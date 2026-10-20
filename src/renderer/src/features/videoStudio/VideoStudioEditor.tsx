import { findTimelineBlockStart, resizeTimelineBlock, timelineBlockOverlaps, type TimelineBlockTarget } from '../../../../shared/videoTimelineEditing'
import './VideoStudioEditor.css'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { buildStudioExpressionAppearance, buildStudioExpressionTransforms, resolveStudioExpressionBase, studioExpressionCollection } from '../studio/expressionTransforms'
import { Icon } from '../../ui/components/Icon'
import { CharacterPortrait } from '../../ui/components/CharacterPortrait'
import { resolveStudioTalkMouthId, videoCharacterTrackColor } from '../../../../shared/studio'
import { fitStudioCharacterToStage } from '../../../../shared/studioCharacterGeometry'
import type { StudioAsset, StudioDocument, StudioElement, StudioFaceMode, StudioFaceTransform, StudioFaceTransforms, VideoAudioSettings, VideoMediaClip, VideoStudioCardSummary, VideoTimelineDocument } from '../../../../shared/studio'
import { automaticBlinkFrameFor, resolveVideoFrameSelection } from '../../../../shared/videoFrame'
import { defaultVideoTransform, editVideoMediaClip, isValidVideoMediaClip, splitVideoMediaClip as splitMediaClip } from '../../../../shared/videoMedia'
import { videoStageCssTransform } from '../../../../shared/videoStageGeometry'
import { faceRenderGeometry, trimTransparentImage, type TrimmedImage } from './characterGeometry'
import { useCharacterTransitions } from './useCharacterTransitions'
import { PreviewTransport } from './PreviewTransport'
import { usePreviewFullscreen } from './usePreviewFullscreen'
import { EditHistory, equalHistoryValue } from './editHistory'
import { VideoLibraryModal } from './VideoLibraryModal'
import { BackgroundLibraryModal } from './BackgroundLibraryModal'
import { VideoStudioClipPreview } from './VideoClipPreview'
import { isValidVideoAudioSettings } from '../../../../shared/videoAudio'
import { VideoTimeline, videoTimelineFor } from './VideoTimeline'
import { DEFAULT_VIDEO_DURATION_FRAMES } from '../../../../shared/videoTimelineDuration'
import { captureVideoCharacter, characterStateAt, normalizeVideoCharacterTransforms, restoreVideoTracks, synchronizeVideoCharacterTransforms, videoCharacterStateEquals, videoCharacterStageElement } from './characterTrack'
import type { CustomizerCharacter } from '../../../../shared/customizer'
import type { CustomizerFaceAppearance } from '../../../../shared/customizer'
import type { FaceCatalogItem, FaceCatalogItemSummary, FaceExpressionCollection, FaceExpressionEffects, FaceExpressionPreset, FaceExpressionPresetSummary, FaceSheetKind, FabricatorPoseSummary } from '../../../../shared/fabricator'
import type { VideoExportProgress, VideoExportRecoveryRecord } from '../../../../shared/videoExportRuntime'
import type { RenderVariant } from '../../../../shared/videoSceneIR'
import { createVideoCharacterRenderAssetSnapshot } from '../../../../shared/videoCharacterRenderAssets'
import { captureVideoCharacterRenderAssets } from './videoCharacterAssetCapture'
import { VideoStudioDomElement } from './VideoStudioDomElement'

type StudioCard = StudioDocument
type StudioSnapshot = Pick<StudioDocument, 'backgroundColor' | 'backgroundAssetId' | 'backgroundX' | 'backgroundY' | 'backgroundWidth' | 'backgroundHeight' | 'backgroundRotation' | 'assets' | 'elements' | 'videoTimeline'>
type Tool = 'background' | 'objects' | null
type DragState = { id: string; pointerId: number; startX: number; startY: number; originalX: number; originalY: number; width: number; height: number }
type AutomaticMouthFrame = { dataUrl: string; geometry: Pick<StudioElement, 'width' | 'height' | 'characterCanvasWidth'> }
type AutomaticMouthAnimation = { frames: AutomaticMouthFrame[]; cycleFrames: number; speechStartFrame: number }

const STUDIO_FACE_RENDER_VERSION = 6
const studioColor = (number: number) => `hsl(${(number * 137.508) % 360} 45% 78%)`

function captureVideoPoster(videoId: string, sourceFrame = 0): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.preload = 'auto'
    let finished = false
    const timeout = window.setTimeout(() => finish(null), 12000)
    const cleanup = () => {
      window.clearTimeout(timeout)
      video.onloadeddata = null
      video.onseeked = null
      video.onerror = null
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
    const finish = (poster: string | null) => {
      if (finished) return
      finished = true
      cleanup()
      resolve(poster)
    }
    const capture = () => {
      try {
        if (!video.videoWidth || !video.videoHeight) return finish(null)
        const width = 320, height = 180
        const canvas = document.createElement('canvas')
        canvas.width = width; canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) return finish(null)
        const sourceRatio = video.videoWidth / video.videoHeight
        const targetRatio = width / height
        const sourceWidth = sourceRatio > targetRatio ? video.videoHeight * targetRatio : video.videoWidth
        const sourceHeight = sourceRatio > targetRatio ? video.videoHeight : video.videoWidth / targetRatio
        context.drawImage(video, (video.videoWidth - sourceWidth) / 2, (video.videoHeight - sourceHeight) / 2, sourceWidth, sourceHeight, 0, 0, width, height)
        finish(canvas.toDataURL('image/jpeg', 0.78))
      } catch { finish(null) }
    }
    video.onerror = () => finish(null)
    video.onseeked = capture
    video.onloadeddata = () => {
      const frameTime = Math.max(0, sourceFrame / 60)
      if (frameTime > 0 && Number.isFinite(video.duration) && frameTime < video.duration) {
        try { video.currentTime = frameTime } catch { capture() }
      } else capture()
    }
    video.src = `gacha-video://library/${videoId}`
    video.load()
  })
}

const defaultStudioEyeTransform: StudioFaceTransform = { x: 0, y: 0, width: 100, height: 100, rotation: 0 }
function studioFaceModeForElement(element: StudioElement | null, appearance: CustomizerFaceAppearance | undefined): StudioFaceMode {
  if (element?.activeFaceMode) return element.activeFaceMode
  if (appearance?.eyeState === 2) return 'blink'
  if (appearance?.mouthOpen) return 'talk'
  return 'idle'
}
const studioTools = [
  { id: 'background', label: 'Fundo', icon: 'frame' },
  { id: 'objects', label: 'Objetos', icon: 'sparkles' }
] as const

function fitElementToTrim(element: StudioElement, crop: TrimmedImage): StudioElement {
  const offsetX = ((crop.left + crop.width / 2) / crop.sourceWidth - 0.5) * element.width * (element.flipX ? -1 : 1)
  const offsetY = ((crop.top + crop.height / 2) / crop.sourceHeight - 0.5) * element.height
  const radians = element.rotation * Math.PI / 180
  const x = offsetX * Math.cos(radians) - offsetY * (9 / 16) * Math.sin(radians)
  const y = offsetX * (16 / 9) * Math.sin(radians) + offsetY * Math.cos(radians)
  return {
    ...element,
    x: element.x + x,
    y: element.y + y,
    width: element.width * crop.width / crop.sourceWidth,
    height: element.height * crop.height / crop.sourceHeight
  }
}

function snapshot(studio: StudioDocument): StudioSnapshot {
  return {
    backgroundColor: studio.backgroundColor,
    backgroundAssetId: studio.backgroundAssetId,
    backgroundX: studio.backgroundX,
    backgroundY: studio.backgroundY,
    backgroundWidth: studio.backgroundWidth,
    backgroundHeight: studio.backgroundHeight,
    backgroundRotation: studio.backgroundRotation,
    assets: studio.assets,
    elements: studio.elements,
    videoTimeline: studio.videoTimeline
  }
}

function equalStudioSnapshot(left: StudioSnapshot, right: StudioSnapshot): boolean {
  const editorialTimeline = (timeline: StudioSnapshot['videoTimeline']) => {
    if (!timeline) return timeline
    const { playheadFrame: _frame, playing: _playing, ...content } = timeline
    return content
  }
  return equalHistoryValue({ ...left, videoTimeline: editorialTimeline(left.videoTimeline) }, { ...right, videoTimeline: editorialTimeline(right.videoTimeline) })
}

function withSnapshot(studio: StudioDocument, next: StudioSnapshot): StudioDocument {
  return { ...studio, ...next, updatedAt: new Date().toISOString() }
}

function studioCharacterRenderKey(character: CustomizerCharacter): string {
  const { faceAppearance: _ignored, ...customization } = character.customization
  return JSON.stringify({ id: character.id, customization })
}


function makeElement(kind: StudioElement['kind'], zIndex: number): StudioElement {
  return {
    id: crypto.randomUUID(), kind, text: kind === 'narrator' ? 'Texto do narrador' : 'Digite aqui',
    x: 0, y: 0, width: kind === 'narrator' ? 32 : 28, height: kind === 'narrator' ? 12 : 16,
    rotation: 0, zIndex
  }
}

type VideoStudioPersistence = {
  list: () => Promise<VideoStudioCardSummary[]>
  load: (id: string) => Promise<StudioDocument | null>
  save: (studio: StudioDocument) => Promise<void>
  delete: (id: string) => Promise<void>
  getFolder: () => Promise<string>
  importImage: (category: StudioAsset['category']) => Promise<StudioAsset | null>
}

function videoStudioPersistence(): VideoStudioPersistence {
  const desktop = window.desktop
  return {
    list: desktop.listVideoStudios,
    load: desktop.loadVideoStudio,
    save: desktop.saveVideoStudio,
    delete: desktop.deleteVideoStudio,
    getFolder: desktop.getVideoStudioFolder,
    importImage: desktop.importVideoStudioImage
  }
}

function studioCardFromDocument(studio: StudioDocument): VideoStudioCardSummary {
  return {
    id: studio.id,
    title: studio.title,
    color: studio.color,
    createdAt: studio.createdAt,
    updatedAt: studio.updatedAt,
    ...(studio.videoTimeline?.coverDataUrl ? { coverDataUrl: studio.videoTimeline.coverDataUrl } : {})
  }
}

