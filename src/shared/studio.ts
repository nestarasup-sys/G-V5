import type { CustomizerFaceAppearance } from './customizer'

export type StudioAsset = {
  id: string
  category: 'background' | 'object' | 'character'
  name: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  dataUrl: string
}

/** Studio-local adjustment shared by a facial category and its variant frames. */
export type StudioFaceTransform = { x: number; y: number; width: number; height: number; rotation: number }
export type StudioFaceTransformCategory = 'eyes' | 'eyebrows' | 'nose' | 'mouth'
/** Keys are category:itemId; bare category keys remain supported for older Studio data. */
export type StudioFaceTransforms = Record<string, StudioFaceTransform>

export type StudioElement = {
  id: string
  kind: 'image' | 'character' | 'narrator' | 'speech' | 'thought'
  assetId?: string
  characterId?: string
  flipX?: boolean
  /** Prevents mouse dragging this character inside this Studio. */
  positionLocked?: boolean
  /** Face choices made to this actor inside this Studio only. */
  faceAppearance?: CustomizerFaceAppearance
  /** Face-piece transforms are stored per selected catalog sheet on this Studio actor. */
  faceTransforms?: StudioFaceTransforms
  /** Pose selected for this actor inside this Studio only. */
  poseSlot?: number | null
  /** Uniform actor size and independent axis squeeze, in percent of its saved base size. */
  characterScale?: number
  characterWidthScale?: number
  characterHeightScale?: number
  /** Width of the untrimmed character artwork relative to the Studio canvas. */
  characterCanvasWidth?: number
  text: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  zIndex: number
}

export type StudioTimelineTrackKind = 'character' | 'objects' | 'narrator' | 'speech' | 'thought' | 'background'
export type StudioTimelineTrack = {
  id: string
  kind: StudioTimelineTrackKind
  name: string
  elementId?: string
  order: number
  visible: boolean
  locked: boolean
  collapsed: boolean
}
export type StudioTimelineBackgroundState = Pick<StudioDocument,
  'backgroundColor' | 'backgroundAssetId' | 'backgroundX' | 'backgroundY' | 'backgroundWidth' | 'backgroundHeight' | 'backgroundRotation'>
export type StudioTimelineClip = {
  id: string
  trackId: string
  elementId: string | null
  startFrame: number
  endFrame: number
  state: { type: 'element'; element: StudioElement } | { type: 'background'; background: StudioTimelineBackgroundState }
}
export type StudioTimeline = {
  version: 1
  fps: 30
  durationFrames: number
  currentFrame: number
  loop: boolean
  speed: number
  tracks: StudioTimelineTrack[]
  clips: StudioTimelineClip[]
}

export type StudioDocument = {
  schemaVersion: 1
  id: string
  title: string
  color: string
  createdAt: string
  updatedAt: string
  backgroundColor: string
  backgroundAssetId: string | null
  backgroundX: number
  backgroundY: number
  backgroundWidth: number
  backgroundHeight: number
  backgroundRotation: number
  assets: StudioAsset[]
  elements: StudioElement[]
  timeline: StudioTimeline
}

const timelineTrackNames: Array<{ kind: Exclude<StudioTimelineTrackKind, 'character'>; name: string }> = [
  { kind: 'background', name: 'Fundo' },
  { kind: 'objects', name: 'Objetos' },
  { kind: 'narrator', name: 'Narrador' },
  { kind: 'speech', name: 'Falas' },
  { kind: 'thought', name: 'Pensamentos' }
]

export function createStudioTimeline(
  elements: StudioElement[],
  background: StudioTimelineBackgroundState,
  durationFrames = 18_000
): StudioTimeline {
  const tracks: StudioTimelineTrack[] = timelineTrackNames.map(({ kind, name }, order) => ({
    id: `lane:${kind}`, kind, name, order, visible: true, locked: false, collapsed: false
  }))
  const clips: StudioTimelineClip[] = [{
    id: crypto.randomUUID(), trackId: 'lane:background', elementId: null,
    startFrame: 0, endFrame: durationFrames,
    state: { type: 'background', background: { ...background } }
  }]
  for (const element of elements) {
    const kind: StudioTimelineTrackKind = element.kind === 'character'
      ? 'character'
      : element.kind === 'image' ? 'objects' : element.kind
    const trackId = kind === 'character' ? `character:${element.id}` : `lane:${kind}`
    if (kind === 'character') tracks.push({
      id: trackId, kind, name: element.text || 'Personagem', elementId: element.id,
      order: tracks.length, visible: true, locked: false, collapsed: false
    })
    clips.push({
      id: crypto.randomUUID(), trackId, elementId: element.id, startFrame: 0, endFrame: durationFrames,
      state: { type: 'element', element: { ...element } }
    })
  }
  return { version: 1, fps: 30, durationFrames, currentFrame: 0, loop: false, speed: 1, tracks, clips }
}

export type StudioDesktopApi = {
  listStudios: () => Promise<StudioDocument[]>
  saveStudio: (studio: StudioDocument) => Promise<void>
  deleteStudio: (id: string) => Promise<void>
  getStudioFolder: () => Promise<string>
  importStudioImage: (category: StudioAsset['category']) => Promise<StudioAsset | null>
  saveStudioPrint: (studioId: string, dataUrl: string) => Promise<string | null>
  openStudioPrints: (studioId: string) => Promise<void>
}
