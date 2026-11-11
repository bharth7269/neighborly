import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Notification } from '../lib/types'
import { relative } from '../lib/format'
import { PageTitle } from '../components/Layout'
import { Button, Empty, Loading } from '../components/ui'

// Only internal paths are ever used as links, so a notification can't send someone off-site.
const safeLink = (l: string | null) => (l && /^\/[a-z0-9/_-]*$/i.test(l) ? l : '/')

export function Alerts() {
  const [list, setList] = useState<Notification[] | null>(null)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  const load = () => supabase.from('notifications').select('id, kind, title, body, link, read_at, created_at')
    .order('created_at', { ascending: false }).limit(100)
    .then(({ data }) => setList((data ?? []) as Notification[]))
  useEffect(() => { void load() }, [])

  async function markAll() {
    await supabase.rpc('mark_notifications_read', { p_ids: null })
    void load()
  }
  async function open(n: Notification) {
    if (!n.read_at) await supabase.rpc('mark_notifications_read', { p_ids: [n.id] })
  }

  const shown = (list ?? []).filter((n) => filter === 'all' || !n.read_at)
  const unread = (list ?? []).some((n) => !n.read_at)

  return (
    <>
      <PageTitle action={unread && <Button tone="plain" onClick={() => void markAll()}>Mark all as read</Button>}>Alerts</PageTitle>
      <div className="mb-4 flex gap-2">
        {(['all', 'unread'] as const).map((f) => (
          <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}
            className={`rounded-full border-2 px-3.5 py-1.5 text-sm font-semibold ${filter === f ? 'border-leaf-edge bg-leaf text-white' : 'border-line bg-white text-ink-soft'}`}>
            {f === 'all' ? 'All' : 'Unread'}
          </button>
        ))}
      </div>
      {list === null ? <Loading /> : shown.length === 0 ? <Empty title="You’re all caught up" /> : (
        <ul className="space-y-2">
          {shown.map((n) => (
            <li key={n.id}>
              <Link to={safeLink(n.link)} onClick={() => void open(n)}
                className={`tile flex gap-3 p-4 ${n.read_at ? 'opacity-70' : ''}`}>
                <span aria-hidden className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${n.read_at ? 'bg-line' : 'bg-marigold'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{n.title}{!n.read_at && <span className="sr-only"> (unread)</span>}</span>
                  {n.body && <span className="block text-ink-soft">{n.body}</span>}
                  <span className="mt-0.5 block text-xs text-ink-soft">{relative(n.created_at)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
