import { useEffect, useEffectEvent, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { VideoAudioControls } from './VideoAudioControls'
import { Icon } from '../../ui/components/Icon'
import { videoCharacterTrackColor } from '../../../../shared/studio'
import type { StudioDocument, VideoTimelineDocument } from '../../../../shared/studio'
import { editVideoMediaClip, type VideoClipEditMode } from '../../../../shared/videoMedia'
import type { VideoAudioSettings, VideoMediaClip } from '../../../../shared/studio'
import { clampTimelineBlockMove, resizeTimelineBlock, type TimelineBlockTarget } from '../../../../shared/videoTimelineEditing'
import { DEFAULT_VIDEO_DURATION_FRAMES, fitVideoTimelineDuration } from '../../../../shared/videoTimelineDuration'
import { characterKeysForFrameRange, characterSegmentAtFrame, clipsForFrameRange, indexVideoTimeline, nearestTimelineSnapFrame } from './videoTimelineIndex'

const EMPTY_TRACK_SETTINGS: NonNullable<VideoTimelineDocument['trackSettings']> = {}
const DEFAULT_TIMELINE: VideoTimelineDocument = {
  schemaVersion: 1, frameRate: 60, durationFrames: DEFAULT_VIDEO_DURATION_FRAMES,
  playheadFrame: 0, playing: false, characterKeys: [], textClips: [], saveMarkers: []
}

type TextClip = VideoTimelineDocument['textClips'][number]
type TrackSelection =
  | { kind: 'character'; elementId: string; startFrame: number; endFrame: number }
  | { kind: 'text'; elementId: string; clipId: string; startFrame: number; endFrame: number }
  | { kind: 'video'; clipId: string; startFrame: number; endFrame: number }
  | null
type TextClipDrag = { pointerId: number; clip: TextClip; mode: 'move' | 'start' | 'end'; originX: number; scrollLeft: number; startFrame: number; endFrame: number; latestStartFrame: number; latestEndFrame: number }
type VideoClipDrag = { pointerId: number; clip: VideoMediaClip; mode: VideoClipEditMode; originX: number; scrollLeft: number; latest: VideoMediaClip }
type BoundaryDrag = { pointerId: number; target: Extract<TimelineBlockTarget, { kind: 'character' }>; mode: 'start' | 'end'; originX: number; scrollLeft: number; renderId: string; source: VideoTimelineDocument; latestStart: number; latestEnd: number }

export function videoTimelineFor(studio: StudioDocument): VideoTimelineDocument {
  return studio.videoTimeline ?? DEFAULT_TIMELINE
}

function formatTime(frame: number): string {
  const seconds = Math.floor(frame / 60)
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}:${String(frame % 60).padStart(2, '0')}`
}

export function VideoTimeline({ preparing, onEnterFullscreen, onExport, canUndo, canRedo, onUndo, onRedo, selectedCanvasId, studio, playheadFrame, playing, height, presetNames, onSeek, onSelectElement, onTogglePlayback, onSaveFrame, onSplitCharacter, onSplitTextClip, onSplitVideoClip, onUpdateTextClip, onUpdateVideoClip, onChangeVideoAudio, onBeginAudioEdit, onDuplicateVideoClip, onDeleteTextClip, onDeleteVideoClip, onDeleteTextElement, onDeleteCharacterSegment, onDuplicateTextClip, onResizeBlock, onChangeDuration, onResize, onAddText, onAddVideo, onChangeTrackSettings, onSetCharacterAnimationsEnabled, onMoveCharacterTrack, onSetCharacterPositionsLocked, onChangeTimelineView }: {
  preparing: boolean
  onEnterFullscreen: () => void
  onExport: () => void
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
  onResizeBlock: (target: TimelineBlockTarget, startFrame: number, endFrame: number) => void
  onChangeDuration: (durationFrames: number) => void
  onResize: (height: number) => void
  onAddText: (kind: 'speech' | 'thought') => void
  onAddVideo: () => void
  onChangeTrackSettings: (id: string, settings: NonNullable<VideoTimelineDocument['trackSettings']>[string]) => void
  onSetCharacterAnimationsEnabled: (enabled: boolean) => void
  onMoveCharacterTrack: (id: string, direction: -1 | 1) => void
  onSetCharacterPositionsLocked: (locked: boolean) => void
  onChangeTimelineView: (settings: { zoom?: number; height?: number }) => void
}) {
  const resizePointer = useRef<{ id: number; startY: number; startHeight: number } | null>(null)
  const textClipDragRef = useRef<TextClipDrag | null>(null)
  const videoClipDragRef = useRef<VideoClipDrag | null>(null)
  const boundaryDragRef = useRef<BoundaryDrag | null>(null)
  const previewUpdateFrameRef = useRef<number | null>(null)
  const previewUpdateRef = useRef<(() => void) | null>(null)
  const suppressClipClickRef = useRef(false)
  const timelineScrollRef = useRef<HTMLDivElement>(null)
  const scrollMeasureFrameRef = useRef<number | null>(null)
  const [scrollViewport, setScrollViewport] = useState({ left: 0, width: 1200 })
  const [selection, setSelection] = useState<TrackSelection>(null)
  const characterTrackClickRef = useRef<string | null>(null)
  const [previewTextClip, setPreviewTextClip] = useState<TextClip | null>(null)
  const [previewVideoClip, setPreviewVideoClip] = useState<VideoMediaClip | null>(null)
  const [previewEdit, setPreviewEdit] = useState<VideoTimelineDocument | null>(null)
  const dragSourceRef = useRef<VideoTimelineDocument | null>(null)
  const [trackMenuOpen, setTrackMenuOpen] = useState(false)
  const [videoWaveforms, setVideoWaveforms] = useState<Record<string, string>>({})
  const [pixelsPerSecond, setPixelsPerSecond] = useState(() => Math.max(1, Math.min(120, studio.videoTimeline?.timelineZoom ?? 37)))
  const timeline = previewEdit ?? videoTimelineFor(studio)
  useEffect(() => {
    let cancelled = false
    const referencedIds = [...new Set((timeline.videoClips ?? []).map((clip) => clip.assetId))]
    const assets = referencedIds.map((id) => timeline.videoAssets?.find((asset) => asset.id === id)).filter(Boolean)
    void Promise.all(assets.map(async (asset) => {
      try {
        const prepared = await window.desktop.prepareVideoPreviewMedia(studio.id, asset!)
        return prepared.waveformUrl ? [asset!.id, prepared.waveformUrl] as const : null
      } catch { return null }
    })).then((rows) => {
      if (!cancelled) setVideoWaveforms(Object.fromEntries(rows.filter((row): row is readonly [string,string] => Boolean(row))))
    })
    return () => { cancelled = true }
  }, [studio.id, timeline.videoAssets, timeline.videoClips])
  const timelineIndex = useMemo(() => indexVideoTimeline(timeline), [timeline.characterKeys, timeline.characterGaps, timeline.textClips, timeline.videoClips, timeline.saveMarkers])
  useEffect(() => {
    const node = timelineScrollRef.current
    if (!node) return
    const measure = () => {
      if (scrollMeasureFrameRef.current !== null) return
      scrollMeasureFrameRef.current = requestAnimationFrame(() => {
        scrollMeasureFrameRef.current = null
        setScrollViewport({ left: node.scrollLeft, width: node.clientWidth })
      })
    }
    node.addEventListener('scroll', measure, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(node)
    measure()
    return () => {
      node.removeEventListener('scroll', measure)
      observer?.disconnect()
      if (scrollMeasureFrameRef.current !== null) cancelAnimationFrame(scrollMeasureFrameRef.current)
      scrollMeasureFrameRef.current = null
    }
  }, [])
  const characterAnimationsEnabled = timeline.animateCharacterTransitions !== false
  useEffect(() => {
    setPixelsPerSecond(Math.max(1, Math.min(120, studio.videoTimeline?.timelineZoom ?? 37)))
  }, [studio.id])
  const selectedCharacterForText = studio.elements.find((element) => element.id === selectedCanvasId && element.kind === 'character')
  useEffect(() => {
    if (selectedCanvasId === undefined) return
    const clipId = selectedCanvasId?.startsWith('video:') ? selectedCanvasId.slice(6) : null
    const clip = clipId ? timelineIndex.videoClipsById.get(clipId) : undefined
    setSelection((current) => clip
      ? { kind: 'video', clipId: clip.id, startFrame: clip.startFrame, endFrame: clip.endFrame }
      : current?.kind === 'video' ? null : current)
  }, [selectedCanvasId, timelineIndex])
  const trackSettings = timeline.trackSettings ?? EMPTY_TRACK_SETTINGS
  const isLocked = (id: string) => trackSettings[id]?.locked === true
  const duration = Math.max(1, timeline.durationFrames)
  const timelineSeconds = duration / 60
  const timelineWidth = timelineSeconds * pixelsPerSecond
  const contentWidth = timelineWidth + 96 + Math.max(120, scrollViewport.width / 2)
  const tickSeconds = pixelsPerSecond >= 16 ? 5 : Math.max(1, Math.ceil(80 / pixelsPerSecond))
  const tickCount = Math.floor(timelineSeconds / tickSeconds)
  const overscanPixels = 360
  const visibleStartFrame = Math.max(0, Math.floor((scrollViewport.left - 96 - overscanPixels) / pixelsPerSecond * 60))
  const visibleEndFrame = Math.min(duration, Math.ceil((scrollViewport.left + scrollViewport.width - 96 + overscanPixels) / pixelsPerSecond * 60))
  const firstVisibleTick = Math.max(0, Math.floor(visibleStartFrame / 60 / tickSeconds))
  const lastVisibleTick = Math.min(tickCount, Math.ceil(visibleEndFrame / 60 / tickSeconds))
  const characters = useMemo(() => studio.elements.map((element, originalIndex) => ({ element, originalIndex }))
    .filter(({ element }) => element.kind === 'character')
    .sort((left, right) => (trackSettings[left.element.id]?.order ?? left.originalIndex) - (trackSettings[right.element.id]?.order ?? right.originalIndex))
    .map(({ element }) => element), [studio.elements, trackSettings])
  const characterPositionsLocked = timeline.characterPositionsLocked ?? (characters.length > 0 && characters.every((character) => character.positionLocked === true))
  const selectedTextClip = selection?.kind === 'text' ? timelineIndex.textClipsById.get(selection.clipId) : undefined
  const selectedVideoClip = selection?.kind === 'video' ? timelineIndex.videoClipsById.get(selection.clipId) : undefined
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
    if (boundaryDragRef.current) return
    const sampledFrame = Math.min(playheadFrame, duration - 1)
    if (selection?.kind !== 'character' || selection.startFrame <= sampledFrame && sampledFrame < selection.endFrame) return
    const segment = characterSegmentAtFrame(timelineIndex, selection.elementId, sampledFrame, duration)
    setSelection(segment ? { kind: 'character', elementId: selection.elementId, ...segment } : null)
  }, [playheadFrame, selection, timelineIndex, duration])
  const textTracks = useMemo(() => (['speech', 'thought'] as const).map((kind) => ({
    kind,
    label: kind === 'speech' ? 'Falas' : 'Pensamentos',
    clips: studio.elements.filter((element) => element.kind === kind).flatMap((element) => {
      const allSavedClips = timelineIndex.textClipsByElement.get(element.id) ?? []
      const savedClips = clipsForFrameRange(allSavedClips, timelineIndex.textClipPrefixMaxEndByElement.get(element.id) ?? [], visibleStartFrame, visibleEndFrame)
      return savedClips
        .map((clip) => ({ element, clip: previewTextClip?.id === clip.id ? previewTextClip : clip }))
    })
  })), [studio.elements, timelineIndex, visibleStartFrame, visibleEndFrame, duration, previewTextClip])
  const resizeTimeline = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = resizePointer.current
    if (!drag || drag.id !== event.pointerId) return
    const maximum = Math.max(220, Math.floor(window.innerHeight * 0.65))
    onResize(Math.max(150, Math.min(maximum, drag.startHeight + drag.startY - event.clientY)))
  }
  const finishResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = resizePointer.current
    if (drag?.id !== event.pointerId) return
    resizePointer.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const maximum = Math.max(220, Math.floor(window.innerHeight * 0.65))
    onChangeTimelineView({ height: Math.max(150, Math.min(maximum, drag.startHeight + drag.startY - event.clientY)) })
  }
  const setZoom = (value: number) => {
    const zoom = Math.max(1, Math.min(120, value))
    setPixelsPerSecond(zoom)
    onChangeTimelineView({ zoom })
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
    const segment = characterSegmentAtFrame(timelineIndex, elementId, frame, duration)
    setSelection(segment ? { kind: 'character', elementId, ...segment } : null)
    onSelectElement(elementId)
    if (secondClickOnTrack) onSeek(frame)
  }
  const snapFrame = (frame: number, excludedClipId?: string, includePlayhead = true) => {
    return nearestTimelineSnapFrame(timelineIndex, frame, playheadFrame, pixelsPerSecond, excludedClipId, includePlayhead)
  }
  const schedulePreviewUpdate = (update: () => void) => {
    previewUpdateRef.current = update
    if (previewUpdateFrameRef.current !== null) return
    previewUpdateFrameRef.current = requestAnimationFrame(() => {
      previewUpdateFrameRef.current = null
      const pending = previewUpdateRef.current
      previewUpdateRef.current = null
      pending?.()
    })
  }
  const cancelPreviewUpdate = () => {
    if (previewUpdateFrameRef.current !== null) cancelAnimationFrame(previewUpdateFrameRef.current)
    previewUpdateFrameRef.current = null
    previewUpdateRef.current = null
  }
  useEffect(() => () => cancelPreviewUpdate(), [])
  const selectedTrackId = selection?.kind === 'video' ? 'video' : selection?.kind === 'character' ? selection.elementId : selectedTextClip?.kind ?? 'speech'
  const characterTrackRows = useMemo(() => characters
    .filter((character) => trackSettings[character.id]?.visible !== false)
    .map((character) => {
      const keys = characterKeysForFrameRange(timelineIndex.characterKeysByElement.get(character.id) ?? [], visibleStartFrame, visibleEndFrame)
      const name = character.text || studio.assets.find((asset) => asset.id === character.assetId)?.name || 'Personagem'
      const color = videoCharacterTrackColor(character.id, character.timelineColor)
      const basePresetId = timeline.characterBases?.[character.id]?.element.activeExpressionPresetId
      const baseLabel = basePresetId ? presetNames[basePresetId] ?? 'Expressão' : 'Base'
      const states = keys.length
        ? [...(keys[0].frame > 0 ? [{ id: `base:${character.id}`, start: 0, end: keys[0].frame, label: baseLabel }] : []), ...keys.map((key, index) => ({ id: key.id, start: key.frame, end: keys[index + 1]?.frame ?? duration, label: key.expressionPresetId ? presetNames[key.expressionPresetId] ?? 'Expressão' : key.faceMode === 'idle' ? 'Base' : key.faceMode === 'blink' ? 'Blink' : 'Talk' }))]
        : [{ id: `base:${character.id}`, start: 0, end: duration, label: baseLabel }]
      const gaps = timelineIndex.characterGapsByElement.get(character.id) ?? []
      const visibleStates = states.flatMap((state) => {
        let parts = [{ start: state.start, end: state.end }]
        for (const gap of gaps) parts = parts.flatMap((part) => {
          if (gap.endFrame <= part.start || gap.startFrame >= part.end) return [part]
          return [
            ...(gap.startFrame > part.start ? [{ start: part.start, end: gap.startFrame }] : []),
            ...(gap.endFrame < part.end ? [{ start: gap.endFrame, end: part.end }] : [])
          ]
        })
        return parts.map((part, index) => ({ ...state, start: part.start, end: part.end, renderId: `${state.id}:${index}` }))
      }).filter((state) => state.end > visibleStartFrame && state.start < visibleEndFrame)
      return { character, keys, name, color, visibleStates }
    }), [characters, trackSettings, timelineIndex, visibleStartFrame, visibleEndFrame, timeline.characterBases, presetNames, duration, studio.assets])
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
    dragSourceRef.current = videoTimelineFor(studio)
    textClipDragRef.current = { pointerId: event.pointerId, clip, mode, originX: event.clientX, scrollLeft: timelineScrollRef.current?.scrollLeft ?? 0, startFrame: clip.startFrame, endFrame: clip.endFrame, latestStartFrame: clip.startFrame, latestEndFrame: clip.endFrame }
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
    dragSourceRef.current = videoTimelineFor(studio)
    videoClipDragRef.current = { pointerId: event.pointerId, clip, mode, originX: event.clientX, scrollLeft: timelineScrollRef.current?.scrollLeft ?? 0, latest: clip }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const scrollForDrag = (clientX: number) => {
    const scroller = timelineScrollRef.current
    if (!scroller) return
    const bounds = scroller.getBoundingClientRect()
    if (clientX > bounds.right - 28) scroller.scrollLeft += 16
    else if (clientX < bounds.left + 120) scroller.scrollLeft = Math.max(0, scroller.scrollLeft - 16)
  }
  const moveVideoClipDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = videoClipDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const asset = timeline.videoAssets?.find((item) => item.id === drag.clip.assetId)
    if (!asset) return
    scrollForDrag(event.clientX)
    const delta = Math.round((event.clientX - drag.originX + (timelineScrollRef.current?.scrollLeft ?? 0) - drag.scrollLeft) / pixelsPerSecond * 60)
    const origin = drag.mode === 'end' ? drag.clip.endFrame : drag.clip.startFrame
    drag.latest = editVideoMediaClip(drag.clip, drag.mode, drag.mode === 'move' ? snapFrame(origin + delta, drag.clip.id) : origin + delta, asset.durationFrames, Math.max(duration, origin + delta))
    if (drag.mode === 'move' && dragSourceRef.current) {
      const startFrame = clampTimelineBlockMove(dragSourceRef.current, { kind: 'video', clipId: drag.clip.id }, drag.latest.startFrame)
      drag.latest = { ...drag.latest, startFrame, endFrame: startFrame + (drag.clip.endFrame - drag.clip.startFrame) }
    }
    schedulePreviewUpdate(() => {
      setPreviewVideoClip(drag.latest)
      if (drag.mode !== 'move') setPreviewEdit(resizeTimelineBlock(dragSourceRef.current!, { kind: 'video', clipId: drag.clip.id }, drag.latest.startFrame, drag.latest.endFrame, characters.map((character) => character.id)))
    })
  }
  const finishVideoClipDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = videoClipDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    videoClipDragRef.current = null
    cancelPreviewUpdate()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (event.type !== 'pointercancel' && !isLocked('video') && (drag.latest.startFrame !== drag.clip.startFrame || drag.latest.endFrame !== drag.clip.endFrame)) {
      suppressClipClickRef.current = true
      if (drag.mode === 'move') onUpdateVideoClip(drag.latest)
      else onResizeBlock({ kind: 'video', clipId: drag.clip.id }, drag.latest.startFrame, drag.latest.endFrame)
      setSelection({ kind: 'video', clipId: drag.clip.id, startFrame: drag.latest.startFrame, endFrame: drag.latest.endFrame })
      requestAnimationFrame(() => { suppressClipClickRef.current = false })
    }
    setPreviewVideoClip(null)
    setPreviewEdit(null)
  }
  const moveTextClipDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = textClipDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    scrollForDrag(event.clientX)
    const delta = Math.round((event.clientX - drag.originX + (timelineScrollRef.current?.scrollLeft ?? 0) - drag.scrollLeft) / pixelsPerSecond * 60)
    let startFrame = drag.startFrame
    let endFrame = drag.endFrame
    if (drag.mode === 'move') {
      startFrame = Math.max(0, Math.min(duration - (drag.endFrame - drag.startFrame), snapFrame(drag.startFrame + delta, drag.clip.id)))
      endFrame = startFrame + (drag.endFrame - drag.startFrame)
      if (dragSourceRef.current) {
        startFrame = clampTimelineBlockMove(dragSourceRef.current, { kind: 'text', clipId: drag.clip.id }, startFrame)
        endFrame = startFrame + (drag.endFrame - drag.startFrame)
      }
    } else if (drag.mode === 'start') startFrame = Math.max(0, Math.min(drag.endFrame - 1, drag.startFrame + delta))
    else endFrame = Math.max(drag.startFrame + 1, drag.endFrame + delta)
    drag.latestStartFrame = startFrame
    drag.latestEndFrame = endFrame
    schedulePreviewUpdate(() => {
      setPreviewTextClip({ ...drag.clip, startFrame: drag.latestStartFrame, endFrame: drag.latestEndFrame })
      if (drag.mode !== 'move') setPreviewEdit(resizeTimelineBlock(dragSourceRef.current!, { kind: 'text', clipId: drag.clip.id }, drag.latestStartFrame, drag.latestEndFrame, characters.map((character) => character.id)))
    })
  }
  const finishTextClipDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = textClipDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    textClipDragRef.current = null
    cancelPreviewUpdate()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (event.type !== 'pointercancel' && (drag.latestStartFrame !== drag.startFrame || drag.latestEndFrame !== drag.endFrame)) {
      suppressClipClickRef.current = true
      if (drag.mode === 'move') onUpdateTextClip({ ...drag.clip, startFrame: drag.latestStartFrame, endFrame: drag.latestEndFrame })
      else onResizeBlock({ kind: 'text', clipId: drag.clip.id }, drag.latestStartFrame, drag.latestEndFrame)
      setSelection((current) => current?.kind === 'text' && current.clipId === drag.clip.id
        ? { ...current, startFrame: drag.latestStartFrame, endFrame: drag.latestEndFrame }
        : current)
      requestAnimationFrame(() => { suppressClipClickRef.current = false })
    }
    setPreviewTextClip(null)
    setPreviewEdit(null)
  }
  const beginCharacterSpanBoundaryDrag = (event: ReactPointerEvent<HTMLButtonElement>, elementId: string, startFrame: number, endFrame: number) => {
    if (isLocked(elementId)) return
    const edge = (event.target as HTMLElement).closest<HTMLElement>('[data-boundary-edge]')?.dataset.boundaryEdge
    if (edge !== 'start' && edge !== 'end') return
    event.preventDefault()
    event.stopPropagation()
    onSelectElement(elementId)
    const target = { kind: 'character' as const, elementId, startFrame, endFrame }
    setSelection(target)
    boundaryDragRef.current = { pointerId: event.pointerId, target, mode: edge, originX: event.clientX, scrollLeft: timelineScrollRef.current?.scrollLeft ?? 0, renderId: event.currentTarget.dataset.segmentId!, source: videoTimelineFor(studio), latestStart: startFrame, latestEnd: endFrame }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveBoundaryDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = boundaryDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    scrollForDrag(event.clientX)
    const delta = Math.round((event.clientX - drag.originX + (timelineScrollRef.current?.scrollLeft ?? 0) - drag.scrollLeft) / pixelsPerSecond * 60)
    // The edge follows the pointer directly, including across any number of neighbours.
    drag.latestStart = drag.mode === 'start' ? Math.max(0, Math.min(drag.target.endFrame - 1, drag.target.startFrame + delta)) : drag.target.startFrame
    drag.latestEnd = drag.mode === 'end' ? Math.max(drag.target.startFrame + 1, drag.target.endFrame + delta) : drag.target.endFrame
    schedulePreviewUpdate(() => setPreviewEdit(resizeTimelineBlock(drag.source, drag.target, drag.latestStart, drag.latestEnd, characters.map((character) => character.id))))
  }
  const finishBoundaryDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = boundaryDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    boundaryDragRef.current = null
    cancelPreviewUpdate()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (event.type !== 'pointercancel' && (drag.latestStart !== drag.target.startFrame || drag.latestEnd !== drag.target.endFrame)) {
      suppressClipClickRef.current = true
      onResizeBlock(drag.target, drag.latestStart, drag.latestEnd)
      setSelection({ ...drag.target, startFrame: drag.latestStart, endFrame: drag.latestEnd })
      requestAnimationFrame(() => { suppressClipClickRef.current = false })
    }
    setPreviewEdit(null)
  }

  return <section className="video-timeline" aria-label="Timeline do Video Studio">
    <header className="video-timeline-toolbar">
      <div className="video-timeline-create-actions"><button type="button" onClick={() => onAddText('speech')} disabled={!selectedCharacterForText} title={selectedCharacterForText ? `Criar fala de ${selectedCharacterForText.text}` : 'Selecione um personagem primeiro'}>+ Fala</button><button type="button" onClick={() => onAddText('thought')} disabled={!selectedCharacterForText} title={selectedCharacterForText ? `Criar pensamento de ${selectedCharacterForText.text}` : 'Selecione um personagem primeiro'}>+ Pensamento</button><button type="button" onClick={onSaveFrame}>+ Corte</button></div>
      <div className="video-timeline-heading"><strong>{formatTime(playheadFrame)}</strong><span>/ {formatTime(duration)}</span><small>{timeline.characterKeys.length + timeline.textClips.length + (timeline.videoClips?.length ?? 0)} eventos</small><button type="button" className="video-history-button" onClick={onUndo} disabled={!canUndo} aria-label="Desfazer" title="Desfazer (Ctrl+Z)"><Icon name="undo" /></button><button type="button" className="video-history-button" onClick={onRedo} disabled={!canRedo} aria-label="Refazer" title="Refazer (Ctrl+Shift+Z ou Ctrl+Y)"><Icon name="redo" /></button><button type="button" className="video-play-button" aria-label={preparing ? 'Cancelar preparação das animações' : playing ? 'Pausar reprodução' : 'Reproduzir'} aria-busy={preparing} onClick={onTogglePlayback}>{playing ? '❚❚' : '▶'}<span>{preparing ? 'Preparando…' : playing ? 'Pausar' : 'Play'}</span></button><button type="button" className="video-split-button" onClick={splitSelection} disabled={!canSplitSelection} title={selection ? 'Dividir o trecho selecionado na posição do playhead' : 'Selecione um trecho para dividir'}>✂ Dividir</button><button type="button" className={`video-position-lock-button${characterPositionsLocked ? ' active' : ''}`} onClick={() => onSetCharacterPositionsLocked(!characterPositionsLocked)} disabled={!characters.length} aria-pressed={characterPositionsLocked} aria-label={characterPositionsLocked ? 'Destrancar posições dos personagens' : 'Trancar posições dos personagens'} title={characterPositionsLocked ? 'Destrancar posições dos personagens' : 'Trancar posições dos personagens'}><Icon name={characterPositionsLocked ? 'lock' : 'unlock'} /></button><button type="button" className="video-add-video-button" onClick={onAddVideo} title="Abrir biblioteca de vídeos">+ Vídeo</button><button type="button" className="video-preview-fullscreen-button" onClick={onEnterFullscreen} aria-label="Prévia em tela cheia" title="Prévia em tela cheia"><Icon name="expand" /></button>{selectedVideoClip && !isLocked('video') && <button type="button" onClick={() => onDuplicateVideoClip(selectedVideoClip)} disabled={selectedVideoClip.endFrame * 2 - selectedVideoClip.startFrame > duration} title="Duplicar vídeo selecionado">Duplicar</button>}{selection?.kind === 'text' && !isLocked(selectedTextClip?.kind ?? 'speech') && selectedTextClip && <button type="button" onClick={() => onDuplicateTextClip(selectedTextClip)} title="Duplicar trecho selecionado">Duplicar</button>}{canDeleteSelection && <button type="button" className="video-delete-selection-button" onClick={deleteSelection} aria-label="Excluir somente o bloco selecionado" title="Excluir somente o bloco selecionado (Backspace)"><Icon name="trash" /></button>}</div>
      <div className="video-timeline-actions">
        <button type="button" className="video-export-quick-button" onClick={onExport} title="Exportar este projeto de vídeo"><Icon name="download" /> Exportar</button>
        <VideoAudioControls master={timeline.videoAudio} selectedClip={selectedVideoClip} clipName={timeline.videoAssets?.find((asset) => asset.id === selectedVideoClip?.assetId)?.name} locked={isLocked('video')} onChangeMaster={onChangeVideoAudio} onChangeClip={onUpdateVideoClip} onBeginEdit={onBeginAudioEdit} />
        <button type="button" className={`video-transition-toggle${characterAnimationsEnabled ? ' active' : ''}`} aria-pressed={characterAnimationsEnabled} onClick={() => onSetCharacterAnimationsEnabled(!characterAnimationsEnabled)} title={characterAnimationsEnabled ? 'Desativar animação entre poses, expressões e boca durante falas' : 'Ativar animação entre poses, expressões e boca durante falas'}><span aria-hidden="true">⇄</span> Animações {characterAnimationsEnabled ? 'ligadas' : 'desligadas'}</button>
        <label className="video-jump-control">Ir para<input aria-label="Ir para segundo da timeline" type="number" min={0} max={Math.floor(duration / 60)} value={Math.floor(playheadFrame / 60)} onChange={(event) => onSeek(Math.min(duration, Math.max(0, Number(event.currentTarget.value) || 0) * 60))} />s</label>
        <button type="button" onClick={() => onChangeDuration(Math.max(60, duration - 3600))} disabled={duration <= 3600 || timeline.characterKeys.some((key) => key.frame >= duration - 3600) || timeline.textClips.some((clip) => clip.endFrame > duration - 3600) || (timeline.videoClips ?? []).some((clip) => clip.endFrame > duration - 3600)} title="Reduzir duração em um minuto">− 1 min</button>
        <button type="button" onClick={() => onChangeDuration(duration + 3600)} title="Aumentar duração em um minuto">+ 1 min</button>
        <button type="button" className="video-fit-duration-button" onClick={() => onChangeDuration(fitVideoTimelineDuration(timeline))} title="Ajustar o fim do projeto ao último item da timeline (mínimo 5 segundos)">Ajustar duração</button>
        <button type="button" onClick={fitTimeline}>Fit</button>
        <button type="button" className="video-zoom-button" onClick={() => setZoom(pixelsPerSecond / 1.25)} title="Diminuir zoom">−</button>
        <label className="video-zoom-control"><span>{pixelsPerSecond.toFixed(0)} px/s</span><input aria-label="Zoom horizontal da timeline" type="range" min={1} max={120} step={1} value={pixelsPerSecond} onChange={(event) => setZoom(Number(event.currentTarget.value))} /></label>
        <button type="button" className="video-zoom-button" onClick={() => setZoom(pixelsPerSecond * 1.25)} title="Aumentar zoom">+</button>
      </div>
      <div className="video-timeline-resize" role="separator" aria-label="Redimensionar altura da timeline" aria-orientation="horizontal" aria-valuemin={150} aria-valuemax={Math.max(220, Math.floor(window.innerHeight * 0.65))} aria-valuenow={height} tabIndex={0}
        onKeyDown={(event) => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); const nextHeight = Math.max(150, Math.min(Math.floor(window.innerHeight * 0.65), height + (event.key === 'ArrowUp' ? 24 : -24))); onResize(nextHeight); onChangeTimelineView({ height: nextHeight }) } }}
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
            {Array.from({ length: Math.max(0, lastVisibleTick - firstVisibleTick + 1) }, (_, index) => (firstVisibleTick + index) * tickSeconds).map((second) => <span key={second} style={{ left: `${second * pixelsPerSecond}px` }}>{`${String(Math.floor(second / 60)).padStart(2, '0')}:${String(second % 60).padStart(2, '0')}`}</span>)}
            <input aria-label="Mover playhead" type="range" min={0} max={duration} step={1} value={Math.min(playheadFrame, duration)} onChange={(event) => onSeek(Number(event.currentTarget.value))} />
          </div>
        </div>
        <div className="video-timeline-tracks">
          {trackSettings.video?.visible !== false && <div className={`video-track-row video-master-track${trackSettings.video?.collapsed ? ' collapsed' : ''}`}>
            <span className="video-track-label"><i className="video-track-badge video">V</i><span>{trackSettings.video?.label ?? 'Vídeo'}</span></span>
            <div className="video-track-lane video-master-lane" style={{ backgroundSize: `${tickSeconds * pixelsPerSecond}px 100%` }} aria-label="Faixa de vídeo do projeto" onClick={seekToLanePosition}>
              {clipsForFrameRange(timelineIndex.videoClips, timelineIndex.videoClipPrefixMaxEnd, visibleStartFrame, visibleEndFrame).map((savedClip) => {
                const clip = previewVideoClip?.id === savedClip.id ? previewVideoClip : savedClip
                const asset = timeline.videoAssets?.find((item) => item.id === clip.assetId)
                const selected = selection?.kind === 'video' && selection.clipId === clip.id
                return <button key={clip.id} type="button" className={`video-master-span${selected ? ' selected' : ''}${isLocked('video') ? ' locked' : ''}`} style={{ left: `${clip.startFrame / 60 * pixelsPerSecond}px`, width: `${Math.max(3, (clip.endFrame - clip.startFrame) / 60 * pixelsPerSecond)}px`, ...(videoWaveforms[clip.assetId] ? { backgroundImage: `linear-gradient(#262d3ddd,#262d3ddd),url("${videoWaveforms[clip.assetId]}")`, backgroundSize: '100% 100%', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' } : {}) }} title={`${asset?.name ?? 'Vídeo'} · ${formatTime(clip.endFrame - clip.startFrame)}`}
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
              {timeline.saveMarkers.filter((marker) => marker.frame >= visibleStartFrame && marker.frame <= visibleEndFrame && clips.some(({ element }) => marker.affectedTrackIds?.includes(element.id))).map((marker) => <i className="video-saved-marker" key={marker.id} style={{ left: `${marker.frame / 60 * pixelsPerSecond}px` }} title={`Frame salvo · ${formatTime(marker.frame)}`} />)}
              {clips.filter(({ clip }) => clip.endFrame >= visibleStartFrame && clip.startFrame <= visibleEndFrame).map(({ element, clip }) => {
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
          {characterTrackRows.map(({ character, keys, name, color, visibleStates }) => {
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
                  return <button type="button" key={boundaryDragRef.current?.target.elementId === character.id && boundaryDragRef.current.latestStart === state.start && boundaryDragRef.current.latestEnd === state.end ? boundaryDragRef.current.renderId : state.renderId} data-segment-id={state.renderId} className={`video-character-span ${selected ? 'selected' : ''}`} style={{ left: `${state.start / 60 * pixelsPerSecond}px`, width: `${Math.max(3, (state.end - state.start) / 60 * pixelsPerSecond)}px`, background: `linear-gradient(180deg, ${color} 0%, ${color}cc 48%, ${color}8c 100%)` }} onPointerDown={(event) => beginCharacterSpanBoundaryDrag(event, character.id, state.start, state.end)} onPointerMove={moveBoundaryDrag} onPointerUp={finishBoundaryDrag} onPointerCancel={finishBoundaryDrag} onClick={(event) => {
                    if (suppressClipClickRef.current) { event.preventDefault(); event.stopPropagation(); return }
                    const rect = event.currentTarget.getBoundingClientRect()
                    const ratio = rect.width > 0 ? Math.max(0, Math.min(0.999999, (event.clientX - rect.left) / rect.width)) : 0
                    const frame = Math.min(state.end - 1, state.start + Math.floor((state.end - state.start) * ratio))
                    selectOrSeekCharacterTrack(character.id, frame)
                  }} title={`${name} · ${state.label} · arraste as bordas para ajustar a duração`}>
                    <span className="video-character-resize-edge start" data-boundary-edge="start" aria-label="Ajustar início do bloco" />
                    <span className="video-character-span-label">{state.label}</span>
                    <span className="video-character-resize-edge end" data-boundary-edge="end" aria-label="Ajustar fim do bloco" />
                  </button>
                })}
                {(timelineIndex.saveMarkersByTrack.get(character.id) ?? []).filter((marker) => marker.frame >= visibleStartFrame && marker.frame <= visibleEndFrame).map((marker) => <i className="video-saved-marker" key={marker.id} style={{ left: `${marker.frame / 60 * pixelsPerSecond}px` }} title={`Frame salvo · ${formatTime(marker.frame)}`} />)}
                {keys.map((key) => <i className="video-keyframe" key={key.id} style={{ left: `${key.frame / 60 * pixelsPerSecond}px` }} aria-hidden="true" />)}
                <i className="video-lane-playhead" style={{ left: `${playheadFrame / 60 * pixelsPerSecond}px` }} />
              </div>
            </div>
          })}
        </div>
      </div>
    </div>
  </section>
}
