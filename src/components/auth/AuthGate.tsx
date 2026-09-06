import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AccountContext } from '../../accountContext';
import { fetchSession, type SessionInfo } from '../../authClient';
import AcceptInviteView from './AcceptInviteView';
import AdminSetupView from './AdminSetupView';
import ForgotPasswordView from './ForgotPasswordView';
import LoginView from './LoginView';
import ResetPasswordView from './ResetPasswordView';

type Phase = 'loading' | 'offline' | 'ready';

const tokenFromQuery = () => new URLSearchParams(window.location.search).get('token') ?? '';

/** Sends the browser back to the plain board URL once a link-based flow
 *  (accept-invite, reset-password) has done its job. */
function goHome() {
  window.history.replaceState({}, '', '/');
}

/**
 * Decides what the app shows before there's a board to show at all: the
 * one-time admin setup, sign in, an invite link, a reset link, or — once
 * someone is in — the board itself.
 *
 * Two things are allowed to reach the board unquestioned: a device with no
 * Worker to ask at all (`npm run dev` with no `dev:worker` — the board still
 * works from local storage, so a login screen with nothing behind it would
 * only get in the way), and a request Cloudflare Access already vetted at the
 * edge before the app ever loaded. Everything else goes through here.
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [showForgot, setShowForgot] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const info = await fetchSession();
      setSession(info);
      setPhase('ready');
    } catch {
      setPhase('offline');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const path = window.location.pathname;

  if (path === '/accept-invite') {
    return (
      <AcceptInviteView
        token={tokenFromQuery()}
        onAccepted={() => {
          goHome();
          void refresh();
        }}
        onCancel={goHome}
      />
    );
  }

  if (path === '/reset-password') {
    return (
      <ResetPasswordView
        token={tokenFromQuery()}
        onReset={() => {
          goHome();
          void refresh();
        }}
        onCancel={goHome}
      />
    );
  }

  if (phase === 'loading') {
    return (
      <div className="auth-shell">
        <p className="auth-loading" role="status" aria-live="polite">
          Loading…
        </p>
      </div>
    );
  }

  if (phase === 'offline' || !session) {
    return <AccountContext.Provider value={{ user: null, refresh }}>{children}</AccountContext.Provider>;
  }

  // Access already decided at the edge — the SPA wouldn't have loaded at all
  // if it hadn't. A native account is the same kind of "already decided".
  if (session.accounts.user || (session.access && session.signedIn)) {
    return <AccountContext.Provider value={{ user: session.accounts.user, refresh }}>{children}</AccountContext.Provider>;
  }

  if (session.accounts.needsSetup) {
    return <AdminSetupView onDone={() => void refresh()} />;
  }

  return showForgot ? (
    <ForgotPasswordView onBack={() => setShowForgot(false)} />
  ) : (
    <LoginView onSignedIn={() => void refresh()} onForgotPassword={() => setShowForgot(true)} />
  );
}
