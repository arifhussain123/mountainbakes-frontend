// Re-export Firebase instances so the rest of the app imports from @/utils/firebase.
// The actual initialisation lives in lib/firebase/client.ts (browser-only guard).
// Authentication now lives in Supabase — import { supabase } from '@/lib/supabase/client'.
export { db, storage } from '@/lib/firebase/client';
