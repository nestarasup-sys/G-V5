import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { FaceAssetKind, FaceCatalogItem, FaceCatalogItemSave, FaceCatalogItemSummary, FaceComponentAsset, FaceComponentAssetSave, FaceComponentAssetSummary, FaceComponentKind, FaceDetailKind, FaceGuideProfile, FaceGuideSettings, FaceTransform, FabricatorProject, FabricatorSlotSummary, ModelPart } from '../../../../../shared/fabricator'
import { Icon } from '../../../ui/components/Icon'
import { usePreviewBackground } from '../usePreviewBackground'
import { processFaceSheet } from './processFaceSheet'
import { splitEyeSheet } from './splitEyeSheet'
import { eyeInteriorMask } from './eyeInteriorMask'
import { alignImportedFacePiece, captureFaceImportAnchor, fitClosedEyeToOpen, validFaceImportAnchor, type AlignableFaceKind, type FaceImportAnchor } from './faceImportAlignment'
import { removeEyebrowGreen } from './removeEyebrowGreen'
import './face-components.css'
import { normalizeEditableImageFile } from '../normalizeImage'

type PartId = 'eye-left' | 'eye-right' | 'pupil-left' | 'pupil-right' | 'eye-closed-left' | 'eye-closed-right' | 'brow-left' | 'brow-right'
type CatalogKind = 'nose' | 'mouth-closed' | 'mouth-open'
type LibraryCategory = FaceComponentKind | FaceDetailKind | 'nose' | 'mouth'
type FaceWorkspaceMode = 'eyes' | 'face'
type FaceGuide = FaceGuideSettings
type PreviewDrag = { pointerId: number; key: string; clientX: number; clientY: number; startX: number; startY: number; modelPerPixelX: number; modelPerPixelY: number; invertX: boolean; pupil: boolean }
const GUIDE_STORAGE_KEY = 'gacha-nymi:face-dev-guides'
const EYES_GUIDE_STORAGE_KEY = 'gacha-nymi:eyes-dev-guides'
const FACE_GUIDE_STORAGE_KEY = 'gacha-nymi:rosto-dev-guides'
const COMPONENT_SELECTION_STORAGE_KEY = 'gacha-nymi:face-dev-component-selections'
const LEGACY_PUPIL_SELECTION_STORAGE_KEY = 'gacha-nymi:face-dev-pupil-selections'
const FACE_IMPORT_ANCHORS_STORAGE_KEY = 'gacha-nymi:face-dev-import-anchors'
const FACE_DETAIL_SELECTION_STORAGE_KEY = 'gacha-nymi:face-dev-detail-selections'
const defaultGuide: FaceGuide = { visible: true, verticalX: 50, horizontalY: 45, lowerHorizontalY: 65, angle: 12 }
const categories: Array<{ kind: FaceComponentKind; label: string; parts: [PartId, PartId]; names: [string, string] }> = [
  { kind: 'eye', label: 'Olhos', parts: ['eye-left', 'eye-right'], names: ['Olho esquerdo', 'Olho direito'] },
  { kind: 'pupil', label: 'Pupilas', parts: ['pupil-left', 'pupil-right'], names: ['Pupila esquerda', 'Pupila direita'] },
  { kind: 'eye-closed', label: 'Olhos fechados', parts: ['eye-closed-left', 'eye-closed-right'], names: ['Olho fechado esquerdo', 'Olho fechado direito'] },
  { kind: 'eyebrow', label: 'Sobrancelhas', parts: ['brow-left', 'brow-right'], names: ['Sobrancelha esquerda', 'Sobrancelha direita'] }
]
const autoFixKinds: AlignableFaceKind[] = ['eye', 'pupil', 'eye-closed']
const faceDetailCategories: Array<{ kind: FaceDetailKind; label: string }> = [
  { kind: 'eye-highlight-left', label: 'Brilho olho esquerdo' },
  { kind: 'eye-highlight-right', label: 'Brilho olho direito' },
  { kind: 'blush', label: 'Blush' },
  { kind: 'facial-shadow', label: 'Sombra facial' }
]
const isFaceDetailKind = (kind: string): kind is FaceDetailKind => faceDetailCategories.some((category) => category.kind === kind)
const isFaceComponentKind = (kind: FaceComponentAsset['kind']): kind is FaceComponentKind => categories.some((category) => category.kind === kind)
const initialTransform = (kind: FaceComponentKind, head: ModelPart, width: number, height: number): FaceTransform => ({
  x: kind === 'pupil' ? 0 : head.width * (kind === 'eyebrow' ? .38 : .37),
  y: kind === 'pupil' ? 0 : head.height * (kind === 'eyebrow' ? .32 : .46),
  scaleX: kind === 'pupil' ? .35 : head.width * (kind === 'eyebrow' ? .16 : .19) / width,
  scaleY: kind === 'pupil' ? .35 : head.height * (kind === 'eyebrow' ? .12 : .17) / height,
  rotation: 0
})
const partCategory = (id: PartId) => categories.find((category) => category.parts.includes(id))!
const isRightLibraryAsset = (asset: FaceComponentAssetSummary) => asset.rightSidePositioned === true || / · (?:Olho|Olho aberto|Olho fechado|Pupila|Sobrancelha) direit[oa]$/.test(asset.name)
const libraryBaseName = (name: string) => name.replace(/ · (?:Olho|Olho aberto|Olho fechado|Pupila|Sobrancelha) (?:esquerd[oa]|direit[oa])$/, '')
function sameLibraryPair(left: FaceComponentAsset, right: FaceComponentAsset): boolean {
  if (left.kind !== right.kind || !isRightLibraryAsset(right)) return false
  if (left.pairId || right.pairId) return Boolean(left.pairId && left.pairId === right.pairId || right.pairId === left.id)
  return libraryBaseName(left.name) === libraryBaseName(right.name) && left.dataUrl === right.dataUrl
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const guideValue = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback
function readFaceGuides(storageKey: string, fallbackStorageKey?: string): Record<number, FaceGuide> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? (fallbackStorageKey ? window.localStorage.getItem(fallbackStorageKey) : null) ?? '{}') as Record<string, Partial<FaceGuide>>
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
    return Object.fromEntries(Object.entries(stored).filter(([slot, value]) => /^[1-9]\d*$/.test(slot) && Number(slot) <= 10 && value && typeof value === 'object').map(([slot, value]) => {
      const horizontalY = guideValue(value.horizontalY, defaultGuide.horizontalY, 10, 90)
      return [Number(slot), {
        visible: value.visible !== false,
        verticalX: guideValue(value.verticalX, defaultGuide.verticalX, 20, 80),
        horizontalY,
        lowerHorizontalY: Math.max(horizontalY + 1, guideValue(value.lowerHorizontalY, defaultGuide.lowerHorizontalY, 11, 99)),
        angle: guideValue(value.angle, defaultGuide.angle, -30, 30)
      }]
    }))
  } catch { return {} }
}
type ComponentSelection = { parts: Partial<Record<PartId, string>>; linked: Partial<Record<FaceComponentKind, boolean>>; moveTogether?: Partial<Record<FaceComponentKind, boolean>> }
function readComponentSelections(): Record<number, ComponentSelection> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(COMPONENT_SELECTION_STORAGE_KEY) ?? '{}') as Record<string, ComponentSelection>
    const legacy = JSON.parse(window.localStorage.getItem(LEGACY_PUPIL_SELECTION_STORAGE_KEY) ?? '{}') as Record<string, { left?: string; right?: string; linked: boolean }>
    const migrated = Object.fromEntries(Object.entries(legacy && typeof legacy === 'object' && !Array.isArray(legacy) ? legacy : {}).filter(([, selection]) => selection && typeof selection === 'object').map(([slot, selection]) => [slot, {
      parts: { 'pupil-left': selection.left, 'pupil-right': selection.right }, linked: { pupil: selection.linked }
    }])) as Record<number, ComponentSelection>
    return { ...migrated, ...(stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}) }
  } catch { return {} }
}
type FaceImportAnchors = Record<number, Partial<Record<AlignableFaceKind, FaceImportAnchor>>>
type FaceDetailSelections = Record<number, Partial<Record<FaceDetailKind, string>>>
function readFaceDetailSelections(): FaceDetailSelections {
  try {
    const stored = JSON.parse(window.localStorage.getItem(FACE_DETAIL_SELECTION_STORAGE_KEY) ?? '{}') as Record<string, Partial<Record<FaceDetailKind, string>>>
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
    return Object.fromEntries(Object.entries(stored).filter(([slot, selections]) => /^\d+$/.test(slot) && selections && typeof selections === 'object').map(([slot, selections]) => [Number(slot), selections]))
  } catch { return {} }
}
function readFaceImportAnchors(): FaceImportAnchors {
  try {
    const stored = JSON.parse(window.localStorage.getItem(FACE_IMPORT_ANCHORS_STORAGE_KEY) ?? '{}') as Record<string, Record<string, unknown>>
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
    return Object.fromEntries(Object.entries(stored).filter(([slot, value]) => /^\d+$/.test(slot) && value && typeof value === 'object').map(([slot, value]) => [Number(slot), Object.fromEntries(
      (['eye', 'pupil', 'eye-closed'] as const).filter((kind) => validFaceImportAnchor(value[kind])).map((kind) => [kind, value[kind]])
    )])) as FaceImportAnchors
  } catch { return {} }
}
const readImage = normalizeEditableImageFile
function catalogSaveData(item: FaceCatalogItem): FaceCatalogItemSave {
  const { dataUrl: _sheetData, ...sheet } = item.sheet
  return { ...item, sheet, pieces: item.pieces.map(({ dataUrl: _pieceData, ...piece }) => piece) }
}
function catalogImagesForSave(item: FaceCatalogItem) {
  return item.id.startsWith('legacy_') ? [
    { id: `sheet-${item.category}`, dataUrl: item.sheet.dataUrl },
    ...item.pieces.map((piece) => ({ id: piece.id, dataUrl: piece.dataUrl }))
  ] : []
}
function initialCatalogTransform(head: ModelPart, item: Pick<FaceCatalogItem, 'category' | 'pieces'>): FaceTransform {
  const piece = item.pieces[0]
  const targetWidth = item.category === 'nose' ? .075 : .2
  const scale = piece ? clamp(head.width * targetWidth / piece.width, .04, 4) : .25
  return { x: head.width * .5, y: head.height * (item.category === 'nose' ? .61 : .78), scaleX: scale, scaleY: scale, rotation: 0 }
}
function alignMouthPreviewTransform(transform: FaceTransform, closedItem: FaceCatalogItem | undefined, activeItem: FaceCatalogItem | undefined): FaceTransform {
  const closedBase = closedItem?.transforms.mouth
  const activeBase = activeItem?.transforms.mouth
  if (!closedBase || !activeBase || closedBase.scaleX <= 0 || closedBase.scaleY <= 0) return transform
  return { ...transform, scaleX: transform.scaleX * activeBase.scaleX / closedBase.scaleX, scaleY: transform.scaleY * activeBase.scaleY / closedBase.scaleY }
}
function initialFaceDetailTransform(kind: FaceDetailKind, head: ModelPart, width: number, height: number): FaceTransform {
  const targetWidth = kind.startsWith('eye-highlight') ? .075 : kind === 'blush' ? .24 : .3
  const scale = width > 0 && height > 0 ? clamp(head.width * targetWidth / width, .01, 20) : .25
  const x = kind.endsWith('left') ? head.width * .39 : kind.endsWith('right') ? head.width * .61 : head.width * .5
  const y = kind.startsWith('eye-highlight') ? head.height * .48 : kind === 'blush' ? head.height * .68 : head.height * .62
  return { x, y, scaleX: scale, scaleY: scale, rotation: 0 }
}

function FaceGuideOverlay({ head, guide }: { head: ModelPart; guide: FaceGuide }) {
  const x = head.width * guide.verticalX / 100
  const y = head.height * guide.horizontalY / 100
  const lowerY = head.height * guide.lowerHorizontalY / 100
  return <svg className="face-components-guide-overlay" viewBox={`0 0 ${head.width} ${head.height}`} preserveAspectRatio="none" aria-hidden="true">
    <g transform={`rotate(${guide.angle} ${x} ${head.height / 2})`}>
      <line className="face-components-guide-halo" x1={x} y1={-head.height} x2={x} y2={head.height * 2} />
      <line className="face-components-guide-halo" x1={-head.width} y1={y} x2={head.width * 2} y2={y} />
      <line className="face-components-guide-halo" x1={-head.width} y1={lowerY} x2={head.width * 2} y2={lowerY} />
      <line className="face-components-guide-line" x1={x} y1={-head.height} x2={x} y2={head.height * 2} />
      <line className="face-components-guide-line" x1={-head.width} y1={y} x2={head.width * 2} y2={y} />
      <line className="face-components-guide-line" x1={-head.width} y1={lowerY} x2={head.width * 2} y2={lowerY} />
      <circle className="face-components-guide-center" cx={x} cy={y} r={2.4} />
    </g>
  </svg>
}

