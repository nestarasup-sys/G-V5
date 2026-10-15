import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Icon } from '../../ui/components/Icon'
import { CharacterPortrait } from '../../ui/components/CharacterPortrait'
import { createStudioTimeline, type StudioAsset, type StudioDocument, type StudioElement, type StudioFaceTransform, type StudioFaceTransforms, type StudioTimeline, type StudioTimelineClip, type StudioTimelineTrack } from '../../../../shared/studio'
import { StudioTimelinePanel } from './StudioTimeline'
import type { CustomizerCharacter } from '../../../../shared/customizer'
import type { CustomizerFaceAppearance } from '../../../../shared/customizer'
import type { FaceCatalogItem, FaceCatalogItemSummary, FaceSheetKind, FabricatorPoseSummary } from '../../../../shared/fabricator'

type StudioCard = StudioDocument
type StudioSnapshot = Pick<StudioDocument, 'backgroundColor' | 'backgroundAssetId' | 'backgroundX' | 'backgroundY' | 'backgroundWidth' | 'backgroundHeight' | 'backgroundRotation' | 'assets' | 'elements' | 'timeline'>
type Tool = 'background' | 'objects' | null
type DragState = { id: string; pointerId: number; startX: number; startY: number; originalX: number; originalY: number; width: number; height: number }

const STORAGE_KEY = 'gacha-nymi-studio-catalog-v1'
const studioColor = (number: number) => `hsl(${(number * 137.508) % 360} 45% 78%)`
const defaultStudioEyeTransform: StudioFaceTransform = { x: 0, y: 0, width: 100, height: 100, rotation: 0 }
const studioTools = [
  { id: 'background', label: 'Fundo', icon: 'frame' },
  { id: 'objects', label: 'Objetos', icon: 'sparkles' }
] as const
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

type TrimmedImage = { dataUrl: string; width: number; height: number; left: number; top: number; sourceWidth: number; sourceHeight: number }

function trimTransparentImage(dataUrl: string): Promise<TrimmedImage | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context || !canvas.width || !canvas.height) return resolve(null)
      context.drawImage(image, 0, 0)
      let pixels: Uint8ClampedArray
      try { pixels = context.getImageData(0, 0, canvas.width, canvas.height).data } catch { return resolve(null) }
      let left = canvas.width, top = canvas.height, right = -1, bottom = -1
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        if (pixels[(y * canvas.width + x) * 4 + 3] <= 8) continue
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
      if (right < left || bottom < top) return resolve(null)
      const width = right - left + 1
      const height = bottom - top + 1
      if (left === 0 && top === 0 && width === canvas.width && height === canvas.height) return resolve(null)
      const cropped = document.createElement('canvas')
      cropped.width = width
      cropped.height = height
      cropped.getContext('2d')?.drawImage(image, left, top, width, height, 0, 0, width, height)
      resolve({ dataUrl: cropped.toDataURL('image/png'), width, height, left, top, sourceWidth: canvas.width, sourceHeight: canvas.height })
    }
    image.onerror = () => resolve(null)
    image.src = dataUrl
  })
}

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

function loadLegacyStudios(): Array<{ id: string; title: string; color: string }> {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(saved)) return []
    return saved.filter((item): item is { id: string; title: string; color: string } => Boolean(item && typeof item === 'object'
      && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.color === 'string'))
  } catch { return [] }
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
    timeline: studio.timeline
  }
}

function withSnapshot(studio: StudioDocument, next: StudioSnapshot): StudioDocument {
  return { ...studio, ...next, updatedAt: new Date().toISOString() }
}

function elementTrackKind(element: StudioElement): StudioTimelineTrack['kind'] {
  if (element.kind === 'character') return 'character'
  if (element.kind === 'image') return 'objects'
  return element.kind
}

function ensureElementTrack(timeline: StudioTimeline, element: StudioElement): StudioTimeline {
  const kind = elementTrackKind(element)
  const id = kind === 'character' ? `character:${element.id}` : `lane:${kind}`
  if (timeline.tracks.some((track) => track.id === id)) return timeline
  const name = kind === 'character' ? element.text || 'Personagem' : ({ background: 'Fundo', objects: 'Objetos', narrator: 'Narrador', speech: 'Falas', thought: 'Pensamentos' } as const)[kind]
  return { ...timeline, tracks: [...timeline.tracks, { id, kind, name, elementId: kind === 'character' ? element.id : undefined, order: timeline.tracks.length, visible: true, locked: false, collapsed: false }] }
}

function ensureElementClip(studio: StudioDocument, element: StudioElement, startFrame = 0, endFrame = studio.timeline.durationFrames): StudioDocument {
  if (studio.timeline.clips.some((clip) => clip.elementId === element.id && startFrame >= clip.startFrame && startFrame < clip.endFrame)) return studio
  const timeline = ensureElementTrack(studio.timeline, element)
  const trackId = elementTrackKind(element) === 'character' ? `character:${element.id}` : `lane:${elementTrackKind(element)}`
  const end = Math.max(endFrame, startFrame + 1)
  return {
    ...studio,
    timeline: { ...timeline, durationFrames: Math.max(timeline.durationFrames, end), clips: [...timeline.clips, { id: crypto.randomUUID(), trackId, elementId: element.id, startFrame, endFrame: end, state: { type: 'element', element: { ...element } } }] }
  }
}

function updateBackgroundTimeline(studio: StudioDocument, backgroundValues: Partial<Pick<StudioDocument, 'backgroundColor' | 'backgroundAssetId' | 'backgroundX' | 'backgroundY' | 'backgroundWidth' | 'backgroundHeight' | 'backgroundRotation'>>, frame: number): StudioDocument {
  let timeline = studio.timeline
  const active = timeline.clips.find((clip) => clip.elementId === null && frame >= clip.startFrame && frame < clip.endFrame)
  if (active && frame > active.startFrame) {
    timeline = splitTimelineClipAtFrame(timeline, active, frame)
    const current = timeline.clips.find((clip) => clip.elementId === null && clip.startFrame === frame)
    if (!current || current.state.type !== 'background') return studio
    timeline = { ...timeline, clips: timeline.clips.map((clip) => clip.id === current.id && clip.state.type === 'background' ? { ...clip, state: { type: 'background', background: { ...clip.state.background, ...backgroundValues } } } : clip) }
  } else if (active) {
    timeline = { ...timeline, clips: timeline.clips.map((clip) => clip.id === active.id && clip.state.type === 'background' ? { ...clip, state: { type: 'background', background: { ...clip.state.background, ...backgroundValues } } } : clip) }
  } else {
    let track = timeline.tracks.find((item) => item.kind === 'background')
    if (!track) {
      track = { id: 'lane:background', kind: 'background', name: 'Fundo', order: 0, visible: true, locked: false, collapsed: false }
      timeline = { ...timeline, tracks: [track, ...timeline.tracks.map((item) => ({ ...item, order: item.order + 1 }))] }
    }
    const nextStart = timeline.clips.filter((clip) => clip.trackId === track?.id && clip.startFrame > frame).reduce((minimum, clip) => Math.min(minimum, clip.startFrame), timeline.durationFrames)
    const endFrame = Math.max(frame + 1, nextStart)
    const background = {
      backgroundColor: studio.backgroundColor, backgroundAssetId: studio.backgroundAssetId,
      backgroundX: studio.backgroundX, backgroundY: studio.backgroundY, backgroundWidth: studio.backgroundWidth,
      backgroundHeight: studio.backgroundHeight, backgroundRotation: studio.backgroundRotation
    }
    timeline = { ...timeline, durationFrames: Math.max(timeline.durationFrames, endFrame), clips: [...timeline.clips, { id: crypto.randomUUID(), trackId: track.id, elementId: null, startFrame: frame, endFrame, state: { type: 'background', background: { ...background, ...backgroundValues } } }] }
  }
  return { ...studio, ...backgroundValues, timeline }
}

function resolveStudioAtFrame(studio: StudioDocument, frame: number): StudioDocument {
  const tracks = new Map(studio.timeline.tracks.map((track) => [track.id, track]))
  const visible = new Map<string, StudioElement>()
  let background = studio
  for (const clip of studio.timeline.clips) {
    if (frame < clip.startFrame || frame >= clip.endFrame) continue
    const track = tracks.get(clip.trackId)
    if (!track?.visible) continue
    if (clip.state.type === 'background') background = { ...background, ...clip.state.background }
    else visible.set(clip.state.element.id, clip.state.element)
  }
  return {
    ...studio,
    backgroundColor: background.backgroundColor,
    backgroundAssetId: background.backgroundAssetId,
    backgroundX: background.backgroundX,
    backgroundY: background.backgroundY,
    backgroundWidth: background.backgroundWidth,
    backgroundHeight: background.backgroundHeight,
    backgroundRotation: background.backgroundRotation,
    elements: studio.elements.flatMap((element) => {
      const state = visible.get(element.id)
      const track = tracks.get(element.kind === 'character' ? `character:${element.id}` : `lane:${elementTrackKind(element)}`)
      return state && track?.visible ? [state] : []
    })
  }
}

function addOrUpdateTimelineElement(studio: StudioDocument, element: StudioElement, frame: number): StudioDocument {
  const next = ensureElementTrack(studio.timeline, element)
  const clip = next.clips.find((item) => item.elementId === element.id && frame >= item.startFrame && frame < item.endFrame)
  if (!clip) return ensureElementClip({ ...studio, timeline: next }, element, frame, Math.max(next.durationFrames, frame + 1))
  return {
    ...studio,
    timeline: { ...next, clips: next.clips.map((item) => item.id === clip.id ? { ...item, state: { type: 'element', element: { ...(clip.state.type === 'element' ? clip.state.element : element), ...element } } } : item) }
  }
}

function splitTimelineClipAtFrame(timeline: StudioTimeline, clip: StudioTimelineClip, frame: number): StudioTimeline {
  if (frame <= clip.startFrame || frame >= clip.endFrame) return timeline
  const second = { ...clip, id: crypto.randomUUID(), startFrame: frame, state: clip.state.type === 'element'
    ? { type: 'element' as const, element: { ...clip.state.element } }
    : { type: 'background' as const, background: { ...clip.state.background } } }
  return { ...timeline, clips: timeline.clips.flatMap((item) => item.id === clip.id ? [{ ...item, endFrame: frame }, second] : [item]) }
}

function studioCharacterRenderKey(character: CustomizerCharacter): string {
  const { faceAppearance: _ignored, ...customization } = character.customization
  return JSON.stringify({ id: character.id, customization })
}

function studioElementSize(element: StudioElement) {
  if (element.kind !== 'character') return { width: element.width, height: element.height }
  const scale = (element.characterScale ?? 100) / 100
  return {
    width: element.width * scale * (element.characterWidthScale ?? 100) / 100,
    height: element.height * scale * (element.characterHeightScale ?? 100) / 100
  }
}

