/**
 * Serves the built board app and its APIs: a two-call board-sync endpoint,
 * and native accounts (invite-only signup, sessions, password reset).
 *
 * Each signed-in account gets its own board — a JSON blob in KV keyed by
 * account id. Writes carry the revision they were based on, so a device that
 * has been offline (or is just a stale tab) is told its base is old rather
 * than silently flattening the newer board.
 *
 * Three ways in are recognised, checked in this order: the session cookie a
 * native login sets, the JWT Cloudflare Access puts on a request it let
 * through at the edge (see `access.ts`), and a shared `BOARD_TOKEN` for
 * callers that are not a browser — a backup script, or `wrangler dev` with
 * neither of the others set up. Only the first — a real account — gets a
 * board of its own; Access and the token still share the one legacy board,
 * exactly as before accounts existed, so an existing single-owner deployment
 * doesn't change behaviour just by upgrading.
 */

import { emailAllowed, teamHost, verifyAccess, type AccessIdentity, type AccessResult } from './access';
import {
  MAX_ACCOUNTS,
  SESSION_TTL_SECONDS,
  accountBoardKey,
  acceptInvite,
  createInvite,
  createPasswordReset,
  createSession,
  destroySession,
  getAccountByEmail,
  getAccountById,
  getInvite,
  listAccounts,
  listInvites,
  needsSetup,
  publicUser,
  resetPassword,
  resolveSession,
  revokeInvite,
  setPassword,
  setRole,
  setStatus,
  setupAdmin,
  verifyLogin,
  type Account,
  type Role,
  type UserStatus,
} from './accounts';
import { hashPassword, isValidEmail, passwordProblem, verifyPassword } from './auth';
import { emailConfigured, sendInviteEmail, sendResetEmail } from './email';

export interface Env {
  BOARD: KVNamespace;
  /** Shared secret for non-browser callers, and a fallback when nothing else is set up. */
  BOARD_TOKEN?: string;
  /** Lets one namespace hold several *legacy* (Access/token) boards if you ever want a second. */
  BOARD_KEY?: string;
  /** Your Zero Trust team, e.g. `myteam` or `myteam.cloudflareaccess.com`. */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Application Audience tag of the Access application on this domain. */
  ACCESS_AUD?: string;
  /** Optional extra gate: only these emails, whatever the Access policy says. */
  ACCESS_EMAILS?: string;
  /** Reserves the one-time admin account bootstrap for this address. See accounts.ts. */
  ADMIN_EMAIL?: string;
  /** Base URL for invite/reset links in emails. Defaults to the request's own origin. */
  APP_URL?: string;
  /** Set this and EMAIL_FROM to have invite/reset emails send themselves, via Resend. */
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  ASSETS: Fetcher;
}

interface StoredBoard {
  rev: number;
  updatedAt: string;
  board: unknown;
}

const SESSION_COOKIE = 'tcard_session';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });

/** Access is on only when both halves are set; one alone can't verify anything. */
const accessConfigured = (env: Env): boolean => Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);

/** Compares without leaking where two secrets first differ. */
function secretsMatch(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const [scheme, ...rest] = header.split(' ');
  return scheme.toLowerCase() === 'bearer' && rest.length > 0 ? rest.join(' ') : null;
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function setCookie(name: string, value: string, opts: { maxAge: number; secure: boolean }): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${opts.maxAge}`];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookie(name: string, opts: { secure: boolean }): string {
  const parts = [`${name}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

const isSecureRequest = (request: Request): boolean => new URL(request.url).protocol === 'https:';

/** Where invite and reset links point. A configured APP_URL beats guessing
 *  from the request, since a request can arrive by a path Access or a proxy
 *  rewrote. */
function appOrigin(request: Request, env: Env): string {
  const configured = env.APP_URL?.trim().replace(/\/+$/, '');
  return configured || new URL(request.url).origin;
}

async function identifyAccount(request: Request, env: Env): Promise<Account | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  return resolveSession(env.BOARD, token);
}

/**
 * Runs the Access check, and applies the optional email allow list on top.
 *
 * An email that Access let through but the allow list doesn't want is reported
 * as `invalid` rather than as a pass, so the caller treats it exactly like a
 * token signed by the wrong team.
 */
