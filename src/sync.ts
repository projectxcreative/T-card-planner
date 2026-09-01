import { useCallback, useEffect, useRef, useState } from 'react';
import { isUntouched, normalise } from './store';
import type { BoardState } from './types';

const TOKEN_KEY = 'tcard-planner.token';
const META_KEY = 'tcard-planner.sync.v1';
const PUSH_DEBOUNCE_MS = 1200;
const POLL_MS = 45_000;
/** Cloudflare handles this itself, at the edge, before the Worker sees it. */
const LOGOUT_URL = '/cdn-cgi/access/logout';

export type SyncStatus =
  /** No login on this device — the board is local only, which is a fine way to run. */
  | 'off'
  /** The Worker has neither Access nor a BOARD_TOKEN set up yet. */
  | 'unconfigured'
  | 'unauthorised'
  /** Signed in through Cloudflare Access once, but that session has run out. */
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
interface Session {
  /** The Worker is behind Cloudflare Access. */
  access: boolean;
  /** This browser carries a login Access signed, so no token is needed. */
  signedIn: boolean;
  email: string | null;
  /** The Worker has some way of letting you in at all. */
  configured: boolean;
}

/** What being redirected to the Access login tells us, on its own. */
const SIGNED_OUT: Session = { access: true, signedIn: false, email: null, configured: true };

/** The statuses a fresh login fixes. The rest are about syncing, not getting in. */
const WAITING_ON_LOGIN: SyncStatus[] = ['off', 'signed-out', 'unauthorised', 'unconfigured'];

/** The answer usually repeats; keeping the old object saves a render each poll. */
function sameSession(previous: Session | null, next: Session): Session {
  return previous &&
    previous.access === next.access &&
    previous.signedIn === next.signedIn &&
    previous.email === next.email &&
    previous.configured === next.configured
    ? previous
    : next;
}

const DEFAULT_META: Meta = { rev: 0, dirty: false, lastSyncedAt: null };

