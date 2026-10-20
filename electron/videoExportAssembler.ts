import { randomUUID } from 'node:crypto'
import { isAbsolute, join, resolve } from 'node:path'
import { mkdtemp, rename, rm, stat } from 'node:fs/promises'
import type { VideoTimelineDocument } from '../src/shared/studio'
import { buildVideoStudioAudioPlan, type VideoStudioAudioSource } from '../src/shared/videoStudioAudioPlan'
import { runVideoStudioProcess, type VideoStudioFfmpegCapabilities } from './videoFfmpegCapabilities'

export type VideoStudioEncodedChunk = Readonly<{
  index: number
  startFrame: number
  endFrameExclusive: number
  path: string
}>

export type VideoStudioAssemblyResult = Readonly<{
  outputPath: string
  audio: boolean
  chunkCount: number
  sourceVideoBytes: number
  outputBytes: number
}>

function concatEscape(path: string): string {
  // FFmpeg concat demuxer uses libavutil escaping, not shell escaping.
  return path.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function validateChunks(chunks: ReadonlyArray<VideoStudioEncodedChunk>, durationFrames: number): void {
  if (!chunks.length) throw new Error('Nenhum chunk de vídeo foi fornecido.')
  let expectedStart = 0
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    if (chunk.index !== index || chunk.startFrame !== expectedStart || !Number.isSafeInteger(chunk.endFrameExclusive)
      || chunk.endFrameExclusive <= chunk.startFrame || chunk.endFrameExclusive > durationFrames || !isAbsolute(chunk.path)) {
      throw new Error('Chunks de vídeo não são contíguos ou estão fora da duração do projeto.')
    }
    expectedStart = chunk.endFrameExclusive
  }
  if (expectedStart !== durationFrames) throw new Error(`Chunks cobrem ${expectedStart} frames; esperava ${durationFrames}.`)
}

async function assertInputFiles(chunks: ReadonlyArray<VideoStudioEncodedChunk>): Promise<number> {
  let bytes = 0
  for (const chunk of chunks) {
    const info = await stat(chunk.path).catch(() => null)
    if (!info?.isFile() || info.size < 1) throw new Error(`Chunk ${chunk.index} ausente ou vazio.`)
    bytes += info.size
  }
  return bytes
}

async function concatenateChunks(
  ffmpeg: VideoStudioFfmpegCapabilities,
  chunks: ReadonlyArray<VideoStudioEncodedChunk>,
  outputPath: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const list = Buffer.from(chunks.map((chunk) => `file '${concatEscape(chunk.path)}'`).join('\n') + '\n', 'utf8')
  const result = await runVideoStudioProcess(ffmpeg.executable, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'concat', '-safe', '0', '-protocol_whitelist', 'file,pipe,crypto,data', '-i', 'pipe:0',
    '-map', '0:v:0', '-c:v', 'copy', '-an', '-movflags', '+faststart', '-f', 'mp4', outputPath,
  ], { input: list, timeoutMs, signal })
  if (result.code !== 0) throw new Error(`Concatenação dos chunks falhou. ${result.stderr}`)
  const info = await stat(outputPath).catch(() => null)
  if (!info?.isFile() || info.size < 1) throw new Error('Concatenação não produziu vídeo intermediário.')
}

/**
 * Assemble already encoded video chunks and mix source audio exactly once.
 * Chunks remain video-only. This keeps Turbo worker count independent of audio
 * and gives serial/Turbo the same mux path.
 */
export async function assembleVideoStudioOutput(
  input: {
    ffmpeg: VideoStudioFfmpegCapabilities
    chunks: ReadonlyArray<VideoStudioEncodedChunk>
    timeline: VideoTimelineDocument
    media: ReadonlyMap<string, VideoStudioAudioSource>
    outputPath: string
    tempRoot: string
    timeoutMs?: number
    signal?: AbortSignal
  },
): Promise<VideoStudioAssemblyResult> {
  if (!input.ffmpeg?.smokeEncoded) throw new Error('FFmpeg não passou pelo capability probe.')
  if (![input.outputPath, input.tempRoot].every(isAbsolute)) throw new Error('Montagem final exige caminhos absolutos.')
  if (input.timeline.frameRate !== 60 || !Number.isSafeInteger(input.timeline.durationFrames) || input.timeline.durationFrames < 1) {
    throw new Error('Timeline inválida para montagem final.')
  }
  validateChunks(input.chunks, input.timeline.durationFrames)
  const sourceVideoBytes = await assertInputFiles(input.chunks)
  const outputPath = resolve(input.outputPath)
  if (input.chunks.some((chunk) => resolve(chunk.path) === outputPath)) throw new Error('Saída final não pode sobrescrever um chunk de origem.')
  const timeoutMs = Math.max(10_000, Math.min(30 * 60_000, input.timeoutMs ?? 10 * 60_000))
  const folder = await mkdtemp(join(resolve(input.tempRoot), 'gacha-video-assemble-'))
  const finalTemp = `${outputPath}.assemble-${randomUUID()}.tmp.mp4`
  const videoInput = input.chunks.length === 1 ? input.chunks[0].path : join(folder, 'joined-video.mp4')
  try {
    if (input.chunks.length > 1) await concatenateChunks(input.ffmpeg, input.chunks, videoInput, timeoutMs, input.signal)
    const audio = buildVideoStudioAudioPlan(input.timeline, input.media, 1)
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', videoInput,
      ...audio.inputArgs,
      ...(audio.filterComplex ? ['-filter_complex', audio.filterComplex] : []),
      '-map', '0:v:0', '-c:v', 'copy',
      ...audio.outputArgs,
      '-t', (input.timeline.durationFrames / 60).toFixed(6),
      '-movflags', '+faststart', '-f', 'mp4', finalTemp,
    ]
    const mux = await runVideoStudioProcess(input.ffmpeg.executable, args, { timeoutMs, signal: input.signal })
    if (mux.code !== 0) throw new Error(`Mux final de vídeo/áudio falhou. ${mux.stderr}`)
    const temporaryFinal = await stat(finalTemp).catch(() => null)
    if (!temporaryFinal?.isFile() || temporaryFinal.size < 128) throw new Error('Mux final não produziu MP4 válido em tamanho mínimo.')
    // A crash during mux may leave only the unique temp file. Promote to the
    // canonical job/final.mp4 name only after FFmpeg has closed it cleanly.
    await rm(outputPath, { force: true }).catch(() => undefined)
    await rename(finalTemp, outputPath)
    const final = await stat(outputPath)
    return {
      outputPath,
      audio: audio.enabled,
      chunkCount: input.chunks.length,
      sourceVideoBytes,
      outputBytes: final.size,
    }
  } finally {
    await rm(finalTemp, { force: true }).catch(() => undefined)
    await rm(folder, { recursive: true, force: true }).catch(() => undefined)
  }
}
