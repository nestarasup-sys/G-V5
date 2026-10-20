import type { VideoMediaClip, VideoTimelineDocument } from './studio'

export type TimelineBlockTarget =
  | { kind: 'character'; elementId: string; startFrame: number; endFrame: number }
  | { kind: 'text'; clipId: string }
  | { kind: 'video'; clipId: string }

type Interval = { startFrame: number; endFrame: number }
type CharacterKey = VideoTimelineDocument['characterKeys'][number]

function blockLane(timeline: VideoTimelineDocument, target: Exclude<TimelineBlockTarget, { kind: 'character' }>) {
  if (target.kind === 'video') return 'video'
  return timeline.textClips.find((clip) => clip.id === target.clipId)?.kind
}

function laneIntervals(timeline: VideoTimelineDocument, lane: string, excludedId?: string): Array<Interval & { id: string }> {
  if (lane === 'video') return (timeline.videoClips ?? []).filter((clip) => clip.id !== excludedId).map(({ id, startFrame, endFrame }) => ({ id, startFrame, endFrame })).sort((a, b) => a.startFrame - b.startFrame)
  return timeline.textClips.filter((clip) => clip.kind === lane && clip.id !== excludedId).map(({ id, startFrame, endFrame }) => ({ id, startFrame, endFrame })).sort((a, b) => a.startFrame - b.startFrame)
}

/** Find the first free position at or after the requested frame in one lane. */
export function findTimelineBlockStart(timeline: VideoTimelineDocument, lane: 'video' | 'speech' | 'thought', requestedStartFrame: number, lengthFrames: number, excludedId?: string): number {
  if (!Number.isSafeInteger(requestedStartFrame) || !Number.isSafeInteger(lengthFrames) || lengthFrames < 1) return Math.max(0, requestedStartFrame || 0)
  let startFrame = Math.max(0, requestedStartFrame)
  const intervals = laneIntervals(timeline, lane, excludedId)
  while (true) {
    const collision = intervals.find((interval) => startFrame < interval.endFrame && startFrame + lengthFrames > interval.startFrame)
    if (!collision) return startFrame
    startFrame = collision.endFrame
  }
}

/** Keep body-dragging inside the neighbouring free space; edge resizing consumes neighbours separately. */
export function clampTimelineBlockMove(timeline: VideoTimelineDocument, target: Exclude<TimelineBlockTarget, { kind: 'character' }>, requestedStartFrame: number): number {
  const selected = target.kind === 'video'
    ? timeline.videoClips?.find((clip) => clip.id === target.clipId)
    : timeline.textClips.find((clip) => clip.id === target.clipId)
  const lane = blockLane(timeline, target)
  if (!selected || !lane || !Number.isSafeInteger(requestedStartFrame)) return selected?.startFrame ?? 0
  const length = selected.endFrame - selected.startFrame
  const intervals = laneIntervals(timeline, lane, selected.id)
  const previous = intervals.filter((interval) => interval.endFrame <= selected.startFrame).at(-1)
  const following = intervals.find((interval) => interval.startFrame >= selected.endFrame)
  const minimum = previous?.endFrame ?? 0
  const maximum = Math.max(minimum, Math.min(timeline.durationFrames - length, following ? following.startFrame - length : timeline.durationFrames - length))
  return Math.max(minimum, Math.min(maximum, requestedStartFrame))
}

export function timelineBlockOverlaps(timeline: VideoTimelineDocument, target: Exclude<TimelineBlockTarget, { kind: 'character' }>, startFrame: number, endFrame: number): boolean {
  const selectedId = target.kind === 'video' ? target.clipId : target.clipId
  const lane = blockLane(timeline, target)
  if (!lane || endFrame <= startFrame) return true
  return laneIntervals(timeline, lane, selectedId).some((interval) => startFrame < interval.endFrame && endFrame > interval.startFrame)
}

function subtract(interval: Interval, occupied: Interval): Interval[] {
  if (interval.endFrame <= occupied.startFrame || interval.startFrame >= occupied.endFrame) return [interval]
  return [
    ...(interval.startFrame < occupied.startFrame ? [{ startFrame: interval.startFrame, endFrame: occupied.startFrame }] : []),
    ...(interval.endFrame > occupied.endFrame ? [{ startFrame: occupied.endFrame, endFrame: interval.endFrame }] : [])
  ]
}

