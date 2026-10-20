import type { CustomizerFaceAppearance } from './customizer'
import type { FaceCatalogItemSummary, FaceExpressionEffects, FaceTransform } from './fabricator'
import type { VideoExportProgress, VideoExportRecoveryRecord, VideoExportStartRequest, VideoExportStartResult } from './videoExportRuntime'

export type StudioAsset = {
  id: string
  category: 'background' | 'object' | 'character'
  name: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  dataUrl: string
}

/** Studio-local adjustment shared by a facial category and its variant frames. */
export type StudioFaceTransform = { x: number; y: number; width: number; height: number; rotation: number; sourceTransformOverride?: FaceTransform }
export type StudioFaceTransformCategory = 'eyes' | 'eyebrows' | 'nose' | 'mouth'
/** Studio-local playback state for the character's neutral, blink, or speaking face. */
export type StudioFaceMode = 'idle' | 'blink' | 'talk'

/** Use the character's talk sheet, its legacy paired sheet, or the model's Dev default. */
export function resolveStudioTalkMouthId(
  appearance: Pick<CustomizerFaceAppearance, 'mouthOpenCatalogId' | 'mouthClosedCatalogId'> | undefined,
  catalog: readonly FaceCatalogItemSummary[]
): string | undefined {
  if (appearance?.mouthOpenCatalogId) return appearance.mouthOpenCatalogId
  const legacyClosed = appearance?.mouthClosedCatalogId?.match(/^legacy_(.+)_mouth-closed$/)
  const legacyTalkId = legacyClosed ? `legacy_${legacyClosed[1]}_mouth-open` : undefined
  const legacyTalk = legacyTalkId && catalog.find((item) => item.id === legacyTalkId && item.category === 'mouth-open')
  if (legacyTalk) return legacyTalk.id
  return catalog
    .filter((item) => item.category === 'mouth-open')
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR') || left.id.localeCompare(right.id))[0]?.id
}

/** Keys are category:itemId; bare category keys remain supported for older Studio data. */
export type StudioFaceTransforms = Record<string, StudioFaceTransform>
export type StudioExpressionBase = { appearance: CustomizerFaceAppearance; transforms: StudioFaceTransforms }

/** Shared persistence boundary for manual and expression-specific transforms. */
export function isStudioExpressionEffects(value: unknown): value is FaceExpressionEffects {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const effects = value as FaceExpressionEffects
  return (['shadow', 'blush', 'mouthBlush'] as const).every((key) => {
    const effect = effects[key]
    return Boolean(effect && typeof effect.enabled === 'boolean' && /^#[0-9a-f]{6}$/i.test(effect.color)
      && Number.isFinite(effect.opacity) && effect.opacity >= 0 && effect.opacity <= 1
      && Number.isFinite(effect.softness) && effect.softness >= 0 && effect.softness <= 1
      && Number.isFinite(effect.size) && effect.size >= 0.05 && effect.size <= 2
      && Number.isFinite(effect.offsetY) && effect.offsetY >= -0.5 && effect.offsetY <= 0.5
      && (effect.offsetX === undefined || Number.isFinite(effect.offsetX) && effect.offsetX >= -0.5 && effect.offsetX <= 0.5)
      && (effect.aspectRatio === undefined || Number.isFinite(effect.aspectRatio) && effect.aspectRatio >= 0.05 && effect.aspectRatio <= 2)
      && (effect.width === undefined || Number.isFinite(effect.width) && effect.width >= 0.01 && effect.width <= 2)
      && (effect.height === undefined || Number.isFinite(effect.height) && effect.height >= 0.01 && effect.height <= 2)
      && (effect.rotation === undefined || Number.isFinite(effect.rotation) && effect.rotation >= -180 && effect.rotation <= 180)
      && (effect.style === undefined || ['oval', 'cheeks', 'bands', 'diagonal', 'spot'].includes(effect.style)))
  })
}

export function isStudioFaceTransforms(value: unknown): value is StudioFaceTransforms {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(value).every(([key, entry]) => {
    const manual = /^(eyes|eyebrows|nose|mouth|mouth-closed|mouth-open)(:[^:]+)?$/i.test(key)
    const expression = /^expression-component:(eye|pupil|brow)-(left|right)$/.test(key)
      || /^expression:(eyes|eyebrows|eye-left|eye-right|brow-left|brow-right|nose|mouth-closed|mouth-open):[^:]+$/.test(key)
    if (!manual && !expression || !entry || typeof entry !== 'object') return false
    const transform = entry as Partial<StudioFaceTransform>
    if (![transform.x, transform.y, transform.width, transform.height, transform.rotation].every((number) => typeof number === 'number' && Number.isFinite(number))) return false
    const source = transform.sourceTransformOverride
    if (source === undefined) return true
    return Boolean(source) && typeof source === 'object' && [source.x, source.y, source.scaleX, source.scaleY, source.rotation].every(Number.isFinite)
      && source.scaleX > 0 && source.scaleY > 0 && (source.flipX === undefined || typeof source.flipX === 'boolean')
  })
}

