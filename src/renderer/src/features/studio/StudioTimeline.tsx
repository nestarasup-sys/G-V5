import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { StudioTimeline, StudioTimelineClip, StudioTimelineTrack } from '../../../../shared/studio'

type Props = {
  timeline: StudioTimeline
  currentFrame: number
  playing: boolean
  selectedClipId: string | null
  onPlayPause: () => void
  onSeek: (frame: number) => void
  onSelectClip: (clip: StudioTimelineClip) => void
  onMoveClip: (id: string, startFrame: number) => void
  onResizeClip: (id: string, startFrame: number, endFrame: number) => void
  onSplitClip: () => void
  onDeleteClip: () => void
  onToggleLoop: () => void
  onSetSpeed: (speed: number) => void
  onAddBlock: (track: StudioTimelineTrack) => void
  onEditStart: () => void
}

const seconds = (frame: number, fps: number) => {
  const total = Math.floor(frame / fps)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function StudioTimelinePanel(props: Props) {
  const { timeline } = props
  const [pixelsPerSecond, setPixelsPerSecond] = useState(4)
  const [snap, setSnap] = useState(true)
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const durationSeconds = timeline.durationFrames / timeline.fps
  const contentWidth = Math.max(1100, durationSeconds * pixelsPerSecond)
  const selectedClip = timeline.clips.find((clip) => clip.id === props.selectedClipId) ?? null
  const tracks = useMemo(() => [...timeline.tracks].sort((a, b) => a.order - b.order), [timeline.tracks])

  useEffect(() => {
    if (!props.playing || !scrollRef.current) return
    const x = 132 + props.currentFrame / timeline.fps * pixelsPerSecond
    const viewport = scrollRef.current
    if (x > viewport.scrollLeft + viewport.clientWidth - 90) viewport.scrollLeft = Math.max(0, x - viewport.clientWidth + 140)
  }, [props.currentFrame, props.playing, timeline.fps, pixelsPerSecond])

  const seekAtPointer = (event: ReactPointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const contentX = event.clientX - rect.left
    props.onSeek(Math.min(timeline.durationFrames, Math.max(0, Math.round(contentX / pixelsPerSecond * timeline.fps))))
  }

  const beginClipDrag = (event: ReactPointerEvent<HTMLElement>, clip: StudioTimelineClip, mode: 'move' | 'left' | 'right') => {
    event.stopPropagation()
    event.preventDefault()
    props.onEditStart()
    props.onSelectClip(clip)
    const pointerId = event.pointerId
    const startX = event.clientX
    const startFrame = clip.startFrame
    const endFrame = clip.endFrame
    event.currentTarget.setPointerCapture(pointerId)
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return
      let delta = Math.round((next.clientX - startX) / pixelsPerSecond * timeline.fps)
      if (snap) delta = Math.round(delta / timeline.fps) * timeline.fps
      if (mode === 'move') props.onMoveClip(clip.id, Math.max(0, startFrame + delta))
      else if (mode === 'left') props.onResizeClip(clip.id, Math.max(0, Math.min(endFrame - 1, startFrame + delta)), endFrame)
      else props.onResizeClip(clip.id, startFrame, Math.max(startFrame + 1, endFrame + delta))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    window.addEventListener('pointercancel', up, { once: true })
  }

  return <section className="studio-timeline" aria-label="Timeline da cena">
    <header className="studio-timeline-toolbar">
      <strong>Timeline</strong>
      <div className="studio-timeline-transport">
        <button type="button" title="Voltar ao início" onClick={() => props.onSeek(0)}>⏮</button>
        <button type="button" title="Frame anterior" onClick={() => props.onSeek(Math.max(0, props.currentFrame - 1))}>‹</button>
        <button className="studio-timeline-play" type="button" onClick={props.onPlayPause}>{props.playing ? 'Pausar' : 'Reproduzir'}</button>
        <button type="button" title="Próximo frame" onClick={() => props.onSeek(Math.min(timeline.durationFrames - 1, props.currentFrame + 1))}>›</button>
        <span>{seconds(props.currentFrame, timeline.fps)} / {seconds(timeline.durationFrames, timeline.fps)}</span>
      </div>
      <div className="studio-timeline-options">
        <label><input type="checkbox" checked={timeline.loop} onChange={props.onToggleLoop} /> Loop</label>
        <label>Velocidade<select value={timeline.speed} onChange={(event) => props.onSetSpeed(Number(event.target.value))}><option value="0.5">0,5×</option><option value="1">1×</option><option value="1.5">1,5×</option><option value="2">2×</option></select></label>
        <label><input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} /> Encaixe</label>
        <button type="button" disabled={!selectedClip || props.currentFrame <= selectedClip.startFrame || props.currentFrame >= selectedClip.endFrame} onClick={props.onSplitClip}>Dividir</button>
        <button type="button" disabled={!selectedClip} onClick={props.onDeleteClip}>Excluir bloco</button>
        <button type="button" onClick={() => setPixelsPerSecond(Math.max(1, Math.min(16, ((scrollRef.current?.clientWidth ?? 1000) - 132) / durationSeconds)))}>Ajustar</button>
        <label className="studio-timeline-zoom">Zoom<input type="range" min="1" max="16" value={pixelsPerSecond} onChange={(event) => setPixelsPerSecond(Number(event.target.value))} /></label>
      </div>
    </header>
    <div className="studio-timeline-scroll" ref={scrollRef}>
      <div className="studio-timeline-ruler-row" style={{ width: 132 + contentWidth }}>
        <div className="studio-timeline-track-name">Faixas</div>
        <div className="studio-timeline-ruler" style={{ width: contentWidth, backgroundSize: `${30 * pixelsPerSecond}px 100%` }} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); seekAtPointer(event) }} onPointerMove={(event) => { if (event.buttons === 1) seekAtPointer(event) }}>
          {Array.from({ length: Math.ceil(durationSeconds / 30) + 1 }, (_, index) => index * 30).filter((second) => second <= durationSeconds).map((second) => <span key={second} style={{ left: second * pixelsPerSecond }}>{seconds(second * timeline.fps, timeline.fps)}</span>)}
          <i style={{ left: props.currentFrame / timeline.fps * pixelsPerSecond }} />
        </div>
      </div>
      {tracks.map((track) => <TimelineTrackRow
        key={track.id}
        track={track}
        clips={timeline.clips.filter((clip) => clip.trackId === track.id)}
        contentWidth={contentWidth}
        pixelsPerSecond={pixelsPerSecond}
        fps={timeline.fps}
        currentFrame={props.currentFrame}
        selectedClipId={props.selectedClipId}
        onSelectTrack={() => setSelectedTrackId(track.id)}
        selectedTrack={selectedTrackId === track.id}
        onAddBlock={() => props.onAddBlock(track)}
        onSeek={props.onSeek}
        onDrag={beginClipDrag}
      />)}
    </div>
  </section>
}

