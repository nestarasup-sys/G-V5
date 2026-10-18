import { useEffect, useEffectEvent, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { VideoAudioControls } from './VideoAudioControls'
import { Icon } from '../../ui/components/Icon'
import { videoCharacterTrackColor } from '../../../../shared/studio'
import type { StudioDocument, VideoTimelineDocument } from '../../../../shared/studio'
import { editVideoMediaClip, type VideoClipEditMode } from '../../../../shared/videoMedia'
import type { VideoAudioSettings, VideoMediaClip } from '../../../../shared/studio'

const DEFAULT_DURATION_FRAMES = 10 * 60 * 60
const DEFAULT_TIMELINE: VideoTimelineDocument = {
  schemaVersion: 1, frameRate: 60, durationFrames: DEFAULT_DURATION_FRAMES,
  playheadFrame: 0, playing: false, characterKeys: [], textClips: [], saveMarkers: []
}

type TextClip = VideoTimelineDocument['textClips'][number]
type TrackSelection =
  | { kind: 'character'; elementId: string; startFrame: number; endFrame: number }
  | { kind: 'text'; elementId: string; clipId: string; startFrame: number; endFrame: number }
  | { kind: 'video'; clipId: string; startFrame: number; endFrame: number }
  | null
type TextClipDrag = { pointerId: number; clip: TextClip; mode: 'move' | 'start' | 'end'; originX: number; startFrame: number; endFrame: number; latestStartFrame: number; latestEndFrame: number }
type VideoClipDrag = { pointerId: number; clip: VideoMediaClip; mode: VideoClipEditMode; originX: number; latest: VideoMediaClip }
type BoundaryDrag = { pointerId: number; elementId: string; keyId: string; originX: number; startFrame: number; minFrame: number; maxFrame: number; latestFrame: number }

export function videoTimelineFor(studio: StudioDocument): VideoTimelineDocument {
  return studio.videoTimeline ?? DEFAULT_TIMELINE
}

function formatTime(frame: number): string {
  const seconds = Math.floor(frame / 60)
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}:${String(frame % 60).padStart(2, '0')}`
}

function characterSegmentAtFrame(timeline: VideoTimelineDocument, elementId: string, frame: number, duration: number): { startFrame: number; endFrame: number } | null {
  const starts = timeline.characterKeys.filter((key) => key.elementId === elementId).map((key) => key.frame).sort((a, b) => a - b)
  const stateStart = starts.filter((start) => start <= frame).at(-1) ?? 0
  const stateEnd = starts.find((start) => start > stateStart) ?? duration
  const gaps = timeline.characterGaps?.filter((gap) => gap.elementId === elementId) ?? []
  if (gaps.some((gap) => gap.startFrame <= frame && frame < gap.endFrame)) return null
  const precedingGap = gaps.filter((gap) => gap.endFrame <= frame && gap.endFrame > stateStart).sort((a, b) => b.endFrame - a.endFrame)[0]
  const followingGap = gaps.filter((gap) => gap.startFrame > frame && gap.startFrame < stateEnd).sort((a, b) => a.startFrame - b.startFrame)[0]
  return { startFrame: precedingGap?.endFrame ?? stateStart, endFrame: followingGap?.startFrame ?? stateEnd }
}

export function VideoTimeline({ preparing, onEnterFullscreen, canUndo, canRedo, onUndo, onRedo, selectedCanvasId, studio, playheadFrame, playing, height, presetNames, onSeek, onSelectElement, onTogglePlayback, onSaveFrame, onSplitCharacter, onSplitTextClip, onSplitVideoClip, onUpdateTextClip, onUpdateVideoClip, onChangeVideoAudio, onBeginAudioEdit, onDuplicateVideoClip, onDeleteTextClip, onDeleteVideoClip, onDeleteTextElement, onDeleteCharacterSegment, onDuplicateTextClip, onMoveCharacterBoundary, onChangeDuration, onResize, onAddText, onAddVideo, onChangeTrackSettings, onSetCharacterAnimationsEnabled, onMoveCharacterTrack, onSetCharacterPositionsLocked }: {
  preparing: boolean
  onEnterFullscreen: () => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  selectedCanvasId?: string | null
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
  onSplitVideoClip: (clipId: string, frame: number, rightClipId: string) => void
  onUpdateTextClip: (clip: TextClip) => void
  onUpdateVideoClip: (clip: VideoMediaClip, record?: boolean) => void
  onChangeVideoAudio: (settings: VideoAudioSettings, record?: boolean) => void
  onBeginAudioEdit: () => void
  onDuplicateVideoClip: (clip: VideoMediaClip) => void
  onDeleteTextClip: (id: string) => void
  onDeleteVideoClip: (id: string) => void
  onDeleteTextElement: (elementId: string) => void
  onDeleteCharacterSegment: (elementId: string, startFrame: number, endFrame: number) => void
  onDuplicateTextClip: (clip: TextClip) => void
  onMoveCharacterBoundary: (elementId: string, keyId: string, frame: number) => void
  onChangeDuration: (durationFrames: number) => void
  onResize: (height: number) => void
  onAddText: (kind: 'speech' | 'thought') => void
  onAddVideo: () => void
  onChangeTrackSettings: (id: string, settings: NonNullable<VideoTimelineDocument['trackSettings']>[string]) => void
  onSetCharacterAnimationsEnabled: (enabled: boolean) => void
  onMoveCharacterTrack: (id: string, direction: -1 | 1) => void
  onSetCharacterPositionsLocked: (locked: boolean) => void
}) {
  const resizePointer = useRef<{ id: number; startY: number; startHeight: number } | null>(null)
  const textClipDragRef = useRef<TextClipDrag | null>(null)
  const videoClipDragRef = useRef<VideoClipDrag | null>(null)
  const boundaryDragRef = useRef<BoundaryDrag | null>(null)
  const suppressClipClickRef = useRef(false)
  const timelineScrollRef = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState<TrackSelection>(null)
  const characterTrackClickRef = useRef<string | null>(null)
  const [previewTextClip, setPreviewTextClip] = useState<TextClip | null>(null)
  const [previewVideoClip, setPreviewVideoClip] = useState<VideoMediaClip | null>(null)
  const [previewBoundary, setPreviewBoundary] = useState<{ elementId: string; keyId: string; frame: number } | null>(null)
  const [trackMenuOpen, setTrackMenuOpen] = useState(false)
  const [pixelsPerSecond, setPixelsPerSecond] = useState(() => {
    try {
      const stored = Number(window.localStorage.getItem('gacha-nymi-video-timeline-zoom'))
      return Number.isFinite(stored) && stored >= 1 ? Math.min(stored, 120) : 37
    } catch { return 37 }
  })
  const timeline = videoTimelineFor(studio)
  const characterAnimationsEnabled = timeline.animateCharacterTransitions !== false
  const selectedCharacterForText = studio.elements.find((element) => element.id === selectedCanvasId && element.kind === 'character')
  useEffect(() => {
    if (selectedCanvasId === undefined) return
    const clipId = selectedCanvasId?.startsWith('video:') ? selectedCanvasId.slice(6) : null
    const clip = timeline.videoClips?.find((item) => item.id === clipId)
    setSelection((current) => clip
      ? { kind: 'video', clipId: clip.id, startFrame: clip.startFrame, endFrame: clip.endFrame }
      : current?.kind === 'video' ? null : current)
  }, [selectedCanvasId, timeline.videoClips])
  const trackSettings = timeline.trackSettings ?? {}
  const isLocked = (id: string) => trackSettings[id]?.locked === true
  const duration = Math.max(1, timeline.durationFrames)
  const timelineSeconds = duration / 60
  const timelineWidth = timelineSeconds * pixelsPerSecond
  const contentWidth = timelineWidth + 96
  const tickSeconds = pixelsPerSecond >= 16 ? 5 : Math.max(1, Math.ceil(80 / pixelsPerSecond))
  const tickCount = Math.floor(timelineSeconds / tickSeconds)
  const characters = studio.elements.filter((element) => element.kind === 'character').sort((left, right) => (trackSettings[left.id]?.order ?? studio.elements.indexOf(left)) - (trackSettings[right.id]?.order ?? studio.elements.indexOf(right)))
  const characterPositionsLocked = characters.length > 0 && characters.every((character) => character.positionLocked === true)
  const selectedTextClip = selection?.kind === 'text' ? timeline.textClips.find((clip) => clip.id === selection.clipId) : undefined
  const selectedVideoClip = selection?.kind === 'video' ? timeline.videoClips?.find((clip) => clip.id === selection.clipId) : undefined
  const canDeleteSelection = selection?.kind === 'character'
    ? !isLocked(selection.elementId) && characters.some((character) => character.id === selection.elementId)
    : selection?.kind === 'text'
      ? !isLocked(selectedTextClip?.kind ?? studio.elements.find((element) => element.id === selection.elementId)?.kind ?? 'speech')
        && Boolean(selectedTextClip || studio.elements.some((element) => element.id === selection.elementId && (element.kind === 'speech' || element.kind === 'thought')))
      : selection?.kind === 'video' ? !isLocked('video') && Boolean(selectedVideoClip) : false
  const deleteSelection = () => {
    if (!selection || !canDeleteSelection) return
    if (selection.kind === 'character') onDeleteCharacterSegment(selection.elementId, selection.startFrame, selection.endFrame)
    else if (selection.kind === 'video') onDeleteVideoClip(selection.clipId)
    else if (!selectedTextClip) onDeleteTextElement(selection.elementId)
    else if (!timeline.textClips.some((clip) => clip.elementId === selection.elementId && clip.id !== selection.clipId)) onDeleteTextElement(selection.elementId)
    else onDeleteTextClip(selection.clipId)
    setSelection(null)
  }
  // Keyboard actions must use the current document/history even when selection stays unchanged.
  const deleteFromKeyboard = useEffectEvent(() => deleteSelection())
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Backspace' || event.altKey || event.ctrlKey || event.metaKey || !canDeleteSelection) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]'))) return
      event.preventDefault()
      deleteFromKeyboard()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selection, canDeleteSelection])
  useEffect(() => {
    const sampledFrame = Math.min(playheadFrame, duration - 1)
    if (selection?.kind !== 'character' || selection.startFrame <= sampledFrame && sampledFrame < selection.endFrame) return
    const segment = characterSegmentAtFrame(timeline, selection.elementId, sampledFrame, duration)
    setSelection(segment ? { kind: 'character', elementId: selection.elementId, ...segment } : null)
  }, [playheadFrame, selection, timeline.characterKeys, timeline.characterGaps, duration])
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
  const seekToLanePosition = (event: ReactMouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return
    characterTrackClickRef.current = null
    const laneBounds = event.currentTarget.getBoundingClientRect()
    const laneFrame = Math.floor(((event.clientX - laneBounds.left) / pixelsPerSecond) * 60)
    onSeek(Math.max(0, Math.min(duration - 1, laneFrame)))
  }
  const selectOrSeekCharacterTrack = (elementId: string, frame: number) => {
    const secondClickOnTrack = characterTrackClickRef.current === elementId
    characterTrackClickRef.current = elementId
    const segment = characterSegmentAtFrame(timeline, elementId, frame, duration)
    setSelection(segment ? { kind: 'character', elementId, ...segment } : null)
    onSelectElement(elementId)
    if (secondClickOnTrack) onSeek(frame)
  }
  const snapFrame = (frame: number, excludedClipId?: string) => {
    const candidates = [playheadFrame, Math.round(frame / 60) * 60,
      ...timeline.characterKeys.map((key) => key.frame),
      ...timeline.textClips.filter((clip) => clip.id !== excludedClipId).flatMap((clip) => [clip.startFrame, clip.endFrame]),
      ...(timeline.videoClips ?? []).filter((clip) => clip.id !== excludedClipId).flatMap((clip) => [clip.startFrame, clip.endFrame])]
    const nearest = candidates.reduce((best, candidate) => Math.abs(candidate - frame) < Math.abs(best - frame) ? candidate : best, candidates[0] ?? frame)
    return Math.abs(nearest - frame) / 60 * pixelsPerSecond <= 8 ? nearest : frame
  }
  const selectedTrackId = selection?.kind === 'video' ? 'video' : selection?.kind === 'character' ? selection.elementId : selectedTextClip?.kind ?? 'speech'
  const canSplitSelection = Boolean(selection && !isLocked(selectedTrackId) && playheadFrame > selection.startFrame && playheadFrame < selection.endFrame)
  const splitSelection = () => {
    if (!selection || !canSplitSelection || (selection.kind !== 'video' && isLocked(selection.kind === 'character' ? selection.elementId : timeline.textClips.find((clip) => clip.id === selection.clipId)?.kind ?? 'speech'))) return
    if (selection.kind === 'character') onSplitCharacter(selection.elementId, playheadFrame)
    else if (selection.kind === 'video') {
      const rightClipId = crypto.randomUUID()
      onSplitVideoClip(selection.clipId, playheadFrame, rightClipId)
      onSelectElement(`video:${rightClipId}`)
      setSelection({ ...selection, clipId: rightClipId, startFrame: playheadFrame })
    } else {
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
  const beginVideoClipDrag = (event: ReactPointerEvent<HTMLButtonElement>, clip: VideoMediaClip) => {
    event.preventDefault()
    event.stopPropagation()
    const edge = (event.target as HTMLElement).closest<HTMLElement>('[data-clip-edge]')?.dataset.clipEdge
    const mode = edge === 'start' || edge === 'end' ? edge : 'move'
    onSelectElement(`video:${clip.id}`)
    setSelection({ kind: 'video', clipId: clip.id, startFrame: clip.startFrame, endFrame: clip.endFrame })
    if (!edge) {
      const bounds = event.currentTarget.getBoundingClientRect()
      const ratio = bounds.width > 0 ? Math.max(0, Math.min(0.999999, (event.clientX - bounds.left) / bounds.width)) : 0
      onSeek(Math.min(clip.endFrame - 1, clip.startFrame + Math.floor((clip.endFrame - clip.startFrame) * ratio)))
    }
    if (isLocked('video')) return
    videoClipDragRef.current = { pointerId: event.pointerId, clip, mode, originX: event.clientX, latest: clip }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveVideoClipDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = videoClipDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const asset = timeline.videoAssets?.find((item) => item.id === drag.clip.assetId)
    if (!asset) return
    const delta = Math.round((event.clientX - drag.originX) / pixelsPerSecond * 60)
    const origin = drag.mode === 'end' ? drag.clip.endFrame : drag.clip.startFrame
    drag.latest = editVideoMediaClip(drag.clip, drag.mode, snapFrame(origin + delta, drag.clip.id), asset.durationFrames, duration)
    setPreviewVideoClip(drag.latest)
  }
  const finishVideoClipDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = videoClipDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    videoClipDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (event.type !== 'pointercancel' && !isLocked('video') && (drag.latest.startFrame !== drag.clip.startFrame || drag.latest.endFrame !== drag.clip.endFrame)) {
      suppressClipClickRef.current = true
      onUpdateVideoClip(drag.latest)
      setSelection({ kind: 'video', clipId: drag.clip.id, startFrame: drag.latest.startFrame, endFrame: drag.latest.endFrame })
      requestAnimationFrame(() => { suppressClipClickRef.current = false })
    }
    setPreviewVideoClip(null)
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
      <div className="video-timeline-create-actions"><button type="button" onClick={() => onAddText('speech')} disabled={!selectedCharacterForText} title={selectedCharacterForText ? `Criar fala de ${selectedCharacterForText.text}` : 'Selecione um personagem primeiro'}>+ Fala</button><button type="button" onClick={() => onAddText('thought')} disabled={!selectedCharacterForText} title={selectedCharacterForText ? `Criar pensamento de ${selectedCharacterForText.text}` : 'Selecione um personagem primeiro'}>+ Pensamento</button><button type="button" onClick={onSaveFrame}>+ Corte</button></div>
      <div className="video-timeline-heading"><strong>{formatTime(playheadFrame)}</strong><span>/ {formatTime(duration)}</span><small>{timeline.characterKeys.length + timeline.textClips.length + (timeline.videoClips?.length ?? 0)} eventos</small><button type="button" className="video-history-button" onClick={onUndo} disabled={!canUndo} aria-label="Desfazer" title="Desfazer (Ctrl+Z)"><Icon name="undo" /></button><button type="button" className="video-history-button" onClick={onRedo} disabled={!canRedo} aria-label="Refazer" title="Refazer (Ctrl+Shift+Z ou Ctrl+Y)"><Icon name="redo" /></button><button type="button" className="video-play-button" aria-label={preparing ? 'Cancelar preparação das animações' : playing ? 'Pausar reprodução' : 'Reproduzir'} aria-busy={preparing} onClick={onTogglePlayback}>{playing ? '❚❚' : '▶'}<span>{preparing ? 'Preparando…' : playing ? 'Pausar' : 'Play'}</span></button><button type="button" className="video-split-button" onClick={splitSelection} disabled={!canSplitSelection} title={selection ? 'Dividir o trecho selecionado na posição do playhead' : 'Selecione um trecho para dividir'}>✂ Dividir</button><button type="button" className={`video-position-lock-button${characterPositionsLocked ? ' active' : ''}`} onClick={() => onSetCharacterPositionsLocked(!characterPositionsLocked)} disabled={!characters.length} aria-pressed={characterPositionsLocked} aria-label={characterPositionsLocked ? 'Destrancar posições dos personagens' : 'Trancar posições dos personagens'} title={characterPositionsLocked ? 'Destrancar posições dos personagens' : 'Trancar posições dos personagens'}><Icon name={characterPositionsLocked ? 'lock' : 'unlock'} /></button><button type="button" className="video-add-video-button" onClick={onAddVideo} title="Abrir biblioteca de vídeos">+ Vídeo</button><button type="button" className="video-preview-fullscreen-button" onClick={onEnterFullscreen} aria-label="Prévia em tela cheia" title="Prévia em tela cheia"><Icon name="expand" /></button>{selectedVideoClip && !isLocked('video') && <button type="button" onClick={() => onDuplicateVideoClip(selectedVideoClip)} disabled={selectedVideoClip.endFrame * 2 - selectedVideoClip.startFrame > duration} title="Duplicar vídeo selecionado">Duplicar</button>}{selection?.kind === 'text' && !isLocked(selectedTextClip?.kind ?? 'speech') && selectedTextClip && <button type="button" onClick={() => onDuplicateTextClip(selectedTextClip)} title="Duplicar trecho selecionado">Duplicar</button>}{canDeleteSelection && <button type="button" className="video-delete-selection-button" onClick={deleteSelection} aria-label="Excluir somente o bloco selecionado" title="Excluir somente o bloco selecionado (Backspace)"><Icon name="trash" /></button>}</div>
      <div className="video-timeline-actions">
        <VideoAudioControls master={timeline.videoAudio} selectedClip={selectedVideoClip} clipName={timeline.videoAssets?.find((asset) => asset.id === selectedVideoClip?.assetId)?.name} locked={isLocked('video')} onChangeMaster={onChangeVideoAudio} onChangeClip={onUpdateVideoClip} onBeginEdit={onBeginAudioEdit} />
        <button type="button" className={`video-transition-toggle${characterAnimationsEnabled ? ' active' : ''}`} aria-pressed={characterAnimationsEnabled} onClick={() => onSetCharacterAnimationsEnabled(!characterAnimationsEnabled)} title={characterAnimationsEnabled ? 'Desativar animação entre poses, expressões e boca durante falas' : 'Ativar animação entre poses, expressões e boca durante falas'}><span aria-hidden="true">⇄</span> Animações {characterAnimationsEnabled ? 'ligadas' : 'desligadas'}</button>
        <label className="video-jump-control">Ir para<input aria-label="Ir para segundo da timeline" type="number" min={0} max={Math.floor(duration / 60)} value={Math.floor(playheadFrame / 60)} onChange={(event) => onSeek(Math.min(duration, Math.max(0, Number(event.currentTarget.value) || 0) * 60))} />s</label>
        <button type="button" onClick={() => onChangeDuration(Math.max(60, duration - 3600))} disabled={duration <= 3600 || timeline.characterKeys.some((key) => key.frame >= duration - 3600) || timeline.textClips.some((clip) => clip.endFrame > duration - 3600) || (timeline.videoClips ?? []).some((clip) => clip.endFrame > duration - 3600)} title="Reduzir duração em um minuto">− 1 min</button>
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
      {([{ id: 'video', name: 'Vídeo' }, { id: 'speech', name: 'Falas' }, { id: 'thought', name: 'Pensamentos' }, ...characters.map((character) => ({ id: character.id, name: character.text || 'Personagem' }))]).map(({ id, name }) => {
        const settings = trackSettings[id] ?? {}
        return <div className="video-track-settings-row" key={id}>
          <input aria-label={`Nome da faixa ${name}`} value={settings.label ?? name} onChange={(event) => onChangeTrackSettings(id, { ...settings, label: event.currentTarget.value })} />
          <button type="button" aria-label={`${settings.visible === false ? 'Mostrar' : 'Ocultar'} faixa ${name}`} aria-pressed={settings.visible !== false} onClick={() => onChangeTrackSettings(id, { ...settings, visible: settings.visible === false })}>{settings.visible === false ? '◌' : '◉'}</button>
          <button type="button" aria-label={`${settings.locked ? 'Desbloquear' : 'Bloquear'} faixa ${name}`} aria-pressed={settings.locked === true} onClick={() => onChangeTrackSettings(id, { ...settings, locked: !settings.locked })}>{settings.locked ? '🔒' : '🔓'}</button>
          <button type="button" aria-label={`${settings.collapsed ? 'Expandir' : 'Recolher'} faixa ${name}`} onClick={() => onChangeTrackSettings(id, { ...settings, collapsed: !settings.collapsed })}>{settings.collapsed ? '▸' : '▾'}</button>
          {id !== 'video' && id !== 'speech' && id !== 'thought' && <><button type="button" aria-label={`Mover faixa ${name} para cima`} onClick={() => onMoveCharacterTrack(id, -1)}>↑</button><button type="button" aria-label={`Mover faixa ${name} para baixo`} onClick={() => onMoveCharacterTrack(id, 1)}>↓</button></>}
        </div>
      })}
    </div>}
    <div className="video-timeline-scroll" ref={timelineScrollRef}>
      <div className="video-timeline-content" style={{ width: `${contentWidth}px` }}>
        <div className="video-timeline-ruler-row">
          <span className="video-track-label video-ruler-label">Faixas<button type="button" className={`video-track-settings-toggle${trackMenuOpen ? ' active' : ''}`} aria-label="Configurar faixas" aria-expanded={trackMenuOpen} title="Configurar faixas" onClick={() => setTrackMenuOpen((value) => !value)}>⚙</button></span>
          <div className="video-timeline-ruler" style={{ width: `${timelineWidth}px`, backgroundSize: `${tickSeconds * pixelsPerSecond}px 100%` }} aria-label="Posição do playhead">
            {Array.from({ length: tickCount + 1 }, (_, index) => index * tickSeconds).map((second) => <span key={second} style={{ left: `${second * pixelsPerSecond}px` }}>{`${String(Math.floor(second / 60)).padStart(2, '0')}:${String(second % 60).padStart(2, '0')}`}</span>)}
            <input aria-label="Mover playhead" type="range" min={0} max={duration} step={1} value={Math.min(playheadFrame, duration)} onChange={(event) => onSeek(Number(event.currentTarget.value))} />
          </div>
        </div>
        <div className="video-timeline-tracks">
          {trackSettings.video?.visible !== false && <div className={`video-track-row video-master-track${trackSettings.video?.collapsed ? ' collapsed' : ''}`}>
            <span className="video-track-label"><i className="video-track-badge video">V</i><span>{trackSettings.video?.label ?? 'Vídeo'}</span></span>
            <div className="video-track-lane video-master-lane" style={{ backgroundSize: `${tickSeconds * pixelsPerSecond}px 100%` }} aria-label="Faixa de vídeo do projeto" onClick={seekToLanePosition}>
              {(timeline.videoClips ?? []).map((savedClip) => {
                const clip = previewVideoClip?.id === savedClip.id ? previewVideoClip : savedClip
                const asset = timeline.videoAssets?.find((item) => item.id === clip.assetId)
                const selected = selection?.kind === 'video' && selection.clipId === clip.id
                return <button key={clip.id} type="button" className={`video-master-span${selected ? ' selected' : ''}${isLocked('video') ? ' locked' : ''}`} style={{ left: `${clip.startFrame / 60 * pixelsPerSecond}px`, width: `${Math.max(3, (clip.endFrame - clip.startFrame) / 60 * pixelsPerSecond)}px` }} title={`${asset?.name ?? 'Vídeo'} · ${formatTime(clip.endFrame - clip.startFrame)}`}
                  onPointerDown={(event) => beginVideoClipDrag(event, clip)} onPointerMove={moveVideoClipDrag} onPointerUp={finishVideoClipDrag} onPointerCancel={finishVideoClipDrag}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (suppressClipClickRef.current) return
                    onSelectElement(`video:${clip.id}`)
                    setSelection({ kind: 'video', clipId: clip.id, startFrame: clip.startFrame, endFrame: clip.endFrame })
                    if (event.detail === 0) onSeek(clip.startFrame)
                  }}>
                  <span className="video-clip-edge video-clip-edge-start" data-clip-edge="start" aria-label="Ajustar início do vídeo" />
                  <span className="video-clip-caption">{asset?.name ?? 'Vídeo'}</span>
                  <span className="video-clip-edge video-clip-edge-end" data-clip-edge="end" aria-label="Ajustar fim do vídeo" />
                </button>
              })}
              <i className="video-lane-playhead" style={{ left: `${playheadFrame / 60 * pixelsPerSecond}px` }} />
              {!(timeline.videoClips?.length) && <span className="video-track-empty">Adicione um vídeo pela barra superior</span>}
            </div>
          </div>}
          {textTracks.filter(({ kind }) => trackSettings[kind]?.visible !== false).map(({ kind, label, clips }) => <div className={`video-track-row${trackSettings[kind]?.collapsed ? ' collapsed' : ''}`} key={kind}>
            <span className="video-track-label"><i className={`video-track-badge ${kind}`}>{kind === 'speech' ? 'F' : 'P'}</i><span>{trackSettings[kind]?.label ?? label}</span></span>
            <div className={`video-track-lane ${kind}-lane`} style={{ backgroundSize: `${tickSeconds * pixelsPerSecond}px 100%` }} aria-label={`Faixa de ${label.toLowerCase()}`} onClick={seekToLanePosition}>
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
            const gaps = (timeline.characterGaps ?? []).filter((gap) => gap.elementId === character.id).sort((a, b) => a.startFrame - b.startFrame)
            const visibleStates = states.flatMap((state) => {
              let parts = [{ start: state.start, end: state.end }]
              for (const gap of gaps) parts = parts.flatMap((part) => {
                if (gap.endFrame <= part.start || gap.startFrame >= part.end) return [part]
                return [
                  ...(gap.startFrame > part.start ? [{ start: part.start, end: gap.startFrame }] : []),
                  ...(gap.endFrame < part.end ? [{ start: gap.endFrame, end: part.end }] : [])
                ]
              })
              return parts.map((part) => ({ ...state, start: part.start, end: part.end, renderId: `${state.id}:${part.start}` }))
            })
            return <div className={`video-track-row${trackSettings[character.id]?.collapsed ? ' collapsed' : ''}`} key={character.id}>
              <span className="video-track-label" title={name}><i className="video-track-badge" style={{ backgroundColor: color }}>{name.slice(0, 1).toUpperCase()}</i><span>{trackSettings[character.id]?.label ?? name}</span></span>
              <div className="video-track-lane character-lane" style={{ backgroundSize: `${tickSeconds * pixelsPerSecond}px 100%` }} aria-label={`Faixa de ${name}`} onClick={(event) => {
                if ((event.target as HTMLElement).closest('button')) return
                const bounds = event.currentTarget.getBoundingClientRect()
                const frame = Math.max(0, Math.min(duration - 1, Math.floor(((event.clientX - bounds.left) / pixelsPerSecond) * 60)))
                selectOrSeekCharacterTrack(character.id, frame)
              }}>
                {visibleStates.map((state) => {
                  const selected = selection?.kind === 'character' && selection.elementId === character.id && selection.startFrame === state.start && selection.endFrame === state.end
                  return <button type="button" key={state.renderId} className={`video-character-span ${selected ? 'selected' : ''}`} style={{ left: `${state.start / 60 * pixelsPerSecond}px`, width: `${Math.max(3, (state.end - state.start) / 60 * pixelsPerSecond)}px`, background: `linear-gradient(180deg, ${color} 0%, ${color}cc 48%, ${color}8c 100%)` }} onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    const ratio = rect.width > 0 ? Math.max(0, Math.min(0.999999, (event.clientX - rect.left) / rect.width)) : 0
                    const frame = Math.min(state.end - 1, state.start + Math.floor((state.end - state.start) * ratio))
                    selectOrSeekCharacterTrack(character.id, frame)
                  }} title={`${name} · ${state.label} · clique para selecionar; clique novamente na faixa para mover o playhead`}><span>{state.label}</span></button>
                })}
                {keys.map((key, index) => key.frame > 0 && <button type="button" key={`boundary:${key.id}`} className="video-character-boundary" style={{ left: `${key.frame / 60 * pixelsPerSecond}px` }} aria-label={`Mover divisão de ${name}`} title="Arraste para ajustar a duração deste estado" onPointerDown={(event) => beginBoundaryDrag(event, character.id, key.id, key.frame, (keys[index - 1]?.frame ?? 0) + 1, (keys[index + 1]?.frame ?? duration) - 1)} onPointerMove={moveBoundaryDrag} onPointerUp={finishBoundaryDrag} onPointerCancel={finishBoundaryDrag} />)}
                {timeline.saveMarkers.map((marker) => <i className="video-saved-marker" key={marker.id} style={{ left: `${marker.frame / 60 * pixelsPerSecond}px` }} title={`Frame salvo · ${formatTime(marker.frame)}`} />)}
                {keys.map((key) => <button type="button" className="video-keyframe" key={key.id} style={{ left: `${key.frame / 60 * pixelsPerSecond}px` }} title={`${formatTime(key.frame)} · ${key.faceMode}`} onClick={() => { characterTrackClickRef.current = null; const segment = characterSegmentAtFrame(timeline, character.id, key.frame, duration); setSelection(segment ? { kind: 'character', elementId: character.id, ...segment } : null); onSelectElement(character.id); onSeek(key.frame) }} aria-label={`Ir ao frame ${formatTime(key.frame)} de ${name}`} />)}
                <i className="video-lane-playhead" style={{ left: `${playheadFrame / 60 * pixelsPerSecond}px` }} />
              </div>
            </div>
          })}
        </div>
      </div>
    </div>
  </section>
}
