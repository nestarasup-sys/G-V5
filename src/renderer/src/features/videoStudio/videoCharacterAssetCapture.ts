import type { CustomizerCharacter } from '../../../../shared/customizer'
import type { StudioDocument } from '../../../../shared/studio'
import {
  createRecordingVideoCharacterRenderAssetProvider,
  type VideoCharacterRenderAssetProvider,
  type VideoCharacterRenderAssetSnapshot,
} from '../../../../shared/videoCharacterRenderAssets'
import { compileCharacterTransitions, transitionSampleFrames } from './characterTransitions'
import { TransitionRenderer } from './transitionRenderer'

export type CharacterAssetCaptureOptions = Readonly<{
  signal?: AbortSignal
  onProgress?: (completed: number, total: number) => void
}>

/**
 * Resolves the same Fabricator/Customizer dependencies the transition renderer
 * will consume, then returns a detached snapshot suitable for pinning in a job.
 * The sequential loop bounds decoded/canvas work and makes cancellation safe.
 */
export async function captureVideoCharacterRenderAssets(
  studio: StudioDocument,
  characters: ReadonlyArray<CustomizerCharacter>,
  source: VideoCharacterRenderAssetProvider,
  options: CharacterAssetCaptureOptions = {},
): Promise<VideoCharacterRenderAssetSnapshot> {
  const transitions = compileCharacterTransitions(studio)
  const jobs = transitions.flatMap((transition) => transitionSampleFrames(transition).map((frame) => ({ transition, frame })))
  const recorder = createRecordingVideoCharacterRenderAssetProvider(source)
  const renderer = new TransitionRenderer(recorder.provider)
  const charactersById = new Map(characters.map((character) => [character.id, character]))

  for (let index = 0; index < jobs.length; index += 1) {
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Captura de assets cancelada.', 'AbortError')
    const { transition, frame } = jobs[index]
    const characterId = transition.from.element.characterId
    if (!characterId) throw new Error('Uma transição do roteiro não referencia um personagem válido.')
    const character = charactersById.get(characterId)
    if (!character) throw new Error(`O personagem ${characterId} da transição não está disponível.`)
    await renderer.render(transition, frame, character)
    options.onProgress?.(index + 1, jobs.length)
  }
  if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Captura de assets cancelada.', 'AbortError')
  return recorder.snapshot()
}
