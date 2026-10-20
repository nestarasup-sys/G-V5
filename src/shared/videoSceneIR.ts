import type { StudioElement, VideoCharacterState, VideoClipTransform, VideoTimelineDocument as Timeline } from './studio'
import type { VideoExportSnapshot } from './videoExportSnapshot'
import { compileVideoCharacterTransitions, type VideoCharacterTransition } from './videoCharacterTransitions'
import { automaticBlinkFrameFor } from './videoFrame'
import { videoCharacterStateAt, videoCharacterTimelineLookup, type VideoCharacterTimelineLookup } from './videoCharacterTimeline'

export type RenderVariant = 'animated' | 'static-characters'

export type VideoSceneProgram = Readonly<{
  snapshot: VideoExportSnapshot
  variant: RenderVariant
  characterLookups: ReadonlyMap<string, VideoCharacterTimelineLookup>
  transitionsByCharacter: ReadonlyMap<string, ReadonlyArray<CompiledTransition>>
  gapsByCharacter: ReadonlyMap<string, IntervalIndex<NonNullable<Timeline['characterGaps']>[number]>>
  textIntervals: IntervalIndex<Timeline['textClips'][number]>
  videoIntervals: IntervalIndex<NonNullable<Timeline['videoClips']>[number]>
  assetsById: ReadonlyMap<string, string>
  elementsById: ReadonlyMap<string, StudioElement>
  artworkTokens: ReadonlyMap<string, number>
}>

type IndexedInterval<T> = Readonly<{ item: T; startFrame: number; endFrame: number; order: number }>
type IntervalIndex<T> = Readonly<{ items: ReadonlyArray<IndexedInterval<T>>; prefixMaxEnd: ReadonlyArray<number> }>

export type CompiledTransition = VideoCharacterTransition

export type EvaluatedCharacter = Readonly<{
  elementId: string
  hidden: boolean
  authoredState?: VideoCharacterState
  /** Applied after pose interpolation, matching the current Video Studio stage transform. */
  stageTransform?: Partial<StudioElement>
  transition?: Readonly<{ startFrame: number; boundaryFrame: number; from: VideoCharacterState; to: VideoCharacterState; progress: number; easedProgress: number }>
  automaticMouth?: Readonly<{ mode: 'talk' | 'idle'; speechStartFrame: number }>
  automaticBlink: boolean
}>

export type VideoSceneLayer =
  | Readonly<{ type: 'element'; kind: StudioElement['kind']; element: StudioElement; zOrder: number; documentOrder: number; assetDataUrl?: string; clipId?: string }>
  | Readonly<{ type: 'video'; kind: 'video'; clipId: string; assetId: string; sourceTick: number; sourceTimeNumerator: number; sourceTimeDenominator: 60; transform?: VideoClipTransform; zOrder: 1; documentOrder: number }>

export type VideoSceneFrame = Readonly<{
  frame: number
  timestampNumerator: number
  timestampDenominator: 60
  variant: RenderVariant
  background: Readonly<{ color: string; assetDataUrl?: string; x: number; y: number; width: number; height: number; rotation: number }>
  characters: ReadonlyArray<EvaluatedCharacter>
  layers: ReadonlyArray<VideoSceneLayer>
  videos: ReadonlyArray<Readonly<{ clipId: string; assetId: string; sourceTick: number; sourceTimeNumerator: number; sourceTimeDenominator: 60; transform?: VideoClipTransform; zOrder: 1 }>>
  /** Exact within one compiled program; equal keys guarantee equal canonical pixels. */
  reuseKey: string
}>

function buildIntervalIndex<T>(items: ReadonlyArray<T>, getStart: (item: T) => number, getEnd: (item: T) => number): IntervalIndex<T> {
  const indexed = items.flatMap((item, order) => {
    const startFrame = getStart(item), endFrame = getEnd(item)
    return Number.isSafeInteger(startFrame) && Number.isSafeInteger(endFrame) && startFrame <= endFrame
      ? [{ item, startFrame, endFrame, order }]
      : []
  }).sort((a, b) => a.startFrame - b.startFrame || a.order - b.order)
  let maxEnd = Number.NEGATIVE_INFINITY
  const prefixMaxEnd = indexed.map((entry) => { maxEnd = Math.max(maxEnd, entry.endFrame); return maxEnd })
  return { items: indexed, prefixMaxEnd }
}

