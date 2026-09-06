import { useState, type FormEvent } from 'react';
import { AuthError, resetPassword } from '../../authClient';
import AuthLayout from './AuthLayout';

interface Props {
  token: string;
  onReset: () => void;
  onCancel: () => void;
}

export default function ResetPasswordView({ token, onReset, onCancel }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!token) {
    return (
      <AuthLayout title="Reset link missing">
        <p className="auth-error">This link is missing its token. Ask your admin to send a fresh reset link.</p>
        <button type="button" className="auth-link" onClick={onCancel}>
          Back to sign in
        </button>
      </AuthLayout>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await resetPassword({ token, password });
      onReset();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Couldn't reach the server. Try again.");
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Choose a new password">
      <form className="auth-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">New password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            autoFocus
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
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
      <button type="button" className="auth-link" onClick={onCancel}>
        Back to sign in
      </button>
    </AuthLayout>
  );
}
