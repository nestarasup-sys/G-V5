const maskCache = new Map<string, Promise<string>>()
const MAX_CACHED_MASKS = 48

/** Builds an alpha mask from the light inner eye area, leaving its dark outline outside the mask. */
export function eyeInteriorMask(dataUrl: string): Promise<string> {
  const cached = maskCache.get(dataUrl)
  if (cached) return cached

  const pending = (async () => {
    const response = await fetch(dataUrl)
    const bitmap = await createImageBitmap(await response.blob())
    try {
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return dataUrl
      context.drawImage(bitmap, 0, 0)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
      const values = pixels.data

      for (let index = 0; index < values.length; index += 4) {
        const sourceAlpha = values[index + 3] / 255
        const luminance = values[index] * 0.2126 + values[index + 1] * 0.7152 + values[index + 2] * 0.0722
        // The dark contour and its antialiasing stay transparent; the light sclera stays opaque.
        const coverage = Math.max(0, Math.min(1, (luminance - 145) / 55))
        const alpha = Math.round(sourceAlpha * coverage * 255)
        values[index] = 255
        values[index + 1] = 255
        values[index + 2] = 255
        values[index + 3] = alpha
      }

      context.putImageData(pixels, 0, 0)
      return canvas.toDataURL('image/png')
    } finally {
      bitmap.close()
    }
  })().catch(() => dataUrl)

  maskCache.set(dataUrl, pending)
  while (maskCache.size > MAX_CACHED_MASKS) {
    const oldestKey = maskCache.keys().next().value
    if (oldestKey === undefined) break
    maskCache.delete(oldestKey)
  }
  return pending
}
