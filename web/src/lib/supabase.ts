import { createClient } from '@supabase/supabase-js'

// Tolerate copy-paste slips: surrounding spaces/quotes and a trailing slash.
const clean = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/^["']|["']$/g, '') : undefined) || undefined
const url = clean(import.meta.env.VITE_SUPABASE_URL)?.replace(/\/+$/, '').toLowerCase()
const anonKey = clean(import.meta.env.VITE_SUPABASE_ANON_KEY)

export const configError =
  !url || !anonKey
    ? 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill them in.'
    : !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) && !url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost')
      ? 'VITE_SUPABASE_URL does not look like a Supabase project URL.'
      : null

// The anon key is public by design: every table is protected by row-level security
// on the server. The service-role key must NEVER be used in this app.
export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
})

export const phoneAuthEnabled = import.meta.env.VITE_ENABLE_PHONE_AUTH === 'true'
