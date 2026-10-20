/** Display buffers are disposable; source assets and character geometry never change. */
export const MAX_CHARACTER_PREVIEW_PIXELS = 4_000_000

export function characterRenderSize(width: number, height: number, displayWidth = width, displayHeight = height, zoom = 1, density = 1): number {
  const native = Math.max(width, height)
  if (!(width > 0 && height > 0)) return 1
  const displayScale = Math.min(displayWidth / width, displayHeight / height) * Math.max(1, zoom) * Math.max(1, density)
  // Keep native detail even when the viewport is small. Bound transient memory.
  const scale = Math.min(Math.max(1, displayScale), Math.sqrt(MAX_CHARACTER_PREVIEW_PIXELS / (width * height)))
  return Math.max(1, Math.ceil(native * scale))
}

export function configureCharacterSampling(context: CanvasRenderingContext2D): void {
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
}
