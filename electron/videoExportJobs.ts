import { createReadStream } from 'node:fs'
import { mkdir, lstat, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, join, relative, resolve, sep } from 'node:path'

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const shaPattern = /^[a-f0-9]{64}$/
const chunkSize = 600

export type VideoExportChunk = { index: number; startFrame: number; endFrame: number; filename: string; sizeBytes: number; sha256: string }
export type VideoExportManifest = {
  schemaVersion: 1
  jobId: string
  studioId: string
  snapshotSha256: string
  mediaSha256: string[]
  durationFrames: number
  frameRate: 60
  width: 1920
  height: 1080
  chunkFrames: 600
  createdAt: string
  updatedAt: string
  chunks: VideoExportChunk[]
}

export class VideoExportJobStore {
  readonly root: string
  constructor(root: string) { this.root = resolve(root) }

  private pathFor(jobId: string): string {
    if (!idPattern.test(jobId)) throw new Error('Job de exportação inválido.')
    return join(this.root, jobId)
  }

  private async hashFile(path: string): Promise<string> {
    const hash = createHash('sha256')
    await new Promise<void>((resolvePromise, reject) => {
      const stream = createReadStream(path)
      stream.on('data', (chunk) => hash.update(chunk))
      stream.once('error', reject)
      stream.once('end', resolvePromise)
    })
    return hash.digest('hex')
  }

  private expectedRange(manifest: VideoExportManifest, index: number): { startFrame: number; endFrame: number } {
    if (!Number.isSafeInteger(index) || index < 0) throw new Error('Índice de trecho inválido.')
    const startFrame = index * chunkSize
    if (startFrame >= manifest.durationFrames) throw new Error('Trecho fora da duração do projeto.')
    return { startFrame, endFrame: Math.min(manifest.durationFrames, startFrame + chunkSize) }
  }

  private async writeManifest(folder: string, manifest: VideoExportManifest): Promise<void> {
    const path = join(folder, 'manifest.json')
    const temp = join(folder, `.manifest-${randomUUID()}.tmp`)
    await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
    await rename(temp, path)
  }

  async create(input: { jobId: string; studioId: string; snapshotSha256: string; mediaSha256: string[]; durationFrames: number }): Promise<VideoExportManifest> {
    const folder = this.pathFor(input.jobId)
    if (!idPattern.test(input.studioId) || !shaPattern.test(input.snapshotSha256) || !input.mediaSha256.every((hash) => shaPattern.test(hash))
      || !Number.isSafeInteger(input.durationFrames) || input.durationFrames < 1 || input.durationFrames > 60 * 60 * 24 * 60) throw new Error('Snapshot ou parâmetros do job inválidos.')
    await mkdir(this.root, { recursive: true })
    await mkdir(folder)
    const now = new Date().toISOString()
    const manifest: VideoExportManifest = {
      schemaVersion: 1, jobId: input.jobId, studioId: input.studioId, snapshotSha256: input.snapshotSha256,
      mediaSha256: [...new Set(input.mediaSha256)].sort(), durationFrames: input.durationFrames,
      frameRate: 60, width: 1920, height: 1080, chunkFrames: chunkSize, createdAt: now, updatedAt: now, chunks: []
    }
    await this.writeManifest(folder, manifest)
    return manifest
  }

  async reopen(jobId: string, expected: { studioId: string; snapshotSha256: string; mediaSha256: string[]; durationFrames: number }): Promise<{ manifest: VideoExportManifest; nextChunkIndex: number }> {
    const folder = this.pathFor(jobId)
    const info = await lstat(folder)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Pasta do job inválida.')
    const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8')) as VideoExportManifest
    const expectedMedia = [...new Set(expected.mediaSha256)].sort()
    if (manifest.schemaVersion !== 1 || manifest.jobId !== jobId || manifest.studioId !== expected.studioId
      || manifest.snapshotSha256 !== expected.snapshotSha256 || JSON.stringify(manifest.mediaSha256) !== JSON.stringify(expectedMedia)
      || manifest.durationFrames !== expected.durationFrames || manifest.frameRate !== 60 || manifest.width !== 1920 || manifest.height !== 1080
      || manifest.chunkFrames !== chunkSize || !Array.isArray(manifest.chunks)) throw new Error('O projeto ou a mídia mudou; este job não pode ser retomado com o snapshot atual.')
    const validChunks: VideoExportChunk[] = []
    for (const chunk of manifest.chunks) {
      const expectedRange = this.expectedRange(manifest, chunk.index)
      const expectedName = `chunk-${String(chunk.index).padStart(6, '0')}.mp4`
      if (chunk.startFrame !== expectedRange.startFrame || chunk.endFrame !== expectedRange.endFrame || chunk.filename !== expectedName
        || basename(chunk.filename) !== chunk.filename || !shaPattern.test(chunk.sha256) || !Number.isSafeInteger(chunk.sizeBytes) || chunk.sizeBytes < 1) continue
      const chunkPath = join(folder, chunk.filename)
      const chunkInfo = await lstat(chunkPath).catch(() => null)
      if (!chunkInfo?.isFile() || chunkInfo.isSymbolicLink() || chunkInfo.size !== chunk.sizeBytes || await this.hashFile(chunkPath) !== chunk.sha256) continue
      validChunks.push(chunk)
    }
    validChunks.sort((left, right) => left.index - right.index)
    const contiguous: VideoExportChunk[] = []
    for (const chunk of validChunks) {
      if (chunk.index !== contiguous.length) break
      contiguous.push(chunk)
    }
    const repaired = { ...manifest, chunks: contiguous }
    if (contiguous.length !== manifest.chunks.length) {
      repaired.updatedAt = new Date().toISOString()
      await this.writeManifest(folder, repaired)
    }
    return { manifest: repaired, nextChunkIndex: contiguous.length }
  }

  async recordChunk(jobId: string, index: number): Promise<VideoExportManifest> {
    const folder = this.pathFor(jobId)
    const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8')) as VideoExportManifest
    if (index !== manifest.chunks.length) throw new Error('Os trechos precisam ser confirmados em ordem, sem lacunas ou duplicações.')
    const range = this.expectedRange(manifest, index)
    const filename = `chunk-${String(index).padStart(6, '0')}.mp4`
    const path = join(folder, filename)
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size < 1) throw new Error('Trecho temporário ausente ou inválido.')
    const chunk: VideoExportChunk = { index, ...range, filename, sizeBytes: info.size, sha256: await this.hashFile(path) }
    const updated = { ...manifest, updatedAt: new Date().toISOString(), chunks: [...manifest.chunks, chunk] }
    await this.writeManifest(folder, updated)
    return updated
  }

  async cancel(jobId: string): Promise<void> {
    const folder = this.pathFor(jobId)
    const info = await lstat(folder)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Pasta do job inválida.')
    const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8')) as VideoExportManifest
    if (manifest.jobId !== jobId) throw new Error('O job não é proprietário desta pasta.')
    const rootRelative = relative(this.root, folder)
    if (!rootRelative || rootRelative.startsWith(`..${sep}`)) throw new Error('Pasta do job fora do diretório temporário.')
    await rm(folder, { recursive: true })
  }
}
