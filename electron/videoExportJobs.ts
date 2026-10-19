import { constants, createReadStream } from 'node:fs'
import { copyFile, mkdir, lstat, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, join, relative, resolve, sep } from 'node:path'
import { verifyVideoExportMediaManifest, type ResolveVideoExportMedia, type VideoExportMediaDependency } from './videoExportAssets'
import { parseVideoExportSnapshot, serializeVideoExportSnapshot, type VideoExportSnapshot } from '../src/shared/videoExportSnapshot'
import type { RenderVariant } from '../src/shared/videoSceneIR'

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const shaPattern = /^[a-f0-9]{64}$/
const chunkSize = 600
const mimeByExtension = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v' } as const

export type VideoExportChunk = { index: number; startFrame: number; endFrame: number; filename: string; sizeBytes: number; sha256: string }
export type PinnedVideoExportMediaDependency = VideoExportMediaDependency & { filename: string }
export type VideoExportManifest = {
  schemaVersion: 1
  jobId: string
  studioId: string
  snapshotSha256: string
  mediaSha256: string[]
  /** Added compatibly: older v1 jobs without pinned media remain readable. */
  mediaDependencies?: PinnedVideoExportMediaDependency[]
  /** Present on jobs that persist a complete immutable scene snapshot. */
  snapshotFile?: 'snapshot.json'
  /** Semantic renderer mode bound to the snapshot. */
  renderVariant?: RenderVariant
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
  constructor(root: string, private readonly resolveMedia?: ResolveVideoExportMedia) { this.root = resolve(root) }

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

  private async writeSnapshot(folder: string, serialized: string): Promise<void> {
    const path = join(folder, 'snapshot.json')
    const temp = join(folder, `.snapshot-${randomUUID()}.tmp`)
    await writeFile(temp, serialized, { flag: 'wx' })
    await rename(temp, path)
  }

  private async readSnapshotFromFolder(folder: string, manifest: VideoExportManifest): Promise<VideoExportSnapshot> {
    if (manifest.snapshotFile !== 'snapshot.json') throw new Error('Este job legado não contém um snapshot persistido.')
    if (!manifest.renderVariant || !['animated', 'static-characters'].includes(manifest.renderVariant)) {
      throw new Error('O manifesto do snapshot não informa uma variante de renderização válida.')
    }
    const path = join(folder, 'snapshot.json')
    const info = await lstat(path).catch(() => null)
    if (!info?.isFile() || info.isSymbolicLink()) throw new Error('Snapshot persistido ausente ou inválido.')
    const [canonicalFolder, canonicalPath] = await Promise.all([realpath(folder), realpath(path)])
    if (relative(canonicalFolder, canonicalPath) !== 'snapshot.json') throw new Error('Snapshot persistido saiu do diretório do job.')
    const serialized = await readFile(path, 'utf8')
    if (createHash('sha256').update(serialized).digest('hex') !== manifest.snapshotSha256) {
      throw new Error('Snapshot persistido não confere com o hash do manifesto.')
    }
    const snapshot = parseVideoExportSnapshot(serialized)
    if (snapshot.studio.id !== manifest.studioId || snapshot.durationFrames !== manifest.durationFrames) {
      throw new Error('Snapshot persistido não corresponde ao projeto ou à duração do job.')
    }
    return snapshot
  }

  private async pinMedia(folder: string, studioId: string, dependency: VideoExportMediaDependency): Promise<PinnedVideoExportMediaDependency> {
    if (!this.resolveMedia) throw new Error('Não há resolvedor confiável para copiar as mídias deste job.')
    const expected = { id: dependency.assetId, extension: dependency.extension, mimeType: dependency.mimeType, size: dependency.sizeBytes }
    const source = await this.resolveMedia(studioId, expected)
    const [canonicalRoot, canonicalSource] = await Promise.all([realpath(source.trustedRoot), realpath(source.path)])
    const relativeSource = relative(canonicalRoot, canonicalSource)
    if (!relativeSource || relativeSource === '..' || relativeSource.startsWith(`..${sep}`)) throw new Error('Uma mídia do job está fora da pasta autorizada.')
    const sourceInfo = await lstat(source.path)
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink() || sourceInfo.size !== dependency.sizeBytes) throw new Error(`A mídia ${dependency.assetId} mudou antes de ser fixada no job.`)

    const filename = `assets/${dependency.assetId}.${dependency.extension}`
    const assetFolder = join(folder, 'assets')
    const destination = join(folder, filename)
    const temporary = `${destination}.${randomUUID()}.tmp`
    await mkdir(assetFolder)
    try {
      await copyFile(canonicalSource, temporary, constants.COPYFILE_EXCL)
      const info = await lstat(temporary)
      if (!info.isFile() || info.isSymbolicLink() || info.size !== dependency.sizeBytes
        || await this.hashFile(temporary) !== dependency.sha256) {
        throw new Error(`A cópia isolada da mídia ${dependency.assetId} não confere com o snapshot.`)
      }
      await rename(temporary, destination)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
    return { ...dependency, filename }
  }

  private async verifyPinnedMediaInFolder(folder: string, manifest: VideoExportManifest): Promise<void> {
    const dependencies = manifest.mediaDependencies ?? []
    if (new Set(dependencies.map((dependency) => dependency.assetId)).size !== dependencies.length) throw new Error('O manifesto do job contém dependências duplicadas.')
    let canonicalAssetsRoot: string | undefined
    if (dependencies.length) {
      const assetFolder = join(folder, 'assets')
      const assetFolderInfo = await lstat(assetFolder).catch(() => null)
      if (!assetFolderInfo?.isDirectory() || assetFolderInfo.isSymbolicLink()) throw new Error('A pasta de mídias pinadas do job está inválida.')
      const [canonicalJob, canonicalAssets] = await Promise.all([realpath(folder), realpath(assetFolder)])
      if (relative(canonicalJob, canonicalAssets) !== 'assets') throw new Error('A pasta de mídias pinadas saiu do diretório do job.')
      canonicalAssetsRoot = canonicalAssets
    }
    const dependencyHashes: string[] = []
    for (const dependency of dependencies) {
      const expectedFilename = `assets/${dependency.assetId}.${dependency.extension}`
      if (!idPattern.test(dependency.assetId) || !shaPattern.test(dependency.sha256)
        || !Number.isSafeInteger(dependency.sizeBytes) || dependency.sizeBytes < 1 || dependency.filename !== expectedFilename
        || !Object.hasOwn(mimeByExtension, dependency.extension)
        || mimeByExtension[dependency.extension as keyof typeof mimeByExtension] !== dependency.mimeType) throw new Error('Dependência pinada do job tem metadados inválidos.')
      const path = join(folder, expectedFilename)
      const info = await lstat(path).catch(() => null)
      const canonicalPath = await realpath(path).catch(() => null)
      if (!info?.isFile() || info.isSymbolicLink() || info.size !== dependency.sizeBytes || !canonicalPath
        || relative(canonicalAssetsRoot!, canonicalPath) !== `${dependency.assetId}.${dependency.extension}`
        || await this.hashFile(path) !== dependency.sha256) throw new Error(`A cópia pinada da mídia ${dependency.assetId} está ausente ou corrompida.`)
      dependencyHashes.push(dependency.sha256)
    }
    if (dependencies.length && dependencyHashes.some((hash) => !manifest.mediaSha256.includes(hash))) throw new Error('Os hashes pinados não correspondem ao manifesto do job.')
  }

  async create(input: { jobId: string; studioId: string; snapshotSha256: string; mediaSha256: string[]; mediaDependencies?: ReadonlyArray<VideoExportMediaDependency>; durationFrames: number; snapshot?: VideoExportSnapshot; renderVariant?: RenderVariant }): Promise<VideoExportManifest> {
    const folder = this.pathFor(input.jobId)
    const dependencies = [...(input.mediaDependencies ?? [])].sort((left, right) => left.assetId.localeCompare(right.assetId))
    if (!idPattern.test(input.studioId) || !shaPattern.test(input.snapshotSha256) || !input.mediaSha256.every((hash) => shaPattern.test(hash))
      || !Number.isSafeInteger(input.durationFrames) || input.durationFrames < 1 || input.durationFrames > 60 * 60 * 24 * 60
      || new Set(dependencies.map((item) => item.assetId)).size !== dependencies.length
      || dependencies.some((item) => !idPattern.test(item.assetId) || !shaPattern.test(item.sha256)
        || !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 1 || !['mp4', 'webm', 'mov', 'm4v'].includes(item.extension)
        || !['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v'].includes(item.mimeType)
        || !input.mediaSha256.includes(item.sha256))) throw new Error('Snapshot ou parâmetros do job inválidos.')
    if (dependencies.length) {
      if (!this.resolveMedia) throw new Error('Não há resolvedor confiável para fixar as mídias deste job.')
      await verifyVideoExportMediaManifest(dependencies, input.studioId, this.resolveMedia)
    }
    let serializedSnapshot: string | undefined
    if (input.snapshot) {
      if (!input.renderVariant || !['animated', 'static-characters'].includes(input.renderVariant)) throw new Error('O job com snapshot exige um modo de renderização válido.')
      serializedSnapshot = serializeVideoExportSnapshot(input.snapshot)
      const serializedHash = createHash('sha256').update(serializedSnapshot).digest('hex')
      if (serializedHash !== input.snapshotSha256 || input.snapshot.studio.id !== input.studioId
        || input.snapshot.durationFrames !== input.durationFrames) throw new Error('Snapshot imutável não corresponde ao hash, projeto ou duração do job.')
    } else if (input.renderVariant) {
      throw new Error('Modo de renderização exige um snapshot completo persistido.')
    }
    await mkdir(this.root, { recursive: true })
    await mkdir(folder)
    try {
      const pinnedDependencies: PinnedVideoExportMediaDependency[] = []
      for (const dependency of dependencies) pinnedDependencies.push(await this.pinMedia(folder, input.studioId, dependency))
      const now = new Date().toISOString()
      const manifest: VideoExportManifest = {
        schemaVersion: 1, jobId: input.jobId, studioId: input.studioId, snapshotSha256: input.snapshotSha256,
        mediaSha256: [...new Set(input.mediaSha256)].sort(), ...(pinnedDependencies.length ? { mediaDependencies: pinnedDependencies } : {}),
        ...(serializedSnapshot ? { snapshotFile: 'snapshot.json' as const, renderVariant: input.renderVariant } : {}),
        durationFrames: input.durationFrames, frameRate: 60, width: 1920, height: 1080,
        chunkFrames: chunkSize, createdAt: now, updatedAt: now, chunks: []
      }
      await this.verifyPinnedMediaInFolder(folder, manifest)
      if (serializedSnapshot) await this.writeSnapshot(folder, serializedSnapshot)
      await this.writeManifest(folder, manifest)
      return manifest
    } catch (error) {
      await rm(folder, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  async reopen(jobId: string, expected: { studioId: string; snapshotSha256: string; mediaSha256: string[]; mediaDependencies?: ReadonlyArray<VideoExportMediaDependency>; durationFrames: number; renderVariant?: RenderVariant }): Promise<{ manifest: VideoExportManifest; nextChunkIndex: number; snapshot?: VideoExportSnapshot }> {
    const folder = this.pathFor(jobId)
    const info = await lstat(folder)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Pasta do job inválida.')
    const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8')) as VideoExportManifest
    const expectedMedia = [...new Set(expected.mediaSha256)].sort()
    if (manifest.schemaVersion !== 1 || manifest.jobId !== jobId || manifest.studioId !== expected.studioId
      || manifest.snapshotSha256 !== expected.snapshotSha256 || JSON.stringify(manifest.mediaSha256) !== JSON.stringify(expectedMedia)
      || manifest.durationFrames !== expected.durationFrames || manifest.frameRate !== 60 || manifest.width !== 1920 || manifest.height !== 1080
      || manifest.chunkFrames !== chunkSize || !Array.isArray(manifest.chunks)) throw new Error('O projeto ou a mídia mudou; este job não pode ser retomado com o snapshot atual.')
    let snapshot: VideoExportSnapshot | undefined
    if (manifest.snapshotFile !== undefined) {
      if (manifest.snapshotFile !== 'snapshot.json' || !manifest.renderVariant
        || !['animated', 'static-characters'].includes(manifest.renderVariant)
        || (expected.renderVariant !== undefined && expected.renderVariant !== manifest.renderVariant)) throw new Error('O modo ou o formato do snapshot do job não corresponde à solicitação.')
      snapshot = await this.readSnapshotFromFolder(folder, manifest)
    } else if (expected.renderVariant !== undefined) {
      throw new Error('Job legado sem snapshot não pode retomar uma exportação com modo semântico.')
    }
    const expectedDependencies = [...(expected.mediaDependencies ?? [])].sort((a, b) => a.assetId.localeCompare(b.assetId))
    const manifestDependencies = [...(manifest.mediaDependencies ?? [])].map(({ filename: _filename, ...dependency }) => dependency).sort((a, b) => a.assetId.localeCompare(b.assetId))
    const signature = (items: ReadonlyArray<VideoExportMediaDependency>) => items.map((item) => [item.assetId, item.extension, item.mimeType, item.sizeBytes, item.sha256].join('\0')).join('\n')
    if (signature(manifestDependencies) !== signature(expectedDependencies)) throw new Error('As dependências do job não correspondem ao snapshot atual.')
    await this.verifyPinnedMediaInFolder(folder, manifest)
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
    return { manifest: repaired, nextChunkIndex: contiguous.length, ...(snapshot ? { snapshot } : {}) }
  }

  async readSnapshot(jobId: string): Promise<VideoExportSnapshot> {
    const folder = this.pathFor(jobId)
    const info = await lstat(folder)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Pasta do job inválida.')
    const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8')) as VideoExportManifest
    if (manifest.jobId !== jobId) throw new Error('O job não é proprietário desta pasta.')
    return this.readSnapshotFromFolder(folder, manifest)
  }

  async verifyPinnedMedia(jobId: string): Promise<void> {
    const folder = this.pathFor(jobId)
    const info = await lstat(folder)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Pasta do job inválida.')
    const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8')) as VideoExportManifest
    if (manifest.jobId !== jobId) throw new Error('O job não é proprietário desta pasta.')
    await this.verifyPinnedMediaInFolder(folder, manifest)
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