async function checkAccess(request: Request, env: Env): Promise<AccessResult | null> {
  if (!accessConfigured(env)) return null;
  const result = await verifyAccess(request, env.ACCESS_TEAM_DOMAIN!, env.ACCESS_AUD!);
  if (result.ok && !emailAllowed(result.identity.email, env.ACCESS_EMAILS)) {
    return { ok: false, reason: 'invalid' };
  }
  return result;
}

type BoardActor =
  | { kind: 'account'; account: Account }
  | { kind: 'access'; identity: AccessIdentity }
  | { kind: 'token' };

function boardKeyFor(env: Env, actor: BoardActor): string {
  return actor.kind === 'account' ? accountBoardKey(actor.account.id) : env.BOARD_KEY || 'board';
}

/**
 * Decides whether a board request may proceed, and who is asking.
 *
 * A native account session wins if there is one; otherwise the Access login a
 * browser arrives with, or the shared token a script carries. A caller with
 * none of the three sees 503 only when there is truly no way in yet — no
 * legacy auth configured *and* nobody has ever set up an account — so that a
 * half-finished setup reads as "not set up" rather than "wrong password".
 */
async function authoriseBoard(
  request: Request,
  env: Env,
  access: AccessResult | null,
  account: Account | null,
): Promise<BoardActor | Response> {
  if (account) return { kind: 'account', account };
  if (access?.ok) return { kind: 'access', identity: access.identity };

  if (env.BOARD_TOKEN) {
    const supplied = bearer(request);
    if (supplied && secretsMatch(supplied, env.BOARD_TOKEN)) return { kind: 'token' };
  }

  if (!env.BOARD_TOKEN && !accessConfigured(env) && (await needsSetup(env.BOARD))) {
    return json(
      {
        error: 'not-configured',
        message: 'This planner has no admin account yet. Open it in a browser to set one up.',
      },
      503,
    );
  }

  // A JWT that merely ran out is a different problem from a wrong one: the
  // browser only needs to visit Access again, which the app can offer to do.
  if (access && !access.ok && access.reason === 'expired') {
    return json({ error: 'signed-out', message: 'Your Cloudflare Access session has expired.' }, 401);
  }

  return json({ error: 'unauthorised', message: 'Sign in to continue.' }, 401);
}

async function readBoard(env: Env, key: string): Promise<StoredBoard | null> {
  return env.BOARD.get<StoredBoard>(key, 'json');
}

