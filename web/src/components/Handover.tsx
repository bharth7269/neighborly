import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '../lib/supabase'
import type { HandoverPhoto, Loan, Stage } from '../lib/types'
import { encodeHandover, extractCode } from '../lib/qr'
import { preparePhoto } from '../lib/image'
import { friendlyError } from '../lib/errors'
import { fmtDateTime } from '../lib/format'
import { Button, ErrorNote, Loading, Photo, useToast } from './ui'

// The scanner library is large, so it loads only when the camera is opened.
const Scanner = lazy(() => import('./Scanner').then((m) => ({ default: m.Scanner })))

/**
 * The handover protocol, for pickup and for return:
 *   1. Both people photograph the item (stored by the server, hashed, time-stamped).
 *   2. The owner shows a single-use QR code (valid 5 minutes).
 *   3. The borrower scans it, which proves both were in the same place.
 */
export function Handover({ loan, stage, isLender, photos, onDone }:
  { loan: Loan; stage: Stage; isLender: boolean; photos: HandoverPhoto[]; onDone: () => void }) {
  const toast = useToast()
  const [uploading, setUploading] = useState(false)
  const [code, setCode] = useState<{ value: string; expires: number } | null>(null)
  const [now, setNow] = useState(Date.now())
  const [scanning, setScanning] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const mine = photos.filter((p) => p.taken_by === (isLender ? loan.lender_id : loan.borrower_id))
  const theirs = photos.filter((p) => p.taken_by === (isLender ? loan.borrower_id : loan.lender_id))
  const bothPhotographed = mine.length > 0 && theirs.length > 0

  useEffect(() => {
    if (!code) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [code])
  const secondsLeft = code ? Math.max(0, Math.round((code.expires - now) / 1000)) : 0

  async function addPhoto(file: File | undefined) {
    if (!file) return
    setError('')
    setUploading(true)
    try {
      const blob = await preparePhoto(file)
      const body = new FormData()
      body.append('loan_id', loan.id)
      body.append('stage', stage)
      body.append('photo', blob, 'photo.jpg')
      const { error } = await supabase.functions.invoke('handover-photo', { body })
      if (error) {
        const ctx = (error as { context?: Response }).context
        const msg = ctx ? ((await ctx.json().catch(() => null)) as { error?: string } | null)?.error : undefined
        throw new Error(msg ?? error.message)
      }
      toast('Photo saved')
      onDone()
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setUploading(false)
    }
  }

  async function showCode() {
    setError('')
    setBusy(true)
    const { data, error } = await supabase.rpc('issue_handover_code', { p_loan: loan.id, p_stage: stage })
    setBusy(false)
    if (error) { setError(friendlyError(error)); return }
    setCode({ value: data as string, expires: Date.now() + 5 * 60_000 })
  }

  const confirm = useCallback(async (raw: string) => {
    setScanning(false)
    setError('')
    const c = extractCode(raw, loan.id, stage)
    if (!c) { setError('That QR code is not for this loan. Scan the code on the owner’s phone.'); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('confirm_handover', { p_loan: loan.id, p_stage: stage, p_code: c })
    setBusy(false)
    if (error) { setError(friendlyError(error)); return }
    if (!data) { setError('This QR code is invalid or expired. Ask the owner to refresh it.'); return }
    toast(stage === 'pickup' ? 'Picked up. Enjoy, and return it on time.' : 'Returned. The owner has 24 hours to check it.')
    onDone()
  }, [loan.id, stage, onDone, toast])

  return (
    <section className="tile space-y-5 p-5" aria-labelledby="handover-h">
      <div>
        <h2 id="handover-h" className="text-xl font-bold">{stage === 'pickup' ? 'Pickup handover' : 'Return handover'}</h2>
        <p className="mt-1 text-ink-soft">Do this together, in person. It takes about a minute.</p>
      </div>

      <ol className="space-y-4">
        <li className="flex gap-3">
          <Step n={1} done={mine.length > 0} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Photograph the item’s condition</p>
            <p className="text-sm text-ink-soft">
              {mine.length ? `You added ${mine.length}.` : 'Show any marks or scratches clearly.'}{' '}
              {theirs.length ? `${isLender ? 'Borrower' : 'Owner'} added ${theirs.length}.` : `Waiting for the ${isLender ? 'borrower' : 'owner'}’s photo.`}
            </p>
            {mine.length < 4 && (
              <label className={`key-plain mt-2 cursor-pointer ${uploading ? 'pointer-events-none opacity-60' : ''}`}>
                <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={uploading}
                  onChange={(e) => { void addPhoto(e.target.files?.[0]); e.target.value = '' }} />
                {uploading ? 'Saving photo…' : 'Take photo'}
              </label>
            )}
          </div>
        </li>

        <li className="flex gap-3">
          <Step n={2} done={false} />
          <div className="min-w-0 flex-1">
            {isLender ? (
              <>
                <p className="font-semibold">Show this code to the borrower</p>
                {!bothPhotographed ? (
                  <p className="text-sm text-ink-soft">Available once you both have added a photo.</p>
                ) : code && secondsLeft > 0 ? (
                  <div className="mt-3 flex flex-col items-center gap-3 rounded-xl bg-white p-4 shadow-tile">
                    <QRCodeSVG value={encodeHandover(loan.id, stage, code.value)} size={220} level="M" marginSize={2} title="Handover QR code" />
                    <p className="font-mono text-sm tracking-wider text-ink-soft" aria-label="Code to type if scanning fails">
                      {code.value.match(/.{1,4}/g)?.join(' ')}
                    </p>
                    <p className="text-sm font-semibold">Expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}</p>
                  </div>
                ) : (
                  <Button className="mt-2" busy={busy} onClick={() => void showCode()}>{code ? 'Show a new code' : 'Show QR code'}</Button>
                )}
              </>
            ) : (
              <>
                <p className="font-semibold">Scan the owner’s QR code</p>
                {!bothPhotographed ? (
                  <p className="text-sm text-ink-soft">Available once you both have added a photo.</p>
                ) : scanning ? (
                  <div className="mt-3"><Suspense fallback={<Loading label="Opening camera" />}><Scanner onResult={(t) => void confirm(t)} onClose={() => setScanning(false)} /></Suspense></div>
                ) : (
                  <div className="mt-2 space-y-3">
                    <Button busy={busy} onClick={() => setScanning(true)}>Scan QR code</Button>
                    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void confirm(typed) }}>
                      <label className="sr-only" htmlFor="typed-code">Or type the code</label>
                      <input id="typed-code" className="field font-mono" placeholder="Or type the code" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
                      <Button type="submit" tone="plain" disabled={typed.replace(/\s/g, '').length < 32}>Confirm</Button>
                    </form>
                  </div>
                )}
              </>
            )}
          </div>
        </li>
      </ol>
      <ErrorNote>{error}</ErrorNote>
    </section>
  )
}

