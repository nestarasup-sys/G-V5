import type { StudioDocument, StudioElement, VideoCharacterState, VideoTimelineDocument } from '../../../../shared/studio'

type CharacterPosition = Pick<StudioElement, 'x' | 'y'>

/** Prefer the script-level placement; legacy scripts are migrated from their first saved state. */
function firstCharacterPosition(timeline: VideoTimelineDocument, elementId: string, fallback?: CharacterPosition): CharacterPosition | undefined {
  const global = timeline.characterPositions?.[elementId]
  if (global && Number.isFinite(global.x) && Number.isFinite(global.y)) return global
  let first: VideoTimelineDocument['characterKeys'][number] | undefined
  for (const key of timeline.characterKeys) {
    if (key.elementId === elementId && key.state && (!first || key.frame <= first.frame)) first = key
  }
  return first?.frame === 0 ? first.state!.element : timeline.characterBases?.[elementId]?.element ?? first?.state?.element ?? fallback
}

function positionedState(state: VideoCharacterState, position: CharacterPosition): VideoCharacterState {
  return state.element.x === position.x && state.element.y === position.y ? state : { ...state, element: { ...state.element, x: position.x, y: position.y } }
}

function applyCharacterPositions(studio: StudioDocument, positions: Map<string, CharacterPosition>): StudioDocument {
  const timeline = studio.videoTimeline
  if (!timeline || !positions.size) return studio
  let changed = false
  const elements = studio.elements.map((element) => {
    const position = positions.get(element.id)
    if (!position || element.x === position.x && element.y === position.y) return element
    changed = true
    return { ...element, x: position.x, y: position.y }
  })
  const characterBases = Object.fromEntries(Object.entries(timeline.characterBases ?? {}).map(([id, state]) => {
    const position = positions.get(id), next = position ? positionedState(state, position) : state
    if (next !== state) changed = true
    return [id, next]
  }))
  const characterKeys = timeline.characterKeys.map((key) => {
    const position = positions.get(key.elementId)
    if (!position || !key.state) return key
    const state = positionedState(key.state, position)
    if (state === key.state) return key
    changed = true
    return { ...key, state }
  })
  const characterPositions = { ...(timeline.characterPositions ?? {}) }
  for (const [id, position] of positions) {
    if (characterPositions[id]?.x === position.x && characterPositions[id]?.y === position.y) continue
    characterPositions[id] = { x: position.x, y: position.y }
    changed = true
  }
  return changed ? { ...studio, elements, videoTimeline: { ...timeline, characterPositions, ...(timeline.characterBases ? { characterBases } : {}), characterKeys } } : studio
}

/** Normalize legacy scripts once and persist the authoritative position without changing acting states. */
export function normalizeVideoCharacterPositions(studio: StudioDocument): StudioDocument {
  if (!studio.videoTimeline) return studio
  const positions = new Map<string, CharacterPosition>()
  for (const element of studio.elements) {
    if (element.kind === 'character') positions.set(element.id, firstCharacterPosition(studio.videoTimeline, element.id, element)!)
  }
  return applyCharacterPositions(studio, positions)
}

/** A stage/inspector move changes the script-level position for that actor alone. */
export function synchronizeVideoCharacterPositions(before: StudioDocument, after: StudioDocument): StudioDocument {
  if (before === after || !after.videoTimeline) return after
  const previous = new Map(before.elements.filter((element) => element.kind === 'character').map((element) => [element.id, element]))
  const edited = new Map<string, CharacterPosition>()
  for (const element of after.elements) {
    const original = previous.get(element.id)
    if (element.kind === 'character' && original && (element.x !== original.x || element.y !== original.y)) edited.set(element.id, element)
  }
  if (edited.size) return applyCharacterPositions(after, edited)
  return normalizeVideoCharacterPositions(after)
}

/** Apply the fixed stage position after any sampled transition or blink geometry. */
export function videoCharacterStageElement(timeline: VideoTimelineDocument, element: StudioElement): StudioElement {
  if (element.kind !== 'character') return element
  const position = firstCharacterPosition(timeline, element.id)
  return position && (element.x !== position.x || element.y !== position.y) ? { ...element, x: position.x, y: position.y } : element
}

export function captureVideoCharacter(studio: StudioDocument, element: StudioElement): VideoCharacterState | null {
  const imageDataUrl = studio.assets.find((asset) => asset.id === element.assetId)?.dataUrl
  return element.kind === 'character' && imageDataUrl ? { element: structuredClone(element), imageDataUrl } : null
}

export function characterStateAt(timeline: VideoTimelineDocument, elementId: string, frame: number): VideoCharacterState | undefined {
  let current = timeline.characterBases?.[elementId]
  for (const key of timeline.characterKeys.filter((item) => item.elementId === elementId).sort((a, b) => a.frame - b.frame)) {
    if (key.frame > frame) break
    if (key.state) current = key.state
  }
  const position = firstCharacterPosition(timeline, elementId)
  return current && position ? positionedState(current, position) : current
}

export function restoreVideoTracks(studio: StudioDocument, frame: number): StudioDocument {
  studio = normalizeVideoCharacterPositions(studio)
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