async function handleApi(
  request: Request,
  env: Env,
  path: string,
  access: AccessResult | null,
): Promise<Response> {
  // Deliberately open: it answers whether the Worker is up and what it expects
  // you to log in with, and nothing about the board or about you. It is what
  // you curl when the login itself is the thing that isn't working.
  if (path === '/api/health') {
    return json({
      ok: true,
      configured: Boolean(env.BOARD_TOKEN) || accessConfigured(env) || !(await needsSetup(env.BOARD)),
      access: accessConfigured(env),
    });
  }

  // Who the app is talking to, so it can say so and stop asking for a token
  // it no longer needs. Only ever reports an identity that just verified.
  if (path === '/api/session') {
    const account = await identifyAccount(request, env);
    return json({
      access: accessConfigured(env),
      signedIn: Boolean(access?.ok),
      email: access?.ok ? access.identity.email : null,
      tokenRequired: !access?.ok && Boolean(env.BOARD_TOKEN),
      configured: Boolean(env.BOARD_TOKEN) || accessConfigured(env),
      accounts: {
        needsSetup: account ? false : await needsSetup(env.BOARD),
        user: account ? publicUser(account) : null,
      },
    });
  }

  if (path !== '/api/board') return json({ error: 'not-found' }, 404);

  const account = await identifyAccount(request, env);
  const allowed = await authoriseBoard(request, env, access, account);
  if (allowed instanceof Response) return allowed;
  const boardKey = boardKeyFor(env, allowed);

  if (request.method === 'GET') {
    const stored = await readBoard(env, boardKey);
    // 204 means "authorised, but nothing saved yet" — the client then pushes
    // whatever it has locally instead of wiping itself.
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

    const stored = await readBoard(env, boardKey);
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
    await env.BOARD.put(boardKey, JSON.stringify(next));
    return json({ rev: next.rev, updatedAt: next.updatedAt });
  }

  return json({ error: 'method-not-allowed' }, 405, { allow: 'GET, PUT' });
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Native account auth: setup, login, invite acceptance, password reset.
 *
 * Invite-only by design — there is no open signup endpoint. The cap on the
 * whole beta is enforced in `accounts.ts`, at invite time and again at
 * acceptance, so a burst of last-minute invites can't overshoot it.
 */
async function handleAuth(request: Request, env: Env, path: string): Promise<Response> {
  const secure = isSecureRequest(request);
  const signIn = async (account: Account, status = 200) => {
    const token = await createSession(env.BOARD, account.id);
    return json({ user: publicUser(account) }, status, {
      'set-cookie': setCookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL_SECONDS, secure }),
    });
  };

  if (path === '/api/auth/setup' && request.method === 'POST') {
    const body = await readJson<{ email?: string; name?: string; password?: string }>(request);
    if (!body) return json({ error: 'bad-json' }, 400);
    const email = (body.email || '').trim();
    const name = (body.name || '').trim();
    if (!isValidEmail(email)) return json({ error: 'bad-email', message: 'Enter a valid email address.' }, 400);
    if (!name) return json({ error: 'bad-name', message: 'Enter your name.' }, 400);
    const problem = passwordProblem(body.password || '');
    if (problem) return json({ error: 'bad-password', message: problem }, 400);

    const result = await setupAdmin(env.BOARD, env.ADMIN_EMAIL, {
      email,
      name,
      passwordHash: await hashPassword(body.password!),
    });
    if (result === 'exists') {
      return json({ error: 'already-set-up', message: 'This planner already has an admin account — sign in instead.' }, 409);
    }
    if (result === 'wrong-email') {
      return json(
        { error: 'wrong-email', message: 'This planner reserves the admin account for a specific email address.' },
        403,
      );
    }
    return signIn(result, 201);
  }

  if (path === '/api/auth/login' && request.method === 'POST') {
    const body = await readJson<{ email?: string; password?: string }>(request);
    if (!body) return json({ error: 'bad-json' }, 400);
    const account = await verifyLogin(env.BOARD, (body.email || '').trim(), body.password || '');
    if (!account) return json({ error: 'invalid-credentials', message: 'Wrong email or password.' }, 401);
    if (account.status !== 'active') {
      return json({ error: 'disabled', message: 'This account has been disabled. Contact your admin.' }, 403);
    }
    return signIn(account);
  }

  if (path === '/api/auth/logout' && request.method === 'POST') {
    const token = cookieValue(request, SESSION_COOKIE);
    if (token) await destroySession(env.BOARD, token);
    return json({ ok: true }, 200, { 'set-cookie': clearCookie(SESSION_COOKIE, { secure }) });
  }

  if (path === '/api/auth/invite' && request.method === 'GET') {
    const token = new URL(request.url).searchParams.get('token') || '';
    const invite = await getInvite(env.BOARD, token);
    if (!invite) return json({ error: 'invalid-invite', message: 'This invite link is invalid or has expired.' }, 404);
    return json({ email: invite.email, role: invite.role });
  }

  if (path === '/api/auth/accept-invite' && request.method === 'POST') {
    const body = await readJson<{ token?: string; name?: string; password?: string }>(request);
    if (!body) return json({ error: 'bad-json' }, 400);
    const name = (body.name || '').trim();
    if (!name) return json({ error: 'bad-name', message: 'Enter your name.' }, 400);
    const problem = passwordProblem(body.password || '');
    if (problem) return json({ error: 'bad-password', message: problem }, 400);

    const result = await acceptInvite(env.BOARD, (body.token || '').trim(), {
      name,
      passwordHash: await hashPassword(body.password!),
    });
    if (result === 'invalid') {
      return json(
        { error: 'invalid-invite', message: 'This invite link is invalid or has expired. Ask your admin for a new one.' },
        400,
      );
    }
    if (result === 'exists') {
      return json({ error: 'already-exists', message: 'An account already exists for this email — sign in instead.' }, 409);
    }
    if (result === 'full') {
      return json({ error: 'full', message: `This beta is capped at ${MAX_ACCOUNTS} accounts.` }, 409);
    }
    return signIn(result, 201);
  }

  if (path === '/api/auth/forgot-password' && request.method === 'POST') {
    const body = await readJson<{ email?: string }>(request);
    const email = (body?.email || '').trim();
    if (isValidEmail(email)) {
      const account = await getAccountByEmail(env.BOARD, email);
      if (account && account.status === 'active') {
        const token = await createPasswordReset(env.BOARD, account.id);
        await sendResetEmail(env, account.email, `${appOrigin(request, env)}/reset-password?token=${token}`);
      }
    }
    // The same response either way — whether an account exists for that email
    // is not something a caller who isn't signed in gets to learn.
    return json({
      ok: true,
      message: emailConfigured(env)
        ? 'If that email has an account, a reset link is on its way.'
        : "Email isn't set up on this planner yet — ask your admin for a reset link instead.",
    });
  }

  if (path === '/api/auth/reset-password' && request.method === 'POST') {
    const body = await readJson<{ token?: string; password?: string }>(request);
    if (!body) return json({ error: 'bad-json' }, 400);
    const problem = passwordProblem(body.password || '');
    if (problem) return json({ error: 'bad-password', message: problem }, 400);

    const result = await resetPassword(env.BOARD, (body.token || '').trim(), await hashPassword(body.password!));
    if (result === 'invalid') {
      return json({ error: 'invalid-token', message: 'This reset link is invalid or has expired.' }, 400);
    }
    return signIn(result);
  }

  if (path === '/api/auth/change-password' && request.method === 'POST') {
    const account = await identifyAccount(request, env);
    if (!account) return json({ error: 'unauthorised' }, 401);
    const body = await readJson<{ currentPassword?: string; newPassword?: string }>(request);
    if (!body) return json({ error: 'bad-json' }, 400);
    const ok = await verifyPassword(body.currentPassword || '', account.passwordHash);
    if (!ok) return json({ error: 'wrong-password', message: 'Your current password is wrong.' }, 400);
    const problem = passwordProblem(body.newPassword || '');
    if (problem) return json({ error: 'bad-password', message: problem }, 400);
    await setPassword(env.BOARD, account, body.newPassword!);
    return json({ ok: true });
  }

  return json({ error: 'not-found' }, 404);
}

