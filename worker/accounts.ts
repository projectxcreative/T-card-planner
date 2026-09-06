/**
 * Native accounts: signup by invite, sessions, and password resets — all
 * stored as plain KV records in the same namespace the board already lives
 * in. At the scale this is built for (a beta capped at a handful of people)
 * that's simpler than standing up D1 for what is, in the end, one row per
 * person.
 *
 * Every key is prefixed so it can't collide with the board's own `board` key
 * or with Access's territory, and `acctEmail:` is a hand-rolled secondary
 * index — KV has no query language, so looking a user up by email means
 * keeping id-by-email next to id-by-id and writing both together.
 */

import { hashPassword, randomToken, verifyPassword } from './auth.ts';

export type Role = 'admin' | 'member';
export type UserStatus = 'active' | 'disabled';

export interface Account {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
}

export interface Invite {
  token: string;
  email: string;
  role: Role;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
}

interface Session {
  userId: string;
  createdAt: string;
  expiresAt: string;
}

interface ResetRequest {
  userId: string;
  createdAt: string;
  expiresAt: string;
}

/** Including whoever is running the beta. Raise it if the beta grows. */
export const MAX_ACCOUNTS = 10;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

const userKey = (id: string) => `acct:${id}`;
const emailKey = (email: string) => `acctEmail:${email.toLowerCase().trim()}`;
const sessionKey = (token: string) => `acctSession:${token}`;
const inviteKey = (token: string) => `acctInvite:${token}`;
const resetKey = (token: string) => `acctReset:${token}`;
/** Where a signed-in account's own board lives, separate from the legacy
 *  single shared board that Access/BOARD_TOKEN callers still use. */
export const accountBoardKey = (id: string) => `acctBoard:${id}`;

export function publicUser(account: Account) {
  return { id: account.id, email: account.email, name: account.name, role: account.role, status: account.status, createdAt: account.createdAt };
}

export async function getAccountById(kv: KVNamespace, id: string): Promise<Account | null> {
  return kv.get<Account>(userKey(id), 'json');
}

export async function getAccountByEmail(kv: KVNamespace, email: string): Promise<Account | null> {
  const id = await kv.get(emailKey(email));
  if (!id) return null;
  return getAccountById(kv, id);
}

async function putAccount(kv: KVNamespace, account: Account): Promise<void> {
  await kv.put(userKey(account.id), JSON.stringify(account));
  await kv.put(emailKey(account.email), account.id);
}

/** All accounts, cheap enough at this scale — the point of the 10-person cap
 *  is exactly that this list stays short. */
export async function listAccounts(kv: KVNamespace): Promise<Account[]> {
  const page = await kv.list({ prefix: 'acct:' });
  const accounts = await Promise.all(page.keys.map((entry) => kv.get<Account>(entry.name, 'json')));
  return accounts.filter((account): account is Account => account !== null);
}

export async function listInvites(kv: KVNamespace): Promise<Invite[]> {
  const page = await kv.list({ prefix: 'acctInvite:' });
  const invites = await Promise.all(page.keys.map((entry) => kv.get<Invite>(entry.name, 'json')));
  const now = Date.now();
  return invites.filter((invite): invite is Invite => invite !== null && new Date(invite.expiresAt).getTime() > now);
}

async function seatsUsed(kv: KVNamespace): Promise<number> {
  const [accounts, invites] = await Promise.all([listAccounts(kv), listInvites(kv)]);
  return accounts.length + invites.length;
}

/** Whether the deployment has never had an account created — the window in
 *  which the very first person to arrive gets to become its admin. */
export async function needsSetup(kv: KVNamespace): Promise<boolean> {
  const page = await kv.list({ prefix: 'acct:', limit: 1 });
  return page.keys.length === 0;
}

export type SetupError = 'exists' | 'wrong-email';

/**
 * Creates the very first account, as admin, with no invite needed.
 *
 * Gated on two things at once: the account table being empty, and — when
 * `adminEmail` is configured — the email matching it. Either alone would be
 * enough for casual safety, but together they mean a stranger who finds the
 * Worker before you've set `ADMIN_EMAIL` still can't claim admin once you do,
 * and setting `ADMIN_EMAIL` before your first visit means only you ever could.
 */