function FaceTransformControls({ head, transform, sourceWidth, sourceHeight, pupil, moveTogether, followEyes, opacity, onChange, onOpacityChange, onReset }: {
  head: ModelPart; transform: FaceTransform; sourceWidth: number; sourceHeight: number; pupil: boolean
  moveTogether?: boolean; followEyes?: boolean
  opacity?: number; onChange: (patch: Partial<FaceTransform>) => void; onOpacityChange?: (value: number) => void; onReset: () => void
}) {
  const xRange = pupil ? head.width * .25 : head.width
  const yRange = pupil ? head.height * .25 : head.height
  const widthPercent = sourceWidth * transform.scaleX / head.width * 100
  const heightPercent = sourceHeight * transform.scaleY / head.height * 100
  const sizeControl = (label: string, value: number, sourceSize: number, headSize: number, field: 'scaleX' | 'scaleY') => <label className="face-component-slider" key={field}>
    <span>{label}<output>{Math.round(value)}%</output></span>
    <input type="range" min="1" max={Math.max(400, Math.ceil(value / 100) * 100 + 100)} step="1" value={value} onChange={(event) => onChange({ [field]: clamp(Number(event.target.value) / 100 * headSize / sourceSize, .01, 20) })} />
  </label>
  return <div className="face-component-transform-controls">
    {!moveTogether && !followEyes && <><div className="face-component-move-controls"><strong>Posição</strong><div className="face-component-nudge-pad">
      <button type="button" aria-label="Subir peça" onClick={() => onChange({ y: transform.y - 1 })}>↑</button>
      <button type="button" aria-label="Mover peça para a esquerda" onClick={() => onChange({ x: transform.x - 1 })}>←</button>
      <button type="button" aria-label="Descer peça" onClick={() => onChange({ y: transform.y + 1 })}>↓</button>
      <button type="button" aria-label="Mover peça para a direita" onClick={() => onChange({ x: transform.x + 1 })}>→</button>
    </div></div>
    <label className="face-component-slider"><span>{pupil ? 'Deslocamento horizontal' : 'Horizontal'}<output>{pupil ? `${Math.round(transform.x)} px` : `${Math.round(transform.x / head.width * 100)}%`}</output></span><input type="range" min={pupil ? -xRange : 0} max={xRange} step="1" value={transform.x} onChange={(event) => onChange({ x: Number(event.target.value) })} /></label>
    <label className="face-component-slider"><span>{pupil ? 'Deslocamento vertical' : 'Vertical'}<output>{pupil ? `${Math.round(transform.y)} px` : `${Math.round(transform.y / head.height * 100)}%`}</output></span><input type="range" min={pupil ? -yRange : 0} max={yRange} step="1" value={transform.y} onChange={(event) => onChange({ y: Number(event.target.value) })} /></label></>}
    {!moveTogether && !followEyes && sizeControl('Largura horizontal', widthPercent, sourceWidth, head.width, 'scaleX')}
    {!moveTogether && sizeControl('Altura vertical', heightPercent, sourceHeight, head.height, 'scaleY')}
    <label className="face-component-slider"><span>Rotação<output>{Math.round(transform.rotation)}°</output></span><input type="range" min="-180" max="180" step="1" value={transform.rotation} onChange={(event) => onChange({ rotation: Number(event.target.value) })} /></label>
    {opacity !== undefined && onOpacityChange && <label className="face-component-slider face-component-opacity-slider"><span>Transparência<output>{Math.round((1 - opacity) * 100)}%</output></span><input type="range" min="0" max="100" step="1" value={Math.round((1 - opacity) * 100)} style={{ '--transparency-progress': `${Math.round((1 - opacity) * 100)}%` } as CSSProperties} onChange={(event) => onOpacityChange(1 - Number(event.target.value) / 100)} aria-label="Transparência do nariz" /></label>}
    <button className="face-component-reset-transform" type="button" onClick={onReset}>{moveTogether ? 'Restaurar rotação' : followEyes ? 'Restaurar altura e rotação' : 'Restaurar encaixe da peça'}</button>
  </div>
}

