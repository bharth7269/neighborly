import { describe, expect, it } from 'vitest'
import { encodeHandover, extractCode, parseHandover } from './qr'
import { circleSchema, itemSchema, joinSchema, phoneSchema } from './validation'
import { friendlyError } from './errors'
import { trustBand } from './format'

const LOAN = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90'
const CODE = '0123456789abcdef0123456789abcdef'

describe('handover QR', () => {
  it('round-trips a payload', () => {
    expect(parseHandover(encodeHandover(LOAN, 'pickup', CODE))).toEqual({ loanId: LOAN, stage: 'pickup', code: CODE })
  })
  it('rejects malformed or foreign payloads', () => {
    expect(parseHandover('https://evil.example')).toBeNull()
    expect(parseHandover(`neighborly:v1:${LOAN}:steal:${CODE}`)).toBeNull()
    expect(parseHandover(`neighborly:v1:not-a-uuid:pickup:${CODE}`)).toBeNull()
    expect(parseHandover(`neighborly:v1:${LOAN}:pickup:${CODE}:extra`)).toBeNull()
  })
  it('only accepts a code for the same loan and stage', () => {
    expect(extractCode(encodeHandover(LOAN, 'pickup', CODE), LOAN, 'pickup')).toBe(CODE)
    expect(extractCode(encodeHandover(LOAN, 'pickup', CODE), LOAN, 'return')).toBeNull()
    expect(extractCode(encodeHandover('00000000-0000-0000-0000-000000000000', 'pickup', CODE), LOAN, 'pickup')).toBeNull()
  })
  it('accepts a typed code with spaces', () => {
    expect(extractCode('0123 4567 89AB CDEF 0123 4567 89ab cdef', LOAN, 'pickup')).toBe(CODE)
    expect(extractCode('1234', LOAN, 'pickup')).toBeNull()
  })
})

describe('validation', () => {
  it('normalises invite codes', () => {
    expect(joinSchema.parse({ code: ' 4f9a1c07b2 ', unit: 'B-1204' }).code).toBe('4F9A1C07B2')
    expect(joinSchema.safeParse({ code: "'; drop table", unit: 'B' }).success).toBe(false)
  })
  it('requires Indian mobile format', () => {
    expect(phoneSchema.safeParse('+919876543210').success).toBe(true)
    expect(phoneSchema.safeParse('9876543210').success).toBe(false)
    expect(phoneSchema.safeParse('+911234567890').success).toBe(false)
  })
  it('enforces item rules', () => {
    const base = { title: 'Drill', description: '', category: 'tools', condition: 'good', tier: 'free', min_trust: '0', deposit_inr: '0', max_days: '7' }
    expect(itemSchema.safeParse(base).success).toBe(true)
    expect(itemSchema.safeParse({ ...base, deposit_inr: '500' }).success).toBe(false)
    expect(itemSchema.safeParse({ ...base, min_trust: '101' }).success).toBe(false)
    expect(itemSchema.safeParse({ ...base, category: 'weapons' }).success).toBe(false)
  })
  it('trims circle names', () => {
    expect(circleSchema.parse({ name: '  Palm Grove  ', kind: 'society', unit: 'A1' }).name).toBe('Palm Grove')
  })
})

describe('errors', () => {
  it('shows database sentences but hides internals', () => {
    expect(friendlyError({ message: 'This item is not available right now' })).toBe('This item is not available right now')
    expect(friendlyError({ message: 'relation "public.loans" does not exist' })).toBe('Something went wrong. Please try again.')
    expect(friendlyError({ message: 'new row violates row-level security policy for table "items"' })).toBe('You don’t have permission to do that.')
    expect(friendlyError(new TypeError('Failed to fetch'))).toMatch(/offline/)
  })
})

describe('trust bands', () => {
  it('maps scores', () => {
    expect(trustBand(85).tone).toBe('leaf')
    expect(trustBand(50).tone).toBe('marigold')
    expect(trustBand(10).tone).toBe('brick')
  })
})
