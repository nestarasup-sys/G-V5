/**
 * Laboratory-only deterministic BGRA fixture producer. This is not the V5
 * artwork compositor and must never be wired to the user-facing export action.
 *
 * It proves absolute-frame sampling and byte-level writer contracts without
 * private assets, a driver-specific encoder, or a running React preview.
 */
export function renderSyntheticBgraFrame(frame: number, width: number, height: number): Buffer {
  if (!Number.isSafeInteger(frame) || frame < 0
    || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 1 || height < 1 || width * height * 4 > 64 * 1024 * 1024) {
    throw new RangeError('Fixture BGRA: frame ou dimensões inválidas.')
  }
  const data = Buffer.allocUnsafe(width * height * 4)
  const boxWidth = Math.max(1, Math.floor(width / 4))
  const boxHeight = Math.max(1, Math.floor(height / 4))
  const boxX = frame % Math.max(1, width - boxWidth + 1)
  const boxY = Math.floor(frame / 3) % Math.max(1, height - boxHeight + 1)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const inBox = x >= boxX && x < boxX + boxWidth && y >= boxY && y < boxY + boxHeight
      data[offset] = inBox ? 0 : (x + frame * 7) & 255 // B
      data[offset + 1] = inBox ? 240 : (y + frame * 11) & 255 // G
      data[offset + 2] = inBox ? 255 : (x + y + frame * 13) & 255 // R
      data[offset + 3] = 255 // A
    }
  }
  return data
}

export interface SyntheticFrameSink {
  writeFrame(frame: Buffer): Promise<void>
}

/** Serialized full-frame BGRA producer with no browser or preview clock. */
export async function feedSyntheticFrames(
  source: { startFrame: number; endFrameExclusive: number; width: number; height: number },
  sink: SyntheticFrameSink,
  hooks: { cancelled?: () => boolean; onFrameWritten?: (completed: number, total: number) => void } = {},
): Promise<{ frames: number; bytes: number }> {
  if (!Number.isSafeInteger(source.startFrame) || !Number.isSafeInteger(source.endFrameExclusive)
    || source.startFrame < 0 || source.endFrameExclusive <= source.startFrame) {
    throw new RangeError('Fixture BGRA: intervalo de frames inválido.')
  }
  const total = source.endFrameExclusive - source.startFrame
  let bytes = 0
  for (let frame = source.startFrame; frame < source.endFrameExclusive; frame += 1) {
    if (hooks.cancelled?.()) throw new Error('Fixture BGRA cancelada.')
    const buffer = renderSyntheticBgraFrame(frame, source.width, source.height)
    await sink.writeFrame(buffer)
    bytes += buffer.length
    hooks.onFrameWritten?.(frame - source.startFrame + 1, total)
  }
  return { frames: total, bytes }
}
