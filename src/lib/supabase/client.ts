import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Set them in frontend/.env.local (see .env.example).'
  );
}

/**
 * Browser Supabase client for authentication.
 *
 * The session (access + refresh token) is persisted in localStorage and auto
 * refreshed. `detectSessionInUrl` lets the password-recovery redirect
 * (/reset-password) pick up the recovery token from the URL hash.
 *
 * Role / branch claims live in `session.user.app_metadata`.
 */
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
