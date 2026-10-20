import type { VideoTimelineDocument } from '../../../../shared/studio'

type CharacterKey = VideoTimelineDocument['characterKeys'][number]
type CharacterGap = NonNullable<VideoTimelineDocument['characterGaps']>[number]
type TextClip = VideoTimelineDocument['textClips'][number]
type VideoClip = NonNullable<VideoTimelineDocument['videoClips']>[number]

export type VideoTimelineIndex = {
  characterKeysByElement: Map<string, CharacterKey[]>
  characterGapsByElement: Map<string, CharacterGap[]>
  textClipsByElement: Map<string, TextClip[]>
  textClipPrefixMaxEndByElement: Map<string, number[]>
  textClipsById: Map<string, TextClip>
  videoClips: VideoClip[]
  videoClipPrefixMaxEnd: number[]
  videoClipsById: Map<string, VideoClip>
  saveMarkersByTrack: Map<string, VideoTimelineDocument['saveMarkers']>
  snapFrames: number[]
  snapFrameOwners: Map<number, Set<string | null>>
}

function addToGroup<T>(groups: Map<string, T[]>, id: string, value: T): void {
  const values = groups.get(id)
  if (values) values.push(value)
  else groups.set(id, [value])
}

/** Builds render/query indexes once per immutable timeline revision. */
export function indexVideoTimeline(timeline: VideoTimelineDocument): VideoTimelineIndex {
  const characterKeysByElement = new Map<string, CharacterKey[]>()
  const characterGapsByElement = new Map<string, CharacterGap[]>()
  const textClipsByElement = new Map<string, TextClip[]>()
  const textClipsById = new Map<string, TextClip>()
  const videoClipsById = new Map<string, VideoClip>()
  const videoClips: VideoClip[] = []
  const saveMarkersByTrack = new Map<string, VideoTimelineDocument['saveMarkers']>()
  const snapFrameOwners = new Map<number, Set<string | null>>()
  const addSnap = (frame: number, owner: string | null = null) => {
    const owners = snapFrameOwners.get(frame)
    if (owners) owners.add(owner)
    else snapFrameOwners.set(frame, new Set([owner]))
  }

  for (const key of timeline.characterKeys) {
    addToGroup(characterKeysByElement, key.elementId, key)
    // Treat the keyframe as the owner of its boundary so the boundary can be
    // excluded while it is being dragged (otherwise it snaps back to itself).
    addSnap(key.frame, key.id)
  }
  for (const gap of timeline.characterGaps ?? []) addToGroup(characterGapsByElement, gap.elementId, gap)
  for (const clip of timeline.textClips) {
    addToGroup(textClipsByElement, clip.elementId, clip)
    textClipsById.set(clip.id, clip)
    addSnap(clip.startFrame, clip.id)
    addSnap(clip.endFrame, clip.id)
  }
  for (const clip of timeline.videoClips ?? []) {
    videoClipsById.set(clip.id, clip)
    videoClips.push(clip)
    addSnap(clip.startFrame, clip.id)
    addSnap(clip.endFrame, clip.id)
  }
  for (const marker of timeline.saveMarkers) {
    for (const trackId of marker.affectedTrackIds ?? []) addToGroup(saveMarkersByTrack, trackId, marker)
  }

  for (const keys of characterKeysByElement.values()) keys.sort((a, b) => a.frame - b.frame)
  for (const gaps of characterGapsByElement.values()) gaps.sort((a, b) => a.startFrame - b.startFrame)
  for (const clips of textClipsByElement.values()) clips.sort((a, b) => a.startFrame - b.startFrame)
  videoClips.sort((a, b) => a.startFrame - b.startFrame)
  const textClipPrefixMaxEndByElement = new Map([...textClipsByElement].map(([id, clips]) => [id, prefixMaximum(clips.map((clip) => clip.endFrame))]))
  const videoClipPrefixMaxEnd = prefixMaximum(videoClips.map((clip) => clip.endFrame))

  return {
    characterKeysByElement,
    characterGapsByElement,
    textClipsByElement,
    textClipPrefixMaxEndByElement,
    textClipsById,
    videoClips,
    videoClipPrefixMaxEnd,
    videoClipsById,
    saveMarkersByTrack,
    snapFrames: [...snapFrameOwners.keys()].sort((a, b) => a - b),
    snapFrameOwners
  }
}

