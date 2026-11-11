import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { Item, RequestPost } from '../lib/types'
import { fieldErrors, requestSchema } from '../lib/validation'
import { friendlyError } from '../lib/errors'
import { fmtDate, relative, todayIST } from '../lib/format'
import { useSession } from '../state/session'
import { PageTitle } from '../components/Layout'
import { Badge, Button, Empty, ErrorNote, Field, Loading, TextArea, useToast } from '../components/ui'

export function Requests() {
  const { circleId, userId } = useSession()
  const toast = useToast()
  const [posts, setPosts] = useState<RequestPost[] | null>(null)
  const [myItems, setMyItems] = useState<Pick<Item, 'id' | 'title'>[]>([])
  const [offered, setOffered] = useState<Set<string>>(new Set())
  const [form, setForm] = useState({ need: '', details: '', needed_by: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [composing, setComposing] = useState(false)

  const load = useCallback(async () => {
    if (!circleId || !userId) return
    const [r, i, o] = await Promise.all([
      supabase.from('requests').select('id, circle_id, requester_id, need, details, needed_by, status, created_at, requester:profiles!requests_requester_id_fkey(id, display_name)')
        .eq('circle_id', circleId).eq('status', 'open').order('created_at', { ascending: false }).limit(100),
      supabase.from('items').select('id, title').eq('owner_id', userId).eq('circle_id', circleId).in('status', ['available', 'paused']),
      supabase.from('request_offers').select('request_id').eq('offerer_id', userId),
    ])
    setPosts((r.data ?? []) as unknown as RequestPost[])
    setMyItems((i.data ?? []) as Pick<Item, 'id' | 'title'>[])
    setOffered(new Set((o.data ?? []).map((x) => x.request_id as string)))
  }, [circleId, userId])

  useEffect(() => { void load() }, [load])

  async function post(e: FormEvent) {
    e.preventDefault()
    setErrors({}); setError('')
    const p = requestSchema.safeParse(form)
    if (!p.success) { setErrors(fieldErrors(p.error)); return }
    setBusy(true)
    const { error } = await supabase.from('requests').insert({
      circle_id: circleId, requester_id: userId, need: p.data.need, details: p.data.details, needed_by: p.data.needed_by || null,
    })
    setBusy(false)
    if (error) { setError(friendlyError(error)); return }
    setForm({ need: '', details: '', needed_by: '' }); setComposing(false)
    toast('Posted to your circle')
    void load()
  }

  async function offer(r: RequestPost, itemId: string | null) {
    const { error } = await supabase.rpc('offer_help', { p_request: r.id, p_item: itemId, p_note: '' })
    if (error) { toast(friendlyError(error), 'brick'); return }
    toast('They’ve been told you can help')
    setOffered((s) => new Set(s).add(r.id))
  }

  async function close(r: RequestPost, status: 'fulfilled' | 'closed') {
    const { error } = await supabase.from('requests').update({ status }).eq('id', r.id)
    if (error) { toast(friendlyError(error), 'brick'); return }
    void load()
  }

  return (
    <>
      <PageTitle action={!composing && <Button onClick={() => setComposing(true)}>Ask for something</Button>}>Neighbours need</PageTitle>
      {composing && (
        <form onSubmit={post} className="tile mb-6 space-y-4 p-5" noValidate>
          <Field label="What do you need?" value={form.need} onChange={(e) => setForm({ ...form, need: e.target.value })} placeholder="A ladder to reach the loft" error={errors.need} maxLength={140} />
          <TextArea label="Details (optional)" value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} maxLength={500} />
          <Field label="Needed by (optional)" type="date" min={todayIST()} value={form.needed_by} onChange={(e) => setForm({ ...form, needed_by: e.target.value })} />
          <ErrorNote>{error}</ErrorNote>
          <div className="flex gap-3"><Button type="submit" busy={busy}>Post request</Button><Button type="button" tone="plain" onClick={() => setComposing(false)}>Cancel</Button></div>
        </form>
      )}
      {posts === null ? <Loading /> : posts.length === 0 ? (
        <Empty title="No open requests">Can’t find something on the shelf? Ask here, and neighbours who own one will be notified.</Empty>
      ) : (
        <ul className="space-y-3">
          {posts.map((r) => {
            const mine = r.requester_id === userId
            return (
              <li key={r.id} className="tile p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-lg font-bold">{r.need}</p>
                    <p className="text-sm text-ink-soft">{mine ? 'You' : r.requester?.display_name} · {relative(r.created_at)}</p>
                  </div>
                  {r.needed_by && <Badge tone="marigold">By {fmtDate(r.needed_by)}</Badge>}
                </div>
                {r.details && <p className="mt-2 text-ink-soft">{r.details}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {mine ? (
                    <>
                      <Button tone="plain" onClick={() => void close(r, 'fulfilled')}>I got it</Button>
                      <Button tone="plain" onClick={() => void close(r, 'closed')}>Close</Button>
                    </>
                  ) : offered.has(r.id) ? (
                    <Badge tone="leaf">You offered to help</Badge>
                  ) : myItems.length > 0 ? (
                    <label className="flex items-center gap-2">
                      <span className="sr-only">Offer one of your items</span>
                      <select className="field !py-2" defaultValue="" onChange={(e) => { if (e.target.value) void offer(r, e.target.value === 'none' ? null : e.target.value) }}>
                        <option value="" disabled>I have this…</option>
                        {myItems.map((i) => <option key={i.id} value={i.id}>Offer my {i.title}</option>)}
                        <option value="none">I have one (not listed yet)</option>
                      </select>
                    </label>
                  ) : (
                    <Button tone="marigold" onClick={() => void offer(r, null)}>I have this</Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