export function FaceComponentsWorkspace({ mode }: { mode: FaceWorkspaceMode }) {
  const [previewBackground] = usePreviewBackground()
  const guideStorageKey = FACE_GUIDE_STORAGE_KEY
  const guideProfile: FaceGuideProfile = 'face'
  const [models, setModels] = useState<FabricatorSlotSummary[]>([])
  const [modelSlot, setModelSlot] = useState(1)
  const [guidesByModel, setGuidesByModel] = useState<Record<number, FaceGuide>>(() => readFaceGuides(guideStorageKey, mode === 'eyes' ? GUIDE_STORAGE_KEY : undefined))
  const [guidesLoadedFor, setGuidesLoadedFor] = useState<FaceGuideProfile | null>(null)
  const [importAnchorsByModel, setImportAnchorsByModel] = useState<FaceImportAnchors>(readFaceImportAnchors)
  const [model, setModel] = useState<FabricatorProject | null>(null)
  const [assets, setAssets] = useState<FaceComponentAssetSummary[]>([])
  const [details, setDetails] = useState<Record<string, FaceComponentAsset>>({})
  const [eyeMasks, setEyeMasks] = useState<Record<string, string>>({})
  const [selectedPart, setSelectedPart] = useState<PartId>('eye-left')
  const [libraryCategory, setLibraryCategory] = useState<LibraryCategory>(() => mode === 'eyes' ? 'eye' : 'nose')
  const [selectedAssets, setSelectedAssets] = useState<Partial<Record<PartId, string>>>({})
  const [faceDetailSelectionsByModel, setFaceDetailSelectionsByModel] = useState<FaceDetailSelections>(() => mode === 'face' ? readFaceDetailSelections() : {})
  const selectedFaceDetails = faceDetailSelectionsByModel[modelSlot] ?? {}
  const [mouthCatalog, setMouthCatalog] = useState<FaceCatalogItemSummary[]>([])
  const [mouthDetails, setMouthDetails] = useState<Record<string, FaceCatalogItem>>({})
  const [selectedMouthId, setSelectedMouthId] = useState<string | null>(null)
  const [mouthKind, setMouthKind] = useState<'mouth-closed' | 'mouth-open'>('mouth-closed')
  const [noseCatalog, setNoseCatalog] = useState<FaceCatalogItemSummary[]>([])
  const [noseDetails, setNoseDetails] = useState<Record<string, FaceCatalogItem>>({})
  const [selectedNoseId, setSelectedNoseId] = useState<string | null>(null)
  const [linked, setLinked] = useState<Record<FaceComponentKind, boolean>>({ eye: true, pupil: true, 'eye-closed': true, eyebrow: true })
  const [moveTogether, setMoveTogether] = useState<Record<FaceComponentKind, boolean>>({ eye: false, pupil: false, 'eye-closed': false, eyebrow: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(() => mode === 'eyes' ? 'Importe a folha 3 em 1 de olhos.' : 'Adicione as peças faciais à biblioteca.')
  const [openModal, setOpenModal] = useState<'import' | 'delete' | null>(null)
  const [markedForDeletion, setMarkedForDeletion] = useState<string[]>([])
  const componentDetailsRef = useRef(details)
  const selectedAssetsRef = useRef(selectedAssets)
  const preparingPair = useRef(new Map<string, Promise<FaceComponentAsset>>())
  const hydratedComponentSlot = useRef<number | null>(null)
  const catalogDetailsRef = useRef<Record<string, FaceCatalogItem>>({})
  const pendingSaves = useRef(new Map<string, { timer: number; run: () => Promise<void> }>())
  const saveChains = useRef(new Map<string, Promise<void>>())
  const previewDrag = useRef<PreviewDrag | null>(null)
  const [draggingPreview, setDraggingPreview] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    let cancelled = false
    const eyeAssets = Object.values(details).filter((asset) => asset.kind === 'eye')
    void Promise.all(eyeAssets.map(async (asset) => [asset.id, await eyeInteriorMask(asset.dataUrl)] as const)).then((entries) => {
      if (cancelled) return
      setEyeMasks((current) => {
        let changed = false
        const next = { ...current }
        for (const [id, mask] of entries) {
          if (next[id] !== mask) { next[id] = mask; changed = true }
        }
        return changed ? next : current
      })
    })
    return () => { cancelled = true }
  }, [details])
  const head = useMemo(() => model?.parts.find((part) => /cabe[çc]a|head/i.test(part.name)) ?? null, [model])
  const guide = guidesByModel[modelSlot] ?? defaultGuide
  const previewScale = head && stageSize.width > 0 && stageSize.height > 0
    ? Math.min((stageSize.width - 24) / head.width, (stageSize.height - 24) / head.height) * .9
    : 0
  const selectedCategory = partCategory(selectedPart)
  const libraryAssets = assets.filter((asset) => !isRightLibraryAsset(asset) || !assets.some((candidate) => {
    const left = details[candidate.id]
    const right = details[asset.id]
    return left && right && !isRightLibraryAsset(candidate) && sameLibraryPair(left, right)
  }))
  const visibleDeletableAssets = libraryAssets.filter((asset) => mode === 'eyes'
    ? categories.some((category) => category.kind === asset.kind)
    : faceDetailCategories.some((category) => category.kind === asset.kind))
  const markedGroupCount = visibleDeletableAssets.filter((asset) => markedForDeletion.includes(asset.id)).length
    + (mode === 'face' ? noseCatalog.filter((item) => markedForDeletion.includes(item.id)).length
      + mouthCatalog.filter((item) => markedForDeletion.includes(item.id)).length : 0)
  const componentPair = categories.find((category) => category.kind === libraryCategory)
  const selectedId = componentPair ? selectedAssets[selectedPart] ?? (linked[selectedCategory.kind] && selectedPart.endsWith('right') ? selectedAssets[selectedCategory.parts[0]] : undefined) : undefined
  const selectedAsset = selectedId ? details[selectedId] : undefined
  const selectedFaceDetailId = isFaceDetailKind(libraryCategory) ? selectedFaceDetails[libraryCategory] : undefined
  const selectedFaceDetail = selectedFaceDetailId ? details[selectedFaceDetailId] : undefined
  const currentImportAnchors = importAnchorsByModel[modelSlot] ?? {}
  const autoFixEnabled = autoFixKinds.every((kind) => Boolean(currentImportAnchors[kind]))
  const autoFixReferencesReady = autoFixKinds.every((kind) => {
    const category = categories.find((entry) => entry.kind === kind)!
    return Boolean(details[selectedAssets[category.parts[0]] ?? ''])
  })
  const leftPairId = componentPair ? selectedAssets[componentPair.parts[0]] : undefined
  const rightPairId = componentPair ? selectedAssets[componentPair.parts[1]] : undefined
  const leftPairAsset = leftPairId ? details[leftPairId] : undefined
  const rightPairAsset = rightPairId ? details[rightPairId] : undefined
  const movementLeftAsset = libraryCategory === 'eye-closed' ? details[selectedAssets['eye-left'] ?? ''] : leftPairAsset
  const movementRightAsset = libraryCategory === 'eye-closed' ? details[selectedAssets['eye-right'] ?? ''] : rightPairAsset
  const rightPairX = head && movementLeftAsset ? movementRightAsset && movementRightAsset.id !== movementLeftAsset.id
    ? movementRightAsset.rightSidePositioned || libraryCategory === 'pupil' ? movementRightAsset.defaultTransform.x : head.width - movementRightAsset.defaultTransform.x
    : libraryCategory === 'pupil' ? -movementLeftAsset.defaultTransform.x : head.width - movementLeftAsset.defaultTransform.x : 0
  const pairX = movementLeftAsset ? (movementLeftAsset.defaultTransform.x + rightPairX) / 2 : 0
  const eyeSeparation = libraryCategory === 'eye' && movementLeftAsset ? Math.max(0, rightPairX - movementLeftAsset.defaultTransform.x) : 0
  const eyeSeparationMax = head ? Math.max(1, 2 * Math.min(pairX, head.width - pairX)) : 1
  const pairY = movementLeftAsset ? (movementLeftAsset.defaultTransform.y + (movementRightAsset && movementRightAsset.id !== movementLeftAsset.id ? movementRightAsset.defaultTransform.y : movementLeftAsset.defaultTransform.y)) / 2 : 0
  const pairHeightAsset = libraryCategory === 'eye-closed' ? leftPairAsset : movementLeftAsset
  const leftEyeForPupil = details[selectedAssets['eye-left'] ?? '']
  const pairWidthSource = movementLeftAsset?.kind === 'pupil' ? leftEyeForPupil ? leftEyeForPupil.width * leftEyeForPupil.defaultTransform.scaleX : head ? head.width * .19 : 1 : movementLeftAsset?.width ?? 1
  const pairHeightSource = pairHeightAsset?.kind === 'pupil' ? leftEyeForPupil ? leftEyeForPupil.height * leftEyeForPupil.defaultTransform.scaleY : head ? head.height * .17 : 1 : pairHeightAsset?.height ?? 1
  const pairWidthPercent = head && movementLeftAsset ? pairWidthSource * movementLeftAsset.defaultTransform.scaleX / head.width * 100 : 0
  const pairHeightPercent = head && pairHeightAsset ? pairHeightSource * pairHeightAsset.defaultTransform.scaleY / head.height * 100 : 0
  const selectedMouth = selectedMouthId && mouthDetails[selectedMouthId]?.category === mouthKind ? mouthDetails[selectedMouthId] : undefined
  const selectedNose = selectedNoseId ? noseDetails[selectedNoseId] : undefined
  const selectedCatalogItem = libraryCategory === 'nose' ? selectedNose : libraryCategory === 'mouth' ? selectedMouth : undefined
  const selectedCatalogPiece = selectedCatalogItem?.pieces.find((piece) => piece.index === (selectedCatalogItem.category === 'nose' ? selectedCatalogItem.selectedNose : selectedCatalogItem.selectedExpression)) ?? selectedCatalogItem?.pieces[0]
  const firstClosedMouth = Object.values(mouthDetails).find((item) => item.category === 'mouth-closed')
  const mouthReferenceItem = selectedMouth?.category === 'mouth-closed' ? selectedMouth : firstClosedMouth
  const sharedMouthTransform = mouthReferenceItem?.transforms.mouth ?? selectedMouth?.transforms.mouth
  const mouthPreviewTransform = selectedMouth && sharedMouthTransform
    ? alignMouthPreviewTransform(sharedMouthTransform, mouthReferenceItem, selectedMouth)
    : sharedMouthTransform
  const activeComponent: (FaceComponentAsset & { kind: FaceComponentKind }) | undefined = mode === 'eyes' && componentPair && selectedAsset && isFaceComponentKind(selectedAsset.kind) ? selectedAsset as FaceComponentAsset & { kind: FaceComponentKind } : undefined
  const activeFaceDetail: (FaceComponentAsset & { kind: FaceDetailKind }) | undefined = mode === 'face' && selectedFaceDetail && isFaceDetailKind(selectedFaceDetail.kind) ? selectedFaceDetail as FaceComponentAsset & { kind: FaceDetailKind } : undefined
  const eyeAssetId = selectedPart.endsWith('right') ? selectedAssets['eye-right'] ?? selectedAssets['eye-left'] : selectedAssets['eye-left']
  const eyeAsset = eyeAssetId ? details[eyeAssetId] : undefined
  const leftOpenEyeAsset = details[selectedAssets['eye-left'] ?? '']
  const selectedOpenEye = eyeAsset && selectedPart.endsWith('right') && linked.eye && leftOpenEyeAsset
    ? { ...eyeAsset, width: leftOpenEyeAsset.width, height: leftOpenEyeAsset.height } : eyeAsset
  const followsOpenEye = selectedAsset?.kind === 'eye-closed' && Boolean(eyeAsset && head)
  const selectedTransform = selectedCatalogItem ? selectedCatalogItem.category === 'nose' ? selectedCatalogItem.transforms.nose : sharedMouthTransform
    : activeFaceDetail?.defaultTransform ?? (selectedAsset && followsOpenEye && selectedOpenEye && head ? fitClosedEyeToOpen(selectedAsset, selectedOpenEye, head, selectedPart.endsWith('right')) : selectedAsset?.defaultTransform)
  const activePreviewKey = selectedCatalogItem ? `${selectedCatalogItem.category}:${selectedCatalogItem.id}` : activeFaceDetail ? `${activeFaceDetail.kind}:${activeFaceDetail.id}` : activeComponent ? `${selectedPart}:${activeComponent.id}` : null
  const controlSourcePiece = selectedCatalogItem?.category !== 'nose' && selectedCatalogItem
    ? mouthReferenceItem?.pieces.find((piece) => piece.index === selectedMouth?.selectedExpression) ?? mouthReferenceItem?.pieces[0] ?? selectedCatalogPiece
    : selectedCatalogPiece
  const selectedSourceWidth = controlSourcePiece?.width ?? activeFaceDetail?.width ?? (selectedAsset?.kind === 'pupil' ? selectedOpenEye ? selectedOpenEye.width * selectedOpenEye.defaultTransform.scaleX : head?.width ? head.width * .19 : 1 : selectedAsset?.width ?? 1)
  const selectedSourceHeight = controlSourcePiece?.height ?? activeFaceDetail?.height ?? (selectedAsset?.kind === 'pupil' ? selectedOpenEye ? selectedOpenEye.height * selectedOpenEye.defaultTransform.scaleY : head?.height ? head.height * .17 : 1 : selectedAsset?.height ?? 1)
  const mouthPiece = selectedMouth?.pieces.find((piece) => piece.index === selectedMouth.selectedExpression) ?? selectedMouth?.pieces[0]
  const mouthTransform = mouthPreviewTransform
  const mouthStyle: CSSProperties | undefined = head && mouthPiece && mouthTransform ? {
    left: `${mouthTransform.x / head.width * 100}%`, top: `${mouthTransform.y / head.height * 100}%`,
    width: `${mouthPiece.width * mouthTransform.scaleX / head.width * 100}%`,
    height: `${mouthPiece.height * mouthTransform.scaleY / head.height * 100}%`,
    transform: `translate(-50%,-50%) rotate(${mouthTransform.rotation}deg)`
  } : undefined
  const nosePiece = selectedNose?.pieces.find((piece) => piece.index === selectedNose.selectedNose) ?? selectedNose?.pieces[0]
  const noseTransform = selectedNose?.transforms.nose
  const noseStyle: CSSProperties | undefined = head && nosePiece && noseTransform ? {
    left: `${noseTransform.x / head.width * 100}%`, top: `${noseTransform.y / head.height * 100}%`,
    width: `${nosePiece.width * noseTransform.scaleX / head.width * 100}%`,
    height: `${nosePiece.height * noseTransform.scaleY / head.height * 100}%`,
    transform: `translate(-50%,-50%) rotate(${noseTransform.rotation}deg)`, opacity: selectedNose?.opacity ?? 1
  } : undefined
  const previewFaceDetailLayers = mode === 'face' ? faceDetailCategories.flatMap(({ kind }) => {
    const asset = details[selectedFaceDetails[kind] ?? '']
    if (!head || !asset) return []
    const transform = asset.defaultTransform
    const style: CSSProperties = {
      left: `${transform.x / head.width * 100}%`, top: `${transform.y / head.height * 100}%`,
      width: `${asset.width * transform.scaleX / head.width * 100}%`, height: `${asset.height * transform.scaleY / head.height * 100}%`,
      transform: `translate(-50%,-50%) rotate(${transform.rotation}deg) scaleX(${transform.flipX ? -1 : 1})`
    }
    return [{ kind, asset, style }]
  }) : []
  componentDetailsRef.current = details
  selectedAssetsRef.current = selectedAssets
  catalogDetailsRef.current = { ...noseDetails, ...mouthDetails }

  function queueSave(key: string, run: () => Promise<void>) {
    const previous = pendingSaves.current.get(key)
    if (previous) window.clearTimeout(previous.timer)
    const timer = window.setTimeout(() => {
      pendingSaves.current.delete(key)
      const next = (saveChains.current.get(key) ?? Promise.resolve()).catch(() => undefined).then(run)
      saveChains.current.set(key, next)
      void next.then(() => window.dispatchEvent(new Event('fabricator:assets-updated'))).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
    }, 180)
    pendingSaves.current.set(key, { timer, run })
  }

  async function flushSave(key: string) {
    const pending = pendingSaves.current.get(key)
    if (pending) {
      window.clearTimeout(pending.timer)
      pendingSaves.current.delete(key)
      const next = (saveChains.current.get(key) ?? Promise.resolve()).catch(() => undefined).then(pending.run)
      saveChains.current.set(key, next)
    }
    await saveChains.current.get(key)?.catch(() => undefined)
  }

  useEffect(() => { void window.desktop.listFabricatorSlots().then((slots) => { setModels(slots); const first = slots.findIndex(Boolean); if (first >= 0) setModelSlot(first + 1) }).catch((reason) => setError(String(reason))) }, [])
  useEffect(() => {
    let cancelled = false
    setGuidesLoadedFor(null)
    void window.desktop.loadFaceGuides(guideProfile).then(async (saved) => {
      if (cancelled) return
      const legacyEyes = readFaceGuides(EYES_GUIDE_STORAGE_KEY)
      const legacyFace = readFaceGuides(FACE_GUIDE_STORAGE_KEY, GUIDE_STORAGE_KEY)
      const next = saved ?? { ...legacyEyes, ...legacyFace }
      setGuidesByModel(next as Record<number, FaceGuide>)
      if (!saved) await window.desktop.saveFaceGuides(guideProfile, next)
      if (!cancelled) setGuidesLoadedFor(guideProfile)
    }).catch((reason) => { if (!cancelled) { setError(reason instanceof Error ? reason.message : String(reason)); setGuidesLoadedFor(guideProfile) } })
    return () => { cancelled = true }
  }, [guideProfile, guideStorageKey, mode])
  useEffect(() => {
    try { window.localStorage.setItem(guideStorageKey, JSON.stringify(guidesByModel)) } catch { /* Keep the durable Fabricator copy available. */ }
    if (guidesLoadedFor === guideProfile) void window.desktop.saveFaceGuides(guideProfile, guidesByModel).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [guideProfile, guideStorageKey, guidesByModel, guidesLoadedFor])
  useEffect(() => { if (mode !== 'eyes') return; try { window.localStorage.setItem(FACE_IMPORT_ANCHORS_STORAGE_KEY, JSON.stringify(importAnchorsByModel)) } catch { setError('Não foi possível salvar a fixação de importação neste computador.') } }, [mode, importAnchorsByModel])
  useEffect(() => { if (mode !== 'face') return; try { window.localStorage.setItem(FACE_DETAIL_SELECTION_STORAGE_KEY, JSON.stringify(faceDetailSelectionsByModel)) } catch { /* Saved assets remain available in the library. */ } }, [mode, faceDetailSelectionsByModel])
  useEffect(() => {
    if (mode !== 'eyes') return
    if (hydratedComponentSlot.current !== modelSlot) return
    try {
      const stored = readComponentSelections()
      stored[modelSlot] = { parts: selectedAssets, linked, moveTogether }
      window.localStorage.setItem(COMPONENT_SELECTION_STORAGE_KEY, JSON.stringify(stored))
    } catch { /* The saved assets remain available in the library. */ }
  }, [mode, modelSlot, selectedAssets, linked, moveTogether])
  function updateGuide(patch: Partial<FaceGuide>) {
    const next = { ...guidesByModel, [modelSlot]: { ...(guidesByModel[modelSlot] ?? defaultGuide), ...patch } }
    setGuidesByModel(next)
    try { window.localStorage.setItem(guideStorageKey, JSON.stringify(next)) } catch { /* The durable Fabricator store remains authoritative. */ }
    if (guidesLoadedFor === guideProfile) void window.desktop.saveFaceGuides(guideProfile, next).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
  }
  function fixImportAnchors() {
    if (!head) return
    const anchors: Partial<Record<AlignableFaceKind, FaceImportAnchor>> = {}
    for (const kind of autoFixKinds) {
      const category = categories.find((entry) => entry.kind === kind)!
      const left = details[selectedAssets[category.parts[0]] ?? '']
      const right = details[selectedAssets[category.parts[1]] ?? '']
      if (!left) {
        setError(`Selecione uma referência para ${category.label.toLowerCase()} antes de ativar o auto fixar.`)
        return
      }
      anchors[kind] = captureFaceImportAnchor(left, right, head)
    }
    setImportAnchorsByModel((current) => ({ ...current, [modelSlot]: anchors }))
    setNotice('Auto fixar ativado para olhos, pupilas e olhos fechados. As próximas importações deste modelo usarão essas referências.')
  }
  function releaseImportAnchors() {
    setImportAnchorsByModel((current) => {
      const next = { ...current }
      delete next[modelSlot]
      return next
    })
    setNotice('Auto fixar desativado. Os assets já salvos mantêm seus ajustes.')
  }
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setStageSize((current) => current.width === width && current.height === height ? current : { width, height })
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!openModal) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) setOpenModal(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [openModal, busy])
  useEffect(() => {
    let active = true
    hydratedComponentSlot.current = null
    setModel(null); setAssets([]); setDetails({}); setSelectedAssets({})
    const visibleKinds: FaceAssetKind[] = mode === 'eyes'
      ? categories.map((category) => category.kind)
      : faceDetailCategories.map((category) => category.kind)
    void Promise.all([
      window.desktop.loadFabricatorSlot(modelSlot),
      Promise.all(visibleKinds.map((kind) => window.desktop.listFaceComponentAssets(modelSlot, kind))).then((lists) => lists.flat())
    ]).then(async ([project, visibleList]) => {
      const loaded = await Promise.all(visibleList.map((entry) => window.desktop.loadFaceComponentAsset(modelSlot, entry.id)))
      if (!active) return
      const loadedAssets = loaded.filter((item): item is FaceComponentAsset => Boolean(item))
      const assetKinds = new Map(loadedAssets.map((item) => [item.id, item.kind]))
      const savedSelection = mode === 'eyes' ? readComponentSelections()[modelSlot] : undefined
      const savedParts = Object.fromEntries(Object.entries(savedSelection?.parts ?? {}).filter(([part, id]) =>
        categories.some((category) => category.parts.includes(part as PartId) && assetKinds.get(id) === category.kind))) as Partial<Record<PartId, string>>
      setModel(project); setAssets(visibleList); setDetails(Object.fromEntries(loadedAssets.map((item) => [item.id, item])))
      setSelectedAssets(savedParts)
      setLinked({ eye: true, pupil: true, 'eye-closed': true, eyebrow: true, ...savedSelection?.linked })
      setMoveTogether({ eye: false, pupil: false, 'eye-closed': false, eyebrow: false, ...savedSelection?.moveTogether })
      hydratedComponentSlot.current = modelSlot
    }).catch((reason) => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [mode, modelSlot])
  useEffect(() => {
    let active = true
    setMouthCatalog([]); setMouthDetails({}); setNoseCatalog([]); setNoseDetails({})
    if (mode !== 'face') return () => { active = false }
    void window.desktop.listFaceCatalog(modelSlot).then(async (list) => {
      const relevant = list.filter((item) => item.category === 'nose' || item.category === 'mouth-closed' || item.category === 'mouth-open')
      const mouths = relevant.filter((item) => item.category === 'mouth-closed' || item.category === 'mouth-open')
      const noses = relevant.filter((item) => item.category === 'nose')
      const loaded = await Promise.all(relevant.map((item) => window.desktop.loadFaceCatalogItem(modelSlot, item.id)))
      if (!active) return
      setMouthCatalog(mouths)
      setNoseCatalog(noses)
      const entries = loaded.filter((item): item is FaceCatalogItem => Boolean(item))
      setMouthDetails(Object.fromEntries(entries.filter((item) => item.category !== 'nose').map((item) => [item.id, item])))
      setNoseDetails(Object.fromEntries(entries.filter((item) => item.category === 'nose').map((item) => [item.id, item])))
      const availableMouthKind = mouths.some((item) => item.category === mouthKind) ? mouthKind : mouths[0]?.category
      if (availableMouthKind === 'mouth-closed' || availableMouthKind === 'mouth-open') setMouthKind(availableMouthKind)
      setSelectedMouthId((current) => mouths.some((item) => item.id === current && item.category === availableMouthKind) ? current : mouths.find((item) => item.category === availableMouthKind)?.id ?? null)
      setSelectedNoseId((current) => noses.some((item) => item.id === current) ? current : noses[0]?.id ?? null)
    }).catch((reason) => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [mode, modelSlot])

  async function cleanSelectedEyebrow() {
    if (!selectedAsset || selectedAsset.kind !== 'eyebrow' || busy) return
    setBusy(true); setError('')
    try {
      const siblings = assets.map((summary) => componentDetailsRef.current[summary.id]).filter((candidate): candidate is FaceComponentAsset =>
        Boolean(candidate && candidate.kind === 'eyebrow' && (candidate.id === selectedAsset.id || sameLibraryPair(selectedAsset, candidate) || sameLibraryPair(candidate, selectedAsset))))
      const updatedAt = new Date().toISOString()
      const processedImages = new Map<string, Awaited<ReturnType<typeof removeEyebrowGreen>>>()
      const changed: FaceComponentAsset[] = []
      for (const sibling of siblings) {
        let processed = processedImages.get(sibling.dataUrl)
        if (!processed) { processed = await removeEyebrowGreen(sibling.dataUrl, false); processedImages.set(sibling.dataUrl, processed) }
        if (processed.removedPixels === 0) continue
        const next = { ...sibling, dataUrl: processed.dataUrl, updatedAt }
        persistComponentAsset(next)
        changed.push(next)
      }
      if (changed.length === 0) { setNotice('Não encontrei fundo verde nas bordas desta sobrancelha.'); return }
      await Promise.all(changed.map((sibling) => flushSave(`component:${sibling.modelSlot}:${sibling.id}`)))
      setNotice('Fundo verde removido da sobrancelha salva. Posição e tamanho preservados.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  async function importEyeSheet(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file || !head) return
    setBusy(true); setError('')
    const savedIds: string[] = []
    try {
      const canonicalSheet = await normalizeEditableImageFile(file)
      const pieces = await splitEyeSheet(canonicalSheet.dataUrl)
      const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 90) || 'Olhos'
      const imported: FaceComponentAsset[] = []
      const assigned: Partial<Record<PartId, string>> = {}
      const sourceSheetPairId = crypto.randomUUID()
      for (const piece of pieces) {
        const category = categories.find((entry) => entry.kind === piece.kind)!
        for (const [index, side] of category.parts.entries()) {
          const baseTransform = initialTransform(piece.kind, head, piece.width, piece.height)
          const defaultTransform: FaceTransform = index === 0 ? baseTransform : {
            ...baseTransform, x: piece.kind === 'pupil' ? -baseTransform.x : head.width - baseTransform.x,
            rotation: -baseTransform.rotation, flipX: true
          }
          const anchor = importAnchorsByModel[modelSlot]?.[piece.kind]
          let transform = anchor ? alignImportedFacePiece(piece.kind, index === 0 ? 'left' : 'right', piece.width, piece.height, anchor) : defaultTransform
          if (piece.kind === 'eye-closed') {
            const open = imported.find((asset) => asset.kind === 'eye' && Boolean(asset.rightSidePositioned) === Boolean(index))
            if (open) transform = fitClosedEyeToOpen({ width: piece.width, defaultTransform: transform, rightSidePositioned: index === 1 }, open, head, index === 1)
          }
          if (transform.scaleX > 20) throw new Error('O olho fechado desta folha é estreito demais para acompanhar a largura do olho aberto.')
          const asset: FaceComponentAssetSave = {
            schemaVersion: 1, id: crypto.randomUUID(), modelSlot, kind: piece.kind,
            name: `${baseName} · ${category.names[index]}`.slice(0, 120), width: piece.width, height: piece.height,
            defaultTransform: transform, rightSidePositioned: index === 1, pairId: sourceSheetPairId, updatedAt: new Date().toISOString()
          }
          await window.desktop.saveFaceComponentAsset(modelSlot, asset, piece.dataUrl)
          savedIds.push(asset.id)
          assigned[side] = asset.id
          imported.push({ ...asset, dataUrl: piece.dataUrl })
        }
      }
      setDetails((current) => ({ ...current, ...Object.fromEntries(imported.map((asset) => [asset.id, asset])) }))
      setAssets((current) => [...imported, ...current])
      setSelectedAssets((current) => ({ ...current, ...assigned }))
      setSelectedPart('eye-left'); setLibraryCategory('eye'); setOpenModal(null)
      setNotice('Olho aberto, pupila e olho fechado importados. Ajuste cada peça na Biblioteca.')
    } catch (reason) {
      await Promise.allSettled(savedIds.map((id) => window.desktop.deleteFaceComponentAsset(modelSlot, id)))
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setBusy(false) }
  }

  function selectFaceDetail(kind: FaceDetailKind, id: string | undefined) {
    setFaceDetailSelectionsByModel((current) => {
      const selected = { ...(current[modelSlot] ?? {}) }
      if (id) selected[kind] = id
      else delete selected[kind]
      return { ...current, [modelSlot]: selected }
    })
  }

  async function importFaceDetail(kind: FaceDetailKind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file || !head) return
    setBusy(true); setError('')
    try {
      const image = await readImage(file)
      const asset: FaceComponentAssetSave = {
        schemaVersion: 1, id: crypto.randomUUID(), modelSlot, kind,
        name: file.name.replace(/\.[^.]+$/, '').slice(0, 110) || faceDetailCategories.find((entry) => entry.kind === kind)!.label,
        width: image.width, height: image.height,
        defaultTransform: initialFaceDetailTransform(kind, head, image.width, image.height),
        updatedAt: new Date().toISOString()
      }
      await window.desktop.saveFaceComponentAsset(modelSlot, asset, image.dataUrl)
      const saved = { ...asset, dataUrl: image.dataUrl }
      setAssets((current) => [asset, ...current])
      setDetails((current) => ({ ...current, [asset.id]: saved }))
      selectFaceDetail(kind, asset.id)
      setLibraryCategory(kind); setNotice(`${asset.name} adicionado ao catálogo facial.`); setOpenModal(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  async function cloneComponentForSide(source: FaceComponentAsset, side: PartId): Promise<FaceComponentAsset> {
    if (!head) throw new Error('Selecione um modelo com cabeça para ajustar a peça.')
    const kind = partCategory(side).kind
    const right = side.endsWith('right')
    const baseName = source.name.replace(/ · (Pupila|Olho|Olho aberto|Olho fechado|Sobrancelha) (esquerda|direita|esquerdo|direito)$/, '')
    const copy: FaceComponentAssetSave = {
      schemaVersion: 1, id: crypto.randomUUID(), modelSlot, kind,
      name: `${baseName} · ${partCategory(side).names[right ? 1 : 0]}`.slice(0, 120),
      width: source.width, height: source.height, rightSidePositioned: right, pairId: source.pairId ?? source.id,
      defaultTransform: {
        ...source.defaultTransform,
        x: kind === 'pupil' ? -source.defaultTransform.x : head.width - source.defaultTransform.x,
        rotation: -source.defaultTransform.rotation,
        flipX: !source.defaultTransform.flipX
      }, updatedAt: new Date().toISOString()
    }
    await window.desktop.saveFaceComponentAsset(modelSlot, copy, source.dataUrl)
    const loaded: FaceComponentAsset = { ...copy, dataUrl: source.dataUrl }
    componentDetailsRef.current = { ...componentDetailsRef.current, [copy.id]: loaded }
    selectedAssetsRef.current = { ...selectedAssetsRef.current, [side]: copy.id }
    setDetails((current) => ({ ...current, [copy.id]: loaded }))
    setAssets((current) => [copy, ...current])
    setSelectedAssets((current) => ({ ...current, [side]: copy.id }))
    return loaded
  }

  async function chooseComponentSide(side: PartId) {
    if (busy) return
    const category = partCategory(side)
    const sourceId = selectedAssets[side === category.parts[0] ? category.parts[1] : category.parts[0]]
    const selectedSideId = selectedAssets[side]
    if (sourceId && (!selectedSideId || selectedSideId === sourceId)) {
      const source = details[sourceId]
      if (source) {
        setBusy(true); setError('')
        try { await cloneComponentForSide(source, side) }
        catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setBusy(false); return }
        setBusy(false)
      }
    }
    if (side.endsWith('right') && selectedSideId && selectedSideId !== sourceId && details[selectedSideId]) normalizeRightAsset(details[selectedSideId])
    if (side.endsWith('right')) setLinked((current) => ({ ...current, [category.kind]: false }))
    setSelectedPart(side); setLibraryCategory(category.kind)
  }

  async function chooseLibraryAsset(asset: FaceComponentAssetSummary) {
    const category = partCategory(selectedPart)
    const chosen = details[asset.id]
    if (!chosen) return
    const pair = assets.map((item) => details[item.id]).filter((item): item is FaceComponentAsset => Boolean(item && item.kind === category.kind))
    const isRight = isRightLibraryAsset(chosen)
    let left = isRight ? pair.find((item) => !isRightLibraryAsset(item) && sameLibraryPair(item, chosen)) ?? null : chosen
    let right = isRight ? chosen : pair.find((item) => sameLibraryPair(chosen, item)) ?? null
    setBusy(true); setError('')
    try {
      if (!left) left = await cloneComponentForSide(right ?? chosen, category.parts[0])
      if (!right) right = await cloneComponentForSide(left, category.parts[1])
      setSelectedAssets((current) => ({ ...current, [category.parts[0]]: left!.id, [category.parts[1]]: right!.id }))
      setLinked((current) => ({ ...current, [category.kind]: false }))
      setNotice(`${category.label}: conjunto esquerdo e direito selecionado.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  async function importCatalogSheet(kind: CatalogKind, event: ChangeEvent<HTMLInputElement>, noseMode: 'one' | 'six' = 'one') {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file || !head) return
    setBusy(true); setError('')
    try {
      const image = await readImage(file)
      const processed = await processFaceSheet(kind, image.dataUrl, noseMode)
      if (!processed.pieces.length) throw new Error('Nenhuma peça foi encontrada na folha.')
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, 120) || (kind === 'nose' ? 'Nariz' : 'Boca')
      const item: FaceCatalogItem = {
        schemaVersion: 1, id: crypto.randomUUID(), modelSlot, category: kind, name,
        sheet: { kind, name: file.name, width: processed.width, height: processed.height, tolerance: 42, dataUrl: processed.sheetPng },
        pieces: processed.pieces,
        transforms: { [kind === 'nose' ? 'nose' : 'mouth']: initialCatalogTransform(head, { category: kind, pieces: processed.pieces }) },
        eyeLinked: true, browLinked: true, selectedNose: 0, selectedExpression: 0, updatedAt: new Date().toISOString()
      }
      await window.desktop.saveFaceCatalogItem(modelSlot, catalogSaveData(item), [
        { id: `sheet-${kind}`, dataUrl: item.sheet.dataUrl },
        ...item.pieces.map((piece) => ({ id: piece.id, dataUrl: piece.dataUrl }))
      ])
      const summary: FaceCatalogItemSummary = { id: item.id, modelSlot, category: kind, name, updatedAt: item.updatedAt, pieceCount: item.pieces.length }
      if (kind === 'nose') {
        setNoseCatalog((current) => [summary, ...current]); setNoseDetails((current) => ({ ...current, [item.id]: item })); setSelectedNoseId(item.id); setLibraryCategory('nose')
      } else {
        setMouthCatalog((current) => [summary, ...current]); setMouthDetails((current) => ({ ...current, [item.id]: item })); setSelectedMouthId(item.id); setMouthKind(kind); setLibraryCategory('mouth')
      }
      setNotice(`${item.pieces.length} ${item.pieces.length === 1 ? 'variante salva' : 'variantes salvas'} em ${name}.`)
      setOpenModal(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  function updateTransform(patch: Partial<FaceTransform>) {
    if (activeFaceDetail) {
      persistComponentAsset({ ...activeFaceDetail, defaultTransform: { ...activeFaceDetail.defaultTransform, ...patch }, updatedAt: new Date().toISOString() })
      return
    }
    if (libraryCategory === 'nose' || libraryCategory === 'mouth') {
      if (!selectedCatalogItem) return
      const original = catalogDetailsRef.current[selectedCatalogItem.id] ?? selectedCatalogItem
      const element = original.category === 'nose' ? 'nose' : 'mouth'
      if (element === 'nose') {
        const current = original.transforms.nose
        if (!current) return
        const next: FaceCatalogItem = { ...original, transforms: { ...original.transforms, nose: { ...current, ...patch } }, updatedAt: new Date().toISOString() }
        catalogDetailsRef.current = { ...catalogDetailsRef.current, [next.id]: next }
        setNoseDetails((items) => ({ ...items, [next.id]: next }))
        queueSave(`catalog:${next.modelSlot}:${next.id}`, () => window.desktop.saveFaceCatalogItem(next.modelSlot, catalogSaveData(next), catalogImagesForSave(next)))
        return
      }
      const mouthItems = Object.values(catalogDetailsRef.current).filter((item) => item.modelSlot === original.modelSlot && (item.category === 'mouth-closed' || item.category === 'mouth-open'))
      const current = mouthItems.find((item) => item.category === 'mouth-closed')?.transforms.mouth ?? original.transforms.mouth
      if (!current) return
      const shared = { ...current, ...patch }
      const updatedAt = new Date().toISOString()
      const updates = (mouthItems.length ? mouthItems : [original]).map((item) => {
        const itemBase = item.transforms.mouth ?? current
        const isOpenMouth = item.category === 'mouth-open'
        const itemTransform = isOpenMouth ? {
          ...shared,
          scaleX: shared.scaleX * itemBase.scaleX / current.scaleX,
          scaleY: shared.scaleY * itemBase.scaleY / current.scaleY
        } : shared
        return { ...item, transforms: { ...item.transforms, mouth: itemTransform }, updatedAt }
      })
      catalogDetailsRef.current = { ...catalogDetailsRef.current, ...Object.fromEntries(updates.map((item) => [item.id, item])) }
      setMouthDetails((items) => ({ ...items, ...Object.fromEntries(updates.map((item) => [item.id, item])) }))
      for (const item of updates) queueSave(`catalog:${item.modelSlot}:${item.id}`, () => window.desktop.saveFaceCatalogItem(item.modelSlot, catalogSaveData(item), catalogImagesForSave(item)))
      return
    }
    if (!selectedAsset) return
    if (followsOpenEye) {
      const closedPatch: Partial<FaceTransform> = {}
      if (patch.scaleY !== undefined) closedPatch.scaleY = patch.scaleY
      if (patch.rotation !== undefined) closedPatch.rotation = patch.rotation
      if (patch.flipX !== undefined) closedPatch.flipX = patch.flipX
      if (Object.keys(closedPatch).length > 0) saveComponentTransform(selectedAsset, closedPatch)
      return
    }
    if (moveTogether[selectedCategory.kind] && head) {
      if (patch.x !== undefined) void movePair(selectedCategory.kind, 'x', pairX + patch.x - selectedAsset.defaultTransform.x)
      if (patch.y !== undefined) void movePair(selectedCategory.kind, 'y', pairY + patch.y - selectedAsset.defaultTransform.y)
      if (patch.scaleX !== undefined) void resizePair(selectedCategory.kind, 'scaleX', selectedSourceWidth * patch.scaleX / head.width * 100)
      if (patch.scaleY !== undefined) void resizePair(selectedCategory.kind, 'scaleY', selectedSourceHeight * patch.scaleY / head.height * 100)
      const individualPatch: Partial<FaceTransform> = {}
      if (patch.rotation !== undefined) individualPatch.rotation = patch.rotation
      if (patch.flipX !== undefined) individualPatch.flipX = patch.flipX
      if (Object.keys(individualPatch).length > 0) saveComponentTransform(selectedAsset, individualPatch)
      return
    }
    saveComponentTransform(selectedAsset, patch)
  }

  function resetSelectedTransform() {
    if (!head) return
    if (selectedCatalogItem) {
      const resetTarget = selectedCatalogItem.category !== 'nose' ? mouthReferenceItem ?? selectedCatalogItem : selectedCatalogItem
      updateTransform(initialCatalogTransform(head, resetTarget))
      return
    }
    if (activeFaceDetail) { updateTransform(initialFaceDetailTransform(activeFaceDetail.kind as FaceDetailKind, head, activeFaceDetail.width, activeFaceDetail.height)); return }
    if (!activeComponent) return
    if (moveTogether[activeComponent.kind]) { updateTransform({ rotation: 0 }); return }
    const base = initialTransform(activeComponent.kind, head, activeComponent.width, activeComponent.height)
    if (selectedPart.endsWith('right')) {
      normalizeRightAsset(activeComponent)
      base.x = activeComponent.kind === 'pupil' ? 0 : head.width - base.x
      base.flipX = true
    }
    updateTransform(followsOpenEye ? { scaleY: base.scaleY, rotation: base.rotation, flipX: base.flipX } : base)
  }

  function persistComponentAsset(next: FaceComponentAsset) {
    componentDetailsRef.current = { ...componentDetailsRef.current, [next.id]: next }
    setDetails((items) => ({ ...items, [next.id]: next }))
    queueSave(`component:${next.modelSlot}:${next.id}`, () => {
      const { dataUrl, ...saved } = next
      return window.desktop.saveFaceComponentAsset(next.modelSlot, saved, dataUrl)
    })
  }

  function normalizeRightAsset(asset: FaceComponentAsset): FaceComponentAsset {
    const original = componentDetailsRef.current[asset.id] ?? asset
    if (!head || original.rightSidePositioned) return original
    const next: FaceComponentAsset = {
      ...original, rightSidePositioned: true, updatedAt: new Date().toISOString(),
      defaultTransform: original.kind === 'pupil' ? original.defaultTransform : {
        ...original.defaultTransform, x: head.width - original.defaultTransform.x,
        rotation: -original.defaultTransform.rotation, flipX: !original.defaultTransform.flipX
      }
    }
    persistComponentAsset(next)
    return next
  }

  function saveComponentTransform(asset: FaceComponentAsset, patch: Partial<FaceTransform>) {
    const original = componentDetailsRef.current[asset.id] ?? asset
    const next: FaceComponentAsset = { ...original, defaultTransform: { ...original.defaultTransform, ...patch }, updatedAt: new Date().toISOString() }
    persistComponentAsset(next)
    if (next.kind !== 'eye' || !head) return
    const selected = selectedAssetsRef.current
    for (const side of ['left', 'right'] as const) {
      const openId = side === 'right' ? selected['eye-right'] ?? selected['eye-left'] : selected['eye-left']
      const closedId = selected[side === 'right' ? 'eye-closed-right' : 'eye-closed-left']
      if (openId !== next.id || !closedId || side === 'right' && closedId === selected['eye-closed-left']) continue
      const closed = componentDetailsRef.current[closedId]
      if (!closed) continue
      const leftOpen = componentDetailsRef.current[selected['eye-left'] ?? '']
      const renderedOpen = side === 'right' && linked.eye && leftOpen ? { ...next, width: leftOpen.width } : next
      const fitted = fitClosedEyeToOpen(closed, renderedOpen, head, side === 'right')
      if (fitted.scaleX > 20) { setError('O olho fechado é estreito demais para acompanhar a largura do olho aberto.'); continue }
      if (closed.defaultTransform.x === fitted.x && closed.defaultTransform.y === fitted.y && closed.defaultTransform.scaleX === fitted.scaleX) continue
      persistComponentAsset({ ...closed, defaultTransform: fitted, updatedAt: new Date().toISOString() })
    }
  }

  async function editablePair(kind: FaceComponentKind): Promise<[FaceComponentAsset, FaceComponentAsset] | null> {
    if (!head) return null
    const category = categories.find((entry) => entry.kind === kind)!
    const leftId = selectedAssetsRef.current[category.parts[0]]
    const rightId = selectedAssetsRef.current[category.parts[1]]
    const left = leftId ? componentDetailsRef.current[leftId] : undefined
    if (!left) return null
    let right = rightId ? componentDetailsRef.current[rightId] : undefined
    if (!right || right.id === left.id) {
      const key = `${modelSlot}:${kind}:${left.id}`
      let pending = preparingPair.current.get(key)
      if (!pending) {
        pending = cloneComponentForSide(left, category.parts[1])
        preparingPair.current.set(key, pending)
      }
      try { right = await pending }
      catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return null }
      finally { preparingPair.current.delete(key) }
    }
    if (!right.rightSidePositioned) right = normalizeRightAsset(right)
    const leftCurrent = componentDetailsRef.current[left.id] ?? left
    const rightCurrent = componentDetailsRef.current[right.id] ?? right
    return [leftCurrent, rightCurrent]
  }

  async function movePair(kind: FaceComponentKind, axis: 'x' | 'y', target: number, relative = false) {
    if (!head) return
    const pair = await editablePair(kind === 'eye-closed' ? 'eye' : kind)
    if (!pair) return
    const [leftCurrent, rightCurrent] = pair
    const leftValue = leftCurrent.defaultTransform[axis]
    const rightValue = rightCurrent.defaultTransform[axis]
    const center = (leftValue + rightValue) / 2
    const limit = axis === 'x' ? head.width : head.height
    const minimum = kind === 'pupil' ? -limit * .25 : 0
    const maximum = kind === 'pupil' ? limit * .25 : limit
    const delta = clamp((relative ? center + target : target) - center, Math.max(minimum - leftValue, minimum - rightValue), Math.min(maximum - leftValue, maximum - rightValue))
    if (Math.abs(delta) < .001) return
    saveComponentTransform(leftCurrent, { [axis]: leftValue + delta })
    saveComponentTransform(rightCurrent, { [axis]: rightValue + delta })
  }

  async function setEyeSeparation(target: number) {
    if (!head) return
    const pair = await editablePair('eye')
    if (!pair) return
    const [left, right] = pair
    const center = clamp((left.defaultTransform.x + right.defaultTransform.x) / 2, 0, head.width)
    const max = 2 * Math.min(center, head.width - center)
    const separation = clamp(target, 0, max)
    saveComponentTransform(left, { x: center - separation / 2 })
    saveComponentTransform(right, { x: center + separation / 2 })
  }

  async function resizePair(kind: FaceComponentKind, axis: 'scaleX' | 'scaleY', targetPercent: number) {
    if (!head) return
    const scaledKind = kind === 'eye-closed' && axis === 'scaleX' ? 'eye' : kind
    const pair = await editablePair(scaledKind)
    if (!pair) return
    const dimension = axis === 'scaleX' ? 'width' : 'height'
    const headSize = head[dimension]
    const selection = selectedAssetsRef.current
    for (const [index, asset] of pair.entries()) {
      let sourceSize = index === 1 && linked[scaledKind] ? pair[0][dimension] : asset[dimension]
      if (scaledKind === 'pupil') {
        const side = index === 0 ? 'eye-left' : 'eye-right'
        const eye = componentDetailsRef.current[selection[side] ?? ''] ?? componentDetailsRef.current[selection['eye-left'] ?? '']
        const sourceEye = index === 1 && linked.eye ? componentDetailsRef.current[selection['eye-left'] ?? ''] ?? eye : eye
        sourceSize = sourceEye && eye ? sourceEye[dimension] * eye.defaultTransform[axis] : headSize * (axis === 'scaleX' ? .19 : .17)
      }
      const scale = clamp(targetPercent / 100 * headSize / sourceSize, .01, 20)
      saveComponentTransform(asset, { [axis]: scale })
    }
  }

  function updateCatalogVariant(index: number) {
    if (!selectedCatalogItem) return
    const original = catalogDetailsRef.current[selectedCatalogItem.id] ?? selectedCatalogItem
    const next = { ...original, [original.category === 'nose' ? 'selectedNose' : 'selectedExpression']: index, updatedAt: new Date().toISOString() }
    catalogDetailsRef.current = { ...catalogDetailsRef.current, [next.id]: next }
    if (next.category === 'nose') setNoseDetails((items) => ({ ...items, [next.id]: next }))
    else setMouthDetails((items) => ({ ...items, [next.id]: next }))
    queueSave(`catalog:${next.modelSlot}:${next.id}`, () => window.desktop.saveFaceCatalogItem(next.modelSlot, catalogSaveData(next), catalogImagesForSave(next)))
  }

  function updateCatalogOpacity(value: number) {
    if (selectedCatalogItem?.category !== 'nose') return
    const original = catalogDetailsRef.current[selectedCatalogItem.id] ?? selectedCatalogItem
    const next = { ...original, opacity: clamp(value, 0, 1), updatedAt: new Date().toISOString() }
    catalogDetailsRef.current = { ...catalogDetailsRef.current, [next.id]: next }
    setNoseDetails((items) => ({ ...items, [next.id]: next }))
    queueSave(`catalog:${next.modelSlot}:${next.id}`, () => window.desktop.saveFaceCatalogItem(next.modelSlot, catalogSaveData(next), catalogImagesForSave(next)))
  }

  function beginPreviewDrag(event: ReactPointerEvent<HTMLImageElement>, key: string, invertX = false, pupil = false) {
    if (event.button !== 0 || !event.isPrimary || !head || !selectedTransform || key !== activePreviewKey) return
    const canvas = event.currentTarget.closest('.face-components-preview-canvas')
    if (!canvas) return
    const bounds = canvas.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    previewDrag.current = {
      pointerId: event.pointerId, key, clientX: event.clientX, clientY: event.clientY,
      startX: selectedTransform.x, startY: selectedTransform.y,
      modelPerPixelX: head.width / bounds.width, modelPerPixelY: head.height / bounds.height,
      invertX, pupil
    }
    setDraggingPreview(true)
  }

  function movePreviewDrag(event: ReactPointerEvent<HTMLImageElement>) {
    const drag = previewDrag.current
    if (!drag || drag.pointerId !== event.pointerId || drag.key !== activePreviewKey || !head) return
    const xRange = drag.pupil ? head.width * .25 : head.width
    const yRange = drag.pupil ? head.height * .25 : head.height
    const x = drag.startX + (event.clientX - drag.clientX) * drag.modelPerPixelX * (drag.invertX ? -1 : 1)
    const y = drag.startY + (event.clientY - drag.clientY) * drag.modelPerPixelY
    updateTransform({ x: clamp(x, drag.pupil ? -xRange : 0, xRange), y: clamp(y, drag.pupil ? -yRange : 0, yRange) })
  }

  function endPreviewDrag(event: ReactPointerEvent<HTMLImageElement>) {
    if (previewDrag.current?.pointerId !== event.pointerId) return
    previewDrag.current = null
    setDraggingPreview(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  async function removeSelectedAssets() {
    if (markedForDeletion.length === 0) return
    setBusy(true)
    setError('')
    const removed: string[] = []
    try {
      for (const id of markedForDeletion) {
        const isCatalogItem = [...noseCatalog, ...mouthCatalog].some((item) => item.id === id)
        await flushSave(`${isCatalogItem ? 'catalog' : 'component'}:${modelSlot}:${id}`)
        if (isCatalogItem) await window.desktop.deleteFaceCatalogItem(modelSlot, id)
        else await window.desktop.deleteFaceComponentAsset(modelSlot, id)
        removed.push(id)
      }
      setNotice(`${removed.length} ${removed.length === 1 ? 'peça excluída' : 'peças excluídas'} da biblioteca.`)
      setOpenModal(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally {
      if (removed.length > 0) {
        const removedIds = new Set(removed)
        setAssets((current) => current.filter((item) => !removedIds.has(item.id)))
        setDetails((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !removedIds.has(id))))
        setSelectedAssets((current) => Object.fromEntries(Object.entries(current).filter(([, id]) => !removedIds.has(id))))
        setMouthCatalog((current) => current.filter((item) => !removedIds.has(item.id)))
        setMouthDetails((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !removedIds.has(id))))
        setSelectedMouthId((current) => current && removedIds.has(current) ? null : current)
        setNoseCatalog((current) => current.filter((item) => !removedIds.has(item.id)))
        setNoseDetails((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !removedIds.has(id))))
        setSelectedNoseId((current) => current && removedIds.has(current) ? null : current)
        setFaceDetailSelectionsByModel((current) => ({
          ...current,
          [modelSlot]: Object.fromEntries(Object.entries(current[modelSlot] ?? {}).filter(([, id]) => !removedIds.has(id))) as Partial<Record<FaceDetailKind, string>>
        }))
        setMarkedForDeletion((current) => current.filter((id) => !removedIds.has(id)))
      }
      setBusy(false)
    }
  }

  function renderPart(id: PartId, mirror: boolean, overrides: Partial<Record<PartId, string>>) {
    if (!head) return null
    const category = partCategory(id)
    const rightSide = id.endsWith('right')
    const leftId = overrides[category.parts[0]] ?? selectedAssets[category.parts[0]]
    const ownId = overrides[id] ?? selectedAssets[id]
    const assetId = ownId ?? (rightSide && mirror && linked[category.kind] ? leftId : undefined)
    const asset = assetId ? details[assetId] : undefined
    const leftAsset = leftId ? details[leftId] : undefined
    if (!asset) return null
    const imageAsset = rightSide && mirror && linked[category.kind] ? leftAsset ?? asset : asset
    const openEyeId = rightSide ? selectedAssets['eye-right'] ?? selectedAssets['eye-left'] : selectedAssets['eye-left']
    const openEye = category.kind === 'eye-closed' && openEyeId ? details[openEyeId] : undefined
    const leftOpen = details[selectedAssets['eye-left'] ?? '']
    const renderedOpenEye = openEye && rightSide && linked.eye && leftOpen
      ? { ...openEye, width: leftOpen.width } : openEye
    const transform = renderedOpenEye ? fitClosedEyeToOpen({ ...asset, width: imageAsset.width }, renderedOpenEye, head, rightSide) : asset.defaultTransform
    const physicalRight = rightSide && asset.rightSidePositioned === true
    const rightEyeId = selectedAssets['eye-right']
    const leftEyeId = selectedAssets['eye-left']
    const eyeAsset = category.kind === 'pupil' ? details[rightSide && rightEyeId ? rightEyeId : leftEyeId ?? ''] : undefined
    const eyeTransform = eyeAsset?.defaultTransform
    const pupilEyeImage = rightSide && linked.eye ? leftOpen ?? eyeAsset : eyeAsset
    const eyeWidth = eyeAsset && pupilEyeImage ? pupilEyeImage.width * eyeTransform!.scaleX : head.width * .19
    const eyeHeight = eyeAsset && pupilEyeImage ? pupilEyeImage.height * eyeTransform!.scaleY : head.height * .17
    let localX = transform.x
    let localY = transform.y
    if (category.kind === 'pupil') {
      const eyeX = eyeTransform?.x ?? head.width * .37
      localX = (rightSide && (!rightEyeId || !eyeAsset?.rightSidePositioned) ? head.width - eyeX : eyeX) + (rightSide && !physicalRight && linked.pupil ? -transform.x : transform.x)
      localY = (eyeTransform?.y ?? head.height * .46) + transform.y
    }
    const mirroredPosition = rightSide && !physicalRight && category.kind !== 'pupil'
    const x = mirroredPosition ? head.width - localX : localX
    const shouldFlip = rightSide && linked[category.kind]
      ? !Boolean(leftAsset?.defaultTransform.flipX)
      : Boolean(transform.flipX)
    const width = category.kind === 'pupil' ? eyeWidth * transform.scaleX : imageAsset.width * transform.scaleX
    const height = category.kind === 'pupil' ? eyeHeight * transform.scaleY : imageAsset.height * transform.scaleY
    const style: CSSProperties = { left: `${x / head.width * 100}%`, top: `${localY / head.height * 100}%`, width: `${width / head.width * 100}%`, height: `${height / head.height * 100}%`, transform: `translate(-50%,-50%) rotate(${transform.rotation * (mirroredPosition ? -1 : 1)}deg) scaleX(${shouldFlip ? -1 : 1})` }
    const dragKey = `${id}:${assetId}`
    const canDrag = dragKey === activePreviewKey && !openEye
    if (category.kind === 'pupil' && eyeAsset && eyeTransform) {
      const eyePartId = rightSide ? 'eye-right' : 'eye-left'
      const selectedEyeId = overrides[eyePartId] ?? selectedAssets[eyePartId] ?? (rightSide ? selectedAssets['eye-left'] : undefined)
      const sideEye = selectedEyeId ? details[selectedEyeId] : undefined
      const leftEye = leftEyeId ? details[leftEyeId] : undefined
      const maskImage = rightSide && linked.eye ? leftEye ?? sideEye : sideEye
      if (sideEye && maskImage) {
        const eyeTransform = sideEye.defaultTransform
        const eyePhysicalRight = rightSide && sideEye.rightSidePositioned === true
        const eyeMirrored = rightSide && !eyePhysicalRight
        const eyeX = eyeMirrored ? head.width - eyeTransform.x : eyeTransform.x
        const eyeRotation = eyeTransform.rotation * (eyeMirrored ? -1 : 1)
        const eyeFlip = rightSide && linked.eye ? !Boolean(leftEye?.defaultTransform.flipX) : Boolean(eyeTransform.flipX)
        const maskStyle: CSSProperties = {
          left: `${eyeX / head.width * 100}%`, top: `${eyeTransform.y / head.height * 100}%`,
          width: `${maskImage.width * eyeTransform.scaleX / head.width * 100}%`,
          height: `${maskImage.height * eyeTransform.scaleY / head.height * 100}%`,
          transform: `translate(-50%,-50%) rotate(${eyeRotation}deg) scaleX(${eyeFlip ? -1 : 1})`,
          maskImage: `url(${eyeMasks[maskImage.id] ?? maskImage.dataUrl})`, WebkitMaskImage: `url(${eyeMasks[maskImage.id] ?? maskImage.dataUrl})`
        }
        const pupilOffsetX = rightSide && !physicalRight && linked.pupil ? -transform.x : transform.x
        const eyeFlipDirection = eyeFlip ? -1 : 1
        const pupilRotation = transform.rotation * (rightSide && !physicalRight ? -1 : 1) * eyeFlipDirection
        const pupilFlip = shouldFlip !== eyeFlip
        const pupilStyle: CSSProperties = {
          left: `${50 + pupilOffsetX / (eyeFlipDirection * eyeTransform.scaleX * maskImage.width) * 100}%`,
          top: `${50 + transform.y / (eyeTransform.scaleY * maskImage.height) * 100}%`,
          width: `${transform.scaleX * 100}%`, height: `${transform.scaleY * 100}%`,
          transform: `translate(-50%,-50%) rotate(${pupilRotation}deg) scaleX(${pupilFlip ? -1 : 1})`
        }
        return <div key={`${id}-${assetId}`} className={`face-component-pupil-mask${canDrag ? ` face-component-pupil-mask-draggable${draggingPreview ? ' is-dragging' : ''}` : ''}`} style={maskStyle}>
          <img className="face-component-pupil-image" src={imageAsset.dataUrl} alt={category.names[rightSide ? 1 : 0]} style={pupilStyle} draggable={false} title={canDrag ? 'Arraste a pupila dentro do olho' : undefined} onPointerDown={canDrag ? (event) => beginPreviewDrag(event, dragKey, false, true) : undefined} onPointerMove={canDrag ? movePreviewDrag : undefined} onPointerUp={canDrag ? endPreviewDrag : undefined} onPointerCancel={canDrag ? endPreviewDrag : undefined} onLostPointerCapture={canDrag ? endPreviewDrag : undefined} />
        </div>
      }
    }
    return <img key={`${id}-${assetId}`} className={`face-component-layer${canDrag ? ` face-component-layer-draggable${draggingPreview ? ' is-dragging' : ''}` : ''}`} src={imageAsset.dataUrl} alt={category.names[rightSide ? 1 : 0]} style={style} draggable={false} title={canDrag ? 'Arraste para mover esta peça' : undefined} onPointerDown={canDrag ? (event) => beginPreviewDrag(event, dragKey, mirroredPosition || rightSide && !physicalRight && category.kind === 'pupil' && linked.pupil, category.kind === 'pupil') : undefined} onPointerMove={canDrag ? movePreviewDrag : undefined} onPointerUp={canDrag ? endPreviewDrag : undefined} onPointerCancel={canDrag ? endPreviewDrag : undefined} onLostPointerCapture={canDrag ? endPreviewDrag : undefined} />
  }

  const workspaceTitle = mode === 'eyes' ? 'Olhos Dev' : 'Rosto Dev'
  const workspaceAssetsCount = mode === 'eyes'
    ? assets.filter((asset) => categories.some((category) => category.kind === asset.kind)).length
    : noseCatalog.length + mouthCatalog.length + assets.filter((asset) => isFaceDetailKind(asset.kind as LibraryCategory)).length
  const libraryCategoryLabel = isFaceDetailKind(libraryCategory) ? faceDetailCategories.find((category) => category.kind === libraryCategory)?.label ?? ''
    : libraryCategory === 'mouth' ? 'Boca' : libraryCategory === 'nose' ? 'Nariz' : selectedCategory.label
  return <section className="fabricator-workspace face-components-workspace" aria-label={`Biblioteca de ${workspaceTitle}`}>
    <header className="face-components-toolbar"><label>Modelo<select value={modelSlot} disabled={busy} onChange={(event) => setModelSlot(Number(event.target.value))}>{models.map((entry, index) => entry && <option key={index + 1} value={index + 1}>Modelo {String(index + 1).padStart(2, '0')} · {entry.name}</option>)}</select></label><span>Selecione uma peça e arraste-a na prévia para mover</span></header>
    <div className="face-components-body">
      <aside className="face-components-library">
        <header><strong>Biblioteca</strong><small>{workspaceAssetsCount} assets</small></header>
        <div className="face-components-library-actions"><button type="button" onClick={() => setOpenModal('import')} disabled={!head || busy}><Icon name="plus" /> Importar</button><button type="button" onClick={() => { setMarkedForDeletion([]); setOpenModal('delete') }} disabled={busy}><Icon name="trash" /> Excluir</button></div>
        <nav className="face-components-library-tabs" aria-label="Categorias da biblioteca" role="tablist">
          {mode === 'eyes' ? categories.map((category) => <button key={category.kind} type="button" role="tab" aria-selected={libraryCategory === category.kind} className={libraryCategory === category.kind ? 'active' : ''} onClick={() => { setLibraryCategory(category.kind); setSelectedPart(category.parts[0]) }}>{category.label}</button>) : <>
            <button type="button" role="tab" aria-selected={libraryCategory === 'nose'} className={libraryCategory === 'nose' ? 'active' : ''} onClick={() => setLibraryCategory('nose')}>Nariz</button>
            <button type="button" role="tab" aria-selected={libraryCategory === 'mouth'} className={libraryCategory === 'mouth' ? 'active' : ''} onClick={() => setLibraryCategory('mouth')}>Boca</button>
            {faceDetailCategories.map((category) => <button key={category.kind} type="button" role="tab" aria-selected={libraryCategory === category.kind} className={libraryCategory === category.kind ? 'active' : ''} onClick={() => setLibraryCategory(category.kind)}>{category.label}</button>)}
          </>}
        </nav>
        <section className="face-components-library-category" role="tabpanel" aria-label={`Assets de ${libraryCategoryLabel}`}>
          <h3>{libraryCategoryLabel} <small>{libraryCategory === 'mouth' ? mouthCatalog.filter((item) => item.category === mouthKind).length : libraryCategory === 'nose' ? noseCatalog.length : libraryAssets.filter((asset) => asset.kind === libraryCategory).length}</small></h3>
          {libraryCategory === 'mouth' && <div className="face-components-mouth-variants"><button type="button" className={mouthKind === 'mouth-closed' ? 'active' : ''} onClick={() => { setMouthKind('mouth-closed'); setSelectedMouthId(mouthCatalog.find((item) => item.category === 'mouth-closed')?.id ?? null) }}>Fechadas</button><button type="button" className={mouthKind === 'mouth-open' ? 'active' : ''} onClick={() => { setMouthKind('mouth-open'); setSelectedMouthId(mouthCatalog.find((item) => item.category === 'mouth-open')?.id ?? null) }}>Abertas</button></div>}
          <div className="face-components-assets">
            {libraryCategory === 'mouth' ? mouthCatalog.filter((item) => item.category === mouthKind).map((item) => <button key={item.id} className={selectedMouthId === item.id ? 'active' : ''} onClick={() => setSelectedMouthId(item.id)} type="button"><img src={mouthDetails[item.id]?.pieces[0]?.dataUrl} alt="" /><span>{item.name}</span></button>) : libraryCategory === 'nose' ? noseCatalog.map((item) => <button key={item.id} className={selectedNoseId === item.id ? 'active' : ''} onClick={() => setSelectedNoseId(item.id)} type="button"><img src={noseDetails[item.id]?.pieces[0]?.dataUrl} alt="" /><span>{item.name}</span></button>) : libraryAssets.filter((asset) => asset.kind === libraryCategory).map((asset) => {
              const displayed = details[asset.id]
              const active = isFaceDetailKind(libraryCategory) ? selectedFaceDetails[libraryCategory] === asset.id : selectedId === asset.id || selectedPart.endsWith('right') && displayed && selectedAsset && sameLibraryPair(displayed, selectedAsset)
              return <button key={asset.id} className={active ? 'active' : ''} onClick={() => isFaceDetailKind(libraryCategory) ? selectFaceDetail(libraryCategory, asset.id) : void chooseLibraryAsset(asset)} disabled={busy} type="button"><img src={displayed?.dataUrl} alt="" /><span>{libraryBaseName(asset.name)}</span></button>
            })}
            {(libraryCategory === 'mouth' ? !mouthCatalog.some((item) => item.category === mouthKind) : libraryCategory === 'nose' ? noseCatalog.length === 0 : !libraryAssets.some((asset) => asset.kind === libraryCategory)) && <small>Nenhum asset salvo nesta categoria</small>}
          </div>
        </section>
      </aside>
      <main className="face-components-stage-column">
        <div className="face-components-stage" ref={stageRef} style={{ '--preview-background': previewBackground } as CSSProperties}>
          {head && previewScale > 0 && <div className="face-components-preview-canvas" style={{ width: head.width * previewScale, height: head.height * previewScale }}>
            <img className="face-components-head" src={head.dataUrl} alt="Cabeça do modelo" />
            {mode === 'eyes' && (libraryCategory === 'eye-closed'
              ? ['eye-closed-left','eye-closed-right','brow-left','brow-right']
              : ['eye-left','eye-right','pupil-left','pupil-right','brow-left','brow-right'] as PartId[]).map((id) => renderPart(id as PartId, true, selectedAssets))}
            {mode === 'face' && nosePiece && noseStyle && <img className={`face-component-layer${libraryCategory === 'nose' ? ` face-component-layer-draggable${draggingPreview ? ' is-dragging' : ''}` : ''}`} src={nosePiece.dataUrl} alt="Nariz selecionado" style={noseStyle} draggable={false} title={libraryCategory === 'nose' ? 'Arraste para mover esta peça' : undefined} onPointerDown={libraryCategory === 'nose' && selectedNose ? (event) => beginPreviewDrag(event, `nose:${selectedNose.id}`) : undefined} onPointerMove={libraryCategory === 'nose' ? movePreviewDrag : undefined} onPointerUp={libraryCategory === 'nose' ? endPreviewDrag : undefined} onPointerCancel={libraryCategory === 'nose' ? endPreviewDrag : undefined} onLostPointerCapture={libraryCategory === 'nose' ? endPreviewDrag : undefined} />}
            {mode === 'face' && mouthPiece && mouthStyle && <img className={`face-component-layer${libraryCategory === 'mouth' ? ` face-component-layer-draggable${draggingPreview ? ' is-dragging' : ''}` : ''}`} src={mouthPiece.dataUrl} alt="Boca selecionada" style={mouthStyle} draggable={false} title={libraryCategory === 'mouth' ? 'Arraste para mover esta peça' : undefined} onPointerDown={libraryCategory === 'mouth' && selectedMouth ? (event) => beginPreviewDrag(event, `${selectedMouth.category}:${selectedMouth.id}`) : undefined} onPointerMove={libraryCategory === 'mouth' ? movePreviewDrag : undefined} onPointerUp={libraryCategory === 'mouth' ? endPreviewDrag : undefined} onPointerCancel={libraryCategory === 'mouth' ? endPreviewDrag : undefined} onLostPointerCapture={libraryCategory === 'mouth' ? endPreviewDrag : undefined} />}
            {previewFaceDetailLayers.map(({ kind, asset, style }) => {
              const canDrag = libraryCategory === kind
              const dragKey = `${kind}:${asset.id}`
              return <img key={asset.id} className={`face-component-layer${canDrag ? ` face-component-layer-draggable${draggingPreview ? ' is-dragging' : ''}` : ''}`} src={asset.dataUrl} alt={faceDetailCategories.find((entry) => entry.kind === kind)?.label ?? kind} style={style} draggable={false} title={canDrag ? 'Arraste para mover esta peça' : undefined} onPointerDown={canDrag ? (event) => beginPreviewDrag(event, dragKey) : undefined} onPointerMove={canDrag ? movePreviewDrag : undefined} onPointerUp={canDrag ? endPreviewDrag : undefined} onPointerCancel={canDrag ? endPreviewDrag : undefined} onLostPointerCapture={canDrag ? endPreviewDrag : undefined} />
            })}
            {guide.visible && <FaceGuideOverlay head={head} guide={guide} />}
          </div>}
          {!head && <span>Selecione um modelo com cabeça.</span>}
        </div>
        <div className="face-components-stage-footer">{notice}</div>
      </main>
      <aside className="face-components-controls">
        <header><strong>Ajuste da peça</strong></header>
        {mode === 'eyes' && <section className="face-component-import-anchor" aria-label="Auto fixar importações de olhos">
          <strong>Auto fixar</strong>
          <button type="button" aria-pressed={autoFixEnabled} disabled={!head || (!autoFixEnabled && !autoFixReferencesReady) || busy} onClick={() => autoFixEnabled ? releaseImportAnchors() : fixImportAnchors()}>{autoFixEnabled ? 'Desativar auto fixar' : 'Ativar auto fixar'}</button>
        </section>}
        {componentPair && <div className="face-component-side-options" role="group" aria-label={`Selecionar lado de ${componentPair.label} para ajustar`}>
          {componentPair.parts.map((part, index) => {
            const asset = selectedAssets[part] ? details[selectedAssets[part]] : undefined
            const displayed = asset ?? (index === 1 ? leftPairAsset : undefined)
            return <button key={part} className={selectedPart === part ? 'active' : ''} type="button" aria-pressed={selectedPart === part} disabled={busy} onClick={() => void chooseComponentSide(part)}><span className="face-component-side-image">{displayed && <img src={displayed.dataUrl} alt="" />}</span><strong>{index === 0 ? 'Esquerda' : 'Direita'}</strong></button>
          })}
        </div>}
        {componentPair && <div className="face-component-link-options">
          <label className="face-component-link"><input type="checkbox" checked={linked[componentPair.kind]} onChange={(event) => {
            if (event.target.checked) { setLinked((current) => ({ ...current, [componentPair.kind]: true })); setSelectedPart(componentPair.parts[0]) }
            else void chooseComponentSide(componentPair.parts[1])
          }} /> Espelhar imagem da esquerda</label>
          <button className={`face-component-move-together${moveTogether[componentPair.kind] ? ' active' : ''}`} type="button" aria-pressed={moveTogether[componentPair.kind]} disabled={!movementLeftAsset || busy} onClick={() => setMoveTogether((current) => ({ ...current, [componentPair.kind]: !current[componentPair.kind] }))}>Mover junto</button>
        </div>}
        {libraryCategory === 'eyebrow' && selectedAsset && <button className="face-component-chroma-action" type="button" disabled={busy} onClick={() => void cleanSelectedEyebrow()}>Remover fundo verde da sobrancelha salva</button>}
        {componentPair && head && movementLeftAsset && moveTogether[componentPair.kind] && <section className="face-component-pair-controls" aria-label={`Posição e tamanho conjuntos de ${componentPair.label}`}>
          <strong>Posição e tamanho dos dois lados</strong>
          {componentPair.kind === 'eye' && <label className="face-component-slider"><span>Separação horizontal entre os olhos <output>{Math.round(eyeSeparation)} px</output></span><input type="range" min="0" max={Math.max(eyeSeparation, eyeSeparationMax)} step="1" value={eyeSeparation} onChange={(event) => void setEyeSeparation(Number(event.target.value))} /></label>}
          <div className="face-component-nudge-pad">
            <button type="button" aria-label="Subir os dois lados" onClick={() => void movePair(componentPair.kind, 'y', -1, true)}>↑</button>
            <button type="button" aria-label="Mover os dois lados para a esquerda" onClick={() => void movePair(componentPair.kind, 'x', -1, true)}>←</button>
            <button type="button" aria-label="Descer os dois lados" onClick={() => void movePair(componentPair.kind, 'y', 1, true)}>↓</button>
            <button type="button" aria-label="Mover os dois lados para a direita" onClick={() => void movePair(componentPair.kind, 'x', 1, true)}>→</button>
          </div>
          <label className="face-component-slider"><span>Horizontal <output>{Math.round(pairX)} px</output></span><input type="range" min={componentPair.kind === 'pupil' ? -head.width * .25 : 0} max={componentPair.kind === 'pupil' ? head.width * .25 : head.width} step="1" value={pairX} onChange={(event) => void movePair(componentPair.kind, 'x', Number(event.target.value))} /></label>
          <label className="face-component-slider"><span>Vertical <output>{Math.round(pairY)} px</output></span><input type="range" min={componentPair.kind === 'pupil' ? -head.height * .25 : 0} max={componentPair.kind === 'pupil' ? head.height * .25 : head.height} step="1" value={pairY} onChange={(event) => void movePair(componentPair.kind, 'y', Number(event.target.value))} /></label>
          <label className="face-component-slider"><span>Largura horizontal dos dois lados <output>{Math.round(pairWidthPercent)}%</output></span><input type="range" min="1" max={Math.max(400, Math.ceil(pairWidthPercent / 100) * 100 + 100)} step="1" value={pairWidthPercent} onChange={(event) => void resizePair(componentPair.kind, 'scaleX', Number(event.target.value))} /></label>
          {pairHeightAsset && <label className="face-component-slider"><span>Altura vertical dos dois lados <output>{Math.round(pairHeightPercent)}%</output></span><input type="range" min="1" max={Math.max(400, Math.ceil(pairHeightPercent / 100) * 100 + 100)} step="1" value={pairHeightPercent} onChange={(event) => void resizePair(componentPair.kind, 'scaleY', Number(event.target.value))} /></label>}
        </section>}
        {head && selectedTransform && (activeComponent || selectedCatalogItem || activeFaceDetail) ? <>
          {!componentPair && <div className="face-component-current"><img src={activeComponent?.dataUrl ?? activeFaceDetail?.dataUrl ?? selectedCatalogPiece?.dataUrl} alt="" /><span><strong>{activeComponent?.name ?? activeFaceDetail?.name ?? selectedCatalogItem?.name}</strong></span></div>}
          {selectedCatalogItem && <label className="face-component-variant">Variante<select value={selectedCatalogItem.category === 'nose' ? selectedCatalogItem.selectedNose : selectedCatalogItem.selectedExpression} onChange={(event) => updateCatalogVariant(Number(event.target.value))}>{selectedCatalogItem.pieces.map((piece) => <option key={piece.id} value={piece.index}>{selectedCatalogItem.category === 'nose' ? 'Nariz' : 'Expressão'} {String(piece.index + 1).padStart(2, '0')}</option>)}</select></label>}
          {componentPair && <strong className="face-component-individual-title">{moveTogether[componentPair.kind] ? 'Rotação individual' : followsOpenEye ? 'Altura e rotação' : 'Ajuste individual'} · {selectedPart.endsWith('right') ? 'direita' : 'esquerda'}</strong>}
          <FaceTransformControls head={head} transform={selectedTransform} sourceWidth={selectedSourceWidth} sourceHeight={selectedSourceHeight} pupil={activeComponent?.kind === 'pupil'} moveTogether={componentPair ? moveTogether[componentPair.kind] : false} followEyes={followsOpenEye} opacity={selectedCatalogItem?.category === 'nose' ? selectedCatalogItem.opacity ?? 1 : undefined} onChange={updateTransform} onOpacityChange={updateCatalogOpacity} onReset={resetSelectedTransform} />
        </> : <div className="face-component-empty">Nenhuma peça selecionada</div>}
        <section className="face-components-guide-controls" aria-label="Guias de alinhamento do rosto">
          <header><strong>Guias de desenho</strong><label><input type="checkbox" checked={guide.visible} disabled={guidesLoadedFor !== guideProfile} onChange={(event) => updateGuide({ visible: event.target.checked })} /> Mostrar</label></header>
          <label>Inclinação do eixo <output>{guide.angle}°</output><input type="range" min="-30" max="30" step="1" value={guide.angle} disabled={!guide.visible || guidesLoadedFor !== guideProfile} onChange={(event) => updateGuide({ angle: Number(event.target.value) })} /></label>
          <label>Posição do eixo <output>{guide.verticalX}%</output><input type="range" min="20" max="80" step="1" value={guide.verticalX} disabled={!guide.visible || guidesLoadedFor !== guideProfile} onChange={(event) => updateGuide({ verticalX: Number(event.target.value) })} /></label>
          <label>Altura da linha superior <output>{guide.horizontalY}%</output><input type="range" min="10" max={Math.min(90, guide.lowerHorizontalY - 1)} step="1" value={guide.horizontalY} disabled={!guide.visible || guidesLoadedFor !== guideProfile} onChange={(event) => updateGuide({ horizontalY: Number(event.target.value) })} /></label>
          <label>Altura da linha inferior <output>{guide.lowerHorizontalY}%</output><input type="range" min={guide.horizontalY + 1} max="99" step="1" value={guide.lowerHorizontalY} disabled={!guide.visible || guidesLoadedFor !== guideProfile} onChange={(event) => updateGuide({ lowerHorizontalY: Number(event.target.value) })} /></label>
          <button type="button" disabled={guidesLoadedFor !== guideProfile} onClick={() => updateGuide(defaultGuide)}>Restaurar guias</button>
        </section>
      </aside>
    </div>{error && <div className={`face-components-error${openModal ? ' face-components-error-modal' : ''}`} role="alert">{error}</div>}
    {openModal && <div className="face-components-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setOpenModal(null) }}>
      <div className="face-components-modal" role="dialog" aria-modal="true" aria-labelledby="face-components-modal-title">
        <header><div><strong id="face-components-modal-title">{openModal === 'import' ? 'Importar peças do rosto' : 'Excluir peças do rosto'}</strong><small>{openModal === 'import' ? 'Escolha a categoria e o formato de importação.' : 'Escolha as peças já importadas que deseja remover.'}</small></div><button type="button" aria-label="Fechar" disabled={busy} onClick={() => setOpenModal(null)}>×</button></header>
        {openModal === 'import' ? <div className="face-components-import-options">
          {mode === 'eyes' ? <label className="face-components-import-option"><span className="face-components-import-sheet"><span>3 peças</span></span><strong>Olho + pupila + olho fechado</strong><small>Folha vertical com as três peças, mesmo que as alturas variem.</small><span className="face-components-import-action"><Icon name="plus" /> Escolher imagem</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !head} onChange={(event) => void importEyeSheet(event)} /></label> : <>
            <label className="face-components-import-option"><span className="face-components-import-sheet"><span>1 peça</span></span><strong>Nariz único</strong><small>Uma imagem com um nariz.</small><span className="face-components-import-action"><Icon name="plus" /> Escolher folha</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !head} onChange={(event) => void importCatalogSheet('nose', event, 'one')} /></label>
            <label className="face-components-import-option"><span className="face-components-import-sheet"><span>3 × 2</span></span><strong>Seis narizes</strong><small>Folha com seis variações de nariz.</small><span className="face-components-import-action"><Icon name="plus" /> Escolher folha</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !head} onChange={(event) => void importCatalogSheet('nose', event, 'six')} /></label>
            <label className="face-components-import-option"><span className="face-components-import-sheet"><span>7 × 3</span></span><strong>Bocas fechadas</strong><small>Folha com 21 expressões fechadas.</small><span className="face-components-import-action"><Icon name="plus" /> Escolher folha</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !head} onChange={(event) => void importCatalogSheet('mouth-closed', event)} /></label>
            <label className="face-components-import-option"><span className="face-components-import-sheet"><span>7 × 3</span></span><strong>Bocas abertas</strong><small>Folha com 21 expressões abertas.</small><span className="face-components-import-action"><Icon name="plus" /> Escolher folha</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !head} onChange={(event) => void importCatalogSheet('mouth-open', event)} /></label>
            {faceDetailCategories.map((category) => <label key={category.kind} className="face-components-import-option"><span className="face-components-import-sheet"><span>1 peça</span></span><strong>{category.label}</strong><small>Uma imagem PNG para este detalhe facial.</small><span className="face-components-import-action"><Icon name="plus" /> Escolher imagem</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !head} onChange={(event) => void importFaceDetail(category.kind, event)} /></label>)}
          </>}
        </div> : <><div className="face-components-delete-list">
          {mode === 'eyes' ? categories.map((category) => <section key={category.kind}><h3>{category.label}</h3>{libraryAssets.filter((asset) => asset.kind === category.kind).map((asset) => {
            const left = details[asset.id]
            const groupIds = [asset.id, ...assets.filter((candidate) => {
              const right = details[candidate.id]
              return left && right && candidate.id !== asset.id && sameLibraryPair(left, right)
            }).map((candidate) => candidate.id)]
            return <label key={asset.id} className="face-components-delete-item"><input type="checkbox" checked={groupIds.every((id) => markedForDeletion.includes(id))} disabled={busy} onChange={(event) => setMarkedForDeletion((current) => event.target.checked ? [...new Set([...current, ...groupIds])] : current.filter((id) => !groupIds.includes(id)))} /><img src={left?.dataUrl} alt="" /><span>{libraryBaseName(asset.name)}</span></label>
          })}{!libraryAssets.some((asset) => asset.kind === category.kind) && <small>Nenhuma peça importada</small>}</section>) : <>
          {faceDetailCategories.map((category) => <section key={category.kind}><h3>{category.label}</h3>{libraryAssets.filter((asset) => asset.kind === category.kind).map((asset) => <label key={asset.id} className="face-components-delete-item"><input type="checkbox" checked={markedForDeletion.includes(asset.id)} disabled={busy} onChange={(event) => setMarkedForDeletion((current) => event.target.checked ? [...current, asset.id] : current.filter((id) => id !== asset.id))} /><img src={details[asset.id]?.dataUrl} alt="" /><span>{asset.name}</span></label>)}{!libraryAssets.some((asset) => asset.kind === category.kind) && <small>Nenhuma peça importada</small>}</section>)}
          <section><h3>Nariz</h3>{noseCatalog.map((item) => <label key={item.id} className="face-components-delete-item"><input type="checkbox" checked={markedForDeletion.includes(item.id)} disabled={busy || item.id.startsWith('legacy_')} onChange={(event) => setMarkedForDeletion((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /><img src={noseDetails[item.id]?.pieces[0]?.dataUrl} alt="" /><span>{item.name}{item.id.startsWith('legacy_') ? ' · legado' : ''}</span></label>)}{noseCatalog.length === 0 && <small>Nenhuma peça importada</small>}</section>
          <section><h3>Boca</h3>{mouthCatalog.map((item) => <label key={item.id} className="face-components-delete-item"><input type="checkbox" checked={markedForDeletion.includes(item.id)} disabled={busy || item.id.startsWith('legacy_')} onChange={(event) => setMarkedForDeletion((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /><img src={mouthDetails[item.id]?.pieces[0]?.dataUrl} alt="" /><span>{item.name}{item.id.startsWith('legacy_') ? ' · legado' : ''}</span></label>)}{mouthCatalog.length === 0 && <small>Nenhuma peça importada</small>}</section>
          </>}
        </div><footer><span>{markedGroupCount} {markedGroupCount === 1 ? 'peça selecionada' : 'peças selecionadas'}</span><button type="button" className="face-components-delete-confirm" disabled={busy || markedForDeletion.length === 0} onClick={() => void removeSelectedAssets()}>Excluir selecionadas</button></footer></>}
      </div>
    </div>}
  </section>
}
