import { useEffect, useRef } from 'react'
import type { VideoAudioSettings, VideoMediaClip } from '../../../../shared/studio'
import { videoAudioOutput } from '../../../../shared/videoAudio'
import { VideoMediaPlayback } from './videoMediaPlayback'

export function VideoStudioClipPreview({ studioId, clip, playheadFrame, playing, masterAudio, onPlaybackError }: {
  studioId: string
  clip: VideoMediaClip
  playheadFrame: number
  playing: boolean
  masterAudio?: VideoAudioSettings
  onPlaybackError: (message: string) => void
}) {
  const mediaRef = useRef<HTMLVideoElement>(null)
  const playbackRef = useRef<VideoMediaPlayback | null>(null)
  const sourceUrl = `gacha-video://studio/${studioId}/${clip.assetId}`
  useEffect(() => {
    if (!mediaRef.current) return
    const playback = new VideoMediaPlayback(mediaRef.current, onPlaybackError)
    playbackRef.current = playback
    return () => { playback.dispose(); playbackRef.current = null }
  }, [sourceUrl, onPlaybackError])
  useEffect(() => {
    playbackRef.current?.update({ clip, frame: playheadFrame, playing, masterAudio })
  }, [clip, playheadFrame, playing, masterAudio, sourceUrl, onPlaybackError])
  return <video ref={mediaRef} className="video-studio-video-clip-preview" src={sourceUrl} muted={videoAudioOutput(masterAudio, clip.audio, playing).muted} playsInline preload="auto" onLoadedMetadata={() => playbackRef.current?.refresh()} onError={() => playbackRef.current?.reportMediaError()} aria-hidden="true" />
}
