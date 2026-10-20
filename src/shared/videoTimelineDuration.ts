import type { VideoTimelineDocument } from './studio'

/** Empty Video Studio projects start short enough for a practical export smoke test. */
export const DEFAULT_VIDEO_DURATION_FRAMES = 5 * 60

/** Fit duration to the latest authored timeline item while keeping a usable minimum. */
export function fitVideoTimelineDuration(timeline: VideoTimelineDocument): number {
  const ends = [
    ...timeline.characterKeys.map((key) => key.frame + 1),
    ...Object.values(timeline.characterTrackEnds ?? {}),
    ...(timeline.characterGaps ?? []).map((gap) => gap.endFrame),
    ...timeline.textClips.map((clip) => clip.endFrame),
    ...(timeline.videoClips ?? []).map((clip) => clip.endFrame),
    ...timeline.saveMarkers.map((marker) => marker.frame + 1),
  ].filter((frame) => Number.isFinite(frame) && frame >= 0)
  return Math.max(DEFAULT_VIDEO_DURATION_FRAMES, ...ends)
}
