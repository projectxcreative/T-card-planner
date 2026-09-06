import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  AuthError,
  adminResetPassword,
  fetchUsers,
  inviteUser,
  revokeInvite,
  setUserRole,
  setUserStatus,
  tokenFromLink,
  type AccountUser,
  type Invite,
  type Role,
  type UsersResponse,
} from '../../authClient';

interface Props {
  currentUserId: string;
  onClose: () => void;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Not fatal — the link is printed on screen too, for a manual select-copy.
  }
}

export default function UsersAdminDialog({ currentUserId, onClose }: Props) {
  const [data, setData] = useState<UsersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('member');
  const [inviteResult, setInviteResult] = useState<{ link: string; emailed: boolean } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resetLinks, setResetLinks] = useState<Record<string, { link: string; emailed: boolean }>>({});

  const load = useCallback(async () => {
    try {
      setData(await fetchUsers());
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Could not load the user list.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const seatsUsed = data ? data.users.length + data.invites.length : 0;

  const submitInvite = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setInviteResult(null);
    try {
      const result = await inviteUser({ email: inviteEmail.trim(), role: inviteRole });
      setInviteResult({ link: result.invite.link, emailed: result.emailed });
      setInviteEmail('');
      setInviteRole('member');
      await load();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Could not send the invite.');
    }
  };

  const toggleRole = async (user: AccountUser) => {
    const next: Role = user.role === 'admin' ? 'member' : 'admin';
    if (next === 'member' && user.id === currentUserId && !window.confirm('Remove your own admin access?')) return;
    setError(null);
    setBusyId(user.id);
    try {
      await setUserRole(user.id, next);
      await load();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Could not change that role.');
    } finally {
      setBusyId(null);
    }
  };

  const toggleStatus = async (user: AccountUser) => {
    const next = user.status === 'disabled' ? 'active' : 'disabled';
    if (
      next === 'disabled' &&
      !window.confirm(
        user.id === currentUserId ? 'Disable your own account? You will be signed out immediately.' : `Disable ${user.email}?`,
      )
    ) {
      return;
    }
    setError(null);
    setBusyId(user.id);
    try {
      await setUserStatus(user.id, next);
      await load();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Could not change that account.');
    } finally {
      setBusyId(null);
    }
  };

  const doResetPassword = async (user: AccountUser) => {
    setError(null);
    setBusyId(user.id);
    try {
      const result = await adminResetPassword(user.id);
      setResetLinks((links) => ({ ...links, [user.id]: result }));
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Could not create a reset link.');
    } finally {
      setBusyId(null);
    }
  };

  const doRevoke = async (invite: Invite) => {
    setError(null);
    try {
      await revokeInvite(tokenFromLink(invite.link));
      await load();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Could not revoke that invite.');
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="users-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="modal-head">
          <h2 id="users-title" className="modal-title">
            Beta users
          </h2>
          <button type="button" className="ghost icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="modal-body">
          {!data ? (
            <p className="auth-message">Loading…</p>
          ) : (
            <>
              <p className="users-limit">
                {seatsUsed} of {data.limit} accounts used.
              </p>

              <div className="users-list">
                {data.users.map((user) => (
                  <div key={user.id} className={user.status === 'disabled' ? 'users-row is-disabled' : 'users-row'}>
                    <div className="users-who">
                      <span className="users-name">
                        {user.name || user.email}
                        {user.id === currentUserId ? ' (you)' : ''}
                      </span>
                      <span className="users-email">{user.email}</span>
                    </div>
                    <span className={user.role === 'admin' ? 'users-badge is-admin' : 'users-badge'}>{user.role}</span>
                    {user.status === 'disabled' && <span className="users-badge is-disabled">disabled</span>}
                    <div className="users-actions">
                      <button type="button" className="ghost" disabled={busyId === user.id} onClick={() => toggleRole(user)}>
                        {user.role === 'admin' ? 'Make member' : 'Make admin'}
                      </button>
                      <button type="button" className="ghost" disabled={busyId === user.id} onClick={() => toggleStatus(user)}>
                        {user.status === 'disabled' ? 'Enable' : 'Disable'}
                      </button>
                      <button type="button" className="ghost" disabled={busyId === user.id} onClick={() => doResetPassword(user)}>
                        Reset password
                      </button>
                    </div>
                    {resetLinks[user.id] && (
                      <p className="users-note">
                        {resetLinks[user.id].emailed ? 'Reset link emailed. Also here, in case: ' : 'Send this reset link to them: '}
                        {resetLinks[user.id].link}{' '}
                        <button type="button" className="ghost" onClick={() => copy(resetLinks[user.id].link)}>
                          Copy
                        </button>
                      </p>
                    )}
                  </div>
                ))}

                {data.invites.map((invite) => (
                  <div key={invite.link} className="users-row is-pending">
                    <div className="users-who">
                      <span className="users-name">{invite.email}</span>
                      <span className="users-email">
                        Invited {new Date(invite.createdAt).toLocaleDateString()} · expires{' '}
                        {new Date(invite.expiresAt).toLocaleDateString()}
                      </span>
                    </div>
                    <span className="users-badge is-pending">invited</span>
                    <span className={invite.role === 'admin' ? 'users-badge is-admin' : 'users-badge'}>{invite.role}</span>
                    <div className="users-actions">
                      <button type="button" className="ghost" onClick={() => copy(invite.link)}>
                        Copy link
                      </button>
                      <button type="button" className="ghost danger" onClick={() => doRevoke(invite)}>
                        Revoke
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <form className="users-invite-form" onSubmit={submitInvite}>
                <label className="field">
                  <span className="field-label">Invite by email</span>
                  <input
                    type="email"
                    required
                    placeholder="name@example.com"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                  />
                </label>
                <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Role)} aria-label="Role">
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button type="submit" className="ghost accent" disabled={seatsUsed >= data.limit}>
                  Send invite
                </button>
              </form>

              {seatsUsed >= data.limit && <p className="users-note">This beta is at its cap of {data.limit} accounts.</p>}

              {inviteResult && (
                <p className="users-note">
                  {inviteResult.emailed ? 'Invite emailed. Also here, in case: ' : "Email isn't set up on this planner — copy this link and send it yourself: "}
                  {inviteResult.link}{' '}
                  <button type="button" className="ghost" onClick={() => copy(inviteResult.link)}>
                    Copy
                  </button>
                </p>
              )}

              {error && (
                <p className="auth-error" role="alert">
                  {error}
                </p>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
