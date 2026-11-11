import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useSession } from '../state/session'

const icons: Record<string, ReactNode> = {
  browse: <path d="M3 9.5 12 4l9 5.5V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z M9 20v-6h6v6" />,
  requests: <path d="M4 5h16v11H8l-4 4Z M8 10h8" />,
  loans: <path d="M7 7h11l-3-3 M17 17H6l3 3 M18 7v5 M6 17v-5" />,
  alerts: <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4Z M10 20h4" />,
  me: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4 21a8 8 0 0 1 16 0" />,
}

function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {icons[name]}
    </svg>
  )
}

function useUnreadCount(userId: string | null) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!userId) return
    const load = () => supabase.from('notifications').select('id', { count: 'exact', head: true })
      .is('read_at', null).then(({ count }) => setN(count ?? 0))
    void load()
    const ch = supabase.channel(`notif-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, load)
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [userId])
  return n
}

const tabs = [
  { to: '/', label: 'Browse', icon: 'browse', end: true },
  { to: '/requests', label: 'Requests', icon: 'requests' },
  { to: '/loans', label: 'Loans', icon: 'loans' },
  { to: '/alerts', label: 'Alerts', icon: 'alerts' },
  { to: '/me', label: 'You', icon: 'me' },
]

export function Layout() {
  const { activeCircles, circle, setCircleId, userId } = useSession()
  const unread = useUnreadCount(userId)

  return (
    <div className="min-h-dvh pb-24 md:pb-10">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2">Skip to content</a>
      <header className="sticky top-0 z-30 border-b-2 border-line bg-ground/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2" aria-label="Neighborly home">
            <img src="/icon.svg" alt="" className="h-9 w-9" />
            <span className="hidden font-display text-xl font-extrabold sm:inline">Neighborly</span>
          </Link>
          {activeCircles.length > 1 ? (
            <label className="min-w-0 flex-1">
              <span className="sr-only">Circle</span>
              <select value={circle?.circle_id ?? ''} onChange={(e) => setCircleId(e.target.value)}
                className="w-full max-w-[220px] truncate rounded-xl border-2 border-line bg-white px-3 py-2 font-semibold">
                {activeCircles.map((m) => <option key={m.circle_id} value={m.circle_id}>{m.circles.name}</option>)}
              </select>
            </label>
          ) : (
            <p className="min-w-0 flex-1 truncate font-semibold text-ink-soft">{circle?.circles.name}</p>
          )}
          <nav className="hidden gap-1 md:flex" aria-label="Main">
            {tabs.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end}
                className={({ isActive }) => `relative rounded-xl px-3 py-2 font-semibold ${isActive ? 'bg-white text-leaf shadow-tile' : 'text-ink-soft hover:text-ink'}`}>
                {t.label}
                {t.icon === 'alerts' && unread > 0 && <span className="ml-1 rounded-full bg-brick px-1.5 text-xs text-white">{unread}</span>}
              </NavLink>
            ))}
          </nav>
          <Link to="/items/new" className="key-marigold !min-h-[42px] !px-4 text-sm">Lend</Link>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-5xl px-4 pt-5">
        <Outlet />
      </main>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="grid grid-cols-5">
          {tabs.map((t) => (
            <li key={t.to}>
              <NavLink to={t.to} end={t.end}
                className={({ isActive }) => `relative flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-xs font-semibold ${isActive ? 'text-leaf' : 'text-ink-soft'}`}>
                <Icon name={t.icon} />
                {t.label}
                {t.icon === 'alerts' && unread > 0 && (
                  <span className="absolute right-[22%] top-2 min-w-[18px] rounded-full bg-brick px-1 text-center text-[11px] leading-[18px] text-white" aria-label={`${unread} unread`}>{unread > 9 ? '9+' : unread}</span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

export function PageTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <h1 className="text-[28px] font-extrabold leading-tight sm:text-4xl">{children}</h1>
      {action}
    </div>
  )
}
