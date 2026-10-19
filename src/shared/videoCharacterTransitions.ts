import type { StudioDocument, StudioElement, VideoCharacterState, VideoTimelineDocument } from './studio'

export const VIDEO_CHARACTER_TRANSITION_FRAMES = 15

export type VideoCharacterTransition = Readonly<{
  elementId: string
  boundaryFrame: number
  startFrame: number
  from: VideoCharacterState
  to: VideoCharacterState
}>

function equalValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && equalValue(a[key], b[key]))
}

function actingState(element: StudioElement) {
  return {
    pose: element.poseSlot,
    face: element.faceAppearance,
    transforms: element.faceTransforms,
    effects: element.activeExpressionEffects,
    mode: element.activeFaceMode,
    preset: element.activeExpressionPresetId,
  }
}

/** Canonical transition windows shared by preview and absolute-frame scene evaluation. */
export function compileVideoCharacterTransitions(studio: Pick<StudioDocument, 'elements' | 'videoTimeline'>): VideoCharacterTransition[] {
  const timeline: VideoTimelineDocument | undefined = studio.videoTimeline
  if (!timeline) return []
  const result: VideoCharacterTransition[] = []
  for (const element of studio.elements.filter((item) => item.kind === 'character')) {
    let previous = timeline.characterBases?.[element.id]
    let previousFrame = 0
    const byFrame = new Map(timeline.characterKeys
      .filter((key) => key.elementId === element.id && key.frame < timeline.durationFrames)
      .map((key) => [key.frame, key] as const))
    for (const key of [...byFrame.values()].sort((a, b) => a.frame - b.frame)) {
      if (!key.state) continue
      const startFrame = Math.max(previousFrame, key.frame - VIDEO_CHARACTER_TRANSITION_FRAMES)
      const overlapsGap = timeline.characterGaps?.some((gap) => gap.elementId === element.id && gap.startFrame < key.frame && gap.endFrame > startFrame)
      if (previous && key.frame > 0 && startFrame < key.frame && !overlapsGap && !equalValue(actingState(previous.element), actingState(key.state.element))) {
        result.push({ elementId: element.id, boundaryFrame: key.frame, startFrame, from: previous, to: key.state })
      }
      previous = key.state
      previousFrame = key.frame
    }
  }
  return result.sort((a, b) => a.boundaryFrame - b.boundaryFrame)
}
