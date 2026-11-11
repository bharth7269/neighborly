const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

export const fmtDate = (d: string) => dateFmt.format(new Date(d.length === 10 ? d + 'T00:00:00' : d))
export const fmtDateTime = (d: string) => dateTimeFmt.format(new Date(d))
export const fmtInr = (n: number) => inr.format(n)

export function relative(d: string): string {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return fmtDate(d)
}

/** Today's date in India as YYYY-MM-DD. */
export function todayIST(offsetDays = 0): string {
  const now = new Date(Date.now() + offsetDays * 86400000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now)
}

export function trustBand(score: number): { label: string; tone: 'leaf' | 'marigold' | 'brick' } {
  if (score >= 70) return { label: 'Trusted', tone: 'leaf' }
  if (score >= 40) return { label: 'Building trust', tone: 'marigold' }
  return { label: 'Low trust', tone: 'brick' }
}
