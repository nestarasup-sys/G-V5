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
  /** Canonical Canvas RGBA bytes; present only on successful frame acknowledgements. */
  pixels?: Uint8Array
  timings?: Readonly<{ composeMs: number; readbackMs: number }>
}>

export type VideoExportSurfaceReady = Readonly<{
  jobId: string
  error?: string
}>
