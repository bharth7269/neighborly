import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { Message } from '../lib/types'
import { messageSchema } from '../lib/validation'
import { friendlyError } from '../lib/errors'
import { fmtDateTime } from '../lib/format'
import { Button, ErrorNote } from './ui'

export function Chat({ loanId, userId, canSend }: { loanId: string; userId: string; canSend: boolean }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const end = useRef<HTMLLIElement>(null)

  useEffect(() => {
    supabase.from('messages').select('id, loan_id, sender_id, body, created_at')
      .eq('loan_id', loanId).order('created_at').limit(300)
      .then(({ data }) => setMessages((data ?? []) as Message[]))
    const ch = supabase.channel(`chat-${loanId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `loan_id=eq.${loanId}` },
        (payload) => setMessages((m) => m.some((x) => x.id === payload.new.id) ? m : [...m, payload.new as Message]))
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [loanId])

  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [messages.length])

  async function send(e: FormEvent) {
    e.preventDefault()
    const p = messageSchema.safeParse(text)
    if (!p.success) return
    setBusy(true); setError('')
    const { data, error } = await supabase.from('messages').insert({ loan_id: loanId, body: p.data })
      .select('id, loan_id, sender_id, body, created_at').single()
    setBusy(false)
    if (error) { setError(friendlyError(error)); return }
    setText('')
    setMessages((m) => m.some((x) => x.id === data.id) ? m : [...m, data as Message])
  }

  return (
    <section className="tile flex flex-col p-5" aria-labelledby="chat-h">
      <h2 id="chat-h" className="text-xl font-bold">Chat</h2>
      <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto" aria-live="polite">
        {messages.length === 0 && <li className="text-sm text-ink-soft">Agree a time and place for the handover. Keep payments and personal numbers out of chat.</li>}
        {messages.map((m) => {
          const mine = m.sender_id === userId
          return (
            <li key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl border-2 px-3.5 py-2 ${mine ? 'border-leaf-edge bg-leaf text-white' : 'border-line bg-ground'}`}>
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <p className={`mt-0.5 text-[11px] ${mine ? 'text-white/80' : 'text-ink-soft'}`}>{fmtDateTime(m.created_at)}</p>
              </div>
            </li>
          )
        })}
        <li ref={end} aria-hidden />
      </ul>
      {canSend ? (
        <form onSubmit={send} className="mt-3 flex gap-2">
          <label htmlFor="chat-input" className="sr-only">Message</label>
          <input id="chat-input" className="field" maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message" autoComplete="off" />
          <Button type="submit" busy={busy} disabled={!text.trim()}>Send</Button>
        </form>
      ) : <p className="mt-3 text-sm text-ink-soft">This conversation is closed.</p>}
      <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>
    </section>
  )
}
