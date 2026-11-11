import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { circleSchema, fieldErrors, joinSchema } from '../lib/validation'
import { friendlyError } from '../lib/errors'
import { useSession } from '../state/session'
import { Button, ErrorNote, Field, Select } from '../components/ui'

export function Onboarding() {
  const { memberships, refresh, setCircleId, signOut, profile } = useSession()
  const [mode, setMode] = useState<'join' | 'create'>('join')
  const [form, setForm] = useState({ code: '', unit: '', name: '', kind: 'society', city: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = memberships.filter((m) => m.status === 'pending')
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(''); setErrors({})
    if (mode === 'join') {
      const p = joinSchema.safeParse(form)
      if (!p.success) { setErrors(fieldErrors(p.error)); return }
      setBusy(true)
      const { data, error } = await supabase.rpc('join_circle', { p_code: p.data.code, p_unit: p.data.unit })
      setBusy(false)
      if (error) { setError(friendlyError(error)); return }
      if (!data) { setErrors({ code: 'That invite code is not valid. Check it with your circle admin.' }); return }
    } else {
      const p = circleSchema.safeParse(form)
      if (!p.success) { setErrors(fieldErrors(p.error)); return }
      setBusy(true)
      const { data, error } = await supabase.rpc('create_circle', { p_name: p.data.name, p_kind: p.data.kind, p_city: p.data.city, p_unit: p.data.unit })
      setBusy(false)
      if (error) { setError(friendlyError(error)); return }
      setCircleId(data as string)
    }
    await refresh()
  }

  return (
    <main className="mx-auto max-w-md px-5 py-10">
      <h1 className="text-3xl font-extrabold">Hi {profile?.display_name ?? 'there'}, which society are you in?</h1>
      <p className="mt-2 text-ink-soft">Neighborly works inside a circle: one society, hostel or campus. Every member is approved by the circle admin.</p>

      {pending.length > 0 && (
        <div className="mt-6 rounded-tag border-2 border-marigold-edge/40 bg-marigold-tint p-4">
          <p className="font-semibold">Waiting for approval</p>
          <ul className="mt-1 text-sm text-ink-soft">
            {pending.map((m) => <li key={m.circle_id}>{m.circles.name}: an admin will verify your flat soon.</li>)}
          </ul>
          <button className="mt-2 text-sm font-semibold text-leaf" onClick={() => void refresh()}>Check again</button>
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-2 rounded-xl bg-white p-1 shadow-tile" role="tablist">
        {(['join', 'create'] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} type="button" onClick={() => setMode(m)}
            className={`rounded-lg py-2.5 font-semibold ${mode === m ? 'bg-leaf text-white' : 'text-ink-soft'}`}>
            {m === 'join' ? 'Join with a code' : 'Start a new circle'}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="tile mt-4 space-y-4 p-5" noValidate>
        {mode === 'join' ? (
          <Field label="Invite code" value={form.code} onChange={set('code')} autoCapitalize="characters" placeholder="e.g. 4F9A1C07B2"
            hint="Ask your society admin or committee for it." error={errors.code} />
        ) : (
          <>
            <Field label="Circle name" value={form.name} onChange={set('name')} placeholder="Palm Grove Residency" error={errors.name} />
            <Select label="Type" value={form.kind} onChange={set('kind')}>
              <option value="society">Apartment society</option>
              <option value="campus">College campus or hostel</option>
              <option value="other">Other community</option>
            </Select>
            <Field label="City" value={form.city} onChange={set('city')} placeholder="Chennai" error={errors.city} />
          </>
        )}
        <Field label="Your flat or room" value={form.unit} onChange={set('unit')} placeholder="Tower B, 1204"
          hint="Only shown to a neighbour after you approve their request, and to circle admins." error={errors.unit} />
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" busy={busy} className="w-full">{mode === 'join' ? 'Ask to join' : 'Create circle'}</Button>
      </form>
      <button onClick={() => void signOut()} className="mt-6 text-sm font-semibold text-ink-soft">Sign out</button>
    </main>
  )
}
