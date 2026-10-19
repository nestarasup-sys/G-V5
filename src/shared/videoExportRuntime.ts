import type { CustomizerCharacter } from './customizer'
import type { StudioDocument, VideoExportRecord } from './studio'
import type { VideoCharacterRenderAssetSnapshot } from './videoCharacterRenderAssets'
import type { RenderVariant } from './videoSceneIR'

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
  message?: string
  record?: VideoExportRecord
}>

export type VideoExportStartRequest = Readonly<{
  studio: StudioDocument
  characters: ReadonlyArray<CustomizerCharacter>
  characterAssets: VideoCharacterRenderAssetSnapshot
  renderVariant: RenderVariant
}>

export type VideoExportStartResult = Readonly<{ jobId: string }>
