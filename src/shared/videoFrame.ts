import type { VideoMediaClip, VideoTimelineDocument } from './studio'

export type VideoFrameSelection = {
  hiddenCharacterIds: Set<string>
  textClipByElementId: Map<string, VideoTimelineDocument['textClips'][number]>
  videoClips: VideoMediaClip[]
}

/** Resolve timeline visibility from an absolute frame, independent of playback state. */
export function resolveVideoFrameSelection(timeline: VideoTimelineDocument, frame: number): VideoFrameSelection {
  const hiddenCharacterIds = new Set<string>()
  const textClipByElementId = new Map<string, VideoTimelineDocument['textClips'][number]>()
  const videoClips: VideoMediaClip[] = []
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= timeline.durationFrames) {
    return { hiddenCharacterIds, textClipByElementId, videoClips }
  }
  for (const gap of timeline.characterGaps ?? []) {
    if (Number.isInteger(gap.startFrame) && Number.isInteger(gap.endFrame) && gap.startFrame <= frame && frame < gap.endFrame) hiddenCharacterIds.add(gap.elementId)
  }
  for (const clip of timeline.textClips) {
    if (!textClipByElementId.has(clip.elementId) && Number.isInteger(clip.startFrame) && Number.isInteger(clip.endFrame) && clip.startFrame <= frame && frame < clip.endFrame) {
      textClipByElementId.set(clip.elementId, clip)
    }
  }
  for (const clip of timeline.videoClips ?? []) {
    if (Number.isInteger(clip.startFrame) && Number.isInteger(clip.endFrame) && clip.startFrame <= frame && frame < clip.endFrame) videoClips.push(clip)
  }
  return { hiddenCharacterIds, textClipByElementId, videoClips }
}

/** Deterministic facial animation helpers shared by preview and export. */
export function automaticBlinkFrameFor(frame: number, characterId: string, frameRate = 60): boolean {
  if (!Number.isSafeInteger(frame) || frame < 0 || !Number.isFinite(frameRate) || frameRate <= 0 || !characterId) return false
  let hash = 2166136261
  for (let index = 0; index < characterId.length; index++) {
    hash ^= characterId.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  const stable = hash >>> 0
  const period = Math.max(1, Math.round(frameRate * (3.2 + (stable % 1800) / 1000)))
  const offset = Math.floor(stable / 1800) % period
  const phase = ((frame + offset) % period + period) % period
  return phase < Math.max(1, Math.round(frameRate * 0.12))
}