function activeIntervals<T>(index: IntervalIndex<T>, frame: number): IndexedInterval<T>[] {
  let low = 0, high = index.prefixMaxEnd.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (index.prefixMaxEnd[middle] <= frame) low = middle + 1
    else high = middle
  }
  const first = low
  low = first; high = index.items.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (index.items[middle].startFrame <= frame) low = middle + 1
    else high = middle
  }
  return index.items.slice(first, low).filter((entry) => entry.endFrame > frame).sort((a, b) => a.order - b.order)
}

function stateAt(program: VideoSceneProgram, elementId: string, frame: number): VideoCharacterState | undefined {
  const lookup = program.characterLookups.get(elementId)
  return lookup ? videoCharacterStateAt(program.snapshot.timeline, elementId, frame, lookup) : undefined
}

function activeTransition(program: VideoSceneProgram, elementId: string, frame: number) {
  if (program.variant !== 'animated' || program.snapshot.timeline.animateCharacterTransitions === false) return undefined
  const transitions = program.transitionsByCharacter.get(elementId) ?? []
  let low = 0, high = transitions.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (transitions[middle].boundaryFrame <= frame) low = middle + 1
    else high = middle
  }
  const transition = transitions[low]
  if (!transition) return undefined
  if (frame <= transition.startFrame) return undefined
  const progress = Math.max(0, Math.min(1, (frame - transition.startFrame) / (transition.boundaryFrame - transition.startFrame)))
  return { startFrame: transition.startFrame, boundaryFrame: transition.boundaryFrame, from: transition.from, to: transition.to, progress, easedProgress: progress * progress * (3 - 2 * progress) }
}

function activeMouthModes(activeText: ReadonlyArray<Timeline['textClips'][number]>, frame: number, elementsById: ReadonlyMap<string, StudioElement>) {
  const modes = new Map<string, { mode: 'talk' | 'idle'; speechStartFrame: number }>()
  for (const clip of activeText) {
    const balloon = clip.state ?? elementsById.get(clip.elementId)
    const speakerId = balloon?.speakerCharacterId
    if (!speakerId) continue
    if (clip.kind === 'speech') {
      const previous = modes.get(speakerId)
      modes.set(speakerId, { mode: 'talk', speechStartFrame: previous?.mode === 'talk' ? Math.min(previous.speechStartFrame, clip.startFrame) : clip.startFrame })
    } else if (modes.get(speakerId)?.mode !== 'talk') {
      modes.set(speakerId, { mode: 'idle', speechStartFrame: frame })
    }
  }
  return modes
}

