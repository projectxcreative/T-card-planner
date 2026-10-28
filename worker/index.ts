/**
 * Serves the built board app, in-app authentication & user/workspace management,
 * and the workspace-scoped sync, file, and calendar feed APIs.
 */

import { emailAllowed, teamHost, verifyAccess, type AccessIdentity, type AccessResult } from './access.ts';
import {
  accessibleWorkspaces,
  canAccessWorkspace,
  clearSessionCookieHeader,
  createSession,
  deleteSession,
  ensurePersonalWorkspace,
  extractSessionToken,
  hashPassword,
  nextUserColour,
  randomId,
  randomToken,
  readUsers,
  readWorkspaces,
  secretsMatch,
  sessionCookieHeader,
  toPublicUser,
  verifyPassword,
  verifySession,
  writeUsers,
  writeWorkspaces,
  type PublicUser,
  type StoredUser,
  type UserRole,
  type Workspace,
  type WorkspaceKind,
} from './auth.ts';
import { fileIdFrom, handleFile, listFiles } from './files.ts';
import {
  DEFAULT_FEED_OPTIONS,
  isValidTimeZone,
  normaliseOptions,
  renderCalendar,
  type FeedOptions,
} from './calendar.ts';

export interface Env {
  BOARD: KVNamespace;
  /** Optional shared secret for non-browser callers (e.g. backup scripts). */
  BOARD_TOKEN?: string;
  /** Default board key in KV (`board` when omitted). */
  BOARD_KEY?: string;
  /** Legacy Cloudflare Access settings (optional fallback if still configured). */
  DEMO_MODE?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ACCESS_EMAILS?: string;
  ASSETS: Fetcher;
}

interface StoredBoard {
  rev: number;
  updatedAt: string;
  board: unknown;
}

interface StoredFeed {
  token: string;
  createdAt: string;
  options: FeedOptions;
  boardKey?: string;
}

const FEED_PATH = /^\/calendar\/([A-Za-z0-9_-]{16,128})\.ics$/;
const FEED_INDEX_PREFIX = 'feed:token:';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });

const accessConfigured = (env: Env): boolean => Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const [scheme, ...rest] = header.split(' ');
  return scheme.toLowerCase() === 'bearer' && rest.length > 0 ? rest.join(' ') : null;
}

async function checkAccess(request: Request, env: Env): Promise<AccessResult | null> {
  if (!accessConfigured(env)) return null;
  const result = await verifyAccess(request, env.ACCESS_TEAM_DOMAIN!, env.ACCESS_AUD!);
  if (result.ok && !emailAllowed(result.identity.email, env.ACCESS_EMAILS)) {
    return { ok: false, reason: 'invalid' };
  }
  return result;
}

interface CallerContext {
  user: StoredUser | null;
  users: Record<string, StoredUser>;
  identity: AccessIdentity | null;
  boardKey: string;
  workspace: Workspace;
  workspaces: Record<string, Workspace>;
}

const defaultBoardKey = (env: Env) => env.BOARD_KEY || 'board';
const feedKeyFor = (bKey: string) => `${bKey}:feed`;

async function resolveCaller(
  request: Request,
  env: Env,
  access: AccessResult | null,
): Promise<CallerContext | Response> {
  const baseKey = defaultBoardKey(env);
  const workspaces = await readWorkspaces(env.BOARD, baseKey);
  const requestedWsId =
    request.headers.get('x-workspace-id')?.trim() ||
    new URL(request.url).searchParams.get('workspace')?.trim() ||
    'default';

  // 1. First-party in-app session (cookie or bearer token)
  const sessionAuth = await verifySession(request, env.BOARD);
  if (sessionAuth) {
    const { user, users } = sessionAuth;
    const ws = workspaces[requestedWsId] ?? workspaces.default;
    if (!canAccessWorkspace(user, ws)) {
      return json({ error: 'forbidden', message: 'You do not have access to this workspace.' }, 403);
    }
    return {
      user,
      users,
      identity: { email: user.email, sub: user.id, service: false },
      boardKey: ws.boardKey,
      workspace: ws,
      workspaces,
    };
  }

  // 2. Shared BOARD_TOKEN for scripts / CLI callers
  if (env.BOARD_TOKEN) {
    const supplied = bearer(request);
    if (supplied && secretsMatch(supplied, env.BOARD_TOKEN)) {
      const users = await readUsers(env.BOARD);
      const ws = workspaces[requestedWsId] ?? workspaces.default;
      return {
        user: null,
        users,
        identity: null,
        boardKey: ws.boardKey,
        workspace: ws,
        workspaces,
      };
    }
  }

  // 3. Optional legacy Cloudflare Access fallback
  if (access?.ok) {
    const users = await readUsers(env.BOARD);
    const matchedUser = Object.values(users).find(
      (u) => u.email.toLowerCase() === access.identity.email.toLowerCase(),
    ) ?? null;
    const ws = workspaces[requestedWsId] ?? workspaces.default;
    return {
      user: matchedUser,
      users,
      identity: access.identity,
      boardKey: ws.boardKey,
      workspace: ws,
      workspaces,
    };
  }

  const users = await readUsers(env.BOARD);
  const hasUsers = Object.keys(users).length > 0;

  if (!hasUsers && !env.BOARD_TOKEN && !accessConfigured(env)) {
    return json(
      {
        error: 'setup-required',
        message: 'Create the initial administrator account to set up this planner.',
      },
      401,
    );
  }

  return json({ error: 'unauthorised', message: 'Please sign in to continue.' }, 401);
}

