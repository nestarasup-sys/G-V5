import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { VideoProject } from '../../../../shared/videoStudio'
import { characterLanesFromScenes } from './studioVideoBridge'
import './studioVideoTimeline.css'

const frameLabel = (frame: number, fps: number) => {
  const seconds = Math.floor(frame / fps)
  const minutes = Math.floor(seconds / 60)
  return [minutes, seconds % 60, frame % fps].map(part => String(part).padStart(2, '0')).join(':')
}

interface Props {
  project: VideoProject
  frame: number
  playing: boolean
  unsavedDraft: boolean
  onSeek: (frame: number) => void
  onPlay: () => void
  onSaveFrame: () => void
}

/**
 * Only new editor UI in Video Studio. Scene/Inspector/Elenco/Tools are shared
 * by StudioPage itself. This component never edits or renders the scene.
 */
export function StudioVideoTimeline({ project, frame, playing, unsavedDraft, onSeek, onPlay, onSaveFrame }: Props) {
  const [zoom, setZoom] = useState(14)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fps = project.frameRate
  const seconds = project.durationFrames / fps
  const pixels = Math.max(450, Math.ceil(seconds * zoom))
  const lanes = useMemo(() => characterLanesFromScenes(project), [project])
  const tickSeconds = zoom >= 42 ? 2 : zoom >= 15 ? 5 : zoom >= 5 ? 15 : 60
  const tickCount = Math.ceil(seconds / tickSeconds)

  const seekPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    onSeek(Math.max(0, Math.min(project.durationFrames - 1,
      Math.round((event.clientX - box.left) / zoom * fps))))
  }
  const fit = () => {
    const view = scrollRef.current?.clientWidth ?? 700
    setZoom(Math.max(.7, Math.min(150, view / seconds)))
  }

  return (
    <section className="studio-video-timeline" aria-label="Timeline de animação">
      <header className="studio-video-timeline-controls">
        <strong>TIMELINE</strong>
        <button type="button" onClick={() => onSeek(0)} title="Voltar ao início">⏮</button>
        <button type="button" onClick={() => onSeek(frame - 1)} title="Voltar um quadro">◀ 1f</button>
        <button type="button" onClick={onPlay}>{playing ? '⏸ Pausar' : '▶ Reproduzir'}</button>
        <button type="button" onClick={() => onSeek(frame + 1)} title="Avançar um quadro">1f ▶</button>
        <span className="studio-video-timecode">{frameLabel(frame, fps)} / {frameLabel(project.durationFrames, fps)}</span>
        <button className="studio-video-save-frame" type="button" onClick={onSaveFrame}>◆ Salvar frame</button>
        {unsavedDraft && <span className="studio-video-pending">Cena editada · não gravada na timeline</span>}
        <span className="studio-video-spacer" />
        <button type="button" onClick={() => setZoom(value => Math.max(.7, value / 1.6))} title="Reduzir zoom">−</button>
        <button type="button" onClick={() => setZoom(value => Math.min(150, value * 1.6))} title="Aumentar zoom">+</button>
        <button type="button" onClick={fit}>Ajustar</button>
      </header>
      <div className="studio-video-timeline-columns">
        <div className="studio-video-track-names">
          <div className="studio-video-track-ruler-label">QUADROS · {fps} FPS</div>
          <div className="studio-video-track-name">Cena inteira</div>
          {lanes.map(lane => <div className="studio-video-track-name" key={lane.id}>{lane.label}</div>)}
          {project.textTracks.map(track => <div className="studio-video-track-name" key={track.id}>{track.name}</div>)}
        </div>
        <div className="studio-video-timeline-scroll" ref={scrollRef}>
          <div className="studio-video-timeline-sheet" style={{ width: pixels }}>
            <div className="studio-video-ruler" onPointerDown={seekPointer}>
              {Array.from({ length: tickCount + 1 }, (_, i) => {
                const t = i * tickSeconds
                return <span key={i} className="studio-video-ruler-tick" style={{ left: t * zoom }}>{Math.floor(t / 60)}:{String(t % 60).padStart(2, '0')}</span>
              })}
            </div>
            <div className="studio-video-track">
              {(project.sceneFrames ?? []).map(beat => <button key={beat.frame} className="studio-video-scene-marker" type="button"
                style={{ left: beat.frame / fps * zoom }} onClick={() => onSeek(beat.frame)}
                title={'Cena salva no quadro ' + beat.frame}>◆</button>)}
            </div>
            {lanes.map(lane => <div className="studio-video-track" key={lane.id}>
              {lane.frames.map(point => <button type="button" key={point} className="studio-video-track-beat"
                style={{ left: point / fps * zoom }} title={'Alteração em ' + frameLabel(point, fps)} onClick={() => onSeek(point)}>●</button>)}
            </div>)}
            {project.textTracks.map(track => <div className="studio-video-track" key={track.id}>
              {track.clips.map(clip => <button type="button" key={clip.id}
                className="studio-video-text-clip" onClick={() => onSeek(clip.startFrame)}
                title={clip.text} style={{ left: clip.startFrame / fps * zoom, width: Math.max(7, (clip.endFrameExclusive - clip.startFrame) / fps * zoom) }}>
                {clip.text}</button>)}
            </div>)}
            <div className="studio-video-playhead" style={{ left: frame / fps * zoom }} />
          </div>
        </div>
      </div>
    </section>
  )
}
