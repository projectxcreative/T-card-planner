import { useEffect, useRef, useState } from 'react';
import type { Sync, SyncStatus } from '../sync';

const LABELS: Record<SyncStatus, string> = {
  off: 'Sign in',
  unconfigured: 'Set up admin',
  unauthorised: 'Sign in',
  'signed-out': 'Signed out',
  idle: 'Synced',
  saving: 'Saving…',
  offline: 'Offline',
  conflict: 'Conflict',
};

const DETAIL: Record<SyncStatus, string> = {
  off: 'Sign in to sync your board across devices and collaborate with your team. Local changes are always saved on this device.',
  unconfigured: 'Create your administrator account to enable in-app login, user management, and cloud sync.',
  unauthorised: 'Your session or token was not accepted. Sign in below to reconnect.',
  'signed-out': 'Your session has ended. Sign in again to pick up where you left off — local edits are safe.',
  idle: 'Up to date with the server.',
  saving: 'Sending your latest changes…',
  offline: "Can't reach the server. Your changes are saved on this device and will sync when connection returns.",
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

export default function SyncBadge({
  sync,
  onOpenSettings,
}: {
  sync: Sync;
  onOpenSettings?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showTokenMode, setShowTokenMode] = useState(false);
  const [tokenDraft, setTokenDraft] = useState('');
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardKind, setNewBoardKind] = useState<'team' | 'personal'>('personal');
  const [addingBoard, setAddingBoard] = useState(false);
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

  const activeWorkspace =
    sync.workspaces.find((w) => w.id === sync.activeWorkspaceId) ?? sync.workspaces[0];

  const badgeLabel =
    sync.signedIn && sync.user
      ? sync.status === 'saving'
        ? 'Saving…'
        : `${activeWorkspace?.name ?? 'Board'} · ${sync.user.name.split(' ')[0]}`
      : LABELS[sync.status];

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
        <span className="sync-label">{badgeLabel}</span>
      </button>

      {open && (
        <div className="sync-pop" role="dialog" aria-label="Account & workspace settings">
          {/* Workspace Switcher */}
          <div className="sync-section">
            <div className="sync-section-head">
              <span className="sync-section-title">Workspace board</span>
              <button
                type="button"
                className="ghost sync-mini-btn"
                onClick={() => setAddingBoard((v) => !v)}
              >
                {addingBoard ? 'Cancel' : '+ New board'}
              </button>
            </div>
            <div className="sync-workspaces">
              {sync.workspaces.map((ws) => (
                <button
                  key={ws.id}
                  type="button"
                  className={`sync-ws-item ${ws.id === sync.activeWorkspaceId ? 'is-active' : ''}`}
                  onClick={() => {
                    sync.switchWorkspace(ws.id);
                  }}
                >
                  <span className="sync-ws-name">{ws.name}</span>
                  <span className="sync-ws-kind">{ws.kind === 'personal' ? 'Personal' : 'Team'}</span>
                </button>
              ))}
            </div>
            {addingBoard && (
              <form
                className="sync-new-board"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!newBoardName.trim()) return;
                  await sync.createWorkspace(newBoardName.trim(), newBoardKind);
                  setNewBoardName('');
                  setAddingBoard(false);
                }}
              >
                <input
                  type="text"
                  className="sync-input"
                  placeholder="Board name (e.g. Personal, Studio)"
                  value={newBoardName}
                  onChange={(e) => setNewBoardName(e.target.value)}
                />
                <div className="sync-actions">
                  <select
                    className="sync-select"
                    value={newBoardKind}
                    onChange={(e) => setNewBoardKind(e.target.value as 'team' | 'personal')}
                  >
                    <option value="personal">Personal board</option>
                    <option value="team">Team board</option>
                  </select>
                  <button type="submit" className="ghost accent">
                    Create
                  </button>
                </div>
              </form>
            )}
          </div>

          <hr className="sync-divider" />

          <p className="sync-detail">{DETAIL[sync.status]}</p>

          {sync.status === 'idle' && sync.lastSyncedAt && (
            <p className="sync-detail dim">Last saved to the server {agoLabel(sync.lastSyncedAt)}.</p>
          )}

          {sync.signedIn && sync.user ? (
            <div className="sync-user-box">
              <div className="sync-user-info">
                <span className="sync-user-avatar">
                  {sync.user.name.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <div className="sync-who">
                    {sync.user.name}{' '}
                    <span className="sync-role-pill">{sync.user.role}</span>
                  </div>
                  <div className="sync-detail dim">{sync.user.email}</div>
                </div>
              </div>
              <div className="sync-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    sync.syncNow();
                    setOpen(false);
                  }}
                >
                  Sync now
                </button>
                {onOpenSettings && (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setOpen(false);
                      onOpenSettings();
                    }}
                  >
                    Team & users
                  </button>
                )}
                <button
                  type="button"
                  className="ghost danger"
                  onClick={() => {
                    void sync.signOut();
                  }}
                >
                  Sign out
                </button>
              </div>
            </div>
          ) : sync.hasToken ? (
            <div className="sync-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  sync.syncNow();
                  setOpen(false);
                }}
              >
                Sync now
              </button>
              <button type="button" className="ghost danger" onClick={sync.clearToken}>
                Forget token
              </button>
            </div>
          ) : !showTokenMode ? (
            <form
              className="sync-auth-form"
              onSubmit={async (event) => {
                event.preventDefault();
                if (sync.setupRequired) {
                  const ok = await sync.setupAdmin(email, name, password);
                  if (ok) {
                    setPassword('');
                    setOpen(false);
                  }
                } else {
                  const ok = await sync.login(email, password);
                  if (ok) {
                    setPassword('');
                    setOpen(false);
                  }
                }
              }}
            >
              {sync.setupRequired && (
                <input
                  type="text"
                  className="sync-input"
                  value={name}
                  placeholder="Your name"
                  required
                  autoComplete="name"
                  onChange={(e) => setName(e.target.value)}
                />
              )}
              <input
                type="email"
                className="sync-input"
                value={email}
                placeholder="Email address"
                required
                autoComplete="email"
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                type="password"
                className="sync-input"
                value={password}
                placeholder={sync.setupRequired ? 'Choose a password (8+ chars)' : 'Password'}
                required
                minLength={sync.setupRequired ? 8 : 1}
                autoComplete={sync.setupRequired ? 'new-password' : 'current-password'}
                onChange={(e) => setPassword(e.target.value)}
              />
              {sync.authError && <p className="sync-error">{sync.authError}</p>}
              <div className="sync-actions">
                <button type="submit" className="ghost accent" disabled={sync.authBusy}>
                  {sync.authBusy
                    ? 'Signing in…'
                    : sync.setupRequired
                      ? 'Create admin account'
                      : 'Sign in'}
                </button>
                <button
                  type="button"
                  className="ghost sync-mini-btn"
                  onClick={() => setShowTokenMode(true)}
                >
                  Use token
                </button>
              </div>
            </form>
          ) : (
            <form
              className="sync-auth-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!tokenDraft.trim()) return;
                sync.setToken(tokenDraft);
                setTokenDraft('');
                setOpen(false);
              }}
            >
              <input
                type="password"
                className="sync-input"
                value={tokenDraft}
                placeholder="Shared sync token (BOARD_TOKEN)"
                autoComplete="off"
                aria-label="Sync token"
                onChange={(event) => setTokenDraft(event.target.value)}
              />
              <div className="sync-actions">
                <button type="submit" className="ghost accent">
                  Connect
                </button>
                <button
                  type="button"
                  className="ghost sync-mini-btn"
                  onClick={() => setShowTokenMode(false)}
                >
                  Email sign-in
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

/** Shown across the top of the board while the server can't be reached.
 *  Edits continue locally and will sync automatically when reconnected. */
export function OfflineBar({ sync }: { sync: Sync }) {
  if (sync.status !== 'offline') return null;

  return (
    <div className="conflict is-offline" role="status">
      <span>
        You're working offline — edits are saved locally on this device and will sync automatically when connection is restored.
      </span>
      <div className="conflict-actions">
        <button type="button" className="ghost accent" onClick={sync.syncNow}>
          Retry sync
        </button>
      </div>
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
