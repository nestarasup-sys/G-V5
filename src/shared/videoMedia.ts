import type { VideoMediaClip } from './studio'
import { isValidVideoAudioSettings } from './videoAudio'

export type VideoClipEditMode = 'move' | 'start' | 'end'
const clampFrame = (frame: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(frame)))

export function isValidVideoMediaClip(clip: VideoMediaClip, sourceDuration: number, timelineDuration: number): boolean {
  return Boolean(clip && typeof clip.id === 'string' && typeof clip.assetId === 'string'
    && isValidVideoAudioSettings(clip.audio)
    && [clip.startFrame, clip.endFrame, clip.sourceStartFrame, clip.sourceEndFrame].every(Number.isSafeInteger)
    && clip.startFrame >= 0 && clip.endFrame > clip.startFrame && clip.endFrame <= timelineDuration
    && clip.sourceStartFrame >= 0 && clip.sourceEndFrame > clip.sourceStartFrame && clip.sourceEndFrame <= sourceDuration
    && clip.endFrame - clip.startFrame === clip.sourceEndFrame - clip.sourceStartFrame)
}

/** Moving preserves source time; trimming advances/recedes the source window by the same delta. */
export function editVideoMediaClip(clip: VideoMediaClip, mode: VideoClipEditMode, frame: number, sourceDuration: number, timelineDuration: number): VideoMediaClip {
  if (!Number.isFinite(frame) || !isValidVideoMediaClip(clip, sourceDuration, timelineDuration)) return clip
  if (mode === 'move') {
    const length = clip.endFrame - clip.startFrame
    const startFrame = clampFrame(frame, 0, timelineDuration - length)
    return { ...clip, startFrame, endFrame: startFrame + length }
  }
  if (mode === 'start') {
    const startFrame = clampFrame(frame, Math.max(0, clip.startFrame - clip.sourceStartFrame), clip.endFrame - 1)
    return { ...clip, startFrame, sourceStartFrame: clip.sourceStartFrame + startFrame - clip.startFrame }
  }
  const endFrame = clampFrame(frame, clip.startFrame + 1, Math.min(timelineDuration, clip.endFrame + sourceDuration - clip.sourceEndFrame))
  return { ...clip, endFrame, sourceEndFrame: clip.sourceEndFrame + endFrame - clip.endFrame }
}

export function splitVideoMediaClip(clip: VideoMediaClip, frame: number, rightClipId: string): [VideoMediaClip, VideoMediaClip] | null {
  if (!Number.isSafeInteger(frame) || frame <= clip.startFrame || frame >= clip.endFrame) return null
  const sourceBoundary = clip.sourceStartFrame + frame - clip.startFrame
  return [
    { ...clip, endFrame: frame, sourceEndFrame: sourceBoundary },
    { ...clip, id: rightClipId, startFrame: frame, sourceStartFrame: sourceBoundary }
  ]
}
