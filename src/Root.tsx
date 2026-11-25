import App from './App';
import SignIn from './components/SignIn';
import { useSupabaseAuth } from './backend/useSupabaseAuth';

/**
 * With Supabase configured, nobody reaches the board without signing in, and
 * a client login never reaches it at all (the portal comes in phase 2). With
 * it unconfigured this is just the app, exactly as before.
 */
export default function Root() {
  const auth = useSupabaseAuth();
  if (auth.status === 'disabled') return <App />;
  if (auth.status === 'loading') return null;
  if (auth.status === 'signed-out') return <SignIn />;
  if (auth.profile?.role !== 'staff') {
    return (
      <main className="sign-in">
        <h1>Nothing to show yet</h1>
        <p>This login isn't set up for the planner. Your client portal is on its way.</p>
      </main>
    );
  }
  return <App />;
}
