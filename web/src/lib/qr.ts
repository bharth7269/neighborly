import type { Stage } from './types'

// QR payload: neighborly:v1:<loan uuid>:<stage>:<32 hex code>
// The code is single-use, expires in 5 minutes, and only its hash is stored server-side.
const PREFIX = 'neighborly:v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CODE = /^[0-9a-f]{32}$/

export function encodeHandover(loanId: string, stage: Stage, code: string): string {
  return `${PREFIX}:${loanId}:${stage}:${code}`
}

export type ParsedHandover = { loanId: string; stage: Stage; code: string }

export function parseHandover(raw: string): ParsedHandover | null {
  const parts = raw.trim().split(':')
  if (parts.length !== 5 || `${parts[0]}:${parts[1]}` !== PREFIX) return null
  const [, , loanId, stage, code] = parts
  if (!UUID.test(loanId) || (stage !== 'pickup' && stage !== 'return') || !CODE.test(code.toLowerCase())) return null
  return { loanId: loanId.toLowerCase(), stage, code: code.toLowerCase() }
}

/** Accepts either a scanned QR payload or a code typed by hand. */
export function extractCode(input: string, loanId: string, stage: Stage): string | null {
  const parsed = parseHandover(input)
  if (parsed) return parsed.loanId === loanId.toLowerCase() && parsed.stage === stage ? parsed.code : null
  const typed = input.replace(/[\s-]/g, '').toLowerCase()
  return CODE.test(typed) ? typed : null
}
