import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { LOAN_STATUS_LABEL, type Dispute, type HandoverPhoto, type Loan } from '../lib/types'
import { friendlyError } from '../lib/errors'
import { disputeSchema } from '../lib/validation'
import { fmtDate, fmtDateTime, fmtInr } from '../lib/format'
import { useSession } from '../state/session'
import { LOAN_COLUMNS } from './Loans'
import { Chat } from '../components/Chat'
import { Handover, PhotoTimeline } from '../components/Handover'
import { Badge, Button, Empty, ErrorNote, Field, Loading, Photo, Select, TextArea, Trust, useToast } from '../components/ui'

export function LoanDetail() {
  const { id } = useParams()
  const { userId } = useSession()
  const toast = useToast()
  const [loan, setLoan] = useState<Loan | null | undefined>(undefined)
  const [photos, setPhotos] = useState<HandoverPhoto[]>([])
  const [dispute, setDispute] = useState<Dispute | null>(null)
  const [contact, setContact] = useState<{ display_name: string; unit_label: string } | null>(null)
  const [rated, setRated] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('loans').select(LOAN_COLUMNS).eq('id', id!).maybeSingle()
    const l = (data as unknown as Loan) ?? null
    setLoan(l)
    if (!l) return
    const [p, d, r] = await Promise.all([
      supabase.from('handover_photos').select('id, loan_id, stage, taken_by, storage_path, sha256, server_time').eq('loan_id', l.id).order('server_time'),
      supabase.from('disputes').select('*').eq('loan_id', l.id).maybeSingle(),
      supabase.from('ratings').select('loan_id').eq('loan_id', l.id).eq('rater_id', userId!).maybeSingle(),
    ])
    setPhotos((p.data ?? []) as HandoverPhoto[])
    setDispute((d.data as Dispute) ?? null)
    setRated(!!r.data)
    if (['approved', 'active', 'returned', 'disputed'].includes(l.status) && userId && [l.lender_id, l.borrower_id].includes(userId)) {
      const c = await supabase.rpc('get_loan_contact', { p_loan: l.id })
      setContact((c.data as { display_name: string; unit_label: string }[] | null)?.[0] ?? null)
    }
  }, [id, userId])

  useEffect(() => {
    void load()
    const ch = supabase.channel(`loan-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'loans', filter: `id=eq.${id}` }, () => void load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'handover_photos', filter: `loan_id=eq.${id}` }, () => void load())
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [id, load])

  async function call(name: string, args: Record<string, unknown>, done: string) {
    setBusy(name); setError('')
    const { error } = await supabase.rpc(name, args)
    setBusy('')
    if (error) { setError(friendlyError(error)); return }
    toast(done)
    await load()
  }

  if (loan === undefined) return <Loading />
  if (loan === null) return <Empty title="Loan not found">It may belong to someone else.</Empty>

  const isLender = loan.lender_id === userId
  const isBorrower = loan.borrower_id === userId
  const isParty = isLender || isBorrower
  const other = isLender ? loan.borrower : loan.lender
  const overdue = loan.status === 'active' && loan.due_at && new Date(loan.due_at) < new Date()
  const returnWindowOpen = loan.status === 'returned' && loan.returned_at && Date.now() - new Date(loan.returned_at).getTime() < 24 * 3600_000

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <div className="space-y-5">
        <header className="tile flex gap-4 p-4">
          <Photo path={loan.item?.photo_paths[0]} alt="" className="h-20 w-20 shrink-0 rounded-xl" />
          <div className="min-w-0">
            <Link to={`/items/${loan.item_id}`} className="text-xl font-bold hover:underline">{loan.item?.title}</Link>
            <p className="text-sm text-ink-soft">{fmtDate(loan.start_date)} to {fmtDate(loan.end_date)}{loan.deposit_inr > 0 && ` · ${fmtInr(loan.deposit_inr)} deposit`}</p>
            <div className="mt-2"><Badge tone={overdue || loan.status === 'disputed' ? 'brick' : 'leaf'}>{overdue ? 'Overdue' : LOAN_STATUS_LABEL[loan.status]}</Badge></div>
          </div>
        </header>

        {isParty && other && (
          <div className="tile flex items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm text-ink-soft">{isLender ? 'Borrower' : 'Owner'}</p>
              <p className="font-semibold">{other.display_name}</p>
              {contact && <p className="text-sm">Meet at <strong>{contact.unit_label}</strong></p>}
            </div>
            <Trust score={other.trust_score} />
          </div>
        )}

        {loan.message && <blockquote className="rounded-xl border-l-0 bg-white/60 p-4 text-ink-soft">“{loan.message}”</blockquote>}

        <ErrorNote>{error}</ErrorNote>

        {isLender && loan.status === 'requested' && (
          <div className="flex gap-3">
            <Button busy={busy === 'respond_loan'} onClick={() => void call('respond_loan', { p_loan: loan.id, p_approve: true }, 'Approved')}>Approve</Button>
            <Button tone="plain" onClick={() => void call('respond_loan', { p_loan: loan.id, p_approve: false }, 'Declined')}>Decline</Button>
          </div>
        )}

        {isParty && loan.status === 'approved' && (
          <Handover loan={loan} stage="pickup" isLender={isLender} photos={photos.filter((p) => p.stage === 'pickup')} onDone={() => void load()} />
        )}
        {isParty && loan.status === 'active' && (
          <>
            <p className="rounded-xl bg-white p-4">{overdue ? <strong className="text-brick">This was due {fmtDateTime(loan.due_at!)}. Please return it today.</strong> : <>Due back by <strong>{fmtDateTime(loan.due_at!)}</strong>.</>}</p>
            <Handover loan={loan} stage="return" isLender={isLender} photos={photos.filter((p) => p.stage === 'return')} onDone={() => void load()} />
          </>
        )}

        {isLender && loan.status === 'returned' && (
          <div className="tile space-y-3 p-5">
            <h2 className="text-xl font-bold">Is everything as it was?</h2>
            <p className="text-ink-soft">Compare with the pickup photos below. If you do nothing, the return is accepted automatically after 24 hours.</p>
            <Button busy={busy === 'accept_return'} onClick={() => void call('accept_return', { p_loan: loan.id }, 'Return accepted')}>Accept return</Button>
          </div>
        )}

        {isParty && (loan.status === 'active' || returnWindowOpen) && <RaiseDispute onSubmit={(reason) => call('raise_dispute', { p_loan: loan.id, p_reason: reason }, 'Reported to moderators')} />}

        {dispute && <DisputePanel loan={loan} dispute={dispute} isParty={isParty} onResolve={(args) => call('resolve_dispute', { p_loan: loan.id, ...args }, 'Dispute resolved')} />}

        {isParty && ['requested', 'approved'].includes(loan.status) && (
          <Button tone="plain" onClick={() => { if (window.confirm('Cancel this loan?')) void call('cancel_loan', { p_loan: loan.id }, 'Cancelled') }}>Cancel loan</Button>
        )}

        {isParty && ['completed', 'resolved'].includes(loan.status) && !rated && (
          <RateForm onSubmit={(stars, comment) => call('rate_neighbour', { p_loan: loan.id, p_stars: stars, p_comment: comment }, 'Thanks for rating')} />
        )}
      </div>

      <div className="space-y-5">
        {isParty && userId && <Chat loanId={loan.id} userId={userId} canSend={['requested', 'approved', 'active', 'returned', 'disputed'].includes(loan.status)} />}
        <PhotoTimeline loan={loan} photos={photos} />
      </div>
    </div>
  )
}

function RaiseDispute({ onSubmit }: { onSubmit: (reason: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  if (!open) return <button className="text-sm font-semibold text-brick underline" onClick={() => setOpen(true)}>Report a problem</button>
  return (
    <form className="tile space-y-3 p-5" onSubmit={(e) => {
      e.preventDefault()
      const p = disputeSchema.safeParse(reason)
      if (!p.success) { setErr(p.error.issues[0].message); return }
      void onSubmit(p.data)
    }}>
      <h2 className="text-xl font-bold">Report a problem</h2>
      <p className="text-sm text-ink-soft">A circle moderator will compare the pickup and return photos and decide. Both of you will be told the outcome.</p>
      <TextArea label="What happened?" value={reason} onChange={(e) => setReason(e.target.value)} error={err} maxLength={1000} />
      <div className="flex gap-3"><Button tone="brick" type="submit">Send to moderators</Button><Button tone="plain" type="button" onClick={() => setOpen(false)}>Cancel</Button></div>
    </form>
  )
}

function DisputePanel({ loan, dispute, isParty, onResolve }:
  { loan: Loan; dispute: Dispute; isParty: boolean; onResolve: (a: { p_outcome: string; p_notes: string; p_deposit_to_lender: number }) => Promise<void> }) {
  const [outcome, setOutcome] = useState('no_fault')
  const [notes, setNotes] = useState('')
  const [deposit, setDeposit] = useState('0')
  const label: Record<string, string> = { no_fault: 'No one at fault', borrower_at_fault: 'Borrower at fault', lender_at_fault: 'Owner at fault' }
  return (
    <section className="tile space-y-3 border-brick/40 p-5">
      <h2 className="text-xl font-bold">{dispute.status === 'open' ? 'Problem reported' : 'Moderator decision'}</h2>
      <p className="whitespace-pre-line text-ink-soft">“{dispute.reason}”</p>
      {dispute.status === 'resolved' ? (
        <p><strong>{label[dispute.outcome ?? 'no_fault']}.</strong> {dispute.notes} {loan.deposit_inr > 0 && <>Deposit to owner: {fmtInr(dispute.deposit_to_lender_inr ?? 0)}.</>}</p>
      ) : isParty ? (
        <p className="text-sm">A moderator is reviewing the photo timeline.</p>
      ) : (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void onResolve({ p_outcome: outcome, p_notes: notes.trim(), p_deposit_to_lender: Number(deposit) || 0 }) }}>
          <Select label="Decision" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {Object.entries(label).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          {loan.deposit_inr > 0 && <Field label={`Deposit kept by owner (max ${fmtInr(loan.deposit_inr)})`} type="number" min={0} max={loan.deposit_inr} value={deposit} onChange={(e) => setDeposit(e.target.value)} />}
          <TextArea label="Reason for decision" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          <Button type="submit">Record decision</Button>
        </form>
      )}
    </section>
  )
}

function RateForm({ onSubmit }: { onSubmit: (stars: number, comment: string) => Promise<void> }) {
  const [stars, setStars] = useState(0)
  const [comment, setComment] = useState('')
  return (
    <form className="tile space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); if (stars) void onSubmit(stars, comment.trim()) }}>
      <h2 className="text-xl font-bold">How did it go?</h2>
      <fieldset className="flex gap-2">
        <legend className="sr-only">Rating</legend>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={`flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border-2 text-xl ${n <= stars ? 'border-marigold-edge bg-marigold' : 'border-line bg-white'}`}>
            <input type="radio" name="stars" value={n} className="sr-only" onChange={() => setStars(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`} />
            <span aria-hidden>★</span>
          </label>
        ))}
      </fieldset>
      <TextArea label="Comment (optional)" maxLength={300} value={comment} onChange={(e) => setComment(e.target.value)} />
      <Button type="submit" disabled={!stars}>Submit rating</Button>
    </form>
  )
}