async function readBoard(env: Env, bKey: string): Promise<StoredBoard | null> {
  return env.BOARD.get<StoredBoard>(bKey, 'json');
}

async function readFeed(env: Env, bKey: string): Promise<StoredFeed | null> {
  const stored = await env.BOARD.get<StoredFeed>(feedKeyFor(bKey), 'json');
  if (!stored || typeof stored.token !== 'string' || !stored.token) return null;
  return {
    token: stored.token,
    createdAt: typeof stored.createdAt === 'string' ? stored.createdAt : '',
    options: normaliseOptions(stored.options),
    boardKey: bKey,
  };
}

const feedUrl = (origin: string, token: string) => `${origin}/calendar/${token}.ics`;

function feedReply(feed: StoredFeed | null, origin: string) {
  return {
    enabled: Boolean(feed),
    url: feed ? feedUrl(origin, feed.token) : null,
    createdAt: feed?.createdAt ?? null,
    options: feed?.options ?? DEFAULT_FEED_OPTIONS,
  };
}

async function handleFeedApi(request: Request, env: Env, bKey: string, origin: string): Promise<Response> {
  const held = await readFeed(env, bKey);

  if (request.method === 'GET') return json(feedReply(held, origin));

  if (request.method === 'DELETE') {
    if (held?.token) await env.BOARD.delete(`${FEED_INDEX_PREFIX}${held.token}`);
    await env.BOARD.delete(feedKeyFor(bKey));
    return json(feedReply(null, origin));
  }

  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405, { allow: 'GET, POST, DELETE' });

  let payload: { rotate?: boolean } & Partial<FeedOptions>;
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ error: 'bad-json' }, 400);
  }

  const zone = typeof payload?.timeZone === 'string' ? payload.timeZone.trim() : '';
  if (zone && !isValidTimeZone(zone)) return json({ error: 'bad-timezone' }, 400);

  const rotating = !held || Boolean(payload?.rotate);
  if (rotating && held?.token) {
    await env.BOARD.delete(`${FEED_INDEX_PREFIX}${held.token}`);
  }

  const next: StoredFeed = {
    token: !rotating && held ? held.token : randomToken(32),
    createdAt: !rotating && held ? held.createdAt : new Date().toISOString(),
    options: normaliseOptions(payload, held?.options ?? DEFAULT_FEED_OPTIONS),
    boardKey: bKey,
  };
  await env.BOARD.put(feedKeyFor(bKey), JSON.stringify(next));
  await env.BOARD.put(`${FEED_INDEX_PREFIX}${next.token}`, bKey);
  return json(feedReply(next, origin));
}

async function handleFeed(request: Request, env: Env, token: string, origin: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method-not-allowed' }, 405, { allow: 'GET, HEAD' });
  }

  const indexedKey = await env.BOARD.get(`${FEED_INDEX_PREFIX}${token}`);
  const targetBoardKey = indexedKey || defaultBoardKey(env);
  const feed = await readFeed(env, targetBoardKey);
  if (!feed || !secretsMatch(token, feed.token)) return new Response('Not found', { status: 404 });

  const stored = await readBoard(env, targetBoardKey);
  const body = renderCalendar(stored?.board ?? {}, feed.options, { origin });
  const headers = {
    'content-type': 'text/calendar; charset=utf-8',
    'content-disposition': `inline; filename="${targetBoardKey.replace(/[^a-zA-Z0-9_-]/g, '-')}.ics"`,
    'cache-control': 'no-cache, private',
    etag: `W/"${stored?.rev ?? 0}-${feed.createdAt}-${hash(JSON.stringify(feed.options))}"`,
  };

  if (request.headers.get('if-none-match') === headers.etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(request.method === 'HEAD' ? null : body, { headers });
}