function TimelineTrackRow({ track, clips, contentWidth, pixelsPerSecond, fps, currentFrame, selectedClipId, onSelectTrack, selectedTrack, onAddBlock, onSeek, onDrag }: {
  track: StudioTimelineTrack
  clips: StudioTimelineClip[]
  contentWidth: number
  pixelsPerSecond: number
  fps: number
  currentFrame: number
  selectedClipId: string | null
  onSelectTrack: () => void
  selectedTrack: boolean
  onAddBlock: () => void
  onSeek: (frame: number) => void
  onDrag: (event: ReactPointerEvent<HTMLElement>, clip: StudioTimelineClip, mode: 'move' | 'left' | 'right') => void
}) {
  const colors: Record<StudioTimelineTrack['kind'], string> = { character: '#55ad8c', objects: '#b188ce', narrator: '#7599d7', speech: '#e879a3', thought: '#d4a05c', background: '#87939e' }
  return <div className={`studio-timeline-track-row${selectedTrack ? ' selected' : ''}`} style={{ width: 132 + contentWidth }}>
    <div className="studio-timeline-track-name" onClick={onSelectTrack}>
      <span><i style={{ backgroundColor: colors[track.kind] }} />{track.name}</span>
      <button type="button" aria-label={`Adicionar bloco em ${track.name}`} title="Adicionar bloco" onClick={onAddBlock}>+</button>
    </div>
    <div className="studio-timeline-lane" style={{ width: contentWidth, backgroundSize: `${30 * pixelsPerSecond}px 100%` }} onPointerDown={(event) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      const rect = event.currentTarget.getBoundingClientRect()
      const frame = Math.round((event.clientX - rect.left) / pixelsPerSecond * fps)
      onSelectTrack()
      onSeek(frame)
    }} onPointerMove={(event) => { if (event.buttons === 1) {
      const rect = event.currentTarget.getBoundingClientRect()
      onSeek(Math.max(0, Math.min(Math.round((event.clientX - rect.left) / pixelsPerSecond * fps), Number.MAX_SAFE_INTEGER)))
    } }}>
      {clips.map((clip) => {
        const left = clip.startFrame / fps * pixelsPerSecond
        const width = Math.max(60, (clip.endFrame - clip.startFrame) / fps * pixelsPerSecond)
        const label = clip.state.type === 'element' ? clip.state.element.text || track.name : track.name
        return <div key={clip.id} className={`studio-timeline-clip${selectedClipId === clip.id ? ' selected' : ''}`} style={{ left, width, backgroundColor: colors[track.kind] }} onPointerDown={(event) => onDrag(event, clip, 'move')} title={`${label} · ${seconds(clip.startFrame, fps)}–${seconds(clip.endFrame, fps)}`}>
          <span className="studio-timeline-trim studio-timeline-trim-left" onPointerDown={(event) => onDrag(event, clip, 'left')} />
          <b>{label}</b><small>{seconds(clip.startFrame, fps)} · {Math.max(1, Math.round((clip.endFrame - clip.startFrame) / fps))}s</small>
          <span className="studio-timeline-trim studio-timeline-trim-right" onPointerDown={(event) => onDrag(event, clip, 'right')} />
        </div>
      })}
      <i className="studio-timeline-playhead" style={{ left: currentFrame / fps * pixelsPerSecond }} />
    </div>
  </div>
}
