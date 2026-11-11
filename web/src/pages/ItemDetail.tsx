import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { CONDITION_LABEL, TIER_LABEL, type Item } from '../lib/types'
import { friendlyError } from '../lib/errors'
import { fmtInr, todayIST } from '../lib/format'
import { useSession } from '../state/session'
import { ITEM_COLUMNS } from './Browse'
import { Badge, Button, Empty, ErrorNote, Field, Loading, Photo, TextArea, Trust, useToast } from '../components/ui'

export function ItemDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const { userId, profile, phoneVerified, circleId } = useSession()
  const [item, setItem] = useState<Item | null | undefined>(undefined)
  const [photo, setPhoto] = useState(0)
  const [dates, setDates] = useState({ start: todayIST(), end: todayIST(1) })
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('items').select(ITEM_COLUMNS).eq('id', id!).maybeSingle()
      .then(({ data }) => setItem((data as unknown as Item) ?? null))
  }, [id])

  if (item === undefined) return <Loading />
  if (item === null) return <Empty title="Item not found">It may have been removed, or it belongs to another circle.</Empty>

  const mine = item.owner_id === userId
  const score = profile?.trust_score ?? 0
  const blocker =
    item.status !== 'available' ? 'This item is not available right now.' :
    score < item.min_trust ? `The owner asks for a trust score of ${item.min_trust}. Yours is ${score}; complete a few loans to raise it.` :
    item.tier === 'premium' && !phoneVerified ? 'Premium items need a verified mobile number. Add one in your profile.' : ''

  async function request(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const { data, error } = await supabase.rpc('request_loan', { p_item: item!.id, p_start: dates.start, p_end: dates.end, p_message: message.trim() })
    setBusy(false)
    if (error) { setError(friendlyError(error)); return }
    toast('Request sent')
    nav(`/loans/${data}`)
  }

  async function setStatus(status: 'available' | 'paused' | 'removed') {
    const { error } = await supabase.from('items').update({ status }).eq('id', item!.id)
    if (error) { toast(friendlyError(error), 'brick'); return }
    if (status === 'removed') { toast('Item removed'); nav('/'); return }
    setItem({ ...item!, status })
  }

  async function report() {
    const reason = window.prompt('What is wrong with this listing?')
    if (!reason || reason.trim().length < 5) return
    const { error } = await supabase.rpc('report_content', { p_circle: circleId, p_user: null, p_item: item!.id, p_reason: reason.trim().slice(0, 500) })
    toast(error ? friendlyError(error) : 'Thanks. A moderator will review it.', error ? 'brick' : 'leaf')
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <section>
        <div className="tile overflow-hidden p-2.5">
          <Photo path={item.photo_paths[photo]} alt={item.title} className="aspect-[4/3] w-full rounded-xl" />
        </div>
        {item.photo_paths.length > 1 && (
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {item.photo_paths.map((p, i) => (
              <button key={p} onClick={() => setPhoto(i)} aria-label={`Photo ${i + 1}`} aria-pressed={photo === i}
                className={`shrink-0 overflow-hidden rounded-xl border-2 ${photo === i ? 'border-leaf' : 'border-line'}`}>
                <Photo path={p} alt="" className="h-16 w-16" />
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-5">
        <div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={item.tier === 'free' ? 'leaf' : 'marigold'}>{TIER_LABEL[item.tier]}</Badge>
            <Badge>{CONDITION_LABEL[item.condition]}</Badge>
            <Badge>Up to {item.max_days} days</Badge>
          </div>
          <h1 className="mt-3 text-3xl font-extrabold leading-tight">{item.title}</h1>
          {item.description && <p className="mt-2 whitespace-pre-line text-ink-soft">{item.description}</p>}
        </div>

        <div className="tile flex items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm text-ink-soft">Lent by</p>
            <p className="font-semibold">{mine ? 'You' : item.owner?.display_name}</p>
          </div>
          {item.owner && <Trust score={item.owner.trust_score} />}
        </div>

        {item.tier !== 'free' && (
          <p className="rounded-xl bg-marigold-tint p-4 text-sm"><strong>{fmtInr(item.deposit_inr)} refundable deposit</strong>, settled between you at pickup and returned when the item comes back in the same condition.</p>
        )}

        {mine ? (
          <div className="flex flex-wrap gap-3">
            <Link to={`/items/${item.id}/edit`} className="key-plain">Edit</Link>
            {item.status === 'available' && <Button tone="plain" onClick={() => void setStatus('paused')}>Pause lending</Button>}
            {item.status === 'paused' && <Button onClick={() => void setStatus('available')}>Make available</Button>}
            {['available', 'paused'].includes(item.status) && (
              <Button tone="brick" onClick={() => { if (window.confirm('Remove this item from the circle?')) void setStatus('removed') }}>Remove</Button>
            )}
          </div>
        ) : blocker ? (
          <p className="rounded-xl border-2 border-line bg-white p-4 font-medium">{blocker}</p>
        ) : (
          <form onSubmit={request} className="tile space-y-4 p-5">
            <h2 className="text-xl font-bold">Ask to borrow</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From" type="date" min={todayIST()} value={dates.start} onChange={(e) => setDates((d) => ({ ...d, start: e.target.value }))} />
              <Field label="Until" type="date" min={dates.start} value={dates.end} onChange={(e) => setDates((d) => ({ ...d, end: e.target.value }))} />
            </div>
            <TextArea label="Message to the owner" maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Need it to put up two shelves on Saturday." />
            <ErrorNote>{error}</ErrorNote>
            <Button type="submit" busy={busy} className="w-full">Send request</Button>
            <p className="text-sm text-ink-soft">Your flat number is shared with the owner only if they approve.</p>
          </form>
        )}
        {!mine && <button onClick={() => void report()} className="text-sm font-semibold text-ink-soft underline">Report this listing</button>}
      </section>
    </div>
  )
}
