import type { StudioElement, VideoCharacterState, VideoTimelineDocument } from './studio'

export type VideoCharacterTimelineLookup = Readonly<{
  keys: ReadonlyArray<VideoTimelineDocument['characterKeys'][number]>
  stageTransform?: Partial<StudioElement>
}>

const transformFields = ['x', 'y', 'width', 'height', 'rotation', 'flipX', 'characterScale', 'characterWidthScale', 'characterHeightScale', 'zIndex'] as const
const lookupsByTimeline = new WeakMap<VideoTimelineDocument, Map<string, VideoCharacterTimelineLookup>>()

function createLookup(timeline: VideoTimelineDocument, elementId: string): VideoCharacterTimelineLookup {
  const keys = timeline.characterKeys.filter((key) => key.elementId === elementId).sort((left, right) => left.frame - right.frame)
  const global = timeline.characterTransforms?.[elementId]
  if (global && [global.x, global.y, global.width, global.height, global.rotation, global.zIndex].every(Number.isFinite)) {
    return { keys, stageTransform: global }
  }
  let first: VideoTimelineDocument['characterKeys'][number] | undefined
  for (const key of keys) {
    if (key.state && (!first || key.frame <= first.frame)) first = key
  }
  const source = first?.frame === 0 ? first.state?.element : timeline.characterBases?.[elementId]?.element ?? first?.state?.element
  if (!source) return { keys }
  const transform = Object.fromEntries(transformFields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]])) as Partial<StudioElement>
  const position = timeline.characterPositions?.[elementId]
  return { keys, stageTransform: position ? { ...transform, x: position.x, y: position.y } : transform }
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
  const keys = lookup.keys
  let current = timeline.characterBases?.[elementId]
  let low = 0, high = keys.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (keys[middle].frame <= frame) low = middle + 1
    else high = middle
  }
  for (let index = low - 1; index >= 0; index -= 1) {
    if (keys[index].state) { current = keys[index].state; break }
  }
  if (!current || !lookup.stageTransform || transformFields.every((field) => current!.element[field] === lookup.stageTransform![field])) return current
  return { ...current, element: { ...current.element, ...lookup.stageTransform } }
}
