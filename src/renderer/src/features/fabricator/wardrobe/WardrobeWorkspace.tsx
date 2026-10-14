import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { FabricatorHistoryState, FabricatorPose, FabricatorPoseSummary, FabricatorProject, FabricatorSlotSummary, WardrobeCategory, WardrobeComponent, WardrobeSet, WardrobeSetSave, WardrobeSetSummary } from '../../../../../shared/fabricator'
import { Icon } from '../../../ui/components/Icon'
import { orderedParts, partJointAnchor, sourcePointFromCanvas } from '../models/rig'
import { cssAffine, mapWardrobeComponentToPose, poseDeltaToSource } from './poseTransform'

type WorkerPiece = Omit<WardrobeComponent, 'category' | 'attachedPartId' | 'rotation' | 'dataUrl'> & { png: ArrayBuffer }
type WorkerMessage = { type: 'complete'; id: number; width: number; height: number; pieces: WorkerPiece[] } | { type: 'error'; id: number; message: string }
type ReferenceMessage = { type: 'complete'; id: number; png: ArrayBuffer } | { type: 'error'; id: number; message: string }
type PieceDrag = { pointerId: number; componentId: string; pointerX: number; pointerY: number; originX: number; originY: number }
const categoryNames: Record<WardrobeCategory, string> = {
  camisa: 'Camisas', 'manga-superior': 'Mangas superiores', 'manga-inferior': 'Mangas inferiores', 'calca-coxa': 'Calças · coxas', 'calca-canela': 'Calças · canelas', shorts: 'Shorts'
}
const categories = Object.keys(categoryNames) as WardrobeCategory[]
function dataUrl(buffer: ArrayBuffer): string {
  let binary = ''; const bytes = new Uint8Array(buffer)
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, Math.min(bytes.length, start + 0x8000)))
  return `data:image/png;base64,${btoa(binary)}`
}
function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Não foi possível ler a imagem.')); reader.readAsDataURL(file) })
}
function guessCategory(piece: WorkerPiece, width: number, height: number): WardrobeCategory {
  const cx = (piece.x + piece.width / 2) / width; const cy = (piece.y + piece.height / 2) / height
  if (cy < .19 && Math.abs(cx - .5) > .1) return 'manga-superior'
  if (cy < .39 && cx > .34 && cx < .66) return 'camisa'
  if (cy > .62) return 'calca-canela'
  if (cy > .34) return 'calca-coxa'
  return 'manga-inferior'
}
function guessName(category: WardrobeCategory, x: number, width: number): string {
  if (category === 'camisa') return 'Camisa'
  if (category === 'shorts') return 'Shorts'
  const side = x < width / 2 ? 'esquerda' : 'direita'
  if (category === 'manga-superior') return `Manga superior ${side}`
  if (category === 'manga-inferior') return `Manga inferior ${side}`
  if (category === 'calca-coxa') return `Calça · coxa ${side}`
  return `Calça · canela ${side}`
}
function getBodyLayer(model: FabricatorProject | null, partId: string): number {
  if (!model) return 0
  const order = model.layerOrder ?? model.parts.map((part) => part.id)
  const layer = order.indexOf(partId)
  return layer >= 0 ? layer : Math.max(0, model.parts.findIndex((part) => part.id === partId))
}
/** Per-set source calibration overrides never mutate the model or its saved poses. */
function fittedBone(bone: FabricatorProject['parts'][number] | undefined, set: WardrobeSet | null) {
  if (!bone) return undefined
  const sourceTransform = set?.sourceOverrides?.[bone.id]
  return sourceTransform ? { ...bone, sourceTransform } : bone
}
function guessBone(category: WardrobeCategory, x: number, width: number, model: FabricatorProject): FabricatorProject['parts'][number] | undefined {
  const side = x < width / 2 ? 'left' : 'right'
  const target = category === 'camisa' ? { x: .5, y: .36 }
    : category === 'shorts' ? { x: .5, y: .42 }
      : category === 'manga-superior' ? { x: side === 'left' ? .27 : .73, y: .27 }
        : category === 'manga-inferior' ? { x: side === 'left' ? .22 : .78, y: .45 }
          : category === 'calca-coxa' ? { x: side === 'left' ? .42 : .58, y: .58 }
            : { x: side === 'left' ? .38 : .62, y: .82 }
  const candidates = model.parts.filter((part) => {
    const partX = part.sourceTransform?.x ?? part.x
    const centerX = (partX + part.width / 2) / model.width
    return category === 'camisa' || category === 'shorts' ? centerX > .3 && centerX < .7 : side === 'left' ? centerX < .5 : centerX >= .5
  })
  const distance = (part: FabricatorProject['parts'][number]) => {
    const partX = part.sourceTransform?.x ?? part.x
    const partY = part.sourceTransform?.y ?? part.y
    const dx = (partX + part.width / 2) / model.width - target.x
    const dy = (partY + part.height / 2) / model.height - target.y
    return dx * dx + dy * dy * 1.5
  }
  return candidates.sort((a, b) => distance(a) - distance(b))[0] ?? model.parts[0]
}
export function WardrobeWorkspace() {
  const [models, setModels] = useState<FabricatorSlotSummary[]>(Array.from({ length: 10 }, () => null))
  const [modelSlot, setModelSlot] = useState(1)
  const [model, setModel] = useState<FabricatorProject | null>(null)
  const [sets, setSets] = useState<WardrobeSetSummary[]>([])
  const [activeSetId, setActiveSetId] = useState<string | null>(null)
  const [draft, setDraft] = useState<WardrobeSet | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(1)
  const [lockAspectRatio, setLockAspectRatio] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const workerRef = useRef<Worker | null>(null)
  const requestRef = useRef(0)
  const pieceDragRef = useRef<PieceDrag | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 })
  const [referencePreview, setReferencePreview] = useState<{ sourceDataUrl: string; imageDataUrl: string } | null>(null)
  const [testPosePickerOpen, setTestPosePickerOpen] = useState(false)
  const [testPoseSlots, setTestPoseSlots] = useState<FabricatorPoseSummary[]>([])
  const [testPose, setTestPose] = useState<FabricatorPose | null>(null)
  const [testPoseLoading, setTestPoseLoading] = useState(false)
  const [testDragOffsets, setTestDragOffsets] = useState<Record<string, { x: number; y: number }>>({})
  const [calibratingPartId, setCalibratingPartId] = useState<string | null>(null)
  const selected = draft?.components.find((component) => component.id === selectedId) ?? null
  const selectedIndex = draft?.components.findIndex((component) => component.id === selectedId) ?? -1
  const previewProject = testPose ?? model
  const previewPoseParts = testPose ? orderedParts(testPose.parts, testPose.layerOrder).filter((part) => !(testPose.hiddenPartIds ?? []).includes(part.id)) : []
  const previewLayerStride = (draft?.components.length ?? 0) + 2
  const scale = previewProject && previewSize.width && previewSize.height ? Math.min((previewSize.width - 48) / previewProject.width, (previewSize.height - 48) / previewProject.height) * zoom : 1

  const reload = useCallback(async (targetSlot: number) => {
    setError('')
    try {
      const [savedModels, reference, library] = await Promise.all([window.desktop.listFabricatorSlots(), window.desktop.loadFabricatorSlot(targetSlot), window.desktop.listWardrobeSets(targetSlot)])
      const firstAvailableModel = savedModels.find((slot) => slot)
      if (!reference && firstAvailableModel && firstAvailableModel.slot !== targetSlot) { setModels(savedModels); setModelSlot(firstAvailableModel.slot); return }
      let recoveredModel = reference
      let history: FabricatorHistoryState | null = null
      if (reference) {
        try { history = await window.desktop.loadFabricatorHistory(targetSlot) } catch { /* Keep calibration available if no history can be read. */ }
        if (history) {
          const original = history.undo[0]?.project
          const originalParts = new Map((original?.parts ?? []).map((part) => [part.id, part]))
          const recoveredParts = reference.parts.map((part) => {
            const sourcePart = originalParts.get(part.id)
            const baseTransform = part.sourceTransform ?? (sourcePart
              ? { x: sourcePart.x, y: sourcePart.y, width: sourcePart.width, height: sourcePart.height, rotation: sourcePart.rotation }
              : undefined)
            if (!baseTransform) return part
            const completeTransform = { ...baseTransform, width: baseTransform.width ?? sourcePart?.width ?? part.width, height: baseTransform.height ?? sourcePart?.height ?? part.height }
            if (part.sourceTransform?.anchorVersion === 1 && part.sourceTransform.width && part.sourceTransform.height) return part
            // Keep the user's current rig pivot, but express it in the original sheet's coordinates.
            const currentAnchor = partJointAnchor(part, reference.joints)
            const sourcePoint = currentAnchor
              ? sourcePointFromCanvas({ ...part, sourceTransform: completeTransform }, currentAnchor)
              : null
            const fallbackAnchor = sourcePart ? partJointAnchor(sourcePart, original?.joints ?? []) : completeTransform.jointAnchor
            const jointAnchor = sourcePoint ?? fallbackAnchor
            return { ...part, sourceTransform: { ...completeTransform, anchorVersion: 1 as const, ...(jointAnchor ? { jointAnchor: { ...jointAnchor } } : {}) } }
          })
          if (recoveredParts.some((part, index) => part !== reference.parts[index])) {
            recoveredModel = { ...reference, parts: recoveredParts }
            // Recovery is read-only. Opening the wardrobe must not write to the model.
            // A historical source frame remains usable for this session.
          }
        }
      }
      setModels(savedModels); setModel(recoveredModel); setSets(library)
      setActiveSetId(null); setDraft(null); setSelectedId(null); setDirty(false)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a biblioteca de roupas.') }
  }, [])
  useEffect(() => { void reload(modelSlot) }, [modelSlot, reload])
  useEffect(() => {
    const element = previewRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setPreviewSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(element); return () => observer.disconnect()
  }, [model])
  useEffect(() => {
    if (!model) { setReferencePreview(null); return }
    let alive = true
    const worker = new Worker(new URL('./wardrobeReference.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<ReferenceMessage>) => {
      if (!alive) return
      if (event.data.type === 'complete') setReferencePreview({ sourceDataUrl: model.sourceDataUrl, imageDataUrl: dataUrl(event.data.png) })
      else setError(event.data.message)
      worker.terminate()
    }
    worker.onerror = () => { if (alive) setError('Não foi possível limpar o fundo verde da referência.'); worker.terminate() }
    worker.postMessage({ id: 1, sourceDataUrl: model.sourceDataUrl, tolerance: model.tolerance })
    return () => { alive = false; worker.terminate() }
  }, [model])
  useEffect(() => () => workerRef.current?.terminate(), [])

  const openSet = async (id: string) => {
    if (dirty && !window.confirm('Há alterações não salvas neste conjunto. Descartar e abrir outro?')) return
    try {
      const loaded = await window.desktop.loadWardrobeSet(modelSlot, id)
      if (!loaded) throw new Error('O conjunto não foi encontrado.')
      setDraft(loaded); setActiveSetId(id); setSelectedId(loaded.components[0]?.id ?? null); setDirty(false); setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível abrir o conjunto.') }
  }
  const importSheet = async (file?: File) => {
    if (!file || !model) return
    if (!/\.(png|jpe?g|webp)$/i.test(file.name)) { setError('Use uma imagem PNG, JPG ou WebP.'); return }
    setProcessing(true); setError('')
    try {
      const source = await readFile(file)
      workerRef.current?.terminate()
      const worker = new Worker(new URL('./wardrobeProcessor.worker.ts', import.meta.url), { type: 'module' })
      workerRef.current = worker
      const id = ++requestRef.current
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data
        if (message.id !== id) return
        setProcessing(false); worker.terminate(); workerRef.current = null
        if (message.type === 'error') { setError(message.message); return }
        if (!message.pieces.length) { setError('Não encontrei peças visíveis. Confira se a folha tem transparência entre as peças.'); return }
        const components = message.pieces.map((piece) => {
          const category = guessCategory(piece, message.width, message.height)
          const { png, ...metadata } = piece
          const bone = guessBone(category, piece.x + piece.width / 2, message.width, model)
          const positioned: WardrobeComponent = { ...metadata, category, attachedPartId: bone?.id ?? '', rotation: 0, originX: metadata.x, originY: metadata.y, originWidth: metadata.width, originHeight: metadata.height, dataUrl: dataUrl(png) }
          return { ...positioned, name: guessName(category, piece.x + piece.width / 2, message.width) }
        })
        setDraft({ schemaVersion: 1, id: crypto.randomUUID(), modelSlot, modelName: model.name, name: file.name.replace(/\.[^.]+$/, ''), width: model.width, height: model.height, components, updatedAt: new Date().toISOString() })
        setActiveSetId(null); setSelectedId(components[0]?.id ?? null); setDirty(true)
      }
      worker.onerror = () => { setProcessing(false); setError('Falha ao processar a imagem localmente.'); worker.terminate(); workerRef.current = null }
      worker.postMessage({ id, dataUrl: source })
    } catch (reason) { setProcessing(false); setError(reason instanceof Error ? reason.message : 'Não foi possível importar a imagem.') }
  }
  const updateComponent = (id: string, values: Partial<WardrobeComponent>) => { setDirty(true); setDraft((current) => current ? ({ ...current, components: current.components.map((component) => component.id === id ? { ...component, ...values } : component), updatedAt: new Date().toISOString() }) : current) }
  const calibrateSourceAnchor = (partId: string, x: number, y: number) => {
    if (!model) return
    const selectedPart = model.parts.find((part) => part.id === partId)
    if (!selectedPart) return
    const currentAnchor = partJointAnchor(selectedPart, model.joints) ?? { x: selectedPart.x + selectedPart.width / 2, y: selectedPart.y + selectedPart.height / 2 }
    const currentCenter = { x: selectedPart.x + selectedPart.width / 2, y: selectedPart.y + selectedPart.height / 2 }
    const radians = -selectedPart.rotation * Math.PI / 180
    const dx = currentAnchor.x - currentCenter.x
    const dy = currentAnchor.y - currentCenter.y
    const localX = dx * Math.cos(radians) - dy * Math.sin(radians)
    const localY = dx * Math.sin(radians) + dy * Math.cos(radians)
    const sourceCenter = { x: x - localX, y: y - localY }
    const sourceTransform = { x: sourceCenter.x - selectedPart.width / 2, y: sourceCenter.y - selectedPart.height / 2, width: selectedPart.width, height: selectedPart.height, rotation: 0, anchorVersion: 1 as const, jointAnchor: { x, y } }
    setDraft((current) => current ? { ...current, sourceOverrides: { ...current.sourceOverrides, [partId]: sourceTransform }, updatedAt: new Date().toISOString() } : current)
    setDirty(true)
    setCalibratingPartId(null)
    setError('Origem ajustada somente neste conjunto. Salve o conjunto para manter a calibração; o modelo original não será modificado.')
  }
  const handleArtboardPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!calibratingPartId || !previewRef.current) return
    event.preventDefault(); event.stopPropagation()
    const bounds = event.currentTarget.getBoundingClientRect()
    calibrateSourceAnchor(calibratingPartId, (event.clientX - bounds.left) / scale, (event.clientY - bounds.top) / scale)
  }
  const moveComponentLayer = (id: string, direction: -1 | 1) => {
    setDirty(true)
    setDraft((current) => {
      if (!current) return current
      const index = current.components.findIndex((component) => component.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.components.length) return current
      const components = [...current.components]
      ;[components[index], components[target]] = [components[target], components[index]]
      return { ...current, components, updatedAt: new Date().toISOString() }
    })
  }
  const beginPieceDrag = (event: ReactPointerEvent<HTMLImageElement>, component: WardrobeComponent) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    if (calibratingPartId && !testPose) {
      const bounds = event.currentTarget.parentElement?.getBoundingClientRect()
      if (bounds) calibrateSourceAnchor(calibratingPartId, (event.clientX - bounds.left) / scale, (event.clientY - bounds.top) / scale)
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    const testOffset = testPose ? testDragOffsets[component.id] ?? { x: 0, y: 0 } : { x: 0, y: 0 }
    pieceDragRef.current = { pointerId: event.pointerId, componentId: component.id, pointerX: event.clientX, pointerY: event.clientY, originX: component.x + testOffset.x, originY: component.y + testOffset.y }
    setSelectedId(component.id)
  }
  const movePieceDrag = (event: ReactPointerEvent<HTMLImageElement>) => {
    const drag = pieceDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const delta = { x: (event.clientX - drag.pointerX) / scale, y: (event.clientY - drag.pointerY) / scale }
    const component = draft?.components.find((item) => item.id === drag.componentId)
    const modelBone = component && fittedBone(model?.parts.find((part) => part.id === component.attachedPartId), draft)
    const poseBone = component && testPose?.parts.find((part) => part.id === component.attachedPartId)
    const sourceDelta = testPose && modelBone && poseBone ? poseDeltaToSource(delta, modelBone, poseBone) : delta
    const x = drag.originX + sourceDelta.x
    const y = drag.originY + sourceDelta.y
    if (testPose) {
      if (component) setTestDragOffsets((current) => ({ ...current, [drag.componentId]: { x: x - component.x, y: y - component.y } }))
    } else updateComponent(drag.componentId, { x, y })
  }
  const finishPieceDrag = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (pieceDragRef.current?.pointerId === event.pointerId) pieceDragRef.current = null
  }
  const nudgeSelected = (dx: number, dy: number) => { if (selected) updateComponent(selected.id, { x: selected.x + dx, y: selected.y + dy }) }
  const resizeSelected = (factor: number) => {
    if (!selected) return
    const width = selected.width * factor; const height = selected.height * factor
    updateComponent(selected.id, { originX: selected.originX ?? selected.x, originY: selected.originY ?? selected.y, originWidth: selected.originWidth ?? selected.width, originHeight: selected.originHeight ?? selected.height, x: selected.x + (selected.width - width) / 2, y: selected.y + (selected.height - height) / 2, width, height })
  }
  const scaleSelectedAxis = (axis: 'width' | 'height', value: number) => {
    if (!selected || !Number.isFinite(value)) return
    const originWidth = selected.originWidth ?? selected.width
    const originHeight = selected.originHeight ?? selected.height
    const centerX = selected.x + selected.width / 2
    const centerY = selected.y + selected.height / 2
    const ratio = value / (axis === 'width' ? originWidth : originHeight)
    const width = axis === 'width' ? value : lockAspectRatio ? originWidth * ratio : selected.width
    const height = axis === 'height' ? value : lockAspectRatio ? originHeight * ratio : selected.height
    updateComponent(selected.id, { originX: selected.originX ?? selected.x, originY: selected.originY ?? selected.y, originWidth, originHeight, x: centerX - width / 2, y: centerY - height / 2, width, height })
  }
  const restoreSelectedOrigin = () => {
    if (!selected) return
    updateComponent(selected.id, { x: selected.originX ?? selected.x, y: selected.originY ?? selected.y, width: selected.originWidth ?? selected.width, height: selected.originHeight ?? selected.height, rotation: 0 })
  }
  const save = async () => {
    if (!draft || !draft.components.length || saving) return
    setSaving(true); setError('')
    try {
      const set: WardrobeSet = { ...draft, modelSlot, modelName: model?.name ?? draft.modelName, updatedAt: new Date().toISOString() }
      const serialized: WardrobeSetSave = { ...set, components: set.components.map(({ dataUrl: _dataUrl, ...component }) => component) }
      await window.desktop.saveWardrobeSet(modelSlot, serialized, set.components.map(({ id, dataUrl: image }) => ({ id, dataUrl: image })))
      setDraft(set); setActiveSetId(set.id); setDirty(false); setSets(await window.desktop.listWardrobeSets(modelSlot))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o conjunto.') }
    finally { setSaving(false) }
  }
  const deleteSet = async () => {
    if (!activeSetId || !window.confirm(`Excluir permanentemente o conjunto “${draft?.name ?? activeSetId}”?`)) return
    try { await window.desktop.deleteWardrobeSet(modelSlot, activeSetId); setDraft(null); setActiveSetId(null); setSelectedId(null); setDirty(false); setSets(await window.desktop.listWardrobeSets(modelSlot)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível excluir o conjunto.') }
  }
  const openTestPosePicker = async () => {
    const missingOrigins = Array.from(new Set((draft?.components ?? []).filter((component) => {
      const bone = fittedBone(model?.parts.find((part) => part.id === component.attachedPartId), draft)
      return !bone?.sourceTransform
    }).map((component) => model?.parts.find((part) => part.id === component.attachedPartId)?.name ?? component.name)))
    if (missingOrigins.length) {
      setError(`Calibre a origem na folha original antes do teste: ${missingOrigins.join(', ')}. Selecione cada peça do conjunto e use “Calibrar origem”.`)
      return
    }
    setError('')
    setTestPosePickerOpen(true)
    setTestPoseLoading(true)
    try {
      const slots = await window.desktop.listFabricatorPoseSlots(modelSlot)
      setTestPoseSlots(slots.filter((slot): slot is NonNullable<typeof slot> => slot !== null))
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as poses deste modelo.') }
    finally { setTestPoseLoading(false) }
  }
  const loadTestPose = async (slot: number) => {
    setTestPoseLoading(true)
    try {
      const pose = await window.desktop.loadFabricatorPose(modelSlot, slot)
      if (!pose) throw new Error('Esta pose não está mais disponível.')
      setTestDragOffsets({}); setTestPose(pose); setTestPosePickerOpen(false); setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível abrir esta pose.') }
    finally { setTestPoseLoading(false) }
  }
  const exitTestPose = () => { setTestPose(null); setTestDragOffsets({}) }

  return <section className="fabricator-workspace wardrobe-workspace" aria-label="Biblioteca de roupas">
    <header className="wardrobe-toolbar">
      <div className="wardrobe-title"><span className="model-slot-logo"><Icon name="shirt" /></span><span><strong>Roupas</strong><small>Biblioteca independente por modelo</small></span></div>
      <label className="wardrobe-model-select">Modelo<select disabled={Boolean(testPose)} value={modelSlot} onChange={(event) => { if (dirty && !window.confirm('Há alterações não salvas. Descartar e trocar de modelo?')) return; setTestPose(null); setModelSlot(Number(event.target.value)) }}>{models.map((item, index) => <option key={index + 1} value={index + 1} disabled={!item}>{String(index + 1).padStart(2, '0')} · {item?.name ?? 'Vazio'}</option>)}</select></label>
      {draft && <input aria-label="Nome do conjunto" className="wardrobe-name-input" disabled={Boolean(testPose)} value={draft.name} onChange={(event) => { setDirty(true); setDraft((current) => current ? { ...current, name: event.target.value } : current) }} placeholder="Nome do conjunto" />}
      <div className="wardrobe-toolbar-actions"><span className={`wardrobe-save-state${dirty ? ' pending' : ''}`}><i />{dirty ? 'Alterações não salvas' : model ? `${model.parts.length} peças no modelo` : 'Escolha um modelo salvo'}</span><button className="pose-button secondary" disabled={!model || processing || Boolean(testPose)} onClick={() => { if (dirty && !window.confirm('Descartar as alterações atuais e importar outra folha?')) return; inputRef.current?.click() }} type="button"><Icon name="plus" /> Importar folha</button>{testPose ? <button className="pose-button danger" onClick={exitTestPose} type="button"><Icon name="eyeOff" /> Sair do teste</button> : <button className="pose-button secondary" disabled={!model || !draft?.components.length} onClick={() => void openTestPosePicker()} type="button"><Icon name="eye" /> Testar pose</button>}<button className="pose-button primary" disabled={!draft || saving || Boolean(testPose)} onClick={() => void save()} type="button"><Icon name="check" />{saving ? 'Salvando…' : activeSetId ? 'Salvar alterações' : 'Salvar conjunto'}</button>{activeSetId && <button className="pose-icon-button" title="Excluir conjunto" disabled={Boolean(testPose)} onClick={() => void deleteSet()} type="button"><Icon name="trash" /></button>}<input ref={inputRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { void importSheet(event.target.files?.[0]); event.currentTarget.value = '' }} /></div>
    </header>
    {error && <div className="wardrobe-error" role="alert">{error}<button onClick={() => setError('')} type="button">Fechar</button></div>}
    <div className="wardrobe-body">
      <aside className="wardrobe-library"><header><span><strong>Conjuntos</strong><small>{sets.length} salvos para este modelo</small></span><span className="wardrobe-count">{sets.length}</span></header><div className="wardrobe-set-list">{sets.map((set) => <button className={`wardrobe-set-row${activeSetId === set.id ? ' active' : ''}`} key={set.id} disabled={Boolean(testPose)} onClick={() => void openSet(set.id)} type="button"><span className="wardrobe-set-icon"><Icon name="shirt" /></span><span><b>{set.name}</b><small>{set.componentCount} peças</small></span><Icon name="chevronRight" /></button>)}{!sets.length && <div className="wardrobe-library-empty"><Icon name="box" /><span>Nenhum conjunto salvo.<br />Importe sua primeira folha.</span></div>}</div><div className="wardrobe-category-legend"><strong>Categorias</strong>{categories.map((category) => <span key={category}><i />{categoryNames[category]}</span>)}</div></aside>
      <section className="wardrobe-preview-card"><header><span><i /> {testPose ? `TESTE DA POSE · ${testPose.name}` : 'PRÉVIA DE ENCAIXE · FOLHA ORIGINAL'}</span><span>{previewProject ? `${previewProject.width} × ${previewProject.height}` : 'Sem modelo'}</span></header><div ref={previewRef} className={`wardrobe-preview-stage${testPose ? ' testing-pose' : ''}`}>{previewProject && <div className={`wardrobe-artboard${calibratingPartId ? ' calibrating-origin' : ''}`} onPointerDown={handleArtboardPointerDown} style={{ width: previewProject.width * scale, height: previewProject.height * scale }}>
        {!testPose && model && referencePreview?.sourceDataUrl === model.sourceDataUrl && <img className="wardrobe-base-image" src={referencePreview.imageDataUrl} alt={`Folha original desmontada do modelo ${model.name}`} title="Referência original desmontada com chroma key; o modelo salvo não será alterado" style={{ left: 0, top: 0, width: previewProject.width * scale, height: previewProject.height * scale, zIndex: 1 }} />}
        {testPose && previewPoseParts.map((part, index) => <img key={part.id} className="wardrobe-pose-body-part" src={part.dataUrl} alt={part.name} draggable={false} style={{ left: part.x * scale, top: part.y * scale, width: part.width * scale, height: part.height * scale, zIndex: 2 + index * previewLayerStride, transform: `rotate(${part.rotation}deg)` }} />)}
        {draft?.components.map((component, index) => {
          const layer = getBodyLayer(model, component.attachedPartId)
          const layerBand = testPose ? previewLayerStride : draft.components.length + 1
          const modelBone = fittedBone(model?.parts.find((part) => part.id === component.attachedPartId), draft)
          const poseBone = testPose?.parts.find((part) => part.id === component.attachedPartId)
          const testOffset = testDragOffsets[component.id] ?? { x: 0, y: 0 }
          const componentX = component.x + (testPose ? testOffset.x : 0)
          const componentY = component.y + (testPose ? testOffset.y : 0)
          const poseMatrix = testPose && modelBone?.sourceTransform && poseBone
            ? mapWardrobeComponentToPose({ ...component, x: componentX, y: componentY }, modelBone, poseBone)
            : null
          const poseLayer = testPose?.layerOrder.indexOf(component.attachedPartId) ?? -1
          const zIndex = testPose ? 3 + Math.max(0, poseLayer) * layerBand + index : 2 + layer * layerBand + index
          const imageClassName = `wardrobe-preview-part${component.id === selectedId ? ' selected' : ''}`
          const imageTitle = `${component.name} · ${categoryNames[component.category]} · camada do modelo ${layer + 1}`
          if (!testPose) return <img key={component.id} className={imageClassName} src={component.dataUrl} alt={component.name} title={imageTitle} draggable={false} onClick={() => setSelectedId(component.id)} onPointerDown={(event) => beginPieceDrag(event, component)} onPointerMove={movePieceDrag} onPointerUp={finishPieceDrag} onPointerCancel={finishPieceDrag} style={{ left: component.x * scale, top: component.y * scale, width: component.width * scale, height: component.height * scale, zIndex, transform: `rotate(${component.rotation}deg)` }} />
          // Never silently render a missing binding in the reference-sheet coordinates.
          if (!poseMatrix) return null
          const dimensions = { position: 'absolute' as const, left: 0, top: 0, width: component.width * scale, height: component.height * scale, transformOrigin: '0 0' }
          return <div key={component.id} className="wardrobe-pose-garment" style={{ inset: 0, zIndex, pointerEvents: 'none' }}>
            <img className={imageClassName} src={component.dataUrl} alt={component.name} title={imageTitle} draggable={false} onClick={() => setSelectedId(component.id)} onPointerDown={(event) => beginPieceDrag(event, component)} onPointerMove={movePieceDrag} onPointerUp={finishPieceDrag} onPointerCancel={finishPieceDrag} style={{ ...dimensions, pointerEvents: 'auto', transform: cssAffine(poseMatrix, scale) }} />
          </div>
        })}
      </div>}{!model && <div className="wardrobe-empty"><Icon name="shirt" /><strong>Selecione um modelo salvo</strong><small>O modelo será usado como guia na prévia de encaixe.</small></div>}{model && !draft && !testPose && <div className="wardrobe-stage-hint">Importe uma folha para começar · fundo transparente preservado</div>}{testPose && <div className="wardrobe-stage-hint wardrobe-test-hint">Teste temporário · a pose salva não será alterada</div>}{calibratingPartId && <div className="wardrobe-stage-hint wardrobe-calibration-hint">Clique na junta de “{model?.parts.find((part) => part.id === calibratingPartId)?.name}” na folha original</div>}<div className="wardrobe-zoom"><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.min(2.2, value + .1))} type="button">+</button><button onClick={() => setZoom((value) => Math.max(.55, value - .1))} type="button">−</button></div>{processing && <div className="wardrobe-processing"><span className="model-spinner" />Detectando peças transparentes…</div>}</div><footer>{testPose ? 'Arraste as roupas para testar o encaixe. Use “Sair do teste” para voltar à folha original.' : 'A posição original da folha é preservada. Arraste cada peça para encaixar; use os controles rápidos para ajustar.'}</footer></section>
      <aside className="wardrobe-edit-panel"><header><span><strong>Peças do conjunto</strong><small>{draft ? `${draft.components.length} partes detectadas` : 'Recortes automáticos'}</small></span>{draft && <span className="wardrobe-count">{draft.components.length}</span>}</header>
        {testPose ? <div className="wardrobe-edit-empty"><Icon name="eye" /><strong>Teste somente visual</strong><small>Arraste a roupa na prévia para experimentar ajustes temporários. Saia do teste para editar e salvar o conjunto.</small></div> : draft ? <><div className="wardrobe-component-list">{draft.components.map((component) => <button key={component.id} className={`wardrobe-component-row${selectedId === component.id ? ' active' : ''}`} onClick={() => setSelectedId(component.id)} type="button"><img src={component.dataUrl} alt="" /><span><b>{component.name}</b><small>{categoryNames[component.category]}</small></span></button>)}</div>{selected && <div className="wardrobe-fields"><div className="wardrobe-field-title"><strong>Editar peça · camada do modelo {getBodyLayer(model, selected.attachedPartId) + 1}</strong><button title="Subir camada" aria-label="Subir camada" disabled={selectedIndex === (draft?.components.length ?? 0) - 1} onClick={() => moveComponentLayer(selected.id, 1)} type="button">↑</button><button title="Descer camada" aria-label="Descer camada" disabled={selectedIndex <= 0} onClick={() => moveComponentLayer(selected.id, -1)} type="button">↓</button><button title="Remover esta peça do conjunto" onClick={() => { setDraft((current) => current ? { ...current, components: current.components.filter((component) => component.id !== selected.id) } : current); setSelectedId(draft.components.find((component) => component.id !== selected.id)?.id ?? null); setDirty(true) }} type="button"><Icon name="trash" /></button></div><label>Nome<input value={selected.name} onChange={(event) => updateComponent(selected.id, { name: event.target.value })} /></label><label>Categoria<select value={selected.category} onChange={(event) => updateComponent(selected.id, { category: event.target.value as WardrobeCategory })}>{categories.map((category) => <option key={category} value={category}>{categoryNames[category]}</option>)}</select></label><label>Parte correspondente<select value={selected.attachedPartId} onChange={(event) => updateComponent(selected.id, { attachedPartId: event.target.value })}>{model?.parts.map((part) => <option key={part.id} value={part.id}>{part.name}{part.sourceTransform ? '' : ' · calibrar origem'}</option>)}</select></label>{(() => { const linkedPart = model?.parts.find((part) => part.id === selected.attachedPartId); return linkedPart && !linkedPart.sourceTransform ? <button className="pose-button secondary wardrobe-calibrate-button" onClick={() => { setTestPose(null); setCalibratingPartId(linkedPart.id); setError('') }} type="button"><Icon name="frame" /> Calibrar origem na folha</button> : null })()}<div className="wardrobe-quick-controls"><div className="wardrobe-nudge-pad"><button aria-label="Mover para cima" title="Mover para cima" onClick={() => nudgeSelected(0, -5)} type="button">↑</button><button aria-label="Mover para esquerda" title="Mover para esquerda" onClick={() => nudgeSelected(-5, 0)} type="button">←</button><span>mover</span><button aria-label="Mover para direita" title="Mover para direita" onClick={() => nudgeSelected(5, 0)} type="button">→</button><button aria-label="Mover para baixo" title="Mover para baixo" onClick={() => nudgeSelected(0, 5)} type="button">↓</button></div><div className="wardrobe-quick-actions"><button title="Diminuir tamanho em 10%" onClick={() => resizeSelected(.9)} type="button">− Tamanho</button><button title="Aumentar tamanho em 10%" onClick={() => resizeSelected(1.1)} type="button">+ Tamanho</button><button title="Girar 15 graus para a esquerda" onClick={() => updateComponent(selected.id, { rotation: selected.rotation - 15 })} type="button">↶ 15°</button><button title="Girar 15 graus para a direita" onClick={() => updateComponent(selected.id, { rotation: selected.rotation + 15 })} type="button">↷ 15°</button><button className="wardrobe-origin-button" onClick={restoreSelectedOrigin} type="button">Voltar à posição original</button></div></div><section className="wardrobe-scale-controls" aria-label="Escala horizontal e vertical"><div className="wardrobe-scale-heading"><strong>Escala da peça</strong><label className="wardrobe-aspect-lock"><input type="checkbox" checked={lockAspectRatio} onChange={(event) => setLockAspectRatio(event.target.checked)} /><span>Manter proporção</span></label></div><label className="wardrobe-scale-row"><span><b>↔ Horizontal</b><output>{Math.round(selected.width / (selected.originWidth ?? selected.width) * 100)}%</output></span><input aria-label="Escala horizontal" type="range" min="10" max="300" step="1" value={Math.max(10, Math.min(300, Math.round(selected.width / (selected.originWidth ?? selected.width) * 100)))} onChange={(event) => scaleSelectedAxis('width', (selected.originWidth ?? selected.width) * Number(event.target.value) / 100)} /></label><label className="wardrobe-scale-row"><span><b>↕ Vertical</b><output>{Math.round(selected.height / (selected.originHeight ?? selected.height) * 100)}%</output></span><input aria-label="Escala vertical" type="range" min="10" max="300" step="1" value={Math.max(10, Math.min(300, Math.round(selected.height / (selected.originHeight ?? selected.height) * 100)))} onChange={(event) => scaleSelectedAxis('height', (selected.originHeight ?? selected.height) * Number(event.target.value) / 100)} /></label></section><div className="wardrobe-number-grid">{([['x', 'X'], ['y', 'Y'], ['width', 'Largura'], ['height', 'Altura'], ['rotation', 'Ângulo']] as const).map(([field, label]) => <label key={field}>{label}<input type="number" step={field === 'rotation' ? 1 : 2} value={Number(selected[field].toFixed(1))} onChange={(event) => { const value = Number(event.target.value); if (field === 'width' || field === 'height') scaleSelectedAxis(field, value); else updateComponent(selected.id, { [field]: value }) }} /></label>)}</div><small className="wardrobe-note">Este vínculo ficará salvo para a futura integração em Customizar.</small></div>}</> : <div className="wardrobe-edit-empty"><Icon name="sparkles" /><strong>Pré-encaixe automático</strong><small>A folha é separada por transparência. Depois você revisa categoria, peça do corpo e posição de cada recorte.</small></div>}
      </aside>
    </div>
    {testPosePickerOpen && <div className="pose-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !testPoseLoading) setTestPosePickerOpen(false) }}><section className="pose-model-picker" role="dialog" aria-modal="true" aria-labelledby="wardrobe-test-picker-title"><header><span><small>TESTE DE ROUPA</small><strong id="wardrobe-test-picker-title">Escolha uma pose</strong></span><button onClick={() => setTestPosePickerOpen(false)} aria-label="Fechar" type="button">×</button></header><p>A roupa será exibida sobre uma cópia visual da pose. A pose salva não será modificada.</p><div className="pose-model-options">{testPoseLoading && <div className="pose-model-none">Carregando poses…</div>}{testPoseSlots.map((pose) => pose && <button key={`pose-${pose.slot}`} className="pose-model-option" disabled={testPoseLoading} onClick={() => void loadTestPose(pose.slot)} type="button"><span className="pose-model-number">{String(pose.slot).padStart(2, '0')}</span><span><b>{pose.name}</b><small>{pose.partCount} peças · {new Date(pose.updatedAt).toLocaleDateString('pt-BR')}</small></span><Icon name="chevronRight" /></button>)}{!testPoseLoading && testPoseSlots.length === 0 && <div className="pose-model-none">Este modelo ainda não tem poses salvas.</div>}</div></section></div>}
  </section>
}
