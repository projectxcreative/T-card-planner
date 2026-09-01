import { useEffect, useRef, useState } from 'react';
import type { Sync, SyncStatus } from '../sync';

const LABELS: Record<SyncStatus, string> = {
  off: 'Sync off',
  unconfigured: 'Set up',
  unauthorised: 'Bad token',
  'signed-out': 'Signed out',
  idle: 'Synced',
  saving: 'Saving…',
  offline: 'Offline',
  conflict: 'Conflict',
};

const DETAIL: Record<SyncStatus, string> = {
  off: 'This device keeps the board in its own browser storage. Add your sync token to share it with your other devices.',
  unconfigured: 'The Worker is running but has no login set up yet — neither Cloudflare Access nor a BOARD_TOKEN secret.',
  unauthorised: "The server didn't accept this token. Check it against the BOARD_TOKEN secret on the Worker.",
  'signed-out': 'Your Cloudflare Access session has ended. Sign in again and the board picks up where it left off — nothing on this device is lost meanwhile.',
  idle: 'Up to date with the server.',
  saving: 'Sending your latest changes.',
  offline: "Can't reach the server. Your changes are saved on this device and will go up when it's back.",
  conflict: 'This board also changed somewhere else.',
};

function agoLabel(iso: string | null): string {
  if (!iso) return '';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function SyncBadge({ sync }: { sync: Sync }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="sync" ref={wrapRef}>
      <button
        type="button"
        className={`sync-badge is-${sync.status}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={DETAIL[sync.status]}
      >
        <span className="sync-dot" aria-hidden="true" />
        <span className="sync-label">{LABELS[sync.status]}</span>
      </button>

      {open && (
        <div className="sync-pop" role="dialog" aria-label="Sync settings">
          <p className="sync-detail">{DETAIL[sync.status]}</p>

          {sync.status === 'idle' && sync.lastSyncedAt && (
            <p className="sync-detail dim">Last saved to the server {agoLabel(sync.lastSyncedAt)}.</p>
          )}

          {sync.email && (
            <p className="sync-detail dim">
              Signed in as <strong className="sync-who">{sync.email}</strong>.
            </p>
          )}

          {sync.status === 'signed-out' ? (
            <div className="sync-actions">
              <button type="button" className="ghost accent" onClick={sync.signIn}>
                Sign in again
              </button>
            </div>
          ) : sync.signedIn ? (
            <div className="sync-actions">
              <button type="button" className="ghost" onClick={() => { sync.syncNow(); setOpen(false); }}>
                Sync now
              </button>
              <button type="button" className="ghost danger" onClick={sync.signOut}>
                Sign out
              </button>
            </div>
          ) : sync.hasToken ? (
            <div className="sync-actions">
              <button type="button" className="ghost" onClick={() => { sync.syncNow(); setOpen(false); }}>
                Sync now
              </button>
              <button type="button" className="ghost danger" onClick={sync.clearToken}>
                Forget token
              </button>
            </div>
          ) : sync.needsToken ? (
            <form
              className="sync-actions"
              onSubmit={(event) => {
                event.preventDefault();
                if (!draft.trim()) return;
                sync.setToken(draft);
                setDraft('');
                setOpen(false);
              }}
            >
              <input
                type="password"
                className="sync-input"
                value={draft}
                placeholder="Sync token"
                autoComplete="off"
                aria-label="Sync token"
                onChange={(event) => setDraft(event.target.value)}
              />
              <button type="submit" className="ghost accent">
                Connect
              </button>
            </form>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** Shown across the top of the board while a conflict is unresolved. */
export function ConflictBar({ sync }: { sync: Sync }) {
  if (sync.status !== 'conflict' || !sync.conflict) return null;
  const theirs = Object.keys(sync.conflict.cards).length;

  return (
    <div className="conflict" role="alert">
      <span>
        This board changed on another device. The server's copy has <strong>{theirs}</strong> card
        {theirs === 1 ? '' : 's'}.
      </span>
      <div className="conflict-actions">
        <button type="button" className="ghost" onClick={() => sync.resolve('theirs')}>
          Use the server's
        </button>
        <button type="button" className="ghost accent" onClick={() => sync.resolve('mine')}>
          Keep this device's
        </button>
      </div>
    </div>
  );
}
