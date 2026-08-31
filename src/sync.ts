import { useCallback, useEffect, useRef, useState } from 'react';
import { isUntouched, normalise } from './store';
import type { BoardState } from './types';

const TOKEN_KEY = 'tcard-planner.token';
const META_KEY = 'tcard-planner.sync.v1';
const PUSH_DEBOUNCE_MS = 1200;
const POLL_MS = 45_000;

export type SyncStatus =
  /** No token on this device — the board is local only, which is a fine way to run. */
  | 'off'
  /** The Worker is up but has no BOARD_TOKEN secret set. */
  | 'unconfigured'
  | 'unauthorised'
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
  lastSyncedAt: string | null;
  /** The server's board, held back for you to choose while a conflict stands. */
  conflict: BoardState | null;
  setToken: (token: string) => void;
  clearToken: () => void;
  resolve: (choice: 'mine' | 'theirs') => void;
  syncNow: () => void;
}

/**
 * Keeps one board in step with the Worker.
 *
 * The board itself is never merged: a device either agrees with the server's
 * revision or it doesn't, and if it doesn't you're asked which side wins. For
 * one person on two devices that is almost always "nothing happened", and when
 * it isn't, losing an afternoon's planning silently would be much worse than a
 * question.
 */
export function useSync(board: BoardState, adopt: (state: BoardState) => void): Sync {
  const [token, setTokenState] = useState(readToken);
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
    (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra }),
    [token],
  );

  /** Maps the Worker's setup failures onto a status, or null if the call was fine. */
  const failureStatus = (response: Response): SyncStatus | null => {
    if (response.status === 401) return 'unauthorised';
    if (response.status === 503) return 'unconfigured';
    if (!response.ok && response.status !== 409) return 'offline';
    return null;
  };

  const push = useCallback(
    async (state: BoardState, force = false) => {
      if (!token || inFlight.current) return;
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

        const failure = failureStatus(response);
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
    [headers, token, writeMeta],
  );

  const pull = useCallback(async () => {
    if (!token || inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch('/api/board', { headers: headers(), cache: 'no-store' });

      // 204: authorised, but the server has never been written to. Seed it.
      if (response.status === 204) {
        inFlight.current = false;
        await push(boardRef.current, true);
        return;
      }

      const failure = failureStatus(response);
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
  }, [adopt, headers, push, token, writeMeta]);

  // Local edits: mark dirty and push, once the dust settles.
  useEffect(() => {
    if (!token || board === synced.current) return;
    if (!meta.current.dirty) writeMeta({ dirty: true });
    if (status === 'conflict') return; // Wait for the choice rather than fighting it.
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => push(board), PUSH_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [board, push, status, token, writeMeta]);

  // First load, then whenever this tab comes back or the network returns.
  useEffect(() => {
    if (!token) {
      setStatus('off');
      return;
    }
    void pull();

    const onVisible = () => {
      if (document.visibilityState === 'visible') void pull();
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
  }, [pull, token]);

  const setToken = useCallback((value: string) => {
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
    setStatus(trimmed ? 'idle' : 'off');
  }, []);

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
    lastSyncedAt,
    conflict,
    setToken,
    clearToken,
    resolve,
    syncNow: () => void pull(),
  };
}