/** Owns Video Studio's editor state and layout; never mount the normal Studio editor here. */
export function VideoStudioEditor({ onEditorActiveChange }: { onEditorActiveChange?: (active: boolean) => void }) {
  const isVideoWorkspace = true
  const workspaceTitle = 'Video Studio'
  const workspacePlural = 'Video Studios'
  const [videoTimelineHeight, setVideoTimelineHeight] = useState(218)
  const videoEditorStyle = isVideoWorkspace ? { '--video-timeline-height': `${videoTimelineHeight}px` } as CSSProperties : undefined
  const persistence = useMemo(videoStudioPersistence, [])
  const [studios, setStudios] = useState<StudioCard[]>([])
  const [studioCards, setStudioCards] = useState<VideoStudioCardSummary[]>([])
  const [openingStudioId, setOpeningStudioId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportVariant, setExportVariant] = useState<RenderVariant>('animated')
  const [exportPreparing, setExportPreparing] = useState(false)
  const [activeExportJobId, setActiveExportJobId] = useState<string | null>(null)
  const [exportProgress, setExportProgress] = useState<VideoExportProgress | null>(null)
  const [exportRecoveries, setExportRecoveries] = useState<VideoExportRecoveryRecord[]>([])
  const [exportRecoveryBusy, setExportRecoveryBusy] = useState<string | null>(null)
  const [availableCharacters, setAvailableCharacters] = useState<CustomizerCharacter[]>([])
  const [assetLibraryRevision, setAssetLibraryRevision] = useState(0)
  const appliedAssetRevisionRef = useRef(new Map<string, number>())
  const [normalizedStudioVersion, setNormalizedStudioVersion] = useState(0)
  const [castPickerOpen, setCastPickerOpen] = useState(false)
  const [castSelection, setCastSelection] = useState<string[]>([])
  const [savingCast, setSavingCast] = useState(false)
  const [videoLibraryOpen, setVideoLibraryOpen] = useState(false)
  const [backgroundLibraryOpen, setBackgroundLibraryOpen] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<'editor' | 'custom'>('editor')
  const [inspectorCustomView, setInspectorCustomView] = useState<'face' | 'presets'>('face')
  const characterInspectorViewRef = useRef<{ tab: 'editor' | 'custom'; customView: 'face' | 'presets' }>({ tab: 'editor', customView: 'face' })
  const [studioPresetCategory, setStudioPresetCategory] = useState<'pose' | 'expression'>('expression')
  const [studioExpressionCollections, setStudioExpressionCollections] = useState<FaceExpressionCollection[]>([])
  const [studioExpressionPresets, setStudioExpressionPresets] = useState<FaceExpressionPresetSummary[]>([])
  const [sceneExpressionPresetVersions, setSceneExpressionPresetVersions] = useState<Record<string, string>>({})
  const [studioExpressionCollectionMenuOpen, setStudioExpressionCollectionMenuOpen] = useState(false)
  const [studioExpressionLoading, setStudioExpressionLoading] = useState(false)
  const [studioExpressionBusy, setStudioExpressionBusy] = useState(false)
  const [studioPoseSlots, setStudioPoseSlots] = useState<Array<NonNullable<FabricatorPoseSummary>>>([])
  const [studioPoseThumbnails, setStudioPoseThumbnails] = useState<Record<number, string>>({})
  const [studioPoseDimensions, setStudioPoseDimensions] = useState<Record<number, { width: number; height: number }>>({})
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [studioFaceCategory, setStudioFaceCategory] = useState<'eyes' | 'eyebrows' | 'nose' | 'mouth'>('eyes')
  const [studioFaceItems, setStudioFaceItems] = useState<FaceCatalogItemSummary[]>([])
  const [studioFaceDetails, setStudioFaceDetails] = useState<Record<string, FaceCatalogItem>>({})
  const [studioFaceLoading, setStudioFaceLoading] = useState(false)
  const [studioFaceBusy, setStudioFaceBusy] = useState(false)
  const [studioFolder, setStudioFolder] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeStudioId, setActiveStudioId] = useState<string | null>(null)
  const [activeTool, setActiveTool] = useState<Tool>(null)
  const { surfaceRef, fullView, enterFullView, exitFullView } = usePreviewFullscreen()
  const [saved, setSaved] = useState(true)
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [videoPlayheadFrame, setVideoPlayheadFrame] = useState(0)
  const [videoPlaying, setVideoPlaying] = useState(false)
  const [animationPreparing, setAnimationPreparing] = useState(false)
  const animationPlayRequestRef = useRef(0)
  const [automaticBlinkPreview, setAutomaticBlinkPreview] = useState<Record<string, { dataUrl: string; geometry: Pick<StudioElement, 'width' | 'height' | 'characterCanvasWidth'> }>>({})
  const [automaticMouthPreview, setAutomaticMouthPreview] = useState<Record<string, AutomaticMouthAnimation>>({})
  const [historyVersion, setHistoryVersion] = useState(0)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const sceneRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const videoPlaybackAnchorRef = useRef({ frame: 0, time: 0 })
  const videoInitialStatesRef = useRef<{ studioId: string; states: NonNullable<VideoTimelineDocument['characterBases']> } | null>(null)
  const editHistoryRef = useRef(new EditHistory<StudioSnapshot>(equalStudioSnapshot, 1000))
  const studioFaceTransformsRef = useRef<Record<string, StudioFaceTransforms>>({})
  const studioFaceRenderTimerRef = useRef<number | null>(null)
  const studioFaceRenderVersionRef = useRef(0)
  const studioFaceRenderPendingRef = useRef<{ studioId: string; elementId: string; assetId: string; character: CustomizerCharacter; transforms: StudioFaceTransforms } | null>(null)
  const studioFaceRenderRunningRef = useRef(false)
  const studioFaceRendererRef = useRef<{ key: string; render: (appearance?: CustomizerFaceAppearance, transforms?: StudioFaceTransforms, effects?: FaceExpressionEffects, mode?: StudioFaceMode) => Promise<{ dataUrl: string; width: number; height: number }> } | null>(null)
  const automaticBlinkFrameCacheRef = useRef<{ signature: string; frames: Array<{ elementId: string; dataUrl: string; geometry: Pick<StudioElement, 'width' | 'height' | 'characterCanvasWidth'> }> } | null>(null)
  const automaticMouthFrameCacheRef = useRef(new Map<string, Record<string, AutomaticMouthAnimation>>())
  const saveGenerationRef = useRef(0)
  const expressionSaveSignatureRef = useRef<{ studioId: string; value: string } | null>(null)
  const normalizedStudioIdsRef = useRef(new Set<string>())
  const nextStudioNumber = useRef(1)
  const selectedStudio = studioCards.find((studio) => studio.id === selectedId) ?? null
  const activeStudio = studios.find((studio) => studio.id === activeStudioId) ?? null
  const videoPreviewFrame = Math.min(videoPlayheadFrame, Math.max(0, (activeStudio?.videoTimeline?.durationFrames ?? 1) - 1))
  const videoFrameSelection = isVideoWorkspace && activeStudio ? resolveVideoFrameSelection(videoTimelineFor(activeStudio), videoPreviewFrame) : null
  useEffect(() => {
    onEditorActiveChange?.(isVideoWorkspace && Boolean(activeStudio))
  }, [isVideoWorkspace, activeStudioId, Boolean(activeStudio), onEditorActiveChange])
  const characterAnimation = useCharacterTransitions(activeStudio, availableCharacters, videoPreviewFrame, videoPlaying, setError, activeStudio ? videoTimelineFor(activeStudio).animateCharacterTransitions !== false : true)
  const videoPlaybackStates = isVideoWorkspace && videoPlaying && activeStudio
    ? new Map(activeStudio.elements.filter((element) => element.kind === 'character').map((element) => [element.id, characterStateAt(videoTimelineFor(activeStudio), element.id, videoPlayheadFrame)]))
    : null
  const selectedVideoClip = selectedElementId?.startsWith('video:') ? activeStudio?.videoTimeline?.videoClips?.find((clip) => `video:${clip.id}` === selectedElementId) : undefined
  const selectedElement = activeStudio?.elements.find((element) => element.id === selectedElementId) ?? null
  const selectedVideoTrackLocked = Boolean(isVideoWorkspace && activeStudio && selectedElement && videoTimelineFor(activeStudio).trackSettings?.[selectedElement.kind === 'character' ? selectedElement.id : selectedElement.kind]?.locked)
  const selectedStudioCharacter = selectedElement?.kind === 'character' ? availableCharacters.find((character) => character.id === selectedElement.characterId) ?? null : null
  const selectedStudioExpressionCollectionId = studioExpressionCollection(selectedElement, studioExpressionPresets)
  const selectedStudioCharacterModelSlot = selectedStudioCharacter ? selectedStudioCharacter.customization.modelSlot ?? 1 : null
  const selectedStudioPoseSlot = selectedElement?.kind === 'character' ? selectedElement.poseSlot === undefined ? selectedStudioCharacter?.customization.poseSlot ?? null : selectedElement.poseSlot : null
  const selectedStudioFaceAppearance = selectedElement?.kind === 'character'
    ? selectedElement.faceAppearance ?? selectedStudioCharacter?.customization.faceAppearance
    : undefined
  const selectedStudioFaceMode = selectedElement?.kind === 'character' ? studioFaceModeForElement(selectedElement, selectedStudioFaceAppearance) : 'idle'
  const selectedStudioOpenMouthId = selectedStudioCharacterModelSlot === null
    ? undefined
    : resolveStudioTalkMouthId(selectedStudioFaceAppearance, studioFaceItems.filter((item) => item.modelSlot === selectedStudioCharacterModelSlot))
  const selectedStudioOpenMouth = selectedStudioOpenMouthId && selectedStudioCharacterModelSlot !== null
    ? studioFaceDetails[`${selectedStudioCharacterModelSlot}:${selectedStudioOpenMouthId}`]
    : undefined
  const selectedStudioTalkAvailable = Boolean(selectedStudioOpenMouth?.pieces.some((piece) => piece.sheet === 'mouth-open' && piece.index === selectedStudioFaceAppearance?.expressionIndex))
  const selectedBackgroundAsset = activeStudio?.assets.find((asset) => asset.id === activeStudio.backgroundAssetId) ?? null
  const stageCharacters = activeStudio?.elements.filter((element) => element.kind === 'character') ?? []
  const automaticBlinkTargets = isVideoWorkspace && videoPlaying && videoPlaybackStates
    ? stageCharacters.flatMap((element) => {
        const playbackState = videoPlaybackStates.get(element.id)
        return playbackState ? [playbackState.element] : []
      })
    : []
  const automaticBlinkSignature = JSON.stringify({
    characters: automaticBlinkTargets.map((element) => {
      const character = availableCharacters.find((item) => item.id === element.characterId)
      return [element.id, element.characterId, character?.updatedAt, element.poseSlot, element.faceAppearance, element.faceTransforms, element.activeExpressionEffects, element.activeFaceMode]
    }),
    renderer: STUDIO_FACE_RENDER_VERSION
  })
  const automaticMouthModes = new Map<string, 'talk' | 'idle'>()
  const automaticSpeechStartFrames = new Map<string, number>()
  if (isVideoWorkspace && activeStudio) {
    const timeline = videoTimelineFor(activeStudio)
    for (const clip of timeline.textClips) {
      if (clip.startFrame > videoPreviewFrame || videoPreviewFrame >= clip.endFrame) continue
      const balloon = clip.state ?? activeStudio.elements.find((element) => element.id === clip.elementId)
      const speakerId = balloon?.speakerCharacterId
      if (!speakerId) continue
      if (clip.kind === 'speech') {
        automaticMouthModes.set(speakerId, 'talk')
        const previousStart = automaticSpeechStartFrames.get(speakerId)
        automaticSpeechStartFrames.set(speakerId, previousStart === undefined ? clip.startFrame : Math.min(previousStart, clip.startFrame))
      }
      else if (automaticMouthModes.get(speakerId) !== 'talk') automaticMouthModes.set(speakerId, 'idle')
    }
  }
  const automaticMouthTargets = isVideoWorkspace && activeStudio
    ? stageCharacters.flatMap((element) => {
        const mode = automaticMouthModes.get(element.id)
        if (!mode || characterAnimation.samples.has(element.id)) return []
        const state = characterStateAt(videoTimelineFor(activeStudio), element.id, videoPreviewFrame)
        const current = videoPlaybackStates?.get(element.id)?.element ?? state?.element ?? element
        return [{ element: current, mode, speechStartFrame: automaticSpeechStartFrames.get(element.id) ?? videoPreviewFrame }]
      })
    : []
  const animateMouthDuringSpeech = isVideoWorkspace && activeStudio?.videoTimeline?.animateCharacterTransitions !== false
  const automaticMouthSignature = JSON.stringify({
    animate: animateMouthDuringSpeech,
    animationVersion: 2,
    mouthAssets: studioFaceItems.map((item) => `${item.modelSlot}:${item.id}`),
    targets: automaticMouthTargets.map(({ element, mode, speechStartFrame }) => {
      const character = availableCharacters.find((item) => item.id === element.characterId)
      return [element.id, mode, speechStartFrame, character?.updatedAt, element.poseSlot, element.faceAppearance, element.faceTransforms, element.activeExpressionEffects, element.activeExpressionPresetId, element.activeExpressionPresetUpdatedAt]
    }),
    renderer: STUDIO_FACE_RENDER_VERSION
  })
  useEffect(() => {
    setAutomaticBlinkPreview({})
    if (!activeStudio || !isVideoWorkspace || !videoPlaying || !automaticBlinkTargets.length) return
    let cancelled = false
    const renderBlinkFrames = async () => {
      try {
        let frames = automaticBlinkFrameCacheRef.current?.signature === automaticBlinkSignature
          ? automaticBlinkFrameCacheRef.current.frames
          : null
        if (!frames) {
          const { renderSavedCharacter } = await import('../customizer/CustomizerPage')
          const stageWidth = sceneRef.current?.clientWidth ?? 1000
          const stageHeight = sceneRef.current?.clientHeight ?? 562
          frames = []
          for (const element of automaticBlinkTargets) {
            const character = availableCharacters.find((item) => item.id === element.characterId)
            const appearance = element.faceAppearance ?? character?.customization.faceAppearance
            if (!character || !appearance || studioFaceModeForElement(element, appearance) !== 'idle') continue
            try {
              const characterCopy: CustomizerCharacter = {
                ...character,
                customization: {
                  ...character.customization,
                  poseSlot: element.poseSlot === undefined ? character.customization.poseSlot : element.poseSlot,
                  faceAppearance: appearance
                }
              }
              const rendered = await renderSavedCharacter(characterCopy, element.faceTransforms, element.activeExpressionEffects, 'blink')
              const crop = await trimTransparentImage(rendered.dataUrl)
              frames.push({
                elementId: element.id,
                dataUrl: crop?.dataUrl ?? rendered.dataUrl,
                geometry: faceRenderGeometry(element, rendered, crop, stageWidth, stageHeight)
              })
            } catch {
              // Characters without a matching closed-eye asset keep their normal preview.
            }
          }
          if (cancelled) return
          automaticBlinkFrameCacheRef.current = { signature: automaticBlinkSignature, frames }
        }
        if (cancelled || !frames.length) return
      } catch {
          // Auto blink is an optional playback effect and must not interrupt the video preview.
      }
    }
    void renderBlinkFrames()
    return () => {
      cancelled = true
      setAutomaticBlinkPreview({})
    }
  }, [activeStudio?.id, automaticBlinkSignature, availableCharacters, isVideoWorkspace, videoPlaying])
  useEffect(() => {
    if (!isVideoWorkspace || !videoPlaying || automaticBlinkFrameCacheRef.current?.signature !== automaticBlinkSignature) {
      setAutomaticBlinkPreview({})
      return
    }
    const frames = automaticBlinkFrameCacheRef.current.frames
    const active = frames.find((item) => automaticBlinkFrameFor(videoPreviewFrame, item.elementId, 60))
    setAutomaticBlinkPreview(active ? { [active.elementId]: { dataUrl: active.dataUrl, geometry: active.geometry } } : {})
  }, [automaticBlinkSignature, isVideoWorkspace, videoPlaying, videoPreviewFrame])
  useEffect(() => {
    if (!activeStudio || !isVideoWorkspace || !automaticMouthTargets.length) {
      setAutomaticMouthPreview({})
      return
    }
    const cached = automaticMouthFrameCacheRef.current.get(automaticMouthSignature)
    if (cached) {
      setAutomaticMouthPreview(cached)
      return
    }
    setAutomaticMouthPreview({})
    let cancelled = false
    const renderAutomaticMouths = async () => {
      const renderedStates: Record<string, AutomaticMouthAnimation> = {}
      const { renderSavedCharacter } = await import('../customizer/CustomizerPage')
      const stageWidth = sceneRef.current?.clientWidth ?? 1000
      const stageHeight = sceneRef.current?.clientHeight ?? 562
      for (const { element, mode, speechStartFrame } of automaticMouthTargets) {
        const character = availableCharacters.find((item) => item.id === element.characterId)
        const appearance = element.faceAppearance ?? character?.customization.faceAppearance
        if (!character || !appearance) continue
        try {
          const characterCopy: CustomizerCharacter = {
            ...character,
            customization: {
              ...character.customization,
              poseSlot: element.poseSlot === undefined ? character.customization.poseSlot : element.poseSlot,
              faceAppearance: appearance
            }
          }
          const mouthScaleFrames = mode === 'talk' && animateMouthDuringSpeech
            ? [
                { width: 1, height: 1 },
                { width: 1.14, height: 1 },
                { width: 1.14, height: 1.12 },
                { width: 1.28, height: 1.12 },
                { width: 1.14, height: 1.12 },
                { width: 1.14, height: 1 },
              ]
            : [{ width: 1, height: 1 }]
          const modelSlot = characterCopy.customization.modelSlot ?? 1
          const openMouthId = resolveStudioTalkMouthId(appearance, studioFaceItems.filter((item) => item.modelSlot === modelSlot))
          const closedMouthId = appearance.mouthClosedCatalogId
          const savedTransforms = element.faceTransforms ?? {}
          const mouthTransform = savedTransforms.mouth
            ?? (closedMouthId ? savedTransforms[`mouth-closed:${closedMouthId}`] : undefined)
            ?? (openMouthId ? savedTransforms[`mouth-open:${openMouthId}`] : undefined)
            ?? savedTransforms['mouth-open']
            ?? defaultStudioEyeTransform
          const frames: AutomaticMouthFrame[] = []
          let geometry: AutomaticMouthFrame['geometry'] | null = null
          for (const scale of mouthScaleFrames) {
            const transforms = scale.width === 1 && scale.height === 1
              ? savedTransforms
              : { ...savedTransforms, mouth: { ...mouthTransform, width: mouthTransform.width * scale.width, height: mouthTransform.height * scale.height } }
            const rendered = await renderSavedCharacter(characterCopy, transforms, element.activeExpressionEffects, mode)
            const crop = await trimTransparentImage(rendered.dataUrl)
            geometry ??= faceRenderGeometry(element, rendered, crop, stageWidth, stageHeight)
            frames.push({ dataUrl: crop?.dataUrl ?? rendered.dataUrl, geometry })
          }
          renderedStates[element.id] = {
            frames,
            cycleFrames: frames.length > 1 ? frames.length * 6 : 0,
            speechStartFrame,
          }
        } catch {
          // Keep the authored character face if this model has no matching open-mouth asset.
        }
      }
      if (!cancelled) {
        automaticMouthFrameCacheRef.current.set(automaticMouthSignature, renderedStates)
        while (automaticMouthFrameCacheRef.current.size > 2) {
          const oldest = automaticMouthFrameCacheRef.current.keys().next().value
          if (oldest === undefined) break
          automaticMouthFrameCacheRef.current.delete(oldest)
        }
        setAutomaticMouthPreview(renderedStates)
      }
    }
    void renderAutomaticMouths()
    return () => { cancelled = true }
  }, [activeStudio?.id, automaticMouthSignature, animateMouthDuringSpeech, availableCharacters, isVideoWorkspace, studioFaceItems])
  useEffect(() => {
    const clampHeight = () => setVideoTimelineHeight((height) => Math.min(height, Math.max(220, Math.floor(window.innerHeight * 0.65))))
    window.addEventListener('resize', clampHeight)
    return () => window.removeEventListener('resize', clampHeight)
  }, [])
  useEffect(() => {
    setVideoPlaying(false)
    animationPlayRequestRef.current += 1
    setAnimationPreparing(false)
    setVideoPlayheadFrame(activeStudio?.videoTimeline?.playheadFrame ?? 0)
    setVideoTimelineHeight(Math.max(150, Math.min(Math.floor(window.innerHeight * 0.65), activeStudio?.videoTimeline?.timelineHeight ?? 218)))
  }, [activeStudioId])
  useEffect(() => {
    if (!isVideoWorkspace || !activeStudio || !normalizedStudioIdsRef.current.has(activeStudio.id) || videoInitialStatesRef.current?.studioId === activeStudio.id) return
    const states: NonNullable<VideoTimelineDocument['characterBases']> = {}
    for (const element of activeStudio.elements) {
      const state = captureVideoCharacter(activeStudio, element)
      if (state) states[element.id] = state
    }
    videoInitialStatesRef.current = { studioId: activeStudio.id, states }
    if (activeStudio.videoTimeline?.characterBases || activeStudio.videoTimeline?.characterKeys.some((key) => key.state)) {
      setStudios((current) => current.map((studio) => studio.id === activeStudio.id ? restoreVideoTracks(studio, activeStudio.videoTimeline?.playheadFrame ?? 0) : studio))
    }
  }, [isVideoWorkspace, activeStudio?.id, normalizedStudioVersion])
  useEffect(() => {
    if (!isVideoWorkspace || !videoPlaying || !activeStudio) return
    const duration = videoTimelineFor(activeStudio).durationFrames
    videoPlaybackAnchorRef.current = { frame: videoPlayheadFrame, time: performance.now() }
    let raf = 0
    const tick = (now: number) => {
      const anchor = videoPlaybackAnchorRef.current
      const next = Math.min(duration, anchor.frame + Math.floor((now - anchor.time) * 60 / 1000))
      setVideoPlayheadFrame(next)
      if (next >= duration) {
        setVideoPlaying(false)
        setStudios((current) => current.map((studio) => studio.id === activeStudioId
          ? restoreVideoTracks({ ...studio, videoTimeline: { ...videoTimelineFor(studio), playheadFrame: duration } }, Math.max(0, duration - 1))
          : studio))
      }
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isVideoWorkspace, videoPlaying, activeStudioId, activeStudio?.videoTimeline?.durationFrames])
  useEffect(() => {
    const pauseWhenHidden = () => { if (document.visibilityState === 'hidden') setVideoPlaying(false) }
    document.addEventListener('visibilitychange', pauseWhenHidden)
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden)
  }, [])
  const rememberCharacterInspectorView = (tab: 'editor' | 'custom', customView: 'face' | 'presets' = inspectorCustomView) => {
    if (selectedElement?.kind === 'character') characterInspectorViewRef.current = { tab, customView }
  }
  const restoreCharacterInspectorView = () => {
    setInspectorTab(characterInspectorViewRef.current.tab)
    setInspectorCustomView(characterInspectorViewRef.current.customView)
  }

  useEffect(() => {
    if (selectedElement?.kind === 'character') studioFaceTransformsRef.current[selectedElement.id] = selectedElement.faceTransforms ?? {}
  }, [activeStudioId, selectedElementId, selectedElement?.faceTransforms])

  useEffect(() => { setStudioExpressionCollectionMenuOpen(false) }, [activeStudioId, selectedElementId])

  useEffect(() => {
    let cancelled = false
    setStudioExpressionCollectionMenuOpen(false)
    if (selectedStudioCharacterModelSlot === null) {
      setStudioExpressionCollections([])
      setStudioExpressionPresets([])
      setStudioExpressionLoading(false)
      return () => { cancelled = true }
    }
    const refreshExpressionLibrary = () => {
      setStudioExpressionLoading(true)
      void Promise.all([
        window.desktop.listFaceExpressionCollections(selectedStudioCharacterModelSlot),
        window.desktop.listFaceExpressionPresets(selectedStudioCharacterModelSlot)
      ]).then(([collections, presets]) => {
        if (cancelled) return
        setStudioExpressionCollections(collections)
        setStudioExpressionPresets(presets)
      }).catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os presets de expressão.')
      }).finally(() => {
        if (!cancelled) setStudioExpressionLoading(false)
      })
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshExpressionLibrary()
    }
    refreshExpressionLibrary()
    window.addEventListener('focus', refreshExpressionLibrary)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      cancelled = true
      window.removeEventListener('focus', refreshExpressionLibrary)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [selectedStudioCharacterModelSlot])

  const activeScenePresetSignature = JSON.stringify(activeStudio?.elements
    .filter((element) => element.kind === 'character' && element.characterId && element.activeExpressionPresetId)
    .map((element) => [element.characterId, element.activeExpressionPresetId]) ?? [])

  useEffect(() => {
    if (!activeStudio || !activeScenePresetSignature) { setSceneExpressionPresetVersions({}); return }
    let cancelled = false
    const characters = new Map(availableCharacters.map((character) => [character.id, character]))
    const slots = Array.from(new Set(activeStudio.elements.flatMap((element) => {
      if (element.kind !== 'character' || !element.characterId || !element.activeExpressionPresetId) return []
      const character = characters.get(element.characterId)
      return character ? [character.customization.modelSlot ?? 1] : []
    })))
    if (!slots.length) { setSceneExpressionPresetVersions({}); return }
    const refresh = () => {
      void Promise.all(slots.map(async (modelSlot) => [modelSlot, await window.desktop.listFaceExpressionPresets(modelSlot)] as const))
        .then((results) => {
          if (cancelled) return
          const versions: Record<string, string> = {}
          for (const [modelSlot, presets] of results) for (const preset of presets) versions[`${modelSlot}:${preset.id}`] = preset.updatedAt
          setSceneExpressionPresetVersions(versions)
        }).catch((reason: unknown) => {
          if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar as revisões das expressões do Studio.')
        })
    }
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') refresh() }
    refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      cancelled = true
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [activeStudio?.id, activeScenePresetSignature, availableCharacters])

  useEffect(() => {
    let cancelled = false
    const startedAt = performance.now()
    void (async () => {
      try {
        const loaded = await persistence.list()
        const folder = await persistence.getFolder()
        if (cancelled) return
        if (cancelled) return
        setStudioCards(loaded)
        setStudioFolder(folder)
        console.info(`[Video Studio perf] lista: ${(performance.now() - startedAt).toFixed(1)} ms · ${loaded.length} cartões`)
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os Studios.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [isVideoWorkspace, persistence])

  useEffect(() => {
    if (!studios.length) return
    setStudioCards((current) => {
      const loaded = new Map(studios.map((studio) => [studio.id, studioCardFromDocument(studio)]))
      let changed = false
      const next = current.map((card) => {
        const updated = loaded.get(card.id)
        if (!updated) return card
        if (card.title === updated.title && card.color === updated.color && card.coverDataUrl === updated.coverDataUrl) return card
        changed = true
        return updated
      })
      return changed ? next : current
    })
  }, [studios])

  useEffect(() => {
    let cancelled = false
    let request = 0
    const refreshCharacters = () => {
      const currentRequest = ++request
      void window.desktop.listCustomizerCharacters().then((characters) => {
        if (!cancelled && currentRequest === request) setAvailableCharacters(characters)
      }).catch((reason: unknown) => {
        if (!cancelled && currentRequest === request) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o elenco de personagens.')
      })
    }
    const refreshVisibleCharacters = () => { if (!document.hidden) refreshCharacters() }
    const refreshAfterAssetSave = () => { setAssetLibraryRevision((revision) => revision + 1); refreshCharacters() }
    refreshCharacters()
    window.addEventListener('focus', refreshCharacters)
    window.addEventListener('customizer:characters-updated', refreshCharacters)
    window.addEventListener('fabricator:assets-updated', refreshAfterAssetSave)
    document.addEventListener('visibilitychange', refreshVisibleCharacters)
    return () => {
      cancelled = true
      window.removeEventListener('focus', refreshCharacters)
      window.removeEventListener('customizer:characters-updated', refreshCharacters)
      window.removeEventListener('fabricator:assets-updated', refreshAfterAssetSave)
      document.removeEventListener('visibilitychange', refreshVisibleCharacters)
    }
  }, [])

  useEffect(() => {
    const modelSlot = selectedStudioCharacterModelSlot
    if (modelSlot === null) { setStudioFaceItems([]); return }
    let cancelled = false
    setStudioFaceLoading(true)
    void window.desktop.listFaceCatalog(modelSlot).then(async (summaries) => {
      if (cancelled) return
      setStudioFaceItems(summaries)
      const items = await Promise.all(summaries.map(async (summary) => ({ key: `${summary.modelSlot}:${summary.id}`, item: await window.desktop.loadFaceCatalogItem(summary.modelSlot, summary.id) })))
      if (cancelled) return
      setStudioFaceDetails((current) => {
        const next = { ...current }
        for (const { key, item } of items) if (item) next[key] = item
        return next
      })
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o catálogo de rosto.')
    }).finally(() => { if (!cancelled) setStudioFaceLoading(false) })
    return () => { cancelled = true }
  }, [selectedStudioCharacterModelSlot])

  useEffect(() => {
    if (!studioPoseSlots.length) { setStudioPoseThumbnails({}); setStudioPoseDimensions({}); return }
    let cancelled = false
    void (async () => {
      const { renderArtwork } = await import('../customizer/CustomizerPage')
      const thumbnails = await Promise.all(studioPoseSlots.map(async (pose) => {
        try {
          const artwork = await window.desktop.loadFabricatorPose(pose.sourceModelSlot, pose.slot)
          if (!artwork) return null
          const thumbnail = await renderArtwork(artwork, 180)
          return thumbnail ? { slot: pose.slot, thumbnail, width: artwork.width, height: artwork.height } : null
        } catch { return null }
      }))
      if (!cancelled) {
        const ready = thumbnails.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        setStudioPoseThumbnails(Object.fromEntries(ready.map((entry) => [entry.slot, entry.thumbnail])))
        setStudioPoseDimensions(Object.fromEntries(ready.map((entry) => [entry.slot, { width: entry.width, height: entry.height }])))
      }
    })().catch(() => { if (!cancelled) { setStudioPoseThumbnails({}); setStudioPoseDimensions({}) } })
    return () => { cancelled = true }
  }, [studioPoseSlots])

  useEffect(() => {
    const modelSlot = selectedStudioCharacterModelSlot
    if (modelSlot === null) { setStudioPoseSlots([]); return }
    let cancelled = false
    void window.desktop.listFabricatorPoseSlots(modelSlot).then((poses) => {
      if (!cancelled) setStudioPoseSlots(poses.filter((pose): pose is NonNullable<typeof pose> => Boolean(pose)))
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as poses do modelo.')
    })
    return () => { cancelled = true }
  }, [selectedStudioCharacterModelSlot])

  useEffect(() => {
    editHistoryRef.current.reset(activeStudioId)
    setCanUndo(false)
    setCanRedo(false)
    setHistoryVersion((value) => value + 1)
    setSelectedElementId(null)
    return () => { editHistoryRef.current.reset(null) }
  }, [activeStudioId])

  useEffect(() => {
    if (!activeStudio || !editHistoryRef.current.observe(activeStudio.id, snapshot(activeStudio))) return
    setCanUndo(editHistoryRef.current.canUndo)
    setCanRedo(editHistoryRef.current.canRedo)
    setHistoryVersion((value) => value + 1)
  }, [activeStudio])

  useEffect(() => {
    if (!activeStudio || normalizedStudioIdsRef.current.has(activeStudio.id)) return
    let cancelled = false
    const studioId = activeStudio.id
    void (async () => {
      const characterAssets = activeStudio.assets.filter((asset) => asset.category === 'character' && activeStudio.elements.some((element) => element.kind === 'character' && element.assetId === asset.id))
      const crops = await Promise.all(characterAssets.map(async (asset) => ({ assetId: asset.id, crop: await trimTransparentImage(asset.dataUrl) })))
      if (cancelled) return
      normalizedStudioIdsRef.current.add(studioId)
      setNormalizedStudioVersion((version) => version + 1)
      const byAsset = new Map(crops.filter((entry): entry is { assetId: string; crop: TrimmedImage } => entry.crop !== null).map((entry) => [entry.assetId, entry.crop]))
      if (!byAsset.size) return
      setStudios((current) => current.map((studio) => studio.id !== studioId ? studio : {
        ...studio,
        assets: studio.assets.map((asset) => {
          const crop = byAsset.get(asset.id)
          return crop ? { ...asset, dataUrl: crop.dataUrl, mimeType: 'image/png' } : asset
        }),
        elements: studio.elements.map((element) => {
          const crop = element.kind === 'character' && element.assetId ? byAsset.get(element.assetId) : undefined
          return crop ? fitElementToTrim(element, crop) : element
        }),
        updatedAt: new Date().toISOString()
      }))
      setSaved(false)
    })()
    return () => { cancelled = true }
  }, [activeStudio])

  useEffect(() => {
    if (!activeStudio || !normalizedStudioIdsRef.current.has(activeStudio.id) || !availableCharacters.length) return
    const characters = new Map(availableCharacters.map((character) => [character.id, character]))
    const pending = activeStudio.elements.flatMap((element) => {
      if (element.kind !== 'character' || !element.characterId || !element.assetId) return []
      const character = characters.get(element.characterId)
      const modelSlot = character?.customization.modelSlot ?? 1
      const latestPresetVersion = element.activeExpressionPresetId ? sceneExpressionPresetVersions[`${modelSlot}:${element.activeExpressionPresetId}`] : undefined
      const presetChanged = Boolean(latestPresetVersion && latestPresetVersion !== element.activeExpressionPresetUpdatedAt)
      const characterChanged = Boolean(character && element.characterSourceUpdatedAt !== character.updatedAt)
      const rendererChanged = element.faceRendererVersion !== STUDIO_FACE_RENDER_VERSION
      const assetRevisionKey = `${activeStudio.id}:${element.id}`
      const assetsChanged = assetLibraryRevision > (appliedAssetRevisionRef.current.get(assetRevisionKey) ?? 0)
      return character && (characterChanged || presetChanged || rendererChanged || assetsChanged)
        ? [{ element, character, shouldRecomposeExpression: characterChanged || presetChanged, assetRevisionKey, assetsChanged }] : []
    })
    if (!pending.length) return
    let cancelled = false
    const studioId = activeStudio.id
    const stageWidth = sceneRef.current?.clientWidth ?? 1000
    const stageHeight = sceneRef.current?.clientHeight ?? 562
    void (async () => {
      try {
        const { renderSavedCharacter } = await import('../customizer/CustomizerPage')
        const updates: Array<{ previous: StudioElement; next: StudioElement; asset: StudioAsset }> = []
        const timelineStates = new Map<string, Map<string, NonNullable<VideoTimelineDocument['characterBases']>[string]>>()
        const refreshedStates = new Map<string, NonNullable<VideoTimelineDocument['characterBases']>[string]>()
        for (const { element, character, shouldRecomposeExpression, assetRevisionKey, assetsChanged } of pending) {
          const timeline = videoTimelineFor(activeStudio)
          const states = new Map<string, NonNullable<VideoTimelineDocument['characterBases']>[string]>()
          const base = timeline.characterBases?.[element.id]
          if (base) states.set(`base:${element.id}`, base)
          for (const key of timeline.characterKeys) if (key.elementId === element.id && key.state) states.set(`key:${element.id}:${key.id}`, key.state)
          const current = captureVideoCharacter(activeStudio, element)
          if (current) states.set(`current:${element.id}`, current)
          const renderedCache = new Map<string, Promise<NonNullable<VideoTimelineDocument['characterBases']>[string]>>()
          const refreshState = (state: NonNullable<VideoTimelineDocument['characterBases']>[string]) => {
            const stateElement = state.element
            const signature = JSON.stringify({ element: stateElement, source: character.updatedAt })
            let rendering = renderedCache.get(signature)
            if (!rendering) {
              rendering = (async () => {
                const modelSlot = character.customization.modelSlot ?? 1
                const presetId = stateElement.activeExpressionPresetId
                const savedPreset = presetId ? await window.desktop.loadFaceExpressionPreset(modelSlot, presetId) : null
                if (presetId && !savedPreset) return state
                const sourceAppearance = character.customization.faceAppearance
                const appearanceFallback = sourceAppearance ?? stateElement.faceAppearance ?? stateElement.expressionBase?.appearance
                const previousBase = appearanceFallback ? resolveStudioExpressionBase(stateElement, appearanceFallback) : undefined
                const sceneTransforms = Object.fromEntries(Object.entries(stateElement.faceTransforms ?? {}).filter(([key]) => !key.startsWith('expression-component:') && !key.startsWith('expression:')))
                const expressionBase = shouldRecomposeExpression
                  ? sourceAppearance ? { appearance: structuredClone(sourceAppearance), transforms: sceneTransforms } : previousBase
                  : previousBase
                const appearance = shouldRecomposeExpression
                  ? savedPreset && expressionBase
                    ? await buildStudioExpressionAppearance(savedPreset, expressionBase.appearance, (id) => window.desktop.loadFaceCatalogItem(modelSlot, id))
                    : expressionBase?.appearance ?? sourceAppearance
                  : stateElement.faceAppearance ?? expressionBase?.appearance ?? sourceAppearance
                const faceMode = stateElement.activeFaceMode ?? studioFaceModeForElement(stateElement, appearance)
                const faceTransforms = shouldRecomposeExpression
                  ? savedPreset && appearance && expressionBase
                    ? await buildStudioExpressionTransforms(savedPreset, appearance, expressionBase.transforms,
                      (id) => window.desktop.loadFaceComponentAsset(modelSlot, id),
                      (id) => window.desktop.loadFaceCatalogItem(modelSlot, id))
                    : expressionBase?.transforms ?? stateElement.faceTransforms
                  : stateElement.faceTransforms ?? expressionBase?.transforms
                const expressionEffects = shouldRecomposeExpression ? savedPreset?.effects : stateElement.activeExpressionEffects
                const customization = { ...character.customization, poseSlot: stateElement.poseSlot === undefined ? character.customization.poseSlot : stateElement.poseSlot, faceAppearance: appearance }
                const rendered = await renderSavedCharacter({ ...character, customization }, faceTransforms, expressionEffects, faceMode)
                const crop = await trimTransparentImage(rendered.dataUrl)
                const cropWidth = crop?.width ?? rendered.width
                const cropHeight = crop?.height ?? rendered.height
                const characterCanvasWidth = stateElement.characterCanvasWidth ?? stateElement.width * rendered.width / cropWidth
                const nextElement: StudioElement = {
                  ...stateElement, characterSourceUpdatedAt: character.updatedAt, faceRendererVersion: STUDIO_FACE_RENDER_VERSION,
                  expressionBase, faceAppearance: appearance, faceTransforms, activeExpressionEffects: expressionEffects, activeFaceMode: faceMode,
                  ...(savedPreset ? { activeExpressionPresetUpdatedAt: savedPreset.updatedAt } : {}), characterCanvasWidth,
                  width: characterCanvasWidth * cropWidth / rendered.width,
                  height: characterCanvasWidth * stageWidth / stageHeight * cropHeight / rendered.width
                }
                return { element: nextElement, imageDataUrl: crop?.dataUrl ?? rendered.dataUrl }
              })()
              renderedCache.set(signature, rendering)
            }
            return rendering
          }
          for (const [stateId, state] of states) {
            const fresh = await refreshState(state)
            if (cancelled) return
            refreshedStates.set(stateId, fresh)
          }
          const currentState = refreshedStates.get(`current:${element.id}`) ?? (current ? await refreshState(current) : undefined)
          if (!currentState) continue
          const asset = activeStudio.assets.find((item) => item.id === element.assetId)
          if (!asset) continue
          updates.push({
            previous: element,
            next: { ...currentState.element, text: element.text === asset.name ? character.name : currentState.element.text },
            asset: { ...asset, name: character.name, mimeType: 'image/png', dataUrl: currentState.imageDataUrl }
          })
          const perCharacter = new Map<string, NonNullable<VideoTimelineDocument['characterBases']>[string]>()
          for (const [stateId, state] of refreshedStates) if (stateId === `base:${element.id}` || stateId.startsWith(`key:${element.id}:`)) perCharacter.set(stateId, state)
          timelineStates.set(element.id, perCharacter)
          if (assetsChanged) appliedAssetRevisionRef.current.set(assetRevisionKey, assetLibraryRevision)
          refreshedStates.clear()
        }
        if (cancelled || !updates.length) return
        setStudios((current) => current.map((studio) => {
          if (studio.id !== studioId) return studio
          const valid = updates.filter(({ previous }) => studio.elements.some((element) => element === previous))
          if (!valid.length) return studio
          const elements = new Map(valid.map(({ next }) => [next.id, next]))
          const assets = new Map(valid.map(({ asset }) => [asset.id, asset]))
          const nextStudio = {
            ...studio,
            elements: studio.elements.map((element) => elements.get(element.id) ?? element),
            assets: studio.assets.map((asset) => assets.get(asset.id) ?? asset),
            updatedAt: new Date().toISOString()
          }
          const timeline = nextStudio.videoTimeline
          if (!timeline) return nextStudio
          const nextBases = { ...(timeline.characterBases ?? {}) }
          for (const [elementId, states] of timelineStates) {
            const base = states.get(`base:${elementId}`)
            if (base) nextBases[elementId] = base
          }
          const nextKeys = timeline.characterKeys.map((key) => {
            if (!key.state) return key
            return { ...key, state: timelineStates.get(key.elementId)?.get(`key:${key.elementId}:${key.id}`) ?? key.state }
          })
          return { ...nextStudio, videoTimeline: { ...timeline, characterBases: nextBases, characterKeys: nextKeys } }
        }))
        setSaved(false)
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o personagem do Studio.')
      }
    })()
    return () => { cancelled = true }
  }, [activeStudio, availableCharacters, normalizedStudioVersion, sceneExpressionPresetVersions, assetLibraryRevision])

  const openStudio = async (card: VideoStudioCardSummary) => {
    const startedAt = performance.now()
    setError(null)
    setSelectedId(card.id)
    const cached = studios.find((studio) => studio.id === card.id)
    if (cached) { setActiveStudioId(card.id); return }
    setOpeningStudioId(card.id)
    try {
      const loaded = await persistence.load(card.id)
      if (!loaded) throw new Error(`Não foi possível encontrar ${card.title}.`)
      setStudios((current) => current.some((studio) => studio.id === loaded.id) ? current : [...current, normalizeVideoCharacterTransforms(loaded)])
      setActiveStudioId(card.id)
      console.info(`[Video Studio perf] abrir projeto: ${(performance.now() - startedAt).toFixed(1)} ms · ${loaded.videoTimeline?.characterKeys.length ?? 0} quadros-chave`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível abrir o Video Studio.')
    } finally { setOpeningStudioId(null) }
  }

  const allocateNumber = () => {
    const highest = studioCards.reduce((max, studio) => Math.max(max, Number(studio.title.match(/Studio\s+(\d+)$/i)?.[1] ?? 0)), 0)
    const number = Math.max(nextStudioNumber.current, highest + 1)
    nextStudioNumber.current = number + 1
    return number
  }

  const createStudio = async () => {
    const number = allocateNumber()
    const now = new Date().toISOString()
    const studio: StudioCard = {
      schemaVersion: 1, id: crypto.randomUUID(), title: `${workspaceTitle} ${String(number).padStart(2, '0')}`,
      color: studioColor(number), createdAt: now, updatedAt: now, backgroundColor: '#d7b5cd',
      backgroundAssetId: null, backgroundX: 0, backgroundY: 0, backgroundWidth: 100, backgroundHeight: 100,
      backgroundRotation: 0, assets: [], elements: [],
      ...(isVideoWorkspace ? { videoTimeline: { schemaVersion: 1, frameRate: 60, durationFrames: DEFAULT_VIDEO_DURATION_FRAMES, playheadFrame: 0, playing: false, characterKeys: [], textClips: [], saveMarkers: [] } } : {})
    }
    try {
      setError(null)
      await persistence.save(studio)
      setStudios((current) => [...current, studio])
      setStudioCards((current) => [...current, studioCardFromDocument(studio)])
      setSelectedId(studio.id)
      setSaved(true)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar o Studio.') }
  }

  const duplicateStudio = async (card: VideoStudioCardSummary | null = selectedStudio) => {
    if (!card) return
    const source = studios.find((studio) => studio.id === card.id) ?? await persistence.load(card.id)
    if (!source) { setError(`Não foi possível carregar ${card.title} para duplicar.`); return }
    const number = allocateNumber()
    const now = new Date().toISOString()
    const duplicate: StudioDocument = {
      ...source, id: crypto.randomUUID(), title: `${workspaceTitle} ${String(number).padStart(2, '0')}`,
      color: studioColor(number), createdAt: now, updatedAt: now,
      assets: source.assets.map((asset) => ({ ...asset, id: crypto.randomUUID() })),
      elements: source.elements.map((element) => ({
        ...element, id: crypto.randomUUID(), assetId: element.assetId
          ? source.assets.find((asset) => asset.id === element.assetId)?.id
          : undefined
      }))
    }
    const oldToNew = new Map(source.assets.map((asset, index) => [asset.id, duplicate.assets[index]?.id ?? '']))
    duplicate.elements = source.elements.map((element, index) => ({
      ...duplicate.elements[index], assetId: element.assetId ? oldToNew.get(element.assetId) : undefined
    }))
    if (source.videoTimeline) {
      const elementIds = new Map(source.elements.map((element, index) => [element.id, duplicate.elements[index].id]))
      const remapState = (state: NonNullable<VideoTimelineDocument['characterKeys'][number]['state']>) => ({ ...state, element: { ...state.element, id: elementIds.get(state.element.id) ?? state.element.id, assetId: state.element.assetId ? oldToNew.get(state.element.assetId) : undefined } })
      duplicate.videoTimeline = { ...source.videoTimeline,
        trackSettings: Object.fromEntries(Object.entries(source.videoTimeline.trackSettings ?? {}).map(([id, settings]) => [elementIds.get(id) ?? id, settings])),
        characterBases: Object.fromEntries(Object.entries(source.videoTimeline.characterBases ?? {}).map(([id, state]) => [elementIds.get(id) ?? id, remapState(state)])),
        characterPositions: Object.fromEntries(Object.entries(source.videoTimeline.characterPositions ?? {}).map(([id, position]) => [elementIds.get(id) ?? id, position])),
        characterTransforms: Object.fromEntries(Object.entries(source.videoTimeline.characterTransforms ?? {}).map(([id, transform]) => [elementIds.get(id) ?? id, transform])),
        characterTrackEnds: source.videoTimeline.characterTrackEnds ? Object.fromEntries(Object.entries(source.videoTimeline.characterTrackEnds).map(([id, frame]) => [elementIds.get(id) ?? id, frame])) : undefined,
        characterGaps: source.videoTimeline.characterGaps?.map((gap) => ({ ...gap, id: crypto.randomUUID(), elementId: elementIds.get(gap.elementId) ?? gap.elementId })),
        characterKeys: source.videoTimeline.characterKeys.map((key) => ({ ...key, id: crypto.randomUUID(), elementId: elementIds.get(key.elementId) ?? key.elementId, state: key.state ? remapState(key.state) : undefined })),
        textClips: source.videoTimeline.textClips.map((clip) => ({ ...clip, id: crypto.randomUUID(), elementId: elementIds.get(clip.elementId) ?? clip.elementId, state: clip.state ? { ...clip.state, id: elementIds.get(clip.state.id) ?? clip.state.id } : undefined }))
      }
    }
    duplicate.backgroundAssetId = source.backgroundAssetId ? oldToNew.get(source.backgroundAssetId) ?? null : null
    try {
      setError(null)
      await persistence.save(duplicate)
      setStudios((current) => [...current, duplicate])
      setStudioCards((current) => [...current, studioCardFromDocument(duplicate)])
      setSelectedId(duplicate.id)
      setSaved(true)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível duplicar o Studio.') }
  }

  const saveStudio = useCallback(async (document = activeStudio) => {
    if (!document) return true
    const generation = ++saveGenerationRef.current
    const startedAt = performance.now()
    try {
      await persistence.save({ ...document, updatedAt: new Date().toISOString() })
      console.info(`[Video Studio perf] salvar projeto: ${(performance.now() - startedAt).toFixed(1)} ms · ${document.videoTimeline?.characterKeys.length ?? 0} quadros-chave`)
      if (generation === saveGenerationRef.current) {
        setSaved(true)
        setError(null)
      }
      return true
    } catch (reason) {
      if (generation === saveGenerationRef.current) setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o Studio neste dispositivo.')
      return false
    }
  }, [activeStudio, persistence])

  useEffect(() => {
    if (!activeStudio) return
    setSaved(false)
    const signature = JSON.stringify(activeStudio.elements.filter((element) => element.kind === 'character').map((element) => [element.id, element.activeExpressionCollectionId, element.activeExpressionPresetId]))
    const previous = expressionSaveSignatureRef.current
    expressionSaveSignatureRef.current = { studioId: activeStudio.id, value: signature }
    if (previous?.studioId === activeStudio.id && previous.value !== signature) {
      void saveStudio(activeStudio)
      return
    }
    const timer = window.setTimeout(() => { void saveStudio(activeStudio) }, 650)
    return () => window.clearTimeout(timer)
  }, [activeStudio, saveStudio])

  const patchStudio = (transform: (studio: StudioDocument) => StudioDocument) => {
    if (!activeStudioId) return
    setStudios((current) => current.map((studio) => {
      if (studio.id !== activeStudioId) return studio
      const next = synchronizeVideoCharacterTransforms(studio, transform(studio))
      if (!isVideoWorkspace || !selectedElementId || next === studio) return next
      const previousElement = studio.elements.find((element) => element.id === selectedElementId && element.kind === 'character')
      const editedElement = next.elements.find((element) => element.id === selectedElementId && element.kind === 'character')
      if (!previousElement || !editedElement) return next
      const previousState = captureVideoCharacter(studio, previousElement)
      const editedState = captureVideoCharacter(next, editedElement)
      if (!editedState || videoCharacterStateEquals(previousState ?? undefined, editedState)) return next

      const timeline = videoTimelineFor(next)
      const activeKey = timeline.characterKeys.filter((key) => key.elementId === selectedElementId && key.frame <= videoPlayheadFrame)
        .sort((left, right) => right.frame - left.frame)[0]
      const globalFields: Partial<StudioElement> = {}
      if (previousElement.timelineColor !== editedElement.timelineColor) globalFields.timelineColor = editedElement.timelineColor
      if (previousElement.positionLocked !== editedElement.positionLocked) globalFields.positionLocked = editedElement.positionLocked
      const applyGlobalFields = (state: NonNullable<VideoTimelineDocument['characterKeys'][number]['state']>) => Object.keys(globalFields).length
        ? { ...state, element: { ...state.element, ...globalFields } } : state
      const characterBases = { ...timeline.characterBases }
      if (characterBases[selectedElementId]) characterBases[selectedElementId] = applyGlobalFields(characterBases[selectedElementId])
      const characterKeys = timeline.characterKeys.map((key) => {
        if (key.elementId !== selectedElementId) return key
        const state = key.id === activeKey?.id ? editedState : key.state ? applyGlobalFields(key.state) : undefined
        return key.id === activeKey?.id
          ? { ...key, poseSlot: editedElement.poseSlot ?? null, expressionCollectionId: editedElement.activeExpressionCollectionId ?? 'standard', expressionPresetId: editedElement.activeExpressionPresetId ?? null, faceMode: studioFaceModeForElement(editedElement, editedElement.faceAppearance), state }
          : { ...key, state }
      })
      if (!activeKey) characterBases[selectedElementId] = editedState
      return normalizeVideoCharacterTransforms({ ...next, videoTimeline: { ...timeline, characterBases, characterKeys } })
    }))
    setSaved(false)
  }

  const refreshHistoryControls = () => {
    setCanUndo(editHistoryRef.current.canUndo)
    setCanRedo(editHistoryRef.current.canRedo)
    setHistoryVersion((value) => value + 1)
  }

  const recordHistory = () => {
    if (!activeStudio) return
    editHistoryRef.current.begin(activeStudio.id, snapshot(activeStudio))
    refreshHistoryControls()
  }

  const changeScene = (transform: (studio: StudioDocument) => StudioDocument) => {
    if (!activeStudio) return
    recordHistory()
    patchStudio(transform)
  }

  const changeTimelineView = (settings: { zoom?: number; height?: number }) => {
    patchStudio((studio) => ({
      ...studio,
      videoTimeline: {
        ...videoTimelineFor(studio),
        ...(settings.zoom !== undefined ? { timelineZoom: settings.zoom } : {}),
        ...(settings.height !== undefined ? { timelineHeight: settings.height } : {})
      },
      updatedAt: new Date().toISOString()
    }))
  }

  const setCharacterPositionsLocked = (locked: boolean) => changeScene((studio) => {
    const timeline = videoTimelineFor(studio)
    const lockState = (state: NonNullable<VideoTimelineDocument['characterKeys'][number]['state']>) => ({ ...state, element: { ...state.element, positionLocked: locked } })
    return {
      ...studio,
      elements: studio.elements.map((element) => element.kind === 'character' ? { ...element, positionLocked: locked } : element),
      videoTimeline: {
        ...timeline,
        characterPositionsLocked: locked,
        characterBases: Object.fromEntries(Object.entries(timeline.characterBases ?? {}).map(([id, state]) => [id, lockState(state)])),
        characterKeys: timeline.characterKeys.map((key) => key.state ? { ...key, state: lockState(key.state) } : key)
      },
      updatedAt: new Date().toISOString()
    }
  })

  const restoreHistorySnapshot = (next: StudioSnapshot) => {
    if (!activeStudio) return
    animationPlayRequestRef.current += 1
    setAnimationPreparing(false)
    setVideoPlaying(false)
    const frame = Math.max(0, Math.min(videoPlayheadFrame, (next.videoTimeline?.durationFrames ?? 1) - 1))
    setVideoPlayheadFrame(frame)
    videoPlaybackAnchorRef.current = { frame, time: performance.now() }
    // Cancel delayed face renders so they cannot repaint a restored expression.
    studioFaceRenderVersionRef.current += 1
    studioFaceRenderPendingRef.current = null
    if (studioFaceRenderTimerRef.current !== null) window.clearTimeout(studioFaceRenderTimerRef.current)
    studioFaceRenderTimerRef.current = null
    dragRef.current = null
    // Restore the document directly: patchStudio would treat the restored character
    // as a new edit and overwrite the expression/pose key at the current playhead.
    setStudios((current) => current.map((studio) => {
      if (studio.id !== activeStudio.id) return studio
      const restored = withSnapshot(studio, next)
      return restoreVideoTracks({ ...restored, ...(restored.videoTimeline ? { videoTimeline: { ...restored.videoTimeline, playheadFrame: frame, playing: false } } : {}) }, frame)
    }))
    setSaved(false)
  }

  const undo = () => {
    if (!activeStudio || studioFaceBusy || studioExpressionBusy || savingCast) return
    const previous = editHistoryRef.current.undo(activeStudio.id, snapshot(activeStudio))
    if (previous) restoreHistorySnapshot(previous)
    refreshHistoryControls()
  }

  const redo = () => {
    if (!activeStudio || studioFaceBusy || studioExpressionBusy || savingCast) return
    const next = editHistoryRef.current.redo(activeStudio.id, snapshot(activeStudio))
    if (next) restoreHistorySnapshot(next)
    refreshHistoryControls()
  }

  const importImage = async (category: StudioAsset['category']) => {
    if (!activeStudio) return
    try {
      const asset = await persistence.importImage(category)
      if (!asset) return
      const studioAtImport = activeStudio
      const nextStudio: StudioDocument = category === 'background'
        ? { ...studioAtImport, assets: [...studioAtImport.assets, asset], backgroundAssetId: asset.id, backgroundX: 0, backgroundY: 0, backgroundWidth: 100, backgroundHeight: 100, backgroundRotation: 0, updatedAt: new Date().toISOString() }
        : {
            ...studioAtImport,
            assets: [...studioAtImport.assets, asset],
            elements: [...studioAtImport.elements, {
              id: crypto.randomUUID(), kind: 'image', assetId: asset.id, text: '', x: 0, y: 0, width: 25, height: 25, rotation: 0,
              zIndex: Math.max(0, ...studioAtImport.elements.map((item) => item.zIndex)) + 1
            }],
            updatedAt: new Date().toISOString()
          }

      // Persist imported image bytes and their manifest before showing the asset as saved.
      await persistence.save(nextStudio)
      if (activeStudioId === studioAtImport.id) {
        recordHistory()
        setStudios((current) => current.map((studio) => studio.id === studioAtImport.id ? nextStudio : studio))
        setSaved(true)
      }
      if (category === 'background') {
        setSelectedElementId('background')
      } else {
        setSelectedElementId(nextStudio.elements.at(-1)?.id ?? null)
      }
      setActiveTool(category === 'background' ? 'background' : 'objects')
      setInspectorOpen(true)
      setInspectorTab('editor')
      setError(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível importar a imagem.') }
  }

  const openVideoLibrary = async () => {
    if (!activeStudio) return
    setVideoPlaying(false)
    if (await saveStudio(activeStudio)) setVideoLibraryOpen(true)
  }

  const openBackgroundLibrary = async () => {
    if (!activeStudio) return
    setVideoPlaying(false)
    if (await saveStudio(activeStudio)) setBackgroundLibraryOpen(true)
  }

  const addLibraryVideos = async (ids: string[]) => {
    if (!activeStudio || videoTimelineFor(activeStudio).trackSettings?.video?.locked) throw new Error('Desbloqueie a faixa de vídeo para adicionar clipes.')
    const assets = await window.desktop.attachVideoLibraryItems(activeStudio.id, ids)
    const startingTimeline = videoTimelineFor(activeStudio)
    let coverDataUrl = startingTimeline.coverDataUrl
    if (!coverDataUrl) {
      const existingClips = [...(startingTimeline.videoClips ?? [])].sort((left, right) => left.startFrame - right.startFrame)
      const candidates = [
        ...existingClips.map((clip) => ({ assetId: clip.assetId, frame: clip.sourceStartFrame })),
        ...assets.map((asset) => ({ assetId: asset.id, frame: 0 }))
      ]
      for (const candidate of candidates) {
        coverDataUrl = await captureVideoPoster(candidate.assetId, candidate.frame) ?? undefined
        if (coverDataUrl) break
      }
    }
    const totalFrames = assets.reduce((sum, item) => sum + item.durationFrames, 0)
    if (videoPlayheadFrame + totalFrames > 60 * 60 * 60 * 24) throw new Error('Os vídeos selecionados ultrapassam a duração máxima de 24 horas do roteiro.')
    const assetIds = new Set([...(videoTimelineFor(activeStudio).videoAssets ?? []).map((item) => item.id), ...assets.map((item) => item.id)])
    if (assetIds.size > 1000) throw new Error('O roteiro atingiu o limite de 1.000 arquivos de vídeo.')
    const studioId = activeStudio.id
    changeScene((studio) => {
      if (studio.id !== studioId) return studio
      const timeline = videoTimelineFor(studio)
      let cursor = videoPlayheadFrame
      const clips: VideoMediaClip[] = []
      for (const asset of assets) {
        const placementTimeline = { ...timeline, videoClips: [...(timeline.videoClips ?? []), ...clips] }
        cursor = findTimelineBlockStart(placementTimeline, 'video', cursor, asset.durationFrames)
        const clip: VideoMediaClip = { id: crypto.randomUUID(), assetId: asset.id, startFrame: cursor, endFrame: cursor + asset.durationFrames, sourceStartFrame: 0, sourceEndFrame: asset.durationFrames }
        clips.push(clip)
        cursor = clip.endFrame
      }
      const videoAssets = [...(timeline.videoAssets ?? [])]
      for (const asset of assets) if (!videoAssets.some((item) => item.id === asset.id)) videoAssets.push(asset)
      return { ...studio, videoTimeline: { ...timeline, ...(timeline.coverDataUrl || !coverDataUrl ? {} : { coverDataUrl }), durationFrames: Math.max(timeline.durationFrames, cursor), videoAssets, videoClips: [...(timeline.videoClips ?? []), ...clips] }, updatedAt: new Date().toISOString() }
    })
  }

  const addLibraryBackground = async (id: string) => {
    if (!activeStudio) throw new Error('Abra um roteiro antes de selecionar um fundo.')
    const studioId = activeStudio.id
    const asset = await window.desktop.attachVideoBackground(studioId, id)
    if (activeStudioId !== studioId) throw new Error('O roteiro mudou enquanto o fundo era copiado. Abra a biblioteca novamente.')
    changeScene((studio) => ({ ...studio, assets: [...studio.assets.filter((entry) => entry.id !== asset.id), asset], backgroundAssetId: asset.id, backgroundX: 0, backgroundY: 0, backgroundWidth: 100, backgroundHeight: 100, backgroundRotation: 0, updatedAt: new Date().toISOString() }))
    setSelectedElementId('background')
    setActiveTool('background')
    setInspectorOpen(true)
    setInspectorTab('editor')
  }

  const addTextElement = (kind: 'narrator' | 'speech' | 'thought') => {
    if (!activeStudio) return
    const selectedSpeaker = kind === 'narrator' ? null : activeStudio.elements.find((item) => item.id === selectedElementId && item.kind === 'character') ?? null
    if (kind !== 'narrator' && !selectedSpeaker) return
    const element: StudioElement = {
      ...makeElement(kind, Math.max(0, ...activeStudio.elements.map((item) => item.zIndex)) + 1),
      ...(selectedSpeaker ? {
        speakerCharacterId: selectedSpeaker.id,
        speakerName: selectedSpeaker.text,
        speakerColor: videoCharacterTrackColor(selectedSpeaker.id, selectedSpeaker.timelineColor)
      } : {})
    }
    changeScene((studio) => {
      if (!isVideoWorkspace || kind === 'narrator') return { ...studio, elements: [...studio.elements, element], updatedAt: new Date().toISOString() }
      const timeline = videoTimelineFor(studio)
      const startFrame = findTimelineBlockStart(timeline, kind, Math.min(videoPlayheadFrame, timeline.durationFrames - 1), 300)
      const endFrame = startFrame + 300
      return { ...studio, elements: [...studio.elements, element], videoTimeline: { ...timeline, durationFrames: Math.max(timeline.durationFrames, endFrame), textClips: [...timeline.textClips, { id: crypto.randomUUID(), elementId: element.id, kind, startFrame, endFrame, state: structuredClone(element) }] }, updatedAt: new Date().toISOString() }
    })
    setSelectedElementId(element.id)
    setInspectorOpen(true)
    setInspectorTab('editor')
  }

  const saveVideoFrame = () => {
    if (!activeStudio || !isVideoWorkspace) return
    const timeline = videoTimelineFor(activeStudio)
    const keys = [...timeline.characterKeys]
    const characterBases = { ...(timeline.characterBases ?? {}) }
    const affectedTrackIds: string[] = []
    for (const character of activeStudio.elements.filter((element) => element.kind === 'character')) {
      if (timeline.trackSettings?.[character.id]?.locked) continue
      const captured = captureVideoCharacter(activeStudio, character)
      if (!captured) continue
      characterBases[character.id] ??= videoInitialStatesRef.current?.studioId === activeStudio.id
        ? videoInitialStatesRef.current.states[character.id] ?? captured : captured
      const previous = characterStateAt({ ...timeline, characterBases, characterKeys: keys }, character.id, Math.max(0, videoPlayheadFrame - 1))
      const state = {
        poseSlot: character.poseSlot ?? null,
        expressionCollectionId: character.activeExpressionCollectionId ?? 'standard',
        expressionPresetId: character.activeExpressionPresetId ?? null,
        faceMode: studioFaceModeForElement(character, character.faceAppearance),
        state: captured
      }
      const existingIndex = keys.findIndex((key) => key.elementId === character.id && key.frame === videoPlayheadFrame)
      if (existingIndex < 0 && videoCharacterStateEquals(previous, captured)) continue
      const key = { id: existingIndex >= 0 ? keys[existingIndex].id : crypto.randomUUID(), elementId: character.id, frame: videoPlayheadFrame, ...state }
      if (existingIndex >= 0) keys[existingIndex] = key
      else keys.push(key)
      affectedTrackIds.push(character.id)
    }
    const textClips = [...timeline.textClips]
    for (const element of activeStudio.elements.filter((item) => item.kind === 'speech' || item.kind === 'thought')) {
      if (timeline.trackSettings?.[element.kind]?.locked) continue
      const index = textClips.findIndex((clip) => clip.elementId === element.id && clip.startFrame <= videoPlayheadFrame && videoPlayheadFrame < clip.endFrame)
      if (index < 0) continue
      const clip = textClips[index]
      if (clip.state && JSON.stringify(clip.state) === JSON.stringify(element)) continue
      if (videoPlayheadFrame > clip.startFrame) {
        textClips.splice(index, 1,
          { ...clip, endFrame: videoPlayheadFrame, state: clip.state ?? structuredClone(element) },
          { ...clip, id: crypto.randomUUID(), startFrame: videoPlayheadFrame, state: structuredClone(element) })
      } else textClips[index] = { ...clip, state: structuredClone(element) }
      affectedTrackIds.push(element.id)
    }
    changeScene((studio) => {
      const current = videoTimelineFor(studio)
      const markerIndex = current.saveMarkers.findIndex((marker) => marker.frame === videoPlayheadFrame)
      const marker = { id: markerIndex >= 0 ? current.saveMarkers[markerIndex].id : crypto.randomUUID(), frame: videoPlayheadFrame, affectedTrackIds }
      const saveMarkers = [...current.saveMarkers]
      if (markerIndex >= 0) saveMarkers[markerIndex] = marker
      else saveMarkers.push(marker)
      return { ...studio, videoTimeline: { ...current, characterBases, playheadFrame: videoPlayheadFrame, characterKeys: keys, textClips, saveMarkers }, updatedAt: new Date().toISOString() }
    })
  }

  const seekVideoFrame = (frame: number) => {
    if (!activeStudio) return
    editHistoryRef.current.cancelPending()
    animationPlayRequestRef.current += 1
    setAnimationPreparing(false)
    const clamped = Math.max(0, Math.min(videoTimelineFor(activeStudio).durationFrames, Math.round(frame)))
    setVideoPlaying(false)
    videoPlaybackAnchorRef.current = { frame: clamped, time: performance.now() }
    setVideoPlayheadFrame(clamped)
    if (isVideoWorkspace && (clamped !== videoPlayheadFrame || videoPlaying)) {
      // Every explicit segment edit is already stored; seeking loads that segment's state.
      setStudios((current) => current.map((studio) => studio.id === activeStudio.id
        ? restoreVideoTracks({ ...studio, videoTimeline: { ...videoTimelineFor(studio), playheadFrame: clamped } }, clamped)
        : studio))
    }
  }

  const prepareVideoPlayback = async (startFrame: number) => {
    const request = ++animationPlayRequestRef.current
    setVideoPlaying(false)
    setVideoPlayheadFrame(startFrame)
    setAnimationPreparing(true)
    const startedAt = performance.now()
    try {
      const currentSession = await characterAnimation.preparePlayback(startFrame)
      console.info(`[Video Studio perf] preparar prévia: ${(performance.now() - startedAt).toFixed(1)} ms · quadro ${startFrame}`)
      if (currentSession && request === animationPlayRequestRef.current) { setError(null); setVideoPlaying(true) }
    } catch (reason) {
      if (request === animationPlayRequestRef.current) setError(reason instanceof Error ? reason.message : 'Não foi possível preparar as animações.')
    } finally { if (request === animationPlayRequestRef.current) setAnimationPreparing(false) }
  }

  const toggleVideoPlayback = async () => {
    if (!activeStudio) return
    if (animationPreparing) { animationPlayRequestRef.current += 1; setAnimationPreparing(false); return }
    if (videoPlaying) { seekVideoFrame(videoPlayheadFrame); return }
    editHistoryRef.current.cancelPending()
    const startFrame = videoPlayheadFrame >= videoTimelineFor(activeStudio).durationFrames ? 0 : videoPlayheadFrame
    if (startFrame !== videoPlayheadFrame) seekVideoFrame(startFrame)
    await prepareVideoPlayback(startFrame)
  }

  useEffect(() => {
    // If preparation cannot keep up on a slow machine, freeze the video clock
    // at the required sample instead of silently replacing animation with a cut.
    if (videoPlaying && characterAnimation.missing) void prepareVideoPlayback(videoPreviewFrame)
  }, [videoPlaying, characterAnimation.missing, videoPreviewFrame])

  const splitVideoCharacterTrack = (elementId: string, frame: number) => {
    if (!activeStudio) return
    if (videoTimelineFor(activeStudio).trackSettings?.[elementId]?.locked) return
    const character = activeStudio.elements.find((element) => element.id === elementId && element.kind === 'character')
    if (!character) return
    changeScene((studio) => {
      const current = videoTimelineFor(studio)
      const keys = [...current.characterKeys]
      if (keys.some((key) => key.elementId === elementId && key.frame === frame)) return studio
      const previous = keys.filter((key) => key.elementId === elementId && key.frame < frame).sort((a, b) => b.frame - a.frame)[0]
      const state = previous ? {
        poseSlot: previous.poseSlot,
        expressionCollectionId: previous.expressionCollectionId,
        expressionPresetId: previous.expressionPresetId,
        faceMode: previous.faceMode,
        state: previous.state ?? characterStateAt(current, elementId, frame) ?? (videoInitialStatesRef.current?.studioId === studio.id ? videoInitialStatesRef.current.states[elementId] : undefined)
      } : {
        poseSlot: character.poseSlot ?? null,
        expressionCollectionId: character.activeExpressionCollectionId ?? 'standard',
        expressionPresetId: character.activeExpressionPresetId ?? null,
        faceMode: studioFaceModeForElement(character, character.faceAppearance),
        state: characterStateAt(current, elementId, frame) ?? (videoInitialStatesRef.current?.studioId === studio.id ? videoInitialStatesRef.current.states[elementId] : undefined) ?? captureVideoCharacter(studio, character) ?? undefined
      }
      keys.push({ id: crypto.randomUUID(), elementId, frame, ...state })
      keys.sort((a, b) => a.frame - b.frame)
      const existingMarker = current.saveMarkers.find((item) => item.frame === frame)
      const marker = { id: existingMarker?.id ?? crypto.randomUUID(), frame, affectedTrackIds: [...new Set([...(existingMarker?.affectedTrackIds ?? []), elementId])] }
      const saveMarkers = existingMarker
        ? current.saveMarkers.map((item) => item.frame === frame ? marker : item)
        : [...current.saveMarkers, marker]
      const characterBases = { ...current.characterBases }
      const baseline = videoInitialStatesRef.current?.studioId === studio.id
        ? videoInitialStatesRef.current.states[elementId] ?? captureVideoCharacter(studio, character)
        : captureVideoCharacter(studio, character)
      if (baseline) characterBases[elementId] ??= baseline
      return { ...studio, videoTimeline: { ...current, characterBases, characterKeys: keys, saveMarkers }, updatedAt: new Date().toISOString() }
    })
    setVideoPlayheadFrame(frame)
  }

  const deleteVideoCharacterSegment = (elementId: string, startFrame: number, endFrame: number) => {
    if (!activeStudio || videoTimelineFor(activeStudio).trackSettings?.[elementId]?.locked) return
    changeScene((studio) => {
      const timeline = videoTimelineFor(studio)
      const start = Math.max(0, Math.min(timeline.durationFrames, Math.round(startFrame)))
      const end = Math.max(start, Math.min(timeline.durationFrames, Math.round(endFrame)))
      if (end <= start || !studio.elements.some((element) => element.id === elementId && element.kind === 'character')) return studio
      const intervals = [...(timeline.characterGaps ?? []).filter((gap) => gap.elementId === elementId), { id: crypto.randomUUID(), elementId, startFrame: start, endFrame: end }].sort((left, right) => left.startFrame - right.startFrame)
      const merged: typeof intervals = []
      for (const interval of intervals) {
        const previous = merged.at(-1)
        if (previous && interval.startFrame <= previous.endFrame) previous.endFrame = Math.max(previous.endFrame, interval.endFrame)
        else merged.push({ ...interval })
      }
      return { ...studio, videoTimeline: { ...timeline, characterGaps: [...(timeline.characterGaps ?? []).filter((gap) => gap.elementId !== elementId), ...merged] }, updatedAt: new Date().toISOString() }
    })
  }

  const splitVideoTextClip = (selected: { elementId: string; clipId: string; startFrame: number; endFrame: number }, frame: number, rightClipId: string) => {
    if (!activeStudio) return
    const element = activeStudio.elements.find((item) => item.id === selected.elementId)
    if (!element || (element.kind !== 'speech' && element.kind !== 'thought')) return
    if (videoTimelineFor(activeStudio).trackSettings?.[element.kind]?.locked) return
    changeScene((studio) => {
      const current = videoTimelineFor(studio)
      const original = current.textClips.find((clip) => clip.id === selected.clipId)
      const kind = original?.kind ?? element.kind as 'speech' | 'thought'
      const leftClipId = original ? original.id : crypto.randomUUID()
      const remaining = current.textClips.filter((clip) => clip.id !== original?.id)
      const state = original?.state ?? structuredClone(element)
      const left: VideoTimelineDocument['textClips'][number] = { id: leftClipId, elementId: selected.elementId, kind, startFrame: selected.startFrame, endFrame: frame, state: structuredClone(state) }
      const right: VideoTimelineDocument['textClips'][number] = { id: rightClipId, elementId: selected.elementId, kind, startFrame: frame, endFrame: selected.endFrame, state: structuredClone(state) }
      return { ...studio, videoTimeline: { ...current, textClips: [...remaining, left, right] }, updatedAt: new Date().toISOString() }
    })
    setVideoPlayheadFrame(frame)
  }

  const splitVideoMediaClip = (clipId: string, frame: number, rightClipId: string) => {
    if (!activeStudio) return
    changeScene((studio) => {
      const timeline = videoTimelineFor(studio)
      const clip = timeline.videoClips?.find((item) => item.id === clipId)
      if (!clip || timeline.trackSettings?.video?.locked) return studio
      const parts = splitMediaClip(clip, frame, rightClipId)
      if (!parts) return studio
      return {
        ...studio,
        videoTimeline: {
          ...timeline,
          videoClips: (timeline.videoClips ?? []).flatMap((item) => item.id !== clipId ? [item] : parts)
        },
        updatedAt: new Date().toISOString()
      }
    })
    setVideoPlayheadFrame(frame)
  }

  const updateVideoMediaClip = (clip: VideoMediaClip, record = true) => {
    const apply = record ? changeScene : patchStudio
    apply((studio) => {
      const timeline = videoTimelineFor(studio)
      const previous = timeline.videoClips?.find((item) => item.id === clip.id)
      const asset = timeline.videoAssets?.find((item) => item.id === clip.assetId)
      if (!previous || previous.assetId !== clip.assetId || !asset || timeline.trackSettings?.video?.locked
        || !isValidVideoMediaClip(clip, asset.durationFrames, timeline.durationFrames)
        || timelineBlockOverlaps(timeline, { kind: 'video', clipId: clip.id }, clip.startFrame, clip.endFrame)) return studio
      return { ...studio, videoTimeline: { ...timeline, videoClips: timeline.videoClips!.map((item) => item.id === clip.id ? clip : item) }, updatedAt: new Date().toISOString() }
    })
  }

  const updateVideoAudio = (audio: VideoAudioSettings, record = true) => {
    if (!isValidVideoAudioSettings(audio)) return
    const apply = record ? changeScene : patchStudio
    apply((studio) => ({ ...studio, videoTimeline: { ...videoTimelineFor(studio), videoAudio: audio }, updatedAt: new Date().toISOString() }))
  }

  const duplicateVideoMediaClip = (selected: VideoMediaClip) => {
    changeScene((studio) => {
      const timeline = videoTimelineFor(studio)
      const clip = timeline.videoClips?.find((item) => item.id === selected.id)
      const asset = timeline.videoAssets?.find((item) => item.id === clip?.assetId)
      if (!clip || !asset || timeline.trackSettings?.video?.locked) return studio
      const length = clip.endFrame - clip.startFrame
      const startFrame = findTimelineBlockStart(timeline, 'video', clip.endFrame, length)
      const duplicate = editVideoMediaClip({ ...clip, id: crypto.randomUUID() }, 'move', startFrame, asset.durationFrames, Math.max(timeline.durationFrames, startFrame + length))
      return { ...studio, videoTimeline: { ...timeline, durationFrames: Math.max(timeline.durationFrames, duplicate.endFrame), videoClips: [...timeline.videoClips!, duplicate] }, updatedAt: new Date().toISOString() }
    })
  }

  const deleteVideoMediaClip = (clipId: string) => {
    changeScene((studio) => {
      const timeline = videoTimelineFor(studio)
      if (timeline.trackSettings?.video?.locked || !(timeline.videoClips ?? []).some((clip) => clip.id === clipId)) return studio
      return { ...studio, videoTimeline: { ...timeline, videoClips: timeline.videoClips!.filter((clip) => clip.id !== clipId) }, updatedAt: new Date().toISOString() }
    })
  }

  const updateVideoTextClip = (clip: VideoTimelineDocument['textClips'][number]) => {
    if (activeStudio && videoTimelineFor(activeStudio).trackSettings?.[clip.kind]?.locked) return
    changeScene((studio) => {
      const current = videoTimelineFor(studio)
      const exists = current.textClips.some((item) => item.id === clip.id)
      if (exists && timelineBlockOverlaps(current, { kind: 'text', clipId: clip.id }, clip.startFrame, clip.endFrame)) return studio
      return { ...studio, videoTimeline: { ...current, textClips: exists ? current.textClips.map((item) => item.id === clip.id ? clip : item) : [...current.textClips, clip] }, updatedAt: new Date().toISOString() }
    })
  }

  const deleteVideoTextClip = (id: string) => {
    changeScene((studio) => {
      const timeline = videoTimelineFor(studio)
      const clip = timeline.textClips.find((item) => item.id === id)
      if (!clip || timeline.trackSettings?.[clip.kind]?.locked) return studio
      return { ...studio, videoTimeline: { ...timeline, textClips: timeline.textClips.filter((item) => item.id !== id) }, updatedAt: new Date().toISOString() }
    })
  }

  const deleteVideoTextElement = (elementId: string) => {
    const element = activeStudio?.elements.find((item) => item.id === elementId)
    if (!activeStudio || !element || (element.kind !== 'speech' && element.kind !== 'thought') || videoTimelineFor(activeStudio).trackSettings?.[element.kind]?.locked) return
    if (selectedElementId === elementId) setSelectedElementId(null)
    changeScene((studio) => {
      const removedAssetIds = new Set(studio.elements.filter((item) => item.id === elementId).map((item) => item.assetId).filter((id): id is string => Boolean(id)))
      const elements = studio.elements.filter((item) => item.id !== elementId)
      const usedAssetIds = new Set(elements.map((element) => element.assetId).filter((id): id is string => Boolean(id)))
      const timeline = videoTimelineFor(studio)
      return {
        ...studio,
        elements,
        assets: studio.assets.filter((asset) => !removedAssetIds.has(asset.id) || usedAssetIds.has(asset.id)),
        videoTimeline: { ...timeline, textClips: timeline.textClips.filter((clip) => clip.elementId !== elementId) },
        updatedAt: new Date().toISOString()
      }
    })
  }

  const duplicateVideoTextClip = (clip: VideoTimelineDocument['textClips'][number]) => {
    changeScene((studio) => {
      const timeline = videoTimelineFor(studio)
      if (timeline.trackSettings?.[clip.kind]?.locked) return studio
      const length = clip.endFrame - clip.startFrame
      const startFrame = findTimelineBlockStart(timeline, clip.kind, clip.endFrame, length)
      const endFrame = startFrame + length
      return { ...studio, videoTimeline: { ...timeline, durationFrames: Math.max(timeline.durationFrames, endFrame), textClips: [...timeline.textClips, { ...clip, id: crypto.randomUUID(), startFrame, endFrame, state: clip.state ? structuredClone(clip.state) : undefined }] }, updatedAt: new Date().toISOString() }
    })
  }

  const resizeVideoBlock = (target: TimelineBlockTarget, startFrame: number, endFrame: number) => {
    changeScene((studio) => {
      const current = videoTimelineFor(studio)
      const videoTimeline = resizeTimelineBlock(current, target, startFrame, endFrame, studio.elements.filter((element) => element.kind === 'character').map((element) => element.id))
      return videoTimeline === current ? studio : { ...studio, videoTimeline, updatedAt: new Date().toISOString() }
    })
  }

  const moveVideoCharacterTrack = (elementId: string, direction: -1 | 1) => {
    changeScene((studio) => {
      const timeline = videoTimelineFor(studio)
      const characters = studio.elements.filter((element) => element.kind === 'character')
        .sort((left, right) => (timeline.trackSettings?.[left.id]?.order ?? studio.elements.indexOf(left)) - (timeline.trackSettings?.[right.id]?.order ?? studio.elements.indexOf(right)))
      const index = characters.findIndex((element) => element.id === elementId)
      const next = index + direction
      if (index < 0 || next < 0 || next >= characters.length) return studio
      const moving = characters[index]
      characters[index] = characters[next]
      characters[next] = moving
      const trackSettings = { ...timeline.trackSettings }
      characters.forEach((element, order) => { trackSettings[element.id] = { ...trackSettings[element.id], order } })
      return { ...studio, videoTimeline: { ...timeline, trackSettings }, updatedAt: new Date().toISOString() }
    })
  }

  const openCastPicker = () => {
    setCastSelection(stageCharacters.map((element) => element.characterId).filter((id): id is string => Boolean(id)))
    setCastPickerOpen(true)
  }

  const saveCastSelection = async () => {
    if (!activeStudio || savingCast) return
    setSavingCast(true)
    try {
      const selectedIds = new Set(castSelection)
      const retained = activeStudio.elements.filter((element) => element.kind !== 'character' || !element.characterId || selectedIds.has(element.characterId))
      const removedCharacterAssetIds = new Set(activeStudio.elements.filter((element) => element.kind === 'character' && element.characterId && !selectedIds.has(element.characterId)).map((element) => element.assetId).filter((id): id is string => Boolean(id)))
      const retainedCharacters = new Set(retained.filter((element) => element.kind === 'character').map((element) => element.characterId))
      const additions = availableCharacters.filter((character) => selectedIds.has(character.id) && !retainedCharacters.has(character.id))
      const { renderSavedCharacter } = await import('../customizer/CustomizerPage')
      const assets: StudioAsset[] = []
      const elements: StudioElement[] = []
      const stageWidth = sceneRef.current?.clientWidth ?? 1000
      const stageHeight = sceneRef.current?.clientHeight ?? 562
      let zIndex = Math.max(0, ...retained.map((item) => item.zIndex))
      for (const character of additions) {
        const rendered = await renderSavedCharacter(character, undefined, undefined, 'idle')
        const crop = await trimTransparentImage(rendered.dataUrl)
        const imageData = crop?.dataUrl ?? rendered.dataUrl
        const imageWidth = crop?.width ?? rendered.width
        const imageHeight = crop?.height ?? rendered.height
        const referenceCharacter = character.customization.poseSlot === null ? character : { ...character, customization: { ...character.customization, poseSlot: null } }
        const referenceRendered = referenceCharacter === character ? rendered : await renderSavedCharacter(referenceCharacter, undefined, undefined, 'idle')
        const referenceCrop = referenceCharacter === character ? crop : await trimTransparentImage(referenceRendered.dataUrl)
        const referenceWidth = referenceCrop?.width ?? referenceRendered.width
        const referenceHeight = referenceCrop?.height ?? referenceRendered.height
        const asset: StudioAsset = { id: crypto.randomUUID(), category: 'character', name: character.name, mimeType: 'image/png', dataUrl: imageData }
        const { width, height, characterCanvasWidth } = fitStudioCharacterToStage(referenceRendered, { width: referenceWidth, height: referenceHeight }, rendered, { width: imageWidth, height: imageHeight }, stageWidth, stageHeight)
        assets.push(asset)
        elements.push({ id: crypto.randomUUID(), kind: 'character', assetId: asset.id, characterId: character.id, characterSourceUpdatedAt: character.updatedAt, faceRendererVersion: STUDIO_FACE_RENDER_VERSION, activeExpressionCollectionId: 'standard', activeExpressionPresetId: null, activeFaceMode: 'idle', positionLocked: activeStudio.videoTimeline?.characterPositionsLocked ?? false, characterScale: 100, characterWidthScale: 100, characterHeightScale: 100, ...(character.customization.faceAppearance ? { expressionBase: { appearance: structuredClone(character.customization.faceAppearance), transforms: {} } } : {}), characterCanvasWidth, text: character.name, x: 0, y: 0, width, height, rotation: 0, zIndex: ++zIndex })
      }
      const nextElements = [...retained, ...elements]
      const retainedElementIds = new Set(nextElements.map((element) => element.id))
      const retainedAssetIds = new Set(retained.map((element) => element.assetId).filter((id): id is string => Boolean(id)))
      changeScene((studio) => ({
        ...studio,
        elements: nextElements,
        assets: [...studio.assets.filter((asset) => !removedCharacterAssetIds.has(asset.id) || retainedAssetIds.has(asset.id)), ...assets],
        ...(studio.videoTimeline ? { videoTimeline: { ...studio.videoTimeline,
          trackSettings: Object.fromEntries(Object.entries(studio.videoTimeline.trackSettings ?? {}).filter(([id]) => id === 'speech' || id === 'thought' || retainedElementIds.has(id))),
          characterBases: {
            ...Object.fromEntries(Object.entries(studio.videoTimeline.characterBases ?? {}).filter(([id]) => retainedElementIds.has(id))),
            ...Object.fromEntries(elements.flatMap((element) => {
              const asset = assets.find((item) => item.id === element.assetId)
              return asset ? [[element.id, { element: structuredClone(element), imageDataUrl: asset.dataUrl }]] : []
            }))
          },
          characterPositions: {
            ...Object.fromEntries(Object.entries(studio.videoTimeline.characterPositions ?? {}).filter(([id]) => retainedElementIds.has(id))),
            ...Object.fromEntries(elements.map((element) => [element.id, { x: element.x, y: element.y }]))
          },
          characterTransforms: {
            ...Object.fromEntries(Object.entries(studio.videoTimeline.characterTransforms ?? {}).filter(([id]) => retainedElementIds.has(id))),
            ...Object.fromEntries(elements.map((element) => [element.id, { x: element.x, y: element.y, width: element.width, height: element.height, rotation: element.rotation, flipX: element.flipX, characterScale: element.characterScale, characterWidthScale: element.characterWidthScale, characterHeightScale: element.characterHeightScale, zIndex: element.zIndex }]))
          },
          characterTrackEnds: studio.videoTimeline.characterTrackEnds ? Object.fromEntries(Object.entries(studio.videoTimeline.characterTrackEnds).filter(([id]) => retainedElementIds.has(id))) : undefined,
          characterKeys: studio.videoTimeline.characterKeys.filter((key) => retainedElementIds.has(key.elementId)), textClips: studio.videoTimeline.textClips.filter((clip) => retainedElementIds.has(clip.elementId)) } } : {}),
        updatedAt: new Date().toISOString()
      }))
      setCastPickerOpen(false)
      setActiveTool(null)
      restoreCharacterInspectorView()
      setInspectorOpen(true)
      setSelectedElementId(elements.at(-1)?.id ?? null)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o elenco do Studio.')
    } finally { setSavingCast(false) }
  }

  const applyStudioFaceAppearance = async (appearance: CustomizerFaceAppearance, faceTransforms: StudioFaceTransforms = selectedElement?.faceTransforms ?? {}, record = true, expressionState?: Pick<StudioElement, 'expressionBase' | 'activeExpressionPresetId' | 'activeExpressionPresetUpdatedAt' | 'activeExpressionCollectionId' | 'activeExpressionEffects' | 'activeFaceMode'>) => {
    if (!activeStudio || selectedElement?.kind !== 'character' || !selectedStudioCharacter || !selectedElement.assetId || studioFaceBusy || selectedVideoTrackLocked) return
    setStudioFaceBusy(true)
    try {
      // Cancel queued slider renders and let any in-flight composition finish before
      // reusing its canvas for a new catalog selection.
      studioFaceRenderVersionRef.current += 1
      studioFaceRenderPendingRef.current = null
      if (studioFaceRenderTimerRef.current !== null) {
        window.clearTimeout(studioFaceRenderTimerRef.current)
        studioFaceRenderTimerRef.current = null
      }
      while (studioFaceRenderRunningRef.current) await new Promise((resolve) => window.setTimeout(resolve, 16))
      const characterCopy: CustomizerCharacter = {
        ...selectedStudioCharacter,
        customization: { ...selectedStudioCharacter.customization, poseSlot: selectedElement.poseSlot === undefined ? selectedStudioCharacter.customization.poseSlot : selectedElement.poseSlot, faceAppearance: appearance }
      }
      const key = studioCharacterRenderKey(characterCopy)
      if (!studioFaceRendererRef.current || studioFaceRendererRef.current.key !== key) {
        const { prepareSavedCharacterRenderer } = await import('../customizer/CustomizerPage')
        const renderer = await prepareSavedCharacterRenderer(characterCopy)
        studioFaceRendererRef.current = { key, render: renderer.render }
      }
      const activeEffects = expressionState && Object.hasOwn(expressionState, 'activeExpressionEffects') ? expressionState.activeExpressionEffects : selectedElement.activeExpressionEffects
      const faceMode = expressionState && Object.hasOwn(expressionState, 'activeFaceMode') ? expressionState.activeFaceMode : selectedElement.activeFaceMode
      const rendered = await studioFaceRendererRef.current.render(appearance, faceTransforms, activeEffects, faceMode)
      const trimmed = await trimTransparentImage(rendered.dataUrl)
      const studioDataUrl = trimmed?.dataUrl ?? rendered.dataUrl
      const elementId = selectedElement.id
      const assetId = selectedElement.assetId
      const update = (studio: StudioDocument): StudioDocument => ({
        ...studio,
        elements: studio.elements.map((element) => element.id === elementId ? { ...element, ...expressionState, faceRendererVersion: STUDIO_FACE_RENDER_VERSION, ...faceRenderGeometry(element, rendered, trimmed, sceneRef.current?.clientWidth ?? 1000, sceneRef.current?.clientHeight ?? 562), faceAppearance: appearance, faceTransforms, characterSourceUpdatedAt: selectedStudioCharacter.updatedAt } : element),
        assets: studio.assets.map((asset) => asset.id === assetId ? { ...asset, dataUrl: studioDataUrl, mimeType: 'image/png' } : asset),
        updatedAt: new Date().toISOString()
      })
      if (record) changeScene(update)
      else patchStudio(update)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível aplicar a peça facial neste Studio.')
    } finally { setStudioFaceBusy(false) }
  }

  const applyStudioBaseExpression = async () => {
    const appearance = selectedStudioCharacter?.customization.faceAppearance ?? selectedStudioFaceAppearance
    if (!selectedElement || !appearance || studioExpressionBusy || studioFaceBusy) return
    const faceMode = studioFaceModeForElement(selectedElement, appearance)
    const base = { ...resolveStudioExpressionBase(selectedElement, appearance), appearance: structuredClone(appearance) }
    setStudioExpressionBusy(true)
    try {
      await applyStudioFaceAppearance(base.appearance, base.transforms, true, { expressionBase: base, activeExpressionPresetId: null, activeExpressionPresetUpdatedAt: undefined, activeExpressionCollectionId: selectedStudioExpressionCollectionId, activeExpressionEffects: undefined, activeFaceMode: faceMode })
    } finally { setStudioExpressionBusy(false) }
  }

  const applyStudioExpressionPreset = async (summary: FaceExpressionPresetSummary) => {
    if (!selectedStudioCharacter || !selectedElement || selectedElement.kind !== 'character' || studioExpressionBusy || studioFaceBusy) return
    setStudioExpressionBusy(true)
    setError(null)
    try {
      const preset: FaceExpressionPreset | null = await window.desktop.loadFaceExpressionPreset(summary.modelSlot, summary.id)
      if (!preset || preset.modelSlot !== selectedStudioCharacterModelSlot) throw new Error('Este preset não está disponível para o modelo selecionado.')
      const characterAppearance = selectedStudioCharacter.customization.faceAppearance ?? selectedStudioFaceAppearance
      if (!characterAppearance) throw new Error('A personagem ainda não tem uma aparência facial para ajustar.')
      const faceMode = studioFaceModeForElement(selectedElement, selectedStudioFaceAppearance)
      const base = { ...resolveStudioExpressionBase(selectedElement, characterAppearance), appearance: structuredClone(characterAppearance) }
      const appearance = base.appearance
      let nextAppearance = await buildStudioExpressionAppearance(preset, appearance, (id) => window.desktop.loadFaceCatalogItem(preset.modelSlot, id))
      if (faceMode === 'talk' && selectedStudioOpenMouthId && !nextAppearance.mouthOpenCatalogId) {
        nextAppearance = { ...nextAppearance, mouthOpenCatalogId: selectedStudioOpenMouthId }
      }
      const faceTransforms = await buildStudioExpressionTransforms(
        preset, nextAppearance, base.transforms,
        (id) => window.desktop.loadFaceComponentAsset(preset.modelSlot, id),
        (id) => window.desktop.loadFaceCatalogItem(preset.modelSlot, id)
      )

      await applyStudioFaceAppearance(nextAppearance, faceTransforms, true, { expressionBase: base, activeExpressionPresetId: preset.id, activeExpressionPresetUpdatedAt: preset.updatedAt, activeExpressionCollectionId: preset.collectionId ?? 'standard', activeExpressionEffects: preset.effects, activeFaceMode: faceMode })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível aplicar este preset de expressão.')
    } finally {
      setStudioExpressionBusy(false)
    }
  }

  const applyStudioFaceMode = async (mode: StudioFaceMode) => {
    if (!selectedElement || selectedElement.kind !== 'character' || !selectedStudioFaceAppearance || studioExpressionBusy || studioFaceBusy) return
    const appearance = mode === 'talk' && selectedStudioOpenMouthId && !selectedStudioFaceAppearance.mouthOpenCatalogId
      ? { ...selectedStudioFaceAppearance, mouthOpenCatalogId: selectedStudioOpenMouthId }
      : selectedStudioFaceAppearance
    await applyStudioFaceAppearance(appearance, selectedElement.faceTransforms ?? {}, true, { activeFaceMode: mode })
  }

  const applyStudioPose = async (poseSlot: number | null) => {
    if (!activeStudio || selectedElement?.kind !== 'character' || !selectedStudioCharacter || !selectedElement.assetId || studioFaceBusy || selectedVideoTrackLocked) return
    setStudioFaceBusy(true)
    try {
      const { renderSavedCharacter } = await import('../customizer/CustomizerPage')
      let characterCanvasWidth = selectedElement.characterCanvasWidth
      if (!characterCanvasWidth) {
        const currentPoseCharacter: CustomizerCharacter = { ...selectedStudioCharacter, customization: { ...selectedStudioCharacter.customization, poseSlot: selectedElement.poseSlot === undefined ? selectedStudioCharacter.customization.poseSlot : selectedElement.poseSlot, faceAppearance: selectedElement.faceAppearance ?? selectedStudioCharacter.customization.faceAppearance } }
        const currentRendered = await renderSavedCharacter(currentPoseCharacter, selectedElement.faceTransforms, selectedElement.activeExpressionEffects, selectedElement.activeFaceMode)
        const currentCrop = await trimTransparentImage(currentRendered.dataUrl)
        characterCanvasWidth = selectedElement.width * currentRendered.width / (currentCrop?.width ?? currentRendered.width)
      }
      const characterCopy: CustomizerCharacter = { ...selectedStudioCharacter, customization: { ...selectedStudioCharacter.customization, poseSlot, faceAppearance: selectedElement.faceAppearance ?? selectedStudioCharacter.customization.faceAppearance } }
      const rendered = await renderSavedCharacter(characterCopy, selectedElement.faceTransforms, selectedElement.activeExpressionEffects, selectedElement.activeFaceMode)
      const trimmed = await trimTransparentImage(rendered.dataUrl)
      const dataUrl = trimmed?.dataUrl ?? rendered.dataUrl
      const cropWidth = trimmed?.width ?? rendered.width
      const cropHeight = trimmed?.height ?? rendered.height
      const stageWidth = sceneRef.current?.clientWidth ?? 1000
      const stageHeight = sceneRef.current?.clientHeight ?? 562
      const fullCanvasHeight = characterCanvasWidth * stageWidth / stageHeight * rendered.height / rendered.width
      const width = characterCanvasWidth * cropWidth / rendered.width
      const height = fullCanvasHeight * cropHeight / rendered.height
      const elementId = selectedElement.id
      const assetId = selectedElement.assetId
      changeScene((studio) => ({
        ...studio,
        elements: studio.elements.map((element) => element.id === elementId ? { ...element, poseSlot, characterCanvasWidth, width, height, characterSourceUpdatedAt: selectedStudioCharacter.updatedAt } : element),
        assets: studio.assets.map((asset) => asset.id === assetId ? { ...asset, dataUrl, mimeType: 'image/png' } : asset),
        updatedAt: new Date().toISOString()
      }))
      setError(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível aplicar a pose neste Studio.') }
    finally { setStudioFaceBusy(false) }
  }

  const chooseStudioFaceSheet = async (summary: FaceCatalogItemSummary) => {
    if (!selectedStudioCharacter) return
    const key = `${summary.modelSlot}:${summary.id}`
    const item = studioFaceDetails[key] ?? await window.desktop.loadFaceCatalogItem(summary.modelSlot, summary.id)
    if (!item) return
    setStudioFaceDetails((current) => ({ ...current, [key]: item }))
    const previous = selectedStudioFaceAppearance
    const sameModel = previous?.modelSlot === item.modelSlot
    const field: Record<FaceSheetKind, keyof CustomizerFaceAppearance> = {
      eyes: 'eyeCatalogId', eyebrows: 'eyebrowCatalogId', nose: 'noseCatalogId',
      'mouth-closed': 'mouthClosedCatalogId', 'mouth-open': 'mouthOpenCatalogId'
    }
    const appearance: CustomizerFaceAppearance = {
      ...(sameModel ? previous : undefined),
      modelSlot: item.modelSlot,
      setId: undefined,
      [field[item.category]]: item.id,
      eyeState: sameModel ? previous.eyeState : 0,
      eyebrows: sameModel ? previous.eyebrows : true,
      noseIndex: item.category === 'nose' ? item.selectedNose : sameModel ? previous.noseIndex : item.selectedNose,
      expressionIndex: item.category.startsWith('mouth') ? item.selectedExpression : sameModel ? previous.expressionIndex : item.selectedExpression,
      mouthOpen: item.category === 'mouth-open' ? true : item.category === 'mouth-closed' ? false : sameModel ? previous.mouthOpen : false
    }
    const faceMode = item.category === 'mouth-open' ? 'talk' : item.category === 'mouth-closed' ? 'idle' : selectedElement?.activeFaceMode
    await applyStudioFaceAppearance(appearance, selectedElement?.faceTransforms ?? {}, true, { activeFaceMode: faceMode })
  }

  const updateStudioFaceVariant = (patch: Partial<CustomizerFaceAppearance>) => {
    if (!selectedStudioFaceAppearance || selectedStudioCharacterModelSlot === null) return
    const changesFaceMode = Object.hasOwn(patch, 'mouthOpen') || Object.hasOwn(patch, 'eyeState')
    let faceMode = selectedElement?.activeFaceMode
    if (Object.hasOwn(patch, 'mouthOpen')) faceMode = patch.mouthOpen ? 'talk' : 'idle'
    else if (Object.hasOwn(patch, 'eyeState')) {
      faceMode = patch.eyeState === 2 ? 'blink' : selectedStudioFaceMode === 'talk' ? 'talk' : 'idle'
    }
    void applyStudioFaceAppearance(
      { ...selectedStudioFaceAppearance, ...patch },
      selectedElement?.faceTransforms ?? {},
      true,
      changesFaceMode ? { activeFaceMode: faceMode } : undefined
    )
  }

  const updateStudioFaceTransform = (transformKey: string, patch: Partial<StudioFaceTransform>, record = false, baseTransform = defaultStudioEyeTransform) => {
    if (!selectedElement || selectedElement.kind !== 'character') return
    const saved = studioFaceTransformsRef.current[selectedElement.id] ?? selectedElement.faceTransforms ?? {}
    const transform = { ...(saved[transformKey] ?? baseTransform), ...patch }
    const next = { ...saved, [transformKey]: transform }
    studioFaceTransformsRef.current[selectedElement.id] = next
    updateElement(selectedElement.id, { faceTransforms: next }, record)
    if (selectedStudioCharacter && selectedStudioFaceAppearance && selectedElement.assetId && activeStudioId) {
      const character: CustomizerCharacter = { ...selectedStudioCharacter, customization: { ...selectedStudioCharacter.customization, poseSlot: selectedElement.poseSlot ?? selectedStudioCharacter.customization.poseSlot, faceAppearance: selectedStudioFaceAppearance } }
      scheduleStudioFacePreview({ studioId: activeStudioId, elementId: selectedElement.id, assetId: selectedElement.assetId, character, transforms: next })
    }
  }

  const finishStudioFaceTransform = (transformKey: string) => {
    if (!selectedElement || selectedElement.kind !== 'character') return
    const faceTransforms = studioFaceTransformsRef.current[selectedElement.id] ?? selectedElement.faceTransforms ?? {}
    if (!faceTransforms[transformKey]) return
    flushStudioFacePreview()
  }

  const scheduleStudioFacePreview = (job: NonNullable<typeof studioFaceRenderPendingRef.current>) => {
    studioFaceRenderPendingRef.current = job
    studioFaceRenderVersionRef.current += 1
    if (studioFaceRenderTimerRef.current !== null) return
    studioFaceRenderTimerRef.current = window.setTimeout(() => {
      studioFaceRenderTimerRef.current = null
      void renderPendingStudioFacePreview()
    }, 55)
  }

  const flushStudioFacePreview = () => {
    if (studioFaceRenderTimerRef.current !== null) window.clearTimeout(studioFaceRenderTimerRef.current)
    studioFaceRenderTimerRef.current = null
    void renderPendingStudioFacePreview()
  }

  const renderPendingStudioFacePreview = async () => {
    if (studioFaceRenderRunningRef.current) return
    studioFaceRenderRunningRef.current = true
    try {
      while (studioFaceRenderPendingRef.current) {
        const job = studioFaceRenderPendingRef.current
        studioFaceRenderPendingRef.current = null
        const version = studioFaceRenderVersionRef.current
        const key = studioCharacterRenderKey(job.character)
        try {
          if (!studioFaceRendererRef.current || studioFaceRendererRef.current.key !== key) {
            const { prepareSavedCharacterRenderer } = await import('../customizer/CustomizerPage')
            const renderer = await prepareSavedCharacterRenderer(job.character)
            if (version !== studioFaceRenderVersionRef.current) continue
            studioFaceRendererRef.current = { key, render: renderer.render }
          }
          const element = activeStudio?.elements.find((candidate) => candidate.id === job.elementId)
          const rendered = await studioFaceRendererRef.current.render(job.character.customization.faceAppearance, studioFaceTransformsRef.current[job.elementId] ?? job.transforms, element?.activeExpressionEffects, element?.activeFaceMode)
          const trimmed = await trimTransparentImage(rendered.dataUrl)
          const studioDataUrl = trimmed?.dataUrl ?? rendered.dataUrl
          if (version === studioFaceRenderVersionRef.current && job.studioId === activeStudioId) {
            patchStudio((studio) => ({
              ...studio,
              elements: studio.elements.map((element) => element.id === job.elementId ? { ...element, faceRendererVersion: STUDIO_FACE_RENDER_VERSION, ...faceRenderGeometry(element, rendered, trimmed, sceneRef.current?.clientWidth ?? 1000, sceneRef.current?.clientHeight ?? 562) } : element),
              assets: studio.assets.map((asset) => asset.id === job.assetId ? { ...asset, dataUrl: studioDataUrl, mimeType: 'image/png' } : asset),
              updatedAt: new Date().toISOString()
            }))
          }
        } catch (reason) {
          if (version === studioFaceRenderVersionRef.current && job.studioId === activeStudioId) setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar a prévia facial.')
        }
      }
    } finally {
      studioFaceRenderRunningRef.current = false
    }
    if (studioFaceRenderPendingRef.current && studioFaceRenderTimerRef.current === null) {
      studioFaceRenderTimerRef.current = window.setTimeout(() => {
        studioFaceRenderTimerRef.current = null
        void renderPendingStudioFacePreview()
      }, 0)
    }
  }

  const removeStageCharacter = (element: StudioElement) => {
    changeScene((studio) => {
      const elements = studio.elements.filter((item) => item.id !== element.id)
      const stillUsed = new Set(elements.map((item) => item.assetId).filter(Boolean))
      return {
        ...studio, elements,
        assets: studio.assets.filter((asset) => asset.id !== element.assetId || stillUsed.has(asset.id)),
        ...(studio.videoTimeline ? { videoTimeline: { ...studio.videoTimeline, trackSettings: Object.fromEntries(Object.entries(studio.videoTimeline.trackSettings ?? {}).filter(([id]) => id !== element.id)), characterBases: Object.fromEntries(Object.entries(studio.videoTimeline.characterBases ?? {}).filter(([id]) => id !== element.id)), characterPositions: Object.fromEntries(Object.entries(studio.videoTimeline.characterPositions ?? {}).filter(([id]) => id !== element.id)), characterTransforms: Object.fromEntries(Object.entries(studio.videoTimeline.characterTransforms ?? {}).filter(([id]) => id !== element.id)), characterTrackEnds: studio.videoTimeline.characterTrackEnds ? Object.fromEntries(Object.entries(studio.videoTimeline.characterTrackEnds).filter(([id]) => id !== element.id)) : undefined, characterGaps: studio.videoTimeline.characterGaps?.filter((gap) => gap.elementId !== element.id), characterKeys: studio.videoTimeline.characterKeys.filter((key) => key.elementId !== element.id), textClips: studio.videoTimeline.textClips.filter((clip) => clip.elementId !== element.id) } } : {}),
        updatedAt: new Date().toISOString()
      }
    })
    if (selectedElementId === element.id) setSelectedElementId(null)
  }

  const updateElement = (id: string, values: Partial<StudioElement>, record = true) => {
    const target = activeStudio?.elements.find((element) => element.id === id)
    if (isVideoWorkspace && target && videoTimelineFor(activeStudio!).trackSettings?.[target.kind === 'character' ? id : target.kind]?.locked) return
    const sharedTextTransform = target && (target.kind === 'speech' || target.kind === 'thought')
      ? Object.fromEntries((['x', 'y', 'width', 'height', 'rotation'] as const).filter((key) => Object.hasOwn(values, key)).map((key) => [key, values[key]])) as Partial<Pick<StudioElement, 'x' | 'y' | 'width' | 'height' | 'rotation'>>
      : {}
    const update = (studio: StudioDocument) => {
      const elements = studio.elements.map((element) => element.id === id ? { ...element, ...values } : element)
      if (!isVideoWorkspace || !target || (target.kind !== 'speech' && target.kind !== 'thought') || !Object.keys(sharedTextTransform).length) return { ...studio, elements, updatedAt: new Date().toISOString() }
      const timeline = videoTimelineFor(studio)
      const baseElement = studio.elements.find((element) => element.id === id) ?? target
      const textClips = timeline.textClips.map((clip) => clip.elementId === id
        ? { ...clip, state: { ...baseElement, ...clip.state, ...sharedTextTransform } }
        : clip)
      return { ...studio, elements, videoTimeline: { ...timeline, textClips }, updatedAt: new Date().toISOString() }
    }
    if (record) changeScene(update)
    else patchStudio(update)
  }

  const updateBackground = (values: Partial<Pick<StudioDocument, 'backgroundColor' | 'backgroundX' | 'backgroundY' | 'backgroundWidth' | 'backgroundHeight' | 'backgroundRotation'>>, record = true) => {
    const update = (studio: StudioDocument) => ({ ...studio, ...values, updatedAt: new Date().toISOString() })
    if (record) changeScene(update)
    else patchStudio(update)
  }

  const startDrag = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (!activeStudio || !sceneRef.current || fullView) return
    event.preventDefault()
    event.stopPropagation()
    if (id === 'background') {
      const rect = sceneRef.current.getBoundingClientRect()
      recordHistory()
      setSelectedElementId('background')
      setActiveTool('background')
      setInspectorOpen(true)
      setInspectorTab('editor')
      dragRef.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originalX: activeStudio.backgroundX, originalY: activeStudio.backgroundY, width: rect.width, height: rect.height }
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    const element = activeStudio.elements.find((item) => item.id === id)
    if (!element) return
    if (isVideoWorkspace && videoTimelineFor(activeStudio).trackSettings?.[element.kind === 'character' ? id : element.kind]?.locked) return
    if (element.kind === 'character' && element.positionLocked) {
      setSelectedElementId(id)
      setActiveTool(null)
      setInspectorOpen(true)
      restoreCharacterInspectorView()
      return
    }
    const rect = sceneRef.current.getBoundingClientRect()
    recordHistory()
    setSelectedElementId(id)
    setActiveTool(null)
    setInspectorOpen(true)
    if (element.kind === 'character') restoreCharacterInspectorView()
    else setInspectorTab('editor')
    dragRef.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originalX: element.x, originalY: element.y, width: rect.width, height: rect.height }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const x = drag.originalX + (event.clientX - drag.startX) / drag.width * 100
    const y = drag.originalY + (event.clientY - drag.startY) / drag.height * 100
    if (drag.id === 'background') patchStudio((studio) => ({ ...studio, backgroundX: x, backgroundY: y, updatedAt: new Date().toISOString() }))
    else updateElement(drag.id, { x, y }, false)
  }

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
  }

  const deleteSelected = () => {
    if (!activeStudio) return
    if (selectedElementId === 'background') {
      changeScene((studio) => ({ ...studio, backgroundAssetId: null, updatedAt: new Date().toISOString() }))
      setSelectedElementId(null)
    } else if (selectedElementId) {
      const current = activeStudio.elements.find((element) => element.id === selectedElementId)
      if (current?.kind === 'character') removeStageCharacter(current)
      else changeScene((studio) => ({ ...studio, elements: studio.elements.filter((element) => element.id !== selectedElementId), ...(studio.videoTimeline ? { videoTimeline: { ...studio.videoTimeline, trackSettings: Object.fromEntries(Object.entries(studio.videoTimeline.trackSettings ?? {}).filter(([id]) => id !== selectedElementId)), characterBases: Object.fromEntries(Object.entries(studio.videoTimeline.characterBases ?? {}).filter(([id]) => id !== selectedElementId)), characterPositions: Object.fromEntries(Object.entries(studio.videoTimeline.characterPositions ?? {}).filter(([id]) => id !== selectedElementId)), characterTransforms: Object.fromEntries(Object.entries(studio.videoTimeline.characterTransforms ?? {}).filter(([id]) => id !== selectedElementId)), characterTrackEnds: studio.videoTimeline.characterTrackEnds ? Object.fromEntries(Object.entries(studio.videoTimeline.characterTrackEnds).filter(([id]) => id !== selectedElementId)) : undefined, characterGaps: studio.videoTimeline.characterGaps?.filter((gap) => gap.elementId !== selectedElementId), characterKeys: studio.videoTimeline.characterKeys.filter((key) => key.elementId !== selectedElementId), textClips: studio.videoTimeline.textClips.filter((clip) => clip.elementId !== selectedElementId) } } : {}), updatedAt: new Date().toISOString() }))
      setSelectedElementId(null)
    }
  }

  const deleteStudio = async (target: VideoStudioCardSummary | null = selectedStudio) => {
    if (!target || !window.confirm(`Excluir ${target.title}?`)) return
    try {
      await persistence.delete(target.id)
      setStudios((current) => current.filter((studio) => studio.id !== target.id))
      setStudioCards((current) => current.filter((studio) => studio.id !== target.id))
      setSelectedId((current) => current === target.id ? null : current)
      setSaved(true)
      setError(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível excluir o Studio.') }
  }

  const leaveStudio = async () => {
    if (!await saveStudio(activeStudio)) return
    editHistoryRef.current.reset(null)
    refreshHistoryControls()
    setActiveStudioId(null)
    setActiveTool(null)
    setSelectedElementId(null)
    exitFullView()
  }

  const startVideoExport = async () => {
    if (!activeStudio || exportPreparing || (exportProgress && !['done', 'failed', 'cancelled'].includes(exportProgress.stage))) return
    setExportPreparing(true)
    setError(null)
    setNotice(exportVariant === 'animated' ? 'Preparando personagens e dependências do vídeo…' : 'Preparando exportação sem animações…')
    try {
      if (!await saveStudio(activeStudio)) return
      const characterAssets = exportVariant === 'animated'
        ? await captureVideoCharacterRenderAssets(activeStudio, availableCharacters, window.desktop, {
            onProgress: (completed, total) => setNotice(total > 0 ? `Preparando personagens… ${completed}/${total}` : 'Preparando personagens…')
          })
        : createVideoCharacterRenderAssetSnapshot([])
      const started = await window.desktop.startVideoExport({
        studio: structuredClone(activeStudio),
        characters: structuredClone(availableCharacters),
        characterAssets,
        renderVariant: exportVariant,
      })
      setActiveExportJobId(started.jobId)
      setExportProgress(await window.desktop.getVideoExportStatus(started.jobId))
      setNotice(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível iniciar a exportação.')
    } finally {
      setExportPreparing(false)
    }
  }

  const cancelVideoExport = async () => {
    if (!activeExportJobId) return
    try { await window.desktop.cancelVideoExport(activeExportJobId) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível cancelar a exportação.') }
  }

  useEffect(() => window.desktop.onVideoExportProgress((progress) => {
    setActiveExportJobId((jobId) => {
      if (jobId && jobId !== progress.jobId) return jobId
      setExportProgress(progress)
      if (progress.stage === 'done') {
        setNotice('Vídeo exportado e verificado.')
        setExportDialogOpen(true)
      } else if (progress.stage === 'failed') {
        setError(progress.message ?? 'A exportação falhou.')
        setExportDialogOpen(true)
      } else if (progress.stage === 'cancelled') {
        setNotice('Exportação cancelada.')
      }
      return progress.jobId
    })
  }), [])

  useEffect(() => {
    if (!exportDialogOpen) return
    let cancelled = false
    void window.desktop.listRecoverableVideoExports()
      .then((records) => { if (!cancelled) setExportRecoveries(records) })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível listar exports interrompidos.') })
    return () => { cancelled = true }
  }, [exportDialogOpen, exportProgress?.stage])

  const resumeVideoExport = async (recovery: VideoExportRecoveryRecord) => {
    if (exportRecoveryBusy || (exportProgress && !['done', 'failed', 'cancelled'].includes(exportProgress.stage))) return
    setExportRecoveryBusy(recovery.jobId)
    setError(null)
    try {
      const result = await window.desktop.resumeVideoExport(recovery.jobId)
      setActiveExportJobId(result.jobId)
      setExportProgress(await window.desktop.getVideoExportStatus(result.jobId))
      setExportRecoveries((current) => current.filter((item) => item.jobId !== recovery.jobId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível retomar a exportação.')
    } finally {
      setExportRecoveryBusy(null)
    }
  }

  const discardVideoExportRecovery = async (recovery: VideoExportRecoveryRecord) => {
    if (exportRecoveryBusy) return
    setExportRecoveryBusy(recovery.jobId)
    setError(null)
    try {
      await window.desktop.discardVideoExportRecovery(recovery.jobId)
      setExportRecoveries((current) => current.filter((item) => item.jobId !== recovery.jobId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível descartar a recuperação.')
    } finally {
      setExportRecoveryBusy(null)
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (videoLibraryOpen || backgroundLibraryOpen) return
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input:not([type="range"]), textarea, select, [role="dialog"]'))) return
      if (event.key === 'Escape' && castPickerOpen && !savingCast) setCastPickerOpen(false)
      else if (event.key === 'Escape' && fullView) exitFullView()
      if (castPickerOpen) return
      if (fullView && !event.ctrlKey && !event.metaKey && !event.altKey && !(target instanceof HTMLElement && target.closest('button, input'))) {
        if (event.code === 'Space') { event.preventDefault(); toggleVideoPlayback(); return }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); seekVideoFrame(videoPlayheadFrame + (event.key === 'ArrowRight' ? 300 : -300)); return }
        if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); seekVideoFrame(event.key === 'Home' ? 0 : activeStudio?.videoTimeline?.durationFrames ?? 0); return }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [castPickerOpen, savingCast, studioFaceBusy, studioExpressionBusy, fullView, activeStudio, videoPlayheadFrame, videoPlaying, animationPreparing, historyVersion, videoLibraryOpen, backgroundLibraryOpen, exitFullView])

  const imageStyle = videoStageCssTransform

  const control = (label: string, value: number, onChange: (value: number, record?: boolean) => void, min: number, max: number, suffix = '%', onFinish?: () => void, disabled = false) => (
    <StudioNumericControl key={label} label={label} value={value} onChange={onChange} onStart={recordHistory} onFinish={onFinish} disabled={disabled} min={min} max={max} suffix={suffix} />
  )

  const propertyPanel = (): ReactNode => {
    if (!activeStudio) return null
    if (selectedVideoClip) {
      const transform = selectedVideoClip.transform ?? defaultVideoTransform
      const locked = videoTimelineFor(activeStudio).trackSettings?.video?.locked === true
      const update = (values: Partial<typeof transform>, record = true) => updateVideoMediaClip({ ...selectedVideoClip, transform: { ...transform, ...values } }, record)
      return <div className="video-studio-side-content">
        <h2>Vídeo selecionado</h2><p>{videoTimelineFor(activeStudio).videoAssets?.find((asset) => asset.id === selectedVideoClip.assetId)?.name}</p>
        {locked && <small>Desbloqueie a faixa de vídeo para editar.</small>}
        <div className="video-studio-controls-grid">
          {control('X', transform.x, (value, record) => update({ x: value }, record), -300, 300, '%', undefined, locked)}
          {control('Y', transform.y, (value, record) => update({ y: value }, record), -300, 300, '%', undefined, locked)}
          {control('Largura', transform.width, (value, record) => update({ width: value }, record), 1, 300, '%', undefined, locked)}
          {control('Altura', transform.height, (value, record) => update({ height: value }, record), 1, 300, '%', undefined, locked)}
          {control('Rotação', transform.rotation, (value, record) => update({ rotation: value }, record), -180, 180, '°', undefined, locked)}
        </div>
        <button type="button" className="video-studio-side-primary" disabled={locked} onClick={() => updateVideoMediaClip({ ...selectedVideoClip, transform: { ...defaultVideoTransform } })}>Restaurar enquadramento</button>
        <button type="button" className="video-studio-side-danger" disabled={locked} onClick={() => deleteVideoMediaClip(selectedVideoClip.id)}><Icon name="trash" />Excluir este trecho</button>
      </div>
    }
    if (activeTool === 'objects') return <div className="video-studio-side-content">
      <h2>Objetos</h2><p>Imagens importadas ficam disponíveis neste Studio.</p>
      <button className="video-studio-side-primary" type="button" onClick={() => void importImage('object')}><Icon name="plus" />Importar imagem</button>
      <div className="video-studio-asset-grid">{activeStudio.assets.filter((asset) => asset.category === 'object').map((asset) => <button key={asset.id} className="video-studio-asset-card" type="button" onClick={() => {
        const element: StudioElement = { id: crypto.randomUUID(), kind: 'image', assetId: asset.id, text: '', x: 0, y: 0, width: 25, height: 25, rotation: 0, zIndex: Math.max(0, ...activeStudio.elements.map((item) => item.zIndex)) + 1 }
        changeScene((studio) => ({ ...studio, elements: [...studio.elements, element], updatedAt: new Date().toISOString() }))
        setSelectedElementId(element.id)
        setInspectorOpen(true)
        setInspectorTab('editor')
      }}><img src={asset.dataUrl} alt="" /><span>{asset.name}</span></button>)}</div>
      {selectedElementId && selectedElement && <ElementControls element={selectedElement} update={(values, record) => updateElement(selectedElement.id, values, record)} remove={deleteSelected} control={control} />}
    </div>
    if (selectedElement && activeStudio) return <div className="video-studio-side-content">
      <h2>{selectedElement.kind === 'character' ? selectedElement.text : selectedElement.kind === 'image' ? 'Objeto selecionado' : selectedElement.kind === 'narrator' ? 'Narrador' : selectedElement.kind === 'speech' ? 'Balão de fala' : 'Balão de pensamento'}</h2>
      {isVideoWorkspace && selectedElement.kind === 'character' && <label className="video-studio-color-control video-track-color-control">Cor da faixa<input aria-label={`Cor da faixa de ${selectedElement.text}`} type="color" value={videoCharacterTrackColor(selectedElement.id, selectedElement.timelineColor)} onChange={(event) => updateElement(selectedElement.id, { timelineColor: event.currentTarget.value })} /></label>}
      {selectedElement.kind !== 'image' && selectedElement.kind !== 'character' && <label className="video-studio-text-control">Texto<textarea value={selectedElement.text} onChange={(event) => updateElement(selectedElement.id, { text: event.target.value })} rows={3} /></label>}
      <ElementControls element={selectedElement} update={(values, record) => updateElement(selectedElement.id, values, record)} remove={deleteSelected} control={control} />
    </div>
    if (selectedElementId === 'background' && selectedBackgroundAsset) return <div className="video-studio-side-content">
      <h2>Imagem de fundo</h2><p>{selectedBackgroundAsset.name}</p>
      <label className="video-studio-color-control">Cor sólida<input type="color" value={activeStudio.backgroundColor} onChange={(event) => updateBackground({ backgroundColor: event.target.value })} /></label>
      <div className="video-studio-controls-grid">{control('X', activeStudio.backgroundX, (value, record) => updateBackground({ backgroundX: value }, record), -100, 100)}{control('Y', activeStudio.backgroundY, (value, record) => updateBackground({ backgroundY: value }, record), -100, 100)}{control('Largura', activeStudio.backgroundWidth, (value, record) => updateBackground({ backgroundWidth: value }, record), 1, 300)}{control('Altura', activeStudio.backgroundHeight, (value, record) => updateBackground({ backgroundHeight: value }, record), 1, 300)}{control('Rotação', activeStudio.backgroundRotation, (value, record) => updateBackground({ backgroundRotation: value }, record), -180, 180, '°')}</div>
      <button className="video-studio-side-danger" type="button" onClick={deleteSelected}><Icon name="trash" />Remover fundo</button>
    </div>
    return <div className="video-studio-side-content"><h2>Cena</h2><p>Escolha uma ferramenta à esquerda ou selecione um elemento na cena.</p><small>{activeStudio.elements.length} elemento(s)</small></div>
  }

  const customPanel = (): ReactNode => {
    if (!selectedStudioCharacter || selectedElement?.kind !== 'character' || selectedStudioCharacterModelSlot === null) {
      return <div className="video-studio-custom-empty"><strong>Personalizar personagem</strong><span>Selecione um personagem na prévia ou no elenco para escolher as peças do rosto.</span></div>
    }
    const sheetKind: FaceSheetKind = studioFaceCategory === 'mouth'
      ? selectedStudioFaceMode === 'talk' ? 'mouth-open' : 'mouth-closed'
      : studioFaceCategory
    const selectedItemId = sheetKind === 'eyes' ? selectedStudioFaceAppearance?.eyeCatalogId
      : sheetKind === 'eyebrows' ? selectedStudioFaceAppearance?.eyebrowCatalogId
        : sheetKind === 'nose' ? selectedStudioFaceAppearance?.noseCatalogId
          : sheetKind === 'mouth-open' ? selectedStudioFaceAppearance?.mouthOpenCatalogId ?? selectedStudioOpenMouthId
            : selectedStudioFaceAppearance?.mouthClosedCatalogId
    const activeItem = selectedItemId ? studioFaceDetails[`${selectedStudioCharacterModelSlot}:${selectedItemId}`] : null
    const studioTransformKey = studioFaceCategory === 'mouth' ? 'mouth' : selectedItemId ? `${sheetKind}:${selectedItemId}` : studioFaceCategory
    const legacyMouthTransform = selectedStudioFaceAppearance?.mouthClosedCatalogId
      ? selectedElement.faceTransforms?.[`mouth-closed:${selectedStudioFaceAppearance.mouthClosedCatalogId}`]
      : selectedStudioFaceAppearance?.mouthOpenCatalogId
        ? selectedElement.faceTransforms?.[`mouth-open:${selectedStudioFaceAppearance.mouthOpenCatalogId}`]
        : undefined
    const selectedStudioFaceTransform = selectedElement.faceTransforms?.[studioTransformKey]
      ?? (studioFaceCategory === 'mouth' ? (selectedItemId ? selectedElement.faceTransforms?.[`${sheetKind}:${selectedItemId}`] : undefined) ?? legacyMouthTransform : undefined)
      ?? selectedElement.faceTransforms?.[studioFaceCategory]
      ?? defaultStudioEyeTransform
    const catalogItems = studioFaceItems.filter((item) => item.category === sheetKind)
    const renderPair = (pieces: FaceCatalogItem['pieces']) => pieces.slice(0, 2).map((piece) => <img key={piece.id} src={piece.dataUrl} alt="" />)
    const categoryButtons = [
      { id: 'eyes', label: 'Olhos' }, { id: 'eyebrows', label: 'Sobrancelhas' },
      { id: 'nose', label: 'Nariz' }, { id: 'mouth', label: 'Boca' }
    ] as const
    return <div className="video-studio-custom-face">
      <div className="video-studio-custom-face-categories" aria-label="Categorias do rosto">
        {categoryButtons.map((category) => <button key={category.id} className={studioFaceCategory === category.id ? 'active' : ''} onClick={() => setStudioFaceCategory(category.id)} type="button">{category.label}</button>)}
      </div>
      {studioFaceCategory === 'mouth' && <div className="video-studio-custom-mouth-tabs"><button className={selectedStudioFaceMode !== 'talk' ? 'active' : ''} onClick={() => void applyStudioFaceMode('idle')} disabled={!selectedStudioFaceAppearance || studioFaceBusy || studioExpressionBusy} type="button">Fechada</button><button className={selectedStudioFaceMode === 'talk' ? 'active' : ''} onClick={() => void applyStudioFaceMode('talk')} disabled={!selectedStudioFaceAppearance || studioFaceBusy || studioExpressionBusy || !selectedStudioTalkAvailable} type="button">Aberta</button></div>}
      <label className="video-studio-custom-eye-sheet-select"><span>{studioFaceCategory === 'eyes' ? 'Folha de olhos' : studioFaceCategory === 'eyebrows' ? 'Folha de sobrancelhas' : studioFaceCategory === 'nose' ? 'Folha de nariz' : 'Folha de boca'}</span><select value={selectedItemId ?? ''} onChange={(event) => { const summary = catalogItems.find((item) => item.id === event.target.value); if (summary) void chooseStudioFaceSheet(summary) }} disabled={studioFaceBusy || studioFaceLoading}><option value="">Selecione uma folha</option>{catalogItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {studioFaceLoading && <p className="video-studio-custom-hint">Carregando catálogo facial…</p>}
      {studioFaceCategory === 'eyebrows' && selectedStudioFaceAppearance?.eyebrowCatalogId && <button className={`video-studio-custom-toggle${selectedStudioFaceAppearance.eyebrows ? ' active' : ''}`} onClick={() => updateStudioFaceVariant({ eyebrows: !selectedStudioFaceAppearance.eyebrows })} disabled={studioFaceBusy} type="button">{selectedStudioFaceAppearance.eyebrows ? 'Ocultar sobrancelhas' : 'Mostrar sobrancelhas'}</button>}
      {sheetKind === 'eyes' && <>
        {activeItem ? <div className="video-studio-custom-face-variants">{[0, 1, 2].map((index) => {
          const pieces = activeItem.pieces.filter((piece) => piece.index === index)
          const labels = ['Direita', 'Esquerda', 'Fechados']
          const displayedEyeState = selectedStudioFaceMode === 'blink' ? 2 : selectedStudioFaceAppearance?.eyeState === 1 ? 1 : 0
          return <button className={(displayedEyeState === index ? 'selected' : '')} key={index} onClick={() => updateStudioFaceVariant({ eyeState: index as 0 | 1 | 2 })} disabled={studioFaceBusy} type="button"><span>{renderPair(pieces)}</span><b>{labels[index]}</b></button>
        })}</div> : <p className="video-studio-custom-hint">Escolha uma folha de olhos para ver as três variantes.</p>}
      </>}
      {activeItem && <>
        {sheetKind === 'nose' && <div className="video-studio-custom-face-variants video-studio-custom-face-grid">{activeItem.pieces.map((piece) => <button className={(selectedStudioFaceAppearance?.noseIndex === piece.index ? 'selected' : '')} key={piece.id} onClick={() => updateStudioFaceVariant({ noseIndex: piece.index })} disabled={studioFaceBusy} type="button"><span><img src={piece.dataUrl} alt="" /></span><b>{piece.index + 1}</b></button>)}</div>}
        {sheetKind.startsWith('mouth') && <div className="video-studio-custom-face-variants video-studio-custom-face-grid">{activeItem.pieces.map((piece) => <button className={(selectedStudioFaceAppearance?.expressionIndex === piece.index ? 'selected' : '')} key={piece.id} onClick={() => updateStudioFaceVariant({ expressionIndex: piece.index })} disabled={studioFaceBusy} type="button"><span><img src={piece.dataUrl} alt="" /></span><b>{String(piece.index + 1).padStart(2, '0')}</b></button>)}</div>}
      </>}
      <div className="video-studio-controls-grid video-studio-custom-eye-controls">
        {control('X', selectedStudioFaceTransform.x, (value, record) => updateStudioFaceTransform(studioTransformKey, { x: value }, record, selectedStudioFaceTransform), -100, 100, '%', () => finishStudioFaceTransform(studioTransformKey), studioFaceBusy)}
        {control('Y', selectedStudioFaceTransform.y, (value, record) => updateStudioFaceTransform(studioTransformKey, { y: value }, record, selectedStudioFaceTransform), -100, 100, '%', () => finishStudioFaceTransform(studioTransformKey), studioFaceBusy)}
        {control('Largura', selectedStudioFaceTransform.width, (value, record) => updateStudioFaceTransform(studioTransformKey, { width: value }, record, selectedStudioFaceTransform), 1, 300, '%', () => finishStudioFaceTransform(studioTransformKey), studioFaceBusy)}
        {control('Altura', selectedStudioFaceTransform.height, (value, record) => updateStudioFaceTransform(studioTransformKey, { height: value }, record, selectedStudioFaceTransform), 1, 300, '%', () => finishStudioFaceTransform(studioTransformKey), studioFaceBusy)}
        {control('Rotação', selectedStudioFaceTransform.rotation, (value, record) => updateStudioFaceTransform(studioTransformKey, { rotation: value }, record, selectedStudioFaceTransform), -180, 180, '°', () => finishStudioFaceTransform(studioTransformKey), studioFaceBusy)}
      </div>
      {studioFaceBusy && <p className="video-studio-custom-hint" role="status">Atualizando personagem…</p>}
    </div>
  }

  const presetsPanel = (): ReactNode => {
    const presetOptions = [
      { id: 'pose' as const, label: 'Pose', icon: 'frame' },
      { id: 'expression' as const, label: 'Expressão', icon: 'face' },
      { id: 'reserved-1', label: 'Em breve', icon: 'sparkles' },
      { id: 'reserved-2', label: 'Em breve', icon: 'sparkles' },
      { id: 'reserved-3', label: 'Em breve', icon: 'sparkles' },
      { id: 'reserved-4', label: 'Em breve', icon: 'sparkles' }
    ] as const
    if (!selectedStudioCharacter || selectedElement?.kind !== 'character') return <div className="video-studio-custom-empty"><strong>Presets</strong><span>Selecione um personagem na cena para ver poses e expressões.</span></div>
    return <div className="video-studio-presets-panel">
      <div className="video-studio-preset-buttons" aria-label="Categorias de presets">
        {presetOptions.map((option) => <button key={option.id} className={`video-studio-preset-button${option.id === studioPresetCategory ? ' active' : ''}${option.id.startsWith('reserved') ? ' reserved' : ''}`} disabled={option.id.startsWith('reserved')} onClick={() => { if (option.id === 'pose') { setStudioPresetCategory('pose') } else if (option.id === 'expression') setStudioPresetCategory('expression') }} type="button"><Icon name={option.icon} /><span>{option.label}</span></button>)}
      </div>
        {studioPresetCategory === 'pose' && <section className="video-studio-preset-catalog" aria-label="Catálogo de poses">
        <h3>Poses do modelo</h3>
        <div className="video-studio-preset-list">
          {studioPoseSlots.filter((pose): pose is NonNullable<FabricatorPoseSummary> => pose !== null).map((pose) => {
            const dimensions = studioPoseDimensions[pose.slot]
            return <button className={`video-studio-pose-option${selectedStudioPoseSlot === pose.slot ? ' selected' : ''}`} key={pose.slot} onClick={() => void applyStudioPose(pose.slot)} disabled={studioFaceBusy} aria-label={`Selecionar pose ${pose.name}`} title={pose.name} style={dimensions ? { aspectRatio: `${dimensions.width}/${dimensions.height}` } : undefined} type="button">{studioPoseThumbnails[pose.slot] ? <img src={studioPoseThumbnails[pose.slot]} alt="" /> : <span className="video-studio-pose-thumb-placeholder" />}</button>
          })}
          {!studioPoseSlots.length && <p className="video-studio-custom-hint">Este modelo ainda não tem poses salvas.</p>}
        </div>
      </section>}
      {studioPresetCategory === 'expression' && <section className="video-studio-expression-catalog" aria-label="Presets do Expressão Dev">
        {studioExpressionLoading ? <p className="video-studio-custom-hint">Carregando conjuntos de expressão…</p> : <>
          <div className="video-studio-expression-modes" role="group" aria-label="Estado facial do personagem">
            {([{ id: 'idle', label: 'Idle' }, { id: 'blink', label: 'Blink' }, { id: 'talk', label: 'Talk' }] as const).map((mode) => <button key={mode.id} className={`video-studio-expression-mode${selectedStudioFaceMode === mode.id ? ' active' : ''}`} type="button" aria-pressed={selectedStudioFaceMode === mode.id} disabled={studioExpressionBusy || studioFaceBusy || !selectedStudioFaceAppearance || mode.id === 'talk' && !selectedStudioTalkAvailable} onClick={() => void applyStudioFaceMode(mode.id)}>{mode.label}</button>)}
          </div>
          <div className="video-studio-expression-collections" aria-label="Selecionar conjunto de expressão">
            <button className="video-studio-expression-collection-button" type="button" aria-expanded={studioExpressionCollectionMenuOpen} onClick={() => setStudioExpressionCollectionMenuOpen((open) => !open)}>
              <strong>{[{ id: 'standard', name: 'Padrão' }, ...studioExpressionCollections].find((item) => item.id === selectedStudioExpressionCollectionId)?.name ?? 'Escolher conjunto'}</strong><Icon name="chevronDown" />
            </button>
            {studioExpressionCollectionMenuOpen && <div className="video-studio-expression-collection-options" role="listbox" aria-label="Conjuntos disponíveis">
              {[{ id: 'standard', name: 'Padrão' }, ...studioExpressionCollections].map((collection) => {
                const selected = selectedStudioExpressionCollectionId === collection.id
                return <button className={`video-studio-expression-collection-option${selected ? ' selected' : ''}`} key={collection.id} type="button" role="option" aria-selected={selected} onClick={() => { updateElement(selectedElement.id, { activeExpressionCollectionId: collection.id }); setStudioExpressionCollectionMenuOpen(false) }}>
                  <span>{collection.name}</span>{selected && <Icon name="check" />}
                </button>
              })}
            </div>}
          </div>
          {selectedStudioExpressionCollectionId ? (() => {
            const expressions = studioExpressionPresets
              .filter((preset) => preset.collectionId === selectedStudioExpressionCollectionId && Number.isInteger(preset.expressionIndex))
              .sort((a, b) => a.expressionIndex! - b.expressionIndex!)
            return <div className="video-studio-expression-selected">
              <div className="video-studio-expression-list">
                <button className={`video-studio-expression-option${!selectedElement.activeExpressionPresetId ? ' selected' : ''}`} type="button" onClick={() => void applyStudioBaseExpression()} disabled={studioExpressionBusy || studioFaceBusy} aria-pressed={!selectedElement.activeExpressionPresetId}><b>•</b><span>Base</span></button>
                {expressions.map((preset) => <button className={`video-studio-expression-option${selectedElement.activeExpressionPresetId === preset.id ? ' selected' : ''}`} key={preset.id} type="button" aria-pressed={selectedElement.activeExpressionPresetId === preset.id} onClick={() => void applyStudioExpressionPreset(preset)} disabled={studioExpressionBusy || studioFaceBusy}>
                  <b>{String((preset.expressionIndex ?? 0) + 1).padStart(2, '0')}</b><span>{preset.name}</span>
                </button>)}
                {!expressions.length && <p className="video-studio-custom-hint">Nenhuma expressão salva neste conjunto. Salve expressões no Expressão Dev para listá-las aqui.</p>}
              </div>
            </div>
          })() : <p className="video-studio-custom-hint">Selecione um conjunto para ver as expressões disponíveis.</p>}
          {(studioExpressionBusy || studioFaceBusy) && <p className="video-studio-custom-hint" role="status">Aplicando expressão…</p>}
        </>}
      </section>}
    </div>
  }

  if (activeStudio) {
    const backgroundAsset = activeStudio.assets.find((asset) => asset.id === activeStudio.backgroundAssetId)
    return (
      <main ref={surfaceRef} className={`video-studio-editor${isVideoWorkspace ? ' video-workspace' : ''}${inspectorOpen && !fullView ? ' inspector-open' : ''}${fullView ? ' full-view' : ''}`} aria-label={`Editor do ${activeStudio.title}`} style={videoEditorStyle}>
        {fullView && <header className="video-preview-header"><span>{activeStudio.title}</span><button type="button" className="video-preview-exit-fullscreen" onClick={exitFullView} aria-label="Sair da tela cheia" title="Sair da tela cheia (Esc)"><Icon name="expand" /></button></header>}
        {!fullView && <aside className="video-studio-editor-rail video-studio-editor-left" aria-label={`Ferramentas do ${workspaceTitle}`}>
          <div className="video-studio-editor-quick-actions">
            <button className="video-studio-round-action video-studio-exit-action" onClick={() => void leaveStudio()} title="Salvar automaticamente e voltar" aria-label={`Voltar para Seus ${workspacePlural}`} type="button"><span>×</span></button>
            <button className="video-studio-round-action" onClick={() => void saveStudio(activeStudio)} title="Salvar agora no computador" aria-label={`Salvar ${workspaceTitle}`} type="button"><Icon name="save" /></button>
          </div>
          <div className="video-studio-editor-quick-actions video-studio-history-actions">
            <button className="video-studio-round-action" disabled={!canUndo || studioFaceBusy || studioExpressionBusy || savingCast} onClick={undo} title="Desfazer (Ctrl+Z)" aria-label="Desfazer" type="button"><Icon name="undo" /></button>
            <button className="video-studio-round-action" disabled={!canRedo || studioFaceBusy || studioExpressionBusy || savingCast} onClick={redo} title="Refazer (Ctrl+Y)" aria-label="Refazer" type="button"><Icon name="redo" /></button>
          </div>
          <nav className="video-studio-tool-list" aria-label="Ferramentas da cena">
            <button className="video-studio-tool-button video-studio-cast-tool-button" onClick={openCastPicker} type="button" aria-haspopup="dialog" aria-expanded={castPickerOpen}><Icon name="user" /><span>Elenco</span><i aria-hidden="true">{stageCharacters.length}</i></button>
            {studioTools.map((tool) => <button className={`video-studio-tool-button${activeTool === tool.id ? ' active' : ''}`} key={tool.id} onClick={() => {
              if (tool.id === 'background') { setActiveTool(null); void openBackgroundLibrary(); return }
              setActiveTool(tool.id); setInspectorOpen(true); setInspectorTab('editor')
            }} type="button"><Icon name={tool.icon} /><span>{tool.label}</span><i aria-hidden="true">✦</i></button>)}
            <button className="video-studio-tool-button" onClick={() => addTextElement('narrator')} type="button"><Icon name="message" /><span>Narrador</span><i aria-hidden="true">✦</i></button>
            <button className="video-studio-tool-button" onClick={() => addTextElement('speech')} disabled={selectedElement?.kind !== 'character'} title={selectedElement?.kind === 'character' ? `Criar fala de ${selectedElement.text}` : 'Selecione um personagem para criar uma fala'} type="button"><Icon name="message" /><span>Fala</span><i aria-hidden="true">✦</i></button>
            <button className="video-studio-tool-button" onClick={() => addTextElement('thought')} disabled={selectedElement?.kind !== 'character'} title={selectedElement?.kind === 'character' ? `Criar pensamento de ${selectedElement.text}` : 'Selecione um personagem para criar um pensamento'} type="button"><Icon name="face" /><span>Pensamento</span><i aria-hidden="true">✦</i></button>
            <span className="video-studio-tool-separator" />
            <button className="video-studio-tool-button video-studio-export-button" onClick={() => setExportDialogOpen(true)} type="button"><Icon name="download" /><span>Exportar vídeo</span><i aria-hidden="true">▶</i></button>
            <button className="video-studio-tool-button video-studio-view-button" onClick={() => enterFullView()} type="button"><Icon name="expand" /><span>View</span></button>
          </nav>
          <small className={`video-studio-save-indicator${saved ? '' : ' unsaved'}`}><i />{saved ? 'Salvo automaticamente' : 'Salvando alterações…'}</small>
          {error && <small className="video-studio-error-message" role="alert">{error}</small>}
          {notice && <small className="video-studio-save-notice" role="status">{notice}</small>}
        </aside>}
        {!fullView && inspectorOpen && <aside className="video-studio-inspector" aria-label="Inspector da cena" onPointerDown={(event) => event.stopPropagation()}>
          <header className="video-studio-inspector-tabs"><button className={inspectorTab === 'editor' ? 'active' : ''} onClick={() => { setInspectorTab('editor'); rememberCharacterInspectorView('editor') }} type="button">Editor</button><button className={inspectorTab === 'custom' && inspectorCustomView === 'face' ? 'active' : ''} onClick={() => { setInspectorTab('custom'); setInspectorCustomView('face'); rememberCharacterInspectorView('custom', 'face') }} type="button">Custom</button><button className="video-studio-inspector-close" onClick={() => setInspectorOpen(false)} aria-label="Fechar inspector" title="Fechar" type="button">×</button></header>
          <button className={`video-studio-inspector-presets${inspectorTab === 'custom' && inspectorCustomView === 'presets' ? ' active' : ''}`} onClick={() => { setStudioPresetCategory('expression'); setInspectorTab('custom'); setInspectorCustomView('presets'); rememberCharacterInspectorView('custom', 'presets') }} type="button"><Icon name="sparkles" />Presets</button>
          {inspectorTab === 'editor' ? <div className="video-studio-inspector-content">{propertyPanel()}</div> : <div className="video-studio-inspector-content">{inspectorCustomView === 'presets' ? presetsPanel() : customPanel()}</div>}
        </aside>}
        <section className="video-studio-scene-area" aria-label="Prévia da cena">
          <div className="video-studio-scene-canvas" ref={sceneRef} style={{ backgroundColor: activeStudio.backgroundColor }} onPointerDown={() => { if (!fullView) setSelectedElementId(null) }}>
            {backgroundAsset && <img className={`video-studio-canvas-background${selectedElementId === 'background' && !fullView ? ' selected' : ''}`} src={backgroundAsset.dataUrl} alt="" style={imageStyle(activeStudio.backgroundX, activeStudio.backgroundY, activeStudio.backgroundWidth, activeStudio.backgroundHeight, activeStudio.backgroundRotation)} onPointerDown={(event) => startDrag(event, 'background')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />}
            {[...activeStudio.elements].sort((a, b) => a.zIndex - b.zIndex).map((sourceElement) => {
              if (videoFrameSelection && sourceElement.kind === 'character' && videoFrameSelection.hiddenCharacterIds.has(sourceElement.id)) return null
              if (videoFrameSelection && (sourceElement.kind === 'speech' || sourceElement.kind === 'thought') && !videoFrameSelection.textClipByElementId.has(sourceElement.id)) return null
              const transitionState = characterAnimation.samples.get(sourceElement.id)
              const playbackState = transitionState ?? videoPlaybackStates?.get(sourceElement.id)
              const mouthAnimation = sourceElement.kind === 'character' && !transitionState ? automaticMouthPreview[sourceElement.id] : undefined
              const mouthMode = automaticMouthModes.get(sourceElement.id)
              const speechStartFrame = mouthAnimation?.speechStartFrame ?? videoPreviewFrame
              const mouthPhase = mouthAnimation?.cycleFrames && videoPlaying && animateMouthDuringSpeech && mouthMode === 'talk'
                ? Math.max(0, videoPreviewFrame - speechStartFrame) % mouthAnimation.cycleFrames
                : 0
              const mouthFrameIndex = mouthAnimation?.frames.length
                ? Math.floor(mouthPhase / Math.max(1, mouthAnimation.cycleFrames / mouthAnimation.frames.length)) % mouthAnimation.frames.length
                : 0
              const automaticMouthState = mouthAnimation?.frames[mouthFrameIndex]
              const blinkState = sourceElement.kind === 'character' && !transitionState && !automaticMouthState ? automaticBlinkPreview[sourceElement.id] : undefined
              const activeTextClip = videoFrameSelection?.textClipByElementId.get(sourceElement.id)
              const playbackElement = playbackState?.element ?? activeTextClip?.state ?? sourceElement
              const faceGeometry = automaticMouthState?.geometry ?? blinkState?.geometry
              const blinkedElement = faceGeometry && playbackElement.kind === 'character' ? { ...playbackElement, ...faceGeometry } : playbackElement
              const element = isVideoWorkspace ? videoCharacterStageElement(videoTimelineFor(activeStudio), blinkedElement) : blinkedElement
              const asset = element.assetId ? activeStudio.assets.find((item) => item.id === element.assetId) : undefined
              const speaker = element.speakerCharacterId ? activeStudio.elements.find((item) => item.id === element.speakerCharacterId && item.kind === 'character') : undefined
              const speakerName = speaker?.text || element.speakerName
              const speakerColor = videoCharacterTrackColor(element.speakerCharacterId ?? element.id, speaker?.timelineColor ?? element.speakerColor)
              const imageDataUrl = automaticMouthState?.dataUrl ?? blinkState?.dataUrl ?? playbackState?.imageDataUrl ?? asset?.dataUrl
              return <VideoStudioDomElement
                key={element.id}
                element={element}
                imageDataUrl={imageDataUrl}
                assetName={asset?.name}
                speakerName={speakerName}
                speakerColor={speakerColor}
                selected={selectedElementId === element.id && !fullView}
                interactive={!fullView}
                onPointerDown={(event) => startDrag(event, element.id)}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              />
            })}
            {isVideoWorkspace && (() => {
              const timeline = videoTimelineFor(activeStudio)
              return (videoFrameSelection?.videoClips ?? []).map((clip) => <VideoStudioClipPreview key={clip.id} studioId={activeStudio.id} asset={timeline.videoAssets?.find((asset) => asset.id === clip.assetId)} clip={clip} playheadFrame={videoPreviewFrame} playing={videoPlaying} masterAudio={timeline.videoAudio} onPlaybackError={setError} selected={!fullView && selectedElementId === `video:${clip.id}`} editable={!fullView && !timeline.trackSettings?.video?.locked} onSelect={() => { if (fullView) return; setVideoPlaying(false); setSelectedElementId(`video:${clip.id}`); setActiveTool(null); setInspectorOpen(true); setInspectorTab('editor') }} onBeginEdit={recordHistory} onTransform={(transform) => updateVideoMediaClip({ ...clip, transform }, false)} />)
            })()}
            {!fullView && <span className="video-studio-scene-title">{activeStudio.title}</span>}
          </div>
        </section>
        {fullView && <PreviewTransport preparing={animationPreparing} frame={videoPlayheadFrame} duration={videoTimelineFor(activeStudio).durationFrames} playing={videoPlaying} audio={videoTimelineFor(activeStudio).videoAudio} onSeek={seekVideoFrame} onTogglePlayback={toggleVideoPlayback} onAudioChange={updateVideoAudio} onBeginAudioEdit={recordHistory} />}
        {!fullView && isVideoWorkspace && <VideoTimeline preparing={animationPreparing} onExport={() => setExportDialogOpen(true)} canUndo={canUndo && !studioFaceBusy && !studioExpressionBusy && !savingCast} canRedo={canRedo && !studioFaceBusy && !studioExpressionBusy && !savingCast} onUndo={undo} onRedo={redo} selectedCanvasId={selectedElementId} studio={activeStudio} playheadFrame={videoPlayheadFrame} playing={videoPlaying} height={videoTimelineHeight} presetNames={Object.fromEntries(studioExpressionPresets.map((preset) => [preset.id, preset.name]))} onResize={setVideoTimelineHeight} onChangeTimelineView={changeTimelineView} onSelectElement={(elementId) => { setVideoPlaying(false); setSelectedElementId(elementId); setInspectorOpen(true); if (elementId.startsWith('video:')) { setActiveTool(null); setInspectorTab('editor') } }} onSeek={seekVideoFrame} onTogglePlayback={toggleVideoPlayback} onEnterFullscreen={enterFullView} onSaveFrame={saveVideoFrame} onSplitCharacter={splitVideoCharacterTrack} onSplitTextClip={splitVideoTextClip} onSplitVideoClip={splitVideoMediaClip} onUpdateVideoClip={updateVideoMediaClip} onChangeVideoAudio={updateVideoAudio} onBeginAudioEdit={recordHistory} onDuplicateVideoClip={duplicateVideoMediaClip} onUpdateTextClip={updateVideoTextClip} onDeleteTextClip={deleteVideoTextClip} onDeleteVideoClip={deleteVideoMediaClip} onDeleteTextElement={deleteVideoTextElement} onDeleteCharacterSegment={deleteVideoCharacterSegment} onDuplicateTextClip={duplicateVideoTextClip} onResizeBlock={resizeVideoBlock} onAddText={(kind) => addTextElement(kind)} onAddVideo={() => void openVideoLibrary()} onChangeTrackSettings={(id, settings) => changeScene((studio) => ({ ...studio, videoTimeline: { ...videoTimelineFor(studio), trackSettings: { ...videoTimelineFor(studio).trackSettings, [id]: settings } }, updatedAt: new Date().toISOString() }))} onSetCharacterAnimationsEnabled={(enabled) => changeScene((studio) => ({ ...studio, videoTimeline: { ...videoTimelineFor(studio), animateCharacterTransitions: enabled }, updatedAt: new Date().toISOString() }))} onMoveCharacterTrack={moveVideoCharacterTrack} onSetCharacterPositionsLocked={setCharacterPositionsLocked} onChangeDuration={(durationFrames) => changeScene((studio) => ({ ...studio, videoTimeline: { ...videoTimelineFor(studio), durationFrames, playheadFrame: Math.min(videoPlayheadFrame, durationFrames) }, updatedAt: new Date().toISOString() }))} />}
        {exportDialogOpen && !fullView && <div className="video-export-modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !exportPreparing) setExportDialogOpen(false) }}>
          <section className="video-export-modal" role="dialog" aria-modal="true" aria-labelledby="video-export-title">
            <header><span><small>EXPORTAÇÃO</small><h2 id="video-export-title">Exportar vídeo</h2></span><button type="button" onClick={() => setExportDialogOpen(false)} disabled={exportPreparing}>×</button></header>
            {!exportProgress || ['done', 'failed', 'cancelled'].includes(exportProgress.stage) ? <>
              <p>Escolha como os personagens serão renderizados. Vídeos importados e áudio permanecem normais nos dois modos.</p>
              <div className="video-export-mode-grid">
                <button type="button" className={exportVariant === 'animated' ? 'active' : ''} onClick={() => setExportVariant('animated')}>
                  <strong>Completo</strong><span>Transições, piscadas e boca automática.</span>
                </button>
                <button type="button" className={exportVariant === 'static-characters' ? 'active' : ''} onClick={() => setExportVariant('static-characters')}>
                  <strong>Sem animações</strong><span>Mantém poses/expressões authored como cortes, sem microanimações.</span>
                </button>
              </div>
              {exportRecoveries.length > 0 && <section className="video-export-recoveries">
                <strong>Exportações interrompidas</strong>
                {exportRecoveries.map((recovery) => <article key={recovery.jobId}>
                  <span><b>{recovery.studioTitle}</b><small>{recovery.completedFrames.toLocaleString('pt-BR')} / {recovery.durationFrames.toLocaleString('pt-BR')} frames · {recovery.renderVariant === 'animated' ? 'Completo' : 'Sem animações'}</small></span>
                  <button type="button" disabled={exportRecoveryBusy !== null} onClick={() => void resumeVideoExport(recovery)}>{exportRecoveryBusy === recovery.jobId ? 'Abrindo…' : 'Retomar'}</button>
                  <button type="button" className="danger" disabled={exportRecoveryBusy !== null} onClick={() => void discardVideoExportRecovery(recovery)}>Descartar</button>
                </article>)}
              </section>}
              {exportProgress?.stage === 'done' && <p className="video-export-success">Última exportação concluída e verificada.</p>}
              {exportProgress?.stage === 'failed' && <p className="video-studio-error-message">{exportProgress.message}</p>}
              <footer>
                {exportProgress?.stage === 'done' && <button type="button" onClick={() => void window.desktop.openVideoExportsFolder(activeStudio.id)}>Abrir pasta</button>}
                <button type="button" className="primary" disabled={exportPreparing} onClick={() => void startVideoExport()}>{exportPreparing ? 'Preparando…' : 'Exportar'}</button>
              </footer>
            </> : <>
              <p>{exportProgress.message ?? 'Exportando vídeo…'}</p>
              <progress max={Math.max(1, exportProgress.totalFrames)} value={exportProgress.completedFrames} />
              <strong>{exportProgress.completedFrames.toLocaleString('pt-BR')} / {exportProgress.totalFrames.toLocaleString('pt-BR')} frames</strong>
              <footer><button type="button" className="danger" onClick={() => void cancelVideoExport()}>Cancelar</button></footer>
            </>}
          </section>
        </div>}
        {videoLibraryOpen && <VideoLibraryModal studioTitle={activeStudio.title} locked={videoTimelineFor(activeStudio).trackSettings?.video?.locked === true} onClose={() => setVideoLibraryOpen(false)} onAdd={addLibraryVideos} />}
        {backgroundLibraryOpen && <BackgroundLibraryModal studioTitle={activeStudio.title} onClose={() => setBackgroundLibraryOpen(false)} onUse={addLibraryBackground} />}
        {castPickerOpen && <div className="video-studio-cast-modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !savingCast) setCastPickerOpen(false) }}>
          <section className="video-studio-cast-modal" role="dialog" aria-modal="true" aria-labelledby="video-studio-cast-modal-title">
            <header><span><small>EDITAR ELENCO</small><h2 id="video-studio-cast-modal-title">Personagens do {workspaceTitle}</h2></span><button className="video-studio-cast-modal-close" onClick={() => setCastPickerOpen(false)} aria-label="Fechar" disabled={savingCast} type="button">×</button></header>
            <div className="video-studio-cast-modal-summary"><strong>Escolha os personagens</strong><span>{castSelection.length} selecionado{castSelection.length === 1 ? '' : 's'}</span></div>
            <div className="video-studio-cast-modal-list">
              {availableCharacters.length ? availableCharacters.map((character) => {
                const selected = castSelection.includes(character.id)
                return <button className={`video-studio-cast-modal-option${selected ? ' selected' : ''}`} key={character.id} onClick={() => setCastSelection((current) => selected ? current.filter((id) => id !== character.id) : [...current, character.id])} disabled={savingCast} type="button">
                  <CharacterPortrait character={character} /><strong>{character.name}</strong><i>{selected ? '✓' : '+'}</i>
                </button>
              }) : <p className="video-studio-cast-modal-empty">Crie personagens em Customizar para adicioná-los ao elenco.</p>}
            </div>
            <footer><button className="video-studio-cast-modal-cancel" onClick={() => setCastPickerOpen(false)} disabled={savingCast} type="button">Cancelar</button><button className="video-studio-cast-modal-save" onClick={() => void saveCastSelection()} disabled={savingCast} type="button">{savingCast ? 'Salvando…' : 'Salvar elenco'}</button></footer>
          </section>
        </div>}
      </main>
    )
  }

  return (
    <main className="video-studio-page" aria-label={workspaceTitle}>
      <header className="video-studio-page-header"><h1>Seus {workspacePlural}</h1>{studioFolder && <small>Dados locais: {studioFolder}</small>}</header>
      <div className="video-studio-toolbar" aria-label={`Ações dos ${workspacePlural}`}>
        <button className="video-studio-action video-studio-action-primary" onClick={() => void createStudio()} disabled={loading} type="button"><Icon name="plus" />Criar</button>
      </div>
      {error && <p className="video-studio-error-message" role="alert">{error}</p>}
      {loading ? <section className="video-studio-empty-state"><strong>Carregando {workspacePlural}…</strong></section> : studioCards.length ? (
        <section className="video-studio-grid" aria-label={`${workspacePlural} criados`}>
          {studioCards.map((studio) => <article className={`video-studio-card${selectedId === studio.id ? ' selected' : ''}`} key={studio.id}>
            <header className="video-studio-card-heading"><button className="video-studio-card-open" onClick={() => void openStudio(studio)} disabled={openingStudioId === studio.id} aria-label={`Abrir ${studio.title}`} type="button">{openingStudioId === studio.id ? 'Abrindo…' : studio.title}</button><div className="video-studio-card-actions"><button className="video-studio-card-action" onClick={() => void duplicateStudio(studio)} aria-label={`Duplicar ${studio.title}`} title={`Duplicar ${studio.title}`} type="button"><span className="video-studio-duplicate-icon" aria-hidden="true">▢</span></button><button className="video-studio-card-action danger" onClick={() => void deleteStudio(studio)} aria-label={`Excluir ${studio.title}`} title={`Excluir ${studio.title}`} type="button"><Icon name="trash" /></button></div></header>
            <button className="video-studio-cover" style={{ backgroundColor: studio.color, ...(studio.coverDataUrl ? { backgroundImage: `url(${studio.coverDataUrl})` } : {}) }} onClick={() => void openStudio(studio)} aria-label={`Abrir ${studio.title}`} type="button" />
          </article>)}
        </section>
      ) : <section className="video-studio-empty-state"><span><Icon name="camera" /></span><strong>Nenhum {workspaceTitle} criado</strong><small>Crie um {workspaceTitle} para começar sua coleção.</small></section>}
    </main>
  )
}

function StudioNumericControl({ label, value, onChange, onStart, onFinish, disabled, min, max, suffix }: {
  label: string
  value: number
  onChange: (value: number, record?: boolean) => void
  onStart: () => void
  onFinish?: () => void
  disabled: boolean
  min: number
  max: number
  suffix: string
}) {
  const format = (number: number) => String(Number(number.toFixed(1)))
  const [draft, setDraft] = useState(() => format(value))

  useEffect(() => { setDraft(format(value)) }, [value])

  const commit = () => {
    const parsed = Number(draft)
    if (!draft.trim() || !Number.isFinite(parsed)) {
      setDraft(format(value))
      return
    }
    const next = Math.min(max, Math.max(min, parsed))
    setDraft(format(next))
    if (next !== value) { onStart(); onChange(next, false); onFinish?.() }
  }

  return <div className="video-studio-control">
    <span>{label}</span>
    <input
      type="number"
      inputMode="decimal"
      value={draft}
      min={min}
      max={max}
      step="0.1"
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); commit() }
        if (event.key === 'Escape') { setDraft(format(value)) }
      }}
      aria-label={label}
    />
    <small>{suffix}</small>
    <input
      className="video-studio-control-range"
      type="range"
      min={min}
      max={max}
      step="0.1"
      value={Math.min(max, Math.max(min, value))}
      disabled={disabled}
      onPointerDown={onStart}
      onPointerUp={() => onFinish?.()}
      onPointerCancel={() => onFinish?.()}
      onKeyDown={(event) => { if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') onStart() }}
      onKeyUp={() => onFinish?.()}
      onChange={(event) => { const next = Number(event.target.value); setDraft(format(next)); onChange(next, false) }}
      aria-label={`${label} pela barra`}
    />
  </div>
}

function ElementControls({ element, update, remove, control }: {
  element: StudioElement
  update: (values: Partial<StudioElement>, record?: boolean) => void
  remove: () => void
  control: (label: string, value: number, onChange: (value: number, record?: boolean) => void, min: number, max: number, suffix?: string) => ReactNode
}) {
  return <>
    <div className="video-studio-controls-grid">
      {control('X', element.x, (value, record) => update({ x: value }, record), -100, 100)}
      {control('Y', element.y, (value, record) => update({ y: value }, record), -100, 100)}
      {element.kind === 'character' && control('Scale', element.characterScale ?? 100, (value, record) => update({ characterScale: value }, record), 1, 300)}
      {element.kind === 'character'
        ? <>
          {control('Largura', element.characterWidthScale ?? 100, (value, record) => update({ characterWidthScale: value }, record), 1, 300)}
          {control('Altura', element.characterHeightScale ?? 100, (value, record) => update({ characterHeightScale: value }, record), 1, 300)}
        </>
        : <>
          {control('Largura', element.width, (value, record) => update({ width: value }, record), 1, 200)}
          {control('Altura', element.height, (value, record) => update({ height: value }, record), 1, 200)}
        </>}
      {control('Rotação', element.rotation, (value, record) => update({ rotation: value }, record), -180, 180, '°')}
    </div>
    {element.kind === 'character' && <button className="video-studio-side-primary video-studio-character-reset" type="button" onClick={() => update({ x: 0, y: 0, characterScale: 100, characterWidthScale: 100, characterHeightScale: 100, rotation: 0, flipX: false })}><Icon name="reset" />Restaurar ajustes</button>}
    {element.kind === 'character' && <div className="video-studio-layer-actions video-studio-character-actions"><button type="button" onClick={() => update({ flipX: !element.flipX })}><Icon name="flipHorizontal" />Espelhar personagem</button><button type="button" onClick={() => update({ zIndex: Math.max(0, element.zIndex - 1) })}>Para trás</button><button type="button" onClick={() => update({ zIndex: Math.max(0, element.zIndex) + 2 })}>Para frente</button></div>}
    {element.kind === 'image' && <div className="video-studio-layer-actions"><button type="button" onClick={() => update({ zIndex: Math.max(0, element.zIndex) + 2 })}>Para frente</button><button type="button" onClick={() => update({ zIndex: Math.max(0, element.zIndex - 1) })}>Para trás</button></div>}
    <button className="video-studio-side-danger" type="button" onClick={remove}><Icon name="trash" />Excluir da cena</button>
  </>
}