function prefixMaximum(values: readonly number[]): number[] {
  let maximum = Number.NEGATIVE_INFINITY
  return values.map((value) => {
    maximum = Math.max(maximum, value)
    return maximum
  })
}

function upperBound<T>(values: readonly T[], value: number, get: (item: T) => number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (get(values[middle]) <= value) low = middle + 1
    else high = middle
  }
  return low
}

export function characterSegmentAtFrame(index: VideoTimelineIndex, elementId: string, frame: number, duration: number): { startFrame: number; endFrame: number } | null {
  const keys = index.characterKeysByElement.get(elementId) ?? []
  const previousKeyIndex = upperBound(keys, frame, (key) => key.frame) - 1
  const stateStart = previousKeyIndex >= 0 ? keys[previousKeyIndex].frame : 0
  const stateEnd = keys[previousKeyIndex + 1]?.frame ?? duration
  const gaps = index.characterGapsByElement.get(elementId) ?? []
  let precedingGapEnd = stateStart
  let followingGapStart = stateEnd
  for (const gap of gaps) {
    if (gap.startFrame <= frame && frame < gap.endFrame) return null
    if (gap.endFrame <= frame && gap.endFrame > precedingGapEnd && gap.endFrame > stateStart) precedingGapEnd = gap.endFrame
    if (gap.startFrame > frame && gap.startFrame < followingGapStart && gap.startFrame < stateEnd) followingGapStart = gap.startFrame
  }
  return { startFrame: precedingGapEnd, endFrame: followingGapStart }
}

/** Returns keyframes needed to render only a horizontal viewport plus its active-state boundaries. */
export function characterKeysForFrameRange(keys: readonly CharacterKey[], startFrame: number, endFrame: number): CharacterKey[] {
  const firstAfterStart = upperBound(keys, startFrame, (key) => key.frame)
  const lastAtOrBeforeEnd = upperBound(keys, endFrame, (key) => key.frame) - 1
  const from = Math.max(0, firstAfterStart - 1)
  const to = Math.min(keys.length, Math.max(from, lastAtOrBeforeEnd + 2))
  return keys.slice(from, to)
}

export function clipsForFrameRange<T extends { startFrame: number; endFrame: number }>(clips: readonly T[], prefixMaxEnd: readonly number[], startFrame: number, endFrame: number): T[] {
  let low = 0
  let high = prefixMaxEnd.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (prefixMaxEnd[middle] < startFrame) low = middle + 1
    else high = middle
  }
  const from = low
  low = from
  high = clips.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (clips[middle].startFrame <= endFrame) low = middle + 1
    else high = middle
  }
  return clips.slice(from, low).filter((clip) => clip.endFrame >= startFrame)
}

function nearestUsableStaticFrame(index: VideoTimelineIndex, target: number, excludedClipId?: string): number | undefined {
  const frames = index.snapFrames
  if (!frames.length) return undefined
  let low = 0
  let high = frames.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (frames[middle] < target) low = middle + 1
    else high = middle
  }

  let left = low - 1
  let right = low
  while (left >= 0 || right < frames.length) {
    const leftFrame = left >= 0 ? frames[left] : undefined
    const rightFrame = right < frames.length ? frames[right] : undefined
    const useLeft = rightFrame === undefined || (leftFrame !== undefined && target - leftFrame <= rightFrame - target)
    const candidate = useLeft ? leftFrame! : rightFrame!
    if (useLeft) left--
    else right++
    const owners = index.snapFrameOwners.get(candidate)
    if (!excludedClipId || !owners || owners.size > 1 || !owners.has(excludedClipId)) return candidate
  }
  return undefined
}

export function nearestTimelineSnapFrame(index: VideoTimelineIndex, frame: number, playheadFrame: number, pixelsPerSecond: number, excludedClipId?: string, includePlayhead = true): number {
  const staticFrame = nearestUsableStaticFrame(index, frame, excludedClipId)
  const secondFrame = Math.round(frame / 60) * 60
  const candidates = [...(includePlayhead ? [playheadFrame] : []), secondFrame, ...(staticFrame === undefined ? [] : [staticFrame])]
  const nearest = candidates.slice(1).reduce((best, candidate) => Math.abs(candidate - frame) < Math.abs(best - frame) ? candidate : best, candidates[0] ?? frame)
  return Math.abs(nearest - frame) / 60 * pixelsPerSecond <= 8 ? nearest : frame
}
