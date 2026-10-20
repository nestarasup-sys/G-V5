import { createHash, randomUUID } from 'node:crypto'
import type { CustomizerCharacter } from '../src/shared/customizer'
import type { StudioDocument, VideoExportRecord as SharedVideoExportRecord } from '../src/shared/studio'
import { createVideoExportSnapshot } from '../src/shared/videoExportSnapshot'
import { createVideoExportCharacterSnapshot } from '../src/shared/videoExportCharacters'
import type { VideoCharacterRenderAssetSnapshot } from '../src/shared/videoCharacterRenderAssets'
import { compileVideoScene, evaluateVideoSceneFrame, type RenderVariant } from '../src/shared/videoSceneIR'
import type { VideoExportProgress } from '../src/shared/videoExportRuntime'
import { buildVideoStudioAudioPlan, type VideoStudioAudioSource } from '../src/shared/videoStudioAudioPlan'
import { buildVideoExportMediaManifest, type ResolveVideoExportMedia } from './videoExportAssets'
import { prepareVideoExportSnapshot } from './videoExportSnapshotAssets'
import type { VideoExportJobStore } from './videoExportJobs'
import type { VideoExportLibrary } from './videoExports'
import type { VideoExportSurfaceHost, VideoExportSurfaceSession } from './videoExportSurfaceHost'
import { resolveVideoStudioTools, type VideoStudioToolPaths } from './videoToolsResolver'
import { probeVideoStudioFfmpeg, type VideoStudioFfmpegCapabilities } from './videoFfmpegCapabilities'
import { encodeVideoStudioSerialChunk } from './videoSerialChunkEncoder'
import { assembleVideoStudioOutput } from './videoExportAssembler'
import { probeVideoMedia } from './videoMediaProbe'
import { verifyVideoStudioOutput } from './videoOutputVerifier'
import { rgbaToBgra } from './videoPixelFormat'

type ActiveExport = {
  jobId: string
  variant: RenderVariant
  controller: AbortController
  progress: VideoExportProgress
  surface: VideoExportSurfaceSession | null
  task: Promise<void>
}

export type VideoExportCoordinatorInput = Readonly<{
  studio: StudioDocument
  characters: ReadonlyArray<CustomizerCharacter>
  characterAssets: VideoCharacterRenderAssetSnapshot
  renderVariant: RenderVariant
}>

export class VideoExportCoordinator {
  private readonly active = new Map<string, ActiveExport>()
  private toolsPromise: Promise<{ paths: VideoStudioToolPaths; ffmpeg: VideoStudioFfmpegCapabilities }> | null = null

  constructor(
    private readonly jobs: VideoExportJobStore,
    private readonly library: VideoExportLibrary,
    private readonly surfaceHost: VideoExportSurfaceHost,
    private readonly resolveMedia: ResolveVideoExportMedia,
    private readonly onProgress: (progress: VideoExportProgress) => void,
  ) {}

  private async tools(): Promise<{ paths: VideoStudioToolPaths; ffmpeg: VideoStudioFfmpegCapabilities }> {
    if (!this.toolsPromise) {
      this.toolsPromise = resolveVideoStudioTools().then(async (paths) => ({
        paths,
        ffmpeg: await probeVideoStudioFfmpeg(paths.ffmpeg),
      }))
      void this.toolsPromise.catch(() => { this.toolsPromise = null })
    }
    return this.toolsPromise
  }

  private update(active: ActiveExport, patch: Partial<VideoExportProgress>): void {
    const progress: VideoExportProgress = Object.freeze({ ...active.progress, ...patch })
    active.progress = progress
    this.onProgress(progress)
  }

