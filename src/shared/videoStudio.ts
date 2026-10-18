import type { StudioAsset } from './studio'

/**
 * Independent Video Studio project. No StudioDocument or Fabricator document is
 * written by this domain. Units: canvas pixels, integer timeline frames.
 */
export type VideoFaceMode = 'idle' | 'blink' | 'talk'
export type VideoAsset = StudioAsset

export interface VideoActorState {
  poseId: string | null
  expressionId: string | null
  faceMode: VideoFaceMode
}

export interface VideoStateSegment {
  id: string
  startFrame: number
  endFrameExclusive: number
  state: VideoActorState
  /** Reserved for deterministic crossfade rendering; never changes segment timing. */
  transitionInMs: number
}

export interface VideoCharacterTrack {
  id: string
  elementId: string
  name: string
  order: number
  locked: boolean
  collapsed: boolean
  segments: VideoStateSegment[]
}

export interface VideoSceneElement {
  id: string
  kind: 'character' | 'image'
  name: string
  assetId: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  zIndex: number
  flipX: boolean
  /** Per-actor sprite roles; later replaced by a G-V5 character renderer adapter. */
  faceAssets?: Partial<Record<VideoFaceMode, string>>
}

export interface VideoTextClip {
  id: string
  startFrame: number
  endFrameExclusive: number
  text: string
  characterId?: string
}

export interface VideoTextTrack {
  id: string
  kind: 'dialogue' | 'thought'
  name: string
  clips: VideoTextClip[]
  locked: boolean
  collapsed: boolean
}

export interface VideoSaveMarker {
  frame: number
  affectedTrackIds: string[]
}

export interface VideoProject {
  schemaVersion: 1
  id: string
  title: string
  color: string
  createdAt: string
  updatedAt: string
  frameRate: number
  durationFrames: number
  canvas: {
    width: number
    height: number
    backgroundColor: string
    backgroundAssetId: string | null
    /** Position/size in Studio percentages; x/y are offsets from canvas center. */
    backgroundPlacement?: { x: number; y: number; width: number; height: number; rotation: number }
  }
  assets: VideoAsset[]
  elements: VideoSceneElement[]
  characterTracks: VideoCharacterTrack[]
  textTracks: VideoTextTrack[]
  saveMarkers: VideoSaveMarker[]
}

export interface VideoStudioDesktopApi {
  listVideoProjects: () => Promise<VideoProject[]>
  saveVideoProject: (project: VideoProject) => Promise<void>
  deleteVideoProject: (id: string) => Promise<void>
  getVideoProjectFolder: () => Promise<string>
  importVideoImage: (category: VideoAsset['category']) => Promise<VideoAsset | null>
}

export const VIDEO_STUDIO_DEFAULT_FPS = 60
export const VIDEO_STUDIO_DEFAULT_DURATION = 600 * VIDEO_STUDIO_DEFAULT_FPS

export function createVideoProject(id: string, title: string, now: string): VideoProject {
  return {
    schemaVersion: 1, id, title, color: '#d8a1ca', createdAt: now, updatedAt: now,
    frameRate: VIDEO_STUDIO_DEFAULT_FPS, durationFrames: VIDEO_STUDIO_DEFAULT_DURATION,
    canvas: { width: 1920, height: 1080, backgroundColor: '#d7b5cd', backgroundAssetId: null },
    assets: [], elements: [], characterTracks: [],
    textTracks: [
      { id: 'dialogue', kind: 'dialogue', name: 'Falas', clips: [], locked: false, collapsed: false },
      { id: 'thought', kind: 'thought', name: 'Pensamentos', clips: [], locked: false, collapsed: false }
    ],
    saveMarkers: []
  }
}
