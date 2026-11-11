import { createContext, useCallback, useContext, useEffect, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { supabase } from '../lib/supabase'
import { trustBand } from '../lib/format'

type Tone = 'leaf' | 'marigold' | 'brick' | 'plain'

export function Button({ tone = 'leaf', busy, children, className = '', ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; busy?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || busy} aria-busy={busy || undefined} className={`key-${tone} ${className}`}>
      {busy && <Spinner small />}
      {children}
    </button>
  )
}

export function Spinner({ small }: { small?: boolean }) {
  return <span aria-hidden className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${small ? 'h-4 w-4' : 'h-6 w-6'}`} />
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return <div role="status" className="flex items-center justify-center gap-3 py-16 text-ink-soft"><Spinner /> {label}…</div>
}

export function Field({ label, error, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <input id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined} className="field" {...rest} />
      {hint && !error && <p id={`${id}-h`} className="mt-1 text-sm text-ink-soft">{hint}</p>}
      {error && <p id={`${id}-e`} className="mt-1 text-sm font-medium text-brick">{error}</p>}
    </div>
  )
}

export function TextArea({ label, error, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string }) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <textarea id={id} aria-invalid={!!error} className="field min-h-[96px]" {...rest} />
      {error && <p className="mt-1 text-sm font-medium text-brick">{error}</p>}
    </div>
  )
}

export function Select({ label, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <select id={id} className="field appearance-none" {...rest}>{children}</select>
    </div>
  )
}

const badgeTone: Record<Tone, string> = {
  leaf: 'bg-leaf-tint text-leaf-edge border-leaf/30',
  marigold: 'bg-marigold-tint text-[#7A5206] border-marigold/40',
  brick: 'bg-brick-tint text-brick-edge border-brick/30',
  plain: 'bg-ground text-ink-soft border-line',
}
export function Badge({ tone = 'plain', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badgeTone[tone]}`}>{children}</span>
}

export function Trust({ score }: { score: number }) {
  const b = trustBand(score)
  return <Badge tone={b.tone}><span aria-hidden>●</span> {score} · {b.label}</Badge>
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="tile p-8 text-center">
      <h2 className="text-xl font-bold">{title}</h2>
      {children && <p className="mx-auto mt-2 max-w-sm text-ink-soft">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null
  return <p role="alert" className="rounded-xl border-2 border-brick/30 bg-brick-tint px-4 py-3 text-sm font-medium text-brick-edge">{children}</p>
}

// ---------------------------------------------------------------------------
// Private photos: fetched as signed URLs that expire after 10 minutes.
// ---------------------------------------------------------------------------
const urlCache = new Map<string, { url: string; exp: number }>()

export function usePhotoUrl(bucket: 'item-photos' | 'handover-photos', path?: string | null) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!path) { setUrl(null); return }
    const key = `${bucket}/${path}`
    const hit = urlCache.get(key)
    if (hit && hit.exp > Date.now()) { setUrl(hit.url); return }
    let alive = true
    supabase.storage.from(bucket).createSignedUrl(path, 600).then(({ data }) => {
      if (!alive || !data) return
      urlCache.set(key, { url: data.signedUrl, exp: Date.now() + 540_000 })
      setUrl(data.signedUrl)
    })
    return () => { alive = false }
  }, [bucket, path])
  return url
}

export function Photo({ bucket = 'item-photos', path, alt, className = '' }:
  { bucket?: 'item-photos' | 'handover-photos'; path?: string | null; alt: string; className?: string }) {
  const url = usePhotoUrl(bucket, path)
  if (!path) {
    return (
      <div className={`flex items-center justify-center bg-leaf-tint text-leaf ${className}`} aria-label={alt} role="img">
        <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M3 9.5 12 4l9 5.5V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" /><path d="M9 20v-6h6v6" />
        </svg>
      </div>
    )
  }
  return url
    ? <img src={url} alt={alt} loading="lazy" className={`object-cover ${className}`} referrerPolicy="no-referrer" />
    : <div className={`animate-pulse bg-line/50 ${className}`} aria-label={alt} role="img" />
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
type Toast = { id: number; text: string; tone: 'leaf' | 'brick' }
const ToastCtx = createContext<(text: string, tone?: 'leaf' | 'brick') => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, tone: 'leaf' | 'brick' = 'leaf') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto rounded-2xl border-2 px-4 py-3 font-semibold shadow-tile-lg ${t.tone === 'leaf' ? 'border-leaf-edge bg-leaf text-white' : 'border-brick-edge bg-brick text-white'}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)
