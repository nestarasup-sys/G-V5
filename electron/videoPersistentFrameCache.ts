import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { deflateRaw, inflateRaw } from 'node:zlib'
import { promisify } from 'node:util'

const deflate = promisify(deflateRaw)
const inflate = promisify(inflateRaw)
const HASH = /^[a-f0-9]{64}$/
const HEADER_BYTES = 40
export const VIDEO_RENDERER_CACHE_VERSION = 'g-v5-canvas-v3-sha256'

type IndexEntry = { key: string; bytes: number; rawBytes: number; touchedAt: number }
type Index = { schemaVersion: 1; rendererVersion: string; entries: IndexEntry[] }

const rootQueues = new Map<string, Promise<unknown>>()
const rootIndexes = new Map<string, Index>()
const rootIndexMaps = new Map<string, Map<string, IndexEntry>>()
function cacheIndex(root: string, index: Index): void {
  rootIndexes.set(root, index)
  rootIndexMaps.set(root, new Map(index.entries.map((entry) => [entry.key, entry])))
}

export type PersistentFrameCacheStats = Readonly<{
  hits: number
  misses: number
  writes: number
  evictions: number
  entries: number
  bytes: number
  maxBytes: number
}>

function cacheHash(semanticKey: string): string {
  return createHash('sha256').update(VIDEO_RENDERER_CACHE_VERSION).update('\0').update(semanticKey).digest('hex')
}

/**
 * Persistent L2 cache for immutable RGBA scene frames. Files are compressed,
 * content-addressed by rendererVersion+semantic key and atomically published.
 * No project names, paths or media filenames are stored in the index.
 */
export class VideoPersistentFrameCache {
  private hits = 0
  private misses = 0
  private writes = 0
  private evictions = 0
  private readonly canonicalRoot: string

  constructor(readonly root: string, readonly maxBytes = 512 * 1024 * 1024) {
    this.canonicalRoot = resolve(root)
    if (!resolve(root) || !Number.isSafeInteger(maxBytes) || maxBytes < 64 * 1024 * 1024) {
      throw new Error('Configuração do cache persistente inválida.')
    }
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = rootQueues.get(this.canonicalRoot) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(operation)
    rootQueues.set(this.canonicalRoot, next)
    void next.finally(() => {
      if (rootQueues.get(this.canonicalRoot) === next) rootQueues.delete(this.canonicalRoot)
    }).catch(() => undefined)
    return next
  }
  private indexPath() { return join(this.root, 'index.json') }
  private framePath(hash: string) { return join(this.root, 'frames', `${hash}.bin`) }

  private async readIndex(): Promise<Index> {
    const cached = rootIndexes.get(this.canonicalRoot)
    if (cached) return cached
    try {
      const parsed = JSON.parse(await readFile(this.indexPath(), 'utf8')) as Index
      if (parsed.schemaVersion !== 1 || parsed.rendererVersion !== VIDEO_RENDERER_CACHE_VERSION || !Array.isArray(parsed.entries)
        || parsed.entries.some((e) => !HASH.test(e.key) || !Number.isSafeInteger(e.bytes) || e.bytes < HEADER_BYTES
          || !Number.isSafeInteger(e.rawBytes) || e.rawBytes < 4 || !Number.isFinite(e.touchedAt))) {
        throw new Error('Índice do cache persistente inválido.')
      }
      cacheIndex(this.canonicalRoot, parsed)
      return parsed
    } catch (reason) {
      const empty: Index = { schemaVersion: 1, rendererVersion: VIDEO_RENDERER_CACHE_VERSION, entries: [] }
      if ((reason as NodeJS.ErrnoException).code === 'ENOENT') {
        cacheIndex(this.canonicalRoot, empty)
        return empty
      }
      // Renderer upgrades/corrupt metadata invalidate only cache, never project data.
      await rm(this.root, { recursive: true, force: true }).catch(() => undefined)
      cacheIndex(this.canonicalRoot, empty)
      return empty
    }
  }

  private async writeIndex(index: Index): Promise<void> {
    await mkdir(this.root, { recursive: true })
    const temp = join(this.root, `.index-${randomUUID()}.tmp`)
    await writeFile(temp, `${JSON.stringify(index)}\n`, { flag: 'wx' })
    try {
      await rename(temp, this.indexPath())
    } catch (reason) {
      const code = (reason as NodeJS.ErrnoException).code
      if (code !== 'EEXIST' && code !== 'EPERM') throw reason
      // Windows does not reliably replace an existing destination with rename.
      // This is cache metadata only: if the process dies in this tiny window,
      // the cache safely reopens empty/corrupt and never affects user data.
      await rm(this.indexPath(), { force: true })
      await rename(temp, this.indexPath())
    } finally {
      await rm(temp, { force: true }).catch(() => undefined)
    }
    cacheIndex(this.canonicalRoot, index)
  }

  private async enforceBudget(index: Index): Promise<void> {
    let bytes = index.entries.reduce((sum, entry) => sum + entry.bytes, 0)
    index.entries.sort((a, b) => a.touchedAt - b.touchedAt)
    while (bytes > this.maxBytes && index.entries.length) {
      const oldest = index.entries.shift()!
      bytes -= oldest.bytes
      await rm(this.framePath(oldest.key), { force: true }).catch(() => undefined)
      this.evictions += 1
    }
  }

