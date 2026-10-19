import { createHash } from 'node:crypto'
import type { VideoExportSnapshot } from '../src/shared/videoExportSnapshot'
import { canonicalVideoExportJson } from '../src/shared/videoExportSnapshot'

const referencePrefix = 'gacha-export-asset:'
const mimeToExtension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const

export type VideoExportSnapshotImage = Readonly<{
  sha256: string
  mimeType: keyof typeof mimeToExtension
  extension: (typeof mimeToExtension)[keyof typeof mimeToExtension]
  sizeBytes: number
  bytes: Buffer
}>

export type PinnedVideoExportSnapshotImage = Omit<VideoExportSnapshotImage, 'bytes'> & Readonly<{ filename: string }>

export type PreparedVideoExportSnapshot = Readonly<{
  serialized: string
  images: ReadonlyArray<VideoExportSnapshotImage>
}>

export type PreparedVideoExportImagePayload = Readonly<{
  serialized: string
  images: ReadonlyArray<VideoExportSnapshotImage>
}>

function assertImageBytes(bytes: Buffer, mimeType: string): asserts mimeType is keyof typeof mimeToExtension {
  const valid = mimeType === 'image/png'
    ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mimeType === 'image/jpeg'
      ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : mimeType === 'image/webp'
        ? bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
        : false
  if (!valid) throw new Error('Imagem embutida no snapshot tem MIME incompatível ou bytes inválidos.')
}

function parseImageDataUrl(value: string): { mimeType: keyof typeof mimeToExtension; bytes: Buffer } | null {
  if (!value.startsWith('data:image/')) return null
  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(value)
  if (!match) throw new Error('Snapshot contém imagem embutida em formato não suportado; esperado PNG, JPEG ou WebP base64.')
  const mimeType = (match[1] === 'image/jpg' ? 'image/jpeg' : match[1]) as keyof typeof mimeToExtension
  const bytes = Buffer.from(match[2], 'base64')
  if (!bytes.length || bytes.toString('base64') !== match[2]) throw new Error('Imagem embutida no snapshot contém base64 inválido.')
  assertImageBytes(bytes, mimeType)
  return { mimeType, bytes }
}

function imageReference(sha256: string, mimeType: string): string {
  return `${referencePrefix}${sha256}:${mimeType}`
}

function imageKey(sha256: string, mimeType: string): string { return `${sha256}:${mimeType}` }

/** Externalizes every embedded PNG/JPEG/WebP in a JSON payload by content digest. */
export function prepareVideoExportImagePayload(payload: unknown): PreparedVideoExportImagePayload {
  const unique = new Map<string, VideoExportSnapshotImage>()
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const parsed = parseImageDataUrl(value)
      if (!parsed) return value
      const sha256 = createHash('sha256').update(parsed.bytes).digest('hex')
      const key = imageKey(sha256, parsed.mimeType)
      if (!unique.has(key)) unique.set(key, {
        sha256, mimeType: parsed.mimeType, extension: mimeToExtension[parsed.mimeType],
        sizeBytes: parsed.bytes.length, bytes: parsed.bytes,
      })
      return imageReference(sha256, parsed.mimeType)
    }
    if (Array.isArray(value)) return value.map(visit)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, visit(entry)]))
    }
    return value
  }

  return {
    serialized: canonicalVideoExportJson(visit(payload)),
    images: [...unique.values()].sort((left, right) => left.sha256 < right.sha256 ? -1 : left.sha256 > right.sha256 ? 1 : 0),
  }
}

/** Removes non-rendering card art and externalizes the scene snapshot's raster bytes. */
export function prepareVideoExportSnapshot(snapshot: VideoExportSnapshot): PreparedVideoExportSnapshot {
  const studio = structuredClone(snapshot.studio) as Record<string, unknown>
  delete studio.thumbnailDataUrl
  const timeline = studio.videoTimeline as Record<string, unknown> | undefined
  if (timeline) delete timeline.coverDataUrl
  return prepareVideoExportImagePayload({
    schemaVersion: 1,
    studio,
    frameRate: snapshot.frameRate,
    durationFrames: snapshot.durationFrames,
  })
}

/** Rehydrates image references only from the job's verified pinned image set. */
export function hydrateVideoExportImagePayload(
  serialized: string,
  dependencies: ReadonlyArray<PinnedVideoExportSnapshotImage>,
  resolveBytes: (dependency: PinnedVideoExportSnapshotImage) => Buffer,
): string {
  const dependencyByKey = new Map<string, PinnedVideoExportSnapshotImage>()
  for (const dependency of dependencies) {
    const key = imageKey(dependency.sha256, dependency.mimeType)
    if (dependencyByKey.has(key)) throw new Error('Snapshot contém dependências de imagem duplicadas.')
    dependencyByKey.set(key, dependency)
  }
  let payload: unknown
  try { payload = JSON.parse(serialized) }
  catch { throw new Error('Snapshot persistido da exportação está corrompido.') }
  const used = new Set<string>()
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string' && value.startsWith(referencePrefix)) {
      const reference = /^gacha-export-asset:([a-f0-9]{64}):(image\/(?:png|jpeg|webp))$/.exec(value)
      if (!reference) throw new Error('Snapshot contém referência de imagem inválida.')
      const key = imageKey(reference[1], reference[2])
      const dependency = dependencyByKey.get(key)
      if (!dependency) throw new Error('Uma imagem referenciada pelo snapshot não está fixada no job.')
      const bytes = resolveBytes(dependency)
      assertImageBytes(bytes, dependency.mimeType)
      used.add(key)
      return `data:${dependency.mimeType};base64,${bytes.toString('base64')}`
    }
    if (Array.isArray(value)) return value.map(visit)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, visit(entry)]))
    }
    return value
  }
  const hydrated = visit(payload)
  if (used.size !== dependencyByKey.size) throw new Error('O manifesto contém imagens pinadas que não pertencem ao snapshot.')
  return canonicalVideoExportJson(hydrated)
}

/** Backwards-compatible scene snapshot helper retained for existing job readers. */
export function hydrateVideoExportSnapshotImages(
  serialized: string,
  dependencies: ReadonlyArray<PinnedVideoExportSnapshotImage>,
  resolveBytes: (dependency: PinnedVideoExportSnapshotImage) => Buffer,
): string {
  return hydrateVideoExportImagePayload(serialized, dependencies, resolveBytes)
}
