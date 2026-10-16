import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { FaceCatalogItem, FaceCatalogItemSave, FaceCatalogItemSummary, FaceComponentAsset, FaceComponentAssetSave, FaceComponentAssetSummary, FaceComponentKind, FaceTransform, FabricatorProject, FabricatorSlotSummary, ModelPart } from '../../../../../shared/fabricator'
import { Icon } from '../../../ui/components/Icon'
import { usePreviewBackground } from '../usePreviewBackground'
import { processFaceSheet } from './processFaceSheet'
import { splitEyeSheet } from './splitEyeSheet'
import { alignImportedFacePiece, captureFaceImportAnchor, fitClosedEyeToOpen, validFaceImportAnchor, type AlignableFaceKind, type FaceImportAnchor } from './faceImportAlignment'
import { removeEyebrowGreen } from './removeEyebrowGreen'
import './face-components.css'

type PartId = 'eye-left' | 'eye-right' | 'pupil-left' | 'pupil-right' | 'eye-closed-left' | 'eye-closed-right' | 'brow-left' | 'brow-right'
type CatalogKind = 'nose' | 'mouth-closed' | 'mouth-open'
type LibraryCategory = FaceComponentKind | 'nose' | 'mouth'
type FaceGuide = { visible: boolean; verticalX: number; horizontalY: number; lowerHorizontalY: number; angle: number }
type PreviewDrag = { pointerId: number; key: string; clientX: number; clientY: number; startX: number; startY: number; modelPerPixelX: number; modelPerPixelY: number; invertX: boolean; pupil: boolean }
const GUIDE_STORAGE_KEY = 'gacha-nymi:face-dev-guides'
const COMPONENT_SELECTION_STORAGE_KEY = 'gacha-nymi:face-dev-component-selections'
const LEGACY_PUPIL_SELECTION_STORAGE_KEY = 'gacha-nymi:face-dev-pupil-selections'
const FACE_IMPORT_ANCHORS_STORAGE_KEY = 'gacha-nymi:face-dev-import-anchors'
const defaultGuide: FaceGuide = { visible: true, verticalX: 50, horizontalY: 45, lowerHorizontalY: 65, angle: 12 }
const categories: Array<{ kind: FaceComponentKind; label: string; parts: [PartId, PartId]; names: [string, string] }> = [
  { kind: 'eye', label: 'Olhos', parts: ['eye-left', 'eye-right'], names: ['Olho esquerdo', 'Olho direito'] },
  { kind: 'pupil', label: 'Pupilas', parts: ['pupil-left', 'pupil-right'], names: ['Pupila esquerda', 'Pupila direita'] },
  { kind: 'eye-closed', label: 'Olhos fechados', parts: ['eye-closed-left', 'eye-closed-right'], names: ['Olho fechado esquerdo', 'Olho fechado direito'] },
  { kind: 'eyebrow', label: 'Sobrancelhas', parts: ['brow-left', 'brow-right'], names: ['Sobrancelha esquerda', 'Sobrancelha direita'] }
]
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
function readFaceGuides(): Record<number, FaceGuide> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(GUIDE_STORAGE_KEY) ?? '{}') as Record<string, Partial<FaceGuide>>
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
    return Object.fromEntries(Object.entries(stored).filter(([slot, value]) => /^\d+$/.test(slot) && value && typeof value === 'object').map(([slot, value]) => {
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
function readFaceImportAnchors(): FaceImportAnchors {
  try {
    const stored = JSON.parse(window.localStorage.getItem(FACE_IMPORT_ANCHORS_STORAGE_KEY) ?? '{}') as Record<string, Record<string, unknown>>
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
    return Object.fromEntries(Object.entries(stored).filter(([slot, value]) => /^\d+$/.test(slot) && value && typeof value === 'object').map(([slot, value]) => [Number(slot), Object.fromEntries(
      (['eye', 'pupil', 'eye-closed'] as const).filter((kind) => validFaceImportAnchor(value[kind])).map((kind) => [kind, value[kind]])
    )])) as FaceImportAnchors
  } catch { return {} }
}
const readImage = async (file: File): Promise<{ dataUrl: string; width: number; height: number }> => {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width; canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Não foi possível abrir a imagem.')
  context.drawImage(bitmap, 0, 0); bitmap.close()
  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
}
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

function FaceTransformControls({ head, transform, sourceWidth, sourceHeight, pupil, moveTogether, followEyes, onChange, onReset }: {
  head: ModelPart; transform: FaceTransform; sourceWidth: number; sourceHeight: number; pupil: boolean
  moveTogether?: boolean; followEyes?: boolean
  onChange: (patch: Partial<FaceTransform>) => void; onReset: () => void
}) {
  const xRange = pupil ? head.width * .25 : head.width
  const yRange = pupil ? head.height * .25 : head.height
  const widthPercent = sourceWidth * transform.scaleX / head.width * 100
  const heightPercent = sourceHeight * transform.scaleY / head.height * 100
  const sizeControl = (label: string, value: number, sourceSize: number, headSize: number, field: 'scaleX' | 'scaleY') => <label className="face-component-slider" key={field}>
    <span>{label}<output>{Math.round(value)}%</output></span>
    <input type="range" min="1" max={Math.max(120, Math.ceil(value / 10) * 10)} step="1" value={value} onChange={(event) => onChange({ [field]: clamp(Number(event.target.value) / 100 * headSize / sourceSize, .01, 20) })} />
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
    {!followEyes && sizeControl('Largura', widthPercent, sourceWidth, head.width, 'scaleX')}
    {sizeControl('Altura', heightPercent, sourceHeight, head.height, 'scaleY')}
    <label className="face-component-slider"><span>Rotação<output>{Math.round(transform.rotation)}°</output></span><input type="range" min="-180" max="180" step="1" value={transform.rotation} onChange={(event) => onChange({ rotation: Number(event.target.value) })} /></label>
    <button className="face-component-reset-transform" type="button" onClick={onReset}>{followEyes ? 'Restaurar altura e rotação' : 'Restaurar encaixe da peça'}</button>
  </div>
}

export function FaceComponentsWorkspace() {
  const [previewBackground] = usePreviewBackground()
  const [models, setModels] = useState<FabricatorSlotSummary[]>([])
  const [modelSlot, setModelSlot] = useState(1)
  const [guidesByModel, setGuidesByModel] = useState<Record<number, FaceGuide>>(readFaceGuides)
  const [importAnchorsByModel, setImportAnchorsByModel] = useState<FaceImportAnchors>(readFaceImportAnchors)
  const [model, setModel] = useState<FabricatorProject | null>(null)
  const [assets, setAssets] = useState<FaceComponentAssetSummary[]>([])
  const [details, setDetails] = useState<Record<string, FaceComponentAsset>>({})
  const [selectedPart, setSelectedPart] = useState<PartId>('eye-left')
  const [libraryCategory, setLibraryCategory] = useState<LibraryCategory>('eye')
  const [selectedAssets, setSelectedAssets] = useState<Partial<Record<PartId, string>>>({})
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
  const [notice, setNotice] = useState('Importe assets PNG transparentes; o formato de folha pode ser definido depois.')
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
  const markedGroupCount = libraryAssets.filter((asset) => markedForDeletion.includes(asset.id)).length
    + noseCatalog.filter((item) => markedForDeletion.includes(item.id)).length
    + mouthCatalog.filter((item) => markedForDeletion.includes(item.id)).length
  const selectedId = selectedAssets[selectedPart] ?? (linked[selectedCategory.kind] && selectedPart.endsWith('right') ? selectedAssets[selectedCategory.parts[0]] : undefined)
  const selectedAsset = selectedId ? details[selectedId] : undefined
  const componentPair = categories.find((category) => category.kind === libraryCategory)
  const alignableKind = libraryCategory === 'eye' || libraryCategory === 'pupil' || libraryCategory === 'eye-closed' ? libraryCategory : null
  const currentImportAnchor = alignableKind ? importAnchorsByModel[modelSlot]?.[alignableKind] : undefined
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
  const pairY = movementLeftAsset ? (movementLeftAsset.defaultTransform.y + (movementRightAsset && movementRightAsset.id !== movementLeftAsset.id ? movementRightAsset.defaultTransform.y : movementLeftAsset.defaultTransform.y)) / 2 : 0
  const selectedMouth = selectedMouthId && mouthDetails[selectedMouthId]?.category === mouthKind ? mouthDetails[selectedMouthId] : undefined
  const selectedNose = selectedNoseId ? noseDetails[selectedNoseId] : undefined
  const selectedCatalogItem = libraryCategory === 'nose' ? selectedNose : libraryCategory === 'mouth' ? selectedMouth : undefined
  const selectedCatalogPiece = selectedCatalogItem?.pieces.find((piece) => piece.index === (selectedCatalogItem.category === 'nose' ? selectedCatalogItem.selectedNose : selectedCatalogItem.selectedExpression)) ?? selectedCatalogItem?.pieces[0]
  const activeComponent = libraryCategory === 'nose' || libraryCategory === 'mouth' ? undefined : selectedAsset
  const eyeAssetId = selectedPart.endsWith('right') ? selectedAssets['eye-right'] ?? selectedAssets['eye-left'] : selectedAssets['eye-left']
  const eyeAsset = eyeAssetId ? details[eyeAssetId] : undefined
  const leftOpenEyeAsset = details[selectedAssets['eye-left'] ?? '']
  const selectedOpenEye = eyeAsset && selectedPart.endsWith('right') && linked.eye && leftOpenEyeAsset
    ? { ...eyeAsset, width: leftOpenEyeAsset.width } : eyeAsset
  const followsOpenEye = selectedAsset?.kind === 'eye-closed' && Boolean(eyeAsset && head)
  const selectedTransform = selectedCatalogItem ? selectedCatalogItem.transforms[selectedCatalogItem.category === 'nose' ? 'nose' : 'mouth']
    : selectedAsset && followsOpenEye && selectedOpenEye && head ? fitClosedEyeToOpen(selectedAsset, selectedOpenEye, head, selectedPart.endsWith('right')) : selectedAsset?.defaultTransform
  const activePreviewKey = selectedCatalogItem ? `${selectedCatalogItem.category}:${selectedCatalogItem.id}` : activeComponent ? `${selectedPart}:${activeComponent.id}` : null
  const selectedSourceWidth = selectedCatalogPiece?.width ?? (selectedAsset?.kind === 'pupil' ? eyeAsset ? eyeAsset.width * eyeAsset.defaultTransform.scaleX : head?.width ? head.width * .19 : 1 : selectedAsset?.width ?? 1)
  const selectedSourceHeight = selectedCatalogPiece?.height ?? (selectedAsset?.kind === 'pupil' ? eyeAsset ? eyeAsset.height * eyeAsset.defaultTransform.scaleY : head?.height ? head.height * .17 : 1 : selectedAsset?.height ?? 1)
  const mouthPiece = selectedMouth?.pieces.find((piece) => piece.index === selectedMouth.selectedExpression) ?? selectedMouth?.pieces[0]
  const mouthTransform = selectedMouth?.transforms.mouth
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
    transform: `translate(-50%,-50%) rotate(${noseTransform.rotation}deg)`
  } : undefined
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
      void next.catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
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
  useEffect(() => { try { window.localStorage.setItem(GUIDE_STORAGE_KEY, JSON.stringify(guidesByModel)) } catch { /* Keep guides available during this session. */ } }, [guidesByModel])
  useEffect(() => { try { window.localStorage.setItem(FACE_IMPORT_ANCHORS_STORAGE_KEY, JSON.stringify(importAnchorsByModel)) } catch { setError('Não foi possível salvar a fixação de importação neste computador.') } }, [importAnchorsByModel])
  useEffect(() => {
    if (hydratedComponentSlot.current !== modelSlot) return
    try {
      const stored = readComponentSelections()
      stored[modelSlot] = { parts: selectedAssets, linked, moveTogether }
      window.localStorage.setItem(COMPONENT_SELECTION_STORAGE_KEY, JSON.stringify(stored))
    } catch { /* The saved assets remain available in the library. */ }
  }, [modelSlot, selectedAssets, linked, moveTogether])
  function updateGuide(patch: Partial<FaceGuide>) {
    setGuidesByModel((current) => ({ ...current, [modelSlot]: { ...(current[modelSlot] ?? defaultGuide), ...patch } }))
  }
  function fixImportAnchor(kind: AlignableFaceKind) {
    if (!head) return
    const category = categories.find((entry) => entry.kind === kind)!
    const left = details[selectedAssets[category.parts[0]] ?? '']
    const right = details[selectedAssets[category.parts[1]] ?? '']
    if (!left) return
    const anchor = captureFaceImportAnchor(left, right, head)
    setImportAnchorsByModel((current) => ({ ...current, [modelSlot]: { ...current[modelSlot], [kind]: anchor } }))
    setNotice(`Posição e tamanho de ${category.label.toLowerCase()} fixados para as próximas importações deste modelo.`)
  }
  function releaseImportAnchor(kind: AlignableFaceKind) {
    setImportAnchorsByModel((current) => {
      const nextForModel = { ...current[modelSlot] }
      delete nextForModel[kind]
      return { ...current, [modelSlot]: nextForModel }
    })
    setNotice('Fixação removida. Os assets já salvos mantêm seus ajustes.')
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
    void Promise.all([window.desktop.loadFabricatorSlot(modelSlot), window.desktop.listFaceComponentAssets(modelSlot)]).then(async ([project, list]) => {
      const loaded = await Promise.all(list.map((entry) => window.desktop.loadFaceComponentAsset(modelSlot, entry.id)))
      if (!active) return
      const loadedAssets = loaded.filter((item): item is FaceComponentAsset => Boolean(item))
      const assetKinds = new Map(loadedAssets.map((item) => [item.id, item.kind]))
      const savedSelection = readComponentSelections()[modelSlot]
      const savedParts = Object.fromEntries(Object.entries(savedSelection?.parts ?? {}).filter(([part, id]) =>
        categories.some((category) => category.parts.includes(part as PartId) && assetKinds.get(id) === category.kind))) as Partial<Record<PartId, string>>
      setModel(project); setAssets(list); setDetails(Object.fromEntries(loadedAssets.map((item) => [item.id, item])))
      setSelectedAssets(savedParts)
      setLinked({ eye: true, pupil: true, 'eye-closed': true, eyebrow: true, ...savedSelection?.linked })
      setMoveTogether({ eye: false, pupil: false, 'eye-closed': false, eyebrow: false, ...savedSelection?.moveTogether })
      hydratedComponentSlot.current = modelSlot
    }).catch((reason) => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [modelSlot])
  useEffect(() => {
    let active = true
    setMouthCatalog([]); setMouthDetails({}); setNoseCatalog([]); setNoseDetails({})
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
  }, [modelSlot])

  async function importAsset(kind: FaceComponentKind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file || !head) return
    setBusy(true); setError('')
    const savedIds: string[] = []
    try {
      const eyebrowImage = kind === 'eyebrow' ? await removeEyebrowGreen(file, true) : null
      const image = eyebrowImage ?? await readImage(file)
      const category = categories.find((item) => item.kind === kind)!
      const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 90) || category.label
      const baseTransform = initialTransform(kind, head, image.width, image.height)
      const imported: FaceComponentAsset[] = []
      const assigned: Partial<Record<PartId, string>> = {}
      const pairId = crypto.randomUUID()
      for (const [index, side] of category.parts.entries()) {
        const defaultTransform: FaceTransform = index === 0 ? baseTransform : { ...baseTransform, x: kind === 'pupil' ? -baseTransform.x : head.width - baseTransform.x, rotation: -baseTransform.rotation, flipX: true }
        const anchor = kind === 'eye' || kind === 'pupil' || kind === 'eye-closed' ? importAnchorsByModel[modelSlot]?.[kind] : undefined
        const transform = anchor ? alignImportedFacePiece(kind as AlignableFaceKind, index === 0 ? 'left' : 'right', image.width, image.height, anchor) : defaultTransform
        const asset: FaceComponentAssetSave = { schemaVersion: 1, id: crypto.randomUUID(), modelSlot, kind, name: `${baseName} · ${category.names[index]}`.slice(0, 120), width: image.width, height: image.height, defaultTransform: transform, rightSidePositioned: index === 1, pairId, updatedAt: new Date().toISOString() }
        await window.desktop.saveFaceComponentAsset(modelSlot, asset, image.dataUrl)
        savedIds.push(asset.id)
        assigned[side] = asset.id
        imported.push({ ...asset, dataUrl: image.dataUrl })
      }
      setDetails((current) => ({ ...current, ...Object.fromEntries(imported.map((asset) => [asset.id, asset])) }))
      setAssets((current) => [...imported, ...current]); setSelectedPart(category.parts[0]); setLibraryCategory(kind); setSelectedAssets((current) => ({ ...current, ...assigned }))
      setNotice(eyebrowImage && eyebrowImage.removedPixels > 0 ? `${baseName} salvo com o fundo verde removido.` : `${baseName} salvo para os dois lados. Ajuste cada lado ou use o controle conjunto.`)
    } catch (reason) {
      await Promise.allSettled(savedIds.map((id) => window.desktop.deleteFaceComponentAsset(modelSlot, id)))
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setBusy(false) }
  }

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
      const pieces = await splitEyeSheet(file)
      const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 90) || 'Olhos'
      const imported: FaceComponentAsset[] = []
      const assigned: Partial<Record<PartId, string>> = {}
      for (const piece of pieces) {
        const category = categories.find((entry) => entry.kind === piece.kind)!
        const pairId = crypto.randomUUID()
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
            defaultTransform: transform, rightSidePositioned: index === 1, pairId, updatedAt: new Date().toISOString()
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
    const otherSide = selectedPart === category.parts[0] ? category.parts[1] : category.parts[0]
    const chosen = details[asset.id]
    const companion = chosen && selectedPart.endsWith('right') ? assets.map((item) => details[item.id]).find((item) => item && sameLibraryPair(chosen, item)) : undefined
    if (companion) {
      setSelectedAssets((current) => ({ ...current, [selectedPart]: companion.id }))
      setLinked((current) => ({ ...current, [category.kind]: false }))
      return
    }
    const needsCopy = chosen && (selectedAssets[otherSide] === asset.id || selectedPart.endsWith('right') !== Boolean(chosen.rightSidePositioned))
    if (needsCopy) {
      setBusy(true); setError('')
      try { await cloneComponentForSide(chosen, selectedPart) }
      catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return }
      finally { setBusy(false) }
    } else setSelectedAssets((current) => ({ ...current, [selectedPart]: asset.id }))
    if (selectedPart.endsWith('right')) setLinked((current) => ({ ...current, [category.kind]: false }))
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
    if (libraryCategory === 'nose' || libraryCategory === 'mouth') {
      if (!selectedCatalogItem) return
      const original = catalogDetailsRef.current[selectedCatalogItem.id] ?? selectedCatalogItem
      const element = original.category === 'nose' ? 'nose' : 'mouth'
      const current = original.transforms[element]
      if (!current) return
      const next: FaceCatalogItem = { ...original, transforms: { ...original.transforms, [element]: { ...current, ...patch } }, updatedAt: new Date().toISOString() }
      catalogDetailsRef.current = { ...catalogDetailsRef.current, [next.id]: next }
      if (element === 'nose') setNoseDetails((items) => ({ ...items, [next.id]: next }))
      else setMouthDetails((items) => ({ ...items, [next.id]: next }))
      queueSave(`catalog:${next.modelSlot}:${next.id}`, () => window.desktop.saveFaceCatalogItem(next.modelSlot, catalogSaveData(next), catalogImagesForSave(next)))
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
      const individualPatch: Partial<FaceTransform> = {}
      if (patch.scaleX !== undefined) individualPatch.scaleX = patch.scaleX
      if (patch.scaleY !== undefined) individualPatch.scaleY = patch.scaleY
      if (patch.rotation !== undefined) individualPatch.rotation = patch.rotation
      if (patch.flipX !== undefined) individualPatch.flipX = patch.flipX
      if (Object.keys(individualPatch).length > 0) saveComponentTransform(selectedAsset, individualPatch)
      return
    }
    saveComponentTransform(selectedAsset, patch)
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

  async function movePair(kind: FaceComponentKind, axis: 'x' | 'y', target: number) {
    if (!head) return
    const movingKind = kind === 'eye-closed' ? 'eye' : kind
    const category = categories.find((entry) => entry.kind === movingKind)!
    const leftId = selectedAssetsRef.current[category.parts[0]]
    const rightId = selectedAssetsRef.current[category.parts[1]]
    const left = leftId ? componentDetailsRef.current[leftId] : undefined
    if (!left) return
    let right = rightId ? componentDetailsRef.current[rightId] : undefined
    if (!right || right.id === left.id) {
      const key = `${modelSlot}:${movingKind}:${left.id}`
      let pending = preparingPair.current.get(key)
      if (!pending) {
        pending = cloneComponentForSide(left, category.parts[1])
        preparingPair.current.set(key, pending)
      }
      try { right = await pending }
      catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return }
      finally { preparingPair.current.delete(key) }
    }
    if (!right.rightSidePositioned) right = normalizeRightAsset(right)
    const leftCurrent = componentDetailsRef.current[left.id] ?? left
    const rightCurrent = componentDetailsRef.current[right.id] ?? right
    const leftValue = leftCurrent.defaultTransform[axis]
    const rightValue = rightCurrent.defaultTransform[axis]
    const center = (leftValue + rightValue) / 2
    const limit = axis === 'x' ? head.width : head.height
    const minimum = movingKind === 'pupil' ? -limit * .25 : 0
    const maximum = movingKind === 'pupil' ? limit * .25 : limit
    const delta = clamp(target - center, Math.max(minimum - leftValue, minimum - rightValue), Math.min(maximum - leftValue, maximum - rightValue))
    if (Math.abs(delta) < .001) return
    saveComponentTransform(leftCurrent, { [axis]: leftValue + delta })
    saveComponentTransform(rightCurrent, { [axis]: rightValue + delta })
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

  function beginPreviewDrag(event: ReactPointerEvent<HTMLImageElement>, key: string, invertX = false, pupil = false) {
    if (event.button !== 0 || !event.isPrimary || !head || !selectedTransform || key !== activePreviewKey) return
    const canvas = event.currentTarget.parentElement
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
    const eyeWidth = eyeAsset ? eyeAsset.width * eyeTransform!.scaleX : head.width * .19
    const eyeHeight = eyeAsset ? eyeAsset.height * eyeTransform!.scaleY : head.height * .17
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
    return <img key={`${id}-${assetId}`} className={`face-component-layer${canDrag ? ` face-component-layer-draggable${draggingPreview ? ' is-dragging' : ''}` : ''}`} src={imageAsset.dataUrl} alt={category.names[rightSide ? 1 : 0]} style={style} draggable={false} title={canDrag ? 'Arraste para mover esta peça' : undefined} onPointerDown={canDrag ? (event) => beginPreviewDrag(event, dragKey, mirroredPosition || rightSide && !physicalRight && category.kind === 'pupil' && linked.pupil, category.kind === 'pupil') : undefined} onPointerMove={canDrag ? movePreviewDrag : undefined} onPointerUp={canDrag ? endPreviewDrag : undefined} onPointerCancel={canDrag ? endPreviewDrag : undefined} onLostPointerCapture={canDrag ? endPreviewDrag : undefined} />
  }

  return <section className="fabricator-workspace face-components-workspace" aria-label="Biblioteca de olhos, pupilas, sobrancelhas, nariz e bocas">
    <header className="face-components-toolbar"><label>Modelo<select value={modelSlot} disabled={busy} onChange={(event) => setModelSlot(Number(event.target.value))}>{models.map((entry, index) => entry && <option key={index + 1} value={index + 1}>Modelo {String(index + 1).padStart(2, '0')} · {entry.name}</option>)}</select></label><span>Selecione uma peça e arraste-a na prévia para mover</span></header>
    <div className="face-components-body">
      <aside className="face-components-library">
        <header><strong>Biblioteca</strong><small>{libraryAssets.length + noseCatalog.length + mouthCatalog.length} assets</small></header>
        <div className="face-components-library-actions"><button type="button" onClick={() => setOpenModal('import')} disabled={!head || busy}><Icon name="plus" /> Importar</button><button type="button" onClick={() => { setMarkedForDeletion([]); setOpenModal('delete') }} disabled={busy}><Icon name="trash" /> Excluir</button></div>
        <nav className="face-components-library-tabs" aria-label="Categorias da biblioteca" role="tablist">
          {categories.map((category) => <button key={category.kind} type="button" role="tab" aria-selected={libraryCategory === category.kind} className={libraryCategory === category.kind ? 'active' : ''} onClick={() => { setLibraryCategory(category.kind); setSelectedPart(category.parts[0]) }}>{category.label}</button>)}
          <button type="button" role="tab" aria-selected={libraryCategory === 'nose'} className={libraryCategory === 'nose' ? 'active' : ''} onClick={() => setLibraryCategory('nose')}>Nariz</button>
          <button type="button" role="tab" aria-selected={libraryCategory === 'mouth'} className={libraryCategory === 'mouth' ? 'active' : ''} onClick={() => setLibraryCategory('mouth')}>Boca</button>
        </nav>
        <section className="face-components-library-category" role="tabpanel" aria-label={`Assets de ${libraryCategory === 'mouth' ? 'Boca' : libraryCategory === 'nose' ? 'Nariz' : selectedCategory.label}`}>
          <h3>{libraryCategory === 'mouth' ? 'Boca' : libraryCategory === 'nose' ? 'Nariz' : selectedCategory.label} <small>{libraryCategory === 'mouth' ? mouthCatalog.filter((item) => item.category === mouthKind).length : libraryCategory === 'nose' ? noseCatalog.length : libraryAssets.filter((asset) => asset.kind === libraryCategory).length}</small></h3>
          {libraryCategory === 'mouth' && <div className="face-components-mouth-variants"><button type="button" className={mouthKind === 'mouth-closed' ? 'active' : ''} onClick={() => { setMouthKind('mouth-closed'); setSelectedMouthId(mouthCatalog.find((item) => item.category === 'mouth-closed')?.id ?? null) }}>Fechadas</button><button type="button" className={mouthKind === 'mouth-open' ? 'active' : ''} onClick={() => { setMouthKind('mouth-open'); setSelectedMouthId(mouthCatalog.find((item) => item.category === 'mouth-open')?.id ?? null) }}>Abertas</button></div>}
          <div className="face-components-assets">
            {libraryCategory === 'mouth' ? mouthCatalog.filter((item) => item.category === mouthKind).map((item) => <button key={item.id} className={selectedMouthId === item.id ? 'active' : ''} onClick={() => setSelectedMouthId(item.id)} type="button"><img src={mouthDetails[item.id]?.pieces[0]?.dataUrl} alt="" /><span>{item.name}</span></button>) : libraryCategory === 'nose' ? noseCatalog.map((item) => <button key={item.id} className={selectedNoseId === item.id ? 'active' : ''} onClick={() => setSelectedNoseId(item.id)} type="button"><img src={noseDetails[item.id]?.pieces[0]?.dataUrl} alt="" /><span>{item.name}</span></button>) : libraryAssets.filter((asset) => asset.kind === libraryCategory).map((asset) => {
              const displayed = details[asset.id]
              const active = selectedId === asset.id || selectedPart.endsWith('right') && displayed && selectedAsset && sameLibraryPair(displayed, selectedAsset)
              return <button key={asset.id} className={active ? 'active' : ''} onClick={() => void chooseLibraryAsset(asset)} disabled={busy} type="button"><img src={displayed?.dataUrl} alt="" /><span>{libraryBaseName(asset.name)}</span></button>
            })}
            {(libraryCategory === 'mouth' ? !mouthCatalog.some((item) => item.category === mouthKind) : libraryCategory === 'nose' ? noseCatalog.length === 0 : !libraryAssets.some((asset) => asset.kind === libraryCategory)) && <small>Nenhum asset salvo nesta categoria</small>}
          </div>
        </section>
      </aside>
      <main className="face-components-stage-column">
        <nav className="face-components-part-tabs">{categories.flatMap((category) => category.parts.map((id, side) => <button key={id} className={libraryCategory === category.kind && selectedPart === id ? 'active' : ''} onClick={() => void chooseComponentSide(id)} type="button">{category.names[side]}</button>))}</nav>
        <div className="face-components-stage" ref={stageRef} style={{ '--preview-background': previewBackground } as CSSProperties}>
          {head && previewScale > 0 && <div className="face-components-preview-canvas" style={{ width: head.width * previewScale, height: head.height * previewScale }}>
            <img className="face-components-head" src={head.dataUrl} alt="Cabeça do modelo" />
            {(libraryCategory === 'eye-closed'
              ? ['eye-closed-left','eye-closed-right','brow-left','brow-right']
              : ['eye-left','eye-right','pupil-left','pupil-right','brow-left','brow-right'] as PartId[]).map((id) => renderPart(id as PartId, true, selectedAssets))}
            {nosePiece && noseStyle && <img className={`face-component-layer${libraryCategory === 'nose' ? ` face-component-layer-draggable${draggingPreview ? ' is-dragging' : ''}` : ''}`} src={nosePiece.dataUrl} alt="Nariz selecionado" style={noseStyle} draggable={false} title={libraryCategory === 'nose' ? 'Arraste para mover esta peça' : undefined} onPointerDown={libraryCategory === 'nose' && selectedNose ? (event) => beginPreviewDrag(event, `nose:${selectedNose.id}`) : undefined} onPointerMove={libraryCategory === 'nose' ? movePreviewDrag : undefined} onPointerUp={libraryCategory === 'nose' ? endPreviewDrag : undefined} onPointerCancel={libraryCategory === 'nose' ? endPreviewDrag : undefined} onLostPointerCapture={libraryCategory === 'nose' ? endPreviewDrag : undefined} />}
            {mouthPiece && mouthStyle && <img className={`face-component-layer${libraryCategory === 'mouth' ? ` face-component-layer-draggable${draggingPreview ? ' is-dragging' : ''}` : ''}`} src={mouthPiece.dataUrl} alt="Boca selecionada" style={mouthStyle} draggable={false} title={libraryCategory === 'mouth' ? 'Arraste para mover esta peça' : undefined} onPointerDown={libraryCategory === 'mouth' && selectedMouth ? (event) => beginPreviewDrag(event, `${selectedMouth.category}:${selectedMouth.id}`) : undefined} onPointerMove={libraryCategory === 'mouth' ? movePreviewDrag : undefined} onPointerUp={libraryCategory === 'mouth' ? endPreviewDrag : undefined} onPointerCancel={libraryCategory === 'mouth' ? endPreviewDrag : undefined} onLostPointerCapture={libraryCategory === 'mouth' ? endPreviewDrag : undefined} />}
            {guide.visible && <FaceGuideOverlay head={head} guide={guide} />}
          </div>}
          {!head && <span>Selecione um modelo com cabeça.</span>}
        </div>
        <div className="face-components-stage-footer">{notice}</div>
      </main>
      <aside className="face-components-controls">
        <header><strong>Ajuste da peça</strong></header>
        {componentPair && <div className="face-component-side-options" role="group" aria-label={`Selecionar lado de ${componentPair.label} para ajustar`}>
          {componentPair.parts.map((part, index) => {
            const asset = selectedAssets[part] ? details[selectedAssets[part]] : undefined
            const displayed = asset ?? (index === 1 ? leftPairAsset : undefined)
            return <button key={part} className={selectedPart === part ? 'active' : ''} type="button" aria-pressed={selectedPart === part} disabled={busy} onClick={() => void chooseComponentSide(part)}><span className="face-component-side-image">{displayed && <img src={displayed.dataUrl} alt="" />}</span><span><strong>{index === 0 ? 'Esquerda' : 'Direita'}</strong><small>{index === 1 && linked[componentPair.kind] ? 'Imagem espelhada' : asset ? 'Ajustar este lado' : 'Escolha uma peça'}</small></span></button>
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
        {libraryCategory === 'eye-closed' && eyeAsset && <p className="face-component-follow-note">O olho fechado acompanha a posição e a largura do olho aberto. Ajuste a altura e a rotação aqui.</p>}
        {alignableKind && <section className="face-component-import-anchor" aria-label="Fixar posição e tamanho para novas importações">
          <div><strong>Referência de importação</strong><small>{alignableKind === 'eye-closed' ? 'A altura usa esta referência; posição e largura acompanham o olho aberto.' : currentImportAnchor ? 'Novas peças terão a posição e o tamanho desta referência.' : 'Ajuste a primeira peça e fixe para as próximas folhas.'}</small></div>
          <button type="button" disabled={!leftPairAsset} onClick={() => fixImportAnchor(alignableKind)}>{currentImportAnchor ? 'Atualizar fixação' : 'Fixar posição e tamanho'}</button>
          {currentImportAnchor && <button className="face-component-import-anchor-release" type="button" onClick={() => releaseImportAnchor(alignableKind)}>Desfixar</button>}
        </section>}
        {componentPair && head && movementLeftAsset && moveTogether[componentPair.kind] && <section className="face-component-pair-controls" aria-label={`Deslocamento conjunto de ${componentPair.label}`}>
          <strong>Deslocamento conjunto</strong><small>Move esquerda e direita na mesma direção.</small>
          <div className="face-component-nudge-pad">
            <button type="button" aria-label="Subir os dois lados" onClick={() => void movePair(componentPair.kind, 'y', pairY - 1)}>↑</button>
            <button type="button" aria-label="Mover os dois lados para a esquerda" onClick={() => void movePair(componentPair.kind, 'x', pairX - 1)}>←</button>
            <button type="button" aria-label="Descer os dois lados" onClick={() => void movePair(componentPair.kind, 'y', pairY + 1)}>↓</button>
            <button type="button" aria-label="Mover os dois lados para a direita" onClick={() => void movePair(componentPair.kind, 'x', pairX + 1)}>→</button>
          </div>
          <label className="face-component-slider"><span>Horizontal <output>{Math.round(pairX)} px</output></span><input type="range" min={componentPair.kind === 'pupil' ? -head.width * .25 : 0} max={componentPair.kind === 'pupil' ? head.width * .25 : head.width} step="1" value={pairX} onChange={(event) => void movePair(componentPair.kind, 'x', Number(event.target.value))} /></label>
          <label className="face-component-slider"><span>Vertical <output>{Math.round(pairY)} px</output></span><input type="range" min={componentPair.kind === 'pupil' ? -head.height * .25 : 0} max={componentPair.kind === 'pupil' ? head.height * .25 : head.height} step="1" value={pairY} onChange={(event) => void movePair(componentPair.kind, 'y', Number(event.target.value))} /></label>
        </section>}
        {head && selectedTransform && (activeComponent || selectedCatalogItem) ? <>
          {!componentPair && <div className="face-component-current"><img src={activeComponent?.dataUrl ?? selectedCatalogPiece?.dataUrl} alt="" /><span><strong>{activeComponent?.name ?? selectedCatalogItem?.name}</strong><small>{selectedCatalogItem ? selectedCatalogItem.category === 'nose' ? 'Nariz' : selectedCatalogItem.category === 'mouth-open' ? 'Boca aberta' : 'Boca fechada' : selectedCategory.names[selectedPart.endsWith('right') ? 1 : 0]}</small></span></div>}
          {selectedCatalogItem && <label className="face-component-variant">Variante<select value={selectedCatalogItem.category === 'nose' ? selectedCatalogItem.selectedNose : selectedCatalogItem.selectedExpression} onChange={(event) => updateCatalogVariant(Number(event.target.value))}>{selectedCatalogItem.pieces.map((piece) => <option key={piece.id} value={piece.index}>{selectedCatalogItem.category === 'nose' ? 'Nariz' : 'Expressão'} {String(piece.index + 1).padStart(2, '0')}</option>)}</select></label>}
          {componentPair && <strong className="face-component-individual-title">{followsOpenEye ? 'Altura e rotação' : moveTogether[componentPair.kind] ? 'Tamanho e rotação' : 'Ajuste individual'} · {selectedPart.endsWith('right') ? 'direita' : 'esquerda'}</strong>}
          <FaceTransformControls head={head} transform={selectedTransform} sourceWidth={selectedSourceWidth} sourceHeight={selectedSourceHeight} pupil={activeComponent?.kind === 'pupil'} moveTogether={componentPair ? moveTogether[componentPair.kind] : false} followEyes={followsOpenEye} onChange={updateTransform} onReset={() => updateTransform(selectedCatalogItem ? initialCatalogTransform(head, selectedCatalogItem) : initialTransform(activeComponent!.kind, head, activeComponent!.width, activeComponent!.height))} />
        </> : <p>Selecione uma peça na Biblioteca para ajustar posição, tamanho e rotação.</p>}
        <section className="face-components-guide-controls" aria-label="Guias de alinhamento do rosto">
          <header><strong>Guias de desenho</strong><label><input type="checkbox" checked={guide.visible} onChange={(event) => updateGuide({ visible: event.target.checked })} /> Mostrar</label></header>
          <p>Marcação visual para alinhar as peças. Não modifica o personagem.</p>
          <label>Inclinação do eixo <output>{guide.angle}°</output><input type="range" min="-30" max="30" step="1" value={guide.angle} disabled={!guide.visible} onChange={(event) => updateGuide({ angle: Number(event.target.value) })} /></label>
          <label>Posição do eixo <output>{guide.verticalX}%</output><input type="range" min="20" max="80" step="1" value={guide.verticalX} disabled={!guide.visible} onChange={(event) => updateGuide({ verticalX: Number(event.target.value) })} /></label>
          <label>Altura da linha superior <output>{guide.horizontalY}%</output><input type="range" min="10" max={Math.min(90, guide.lowerHorizontalY - 1)} step="1" value={guide.horizontalY} disabled={!guide.visible} onChange={(event) => updateGuide({ horizontalY: Number(event.target.value) })} /></label>
          <label>Altura da linha inferior <output>{guide.lowerHorizontalY}%</output><input type="range" min={guide.horizontalY + 1} max="99" step="1" value={guide.lowerHorizontalY} disabled={!guide.visible} onChange={(event) => updateGuide({ lowerHorizontalY: Number(event.target.value) })} /></label>
          <button type="button" onClick={() => setGuidesByModel((current) => ({ ...current, [modelSlot]: defaultGuide }))}>Restaurar guias</button>
        </section>
      </aside>
    </div>{error && <div className={`face-components-error${openModal ? ' face-components-error-modal' : ''}`} role="alert">{error}</div>}
    {openModal && <div className="face-components-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setOpenModal(null) }}>
      <div className="face-components-modal" role="dialog" aria-modal="true" aria-labelledby="face-components-modal-title">
        <header><div><strong id="face-components-modal-title">{openModal === 'import' ? 'Importar peças do rosto' : 'Excluir peças do rosto'}</strong><small>{openModal === 'import' ? 'Escolha a categoria e o formato de importação.' : 'Escolha as peças já importadas que deseja remover.'}</small></div><button type="button" aria-label="Fechar" disabled={busy} onClick={() => setOpenModal(null)}>×</button></header>
        {openModal === 'import' ? <div className="face-components-import-options">
          <label className="face-components-import-option"><span className="face-components-import-sheet"><span>3 peças</span></span><strong>Olho + pupila + olho fechado</strong><small>Uma imagem vertical: olho aberto em cima, pupila no meio e olho fechado embaixo. O app identifica os espaços entre as peças, mesmo com alturas diferentes.</small><span className="face-components-import-action"><Icon name="plus" /> Escolher imagem</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !head} onChange={(event) => void importEyeSheet(event)} /></label>
          <label className="face-components-import-option"><span className="face-components-import-sheet"><span>1 peça</span></span><strong>Sobrancelha</strong><small>Uma sobrancelha por imagem; o fundo verde é removido automaticamente e o lado direito pode ser espelhado.</small><span className="face-components-import-action"><Icon name="plus" /> Escolher imagem</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !head} onChange={(event) => void importAsset('eyebrow', event)} /></label>
          <label className="face-components-import-option"><span className="face-components-import-sheet"><span>1 peça</span></span><strong>Nariz único</strong><small>Uma imagem com um nariz.</small><span className="face-components-import-action"><Icon name="plus" /> Escolher folha</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !head} onChange={(event) => void importCatalogSheet('nose', event, 'one')} /></label>
          <label className="face-components-import-option"><span className="face-components-import-sheet"><span>3 × 2</span></span><strong>Seis narizes</strong><small>Folha com seis variações de nariz.</small><span className="face-components-import-action"><Icon name="plus" /> Escolher folha</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !head} onChange={(event) => void importCatalogSheet('nose', event, 'six')} /></label>
          <label className="face-components-import-option"><span className="face-components-import-sheet"><span>7 × 3</span></span><strong>Bocas fechadas</strong><small>Folha com 21 expressões fechadas.</small><span className="face-components-import-action"><Icon name="plus" /> Escolher folha</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !head} onChange={(event) => void importCatalogSheet('mouth-closed', event)} /></label>
          <label className="face-components-import-option"><span className="face-components-import-sheet"><span>7 × 3</span></span><strong>Bocas abertas</strong><small>Folha com 21 expressões abertas.</small><span className="face-components-import-action"><Icon name="plus" /> Escolher folha</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !head} onChange={(event) => void importCatalogSheet('mouth-open', event)} /></label>
        </div> : <><div className="face-components-delete-list">
          {categories.map((category) => <section key={category.kind}><h3>{category.label}</h3>{libraryAssets.filter((asset) => asset.kind === category.kind).map((asset) => {
            const left = details[asset.id]
            const groupIds = [asset.id, ...assets.filter((candidate) => {
              const right = details[candidate.id]
              return left && right && candidate.id !== asset.id && sameLibraryPair(left, right)
            }).map((candidate) => candidate.id)]
            return <label key={asset.id} className="face-components-delete-item"><input type="checkbox" checked={groupIds.every((id) => markedForDeletion.includes(id))} disabled={busy} onChange={(event) => setMarkedForDeletion((current) => event.target.checked ? [...new Set([...current, ...groupIds])] : current.filter((id) => !groupIds.includes(id)))} /><img src={left?.dataUrl} alt="" /><span>{libraryBaseName(asset.name)}</span></label>
          })}{!libraryAssets.some((asset) => asset.kind === category.kind) && <small>Nenhuma peça importada</small>}</section>)}
          <section><h3>Nariz</h3>{noseCatalog.map((item) => <label key={item.id} className="face-components-delete-item"><input type="checkbox" checked={markedForDeletion.includes(item.id)} disabled={busy || item.id.startsWith('legacy_')} onChange={(event) => setMarkedForDeletion((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /><img src={noseDetails[item.id]?.pieces[0]?.dataUrl} alt="" /><span>{item.name}{item.id.startsWith('legacy_') ? ' · legado' : ''}</span></label>)}{noseCatalog.length === 0 && <small>Nenhuma peça importada</small>}</section>
          <section><h3>Boca</h3>{mouthCatalog.map((item) => <label key={item.id} className="face-components-delete-item"><input type="checkbox" checked={markedForDeletion.includes(item.id)} disabled={busy || item.id.startsWith('legacy_')} onChange={(event) => setMarkedForDeletion((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /><img src={mouthDetails[item.id]?.pieces[0]?.dataUrl} alt="" /><span>{item.name}{item.id.startsWith('legacy_') ? ' · legado' : ''}</span></label>)}{mouthCatalog.length === 0 && <small>Nenhuma peça importada</small>}</section>
        </div><footer><span>{markedGroupCount} {markedGroupCount === 1 ? 'peça selecionada' : 'peças selecionadas'}</span><button type="button" className="face-components-delete-confirm" disabled={busy || markedForDeletion.length === 0} onClick={() => void removeSelectedAssets()}>Excluir selecionadas</button></footer></>}
      </div>
    </div>}
  </section>
}
