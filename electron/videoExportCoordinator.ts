import { createHash, randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { cpus, freemem, totalmem } from 'node:os'
import type { CustomizerCharacter } from '../src/shared/customizer'
import type { StudioDocument, VideoExportRecord as SharedVideoExportRecord } from '../src/shared/studio'
import { fitVideoTimelineDuration } from '../src/shared/videoTimelineDuration'
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
import { VideoSemanticFrameCache } from './videoSemanticFrameCache'
import { VideoPersistentFrameCache } from './videoPersistentFrameCache'
import { chooseVideoExportWorkerCount, videoExportWorkerOverride } from './videoExportAutoTuner'

type ReopenedVideoExportJob = Awaited<ReturnType<VideoExportJobStore['reopen']>>

function completedChunkBytes(manifest: ReopenedVideoExportJob['manifest']): number {
  return manifest.chunks.reduce((sum, chunk) => sum + chunk.sizeBytes, 0)
}

type ActiveExport = {
  jobId: string
  variant: RenderVariant
  controller: AbortController
  progress: VideoExportProgress
  surfaces: Set<VideoExportSurfaceSession>
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
    const exportTimeline = input.studio.videoTimeline
    const exportDurationFrames = fitVideoTimelineDuration(exportTimeline)
    const exportInput: VideoExportCoordinatorInput = {
      ...input,
      studio: {
        ...input.studio,
        videoTimeline: { ...exportTimeline, durationFrames: exportDurationFrames },
      },
    }
    const jobId = randomUUID()
    const totalFrames = exportDurationFrames
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
      surfaces: new Set(),
      task: Promise.resolve(),
    }
    this.active.set(jobId, active)
    this.onProgress(initial)
    active.task = this.run(active, exportInput).catch((reason: unknown) => {
      const cancelled = active.controller.signal.aborted
      this.update(active, {
        stage: cancelled ? 'cancelled' : 'failed',
        message: reason instanceof Error ? reason.message : String(reason),
      })
    }).finally(async () => {
      await this.disposeSurfaces(active)
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
    const previous = this.active.get(jobId)
    if (previous) {
      if (!['done', 'failed', 'cancelled'].includes(previous.progress.stage)) {
        throw new Error('Este job já está ativo nesta sessão.')
      }
      // A terminal progress event can arrive just before the task's finally()
      // disposes surfaces. Drain it before reusing the same persisted job id.
      await previous.task.catch(() => undefined)
      if (previous.progress.stage === 'done') {
        throw new Error('Uma exportação já concluída não pode ser retomada.')
      }
      this.active.delete(jobId)
    }
    const reopened = await this.jobs.reopen(jobId)
    if (!reopened.snapshot || !reopened.characters || !reopened.characterAssets || !reopened.manifest.renderVariant) {
      throw new Error('Job não possui snapshots suficientes para retomada segura.')
    }
    const completedFrames = reopened.manifest.chunks.reduce((sum, chunk) => sum + (chunk.endFrame - chunk.startFrame), 0)
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
      surfaces: new Set(),
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
      await this.disposeSurfaces(active)
      if (active.controller.signal.aborted) await this.jobs.cleanup(jobId).catch(() => undefined)
    })
    return jobId
  }

  async cancel(jobId: string): Promise<void> {
    const active = this.active.get(jobId)
    if (!active) throw new Error('Job de exportação não encontrado.')
    if (['done', 'failed', 'cancelled'].includes(active.progress.stage)) return
    active.controller.abort(new Error('Exportação cancelada pelo usuário.'))
    await this.disposeSurfaces(active)
    await active.task.catch(() => undefined)
  }

  forgetTerminal(jobId: string): void {
    const active = this.active.get(jobId)
    if (!active) return
    if (!['done', 'failed', 'cancelled'].includes(active.progress.stage)) {
      throw new Error('Job de exportação ainda está ativo.')
    }
    this.active.delete(jobId)
  }

  async discardRecovery(jobId: string): Promise<void> {
    const active = this.active.get(jobId)
    if (active && !['done', 'failed', 'cancelled'].includes(active.progress.stage)) {
      throw new Error('Não é possível descartar um job de exportação ainda ativo.')
    }
    this.active.delete(jobId)
    await this.jobs.cleanup(jobId)
  }

  private async disposeSurfaces(active: ActiveExport): Promise<void> {
    const surfaces = [...active.surfaces]
    active.surfaces.clear()
    await Promise.allSettled(surfaces.map((surface) => surface.dispose()))
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
    const tune = chooseVideoExportWorkerCount({
      pendingChunks: reopened.missingChunkIndexes.length,
      durationFrames: timeline.durationFrames,
      logicalCpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
      freeMemoryBytes: freemem(),
      videoEncoder: ffmpeg.videoEncoder,
      sceneComplexityUnits: studio.elements.length + (timeline.videoClips?.length ?? 0) + Math.ceil(timeline.characterKeys.length / 4),
      overrideWorkers: videoExportWorkerOverride(process.env.GACHA_VIDEO_EXPORT_WORKERS),
    })
    let workerCount: 1 | 2 = tune.workerCount
    let workerStrategy = tune.reason
    let fallbackCount = 0
    this.update(active, {
      stage: 'rendering',
      chunkCount,
      message: workerCount > 1 ? 'Inicializando Turbo com 2 workers…' : 'Inicializando compositor canônico…',
      metrics: applyMetrics({ prepareMs: renderStarted - prepareStarted, workerCount, workerStrategy, fallbackCount }),
    })

    const surfaces = await Promise.all(
      Array.from({ length: workerCount }, () => this.surfaceHost.open(active.jobId)),
    )
    surfaces.forEach((surface) => active.surfaces.add(surface))
    this.abort(active)

    const sceneProgram = compileVideoScene(snapshot, renderVariant)
    const frameCache = new VideoSemanticFrameCache()
    const persistentFrameCache = new VideoPersistentFrameCache(this.library.frameCacheRoot)
    await persistentFrameCache.repair()
    const inFlightFrames = new Map<string, Promise<Buffer>>()
    const completedByChunk = new Map<number, number>(
      reopened.manifest.chunks.map((chunk) => [chunk.index, chunk.endFrame - chunk.startFrame]),
    )
    let reusedFrames = 0
    let renderedFrames = 0
    let encodedChunkBytes = completedChunkBytes(reopened.manifest)
    let persistentCacheHits = 0, persistentCacheMisses = 0, persistentCacheWrites = 0, persistentCacheWriteSkips = 0
    const pendingPersistentWrites = new Set<Promise<void>>()
    const schedulePersistentWrite = (semantic: string, rgba: Buffer) => {
      // L2 is an optimization: cold export must not wait on deflate+disk for
      // every frame. Keep at most two writes queued; skip excess rather than
      // turning a fast renderer into an unbounded memory/disk backlog.
      if (pendingPersistentWrites.size >= 2) {
        persistentCacheWriteSkips += 1
        return
      }
      let write!: Promise<void>
      write = persistentFrameCache.set(semantic, rgba)
        .then(() => { persistentCacheWrites += 1 })
        .catch(() => undefined)
        .finally(() => pendingPersistentWrites.delete(write))
      pendingPersistentWrites.add(write)
    }
    let surfaceRoundTripMs = 0, composeMs = 0, readbackMs = 0, surfaceOtherMs = 0
    let writerWaitMs = 0, writerPeakInFlight = 0
    const frameBytes = 1920 * 1080 * 4

    const aggregateCompletedFrames = () => [...completedByChunk.values()].reduce((sum, value) => sum + value, 0)
    const updateRenderMetrics = () => {
      const stats = frameCache.stats()
      return applyMetrics({
        renderedFrames,
        reusedFrames,
        rawFrameBytes: aggregateCompletedFrames() * frameBytes,
        encodedChunkBytes,
        cacheHits: stats.hits,
        cacheMisses: stats.misses,
        cacheEvictions: stats.evictions,
        cacheEntries: stats.entries,
        cacheBytes: stats.bytes,
        cacheMaxBytes: stats.maxBytes,
        persistentCacheHits,
        persistentCacheMisses,
        persistentCacheWrites,
        persistentCacheWriteSkips,
        surfaceRoundTripMs,
        composeMs,
        readbackMs,
        surfaceOtherMs,
        writerWaitMs,
        writerPeakInFlight,
        workerCount,
        workerStrategy,
        fallbackCount,
      })
    }

    const renderSemanticFrame = async (surface: VideoExportSurfaceSession, frame: number): Promise<Buffer> => {
      this.abort(active)
      const semantic = evaluateVideoSceneFrame(sceneProgram, frame).reuseKey
      const pending = inFlightFrames.get(semantic)
      if (pending) {
        reusedFrames += 1
        return pending
      }
      const cached = frameCache.get(semantic)
      if (cached) {
        reusedFrames += 1
        return cached
      }
      if (persistentFrameCache.has(semantic, frameBytes)) {
        const persistent = await persistentFrameCache.get(semantic, frameBytes)
        if (persistent) {
          persistentCacheHits += 1
          reusedFrames += 1
          frameCache.set(semantic, persistent)
          return persistent
        }
      }
      persistentCacheMisses += 1
      renderedFrames += 1
      const rendering = surface.renderFrameDetailed(frame)
        .then(({ pixels: rgba, timings, roundTripMs }) => {
          surfaceRoundTripMs += roundTripMs
          composeMs += timings.composeMs
          readbackMs += timings.readbackMs
          surfaceOtherMs += Math.max(0, roundTripMs - timings.composeMs - timings.readbackMs)
          frameCache.set(semantic, rgba)
          schedulePersistentWrite(semantic, rgba)
          return rgba
        })
        .finally(() => inFlightFrames.delete(semantic))
      inFlightFrames.set(semantic, rendering)
      return rendering
    }

    const runWorker = async (
      surface: VideoExportSurfaceSession,
      workerIndex: number,
      pendingIndexes: ReadonlyArray<number>,
      cursorRef: { value: number },
    ): Promise<void> => {
      while (true) {
        this.abort(active)
        const cursor = cursorRef.value
        cursorRef.value += 1
        const index = pendingIndexes[cursor]
        if (index === undefined) return
        const startFrame = index * reopened.manifest.chunkFrames
        const endFrameExclusive = Math.min(timeline.durationFrames, startFrame + reopened.manifest.chunkFrames)
        const outputPath = this.jobs.chunkOutputPath(active.jobId, index)
        const encodedChunk = await encodeVideoStudioSerialChunk({
          ffmpeg,
          outputPath,
          startFrame,
          endFrameExclusive,
        }, async (frame) => renderSemanticFrame(surface, frame), {
          signal: active.controller.signal,
          onProgress: ({ completedFrames }) => {
            completedByChunk.set(index, completedFrames)
            this.update(active, {
              stage: 'rendering',
              chunkIndex: index,
              chunkCount,
              completedFrames: aggregateCompletedFrames(),
              reusedFrames,
              metrics: updateRenderMetrics(),
              message: workerCount > 1
                ? `Turbo worker ${workerIndex + 1}: trecho ${index + 1}/${chunkCount}…`
                : `Renderizando trecho ${index + 1}/${chunkCount}…`,
            })
          },
        })
        encodedChunkBytes += encodedChunk.outputBytes
        writerWaitMs += encodedChunk.writer.writeCallbackWaitMs
        writerPeakInFlight = Math.max(writerPeakInFlight, encodedChunk.writer.peakInFlight)
        completedByChunk.set(index, endFrameExclusive - startFrame)
        await this.jobs.recordChunk(active.jobId, index)
        this.update(active, {
          stage: 'rendering',
          chunkIndex: index,
          chunkCount,
          completedFrames: aggregateCompletedFrames(),
          reusedFrames,
          metrics: updateRenderMetrics(),
          message: workerCount > 1
            ? `Turbo confirmou trecho ${index + 1}/${chunkCount}.`
            : `Trecho ${index + 1}/${chunkCount} confirmado.`,
        })
      }
    }

    const runWorkerBatch = async (
      batchSurfaces: ReadonlyArray<VideoExportSurfaceSession>,
      pendingIndexes: ReadonlyArray<number>,
    ): Promise<void> => {
      const cursorRef = { value: 0 }
      const workers = batchSurfaces.map((surface, index) => runWorker(surface, index, pendingIndexes, cursorRef))
      await Promise.all(workers)
    }

    try {
      await runWorkerBatch(surfaces, reopened.missingChunkIndexes)
    } catch (reason) {
      await this.disposeSurfaces(active)
      this.abort(active)
      if (workerCount === 1) throw reason
      const fallback = await this.jobs.reopen(active.jobId)
      if (!fallback.missingChunkIndexes.length) {
        workerStrategy = `${workerStrategy}; Turbo worker failed after all chunks were checkpointed`
      } else {
        workerCount = 1
        fallbackCount += 1
        workerStrategy = `${workerStrategy}; fallback serial after Turbo failure`
        completedByChunk.clear()
        for (const chunk of fallback.manifest.chunks) completedByChunk.set(chunk.index, chunk.endFrame - chunk.startFrame)
        encodedChunkBytes = completedChunkBytes(fallback.manifest)
        const fallbackSurface = await this.surfaceHost.open(active.jobId)
        active.surfaces.add(fallbackSurface)
        this.update(active, {
          stage: 'rendering',
          completedFrames: aggregateCompletedFrames(),
          message: 'Turbo indisponível neste job; retomando automaticamente em modo serial…',
          metrics: updateRenderMetrics(),
        })
        await runWorkerBatch([fallbackSurface], fallback.missingChunkIndexes)
      }
    }
    this.abort(active)
    await this.disposeSurfaces(active)
    if (pendingPersistentWrites.size) await Promise.allSettled([...pendingPersistentWrites])
    this.abort(active)

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
        renderedFrames,
        reusedFrames,
        rawFrameBytes: aggregateCompletedFrames() * frameBytes,
        encodedChunkBytes,
        cacheHits: frameCache.stats().hits,
        cacheMisses: frameCache.stats().misses,
        cacheEvictions: frameCache.stats().evictions,
        cacheEntries: frameCache.stats().entries,
        cacheBytes: frameCache.stats().bytes,
        cacheMaxBytes: frameCache.stats().maxBytes,
        persistentCacheHits,
        persistentCacheMisses,
        persistentCacheWrites,
        persistentCacheWriteSkips,
        surfaceRoundTripMs,
        composeMs,
        readbackMs,
        surfaceOtherMs,
        workerCount,
        workerStrategy,
        fallbackCount,
        writerWaitMs,
        writerPeakInFlight,
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
        persistentCacheHits,
        persistentCacheMisses,
        persistentCacheWrites,
        persistentCacheWriteSkips,
        surfaceRoundTripMs,
        composeMs,
        readbackMs,
        surfaceOtherMs,
        workerCount,
        workerStrategy,
        fallbackCount,
        writerWaitMs,
        writerPeakInFlight,
      }),
      message: 'Exportação concluída e verificada.',
      record: sharedRecord,
    })
  }
}
