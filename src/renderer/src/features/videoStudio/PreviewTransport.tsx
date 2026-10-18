import type { CSSProperties } from 'react'
import type { VideoAudioSettings } from '../../../../shared/studio'
import { videoAudioSettings } from '../../../../shared/videoAudio'

function timecode(frame: number) {
  const seconds = Math.floor(frame / 60)
  const hours = Math.floor(seconds / 3600)
  return `${hours ? `${String(hours).padStart(2, '0')}:` : ''}${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}:${String(frame % 60).padStart(2, '0')}`
}

export function PreviewTransport({ preparing, frame, duration, playing, audio, onSeek, onTogglePlayback, onAudioChange, onBeginAudioEdit }: {
  preparing: boolean
  frame: number
  duration: number
  playing: boolean
  audio?: VideoAudioSettings
  onSeek: (frame: number) => void
  onTogglePlayback: () => void
  onAudioChange: (audio: VideoAudioSettings, record?: boolean) => void
  onBeginAudioEdit: () => void
}) {
  const current = Math.max(0, Math.min(frame, duration))
  const settings = videoAudioSettings(audio)
  const muted = settings.muted || settings.volume === 0
  return <footer className="video-preview-transport" aria-label="Controles da reprodução em tela cheia">
    <input className="video-preview-scrubber" type="range" min={0} max={duration} step={1} value={current} aria-label="Posição na timeline" aria-valuetext={`${timecode(current)} de ${timecode(duration)}`} style={{ '--preview-progress': `${duration > 0 ? current / duration * 100 : 0}%` } as CSSProperties} onChange={(event) => onSeek(Number(event.currentTarget.value))} />
    <div className="video-preview-transport-row">
      <button type="button" aria-label="Voltar ao início" title="Voltar ao início" onClick={() => onSeek(0)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5v14M19 5 8 12l11 7V5Z" /></svg></button>
      <button type="button" title="Voltar 5 segundos" aria-label="Voltar 5 segundos" onClick={() => onSeek(current - 300)}>−5s</button>
      <button className="video-preview-play" type="button" aria-label={preparing ? 'Cancelar preparação das animações' : playing ? 'Pausar reprodução' : 'Reproduzir'} aria-busy={preparing} title={preparing ? 'Preparando animações… Clique para cancelar' : playing ? 'Pausar' : 'Reproduzir'} onClick={onTogglePlayback}><svg viewBox="0 0 24 24" aria-hidden="true">{playing ? <path d="M6 4h4v16H6ZM14 4h4v16h-4Z" /> : <path d="m7 3 15 9-15 9V3Z" />}</svg></button>
      <button type="button" title="Avançar 5 segundos" aria-label="Avançar 5 segundos" onClick={() => onSeek(current + 300)}>+5s</button>
      <output className="video-preview-time" aria-label="Tempo atual e duração">{timecode(current)}<span> / {timecode(duration)}</span></output>
      <div className="video-preview-volume">
        <button type="button" aria-label={muted ? 'Ativar áudio' : 'Silenciar áudio'} aria-pressed={muted} title={muted ? 'Ativar áudio' : 'Silenciar áudio'} onClick={() => onAudioChange({ volume: settings.volume || 1, muted: !muted })}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4 6 8H3v8h3l5 4V4Z" />{muted ? <path d="m16 9 6 6m0-6-6 6" /> : <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />}</svg></button>
        <input aria-label="Volume da prévia" type="range" min={0} max={100} step={1} value={Math.round(settings.volume * 100)} onPointerDown={onBeginAudioEdit} onKeyDown={(event) => { if (!event.repeat && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) onBeginAudioEdit() }} onChange={(event) => onAudioChange({ volume: Number(event.currentTarget.value) / 100, muted: false }, false)} />
      </div>
      <small>60 FPS</small>
    </div>
  </footer>
}
