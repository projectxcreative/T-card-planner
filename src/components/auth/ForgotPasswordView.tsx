import { useState, type FormEvent } from 'react';
import { AuthError, forgotPassword } from '../../authClient';
import AuthLayout from './AuthLayout';

export default function ForgotPasswordView({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const result = await forgotPassword(email.trim());
      setMessage(result.message);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Reset your password" subtitle="Enter the email your account was invited with.">
      {message ? (
        <p className="auth-message">{message}</p>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            <span className="field-label">Email</span>
            <input type="email" autoComplete="email" required autoFocus value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="ghost accent auth-submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
      <button type="button" className="auth-link" onClick={onBack}>
        Back to sign in
      </button>
    </AuthLayout>
  );
}
