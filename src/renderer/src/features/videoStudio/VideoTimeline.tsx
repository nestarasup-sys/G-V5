import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { StudioDocument, VideoTimelineDocument } from '../../../../shared/studio'

const DEFAULT_DURATION_FRAMES = 10 * 60 * 60
const DEFAULT_TIMELINE: VideoTimelineDocument = {
  schemaVersion: 1,
  frameRate: 60,
  durationFrames: DEFAULT_DURATION_FRAMES,
  playheadFrame: 0,
  playing: false,
  characterKeys: [],
  textClips: [],
  saveMarkers: []
}

export function videoTimelineFor(studio: StudioDocument): VideoTimelineDocument {
  return studio.videoTimeline ?? DEFAULT_TIMELINE
}

function formatTime(frame: number): string {
  const seconds = Math.floor(frame / 60)
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}:${String(frame % 60).padStart(2, '0')}`
}

export function VideoTimeline({ studio, playheadFrame, playing, height, onSeek, onTogglePlayback, onSaveFrame, onChangeDuration, onResize }: {
  studio: StudioDocument
  playheadFrame: number
  playing: boolean
  height: number
  onSeek: (frame: number) => void
  onTogglePlayback: () => void
  onSaveFrame: () => void
  onChangeDuration: (durationFrames: number) => void
  onResize: (height: number) => void
}) {
  const resizePointer = useRef<{ id: number; startY: number; startHeight: number } | null>(null)
  const timeline = videoTimelineFor(studio)
  const duration = Math.max(1, timeline.durationFrames)
  const characters = studio.elements.filter((element) => element.kind === 'character')
  const textTracks = (['speech', 'thought'] as const).map((kind) => ({
    kind,
    label: kind === 'speech' ? 'Falas' : 'Pensamentos',
    clips: studio.elements.filter((element) => element.kind === kind).map((element) => ({
      element,
      clip: timeline.textClips.find((item) => item.elementId === element.id)
    }))
  }))
  const setPlayheadFromInput = (value: string) => onSeek(Number(value))
  const resizeTimeline = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = resizePointer.current
    if (!drag || drag.id !== event.pointerId) return
    const maximum = Math.max(220, Math.floor(window.innerHeight * 0.65))
    onResize(Math.max(150, Math.min(maximum, drag.startHeight + drag.startY - event.clientY)))
  }
  const finishResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizePointer.current?.id !== event.pointerId) return
    resizePointer.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return <section className="video-timeline" aria-label="Timeline do Video Studio">
    <div className="video-timeline-resize" role="separator" aria-label="Redimensionar altura da timeline" aria-orientation="horizontal" aria-valuemin={150} aria-valuemax={Math.max(220, Math.floor(window.innerHeight * 0.65))} aria-valuenow={height} tabIndex={0}
      onKeyDown={(event) => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); onResize(Math.max(150, Math.min(Math.floor(window.innerHeight * 0.65), height + (event.key === 'ArrowUp' ? 24 : -24)))) } }}
      onPointerDown={(event) => { event.preventDefault(); resizePointer.current = { id: event.pointerId, startY: event.clientY, startHeight: height }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={resizeTimeline} onPointerUp={finishResize} onPointerCancel={finishResize}>
      <span /><span /><span />
    </div>
    <header className="video-timeline-toolbar">
      <div className="video-timeline-heading"><strong>Timeline</strong><span>{formatTime(playheadFrame)} / {formatTime(duration)}</span></div>
      <div className="video-timeline-actions">
        <button type="button" onClick={() => onChangeDuration(Math.max(60, duration - 60 * 60))} disabled={duration <= 3600 || timeline.characterKeys.some((key) => key.frame >= duration - 3600) || timeline.textClips.some((clip) => clip.endFrame > duration - 3600)} title="Reduzir duração em um minuto">− 1 min</button>
        <button type="button" onClick={() => onChangeDuration(duration + 60 * 60)} title="Aumentar duração em um minuto">+ 1 min</button>
        <button type="button" aria-label={playing ? 'Pausar reprodução' : 'Reproduzir'} onClick={onTogglePlayback}>{playing ? '❚❚' : '▶'}<span>{playing ? 'Pausar' : 'Play'}</span></button>
        <button className="primary" type="button" onClick={onSaveFrame}>Salvar frame</button>
      </div>
    </header>
    <div className="video-timeline-ruler-row">
      <span className="video-track-label">Faixas</span>
      <div className="video-timeline-ruler" aria-label="Posição do playhead">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((tick) => <span key={tick} style={{ left: `${tick * 10}%` }}>{formatTime(Math.round(duration * tick / 10))}</span>)}
        <input aria-label="Mover playhead" type="range" min={0} max={duration} step={1} value={Math.min(playheadFrame, duration)} onChange={(event) => setPlayheadFromInput(event.currentTarget.value)} />
      </div>
    </div>
    <div className="video-timeline-tracks">
      {characters.map((character) => {
        const keys = timeline.characterKeys.filter((key) => key.elementId === character.id).sort((a, b) => a.frame - b.frame)
        const name = character.text || studio.assets.find((asset) => asset.id === character.assetId)?.name || 'Personagem'
        return <div className="video-track-row" key={character.id}>
          <span className="video-track-label" title={name}>{name}</span>
          <div className="video-track-lane character-lane" aria-label={`Faixa de ${name}`}>
            <span className="video-character-span" />
            {timeline.saveMarkers.map((marker) => <i className="video-saved-marker" key={marker.id} style={{ left: `${Math.min(100, marker.frame / duration * 100)}%` }} title={`Frame salvo · ${formatTime(marker.frame)}`} />)}
            {keys.map((key) => <button type="button" className="video-keyframe" key={key.id} style={{ left: `${Math.min(100, key.frame / duration * 100)}%` }} title={`${formatTime(key.frame)} · ${key.faceMode}`} onClick={() => onSeek(key.frame)} aria-label={`Ir ao frame ${formatTime(key.frame)} de ${name}`} />)}
            <i className="video-lane-playhead" style={{ left: `${Math.min(100, playheadFrame / duration * 100)}%` }} />
          </div>
        </div>
      })}
      {textTracks.map(({ kind, label, clips }) => <div className="video-track-row" key={kind}>
        <span className="video-track-label">{label}</span>
        <div className={`video-track-lane ${kind}-lane`} aria-label={`Faixa de ${label.toLowerCase()}`}>
          {timeline.saveMarkers.map((marker) => <i className="video-saved-marker" key={marker.id} style={{ left: `${Math.min(100, marker.frame / duration * 100)}%` }} title={`Frame salvo · ${formatTime(marker.frame)}`} />)}
          {clips.map(({ element, clip }) => {
            const start = clip?.startFrame ?? 0
            const end = clip?.endFrame ?? Math.min(duration, start + 300)
            return <button type="button" className={`video-text-clip ${kind}-clip`} key={element.id} style={{ left: `${start / duration * 100}%`, width: `${Math.max(1, (end - start) / duration * 100)}%` }} title={element.text || (kind === 'speech' ? 'Fala' : 'Pensamento')} onClick={() => onSeek(start)}>{element.text || (kind === 'speech' ? 'Fala' : 'Pensamento')}</button>
          })}
          <i className="video-lane-playhead" style={{ left: `${Math.min(100, playheadFrame / duration * 100)}%` }} />
          {!clips.length && <span className="video-track-empty">Adicione {kind === 'speech' ? 'uma fala' : 'um pensamento'} pela barra de ferramentas</span>}
        </div>
      </div>)}
    </div>
    <footer className="video-timeline-footer"><span>60 FPS · duração inicial de 10 minutos</span><label>Ir para <input type="number" min={0} max={Math.floor(duration / 60)} value={Math.floor(playheadFrame / 60)} onChange={(event) => onSeek(Math.min(duration, Math.max(0, Number(event.currentTarget.value) || 0) * 60))} /> s</label></footer>
  </section>
}
