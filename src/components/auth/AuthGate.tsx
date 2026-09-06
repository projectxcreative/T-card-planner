import { ClerkProvider, Show, SignIn, SignUp, UserButton, useAuth } from '@clerk/react';
import { dark } from '@clerk/themes';
import App from '../../App';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

/**
 * Clerk does the actual sign-in, invite-only sign-up, and password reset —
 * this component just decides which of Clerk's own screens to show, and
 * bridges its session token into the board's own sync (see `sync.ts`).
 *
 * Who gets to sign up at all, who's an admin, and inviting the beta — all of
 * that lives in Clerk's own dashboard (Restricted sign-up mode plus its
 * Invitations page), not in this app. See the README's Accounts section.
 */
export default function AuthGate() {
  // Unset means accounts are off: the board runs exactly as it did before
  // Clerk existed, on local storage plus whatever Access or BOARD_TOKEN the
  // Worker has — the normal shape of `npm run dev` with nothing configured.
  if (!PUBLISHABLE_KEY) return <App />;

  // Read once, at boot: the sign-in screen has no theme toggle of its own,
  // and the app's own toggle only appears once you're past it.
  const isDark = document.documentElement.dataset.theme === 'dark';

  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/" appearance={isDark ? dark : undefined}>
      <Show when="signed-in">
        <SignedInApp />
      </Show>
      <Show when="signed-out">
        <SignInOrUp />
      </Show>
    </ClerkProvider>
  );
}

function SignedInApp() {
  const { getToken } = useAuth();
  return <App accountSlot={<UserButton />} getClerkToken={getToken} />;
}

/** Clerk appends `__clerk_ticket` to the link it emails for an invitation —
 *  whoever arrives with one is completing a sign-up, not logging in. Sign-up
 *  is Restricted in the Clerk dashboard, so there's no self-serve path to it
 *  without one: this is the only way `<SignUp/>` ever renders. */
const hasInviteTicket = () => new URLSearchParams(window.location.search).has('__clerk_ticket');

function SignInOrUp() {
  return (
    <div className="auth-shell">
      <div className="auth-brand">
        <img className="brand-mark" src="/logo.svg" alt="" width={22} height={22} />
        <span className="brand-name">T-Card Planner</span>
      </div>
      {hasInviteTicket() ? <SignUp /> : <SignIn />}
    </div>
  );
}
