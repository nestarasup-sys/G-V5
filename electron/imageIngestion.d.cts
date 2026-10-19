export const MAX_IMAGE_BYTES: number
export const MAX_IMAGE_PIXELS: number
export function normalizeImageBuffer(input: Buffer | Uint8Array, limits?: { maxBytes?: number; maxPixels?: number }): Promise<{
  bytes: Buffer
  mimeType: 'image/png'
  extension: '.png'
  width: number
  height: number
  channels: number
  bitDepth: 8 | 16
  sourceFormat: string
  sourceBytes: number
  outputBytes: number
}>