export type StudioElement = {
  id: string
  kind: 'image' | 'character' | 'narrator' | 'speech' | 'thought'
  assetId?: string
  characterId?: string
  /** Video Studio lane color; stored with this scene instance, not the saved character. */
  timelineColor?: string
  /** Video Studio speech/thought bubbles belong to the actor selected at creation. */
  speakerCharacterId?: string
  speakerName?: string
  speakerColor?: string
  /** Customizer revision used to compose this actor's stored image. */
  characterSourceUpdatedAt?: string
  flipX?: boolean
  /** Prevents mouse dragging this character inside this Studio. */
  positionLocked?: boolean
  /** Face choices made to this actor inside this Studio only. */
  faceAppearance?: CustomizerFaceAppearance
  /** Studio-only facial playback state; does not modify the character's Customizer data. */
  activeFaceMode?: StudioFaceMode
  /** Face-piece transforms are stored per selected catalog sheet on this Studio actor. */
  faceTransforms?: StudioFaceTransforms
  /** Character-specific neutral face, shared by every expression collection. */
  expressionBase?: StudioExpressionBase
  activeExpressionPresetId?: string | null
  /** Saved preset revision currently composed into this Studio actor. */
  activeExpressionPresetUpdatedAt?: string
  /** Renderer revision used to generate the actor's cached Studio image. */
  faceRendererVersion?: number
  activeExpressionEffects?: FaceExpressionEffects
  /** Expression collection currently selected for this actor in the inspector. */
  activeExpressionCollectionId?: string
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

export const VIDEO_CHARACTER_TRACK_COLORS = ['#7768c8', '#5277b8', '#aa8264', '#478f83', '#b47a43', '#bd6386', '#4b91ad', '#8b6c9c'] as const

export function videoCharacterTrackColor(id: string, selected?: string): string {
  if (selected && /^#[0-9a-f]{6}$/i.test(selected)) return selected
  let hash = 0
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) | 0
  return VIDEO_CHARACTER_TRACK_COLORS[Math.abs(hash) % VIDEO_CHARACTER_TRACK_COLORS.length]
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
  /** Compressed snapshot of the latest saved composition, shown on the Studio card. */
  thumbnailDataUrl?: string
  assets: StudioAsset[]
  elements: StudioElement[]
  /** Present only in the independent Video Studio workspace. */
  videoTimeline?: VideoTimelineDocument
}

export type VideoTimelineDocument = {
  schemaVersion: 1
  frameRate: 60
  durationFrames: number
  playheadFrame: number
  playing: boolean
  /** Interpolate pose and expression changes during playback; defaults to enabled for older scenes. */
  animateCharacterTransitions?: boolean
  /** Video Studio control preferences stored independently in each project. */
  characterPositionsLocked?: boolean
  timelineZoom?: number
  timelineHeight?: number
  /** Persisted timeline UI metadata; visibility hides lanes and lock blocks edits. */
  trackSettings?: Record<string, { visible?: boolean; locked?: boolean; label?: string; collapsed?: boolean; order?: number }>
  /** Original state of each actor, retained when returning to the first segment. */
  characterBases?: Record<string, VideoCharacterState>
  /** One authoritative stage position per actor, shared by every segment and transition. */
  characterPositions?: Record<string, { x: number; y: number }>
  /** Global stage transforms; pose and expression remain authored per segment. */
  characterTransforms?: Record<string, Pick<StudioElement, 'x' | 'y' | 'rotation' | 'flipX' | 'characterScale' | 'characterWidthScale' | 'characterHeightScale' | 'zIndex'>>
  /** Empty intervals created by deleting a character segment, preserving adjacent states. */
  characterGaps?: Array<{ id: string; elementId: string; startFrame: number; endFrame: number }>
  /** Last visible authored frame boundary per character, retained when a block is resized. */
  characterTrackEnds?: Record<string, number>
  /** Imported media files live in this Studio project's dedicated videos folder. */
  videoAssets?: VideoStudioAsset[]
  /** Compressed still from the first video clip, used as this project's library cover. */
  coverDataUrl?: string
  /** Video clips use source duration in frames and are placed on the top timeline lane. */
  videoClips?: VideoMediaClip[]
  /** Project-wide video sound mix, restored with the timeline. */
  videoAudio?: VideoAudioSettings
  characterKeys: Array<{ id: string; elementId: string; frame: number; poseSlot: number | null; expressionCollectionId: string | null; expressionPresetId: string | null; faceMode: StudioFaceMode; state?: VideoCharacterState }>
  textClips: Array<{ id: string; elementId: string; kind: 'speech' | 'thought'; startFrame: number; endFrame: number; state?: StudioElement }>
  saveMarkers: Array<{ id: string; frame: number; affectedTrackIds: string[] }>
}

/** Timeline placement and the corresponding window inside the original video. */
export type VideoMediaClip = {
  id: string
  assetId: string
  startFrame: number
  endFrame: number
  sourceStartFrame: number
  sourceEndFrame: number
  /** Absent in older projects: original sound at full volume. */
  audio?: VideoAudioSettings
  /** Per-segment composition; omitted by older documents for the centered default. */
  transform?: VideoClipTransform
}

export type VideoClipTransform = { x: number; y: number; width: number; height: number; rotation: number }

export type VideoAudioSettings = { volume: number; muted: boolean }

export type VideoStudioAsset = {
  id: string
  name: string
  mimeType: 'video/mp4' | 'video/webm' | 'video/quicktime' | 'video/x-m4v'
  extension: 'mp4' | 'webm' | 'mov' | 'm4v'
  size: number
  durationFrames: number
}

export type VideoPreviewMedia = {
  sourceSha256: string
  proxyUrl: string
  waveformUrl: string | null
}

export type VideoLibraryItem = Omit<VideoStudioAsset, 'durationFrames'> & {
  durationFrames: number | null
  createdAt: string
  available: boolean
  studios: Array<{ id: string; title: string }>
}

export type VideoBackgroundLibraryItem = {
  id: string
  name: string
  mimeType: StudioAsset['mimeType']
  extension: 'png' | 'jpg' | 'jpeg' | 'webp'
  size: number
  createdAt: string
  available: boolean
  studios: Array<{ id: string; title: string }>
}

export type VideoExportRecord = {
  schemaVersion: 1
  id: string
  studioId: string
  studioTitle: string
  filename: string
  sizeBytes: number
  sha256: string
  width: 1920
  height: 1080
  frameRate: 60
  durationFrames: number
  videoCodec: 'h264'
  audioCodec: 'aac' | null
  createdAt: string
  available: boolean
}

/** A segment owns both its editable Studio properties and its composed artwork. */
export type VideoCharacterState = { element: StudioElement; imageDataUrl: string }

export type StudioDesktopApi = {
  flushPendingWrites: () => Promise<void>
  listStudios: () => Promise<StudioDocument[]>
  saveStudio: (studio: StudioDocument) => Promise<void>
  deleteStudio: (id: string) => Promise<void>
  getStudioFolder: () => Promise<string>
  importStudioImage: (category: StudioAsset['category']) => Promise<StudioAsset | null>
  saveStudioPrint: (studioId: string, dataUrl: string) => Promise<string | null>
  openStudioPrints: (studioId: string) => Promise<void>
}

/** Independent persistence boundary for the Video Studio workspace. */
export type VideoStudioCardSummary = Pick<StudioDocument, 'id' | 'title' | 'color' | 'createdAt' | 'updatedAt'> & {
  coverDataUrl?: string
}

export type VideoStudioDesktopApi = {
  listVideoStudios: () => Promise<VideoStudioCardSummary[]>
  loadVideoStudio: (id: string) => Promise<StudioDocument | null>
  saveVideoStudio: (studio: StudioDocument) => Promise<void>
  deleteVideoStudio: (id: string) => Promise<void>
  getVideoStudioFolder: () => Promise<string>
  importVideoStudioImage: (category: StudioAsset['category']) => Promise<StudioAsset | null>
  listVideoLibrary: () => Promise<VideoLibraryItem[]>
  importVideoLibrary: () => Promise<VideoLibraryItem | null>
  finishVideoLibraryImport: (id: string, durationFrames: number) => Promise<VideoLibraryItem>
  deleteVideoLibraryItem: (id: string) => Promise<void>
  renameVideoLibraryItem: (id: string, name: string) => Promise<VideoLibraryItem>
  attachVideoLibraryItems: (studioId: string, ids: string[]) => Promise<VideoStudioAsset[]>
  prepareVideoPreviewMedia: (studioId: string, asset: VideoStudioAsset) => Promise<VideoPreviewMedia>
  listVideoBackgroundLibrary: () => Promise<VideoBackgroundLibraryItem[]>
  importVideoBackground: () => Promise<VideoBackgroundLibraryItem | null>
  deleteVideoBackground: (id: string) => Promise<void>
  attachVideoBackground: (studioId: string, id: string) => Promise<StudioAsset>
  saveVideoStudioPrint: (studioId: string, dataUrl: string) => Promise<string | null>
  openVideoStudioPrints: (studioId: string) => Promise<void>
  listVideoExports: () => Promise<VideoExportRecord[]>
  openVideoExportsFolder: (studioId?: string) => Promise<void>
  deleteVideoExport: (id: string) => Promise<void>
  startVideoExport: (request: VideoExportStartRequest) => Promise<VideoExportStartResult>
  cancelVideoExport: (jobId: string) => Promise<void>
  getVideoExportStatus: (jobId: string) => Promise<VideoExportProgress | null>
  onVideoExportProgress: (callback: (progress: VideoExportProgress) => void) => () => void
  listRecoverableVideoExports: () => Promise<VideoExportRecoveryRecord[]>
  resumeVideoExport: (jobId: string) => Promise<VideoExportStartResult>
  discardVideoExportRecovery: (jobId: string) => Promise<void>
}
