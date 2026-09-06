/**
 * Talks to the native-account API: setup, login, invites, password reset,
 * and the admin-only user list. Every call throws an `AuthError` carrying the
 * server's own message, so a form can show it directly rather than a generic
 * "something went wrong."
 */

export type Role = 'admin' | 'member';
export type AccountStatus = 'active' | 'disabled';

export interface AccountUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: AccountStatus;
  createdAt: string;
}

export interface AccountsSession {
  needsSetup: boolean;
  user: AccountUser | null;
}

export interface SessionInfo {
  access: boolean;
  signedIn: boolean;
  email: string | null;
  tokenRequired: boolean;
  configured: boolean;
  accounts: AccountsSession;
}

export interface Invite {
  email: string;
  role: Role;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  link: string;
}

export interface UsersResponse {
  users: AccountUser[];
  invites: Invite[];
  limit: number;
}

export class AuthError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function parseBody(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  const body = await parseBody(response);
  if (!response.ok) {
    throw new AuthError((body.error as string) ?? 'unknown', (body.message as string) ?? 'Something went wrong.');
  }
  return body as T;
}

const post = <T>(url: string, payload: unknown) => call<T>(url, { method: 'POST', body: JSON.stringify(payload) });

export const fetchSession = () => call<SessionInfo>('/api/session');

export const setupAdmin = (input: { email: string; name: string; password: string }) =>
  post<{ user: AccountUser }>('/api/auth/setup', input);

export const login = (input: { email: string; password: string }) =>
  post<{ user: AccountUser }>('/api/auth/login', input);

export const logout = () => post<{ ok: boolean }>('/api/auth/logout', {});

export const fetchInvite = (token: string) => call<{ email: string; role: Role }>(`/api/auth/invite?token=${encodeURIComponent(token)}`);

export const acceptInvite = (input: { token: string; name: string; password: string }) =>
  post<{ user: AccountUser }>('/api/auth/accept-invite', input);

export const forgotPassword = (email: string) => post<{ ok: boolean; message: string }>('/api/auth/forgot-password', { email });

export const resetPassword = (input: { token: string; password: string }) =>
  post<{ user: AccountUser }>('/api/auth/reset-password', input);

export const changePassword = (input: { currentPassword: string; newPassword: string }) =>
  post<{ ok: boolean }>('/api/auth/change-password', input);

export const fetchUsers = () => call<UsersResponse>('/api/users');

export const inviteUser = (input: { email: string; role: Role }) =>
  post<{ invite: Invite; emailed: boolean }>('/api/users/invite', input);

export const revokeInvite = (token: string) => call<{ ok: boolean }>(`/api/users/invite/${encodeURIComponent(token)}`, { method: 'DELETE' });

export const setUserRole = (id: string, role: Role) => post<{ user: AccountUser }>(`/api/users/${encodeURIComponent(id)}/role`, { role });

export const setUserStatus = (id: string, status: AccountStatus) =>
  post<{ user: AccountUser }>(`/api/users/${encodeURIComponent(id)}/status`, { status });

export const adminResetPassword = (id: string) =>
  post<{ link: string; emailed: boolean }>(`/api/users/${encodeURIComponent(id)}/reset-password`, {});

/** The token a link like `/accept-invite?token=…` or `/reset-password?token=…` carries. */
export function tokenFromLink(link: string): string {
  try {
    return new URL(link).searchParams.get('token') ?? '';
  } catch {
    return '';
  }
}
