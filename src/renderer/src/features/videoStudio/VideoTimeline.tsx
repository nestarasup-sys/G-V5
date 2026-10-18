import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { videoCharacterTrackColor } from '../../../../shared/studio'
import type { StudioDocument, VideoTimelineDocument } from '../../../../shared/studio'

const DEFAULT_DURATION_FRAMES = 10 * 60 * 60
const DEFAULT_TIMELINE: VideoTimelineDocument = {
  schemaVersion: 1, frameRate: 60, durationFrames: DEFAULT_DURATION_FRAMES,
  playheadFrame: 0, playing: false, characterKeys: [], textClips: [], saveMarkers: []
}

export function videoTimelineFor(studio: StudioDocument): VideoTimelineDocument {
  return studio.videoTimeline ?? DEFAULT_TIMELINE
}

function formatTime(frame: number): string {
  const seconds = Math.floor(frame / 60)
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}:${String(frame % 60).padStart(2, '0')}`
}

export function VideoTimeline({ studio, playheadFrame, playing, height, presetNames, onSeek, onTogglePlayback, onSaveFrame, onChangeDuration, onResize, onAddText }: {
  studio: StudioDocument
  playheadFrame: number
  playing: boolean
  height: number
  presetNames: Record<string, string>
  onSeek: (frame: number) => void
  onTogglePlayback: () => void
  onSaveFrame: () => void
  onChangeDuration: (durationFrames: number) => void
  onResize: (height: number) => void
  onAddText: (kind: 'speech' | 'thought') => void
}) {
  const resizePointer = useRef<{ id: number; startY: number; startHeight: number } | null>(null)
  const timelineScrollRef = useRef<HTMLDivElement>(null)
  const [pixelsPerSecond, setPixelsPerSecond] = useState(() => {
    try {
      const stored = Number(window.localStorage.getItem('gacha-nymi-video-timeline-zoom'))
      return Number.isFinite(stored) && stored >= 1 ? Math.min(stored, 120) : 37
    } catch { return 37 }
  })
  const timeline = videoTimelineFor(studio)
  const duration = Math.max(1, timeline.durationFrames)
  const timelineSeconds = duration / 60
  const timelineWidth = timelineSeconds * pixelsPerSecond
  const contentWidth = timelineWidth + 96
  const tickSeconds = pixelsPerSecond >= 16 ? 5 : Math.max(1, Math.ceil(80 / pixelsPerSecond))
  const tickCount = Math.floor(timelineSeconds / tickSeconds)
  const characters = studio.elements.filter((element) => element.kind === 'character')
  const textTracks = (['speech', 'thought'] as const).map((kind) => ({
    kind,
    label: kind === 'speech' ? 'Falas' : 'Pensamentos',
    clips: studio.elements.filter((element) => element.kind === kind).map((element) => ({
      element, clip: timeline.textClips.find((item) => item.elementId === element.id)
    }))
  }))
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
  const setZoom = (value: number) => {
    const zoom = Math.max(1, Math.min(120, value))
    setPixelsPerSecond(zoom)
    try { window.localStorage.setItem('gacha-nymi-video-timeline-zoom', String(zoom)) } catch { /* Keep zoom available for this session. */ }
  }
  const fitTimeline = () => {
    const availableWidth = Math.max(180, (timelineScrollRef.current?.clientWidth ?? 1000) - 96)
    setZoom(availableWidth / timelineSeconds)
    if (timelineScrollRef.current) timelineScrollRef.current.scrollLeft = 0
  }

  return <section className="video-timeline" aria-label="Timeline do Video Studio">
    <div className="video-timeline-resize" role="separator" aria-label="Redimensionar altura da timeline" aria-orientation="horizontal" aria-valuemin={150} aria-valuemax={Math.max(220, Math.floor(window.innerHeight * 0.65))} aria-valuenow={height} tabIndex={0}
      onKeyDown={(event) => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); onResize(Math.max(150, Math.min(Math.floor(window.innerHeight * 0.65), height + (event.key === 'ArrowUp' ? 24 : -24)))) } }}
      onPointerDown={(event) => { event.preventDefault(); resizePointer.current = { id: event.pointerId, startY: event.clientY, startHeight: height }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={resizeTimeline} onPointerUp={finishResize} onPointerCancel={finishResize}>
      <span /><span /><span />
    </div>
    <header className="video-timeline-toolbar">
      <div className="video-timeline-create-actions"><button type="button" onClick={() => onAddText('speech')}>+ Fala</button><button type="button" onClick={() => onAddText('thought')}>+ Pensamento</button></div>
      <div className="video-timeline-heading"><strong>{formatTime(playheadFrame)}</strong><span>/ {formatTime(duration)}</span><small>{timeline.characterKeys.length + timeline.textClips.length} eventos</small><button type="button" className="video-play-button" aria-label={playing ? 'Pausar reprodução' : 'Reproduzir'} onClick={onTogglePlayback}>{playing ? '❚❚' : '▶'}<span>{playing ? 'Pausar' : 'Play'}</span></button><button type="button" className="video-split-button" onClick={onSaveFrame} title="Dividir a faixa no playhead">✂ Dividir</button></div>
      <div className="video-timeline-actions">
        <button type="button" onClick={() => onChangeDuration(Math.max(60, duration - 3600))} disabled={duration <= 3600 || timeline.characterKeys.some((key) => key.frame >= duration - 3600) || timeline.textClips.some((clip) => clip.endFrame > duration - 3600)} title="Reduzir duração em um minuto">− 1 min</button>
        <button type="button" onClick={() => onChangeDuration(duration + 3600)} title="Aumentar duração em um minuto">+ 1 min</button>
        <button type="button" onClick={fitTimeline}>Fit</button>
        <button type="button" className="video-zoom-button" onClick={() => setZoom(pixelsPerSecond / 1.25)} title="Diminuir zoom">−</button>
        <label className="video-zoom-control"><span>{pixelsPerSecond.toFixed(0)} px/s</span><input aria-label="Zoom horizontal da timeline" type="range" min={1} max={120} step={1} value={pixelsPerSecond} onChange={(event) => setZoom(Number(event.currentTarget.value))} /></label>
        <button type="button" className="video-zoom-button" onClick={() => setZoom(pixelsPerSecond * 1.25)} title="Aumentar zoom">+</button>
      </div>
    </header>
    <div className="video-timeline-scroll" ref={timelineScrollRef}>
      <div className="video-timeline-content" style={{ width: `${contentWidth}px` }}>
        <div className="video-timeline-ruler-row">
          <span className="video-track-label video-ruler-label">Faixas</span>
          <div className="video-timeline-ruler" style={{ width: `${timelineWidth}px`, backgroundSize: `${tickSeconds * pixelsPerSecond}px 100%` }} aria-label="Posição do playhead">
            {Array.from({ length: tickCount + 1 }, (_, index) => index * tickSeconds).map((second) => <span key={second} style={{ left: `${second * pixelsPerSecond}px` }}>{`${String(Math.floor(second / 60)).padStart(2, '0')}:${String(second % 60).padStart(2, '0')}`}</span>)}
            <input aria-label="Mover playhead" type="range" min={0} max={duration} step={1} value={Math.min(playheadFrame, duration)} onChange={(event) => onSeek(Number(event.currentTarget.value))} />
          </div>
        </div>
        <div className="video-timeline-tracks">
          {textTracks.map(({ kind, label, clips }) => <div className="video-track-row" key={kind}>
            <span className="video-track-label"><i className={`video-track-badge ${kind}`}>{kind === 'speech' ? 'F' : 'P'}</i><span>{label}</span></span>
            <div className={`video-track-lane ${kind}-lane`} style={{ backgroundSize: `${tickSeconds * pixelsPerSecond}px 100%` }} aria-label={`Faixa de ${label.toLowerCase()}`}>
              {timeline.saveMarkers.map((marker) => <i className="video-saved-marker" key={marker.id} style={{ left: `${marker.frame / 60 * pixelsPerSecond}px` }} title={`Frame salvo · ${formatTime(marker.frame)}`} />)}
              {clips.map(({ element, clip }) => {
                const start = clip?.startFrame ?? 0
                const end = clip?.endFrame ?? Math.min(duration, start + 300)
                return <button type="button" className={`video-text-clip ${kind}-clip`} key={element.id} style={{ left: `${start / 60 * pixelsPerSecond}px`, width: `${Math.max(3, (end - start) / 60 * pixelsPerSecond)}px` }} title={element.text || (kind === 'speech' ? 'Fala' : 'Pensamento')} onClick={() => onSeek(start)}>{element.text || (kind === 'speech' ? 'Fala' : 'Pensamento')}</button>
              })}
              <i className="video-lane-playhead" style={{ left: `${playheadFrame / 60 * pixelsPerSecond}px` }} />
              {!clips.length && <span className="video-track-empty">Adicione {kind === 'speech' ? 'uma fala' : 'um pensamento'} pela barra de ferramentas</span>}
            </div>
          </div>)}
          {characters.map((character) => {
            const keys = timeline.characterKeys.filter((key) => key.elementId === character.id).sort((a, b) => a.frame - b.frame)
            const name = character.text || studio.assets.find((asset) => asset.id === character.assetId)?.name || 'Personagem'
            const color = videoCharacterTrackColor(character.id, character.timelineColor)
            const states = keys.length
              ? [...(keys[0].frame > 0 ? [{ id: `base:${character.id}`, start: 0, end: keys[0].frame, label: 'Base' }] : []), ...keys.map((key, index) => ({ id: key.id, start: key.frame, end: keys[index + 1]?.frame ?? duration, label: key.expressionPresetId ? presetNames[key.expressionPresetId] ?? 'Expressão' : key.faceMode === 'idle' ? 'Base' : key.faceMode === 'blink' ? 'Blink' : 'Talk' }))]
              : [{ id: `base:${character.id}`, start: 0, end: duration, label: 'Base' }]
            return <div className="video-track-row" key={character.id}>
              <span className="video-track-label" title={name}><i className="video-track-badge" style={{ backgroundColor: color }}>{name.slice(0, 1).toUpperCase()}</i><span>{name}</span></span>
              <div className="video-track-lane character-lane" style={{ backgroundSize: `${tickSeconds * pixelsPerSecond}px 100%` }} aria-label={`Faixa de ${name}`}>
                {states.map((state) => <button type="button" key={state.id} className="video-character-span" style={{ left: `${state.start / 60 * pixelsPerSecond}px`, width: `${Math.max(3, (state.end - state.start) / 60 * pixelsPerSecond)}px`, background: `linear-gradient(180deg, ${color} 0%, ${color}cc 48%, ${color}8c 100%)` }} onClick={() => onSeek(state.start)} title={`${name} · ${state.label}`}><span>{state.label}</span></button>)}
                {timeline.saveMarkers.map((marker) => <i className="video-saved-marker" key={marker.id} style={{ left: `${marker.frame / 60 * pixelsPerSecond}px` }} title={`Frame salvo · ${formatTime(marker.frame)}`} />)}
                {keys.map((key) => <button type="button" className="video-keyframe" key={key.id} style={{ left: `${key.frame / 60 * pixelsPerSecond}px` }} title={`${formatTime(key.frame)} · ${key.faceMode}`} onClick={() => onSeek(key.frame)} aria-label={`Ir ao frame ${formatTime(key.frame)} de ${name}`} />)}
                <i className="video-lane-playhead" style={{ left: `${playheadFrame / 60 * pixelsPerSecond}px` }} />
              </div>
            </div>
          })}
        </div>
      </div>
    </div>
    <footer className="video-timeline-footer"><span>60 FPS · duração inicial de 10 minutos</span><label>Ir para <input type="number" min={0} max={Math.floor(duration / 60)} value={Math.floor(playheadFrame / 60)} onChange={(event) => onSeek(Math.min(duration, Math.max(0, Number(event.currentTarget.value) || 0) * 60))} /> s</label></footer>
  </section>
}
