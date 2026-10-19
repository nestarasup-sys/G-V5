import type { StudioDocument } from '../../../../shared/studio'
import { compileVideoCharacterTransitions, VIDEO_CHARACTER_TRANSITION_FRAMES, type VideoCharacterTransition } from '../../../../shared/videoCharacterTransitions'
import { transitionProgress } from '../../../../shared/videoCharacterInterpolation'

export const VIDEO_FRAME_RATE = 60
export const CHARACTER_TRANSITION_MS = VIDEO_CHARACTER_TRANSITION_FRAMES / VIDEO_FRAME_RATE * 1000
export type CharacterTransition = VideoCharacterTransition

export {
  mix, mixAngle, mixAppearance, mixEffects, mixFaceTransform, mixPoseArtwork,
  mixStageElement, mixStudioTransforms, smoothProgress,
  type PoseArtwork,
} from '../../../../shared/videoCharacterInterpolation'

export function compileCharacterTransitions(studio: StudioDocument): CharacterTransition[] {
  return compileVideoCharacterTransitions(studio)
}

/** Only intermediate output samples need artwork; the boundary belongs to the next segment. */
export function transitionSampleFrames(transition: CharacterTransition): number[] {
  const result: number[] = []
  for (let frame = Math.floor(transition.startFrame) + 1; frame < transition.boundaryFrame; frame++) result.push(frame)
  return result
}

export { transitionProgress }
