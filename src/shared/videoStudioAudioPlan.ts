import type { VideoTimelineDocument } from './studio'
import { videoAudioOutput, videoAudioSettings } from './videoAudio'

export type VideoStudioAudioSource = { path: string; hasAudio: boolean }
export type VideoStudioAudioPlan = {
  enabled: boolean
  inputArgs: string[]
  filterComplex?: string
  outputArgs: string[]
  sourceCount: number
}

const seconds = (frame: number): string => (frame / 60).toFixed(6)

/** Build FFmpeg's one-pass AAC mix from V5's project and per-clip audio contract. */
export function buildVideoStudioAudioPlan(
  timeline: VideoTimelineDocument,
  media: ReadonlyMap<string, VideoStudioAudioSource>,
  projectInputIndex = 1
): VideoStudioAudioPlan {
  const master = videoAudioSettings(timeline.videoAudio)
  if (master.muted || master.volume === 0) return { enabled: false, inputArgs: [], outputArgs: ['-an'], sourceCount: 0 }
  const planned = [] as Array<{ path: string; startFrame: number; durationFrames: number; sourceStartFrame: number; gain: number; inputIndex: number }>
  for (const clip of timeline.videoClips ?? []) {
    const startFrame = Math.max(0, clip.startFrame)
    const endFrame = Math.min(timeline.durationFrames, clip.endFrame)
    const durationFrames = endFrame - startFrame
    const sourceStartFrame = Math.max(0, clip.sourceStartFrame)
    const sourceDurationFrames = Math.max(0, clip.sourceEndFrame - clip.sourceStartFrame)
    const output = videoAudioOutput(timeline.videoAudio, clip.audio, true)
    if (durationFrames <= 0 || sourceDurationFrames <= 0 || output.muted) continue
    const asset = media.get(clip.assetId)
    if (!asset) throw new Error(`A mídia de áudio do clipe ${clip.id} não está disponível.`)
    if (!asset.hasAudio) continue
    const gain = master.volume * videoAudioSettings(clip.audio).volume
    planned.push({ path: asset.path, startFrame, durationFrames: Math.min(durationFrames, sourceDurationFrames), sourceStartFrame, gain, inputIndex: projectInputIndex + planned.length })
  }
  if (!planned.length) return { enabled: false, inputArgs: [], outputArgs: ['-an'], sourceCount: 0 }

  const inputArgs: string[] = []
  const filters: string[] = []
  planned.forEach((source, index) => {
    inputArgs.push('-ss', seconds(source.sourceStartFrame), '-t', seconds(source.durationFrames), '-i', source.path)
    const delayMs = Math.round(source.startFrame / 60 * 1000)
    filters.push(`[${source.inputIndex}:a:0]atrim=duration=${seconds(source.durationFrames)},asetpts=PTS-STARTPTS,aresample=48000,volume=${source.gain.toFixed(6)},adelay=delays=${delayMs}:all=1[a${index}]`)
  })
  const projectDuration = seconds(timeline.durationFrames)
  if (planned.length === 1) filters.push(`[a0]apad=whole_dur=${projectDuration},atrim=duration=${projectDuration}[aout]`)
  else filters.push(`${planned.map((_, index) => `[a${index}]`).join('')}amix=inputs=${planned.length}:duration=longest:normalize=0:dropout_transition=0,alimiter=limit=0.95:latency=1,apad=whole_dur=${projectDuration},atrim=duration=${projectDuration}[aout]`)
  return {
    enabled: true,
    inputArgs,
    filterComplex: filters.join(';'),
    outputArgs: ['-map', '[aout]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'],
    sourceCount: planned.length
  }
}
