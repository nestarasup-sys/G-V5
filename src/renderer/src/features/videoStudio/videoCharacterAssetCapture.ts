import type { CustomizerCharacter } from '../../../../shared/customizer'
import type { StudioDocument, VideoCharacterState } from '../../../../shared/studio'
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

export type AutomaticFaceCaptureState = Readonly<{
  elementId: string
  characterId: string
  state: VideoCharacterState
}>

/**
 * Collect every authored appearance that can become the source of automatic
 * blink/talk rendering. Identity-based dedupe is intentional: a repeated state
 * object is the same authored artwork, while detached keys are captured even if
 * their JSON happens to look equal today.
 */
export function collectAutomaticFaceCaptureStates(studio: Pick<StudioDocument, 'elements' | 'videoTimeline'>): AutomaticFaceCaptureState[] {
  const timeline = studio.videoTimeline
  if (!timeline) return []
  const result: AutomaticFaceCaptureState[] = []
  const seen = new Set<VideoCharacterState>()
  const push = (elementId: string, state: VideoCharacterState | undefined) => {
    if (!state || seen.has(state)) return
    const characterId = state.element.characterId
      ?? studio.elements.find((element) => element.id === elementId && element.kind === 'character')?.characterId
    if (!characterId) return
    seen.add(state)
    result.push({ elementId, characterId, state })
  }
  for (const element of studio.elements) {
    if (element.kind !== 'character') continue
    push(element.id, timeline.characterBases?.[element.id])
  }
  for (const key of timeline.characterKeys) push(key.elementId, key.state)
  return result
}

function syntheticFaceTransition(item: AutomaticFaceCaptureState, mode: 'blink' | 'talk') {
  const element = { ...item.state.element, activeFaceMode: mode }
  const state: VideoCharacterState = { element, imageDataUrl: item.state.imageDataUrl }
  return {
    elementId: item.elementId,
    startFrame: 0,
    boundaryFrame: 2,
    from: state,
    to: state,
  }
}

/**
 * Resolves the exact Fabricator/Customizer reads needed by transitions and
 * automatic face recipes, then returns a detached snapshot suitable for pinning
 * inside an export job. The sequential loop bounds decoded/canvas work and
 * makes cancellation deterministic.
 */
export async function captureVideoCharacterRenderAssets(
  studio: StudioDocument,
  characters: ReadonlyArray<CustomizerCharacter>,
  source: VideoCharacterRenderAssetProvider,
  options: CharacterAssetCaptureOptions = {},
): Promise<VideoCharacterRenderAssetSnapshot> {
  const transitions = compileCharacterTransitions(studio)
  const transitionJobs = transitions.flatMap((transition) => transitionSampleFrames(transition).map((frame) => ({ transition, frame })))
  const faceStates = collectAutomaticFaceCaptureStates(studio)
  const faceJobs = faceStates.flatMap((item) => (['blink', 'talk'] as const).map((mode) => ({ item, mode })))
  const modelSlots = [...new Set(faceStates.flatMap(({ characterId }) => {
    const character = characters.find((candidate) => candidate.id === characterId)
    return character ? [character.customization.modelSlot ?? 1] : []
  }))].sort((a, b) => a - b)
  const total = transitionJobs.length + faceJobs.length + modelSlots.length
  let completed = 0

  const recorder = createRecordingVideoCharacterRenderAssetProvider(source)
  const renderer = new TransitionRenderer(recorder.provider)
  const charactersById = new Map(characters.map((character) => [character.id, character]))
  const abort = () => {
    if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Captura de assets cancelada.', 'AbortError')
  }
  const progressed = () => {
    completed += 1
    options.onProgress?.(completed, total)
  }

  for (const { transition, frame } of transitionJobs) {
    abort()
    const characterId = transition.from.element.characterId
    if (!characterId) throw new Error('Uma transição do roteiro não referencia um personagem válido.')
    const character = charactersById.get(characterId)
    if (!character) throw new Error(`O personagem ${characterId} da transição não está disponível.`)
    await renderer.render(transition, frame, character)
    progressed()
  }

  // Mouth selection itself needs the catalog summary list before the renderer
  // resolves the selected catalog item.
  for (const modelSlot of modelSlots) {
    abort()
    await recorder.provider.listFaceCatalog(modelSlot)
    progressed()
  }

  for (const { item, mode } of faceJobs) {
    abort()
    const character = charactersById.get(item.characterId)
    if (!character) throw new Error(`O personagem ${item.characterId} do estado facial não está disponível.`)
    // Preview treats automatic blink/talk as optional when that model does not
    // have a matching closed-eye/open-mouth recipe. Capture mirrors that rule.
    try { await renderer.render(syntheticFaceTransition(item, mode), 1, character) }
    catch { /* authored PNG remains the deterministic fallback */ }
    progressed()
  }

  abort()
  return recorder.snapshot()
}
