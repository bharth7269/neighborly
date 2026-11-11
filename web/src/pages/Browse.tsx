import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { CATEGORIES, type Item } from '../lib/types'
import { friendlyError } from '../lib/errors'
import { useSession } from '../state/session'
import { ItemTag } from '../components/ItemTag'
import { PageTitle } from '../components/Layout'
import { Empty, ErrorNote, Loading } from '../components/ui'

export const ITEM_COLUMNS =
  'id, circle_id, owner_id, title, description, category, condition, tier, min_trust, deposit_inr, max_days, status, photo_paths, created_at, owner:profiles!items_owner_id_fkey(id, display_name, trust_score)'

export function Browse() {
  const { circleId, circle } = useSession()
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [onlyAvailable, setOnlyAvailable] = useState(false)

  useEffect(() => {
    if (!circleId) return
    setItems(null)
    supabase.from('items').select(ITEM_COLUMNS)
      .eq('circle_id', circleId).neq('status', 'removed')
      .order('created_at', { ascending: false }).limit(200)
      .then(({ data, error }) => {
        if (error) setError(friendlyError(error))
        setItems((data ?? []) as unknown as Item[])
      })
  }, [circleId])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (items ?? []).filter((i) =>
      (cat === 'all' || i.category === cat) &&
      (!onlyAvailable || i.status === 'available') &&
      (!needle || i.title.toLowerCase().includes(needle) || i.description.toLowerCase().includes(needle)))
  }, [items, q, cat, onlyAvailable])

  return (
    <>
      <PageTitle>What’s on the shelf in {circle?.circles.name ?? 'your circle'}</PageTitle>

      <div className="mb-5 space-y-3">
        <label className="block">
          <span className="sr-only">Search items</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for a drill, tent, projector…" className="field" />
        </label>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Category">
          {[['all', 'Everything'] as const, ...CATEGORIES].map(([v, label]) => (
            <button key={v} type="button" aria-pressed={cat === v} onClick={() => setCat(v)}
              className={`shrink-0 rounded-full border-2 px-3.5 py-1.5 text-sm font-semibold ${cat === v ? 'border-leaf-edge bg-leaf text-white' : 'border-line bg-white text-ink-soft'}`}>
              {label}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink-soft">
          <input type="checkbox" className="h-5 w-5 accent-leaf" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} />
          Available now only
        </label>
      </div>

      <ErrorNote>{error}</ErrorNote>
      {items === null ? <Loading label="Loading items" /> : shown.length === 0 ? (
        items.length === 0 ? (
          <Empty title="Nothing listed yet" action={<div className="flex flex-wrap justify-center gap-3"><Link to="/items/new" className="key-marigold">Lend something</Link><Link to="/requests" className="key-plain">Ask for something</Link></div>}>
            Be the first: list one thing you rarely use, or post what you need and let neighbours offer it.
          </Empty>
        ) : (
          <Empty title="No matches">Try another word, or <Link to="/requests" className="font-semibold text-leaf underline">ask the circle</Link> for it.</Empty>
        )
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((i) => <li key={i.id}><ItemTag item={i} /></li>)}
        </ul>
      )}
    </>
  )
}
