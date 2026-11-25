import { useCallback, useEffect, useRef, useState } from 'react';
import { isUntouched, normalise } from '../store';
import type { AppUser, BoardState, WorkspaceInfo } from '../types';
import type { Sync, SyncStatus } from '../sync';
import {
  TABLES,
  boardToRows,
  diffRows,
  emptyRows,
  indexRows,
  isEmptyChange,
  rowsToBoard,
  type Row,
  type Rows,
  type Table,
} from './boardRows';
import { signOut, supabase } from './supabase';
import { useSupabaseAuth } from './useSupabaseAuth';

const SAVE_DEBOUNCE_MS = 800;
const POLL_MS = 60_000;
const PAGE = 1000;

const TEAM_BOARD: WorkspaceInfo[] = [
  { id: 'default', name: 'Team Board', kind: 'team', ownerId: null, createdAt: new Date(0).toISOString() },
];

/** Primary key columns, for deletes. */
const KEY_COLUMNS: Record<Table, string[]> = {
  clients: ['id'],
  categories: ['id'],
  update_categories: ['id'],
  projects: ['id'],
  project_milestones: ['id'],
  expenses: ['id'],
  cards: ['id'],
  card_tags: ['card_id', 'client_id'],
  card_updates: ['id'],
  attachments: ['id'],
  orphaned_events: ['event_id'],
};

async function fetchAll(): Promise<Rows> {
  if (!supabase) return emptyRows();
  const fetched: Partial<Record<Table, Row[]>> = {};
  await Promise.all(
    TABLES.map(async (table) => {
      const out: Row[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase!.from(table).select('*').range(from, from + PAGE - 1);
        if (error) throw error;
        out.push(...(data as Row[]));
        if (!data || data.length < PAGE) break;
      }
      fetched[table] = out;
    }),
  );
  return indexRows(fetched);
}

async function write(before: Rows, after: Rows): Promise<void> {
  if (!supabase) return;
  const changes = diffRows(before, after);
  for (const { table, rows } of changes.upserts) {
    const { error } = await supabase.from(table).upsert(rows, { defaultToNull: false });
    if (error) throw error;
  }
  for (const { table, keys } of changes.deletes) {
    const columns = KEY_COLUMNS[table];
    if (columns.length === 1) {
      const { error } = await supabase.from(table).delete().in(columns[0], keys);
      if (error) throw error;
    } else {
      for (const key of keys) {
        const parts = key.split(':');
        let query = supabase.from(table).delete();
        columns.forEach((col, i) => (query = query.eq(col, parts[i])));
        const { error } = await query;
        if (error) throw error;
      }
    }
  }
}

/**
 * The Supabase stand-in for useSync: loads the team board from the tables
 * once signed in, saves each change as the rows it touched, and picks up
 * other people's changes as they happen. Returns the same Sync shape so the
 * rest of the app doesn't need to know which backend it is on.
 */