  start(input: VideoExportCoordinatorInput): string {
    if (!input?.studio?.videoTimeline) throw new Error('Exportação exige um projeto do Video Studio.')
    if (input.renderVariant !== 'animated' && input.renderVariant !== 'static-characters') throw new Error('Modo de exportação inválido.')
    const jobId = randomUUID()
    const totalFrames = input.studio.videoTimeline.durationFrames
    const initial: VideoExportProgress = Object.freeze({
      jobId,
      stage: 'queued',
      renderVariant: input.renderVariant,
      completedFrames: 0,
      totalFrames,
    })
    const active: ActiveExport = {
      jobId,
      variant: input.renderVariant,
      controller: new AbortController(),
      progress: initial,
      surface: null,
      task: Promise.resolve(),
    }
    this.active.set(jobId, active)
    this.onProgress(initial)
    active.task = this.run(active, input).catch((reason: unknown) => {
      const cancelled = active.controller.signal.aborted
      this.update(active, {
        stage: cancelled ? 'cancelled' : 'failed',
        message: reason instanceof Error ? reason.message : String(reason),
      })
    }).finally(async () => {
      const surface = active.surface
      active.surface = null
      await surface?.dispose().catch(() => undefined)
      if (active.controller.signal.aborted) await this.jobs.cleanup(jobId).catch(() => undefined)
    })
    return jobId
  }

  status(jobId: string): VideoExportProgress | null {
    return this.active.get(jobId)?.progress ?? null
  }

  async cancel(jobId: string): Promise<void> {
    const active = this.active.get(jobId)
    if (!active) throw new Error('Job de exportação não encontrado.')
    if (['done', 'failed', 'cancelled'].includes(active.progress.stage)) return
    active.controller.abort(new Error('Exportação cancelada pelo usuário.'))
    await active.surface?.dispose().catch(() => undefined)
    await active.task.catch(() => undefined)
  }

  private abort(active: ActiveExport): void {
    if (active.controller.signal.aborted) {
      throw active.controller.signal.reason instanceof Error
        ? active.controller.signal.reason
        : new Error('Exportação cancelada.')
    }
  }