function makeElement(kind: StudioElement['kind'], zIndex: number): StudioElement {
  return {
    id: crypto.randomUUID(), kind, text: kind === 'narrator' ? 'Texto do narrador' : 'Digite aqui',
    x: 0, y: 0, width: kind === 'narrator' ? 32 : 28, height: kind === 'narrator' ? 12 : 16,
    rotation: 0, zIndex
  }
}

function makeCanvasPrint(studio: StudioDocument): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1920
    canvas.height = 1080
    const context = canvas.getContext('2d')
    if (!context) return reject(new Error('Não foi possível preparar a imagem do print.'))
    context.fillStyle = studio.backgroundColor
    context.fillRect(0, 0, canvas.width, canvas.height)
    const load = (src: string) => new Promise<HTMLImageElement>((ok, fail) => {
      const image = new Image()
      image.onload = () => ok(image)
      image.onerror = () => fail(new Error('Uma imagem da cena não pôde ser carregada para o print.'))
      image.src = src
    })
    const drawImage = async (src: string, x: number, y: number, width: number, height: number, rotation: number, flipX = false) => {
      const image = await load(src)
      context.save()
      context.translate((50 + x) * 19.2, (50 + y) * 10.8)
      context.rotate(rotation * Math.PI / 180)
      if (flipX) context.scale(-1, 1)
      context.drawImage(image, -width * 9.6, -height * 5.4, width * 19.2, height * 10.8)
      context.restore()
    }
    const drawText = (element: StudioElement) => {
      const cx = (50 + element.x) * 19.2
      const cy = (50 + element.y) * 10.8
      const width = element.width * 19.2
      const height = element.height * 10.8
      context.save()
      context.translate(cx, cy)
      context.rotate(element.rotation * Math.PI / 180)
      context.fillStyle = element.kind === 'narrator' ? 'rgba(255,255,255,.90)' : 'rgba(255,250,253,.96)'
      context.strokeStyle = '#604b59'
      context.lineWidth = 4
      context.beginPath()
      context.roundRect(-width / 2, -height / 2, width, height, element.kind === 'narrator' ? 20 : height / 2)
      context.fill()
      context.stroke()
      context.fillStyle = '#352d35'
      context.font = `600 ${Math.max(22, Math.round(height * .3))}px sans-serif`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      const words = element.text.split(/\s+/)
      const lines: string[] = []
      let line = ''
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word
        if (context.measureText(candidate).width > width - 36 && line) { lines.push(line); line = word } else line = candidate
      }
      if (line) lines.push(line)
      lines.slice(0, 5).forEach((value, index, values) => context.fillText(value, 0, (index - (values.length - 1) / 2) * Math.max(28, height * .32), width - 30))
      context.restore()
    }
    void (async () => {
      try {
        const bg = studio.assets.find((asset) => asset.id === studio.backgroundAssetId)
        if (bg) await drawImage(bg.dataUrl, studio.backgroundX, studio.backgroundY, studio.backgroundWidth, studio.backgroundHeight, studio.backgroundRotation)
        for (const element of [...studio.elements].sort((a, b) => a.zIndex - b.zIndex)) {
          if (element.kind === 'image' || element.kind === 'character') {
            const asset = studio.assets.find((item) => item.id === element.assetId)
            if (asset) {
              const size = studioElementSize(element)
              await drawImage(asset.dataUrl, element.x, element.y, size.width, size.height, element.rotation, element.kind === 'character' && element.flipX === true)
            }
          } else drawText(element)
        }
        resolve(canvas.toDataURL('image/png'))
      } catch (reason) { reject(reason) }
    })()
  })
}

