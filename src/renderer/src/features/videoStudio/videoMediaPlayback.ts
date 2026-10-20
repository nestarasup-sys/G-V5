import { VideoPreviewSeekScheduler } from './videoPreviewSeekScheduler'
import type { VideoAudioSettings, VideoMediaClip } from '../../../../shared/studio'
import { videoAudioOutput } from '../../../../shared/videoAudio'

export type VideoPlaybackState = { clip: VideoMediaClip; frame: number; playing: boolean; masterAudio?: VideoAudioSettings }

/** A video's image and sound share one native media clock and one decoder. */
export class VideoMediaPlayback {
  private state: VideoPlaybackState | null = null
  private disposed = false
  private pending = false
  private blocked = false
  private request = 0
  private mediaErrorReported = false
  private readonly seekScheduler = new VideoPreviewSeekScheduler()

  constructor(private readonly media: HTMLVideoElement, private readonly onError: (message: string) => void) {}

  update(next: VideoPlaybackState): void {
    if (this.disposed) return
    const wasPlaying = this.state?.playing === true
    this.state = next
    const output = videoAudioOutput(next.masterAudio, next.clip.audio, next.playing)
    this.media.volume = output.volume
    this.media.muted = output.muted
    if (!next.playing) {
      if (wasPlaying || this.pending) this.request += 1
      this.seekScheduler.cancel()
      this.pending = false
      this.blocked = false
      if (!this.media.paused) this.media.pause()
    } else if (!wasPlaying) this.blocked = false

    if (this.media.readyState === 0 || !Number.isFinite(this.media.duration)) return
    const sourceTime = (next.clip.sourceStartFrame + next.frame - next.clip.startFrame) / 60
    const target = Math.max(0, Math.min(sourceTime, this.media.duration - 0.001))
    // Calling play() on ended media rewinds it; never replay its opening at the final frame.
    if (next.playing && this.media.ended && target >= this.media.duration - 1 / 60 - 0.00001) {
      this.media.muted = true
      return
    }
    // Let native playback run; coalesce scrubbing seeks so obsolete playhead
    // positions never flood the decoder while the pointer is still moving.
    if (Math.abs(this.media.currentTime - target) > (next.playing ? 0.15 : 1 / 120)) {
      this.seekScheduler.request(target, ({ targetSeconds }) => {
        if (this.disposed || !this.state) return
        try { this.media.currentTime = targetSeconds } catch { /* media error event reports a stable message */ }
      })
    }
    if (!next.playing || !this.media.paused || this.pending || this.blocked) return
    this.pending = true
    const request = ++this.request
    void this.media.play().then(() => {
      if (this.disposed || request !== this.request) return
      if (!this.state?.playing) {
        this.media.muted = true
        this.media.pause()
      }
      if (request === this.request) this.pending = false
    }).catch((reason: unknown) => {
      if (this.disposed || request !== this.request) return
      this.pending = false
      this.blocked = true
      this.media.muted = true
      this.media.pause()
      const denied = reason instanceof Error && reason.name === 'NotAllowedError'
      this.onError(denied ? 'A reprodução foi bloqueada. Clique em Pausar e depois em Play para ouvir o vídeo.' : 'Não foi possível reproduzir este vídeo e seu áudio. Tente abrir o arquivo em MP4 ou WebM compatível.')
    })
  }

  refresh(): void {
    if (this.state) this.update(this.state)
  }

  reportMediaError(): void {
    if (this.disposed || this.mediaErrorReported) return
    this.mediaErrorReported = true
    this.blocked = true
    this.pending = false
    this.request += 1
    this.media.muted = true
    this.media.pause()
    this.onError('Não foi possível carregar o vídeo e seu áudio. Confira se o arquivo continua na pasta deste projeto e usa um formato compatível.')
  }

  dispose(): void {
    this.disposed = true
    this.request += 1
    this.state = null
    this.seekScheduler.dispose()
    this.media.muted = true
    this.media.pause()
  }
}
