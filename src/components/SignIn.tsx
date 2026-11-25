import { useState, type FormEvent } from 'react';
import { sendSignInLink } from '../backend/supabase';

/** The door in front of the board: an email address, and a link sent to it. */
export default function SignIn() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!address) return;
    setState('sending');
    setError(null);
    const problem = await sendSignInLink(address);
    if (problem) {
      setError(problem);
      setState('idle');
    } else {
      setState('sent');
    }
  };

  return (
    <main className="sign-in">
      <img src="/logo.svg" alt="" width={48} height={48} />
      <h1>T-Card Planner</h1>
      {state === 'sent' ? (
        <p>
          Check <strong>{email.trim()}</strong> for a sign-in link. It works once, on this device.
        </p>
      ) : (
        <form onSubmit={submit}>
          <label htmlFor="sign-in-email">Email</label>
          <input
            id="sign-in-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" disabled={state === 'sending'}>
            {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
          </button>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
    </main>
  );
}
