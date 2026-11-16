import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** True when the app has been pointed at a Supabase project. */
export const isConfigured = Boolean(url && anonKey && !url.includes('YOUR-PROJECT'))

/**
 * The single Supabase client for the whole app. Every feature reads and
 * writes through this, so auth and row level security apply everywhere.
 */
export const supabase: SupabaseClient = createClient(
  url ?? 'http://localhost:54321',
  anonKey ?? 'public-anon-key',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
)
