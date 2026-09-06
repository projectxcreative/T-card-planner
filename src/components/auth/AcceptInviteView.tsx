import { useEffect, useState, type FormEvent } from 'react';
import { AuthError, acceptInvite, fetchInvite, type Role } from '../../authClient';
import AuthLayout from './AuthLayout';

interface Props {
  token: string;
  onAccepted: () => void;
  onCancel: () => void;
}

type Loaded = { email: string; role: Role };

export default function AcceptInviteView({ token, onAccepted, onCancel }: Props) {
  const [invite, setInvite] = useState<Loaded | 'loading' | 'invalid'>('loading');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setInvite('invalid');
      return;
    }
    fetchInvite(token)
      .then((result) => {
        if (!cancelled) setInvite(result);
      })
      .catch(() => {
        if (!cancelled) setInvite('invalid');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await acceptInvite({ token, name: name.trim(), password });
      onAccepted();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Couldn't reach the server. Try again.");
      setBusy(false);
    }
  };

  if (invite === 'loading') {
    return (
      <AuthLayout title="Accept your invite">
        <p className="auth-message">Loading…</p>
      </AuthLayout>
    );
  }

  if (invite === 'invalid') {
    return (
      <AuthLayout title="Invite not found">
        <p className="auth-error">This invite link is invalid or has expired. Ask your admin for a new one.</p>
        <button type="button" className="auth-link" onClick={onCancel}>
          Back to sign in
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="You're invited" subtitle={`Set up your account for ${invite.email}.`}>
      <form className="auth-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Your name</span>
          <input type="text" autoComplete="name" required autoFocus value={name} onChange={(event) => setName(event.target.value)} />
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
          {busy ? 'Setting up…' : 'Create account'}
        </button>
      </form>
      <button type="button" className="auth-link" onClick={onCancel}>
        Already have an account? Sign in
      </button>
    </AuthLayout>
  );
}
