import type { StudioDocument, StudioElement, VideoCharacterState, VideoTimelineDocument } from '../../../../shared/studio'
import { videoCharacterStateAt, videoCharacterTimelineLookup } from '../../../../shared/videoCharacterTimeline'

// width/height describe the visible crop of a particular pose. They are not
// actor-wide transforms: pose changes legitimately alter these dimensions.
type CharacterTransform = Pick<StudioElement, 'x' | 'y' | 'rotation' | 'flipX' | 'characterScale' | 'characterWidthScale' | 'characterHeightScale' | 'zIndex'>
const transformFields = ['x', 'y', 'rotation', 'flipX', 'characterScale', 'characterWidthScale', 'characterHeightScale', 'zIndex'] as const

function pickTransform(element: StudioElement): CharacterTransform {
  return Object.fromEntries(transformFields.filter((field) => element[field] !== undefined).map((field) => [field, element[field]])) as CharacterTransform
}

function equalTransform(left: CharacterTransform | undefined, right: CharacterTransform | undefined): boolean {
  return Boolean(left && right && transformFields.every((field) => left[field] === right[field]))
}

function pickCharacterTransform(source: Partial<StudioElement>): CharacterTransform {
  return Object.fromEntries(transformFields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]])) as CharacterTransform
}

/** Prefer the script-level transform; legacy scripts are migrated from their first authored state. */
function firstCharacterTransform(timeline: VideoTimelineDocument, elementId: string, fallback?: StudioElement): CharacterTransform | undefined {
  const global = timeline.characterTransforms?.[elementId]
  if (global && [global.x, global.y, global.rotation, global.zIndex].every(Number.isFinite)) return pickCharacterTransform(global)
  if (fallback) {
    const source = fallback
    const transform = pickTransform(source)
    const legacyPosition = timeline.characterPositions?.[elementId]
    return legacyPosition ? { ...transform, x: legacyPosition.x, y: legacyPosition.y } : transform
  }
  return videoCharacterTimelineLookup(timeline, elementId).stageTransform as CharacterTransform | undefined
}

function transformedElement(element: StudioElement, transform: CharacterTransform): StudioElement {
  return transformFields.every((field) => element[field] === transform[field]) ? element : { ...element, ...transform }
}

function transformedState(state: VideoCharacterState, transform: CharacterTransform): VideoCharacterState {
  const element = transformedElement(state.element, transform)
  return element === state.element ? state : { ...state, element }
}

function applyCharacterTransforms(studio: StudioDocument, transforms: Map<string, CharacterTransform>): StudioDocument {
  const timeline = studio.videoTimeline
  if (!timeline || !transforms.size) return studio
  let changed = false
  const elements = studio.elements.map((element) => {
    const transform = transforms.get(element.id)
    if (!transform) return element
    const next = transformedElement(element, transform)
    if (next === element) return element
    changed = true
    return next
  })
  const characterBases = Object.fromEntries(Object.entries(timeline.characterBases ?? {}).map(([id, state]) => {
    const transform = transforms.get(id), next = transform ? transformedState(state, transform) : state
    if (next !== state) changed = true
    return [id, next]
  }))
  const characterKeys = timeline.characterKeys.map((key) => {
    const transform = transforms.get(key.elementId)
    if (!transform || !key.state) return key
    const state = transformedState(key.state, transform)
    if (state === key.state) return key
    changed = true
    return { ...key, state }
  })
  const characterTransforms = { ...(timeline.characterTransforms ?? {}) }
  const characterPositions = { ...(timeline.characterPositions ?? {}) }
  for (const [id, transform] of transforms) {
    if (!equalTransform(characterTransforms[id], transform)) {
      characterTransforms[id] = transform
      changed = true
    }
    if (characterPositions[id]?.x !== transform.x || characterPositions[id]?.y !== transform.y) {
      characterPositions[id] = { x: transform.x, y: transform.y }
      changed = true
    }
  }
  return changed ? { ...studio, elements, videoTimeline: { ...timeline, characterTransforms, characterPositions, ...(timeline.characterBases ? { characterBases } : {}), characterKeys } } : studio
}

/** Migrate older scripts once while preserving segment-local pose, expression and artwork. */
export function normalizeVideoCharacterTransforms(studio: StudioDocument): StudioDocument {
  if (!studio.videoTimeline) return studio
  const transforms = new Map<string, CharacterTransform>()
  for (const element of studio.elements) {
    if (element.kind !== 'character') continue
    const transform = firstCharacterTransform(studio.videoTimeline, element.id, element)
    if (transform) transforms.set(element.id, transform)
  }
  return applyCharacterTransforms(studio, transforms)
}

/** Any stage/inspector transform edit changes the actor's single script-wide placement. */
export function synchronizeVideoCharacterTransforms(before: StudioDocument, after: StudioDocument): StudioDocument {
  if (before === after || !after.videoTimeline) return after
  const previous = new Map(before.elements.filter((element) => element.kind === 'character').map((element) => [element.id, element]))
  const edited = new Map<string, CharacterTransform>()
  for (const element of after.elements) {
    const original = previous.get(element.id)
    if (element.kind !== 'character' || !original) continue
    const transform = pickTransform(element)
    if (transformFields.some((field) => element[field] !== original[field])) edited.set(element.id, transform)
  }
  if (edited.size) return applyCharacterTransforms(after, edited)
  return normalizeVideoCharacterTransforms(after)
}

/** Apply the fixed transform after any sampled transition or blink geometry. */
export function videoCharacterStageElement(timeline: VideoTimelineDocument, element: StudioElement): StudioElement {
  if (element.kind !== 'character') return element
  const transform = firstCharacterTransform(timeline, element.id)
  return transform ? transformedElement(element, transform) : element
}

export function captureVideoCharacter(studio: StudioDocument, element: StudioElement): VideoCharacterState | null {
  const imageDataUrl = studio.assets.find((asset) => asset.id === element.assetId)?.dataUrl
  return element.kind === 'character' && imageDataUrl ? { element: structuredClone(element), imageDataUrl } : null
}

export function characterStateAt(timeline: VideoTimelineDocument, elementId: string, frame: number): VideoCharacterState | undefined {
  return videoCharacterStateAt(timeline, elementId, frame)
}

export function restoreVideoTracks(studio: StudioDocument, frame: number): StudioDocument {
  studio = normalizeVideoCharacterTransforms(studio)
  const timeline = studio.videoTimeline
  if (!timeline) return studio
  const states = new Map(studio.elements.filter((element) => element.kind === 'character').map((element) => [element.id, characterStateAt(timeline, element.id, frame)]))
  return {
    ...studio,
    elements: studio.elements.map((element) => {
      if (element.kind === 'speech' || element.kind === 'thought') {
        const clip = timeline.textClips.find((item) => item.elementId === element.id && item.startFrame <= frame && frame < item.endFrame)
        return clip?.state ? structuredClone(clip.state) : element
      }
      const state = states.get(element.id)
      return state ? structuredClone(state.element) : element
    }),
    assets: studio.assets.map((asset) => {
      const element = studio.elements.find((item) => item.assetId === asset.id && item.kind === 'character')
      const state = element ? states.get(element.id) : undefined
      return state ? { ...asset, dataUrl: state.imageDataUrl, mimeType: 'image/png' } : asset
    })
  }
}

export function videoCharacterStateEquals(left: VideoCharacterState | undefined, right: VideoCharacterState | undefined): boolean {
  return Boolean(left && right && left.imageDataUrl === right.imageDataUrl && JSON.stringify(left.element) === JSON.stringify(right.element))
}
