import { Link } from 'react-router-dom'
import type { Item } from '../lib/types'
import { CONDITION_LABEL } from '../lib/types'
import { fmtInr } from '../lib/format'
import { Badge, Photo } from './ui'

// An item shown as a physical lending tag: punched hole, string, solid edge.
export function ItemTag({ item }: { item: Item }) {
  const unavailable = item.status !== 'available'
  return (
    <Link to={`/items/${item.id}`}
      className="group relative block rounded-tag border-2 border-line bg-white shadow-tile-lg transition-transform duration-100 hover:-translate-y-0.5 active:translate-y-0.5">
      <span aria-hidden className="absolute left-1/2 top-2.5 z-10 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-line bg-ground" />
      <div className="p-2.5 pt-7">
        <div className="relative overflow-hidden rounded-xl">
          <Photo path={item.photo_paths[0]} alt={item.title} className="aspect-[4/3] w-full" />
          {unavailable && (
            <span className="absolute left-2 top-2 rounded-lg bg-ink/85 px-2 py-0.5 text-xs font-semibold text-white">
              {item.status === 'paused' ? 'Paused' : 'On loan'}
            </span>
          )}
        </div>
      </div>
      <div className="border-t-2 border-dashed border-line px-3.5 pb-3.5 pt-2.5">
        <h3 className="line-clamp-2 text-[17px] font-bold leading-tight">{item.title}</h3>
        <p className="mt-0.5 truncate text-sm text-ink-soft">{item.owner?.display_name ?? 'Neighbour'} · {CONDITION_LABEL[item.condition]}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.tier === 'free' && <Badge tone="leaf">Free</Badge>}
          {item.tier !== 'free' && <Badge tone="marigold">{fmtInr(item.deposit_inr)} deposit</Badge>}
          {item.min_trust > 0 && <Badge>Trust {item.min_trust}+</Badge>}
        </div>
      </div>
    </Link>
  )
}