export function useSupabaseSync(board: BoardState, adopt: (state: BoardState) => void): Sync {
  const auth = useSupabaseAuth();
  const signedIn = auth.status === 'signed-in';
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);

  /** What the database held at the last load or save, in row form. */
  const saved = useRef<Rows | null>(null);
  const boardRef = useRef(board);
  boardRef.current = board;
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef<() => Promise<void>>(async () => {});

  const pending = useCallback(
    () => saved.current !== null && !isEmptyChange(diffRows(saved.current, boardToRows(boardRef.current, saved.current))),
    [],
  );

  const load = useCallback(async () => {
    if (!signedIn || busy.current) return;
    if (pending()) return; // never drop edits that haven't been saved yet
    busy.current = true;
    try {
      const rows = await fetchAll();
      if (saved.current === null && rows.cards.size === 0 && !isUntouched(boardRef.current)) {
        // First sign-in against an empty database, on a device that already
        // has the board: keep it, and let the first save upload it.
        saved.current = rows;
        setStatus('idle');
        timer.current = setTimeout(() => void saveRef.current(), SAVE_DEBOUNCE_MS);
        return;
      }
      const next = normalise(rowsToBoard(rows));
      if (!saved.current || pending() === false) {
        saved.current = boardToRows(next, rows);
        adopt(next);
      }
      setStatus('idle');
      setLastSyncedAt(new Date().toISOString());
    } catch {
      setStatus('offline');
    } finally {
      busy.current = false;
    }
  }, [signedIn, adopt, pending]);

  const save = useCallback(async () => {
    if (!signedIn || busy.current || !saved.current) return;
    const before = saved.current;
    const after = boardToRows(boardRef.current, before);
    if (isEmptyChange(diffRows(before, after))) return;
    busy.current = true;
    setStatus('saving');
    try {
      await write(before, after);
      saved.current = after;
      setStatus('idle');
      setLastSyncedAt(new Date().toISOString());
    } catch {
      setStatus('offline');
    } finally {
      busy.current = false;
    }
    // Anything edited while that save was in flight goes in the next one.
    if (pending()) timer.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
  }, [signedIn, pending]);

  saveRef.current = save;

  // First load after signing in.
  useEffect(() => {
    if (signedIn && saved.current === null) void load();
  }, [signedIn, load]);

  // Save shortly after the board stops changing.
  useEffect(() => {
    if (!signedIn || saved.current === null) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [board, signedIn, save]);

  // Other people's changes: live where Realtime is on, and a slow poll as a net.
  useEffect(() => {
    if (!signedIn || !supabase) return;
    let reload: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (reload) clearTimeout(reload);
      reload = setTimeout(() => void load(), 500);
    };
    const channel = supabase
      .channel('board')
      .on('postgres_changes', { event: '*', schema: 'public' }, soon)
      .subscribe();
    const poll = setInterval(() => void load(), POLL_MS);
    const onFocus = () => document.visibilityState === 'visible' && soon();
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('online', soon);
    return () => {
      if (reload) clearTimeout(reload);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('online', soon);
      void supabase!.removeChannel(channel);
    };
  }, [signedIn, load]);

  // The team, for assigning cards.
  useEffect(() => {
    if (!signedIn || !supabase) return;
    void supabase
      .from('profiles')
      .select('id, display_name, role, created_at')
      .eq('role', 'staff')
      .then(({ data }) => {
        setUsers(
          (data ?? []).map((p, i) => ({
            id: String(p.id),
            email: '',
            name: String(p.display_name || 'Team member'),
            role: 'admin',
            colour: ['#2179c8', '#0f8f8a', '#6f9c22', '#c68512', '#d84630', '#7b4a9e'][i % 6],
            createdAt: String(p.created_at ?? ''),
          })),
        );
      });
  }, [signedIn]);

  const session = auth.status === 'signed-in' ? auth.session : null;
  const user: AppUser | null = session
    ? users.find((u) => u.id === session.user.id) ?? {
        id: session.user.id,
        email: session.user.email ?? '',
        name: auth.status === 'signed-in' ? auth.profile?.display_name ?? '' : '',
        role: 'admin',
        colour: '#2179c8',
        createdAt: session.user.created_at,
      }
    : null;

  const notHere = async () => ({ ok: false, error: 'Manage the team in Supabase for now.' });

  return {
    status: signedIn ? status : 'signed-out',
    hasToken: false,
    signedIn,
    setupRequired: false,
    user,
    users,
    workspaces: TEAM_BOARD,
    activeWorkspaceId: 'default',
    email: session?.user.email ?? null,
    needsToken: false,
    authError: null,
    authBusy: false,
    lastSyncedAt,
    conflict: null,
    setToken: () => {},
    clearToken: () => {},
    resolve: () => {},
    syncNow: () => {
      void save().then(() => load());
    },
    login: async () => false,
    setupAdmin: async () => false,
    signIn: () => {},
    signOut,
    switchWorkspace: () => {},
    createWorkspace: async () => null,
    renameWorkspace: async () => false,
    deleteWorkspace: async () => false,
    createUser: notHere,
    updateUser: notHere,
    deleteUser: notHere,
    updateProfile: notHere,
  };
}
