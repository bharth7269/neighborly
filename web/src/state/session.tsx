import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Membership, Profile } from '../lib/types'

interface SessionState {
  ready: boolean
  session: Session | null
  userId: string | null
  phoneVerified: boolean
  profile: Profile | null
  memberships: Membership[]
  activeCircles: Membership[]
  circleId: string | null
  circle: Membership | null
  setCircleId: (id: string) => void
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<SessionState | null>(null)
const CIRCLE_KEY = 'nb.circle'

function readStored(): string | null {
  try { return localStorage.getItem(CIRCLE_KEY) } catch { return null }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [circleId, setCircleIdState] = useState<string | null>(readStored())

  const userId = session?.user.id ?? null

  const load = useCallback(async (uid: string | null) => {
    if (!uid) { setProfile(null); setMemberships([]); return }
    const [p, m] = await Promise.all([
      supabase.from('profiles').select('id, display_name, bio, trust_score, created_at').eq('id', uid).single(),
      supabase.from('circle_members')
        .select('circle_id, user_id, role, status, circles(id, name, kind, city)')
        .eq('user_id', uid),
    ])
    if (!p.error) setProfile(p.data as Profile)
    if (!m.error) setMemberships((m.data ?? []) as unknown as Membership[])
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await load(data.session?.user.id ?? null)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      // Defer to avoid calling Supabase inside the auth callback.
      setTimeout(() => { void load(s?.user.id ?? null) }, 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [load])

  const activeCircles = useMemo(() => memberships.filter((m) => m.status === 'active'), [memberships])
  const circle = activeCircles.find((m) => m.circle_id === circleId) ?? activeCircles[0] ?? null

  const setCircleId = useCallback((id: string) => {
    setCircleIdState(id)
    try { localStorage.setItem(CIRCLE_KEY, id) } catch { /* storage unavailable */ }
  }, [])

  const value: SessionState = {
    ready, session, userId, profile, memberships, activeCircles,
    phoneVerified: Boolean(session?.user.phone_confirmed_at),
    circleId: circle?.circle_id ?? null, circle, setCircleId,
    refresh: () => load(userId),
    signOut: async () => {
      await supabase.auth.signOut()
      try { localStorage.removeItem(CIRCLE_KEY) } catch { /* ignore */ }
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession(): SessionState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSession outside SessionProvider')
  return v
}