/**
 * Admin-only user management: invite, list, promote/demote, enable/disable,
 * and hand out a reset link for someone who can't get email.
 */
async function handleUsers(request: Request, env: Env, path: string): Promise<Response> {
  const account = await identifyAccount(request, env);
  if (!account) return json({ error: 'unauthorised', message: 'Sign in to continue.' }, 401);
  if (account.role !== 'admin') return json({ error: 'forbidden', message: 'Admins only.' }, 403);

  if (path === '/api/users' && request.method === 'GET') {
    const [accounts, invites] = await Promise.all([listAccounts(env.BOARD), listInvites(env.BOARD)]);
    return json({
      users: accounts.map(publicUser),
      invites: invites.map(({ token, email, role, invitedBy, createdAt, expiresAt }) => ({
        email,
        role,
        invitedBy,
        createdAt,
        expiresAt,
        link: `${appOrigin(request, env)}/accept-invite?token=${token}`,
      })),
      limit: MAX_ACCOUNTS,
    });
  }

  if (path === '/api/users/invite' && request.method === 'POST') {
    const body = await readJson<{ email?: string; role?: string }>(request);
    if (!body) return json({ error: 'bad-json' }, 400);
    const email = (body.email || '').trim();
    if (!isValidEmail(email)) return json({ error: 'bad-email', message: 'Enter a valid email address.' }, 400);
    const role: Role = body.role === 'admin' ? 'admin' : 'member';

    const result = await createInvite(env.BOARD, account.id, email, role);
    if (result === 'exists') return json({ error: 'exists', message: 'That person already has an account.' }, 409);
    if (result === 'pending') {
      return json({ error: 'pending', message: 'There is already a pending invite for that email.' }, 409);
    }
    if (result === 'full') {
      return json({ error: 'full', message: `This beta is capped at ${MAX_ACCOUNTS} accounts.` }, 409);
    }

    const link = `${appOrigin(request, env)}/accept-invite?token=${result.token}`;
    const emailed = await sendInviteEmail(env, result.email, link, account.name || account.email);
    return json({ invite: { email: result.email, role: result.role, expiresAt: result.expiresAt, link }, emailed }, 201);
  }

  const inviteMatch = path.match(/^\/api\/users\/invite\/([^/]+)$/);
  if (inviteMatch && request.method === 'DELETE') {
    await revokeInvite(env.BOARD, decodeURIComponent(inviteMatch[1]));
    return json({ ok: true });
  }

  const userMatch = path.match(/^\/api\/users\/([^/]+)\/(role|status|reset-password)$/);
  if (userMatch) {
    const [, rawId, action] = userMatch;
    const target = await getAccountById(env.BOARD, decodeURIComponent(rawId));
    if (!target) return json({ error: 'not-found' }, 404);

    if (action === 'role' && request.method === 'POST') {
      const body = await readJson<{ role?: string }>(request);
      if (!body) return json({ error: 'bad-json' }, 400);
      const role: Role = body.role === 'admin' ? 'admin' : 'member';
      const result = await setRole(env.BOARD, target, role);
      if (result === 'last-admin') {
        return json({ error: 'last-admin', message: 'This planner needs at least one admin — promote someone else first.' }, 409);
      }
      return json({ user: publicUser(result) });
    }

    if (action === 'status' && request.method === 'POST') {
      const body = await readJson<{ status?: string }>(request);
      if (!body) return json({ error: 'bad-json' }, 400);
      const status: UserStatus = body.status === 'disabled' ? 'disabled' : 'active';
      const result = await setStatus(env.BOARD, target, status);
      if (result === 'last-admin') {
        return json({ error: 'last-admin', message: 'This planner needs at least one active admin.' }, 409);
      }
      return json({ user: publicUser(result) });
    }

    if (action === 'reset-password' && request.method === 'POST') {
      const token = await createPasswordReset(env.BOARD, target.id);
      const link = `${appOrigin(request, env)}/reset-password?token=${token}`;
      const emailed = await sendResetEmail(env, target.email, link);
      return json({ link, emailed });
    }
  }

  return json({ error: 'not-found' }, 404);
}

