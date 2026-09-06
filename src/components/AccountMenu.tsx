import { useEffect, useRef, useState } from 'react';
import { useAccount } from '../accountContext';
import { logout } from '../authClient';

/** Only shown for a native account — Access and BOARD_TOKEN callers keep
 *  using the sync badge's own sign-in/out, exactly as before accounts existed. */
export default function AccountMenu({ onManageUsers }: { onManageUsers?: () => void }) {
  const { user, refresh } = useAccount();
  const [open, setOpen] = useState(false);
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

  if (!user) return null;

  const initial = (user.name || user.email).trim().charAt(0).toUpperCase() || '?';

  const signOut = async () => {
    try {
      await logout();
    } catch {
      // Whatever the server actually did, asking it who we are next settles it.
    }
    setOpen(false);
    refresh();
  };

  return (
    <div className="account" ref={wrapRef}>
      <button type="button" className="account-badge" onClick={() => setOpen((value) => !value)} aria-expanded={open} title={user.email}>
        <span className="account-avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="account-label">{user.name || user.email}</span>
      </button>

      {open && (
        <div className="account-pop sync-pop" role="dialog" aria-label="Account">
          <p className="sync-detail account-who">
            Signed in as <strong className="sync-who">{user.email}</strong>
            {user.role === 'admin' && <span className="users-badge is-admin account-role">admin</span>}
          </p>
          <div className="sync-actions">
            {user.role === 'admin' && onManageUsers && (
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setOpen(false);
                  onManageUsers();
                }}
              >
                Manage users
              </button>
            )}
            <button type="button" className="ghost danger" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