/** Compile immutable indexes and animation spans once for deterministic absolute-frame evaluation. */
export function compileVideoScene(snapshot: VideoExportSnapshot, variant: RenderVariant): VideoSceneProgram {
  // Job manifests and IPC deserialize untyped inputs: a TypeScript union is not a runtime guard.
  // Never silently fall back to animated behavior for an unknown export profile.
  if (variant !== 'animated' && variant !== 'static-characters') {
    throw new Error('Variante de renderização de vídeo inválida.')
  }
  const characterLookups = new Map<string, VideoCharacterTimelineLookup>()
  const transitionsByCharacter = new Map<string, CompiledTransition[]>()
  const gapsByCharacter = new Map<string, IntervalIndex<NonNullable<Timeline['characterGaps']>[number]>>()
  const gapsByElement = new Map<string, NonNullable<Timeline['characterGaps']>[number][]>()
  for (const gap of snapshot.timeline.characterGaps ?? []) {
    const existing = gapsByElement.get(gap.elementId)
    if (existing) existing.push(gap)
    else gapsByElement.set(gap.elementId, [gap])
  }
  for (const transition of compileVideoCharacterTransitions(snapshot.studio)) {
    const current = transitionsByCharacter.get(transition.elementId) ?? []
    current.push(transition)
    transitionsByCharacter.set(transition.elementId, current)
  }
  for (const element of snapshot.studio.elements) {
    if (element.kind !== 'character') continue
    const lookup = videoCharacterTimelineLookup(snapshot.timeline, element.id)
    characterLookups.set(element.id, lookup)
    transitionsByCharacter.set(element.id, transitionsByCharacter.get(element.id) ?? [])
    gapsByCharacter.set(element.id, buildIntervalIndex(gapsByElement.get(element.id) ?? [], (gap) => gap.startFrame, (gap) => gap.endFrame))
  }
  const assetsById = new Map(snapshot.studio.assets.flatMap((asset) => asset.dataUrl ? [[asset.id, asset.dataUrl] as const] : []))
  const elementsById = new Map(snapshot.studio.elements.map((element) => [element.id, element]))
  const artworkTokens = new Map<string, number>()
  const rememberArtwork = (source: string | undefined) => {
    if (source && !artworkTokens.has(source)) artworkTokens.set(source, artworkTokens.size + 1)
  }
  for (const asset of snapshot.studio.assets) rememberArtwork(asset.dataUrl)
  for (const state of Object.values(snapshot.timeline.characterBases ?? {})) rememberArtwork(state.imageDataUrl)
  for (const key of snapshot.timeline.characterKeys) rememberArtwork(key.state?.imageDataUrl)
  return {
    snapshot,
    variant,
    characterLookups,
    transitionsByCharacter,
    gapsByCharacter,
    textIntervals: buildIntervalIndex(snapshot.timeline.textClips, (clip) => clip.startFrame, (clip) => clip.endFrame),
    videoIntervals: buildIntervalIndex(snapshot.timeline.videoClips ?? [], (clip) => clip.startFrame, (clip) => clip.endFrame),
    assetsById,
    elementsById,
    artworkTokens,
  }
}