function hash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/* ---------- Auth, User & Workspace endpoints ---------- */

async function handleAuthApi(request: Request, env: Env, path: string): Promise<Response> {
  const baseKey = defaultBoardKey(env);

  if (path === '/api/auth/setup' && request.method === 'POST') {
    const users = await readUsers(env.BOARD);
    if (Object.keys(users).length > 0) {
      return json({ error: 'already-configured', message: 'An administrator account already exists. Please sign in.' }, 400);
    }

    let body: { email?: string; name?: string; password?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: 'bad-json' }, 400);
    }

    const email = (body.email ?? '').trim().toLowerCase();
    const name = (body.name ?? '').trim() || email.split('@')[0] || 'Admin';
    const password = body.password ?? '';

    if (!email || !email.includes('@')) {
      return json({ error: 'invalid-email', message: 'Enter a valid email address.' }, 400);
    }
    if (password.length < 6) {
      return json({ error: 'weak-password', message: 'Password must be at least 6 characters.' }, 400);
    }

    const { salt, hash: passwordHash } = await hashPassword(password);
    const user: StoredUser = {
      id: randomId(),
      email,
      name: name.slice(0, 60),
      role: 'admin',
      colour: nextUserColour(0),
      salt,
      passwordHash,
      createdAt: new Date().toISOString(),
    };

    const nextUsers = { [user.id]: user };
    await writeUsers(env.BOARD, nextUsers);

    let workspaces = await readWorkspaces(env.BOARD, baseKey);
    workspaces = ensurePersonalWorkspace(user, workspaces);
    await writeWorkspaces(env.BOARD, workspaces);

    const session = await createSession(env.BOARD, user.id);
    const pubUser = toPublicUser(user);
    return json(
      {
        sessionToken: session.token,
        user: pubUser,
        workspaces: accessibleWorkspaces(user, workspaces),
        users: [pubUser],
      },
      200,
      { 'set-cookie': sessionCookieHeader(session.token, request.url) },
    );
  }

  if (path === '/api/auth/login' && request.method === 'POST') {
    let body: { email?: string; password?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: 'bad-json' }, 400);
    }

    const email = (body.email ?? '').trim().toLowerCase();
    const password = body.password ?? '';
    const users = await readUsers(env.BOARD);
    const user = Object.values(users).find((u) => u.email.toLowerCase() === email);

    if (!user || !(await verifyPassword(password, user.salt, user.passwordHash))) {
      return json({ error: 'invalid-credentials', message: 'Incorrect email or password.' }, 401);
    }

    let workspaces = await readWorkspaces(env.BOARD, baseKey);
    workspaces = ensurePersonalWorkspace(user, workspaces);
    await writeWorkspaces(env.BOARD, workspaces);

    const session = await createSession(env.BOARD, user.id);
    const pubUser = toPublicUser(user);
    return json(
      {
        sessionToken: session.token,
        user: pubUser,
        workspaces: accessibleWorkspaces(user, workspaces),
        users: Object.values(users).map(toPublicUser),
      },
      200,
      { 'set-cookie': sessionCookieHeader(session.token, request.url) },
    );
  }

  if (path === '/api/auth/logout' && request.method === 'POST') {
    const token = extractSessionToken(request);
    if (token) await deleteSession(env.BOARD, token);
    return json({ ok: true }, 200, { 'set-cookie': clearSessionCookieHeader(request.url) });
  }

  if (path === '/api/auth/profile' && request.method === 'POST') {
    const verified = await verifySession(request, env.BOARD);
    if (!verified) return json({ error: 'unauthorised' }, 401);

    let body: { name?: string; colour?: string; currentPassword?: string; newPassword?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: 'bad-json' }, 400);
    }

    const { user, users } = verified;
    const updated: StoredUser = { ...user };
    if (typeof body.name === 'string' && body.name.trim()) {
      updated.name = body.name.trim().slice(0, 60);
    }
    if (typeof body.colour === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.colour)) {
      updated.colour = body.colour.toLowerCase();
    }
    if (body.newPassword) {
      if (body.newPassword.length < 6) {
        return json({ error: 'weak-password', message: 'New password must be at least 6 characters.' }, 400);
      }
      if (body.currentPassword && !(await verifyPassword(body.currentPassword, user.salt, user.passwordHash))) {
        return json({ error: 'invalid-password', message: 'Current password did not match.' }, 400);
      }
      const { salt, hash: passwordHash } = await hashPassword(body.newPassword);
      updated.salt = salt;
      updated.passwordHash = passwordHash;
    }

    users[user.id] = updated;
    await writeUsers(env.BOARD, users);
    return json({ user: toPublicUser(updated), users: Object.values(users).map(toPublicUser) });
  }

  return json({ error: 'not-found' }, 404);
}

