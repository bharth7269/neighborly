import { useEffect, useId, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'

// Camera QR scanner. Stops the camera as soon as a code is read or the panel closes.
export function Scanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const id = useId().replace(/:/g, '')
  const [error, setError] = useState('')
  const done = useRef(false)

  useEffect(() => {
    const scanner = new Html5Qrcode(`qr-${id}`, { verbose: false })
    let started = false
    scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 230, height: 230 } }, (text) => {
      if (done.current) return
      done.current = true
      onResult(text)
    }, () => {}).then(() => { started = true }).catch(() => {
      setError('Camera not available. Allow camera access in your browser settings, or type the code instead.')
    })
    return () => {
      if (started) void scanner.stop().then(() => scanner.clear()).catch(() => {})
    }
  }, [id, onResult])

  return (
    <div className="space-y-3">
      <div id={`qr-${id}`} className="overflow-hidden rounded-xl border-2 border-line bg-ink" />
      {error && <p role="alert" className="text-sm font-medium text-brick">{error}</p>}
      <button type="button" onClick={onClose} className="key-plain w-full">Close camera</button>
    </div>
  )
}
