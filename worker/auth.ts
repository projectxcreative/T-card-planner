/**
 * In-app authentication, user management, and multi-workspace scoping.
 *
 * Replaces external Cloudflare Access edge login with first-party accounts and
 * workspaces stored in the Worker's KV namespace. Passwords are hashed using
 * Web Crypto PBKDF2-HMAC-SHA256 (100,000 iterations) with a per-user 16-byte
 * random salt and compared in constant time.
 */

export type UserRole = 'admin' | 'member';

export interface StoredUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  colour: string;
  salt: string;
  passwordHash: string;
  createdAt: string;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  colour: string;
  createdAt: string;
}

export type WorkspaceKind = 'team' | 'personal';

export interface Workspace {
  id: string;
  name: string;
  kind: WorkspaceKind;
  ownerId: string | null;
  /** User ids allowed into this workspace, or `['*']` for everyone on the team. */
  memberIds: string[];
  /** Underlying KV prefix for the board, its files and its calendar feed. */
  boardKey: string;
  createdAt: string;
}

export interface StoredSession {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

const USERS_KEY = 'auth:users';
const WORKSPACES_KEY = 'auth:workspaces';
const SESSION_PREFIX = 'auth:session:';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const PBKDF2_ITERATIONS = 100_000;

const USER_PALETTE = [
  '#2179c8', '#0f8f8a', '#6f9c22', '#c68512',
  '#d84630', '#7b4a9e', '#b81f6a', '#64748b',
];

export const SESSION_COOKIE = 'tcard_session';

/** Constant-time byte comparison so password and token checks never leak length or prefix. */
export function secretsMatch(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16) || 0;
  }
  return out;
}

export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export async function hashPassword(password: string, saltHex?: string): Promise<{ salt: string; hash: string }> {
  const saltBytes = saltHex ? hexToBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );
  return {
    salt: bytesToHex(saltBytes),
    hash: bytesToHex(new Uint8Array(derived)),
  };
}

export async function verifyPassword(password: string, salt: string, expectedHash: string): Promise<boolean> {
  const { hash } = await hashPassword(password, salt);
  return secretsMatch(hash, expectedHash);
}

export function toPublicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    colour: user.colour,
    createdAt: user.createdAt,
  };
}

export async function readUsers(kv: KVNamespace): Promise<Record<string, StoredUser>> {
  const stored = await kv.get<Record<string, StoredUser>>(USERS_KEY, 'json');
  return stored && typeof stored === 'object' ? stored : {};
}

export async function writeUsers(kv: KVNamespace, users: Record<string, StoredUser>): Promise<void> {
  await kv.put(USERS_KEY, JSON.stringify(users));
}

export async function readWorkspaces(kv: KVNamespace, defaultBoardKey: string): Promise<Record<string, Workspace>> {
  const stored = await kv.get<Record<string, Workspace>>(WORKSPACES_KEY, 'json');
  const map: Record<string, Workspace> = stored && typeof stored === 'object' ? { ...stored } : {};
  if (!map.default) {
    map.default = {
      id: 'default',
      name: 'Team Board',
      kind: 'team',
      ownerId: null,
      memberIds: ['*'],
      boardKey: defaultBoardKey,
      createdAt: new Date().toISOString(),
    };
  } else {
    map.default = { ...map.default, boardKey: defaultBoardKey };
  }
  return map;
}

export async function writeWorkspaces(kv: KVNamespace, workspaces: Record<string, Workspace>): Promise<void> {
  await kv.put(WORKSPACES_KEY, JSON.stringify(workspaces));
}

export function canAccessWorkspace(user: PublicUser | StoredUser, workspace: Workspace): boolean {
  if (user.role === 'admin') return true;
  if (workspace.ownerId === user.id) return true;
  if (workspace.memberIds.includes('*') || workspace.memberIds.includes(user.id)) return true;
  return false;
}

export function accessibleWorkspaces(
  user: PublicUser | StoredUser,
  workspaces: Record<string, Workspace>,
): Workspace[] {
  return Object.values(workspaces)
    .filter((ws) => canAccessWorkspace(user, ws))
    .sort((a, b) => {
      if (a.id === 'default') return -1;
      if (b.id === 'default') return 1;
      if (a.kind !== b.kind) return a.kind === 'team' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

export function ensurePersonalWorkspace(
  user: StoredUser,
  workspaces: Record<string, Workspace>,
): Record<string, Workspace> {
  const personalId = `personal-${user.id}`;
  if (workspaces[personalId]) return workspaces;
  return {
    ...workspaces,
    [personalId]: {
      id: personalId,
      name: `${user.name || user.email.split('@')[0]}'s Board`,
      kind: 'personal',
      ownerId: user.id,
      memberIds: [user.id],
      boardKey: `ws:${personalId}`,
      createdAt: new Date().toISOString(),
    },
  };
}

export function nextUserColour(existingCount: number): string {
  return USER_PALETTE[existingCount % USER_PALETTE.length];
}

export async function createSession(kv: KVNamespace, userId: string): Promise<StoredSession> {
  const token = randomToken(32);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  const session: StoredSession = {
    token,
    userId,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };
  await kv.put(`${SESSION_PREFIX}${token}`, JSON.stringify(session), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return session;
}

export async function deleteSession(kv: KVNamespace, token: string): Promise<void> {
  if (!token) return;
  await kv.delete(`${SESSION_PREFIX}${token}`);
}

export function sessionCookieHeader(token: string, requestUrl: string): string {
  const secure = requestUrl.startsWith('https://') ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

export function clearSessionCookieHeader(requestUrl: string): string {
  const secure = requestUrl.startsWith('https://') ? '; Secure' : '';
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

export function extractSessionToken(request: Request): string | null {
  const auth = request.headers.get('authorization');
  if (auth) {
    const [scheme, ...rest] = auth.split(' ');
    if (scheme.toLowerCase() === 'bearer' && rest.length > 0) {
      const token = rest.join(' ').trim();
      if (token) return token;
    }
  }
  const cookie = request.headers.get('cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const [rawName, ...rawVal] = part.trim().split('=');
    if (rawName === SESSION_COOKIE) {
      const value = rawVal.join('=').trim();
      if (value) return value;
    }
  }
  return null;
}

export async function verifySession(
  request: Request,
  kv: KVNamespace,
): Promise<{ user: StoredUser; token: string; users: Record<string, StoredUser> } | null> {
  const token = extractSessionToken(request);
  if (!token) return null;
  const session = await kv.get<StoredSession>(`${SESSION_PREFIX}${token}`, 'json');
  if (!session || !session.userId) return null;
  if (session.expiresAt && Date.parse(session.expiresAt) < Date.now()) {
    await kv.delete(`${SESSION_PREFIX}${token}`);
    return null;
  }
  const users = await readUsers(kv);
  const user = users[session.userId];
  if (!user) return null;
  return { user, token, users };
}
