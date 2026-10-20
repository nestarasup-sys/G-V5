import { createHash, randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { CustomizerCharacter } from '../src/shared/customizer'
import type { StudioDocument, VideoExportRecord as SharedVideoExportRecord } from '../src/shared/studio'
import { createVideoExportSnapshot } from '../src/shared/videoExportSnapshot'
import { createVideoExportCharacterSnapshot } from '../src/shared/videoExportCharacters'
import type { VideoCharacterRenderAssetSnapshot } from '../src/shared/videoCharacterRenderAssets'
import { compileVideoScene, evaluateVideoSceneFrame, type RenderVariant } from '../src/shared/videoSceneIR'
import type { VideoExportMetrics, VideoExportProgress, VideoExportRecoveryRecord } from '../src/shared/videoExportRuntime'
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
import { VideoSemanticFrameCache } from './videoSemanticFrameCache'

type ReopenedVideoExportJob = Awaited<ReturnType<VideoExportJobStore['reopen']>>

function completedChunkBytes(manifest: ReopenedVideoExportJob['manifest']): number {
  return manifest.chunks.reduce((sum, chunk) => sum + chunk.sizeBytes, 0)
}

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
      metrics: { startedAt: new Date().toISOString() },
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

  async listRecoverable(): Promise<VideoExportRecoveryRecord[]> {
    return this.jobs.listRecoverable()
  }

  async resume(jobId: string): Promise<string> {
    if (this.active.has(jobId)) throw new Error('Este job já está ativo nesta sessão.')
    const reopened = await this.jobs.reopen(jobId)
    if (!reopened.snapshot || !reopened.characters || !reopened.characterAssets || !reopened.manifest.renderVariant) {
      throw new Error('Job não possui snapshots suficientes para retomada segura.')
    }
    const completedFrames = reopened.manifest.chunks.at(-1)?.endFrame ?? 0
    const initial: VideoExportProgress = Object.freeze({
      jobId,
      stage: 'queued',
      renderVariant: reopened.manifest.renderVariant,
      completedFrames,
      totalFrames: reopened.manifest.durationFrames,
      chunkCount: Math.ceil(reopened.manifest.durationFrames / reopened.manifest.chunkFrames),
      message: completedFrames > 0 ? 'Retomando exportação verificada…' : 'Reiniciando job preparado…',
      metrics: { startedAt: new Date().toISOString() },
    })
    const active: ActiveExport = {
      jobId,
      variant: reopened.manifest.renderVariant,
      controller: new AbortController(),
      progress: initial,
      surface: null,
      task: Promise.resolve(),
    }
    this.active.set(jobId, active)
    this.onProgress(initial)
    const input: VideoExportCoordinatorInput = {
      studio: reopened.snapshot.studio,
      characters: reopened.characters.characters,
      characterAssets: reopened.characterAssets,
      renderVariant: reopened.manifest.renderVariant,
    }
    active.task = this.run(active, input, reopened).catch((reason: unknown) => {
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

  async cancel(jobId: string): Promise<void> {
    const active = this.active.get(jobId)
    if (!active) throw new Error('Job de exportação não encontrado.')
    if (['done', 'failed', 'cancelled'].includes(active.progress.stage)) return
    active.controller.abort(new Error('Exportação cancelada pelo usuário.'))
    await active.surface?.dispose().catch(() => undefined)
    await active.task.catch(() => undefined)
  }

  async discardRecovery(jobId: string): Promise<void> {
    const active = this.active.get(jobId)
    if (active && !['done', 'failed', 'cancelled'].includes(active.progress.stage)) {
      throw new Error('Não é possível descartar um job de exportação ainda ativo.')
    }
    this.active.delete(jobId)
    await this.jobs.cleanup(jobId)
  }

  private abort(active: ActiveExport): void {
    if (active.controller.signal.aborted) {
      throw active.controller.signal.reason instanceof Error
        ? active.controller.signal.reason
        : new Error('Exportação cancelada.')
    }
  }

  private async run(active: ActiveExport, input: VideoExportCoordinatorInput, resumeJob?: ReopenedVideoExportJob): Promise<void> {
    const totalStarted = performance.now()
    const startedAt = active.progress.metrics?.startedAt ?? new Date().toISOString()
    let metrics: VideoExportMetrics = { startedAt }
    const applyMetrics = (patch: Partial<VideoExportMetrics>) => {
      metrics = { ...metrics, ...patch }
      return metrics
    }
    const renderVariant = resumeJob?.manifest.renderVariant ?? input.renderVariant
    if (!renderVariant) throw new Error('Job sem modo de renderização.')
    const snapshot = resumeJob?.snapshot ?? createVideoExportSnapshot(input.studio)
    if (!snapshot) throw new Error('Job sem snapshot de cena.')
    const studio = snapshot.studio
    const timeline = snapshot.timeline
    const prepareStarted = performance.now()
    this.update(active, { stage: 'preparing', message: 'Fixando projeto, personagens e mídias…', metrics })
    this.abort(active)

    const preparedSnapshot = prepareVideoExportSnapshot(snapshot)
    const snapshotSha256 = createHash('sha256').update(preparedSnapshot.serialized).digest('hex')
    const characters = resumeJob?.characters ?? createVideoExportCharacterSnapshot(studio, input.characters)
    const mediaDependencies = resumeJob?.manifest.mediaDependencies ?? await buildVideoExportMediaManifest(studio, this.resolveMedia)
    this.abort(active)

    if (!resumeJob) await this.jobs.create({
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

    const reopened = resumeJob ?? await this.jobs.reopen(active.jobId)
    const chunkCount = Math.ceil(timeline.durationFrames / reopened.manifest.chunkFrames)
    const media = new Map<string, VideoStudioAudioSource>()
    for (const dependency of reopened.manifest.mediaDependencies ?? []) {
      this.abort(active)
      const pinned = await this.jobs.resolvePinnedMedia(active.jobId, dependency.assetId)
      const probe = await probeVideoMedia(paths.ffprobe, pinned.path, { signal: active.controller.signal })
      media.set(dependency.assetId, { path: pinned.path, hasAudio: probe.audio !== null })
    }

    const renderStarted = performance.now()
    this.update(active, {
      stage: 'rendering',
      chunkCount,
      message: 'Inicializando compositor canônico…',
      metrics: applyMetrics({ prepareMs: renderStarted - prepareStarted }),
    })
    active.surface = await this.surfaceHost.open(active.jobId)
    this.abort(active)
    const sceneProgram = compileVideoScene(snapshot, renderVariant)
    const frameCache = new VideoSemanticFrameCache()
    let reusedFrames = 0
    let encodedChunkBytes = completedChunkBytes(reopened.manifest)
    let rawFrameBytes = reopened.manifest.chunks.reduce((sum, chunk) => sum + (chunk.endFrame - chunk.startFrame) * 1920 * 1080 * 4, 0)

    for (let index = reopened.nextChunkIndex; index < chunkCount; index += 1) {
      this.abort(active)
      const startFrame = index * reopened.manifest.chunkFrames
      const endFrameExclusive = Math.min(timeline.durationFrames, startFrame + reopened.manifest.chunkFrames)
      const outputPath = this.jobs.chunkOutputPath(active.jobId, index)
      const encodedChunk = await encodeVideoStudioSerialChunk({
        ffmpeg,
        outputPath,
        startFrame,
        endFrameExclusive,
      }, async (frame) => {
        this.abort(active)
        const semantic = evaluateVideoSceneFrame(sceneProgram, frame).reuseKey
        const cached = frameCache.get(semantic)
        if (cached) {
          reusedFrames += 1
          return cached
        }
        const rgba = await active.surface!.renderFrame(frame)
        const pixels = rgbaToBgra(rgba)
        frameCache.set(semantic, pixels)
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
            metrics: applyMetrics({
              renderedFrames: startFrame + completedFrames - reusedFrames,
              reusedFrames,
              rawFrameBytes: rawFrameBytes + completedFrames * 1920 * 1080 * 4,
              encodedChunkBytes,
              cacheHits: frameCache.stats().hits,
              cacheMisses: frameCache.stats().misses,
              cacheEvictions: frameCache.stats().evictions,
              cacheEntries: frameCache.stats().entries,
              cacheBytes: frameCache.stats().bytes,
              cacheMaxBytes: frameCache.stats().maxBytes,
            }),
            message: `Renderizando trecho ${index + 1}/${chunkCount}…`,
          })
        },
      })
      encodedChunkBytes += encodedChunk.outputBytes
      rawFrameBytes += encodedChunk.writer.bytesWritten
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

    const renderEnded = performance.now()
    this.update(active, {
      stage: 'assembling',
      completedFrames: timeline.durationFrames,
      reusedFrames,
      metrics: applyMetrics({
        renderMs: renderEnded - renderStarted,
        renderedFrames: timeline.durationFrames - reusedFrames,
        reusedFrames,
        rawFrameBytes,
        encodedChunkBytes,
        cacheHits: frameCache.stats().hits,
        cacheMisses: frameCache.stats().misses,
        cacheEvictions: frameCache.stats().evictions,
        cacheEntries: frameCache.stats().entries,
        cacheBytes: frameCache.stats().bytes,
        cacheMaxBytes: frameCache.stats().maxBytes,
      }),
      message: 'Montando vídeo e áudio…',
    })
    const assembleStarted = performance.now()
    const finalPath = this.jobs.finalOutputPath(active.jobId)
    const assembly = await assembleVideoStudioOutput({
      ffmpeg,
      chunks,
      timeline,
      media,
      outputPath: finalPath,
      tempRoot: this.jobs.root,
      signal: active.controller.signal,
    })

    this.abort(active)
    const assembleEnded = performance.now()
    this.update(active, { stage: 'verifying', message: 'Verificando MP4 inteiro…', metrics: applyMetrics({ assembleMs: assembleEnded - assembleStarted, finalBytes: assembly.outputBytes }) })
    const verifyStarted = performance.now()
    await verifyVideoStudioOutput({
      ffprobeExecutable: paths.ffprobe,
      ffmpegExecutable: paths.ffmpeg,
      outputPath: finalPath,
      signal: active.controller.signal,
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
    const verifyEnded = performance.now()
    this.update(active, { stage: 'publishing', message: 'Publicando exportação verificada…', metrics: applyMetrics({ verifyMs: verifyEnded - verifyStarted }) })
    const publishStarted = performance.now()
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
    const finishedAt = performance.now()
    this.update(active, {
      stage: 'done',
      completedFrames: timeline.durationFrames,
      reusedFrames,
      metrics: applyMetrics({
        publishMs: finishedAt - publishStarted,
        totalMs: finishedAt - totalStarted,
        finalBytes: record.sizeBytes,
        cacheHits: frameCache.stats().hits,
        cacheMisses: frameCache.stats().misses,
        cacheEvictions: frameCache.stats().evictions,
        cacheEntries: frameCache.stats().entries,
        cacheBytes: frameCache.stats().bytes,
        cacheMaxBytes: frameCache.stats().maxBytes,
      }),
      message: 'Exportação concluída e verificada.',
      record: sharedRecord,
    })
  }
}
