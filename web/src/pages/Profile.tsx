import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fieldErrors, otpSchema, phoneSchema, profileSchema } from '../lib/validation'
import { friendlyError } from '../lib/errors'
import { relative, trustBand } from '../lib/format'
import { useSession } from '../state/session'
import { PageTitle } from '../components/Layout'
import { Button, ErrorNote, Field, TextArea, useToast } from '../components/ui'

const REASONS: Record<string, string> = {
  returned_on_time: 'Returned an item', lent_item: 'Lent an item', late_return: 'Returned late',
  dispute_at_fault: 'Found at fault in a dispute',
}

export function Profile() {
  const { profile, refresh, signOut, session, phoneVerified, activeCircles } = useSession()
  const toast = useToast()
  const [form, setForm] = useState({ display_name: profile?.display_name ?? '', bio: profile?.bio ?? '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [events, setEvents] = useState<{ id: string; delta: number; reason: string; created_at: string }[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('trust_events').select('id, delta, reason, created_at').order('created_at', { ascending: false }).limit(20)
      .then(({ data }) => setEvents(data ?? []))
  }, [profile?.trust_score])

  async function save(e: FormEvent) {
    e.preventDefault()
    const p = profileSchema.safeParse(form)
    if (!p.success) { setErrors(fieldErrors(p.error)); return }
    setBusy(true)
    const { error } = await supabase.from('profiles').update(p.data).eq('id', profile!.id)
    setBusy(false)
    if (error) { toast(friendlyError(error), 'brick'); return }
    setErrors({}); toast('Profile saved'); void refresh()
  }

  const score = profile?.trust_score ?? 0
  const band = trustBand(score)
  const staffCircles = activeCircles.filter((m) => m.role !== 'member')

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageTitle>You</PageTitle>

      <section className="tile p-5">
        <p className="text-sm font-semibold text-ink-soft">Trust score</p>
        <div className="mt-1 flex items-end gap-3">
          <span className="font-display text-6xl font-extrabold leading-none">{score}</span>
          <span className="pb-1 font-semibold">{band.label}</span>
        </div>
        <div className="mt-3 h-4 overflow-hidden rounded-full border-2 border-line bg-ground" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} aria-label="Trust score">
          <div className={`h-full ${band.tone === 'leaf' ? 'bg-leaf' : band.tone === 'marigold' ? 'bg-marigold' : 'bg-brick'}`} style={{ width: `${score}%` }} />
        </div>
        <p className="mt-3 text-sm text-ink-soft">Everyone starts at 50. Returning things on time raises it; late returns and damage lower it. Points from lending to the same person repeatedly are capped.</p>
        {events.length > 0 && (
          <ul className="mt-4 divide-y-2 divide-line">
            {events.map((ev) => (
              <li key={ev.id} className="flex justify-between py-2 text-sm">
                <span>{REASONS[ev.reason] ?? ev.reason} <span className="text-ink-soft">· {relative(ev.created_at)}</span></span>
                <span className={`font-bold ${ev.delta > 0 ? 'text-leaf' : 'text-brick'}`}>{ev.delta > 0 ? `+${ev.delta}` : ev.delta}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form onSubmit={save} className="tile space-y-4 p-5" noValidate>
        <h2 className="text-xl font-bold">Profile</h2>
        <Field label="Name neighbours see" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} error={errors.display_name} maxLength={60} />
        <TextArea label="About you (optional)" value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} maxLength={280} error={errors.bio} />
        <p className="text-sm text-ink-soft">Signed in as {session?.user.email ?? session?.user.phone}</p>
        <Button type="submit" busy={busy}>Save profile</Button>
      </form>

      {!phoneVerified && <VerifyPhone onDone={() => void refresh()} />}

      {staffCircles.length > 0 && (
        <section className="tile p-5">
          <h2 className="text-xl font-bold">Circles you manage</h2>
          <ul className="mt-3 space-y-2">
            {staffCircles.map((m) => <li key={m.circle_id}><Link className="font-semibold text-leaf underline" to={`/circle/${m.circle_id}/members`}>{m.circles.name}</Link></li>)}
          </ul>
        </section>
      )}

      <section className="tile space-y-3 p-5">
        <h2 className="text-xl font-bold">Account</h2>
        <div className="flex flex-wrap gap-3">
          <Button tone="plain" onClick={() => void signOut()}>Sign out</Button>
          <Link to="/join" className="key-plain">Join another circle</Link>
        </div>
        <DeleteAccount onDeleted={() => void signOut()} />
      </section>
    </div>
  )
}

function VerifyPhone({ onDone }: { onDone: () => void }) {
  const toast = useToast()
  const [phone, setPhone] = useState('')
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault(); setError('')
    if (!sent) {
      const p = phoneSchema.safeParse(phone)
      if (!p.success) { setError(p.error.issues[0].message); return }
      setBusy(true)
      const { error } = await supabase.auth.updateUser({ phone: p.data })
      setBusy(false)
      if (error) setError(friendlyError(error)); else setSent(true)
    } else {
      const p = otpSchema.safeParse(code)
      if (!p.success) { setError(p.error.issues[0].message); return }
      setBusy(true)
      const { error } = await supabase.auth.verifyOtp({ phone, token: p.data, type: 'phone_change' })
      setBusy(false)
      if (error) { setError(friendlyError(error)); return }
      toast('Phone verified'); onDone()
    }
  }

  return (
    <form onSubmit={submit} className="tile space-y-4 p-5" noValidate>
      <h2 className="text-xl font-bold">Verify your mobile number</h2>
      <p className="text-ink-soft">Needed to borrow premium items. Your number is never shown to other members.</p>
      {!sent
        ? <Field label="Mobile number" type="tel" inputMode="tel" placeholder="+919876543210" value={phone} onChange={(e) => setPhone(e.target.value)} />
        : <Field label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" tone="plain" busy={busy}>{sent ? 'Verify' : 'Send code'}</Button>
    </form>
  )
}

function DeleteAccount({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function del() {
    setBusy(true); setError('')
    const { error } = await supabase.functions.invoke('delete-account', { body: {} })
    setBusy(false)
    if (error) {
      const ctx = (error as { context?: Response }).context
      const msg = ctx ? ((await ctx.json().catch(() => null)) as { error?: string } | null)?.error : undefined
      setError(msg ?? friendlyError(error)); return
    }
    onDeleted()
  }

  if (!open) return <button className="text-sm font-semibold text-brick underline" onClick={() => setOpen(true)}>Delete my account</button>
  return (
    <div className="space-y-3 rounded-xl border-2 border-brick/30 bg-brick-tint p-4">
      <p className="font-semibold">This permanently deletes your profile, listings, memberships and messages.</p>
      <p className="text-sm">Condition photos from past loans are kept for the other person’s records, without your name. Type DELETE to confirm.</p>
      <Field label="Confirmation" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
      <ErrorNote>{error}</ErrorNote>
      <Button tone="brick" busy={busy} disabled={confirmText !== 'DELETE'} onClick={() => void del()}>Delete account permanently</Button>
    </div>
  )
}
