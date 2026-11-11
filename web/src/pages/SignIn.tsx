import { useState, type FormEvent } from 'react'
import { phoneAuthEnabled, supabase } from '../lib/supabase'
import { emailSchema, otpSchema, phoneSchema } from '../lib/validation'
import { friendlyError } from '../lib/errors'
import { Button, ErrorNote, Field } from '../components/ui'

// Passwordless sign-in with a 6-digit one-time code (email, or SMS when enabled).
// No passwords are stored, so there is nothing to leak or reuse.
export function SignIn() {
  const [method, setMethod] = useState<'email' | 'phone'>('email')
  const [target, setTarget] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function sendCode(e: FormEvent) {
    e.preventDefault()
    setError('')
    const parsed = (method === 'email' ? emailSchema : phoneSchema).safeParse(target)
    if (!parsed.success) { setError(parsed.error.issues[0].message); return }
    setBusy(true)
    const res = method === 'email'
      ? await supabase.auth.signInWithOtp({ email: parsed.data, options: { shouldCreateUser: true } })
      : await supabase.auth.signInWithOtp({ phone: parsed.data })
    setBusy(false)
    if (res.error) setError(friendlyError(res.error))
    else setSentTo(parsed.data)
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    setError('')
    const parsed = otpSchema.safeParse(code)
    if (!parsed.success || !sentTo) { setError(parsed.success ? 'Request a code first' : parsed.error.issues[0].message); return }
    setBusy(true)
    const res = method === 'email'
      ? await supabase.auth.verifyOtp({ email: sentTo, token: parsed.data, type: 'email' })
      : await supabase.auth.verifyOtp({ phone: sentTo, token: parsed.data, type: 'sms' })
    setBusy(false)
    if (res.error) setError(friendlyError(res.error))
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <img src="/icon.svg" alt="" className="h-16 w-16" />
      <h1 className="mt-6 text-4xl font-extrabold leading-[1.05]">Borrow it from the flat next door.</h1>
      <p className="mt-3 text-lg text-ink-soft">Neighborly lets verified residents of your society lend and borrow things, with photo proof at every handover.</p>

      <div className="tile mt-8 p-5">
        {!sentTo ? (
          <form onSubmit={sendCode} className="space-y-4" noValidate>
            {phoneAuthEnabled && (
              <div role="tablist" className="grid grid-cols-2 gap-2 rounded-xl bg-ground p-1">
                {(['email', 'phone'] as const).map((m) => (
                  <button key={m} type="button" role="tab" aria-selected={method === m}
                    onClick={() => { setMethod(m); setTarget(''); setError('') }}
                    className={`rounded-lg py-2 font-semibold ${method === m ? 'bg-white shadow-tile' : 'text-ink-soft'}`}>
                    {m === 'email' ? 'Email' : 'Mobile'}
                  </button>
                ))}
              </div>
            )}
            {method === 'email'
              ? <Field label="Email address" type="email" autoComplete="email" inputMode="email" value={target} onChange={(e) => setTarget(e.target.value)} required />
              : <Field label="Mobile number" type="tel" autoComplete="tel" inputMode="tel" placeholder="+919876543210" value={target} onChange={(e) => setTarget(e.target.value)} required />}
            <ErrorNote>{error}</ErrorNote>
            <Button type="submit" busy={busy} className="w-full">Send me a code</Button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-4" noValidate>
            <p className="text-ink-soft">
              We sent a message to <strong className="text-ink">{sentTo}</strong>.{' '}
              {method === 'email'
                ? 'Open it on this device and tap the sign-in link. If it shows a 6-digit code instead, enter it here.'
                : 'Enter the 6-digit code from the SMS.'}
            </p>
            <Field label="Code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="field text-center font-display text-2xl tracking-[0.4em]" required />
            <ErrorNote>{error}</ErrorNote>
            <Button type="submit" busy={busy} className="w-full">Sign in</Button>
            <button type="button" className="w-full py-2 text-sm font-semibold text-leaf" onClick={() => { setSentTo(null); setCode('') }}>
              Use a different {method === 'email' ? 'email' : 'number'}
            </button>
          </form>
        )}
      </div>
      <p className="mt-6 text-sm text-ink-soft">
        By continuing you agree to the <a className="font-semibold text-leaf underline" href="/terms.html">Terms</a> and <a className="font-semibold text-leaf underline" href="/privacy.html">Privacy policy</a>.
      </p>
    </main>
  )
}
