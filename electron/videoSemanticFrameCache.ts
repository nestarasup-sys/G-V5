export type VideoSemanticFrameCacheStats = Readonly<{
  hits: number
  misses: number
  evictions: number
  entries: number
  bytes: number
  maxBytes: number
}>

/**
 * Job-local semantic frame cache. Keys are only meaningful inside one immutable
 * VideoSceneProgram; callers must never share an instance across snapshots.
 */
export class VideoSemanticFrameCache {
  private readonly entries = new Map<string, Buffer>()
  private bytes = 0
  private hits = 0
  private misses = 0
  private evictions = 0

  constructor(readonly maxBytes = 96 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 8 * 1024 * 1024) throw new Error('Orçamento do cache semântico inválido.')
  }

  get(key: string): Buffer | undefined {
    const value = this.entries.get(key)
    if (!value) {
      this.misses += 1
      return undefined
    }
    this.entries.delete(key)
    this.entries.set(key, value)
    this.hits += 1
    return value
  }

  set(key: string, pixels: Buffer): void {
    if (!key || !Buffer.isBuffer(pixels) || pixels.byteLength < 4) throw new Error('Entrada inválida no cache semântico.')
    if (pixels.byteLength > this.maxBytes) return
    const previous = this.entries.get(key)
    if (previous) {
      this.entries.delete(key)
      this.bytes -= previous.byteLength
    }
    this.entries.set(key, pixels)
    this.bytes += pixels.byteLength
    while (this.bytes > this.maxBytes && this.entries.size > 1) {
      const oldestKey = this.entries.keys().next().value as string | undefined
      if (!oldestKey) break
      const oldest = this.entries.get(oldestKey)
      this.entries.delete(oldestKey)
      if (oldest) this.bytes -= oldest.byteLength
      this.evictions += 1
    }
  }

  clear(): void {
    this.entries.clear()
    this.bytes = 0
  }

  stats(): VideoSemanticFrameCacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      entries: this.entries.size,
      bytes: this.bytes,
      maxBytes: this.maxBytes,
    }
  }
}
