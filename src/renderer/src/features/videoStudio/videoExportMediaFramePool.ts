import type { VideoSceneFrame } from '../../../../shared/videoSceneIR'

type CachedBitmap = { bitmap: ImageBitmap; bytes: number }

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new DOMException('Operação cancelada.', 'AbortError')
}

export class VideoExportMediaFramePool {
  private readonly videos = new Map<string, HTMLVideoElement>()
  private readonly ready = new Map<string, Promise<HTMLVideoElement>>()
  private readonly bitmaps = new Map<string, CachedBitmap>()
  private bitmapBytes = 0
  private disposed = false

  constructor(private readonly jobId: string, private readonly maxBitmapBytes = 96 * 1024 * 1024) {}

  private video(assetId: string): Promise<HTMLVideoElement> {
    if (this.disposed) return Promise.reject(new Error('Decoder de mídia já foi descartado.'))
    let pending = this.ready.get(assetId)
    if (pending) return pending
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.playsInline = true
    video.crossOrigin = 'anonymous'
    video.src = `gacha-video://export-job/${this.jobId}/${assetId}`
    this.videos.set(assetId, video)
    pending = new Promise<HTMLVideoElement>((resolve, reject) => {
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', loaded)
        video.removeEventListener('error', failed)
      }
      const loaded = () => { cleanup(); resolve(video) }
      const failed = () => { cleanup(); reject(new Error(`Não foi possível decodificar a mídia pinada ${assetId}.`)) }
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA && Number.isFinite(video.duration)) resolve(video)
      else {
        video.addEventListener('loadedmetadata', loaded, { once: true })
        video.addEventListener('error', failed, { once: true })
        video.load()
      }
    })
    this.ready.set(assetId, pending)
    void pending.catch(() => { this.ready.delete(assetId); this.videos.delete(assetId) })
    return pending
  }

  private async seek(video: HTMLVideoElement, target: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw abortError(signal)
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('Mídia sem duração decodificável.')
    const clamped = Math.max(0, Math.min(target, Math.max(0, video.duration - 0.000001)))
    const needsSeek = Math.abs(video.currentTime - clamped) > 0.000001 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    if (!needsSeek) return

    await new Promise<void>((resolve, reject) => {
      let done = false
      const timeout = window.setTimeout(() => finish(new Error('Seek de mídia excedeu 8 segundos.')), 8000)
      const finish = (error?: Error) => {
        if (done) return
        done = true
        window.clearTimeout(timeout)
        video.removeEventListener('seeked', onSeeked)
        video.removeEventListener('error', onError)
        signal?.removeEventListener('abort', onAbort)
        error ? reject(error) : resolve()
      }
      const onSeeked = () => {
        // seeked means the paused media element completed its seek. Waiting for
        // a future requestVideoFrameCallback can deadlock because no future
        // playback presentation is required while paused.
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) finish()
        else {
          const check = () => {
            if (done) return
            if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) finish()
            else window.setTimeout(check, 4)
          }
          check()
        }
      }
      const onError = () => finish(new Error('Decoder falhou durante seek de mídia.'))
      const onAbort = () => finish(abortError(signal))
      video.addEventListener('seeked', onSeeked, { once: true })
      video.addEventListener('error', onError, { once: true })
      signal?.addEventListener('abort', onAbort, { once: true })
      try { video.currentTime = clamped }
      catch (reason) { finish(reason instanceof Error ? reason : new Error(String(reason))) }
    })
    if (signal?.aborted) throw abortError(signal)
  }

  private remember(key: string, bitmap: ImageBitmap): ImageBitmap {
    const bytes = bitmap.width * bitmap.height * 4
    this.bitmaps.set(key, { bitmap, bytes })
    this.bitmapBytes += bytes
    while (this.bitmapBytes > this.maxBitmapBytes && this.bitmaps.size > 1) {
      const oldestKey = this.bitmaps.keys().next().value
      const oldest = oldestKey ? this.bitmaps.get(oldestKey) : undefined
      if (!oldestKey || !oldest) break
      this.bitmaps.delete(oldestKey)
      this.bitmapBytes -= oldest.bytes
      oldest.bitmap.close()
    }
    return bitmap
  }

  async frame(assetId: string, sourceNumerator: number, sourceDenominator: number, signal?: AbortSignal): Promise<ImageBitmap> {
    if (!Number.isSafeInteger(sourceNumerator) || !Number.isSafeInteger(sourceDenominator) || sourceNumerator < 0 || sourceDenominator <= 0) {
      throw new Error('Timestamp de mídia inválido.')
    }
    const key = `${assetId}:${sourceNumerator}/${sourceDenominator}`
    const cached = this.bitmaps.get(key)
    if (cached) {
      this.bitmaps.delete(key)
      this.bitmaps.set(key, cached)
      return cached.bitmap
    }
    const video = await this.video(assetId)
    await this.seek(video, sourceNumerator / sourceDenominator, signal)
    if (signal?.aborted) throw abortError(signal)
    const bitmap = await createImageBitmap(video)
    if (!bitmap.width || !bitmap.height) { bitmap.close(); throw new Error('Decoder retornou um frame de vídeo vazio.') }
    return this.remember(key, bitmap)
  }

  async framesForScene(scene: VideoSceneFrame, signal?: AbortSignal): Promise<ReadonlyMap<string, CanvasImageSource>> {
    const result = new Map<string, CanvasImageSource>()
    for (const video of scene.videos) {
      result.set(video.clipId, await this.frame(video.assetId, video.sourceTimeNumerator, video.sourceTimeDenominator, signal))
    }
    return result
  }

  dispose(): void {
    this.disposed = true
    for (const cached of this.bitmaps.values()) cached.bitmap.close()
    this.bitmaps.clear()
    this.bitmapBytes = 0
    for (const video of this.videos.values()) {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
    this.videos.clear()
    this.ready.clear()
  }
}