export async function setupAdmin(
  kv: KVNamespace,
  adminEmail: string | undefined,
  input: { email: string; name: string; passwordHash: string },
): Promise<Account | SetupError> {
  if (!(await needsSetup(kv))) return 'exists';
  if (adminEmail && adminEmail.trim().toLowerCase() !== input.email.toLowerCase()) return 'wrong-email';

  const account: Account = {
    id: randomToken(12),
    email: input.email.toLowerCase().trim(),
    name: input.name.trim(),
    passwordHash: input.passwordHash,
    role: 'admin',
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  await putAccount(kv, account);
  return account;
}

export type InviteError = 'exists' | 'pending' | 'full';

export async function createInvite(
  kv: KVNamespace,
  invitedBy: string,
  email: string,
  role: Role,
): Promise<Invite | InviteError> {
  const normalised = email.toLowerCase().trim();
  if (await getAccountByEmail(kv, normalised)) return 'exists';

  const invites = await listInvites(kv);
  if (invites.some((invite) => invite.email === normalised)) return 'pending';
  if (invites.length + (await listAccounts(kv)).length >= MAX_ACCOUNTS) return 'full';

  const invite: Invite = {
    token: randomToken(),
    email: normalised,
    role,
    invitedBy,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
  };
  await kv.put(inviteKey(invite.token), JSON.stringify(invite), { expirationTtl: Math.ceil(INVITE_TTL_MS / 1000) });
  return invite;
}

export async function getInvite(kv: KVNamespace, token: string): Promise<Invite | null> {
  const invite = await kv.get<Invite>(inviteKey(token), 'json');
  if (!invite) return null;
  if (new Date(invite.expiresAt).getTime() <= Date.now()) {
    await kv.delete(inviteKey(token));
    return null;
  }
  return invite;
}

export async function revokeInvite(kv: KVNamespace, token: string): Promise<void> {
  await kv.delete(inviteKey(token));
}

export type AcceptError = 'invalid' | 'exists' | 'full';

export async function acceptInvite(
  kv: KVNamespace,
  token: string,
  input: { name: string; passwordHash: string },
): Promise<Account | AcceptError> {
  const invite = await getInvite(kv, token);
  if (!invite) return 'invalid';
  if (await getAccountByEmail(kv, invite.email)) {
    await revokeInvite(kv, token);
    return 'exists';
  }
  if ((await seatsUsed(kv)) > MAX_ACCOUNTS) return 'full';

  const account: Account = {
    id: randomToken(12),
    email: invite.email,
    name: input.name.trim(),
    passwordHash: input.passwordHash,
    role: invite.role,
    status: 'active',
    createdAt: new Date().toISOString(),
  };
  await putAccount(kv, account);
  await revokeInvite(kv, token);
  return account;
}

export async function createSession(kv: KVNamespace, userId: string): Promise<string> {
  const token = randomToken();
  const session: Session = {
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  };
  await kv.put(sessionKey(token), JSON.stringify(session), { expirationTtl: Math.ceil(SESSION_TTL_MS / 1000) });
  return token;
}

export async function resolveSession(kv: KVNamespace, token: string): Promise<Account | null> {
  const session = await kv.get<Session>(sessionKey(token), 'json');
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await kv.delete(sessionKey(token));
    return null;
  }
  const account = await getAccountById(kv, session.userId);
  if (!account || account.status !== 'active') return null;
  return account;
}

export async function destroySession(kv: KVNamespace, token: string): Promise<void> {
  await kv.delete(sessionKey(token));
}

export async function createPasswordReset(kv: KVNamespace, userId: string): Promise<string> {
  const token = randomToken();
  const reset: ResetRequest = {
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + RESET_TTL_MS).toISOString(),
  };
  await kv.put(resetKey(token), JSON.stringify(reset), { expirationTtl: Math.ceil(RESET_TTL_MS / 1000) });
  return token;
}

export type ResetError = 'invalid';

export async function resetPassword(kv: KVNamespace, token: string, newPasswordHash: string): Promise<Account | ResetError> {
  const reset = await kv.get<ResetRequest>(resetKey(token), 'json');
  if (!reset || new Date(reset.expiresAt).getTime() <= Date.now()) {
    if (reset) await kv.delete(resetKey(token));
    return 'invalid';
  }
  const account = await getAccountById(kv, reset.userId);
  if (!account) return 'invalid';

  const updated: Account = { ...account, passwordHash: newPasswordHash };
  await putAccount(kv, updated);
  await kv.delete(resetKey(token));
  return updated;
}

export async function verifyLogin(kv: KVNamespace, email: string, password: string): Promise<Account | null> {
  const account = await getAccountByEmail(kv, email);
  if (!account) return null;
  const ok = await verifyPassword(password, account.passwordHash);
  return ok ? account : null;
}

export async function setPassword(kv: KVNamespace, account: Account, password: string): Promise<Account> {
  const updated: Account = { ...account, passwordHash: await hashPassword(password) };
  await putAccount(kv, updated);
  return updated;
}

export type RoleChangeError = 'last-admin';

/** Refuses to leave the beta with no admin at all — the one state nobody
 *  inside the app could recover from. */
export async function setRole(kv: KVNamespace, account: Account, role: Role): Promise<Account | RoleChangeError> {
  if (account.role === 'admin' && role !== 'admin') {
    const admins = (await listAccounts(kv)).filter((other) => other.role === 'admin' && other.status === 'active');
    if (admins.length <= 1) return 'last-admin';
  }
  const updated: Account = { ...account, role };
  await putAccount(kv, updated);
  return updated;
}

export type StatusChangeError = 'last-admin';

export async function setStatus(kv: KVNamespace, account: Account, status: UserStatus): Promise<Account | StatusChangeError> {
  if (account.role === 'admin' && status !== 'active') {
    const admins = (await listAccounts(kv)).filter((other) => other.role === 'admin' && other.status === 'active');
    if (admins.length <= 1) return 'last-admin';
  }
  const updated: Account = { ...account, status };
  await putAccount(kv, updated);
  return updated;
}