export function StudioPage() {
  const [studios, setStudios] = useState<StudioCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [availableCharacters, setAvailableCharacters] = useState<CustomizerCharacter[]>([])
  const [castPickerOpen, setCastPickerOpen] = useState(false)
  const [castSelection, setCastSelection] = useState<string[]>([])
  const [savingCast, setSavingCast] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<'editor' | 'custom'>('editor')
  const [inspectorCustomView, setInspectorCustomView] = useState<'face' | 'presets'>('face')
  const characterInspectorViewRef = useRef<{ tab: 'editor' | 'custom'; customView: 'face' | 'presets' }>({ tab: 'editor', customView: 'face' })
  const [studioPresetCategory, setStudioPresetCategory] = useState<'pose' | 'expression'>('pose')
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
  const [fullView, setFullView] = useState(false)
  const [saved, setSaved] = useState(true)
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [playheadFrame, setPlayheadFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [selectedTimelineClipId, setSelectedTimelineClipId] = useState<string | null>(null)
  const [historyVersion, setHistoryVersion] = useState(0)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const sceneRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const undoRef = useRef<StudioSnapshot[]>([])
  const redoRef = useRef<StudioSnapshot[]>([])
  const studioFaceTransformsRef = useRef<Record<string, StudioFaceTransforms>>({})
  const studioTimelineAssetIdsRef = useRef<Record<string, string>>({})
  const studioFaceRenderTimerRef = useRef<number | null>(null)
  const studioFaceRenderVersionRef = useRef(0)
  const studioFaceRenderPendingRef = useRef<{ studioId: string; elementId: string; assetId: string; character: CustomizerCharacter; transforms: StudioFaceTransforms } | null>(null)
  const studioFaceRenderRunningRef = useRef(false)
  const studioFaceRendererRef = useRef<{ key: string; render: (appearance?: CustomizerFaceAppearance, transforms?: StudioFaceTransforms) => Promise<{ dataUrl: string; width: number; height: number }> } | null>(null)
  const saveGenerationRef = useRef(0)
  const playbackClockRef = useRef<{ lastTime: number; frameRemainder: number }>({ lastTime: 0, frameRemainder: 0 })
  const playheadFrameRef = useRef(0)
  const normalizedStudioIdsRef = useRef(new Set<string>())
  const nextStudioNumber = useRef(1)
  const selectedStudio = studios.find((studio) => studio.id === selectedId) ?? null
  const activeStudio = studios.find((studio) => studio.id === activeStudioId) ?? null
  const sceneStudio = activeStudio ? resolveStudioAtFrame(activeStudio, playheadFrame) : null
  const selectedElement = sceneStudio?.elements.find((element) => element.id === selectedElementId) ?? null
  const selectedStudioCharacter = selectedElement?.kind === 'character' ? availableCharacters.find((character) => character.id === selectedElement.characterId) ?? null : null
  const selectedStudioCharacterModelSlot = selectedStudioCharacter ? selectedStudioCharacter.customization.modelSlot ?? 1 : null
  const selectedStudioPoseSlot = selectedElement?.kind === 'character' ? selectedElement.poseSlot ?? selectedStudioCharacter?.customization.poseSlot ?? null : null
  const selectedStudioFaceAppearance = selectedElement?.kind === 'character'
    ? selectedElement.faceAppearance ?? selectedStudioCharacter?.customization.faceAppearance
    : undefined
  const selectedBackgroundAsset = sceneStudio?.assets.find((asset) => asset.id === sceneStudio.backgroundAssetId) ?? null
  const stageCharacters = activeStudio?.elements.filter((element) => element.kind === 'character') ?? []
  const allStageCharactersLocked = stageCharacters.length > 0 && stageCharacters.every((element) => element.positionLocked === true)
  const toggleStageCharacterPositionLock = () => {
    if (!activeStudio || !stageCharacters.length) return
    const nextLocked = !allStageCharactersLocked
    changeScene((studio) => ({
      ...studio,
      elements: studio.elements.map((element) => element.kind === 'character' ? { ...element, positionLocked: nextLocked } : element),
      timeline: { ...studio.timeline, clips: studio.timeline.clips.map((clip) => clip.state.type === 'element' && clip.state.element.kind === 'character' ? { ...clip, state: { type: 'element', element: { ...clip.state.element, positionLocked: nextLocked } } } : clip) },
      updatedAt: new Date().toISOString()
    }))
  }
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

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const existing = await window.desktop.listStudios()
        const knownIds = new Set(existing.map((studio) => studio.id))
        const legacy = loadLegacyStudios()
        const now = new Date().toISOString()
        for (const old of legacy) {
          if (knownIds.has(old.id) || !isUuid(old.id)) continue
          await window.desktop.saveStudio({
            schemaVersion: 1, ...old, createdAt: now, updatedAt: now, backgroundColor: '#d7b5cd',
            backgroundAssetId: null, backgroundX: 0, backgroundY: 0, backgroundWidth: 100, backgroundHeight: 100,
            backgroundRotation: 0, assets: [], elements: [], timeline: createStudioTimeline([], {
              backgroundColor: '#d7b5cd', backgroundAssetId: null, backgroundX: 0, backgroundY: 0,
              backgroundWidth: 100, backgroundHeight: 100, backgroundRotation: 0
            })
          })
        }
        const loaded = await window.desktop.listStudios()
        const folder = await window.desktop.getStudioFolder()
        if (cancelled) return
        setStudios(loaded)
        setStudioFolder(folder)
        if (legacy.length) window.localStorage.removeItem(STORAGE_KEY)
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os Studios.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.desktop.listCustomizerCharacters().then((characters) => {
      if (!cancelled) setAvailableCharacters(characters)
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o elenco de personagens.')
    })
    return () => { cancelled = true }
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
    if (!activeStudioId) return
    undoRef.current = []
    redoRef.current = []
    setCanUndo(false)
    setCanRedo(false)
    setHistoryVersion((value) => value + 1)
    setSelectedElementId(null)
  }, [activeStudioId])

  useEffect(() => {
    setPlaying(false)
    setSelectedTimelineClipId(null)
    const frame = activeStudio?.timeline.currentFrame ?? 0
    playheadFrameRef.current = frame
    setPlayheadFrame(frame)
  }, [activeStudioId])

  useEffect(() => {
    if (!playing || !activeStudio) return
    let animationFrame = 0
    const duration = activeStudio.timeline.durationFrames
    const fps = activeStudio.timeline.fps
    const speed = activeStudio.timeline.speed
    const loop = activeStudio.timeline.loop
    playbackClockRef.current = { lastTime: 0, frameRemainder: 0 }
    const tick = (now: number) => {
      const clock = playbackClockRef.current
      if (!clock.lastTime) clock.lastTime = now
      const elapsed = Math.min(100, now - clock.lastTime)
      clock.lastTime = now
      clock.frameRemainder += elapsed * fps * speed / 1000
      const advance = Math.floor(clock.frameRemainder)
      if (advance > 0) {
        clock.frameRemainder -= advance
        const next = playheadFrameRef.current + advance
        const resolved = next < duration ? next : loop ? next % duration : duration - 1
        playheadFrameRef.current = resolved
        setPlayheadFrame(resolved)
        if (next >= duration && !loop) {
          setPlaying(false)
          patchStudio((studio) => ({ ...studio, timeline: { ...studio.timeline, currentFrame: resolved } }))
          return
        }
      }
      if (playing) animationFrame = window.requestAnimationFrame(tick)
    }
    animationFrame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(animationFrame)
  }, [playing, activeStudioId, activeStudio?.timeline.durationFrames, activeStudio?.timeline.fps, activeStudio?.timeline.speed, activeStudio?.timeline.loop])

  useEffect(() => {
    if (!activeStudio || normalizedStudioIdsRef.current.has(activeStudio.id)) return
    let cancelled = false
    const studioId = activeStudio.id
    void (async () => {
      const characterAssets = activeStudio.assets.filter((asset) => asset.category === 'character' && activeStudio.elements.some((element) => element.kind === 'character' && element.assetId === asset.id))
      const crops = await Promise.all(characterAssets.map(async (asset) => ({ assetId: asset.id, crop: await trimTransparentImage(asset.dataUrl) })))
      if (cancelled) return
      normalizedStudioIdsRef.current.add(studioId)
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

  const allocateNumber = () => {
    const highest = studios.reduce((max, studio) => Math.max(max, Number(studio.title.match(/^Studio\s+(\d+)/i)?.[1] ?? 0)), 0)
    const number = Math.max(nextStudioNumber.current, highest + 1)
    nextStudioNumber.current = number + 1
    return number
  }

  const createStudio = async () => {
    const number = allocateNumber()
    const now = new Date().toISOString()
    const studio: StudioCard = {
      schemaVersion: 1, id: crypto.randomUUID(), title: `Studio ${String(number).padStart(2, '0')}`,
      color: studioColor(number), createdAt: now, updatedAt: now, backgroundColor: '#d7b5cd',
      backgroundAssetId: null, backgroundX: 0, backgroundY: 0, backgroundWidth: 100, backgroundHeight: 100,
      backgroundRotation: 0, assets: [], elements: [], timeline: createStudioTimeline([], {
        backgroundColor: '#d7b5cd', backgroundAssetId: null, backgroundX: 0, backgroundY: 0,
        backgroundWidth: 100, backgroundHeight: 100, backgroundRotation: 0
      })
    }
    try {
      setError(null)
      await window.desktop.saveStudio(studio)
      setStudios((current) => [...current, studio])
      setSelectedId(studio.id)
      setSaved(true)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar o Studio.') }
  }

  const duplicateStudio = async (source: StudioCard | null = selectedStudio) => {
    if (!source) return
    const number = allocateNumber()
    const now = new Date().toISOString()
    const duplicate: StudioCard = {
      ...source, id: crypto.randomUUID(), title: `Studio ${String(number).padStart(2, '0')}`,
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
    duplicate.backgroundAssetId = source.backgroundAssetId ? oldToNew.get(source.backgroundAssetId) ?? null : null
    const elementIds = new Map(source.elements.map((element, index) => [element.id, duplicate.elements[index].id]))
    const trackIds = new Map(source.timeline.tracks.map((track) => [track.id,
      track.kind === 'character' && track.elementId ? `character:${elementIds.get(track.elementId) ?? track.elementId}` : track.id
    ]))
    duplicate.timeline = {
      ...source.timeline,
      tracks: source.timeline.tracks.map((track) => ({ ...track, id: trackIds.get(track.id) ?? track.id, elementId: track.elementId ? elementIds.get(track.elementId) : undefined })),
      clips: source.timeline.clips.map((clip) => ({
        ...clip, id: crypto.randomUUID(), trackId: trackIds.get(clip.trackId) ?? clip.trackId,
        elementId: clip.elementId ? elementIds.get(clip.elementId) ?? null : null,
        state: clip.state.type === 'element' ? { type: 'element', element: {
          ...clip.state.element,
          id: elementIds.get(clip.state.element.id) ?? clip.state.element.id,
          assetId: clip.state.element.assetId ? oldToNew.get(clip.state.element.assetId) ?? clip.state.element.assetId : undefined
        } } : { type: 'background', background: { ...clip.state.background, backgroundAssetId: clip.state.background.backgroundAssetId ? oldToNew.get(clip.state.background.backgroundAssetId) ?? null : null } }
      }))
    }
    try {
      setError(null)
      await window.desktop.saveStudio(duplicate)
      setStudios((current) => [...current, duplicate])
      setSelectedId(duplicate.id)
      setSaved(true)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível duplicar o Studio.') }
  }

  const saveStudio = useCallback(async (document = activeStudio) => {
    if (!document) return true
    const generation = ++saveGenerationRef.current
    try {
      await window.desktop.saveStudio({ ...document, updatedAt: new Date().toISOString() })
      if (generation === saveGenerationRef.current) {
        setSaved(true)
        setError(null)
      }
      return true
    } catch (reason) {
      if (generation === saveGenerationRef.current) setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o Studio neste dispositivo.')
      return false
    }
  }, [activeStudio])

  useEffect(() => {
    if (!activeStudio) return
    setSaved(false)
    const timer = window.setTimeout(() => { void saveStudio(activeStudio) }, 650)
    return () => window.clearTimeout(timer)
  }, [activeStudio, saveStudio])

  const patchStudio = (transform: (studio: StudioDocument) => StudioDocument) => {
    if (!activeStudioId) return
    setStudios((current) => current.map((studio) => studio.id === activeStudioId ? transform(studio) : studio))
    setSaved(false)
  }

  const seekTimeline = (requestedFrame: number) => {
    if (!activeStudio) return
    const frame = Math.max(0, Math.min(activeStudio.timeline.durationFrames - 1, Math.round(requestedFrame)))
    playheadFrameRef.current = frame
    setPlayheadFrame(frame)
    patchStudio((studio) => ({ ...studio, timeline: { ...studio.timeline, currentFrame: frame } }))
  }

  const toggleTimelinePlayback = () => {
    if (!activeStudio) return
    if (playing) {
      setPlaying(false)
      patchStudio((studio) => ({ ...studio, timeline: { ...studio.timeline, currentFrame: playheadFrameRef.current } }))
      return
    }
    if (playheadFrameRef.current >= activeStudio.timeline.durationFrames - 1) seekTimeline(0)
    setPlaying(true)
  }

  const moveTimelineClip = (id: string, startFrame: number) => patchStudio((studio) => {
    const clip = studio.timeline.clips.find((item) => item.id === id)
    if (!clip) return studio
    const length = clip.endFrame - clip.startFrame
    const sameSequence = (item: StudioTimelineClip) => item.id !== id && item.trackId === clip.trackId && (clip.elementId === null || item.elementId === clip.elementId)
    const siblings = studio.timeline.clips.filter(sameSequence)
    const previousEnd = Math.max(0, ...siblings.filter((item) => item.endFrame <= clip.startFrame).map((item) => item.endFrame))
    const nextStart = siblings.filter((item) => item.startFrame >= clip.endFrame).reduce((minimum, item) => Math.min(minimum, item.startFrame), Number.POSITIVE_INFINITY)
    const boundedStart = Math.max(previousEnd, Number.isFinite(nextStart) ? Math.min(startFrame, Math.max(previousEnd, nextStart - length)) : startFrame)
    const endFrame = boundedStart + length
    return { ...studio, timeline: { ...studio.timeline, durationFrames: Math.max(studio.timeline.durationFrames, endFrame), clips: studio.timeline.clips.map((item) => item.id === id ? { ...item, startFrame: boundedStart, endFrame } : item) } }
  })

  const resizeTimelineClip = (id: string, startFrame: number, endFrame: number) => patchStudio((studio) => {
    const clip = studio.timeline.clips.find((item) => item.id === id)
    if (!clip || endFrame <= startFrame) return studio
    const sameSequence = (item: StudioTimelineClip) => item.id !== id && item.trackId === clip.trackId && (clip.elementId === null || item.elementId === clip.elementId)
    const siblings = studio.timeline.clips.filter(sameSequence)
    const previousEnd = Math.max(0, ...siblings.filter((item) => item.endFrame <= clip.startFrame).map((item) => item.endFrame))
    const nextStart = siblings.filter((item) => item.startFrame >= clip.endFrame).reduce((minimum, item) => Math.min(minimum, item.startFrame), Number.POSITIVE_INFINITY)
    const resizingLeft = startFrame !== clip.startFrame
    const boundedStart = resizingLeft ? Math.max(previousEnd, Math.min(clip.endFrame - 1, startFrame)) : clip.startFrame
    const boundedEnd = resizingLeft ? clip.endFrame : Math.max(boundedStart + 1, Number.isFinite(nextStart) ? Math.min(endFrame, nextStart) : endFrame)
    return { ...studio, timeline: { ...studio.timeline, durationFrames: Math.max(studio.timeline.durationFrames, boundedEnd), clips: studio.timeline.clips.map((item) => item.id === id ? { ...item, startFrame: boundedStart, endFrame: boundedEnd } : item) } }
  })

  const splitSelectedTimelineClip = () => {
    if (!activeStudio || !selectedTimelineClipId) return
    const clip = activeStudio.timeline.clips.find((item) => item.id === selectedTimelineClipId)
    if (!clip || playheadFrame <= clip.startFrame || playheadFrame >= clip.endFrame) return
    changeScene((studio) => ({ ...studio, timeline: splitTimelineClipAtFrame(studio.timeline, clip, playheadFrame) }))
  }

  const deleteSelectedTimelineClip = () => {
    if (!selectedTimelineClipId) return
    changeScene((studio) => ({ ...studio, timeline: { ...studio.timeline, clips: studio.timeline.clips.filter((clip) => clip.id !== selectedTimelineClipId) } }))
    setSelectedTimelineClipId(null)
  }

  const addTimelineBlock = (track: StudioTimelineTrack) => {
    if (!activeStudio) return
    if (track.kind === 'character' && track.elementId) {
      const element = activeStudio.elements.find((item) => item.id === track.elementId)
      if (!element) return
      changeScene((studio) => {
        const active = studio.timeline.clips.find((clip) => clip.trackId === track.id && playheadFrame >= clip.startFrame && playheadFrame < clip.endFrame)
        const previous = active ?? studio.timeline.clips.filter((clip) => clip.trackId === track.id && clip.endFrame <= playheadFrame).sort((a, b) => b.endFrame - a.endFrame)[0]
        const state = previous?.state.type === 'element' ? previous.state.element : element
        const nextStart = studio.timeline.clips.filter((clip) => clip.trackId === track.id && clip.startFrame > playheadFrame).reduce((minimum, clip) => Math.min(minimum, clip.startFrame), studio.timeline.durationFrames)
        const endFrame = Math.max(playheadFrame + 1, active?.endFrame ?? nextStart)
        let clips = studio.timeline.clips.flatMap((clip) => {
          if (clip.trackId !== track.id || clip.endFrame <= playheadFrame || clip.startFrame >= endFrame) return [clip]
          return clip.startFrame < playheadFrame ? [{ ...clip, endFrame: playheadFrame }] : []
        })
        clips = [...clips, { id: crypto.randomUUID(), trackId: track.id, elementId: element.id, startFrame: playheadFrame, endFrame, state: { type: 'element' as const, element: { ...state } } }]
        return { ...studio, timeline: { ...studio.timeline, durationFrames: Math.max(studio.timeline.durationFrames, endFrame), clips } }
      })
      setSelectedElementId(element.id)
      return
    }
    if (track.kind === 'background') {
      changeScene((studio) => {
        const source = studio.timeline.clips.find((clip) => clip.trackId === track.id && playheadFrame >= clip.startFrame && playheadFrame < clip.endFrame)
        const background = source?.state.type === 'background' ? source.state.background : {
          backgroundColor: studio.backgroundColor, backgroundAssetId: studio.backgroundAssetId,
          backgroundX: studio.backgroundX, backgroundY: studio.backgroundY, backgroundWidth: studio.backgroundWidth,
          backgroundHeight: studio.backgroundHeight, backgroundRotation: studio.backgroundRotation
        }
        const nextStart = studio.timeline.clips.filter((clip) => clip.trackId === track.id && clip.startFrame > playheadFrame).reduce((minimum, clip) => Math.min(minimum, clip.startFrame), studio.timeline.durationFrames)
        const endFrame = Math.max(playheadFrame + 1, source?.endFrame ?? nextStart)
        const clips = studio.timeline.clips.flatMap((clip) => {
          if (clip.trackId !== track.id || clip.endFrame <= playheadFrame || clip.startFrame >= endFrame) return [clip]
          return clip.startFrame < playheadFrame ? [{ ...clip, endFrame: playheadFrame }] : []
        })
        return { ...studio, timeline: { ...studio.timeline, durationFrames: Math.max(studio.timeline.durationFrames, endFrame), clips: [...clips, { id: crypto.randomUUID(), trackId: track.id, elementId: null, startFrame: playheadFrame, endFrame, state: { type: 'background' as const, background: { ...background } } }] } }
      })
      setSelectedElementId('background')
      return
    }
    if (track.kind === 'speech' || track.kind === 'thought' || track.kind === 'narrator') {
      addTextElement(track.kind)
      return
    }
    const source = activeStudio.elements.find((element) => element.kind === 'image')
    if (source) {
      const element: StudioElement = { ...source, id: crypto.randomUUID(), text: '', x: source.x + 3, y: source.y + 3, zIndex: Math.max(0, ...activeStudio.elements.map((item) => item.zIndex)) + 1 }
      changeScene((studio) => ensureElementClip({ ...studio, elements: [...studio.elements, element] }, element, playheadFrame, studio.timeline.durationFrames))
      setSelectedElementId(element.id)
    }
  }

  const updateTimelinePreference = (values: Partial<Pick<StudioTimeline, 'loop' | 'speed'>>) => patchStudio((studio) => ({ ...studio, timeline: { ...studio.timeline, ...values } }))

  const isolateTimelineCharacterAsset = (element: StudioElement) => {
    if (!activeStudio || element.kind !== 'character' || !element.assetId) return null
    const clip = activeStudio.timeline.clips.find((item) => item.elementId === element.id && playheadFrame >= item.startFrame && playheadFrame < item.endFrame)
    if (!clip || clip.state.type !== 'element') return null
    const originalAssetId = activeStudio.elements.find((item) => item.id === element.id)?.assetId ?? element.assetId
    const currentAssetId = clip.state.element.assetId ?? originalAssetId
    const rememberedAssetId = studioTimelineAssetIdsRef.current[clip.id]
    let targetAssetId = rememberedAssetId ?? currentAssetId
    const sharedWithAnotherClip = activeStudio.timeline.clips.some((item) => item.id !== clip.id && item.elementId === element.id
      && item.state.type === 'element' && item.state.element.assetId === currentAssetId)
    if (!rememberedAssetId && (targetAssetId === originalAssetId || sharedWithAnotherClip)) targetAssetId = crypto.randomUUID()
    studioTimelineAssetIdsRef.current[clip.id] = targetAssetId
    const sourceAsset = activeStudio.assets.find((asset) => asset.id === currentAssetId)
      ?? activeStudio.assets.find((asset) => asset.id === originalAssetId)
    return sourceAsset ? { clipId: clip.id, assetId: targetAssetId, sourceAsset } : null
  }

  const saveTimelineCharacterAsset = (studio: StudioDocument, element: StudioElement, assetId: string, dataUrl: string, fallback?: StudioAsset) => {
    const current = studio.assets.find((asset) => asset.id === assetId)
    const source = current ?? fallback ?? studio.assets.find((asset) => asset.id === element.assetId)
    if (!source) return studio
    const asset: StudioAsset = { ...source, id: assetId, mimeType: 'image/png', dataUrl }
    const assets = current ? studio.assets.map((item) => item.id === assetId ? asset : item) : [...studio.assets, asset]
    const updatedElement = { ...element, assetId }
    return { ...addOrUpdateTimelineElement(studio, updatedElement, playheadFrame), assets }
  }

  const recordHistory = () => {
    if (!activeStudio) return
    undoRef.current = [...undoRef.current.slice(-29), snapshot(activeStudio)]
    redoRef.current = []
    setCanUndo(undoRef.current.length > 0)
    setCanRedo(false)
    setHistoryVersion((value) => value + 1)
  }

  const changeScene = (transform: (studio: StudioDocument) => StudioDocument) => {
    if (!activeStudio) return
    recordHistory()
    patchStudio((studio) => transform(studio))
  }

  const undo = () => {
    if (!activeStudio || !undoRef.current.length) return
    const previous = undoRef.current[undoRef.current.length - 1]
    undoRef.current = undoRef.current.slice(0, -1)
    redoRef.current = [...redoRef.current.slice(-29), snapshot(activeStudio)]
    playheadFrameRef.current = previous.timeline.currentFrame
    setPlayheadFrame(previous.timeline.currentFrame)
    patchStudio((studio) => withSnapshot(studio, previous))
    setCanUndo(undoRef.current.length > 0)
    setCanRedo(true)
    setHistoryVersion((value) => value + 1)
  }

  const redo = () => {
    if (!activeStudio || !redoRef.current.length) return
    const next = redoRef.current[redoRef.current.length - 1]
    redoRef.current = redoRef.current.slice(0, -1)
    undoRef.current = [...undoRef.current.slice(-29), snapshot(activeStudio)]
    playheadFrameRef.current = next.timeline.currentFrame
    setPlayheadFrame(next.timeline.currentFrame)
    patchStudio((studio) => withSnapshot(studio, next))
    setCanUndo(true)
    setCanRedo(redoRef.current.length > 0)
    setHistoryVersion((value) => value + 1)
  }

  const importImage = async (category: StudioAsset['category']) => {
    if (!activeStudio) return
    try {
      const asset = await window.desktop.importStudioImage(category)
      if (!asset) return
      const nextAssets = [...activeStudio.assets, asset]
      recordHistory()
      if (category === 'background') {
        patchStudio((studio) => ({ ...updateBackgroundTimeline(studio, { backgroundAssetId: asset.id, backgroundX: 0, backgroundY: 0, backgroundWidth: 100, backgroundHeight: 100, backgroundRotation: 0 }, playheadFrame), assets: nextAssets, updatedAt: new Date().toISOString() }))
        setSelectedElementId('background')
      } else {
        const element: StudioElement = { id: crypto.randomUUID(), kind: 'image', assetId: asset.id, text: '', x: 0, y: 0, width: 25, height: 25, rotation: 0, zIndex: Math.max(0, ...activeStudio.elements.map((item) => item.zIndex)) + 1 }
        patchStudio((studio) => {
          let next = { ...studio, assets: nextAssets, elements: [...studio.elements, element], updatedAt: new Date().toISOString() }
          next = ensureElementClip(next, element, playheadFrame, next.timeline.durationFrames)
          return next
        })
        setSelectedElementId(element.id)
      }
      setActiveTool(category === 'background' ? 'background' : 'objects')
      setInspectorOpen(true)
      setInspectorTab('editor')
      setError(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível importar a imagem.') }
  }

  const selectBackground = (asset: StudioAsset) => {
    changeScene((studio) => ({ ...updateBackgroundTimeline(studio, { backgroundAssetId: asset.id, backgroundX: 0, backgroundY: 0, backgroundWidth: 100, backgroundHeight: 100, backgroundRotation: 0 }, playheadFrame), updatedAt: new Date().toISOString() }))
    setSelectedElementId('background')
    setInspectorOpen(true)
    setInspectorTab('editor')
  }

  const addTextElement = (kind: 'narrator' | 'speech' | 'thought') => {
    if (!activeStudio) return
    const element = makeElement(kind, Math.max(0, ...activeStudio.elements.map((item) => item.zIndex)) + 1)
    changeScene((studio) => ensureElementClip({ ...studio, elements: [...studio.elements, element], updatedAt: new Date().toISOString() }, element, playheadFrame, playheadFrame + 120))
    setSelectedElementId(element.id)
    setInspectorOpen(true)
    setInspectorTab('editor')
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
        const rendered = await renderSavedCharacter(character)
        const crop = await trimTransparentImage(rendered.dataUrl)
        const imageData = crop?.dataUrl ?? rendered.dataUrl
        const imageWidth = crop?.width ?? rendered.width
        const imageHeight = crop?.height ?? rendered.height
        const asset: StudioAsset = { id: crypto.randomUUID(), category: 'character', name: character.name, mimeType: 'image/png', dataUrl: imageData }
        const width = 20
        const characterCanvasWidth = width * rendered.width / imageWidth
        const canvasHeight = characterCanvasWidth * stageWidth / stageHeight * rendered.height / rendered.width
        const height = Math.min(82, canvasHeight * imageHeight / rendered.height)
        assets.push(asset)
        elements.push({ id: crypto.randomUUID(), kind: 'character', assetId: asset.id, characterId: character.id, poseSlot: character.customization.poseSlot, characterScale: 100, characterWidthScale: 100, characterHeightScale: 100, characterCanvasWidth, text: character.name, x: 0, y: 0, width, height, rotation: 0, zIndex: ++zIndex })
      }
      const nextElements = [...retained, ...elements]
      const retainedAssetIds = new Set(retained.map((element) => element.assetId).filter((id): id is string => Boolean(id)))
      changeScene((studio) => {
        const removedIds = new Set(studio.elements.filter((element) => element.kind === 'character' && !selectedIds.has(element.characterId ?? '')).map((element) => element.id))
        let next: StudioDocument = {
          ...studio,
          elements: nextElements,
          assets: [...studio.assets.filter((asset) => !removedCharacterAssetIds.has(asset.id) || retainedAssetIds.has(asset.id)), ...assets],
          timeline: { ...studio.timeline, tracks: studio.timeline.tracks.filter((track) => !track.elementId || !removedIds.has(track.elementId)), clips: studio.timeline.clips.filter((clip) => !clip.elementId || !removedIds.has(clip.elementId)) },
          updatedAt: new Date().toISOString()
        }
        for (const element of elements) next = ensureElementClip(next, element, playheadFrame, next.timeline.durationFrames)
        return next
      })
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

  const applyStudioFaceAppearance = async (appearance: CustomizerFaceAppearance, faceTransforms: StudioFaceTransforms = selectedElement?.faceTransforms ?? {}, record = true) => {
    if (!activeStudio || selectedElement?.kind !== 'character' || !selectedStudioCharacter || !selectedElement.assetId || studioFaceBusy) return
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
        customization: { ...selectedStudioCharacter.customization, poseSlot: selectedElement.poseSlot ?? selectedStudioCharacter.customization.poseSlot, faceAppearance: appearance }
      }
      const key = studioCharacterRenderKey(characterCopy)
      if (!studioFaceRendererRef.current || studioFaceRendererRef.current.key !== key) {
        const { prepareSavedCharacterRenderer } = await import('../customizer/CustomizerPage')
        const renderer = await prepareSavedCharacterRenderer(characterCopy)
        studioFaceRendererRef.current = { key, render: renderer.render }
      }
      const rendered = await studioFaceRendererRef.current.render(appearance, faceTransforms)
      const trimmed = await trimTransparentImage(rendered.dataUrl)
      const studioDataUrl = trimmed?.dataUrl ?? rendered.dataUrl
      const element = selectedElement
      const isolated = isolateTimelineCharacterAsset(element)
      if (!isolated) return
      const nextElement = { ...element, faceAppearance: appearance, faceTransforms, assetId: isolated.assetId }
      const update = (studio: StudioDocument): StudioDocument => ({
        ...saveTimelineCharacterAsset(studio, nextElement, isolated.assetId, studioDataUrl, isolated.sourceAsset),
        updatedAt: new Date().toISOString()
      })
      if (record) changeScene(update)
      else patchStudio(update)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível aplicar a peça facial neste Studio.')
    } finally { setStudioFaceBusy(false) }
  }

  const applyStudioPose = async (poseSlot: number | null) => {
    if (!activeStudio || selectedElement?.kind !== 'character' || !selectedStudioCharacter || !selectedElement.assetId || studioFaceBusy) return
    setStudioFaceBusy(true)
    try {
      const { renderSavedCharacter } = await import('../customizer/CustomizerPage')
      let characterCanvasWidth = selectedElement.characterCanvasWidth
      if (!characterCanvasWidth) {
        const currentPoseCharacter: CustomizerCharacter = { ...selectedStudioCharacter, customization: { ...selectedStudioCharacter.customization, poseSlot: selectedElement.poseSlot ?? selectedStudioCharacter.customization.poseSlot, faceAppearance: selectedElement.faceAppearance ?? selectedStudioCharacter.customization.faceAppearance } }
        const currentRendered = await renderSavedCharacter(currentPoseCharacter, selectedElement.faceTransforms)
        const currentCrop = await trimTransparentImage(currentRendered.dataUrl)
        characterCanvasWidth = selectedElement.width * currentRendered.width / (currentCrop?.width ?? currentRendered.width)
      }
      const characterCopy: CustomizerCharacter = { ...selectedStudioCharacter, customization: { ...selectedStudioCharacter.customization, poseSlot } }
      const rendered = await renderSavedCharacter(characterCopy, selectedElement.faceTransforms)
      const trimmed = await trimTransparentImage(rendered.dataUrl)
      const dataUrl = trimmed?.dataUrl ?? rendered.dataUrl
      const cropWidth = trimmed?.width ?? rendered.width
      const cropHeight = trimmed?.height ?? rendered.height
      const stageWidth = sceneRef.current?.clientWidth ?? 1000
      const stageHeight = sceneRef.current?.clientHeight ?? 562
      const fullCanvasHeight = characterCanvasWidth * stageWidth / stageHeight * rendered.height / rendered.width
      const width = characterCanvasWidth * cropWidth / rendered.width
      const height = fullCanvasHeight * cropHeight / rendered.height
      const isolated = isolateTimelineCharacterAsset(selectedElement)
      if (!isolated) return
      const nextElement = { ...selectedElement, poseSlot, characterCanvasWidth, width, height, assetId: isolated.assetId }
      changeScene((studio) => ({ ...saveTimelineCharacterAsset(studio, nextElement, isolated.assetId, dataUrl, isolated.sourceAsset), updatedAt: new Date().toISOString() }))
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
    await applyStudioFaceAppearance(appearance)
  }

  const updateStudioFaceVariant = (patch: Partial<CustomizerFaceAppearance>) => {
    if (!selectedStudioFaceAppearance || selectedStudioCharacterModelSlot === null) return
    void applyStudioFaceAppearance({ ...selectedStudioFaceAppearance, ...patch })
  }

  const updateStudioFaceTransform = (transformKey: string, patch: Partial<StudioFaceTransform>, record = false, baseTransform = defaultStudioEyeTransform) => {
    if (!selectedElement || selectedElement.kind !== 'character') return
    const saved = studioFaceTransformsRef.current[selectedElement.id] ?? selectedElement.faceTransforms ?? {}
    const transform = { ...(saved[transformKey] ?? baseTransform), ...patch }
    const next = { ...saved, [transformKey]: transform }
    studioFaceTransformsRef.current[selectedElement.id] = next
    const isolated = isolateTimelineCharacterAsset(selectedElement)
    if (!isolated) return
    const asset = activeStudio?.assets.find((item) => item.id === isolated.assetId) ?? isolated.sourceAsset
    patchStudio((studio) => saveTimelineCharacterAsset(studio, { ...selectedElement, faceTransforms: next, assetId: isolated.assetId }, isolated.assetId, asset.dataUrl, isolated.sourceAsset))
    if (record) recordHistory()
    if (selectedStudioCharacter && selectedStudioFaceAppearance && isolated.assetId && activeStudioId) {
      const character: CustomizerCharacter = { ...selectedStudioCharacter, customization: { ...selectedStudioCharacter.customization, poseSlot: selectedElement.poseSlot ?? selectedStudioCharacter.customization.poseSlot, faceAppearance: selectedStudioFaceAppearance } }
      scheduleStudioFacePreview({ studioId: activeStudioId, elementId: selectedElement.id, assetId: isolated.assetId, character, transforms: next })
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
          const rendered = await studioFaceRendererRef.current.render(job.character.customization.faceAppearance, job.transforms)
          const trimmed = await trimTransparentImage(rendered.dataUrl)
          const studioDataUrl = trimmed?.dataUrl ?? rendered.dataUrl
          if (version === studioFaceRenderVersionRef.current && job.studioId === activeStudioId) {
            patchStudio((studio) => ({
              ...studio,
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
        timeline: { ...studio.timeline, tracks: studio.timeline.tracks.filter((track) => track.elementId !== element.id), clips: studio.timeline.clips.filter((clip) => clip.elementId !== element.id) },
        updatedAt: new Date().toISOString()
      }
    })
    if (selectedElementId === element.id) setSelectedElementId(null)
  }

  const updateElement = (id: string, values: Partial<StudioElement>, record = true) => {
    const update = (studio: StudioDocument) => {
      const element = studio.timeline.clips.find((clip) => clip.elementId === id && playheadFrame >= clip.startFrame && playheadFrame < clip.endFrame)?.state
      const source = element?.type === 'element' ? element.element : studio.elements.find((item) => item.id === id)
      if (!source) return studio
      const nextElement = { ...source, ...values }
      const nextStudio = addOrUpdateTimelineElement(studio, nextElement, playheadFrame)
      return { ...nextStudio, updatedAt: new Date().toISOString() }
    }
    if (record) changeScene(update)
    else patchStudio(update)
  }

  const updateBackground = (values: Partial<Pick<StudioDocument, 'backgroundColor' | 'backgroundX' | 'backgroundY' | 'backgroundWidth' | 'backgroundHeight' | 'backgroundRotation'>>, record = true) => {
    const update = (studio: StudioDocument) => ({ ...updateBackgroundTimeline(studio, values, playheadFrame), updatedAt: new Date().toISOString() })
    if (record) changeScene(update)
    else patchStudio(update)
  }

  const startDrag = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (!activeStudio || !sceneRef.current) return
    event.preventDefault()
    event.stopPropagation()
    if (id === 'background') {
      const rect = sceneRef.current.getBoundingClientRect()
      recordHistory()
      setSelectedElementId('background')
      setActiveTool('background')
      setInspectorOpen(true)
      setInspectorTab('editor')
      dragRef.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originalX: sceneStudio?.backgroundX ?? activeStudio.backgroundX, originalY: sceneStudio?.backgroundY ?? activeStudio.backgroundY, width: rect.width, height: rect.height }
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    const element = sceneStudio?.elements.find((item) => item.id === id)
    if (!element) return
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
    if (drag.id === 'background') patchStudio((studio) => ({ ...updateBackgroundTimeline(studio, { backgroundX: x, backgroundY: y }, playheadFrame), updatedAt: new Date().toISOString() }))
    else updateElement(drag.id, { x, y }, false)
  }

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
  }

  const deleteSelected = () => {
    if (!activeStudio) return
    if (selectedElementId === 'background') {
      changeScene((studio) => updateBackgroundTimeline(studio, { backgroundAssetId: null }, playheadFrame))
      setSelectedElementId(null)
    } else if (selectedElementId) {
      const current = activeStudio.elements.find((element) => element.id === selectedElementId)
      if (current?.kind === 'character') removeStageCharacter(current)
      else changeScene((studio) => ({ ...studio, elements: studio.elements.filter((element) => element.id !== selectedElementId), timeline: { ...studio.timeline, clips: studio.timeline.clips.filter((clip) => clip.elementId !== selectedElementId) }, updatedAt: new Date().toISOString() }))
      setSelectedElementId(null)
    }
  }

  const deleteStudio = async (target: StudioCard | null = selectedStudio) => {
    if (!target || !window.confirm(`Excluir ${target.title}?`)) return
    try {
      await window.desktop.deleteStudio(target.id)
      setStudios((current) => current.filter((studio) => studio.id !== target.id))
      setSelectedId((current) => current === target.id ? null : current)
      setSaved(true)
      setError(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível excluir o Studio.') }
  }

  const leaveStudio = async () => {
    if (!activeStudio) return
    setPlaying(false)
    const current = { ...activeStudio, timeline: { ...activeStudio.timeline, currentFrame: playheadFrameRef.current } }
    setStudios((items) => items.map((studio) => studio.id === current.id ? current : studio))
    if (!await saveStudio(current)) return
    setActiveStudioId(null)
    setActiveTool(null)
    setSelectedElementId(null)
    setFullView(false)
  }

  const exportPrint = async () => {
    if (!activeStudio) return
    try {
      if (!await saveStudio(activeStudio)) return
      const image = await makeCanvasPrint(sceneStudio ?? activeStudio)
      const path = await window.desktop.saveStudioPrint(activeStudio.id, image)
      if (path) { setError(null); setNotice(`Print salvo em ${path}`) }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível gerar o print.') }
  }

  const openPrints = async () => {
    if (!activeStudio) return
    try { await window.desktop.openStudioPrints(activeStudio.id) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível abrir a pasta de prints.') }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && castPickerOpen && !savingCast) setCastPickerOpen(false)
      else if (event.key === 'Escape' && fullView) setFullView(false)
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [castPickerOpen, savingCast, fullView, activeStudio, historyVersion])

  const imageStyle = (x: number, y: number, width: number, height: number, rotation: number, flipX = false) => ({
    left: `calc(50% + ${x}%)`, top: `calc(50% + ${y}%)`, width: `${width}%`, height: `${height}%`,
    transform: `translate(-50%, -50%) rotate(${rotation}deg) scaleX(${flipX ? -1 : 1})`
  })

  const control = (label: string, value: number, onChange: (value: number, record?: boolean) => void, min: number, max: number, suffix = '%', onFinish?: () => void, disabled = false) => (
    <StudioNumericControl key={label} label={label} value={value} onChange={onChange} onStart={recordHistory} onFinish={onFinish} disabled={disabled} min={min} max={max} suffix={suffix} />
  )

  const propertyPanel = (): ReactNode => {
    if (!activeStudio) return null
    if (activeTool === 'background') return <div className="studio-side-content">
      <h2>Fundos</h2><p>Escolha um fundo salvo ou adicione uma imagem.</p>
      <label className="studio-color-control">Cor sólida<input type="color" value={sceneStudio?.backgroundColor ?? activeStudio.backgroundColor} onChange={(event) => updateBackground({ backgroundColor: event.target.value })} /></label>
      <button className="studio-side-primary" type="button" onClick={() => void importImage('background')}><Icon name="plus" />Adicionar imagem</button>
      <div className="studio-asset-grid">{activeStudio.assets.filter((asset) => asset.category === 'background').map((asset) => <button key={asset.id} className={`studio-asset-card${sceneStudio?.backgroundAssetId === asset.id ? ' active' : ''}`} type="button" onClick={() => selectBackground(asset)}><img src={asset.dataUrl} alt="" /><span>{asset.name}</span></button>)}</div>
      {selectedBackgroundAsset && selectedElementId === 'background' && <><div className="studio-controls-grid">{control('X', sceneStudio?.backgroundX ?? activeStudio.backgroundX, (value, record) => updateBackground({ backgroundX: value }, record), -100, 100)}{control('Y', sceneStudio?.backgroundY ?? activeStudio.backgroundY, (value, record) => updateBackground({ backgroundY: value }, record), -100, 100)}{control('Largura', sceneStudio?.backgroundWidth ?? activeStudio.backgroundWidth, (value, record) => updateBackground({ backgroundWidth: value }, record), 1, 300)}{control('Altura', sceneStudio?.backgroundHeight ?? activeStudio.backgroundHeight, (value, record) => updateBackground({ backgroundHeight: value }, record), 1, 300)}{control('Rotação', sceneStudio?.backgroundRotation ?? activeStudio.backgroundRotation, (value, record) => updateBackground({ backgroundRotation: value }, record), -180, 180, '°')}</div><button className="studio-side-danger" type="button" onClick={deleteSelected}><Icon name="trash" />Remover fundo da cena</button></>}
    </div>
    if (activeTool === 'objects') return <div className="studio-side-content">
      <h2>Objetos</h2><p>Imagens importadas ficam disponíveis neste Studio.</p>
      <button className="studio-side-primary" type="button" onClick={() => void importImage('object')}><Icon name="plus" />Importar imagem</button>
      <div className="studio-asset-grid">{activeStudio.assets.filter((asset) => asset.category === 'object').map((asset) => <button key={asset.id} className="studio-asset-card" type="button" onClick={() => {
        const element: StudioElement = { id: crypto.randomUUID(), kind: 'image', assetId: asset.id, text: '', x: 0, y: 0, width: 25, height: 25, rotation: 0, zIndex: Math.max(0, ...activeStudio.elements.map((item) => item.zIndex)) + 1 }
        changeScene((studio) => ensureElementClip({ ...studio, elements: [...studio.elements, element], updatedAt: new Date().toISOString() }, element, playheadFrame, studio.timeline.durationFrames))
        setSelectedElementId(element.id)
        setInspectorOpen(true)
        setInspectorTab('editor')
      }}><img src={asset.dataUrl} alt="" /><span>{asset.name}</span></button>)}</div>
      {selectedElementId && selectedElement && <ElementControls element={selectedElement} update={(values, record) => updateElement(selectedElement.id, values, record)} remove={deleteSelected} control={control} />}
    </div>
    if (selectedElement && activeStudio) return <div className="studio-side-content">
      <h2>{selectedElement.kind === 'character' ? selectedElement.text : selectedElement.kind === 'image' ? 'Objeto selecionado' : selectedElement.kind === 'narrator' ? 'Narrador' : selectedElement.kind === 'speech' ? 'Balão de fala' : 'Balão de pensamento'}</h2>
      {selectedElement.kind !== 'image' && selectedElement.kind !== 'character' && <label className="studio-text-control">Texto<textarea value={selectedElement.text} onChange={(event) => updateElement(selectedElement.id, { text: event.target.value })} rows={3} /></label>}
      <ElementControls element={selectedElement} update={(values, record) => updateElement(selectedElement.id, values, record)} remove={deleteSelected} control={control} />
    </div>
    if (selectedElementId === 'background' && selectedBackgroundAsset) return <div className="studio-side-content">
      <h2>Imagem de fundo</h2><p>{selectedBackgroundAsset.name}</p>
      <div className="studio-controls-grid">{control('X', sceneStudio?.backgroundX ?? activeStudio.backgroundX, (value, record) => updateBackground({ backgroundX: value }, record), -100, 100)}{control('Y', sceneStudio?.backgroundY ?? activeStudio.backgroundY, (value, record) => updateBackground({ backgroundY: value }, record), -100, 100)}{control('Largura', sceneStudio?.backgroundWidth ?? activeStudio.backgroundWidth, (value, record) => updateBackground({ backgroundWidth: value }, record), 1, 300)}{control('Altura', sceneStudio?.backgroundHeight ?? activeStudio.backgroundHeight, (value, record) => updateBackground({ backgroundHeight: value }, record), 1, 300)}{control('Rotação', sceneStudio?.backgroundRotation ?? activeStudio.backgroundRotation, (value, record) => updateBackground({ backgroundRotation: value }, record), -180, 180, '°')}</div>
      <button className="studio-side-danger" type="button" onClick={deleteSelected}><Icon name="trash" />Remover fundo</button>
    </div>
    return <div className="studio-side-content"><h2>Cena</h2><p>Escolha uma ferramenta à esquerda ou selecione um elemento na cena.</p><small>{activeStudio.elements.length} elemento(s)</small></div>
  }

  const customPanel = (): ReactNode => {
    if (!selectedStudioCharacter || selectedElement?.kind !== 'character' || selectedStudioCharacterModelSlot === null) {
      return <div className="studio-custom-empty"><strong>Personalizar personagem</strong><span>Selecione um personagem na prévia ou no elenco para escolher as peças do rosto.</span></div>
    }
    const sheetKind: FaceSheetKind = studioFaceCategory === 'mouth'
      ? selectedStudioFaceAppearance?.mouthOpen ? 'mouth-open' : 'mouth-closed'
      : studioFaceCategory
    const selectedItemId = sheetKind === 'eyes' ? selectedStudioFaceAppearance?.eyeCatalogId
      : sheetKind === 'eyebrows' ? selectedStudioFaceAppearance?.eyebrowCatalogId
        : sheetKind === 'nose' ? selectedStudioFaceAppearance?.noseCatalogId
          : sheetKind === 'mouth-open' ? selectedStudioFaceAppearance?.mouthOpenCatalogId
            : selectedStudioFaceAppearance?.mouthClosedCatalogId
    const activeItem = selectedItemId ? studioFaceDetails[`${selectedStudioCharacterModelSlot}:${selectedItemId}`] : null
    const studioTransformKey = selectedItemId ? `${sheetKind}:${selectedItemId}` : studioFaceCategory
    const selectedStudioFaceTransform = selectedElement.faceTransforms?.[studioTransformKey]
      ?? selectedElement.faceTransforms?.[studioFaceCategory]
      ?? defaultStudioEyeTransform
    const catalogItems = studioFaceItems.filter((item) => item.category === sheetKind)
    const renderPair = (pieces: FaceCatalogItem['pieces']) => pieces.slice(0, 2).map((piece) => <img key={piece.id} src={piece.dataUrl} alt="" />)
    const categoryButtons = [
      { id: 'eyes', label: 'Olhos' }, { id: 'eyebrows', label: 'Sobrancelhas' },
      { id: 'nose', label: 'Nariz' }, { id: 'mouth', label: 'Boca' }
    ] as const
    return <div className="studio-custom-face">
      <div className="studio-custom-face-categories" aria-label="Categorias do rosto">
        {categoryButtons.map((category) => <button key={category.id} className={studioFaceCategory === category.id ? 'active' : ''} onClick={() => setStudioFaceCategory(category.id)} type="button">{category.label}</button>)}
      </div>
      {studioFaceCategory === 'mouth' && <div className="studio-custom-mouth-tabs"><button className={!selectedStudioFaceAppearance?.mouthOpen ? 'active' : ''} onClick={() => updateStudioFaceVariant({ mouthOpen: false })} disabled={!selectedStudioFaceAppearance || studioFaceBusy} type="button">Fechada</button><button className={selectedStudioFaceAppearance?.mouthOpen ? 'active' : ''} onClick={() => updateStudioFaceVariant({ mouthOpen: true })} disabled={!selectedStudioFaceAppearance || studioFaceBusy} type="button">Aberta</button></div>}
      <label className="studio-custom-eye-sheet-select"><span>{studioFaceCategory === 'eyes' ? 'Folha de olhos' : studioFaceCategory === 'eyebrows' ? 'Folha de sobrancelhas' : studioFaceCategory === 'nose' ? 'Folha de nariz' : 'Folha de boca'}</span><select value={selectedItemId ?? ''} onChange={(event) => { const summary = catalogItems.find((item) => item.id === event.target.value); if (summary) void chooseStudioFaceSheet(summary) }} disabled={studioFaceBusy || studioFaceLoading}><option value="">Selecione uma folha</option>{catalogItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {studioFaceLoading && <p className="studio-custom-hint">Carregando catálogo facial…</p>}
      {studioFaceCategory === 'eyebrows' && selectedStudioFaceAppearance?.eyebrowCatalogId && <button className={`studio-custom-toggle${selectedStudioFaceAppearance.eyebrows ? ' active' : ''}`} onClick={() => updateStudioFaceVariant({ eyebrows: !selectedStudioFaceAppearance.eyebrows })} disabled={studioFaceBusy} type="button">{selectedStudioFaceAppearance.eyebrows ? 'Ocultar sobrancelhas' : 'Mostrar sobrancelhas'}</button>}
      {sheetKind === 'eyes' && <>
        {activeItem ? <div className="studio-custom-face-variants">{[0, 1, 2].map((index) => {
          const pieces = activeItem.pieces.filter((piece) => piece.index === index)
          const labels = ['Direita', 'Esquerda', 'Fechados']
          return <button className={(selectedStudioFaceAppearance?.eyeState === index ? 'selected' : '')} key={index} onClick={() => updateStudioFaceVariant({ eyeState: index as 0 | 1 | 2 })} disabled={studioFaceBusy} type="button"><span>{renderPair(pieces)}</span><b>{labels[index]}</b></button>
        })}</div> : <p className="studio-custom-hint">Escolha uma folha de olhos para ver as três variantes.</p>}
      </>}
      {activeItem && <>
        {sheetKind === 'nose' && <div className="studio-custom-face-variants studio-custom-face-grid">{activeItem.pieces.map((piece) => <button className={(selectedStudioFaceAppearance?.noseIndex === piece.index ? 'selected' : '')} key={piece.id} onClick={() => updateStudioFaceVariant({ noseIndex: piece.index })} disabled={studioFaceBusy} type="button"><span><img src={piece.dataUrl} alt="" /></span><b>{piece.index + 1}</b></button>)}</div>}
        {sheetKind.startsWith('mouth') && <div className="studio-custom-face-variants studio-custom-face-grid">{activeItem.pieces.map((piece) => <button className={(selectedStudioFaceAppearance?.expressionIndex === piece.index ? 'selected' : '')} key={piece.id} onClick={() => updateStudioFaceVariant({ expressionIndex: piece.index })} disabled={studioFaceBusy} type="button"><span><img src={piece.dataUrl} alt="" /></span><b>{String(piece.index + 1).padStart(2, '0')}</b></button>)}</div>}
      </>}
      <div className="studio-controls-grid studio-custom-eye-controls">
        {control('X', selectedStudioFaceTransform.x, (value, record) => updateStudioFaceTransform(studioTransformKey, { x: value }, record, selectedStudioFaceTransform), -100, 100, '%', () => finishStudioFaceTransform(studioTransformKey), studioFaceBusy)}
        {control('Y', selectedStudioFaceTransform.y, (value, record) => updateStudioFaceTransform(studioTransformKey, { y: value }, record, selectedStudioFaceTransform), -100, 100, '%', () => finishStudioFaceTransform(studioTransformKey), studioFaceBusy)}
        {control('Largura', selectedStudioFaceTransform.width, (value, record) => updateStudioFaceTransform(studioTransformKey, { width: value }, record, selectedStudioFaceTransform), 1, 300, '%', () => finishStudioFaceTransform(studioTransformKey), studioFaceBusy)}
        {control('Altura', selectedStudioFaceTransform.height, (value, record) => updateStudioFaceTransform(studioTransformKey, { height: value }, record, selectedStudioFaceTransform), 1, 300, '%', () => finishStudioFaceTransform(studioTransformKey), studioFaceBusy)}
        {control('Rotação', selectedStudioFaceTransform.rotation, (value, record) => updateStudioFaceTransform(studioTransformKey, { rotation: value }, record, selectedStudioFaceTransform), -180, 180, '°', () => finishStudioFaceTransform(studioTransformKey), studioFaceBusy)}
      </div>
      {studioFaceBusy && <p className="studio-custom-hint" role="status">Atualizando personagem…</p>}
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
    if (!selectedStudioCharacter || selectedElement?.kind !== 'character') return <div className="studio-custom-empty"><strong>Presets</strong><span>Selecione um personagem na cena para ver poses e expressões.</span></div>
    return <div className="studio-presets-panel">
      <div className="studio-preset-buttons" aria-label="Categorias de presets">
        {presetOptions.map((option) => <button key={option.id} className={`studio-preset-button${option.id === studioPresetCategory ? ' active' : ''}${option.id.startsWith('reserved') ? ' reserved' : ''}`} disabled={option.id.startsWith('reserved')} onClick={() => { if (option.id === 'pose' || option.id === 'expression') setStudioPresetCategory(option.id) }} type="button"><Icon name={option.icon} /><span>{option.label}</span></button>)}
      </div>
        {studioPresetCategory === 'pose' && <section className="studio-preset-catalog" aria-label="Catálogo de poses">
        <h3>Poses do modelo</h3>
        <div className="studio-preset-list">
          {studioPoseSlots.filter((pose): pose is NonNullable<FabricatorPoseSummary> => pose !== null).map((pose) => {
            const dimensions = studioPoseDimensions[pose.slot]
            return <button className={`studio-pose-option${selectedStudioPoseSlot === pose.slot ? ' selected' : ''}`} key={pose.slot} onClick={() => void applyStudioPose(pose.slot)} disabled={studioFaceBusy} aria-label={`Selecionar pose ${pose.name}`} title={pose.name} style={dimensions ? { aspectRatio: `${dimensions.width}/${dimensions.height}` } : undefined} type="button">{studioPoseThumbnails[pose.slot] ? <img src={studioPoseThumbnails[pose.slot]} alt="" /> : <span className="studio-pose-thumb-placeholder" />}</button>
          })}
          {!studioPoseSlots.length && <p className="studio-custom-hint">Este modelo ainda não tem poses salvas.</p>}
        </div>
      </section>}
    </div>
  }

  const castPanel = () => <div className="studio-cast-content">
    <header><span><h2>Elenco</h2><small>{stageCharacters.length} na cena</small></span><button className="studio-cast-add-button" onClick={openCastPicker} type="button"><Icon name="plus" />Adicionar</button></header>
    <section className="studio-cast-section" aria-label="Personagens na cena">
      <header><h3>Na cena</h3><button className={`studio-cast-lock${allStageCharactersLocked ? ' active' : ''}`} onClick={toggleStageCharacterPositionLock} disabled={!stageCharacters.length} aria-label={allStageCharactersLocked ? 'Desbloquear posição dos personagens' : 'Bloquear posição dos personagens'} title={allStageCharactersLocked ? 'Desbloquear posições' : 'Bloquear posições'} type="button"><Icon name={allStageCharactersLocked ? 'lock' : 'unlock'} /></button></header>
      {stageCharacters.length ? stageCharacters.map((element) => {
        const character = availableCharacters.find((item) => item.id === element.characterId)
        const firstName = (character?.name ?? element.text).trim().split(/\s+/)[0] || element.text
        return <article className={`studio-cast-item${selectedElementId === element.id ? ' selected' : ''}`} key={element.id}>
          <button className="studio-cast-select" onClick={() => { setSelectedElementId(element.id); setActiveTool(null); setInspectorOpen(true); restoreCharacterInspectorView() }} type="button">
            {character ? <CharacterPortrait character={character} /> : <span className="studio-cast-fallback">{element.text.slice(0, 1)}</span>}
            <span>{firstName}</span>
          </button>
          <button className="studio-cast-remove" onClick={() => removeStageCharacter(element)} aria-label={`Remover ${firstName} do elenco`} title="Remover da cena" type="button">×</button>
        </article>
      }) : <p className="studio-cast-empty">Adicione personagens para montar a cena.</p>}
    </section>
  </div>

  if (activeStudio) {
    const backgroundAsset = sceneStudio?.assets.find((asset) => asset.id === sceneStudio.backgroundAssetId)
    const inspectorWidth = sceneRef.current ? Math.min(38, 276 / sceneRef.current.clientWidth * 100) : 28
    const selectedBounds = selectedElement
      ? { left: 50 + selectedElement.x - studioElementSize(selectedElement).width / 2, right: 50 + selectedElement.x + studioElementSize(selectedElement).width / 2 }
      : selectedElementId === 'background'
        ? { left: 50 + (sceneStudio?.backgroundX ?? activeStudio.backgroundX) - (sceneStudio?.backgroundWidth ?? activeStudio.backgroundWidth) / 2, right: 50 + (sceneStudio?.backgroundX ?? activeStudio.backgroundX) + (sceneStudio?.backgroundWidth ?? activeStudio.backgroundWidth) / 2 }
        : null
    const inspectorSide = selectedBounds?.right !== undefined && selectedBounds.right > 100 - inspectorWidth
      ? 'left'
      : selectedBounds?.left !== undefined && selectedBounds.left < inspectorWidth ? 'right' : 'right'
    return (
      <main className={`studio-editor${fullView ? ' full-view' : ''}`} aria-label={`Editor do ${activeStudio.title}`}>
        {!fullView && <aside className="studio-editor-rail studio-editor-left" aria-label="Ferramentas do Studio">
          <div className="studio-editor-quick-actions">
            <button className="studio-round-action" onClick={() => void leaveStudio()} title="Salvar automaticamente e voltar" aria-label="Voltar para Seus Studios" type="button"><span>←</span></button>
            <button className="studio-round-action" onClick={() => void saveStudio(activeStudio)} title="Salvar agora no computador" aria-label="Salvar Studio" type="button"><Icon name="save" /></button>
          </div>
          <div className="studio-editor-quick-actions studio-history-actions">
            <button className="studio-round-action" disabled={!canUndo} onClick={undo} title="Desfazer (Ctrl+Z)" aria-label="Desfazer" type="button"><Icon name="undo" /></button>
            <button className="studio-round-action" disabled={!canRedo} onClick={redo} title="Refazer (Ctrl+Y)" aria-label="Refazer" type="button"><Icon name="redo" /></button>
          </div>
          <nav className="studio-tool-list" aria-label="Ferramentas da cena">
            {studioTools.map((tool) => <button className={`studio-tool-button${activeTool === tool.id ? ' active' : ''}`} key={tool.id} onClick={() => { setActiveTool(tool.id); setInspectorOpen(true); setInspectorTab('editor') }} type="button"><Icon name={tool.icon} /><span>{tool.label}</span><i aria-hidden="true">✦</i></button>)}
            <button className="studio-tool-button" onClick={() => addTextElement('narrator')} type="button"><Icon name="message" /><span>Narrador</span><i aria-hidden="true">✦</i></button>
            <button className="studio-tool-button" onClick={() => addTextElement('speech')} type="button"><Icon name="message" /><span>Fala</span><i aria-hidden="true">✦</i></button>
            <button className="studio-tool-button" onClick={() => addTextElement('thought')} type="button"><Icon name="face" /><span>Pensamento</span><i aria-hidden="true">✦</i></button>
            <span className="studio-tool-separator" />
            <button className="studio-tool-button" onClick={() => void exportPrint()} type="button"><Icon name="download" /><span>Print</span><i aria-hidden="true">✦</i></button>
            <button className="studio-tool-button" onClick={() => void openPrints()} type="button"><Icon name="folder" /><span>Pasta</span><i aria-hidden="true">✦</i></button>
            <button className="studio-tool-button studio-view-button" onClick={() => setFullView(true)} type="button"><Icon name="expand" /><span>View</span></button>
          </nav>
          <small className={`studio-save-indicator${saved ? '' : ' unsaved'}`}><i />{saved ? 'Salvo automaticamente' : 'Salvando alterações…'}</small>
          {error && <small className="studio-error-message" role="alert">{error}</small>}
          {notice && <small className="studio-save-notice" role="status">{notice}</small>}
        </aside>}
        <section className="studio-scene-area" aria-label="Prévia da cena">
          <div className="studio-scene-canvas" ref={sceneRef} style={{ backgroundColor: sceneStudio?.backgroundColor ?? activeStudio.backgroundColor }} onPointerDown={() => setSelectedElementId(null)}>
            {backgroundAsset && <img className={`studio-canvas-background${selectedElementId === 'background' && !fullView ? ' selected' : ''}`} src={backgroundAsset.dataUrl} alt="" style={imageStyle(sceneStudio?.backgroundX ?? activeStudio.backgroundX, sceneStudio?.backgroundY ?? activeStudio.backgroundY, sceneStudio?.backgroundWidth ?? activeStudio.backgroundWidth, sceneStudio?.backgroundHeight ?? activeStudio.backgroundHeight, sceneStudio?.backgroundRotation ?? activeStudio.backgroundRotation)} onPointerDown={(event) => startDrag(event, 'background')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />}
            {[...(sceneStudio?.elements ?? [])].sort((a, b) => a.zIndex - b.zIndex).map((element) => {
              const asset = element.assetId ? sceneStudio?.assets.find((item) => item.id === element.assetId) : undefined
              const size = studioElementSize(element)
              return <div key={element.id} className={`studio-canvas-element studio-element-${element.kind}${selectedElementId === element.id && !fullView ? ' selected' : ''}`} style={{ ...imageStyle(element.x, element.y, size.width, size.height, element.rotation, element.kind === 'character' && element.flipX === true), zIndex: element.zIndex + 1 }} onPointerDown={(event) => startDrag(event, element.id)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
                {(element.kind === 'image' || element.kind === 'character') && asset ? <img src={asset.dataUrl} alt={asset.name} draggable={false} /> : <span>{element.text}</span>}
              </div>
            })}
            {fullView && <button className="studio-exit-view" onClick={() => setFullView(false)} type="button">Sair da visualização <kbd>Esc</kbd></button>}
            {!fullView && <span className="studio-scene-title">{activeStudio.title}</span>}
            {!fullView && inspectorOpen && <aside className={`studio-inspector studio-inspector-${inspectorSide}`} aria-label="Inspector da cena" onPointerDown={(event) => event.stopPropagation()}>
              <header className="studio-inspector-tabs"><button className={inspectorTab === 'editor' ? 'active' : ''} onClick={() => { setInspectorTab('editor'); rememberCharacterInspectorView('editor') }} type="button">Editor</button><button className={inspectorTab === 'custom' && inspectorCustomView === 'face' ? 'active' : ''} onClick={() => { setInspectorTab('custom'); setInspectorCustomView('face'); rememberCharacterInspectorView('custom', 'face') }} type="button">Custom</button><button className="studio-inspector-close" onClick={() => setInspectorOpen(false)} aria-label="Fechar inspector" title="Fechar" type="button">×</button></header>
              <button className={`studio-inspector-presets${inspectorTab === 'custom' && inspectorCustomView === 'presets' ? ' active' : ''}`} onClick={() => { setInspectorTab('custom'); setInspectorCustomView('presets'); rememberCharacterInspectorView('custom', 'presets') }} type="button"><Icon name="sparkles" />Presets</button>
              {inspectorTab === 'editor' ? <div className="studio-inspector-content">{propertyPanel()}</div> : <div className="studio-inspector-content">{inspectorCustomView === 'presets' ? presetsPanel() : customPanel()}</div>}
            </aside>}
          </div>
        </section>
        {!fullView && <aside className="studio-editor-rail studio-editor-right" aria-label="Elenco do Studio">{castPanel()}</aside>}
        {!fullView && <StudioTimelinePanel
          timeline={activeStudio.timeline}
          currentFrame={playheadFrame}
          playing={playing}
          selectedClipId={selectedTimelineClipId}
          onPlayPause={toggleTimelinePlayback}
          onSeek={seekTimeline}
          onSelectClip={(clip) => {
            setSelectedTimelineClipId(clip.id)
            seekTimeline(clip.startFrame)
            setSelectedElementId(clip.elementId ?? 'background')
            setActiveTool(clip.elementId === null ? 'background' : null)
            setInspectorTab('editor')
            setInspectorOpen(true)
          }}
          onMoveClip={moveTimelineClip}
          onResizeClip={resizeTimelineClip}
          onSplitClip={splitSelectedTimelineClip}
          onDeleteClip={deleteSelectedTimelineClip}
          onToggleLoop={() => updateTimelinePreference({ loop: !activeStudio.timeline.loop })}
          onSetSpeed={(speed) => updateTimelinePreference({ speed })}
          onAddBlock={addTimelineBlock}
          onEditStart={recordHistory}
        />}
        {castPickerOpen && <div className="studio-cast-modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !savingCast) setCastPickerOpen(false) }}>
          <section className="studio-cast-modal" role="dialog" aria-modal="true" aria-labelledby="studio-cast-modal-title">
            <header><span><small>EDITAR ELENCO</small><h2 id="studio-cast-modal-title">Personagens do Studio</h2></span><button className="studio-cast-modal-close" onClick={() => setCastPickerOpen(false)} aria-label="Fechar" disabled={savingCast} type="button">×</button></header>
            <div className="studio-cast-modal-summary"><strong>Escolha os personagens</strong><span>{castSelection.length} selecionado{castSelection.length === 1 ? '' : 's'}</span></div>
            <div className="studio-cast-modal-list">
              {availableCharacters.length ? availableCharacters.map((character) => {
                const selected = castSelection.includes(character.id)
                return <button className={`studio-cast-modal-option${selected ? ' selected' : ''}`} key={character.id} onClick={() => setCastSelection((current) => selected ? current.filter((id) => id !== character.id) : [...current, character.id])} disabled={savingCast} type="button">
                  <CharacterPortrait character={character} /><strong>{character.name}</strong><i>{selected ? '✓' : '+'}</i>
                </button>
              }) : <p className="studio-cast-modal-empty">Crie personagens em Customizar para adicioná-los ao elenco.</p>}
            </div>
            <footer><button className="studio-cast-modal-cancel" onClick={() => setCastPickerOpen(false)} disabled={savingCast} type="button">Cancelar</button><button className="studio-cast-modal-save" onClick={() => void saveCastSelection()} disabled={savingCast} type="button">{savingCast ? 'Salvando…' : 'Salvar elenco'}</button></footer>
          </section>
        </div>}
      </main>
    )
  }

  return (
    <main className="studio-page" aria-label="Studio">
      <header className="studio-page-header"><h1>Seus Studios</h1>{studioFolder && <small>Dados locais: {studioFolder}</small>}</header>
      <div className="studio-toolbar" aria-label="Ações dos Studios">
        <button className="studio-action studio-action-primary" onClick={() => void createStudio()} disabled={loading} type="button"><Icon name="plus" />Criar</button>
      </div>
      {error && <p className="studio-error-message" role="alert">{error}</p>}
      {loading ? <section className="studio-empty-state"><strong>Carregando Studios…</strong></section> : studios.length ? (
        <section className="studio-grid" aria-label="Studios criados">
          {studios.map((studio) => <article className={`studio-card${selectedId === studio.id ? ' selected' : ''}`} key={studio.id}>
            <header className="studio-card-heading"><button className="studio-card-open" onClick={() => { setSelectedId(studio.id); setActiveStudioId(studio.id) }} aria-label={`Abrir ${studio.title}`} type="button">{studio.title}</button><div className="studio-card-actions"><button className="studio-card-action" onClick={() => void duplicateStudio(studio)} aria-label={`Duplicar ${studio.title}`} title={`Duplicar ${studio.title}`} type="button"><span className="studio-duplicate-icon" aria-hidden="true">▢</span></button><button className="studio-card-action danger" onClick={() => void deleteStudio(studio)} aria-label={`Excluir ${studio.title}`} title={`Excluir ${studio.title}`} type="button"><Icon name="trash" /></button></div></header>
            <button className="studio-cover" style={{ backgroundColor: studio.color }} onClick={() => { setSelectedId(studio.id); setActiveStudioId(studio.id) }} aria-label={`Abrir ${studio.title}`} type="button" />
          </article>)}
        </section>
      ) : <section className="studio-empty-state"><span><Icon name="camera" /></span><strong>Nenhum Studio criado</strong><small>Crie um Studio para começar sua coleção.</small></section>}
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

  return <div className="studio-control">
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
      className="studio-control-range"
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
    <div className="studio-controls-grid">
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
    {element.kind === 'character' && <div className="studio-layer-actions studio-character-actions"><button type="button" onClick={() => update({ flipX: !element.flipX })}><Icon name="flipHorizontal" />Espelhar personagem</button><button type="button" onClick={() => update({ zIndex: Math.max(0, element.zIndex - 1) })}>Para trás</button><button type="button" onClick={() => update({ zIndex: element.zIndex + 1 })}>Para frente</button></div>}
    {element.kind === 'image' && <div className="studio-layer-actions"><button type="button" onClick={() => update({ zIndex: element.zIndex + 1 })}>Para frente</button><button type="button" onClick={() => update({ zIndex: Math.max(0, element.zIndex - 1) })}>Para trás</button></div>}
    <button className="studio-side-danger" type="button" onClick={remove}><Icon name="trash" />Excluir da cena</button>
  </>
}