async function handleUsersApi(request: Request, env: Env, path: string): Promise<Response> {
  const verified = await verifySession(request, env.BOARD);
  if (!verified) return json({ error: 'unauthorised' }, 401);
  const { user: currentUser, users } = verified;

  if (path === '/api/users' && request.method === 'GET') {
    return json({ users: Object.values(users).map(toPublicUser) });
  }

  if (currentUser.role !== 'admin') {
    return json({ error: 'forbidden', message: 'Only administrators can manage team accounts.' }, 403);
  }

  if (path === '/api/users' && request.method === 'POST') {
    let body: { email?: string; name?: string; password?: string; role?: UserRole; colour?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: 'bad-json' }, 400);
    }

    const email = (body.email ?? '').trim().toLowerCase();
    const name = (body.name ?? '').trim() || email.split('@')[0] || 'Member';
    const password = body.password ?? '';
    const role: UserRole = body.role === 'admin' ? 'admin' : 'member';

    if (!email || !email.includes('@')) {
      return json({ error: 'invalid-email', message: 'Enter a valid email address.' }, 400);
    }
    if (Object.values(users).some((u) => u.email.toLowerCase() === email)) {
      return json({ error: 'duplicate-email', message: 'A user with that email already exists.' }, 409);
    }
    if (password.length < 6) {
      return json({ error: 'weak-password', message: 'Password must be at least 6 characters.' }, 400);
    }

    const { salt, hash: passwordHash } = await hashPassword(password);
    const created: StoredUser = {
      id: randomId(),
      email,
      name: name.slice(0, 60),
      role,
      colour:
        typeof body.colour === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.colour)
          ? body.colour.toLowerCase()
          : nextUserColour(Object.keys(users).length),
      salt,
      passwordHash,
      createdAt: new Date().toISOString(),
    };

    users[created.id] = created;
    await writeUsers(env.BOARD, users);

    const baseKey = defaultBoardKey(env);
    let workspaces = await readWorkspaces(env.BOARD, baseKey);
    workspaces = ensurePersonalWorkspace(created, workspaces);
    await writeWorkspaces(env.BOARD, workspaces);

    return json({
      user: toPublicUser(created),
      users: Object.values(users).map(toPublicUser),
      workspaces: accessibleWorkspaces(currentUser, workspaces),
    });
  }

  const match = /^\/api\/users\/([A-Za-z0-9_-]+)$/.exec(path);
  if (!match) return json({ error: 'not-found' }, 404);
  const targetId = match[1];
  const target = users[targetId];
  if (!target) return json({ error: 'not-found' }, 404);

  if (request.method === 'PATCH') {
    let body: { name?: string; role?: UserRole; colour?: string; password?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: 'bad-json' }, 400);
    }

    const updated: StoredUser = { ...target };
    if (typeof body.name === 'string' && body.name.trim()) {
      updated.name = body.name.trim().slice(0, 60);
    }
    if (body.role === 'admin' || body.role === 'member') {
      const adminCount = Object.values(users).filter((u) => u.role === 'admin').length;
      if (target.role === 'admin' && body.role !== 'admin' && adminCount <= 1) {
        return json({ error: 'last-admin', message: 'Cannot demote the only administrator.' }, 400);
      }
      updated.role = body.role;
    }
    if (typeof body.colour === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.colour)) {
      updated.colour = body.colour.toLowerCase();
    }
    if (typeof body.password === 'string' && body.password.length > 0) {
      if (body.password.length < 6) {
        return json({ error: 'weak-password', message: 'Password must be at least 6 characters.' }, 400);
      }
      const { salt, hash: passwordHash } = await hashPassword(body.password);
      updated.salt = salt;
      updated.passwordHash = passwordHash;
    }

    users[targetId] = updated;
    await writeUsers(env.BOARD, users);
    return json({ user: toPublicUser(updated), users: Object.values(users).map(toPublicUser) });
  }

  if (request.method === 'DELETE') {
    const adminCount = Object.values(users).filter((u) => u.role === 'admin').length;
    if (target.role === 'admin' && adminCount <= 1) {
      return json({ error: 'last-admin', message: 'Cannot remove the last administrator.' }, 400);
    }
    delete users[targetId];
    await writeUsers(env.BOARD, users);
    return json({ users: Object.values(users).map(toPublicUser) });
  }

  return json({ error: 'method-not-allowed' }, 405);
}

