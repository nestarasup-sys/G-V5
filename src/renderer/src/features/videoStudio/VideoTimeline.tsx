import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { videoCharacterTrackColor } from '../../../../shared/studio'
import type { StudioDocument, VideoTimelineDocument } from '../../../../shared/studio'

const DEFAULT_DURATION_FRAMES = 10 * 60 * 60
const DEFAULT_TIMELINE: VideoTimelineDocument = {
  schemaVersion: 1, frameRate: 60, durationFrames: DEFAULT_DURATION_FRAMES,
  playheadFrame: 0, playing: false, characterKeys: [], textClips: [], saveMarkers: []
}

type TextClip = VideoTimelineDocument['textClips'][number]
type TrackSelection =
  | { kind: 'character'; elementId: string; startFrame: number; endFrame: number }
  | { kind: 'text'; elementId: string; clipId: string; startFrame: number; endFrame: number }
  | null
type TextClipDrag = { pointerId: number; clip: TextClip; mode: 'move' | 'start' | 'end'; originX: number; startFrame: number; endFrame: number; latestStartFrame: number; latestEndFrame: number }
type BoundaryDrag = { pointerId: number; elementId: string; keyId: string; originX: number; startFrame: number; minFrame: number; maxFrame: number; latestFrame: number }

export function videoTimelineFor(studio: StudioDocument): VideoTimelineDocument {
  return studio.videoTimeline ?? DEFAULT_TIMELINE
}

