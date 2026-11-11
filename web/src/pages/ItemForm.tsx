import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { CATEGORIES, type Item } from '../lib/types'
import { fieldErrors, itemSchema } from '../lib/validation'
import { friendlyError } from '../lib/errors'
import { preparePhoto } from '../lib/image'
import { useSession } from '../state/session'
import { PageTitle } from '../components/Layout'
import { Button, ErrorNote, Field, Loading, Photo, Select, TextArea, useToast } from '../components/ui'

const blank = { title: '', description: '', category: 'tools', condition: 'good', tier: 'free', min_trust: '0', deposit_inr: '0', max_days: '7' }

export function ItemForm() {
  const { id } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const { circleId, userId } = useSession()
  const [form, setForm] = useState(blank)
  const [existing, setExisting] = useState<Item | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(!!id)

  useEffect(() => {
    if (!id) return
    supabase.from('items').select('*').eq('id', id).single().then(({ data }) => {
      if (data && data.owner_id === userId) {
        const it = data as Item
        setExisting(it)
        setForm({ ...it, min_trust: String(it.min_trust), deposit_inr: String(it.deposit_inr), max_days: String(it.max_days) })
      }
      setLoading(false)
    })
  }, [id, userId])

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(''); setErrors({})
    const p = itemSchema.safeParse(form)
    if (!p.success) { setErrors(fieldErrors(p.error)); return }
    if (!circleId || !userId) return
    const keep = existing?.photo_paths ?? []
    if (keep.length + files.length > 6) { setErrors({ photos: 'Up to 6 photos' }); return }
    if (!existing && files.length === 0) { setErrors({ photos: 'Add at least one photo so neighbours can see its condition' }); return }

    setBusy(true)
    try {
      let itemId = existing?.id
      let circle = existing?.circle_id ?? circleId
      if (!itemId) {
        const { data, error } = await supabase.from('items')
          .insert({ ...p.data, circle_id: circleId, owner_id: userId }).select('id, circle_id').single()
        if (error) throw error
        itemId = data.id; circle = data.circle_id
      }
      const paths = [...keep]
      for (const f of files) {
        const blob = await preparePhoto(f)
        const path = `${circle}/${itemId}/${crypto.randomUUID()}.jpg`
        const up = await supabase.storage.from('item-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false })
        if (up.error) throw up.error
        paths.push(path)
      }
      const { error } = await supabase.from('items').update({ ...p.data, photo_paths: paths }).eq('id', itemId)
      if (error) throw error
      toast(existing ? 'Item updated' : 'Item listed')
      nav(`/items/${itemId}`, { replace: true })
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  async function removePhoto(path: string) {
    if (!existing) return
    const next = existing.photo_paths.filter((p) => p !== path)
    const { error } = await supabase.from('items').update({ photo_paths: next }).eq('id', existing.id)
    if (error) { setError(friendlyError(error)); return }
    await supabase.storage.from('item-photos').remove([path])
    setExisting({ ...existing, photo_paths: next })
  }

  if (loading) return <Loading />

  return (
    <div className="mx-auto max-w-xl">
      <PageTitle>{existing ? 'Edit item' : 'Lend something'}</PageTitle>
      <form onSubmit={submit} className="tile space-y-5 p-5" noValidate>
        <Field label="What is it?" value={form.title} onChange={set('title')} placeholder="Bosch cordless drill" error={errors.title} />
        <TextArea label="Details" value={form.description} onChange={set('description')} placeholder="Comes with 10 bits and a charger. Battery lasts about an hour." error={errors.description} />
        <div className="grid grid-cols-2 gap-4">
          <Select label="Category" value={form.category} onChange={set('category')}>
            {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <Select label="Condition" value={form.condition} onChange={set('condition')}>
            <option value="new">New</option><option value="like_new">Like new</option><option value="good">Good</option><option value="fair">Fair</option>
          </Select>
        </div>

        <fieldset>
          <legend className="label">How do you want to lend it?</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {([['free', 'Free', 'Everyday things'], ['protected', 'With deposit', 'Worth ₹2k–15k'], ['premium', 'Premium', 'Worth ₹15k+, verified phone only']] as const).map(([v, t, d]) => (
              <label key={v} className={`cursor-pointer rounded-xl border-2 p-3 ${form.tier === v ? 'border-leaf bg-leaf-tint' : 'border-line bg-white'}`}>
                <input type="radio" name="tier" value={v} checked={form.tier === v} onChange={set('tier')} className="sr-only" />
                <span className="block font-semibold">{t}</span>
                <span className="block text-sm text-ink-soft">{d}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Deposit (₹)" type="number" inputMode="numeric" min={0} max={100000} value={form.deposit_inr} onChange={set('deposit_inr')} disabled={form.tier === 'free'} error={errors.deposit_inr} />
          <Field label="Min. trust" type="number" inputMode="numeric" min={0} max={100} value={form.min_trust} onChange={set('min_trust')} error={errors.min_trust} />
          <Field label="Max days" type="number" inputMode="numeric" min={1} max={30} value={form.max_days} onChange={set('max_days')} error={errors.max_days} />
        </div>
        {form.tier !== 'free' && <p className="-mt-2 text-sm text-ink-soft">The deposit is agreed in the app and settled between you (cash or UPI) at pickup. In-app payments are coming later.</p>}

        <div>
          <span className="label">Photos</span>
          {existing && existing.photo_paths.length > 0 && (
            <ul className="mb-3 grid grid-cols-3 gap-2">
              {existing.photo_paths.map((p) => (
                <li key={p} className="relative">
                  <Photo path={p} alt="Item photo" className="aspect-square w-full rounded-xl" />
                  <button type="button" onClick={() => void removePhoto(p)} className="absolute right-1 top-1 rounded-lg bg-white px-2 text-sm font-semibold shadow-tile" aria-label="Remove photo">Remove</button>
                </li>
              ))}
            </ul>
          )}
          <input type="file" accept="image/*" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 6))}
            className="block w-full text-sm file:mr-3 file:rounded-xl file:border-2 file:border-line file:bg-white file:px-4 file:py-2 file:font-semibold" />
          <p className="mt-1 text-sm text-ink-soft">Location data is removed from photos before upload.</p>
          {errors.photos && <p className="mt-1 text-sm font-medium text-brick">{errors.photos}</p>}
        </div>

        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" busy={busy} className="w-full">{existing ? 'Save changes' : 'List item'}</Button>
      </form>
    </div>
  )
}
