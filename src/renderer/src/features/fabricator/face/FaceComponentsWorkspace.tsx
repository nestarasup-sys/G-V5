import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { FaceCatalogItem, FaceCatalogItemSave, FaceCatalogItemSummary, FaceComponentAsset, FaceComponentAssetSave, FaceComponentAssetSummary, FaceComponentKind, FaceTransform, FabricatorProject, FabricatorSlotSummary, ModelPart } from '../../../../../shared/fabricator'
import { Icon } from '../../../ui/components/Icon'
import { usePreviewBackground } from '../usePreviewBackground'
import { processFaceSheet } from './processFaceSheet'
import { splitEyeSheet } from './splitEyeSheet'
import './face-components.css'

type PartId = 'eye-left' | 'eye-right' | 'pupil-left' | 'pupil-right' | 'eye-closed-left' | 'eye-closed-right' | 'brow-left' | 'brow-right'
type CatalogKind = 'nose' | 'mouth-closed' | 'mouth-open'
type LibraryCategory = FaceComponentKind | 'nose' | 'mouth'
type FaceGuide = { visible: boolean; verticalX: number; horizontalY: number; lowerHorizontalY: number; angle: number }
type PreviewDrag = { pointerId: number; key: string; clientX: number; clientY: number; startX: number; startY: number; modelPerPixelX: number; modelPerPixelY: number; invertX: boolean; pupil: boolean }
const GUIDE_STORAGE_KEY = 'gacha-nymi:face-dev-guides'
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

