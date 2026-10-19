import { createReadStream } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { relative, sep } from 'node:path'
import type { StudioDocument, VideoStudioAsset } from '../src/shared/studio'

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const mimeByExtension: Record<VideoStudioAsset['extension'], VideoStudioAsset['mimeType']> = {
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v',
}

export type VideoExportMediaDependency = Readonly<{
  assetId: string
  extension: VideoStudioAsset['extension']
  mimeType: VideoStudioAsset['mimeType']
  sizeBytes: number
  sha256: string
}>

export type ResolvedVideoExportMedia = Readonly<{ path: string; trustedRoot: string }>
export type ResolveVideoExportMedia = (studioId: string, asset: Pick<VideoStudioAsset, 'id' | 'extension' | 'mimeType' | 'size'>) => Promise<ResolvedVideoExportMedia>

function assertAssetMetadata(asset: VideoStudioAsset): void {
  if (!idPattern.test(asset.id) || !Object.hasOwn(mimeByExtension, asset.extension)
    || mimeByExtension[asset.extension] !== asset.mimeType
    || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > 5 * 1024 ** 3) {
    throw new Error('Metadados de uma mídia do roteiro estão inválidos.')
  }
}

async function inspectMedia(studioId: string, asset: Pick<VideoStudioAsset, 'id' | 'extension' | 'mimeType' | 'size'>, resolveAsset: ResolveVideoExportMedia): Promise<VideoExportMediaDependency> {
  const resolved = await resolveAsset(studioId, asset)
  const [trustedRoot, mediaPath] = await Promise.all([realpath(resolved.trustedRoot), realpath(resolved.path)])
  const pathFromRoot = relative(trustedRoot, mediaPath)
  if (!pathFromRoot || pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || pathFromRoot.startsWith(`..${process.platform === 'win32' ? '/' : sep}`)) {
    throw new Error('Uma mídia do roteiro está fora da pasta autorizada.')
  }
  const before = await lstat(resolved.path)
  if (!before.isFile() || before.isSymbolicLink() || before.size !== asset.size) {
    throw new Error(`A mídia ${asset.id} está ausente ou tem tamanho diferente do catálogo.`)
  }
  const hash = createHash('sha256')
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(mediaPath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', resolvePromise)
  })
  const after = await lstat(resolved.path)
  if (!after.isFile() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino
    || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
    throw new Error(`A mídia ${asset.id} mudou enquanto era verificada.`)
  }
  return Object.freeze({ assetId: asset.id, extension: asset.extension, mimeType: asset.mimeType, sizeBytes: after.size, sha256: hash.digest('hex') })
}

/** Hashes only media referenced by timeline clips; no absolute paths enter the manifest. */
export async function buildVideoExportMediaManifest(studio: Pick<StudioDocument, 'id' | 'videoTimeline'>, resolveAsset: ResolveVideoExportMedia): Promise<ReadonlyArray<VideoExportMediaDependency>> {
  const timeline = studio?.videoTimeline
  if (!timeline || !idPattern.test(studio.id)) throw new Error('Manifest de mídia exige um roteiro válido do Video Studio.')
  const assets = new Map<string, VideoStudioAsset>()
  for (const asset of timeline.videoAssets ?? []) {
    assertAssetMetadata(asset)
    const previous = assets.get(asset.id)
    if (previous && (previous.extension !== asset.extension || previous.mimeType !== asset.mimeType || previous.size !== asset.size)) {
      throw new Error(`O asset ${asset.id} aparece com metadados conflitantes.`)
    }
    assets.set(asset.id, asset)
  }
  const referencedIds = [...new Set((timeline.videoClips ?? []).map((clip) => clip.assetId))].sort()
  const result: VideoExportMediaDependency[] = []
  for (const assetId of referencedIds) {
    if (!idPattern.test(assetId)) throw new Error('Uma referência de vídeo do roteiro tem ID inválido.')
    const asset = assets.get(assetId)
    if (!asset) throw new Error(`O vídeo ${assetId} usado na timeline não está anexado ao roteiro.`)
    result.push(await inspectMedia(studio.id, asset, resolveAsset))
  }
  return Object.freeze(result)
}

/** Re-hashes the same logical dependencies before resume/finalization and fails closed on change. */
export async function verifyVideoExportMediaManifest(manifest: ReadonlyArray<VideoExportMediaDependency>, studioId: string, resolveAsset: ResolveVideoExportMedia): Promise<void> {
  if (!Array.isArray(manifest)) throw new Error('Manifest de mídia da exportação está inválido.')
  if (!idPattern.test(studioId)) throw new Error('Identificador do roteiro no manifesto é inválido.')
  const dependencies = [...(manifest as ReadonlyArray<VideoExportMediaDependency>)].sort((a, b) => a.assetId.localeCompare(b.assetId))
  if (new Set(dependencies.map((entry) => entry.assetId)).size !== dependencies.length) throw new Error('Manifest de mídia contém IDs duplicados.')
  for (const expected of dependencies) {
    if (!idPattern.test(expected.assetId) || !Object.hasOwn(mimeByExtension, expected.extension)
      || mimeByExtension[expected.extension] !== expected.mimeType || !Number.isSafeInteger(expected.sizeBytes)
      || expected.sizeBytes < 1 || expected.sizeBytes > 5 * 1024 ** 3 || !/^[a-f0-9]{64}$/.test(expected.sha256)) {
      throw new Error('Manifest de mídia da exportação está inválido.')
    }
    const actual = await inspectMedia(studioId, { id: expected.assetId, extension: expected.extension, mimeType: expected.mimeType, size: expected.sizeBytes }, resolveAsset)
    if (actual.assetId !== expected.assetId || actual.extension !== expected.extension || actual.mimeType !== expected.mimeType
      || actual.sizeBytes !== expected.sizeBytes || actual.sha256 !== expected.sha256) {
      throw new Error(`A mídia ${expected.assetId} mudou desde o snapshot da exportação.`)
    }
  }
}