async function handleWorkspacesApi(request: Request, env: Env, path: string): Promise<Response> {
  const verified = await verifySession(request, env.BOARD);
  if (!verified) return json({ error: 'unauthorised' }, 401);
  const { user } = verified;
  const baseKey = defaultBoardKey(env);
  const workspaces = await readWorkspaces(env.BOARD, baseKey);

  if (path === '/api/workspaces' && request.method === 'GET') {
    return json({ workspaces: accessibleWorkspaces(user, workspaces) });
  }

  if (path === '/api/workspaces' && request.method === 'POST') {
    let body: { name?: string; kind?: WorkspaceKind };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: 'bad-json' }, 400);
    }

    const name = (body.name ?? '').trim().slice(0, 60);
    if (!name) return json({ error: 'invalid-name', message: 'Enter a workspace name.' }, 400);

    const kind: WorkspaceKind = body.kind === 'personal' ? 'personal' : 'team';
    if (kind === 'team' && user.role !== 'admin') {
      return json({ error: 'forbidden', message: 'Only administrators can create shared team workspaces.' }, 403);
    }

    const id = `${kind}-${randomId()}`;
    const created: Workspace = {
      id,
      name,
      kind,
      ownerId: user.id,
      memberIds: kind === 'team' ? ['*'] : [user.id],
      boardKey: `ws:${id}`,
      createdAt: new Date().toISOString(),
    };

    workspaces[id] = created;
    await writeWorkspaces(env.BOARD, workspaces);
    return json({ workspace: created, workspaces: accessibleWorkspaces(user, workspaces) });
  }

  const match = /^\/api\/workspaces\/([A-Za-z0-9_-]+)$/.exec(path);
  if (!match) return json({ error: 'not-found' }, 404);
  const wsId = match[1];
  const target = workspaces[wsId];
  if (!target || !canAccessWorkspace(user, target)) return json({ error: 'not-found' }, 404);

  if (request.method === 'PATCH') {
    let body: { name?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: 'bad-json' }, 400);
    }
    if (typeof body.name === 'string' && body.name.trim()) {
      target.name = body.name.trim().slice(0, 60);
      workspaces[wsId] = target;
      await writeWorkspaces(env.BOARD, workspaces);
    }
    return json({ workspace: target, workspaces: accessibleWorkspaces(user, workspaces) });
  }

  if (request.method === 'DELETE') {
    if (wsId === 'default') {
      return json({ error: 'cannot-delete-default', message: 'The default team board cannot be deleted.' }, 400);
    }
    if (target.kind === 'team' && user.role !== 'admin') {
      return json({ error: 'forbidden', message: 'Only administrators can delete shared team boards.' }, 403);
    }
    delete workspaces[wsId];
    await writeWorkspaces(env.BOARD, workspaces);
    return json({ workspaces: accessibleWorkspaces(user, workspaces) });
  }

  return json({ error: 'method-not-allowed' }, 405);
}