function formatTime(frame: number): string {
  const seconds = Math.floor(frame / 60)
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}:${String(frame % 60).padStart(2, '0')}`
}

export function VideoTimeline({ studio, playheadFrame, playing, height, presetNames, onSeek, onSelectElement, onTogglePlayback, onSaveFrame, onSplitCharacter, onSplitTextClip, onUpdateTextClip, onDeleteTextClip, onDuplicateTextClip, onMoveCharacterBoundary, onChangeDuration, onResize, onAddText, onChangeTrackSettings, onMoveCharacterTrack }: {
  studio: StudioDocument
  playheadFrame: number
  playing: boolean
  height: number
  presetNames: Record<string, string>
  onSeek: (frame: number) => void
  onSelectElement: (elementId: string) => void
  onTogglePlayback: () => void
  onSaveFrame: () => void
  onSplitCharacter: (elementId: string, frame: number) => void
  onSplitTextClip: (clip: { elementId: string; clipId: string; startFrame: number; endFrame: number }, frame: number, rightClipId: string) => void
  onUpdateTextClip: (clip: TextClip) => void
  onDeleteTextClip: (id: string) => void
  onDuplicateTextClip: (clip: TextClip) => void
  onMoveCharacterBoundary: (elementId: string, keyId: string, frame: number) => void
  onChangeDuration: (durationFrames: number) => void
  onResize: (height: number) => void
  onAddText: (kind: 'speech' | 'thought') => void
  onChangeTrackSettings: (id: string, settings: NonNullable<VideoTimelineDocument['trackSettings']>[string]) => void
  onMoveCharacterTrack: (id: string, direction: -1 | 1) => void
}) {
  const resizePointer = useRef<{ id: number; startY: number; startHeight: number } | null>(null)
  const textClipDragRef = useRef<TextClipDrag | null>(null)
  const boundaryDragRef = useRef<BoundaryDrag | null>(null)
  const suppressClipClickRef = useRef(false)
  const timelineScrollRef = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState<TrackSelection>(null)
  const [previewTextClip, setPreviewTextClip] = useState<TextClip | null>(null)
  const [previewBoundary, setPreviewBoundary] = useState<{ elementId: string; keyId: string; frame: number } | null>(null)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [trackMenuOpen, setTrackMenuOpen] = useState(false)
  const [pixelsPerSecond, setPixelsPerSecond] = useState(() => {
    try {
      const stored = Number(window.localStorage.getItem('gacha-nymi-video-timeline-zoom'))
      return Number.isFinite(stored) && stored >= 1 ? Math.min(stored, 120) : 37
    } catch { return 37 }
  })
  const timeline = videoTimelineFor(studio)
  const trackSettings = timeline.trackSettings ?? {}
  const isLocked = (id: string) => trackSettings[id]?.locked === true
  const duration = Math.max(1, timeline.durationFrames)
  const timelineSeconds = duration / 60
  const timelineWidth = timelineSeconds * pixelsPerSecond
  const contentWidth = timelineWidth + 96
  const tickSeconds = pixelsPerSecond >= 16 ? 5 : Math.max(1, Math.ceil(80 / pixelsPerSecond))
  const tickCount = Math.floor(timelineSeconds / tickSeconds)
  const characters = studio.elements.filter((element) => element.kind === 'character').sort((left, right) => (trackSettings[left.id]?.order ?? studio.elements.indexOf(left)) - (trackSettings[right.id]?.order ?? studio.elements.indexOf(right)))
  useEffect(() => {
    const sampledFrame = Math.min(playheadFrame, duration - 1)
    if (selection?.kind !== 'character' || selection.startFrame <= sampledFrame && sampledFrame < selection.endFrame) return
    const starts = timeline.characterKeys.filter((key) => key.elementId === selection.elementId).map((key) => key.frame).sort((a, b) => a - b)
    const startFrame = starts.filter((frame) => frame <= sampledFrame).at(-1) ?? 0
    const endFrame = starts.find((frame) => frame > startFrame) ?? duration
    setSelection({ kind: 'character', elementId: selection.elementId, startFrame, endFrame })
  }, [playheadFrame, selection, timeline.characterKeys, duration])
  const textTracks = (['speech', 'thought'] as const).map((kind) => ({
    kind,
    label: kind === 'speech' ? 'Falas' : 'Pensamentos',
    clips: studio.elements.filter((element) => element.kind === kind).flatMap((element) => {
      const savedClips = timeline.textClips.filter((item) => item.elementId === element.id)
      return (savedClips.length ? savedClips : [{ id: `legacy:${element.id}`, elementId: element.id, kind, startFrame: 0, endFrame: Math.min(duration, 300) }])
        .map((clip) => ({ element, clip: previewTextClip?.id === clip.id ? previewTextClip : clip }))
    })
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
  const snapFrame = (frame: number, excludedClipId?: string) => {
    if (!snapEnabled) return frame
    const candidates = [playheadFrame, Math.round(frame / 60) * 60,
      ...timeline.characterKeys.map((key) => key.frame),
      ...timeline.textClips.filter((clip) => clip.id !== excludedClipId).flatMap((clip) => [clip.startFrame, clip.endFrame])]
    const nearest = candidates.reduce((best, candidate) => Math.abs(candidate - frame) < Math.abs(best - frame) ? candidate : best, frame)
    return Math.abs(nearest - frame) / 60 * pixelsPerSecond <= 8 ? nearest : frame
  }
  const canSplitSelection = Boolean(selection && playheadFrame > selection.startFrame && playheadFrame < selection.endFrame)
  const splitSelection = () => {
    if (!selection || !canSplitSelection || isLocked(selection.kind === 'character' ? selection.elementId : timeline.textClips.find((clip) => clip.id === selection.clipId)?.kind ?? 'speech')) return
    if (selection.kind === 'character') onSplitCharacter(selection.elementId, playheadFrame)
    else {
      const rightClipId = crypto.randomUUID()
      onSplitTextClip({ elementId: selection.elementId, clipId: selection.clipId, startFrame: selection.startFrame, endFrame: selection.endFrame }, playheadFrame, rightClipId)
      setSelection({ ...selection, clipId: rightClipId, startFrame: playheadFrame })
    }
    if (selection.kind === 'character') setSelection({ ...selection, startFrame: playheadFrame })
  }
  const beginTextClipDrag = (event: ReactPointerEvent<HTMLButtonElement>, clip: TextClip) => {
    if (isLocked(clip.kind)) return
    event.preventDefault()
    event.stopPropagation()
    const edge = (event.target as HTMLElement).closest<HTMLElement>('[data-clip-edge]')?.dataset.clipEdge
    const mode = edge === 'start' || edge === 'end' ? edge : 'move'
    setSelection({ kind: 'text', elementId: clip.elementId, clipId: clip.id, startFrame: clip.startFrame, endFrame: clip.endFrame })
    onSelectElement(clip.elementId)
    if (!edge) {
      const rect = event.currentTarget.getBoundingClientRect()
      const ratio = rect.width > 0 ? Math.max(0, Math.min(0.999999, (event.clientX - rect.left) / rect.width)) : 0
      onSeek(Math.min(clip.endFrame - 1, clip.startFrame + Math.floor((clip.endFrame - clip.startFrame) * ratio)))
    }
    textClipDragRef.current = { pointerId: event.pointerId, clip, mode, originX: event.clientX, startFrame: clip.startFrame, endFrame: clip.endFrame, latestStartFrame: clip.startFrame, latestEndFrame: clip.endFrame }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveTextClipDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = textClipDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const delta = Math.round((event.clientX - drag.originX) / pixelsPerSecond * 60)
    let startFrame = drag.startFrame
    let endFrame = drag.endFrame
    if (drag.mode === 'move') {
      startFrame = Math.max(0, Math.min(duration - (drag.endFrame - drag.startFrame), snapFrame(drag.startFrame + delta, drag.clip.id)))
      endFrame = startFrame + (drag.endFrame - drag.startFrame)
    } else if (drag.mode === 'start') startFrame = Math.max(0, Math.min(drag.endFrame - 1, snapFrame(drag.startFrame + delta, drag.clip.id)))
    else endFrame = Math.max(drag.startFrame + 1, Math.min(duration, snapFrame(drag.endFrame + delta, drag.clip.id)))
    drag.latestStartFrame = startFrame
    drag.latestEndFrame = endFrame
    setPreviewTextClip({ ...drag.clip, startFrame, endFrame })
  }
  const finishTextClipDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = textClipDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    textClipDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (drag.latestStartFrame !== drag.startFrame || drag.latestEndFrame !== drag.endFrame) {
      suppressClipClickRef.current = true
      onUpdateTextClip({ ...drag.clip, startFrame: drag.latestStartFrame, endFrame: drag.latestEndFrame })
      setSelection((current) => current?.kind === 'text' && current.clipId === drag.clip.id
        ? { ...current, startFrame: drag.latestStartFrame, endFrame: drag.latestEndFrame }
        : current)
      requestAnimationFrame(() => { suppressClipClickRef.current = false })
    }
    setPreviewTextClip(null)
  }
  const beginBoundaryDrag = (event: ReactPointerEvent<HTMLButtonElement>, elementId: string, keyId: string, frame: number, minFrame: number, maxFrame: number) => {
    if (isLocked(elementId)) return
    event.preventDefault()
    event.stopPropagation()
    onSelectElement(elementId)
    boundaryDragRef.current = { pointerId: event.pointerId, elementId, keyId, originX: event.clientX, startFrame: frame, minFrame, maxFrame, latestFrame: frame }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveBoundaryDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = boundaryDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const frame = Math.max(drag.minFrame, Math.min(drag.maxFrame, snapFrame(drag.startFrame + Math.round((event.clientX - drag.originX) / pixelsPerSecond * 60))))
    drag.latestFrame = frame
    setPreviewBoundary({ elementId: drag.elementId, keyId: drag.keyId, frame })
  }
  const finishBoundaryDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = boundaryDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    boundaryDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (drag.latestFrame !== drag.startFrame) {
      onMoveCharacterBoundary(drag.elementId, drag.keyId, drag.latestFrame)
      setSelection((current) => current?.kind === 'character' && current.elementId === drag.elementId
        ? current.startFrame === drag.startFrame
          ? { ...current, startFrame: drag.latestFrame }
          : current.endFrame === drag.startFrame
            ? { ...current, endFrame: drag.latestFrame }
            : current
        : current)
    }
    setPreviewBoundary(null)
  }

  return <section className="video-timeline" aria-label="Timeline do Video Studio">
    <header className="video-timeline-toolbar">
      <div className="video-timeline-create-actions"><button type="button" onClick={() => onAddText('speech')}>+ Fala</button><button type="button" onClick={() => onAddText('thought')}>+ Pensamento</button><button type="button" onClick={onSaveFrame}>+ Corte</button></div>
      <div className="video-timeline-heading"><strong>{formatTime(playheadFrame)}</strong><span>/ {formatTime(duration)}</span><small>{timeline.characterKeys.length + timeline.textClips.length} eventos</small><button type="button" className="video-play-button" aria-label={playing ? 'Pausar reprodução' : 'Reproduzir'} onClick={onTogglePlayback}>{playing ? '❚❚' : '▶'}<span>{playing ? 'Pausar' : 'Play'}</span></button><button type="button" className="video-split-button" onClick={splitSelection} disabled={!canSplitSelection} title={selection ? 'Dividir o trecho selecionado na posição do playhead' : 'Selecione um trecho para dividir'}>✂ Dividir</button>{selection?.kind === 'text' && !isLocked(timeline.textClips.find((clip) => clip.id === selection.clipId)?.kind ?? 'speech') && <><button type="button" onClick={() => { const clip = timeline.textClips.find((item) => item.id === selection.clipId); if (clip) onDuplicateTextClip(clip) }}>Duplicar</button><button type="button" onClick={() => { onDeleteTextClip(selection.clipId); setSelection(null) }}>Excluir</button></>}</div>
      <div className="video-timeline-actions">
        <button type="button" className={snapEnabled ? 'active' : ''} aria-pressed={snapEnabled} onClick={() => setSnapEnabled((value) => !value)} title="Magnetismo das bordas">⌁ Snap</button>
        <button type="button" className={trackMenuOpen ? 'active' : ''} aria-expanded={trackMenuOpen} onClick={() => setTrackMenuOpen((value) => !value)}>Faixas</button>
        <label className="video-jump-control">Ir para<input aria-label="Ir para segundo da timeline" type="number" min={0} max={Math.floor(duration / 60)} value={Math.floor(playheadFrame / 60)} onChange={(event) => onSeek(Math.min(duration, Math.max(0, Number(event.currentTarget.value) || 0) * 60))} />s</label>
        <button type="button" onClick={() => onChangeDuration(Math.max(60, duration - 3600))} disabled={duration <= 3600 || timeline.characterKeys.some((key) => key.frame >= duration - 3600) || timeline.textClips.some((clip) => clip.endFrame > duration - 3600)} title="Reduzir duração em um minuto">− 1 min</button>
        <button type="button" onClick={() => onChangeDuration(duration + 3600)} title="Aumentar duração em um minuto">+ 1 min</button>
        <button type="button" onClick={fitTimeline}>Fit</button>
        <button type="button" className="video-zoom-button" onClick={() => setZoom(pixelsPerSecond / 1.25)} title="Diminuir zoom">−</button>
        <label className="video-zoom-control"><span>{pixelsPerSecond.toFixed(0)} px/s</span><input aria-label="Zoom horizontal da timeline" type="range" min={1} max={120} step={1} value={pixelsPerSecond} onChange={(event) => setZoom(Number(event.currentTarget.value))} /></label>
        <button type="button" className="video-zoom-button" onClick={() => setZoom(pixelsPerSecond * 1.25)} title="Aumentar zoom">+</button>
      </div>
      <div className="video-timeline-resize" role="separator" aria-label="Redimensionar altura da timeline" aria-orientation="horizontal" aria-valuemin={150} aria-valuemax={Math.max(220, Math.floor(window.innerHeight * 0.65))} aria-valuenow={height} tabIndex={0}
        onKeyDown={(event) => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); onResize(Math.max(150, Math.min(Math.floor(window.innerHeight * 0.65), height + (event.key === 'ArrowUp' ? 24 : -24)))) } }}
        onPointerDown={(event) => { event.preventDefault(); resizePointer.current = { id: event.pointerId, startY: event.clientY, startHeight: height }; event.currentTarget.setPointerCapture(event.pointerId) }} onPointerMove={resizeTimeline} onPointerUp={finishResize} onPointerCancel={finishResize}>
        <span /><span /><span />
      </div>
    </header>
    {trackMenuOpen && <div className="video-track-settings" aria-label="Configuração das faixas">
      {([{ id: 'speech', name: 'Falas' }, { id: 'thought', name: 'Pensamentos' }, ...characters.map((character) => ({ id: character.id, name: character.text || 'Personagem' }))]).map(({ id, name }) => {
        const settings = trackSettings[id] ?? {}
        return <div className="video-track-settings-row" key={id}>
          <input aria-label={`Nome da faixa ${name}`} value={settings.label ?? name} onChange={(event) => onChangeTrackSettings(id, { ...settings, label: event.currentTarget.value })} />
          <button type="button" aria-label={`${settings.visible === false ? 'Mostrar' : 'Ocultar'} faixa ${name}`} aria-pressed={settings.visible !== false} onClick={() => onChangeTrackSettings(id, { ...settings, visible: settings.visible === false })}>{settings.visible === false ? '◌' : '◉'}</button>
          <button type="button" aria-label={`${settings.locked ? 'Desbloquear' : 'Bloquear'} faixa ${name}`} aria-pressed={settings.locked === true} onClick={() => onChangeTrackSettings(id, { ...settings, locked: !settings.locked })}>{settings.locked ? '🔒' : '🔓'}</button>
          <button type="button" aria-label={`${settings.collapsed ? 'Expandir' : 'Recolher'} faixa ${name}`} onClick={() => onChangeTrackSettings(id, { ...settings, collapsed: !settings.collapsed })}>{settings.collapsed ? '▸' : '▾'}</button>
          {id !== 'speech' && id !== 'thought' && <><button type="button" aria-label={`Mover faixa ${name} para cima`} onClick={() => onMoveCharacterTrack(id, -1)}>↑</button><button type="button" aria-label={`Mover faixa ${name} para baixo`} onClick={() => onMoveCharacterTrack(id, 1)}>↓</button></>}
        </div>
      })}
    </div>}
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
          {textTracks.filter(({ kind }) => trackSettings[kind]?.visible !== false).map(({ kind, label, clips }) => <div className={`video-track-row${trackSettings[kind]?.collapsed ? ' collapsed' : ''}`} key={kind}>
            <span className="video-track-label"><i className={`video-track-badge ${kind}`}>{kind === 'speech' ? 'F' : 'P'}</i><span>{trackSettings[kind]?.label ?? label}</span></span>
            <div className={`video-track-lane ${kind}-lane`} style={{ backgroundSize: `${tickSeconds * pixelsPerSecond}px 100%` }} aria-label={`Faixa de ${label.toLowerCase()}`}>
              {timeline.saveMarkers.map((marker) => <i className="video-saved-marker" key={marker.id} style={{ left: `${marker.frame / 60 * pixelsPerSecond}px` }} title={`Frame salvo · ${formatTime(marker.frame)}`} />)}
              {clips.map(({ element, clip }) => {
                const selected = selection?.kind === 'text' && selection.clipId === clip.id
                const start = clip.startFrame
                const end = clip.endFrame
                return <button type="button" className={`video-text-clip ${kind}-clip ${selected ? 'selected' : ''}`} key={clip.id} style={{ left: `${start / 60 * pixelsPerSecond}px`, width: `${Math.max(3, (end - start) / 60 * pixelsPerSecond)}px` }} title={clip.state?.text || element.text || (kind === 'speech' ? 'Fala' : 'Pensamento')} onPointerDown={(event) => beginTextClipDrag(event, clip)} onPointerMove={moveTextClipDrag} onPointerUp={finishTextClipDrag} onPointerCancel={finishTextClipDrag} onClick={(event) => {
                  if (suppressClipClickRef.current) { event.preventDefault(); event.stopPropagation(); return }
                  const rect = event.currentTarget.getBoundingClientRect()
                  const ratio = rect.width > 0 ? Math.max(0, Math.min(0.999999, (event.clientX - rect.left) / rect.width)) : 0
                  const frame = Math.min(end - 1, start + Math.floor((end - start) * ratio))
                  setSelection({ kind: 'text', elementId: element.id, clipId: clip.id, startFrame: start, endFrame: end })
                  onSeek(frame)
                }}>
                  <span className="video-clip-edge video-clip-edge-start" data-clip-edge="start" aria-label="Ajustar início do bloco" />
                  <span className="video-clip-caption">{clip.state?.text || element.text || (kind === 'speech' ? 'Fala' : 'Pensamento')}</span>
                  <span className="video-clip-edge video-clip-edge-end" data-clip-edge="end" aria-label="Ajustar fim do bloco" />
                </button>
              })}
              <i className="video-lane-playhead" style={{ left: `${playheadFrame / 60 * pixelsPerSecond}px` }} />
              {!clips.length && <span className="video-track-empty">Adicione {kind === 'speech' ? 'uma fala' : 'um pensamento'} pela barra de ferramentas</span>}
            </div>
          </div>)}
          {characters.filter((character) => trackSettings[character.id]?.visible !== false).map((character) => {
            const keys = timeline.characterKeys.filter((key) => key.elementId === character.id).map((key) => previewBoundary?.elementId === character.id && previewBoundary.keyId === key.id ? { ...key, frame: previewBoundary.frame } : key).sort((a, b) => a.frame - b.frame)
            const name = character.text || studio.assets.find((asset) => asset.id === character.assetId)?.name || 'Personagem'
            const color = videoCharacterTrackColor(character.id, character.timelineColor)
            const basePresetId = timeline.characterBases?.[character.id]?.element.activeExpressionPresetId
            const baseLabel = basePresetId ? presetNames[basePresetId] ?? 'Expressão' : 'Base'
            const states = keys.length
              ? [...(keys[0].frame > 0 ? [{ id: `base:${character.id}`, start: 0, end: keys[0].frame, label: baseLabel }] : []), ...keys.map((key, index) => ({ id: key.id, start: key.frame, end: keys[index + 1]?.frame ?? duration, label: key.expressionPresetId ? presetNames[key.expressionPresetId] ?? 'Expressão' : key.faceMode === 'idle' ? 'Base' : key.faceMode === 'blink' ? 'Blink' : 'Talk' }))]
              : [{ id: `base:${character.id}`, start: 0, end: duration, label: baseLabel }]
            return <div className={`video-track-row${trackSettings[character.id]?.collapsed ? ' collapsed' : ''}`} key={character.id}>
              <span className="video-track-label" title={name}><i className="video-track-badge" style={{ backgroundColor: color }}>{name.slice(0, 1).toUpperCase()}</i><span>{trackSettings[character.id]?.label ?? name}</span></span>
              <div className="video-track-lane character-lane" style={{ backgroundSize: `${tickSeconds * pixelsPerSecond}px 100%` }} aria-label={`Faixa de ${name}`}>
                {states.map((state) => {
                  const selected = selection?.kind === 'character' && selection.elementId === character.id && selection.startFrame === state.start
                  return <button type="button" key={state.id} className={`video-character-span ${selected ? 'selected' : ''}`} style={{ left: `${state.start / 60 * pixelsPerSecond}px`, width: `${Math.max(3, (state.end - state.start) / 60 * pixelsPerSecond)}px`, background: `linear-gradient(180deg, ${color} 0%, ${color}cc 48%, ${color}8c 100%)` }} onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    const ratio = rect.width > 0 ? Math.max(0, Math.min(0.999999, (event.clientX - rect.left) / rect.width)) : 0
                    const frame = Math.min(state.end - 1, state.start + Math.floor((state.end - state.start) * ratio))
                    setSelection({ kind: 'character', elementId: character.id, startFrame: state.start, endFrame: state.end })
                    onSelectElement(character.id)
                    onSeek(frame)
                  }} title={`${name} · ${state.label}`}><span>{state.label}</span></button>
                })}
                {keys.map((key, index) => key.frame > 0 && <button type="button" key={`boundary:${key.id}`} className="video-character-boundary" style={{ left: `${key.frame / 60 * pixelsPerSecond}px` }} aria-label={`Mover divisão de ${name}`} title="Arraste para ajustar a duração deste estado" onPointerDown={(event) => beginBoundaryDrag(event, character.id, key.id, key.frame, (keys[index - 1]?.frame ?? 0) + 1, (keys[index + 1]?.frame ?? duration) - 1)} onPointerMove={moveBoundaryDrag} onPointerUp={finishBoundaryDrag} onPointerCancel={finishBoundaryDrag} />)}
                {timeline.saveMarkers.map((marker) => <i className="video-saved-marker" key={marker.id} style={{ left: `${marker.frame / 60 * pixelsPerSecond}px` }} title={`Frame salvo · ${formatTime(marker.frame)}`} />)}
                {keys.map((key, index) => <button type="button" className="video-keyframe" key={key.id} style={{ left: `${key.frame / 60 * pixelsPerSecond}px` }} title={`${formatTime(key.frame)} · ${key.faceMode}`} onClick={() => { setSelection({ kind: 'character', elementId: character.id, startFrame: key.frame, endFrame: keys[index + 1]?.frame ?? duration }); onSelectElement(character.id); onSeek(key.frame) }} aria-label={`Ir ao frame ${formatTime(key.frame)} de ${name}`} />)}
                <i className="video-lane-playhead" style={{ left: `${playheadFrame / 60 * pixelsPerSecond}px` }} />
              </div>
            </div>
          })}
        </div>
      </div>
    </div>
  </section>
}
