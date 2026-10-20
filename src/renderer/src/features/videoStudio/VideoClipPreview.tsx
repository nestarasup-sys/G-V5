import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { VideoAudioSettings, VideoClipTransform, VideoMediaClip, VideoStudioAsset } from '../../../../shared/studio'
import { defaultVideoTransform } from '../../../../shared/videoMedia'
import { videoAudioOutput } from '../../../../shared/videoAudio'
import { VideoMediaPlayback } from './videoMediaPlayback'

type CompositionDrag = { pointerId: number; clientX: number; clientY: number; stageWidth: number; stageHeight: number; original: VideoClipTransform; corner?: { x: number; y: number }; started: boolean }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export function VideoStudioClipPreview({ studioId, asset, clip, playheadFrame, playing, masterAudio, onPlaybackError, onFramePresented, selected, editable, onSelect, onBeginEdit, onTransform }: {
  studioId: string
  asset?: VideoStudioAsset
  clip: VideoMediaClip
  playheadFrame: number
  playing: boolean
  masterAudio?: VideoAudioSettings
  onPlaybackError: (message: string) => void
  /** Optional frame-ready signal used by the isolated visual oracle. */
  onFramePresented?: (frame: number, clipId: string) => void
  selected: boolean
  editable: boolean
  onSelect: () => void
  onBeginEdit: () => void
  onTransform: (transform: VideoClipTransform) => void
}) {
  const mediaRef = useRef<HTMLVideoElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<CompositionDrag | null>(null)
  const playbackRef = useRef<VideoMediaPlayback | null>(null)
  const [proxyUrl, setProxyUrl] = useState<string | null>(null)
  const sourceUrl = proxyUrl ?? `gacha-video://studio/${studioId}/${clip.assetId}`
  useEffect(() => {
    let cancelled = false
    setProxyUrl(null)
    if (!asset) return () => { cancelled = true }
    const preparePreview = window.desktop.prepareVideoPreviewMedia
    // The restricted export/oracle preload intentionally omits the regular
    // app's proxy IPC; its already-authorized gacha-video source remains valid.
    if (typeof preparePreview !== 'function') return () => { cancelled = true }
    void preparePreview(studioId, asset).then((prepared) => {
      if (!cancelled) setProxyUrl(prepared.proxyUrl)
    }).catch(() => {
      // Proxy is an optimization only. Original project media remains the fallback.
    })
    return () => { cancelled = true }
  }, [studioId, asset?.id, asset?.size, asset?.durationFrames])
  useEffect(() => {
    if (!mediaRef.current) return
    const playback = new VideoMediaPlayback(mediaRef.current, onPlaybackError)
    playbackRef.current = playback
    return () => { playback.dispose(); playbackRef.current = null }
  }, [sourceUrl, onPlaybackError])
  useEffect(() => {
    const media = mediaRef.current
    let disposed = false
    let frameCallback: number | null = null
    let presentationTimeout: number | null = null
    let presentationPending = false
    const sourceTime = (clip.sourceStartFrame + playheadFrame - clip.startFrame) / 60
    const target = media && Number.isFinite(media.duration) ? Math.max(0, Math.min(sourceTime, media.duration - 0.001)) : sourceTime
    const finishPresented = () => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!disposed && media === mediaRef.current && Math.abs(media.currentTime - target) <= 0.001) onFramePresented?.(playheadFrame, clip.id)
      }))
    }
    const reportPresented = () => {
      if (!media || disposed || !onFramePresented || presentationPending
        || media.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !Number.isFinite(media.duration)
        || Math.abs(media.currentTime - target) > 0.001) return
      // For the isolated oracle, currentTime/seeked alone is not a presentation
      // barrier: Chromium can expose the target timestamp while capturePage still
      // contains the previously decoded frame. requestVideoFrameCallback confirms
      // that a frame for the sought media time reached the compositor.
      if (typeof media.requestVideoFrameCallback === 'function') {
        presentationPending = true
        presentationTimeout = window.setTimeout(() => {
          presentationPending = false
          presentationTimeout = null
          if (!disposed) onPlaybackError('O decoder não apresentou o frame solicitado em até 2 segundos.')
        }, 2000)
        frameCallback = media.requestVideoFrameCallback((_now, metadata) => {
          frameCallback = null
          presentationPending = false
          if (presentationTimeout !== null) window.clearTimeout(presentationTimeout)
          presentationTimeout = null
          if (disposed || Math.abs(media.currentTime - target) > 0.001) return
          if (Math.abs(metadata.mediaTime - target) > 1 / 120 + 0.001) {
            reportPresented()
            return
          }
          finishPresented()
        })
        return
      }
      finishPresented()
    }
    media?.addEventListener('loadeddata', reportPresented)
    media?.addEventListener('seeked', reportPresented)
    media?.addEventListener('timeupdate', reportPresented)
    playbackRef.current?.update({ clip, frame: playheadFrame, playing, masterAudio })
    reportPresented()
    return () => {
      disposed = true
      if (frameCallback !== null && media && typeof media.cancelVideoFrameCallback === 'function') media.cancelVideoFrameCallback(frameCallback)
      if (presentationTimeout !== null) window.clearTimeout(presentationTimeout)
      media?.removeEventListener('loadeddata', reportPresented)
      media?.removeEventListener('seeked', reportPresented)
      media?.removeEventListener('timeupdate', reportPresented)
    }
  }, [clip, playheadFrame, playing, masterAudio, sourceUrl, onPlaybackError, onFramePresented])
  const transform = clip.transform ?? defaultVideoTransform
  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    onSelect()
    if (!editable) return
    const stage = wrapperRef.current?.parentElement?.getBoundingClientRect()
    if (!stage?.width || !stage.height) return
    const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-video-corner]')?.dataset.videoCorner
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, stageWidth: stage.width, stageHeight: stage.height, original: { ...transform }, started: false,
      corner: handle ? { x: handle.includes('w') ? -1 : 1, y: handle.includes('n') ? -1 : 1 } : undefined }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !editable) return
    const dx = event.clientX - drag.clientX, dy = event.clientY - drag.clientY
    if (!drag.started) {
      if (Math.hypot(dx, dy) < 2) return
      onBeginEdit()
      drag.started = true
    }
    const original = drag.original
    if (!drag.corner) {
      onTransform({ ...original, x: clamp(original.x + dx / drag.stageWidth * 100, -300, 300), y: clamp(original.y + dy / drag.stageHeight * 100, -300, 300) })
      return
    }
    // Work in the rotated video's local axes and keep the opposite corner anchored.
    const angle = original.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle)
    const localX = dx * cos + dy * sin, localY = -dx * sin + dy * cos
    const width = clamp(original.width + drag.corner.x * localX / drag.stageWidth * 100, 1, 300)
    const height = clamp(original.height + drag.corner.y * localY / drag.stageHeight * 100, 1, 300)
    const shiftX = (width - original.width) * drag.stageWidth / 100 * drag.corner.x / 2
    const shiftY = (height - original.height) * drag.stageHeight / 100 * drag.corner.y / 2
    onTransform({ ...original, width, height, x: clamp(original.x + (shiftX * cos - shiftY * sin) / drag.stageWidth * 100, -300, 300), y: clamp(original.y + (shiftX * sin + shiftY * cos) / drag.stageHeight * 100, -300, 300) })
  }
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <div ref={wrapperRef} className={`video-studio-video-composition${selected ? ' selected' : ''}${editable ? '' : ' locked'}`} style={{ left: `${50 + transform.x}%`, top: `${50 + transform.y}%`, width: `${transform.width}%`, height: `${transform.height}%`, transform: `translate(-50%, -50%) rotate(${transform.rotation}deg)` }} onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { dragRef.current = null }}>
    <video ref={mediaRef} className="video-studio-video-clip-preview" src={sourceUrl} muted={videoAudioOutput(masterAudio, clip.audio, playing).muted} playsInline preload="auto" onLoadedMetadata={() => playbackRef.current?.refresh()} onError={() => playbackRef.current?.reportMediaError()} aria-hidden="true" />
    {selected && editable && ['nw', 'ne', 'sw', 'se'].map((corner) => <span key={corner} className={`video-studio-video-resize ${corner}`} data-video-corner={corner} aria-hidden="true" />)}
  </div>
}
