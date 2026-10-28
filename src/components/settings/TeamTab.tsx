import { useState } from 'react';
import type { Sync } from '../../sync';
import type { UserRole, WorkspaceKind } from '../../types';

export default function TeamTab({ sync }: { sync: Sync }) {
  // Workspace creation state
  const [wsName, setWsName] = useState('');
  const [wsKind, setWsKind] = useState<WorkspaceKind>('team');

  // Login / Admin setup state when signed out
  const [authEmail, setAuthEmail] = useState('');
  const [authName, setAuthName] = useState('');
  const [authPassword, setAuthPassword] = useState('');

  // Profile update state
  const [profileName, setProfileName] = useState(sync.user?.name ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  // Admin: Add new user state
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userRole, setUserRole] = useState<UserRole>('member');
  const [userMsg, setUserMsg] = useState<string | null>(null);

  // Admin: Reset password inline state
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPasswordDraft, setResetPasswordDraft] = useState('');

  const isAdmin = sync.user?.role === 'admin';

  return (
    <div className="settings-section-stack">
      {/* 1. Workspaces / Boards */}
      <section className="settings-block">
        <div className="settings-head">
          <h3 className="settings-sub">Workspaces & boards</h3>
        </div>
        <p className="settings-note">
          Switch between shared team boards and private personal boards. Each workspace has its own cards, projects, and clients.
        </p>

        <ul className="cat-list">
          {sync.workspaces.map((ws) => {
            const active = ws.id === sync.activeWorkspaceId;
            return (
              <li key={ws.id} className="cat-row">
                <button
                  type="button"
                  className={`ghost ${active ? 'accent' : ''}`}
                  onClick={() => sync.switchWorkspace(ws.id)}
                  title={active ? 'Active board' : 'Switch to this board'}
                >
                  {active ? '● Active' : 'Switch'}
                </button>
                <input
                  type="text"
                  className="cat-input"
                  value={ws.name}
                  disabled={ws.id === 'default' && !isAdmin && sync.signedIn}
                  aria-label="Workspace name"
                  onChange={(e) => void sync.renameWorkspace(ws.id, e.target.value)}
                />
                <span className="team-pill">{ws.kind === 'personal' ? 'Personal' : 'Team'}</span>
                <button
                  type="button"
                  className="ghost cat-remove"
                  disabled={ws.id === 'default'}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete workspace "${ws.name}"? Make sure you have exported any work you want to keep.`,
                      )
                    ) {
                      void sync.deleteWorkspace(ws.id);
                    }
                  }}
                  title={ws.id === 'default' ? 'The default Team Board cannot be deleted' : 'Delete workspace'}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>

        <form
          className="cat-add"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!wsName.trim()) return;
            await sync.createWorkspace(wsName.trim(), wsKind);
            setWsName('');
          }}
        >
          <input
            type="text"
            className="cat-input"
            value={wsName}
            placeholder="New workspace name…"
            onChange={(e) => setWsName(e.target.value)}
          />
          <select
            className="panel-select team-select-compact"
            value={wsKind}
            onChange={(e) => setWsKind(e.target.value as WorkspaceKind)}
          >
            <option value="team">Team board</option>
            <option value="personal">Personal board</option>
          </select>
          <button type="submit" className="ghost accent" disabled={!wsName.trim()}>
            + Add board
          </button>
        </form>
      </section>

      {/* 2. Account & In-App Authentication */}
      <section className="settings-block">
        <div className="settings-head">
          <h3 className="settings-sub">Account & authentication</h3>
        </div>

        {!sync.signedIn ? (
          <div>
            <p className="settings-note">
              {sync.setupRequired
                ? 'No users have been registered on the server yet. Create the first administrator account below.'
                : 'Sign in with your email and password to sync boards across devices and manage your team.'}
            </p>
            <form
              className="team-form-grid"
              onSubmit={async (e) => {
                e.preventDefault();
                if (sync.setupRequired) {
                  await sync.setupAdmin(authEmail, authName, authPassword);
                } else {
                  await sync.login(authEmail, authPassword);
                }
              }}
            >
              {sync.setupRequired && (
                <input
                  type="text"
                  className="cat-input"
                  placeholder="Your full name"
                  value={authName}
                  required
                  onChange={(e) => setAuthName(e.target.value)}
                />
              )}
              <input
                type="email"
                className="cat-input"
                placeholder="Email address"
                value={authEmail}
                required
                onChange={(e) => setAuthEmail(e.target.value)}
              />
              <input
                type="password"
                className="cat-input"
                placeholder={sync.setupRequired ? 'Password (min 8 chars)' : 'Password'}
                value={authPassword}
                required
                minLength={sync.setupRequired ? 8 : 1}
                onChange={(e) => setAuthPassword(e.target.value)}
              />
              <button type="submit" className="ghost accent" disabled={sync.authBusy}>
                {sync.authBusy
                  ? 'Please wait…'
                  : sync.setupRequired
                    ? 'Create admin account'
                    : 'Sign in'}
              </button>
            </form>
            {sync.authError && <p className="sync-error">{sync.authError}</p>}
          </div>
        ) : (
          <div>
            <p className="settings-note">
              Signed in as <strong>{sync.user?.name}</strong> ({sync.user?.email}) · Role:{' '}
              <strong>{sync.user?.role}</strong>
            </p>
            <form
              className="team-form-grid"
              onSubmit={async (e) => {
                e.preventDefault();
                setProfileMsg(null);
                const res = await sync.updateProfile({
                  name: profileName.trim() || undefined,
                  currentPassword: currentPassword || undefined,
                  newPassword: newPassword || undefined,
                });
                if (res.ok) {
                  setCurrentPassword('');
                  setNewPassword('');
                  setProfileMsg('Profile updated.');
                } else {
                  setProfileMsg(res.error || 'Could not update profile.');
                }
              }}
            >
              <input
                type="text"
                className="cat-input"
                placeholder="Display name"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
              />
              <input
                type="password"
                className="cat-input"
                placeholder="Current password (to change)"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
              <input
                type="password"
                className="cat-input"
                placeholder="New password (8+ chars)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <div className="sync-actions">
                <button type="submit" className="ghost accent">
                  Save profile
                </button>
                <button
                  type="button"
                  className="ghost danger"
                  onClick={() => void sync.signOut()}
                >
                  Sign out
                </button>
              </div>
            </form>
            {profileMsg && <p className="settings-note">{profileMsg}</p>}
          </div>
        )}
      </section>

      {/* 3. Team Directory & Admin User Management */}
      {sync.signedIn && (
        <section className="settings-block">
          <div className="settings-head">
            <h3 className="settings-sub">Team members ({sync.users.length})</h3>
          </div>
          <p className="settings-note">
            {isAdmin
              ? 'Add or manage team accounts. Members can sign in, be assigned to cards, and collaborate on team boards.'
              : 'Team members who have access to shared boards and can be assigned to cards.'}
          </p>

          <ul className="cat-list">
            {sync.users.map((u) => (
              <li key={u.id} className="cat-row team-user-row">
                <span className="sync-user-avatar">{u.name.slice(0, 2).toUpperCase()}</span>
                <div className="team-user-meta">
                  <strong>{u.name}</strong>
                  <span className="dim">{u.email}</span>
                </div>
                {isAdmin ? (
                  <>
                    <select
                      className="panel-select team-select-compact"
                      value={u.role}
                      onChange={(e) =>
                        void sync.updateUser(u.id, { role: e.target.value as UserRole })
                      }
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                    {resetUserId === u.id ? (
                      <div className="sync-actions">
                        <input
                          type="password"
                          className="cat-input"
                          placeholder="New password (8+ chars)"
                          value={resetPasswordDraft}
                          onChange={(e) => setResetPasswordDraft(e.target.value)}
                        />
                        <button
                          type="button"
                          className="ghost accent"
                          onClick={async () => {
                            if (resetPasswordDraft.length < 8) {
                              setUserMsg('Password must be at least 8 characters.');
                              return;
                            }
                            const res = await sync.updateUser(u.id, {
                              password: resetPasswordDraft,
                            });
                            if (res.ok) {
                              setResetUserId(null);
                              setResetPasswordDraft('');
                              setUserMsg(`Password updated for ${u.name}.`);
                            } else {
                              setUserMsg(res.error ?? 'Error resetting password.');
                            }
                          }}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => {
                            setResetUserId(null);
                            setResetPasswordDraft('');
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => {
                          setResetUserId(u.id);
                          setResetPasswordDraft('');
                        }}
                      >
                        Reset password
                      </button>
                    )}
                    <button
                      type="button"
                      className="ghost cat-remove"
                      disabled={u.id === sync.user?.id}
                      title={
                        u.id === sync.user?.id
                          ? 'You cannot delete your own account'
                          : `Remove ${u.name}`
                      }
                      onClick={() => {
                        if (window.confirm(`Remove user ${u.name} (${u.email})?`)) {
                          void sync.deleteUser(u.id);
                        }
                      }}
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <span className="team-pill">{u.role}</span>
                )}
              </li>
            ))}
          </ul>

          {isAdmin && (
            <form
              className="team-form-grid"
              onSubmit={async (e) => {
                e.preventDefault();
                setUserMsg(null);
                const res = await sync.createUser({
                  name: userName.trim(),
                  email: userEmail.trim(),
                  password: userPassword,
                  role: userRole,
                });
                if (res.ok) {
                  setUserName('');
                  setUserEmail('');
                  setUserPassword('');
                  setUserRole('member');
                  setUserMsg('Team member added.');
                } else {
                  setUserMsg(res.error || 'Could not add user.');
                }
              }}
            >
              <input
                type="text"
                className="cat-input"
                placeholder="Member name"
                value={userName}
                required
                onChange={(e) => setUserName(e.target.value)}
              />
              <input
                type="email"
                className="cat-input"
                placeholder="Member email"
                value={userEmail}
                required
                onChange={(e) => setUserEmail(e.target.value)}
              />
              <input
                type="password"
                className="cat-input"
                placeholder="Initial password (8+ chars)"
                value={userPassword}
                required
                minLength={8}
                onChange={(e) => setUserPassword(e.target.value)}
              />
              <div className="sync-actions">
                <select
                  className="panel-select team-select-compact"
                  value={userRole}
                  onChange={(e) => setUserRole(e.target.value as UserRole)}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button type="submit" className="ghost accent">
                  + Add user
                </button>
              </div>
            </form>
          )}
          {userMsg && <p className="settings-note">{userMsg}</p>}
        </section>
      )}
    </div>
  );
}
