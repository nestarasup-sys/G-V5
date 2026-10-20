export type PixelRect = Readonly<{ x: number; y: number; width: number; height: number }>

export type PixelDiffMetrics = Readonly<{
  pixels: number
  changedPixels: number
  changedPixelRatio: number
  meanAbsoluteError: number
  p95AbsoluteError: number
  maxChannelError: number
  /** @deprecated Use maxChannelError; retained while diagnostics migrate. */
  maxAbsoluteError: number
  differenceBounds: PixelRect | null
}>

export function comparePixelBuffers(
  left: Uint8Array,
  right: Uint8Array,
  width: number,
  height: number,
  roi: PixelRect = { x: 0, y: 0, width, height },
  changedPixelChannelTolerance = 0,
): PixelDiffMetrics {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new Error('Dimensões do oracle inválidas.')
  if (!Number.isSafeInteger(changedPixelChannelTolerance) || changedPixelChannelTolerance < 0 || changedPixelChannelTolerance > 255) throw new Error('Tolerância do oracle inválida.')
  const expected = width * height * 4
  if (left.byteLength !== expected || right.byteLength !== expected) throw new Error('Buffers do oracle não possuem o tamanho RGBA/BGRA esperado.')
  const x0 = Math.max(0, Math.min(width, Math.floor(roi.x)))
  const y0 = Math.max(0, Math.min(height, Math.floor(roi.y)))
  const x1 = Math.max(x0, Math.min(width, Math.ceil(roi.x + roi.width)))
  const y1 = Math.max(y0, Math.min(height, Math.ceil(roi.y + roi.height)))
  if (x1 <= x0 || y1 <= y0) throw new Error('ROI do oracle está vazio.')

  let pixels = 0
  let changedPixels = 0
  let total = 0
  let max = 0
  let minX = width, minY = height, maxX = -1, maxY = -1
  const histogram = new Uint32Array(256)
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * width + x) * 4
      let changed = false
      for (let channel = 0; channel < 3; channel += 1) {
        const diff = Math.abs(left[offset + channel] - right[offset + channel])
        histogram[diff] += 1
        total += diff
        if (diff > max) max = diff
        if (diff > changedPixelChannelTolerance) changed = true
      }
      if (changed) {
        changedPixels += 1
        minX = Math.min(minX, x); minY = Math.min(minY, y)
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
      }
      pixels += 1
    }
  }

  const samples = pixels * 3
  const target = Math.ceil(samples * 0.95)
  let seen = 0
  let p95 = 0
  for (let value = 0; value < histogram.length; value += 1) {
    seen += histogram[value]
    if (seen >= target) { p95 = value; break }
  }
  return {
    pixels,
    changedPixels,
    changedPixelRatio: changedPixels / pixels,
    meanAbsoluteError: total / samples,
    p95AbsoluteError: p95,
    maxChannelError: max,
    maxAbsoluteError: max,
    differenceBounds: changedPixels ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
  }
}
