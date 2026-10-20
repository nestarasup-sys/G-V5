import { isAbsolute } from 'node:path'
import { stat } from 'node:fs/promises'
import { runVideoStudioProcess } from './videoFfmpegCapabilities'

export type VideoStudioOutputExpectation = Readonly<{
  width: 1920
  height: 1080
  frameRate: 60
  durationFrames: number
  audio: boolean
}>

type ProbeStream = {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  r_frame_rate?: string
  avg_frame_rate?: string
  nb_read_frames?: string
  sample_rate?: string
  channels?: number
  duration?: string
  start_time?: string
}

type ProbePayload = { streams?: ProbeStream[]; format?: { duration?: string; format_name?: string } }

export type VideoStudioOutputVerification = Readonly<{
  videoCodec: 'h264'
  audioCodec: 'aac' | null
  width: 1920
  height: 1080
  frameRate: 60
  decodedFrames: number
  durationSeconds: number
  audioSampleRate: 48000 | null
  audioChannels: number | null
}>

function rational(value: string | undefined): number | null {
  if (!value) return null
  const [numerator, denominator = '1'] = value.split('/')
  const n = Number(numerator), d = Number(denominator)
  return Number.isFinite(n) && Number.isFinite(d) && d !== 0 ? n / d : null
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Pure validator so codec/timestamp regressions are covered without requiring FFmpeg in unit tests. */
export function verifyVideoStudioProbePayload(
  payload: ProbePayload,
  expected: VideoStudioOutputExpectation,
): VideoStudioOutputVerification {
  if (!payload || !Array.isArray(payload.streams)) throw new Error('FFprobe não retornou streams válidos.')
  if (expected.width !== 1920 || expected.height !== 1080 || expected.frameRate !== 60
    || !Number.isSafeInteger(expected.durationFrames) || expected.durationFrames < 1) throw new Error('Expectativa de saída inválida.')

  const videos = payload.streams.filter((stream) => stream.codec_type === 'video')
  const audios = payload.streams.filter((stream) => stream.codec_type === 'audio')
  if (videos.length !== 1) throw new Error(`Esperava exatamente um stream de vídeo; recebeu ${videos.length}.`)
  if (expected.audio ? audios.length !== 1 : audios.length !== 0) {
    throw new Error(expected.audio ? 'A saída deveria conter exatamente um stream de áudio.' : 'A saída sem áudio contém stream inesperado.')
  }

  const video = videos[0]
  if (video.codec_name !== 'h264') throw new Error(`Codec de vídeo inesperado: ${video.codec_name ?? 'ausente'}.`)
  if (video.width !== expected.width || video.height !== expected.height) throw new Error(`Resolução inesperada: ${video.width}×${video.height}.`)
  const fps = rational(video.r_frame_rate) ?? rational(video.avg_frame_rate)
  if (fps === null || Math.abs(fps - expected.frameRate) > 1e-9) throw new Error(`Frame rate inesperado: ${video.r_frame_rate ?? video.avg_frame_rate ?? 'ausente'}.`)
  const decodedFrames = finiteNumber(video.nb_read_frames)
  if (decodedFrames === null || !Number.isSafeInteger(decodedFrames) || decodedFrames !== expected.durationFrames) {
    throw new Error(`Contagem de frames inválida: ${video.nb_read_frames ?? 'ausente'}; esperava ${expected.durationFrames}.`)
  }

  const projectDuration = expected.durationFrames / expected.frameRate
  const videoDuration = finiteNumber(video.duration)
  const formatDuration = finiteNumber(payload.format?.duration)
  const durationSeconds = videoDuration ?? formatDuration
  if (durationSeconds === null) throw new Error('A duração da saída não pôde ser verificada.')
  // H.264/AAC container timestamps may round to the stream timebase; one output-frame tolerance is sufficient.
  if (Math.abs(durationSeconds - projectDuration) > 1 / expected.frameRate + 1e-6) {
    throw new Error(`Duração inesperada: ${durationSeconds.toFixed(6)}s; esperava ${projectDuration.toFixed(6)}s.`)
  }

  let audioSampleRate: 48000 | null = null
  let audioChannels: number | null = null
  if (expected.audio) {
    const audio = audios[0]
    if (audio.codec_name !== 'aac') throw new Error(`Codec de áudio inesperado: ${audio.codec_name ?? 'ausente'}.`)
    const rate = finiteNumber(audio.sample_rate)
    if (rate !== 48000) throw new Error(`Sample rate de áudio inesperado: ${audio.sample_rate ?? 'ausente'}.`)
    if (!Number.isSafeInteger(audio.channels) || (audio.channels ?? 0) < 1 || (audio.channels ?? 0) > 2) throw new Error('Número de canais de áudio inválido.')
    audioSampleRate = 48000
    audioChannels = audio.channels!
  }

  return {
    videoCodec: 'h264',
    audioCodec: expected.audio ? 'aac' : null,
    width: 1920,
    height: 1080,
    frameRate: 60,
    decodedFrames,
    durationSeconds,
    audioSampleRate,
    audioChannels,
  }
}

/** FFprobe + a full FFmpeg decode. A file is not publishable until both pass. */
export async function verifyVideoStudioOutput(
  input: {
    ffprobeExecutable: string
    ffmpegExecutable: string
    outputPath: string
    expected: VideoStudioOutputExpectation
    timeoutMs?: number
    signal?: AbortSignal
  },
): Promise<VideoStudioOutputVerification> {
  if (![input.ffprobeExecutable, input.ffmpegExecutable, input.outputPath].every(isAbsolute)) {
    throw new Error('Verificação de saída exige caminhos absolutos.')
  }
  const file = await stat(input.outputPath).catch(() => null)
  if (!file?.isFile() || file.size < 128) throw new Error('MP4 final ausente ou vazio.')
  const timeoutMs = Math.max(5_000, Math.min(120_000, input.timeoutMs ?? 120_000))

  const probe = await runVideoStudioProcess(input.ffprobeExecutable, [
    '-v', 'error', '-count_frames',
    '-show_entries', 'format=duration,format_name:stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,nb_read_frames,sample_rate,channels,duration,start_time',
    '-of', 'json', input.outputPath,
  ], { timeoutMs, signal: input.signal })
  if (probe.code !== 0) throw new Error(`FFprobe rejeitou o MP4 final. ${probe.stderr}`)
  let payload: ProbePayload
  try { payload = JSON.parse(probe.stdout) as ProbePayload }
  catch { throw new Error('FFprobe retornou JSON inválido.') }
  const verified = verifyVideoStudioProbePayload(payload, input.expected)

  const decode = await runVideoStudioProcess(input.ffmpegExecutable, [
    '-v', 'error', '-nostdin', '-i', input.outputPath, '-map', '0:v:0',
    ...(input.expected.audio ? ['-map', '0:a:0'] : []),
    '-f', 'null', '-',
  ], { timeoutMs, signal: input.signal })
  if (decode.code !== 0 || decode.stderr.trim()) throw new Error(`O decode integral do MP4 final falhou. ${decode.stderr}`)
  return verified
}
