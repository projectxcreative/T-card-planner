import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { loadProfile, supabase, type Profile } from './supabase';

export type AuthState =
  | { status: 'disabled' }
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; session: Session; profile: Profile | null };

/** Tracks the Supabase login and the signed-in person's profile (and so
 *  whether they are staff or a client). */
export function useSupabaseAuth(): AuthState {
  const [state, setState] = useState<AuthState>(
    supabase ? { status: 'loading' } : { status: 'disabled' },
  );

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    const apply = async (session: Session | null) => {
      if (!session) {
        if (!cancelled) setState({ status: 'signed-out' });
        return;
      }
      let profile: Profile | null = null;
      try {
        profile = await loadProfile(session.user.id);
      } catch {
        profile = null;
      }
      if (!cancelled) setState({ status: 'signed-in', session, profile });
    };

    supabase.auth.getSession().then(({ data }) => apply(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      void apply(session);
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  return state;
}
