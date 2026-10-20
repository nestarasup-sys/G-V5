import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { buildStudioExpressionAppearance, buildStudioExpressionTransforms, resolveStudioExpressionBase, studioExpressionCollection } from './expressionTransforms'
import { Icon } from '../../ui/components/Icon'
import { CharacterPortrait } from '../../ui/components/CharacterPortrait'
import { resolveStudioTalkMouthId } from '../../../../shared/studio'
import { fitStudioCharacterToStage } from '../../../../shared/studioCharacterGeometry'
import type { StudioAsset, StudioDocument, StudioElement, StudioFaceMode, StudioFaceTransform, StudioFaceTransforms } from '../../../../shared/studio'
import type { CustomizerCharacter } from '../../../../shared/customizer'
import type { CustomizerFaceAppearance } from '../../../../shared/customizer'
import type { FaceCatalogItem, FaceCatalogItemSummary, FaceExpressionCollection, FaceExpressionEffects, FaceExpressionPreset, FaceExpressionPresetSummary, FaceSheetKind, FabricatorPoseSummary } from '../../../../shared/fabricator'

type StudioCard = StudioDocument
type StudioSnapshot = Pick<StudioDocument, 'backgroundColor' | 'backgroundAssetId' | 'backgroundX' | 'backgroundY' | 'backgroundWidth' | 'backgroundHeight' | 'backgroundRotation' | 'assets' | 'elements'>
type Tool = 'background' | 'objects' | null
type DragState = { id: string; pointerId: number; startX: number; startY: number; originalX: number; originalY: number; width: number; height: number }

const STORAGE_KEY = 'gacha-nymi-studio-catalog-v1'
const STUDIO_FACE_RENDER_VERSION = 6
const studioColor = (number: number) => `hsl(${(number * 137.508) % 360} 45% 78%)`
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
    elements: studio.elements
  }
}

function withSnapshot(studio: StudioDocument, next: StudioSnapshot): StudioDocument {
  return { ...studio, ...next, updatedAt: new Date().toISOString() }
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

function faceRenderGeometry(element: StudioElement, rendered: { width: number; height: number }, crop: { width: number; height: number } | null, stageWidth: number, stageHeight: number) {
  const cropWidth = crop?.width ?? rendered.width
  const cropHeight = crop?.height ?? rendered.height
  const characterCanvasWidth = element.characterCanvasWidth ?? element.width * rendered.width / Math.max(1, cropWidth)
  return {
    characterCanvasWidth,
    width: characterCanvasWidth * cropWidth / rendered.width,
    height: characterCanvasWidth * stageWidth / Math.max(1, stageHeight) * cropHeight / rendered.width
  }
}

function makeElement(kind: StudioElement['kind'], zIndex: number): StudioElement {
  return {
    id: crypto.randomUUID(), kind, text: kind === 'narrator' ? 'Texto do narrador' : 'Digite aqui',
    x: 0, y: 0, width: kind === 'narrator' ? 32 : 28, height: kind === 'narrator' ? 12 : 16,
    rotation: 0, zIndex
  }
}

function makeCanvasPrint(studio: StudioDocument, outputWidth = 1920, outputHeight = 1080, mimeType = 'image/png'): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = outputWidth
    canvas.height = outputHeight
    const context = canvas.getContext('2d')
    if (!context) return reject(new Error('Não foi possível preparar a imagem do print.'))
    context.scale(outputWidth / 1920, outputHeight / 1080)
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
        resolve(canvas.toDataURL(mimeType, mimeType === 'image/jpeg' ? 0.78 : undefined))
      } catch (reason) { reject(reason) }
    })()
  })
}

function makeStudioThumbnail(studio: StudioDocument): Promise<string> {
  return makeCanvasPrint(studio, 480, 270, 'image/jpeg')
}