function FaceTransformControls({ head, transform, sourceWidth, sourceHeight, pupil, onChange, onReset }: {
  head: ModelPart; transform: FaceTransform; sourceWidth: number; sourceHeight: number; pupil: boolean
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
    <div className="face-component-move-controls"><strong>Posição</strong><div className="face-component-nudge-pad">
      <button type="button" aria-label="Subir peça" onClick={() => onChange({ y: transform.y - 1 })}>↑</button>
      <button type="button" aria-label="Mover peça para a esquerda" onClick={() => onChange({ x: transform.x - 1 })}>←</button>
      <button type="button" aria-label="Descer peça" onClick={() => onChange({ y: transform.y + 1 })}>↓</button>
      <button type="button" aria-label="Mover peça para a direita" onClick={() => onChange({ x: transform.x + 1 })}>→</button>
    </div></div>
    <label className="face-component-slider"><span>{pupil ? 'Deslocamento horizontal' : 'Horizontal'}<output>{pupil ? `${Math.round(transform.x)} px` : `${Math.round(transform.x / head.width * 100)}%`}</output></span><input type="range" min={pupil ? -xRange : 0} max={xRange} step="1" value={transform.x} onChange={(event) => onChange({ x: Number(event.target.value) })} /></label>
    <label className="face-component-slider"><span>{pupil ? 'Deslocamento vertical' : 'Vertical'}<output>{pupil ? `${Math.round(transform.y)} px` : `${Math.round(transform.y / head.height * 100)}%`}</output></span><input type="range" min={pupil ? -yRange : 0} max={yRange} step="1" value={transform.y} onChange={(event) => onChange({ y: Number(event.target.value) })} /></label>
    {sizeControl('Largura', widthPercent, sourceWidth, head.width, 'scaleX')}
    {sizeControl('Altura', heightPercent, sourceHeight, head.height, 'scaleY')}
    <label className="face-component-slider"><span>Rotação<output>{Math.round(transform.rotation)}°</output></span><input type="range" min="-180" max="180" step="1" value={transform.rotation} onChange={(event) => onChange({ rotation: Number(event.target.value) })} /></label>
    <button className="face-component-reset-transform" type="button" onClick={onReset}>Restaurar encaixe da peça</button>
  </div>
}

export function FaceComponentsWorkspace() {
  const [previewBackground] = usePreviewBackground()
  const [models, setModels] = useState<FabricatorSlotSummary[]>([])
  const [modelSlot, setModelSlot] = useState(1)
  const [guidesByModel, setGuidesByModel] = useState<Record<number, FaceGuide>>(readFaceGuides)
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('Importe assets PNG transparentes; o formato de folha pode ser definido depois.')
  const [openModal, setOpenModal] = useState<'import' | 'delete' | null>(null)
  const [markedForDeletion, setMarkedForDeletion] = useState<string[]>([])
  const componentDetailsRef = useRef(details)
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
  const selectedId = linked[selectedCategory.kind] && selectedPart.endsWith('right')
    ? selectedAssets[selectedCategory.parts[0]]
    : selectedAssets[selectedPart]
  const selectedAsset = selectedId ? details[selectedId] : undefined
  const selectedMouth = selectedMouthId && mouthDetails[selectedMouthId]?.category === mouthKind ? mouthDetails[selectedMouthId] : undefined
  const selectedNose = selectedNoseId ? noseDetails[selectedNoseId] : undefined
  const selectedCatalogItem = libraryCategory === 'nose' ? selectedNose : libraryCategory === 'mouth' ? selectedMouth : undefined
  const selectedCatalogPiece = selectedCatalogItem?.pieces.find((piece) => piece.index === (selectedCatalogItem.category === 'nose' ? selectedCatalogItem.selectedNose : selectedCatalogItem.selectedExpression)) ?? selectedCatalogItem?.pieces[0]
  const activeComponent = libraryCategory === 'nose' || libraryCategory === 'mouth' ? undefined : selectedAsset
  const selectedTransform = selectedCatalogItem ? selectedCatalogItem.transforms[selectedCatalogItem.category === 'nose' ? 'nose' : 'mouth'] : selectedAsset?.defaultTransform
  const activePreviewKey = selectedCatalogItem ? `${selectedCatalogItem.category}:${selectedCatalogItem.id}` : activeComponent ? `${selectedPart}:${activeComponent.id}` : null
  const eyeAssetId = selectedPart.endsWith('right') && !linked.eye ? selectedAssets['eye-right'] : selectedAssets['eye-left']
  const eyeAsset = eyeAssetId ? details[eyeAssetId] : undefined
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
  function updateGuide(patch: Partial<FaceGuide>) {
    setGuidesByModel((current) => ({ ...current, [modelSlot]: { ...(current[modelSlot] ?? defaultGuide), ...patch } }))
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
    setModel(null); setAssets([]); setDetails({}); setSelectedAssets({})
    void Promise.all([window.desktop.loadFabricatorSlot(modelSlot), window.desktop.listFaceComponentAssets(modelSlot)]).then(async ([project, list]) => {
      const loaded = await Promise.all(list.map((entry) => window.desktop.loadFaceComponentAsset(modelSlot, entry.id)))
      if (!active) return
      setModel(project); setAssets(list); setDetails(Object.fromEntries(loaded.filter((item): item is FaceComponentAsset => Boolean(item)).map((item) => [item.id, item])))
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
    try {
      const image = await readImage(file)
      const id = crypto.randomUUID()
      const activePart = partCategory(selectedPart).kind === kind ? selectedPart : categories.find((category) => category.kind === kind)!.parts[0]
      const asset: FaceComponentAssetSave = { schemaVersion: 1, id, modelSlot, kind, name: file.name.replace(/\.[^.]+$/, '').slice(0, 120) || categories.find((item) => item.kind === kind)!.label, width: image.width, height: image.height, defaultTransform: initialTransform(kind, head, image.width, image.height), updatedAt: new Date().toISOString() }
      await window.desktop.saveFaceComponentAsset(modelSlot, asset, image.dataUrl)
      const loaded = { ...asset, dataUrl: image.dataUrl }
      setDetails((current) => ({ ...current, [id]: loaded })); setAssets((current) => [asset, ...current]); setSelectedPart(activePart); setLibraryCategory(kind); setSelectedAssets((current) => ({ ...current, [activePart]: id }))
      setNotice(`${asset.name} salvo. Ajuste o encaixe na prévia do modelo.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) }
  }

  async function importEyeSheet(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file || !head) return
    setBusy(true); setError('')
    const savedIds: string[] = []
    try {
      const pieces = await splitEyeSheet(file)
      const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 90) || 'Olhos'
      const labels: Record<(typeof pieces)[number]['kind'], string> = { eye: 'Olho aberto', pupil: 'Pupila', 'eye-closed': 'Olho fechado' }
      const imported: FaceComponentAsset[] = []
      for (const piece of pieces) {
        const asset: FaceComponentAssetSave = {
          schemaVersion: 1, id: crypto.randomUUID(), modelSlot, kind: piece.kind,
          name: `${baseName} · ${labels[piece.kind]}`.slice(0, 120), width: piece.width, height: piece.height,
          defaultTransform: initialTransform(piece.kind, head, piece.width, piece.height), updatedAt: new Date().toISOString()
        }
        await window.desktop.saveFaceComponentAsset(modelSlot, asset, piece.dataUrl)
        savedIds.push(asset.id)
        imported.push({ ...asset, dataUrl: piece.dataUrl })
      }
      setDetails((current) => ({ ...current, ...Object.fromEntries(imported.map((asset) => [asset.id, asset])) }))
      setAssets((current) => [...imported, ...current])
      setSelectedAssets((current) => ({ ...current,
        'eye-left': imported.find((asset) => asset.kind === 'eye')?.id,
        'pupil-left': imported.find((asset) => asset.kind === 'pupil')?.id,
        'eye-closed-left': imported.find((asset) => asset.kind === 'eye-closed')?.id
      }))
      setSelectedPart('eye-left'); setLibraryCategory('eye'); setOpenModal(null)
      setNotice('Olho aberto, pupila e olho fechado importados. Ajuste cada peça na Biblioteca.')
    } catch (reason) {
      await Promise.allSettled(savedIds.map((id) => window.desktop.deleteFaceComponentAsset(modelSlot, id)))
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setBusy(false) }
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
    const original = componentDetailsRef.current[selectedAsset.id] ?? selectedAsset
    const next: FaceComponentAsset = { ...original, defaultTransform: { ...original.defaultTransform, ...patch }, updatedAt: new Date().toISOString() }
    componentDetailsRef.current = { ...componentDetailsRef.current, [next.id]: next }
    setDetails((items) => ({ ...items, [next.id]: next }))
    queueSave(`component:${next.modelSlot}:${next.id}`, () => {
      const { dataUrl, ...saved } = next
      return window.desktop.saveFaceComponentAsset(next.modelSlot, saved, dataUrl)
    })
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
    const assetId = id.endsWith('right') && mirror && linked[category.kind]
      ? overrides[category.parts[0]] ?? selectedAssets[category.parts[0]]
      : overrides[id] ?? selectedAssets[id]
    const asset = assetId ? details[assetId] : undefined
    if (!asset) return null
    const transform = asset.defaultTransform
    const rightSide = id.endsWith('right')
    const eyeLinked = linked.eye
    const eyeId = rightSide && !eyeLinked ? selectedAssets['eye-right'] : selectedAssets['eye-left']
    const eyeAsset = category.kind === 'pupil' ? details[eyeId ?? ''] : undefined
    const eyeTransform = eyeAsset?.defaultTransform
    const eyeWidth = eyeAsset ? eyeAsset.width * eyeTransform!.scaleX : head.width * .19
    const eyeHeight = eyeAsset ? eyeAsset.height * eyeTransform!.scaleY : head.height * .17
    let localX = transform.x
    let localY = transform.y
    if (category.kind === 'pupil') {
      const eyeX = eyeTransform?.x ?? head.width * .37
      localX = (rightSide ? head.width - eyeX : eyeX) + (rightSide && linked.pupil ? -transform.x : transform.x)
      localY = (eyeTransform?.y ?? head.height * .46) + transform.y
    }
    const mirroredPosition = rightSide && category.kind !== 'pupil'
    const mirroredAsset = rightSide && linked[category.kind]
    const x = mirroredPosition ? head.width - localX : localX
    const shouldFlip = Boolean(mirroredAsset) !== Boolean(transform.flipX)
    const width = category.kind === 'pupil' ? eyeWidth * transform.scaleX : asset.width * transform.scaleX
    const height = category.kind === 'pupil' ? eyeHeight * transform.scaleY : asset.height * transform.scaleY
    const style: CSSProperties = { left: `${x / head.width * 100}%`, top: `${localY / head.height * 100}%`, width: `${width / head.width * 100}%`, height: `${height / head.height * 100}%`, transform: `translate(-50%,-50%) rotate(${transform.rotation * (mirroredPosition ? -1 : 1)}deg) scaleX(${shouldFlip ? -1 : 1})` }
    const dragKey = `${id}:${assetId}`
    const canDrag = dragKey === activePreviewKey
    return <img key={`${id}-${assetId}`} className={`face-component-layer${canDrag ? ` face-component-layer-draggable${draggingPreview ? ' is-dragging' : ''}` : ''}`} src={asset.dataUrl} alt={category.names[rightSide ? 1 : 0]} style={style} draggable={false} title={canDrag ? 'Arraste para mover esta peça' : undefined} onPointerDown={canDrag ? (event) => beginPreviewDrag(event, dragKey, rightSide && (category.kind !== 'pupil' || linked.pupil), category.kind === 'pupil') : undefined} onPointerMove={canDrag ? movePreviewDrag : undefined} onPointerUp={canDrag ? endPreviewDrag : undefined} onPointerCancel={canDrag ? endPreviewDrag : undefined} onLostPointerCapture={canDrag ? endPreviewDrag : undefined} />
  }

  return <section className="fabricator-workspace face-components-workspace" aria-label="Biblioteca de olhos, pupilas, sobrancelhas, nariz e bocas">
    <header className="face-components-toolbar"><label>Modelo<select value={modelSlot} disabled={busy} onChange={(event) => setModelSlot(Number(event.target.value))}>{models.map((entry, index) => entry && <option key={index + 1} value={index + 1}>Modelo {String(index + 1).padStart(2, '0')} · {entry.name}</option>)}</select></label><span>Selecione uma peça e arraste-a na prévia para mover</span></header>
    <div className="face-components-body">
      <aside className="face-components-library">
        <header><strong>Biblioteca</strong><small>{assets.length + noseCatalog.length + mouthCatalog.length} assets</small></header>
        <div className="face-components-library-actions"><button type="button" onClick={() => setOpenModal('import')} disabled={!head || busy}><Icon name="plus" /> Importar</button><button type="button" onClick={() => { setMarkedForDeletion([]); setOpenModal('delete') }} disabled={busy}><Icon name="trash" /> Excluir</button></div>
        <nav className="face-components-library-tabs" aria-label="Categorias da biblioteca" role="tablist">
          {categories.map((category) => <button key={category.kind} type="button" role="tab" aria-selected={libraryCategory === category.kind} className={libraryCategory === category.kind ? 'active' : ''} onClick={() => { setLibraryCategory(category.kind); setSelectedPart(category.parts[0]) }}>{category.label}</button>)}
          <button type="button" role="tab" aria-selected={libraryCategory === 'nose'} className={libraryCategory === 'nose' ? 'active' : ''} onClick={() => setLibraryCategory('nose')}>Nariz</button>
          <button type="button" role="tab" aria-selected={libraryCategory === 'mouth'} className={libraryCategory === 'mouth' ? 'active' : ''} onClick={() => setLibraryCategory('mouth')}>Boca</button>
        </nav>
        <section className="face-components-library-category" role="tabpanel" aria-label={`Assets de ${libraryCategory === 'mouth' ? 'Boca' : libraryCategory === 'nose' ? 'Nariz' : selectedCategory.label}`}>
          <h3>{libraryCategory === 'mouth' ? 'Boca' : libraryCategory === 'nose' ? 'Nariz' : selectedCategory.label} <small>{libraryCategory === 'mouth' ? mouthCatalog.filter((item) => item.category === mouthKind).length : libraryCategory === 'nose' ? noseCatalog.length : assets.filter((asset) => asset.kind === libraryCategory).length}</small></h3>
          {libraryCategory === 'mouth' && <div className="face-components-mouth-variants"><button type="button" className={mouthKind === 'mouth-closed' ? 'active' : ''} onClick={() => { setMouthKind('mouth-closed'); setSelectedMouthId(mouthCatalog.find((item) => item.category === 'mouth-closed')?.id ?? null) }}>Fechadas</button><button type="button" className={mouthKind === 'mouth-open' ? 'active' : ''} onClick={() => { setMouthKind('mouth-open'); setSelectedMouthId(mouthCatalog.find((item) => item.category === 'mouth-open')?.id ?? null) }}>Abertas</button></div>}
          <div className="face-components-assets">
            {libraryCategory === 'mouth' ? mouthCatalog.filter((item) => item.category === mouthKind).map((item) => <button key={item.id} className={selectedMouthId === item.id ? 'active' : ''} onClick={() => setSelectedMouthId(item.id)} type="button"><img src={mouthDetails[item.id]?.pieces[0]?.dataUrl} alt="" /><span>{item.name}</span></button>) : libraryCategory === 'nose' ? noseCatalog.map((item) => <button key={item.id} className={selectedNoseId === item.id ? 'active' : ''} onClick={() => setSelectedNoseId(item.id)} type="button"><img src={noseDetails[item.id]?.pieces[0]?.dataUrl} alt="" /><span>{item.name}</span></button>) : assets.filter((asset) => asset.kind === libraryCategory).map((asset) => <button key={asset.id} className={selectedId === asset.id ? 'active' : ''} onClick={() => setSelectedAssets((current) => ({ ...current, [selectedPart]: asset.id }))} type="button"><img src={details[asset.id]?.dataUrl} alt="" /><span>{asset.name}</span></button>)}
            {(libraryCategory === 'mouth' ? !mouthCatalog.some((item) => item.category === mouthKind) : libraryCategory === 'nose' ? noseCatalog.length === 0 : !assets.some((asset) => asset.kind === libraryCategory)) && <small>Nenhum asset salvo nesta categoria</small>}
          </div>
        </section>
      </aside>
      <main className="face-components-stage-column">
        <nav className="face-components-part-tabs">{categories.flatMap((category) => category.parts.map((id, side) => <button key={id} className={libraryCategory === category.kind && selectedPart === id ? 'active' : ''} onClick={() => { setSelectedPart(id); setLibraryCategory(category.kind) }} type="button">{category.names[side]}</button>))}</nav>
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
        {activeComponent && <label className="face-component-link"><input type="checkbox" checked={linked[activeComponent.kind]} onChange={(event) => setLinked((current) => ({ ...current, [activeComponent.kind]: event.target.checked }))} /> Espelhar lado direito</label>}
        {head && selectedTransform && (activeComponent || selectedCatalogItem) ? <>
          <div className="face-component-current"><img src={activeComponent?.dataUrl ?? selectedCatalogPiece?.dataUrl} alt="" /><span><strong>{activeComponent?.name ?? selectedCatalogItem?.name}</strong><small>{selectedCatalogItem ? selectedCatalogItem.category === 'nose' ? 'Nariz' : selectedCatalogItem.category === 'mouth-open' ? 'Boca aberta' : 'Boca fechada' : selectedCategory.names[selectedPart.endsWith('right') ? 1 : 0]}</small></span></div>
          {selectedCatalogItem && <label className="face-component-variant">Variante<select value={selectedCatalogItem.category === 'nose' ? selectedCatalogItem.selectedNose : selectedCatalogItem.selectedExpression} onChange={(event) => updateCatalogVariant(Number(event.target.value))}>{selectedCatalogItem.pieces.map((piece) => <option key={piece.id} value={piece.index}>{selectedCatalogItem.category === 'nose' ? 'Nariz' : 'Expressão'} {String(piece.index + 1).padStart(2, '0')}</option>)}</select></label>}
          <FaceTransformControls head={head} transform={selectedTransform} sourceWidth={selectedSourceWidth} sourceHeight={selectedSourceHeight} pupil={activeComponent?.kind === 'pupil'} onChange={updateTransform} onReset={() => updateTransform(selectedCatalogItem ? initialCatalogTransform(head, selectedCatalogItem) : initialTransform(activeComponent!.kind, head, activeComponent!.width, activeComponent!.height))} />
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
          <label className="face-components-import-option"><span className="face-components-import-sheet"><span>1 peça</span></span><strong>Sobrancelha</strong><small>Uma sobrancelha por imagem; o lado direito pode ser espelhado.</small><span className="face-components-import-action"><Icon name="plus" /> Escolher imagem</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !head} onChange={(event) => void importAsset('eyebrow', event)} /></label>
          <label className="face-components-import-option"><span className="face-components-import-sheet"><span>1 peça</span></span><strong>Nariz único</strong><small>Uma imagem com um nariz.</small><span className="face-components-import-action"><Icon name="plus" /> Escolher folha</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !head} onChange={(event) => void importCatalogSheet('nose', event, 'one')} /></label>
          <label className="face-components-import-option"><span className="face-components-import-sheet"><span>3 × 2</span></span><strong>Seis narizes</strong><small>Folha com seis variações de nariz.</small><span className="face-components-import-action"><Icon name="plus" /> Escolher folha</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !head} onChange={(event) => void importCatalogSheet('nose', event, 'six')} /></label>
          <label className="face-components-import-option"><span className="face-components-import-sheet"><span>7 × 3</span></span><strong>Bocas fechadas</strong><small>Folha com 21 expressões fechadas.</small><span className="face-components-import-action"><Icon name="plus" /> Escolher folha</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !head} onChange={(event) => void importCatalogSheet('mouth-closed', event)} /></label>
          <label className="face-components-import-option"><span className="face-components-import-sheet"><span>7 × 3</span></span><strong>Bocas abertas</strong><small>Folha com 21 expressões abertas.</small><span className="face-components-import-action"><Icon name="plus" /> Escolher folha</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !head} onChange={(event) => void importCatalogSheet('mouth-open', event)} /></label>
        </div> : <><div className="face-components-delete-list">
          {categories.map((category) => <section key={category.kind}><h3>{category.label}</h3>{assets.filter((asset) => asset.kind === category.kind).map((asset) => <label key={asset.id} className="face-components-delete-item"><input type="checkbox" checked={markedForDeletion.includes(asset.id)} disabled={busy} onChange={(event) => setMarkedForDeletion((current) => event.target.checked ? [...current, asset.id] : current.filter((id) => id !== asset.id))} /><img src={details[asset.id]?.dataUrl} alt="" /><span>{asset.name}</span></label>)}{!assets.some((asset) => asset.kind === category.kind) && <small>Nenhuma peça importada</small>}</section>)}
          <section><h3>Nariz</h3>{noseCatalog.map((item) => <label key={item.id} className="face-components-delete-item"><input type="checkbox" checked={markedForDeletion.includes(item.id)} disabled={busy || item.id.startsWith('legacy_')} onChange={(event) => setMarkedForDeletion((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /><img src={noseDetails[item.id]?.pieces[0]?.dataUrl} alt="" /><span>{item.name}{item.id.startsWith('legacy_') ? ' · legado' : ''}</span></label>)}{noseCatalog.length === 0 && <small>Nenhuma peça importada</small>}</section>
          <section><h3>Boca</h3>{mouthCatalog.map((item) => <label key={item.id} className="face-components-delete-item"><input type="checkbox" checked={markedForDeletion.includes(item.id)} disabled={busy || item.id.startsWith('legacy_')} onChange={(event) => setMarkedForDeletion((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /><img src={mouthDetails[item.id]?.pieces[0]?.dataUrl} alt="" /><span>{item.name}{item.id.startsWith('legacy_') ? ' · legado' : ''}</span></label>)}{mouthCatalog.length === 0 && <small>Nenhuma peça importada</small>}</section>
        </div><footer><span>{markedForDeletion.length} {markedForDeletion.length === 1 ? 'peça selecionada' : 'peças selecionadas'}</span><button type="button" className="face-components-delete-confirm" disabled={busy || markedForDeletion.length === 0} onClick={() => void removeSelectedAssets()}>Excluir selecionadas</button></footer></>}
      </div>
    </div>}
  </section>
}
