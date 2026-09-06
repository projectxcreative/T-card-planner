import { useState, type FormEvent } from 'react';
import { AuthError, setupAdmin } from '../../authClient';
import AuthLayout from './AuthLayout';

/** Shown exactly once per deployment — while no account exists yet. Whoever
 *  completes this becomes the admin; see `ADMIN_EMAIL` in accounts.ts for how
 *  that's kept from being whoever gets here first. */
export default function AdminSetupView({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await setupAdmin({ name: name.trim(), email: email.trim(), password });
      onDone();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Couldn't reach the server. Try again.");
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Set up your admin account" subtitle="This planner doesn't have an admin yet — that's you.">
      <form className="auth-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Your name</span>
          <input type="text" autoComplete="name" required autoFocus value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Email</span>
          <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <span className="field-note">At least 8 characters.</span>
        </label>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="ghost accent auth-submit" disabled={busy}>
          {busy ? 'Setting up…' : 'Create admin account'}
        </button>
      </form>
    </AuthLayout>
  );
}