/** Normal Studio owns this layout; Video Studio has its own editor and stylesheet. */
export function StudioPage() {
  const [studios, setStudios] = useState<StudioCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [availableCharacters, setAvailableCharacters] = useState<CustomizerCharacter[]>([])
  const [assetLibraryRevision, setAssetLibraryRevision] = useState(0)
  const appliedAssetRevisionRef = useRef(new Map<string, number>())
  const [normalizedStudioVersion, setNormalizedStudioVersion] = useState(0)
  const [castPickerOpen, setCastPickerOpen] = useState(false)
  const [castSelection, setCastSelection] = useState<string[]>([])
  const [savingCast, setSavingCast] = useState(false)
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
  const [fullView, setFullView] = useState(false)
  const [saved, setSaved] = useState(true)
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [historyVersion, setHistoryVersion] = useState(0)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const sceneRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const undoRef = useRef<StudioSnapshot[]>([])
  const redoRef = useRef<StudioSnapshot[]>([])
  const studioFaceTransformsRef = useRef<Record<string, StudioFaceTransforms>>({})
  const studioFaceRenderTimerRef = useRef<number | null>(null)
  const studioFaceRenderVersionRef = useRef(0)
  const studioFaceRenderPendingRef = useRef<{ studioId: string; elementId: string; assetId: string; character: CustomizerCharacter; transforms: StudioFaceTransforms } | null>(null)
  const studioFaceRenderRunningRef = useRef(false)
  const studioFaceRendererRef = useRef<{ key: string; render: (appearance?: CustomizerFaceAppearance, transforms?: StudioFaceTransforms, effects?: FaceExpressionEffects, mode?: StudioFaceMode) => Promise<{ dataUrl: string; width: number; height: number }> } | null>(null)
  const saveGenerationRef = useRef(0)
  const expressionSaveSignatureRef = useRef<{ studioId: string; value: string } | null>(null)
  const normalizedStudioIdsRef = useRef(new Set<string>())
  const nextStudioNumber = useRef(1)
  const selectedStudio = studios.find((studio) => studio.id === selectedId) ?? null
  const activeStudio = studios.find((studio) => studio.id === activeStudioId) ?? null
  const selectedElement = activeStudio?.elements.find((element) => element.id === selectedElementId) ?? null
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
  const allStageCharactersLocked = stageCharacters.length > 0 && stageCharacters.every((element) => element.positionLocked === true)
  const toggleStageCharacterPositionLock = () => {
    if (!activeStudio || !stageCharacters.length) return
    const nextLocked = !allStageCharactersLocked
    changeScene((studio) => ({
      ...studio,
      elements: studio.elements.map((element) => element.kind === 'character' ? { ...element, positionLocked: nextLocked } : element),
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
            backgroundRotation: 0, assets: [], elements: []
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
    const refreshAfterFabricatorSave = () => { setAssetLibraryRevision((revision) => revision + 1); refreshCharacters() }
    refreshCharacters()
    window.addEventListener('focus', refreshCharacters)
    window.addEventListener('customizer:characters-updated', refreshCharacters)
    window.addEventListener('fabricator:assets-updated', refreshAfterFabricatorSave)
    document.addEventListener('visibilitychange', refreshVisibleCharacters)
    return () => {
      cancelled = true
      window.removeEventListener('focus', refreshCharacters)
      window.removeEventListener('customizer:characters-updated', refreshCharacters)
      window.removeEventListener('fabricator:assets-updated', refreshAfterFabricatorSave)
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
    if (!activeStudioId) return
    undoRef.current = []
    redoRef.current = []
    setCanUndo(false)
    setCanRedo(false)
    setHistoryVersion((value) => value + 1)
    setSelectedElementId(null)
  }, [activeStudioId])

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
        for (const { element, character, shouldRecomposeExpression, assetRevisionKey, assetsChanged } of pending) {
          const savedPreset = element.activeExpressionPresetId
            ? await window.desktop.loadFaceExpressionPreset(character.customization.modelSlot ?? 1, element.activeExpressionPresetId)
            : null
          if (element.activeExpressionPresetId && !savedPreset) continue
          const sourceAppearance = character.customization.faceAppearance
          const appearanceFallback = sourceAppearance ?? element.faceAppearance ?? element.expressionBase?.appearance
          if (!appearanceFallback) continue
          const previousBase = resolveStudioExpressionBase(element, appearanceFallback)
          const sceneTransforms = Object.fromEntries(Object.entries(element.faceTransforms ?? {}).filter(([key]) => !key.startsWith('expression-component:') && !key.startsWith('expression:')))
          const characterChanged = element.characterSourceUpdatedAt !== character.updatedAt
          const expressionBase = characterChanged && sourceAppearance
            ? { appearance: structuredClone(sourceAppearance), transforms: sceneTransforms }
            : previousBase
          const appearance = shouldRecomposeExpression
            ? savedPreset && expressionBase
              ? await buildStudioExpressionAppearance(savedPreset, expressionBase.appearance, (id) => window.desktop.loadFaceCatalogItem(savedPreset.modelSlot, id))
              : expressionBase?.appearance ?? element.faceAppearance
            : element.faceAppearance ?? expressionBase?.appearance
          const faceMode = studioFaceModeForElement(element, element.faceAppearance ?? expressionBase?.appearance)
          const faceTransforms = shouldRecomposeExpression
            ? savedPreset && appearance && expressionBase
              ? await buildStudioExpressionTransforms(savedPreset, appearance, expressionBase.transforms,
                (id) => window.desktop.loadFaceComponentAsset(savedPreset.modelSlot, id),
                (id) => window.desktop.loadFaceCatalogItem(savedPreset.modelSlot, id))
              : expressionBase?.transforms ?? element.faceTransforms
            : element.faceTransforms ?? expressionBase?.transforms
          const expressionEffects = shouldRecomposeExpression ? savedPreset?.effects : element.activeExpressionEffects
          const customization = {
            ...character.customization,
            poseSlot: element.poseSlot === undefined ? character.customization.poseSlot : element.poseSlot,
            faceAppearance: appearance
          }
          const rendered = await renderSavedCharacter({ ...character, customization }, faceTransforms, expressionEffects, faceMode)
          if (cancelled) return
          const crop = await trimTransparentImage(rendered.dataUrl)
          if (cancelled) return
          const cropWidth = crop?.width ?? rendered.width
          const cropHeight = crop?.height ?? rendered.height
          const characterCanvasWidth = element.characterCanvasWidth ?? element.width * rendered.width / cropWidth
          const asset = activeStudio.assets.find((item) => item.id === element.assetId)
          if (!asset) continue
          updates.push({
            previous: element,
            next: {
              ...element, characterSourceUpdatedAt: character.updatedAt, faceRendererVersion: STUDIO_FACE_RENDER_VERSION, expressionBase, faceAppearance: appearance, faceTransforms, activeExpressionEffects: expressionEffects, activeFaceMode: faceMode,
              ...(savedPreset ? { activeExpressionPresetUpdatedAt: savedPreset.updatedAt } : {}), characterCanvasWidth,
              width: characterCanvasWidth * cropWidth / rendered.width,
              height: characterCanvasWidth * stageWidth / stageHeight * cropHeight / rendered.width,
              text: element.text === asset.name ? character.name : element.text
            },
            asset: { ...asset, name: character.name, mimeType: 'image/png', dataUrl: crop?.dataUrl ?? rendered.dataUrl }
          })
          if (assetsChanged) appliedAssetRevisionRef.current.set(assetRevisionKey, assetLibraryRevision)
        }
        if (cancelled || !updates.length) return
        setStudios((current) => current.map((studio) => {
          if (studio.id !== studioId) return studio
          const valid = updates.filter(({ previous }) => studio.elements.some((element) => element === previous))
          if (!valid.length) return studio
          const elements = new Map(valid.map(({ next }) => [next.id, next]))
          const assets = new Map(valid.map(({ asset }) => [asset.id, asset]))
          return {
            ...studio,
            elements: studio.elements.map((element) => elements.get(element.id) ?? element),
            assets: studio.assets.map((asset) => assets.get(asset.id) ?? asset),
            updatedAt: new Date().toISOString()
          }
        }))
        setSaved(false)
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o personagem do Studio.')
      }
    })()
    return () => { cancelled = true }
  }, [activeStudio, availableCharacters, normalizedStudioVersion, sceneExpressionPresetVersions, assetLibraryRevision])

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
      backgroundRotation: 0, assets: [], elements: []
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
      const thumbnailDataUrl = await makeStudioThumbnail(document).catch(() => document.thumbnailDataUrl)
      const savedDocument = { ...document, ...(thumbnailDataUrl ? { thumbnailDataUrl } : {}), updatedAt: new Date().toISOString() }
      await window.desktop.saveStudio(savedDocument)
      if (generation === saveGenerationRef.current) {
        if (savedDocument.thumbnailDataUrl !== document.thumbnailDataUrl) {
          setStudios((current) => current.map((studio) => studio.id === document.id && studio.updatedAt === document.updatedAt && studio.thumbnailDataUrl !== savedDocument.thumbnailDataUrl
            ? { ...studio, thumbnailDataUrl: savedDocument.thumbnailDataUrl }
            : studio))
        }
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
    setStudios((current) => current.map((studio) => studio.id === activeStudioId ? transform(studio) : studio))
    setSaved(false)
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
      await window.desktop.saveStudio(nextStudio)
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

  const selectBackground = (asset: StudioAsset) => {
    changeScene((studio) => ({ ...studio, backgroundAssetId: asset.id, backgroundX: 0, backgroundY: 0, backgroundWidth: 100, backgroundHeight: 100, backgroundRotation: 0, updatedAt: new Date().toISOString() }))
    setSelectedElementId('background')
    setInspectorOpen(true)
    setInspectorTab('editor')
  }

  const addTextElement = (kind: 'narrator' | 'speech' | 'thought') => {
    if (!activeStudio) return
    const element = makeElement(kind, Math.max(0, ...activeStudio.elements.map((item) => item.zIndex)) + 1)
    changeScene((studio) => ({ ...studio, elements: [...studio.elements, element], updatedAt: new Date().toISOString() }))
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
        elements.push({ id: crypto.randomUUID(), kind: 'character', assetId: asset.id, characterId: character.id, characterSourceUpdatedAt: character.updatedAt, faceRendererVersion: STUDIO_FACE_RENDER_VERSION, activeExpressionCollectionId: 'standard', activeExpressionPresetId: null, activeFaceMode: 'idle', characterScale: 100, characterWidthScale: 100, characterHeightScale: 100, ...(character.customization.faceAppearance ? { expressionBase: { appearance: structuredClone(character.customization.faceAppearance), transforms: {} } } : {}), characterCanvasWidth, text: character.name, x: 0, y: 0, width, height, rotation: 0, zIndex: ++zIndex })
      }
      const nextElements = [...retained, ...elements]
      const retainedAssetIds = new Set(retained.map((element) => element.assetId).filter((id): id is string => Boolean(id)))
      changeScene((studio) => ({
        ...studio,
        elements: nextElements,
        assets: [...studio.assets.filter((asset) => !removedCharacterAssetIds.has(asset.id) || retainedAssetIds.has(asset.id)), ...assets],
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

  const applyStudioExpressionPreset = async (summary: FaceExpressionPresetSummary, pupilsLeft = false) => {
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
      if (pupilsLeft) {
        for (const side of ['left', 'right'] as const) {
          const pupilPart = `pupil-${side}` as const
          const eyePart = `eye-${side}` as const
          const transformKey = `expression-component:${pupilPart}`
          const current = faceTransforms[transformKey]
          const pupilId = nextAppearance.components?.[pupilPart]?.assetId
          const eyeId = nextAppearance.components?.[eyePart]?.assetId
          if (!current?.sourceTransformOverride || !pupilId || !eyeId) continue
          const [pupilAsset, eyeAsset] = await Promise.all([
            window.desktop.loadFaceComponentAsset(preset.modelSlot, pupilId),
            window.desktop.loadFaceComponentAsset(preset.modelSlot, eyeId)
          ])
          if (!pupilAsset || !eyeAsset) continue
          const eyeTransform = nextAppearance.components?.[eyePart]?.transform ?? eyeAsset.defaultTransform
          const pointsLeft = side === 'left' || pupilAsset.rightSidePositioned === true
          faceTransforms[transformKey] = {
            ...current,
            sourceTransformOverride: {
              ...current.sourceTransformOverride,
              x: (pointsLeft ? -1 : 1) * eyeAsset.width * eyeTransform.scaleX * .16
            }
          }
        }
      }

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
    if (!activeStudio || selectedElement?.kind !== 'character' || !selectedStudioCharacter || !selectedElement.assetId || studioFaceBusy) return
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
        updatedAt: new Date().toISOString()
      }
    })
    if (selectedElementId === element.id) setSelectedElementId(null)
  }

  const updateElement = (id: string, values: Partial<StudioElement>, record = true) => {
    const update = (studio: StudioDocument) => ({ ...studio, elements: studio.elements.map((element) => element.id === id ? { ...element, ...values } : element), updatedAt: new Date().toISOString() })
    if (record) changeScene(update)
    else patchStudio(update)
  }

  const updateBackground = (values: Partial<Pick<StudioDocument, 'backgroundColor' | 'backgroundX' | 'backgroundY' | 'backgroundWidth' | 'backgroundHeight' | 'backgroundRotation'>>, record = true) => {
    const update = (studio: StudioDocument) => ({ ...studio, ...values, updatedAt: new Date().toISOString() })
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
      dragRef.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originalX: activeStudio.backgroundX, originalY: activeStudio.backgroundY, width: rect.width, height: rect.height }
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    const element = activeStudio.elements.find((item) => item.id === id)
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
      else changeScene((studio) => ({ ...studio, elements: studio.elements.filter((element) => element.id !== selectedElementId), updatedAt: new Date().toISOString() }))
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
    if (!await saveStudio(activeStudio)) return
    setActiveStudioId(null)
    setActiveTool(null)
    setSelectedElementId(null)
    setFullView(false)
  }

  const exportPrint = async () => {
    if (!activeStudio) return
    try {
      if (!await saveStudio(activeStudio)) return
      const image = await makeCanvasPrint(activeStudio)
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
      <label className="studio-color-control">Cor sólida<input type="color" value={activeStudio.backgroundColor} onChange={(event) => updateBackground({ backgroundColor: event.target.value })} /></label>
      <button className="studio-side-primary" type="button" onClick={() => void importImage('background')}><Icon name="plus" />Adicionar imagem</button>
      <div className="studio-asset-grid">{activeStudio.assets.filter((asset) => asset.category === 'background').map((asset) => <button key={asset.id} className={`studio-asset-card${activeStudio.backgroundAssetId === asset.id ? ' active' : ''}`} type="button" onClick={() => selectBackground(asset)}><img src={asset.dataUrl} alt="" /><span>{asset.name}</span></button>)}</div>
      {selectedBackgroundAsset && selectedElementId === 'background' && <><div className="studio-controls-grid">{control('X', activeStudio.backgroundX, (value, record) => updateBackground({ backgroundX: value }, record), -100, 100)}{control('Y', activeStudio.backgroundY, (value, record) => updateBackground({ backgroundY: value }, record), -100, 100)}{control('Largura', activeStudio.backgroundWidth, (value, record) => updateBackground({ backgroundWidth: value }, record), 1, 300)}{control('Altura', activeStudio.backgroundHeight, (value, record) => updateBackground({ backgroundHeight: value }, record), 1, 300)}{control('Rotação', activeStudio.backgroundRotation, (value, record) => updateBackground({ backgroundRotation: value }, record), -180, 180, '°')}</div><button className="studio-side-danger" type="button" onClick={deleteSelected}><Icon name="trash" />Remover fundo da cena</button></>}
    </div>
    if (activeTool === 'objects') return <div className="studio-side-content">
      <h2>Objetos</h2><p>Imagens importadas ficam disponíveis neste Studio.</p>
      <button className="studio-side-primary" type="button" onClick={() => void importImage('object')}><Icon name="plus" />Importar imagem</button>
      <div className="studio-asset-grid">{activeStudio.assets.filter((asset) => asset.category === 'object').map((asset) => <button key={asset.id} className="studio-asset-card" type="button" onClick={() => {
        const element: StudioElement = { id: crypto.randomUUID(), kind: 'image', assetId: asset.id, text: '', x: 0, y: 0, width: 25, height: 25, rotation: 0, zIndex: Math.max(0, ...activeStudio.elements.map((item) => item.zIndex)) + 1 }
        changeScene((studio) => ({ ...studio, elements: [...studio.elements, element], updatedAt: new Date().toISOString() }))
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
      <div className="studio-controls-grid">{control('X', activeStudio.backgroundX, (value, record) => updateBackground({ backgroundX: value }, record), -100, 100)}{control('Y', activeStudio.backgroundY, (value, record) => updateBackground({ backgroundY: value }, record), -100, 100)}{control('Largura', activeStudio.backgroundWidth, (value, record) => updateBackground({ backgroundWidth: value }, record), 1, 300)}{control('Altura', activeStudio.backgroundHeight, (value, record) => updateBackground({ backgroundHeight: value }, record), 1, 300)}{control('Rotação', activeStudio.backgroundRotation, (value, record) => updateBackground({ backgroundRotation: value }, record), -180, 180, '°')}</div>
      <button className="studio-side-danger" type="button" onClick={deleteSelected}><Icon name="trash" />Remover fundo</button>
    </div>
    return <div className="studio-side-content"><h2>Cena</h2><p>Escolha uma ferramenta à esquerda ou selecione um elemento na cena.</p><small>{activeStudio.elements.length} elemento(s)</small></div>
  }

  const customPanel = (): ReactNode => {
    if (!selectedStudioCharacter || selectedElement?.kind !== 'character' || selectedStudioCharacterModelSlot === null) {
      return <div className="studio-custom-empty"><strong>Personalizar personagem</strong><span>Selecione um personagem na prévia ou no elenco para escolher as peças do rosto.</span></div>
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
    return <div className="studio-custom-face">
      <div className="studio-custom-face-categories" aria-label="Categorias do rosto">
        {categoryButtons.map((category) => <button key={category.id} className={studioFaceCategory === category.id ? 'active' : ''} onClick={() => setStudioFaceCategory(category.id)} type="button">{category.label}</button>)}
      </div>
      {studioFaceCategory === 'mouth' && <div className="studio-custom-mouth-tabs"><button className={selectedStudioFaceMode !== 'talk' ? 'active' : ''} onClick={() => void applyStudioFaceMode('idle')} disabled={!selectedStudioFaceAppearance || studioFaceBusy || studioExpressionBusy} type="button">Fechada</button><button className={selectedStudioFaceMode === 'talk' ? 'active' : ''} onClick={() => void applyStudioFaceMode('talk')} disabled={!selectedStudioFaceAppearance || studioFaceBusy || studioExpressionBusy || !selectedStudioTalkAvailable} type="button">Aberta</button></div>}
      <label className="studio-custom-eye-sheet-select"><span>{studioFaceCategory === 'eyes' ? 'Folha de olhos' : studioFaceCategory === 'eyebrows' ? 'Folha de sobrancelhas' : studioFaceCategory === 'nose' ? 'Folha de nariz' : 'Folha de boca'}</span><select value={selectedItemId ?? ''} onChange={(event) => { const summary = catalogItems.find((item) => item.id === event.target.value); if (summary) void chooseStudioFaceSheet(summary) }} disabled={studioFaceBusy || studioFaceLoading}><option value="">Selecione uma folha</option>{catalogItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {studioFaceLoading && <p className="studio-custom-hint">Carregando catálogo facial…</p>}
      {studioFaceCategory === 'eyebrows' && selectedStudioFaceAppearance?.eyebrowCatalogId && <button className={`studio-custom-toggle${selectedStudioFaceAppearance.eyebrows ? ' active' : ''}`} onClick={() => updateStudioFaceVariant({ eyebrows: !selectedStudioFaceAppearance.eyebrows })} disabled={studioFaceBusy} type="button">{selectedStudioFaceAppearance.eyebrows ? 'Ocultar sobrancelhas' : 'Mostrar sobrancelhas'}</button>}
      {sheetKind === 'eyes' && <>
        {activeItem ? <div className="studio-custom-face-variants">{[0, 1, 2].map((index) => {
          const pieces = activeItem.pieces.filter((piece) => piece.index === index)
          const labels = ['Direita', 'Esquerda', 'Fechados']
          const displayedEyeState = selectedStudioFaceMode === 'blink' ? 2 : selectedStudioFaceAppearance?.eyeState === 1 ? 1 : 0
          return <button className={(displayedEyeState === index ? 'selected' : '')} key={index} onClick={() => updateStudioFaceVariant({ eyeState: index as 0 | 1 | 2 })} disabled={studioFaceBusy} type="button"><span>{renderPair(pieces)}</span><b>{labels[index]}</b></button>
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
        {presetOptions.map((option) => <button key={option.id} className={`studio-preset-button${option.id === studioPresetCategory ? ' active' : ''}${option.id.startsWith('reserved') ? ' reserved' : ''}`} disabled={option.id.startsWith('reserved')} onClick={() => { if (option.id === 'pose') { setStudioPresetCategory('pose') } else if (option.id === 'expression') setStudioPresetCategory('expression') }} type="button"><Icon name={option.icon} /><span>{option.label}</span></button>)}
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
      {studioPresetCategory === 'expression' && <section className="studio-expression-catalog" aria-label="Presets do Expressão Dev">
        {studioExpressionLoading ? <p className="studio-custom-hint">Carregando conjuntos de expressão…</p> : <>
          <div className="studio-expression-modes" role="group" aria-label="Estado facial do personagem">
            {([{ id: 'idle', label: 'Idle' }, { id: 'blink', label: 'Blink' }, { id: 'talk', label: 'Talk' }] as const).map((mode) => <button key={mode.id} className={`studio-expression-mode${selectedStudioFaceMode === mode.id ? ' active' : ''}`} type="button" aria-pressed={selectedStudioFaceMode === mode.id} disabled={studioExpressionBusy || studioFaceBusy || !selectedStudioFaceAppearance || mode.id === 'talk' && !selectedStudioTalkAvailable} onClick={() => void applyStudioFaceMode(mode.id)}>{mode.label}</button>)}
          </div>
          <div className="studio-expression-collections" aria-label="Selecionar conjunto de expressão">
            <button className="studio-expression-collection-button" type="button" aria-expanded={studioExpressionCollectionMenuOpen} onClick={() => setStudioExpressionCollectionMenuOpen((open) => !open)}>
              <strong>{[{ id: 'standard', name: 'Padrão' }, ...studioExpressionCollections].find((item) => item.id === selectedStudioExpressionCollectionId)?.name ?? 'Escolher conjunto'}</strong><Icon name="chevronDown" />
            </button>
            {studioExpressionCollectionMenuOpen && <div className="studio-expression-collection-options" role="listbox" aria-label="Conjuntos disponíveis">
              {[{ id: 'standard', name: 'Padrão' }, ...studioExpressionCollections].map((collection) => {
                const selected = selectedStudioExpressionCollectionId === collection.id
                return <button className={`studio-expression-collection-option${selected ? ' selected' : ''}`} key={collection.id} type="button" role="option" aria-selected={selected} onClick={() => { updateElement(selectedElement.id, { activeExpressionCollectionId: collection.id }); setStudioExpressionCollectionMenuOpen(false) }}>
                  <span>{collection.name}</span>{selected && <Icon name="check" />}
                </button>
              })}
            </div>}
          </div>
          {selectedStudioExpressionCollectionId ? (() => {
            const expressions = studioExpressionPresets
              .filter((preset) => preset.collectionId === selectedStudioExpressionCollectionId && Number.isInteger(preset.expressionIndex))
              .sort((a, b) => a.expressionIndex! - b.expressionIndex!)
            return <div className="studio-expression-selected">
              <div className="studio-expression-list">
                <button className={`studio-expression-option${!selectedElement.activeExpressionPresetId ? ' selected' : ''}`} type="button" onClick={() => void applyStudioBaseExpression()} disabled={studioExpressionBusy || studioFaceBusy} aria-pressed={!selectedElement.activeExpressionPresetId}><b>•</b><span>Base</span></button>
                {expressions.map((preset) => <div className="studio-expression-row" key={preset.id}>
                  <button className={`studio-expression-option${selectedElement.activeExpressionPresetId === preset.id ? ' selected' : ''}`} type="button" aria-pressed={selectedElement.activeExpressionPresetId === preset.id} onClick={() => void applyStudioExpressionPreset(preset)} disabled={studioExpressionBusy || studioFaceBusy}>
                    <b>{String((preset.expressionIndex ?? 0) + 1).padStart(2, '0')}</b><span>{preset.name}</span>
                  </button>
                  <button className="studio-expression-look-left" type="button" title={`Aplicar ${preset.name} com as pupilas voltadas à esquerda`} aria-label={`Pupilas à esquerda: ${preset.name}`} onClick={() => void applyStudioExpressionPreset(preset, true)} disabled={studioExpressionBusy || studioFaceBusy}>pt</button>
                </div>)}
                {!expressions.length && <p className="studio-custom-hint">Nenhuma expressão salva neste conjunto. Salve expressões no Expressão Dev para listá-las aqui.</p>}
              </div>
            </div>
          })() : <p className="studio-custom-hint">Selecione um conjunto para ver as expressões disponíveis.</p>}
          {(studioExpressionBusy || studioFaceBusy) && <p className="studio-custom-hint" role="status">Aplicando expressão…</p>}
        </>}
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
    const backgroundAsset = activeStudio.assets.find((asset) => asset.id === activeStudio.backgroundAssetId)
    const inspectorWidth = sceneRef.current ? Math.min(38, 276 / sceneRef.current.clientWidth * 100) : 28
    const selectedBounds = selectedElement
      ? { left: 50 + selectedElement.x - studioElementSize(selectedElement).width / 2, right: 50 + selectedElement.x + studioElementSize(selectedElement).width / 2 }
      : selectedElementId === 'background'
        ? { left: 50 + activeStudio.backgroundX - activeStudio.backgroundWidth / 2, right: 50 + activeStudio.backgroundX + activeStudio.backgroundWidth / 2 }
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
          <div className="studio-scene-canvas" ref={sceneRef} style={{ backgroundColor: activeStudio.backgroundColor }} onPointerDown={() => setSelectedElementId(null)}>
            {backgroundAsset && <img className={`studio-canvas-background${selectedElementId === 'background' && !fullView ? ' selected' : ''}`} src={backgroundAsset.dataUrl} alt="" style={imageStyle(activeStudio.backgroundX, activeStudio.backgroundY, activeStudio.backgroundWidth, activeStudio.backgroundHeight, activeStudio.backgroundRotation)} onPointerDown={(event) => startDrag(event, 'background')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />}
            {[...activeStudio.elements].sort((a, b) => a.zIndex - b.zIndex).map((element) => {
              const asset = element.assetId ? activeStudio.assets.find((item) => item.id === element.assetId) : undefined
              const size = studioElementSize(element)
              return <div key={element.id} className={`studio-canvas-element studio-element-${element.kind}${selectedElementId === element.id && !fullView ? ' selected' : ''}`} style={{ ...imageStyle(element.x, element.y, size.width, size.height, element.rotation, element.kind === 'character' && element.flipX === true), zIndex: element.zIndex + 1 }} onPointerDown={(event) => startDrag(event, element.id)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
                {(element.kind === 'image' || element.kind === 'character') && asset ? <img src={asset.dataUrl} alt={asset.name} draggable={false} /> : <span>{element.text}</span>}
              </div>
            })}
            {fullView && <button className="studio-exit-view" onClick={() => setFullView(false)} type="button">Sair da visualização <kbd>Esc</kbd></button>}
            {!fullView && <span className="studio-scene-title">{activeStudio.title}</span>}
            {!fullView && inspectorOpen && <aside className={`studio-inspector studio-inspector-${inspectorSide}`} aria-label="Inspector da cena" onPointerDown={(event) => event.stopPropagation()}>
              <header className="studio-inspector-tabs"><button className={inspectorTab === 'editor' ? 'active' : ''} onClick={() => { setInspectorTab('editor'); rememberCharacterInspectorView('editor') }} type="button">Editor</button><button className={inspectorTab === 'custom' && inspectorCustomView === 'face' ? 'active' : ''} onClick={() => { setInspectorTab('custom'); setInspectorCustomView('face'); rememberCharacterInspectorView('custom', 'face') }} type="button">Custom</button><button className="studio-inspector-close" onClick={() => setInspectorOpen(false)} aria-label="Fechar inspector" title="Fechar" type="button">×</button></header>
              <button className={`studio-inspector-presets${inspectorTab === 'custom' && inspectorCustomView === 'presets' ? ' active' : ''}`} onClick={() => { setStudioPresetCategory('expression'); setInspectorTab('custom'); setInspectorCustomView('presets'); rememberCharacterInspectorView('custom', 'presets') }} type="button"><Icon name="sparkles" />Presets</button>
              {inspectorTab === 'editor' ? <div className="studio-inspector-content">{propertyPanel()}</div> : <div className="studio-inspector-content">{inspectorCustomView === 'presets' ? presetsPanel() : customPanel()}</div>}
            </aside>}
          </div>
        </section>
        {!fullView && <aside className="studio-editor-rail studio-editor-right" aria-label="Elenco do Studio">{castPanel()}</aside>}
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
            <button className="studio-cover" style={{ backgroundColor: studio.color, ...(studio.thumbnailDataUrl ? { backgroundImage: `url(${studio.thumbnailDataUrl})` } : {}) }} onClick={() => { setSelectedId(studio.id); setActiveStudioId(studio.id) }} aria-label={`Abrir ${studio.title}`} type="button" />
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
    {element.kind === 'character' && <button className="studio-side-primary studio-character-reset" type="button" onClick={() => update({ x: 0, y: 0, characterScale: 100, characterWidthScale: 100, characterHeightScale: 100, rotation: 0, flipX: false })}><Icon name="reset" />Restaurar ajustes</button>}
    {element.kind === 'character' && <div className="studio-layer-actions studio-character-actions"><button type="button" onClick={() => update({ flipX: !element.flipX })}><Icon name="flipHorizontal" />Espelhar personagem</button><button type="button" onClick={() => update({ zIndex: Math.max(0, element.zIndex - 1) })}>Para trás</button><button type="button" onClick={() => update({ zIndex: element.zIndex + 1 })}>Para frente</button></div>}
    {element.kind === 'image' && <div className="studio-layer-actions"><button type="button" onClick={() => update({ zIndex: element.zIndex + 1 })}>Para frente</button><button type="button" onClick={() => update({ zIndex: Math.max(0, element.zIndex - 1) })}>Para trás</button></div>}
    <button className="studio-side-danger" type="button" onClick={remove}><Icon name="trash" />Excluir da cena</button>
  </>
}
