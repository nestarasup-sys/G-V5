import type { StudioElement, VideoCharacterState, VideoTimelineDocument } from './studio'

export type VideoCharacterTimelineLookup = Readonly<{
  keys: ReadonlyArray<VideoTimelineDocument['characterKeys'][number]>
  /** Index only authored visual states; sparse metadata keys never force a linear backward scan. */
  stateKeys: ReadonlyArray<VideoTimelineDocument['characterKeys'][number]>
  stageTransform?: Partial<StudioElement>
}>

// Stage transforms are actor-wide. The element's width/height are pose-local
// visible-crop geometry and must remain attached to each authored state.
const transformFields = ['x', 'y', 'rotation', 'flipX', 'characterScale', 'characterWidthScale', 'characterHeightScale', 'zIndex'] as const
const lookupsByTimeline = new WeakMap<VideoTimelineDocument, Map<string, VideoCharacterTimelineLookup>>()

function createLookup(timeline: VideoTimelineDocument, elementId: string): VideoCharacterTimelineLookup {
  const keys = timeline.characterKeys.filter((key) => key.elementId === elementId).sort((left, right) => left.frame - right.frame)
  const stateKeys = keys.filter((key) => key.state)
  const global = timeline.characterTransforms?.[elementId]
  if (global && [global.x, global.y, global.rotation, global.zIndex].every(Number.isFinite)) {
    const stageTransform = Object.fromEntries(transformFields.filter((field) => global[field] !== undefined).map((field) => [field, global[field]])) as Partial<StudioElement>
    return { keys, stateKeys, stageTransform }
  }
  let first: VideoTimelineDocument['characterKeys'][number] | undefined
  for (const key of stateKeys) {
    if (!first || key.frame <= first.frame) first = key
  }
  const source = first?.frame === 0 ? first.state?.element : timeline.characterBases?.[elementId]?.element ?? first?.state?.element
  if (!source) return { keys, stateKeys }
  const transform = Object.fromEntries(transformFields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]])) as Partial<StudioElement>
  const position = timeline.characterPositions?.[elementId]
  return { keys, stateKeys, stageTransform: position ? { ...transform, x: position.x, y: position.y } : transform }
}

/** Reusable per-timeline key index and script-wide transform. */
export function videoCharacterTimelineLookup(timeline: VideoTimelineDocument, elementId: string): VideoCharacterTimelineLookup {
  let lookups = lookupsByTimeline.get(timeline)
  if (!lookups) { lookups = new Map(); lookupsByTimeline.set(timeline, lookups) }
  let lookup = lookups.get(elementId)
  if (!lookup) { lookup = createLookup(timeline, elementId); lookups.set(elementId, lookup) }
  return lookup
}

/** Resolve the last authored state at or before an absolute frame, independent of UI transport. */
export function videoCharacterStateAt(
  timeline: VideoTimelineDocument,
  elementId: string,
  frame: number,
  lookup = videoCharacterTimelineLookup(timeline, elementId),
): VideoCharacterState | undefined {
  // Binary-search only keys that actually contain artwork. Metadata-only keys
  // may be extremely numerous in long scripts, but cannot change the state.
  const keys = lookup.stateKeys
  let current = timeline.characterBases?.[elementId]
  let low = 0, high = keys.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (keys[middle].frame <= frame) low = middle + 1
    else high = middle
  }
  if (low > 0) current = keys[low - 1].state
  if (!current || !lookup.stageTransform || transformFields.every((field) => current!.element[field] === lookup.stageTransform![field])) return current
  return { ...current, element: { ...current.element, ...lookup.stageTransform } }
}