function Step({ n, done }: { n: number; done: boolean }) {
  return (
    <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 font-display font-bold ${done ? 'border-leaf-edge bg-leaf text-white' : 'border-line bg-ground text-ink-soft'}`}>
      {done ? '✓' : n}
    </span>
  )
}

/** The evidence timeline: every condition photo with server time and fingerprint. */
export function PhotoTimeline({ loan, photos }: { loan: Loan; photos: HandoverPhoto[] }) {
  if (!photos.length) return null
  const who = (id: string | null) => id === loan.lender_id ? 'Owner' : id === loan.borrower_id ? 'Borrower' : 'Deleted account'
  return (
    <section className="tile p-5">
      <h2 className="text-xl font-bold">Condition record</h2>
      <p className="mt-1 text-sm text-ink-soft">Photos are stored by the server, time-stamped and fingerprinted, and can’t be edited or deleted by either of you.</p>
      {(['pickup', 'return'] as const).map((s) => {
        const list = photos.filter((p) => p.stage === s)
        if (!list.length) return null
        return (
          <div key={s} className="mt-4">
            <h3 className="font-semibold">{s === 'pickup' ? 'At pickup' : 'At return'}</h3>
            <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {list.map((p) => (
                <li key={p.id}>
                  <Photo bucket="handover-photos" path={p.storage_path} alt={`${who(p.taken_by)} photo at ${s}`} className="aspect-square w-full rounded-xl" />
                  <p className="mt-1 text-xs text-ink-soft">{who(p.taken_by)} · {fmtDateTime(p.server_time)}</p>
                  <p className="font-mono text-[11px] text-ink-soft" title={p.sha256}>#{p.sha256.slice(0, 12)}</p>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </section>
  )
}
