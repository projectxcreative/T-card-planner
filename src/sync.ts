import { useCallback, useEffect, useRef, useState } from 'react';
import { isUntouched, normalise } from './store';
import {
  getActiveWorkspaceId,
  getBoardState,
  switchWorkspaceBoard,
  useBoard,
} from './store/boardStore';
import type {
  AppUser,
  BoardState,
  UserRole,
  WorkspaceInfo,
  WorkspaceKind,
} from './types';

const TOKEN_KEY = 'tcard-planner.token';
const SESSION_TOKEN_KEY = 'tcard-planner.session-token';
const META_KEY = 'tcard-planner.sync.v1';
const PUSH_DEBOUNCE_MS = 1200;
const POLL_MS = 45_000;

export type SyncStatus =
  /** No login on this device — the board is local only, which is a fine way to run. */
  | 'off'
  /** The Worker has no users or token set up yet (ready for initial admin setup). */
  | 'unconfigured'
  | 'unauthorised'
  /** Session expired or signed out. */
  | 'signed-out'
  | 'idle'
  | 'saving'
  | 'offline'
  | 'conflict';

interface Meta {
  /** Server revision this device last agreed with. */
  rev: number;
  /** Local edits made since then that the server hasn't accepted. */
  dirty: boolean;
  lastSyncedAt: string | null;
}

/** What the Worker says about who is asking. Null until the first answer. */
interface SessionResponse {
  mode?: 'in-app' | 'token' | 'access';
  setupRequired?: boolean;
  access: boolean;
  signedIn: boolean;
  email: string | null;
  user?: AppUser | null;
  workspaces?: WorkspaceInfo[];
  configured: boolean;
}

const WAITING_ON_LOGIN: SyncStatus[] = ['off', 'signed-out', 'unauthorised', 'unconfigured'];

const DEFAULT_META: Meta = { rev: 0, dirty: false, lastSyncedAt: null };

function metaKeyFor(workspaceId = getActiveWorkspaceId()): string {
  return !workspaceId || workspaceId === 'default' ? META_KEY : `${META_KEY}:${workspaceId}`;
}

function readMeta(workspaceId = getActiveWorkspaceId()): Meta {
  try {
    const raw = localStorage.getItem(metaKeyFor(workspaceId));
    return raw ? { ...DEFAULT_META, ...(JSON.parse(raw) as Partial<Meta>) } : DEFAULT_META;
  } catch {
    return DEFAULT_META;
  }
}

function readToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function readSessionToken(): string {
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeSessionToken(token: string): void {
  try {
    if (token) {
      localStorage.setItem(SESSION_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(SESSION_TOKEN_KEY);
    }
  } catch {
    // Ignore storage issues.
  }
}

/**
 * Headers attached to calls to the Worker.
 * Includes the active workspace ID and any active session or shared token.
 */
export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const bearer = readSessionToken() || readToken();
  const workspaceId = getActiveWorkspaceId();
  const base: Record<string, string> = {
    'x-workspace-id': workspaceId,
  };
  if (bearer) {
    base.authorization = `Bearer ${bearer}`;
  }
  return { ...base, ...extra };
}

export interface Sync {
  status: SyncStatus;
  hasToken: boolean;
  signedIn: boolean;
  setupRequired: boolean;
  user: AppUser | null;
  users: AppUser[];
  workspaces: WorkspaceInfo[];
  activeWorkspaceId: string;
  email: string | null;
  needsToken: boolean;
  authError: string | null;
  authBusy: boolean;
  lastSyncedAt: string | null;
  conflict: BoardState | null;
  setToken: (token: string) => void;
  clearToken: () => void;
  resolve: (choice: 'mine' | 'theirs') => void;
  syncNow: () => void;
  login: (email: string, password: string) => Promise<boolean>;
  setupAdmin: (email: string, name: string, password: string) => Promise<boolean>;
  signIn: () => void;
  signOut: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => void;
  createWorkspace: (name: string, kind: WorkspaceKind) => Promise<WorkspaceInfo | null>;
  renameWorkspace: (id: string, name: string) => Promise<boolean>;
  deleteWorkspace: (id: string) => Promise<boolean>;
  createUser: (input: {
    email: string;
    name: string;
    password: string;
    role: UserRole;
  }) => Promise<{ ok: boolean; error?: string }>;
  updateUser: (
    id: string,
    patch: { name?: string; email?: string; role?: UserRole; password?: string },
  ) => Promise<{ ok: boolean; error?: string }>;
  deleteUser: (id: string) => Promise<{ ok: boolean; error?: string }>;
  updateProfile: (patch: {
    name?: string;
    currentPassword?: string;
    newPassword?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
}

const DEFAULT_WORKSPACES: WorkspaceInfo[] = [
  {
    id: 'default',
    name: 'Team Board',
    kind: 'team',
    ownerId: null,
    createdAt: new Date(0).toISOString(),
  },
];

export function useSync(board: BoardState, adopt: (state: BoardState) => void): Sync {
  const activeWorkspaceId = useBoard(() => getActiveWorkspaceId());
  const [token, setTokenState] = useState(readToken);
  const [sessionToken, setSessionTokenState] = useState(readSessionToken);
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>(DEFAULT_WORKSPACES);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [status, setStatus] = useState<SyncStatus>(() =>
    readSessionToken() || readToken() ? 'idle' : 'off',
  );
  const [conflict, setConflict] = useState<BoardState | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(
    () => readMeta(activeWorkspaceId).lastSyncedAt,
  );

  const meta = useRef<Meta>(readMeta(activeWorkspaceId));
  const synced = useRef<BoardState>(board);
  const conflictRev = useRef(0);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boardRef = useRef(board);
  boardRef.current = board;

  const signedIn = Boolean(session?.signedIn);
  const setupRequired = Boolean(session?.setupRequired);
  const enabled = signedIn || Boolean(token) || Boolean(sessionToken);

  const writeMeta = useCallback((patch: Partial<Meta>, wsId = getActiveWorkspaceId()) => {
    meta.current = { ...meta.current, ...patch };
    try {
      localStorage.setItem(metaKeyFor(wsId), JSON.stringify(meta.current));
    } catch {
      // A full quota shouldn't stop syncing.
    }
    if (patch.lastSyncedAt !== undefined) setLastSyncedAt(patch.lastSyncedAt);
  }, []);

  const headers = useCallback(
    (extra: Record<string, string> = {}) => authHeaders(extra),
    [token, sessionToken, activeWorkspaceId],
  );

  const failureStatus = useCallback(async (response: Response): Promise<SyncStatus | null> => {
    if (response.redirected) return 'signed-out';

    if (response.status === 401) {
      const error = await response
        .clone()
        .json()
        .then((body) => (body as { error?: string }).error)
        .catch(() => undefined);
      return error === 'signed-out' ? 'signed-out' : 'unauthorised';
    }
    if (response.status === 503) return 'unconfigured';
    if (!response.ok && response.status !== 409) return 'offline';
    return null;
  }, []);

  const push = useCallback(
    async (state: BoardState, force = false) => {
      if (!enabled || inFlight.current) return;
      inFlight.current = true;
      setStatus('saving');
      try {
        const response = await fetch('/api/board', {
          method: 'PUT',
          headers: headers({ 'content-type': 'application/json' }),
          body: JSON.stringify({ rev: force ? undefined : meta.current.rev, board: state, force }),
        });

        if (response.status === 409) {
          const remote = (await response.json()) as { rev: number; board: unknown };
          conflictRev.current = remote.rev;
          setConflict(normalise(remote.board));
          setStatus('conflict');
          return;
        }

        const failure = await failureStatus(response);
        if (failure) {
          setStatus(failure);
          return;
        }

        const { rev, updatedAt } = (await response.json()) as { rev: number; updatedAt: string };
        synced.current = state;
        writeMeta({ rev, dirty: false, lastSyncedAt: updatedAt });
        setConflict(null);
        setStatus('idle');
      } catch {
        setStatus('offline');
      } finally {
        inFlight.current = false;
      }
    },
    [enabled, failureStatus, headers, writeMeta],
  );

  const pull = useCallback(async () => {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch('/api/board', { headers: headers(), cache: 'no-store' });

      // 204: authorised, but the server has never been written to. Seed it.
      if (response.status === 204) {
        inFlight.current = false;
        await push(boardRef.current, true);
        return;
      }

      const failure = await failureStatus(response);
      if (failure) {
        setStatus(failure);
        return;
      }

      const remote = (await response.json()) as { rev: number; updatedAt: string; board: unknown };

      if (remote.rev === meta.current.rev) {
        if (meta.current.dirty) {
          inFlight.current = false;
          await push(boardRef.current);
          return;
        }
        setStatus('idle');
        return;
      }

      if (meta.current.dirty) {
        conflictRev.current = remote.rev;
        setConflict(normalise(remote.board));
        setStatus('conflict');
        return;
      }

      const next = normalise(remote.board);
      synced.current = next;
      writeMeta({ rev: remote.rev, dirty: false, lastSyncedAt: remote.updatedAt });
      adopt(next);
      setStatus('idle');
    } catch {
      setStatus('offline');
    } finally {
      inFlight.current = false;
    }
  }, [adopt, enabled, failureStatus, headers, push, writeMeta]);

  const fetchUsers = useCallback(async () => {
    try {
      const response = await fetch('/api/users', { headers: authHeaders(), cache: 'no-store' });
      if (!response.ok) return;
      const body = (await response.json()) as { users?: AppUser[] };
      if (Array.isArray(body.users)) {
        setUsers(body.users);
      }
    } catch {
      // Ignore if offline or local dev without worker.
    }
  }, []);

  const readSession = useCallback(async () => {
    try {
      const response = await fetch('/api/session', { headers: authHeaders(), cache: 'no-store' });
      if (response.redirected) {
        setSession({
          access: true,
          signedIn: false,
          email: null,
          configured: true,
        });
        return;
      }
      if (!response.ok) return;
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) return;
      const next = (await response.json()) as SessionResponse;
      setSession(next);
      if (Array.isArray(next.workspaces) && next.workspaces.length > 0) {
        setWorkspaces(next.workspaces);
      }
      if (next.signedIn) {
        void fetchUsers();
      }
    } catch {
      // Offline. Whatever we knew last still holds.
    }
  }, [fetchUsers]);

  useEffect(() => {
    void readSession();
  }, [readSession]);

  useEffect(() => {
    if (!session) return;
    setStatus((current) => {
      if (current === 'conflict') return current;
      if (signedIn) return WAITING_ON_LOGIN.includes(current) ? 'idle' : current;
      if (!token && !sessionToken) {
        if (session.setupRequired) return 'unconfigured';
        return session.access ? 'signed-out' : 'off';
      }
      return current;
    });
  }, [session, signedIn, token, sessionToken]);

  // Local edits: always mark dirty (even while signed out or offline so
  // reconnecting never silently overwrites local work), and push when enabled.
  useEffect(() => {
    if (board === synced.current) return;
    if (!meta.current.dirty) writeMeta({ dirty: true });
    if (!enabled || status === 'conflict') return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => push(board), PUSH_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [board, enabled, push, status, writeMeta]);

  // First load, then whenever this tab comes back or the network returns.
  useEffect(() => {
    if (!enabled) return;
    void pull();

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void readSession();
        void pull();
      }
    };
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') void pull();
    }, POLL_MS);

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [enabled, pull, readSession]);

  const setToken = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      try {
        localStorage.setItem(TOKEN_KEY, trimmed);
      } catch {
        // Ignore storage errors.
      }
      meta.current = { ...DEFAULT_META, dirty: !isUntouched(boardRef.current) };
      localStorage.setItem(metaKeyFor(), JSON.stringify(meta.current));
      setConflict(null);
      setTokenState(trimmed);
      setStatus(trimmed || signedIn ? 'idle' : 'off');
    },
    [signedIn],
  );

  const clearToken = useCallback(() => setToken(''), [setToken]);

  const login = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      setAuthBusy(true);
      setAuthError(null);
      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: authHeaders({ 'content-type': 'application/json' }),
          body: JSON.stringify({ email, password }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          user?: AppUser;
          workspaces?: WorkspaceInfo[];
          sessionToken?: string;
        };
        if (!response.ok || !body.user) {
          setAuthError(body.error || 'Invalid email or password.');
          return false;
        }
        if (body.sessionToken) {
          writeSessionToken(body.sessionToken);
          setSessionTokenState(body.sessionToken);
        }
        if (Array.isArray(body.workspaces) && body.workspaces.length > 0) {
          setWorkspaces(body.workspaces);
        }
        setSession({
          mode: 'in-app',
          setupRequired: false,
          access: false,
          signedIn: true,
          email: body.user.email,
          user: body.user,
          workspaces: body.workspaces ?? DEFAULT_WORKSPACES,
          configured: true,
        });
        meta.current = { ...readMeta(), dirty: !isUntouched(boardRef.current) };
        setStatus('idle');
        void fetchUsers();
        return true;
      } catch {
        setAuthError('Could not reach the server. Check your connection.');
        return false;
      } finally {
        setAuthBusy(false);
      }
    },
    [fetchUsers],
  );

  const setupAdmin = useCallback(
    async (email: string, name: string, password: string): Promise<boolean> => {
      setAuthBusy(true);
      setAuthError(null);
      try {
        const response = await fetch('/api/auth/setup', {
          method: 'POST',
          headers: authHeaders({ 'content-type': 'application/json' }),
          body: JSON.stringify({ email, name, password }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          user?: AppUser;
          workspaces?: WorkspaceInfo[];
          sessionToken?: string;
        };
        if (!response.ok || !body.user) {
          setAuthError(body.error || 'Could not create admin account.');
          return false;
        }
        if (body.sessionToken) {
          writeSessionToken(body.sessionToken);
          setSessionTokenState(body.sessionToken);
        }
        if (Array.isArray(body.workspaces) && body.workspaces.length > 0) {
          setWorkspaces(body.workspaces);
        }
        setSession({
          mode: 'in-app',
          setupRequired: false,
          access: false,
          signedIn: true,
          email: body.user.email,
          user: body.user,
          workspaces: body.workspaces ?? DEFAULT_WORKSPACES,
          configured: true,
        });
        setUsers([body.user]);
        meta.current = { ...readMeta(), dirty: !isUntouched(boardRef.current) };
        setStatus('idle');
        return true;
      } catch {
        setAuthError('Could not reach the server. Check your connection.');
        return false;
      } finally {
        setAuthBusy(false);
      }
    },
    [],
  );

  const signOut = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() });
    } catch {
      // Ignore network errors on logout.
    }
    writeSessionToken('');
    setSessionTokenState('');
    setConflict(null);
    setSession((prev) =>
      prev
        ? {
            ...prev,
            signedIn: false,
            email: null,
            user: null,
          }
        : null,
    );
    setStatus(token ? 'idle' : 'off');
  }, [token]);

  const switchWorkspace = useCallback(
    (workspaceId: string) => {
      const nextId = workspaceId.trim() || 'default';
      if (nextId === getActiveWorkspaceId()) return;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      switchWorkspaceBoard(nextId);
      const nextBoard = getBoardState();
      synced.current = nextBoard;
      const nextMeta = readMeta(nextId);
      meta.current = nextMeta;
      setLastSyncedAt(nextMeta.lastSyncedAt);
      setConflict(null);
      if (enabled) {
        setStatus('idle');
        setTimeout(() => void pull(), 20);
      }
    },
    [enabled, pull],
  );

  const createWorkspace = useCallback(
    async (name: string, kind: WorkspaceKind): Promise<WorkspaceInfo | null> => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      try {
        const response = await fetch('/api/workspaces', {
          method: 'POST',
          headers: authHeaders({ 'content-type': 'application/json' }),
          body: JSON.stringify({ name: trimmed, kind }),
        });
        if (response.ok) {
          const body = (await response.json()) as {
            workspace: WorkspaceInfo;
            workspaces: WorkspaceInfo[];
          };
          if (Array.isArray(body.workspaces)) setWorkspaces(body.workspaces);
          if (body.workspace) {
            switchWorkspace(body.workspace.id);
            return body.workspace;
          }
        }
      } catch {
        // Fallback to local-only workspace if offline or local dev.
      }
      const localWs: WorkspaceInfo = {
        id: `${kind}-${Math.random().toString(36).slice(2, 8)}`,
        name: trimmed,
        kind,
        ownerId: session?.user?.id ?? null,
        createdAt: new Date().toISOString(),
      };
      setWorkspaces((prev) => [...prev, localWs]);
      switchWorkspace(localWs.id);
      return localWs;
    },
    [session?.user?.id, switchWorkspace],
  );

  const renameWorkspace = useCallback(async (id: string, name: string): Promise<boolean> => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ name: trimmed }),
      });
      if (response.ok) {
        const body = (await response.json()) as { workspaces?: WorkspaceInfo[] };
        if (Array.isArray(body.workspaces)) {
          setWorkspaces(body.workspaces);
          return true;
        }
      }
    } catch {
      // Update locally below.
    }
    setWorkspaces((prev) => prev.map((w) => (w.id === id ? { ...w, name: trimmed } : w)));
    return true;
  }, []);

  const deleteWorkspace = useCallback(
    async (id: string): Promise<boolean> => {
      if (id === 'default') return false;
      try {
        const response = await fetch(`/api/workspaces/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: authHeaders(),
        });
        if (response.ok) {
          const body = (await response.json()) as { workspaces?: WorkspaceInfo[] };
          if (Array.isArray(body.workspaces)) setWorkspaces(body.workspaces);
        }
      } catch {
        setWorkspaces((prev) => prev.filter((w) => w.id !== id));
      }
      if (getActiveWorkspaceId() === id) {
        switchWorkspace('default');
      }
      return true;
    },
    [switchWorkspace],
  );

  const createUser = useCallback(
    async (input: {
      email: string;
      name: string;
      password: string;
      role: UserRole;
    }): Promise<{ ok: boolean; error?: string }> => {
      try {
        const response = await fetch('/api/users', {
          method: 'POST',
          headers: authHeaders({ 'content-type': 'application/json' }),
          body: JSON.stringify(input),
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          users?: AppUser[];
        };
        if (!response.ok) return { ok: false, error: body.error || 'Could not create user.' };
        if (Array.isArray(body.users)) setUsers(body.users);
        return { ok: true };
      } catch {
        return { ok: false, error: 'Could not reach the server.' };
      }
    },
    [],
  );

  const updateUser = useCallback(
    async (
      id: string,
      patch: { name?: string; email?: string; role?: UserRole; password?: string },
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        const response = await fetch(`/api/users/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: authHeaders({ 'content-type': 'application/json' }),
          body: JSON.stringify(patch),
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          user?: AppUser;
          users?: AppUser[];
        };
        if (!response.ok) return { ok: false, error: body.error || 'Could not update user.' };
        if (Array.isArray(body.users)) setUsers(body.users);
        if (body.user && session?.user?.id === body.user.id) {
          setSession((prev) => (prev ? { ...prev, user: body.user!, email: body.user!.email } : prev));
        }
        return { ok: true };
      } catch {
        return { ok: false, error: 'Could not reach the server.' };
      }
    },
    [session?.user?.id],
  );

  const deleteUser = useCallback(
    async (id: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const response = await fetch(`/api/users/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: authHeaders(),
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          users?: AppUser[];
        };
        if (!response.ok) return { ok: false, error: body.error || 'Could not remove user.' };
        if (Array.isArray(body.users)) setUsers(body.users);
        return { ok: true };
      } catch {
        return { ok: false, error: 'Could not reach the server.' };
      }
    },
    [],
  );

  const updateProfile = useCallback(
    async (patch: {
      name?: string;
      currentPassword?: string;
      newPassword?: string;
    }): Promise<{ ok: boolean; error?: string }> => {
      try {
        const response = await fetch('/api/auth/profile', {
          method: 'PATCH',
          headers: authHeaders({ 'content-type': 'application/json' }),
          body: JSON.stringify(patch),
        });
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          user?: AppUser;
        };
        if (!response.ok) return { ok: false, error: body.error || 'Could not update profile.' };
        if (body.user) {
          setSession((prev) => (prev ? { ...prev, user: body.user!, email: body.user!.email } : prev));
          setUsers((prev) => prev.map((u) => (u.id === body.user!.id ? body.user! : u)));
        }
        return { ok: true };
      } catch {
        return { ok: false, error: 'Could not reach the server.' };
      }
    },
    [],
  );

  const resolve = useCallback(
    (choice: 'mine' | 'theirs') => {
      const remote = conflict;
      setConflict(null);
      if (choice === 'theirs' && remote) {
        synced.current = remote;
        writeMeta({ rev: conflictRev.current, dirty: false, lastSyncedAt: new Date().toISOString() });
        adopt(remote);
        setStatus('idle');
        return;
      }
      writeMeta({ rev: conflictRev.current });
      void push(boardRef.current, true);
    },
    [adopt, conflict, push, writeMeta],
  );

  return {
    status,
    hasToken: Boolean(token),
    signedIn,
    setupRequired,
    user: session?.user ?? null,
    users,
    workspaces,
    activeWorkspaceId,
    email: session?.user?.email ?? session?.email ?? null,
    needsToken: !signedIn && !session?.access,
    authError,
    authBusy,
    lastSyncedAt,
    conflict,
    setToken,
    clearToken,
    resolve,
    login,
    setupAdmin,
    signIn: () => void readSession(),
    signOut,
    switchWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    createUser,
    updateUser,
    deleteUser,
    updateProfile,
    syncNow: () => void pull(),
  };
}
