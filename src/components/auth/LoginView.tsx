import { useState, type FormEvent } from 'react';
import { AuthError, login } from '../../authClient';
import AuthLayout from './AuthLayout';

interface Props {
  onSignedIn: () => void;
  onForgotPassword: () => void;
}

export default function LoginView({ onSignedIn, onForgotPassword }: Props) {
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
      await login({ email: email.trim(), password });
      onSignedIn();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Couldn't reach the server. Try again.");
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Sign in" subtitle="This beta is invite-only — ask your admin if you need an invite.">
      <form className="auth-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="ghost accent auth-submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <button type="button" className="auth-link" onClick={onForgotPassword}>
        Forgot your password?
      </button>
    </AuthLayout>
  );
}
