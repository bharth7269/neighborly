import { z } from 'zod'

// Client-side validation mirrors the database constraints so people get instant
// feedback. The database still enforces every rule; this is UX, not security.
const text = (min: number, max: number, label: string) =>
  z.string().trim().min(min, `${label} needs at least ${min} characters`).max(max, `${label} can be at most ${max} characters`)

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address').max(254)
export const phoneSchema = z.string().trim().regex(/^\+91[6-9]\d{9}$/, 'Enter an Indian mobile number like +919876543210')
export const otpSchema = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code')

export const circleSchema = z.object({
  name: text(3, 80, 'Name'),
  kind: z.enum(['society', 'campus', 'other']),
  city: z.string().trim().max(60).optional().default(''),
  unit: text(1, 40, 'Flat / room'),
})

export const joinSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[0-9A-F]{10}$/, 'Invite codes are 10 letters and numbers'),
  unit: text(1, 40, 'Flat / room'),
})

export const itemSchema = z.object({
  title: text(3, 80, 'Title'),
  description: z.string().trim().max(1000, 'Description can be at most 1000 characters'),
  category: z.enum(['tools', 'kitchen', 'electronics', 'outdoor', 'sports', 'party', 'kids', 'books', 'other']),
  condition: z.enum(['new', 'like_new', 'good', 'fair']),
  tier: z.enum(['free', 'protected', 'premium']),
  min_trust: z.coerce.number().int().min(0).max(100),
  deposit_inr: z.coerce.number().int().min(0).max(100000),
  max_days: z.coerce.number().int().min(1).max(30),
}).refine((v) => v.tier === 'free' ? v.deposit_inr === 0 : true, { message: 'Free items cannot have a deposit', path: ['deposit_inr'] })

export const requestSchema = z.object({
  need: text(3, 140, 'What you need'),
  details: z.string().trim().max(500),
  needed_by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
})

export const messageSchema = text(1, 1000, 'Message')
export const disputeSchema = text(10, 1000, 'Description')
export const profileSchema = z.object({ display_name: text(2, 60, 'Name'), bio: z.string().trim().max(280) })

/** Returns the first error message per field. */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of err.issues) {
    const k = issue.path.join('.') || '_'
    if (!out[k]) out[k] = issue.message
  }
  return out
}