/**
 * The page shown when the app itself is asked for without an Access login.
 *
 * Access normally challenges before the request ever gets here, so reaching
 * this page means the request arrived by a route the Access application does
 * not cover. Sending it to the login would only loop, so it says what is
 * actually wrong instead. Only ever shown on a deployment that has Access
 * configured at all — an accounts-only deployment never reaches this.
 */
function deniedPage(reason: 'missing' | 'expired' | 'invalid'): Response {
  const heading = reason === 'expired' ? 'Your session has expired' : 'Sign-in required';
  const detail =
    reason === 'expired'
      ? 'Reload this page and Cloudflare Access will sign you back in.'
      : reason === 'invalid'
        ? 'Your login was not accepted for this board. If it is yours, check the Access policy and the ACCESS_AUD value on the Worker.'
        : 'This request did not come through Cloudflare Access. Open the board on its usual address — the one the Access application protects.';

  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${heading} — T-Card Planner</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
         font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
         background:#eef1f5; color:#1e2430; }
  main { max-width:34rem; }
  h1 { font-size:1.3rem; margin:0 0 .6em; }
  p { margin:0 0 1em; color:#4a5568; }
  @media (prefers-color-scheme: dark) { body { background:#161a20; color:#e6e9ee; } p { color:#9aa4b2; } }
</style>
<main><h1>${heading}</h1><p>${detail}</p></main>`,
    { status: reason === 'expired' ? 401 : 403, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;

    // Cloudflare handles /cdn-cgi/access/* at the edge, so this only runs if
    // the request somehow got past it. Sending sign-out on to the team domain
    // means the button in the app works either way.
    if (path === '/cdn-cgi/access/logout' && env.ACCESS_TEAM_DOMAIN) {
      return Response.redirect(`https://${teamHost(env.ACCESS_TEAM_DOMAIN)}/cdn-cgi/access/logout`, 302);
    }

    const access = await checkAccess(request, env);

    if (path.startsWith('/api/auth/')) {
      const response = await handleAuth(request, env, path);
      response.headers.append('vary', 'cookie');
      return response;
    }

    if (path.startsWith('/api/users')) {
      const response = await handleUsers(request, env, path);
      response.headers.append('vary', 'cookie');
      return response;
    }

    if (path.startsWith('/api/')) {
      const response = await handleApi(request, env, path, access);
      // Same-origin only: the app is served by this very Worker, so there is
      // no reason to hand the API to another site. The reply depends on every
      // credential a caller might carry, so none of them may be cached across
      // callers.
      response.headers.set('vary', 'authorization, cookie');
      return response;
    }

    // The app itself. With Access configured nothing is served without a valid
    // login — not even the shell — so a Worker reachable on some address the
    // Access application misses is a closed door rather than an open one.
    // Accounts don't gate the shell the same way: the SPA itself decides what
    // to show (setup, sign in, or the board) once it asks `/api/session`.
    if (access && !access.ok) return deniedPage(access.reason);

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
