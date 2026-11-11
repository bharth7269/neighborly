// Maps errors from Supabase into messages people can act on, without exposing internals.
type MaybeError = { message?: string; code?: string; status?: number } | null | undefined

const FRIENDLY_DB_MESSAGE = /^[A-Z][\w\s'’(),.%·-]{3,160}$/

export function friendlyError(err: unknown): string {
  const e = err as MaybeError
  const msg = e?.message ?? ''
  if (!msg) return 'Something went wrong. Please try again.'
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'You seem to be offline. Check your connection and try again.'
  if (/JWT expired|invalid JWT|not authenticated/i.test(msg)) return 'Your session expired. Please sign in again.'
  if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Please wait a few minutes and try again.'
  if (/permission denied|row-level security/i.test(msg)) return 'You don’t have permission to do that.'
  if (/Token has expired or is invalid/i.test(msg)) return 'That code is wrong or has expired. Request a new one.'
  // Our database functions raise short, human-readable sentences — show those as-is.
  if (FRIENDLY_DB_MESSAGE.test(msg)) return msg
  if (import.meta.env.DEV) console.error(err)
  return 'Something went wrong. Please try again.'
}

/** Unwraps a Supabase { data, error } result, throwing on error. */
export function must<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error
  return res.data
}
