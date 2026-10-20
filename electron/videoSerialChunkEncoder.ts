import { isAbsolute } from 'node:path'
import { stat } from 'node:fs/promises'
import { VideoRawFrameWriter, buildVideoStudioChunkArgs, type RawFrameWriterResult } from './videoRawFrameWriter'
import type { VideoStudioFfmpegCapabilities } from './videoFfmpegCapabilities'

export type VideoSerialChunkRequest = Readonly<{
  ffmpeg: VideoStudioFfmpegCapabilities
  outputPath: string
  startFrame: number
  endFrameExclusive: number
  width?: 1920
  height?: 1080
  frameRate?: 60
}>

export type VideoSerialChunkProgress = Readonly<{
  startFrame: number
  endFrameExclusive: number
  completedFrames: number
  totalFrames: number
}>

export type VideoSerialFrameProvider = (absoluteFrame: number, signal: AbortSignal) => Promise<Buffer>

export type VideoSerialChunkResult = Readonly<{
  startFrame: number
  endFrameExclusive: number
  frameCount: number
  outputPath: string
  writer: RawFrameWriterResult
  outputBytes: number
}>

/**
 * Serial chunk encoder used as the correctness oracle before Turbo workers.
 * It knows nothing about React or scene composition; the caller provides one
 * exact RGBA frame for each absolute frame in [start,end).
 */
export async function encodeVideoStudioSerialChunk(
  request: VideoSerialChunkRequest,
  renderFrame: VideoSerialFrameProvider,
  options: {
    signal?: AbortSignal
    onProgress?: (progress: VideoSerialChunkProgress) => void
  } = {},
): Promise<VideoSerialChunkResult> {
  const { ffmpeg, outputPath, startFrame, endFrameExclusive } = request
  if (!ffmpeg?.smokeEncoded || !ffmpeg.videoEncoder) throw new Error('FFmpeg ainda não passou pelo capability probe do Video Studio.')
  if (!isAbsolute(ffmpeg.executable) || !isAbsolute(outputPath)) throw new Error('Encoder e saída precisam usar caminhos absolutos.')
  if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrameExclusive)
    || startFrame < 0 || endFrameExclusive <= startFrame) throw new Error('Intervalo serial inválido.')
  const frameCount = endFrameExclusive - startFrame
  if (frameCount > 600) throw new Error('O encoder serial de chunk aceita no máximo 600 frames por trecho.')
  const width = request.width ?? 1920
  const height = request.height ?? 1080
  const frameRate = request.frameRate ?? 60
  if (width !== 1920 || height !== 1080 || frameRate !== 60) throw new Error('O perfil atual de exportação exige 1920×1080 a 60 FPS.')
  const frameBytes = width * height * 4
  const controller = new AbortController()
  const relayAbort = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) relayAbort()
  else options.signal?.addEventListener('abort', relayAbort, { once: true })

  let pendingRender: Promise<Buffer> | null = null
  const writer = new VideoRawFrameWriter({
    executable: ffmpeg.executable,
    args: buildVideoStudioChunkArgs(outputPath, frameCount, 'rgba', ffmpeg.videoEncoder),
    outputPath,
    frameBytes,
    frameCount,
  })
  try {
    await writer.ready()
    // Keep exactly one render ahead of the writer. This overlaps Canvas/IPC
    // composition with FFmpeg stdin without allowing an unbounded frame queue.
    pendingRender = renderFrame(startFrame, controller.signal)
    for (let absoluteFrame = startFrame; absoluteFrame < endFrameExclusive; absoluteFrame += 1) {
      if (controller.signal.aborted) throw controller.signal.reason instanceof Error
        ? controller.signal.reason : new Error('Exportação cancelada.')
      const pixels = await pendingRender
      if (!Buffer.isBuffer(pixels)) throw new Error(`Renderer não devolveu Buffer RGBA no frame ${absoluteFrame}.`)
      if (pixels.byteLength !== frameBytes) throw new Error(`Renderer devolveu ${pixels.byteLength} bytes no frame ${absoluteFrame}; esperava ${frameBytes}.`)
      if (absoluteFrame + 1 < endFrameExclusive) {
        pendingRender = renderFrame(absoluteFrame + 1, controller.signal)
      }
      await writer.writeFrame(pixels, { copy: false })
      options.onProgress?.({
        startFrame,
        endFrameExclusive,
        completedFrames: absoluteFrame - startFrame + 1,
        totalFrames: frameCount,
      })
    }
    const writerResult = await writer.finish()
    const output = await stat(outputPath)
    if (!output.isFile() || output.size < 1) throw new Error('Chunk serial terminou sem arquivo de saída.')
    return { startFrame, endFrameExclusive, frameCount, outputPath, writer: writerResult, outputBytes: output.size }
  } catch (error) {
    await writer.cancel().catch(() => undefined)
    await pendingRender?.catch(() => undefined)
    throw error
  } finally {
    options.signal?.removeEventListener('abort', relayAbort)
  }
}
