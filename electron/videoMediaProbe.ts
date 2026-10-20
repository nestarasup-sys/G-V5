import { isAbsolute } from 'node:path'
import { stat } from 'node:fs/promises'
import { runVideoStudioProcess } from './videoFfmpegCapabilities'

export type VideoMediaProbeInfo = Readonly<{
  path: string
  durationSeconds: number
  video: Readonly<{
    codec: string
    width: number
    height: number
    timeBase: string
    averageFrameRate: string
    realFrameRate: string
    variableFrameRate: boolean
    startTimeSeconds: number
    durationSeconds: number
  }>
  audio: null | Readonly<{
    codec: string
    sampleRate: number
    channels: number
    startTimeSeconds: number
    durationSeconds: number
  }>
}>

type Stream = {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  time_base?: string
  avg_frame_rate?: string
  r_frame_rate?: string
  start_time?: string
  duration?: string
  sample_rate?: string
  channels?: number
}

type ProbePayload = { streams?: Stream[]; format?: { duration?: string } }

function finiteNumber(value: unknown, label: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} inválido no FFprobe.`)
  return parsed
}

function positiveNumber(value: unknown, label: string): number {
  const parsed = finiteNumber(value, label)
  if (parsed < 0) throw new Error(`${label} inválido no FFprobe.`)
  return parsed
}

function rate(value: string | undefined): number | null {
  if (!value || value === '0/0') return null
  const [n, d = 1] = value.split('/').map(Number)
  return Number.isFinite(n) && Number.isFinite(d) && d !== 0 && n > 0 ? n / d : null
}

function validTimeBase(value: string | undefined): boolean {
  if (!value) return false
  const parts = value.split('/')
  if (parts.length !== 2) return false
  const n = Number(parts[0]), d = Number(parts[1])
  return Number.isSafeInteger(n) && Number.isSafeInteger(d) && n > 0 && d > 0
}

export function parseVideoMediaProbe(path: string, payload: ProbePayload): VideoMediaProbeInfo {
  if (!isAbsolute(path)) throw new Error('Probe de mídia exige caminho absoluto.')
  if (!payload || !Array.isArray(payload.streams)) throw new Error('FFprobe não retornou streams da mídia.')
  const videos = payload.streams.filter((stream) => stream.codec_type === 'video')
  if (videos.length !== 1) throw new Error(`A mídia precisa conter exatamente um stream de vídeo; recebeu ${videos.length}.`)
  const video = videos[0]
  if (!video.codec_name || !Number.isSafeInteger(video.width) || !Number.isSafeInteger(video.height)
    || (video.width ?? 0) < 1 || (video.height ?? 0) < 1 || !validTimeBase(video.time_base)) {
    throw new Error('Metadados do stream de vídeo estão incompletos.')
  }
  const avg = rate(video.avg_frame_rate)
  const real = rate(video.r_frame_rate)
  if (avg === null || real === null) throw new Error('Frame rate da mídia não pôde ser identificado.')
  const formatDuration = positiveNumber(payload.format?.duration, 'Duração da mídia')
  const videoDuration = video.duration === undefined ? formatDuration : positiveNumber(video.duration, 'Duração do vídeo')
  const videoStart = video.start_time === undefined ? 0 : finiteNumber(video.start_time, 'Início do vídeo')
  const audios = payload.streams.filter((stream) => stream.codec_type === 'audio')
  if (audios.length > 1) throw new Error('Mídia com múltiplos streams de áudio exige seleção explícita, ainda não suportada.')
  let audio: VideoMediaProbeInfo['audio'] = null
  if (audios[0]) {
    const stream = audios[0]
    const sampleRate = Number(stream.sample_rate)
    if (!stream.codec_name || !Number.isSafeInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 384_000
      || !Number.isSafeInteger(stream.channels) || (stream.channels ?? 0) < 1 || (stream.channels ?? 0) > 8) {
      throw new Error('Metadados do stream de áudio estão incompletos.')
    }
    audio = {
      codec: stream.codec_name,
      sampleRate,
      channels: stream.channels!,
      startTimeSeconds: stream.start_time === undefined ? 0 : finiteNumber(stream.start_time, 'Início do áudio'),
      durationSeconds: stream.duration === undefined ? formatDuration : positiveNumber(stream.duration, 'Duração do áudio'),
    }
  }
  // avg_frame_rate vs r_frame_rate is only a heuristic; export still addresses source by timestamp/PTS.
  const variableFrameRate = Math.abs(avg - real) > 1e-6
  return {
    path,
    durationSeconds: formatDuration,
    video: {
      codec: video.codec_name,
      width: video.width!,
      height: video.height!,
      timeBase: video.time_base!,
      averageFrameRate: video.avg_frame_rate!,
      realFrameRate: video.r_frame_rate!,
      variableFrameRate,
      startTimeSeconds: videoStart,
      durationSeconds: videoDuration,
    },
    audio,
  }
}

export async function probeVideoMedia(
  ffprobeExecutable: string,
  path: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<VideoMediaProbeInfo> {
  if (!isAbsolute(ffprobeExecutable) || !isAbsolute(path)) throw new Error('FFprobe e mídia precisam usar caminhos absolutos.')
  const info = await stat(path).catch(() => null)
  if (!info?.isFile() || info.size < 1) throw new Error('Mídia de origem não foi encontrada.')
  const result = await runVideoStudioProcess(ffprobeExecutable, [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,time_base,avg_frame_rate,r_frame_rate,start_time,duration,sample_rate,channels',
    '-of', 'json', path,
  ], { timeoutMs: options.timeoutMs ?? 30_000, signal: options.signal })
  if (result.code !== 0) throw new Error(`FFprobe falhou ao analisar mídia. ${result.stderr}`)
  let payload: ProbePayload
  try { payload = JSON.parse(result.stdout) as ProbePayload }
  catch { throw new Error('FFprobe retornou JSON inválido para a mídia.') }
  return parseVideoMediaProbe(path, payload)
}
