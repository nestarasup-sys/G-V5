import type { StudioDocument, VideoTimelineDocument } from './studio'
import { automaticBlinkFrameFor, resolveVideoFrameSelection } from './videoFrame'

/**
 * Export-domain projection of a StudioDocument. React playhead/playing are never
 * a clock for export. This is a correctness scaffold, NOT a pixel renderer.
 */
export type VideoExportSnapshot = Readonly<{
  studio: StudioDocument
  timeline: VideoTimelineDocument
  frameRate: 60
  durationFrames: number
}>

type SerializedVideoExportSnapshot = Readonly<{
  schemaVersion: 1
  studio: StudioDocument
  frameRate: 60
  durationFrames: number
}>

export type VideoExportFrameSelection = Readonly<{
  frame: number
  timeSeconds: number
  characters: ReadonlyArray<{ elementId: string; hidden: boolean; blink: boolean }>
  texts: ReadonlyArray<{ elementId: string; clipId: string; kind: 'speech' | 'thought' }>
  videos: ReadonlyArray<{
    clipId: string
    assetId: string
    sourceFrame: number
    startFrame: number
    endFrameExclusive: number
  }>
}>

function deepFreeze<T>(value: T, visited = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || visited.has(value)) return value
  visited.add(value)
  for (const member of Object.values(value)) deepFreeze(member, visited)
  return Object.freeze(value)
}

export function canonicalVideoExportJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Snapshot contém um número inválido.')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalVideoExportJson(entry)).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalVideoExportJson(entry)}`).join(',')}}`
  }
  throw new Error('Snapshot contém um valor que não pode ser persistido.')
}

/**
 * Clone once at job acceptance. No active React state, media loading side
 * effects, changes to the persisted Studio or private asset writes.
 */
export function createVideoExportSnapshot(source: StudioDocument): VideoExportSnapshot {
  if (!source || source.schemaVersion !== 1 || !source.videoTimeline) {
    throw new Error('Snapshot de exportação exige um documento do Video Studio.')
  }
  const timeline = source.videoTimeline
  if (timeline.schemaVersion !== 1 || timeline.frameRate !== 60
    || !Number.isSafeInteger(timeline.durationFrames) || timeline.durationFrames < 1
    || timeline.durationFrames > 24 * 60 * 60 * 60) {
    throw new Error('Timeline de exportação inválida: esperado 60 FPS e duração em frames inteiros.')
  }
  for (const clip of timeline.videoClips ?? []) {
    if (![clip.startFrame, clip.endFrame, clip.sourceStartFrame, clip.sourceEndFrame].every(Number.isSafeInteger)
      || clip.startFrame < 0 || clip.endFrame > timeline.durationFrames || clip.endFrame <= clip.startFrame
      || clip.sourceStartFrame < 0 || clip.sourceEndFrame - clip.sourceStartFrame < clip.endFrame - clip.startFrame) {
      throw new Error('Clip de vídeo com limites incompatíveis com o snapshot de exportação.')
    }
  }
  const studio = structuredClone(source)
  const detachedTimeline = studio.videoTimeline!
  detachedTimeline.playheadFrame = 0
  detachedTimeline.playing = false
  // This freeze is intentionally transitive: a foreground renderer may only
  // read the snapshot. Performance/asset URL lifetime are measured later.
  return deepFreeze({
    studio,
    timeline: detachedTimeline,
    frameRate: 60 as const,
    durationFrames: detachedTimeline.durationFrames
  })
}

/** Stable, versioned JSON for persisting the exact project state accepted by an export job. */
export function serializeVideoExportSnapshot(snapshot: VideoExportSnapshot): string {
  if (!snapshot || snapshot.frameRate !== 60 || snapshot.durationFrames !== snapshot.timeline.durationFrames
    || snapshot.studio.videoTimeline !== snapshot.timeline) throw new Error('Snapshot de exportação inconsistente.')
  const payload: SerializedVideoExportSnapshot = {
    schemaVersion: 1,
    studio: snapshot.studio,
    frameRate: snapshot.frameRate,
    durationFrames: snapshot.durationFrames,
  }
  return canonicalVideoExportJson(payload)
}

/** Reconstructs the frozen runtime view from its pinned on-disk representation. */
export function parseVideoExportSnapshot(serialized: string): VideoExportSnapshot {
  let payload: SerializedVideoExportSnapshot
  try { payload = JSON.parse(serialized) as SerializedVideoExportSnapshot }
  catch { throw new Error('Snapshot persistido da exportação está corrompido.') }
  if (!payload || payload.schemaVersion !== 1 || !payload.studio || payload.frameRate !== 60
    || !Number.isSafeInteger(payload.durationFrames) || payload.durationFrames < 1) {
    throw new Error('Snapshot persistido da exportação tem um formato incompatível.')
  }
  const snapshot = createVideoExportSnapshot(payload.studio)
  if (snapshot.frameRate !== payload.frameRate || snapshot.durationFrames !== payload.durationFrames) {
    throw new Error('Duração do snapshot persistido não confere com a timeline.')
  }
  return snapshot
}

/**
 * Resolve CONTENT at an absolute frame. This intentionally stops short of
 * rasterizing a V5 character; poses/wardrobe/transitions require the separate
 * character compositor parity gate before being used by an encoder.
 *
 * All time ranges are half-open; no dependence on preview history or playing.
 */
export function resolveVideoExportFrameSelection(snapshot: VideoExportSnapshot, frame: number): VideoExportFrameSelection {
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= snapshot.durationFrames) {
    throw new RangeError('Frame de exportação fora do intervalo [0, durationFrames).')
  }
  const selection = resolveVideoFrameSelection(snapshot.timeline, frame)
  const characters = snapshot.studio.elements
    .filter((element) => element.kind === 'character')
    .map((element) => ({
      elementId: element.id,
      hidden: selection.hiddenCharacterIds.has(element.id),
      blink: !selection.hiddenCharacterIds.has(element.id) && automaticBlinkFrameFor(frame, element.id, snapshot.frameRate)
    }))
  const texts = [...selection.textClipByElementId.values()].map((clip) => ({
    elementId: clip.elementId,
    clipId: clip.id,
    kind: clip.kind
  }))
  const videos = selection.videoClips.map((clip) => ({
    clipId: clip.id,
    assetId: clip.assetId,
    sourceFrame: clip.sourceStartFrame + (frame - clip.startFrame),
    startFrame: clip.startFrame,
    endFrameExclusive: clip.endFrame
  }))
  return { frame, timeSeconds: frame / snapshot.frameRate, characters, texts, videos }
}