function readMeta(): Meta {
  try {
    const raw = localStorage.getItem(META_KEY);
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

export interface Sync {
  status: SyncStatus;
  hasToken: boolean;
  /** True once the Worker has confirmed a Cloudflare Access login. */
  signedIn: boolean;
  /** Who Access says you are, for the badge to show. */
  email: string | null;
  /** False when Access is doing the login, so the token box is just noise. */
  needsToken: boolean;
  lastSyncedAt: string | null;
  /** The server's board, held back for you to choose while a conflict stands. */
  conflict: BoardState | null;
  setToken: (token: string) => void;
  clearToken: () => void;
  resolve: (choice: 'mine' | 'theirs') => void;
  syncNow: () => void;
  /** Go back through Access for a fresh session. */
  signIn: () => void;
  signOut: () => void;
}

/**
 * Keeps one board in step with the Worker.
 *
 * The board itself is never merged: a device either agrees with the server's
 * revision or it doesn't, and if it doesn't you're asked which side wins. For
 * one person on two devices that is almost always "nothing happened", and when
 * it isn't, losing an afternoon's planning silently would be much worse than a
 * question.
 *
 * Getting in is the Worker's business, not this file's. Ask it once who you
 * are: behind Cloudflare Access the browser is already logged in and syncing
 * just starts, and only a Worker without Access falls back to asking for a
 * shared token per device.
 */
export function useSync(board: BoardState, adopt: (state: BoardState) => void): Sync {
  const [token, setTokenState] = useState(readToken);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SyncStatus>(() => (readToken() ? 'idle' : 'off'));
  const [conflict, setConflict] = useState<BoardState | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(() => readMeta().lastSyncedAt);

  const meta = useRef<Meta>(readMeta());
  /** The exact board object the server has, so a pulled board isn't pushed back. */
  const synced = useRef<BoardState>(board);
  const conflictRev = useRef(0);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boardRef = useRef(board);
  boardRef.current = board;

  const signedIn = Boolean(session?.signedIn);
  /** Either credential is enough to talk to the server. */
  const enabled = signedIn || Boolean(token);

  const writeMeta = useCallback((patch: Partial<Meta>) => {
    meta.current = { ...meta.current, ...patch };
    try {
      localStorage.setItem(META_KEY, JSON.stringify(meta.current));
    } catch {
      // A full quota shouldn't stop syncing.
    }
    if (patch.lastSyncedAt !== undefined) setLastSyncedAt(patch.lastSyncedAt);
  }, []);

  const headers = useCallback(
    (extra: Record<string, string> = {}) =>
      // The Access login rides along as a cookie; the token is only sent when
      // there is one, so a signed-in browser needn't hold a secret at all.
      (token ? { authorization: `Bearer ${token}`, ...extra } : { ...extra }),
    [token],
  );

  /** Maps the Worker's refusals onto a status, or null if the call was fine. */
  const failureStatus = useCallback(async (response: Response): Promise<SyncStatus | null> => {
    // An expired Access session is bounced to the login page, and a same-origin
    // fetch follows that redirect happily — so a "successful" reply from
    // somewhere other than where we asked means the session is gone.
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
        if (!meta.current.dirty) setStatus('idle');
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

  /**
   * Ask the Worker who we are, before anything else.
   *
   * A board opened from the service worker's cache with no signal gets no
   * answer at all, and that is not a reason to declare anyone signed out: the
   * session is simply unknown, and the first real sync will say. Being bounced
   * to the login page is different — that is an answer, and it means the
   * Access session has ended.
   */
  const readSession = useCallback(async () => {
    try {
      const response = await fetch('/api/session', { cache: 'no-store' });
      if (response.redirected) {
        setSession((prev) => sameSession(prev, SIGNED_OUT));
        return;
      }
      if (!response.ok) return;
      const next = (await response.json()) as Session;
      setSession((prev) => sameSession(prev, next));
    } catch {
      // Offline. Whatever we knew last still holds.
    }
  }, []);

  useEffect(() => {
    void readSession();
  }, [readSession]);

  // Signing in or out through Access changes what this device can do without
  // the token ever changing, so settle the status once the answer lands —
  // without treading on a sync that is mid-flight.
  useEffect(() => {
    if (!session) return;
    setStatus((current) => {
      if (current === 'conflict') return current;
      if (signedIn) return WAITING_ON_LOGIN.includes(current) ? 'idle' : current;
      if (!token) return session.access ? 'signed-out' : 'off';
      return current;
    });
  }, [session, signedIn, token]);

  // Local edits: mark dirty and push, once the dust settles.
  useEffect(() => {
    if (!enabled || board === synced.current) return;
    if (!meta.current.dirty) writeMeta({ dirty: true });
    if (status === 'conflict') return; // Wait for the choice rather than fighting it.
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
        // A tab left open past the session's end needs to notice it was signed
        // out, so re-ask before syncing rather than after it fails.
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
        // Nothing to do; the token just won't survive a reload.
      }
      // A new token means a new conversation with the server, starting at rev 0.
      // Real local work counts as an unsent change, so if the server already has
      // a board you get asked which one wins instead of quietly losing yours.
      meta.current = { ...DEFAULT_META, dirty: !isUntouched(boardRef.current) };
      localStorage.setItem(META_KEY, JSON.stringify(meta.current));
      setConflict(null);
      setTokenState(trimmed);
      setStatus(trimmed || signedIn ? 'idle' : 'off');
    },
    [signedIn],
  );

  const clearToken = useCallback(() => setToken(''), [setToken]);

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
    email: session?.email ?? null,
    // Behind Access the login is the login; a token as well would be one more
    // secret to keep, guarding a door that is already shut.
    needsToken: !signedIn && !session?.access,
    lastSyncedAt,
    conflict,
    setToken,
    clearToken,
    resolve,
    // Reloading is what re-runs the login: Access challenges the navigation and
    // hands the browser a fresh session before the app comes back.
    signIn: () => window.location.reload(),
    signOut: () => {
      window.location.href = LOGOUT_URL;
    },
    syncNow: () => void pull(),
  };
}
