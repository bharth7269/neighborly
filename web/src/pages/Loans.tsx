import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { LOAN_STATUS_LABEL, type Loan } from '../lib/types'
import { fmtDate } from '../lib/format'
import { useSession } from '../state/session'
import { PageTitle } from '../components/Layout'
import { Badge, Empty, Loading, Photo } from '../components/ui'

export const LOAN_COLUMNS =
  'id, item_id, circle_id, lender_id, borrower_id, status, start_date, end_date, message, deposit_inr, approved_at, started_at, due_at, returned_at, closed_at, created_at,' +
  ' item:items(id, title, photo_paths, tier, circle_id),' +
  ' lender:profiles!loans_lender_id_fkey(id, display_name, trust_score),' +
  ' borrower:profiles!loans_borrower_id_fkey(id, display_name, trust_score)'

const LIVE = ['requested', 'approved', 'active', 'returned', 'disputed']

export function Loans() {
  const { userId } = useSession()
  const [tab, setTab] = useState<'borrowing' | 'lending'>('borrowing')
  const [loans, setLoans] = useState<Loan[] | null>(null)

  useEffect(() => {
    if (!userId) return
    setLoans(null)
    supabase.from('loans').select(LOAN_COLUMNS)
      .eq(tab === 'borrowing' ? 'borrower_id' : 'lender_id', userId)
      .order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => setLoans((data ?? []) as unknown as Loan[]))
  }, [userId, tab])

  const live = (loans ?? []).filter((l) => LIVE.includes(l.status))
  const past = (loans ?? []).filter((l) => !LIVE.includes(l.status))

  return (
    <>
      <PageTitle>Your loans</PageTitle>
      <div className="mb-5 grid max-w-sm grid-cols-2 gap-2 rounded-xl bg-white p-1 shadow-tile" role="tablist">
        {(['borrowing', 'lending'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`rounded-lg py-2.5 font-semibold ${tab === t ? 'bg-leaf text-white' : 'text-ink-soft'}`}>
            {t === 'borrowing' ? 'Borrowing' : 'Lending'}
          </button>
        ))}
      </div>
      {loans === null ? <Loading /> : loans.length === 0 ? (
        <Empty title={tab === 'borrowing' ? 'You haven’t borrowed anything yet' : 'Nobody has asked for your things yet'}
          action={<Link to={tab === 'borrowing' ? '/' : '/items/new'} className="key-leaf">{tab === 'borrowing' ? 'Browse items' : 'Lend something'}</Link>} />
      ) : (
        <div className="space-y-8">
          {live.length > 0 && <LoanList title="In progress" loans={live} tab={tab} />}
          {past.length > 0 && <LoanList title="Finished" loans={past} tab={tab} />}
        </div>
      )}
    </>
  )
}

function LoanList({ title, loans, tab }: { title: string; loans: Loan[]; tab: 'borrowing' | 'lending' }) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-bold text-ink-soft">{title}</h2>
      <ul className="space-y-3">
        {loans.map((l) => {
          const other = tab === 'borrowing' ? l.lender : l.borrower
          const overdue = l.status === 'active' && l.due_at && new Date(l.due_at) < new Date()
          return (
            <li key={l.id}>
              <Link to={`/loans/${l.id}`} className="tile flex items-center gap-4 p-3 transition-transform hover:-translate-y-0.5">
                <Photo path={l.item?.photo_paths[0]} alt="" className="h-16 w-16 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{l.item?.title ?? 'Removed item'}</p>
                  <p className="truncate text-sm text-ink-soft">{tab === 'borrowing' ? 'From' : 'To'} {other?.display_name ?? 'a former member'} · {fmtDate(l.start_date)} to {fmtDate(l.end_date)}</p>
                </div>
                <Badge tone={overdue ? 'brick' : l.status === 'disputed' ? 'brick' : ['approved', 'active'].includes(l.status) ? 'leaf' : l.status === 'requested' || l.status === 'returned' ? 'marigold' : 'plain'}>
                  {overdue ? 'Overdue' : LOAN_STATUS_LABEL[l.status]}
                </Badge>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
