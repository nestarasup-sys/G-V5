import type { VideoAudioSettings } from './studio'

export function isValidVideoAudioSettings(value: unknown): value is VideoAudioSettings | undefined {
  if (value === undefined) return true
  if (!value || typeof value !== 'object') return false
  const settings = value as VideoAudioSettings
  return typeof settings.muted === 'boolean' && Number.isFinite(settings.volume) && settings.volume >= 0 && settings.volume <= 1
}

export function videoAudioSettings(value?: VideoAudioSettings): VideoAudioSettings {
  const volume = value?.volume
  return { volume: typeof volume === 'number' && Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1, muted: value?.muted === true }
}

/** One gain rule shared by preview playback and future video export. */
export function videoAudioOutput(master: VideoAudioSettings | undefined, clip: VideoAudioSettings | undefined, playing: boolean): VideoAudioSettings {
  const project = videoAudioSettings(master)
  const media = videoAudioSettings(clip)
  const volume = project.volume * media.volume
  return { volume, muted: !playing || project.muted || media.muted || volume === 0 }
}