/** One edit transaction: the resized block wins over its neighbours on the same lane. */
export function resizeTimelineBlock(timeline: VideoTimelineDocument, target: TimelineBlockTarget, startFrame: number, endFrame: number, characterIds: readonly string[] = []): VideoTimelineDocument {
  if (![startFrame, endFrame].every(Number.isSafeInteger) || startFrame < 0 || endFrame <= startFrame) return timeline
  const laneId = target.kind === 'character' ? target.elementId : target.kind === 'video' ? 'video' : timeline.textClips.find((clip) => clip.id === target.clipId)?.kind
  if (!laneId || timeline.trackSettings?.[laneId]?.locked) return timeline
  const occupied = { startFrame, endFrame }
  let next = timeline
  if (target.kind === 'character') {
    const keys = timeline.characterKeys.filter((key) => key.elementId === target.elementId).sort((a, b) => a.frame - b.frame)
    const base = timeline.characterBases?.[target.elementId]
    const baseKey: CharacterKey = { id: `base:${target.elementId}`, elementId: target.elementId, frame: 0, poseSlot: base?.element.poseSlot ?? null, expressionCollectionId: base?.element.activeExpressionCollectionId ?? null, expressionPresetId: base?.element.activeExpressionPresetId ?? null, faceMode: base?.element.activeFaceMode ?? 'idle', state: base }
    const boundaries = keys[0]?.frame === 0 ? keys : [baseKey, ...keys]
    let inheritedState = base
    const segments = boundaries.flatMap((key, index) => {
      inheritedState = key.state ?? inheritedState
      let parts: Interval[] = [{ startFrame: key.frame, endFrame: boundaries[index + 1]?.frame ?? timeline.durationFrames }]
      for (const gap of timeline.characterGaps ?? []) if (gap.elementId === target.elementId) parts = parts.flatMap((part) => subtract(part, gap))
      return parts.filter((part) => part.endFrame > part.startFrame).map((part, partIndex) => ({ ...part, key: { ...key, state: inheritedState, id: partIndex ? `${key.id}:part:${partIndex}` : key.id } }))
    })
    const selected = segments.find((segment) => segment.startFrame === target.startFrame && segment.endFrame === target.endFrame)
    if (!selected) return timeline
    const edited = segments.flatMap((segment) => segment === selected ? [] : subtract(segment, occupied).map((part, index) => ({ ...part, key: { ...segment.key, id: index ? `${segment.key.id}:remainder` : segment.key.id } })))
    edited.push({ ...occupied, key: selected.key })
    edited.sort((a, b) => a.startFrame - b.startFrame)
    const duration = Math.max(timeline.durationFrames, endFrame)
    const gaps: NonNullable<VideoTimelineDocument['characterGaps']> = []
    let cursor = 0
    for (const segment of edited) {
      if (segment.startFrame > cursor) gaps.push({ id: `gap:${target.elementId}:${cursor}`, elementId: target.elementId, startFrame: cursor, endFrame: segment.startFrame })
      cursor = segment.endFrame
    }
    if (cursor < duration) gaps.push({ id: `gap:${target.elementId}:${cursor}`, elementId: target.elementId, startFrame: cursor, endFrame: duration })
    next = { ...timeline, characterTrackEnds: { ...timeline.characterTrackEnds, [target.elementId]: cursor }, characterKeys: [...timeline.characterKeys.filter((key) => key.elementId !== target.elementId), ...edited.map((segment) => ({ ...segment.key, frame: segment.startFrame }))], characterGaps: [...(timeline.characterGaps ?? []).filter((gap) => gap.elementId !== target.elementId), ...gaps] }
  } else if (target.kind === 'text') {
    const selected = timeline.textClips.find((clip) => clip.id === target.clipId)
    if (!selected) return timeline
    next = { ...timeline, textClips: timeline.textClips.flatMap((clip) => clip.id === selected.id ? [{ ...clip, ...occupied }] : clip.kind !== selected.kind ? [clip] : subtract(clip, occupied).map((part, index) => ({ ...clip, ...part, id: index ? `${clip.id}:remainder` : clip.id }))) }
  } else {
    const selected = timeline.videoClips?.find((clip) => clip.id === target.clipId)
    const asset = timeline.videoAssets?.find((asset) => asset.id === selected?.assetId)
    if (!selected || !asset) return timeline
    const sourceStartFrame = selected.sourceStartFrame + startFrame - selected.startFrame
    const sourceEndFrame = selected.sourceEndFrame + endFrame - selected.endFrame
    if (sourceStartFrame < 0 || sourceEndFrame > asset.durationFrames) return timeline
    const trimmed = (clip: VideoMediaClip, part: Interval, index: number): VideoMediaClip => ({ ...clip, ...part, id: index ? `${clip.id}:remainder` : clip.id, sourceStartFrame: clip.sourceStartFrame + part.startFrame - clip.startFrame, sourceEndFrame: clip.sourceEndFrame + part.endFrame - clip.endFrame })
    next = { ...timeline, videoClips: timeline.videoClips!.flatMap((clip) => clip.id === selected.id ? [{ ...clip, ...occupied, sourceStartFrame, sourceEndFrame }] : subtract(clip, occupied).map((part, index) => trimmed(clip, part, index))) }
  }
  // Implicit character states must not grow just because another lane grows.
  if (endFrame > timeline.durationFrames) {
    const ids = new Set([...characterIds, ...Object.keys(timeline.characterBases ?? {}), ...timeline.characterKeys.map((key) => key.elementId)])
    const extensions = [...ids].filter((id) => target.kind !== 'character' || id !== target.elementId).map((elementId) => ({ id: `gap:${elementId}:${timeline.durationFrames}`, elementId, startFrame: timeline.durationFrames, endFrame }))
    next = { ...next, characterGaps: [...(next.characterGaps ?? []), ...extensions] }
  }
  return { ...next, durationFrames: Math.max(timeline.durationFrames, endFrame) }
}
