import type { CustomizerCharacter } from './customizer'
import type { StudioDocument, VideoExportRecord } from './studio'
import type { VideoCharacterRenderAssetSnapshot } from './videoCharacterRenderAssets'
import type { RenderVariant } from './videoSceneIR'

export type VideoExportMetrics = Readonly<{
  startedAt: string
  totalMs?: number
  prepareMs?: number
  renderMs?: number
  assembleMs?: number
  verifyMs?: number
  publishMs?: number
  renderedFrames?: number
  reusedFrames?: number
  rawFrameBytes?: number
  encodedChunkBytes?: number
  finalBytes?: number
  cacheHits?: number
  cacheMisses?: number
  cacheEvictions?: number
  cacheEntries?: number
  cacheBytes?: number
  cacheMaxBytes?: number
  persistentCacheHits?: number
  persistentCacheMisses?: number
  persistentCacheWrites?: number
  persistentCacheWriteSkips?: number
  surfaceRoundTripMs?: number
  composeMs?: number
  readbackMs?: number
  surfaceOtherMs?: number
  writerWaitMs?: number
  writerPeakInFlight?: number
  workerCount?: number
  workerStrategy?: string
  fallbackCount?: number
}>

export type VideoExportStage =
  | 'queued' | 'preparing' | 'rendering' | 'assembling' | 'verifying' | 'publishing'
  | 'done' | 'cancelled' | 'failed'

export type VideoExportProgress = Readonly<{
  jobId: string
  stage: VideoExportStage
  renderVariant: RenderVariant
  completedFrames: number
  totalFrames: number
  chunkIndex?: number
  chunkCount?: number
  reusedFrames?: number
  message?: string
  record?: VideoExportRecord
  metrics?: VideoExportMetrics
}>

export type VideoExportStartRequest = Readonly<{
  studio: StudioDocument
  characters: ReadonlyArray<CustomizerCharacter>
  characterAssets: VideoCharacterRenderAssetSnapshot
  renderVariant: RenderVariant
}>

export type VideoExportStartResult = Readonly<{ jobId: string }>


export type VideoExportRecoveryRecord = Readonly<{
  jobId: string
  studioId: string
  studioTitle: string
  renderVariant: RenderVariant
  durationFrames: number
  completedFrames: number
  completedChunks: number
  totalChunks: number
  updatedAt: string
}>
