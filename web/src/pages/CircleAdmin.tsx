import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { MemberRole } from '../lib/types'
import { friendlyError } from '../lib/errors'
import { relative } from '../lib/format'
import { useSession } from '../state/session'
import { PageTitle } from '../components/Layout'
import { Badge, Button, Empty, Loading, useToast } from '../components/ui'

type Pending = { user_id: string; display_name: string; unit_label: string; requested_at: string }
type Member = { user_id: string; role: MemberRole; status: string; profile: { display_name: string; trust_score: number } | null }

export function CircleAdmin() {
  const { id } = useParams()
  const { activeCircles, userId } = useSession()
  const toast = useToast()
  const me = activeCircles.find((m) => m.circle_id === id)
  const isAdmin = me?.role === 'admin'
  const [pending, setPending] = useState<Pending[] | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [disputes, setDisputes] = useState<{ id: string; status: string; created_at: string }[]>([])
  const [reports, setReports] = useState<{ id: string; reason: string; created_at: string; target_item_id: string | null }[]>([])
  const [code, setCode] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    const [p, m, d, r] = await Promise.all([
      supabase.rpc('list_pending_members', { p_circle: id }),
      supabase.from('circle_members').select('user_id, role, status, profile:profiles!circle_members_user_id_fkey(display_name, trust_score)').eq('circle_id', id).in('status', ['active', 'suspended']),
      supabase.from('loans').select('id, status, created_at').eq('circle_id', id).in('status', ['disputed']).order('created_at'),
      supabase.from('reports').select('id, reason, created_at, target_item_id').eq('circle_id', id).eq('status', 'open').order('created_at', { ascending: false }),
    ])
    setPending((p.data ?? []) as Pending[])
    setMembers((m.data ?? []) as unknown as Member[])
    setDisputes(d.data ?? [])
    setReports(r.data ?? [])
  }, [id])
  useEffect(() => { void load() }, [load])

  async function rpc(name: string, args: Record<string, unknown>, done: string) {
    const { data, error } = await supabase.rpc(name, args)
    if (error) { toast(friendlyError(error), 'brick'); return null }
    toast(done); void load(); return data
  }

  if (!me || me.role === 'member') return <Empty title="Only circle moderators can see this page" />
  if (pending === null) return <Loading />

  return (
    <div className="space-y-6">
      <PageTitle>Manage {me.circles.name}</PageTitle>

      <section className="tile p-5">
        <h2 className="text-xl font-bold">Invite code</h2>
        <p className="mt-1 text-ink-soft">Share it in your society group. Everyone who uses it still needs your approval.</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {code ? <span className="rounded-xl border-2 border-dashed border-leaf bg-leaf-tint px-4 py-2 font-mono text-xl font-bold tracking-widest">{code}</span>
                : <Button tone="plain" onClick={async () => { const r = await supabase.rpc('get_circle_invite', { p_circle: id }); setCode(r.data as string) }}>Show code</Button>}
          {isAdmin && <Button tone="plain" onClick={async () => { const c = await rpc('rotate_circle_invite', { p_circle: id }, 'New code created; the old one no longer works'); if (c) setCode(c as string) }}>Make a new code</Button>}
        </div>
      </section>

      <section className="tile p-5">
        <h2 className="text-xl font-bold">Waiting for approval</h2>
        <p className="mt-1 text-ink-soft">Check that each flat number is real before approving.</p>
        {pending.length === 0 ? <p className="mt-3 text-sm text-ink-soft">No one is waiting.</p> : (
          <ul className="mt-3 divide-y-2 divide-line">
            {pending.map((p) => (
              <li key={p.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div><p className="font-semibold">{p.display_name}</p><p className="text-sm text-ink-soft">{p.unit_label} · asked {relative(p.requested_at)}</p></div>
                <div className="flex gap-2">
                  <Button onClick={() => void rpc('review_member', { p_circle: id, p_user: p.user_id, p_approve: true }, 'Approved')}>Approve</Button>
                  <Button tone="plain" onClick={() => void rpc('review_member', { p_circle: id, p_user: p.user_id, p_approve: false }, 'Declined')}>Decline</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(disputes.length > 0 || reports.length > 0) && (
        <section className="tile p-5">
          <h2 className="text-xl font-bold">Needs review</h2>
          <ul className="mt-3 space-y-2">
            {disputes.map((d) => <li key={d.id}><Link className="font-semibold text-brick underline" to={`/loans/${d.id}`}>Dispute opened {relative(d.created_at)}</Link></li>)}
            {reports.map((r) => (
              <li key={r.id} className="text-sm">
                <Badge tone="marigold">Report</Badge> “{r.reason}” {r.target_item_id && <Link className="font-semibold text-leaf underline" to={`/items/${r.target_item_id}`}>View item</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="tile p-5">
        <h2 className="text-xl font-bold">Members ({members.filter((m) => m.status === 'active').length})</h2>
        <ul className="mt-3 divide-y-2 divide-line">
          {members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="font-semibold">{m.profile?.display_name} {m.user_id === userId && <span className="text-ink-soft">(you)</span>}</p>
                <div className="mt-1 flex gap-1.5"><Badge>{m.role}</Badge>{m.status === 'suspended' && <Badge tone="brick">Suspended</Badge>}<Badge>Trust {m.profile?.trust_score}</Badge></div>
              </div>
              {m.user_id !== userId && m.status === 'active' && m.role !== 'admin' && (
                <div className="flex flex-wrap gap-2">
                  {isAdmin && (
                    <Button tone="plain" onClick={() => void rpc('set_member_role', { p_circle: id, p_user: m.user_id, p_role: m.role === 'moderator' ? 'member' : 'moderator' }, 'Role updated')}>
                      {m.role === 'moderator' ? 'Make member' : 'Make moderator'}
                    </Button>
                  )}
                  <Button tone="brick" onClick={() => {
                    const reason = window.prompt('Why are you suspending this member?')
                    if (reason) void rpc('suspend_member', { p_circle: id, p_user: m.user_id, p_reason: reason }, 'Member suspended')
                  }}>Suspend</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
