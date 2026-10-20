import { constants, createReadStream } from 'node:fs'
import { copyFile, mkdir, lstat, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { verifyVideoExportMediaManifest, type ResolveVideoExportMedia, type VideoExportMediaDependency } from './videoExportAssets'
import { parseVideoExportSnapshot, type VideoExportSnapshot } from '../src/shared/videoExportSnapshot'
import type { RenderVariant } from '../src/shared/videoSceneIR'
import { hydrateVideoExportImagePayload, hydrateVideoExportSnapshotImages, prepareVideoExportImagePayload, prepareVideoExportSnapshot, type PinnedVideoExportSnapshotImage, type VideoExportSnapshotImage } from './videoExportSnapshotAssets'
import { parseVideoCharacterRenderAssetSnapshot, serializeVideoCharacterRenderAssetSnapshot, type VideoCharacterRenderAssetSnapshot } from '../src/shared/videoCharacterRenderAssets'
import { parseVideoExportCharacterSnapshot, serializeVideoExportCharacterSnapshot, type VideoExportCharacterSnapshot } from '../src/shared/videoExportCharacters'
import type { VideoExportRecoveryRecord } from '../src/shared/videoExportRuntime'

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const shaPattern = /^[a-f0-9]{64}$/
const chunkSize = 600
const mimeByExtension = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v' } as const

export type VideoExportChunk = { index: number; startFrame: number; endFrame: number; filename: string; sizeBytes: number; sha256: string }
export type PinnedVideoExportMediaDependency = VideoExportMediaDependency & { filename: string }
export type VideoExportManifest = {
  schemaVersion: 1 | 2
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
  /** Content-addressed raster inputs extracted from the persisted scene JSON. */
  snapshotImageDependencies?: PinnedVideoExportSnapshotImage[]
  /** Transitively resolved Fabricator/Customizer reads captured during character preparation. */
  characterAssetsFile?: 'character-assets.json'
  characterAssetsSha256?: string
  characterAssetImageDependencies?: PinnedVideoExportSnapshotImage[]
  /** Complete Customizer character definitions pinned for transition rendering. */
  charactersFile?: 'characters.json'
  charactersSha256?: string
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
  private readonly manifestMutationQueues = new Map<string, Promise<void>>()
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

  private async writeCharacters(folder: string, serialized: string): Promise<void> {
    const path = join(folder, 'characters.json')
    const temp = join(folder, `.characters-${randomUUID()}.tmp`)
    await writeFile(temp, serialized, { flag: 'wx' })
    await rename(temp, path)
  }

  private async writeCharacterAssets(folder: string, serialized: string): Promise<void> {
    const path = join(folder, 'character-assets.json')
    const temp = join(folder, `.character-assets-${randomUUID()}.tmp`)
    await writeFile(temp, serialized, { flag: 'wx' })
    await rename(temp, path)
  }

  private async pinSnapshotImage(folder: string, image: VideoExportSnapshotImage): Promise<PinnedVideoExportSnapshotImage> {
    const filename = `assets/images/${image.sha256}.${image.extension}`
    const jobRoot = await realpath(folder)
    const assetsFolder = join(folder, 'assets')
    await mkdir(assetsFolder, { recursive: true })
    const assetsInfo = await lstat(assetsFolder)
    const canonicalAssetsFolder = await realpath(assetsFolder)
    if (!assetsInfo.isDirectory() || assetsInfo.isSymbolicLink() || relative(jobRoot, canonicalAssetsFolder) !== 'assets') {
      throw new Error('Pasta de assets pinados do job inválida.')
    }
    const imageFolder = join(canonicalAssetsFolder, 'images')
    await mkdir(imageFolder, { recursive: true })
    const imageFolderInfo = await lstat(imageFolder)
    const canonicalImageFolder = await realpath(imageFolder)
    if (!imageFolderInfo.isDirectory() || imageFolderInfo.isSymbolicLink() || relative(canonicalAssetsFolder, canonicalImageFolder) !== 'images') {
      throw new Error('Pasta de imagens pinadas do job inválida.')
    }
    const destination = join(canonicalImageFolder, `${image.sha256}.${image.extension}`)
    const temporary = `${destination}.${randomUUID()}.tmp`
    const existing = await lstat(destination).catch(() => null)
    if (existing) {
      if (!existing.isFile() || existing.isSymbolicLink() || existing.size !== image.sizeBytes
        || await this.hashFile(destination) !== image.sha256) throw new Error('Uma imagem com o mesmo hash já está pinada, mas seus bytes não conferem.')
      return { sha256: image.sha256, mimeType: image.mimeType, extension: image.extension, sizeBytes: image.sizeBytes, filename }
    }
    try {
      await writeFile(temporary, image.bytes, { flag: 'wx' })
      const info = await lstat(temporary)
      if (!info.isFile() || info.isSymbolicLink() || info.size !== image.sizeBytes
        || await this.hashFile(temporary) !== image.sha256) throw new Error('A imagem copiada para o job não confere com o snapshot.')
      await rename(temporary, destination)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
    return {
      sha256: image.sha256, mimeType: image.mimeType, extension: image.extension,
      sizeBytes: image.sizeBytes, filename,
    }
  }

  private async readPinnedSnapshotImages(folder: string, dependencies: ReadonlyArray<PinnedVideoExportSnapshotImage>): Promise<Map<string, Buffer>> {
    if (!Array.isArray(dependencies)) throw new Error('Manifesto de imagens do snapshot inválido.')
    const bytesByReference = new Map<string, Buffer>()
    const canonicalFolder = await realpath(folder)
    let canonicalAssetsFolder: string | undefined
    if (dependencies.length) {
      const imageFolder = join(folder, 'assets', 'images')
      const directoryInfo = await lstat(imageFolder).catch(() => null)
      if (!directoryInfo?.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error('Pasta de imagens pinadas do job inválida.')
      canonicalAssetsFolder = await realpath(imageFolder)
      if (relative(canonicalFolder, canonicalAssetsFolder) !== join('assets', 'images')) throw new Error('Pasta de imagens pinadas saiu do diretório do job.')
    }
    const validFormats = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
    } as const
    for (const dependency of dependencies) {
      const reference = `${dependency.sha256}:${dependency.mimeType}`
      const filename = `assets/images/${dependency.sha256}.${dependency.extension}`
      if (!shaPattern.test(dependency.sha256) || !Object.hasOwn(validFormats, dependency.mimeType)
        || validFormats[dependency.mimeType as keyof typeof validFormats] !== dependency.extension
        || !Number.isSafeInteger(dependency.sizeBytes) || dependency.sizeBytes < 1 || dependency.filename !== filename
        || bytesByReference.has(reference)) throw new Error('Dependência de imagem do snapshot inválida.')
      const path = join(folder, filename)
      const info = await lstat(path).catch(() => null)
      const canonicalPath = await realpath(path).catch(() => null)
      if (!info?.isFile() || info.isSymbolicLink() || info.size !== dependency.sizeBytes || !canonicalPath
        || relative(canonicalAssetsFolder!, canonicalPath) !== `${dependency.sha256}.${dependency.extension}`) {
        throw new Error('Uma imagem pinada do snapshot está ausente ou inválida.')
      }
      const bytes = await readFile(path)
      if (createHash('sha256').update(bytes).digest('hex') !== dependency.sha256) throw new Error('Uma imagem pinada do snapshot está corrompida.')
      bytesByReference.set(reference, bytes)
    }
    return bytesByReference
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
    const images = await this.readPinnedSnapshotImages(folder, manifest.snapshotImageDependencies ?? [])
    const hydrated = hydrateVideoExportSnapshotImages(serialized, manifest.snapshotImageDependencies ?? [], (dependency) => {
      const bytes = images.get(`${dependency.sha256}:${dependency.mimeType}`)
      if (!bytes) throw new Error('Uma imagem referenciada pelo snapshot não foi carregada.')
      return bytes
    })
    const snapshot = parseVideoExportSnapshot(hydrated)
    if (snapshot.studio.id !== manifest.studioId || snapshot.durationFrames !== manifest.durationFrames) {
      throw new Error('Snapshot persistido não corresponde ao projeto ou à duração do job.')
    }
    return snapshot
  }

  private async readCharacterAssetsFromFolder(folder: string, manifest: VideoExportManifest): Promise<VideoCharacterRenderAssetSnapshot> {
    if (manifest.characterAssetsFile !== 'character-assets.json' || !shaPattern.test(manifest.characterAssetsSha256 ?? '')) {
      throw new Error('O manifesto não contém um snapshot válido dos assets de personagem.')
    }
    const path = join(folder, 'character-assets.json')
    const info = await lstat(path).catch(() => null)
    if (!info?.isFile() || info.isSymbolicLink()) throw new Error('Snapshot de assets de personagem ausente ou inválido.')
    const [canonicalFolder, canonicalPath] = await Promise.all([realpath(folder), realpath(path)])
    if (relative(canonicalFolder, canonicalPath) !== 'character-assets.json') throw new Error('Snapshot de assets de personagem saiu do diretório do job.')
    const serialized = await readFile(path, 'utf8')
    if (createHash('sha256').update(serialized).digest('hex') !== manifest.characterAssetsSha256) {
      throw new Error('Snapshot de assets de personagem não confere com o hash do manifesto.')
    }
    const dependencies = manifest.characterAssetImageDependencies ?? []
    const images = await this.readPinnedSnapshotImages(folder, dependencies)
    const hydrated = hydrateVideoExportImagePayload(serialized, dependencies, (dependency) => {
      const bytes = images.get(`${dependency.sha256}:${dependency.mimeType}`)
      if (!bytes) throw new Error('Uma imagem de personagem referenciada não foi carregada.')
      return bytes
    })
    return parseVideoCharacterRenderAssetSnapshot(hydrated)
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

    const filename = `assets/${dependency.sha256}`
    const assetFolder = join(folder, 'assets')
    const destination = join(folder, filename)
    const temporary = `${destination}.${randomUUID()}.tmp`
    await mkdir(assetFolder, { recursive: true })
    const existing = await lstat(destination).catch(() => null)
    if (existing) {
      if (!existing.isFile() || existing.isSymbolicLink() || existing.size !== dependency.sizeBytes
        || await this.hashFile(destination) !== dependency.sha256) {
        throw new Error('Uma mídia com o mesmo hash já está pinada, mas seus bytes não conferem.')
      }
      return { ...dependency, filename }
    }
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
      const contentAddressedFilename = `assets/${dependency.sha256}`
      const legacyFilename = `assets/${dependency.assetId}.${dependency.extension}`
      const expectedFilename = dependency.filename
      if (!idPattern.test(dependency.assetId) || !shaPattern.test(dependency.sha256)
        || !Number.isSafeInteger(dependency.sizeBytes) || dependency.sizeBytes < 1
        || (expectedFilename !== contentAddressedFilename && expectedFilename !== legacyFilename)
        || !Object.hasOwn(mimeByExtension, dependency.extension)
        || mimeByExtension[dependency.extension as keyof typeof mimeByExtension] !== dependency.mimeType) throw new Error('Dependência pinada do job tem metadados inválidos.')
      const path = join(folder, expectedFilename)
      const info = await lstat(path).catch(() => null)
      const canonicalPath = await realpath(path).catch(() => null)
      if (!info?.isFile() || info.isSymbolicLink() || info.size !== dependency.sizeBytes || !canonicalPath
        || relative(canonicalAssetsRoot!, canonicalPath) !== expectedFilename.slice('assets/'.length)
        || await this.hashFile(path) !== dependency.sha256) throw new Error(`A cópia pinada da mídia ${dependency.assetId} está ausente ou corrompida.`)
      dependencyHashes.push(dependency.sha256)
    }
    if (dependencies.length && dependencyHashes.some((hash) => !manifest.mediaSha256.includes(hash))) throw new Error('Os hashes pinados não correspondem ao manifesto do job.')
  }

  async create(input: { jobId: string; studioId: string; snapshotSha256: string; mediaSha256: string[]; mediaDependencies?: ReadonlyArray<VideoExportMediaDependency>; durationFrames: number; snapshot?: VideoExportSnapshot; characterAssets?: VideoCharacterRenderAssetSnapshot; characters?: VideoExportCharacterSnapshot; renderVariant?: RenderVariant }): Promise<VideoExportManifest> {
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
    let preparedSnapshot: ReturnType<typeof prepareVideoExportSnapshot> | undefined
    let preparedCharacterAssets: ReturnType<typeof prepareVideoExportImagePayload> | undefined
    let serializedCharacters: string | undefined
    if (input.snapshot) {
      if (!input.renderVariant || !['animated', 'static-characters'].includes(input.renderVariant)) throw new Error('O job com snapshot exige um modo de renderização válido.')
      preparedSnapshot = prepareVideoExportSnapshot(input.snapshot)
      const serializedHash = createHash('sha256').update(preparedSnapshot.serialized).digest('hex')
      if (serializedHash !== input.snapshotSha256 || input.snapshot.studio.id !== input.studioId
        || input.snapshot.durationFrames !== input.durationFrames) throw new Error('Snapshot imutável não corresponde ao hash, projeto ou duração do job.')
    } else if (input.renderVariant) {
      throw new Error('Modo de renderização exige um snapshot completo persistido.')
    }
    if (input.characters) {
      if (!preparedSnapshot || !input.renderVariant) throw new Error('Personagens pinados exigem snapshot e modo de renderização do mesmo job.')
      serializedCharacters = serializeVideoExportCharacterSnapshot(input.characters)
    }
    if (input.characterAssets) {
      if (!preparedSnapshot || !input.renderVariant) throw new Error('Assets de personagem exigem snapshot e modo de renderização do mesmo job.')
      const serialized = serializeVideoCharacterRenderAssetSnapshot(input.characterAssets)
      preparedCharacterAssets = prepareVideoExportImagePayload(JSON.parse(serialized))
    }
    await mkdir(this.root, { recursive: true })
    await mkdir(folder)
    try {
      const pinnedDependencies: PinnedVideoExportMediaDependency[] = []
      for (const dependency of dependencies) pinnedDependencies.push(await this.pinMedia(folder, input.studioId, dependency))
      const pinnedSnapshotImages: PinnedVideoExportSnapshotImage[] = []
      for (const image of preparedSnapshot?.images ?? []) pinnedSnapshotImages.push(await this.pinSnapshotImage(folder, image))
      const pinnedCharacterImages: PinnedVideoExportSnapshotImage[] = []
      for (const image of preparedCharacterAssets?.images ?? []) pinnedCharacterImages.push(await this.pinSnapshotImage(folder, image))
      const now = new Date().toISOString()
      const manifest: VideoExportManifest = {
        schemaVersion: 2, jobId: input.jobId, studioId: input.studioId, snapshotSha256: input.snapshotSha256,
        mediaSha256: [...new Set(input.mediaSha256)].sort(), ...(pinnedDependencies.length ? { mediaDependencies: pinnedDependencies } : {}),
        ...(preparedSnapshot ? { snapshotFile: 'snapshot.json' as const, renderVariant: input.renderVariant,
          ...(pinnedSnapshotImages.length ? { snapshotImageDependencies: pinnedSnapshotImages } : {}) } : {}),
        ...(serializedCharacters ? {
          charactersFile: 'characters.json' as const,
          charactersSha256: createHash('sha256').update(serializedCharacters).digest('hex'),
        } : {}),
        ...(preparedCharacterAssets ? {
          characterAssetsFile: 'character-assets.json' as const,
          characterAssetsSha256: createHash('sha256').update(preparedCharacterAssets.serialized).digest('hex'),
          ...(pinnedCharacterImages.length ? { characterAssetImageDependencies: pinnedCharacterImages } : {}),
        } : {}),
        durationFrames: input.durationFrames, frameRate: 60, width: 1920, height: 1080,
        chunkFrames: chunkSize, createdAt: now, updatedAt: now, chunks: []
      }
      await this.verifyPinnedMediaInFolder(folder, manifest)
      if (preparedSnapshot) await this.writeSnapshot(folder, preparedSnapshot.serialized)
      if (serializedCharacters) await this.writeCharacters(folder, serializedCharacters)
      if (preparedCharacterAssets) await this.writeCharacterAssets(folder, preparedCharacterAssets.serialized)
      await this.writeManifest(folder, manifest)
      return manifest
    } catch (error) {
      await rm(folder, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  async reopen(jobId: string, expected?: { studioId: string; snapshotSha256: string; mediaSha256: string[]; mediaDependencies?: ReadonlyArray<VideoExportMediaDependency>; durationFrames: number; renderVariant?: RenderVariant; characterAssetsSha256?: string; charactersSha256?: string }): Promise<{ manifest: VideoExportManifest; nextChunkIndex: number; missingChunkIndexes: number[]; snapshot?: VideoExportSnapshot; characters?: VideoExportCharacterSnapshot; characterAssets?: VideoCharacterRenderAssetSnapshot }> {
    const folder = this.pathFor(jobId)
    const info = await lstat(folder)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Pasta do job inválida.')
    const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8')) as VideoExportManifest
    const expectedMedia = [...new Set(expected?.mediaSha256 ?? manifest.mediaSha256 ?? [])].sort()
    if (![1, 2].includes(manifest.schemaVersion) || manifest.jobId !== jobId || !idPattern.test(manifest.studioId)
      || !shaPattern.test(manifest.snapshotSha256) || !Array.isArray(manifest.mediaSha256)
      || manifest.mediaSha256.some((hash) => !shaPattern.test(hash))
      || JSON.stringify(manifest.mediaSha256) !== JSON.stringify([...new Set(manifest.mediaSha256)].sort())
      || !Array.isArray(manifest.mediaDependencies ?? [])
      || !Array.isArray(manifest.characterAssetImageDependencies ?? [])
      || (manifest.characterAssetsFile !== undefined && (manifest.characterAssetsFile !== 'character-assets.json' || !shaPattern.test(manifest.characterAssetsSha256 ?? '')))
      || (manifest.characterAssetsFile === undefined && (manifest.characterAssetsSha256 !== undefined || (manifest.characterAssetImageDependencies?.length ?? 0) > 0))
      || (manifest.charactersFile !== undefined && (manifest.charactersFile !== 'characters.json' || !shaPattern.test(manifest.charactersSha256 ?? '')))
      || (manifest.charactersFile === undefined && manifest.charactersSha256 !== undefined)
      || (expected !== undefined && (manifest.studioId !== expected.studioId
        || manifest.snapshotSha256 !== expected.snapshotSha256 || JSON.stringify(manifest.mediaSha256) !== JSON.stringify(expectedMedia)
        || manifest.durationFrames !== expected.durationFrames))
      || !Number.isSafeInteger(manifest.durationFrames) || manifest.durationFrames < 1 || manifest.durationFrames > 60 * 60 * 24 * 60
      || manifest.frameRate !== 60 || manifest.width !== 1920 || manifest.height !== 1080
      || manifest.chunkFrames !== chunkSize || !Array.isArray(manifest.chunks)) throw new Error('O projeto ou a mídia mudou; este job não pode ser retomado com o snapshot atual.')
    let snapshot: VideoExportSnapshot | undefined
    let characterAssets: VideoCharacterRenderAssetSnapshot | undefined
    let characters: VideoExportCharacterSnapshot | undefined
    if (manifest.snapshotFile !== undefined) {
      if (manifest.snapshotFile !== 'snapshot.json' || !manifest.renderVariant
        || !['animated', 'static-characters'].includes(manifest.renderVariant)
        || (expected?.renderVariant !== undefined && expected.renderVariant !== manifest.renderVariant)) throw new Error('O modo ou o formato do snapshot do job não corresponde à solicitação.')
      snapshot = await this.readSnapshotFromFolder(folder, manifest)
    } else if (!expected || expected.renderVariant !== undefined) {
      throw new Error('Job legado sem snapshot não pode ser recuperado sem identidade externa do projeto.')
    }
    if (manifest.charactersFile !== undefined) {
      if (expected?.charactersSha256 !== undefined && expected.charactersSha256 !== manifest.charactersSha256) throw new Error('As definições dos personagens mudaram desde o snapshot de exportação.')
      const characterPath = join(folder, 'characters.json')
      const [characterInfo, canonicalFolder, canonicalCharacterPath] = await Promise.all([
        lstat(characterPath).catch(() => null),
        realpath(folder),
        realpath(characterPath).catch(() => null),
      ])
      if (!characterInfo?.isFile() || characterInfo.isSymbolicLink() || !canonicalCharacterPath
        || relative(canonicalFolder, canonicalCharacterPath) !== 'characters.json') throw new Error('Snapshot de personagens ausente ou inválido.')
      const serializedCharacters = await readFile(characterPath, 'utf8')
      if (createHash('sha256').update(serializedCharacters).digest('hex') !== manifest.charactersSha256) throw new Error('Snapshot de personagens não confere com o hash do manifesto.')
      characters = parseVideoExportCharacterSnapshot(serializedCharacters)
    } else if (expected?.charactersSha256 !== undefined) {
      throw new Error('Este job não contém o snapshot esperado dos personagens.')
    }
    if (manifest.characterAssetsFile !== undefined) {
      if (expected?.characterAssetsSha256 !== undefined && expected.characterAssetsSha256 !== manifest.characterAssetsSha256) throw new Error('Os assets de personagem mudaram desde o snapshot de exportação.')
      characterAssets = await this.readCharacterAssetsFromFolder(folder, manifest)
    } else if (expected?.characterAssetsSha256 !== undefined) {
      throw new Error('Este job não contém o snapshot esperado dos assets de personagem.')
    }
    const manifestDependencies = [...(manifest.mediaDependencies ?? [])].map(({ filename: _filename, ...dependency }) => dependency).sort((a, b) => a.assetId.localeCompare(b.assetId))
    const expectedDependencies = [...(expected ? (expected.mediaDependencies ?? []) : manifestDependencies)].sort((a, b) => a.assetId.localeCompare(b.assetId))
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
    const deduplicated = validChunks.filter((chunk, index) => index === 0 || chunk.index !== validChunks[index - 1].index)
    const totalChunks = Math.ceil(manifest.durationFrames / manifest.chunkFrames)
    let retained: VideoExportChunk[]
    if (manifest.schemaVersion === 1) {
      const contiguous: VideoExportChunk[] = []
      for (const chunk of deduplicated) {
        if (chunk.index !== contiguous.length) break
        contiguous.push(chunk)
      }
      retained = contiguous
    } else {
      retained = deduplicated.filter((chunk) => chunk.index < totalChunks)
    }
    const completedIndexes = new Set(retained.map((chunk) => chunk.index))
    const missingChunkIndexes = Array.from({ length: totalChunks }, (_, index) => index).filter((index) => !completedIndexes.has(index))
    const nextChunkIndex = missingChunkIndexes[0] ?? totalChunks
    const repaired = { ...manifest, chunks: retained }
    if (JSON.stringify(retained) !== JSON.stringify(manifest.chunks)) {
      repaired.updatedAt = new Date().toISOString()
      await this.writeManifest(folder, repaired)
    }
    return {
      manifest: repaired,
      nextChunkIndex,
      missingChunkIndexes,
      ...(snapshot ? { snapshot } : {}),
      ...(characters ? { characters } : {}),
      ...(characterAssets ? { characterAssets } : {}),
    }
  }

  async readSnapshot(jobId: string): Promise<VideoExportSnapshot> {
    const folder = this.pathFor(jobId)
    const info = await lstat(folder)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Pasta do job inválida.')
    const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8')) as VideoExportManifest
    if (manifest.jobId !== jobId) throw new Error('O job não é proprietário desta pasta.')
    return this.readSnapshotFromFolder(folder, manifest)
  }

  async readCharacters(jobId: string): Promise<VideoExportCharacterSnapshot> {
    const folder = this.pathFor(jobId)
    const info = await lstat(folder)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Pasta do job inválida.')
    const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8')) as VideoExportManifest
    if (manifest.jobId !== jobId || manifest.charactersFile !== 'characters.json' || !shaPattern.test(manifest.charactersSha256 ?? '')) {
      throw new Error('O job não contém snapshot válido dos personagens.')
    }
    const path = join(folder, 'characters.json')
    const [pathInfo, canonicalFolder, canonicalPath] = await Promise.all([lstat(path).catch(() => null), realpath(folder), realpath(path).catch(() => null)])
    if (!pathInfo?.isFile() || pathInfo.isSymbolicLink() || !canonicalPath || relative(canonicalFolder, canonicalPath) !== 'characters.json') {
      throw new Error('Snapshot de personagens ausente ou inválido.')
    }
    const serialized = await readFile(path, 'utf8')
    if (createHash('sha256').update(serialized).digest('hex') !== manifest.charactersSha256) throw new Error('Snapshot de personagens está corrompido.')
    return parseVideoExportCharacterSnapshot(serialized)
  }

  async readCharacterAssets(jobId: string): Promise<VideoCharacterRenderAssetSnapshot> {
    const folder = this.pathFor(jobId)
    const info = await lstat(folder)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Pasta do job inválida.')
    const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8')) as VideoExportManifest
    if (manifest.jobId !== jobId) throw new Error('O job não é proprietário desta pasta.')
    return this.readCharacterAssetsFromFolder(folder, manifest)
  }

  async verifyPinnedMedia(jobId: string): Promise<void> {
    const folder = this.pathFor(jobId)
    const info = await lstat(folder)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Pasta do job inválida.')
    const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8')) as VideoExportManifest
    if (manifest.jobId !== jobId) throw new Error('O job não é proprietário desta pasta.')
    await this.verifyPinnedMediaInFolder(folder, manifest)
  }

  chunkOutputPath(jobId: string, index: number): string {
    const folder = this.pathFor(jobId)
    if (!Number.isSafeInteger(index) || index < 0) throw new Error('Índice de chunk inválido.')
    return join(folder, `chunk-${String(index).padStart(6, '0')}.mp4`)
  }

  finalOutputPath(jobId: string): string {
    return join(this.pathFor(jobId), 'final.mp4')
  }

  async resolvePinnedMedia(jobId: string, assetId: string): Promise<{ path: string; extension: keyof typeof mimeByExtension; mimeType: (typeof mimeByExtension)[keyof typeof mimeByExtension]; sizeBytes: number }> {
    if (!idPattern.test(assetId)) throw new Error('Asset de mídia inválido.')
    const folder = this.pathFor(jobId)
    const info = await lstat(folder)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Pasta do job inválida.')
    const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8')) as VideoExportManifest
    if (manifest.jobId !== jobId) throw new Error('O job não é proprietário desta pasta.')
    const dependency = (manifest.mediaDependencies ?? []).find((item) => item.assetId === assetId)
    if (!dependency || !shaPattern.test(dependency.sha256) || !Object.hasOwn(mimeByExtension, dependency.extension)
      || mimeByExtension[dependency.extension] !== dependency.mimeType) throw new Error('Mídia pinada não encontrada no job.')
    const expected = dependency.filename === `assets/${dependency.sha256}`
      ? dependency.filename
      : `assets/${dependency.assetId}.${dependency.extension}`
    if (dependency.filename !== expected) throw new Error('Caminho da mídia pinada é inválido.')
    const path = join(folder, dependency.filename)
    const [pathInfo, canonicalFolder, canonicalPath] = await Promise.all([
      lstat(path).catch(() => null), realpath(folder), realpath(path).catch(() => null),
    ])
    const relativePath = canonicalPath ? relative(canonicalFolder, canonicalPath) : ''
    if (!pathInfo?.isFile() || pathInfo.isSymbolicLink() || pathInfo.size !== dependency.sizeBytes || !canonicalPath
      || !relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
      throw new Error('Mídia pinada saiu do diretório do job ou foi alterada.')
    }
    return { path: canonicalPath, extension: dependency.extension, mimeType: dependency.mimeType, sizeBytes: dependency.sizeBytes }
  }

  private async serializeManifestMutation<T>(jobId: string, mutation: () => Promise<T>): Promise<T> {
    const previous = this.manifestMutationQueues.get(jobId) ?? Promise.resolve()
    let release!: () => void
    const barrier = new Promise<void>((resolve) => { release = resolve })
    const queued = previous.catch(() => undefined).then(() => barrier)
    this.manifestMutationQueues.set(jobId, queued)
    await previous.catch(() => undefined)
    try {
      return await mutation()
    } finally {
      release()
      if (this.manifestMutationQueues.get(jobId) === queued) this.manifestMutationQueues.delete(jobId)
    }
  }

  async recordChunk(jobId: string, index: number): Promise<VideoExportManifest> {
    return this.serializeManifestMutation(jobId, async () => {
      const folder = this.pathFor(jobId)
      const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8')) as VideoExportManifest
      const range = this.expectedRange(manifest, index)
      if (manifest.schemaVersion === 1 && index !== manifest.chunks.length) {
        throw new Error('Jobs v1 exigem trechos confirmados em ordem.')
      }
      if (manifest.chunks.some((chunk) => chunk.index === index)) throw new Error('Este trecho já foi confirmado no manifesto.')
      const filename = `chunk-${String(index).padStart(6, '0')}.mp4`
      const path = join(folder, filename)
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink() || info.size < 1) throw new Error('Trecho temporário ausente ou inválido.')
      const chunk: VideoExportChunk = { index, ...range, filename, sizeBytes: info.size, sha256: await this.hashFile(path) }
      const updated = {
        ...manifest,
        updatedAt: new Date().toISOString(),
        chunks: [...manifest.chunks, chunk].sort((left, right) => left.index - right.index),
      }
      await this.writeManifest(folder, updated)
      return updated
    })
  }

  async listRecoverable(): Promise<VideoExportRecoveryRecord[]> {
    await mkdir(this.root, { recursive: true })
    const rootInfo = await lstat(this.root)
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Raiz de jobs de exportação inválida.')
    const records: VideoExportRecoveryRecord[] = []
    const candidates = (await readdir(this.root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && idPattern.test(entry.name))
    const entries = (await Promise.all(candidates.map(async (entry) => ({
      entry,
      mtimeMs: (await lstat(join(this.root, entry.name)).catch(() => null))?.mtimeMs ?? 0,
    }))))
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .slice(0, 100)
      .map(({ entry }) => entry)
    for (const entry of entries) {
      try {
        const reopened = await this.reopen(entry.name)
        const { manifest, snapshot } = reopened
        if (!snapshot || !reopened.characters || !reopened.characterAssets || !manifest.renderVariant) continue
        const completedFrames = manifest.chunks.reduce((sum, chunk) => sum + (chunk.endFrame - chunk.startFrame), 0)
        const totalChunks = Math.ceil(manifest.durationFrames / manifest.chunkFrames)
        records.push({
          jobId: manifest.jobId,
          studioId: manifest.studioId,
          studioTitle: snapshot.studio.title,
          renderVariant: manifest.renderVariant,
          durationFrames: manifest.durationFrames,
          completedFrames,
          completedChunks: manifest.chunks.length,
          totalChunks,
          updatedAt: manifest.updatedAt,
        })
      } catch {
        // Invalid/corrupt job folders are intentionally omitted from resumable UI.
      }
    }
    return records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async cleanup(jobId: string): Promise<void> {
    const folder = this.pathFor(jobId)
    const info = await lstat(folder).catch(() => null)
    if (!info) return
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Pasta do job inválida.')
    const [canonicalRoot, canonicalFolder] = await Promise.all([
      realpath(this.root),
      realpath(folder),
    ])
    // Cleanup must remain possible after a crash truncates/corrupts manifest.json,
    // but deletion is allowed only for the exact UUID child inside the trusted
    // jobs root. A readable manifest with a conflicting owner still fails closed.
    if (dirname(canonicalFolder) !== canonicalRoot || basename(canonicalFolder) !== jobId) {
      throw new Error('Pasta do job fora do diretório temporário.')
    }
    const manifestPath = join(canonicalFolder, 'manifest.json')
    const manifestText = await readFile(manifestPath, 'utf8').catch(() => null)
    if (manifestText !== null) {
      try {
        const manifest = JSON.parse(manifestText) as VideoExportManifest
        if (manifest.jobId !== jobId) throw new Error('O job não é proprietário desta pasta.')
      } catch (reason) {
        if (reason instanceof Error && reason.message === 'O job não é proprietário desta pasta.') throw reason
        // Malformed/truncated manifests are not resumable, but the exact
        // app-owned UUID directory can still be discarded safely.
      }
    }
    await rm(canonicalFolder, { recursive: true })
  }

  async cancel(jobId: string): Promise<void> {
    await this.cleanup(jobId)
  }
}