async function handleApi(
  request: Request,
  env: Env,
  path: string,
  access: AccessResult | null,
): Promise<Response> {
  if (path === '/api/health') {
    const users = await readUsers(env.BOARD);
    const hasUsers = Object.keys(users).length > 0;
    return json({
      ok: true,
      configured: hasUsers || Boolean(env.BOARD_TOKEN) || accessConfigured(env),
      setupRequired: !hasUsers,
      access: accessConfigured(env),
    });
  }

  if (path === '/api/session') {
    const baseKey = defaultBoardKey(env);
    const users = await readUsers(env.BOARD);
    const hasUsers = Object.keys(users).length > 0;
    const workspaces = await readWorkspaces(env.BOARD, baseKey);

    const sessionAuth = await verifySession(request, env.BOARD);
    if (sessionAuth) {
      const pubUser = toPublicUser(sessionAuth.user);
      const userWorkspaces = accessibleWorkspaces(sessionAuth.user, workspaces);
      const allUsers: PublicUser[] = Object.values(users).map(toPublicUser);
      return json({
        access: false,
        signedIn: true,
        setupRequired: false,
        user: pubUser,
        email: pubUser.email,
        workspaces: userWorkspaces,
        users: allUsers,
        tokenRequired: false,
        configured: true,
      });
    }

    return json({
      access: accessConfigured(env),
      signedIn: Boolean(access?.ok),
      setupRequired: !hasUsers && !access?.ok,
      user: null,
      email: access?.ok ? access.identity.email : null,
      workspaces: access?.ok ? Object.values(workspaces) : [],
      users: [],
      tokenRequired: !hasUsers && !access?.ok && Boolean(env.BOARD_TOKEN),
      configured: hasUsers || Boolean(env.BOARD_TOKEN) || accessConfigured(env),
    });
  }

  if (path.startsWith('/api/auth/')) {
    return handleAuthApi(request, env, path);
  }

  if (path === '/api/users' || path.startsWith('/api/users/')) {
    return handleUsersApi(request, env, path);
  }

  if (path === '/api/workspaces' || path.startsWith('/api/workspaces/')) {
    return handleWorkspacesApi(request, env, path);
  }

  if (path === '/api/calendar') {
    const caller = await resolveCaller(request, env, access);
    if (caller instanceof Response) return caller;
    return handleFeedApi(request, env, caller.boardKey, new URL(request.url).origin);
  }

  if (path === '/api/files' || path.startsWith('/api/files/')) {
    const caller = await resolveCaller(request, env, access);
    if (caller instanceof Response) return caller;

    if (path === '/api/files') {
      if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405, { allow: 'GET' });
      return listFiles(env.BOARD, caller.boardKey);
    }

    const id = fileIdFrom(path);
    if (!id) return json({ error: 'not-found' }, 404);
    return handleFile(request, env.BOARD, caller.boardKey, id);
  }

  if (path !== '/api/board') return json({ error: 'not-found' }, 404);

  const caller = await resolveCaller(request, env, access);
  if (caller instanceof Response) return caller;

  if (request.method === 'GET') {
    const stored = await readBoard(env, caller.boardKey);
    return stored ? json(stored) : new Response(null, { status: 204 });
  }

  if (request.method === 'PUT') {
    let payload: { rev?: number; board?: unknown; force?: boolean };
    try {
      payload = (await request.json()) as typeof payload;
    } catch {
      return json({ error: 'bad-json' }, 400);
    }
    if (!payload || typeof payload.board !== 'object' || payload.board === null) {
      return json({ error: 'bad-board' }, 400);
    }

    const stored = await readBoard(env, caller.boardKey);
    const currentRev = stored?.rev ?? 0;
    const baseRev = Number.isFinite(payload.rev) ? Number(payload.rev) : 0;

    if (!payload.force && currentRev !== baseRev) {
      return json({ error: 'conflict', ...(stored as StoredBoard) }, 409);
    }

    const next: StoredBoard = {
      rev: currentRev + 1,
      updatedAt: new Date().toISOString(),
      board: payload.board,
    };
    await env.BOARD.put(caller.boardKey, JSON.stringify(next));
    return json({ rev: next.rev, updatedAt: next.updatedAt });
  }

  return json({ error: 'method-not-allowed' }, 405, { allow: 'GET, PUT' });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/calendar/')) {
      const feedMatch = FEED_PATH.exec(path);
      return feedMatch
        ? handleFeed(request, env, feedMatch[1], url.origin)
        : new Response('Not found', { status: 404 });
    }

    if (path === '/cdn-cgi/access/logout' && env.ACCESS_TEAM_DOMAIN) {
      return Response.redirect(`https://${teamHost(env.ACCESS_TEAM_DOMAIN)}/cdn-cgi/access/logout`, 302);
    }

    const access = await checkAccess(request, env);

    if (path.startsWith('/api/')) {
      const response = await handleApi(request, env, path, access);
      response.headers.set('vary', 'authorization, cookie, x-workspace-id');
      return response;
    }

    // Serve the SPA assets directly; authentication is handled in-app.
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