  has(semanticKey: string, expectedRawBytes: number): boolean {
    if (!semanticKey || !Number.isSafeInteger(expectedRawBytes) || expectedRawBytes < 4) throw new Error('Consulta inválida ao cache persistente.')
    const key = cacheHash(semanticKey)
    const entry = rootIndexMaps.get(this.canonicalRoot)?.get(key)
    return Boolean(entry && entry.rawBytes === expectedRawBytes)
  }

  async get(semanticKey: string, expectedRawBytes: number): Promise<Buffer | undefined> {
    if (!semanticKey || !Number.isSafeInteger(expectedRawBytes) || expectedRawBytes < 4) throw new Error('Consulta inválida ao cache persistente.')
    return this.run(async () => {
      const key = cacheHash(semanticKey)
      const index = await this.readIndex()
      const entry = rootIndexMaps.get(this.canonicalRoot)?.get(key) ?? index.entries.find((candidate) => candidate.key === key)
      if (!entry || entry.rawBytes !== expectedRawBytes) { this.misses += 1; return undefined }
      try {
        const file = await readFile(this.framePath(key))
        if (file.byteLength !== entry.bytes || file.byteLength < HEADER_BYTES || file.subarray(0, 4).toString('ascii') !== 'GV5F') throw new Error('cache frame invalid')
        const rawBytes = file.readUInt32LE(4)
        const checksum = file.subarray(8, 40)
        if (rawBytes !== expectedRawBytes) throw new Error('cache raw size mismatch')
        const pixels = await inflate(file.subarray(HEADER_BYTES))
        if (pixels.byteLength !== rawBytes) throw new Error('cache inflate mismatch')
        const actualChecksum = createHash('sha256').update(pixels).digest()
        if (!actualChecksum.equals(checksum)) throw new Error('cache checksum mismatch')
        // LRU freshness is a performance hint, not correctness metadata.
        // Keep hot touches in the shared in-memory index and persist them on
        // the next normal mutation instead of rewriting index.json per frame.
        entry.touchedAt = Date.now()
        this.hits += 1
        return Buffer.from(pixels)
      } catch {
        index.entries = index.entries.filter((candidate) => candidate.key !== key)
        await rm(this.framePath(key), { force: true }).catch(() => undefined)
        await this.writeIndex(index)
        this.misses += 1
        return undefined
      }
    })
  }

  async set(semanticKey: string, pixels: Buffer): Promise<void> {
    if (!semanticKey || !Buffer.isBuffer(pixels) || pixels.byteLength < 4) throw new Error('Entrada inválida no cache persistente.')
    return this.run(async () => {
      const key = cacheHash(semanticKey)
      const index = await this.readIndex()
      const existing = rootIndexMaps.get(this.canonicalRoot)?.get(key) ?? index.entries.find((candidate) => candidate.key === key)
      if (existing?.rawBytes === pixels.byteLength) { existing.touchedAt = Date.now(); await this.writeIndex(index); return }
      const compressed = await deflate(pixels, { level: 1 })
      const file = Buffer.allocUnsafe(HEADER_BYTES + compressed.byteLength)
      file.write('GV5F', 0, 'ascii')
      file.writeUInt32LE(pixels.byteLength, 4)
      createHash('sha256').update(pixels).digest().copy(file, 8)
      compressed.copy(file, HEADER_BYTES)
      // A single pathological frame may not evict the useful cache.
      if (file.byteLength > Math.floor(this.maxBytes / 4)) return
      await mkdir(join(this.root, 'frames'), { recursive: true })
      const temp = join(this.root, 'frames', `.${key}-${randomUUID()}.tmp`)
      await writeFile(temp, file, { flag: 'wx' })
      try { await rename(temp, this.framePath(key)) } catch (reason) {
        await rm(temp, { force: true }).catch(() => undefined)
        if ((reason as NodeJS.ErrnoException).code !== 'EEXIST') throw reason
      }
      index.entries = index.entries.filter((candidate) => candidate.key !== key)
      const info = await stat(this.framePath(key))
      index.entries.push({ key, bytes: info.size, rawBytes: pixels.byteLength, touchedAt: Date.now() })
      this.writes += 1
      await this.enforceBudget(index)
      await this.writeIndex(index)
    })
  }

  async clear(): Promise<void> {
    await this.run(async () => {
      await rm(this.root, { recursive: true, force: true })
      rootIndexes.delete(this.canonicalRoot)
      rootIndexMaps.delete(this.canonicalRoot)
    })
  }

  async stats(): Promise<PersistentFrameCacheStats> {
    return this.run(async () => {
      const index = await this.readIndex()
      return {
        hits: this.hits, misses: this.misses, writes: this.writes, evictions: this.evictions,
        entries: index.entries.length, bytes: index.entries.reduce((sum, entry) => sum + entry.bytes, 0), maxBytes: this.maxBytes,
      }
    })
  }

  /** Remove orphan files left by interrupted writes without trusting filenames. */
  async repair(): Promise<void> {
    await this.run(async () => {
      const index = await this.readIndex()
      const known = new Set(index.entries.map((entry) => `${entry.key}.bin`))
      const folder = join(this.root, 'frames')
      const names = await readdir(folder).catch(() => [] as string[])
      for (const name of names) if (!known.has(name)) await rm(join(folder, name), { force: true }).catch(() => undefined)
      await this.enforceBudget(index)
      await this.writeIndex(index)
    })
  }
}
