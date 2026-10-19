import type { VideoExportSnapshot } from './videoExportSnapshot'
import type { VideoExportCharacterSnapshot } from './videoExportCharacters'
import type { VideoCharacterRenderAssetSnapshot } from './videoCharacterRenderAssets'
import type { RenderVariant } from './videoSceneIR'

export type VideoExportSurfaceBootstrap = Readonly<{
  jobId: string
  snapshot: VideoExportSnapshot
  characters: VideoExportCharacterSnapshot
  characterAssets: VideoCharacterRenderAssetSnapshot
  renderVariant: RenderVariant
}>

export type VideoExportSurfaceRenderRequest = Readonly<{
  requestId: string
  frame: number
}>

export type VideoExportSurfaceFrameReady = Readonly<{
  requestId: string
  frame: number
  error?: string
}>