/** Produce a semantic frame description; rasterization and external assets are separate backends. */
export function evaluateVideoSceneFrame(program: VideoSceneProgram, frame: number): VideoSceneFrame {
  const { studio, timeline } = program.snapshot
  if (!Number.isSafeInteger(frame) || frame < 0 || frame >= program.snapshot.durationFrames) throw new RangeError('Frame fora do intervalo do programa de cena.')
  const activeTextClips = activeIntervals(program.textIntervals, frame).map((entry) => entry.item)
  const activeTextByElementId = new Map<string, Timeline['textClips'][number]>()
  for (const clip of activeTextClips) if (!activeTextByElementId.has(clip.elementId)) activeTextByElementId.set(clip.elementId, clip)
  const videoClips = activeIntervals(program.videoIntervals, frame).map((entry) => entry.item)
  const mouthModes = program.variant === 'animated' && timeline.animateCharacterTransitions !== false
    ? activeMouthModes(activeTextClips, frame, program.elementsById)
    : new Map()
  const statesByCharacter = new Map<string, VideoCharacterState | undefined>()
  const hiddenCharacterIds = new Set<string>()
  const characters: EvaluatedCharacter[] = studio.elements.filter((element) => element.kind === 'character').map((element) => {
    const hidden = (program.gapsByCharacter.get(element.id)?.items.length ?? 0) > 0
      && activeIntervals(program.gapsByCharacter.get(element.id)!, frame).length > 0
    if (hidden) hiddenCharacterIds.add(element.id)
    const transition = hidden ? undefined : activeTransition(program, element.id, frame)
    const mouth = !hidden && !transition && program.variant === 'animated' ? mouthModes.get(element.id) : undefined
    const automaticBlink = !hidden && !transition && !mouth && program.variant === 'animated'
      && automaticBlinkFrameFor(frame, element.id, program.snapshot.frameRate)
    const authoredState = stateAt(program, element.id, frame)
    statesByCharacter.set(element.id, authoredState)
    return {
      elementId: element.id,
      hidden,
      authoredState,
      ...(transition ? { transition, ...(program.characterLookups.get(element.id)?.stageTransform ? { stageTransform: program.characterLookups.get(element.id)!.stageTransform } : {}) } : {}),
      ...(mouth ? { automaticMouth: mouth } : {}),
      automaticBlink,
    }
  })
  const activeText = activeTextByElementId
  const layers: VideoSceneLayer[] = []
  studio.elements.forEach((element, documentOrder) => {
    if (element.kind === 'character' && hiddenCharacterIds.has(element.id)) return
    const clip = activeText.get(element.id)
    if ((element.kind === 'speech' || element.kind === 'thought') && !clip) return
    const characterState = element.kind === 'character' ? statesByCharacter.get(element.id) : undefined
    const effective = element.kind === 'character'
      ? characterState?.element ?? element
      : clip?.state ?? element
    const assetDataUrl = element.kind === 'character'
      ? characterState?.imageDataUrl
      : program.assetsById.get(effective.assetId ?? '')
    layers.push({ type: 'element', kind: effective.kind, element: effective, zOrder: effective.zIndex + 2, documentOrder: documentOrder + 1, ...(assetDataUrl ? { assetDataUrl } : {}), ...(clip ? { clipId: clip.id } : {}) })
  })
  const videos = videoClips.map((clip) => {
    const sourceTick = clip.sourceStartFrame + frame - clip.startFrame
    return { clipId: clip.id, assetId: clip.assetId, sourceTick, sourceTimeNumerator: sourceTick, sourceTimeDenominator: 60 as const, ...(clip.transform ? { transform: clip.transform } : {}), zOrder: 1 as const }
  })
  videos.forEach((video, documentOrder) => layers.push({ type: 'video', kind: 'video', ...video, documentOrder }))
  layers.sort((a, b) => a.zOrder - b.zOrder || a.documentOrder - b.documentOrder)

  const reuseKey = JSON.stringify([
    program.variant,
    characters.map((character) => {
      if (character.hidden) return [character.elementId, 'hidden']
      const element = character.authoredState?.element
      const geometry = element ? [
        element.x, element.y, element.width, element.height, element.rotation, element.zIndex,
        element.flipX === true, element.characterScale ?? 100, element.characterWidthScale ?? 100,
        element.characterHeightScale ?? 100, element.text ?? '', element.timelineColor ?? '',
        element.poseSlot ?? null,
        element.activeFaceMode ?? null,
        element.activeExpressionPresetId ?? null,
        element.faceAppearance ?? null,
        element.faceTransforms ?? null,
        element.activeExpressionEffects ?? null,
      ] : []
      const artwork = character.authoredState?.imageDataUrl
        ? program.artworkTokens.get(character.authoredState.imageDataUrl) ?? -1
        : -1
      if (character.transition) return [character.elementId, 'transition', frame, artwork, geometry]
      if (character.automaticMouth) {
        const phase = character.automaticMouth.mode === 'talk'
          ? Math.floor((Math.max(0, frame - character.automaticMouth.speechStartFrame) % 36) / 6)
          : 0
        return [character.elementId, 'mouth', character.automaticMouth.mode, phase, artwork, geometry]
      }
      if (character.automaticBlink) return [character.elementId, 'blink', artwork, geometry]
      return [character.elementId, 'static', artwork, geometry]
    }),
    layers.map((layer) => layer.type === 'video'
      ? ['video', layer.clipId, layer.sourceTick]
      : [layer.kind, layer.element.id, layer.clipId ?? '', layer.zOrder]),
  ])

  return {
    frame,
    timestampNumerator: frame,
    timestampDenominator: 60,
    variant: program.variant,
    background: {
      color: studio.backgroundColor,
      ...(program.assetsById.get(studio.backgroundAssetId ?? '') ? { assetDataUrl: program.assetsById.get(studio.backgroundAssetId ?? '') } : {}),
      x: studio.backgroundX, y: studio.backgroundY, width: studio.backgroundWidth, height: studio.backgroundHeight, rotation: studio.backgroundRotation,
    },
    characters,
    layers,
    videos,
    reuseKey,
  }
}
