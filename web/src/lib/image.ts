// Re-encodes a photo in the browser before upload:
//  • strips EXIF metadata, including GPS location (privacy: no home coordinates leak)
//  • downsizes to at most 1600px and ~85% JPEG quality (fast on mobile data)
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

export async function preparePhoto(file: File, maxSide = 1600): Promise<Blob> {
  if (!ACCEPTED.includes(file.type) && !file.type.startsWith('image/')) {
    throw new Error('Please choose a photo (JPEG, PNG or WebP)')
  }
  if (file.size > 25 * 1024 * 1024) throw new Error('That photo is too large')

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
    throw new Error('This photo format is not supported on your device')
  })
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not process the photo')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!blob) throw new Error('Could not process the photo')
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error('Photo is still over 5 MB after compression')
  return blob
}
