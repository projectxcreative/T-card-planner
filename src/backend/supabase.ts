import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The Supabase client, or null when this build isn't pointed at Supabase —
 * in which case the app carries on with the Cloudflare Worker sync as before.
 * Both live side by side until the move is finished.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;

export const usingSupabase = supabase !== null;

export type AppRole = 'staff' | 'client';

export interface Profile {
  id: string;
  display_name: string;
  role: AppRole;
}

/** Emails a one-time sign-in link. Sign-ups are off in the project, so this
 *  only works for people who have been invited. */
export async function sendSignInLink(email: string): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured for this build.';
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
  });
  return error ? error.message : null;
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}

export async function currentSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function loadProfile(userId: string): Promise<Profile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, role')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}