  private async run(active: ActiveExport, input: VideoExportCoordinatorInput): Promise<void> {
    const { studio, renderVariant } = input
    const timeline = studio.videoTimeline!
    this.update(active, { stage: 'preparing', message: 'Fixando projeto, personagens e mídias…' })
    this.abort(active)

    const snapshot = createVideoExportSnapshot(studio)
    const preparedSnapshot = prepareVideoExportSnapshot(snapshot)
    const snapshotSha256 = createHash('sha256').update(preparedSnapshot.serialized).digest('hex')
    const characters = createVideoExportCharacterSnapshot(studio, input.characters)
    const mediaDependencies = await buildVideoExportMediaManifest(studio, this.resolveMedia)
    this.abort(active)

    await this.jobs.create({
      jobId: active.jobId,
      studioId: studio.id,
      snapshotSha256,
      mediaSha256: mediaDependencies.map((dependency) => dependency.sha256),
      mediaDependencies,
      durationFrames: timeline.durationFrames,
      snapshot,
      characters,
      characterAssets: input.characterAssets,
      renderVariant,
    })

    const { paths, ffmpeg } = await this.tools()
    this.abort(active)

    const reopened = await this.jobs.reopen(active.jobId)
    const chunkCount = Math.ceil(timeline.durationFrames / reopened.manifest.chunkFrames)
    const media = new Map<string, VideoStudioAudioSource>()
    for (const dependency of reopened.manifest.mediaDependencies ?? []) {
      this.abort(active)
      const pinned = await this.jobs.resolvePinnedMedia(active.jobId, dependency.assetId)
      const probe = await probeVideoMedia(paths.ffprobe, pinned.path)
      media.set(dependency.assetId, { path: pinned.path, hasAudio: probe.audio !== null })
    }

    this.update(active, {
      stage: 'rendering',
      chunkCount,
      message: 'Inicializando compositor canônico…',
    })
    active.surface = await this.surfaceHost.open(active.jobId)
    this.abort(active)
    const sceneProgram = compileVideoScene(snapshot, renderVariant)
    let cachedPixels: { key: string; pixels: Buffer } | null = null
    let reusedFrames = 0

    for (let index = reopened.nextChunkIndex; index < chunkCount; index += 1) {
      this.abort(active)
      const startFrame = index * reopened.manifest.chunkFrames
      const endFrameExclusive = Math.min(timeline.durationFrames, startFrame + reopened.manifest.chunkFrames)
      const outputPath = this.jobs.chunkOutputPath(active.jobId, index)
      await encodeVideoStudioSerialChunk({
        ffmpeg,
        outputPath,
        startFrame,
        endFrameExclusive,
      }, async (frame) => {
        this.abort(active)
        const semantic = evaluateVideoSceneFrame(sceneProgram, frame).reuseKey
        if (cachedPixels?.key === semantic) {
          reusedFrames += 1
          return cachedPixels.pixels
        }
        const rgba = await active.surface!.renderFrame(frame)
        const pixels = rgbaToBgra(rgba)
        cachedPixels = { key: semantic, pixels }
        return pixels
      }, {
        signal: active.controller.signal,
        onProgress: ({ completedFrames }) => {
          this.update(active, {
            stage: 'rendering',
            chunkIndex: index,
            chunkCount,
            completedFrames: startFrame + completedFrames,
            reusedFrames,
            message: `Renderizando trecho ${index + 1}/${chunkCount}…`,
          })
        },
      })
      await this.jobs.recordChunk(active.jobId, index)
    }

    this.abort(active)
    await active.surface.dispose()
    active.surface = null

    const completed = await this.jobs.reopen(active.jobId)
    if (completed.manifest.chunks.length !== chunkCount) throw new Error('Nem todos os chunks foram confirmados antes da montagem.')
    const chunks = completed.manifest.chunks.map((chunk) => ({
      index: chunk.index,
      startFrame: chunk.startFrame,
      endFrameExclusive: chunk.endFrame,
      path: this.jobs.chunkOutputPath(active.jobId, chunk.index),
    }))

    this.update(active, {
      stage: 'assembling',
      completedFrames: timeline.durationFrames,
      reusedFrames,
      message: 'Montando vídeo e áudio…',
    })
    const finalPath = this.jobs.finalOutputPath(active.jobId)
    const assembly = await assembleVideoStudioOutput({
      ffmpeg,
      chunks,
      timeline,
      media,
      outputPath: finalPath,
      tempRoot: this.jobs.root,
    })

    this.abort(active)
    this.update(active, { stage: 'verifying', message: 'Verificando MP4 inteiro…' })
    await verifyVideoStudioOutput({
      ffprobeExecutable: paths.ffprobe,
      ffmpegExecutable: paths.ffmpeg,
      outputPath: finalPath,
      expected: {
        width: 1920,
        height: 1080,
        frameRate: 60,
        durationFrames: timeline.durationFrames,
        audio: assembly.audio,
      },
    })

    // Rebuild the audio decision from the same immutable timeline as a guard
    // against assembler/result drift before writing catalog metadata.
    const plannedAudio = buildVideoStudioAudioPlan(timeline, media).enabled
    if (plannedAudio !== assembly.audio) throw new Error('Plano de áudio mudou durante a montagem final.')

    this.abort(active)
    this.update(active, { stage: 'publishing', message: 'Publicando exportação verificada…' })
    const record = await this.library.finalize(active.jobId, {
      id: randomUUID(),
      studioId: studio.id,
      studioTitle: studio.title,
      width: 1920,
      height: 1080,
      frameRate: 60,
      durationFrames: timeline.durationFrames,
      videoCodec: 'h264',
      audioCodec: assembly.audio ? 'aac' : null,
    })
    await this.jobs.cleanup(active.jobId)
    const sharedRecord: SharedVideoExportRecord = { ...record, available: true }
    this.update(active, {
      stage: 'done',
      completedFrames: timeline.durationFrames,
      reusedFrames,
      message: 'Exportação concluída e verificada.',
      record: sharedRecord,
    })
  }
}
