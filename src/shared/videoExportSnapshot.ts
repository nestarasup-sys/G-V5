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
