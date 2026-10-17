import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { FabricatorHistoryState, FabricatorPose, FabricatorPoseSummary, FabricatorProject, FabricatorProjectSave, FabricatorSlotSummary, ModelPart, WardrobeCategory, WardrobeComponent, WardrobeEdition, WardrobeSet, WardrobeSetSave, WardrobeSetSummary } from '../../../../../shared/fabricator'
import { Icon } from '../../../ui/components/Icon'
import { usePreviewBackground } from '../usePreviewBackground'
import { orderedParts, partJointAnchor, sourcePointFromCanvas } from '../models/rig'
import { isHeadPart } from '../models/resize'
import { resizeAroundAnchor } from '../../../../../shared/headShape'
import { bindWardrobeComponent, mapWardrobeComponentToPose, poseDeltaToSource } from './poseTransform'
import { splitWardrobeV2Reference, supportsWardrobeV2, wardrobeV2SourceUrl } from './wardrobeV2Reference'

type WorkerPiece = Omit<WardrobeComponent, 'category' | 'attachedPartId' | 'rotation' | 'dataUrl'> & { png: ArrayBuffer }
type WorkerMessage = { type: 'complete'; id: number; width: number; height: number; pieces: WorkerPiece[] } | { type: 'error'; id: number; message: string }
type ReferenceMessage = { type: 'complete'; id: number; png: ArrayBuffer } | { type: 'error'; id: number; message: string }
type PieceDrag = { pointerId: number; componentId: string; pointerX: number; pointerY: number; originX: number; originY: number }
type PreviewPanDrag = { pointerId: number; pointerX: number; pointerY: number; originX: number; originY: number }
type SourcePiece = { x: number; y: number; width: number; height: number; png: ArrayBuffer }
type SourceMessage = { type: 'complete'; id: number; parts: SourcePiece[] } | { type: 'error'; id: number; message: string } | { type: 'progress'; id: number; value: number }
type SourceReferencePart = { x: number; y: number; width: number; height: number; imageDataUrl: string }
type BodyDrag = { pointerId: number; partId: string; pointerX: number; pointerY: number; originX: number; originY: number }
type Point = { x: number; y: number }
const zeroOffset: Point = { x: 0, y: 0 }

function withSourceFrame(part: ModelPart, reference?: SourceReferencePart): ModelPart {
  if (!reference) return part
  return { ...part, sourceTransform: { ...part.sourceTransform, x: reference.x, y: reference.y, width: reference.width, height: reference.height, rotation: 0 } }
}

function sourcePreviewFrame(part: ModelPart, source: SourceReferencePart): SourceReferencePart {
  const original = part.sourceTransform
  if (!isHeadPart(part) || !part.resizeBase || !original) return source
  const sourceWidth = original.width ?? source.width
  const sourceHeight = original.height ?? source.height
  const anchor = original.jointAnchor ?? { x: source.x + source.width / 2, y: source.y + source.height / 2 }
  const resized = resizeAroundAnchor(
    { ...source, rotation: original.rotation },
    source.width * part.width / sourceWidth,
    source.height * part.height / sourceHeight,
    anchor
  )
  return { ...source, x: resized.x, y: resized.y, width: resized.width, height: resized.height }
}

function bindingMarker(component: WardrobeComponent, bone: ModelPart): Point {
  const source = bone.sourceTransform
  const bx = source?.x ?? bone.x; const by = source?.y ?? bone.y
  const bw = source?.width ?? bone.width; const bh = source?.height ?? bone.height
  const left = Math.max(component.x, bx); const right = Math.min(component.x + component.width, bx + bw)
  const top = Math.max(component.y, by); const bottom = Math.min(component.y + component.height, by + bh)
  if (right > left && bottom > top) return { x: (left + right) / 2, y: (top + bottom) / 2 }
  return { x: Math.max(bx, Math.min(bx + bw, component.x + component.width / 2)), y: Math.max(by, Math.min(by + bh, component.y + component.height / 2)) }
}
function rebindComponents(components: WardrobeComponent[], reference: FabricatorProject): { components: WardrobeComponent[]; changed: boolean } {
  const bones = new Map(reference.parts.map((part) => [part.id, part]))
  let changed = false
  const rebound = components.map((component) => {
    const bone = bones.get(component.attachedPartId)
    if (!bone) return component
    const expected = bindWardrobeComponent(component, bone)
    const current = component.binding
    if (current?.boneId === expected.boneId && Math.abs(current.localCenterX - expected.localCenterX) < 0.00001 && Math.abs(current.localCenterY - expected.localCenterY) < 0.00001 && Math.abs(current.widthRatio - expected.widthRatio) < 0.00001 && Math.abs(current.heightRatio - expected.heightRatio) < 0.00001 && Math.abs(current.relativeRotation - expected.relativeRotation) < 0.00001) return component
    changed = true
    return { ...component, binding: expected }
  })
  return { components: changed ? rebound : components, changed }
}
const categoryNames: Record<WardrobeCategory, string> = {
  camisa: 'Camisas', jaqueta: 'Jaquetas', 'manga-superior': 'Mangas superiores', 'manga-inferior': 'Mangas inferiores', luvas: 'Luvas', capa: 'Capa', cinto: 'Cinto', oculos: 'Óculos', 'acessorio-cabeca': 'Acessórios de cabeça', saia: 'Saia', 'calca-coxa': 'Calças · coxas', 'calca-canela': 'Calças · canelas', shorts: 'Shorts', meia: 'Meias', sapato: 'Sapatos'
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
function guessCategory(piece: WorkerPiece, width: number, height: number, edition: WardrobeEdition): WardrobeCategory {
  const cx = (piece.x + piece.width / 2) / width; const cy = (piece.y + piece.height / 2) / height
  if (edition === 2) {
    const central = cx > .34 && cx < .66
    const outer = cx < .34 || cx > .66
    const aspect = piece.width / Math.max(1, piece.height)
    // Dev 2.0 sheets may place artwork freely; classify against the fixed body zones,
    // not the tighter coordinates used by the legacy wardrobe sheet.
    if (cy < .22 && central) return aspect > 1.45 ? 'oculos' : 'acessorio-cabeca'
    if (cy > .88 && cx > .28 && cx < .72) return 'sapato'
    if (cy >= .22 && cy < .34 && outer) return 'manga-superior'
    if (cy >= .34 && cy < .51 && outer) return cy > .46 ? 'luvas' : 'manga-inferior'
    if (cy >= .3 && cy < .49 && central) return 'camisa'
    if (cy >= .49 && cy < .67 && central) return 'calca-coxa'
    if (cy >= .67 && cy < .89 && cx > .3 && cx < .7) return 'calca-canela'
  }
  if (cy < .19 && Math.abs(cx - .5) > .1) return 'manga-superior'
  if (cy < .39 && cx > .34 && cx < .66) return 'camisa'
  if (cy > .62) return 'calca-canela'
  if (cy > .34) return 'calca-coxa'
  return 'manga-inferior'
}
function guessName(category: WardrobeCategory, x: number, width: number): string {
  if (category === 'camisa') return 'Camisa'
  if (category === 'jaqueta') return 'Jaqueta'
  if (category === 'capa') return 'Capa'
  if (category === 'cinto') return 'Cinto'
  if (category === 'oculos') return 'Óculos'
  if (category === 'acessorio-cabeca') return 'Acessório de cabeça'
  if (category === 'saia') return 'Saia'
  if (category === 'shorts') return 'Bermuda'
  if (category === 'meia') return `Meia ${x < width / 2 ? 'esquerda' : 'direita'}`
  if (category === 'sapato') return `Sapato ${x < width / 2 ? 'esquerdo' : 'direito'}`
  const side = x < width / 2 ? 'esquerda' : 'direita'
  if (category === 'luvas') return `Luvas ${side}`
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
function serializeModel(model: FabricatorProject): FabricatorProjectSave {
  const { sourceDataUrl: _sourceDataUrl, parts, ...metadata } = model
  return { ...metadata, parts: parts.map(({ dataUrl: _dataUrl, chromaBaseDataUrl: _chromaBaseDataUrl, ...part }) => part) }
}
function guessBone(category: WardrobeCategory, x: number, width: number, model: FabricatorProject): FabricatorProject['parts'][number] | undefined {
  const side = x < width / 2 ? 'left' : 'right'
  const centerCategory = category === 'camisa' || category === 'jaqueta' || category === 'capa' || category === 'cinto' || category === 'oculos' || category === 'acessorio-cabeca' || category === 'saia'
  const target = category === 'capa' ? { x: .5, y: .31 }
    : category === 'oculos' || category === 'acessorio-cabeca' ? { x: .5, y: .2 }
      : category === 'cinto' || category === 'saia' ? { x: .5, y: .49 }
      : category === 'camisa' || category === 'jaqueta' ? { x: .5, y: .36 }
    : category === 'shorts' ? { x: side === 'left' ? .42 : .58, y: .42 }
      : category === 'meia' ? { x: side === 'left' ? .43 : .57, y: .83 }
        : category === 'sapato' ? { x: side === 'left' ? .43 : .57, y: .94 }
        : category === 'manga-superior' ? { x: side === 'left' ? .27 : .73, y: .27 }
          : category === 'manga-inferior' ? { x: side === 'left' ? .22 : .78, y: .45 }
            : category === 'luvas' ? { x: side === 'left' ? .21 : .79, y: .49 }
              : category === 'calca-coxa' ? { x: side === 'left' ? .42 : .58, y: .58 }
                : { x: side === 'left' ? .38 : .62, y: .82 }
  const candidates = model.parts.filter((part) => {
    const partX = part.sourceTransform?.x ?? part.x
    const centerX = (partX + part.width / 2) / model.width
    return centerCategory ? centerX > .3 && centerX < .7 : side === 'left' ? centerX < .5 : centerX >= .5
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
export function WardrobeWorkspace({ edition = 1 }: { edition?: WardrobeEdition }) {
  const [previewBackground, setPreviewBackground] = usePreviewBackground()
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
  const [previewPan, setPreviewPan] = useState<Point>(zeroOffset)
  const [lockAspectRatio, setLockAspectRatio] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const workerRef = useRef<Worker | null>(null)
  const requestRef = useRef(0)
  const pieceDragRef = useRef<PieceDrag | null>(null)
  const previewPanDragRef = useRef<PreviewPanDrag | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const artboardRef = useRef<HTMLDivElement>(null)
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 })
  const [referencePreview, setReferencePreview] = useState<{ sourceDataUrl: string; imageDataUrl: string } | null>(null)
  const [sourceReference, setSourceReference] = useState<{ sourceDataUrl: string; parts: Record<string, SourceReferencePart> } | null>(null)
  const [moveBodyMode, setMoveBodyMode] = useState(false)
  const [showBindingMarkers, setShowBindingMarkers] = useState(true)
  const [bodyOffsets, setBodyOffsets] = useState<Record<string, Point>>({})
  const bodyDragRef = useRef<BodyDrag | null>(null)
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
  const referenceSource = model ? edition === 2 ? wardrobeV2SourceUrl : model.sourceDataUrl : null
  const sourceParts = model && sourceReference?.sourceDataUrl === referenceSource ? sourceReference.parts : null
  const referenceModel = model && sourceParts ? { ...model, parts: model.parts.map((part) => withSourceFrame(part, sourceParts[part.id])) } : model
  const referenceBone = (partId: string) => referenceModel?.parts.find((part) => part.id === partId)

  const reload = useCallback(async (targetSlot: number) => {
    setError('')
    try {
      const [savedModels, reference, library] = await Promise.all([window.desktop.listFabricatorSlots(), window.desktop.loadFabricatorSlot(targetSlot), window.desktop.listWardrobeSets(targetSlot)])
      setModels(savedModels)
      const firstAvailableModel = savedModels.find((slot) => slot && (edition === 1 || slot.partCount === 10))
      if (!reference && firstAvailableModel && firstAvailableModel.slot !== targetSlot) { setModels(savedModels); setModelSlot(firstAvailableModel.slot); return }
      if (edition === 2 && reference && !supportsWardrobeV2(reference)) throw new Error('Roupas Dev 2.0 requer o modelo original de 1122 × 1402 com 10 partes correspondente à folha enviada.')
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
            if (edition === 1) {
              try { await window.desktop.saveFabricatorProject(serializeModel(recoveredModel), []) }
              catch { setError('Recuperei a origem das peças pelo histórico, mas não consegui gravá-la no modelo. Ela ficará disponível nesta sessão.') }
            }
          }
        }
      }
      setModels(savedModels); setModel(recoveredModel); setSets(library.filter((set) => set.edition === edition))
      setActiveSetId(null); setDraft(null); setSelectedId(null); setDirty(false); setBodyOffsets({}); setMoveBodyMode(false)
    } catch (reason) {
      setModel(null); setSets([]); setDraft(null); setActiveSetId(null); setSelectedId(null)
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a biblioteca de roupas.')
    }
  }, [edition])
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
      if (event.data.type === 'complete') {
        if (referenceSource) setReferencePreview({ sourceDataUrl: referenceSource, imageDataUrl: dataUrl(event.data.png) })
      } else setError(event.data.message)
      worker.terminate()
    }
    worker.onerror = () => { if (alive) setError('Não foi possível limpar o fundo verde da referência.'); worker.terminate() }
    worker.postMessage({ id: 1, sourceDataUrl: referenceSource, tolerance: model.tolerance })
    return () => { alive = false; worker.terminate() }
  }, [model, referenceSource])
  useEffect(() => {
    if (!model) { setSourceReference(null); return }
    if (edition === 2) {
      if (referencePreview?.sourceDataUrl !== referenceSource) { setSourceReference(null); return }
      let alive = true
      void splitWardrobeV2Reference(referencePreview.imageDataUrl, model).then((parts) => {
        if (alive) { setSourceReference({ sourceDataUrl: wardrobeV2SourceUrl, parts }); setError('') }
      }).catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)) })
      return () => { alive = false }
    }
    let alive = true
    setSourceReference(null)
    const worker = new Worker(new URL('../models/imageProcessor.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<SourceMessage>) => {
      if (!alive || event.data.type === 'progress') return
      if (event.data.type === 'error') { setError(`Não foi possível separar o corpo original: ${event.data.message}`); worker.terminate(); return }
      const pieces = event.data.parts
      // Reprocessing with a different chroma tolerance changes crop margins.
      // Import and reprocessing both sort components by y/x, so preserve that
      // stable order instead of rejecting valid pieces by their old dimensions.
      if (pieces.length !== model.parts.length) { setError(`A folha original gerou ${pieces.length} peças, mas o modelo salvo tem ${model.parts.length}. Ajuste o chroma do modelo para recuperar a mesma separação.`); worker.terminate(); return }
      const parts: Record<string, SourceReferencePart> = {}
      model.parts.forEach((part, index) => {
        const piece = pieces[index]
        parts[part.id] = { x: piece.x, y: piece.y, width: piece.width, height: piece.height, imageDataUrl: dataUrl(piece.png) }
      })
      setSourceReference({ sourceDataUrl: model.sourceDataUrl, parts })
      setError('')
      worker.terminate()
    }
    worker.onerror = () => { if (alive) setError('Não foi possível carregar as peças separadas do corpo original.'); worker.terminate() }
    worker.postMessage({ id: 1, sourceDataUrl: model.sourceDataUrl, tolerance: model.tolerance })
    return () => { alive = false; worker.terminate() }
  }, [model, edition, referencePreview, referenceSource])
  useEffect(() => {
    if (!sourceParts || !referenceModel || !draft) return
    const rebound = rebindComponents(draft.components, referenceModel)
    if (!rebound.changed) return
    setDraft((current) => current?.id === draft.id ? { ...current, components: rebindComponents(current.components, referenceModel).components } : current)
    setDirty(true)
  }, [sourceParts, draft?.id])
  useEffect(() => () => workerRef.current?.terminate(), [])

  const openSet = async (id: string) => {
    if (edition === 2 && !sourceParts) { setError('Aguarde a referência 2.0 carregar antes de abrir o conjunto.'); return }
    if (dirty && !window.confirm('Há alterações não salvas neste conjunto. Descartar e abrir outro?')) return
    try {
      const loaded = await window.desktop.loadWardrobeSet(modelSlot, id)
      if (!loaded || (loaded.edition ?? 1) !== edition) throw new Error('O conjunto não pertence a esta versão de Roupas Dev.')
      const rebound = referenceModel ? rebindComponents(loaded.components, referenceModel) : { components: loaded.components, changed: false }
      setDraft(rebound.changed ? { ...loaded, components: rebound.components } : loaded); setActiveSetId(id); setSelectedId(rebound.components[0]?.id ?? null); setDirty(rebound.changed); setBodyOffsets({}); setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível abrir o conjunto.') }
  }
  const importSheet = async (file?: File) => {
    if (!file || !model) return
    if (edition === 2 && !sourceParts) { setError('Aguarde a referência 2.0 carregar antes de importar a folha.'); return }
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
          const category = guessCategory(piece, message.width, message.height, edition)
          const { png, ...metadata } = piece
          const bone = guessBone(category, piece.x + piece.width / 2, message.width, referenceModel ?? model)
          const positioned: WardrobeComponent = { ...metadata, category, attachedPartId: bone?.id ?? '', rotation: 0, originX: metadata.x, originY: metadata.y, originWidth: metadata.width, originHeight: metadata.height, dataUrl: dataUrl(png) }
          if (bone) positioned.binding = bindWardrobeComponent(positioned, bone)
          return { ...positioned, name: guessName(category, piece.x + piece.width / 2, message.width) }
        })
        setDraft({ schemaVersion: 1, edition, id: crypto.randomUUID(), modelSlot, modelName: model.name, name: file.name.replace(/\.[^.]+$/, ''), width: model.width, height: model.height, components, updatedAt: new Date().toISOString() })
        setActiveSetId(null); setSelectedId(components[0]?.id ?? null); setDirty(true); setBodyOffsets({})
      }
      worker.onerror = () => { setProcessing(false); setError('Falha ao processar a imagem localmente.'); worker.terminate(); workerRef.current = null }
      worker.postMessage({ id, dataUrl: source, ...(edition === 2 ? { normalizeTo: { width: model.width, height: model.height } } : {}) })
    } catch (reason) { setProcessing(false); setError(reason instanceof Error ? reason.message : 'Não foi possível importar a imagem.') }
  }
  const updateComponent = (id: string, values: Partial<WardrobeComponent>) => {
    setDirty(true)
    setDraft((current) => current ? ({ ...current, components: current.components.map((component) => {
      if (component.id !== id) return component
      const updated = { ...component, ...values }
      const bone = referenceBone(updated.attachedPartId)
      if (bone && (component.binding || values.attachedPartId !== undefined)) updated.binding = bindWardrobeComponent(updated, bone)
      return updated
    }), updatedAt: new Date().toISOString() }) : current)
  }
  const fixSelectedBinding = () => {
    if (!selected) return
    const bone = referenceBone(selected.attachedPartId)
    if (!bone) return
    updateComponent(selected.id, { binding: bindWardrobeComponent(selected, bone) })
    setBodyOffsets({})
    setError('')
  }
  const calibrateSourceAnchor = async (partId: string, x: number, y: number) => {
    if (!model || edition === 2) return
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
    const parts = model.parts.map((part) => part.id === partId
      ? { ...part, sourceTransform: { x: sourceCenter.x - part.width / 2, y: sourceCenter.y - part.height / 2, width: part.width, height: part.height, rotation: 0, anchorVersion: 1 as const, jointAnchor: { x, y } } }
      : part)
    const calibrated = { ...model, parts, updatedAt: new Date().toISOString() }
    setModel(calibrated); setCalibratingPartId(null); setError('')
    try { await window.desktop.saveFabricatorProject(serializeModel(calibrated), []) }
    catch (reason) { setError(reason instanceof Error ? `Calibração aplicada nesta sessão, mas não foi salva: ${reason.message}` : 'Calibração aplicada nesta sessão, mas não foi salva.') }
  }
  const handleArtboardPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!calibratingPartId || !previewRef.current) return
    event.preventDefault(); event.stopPropagation()
    const bounds = event.currentTarget.getBoundingClientRect()
    void calibrateSourceAnchor(calibratingPartId, (event.clientX - bounds.left) / scale, (event.clientY - bounds.top) / scale)
  }
  const handlePreviewPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (edition !== 2 || moveBodyMode || testPose || calibratingPartId || event.button !== 0 || !artboardRef.current) return
    const target = event.target as HTMLElement
    if (target !== event.currentTarget && target !== artboardRef.current) return

    const bounds = artboardRef.current.getBoundingClientRect()
    const x = (event.clientX - bounds.left) / scale
    const y = (event.clientY - bounds.top) / scale
    const overBody = Boolean(model && sourceParts && model.parts.some((part) => {
      const source = sourceParts[part.id]
      if (!source) return false
      const frame = sourcePreviewFrame(part, source)
      const offset = bodyOffsets[part.id] ?? zeroOffset
      return x >= frame.x + offset.x && x <= frame.x + offset.x + frame.width && y >= frame.y + offset.y && y <= frame.y + offset.y + frame.height
    }))
    const overGarment = Boolean(draft?.components.some((component) => x >= component.x && x <= component.x + component.width && y >= component.y && y <= component.y + component.height))
    if (overBody || overGarment) return

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    previewPanDragRef.current = { pointerId: event.pointerId, pointerX: event.clientX, pointerY: event.clientY, originX: previewPan.x, originY: previewPan.y }
  }
  const movePreviewPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = previewPanDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setPreviewPan({ x: drag.originX + event.clientX - drag.pointerX, y: drag.originY + event.clientY - drag.pointerY })
  }
  const finishPreviewPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (previewPanDragRef.current?.pointerId === event.pointerId) previewPanDragRef.current = null
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
  const beginBodyDrag = (event: ReactPointerEvent<HTMLImageElement>, partId: string) => {
    if (!moveBodyMode || testPose || event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const offset = bodyOffsets[partId] ?? zeroOffset
    bodyDragRef.current = { pointerId: event.pointerId, partId, pointerX: event.clientX, pointerY: event.clientY, originX: offset.x, originY: offset.y }
    const attached = draft?.components.find((component) => component.binding?.boneId === partId)
    if (attached) setSelectedId(attached.id)
  }
  const moveBodyDrag = (event: ReactPointerEvent<HTMLImageElement>) => {
    const drag = bodyDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setBodyOffsets((current) => ({ ...current, [drag.partId]: { x: drag.originX + (event.clientX - drag.pointerX) / scale, y: drag.originY + (event.clientY - drag.pointerY) / scale } }))
  }
  const finishBodyDrag = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (bodyDragRef.current?.pointerId === event.pointerId) bodyDragRef.current = null
  }
  const beginPieceDrag = (event: ReactPointerEvent<HTMLElement>, component: WardrobeComponent) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    if (calibratingPartId && !testPose) {
      const bounds = event.currentTarget.parentElement?.getBoundingClientRect()
      if (bounds) void calibrateSourceAnchor(calibratingPartId, (event.clientX - bounds.left) / scale, (event.clientY - bounds.top) / scale)
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    const testOffset = testPose ? testDragOffsets[component.id] ?? { x: 0, y: 0 } : { x: 0, y: 0 }
    pieceDragRef.current = { pointerId: event.pointerId, componentId: component.id, pointerX: event.clientX, pointerY: event.clientY, originX: component.x + testOffset.x, originY: component.y + testOffset.y }
    setSelectedId(component.id)
  }
  const movePieceDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = pieceDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const delta = { x: (event.clientX - drag.pointerX) / scale, y: (event.clientY - drag.pointerY) / scale }
    const component = draft?.components.find((item) => item.id === drag.componentId)
    const modelBone = component && referenceBone(component.attachedPartId)
    const poseBone = component && testPose?.parts.find((part) => part.id === component.attachedPartId)
    const sourceDelta = testPose && modelBone && poseBone ? poseDeltaToSource(delta, modelBone, poseBone) : delta
    const x = drag.originX + sourceDelta.x
    const y = drag.originY + sourceDelta.y
    if (testPose) {
      if (component) setTestDragOffsets((current) => ({ ...current, [drag.componentId]: { x: x - component.x, y: y - component.y } }))
    } else updateComponent(drag.componentId, { x, y })
  }
  const finishPieceDrag = (event: ReactPointerEvent<HTMLElement>) => {
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
    if (!draft || !draft.components.length || saving || edition === 2 && !sourceParts) return
    setSaving(true); setError('')
    try {
      const set: WardrobeSet = { ...draft, edition, modelSlot, modelName: model?.name ?? draft.modelName, updatedAt: new Date().toISOString() }
      const serialized: WardrobeSetSave = { ...set, components: set.components.map(({ dataUrl: _dataUrl, ...component }) => component) }
      await window.desktop.saveWardrobeSet(modelSlot, serialized, set.components.map(({ id, dataUrl: image }) => ({ id, dataUrl: image })))
      setDraft(set); setActiveSetId(set.id); setDirty(false); setSets((await window.desktop.listWardrobeSets(modelSlot)).filter((item) => item.edition === edition))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o conjunto.') }
    finally { setSaving(false) }
  }
  const deleteSet = async () => {
    if (!activeSetId || !window.confirm(`Excluir permanentemente o conjunto “${draft?.name ?? activeSetId}”?`)) return
    try { await window.desktop.deleteWardrobeSet(modelSlot, activeSetId); setDraft(null); setActiveSetId(null); setSelectedId(null); setDirty(false); setSets((await window.desktop.listWardrobeSets(modelSlot)).filter((item) => item.edition === edition)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível excluir o conjunto.') }
  }
  const openTestPosePicker = async () => {
    if (!sourceParts) { setError('Aguarde a referência original do corpo carregar antes de testar a pose.'); return }
    const missingOrigins = Array.from(new Set((draft?.components ?? []).filter((component) => {
      const bone = referenceBone(component.attachedPartId)
      return !bone?.sourceTransform
    }).map((component) => referenceBone(component.attachedPartId)?.name ?? component.name)))
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
      setTestDragOffsets({}); setBodyOffsets({}); setMoveBodyMode(false); setTestPose(pose); setTestPosePickerOpen(false); setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível abrir esta pose.') }
    finally { setTestPoseLoading(false) }
  }
  const exitTestPose = () => { setTestPose(null); setTestDragOffsets({}) }

  const renderComponentList = () => <div className="wardrobe-component-list">{draft?.components.map((component) => <button key={component.id} className={`wardrobe-component-row${selectedId === component.id ? ' active' : ''}`} onClick={() => setSelectedId(component.id)} type="button"><img src={component.dataUrl} alt="" /><span><b>{component.name}</b><small>{categoryNames[component.category]}</small></span></button>)}</div>
  return <section className="fabricator-workspace wardrobe-workspace" aria-label={edition === 2 ? 'Biblioteca de roupas 2.0' : 'Biblioteca de roupas'}>
    <header className="wardrobe-toolbar">
      <div className="wardrobe-title"><span className="model-slot-logo"><Icon name="shirt" /></span><span><strong>{edition === 2 ? 'Roupas 2.0' : 'Roupas'}</strong><small>{edition === 2 ? 'Referência com mãos e pés separados' : 'Biblioteca independente por modelo'}</small></span></div>
      <label className="wardrobe-model-select">Modelo<select value={modelSlot} onChange={(event) => { if (dirty && !window.confirm('Há alterações não salvas. Descartar e trocar de modelo?')) return; setTestPose(null); setModelSlot(Number(event.target.value)) }}>{models.map((item, index) => <option key={index + 1} value={index + 1} disabled={!item || edition === 2 && item.partCount !== 10}>{String(index + 1).padStart(2, '0')} · {item?.name ?? 'Vazio'}</option>)}</select></label>
      {draft && <input aria-label="Nome do conjunto" className="wardrobe-name-input" value={draft.name} onChange={(event) => { setDirty(true); setDraft((current) => current ? { ...current, name: event.target.value } : current) }} placeholder="Nome do conjunto" />}
      <div className="wardrobe-toolbar-actions"><span className={`wardrobe-save-state${dirty ? ' pending' : ''}`}><i />{dirty ? 'Alterações não salvas' : model ? `${model.parts.length} peças no modelo` : 'Escolha um modelo salvo'}</span><button className="pose-button secondary" disabled={!model || processing} onClick={() => { if (dirty && !window.confirm('Descartar as alterações atuais e importar outra folha?')) return; inputRef.current?.click() }} type="button"><Icon name="plus" /> Importar folha</button>{testPose ? <button className="pose-button danger" onClick={exitTestPose} type="button"><Icon name="eyeOff" /> Sair do teste</button> : <button className="pose-button secondary" disabled={!model || !draft?.components.length} onClick={() => void openTestPosePicker()} type="button"><Icon name="eye" /> Testar pose</button>}<button className="pose-button primary" disabled={!draft || saving} onClick={() => void save()} type="button"><Icon name="check" />{saving ? 'Salvando…' : activeSetId ? 'Salvar alterações' : 'Salvar conjunto'}</button>{activeSetId && <button className="pose-icon-button" title="Excluir conjunto" onClick={() => void deleteSet()} type="button"><Icon name="trash" /></button>}<input ref={inputRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { void importSheet(event.target.files?.[0]); event.currentTarget.value = '' }} /></div>
    </header>
    {error && <div className="wardrobe-error" role="alert">{error}<button onClick={() => setError('')} type="button">Fechar</button></div>}
    <div className={`wardrobe-body${edition === 2 ? ' wardrobe-body-v2' : ''}`}>
      <aside className="wardrobe-library"><header><span><strong>Conjuntos</strong><small>{sets.length} salvos para este modelo</small></span><span className="wardrobe-count">{sets.length}</span></header><div className="wardrobe-set-list">{sets.map((set) => <button className={`wardrobe-set-row${activeSetId === set.id ? ' active' : ''}`} key={set.id} onClick={() => void openSet(set.id)} type="button"><span className="wardrobe-set-icon"><Icon name="shirt" /></span><span><b>{set.name}</b><small>{set.componentCount} peças</small></span><Icon name="chevronRight" /></button>)}{!sets.length && <div className="wardrobe-library-empty"><Icon name="box" /><span>Nenhum conjunto salvo.<br />Importe sua primeira folha.</span></div>}</div><div className="wardrobe-category-legend"><strong>Categorias</strong>{categories.map((category) => <span key={category}><i />{categoryNames[category]}</span>)}</div></aside>
      {edition === 2 && <aside className="wardrobe-catalog-panel" aria-label="Catálogo de peças do conjunto">
        <header><span><strong>Catálogo</strong><small>{draft ? `${draft.components.length} peças deste conjunto` : 'Escolha um conjunto'}</small></span>{draft && <span className="wardrobe-count">{draft.components.length}</span>}</header>
        {draft ? renderComponentList() : <div className="wardrobe-edit-empty"><Icon name="shirt" /><strong>Nenhum conjunto aberto</strong><small>Escolha um conjunto à esquerda para ver as peças.</small></div>}
      </aside>}
      <section className="wardrobe-preview-card"><header><span><i /> {testPose ? `TESTE DA POSE · ${testPose.name}` : edition === 2 ? 'PRÉVIA DE ENCAIXE · FOLHA 2.0' : 'PRÉVIA DE ENCAIXE · FOLHA ORIGINAL'}</span><span>{previewProject ? `${previewProject.width} × ${previewProject.height}` : 'Sem modelo'}</span></header>
        {!testPose && <div className="wardrobe-preview-controls"><button className={`pose-button ${moveBodyMode ? 'primary' : 'secondary'}`} disabled={!sourceParts || Boolean(calibratingPartId)} onClick={() => setMoveBodyMode((value) => !value)} type="button">{moveBodyMode ? 'Mover corpo: ligado' : 'Mover corpo'}</button><button className="pose-button secondary" disabled={!Object.keys(bodyOffsets).length} onClick={() => setBodyOffsets({})} type="button">Repor corpo</button>{edition === 2 && <button className="pose-button secondary" disabled={previewPan.x === 0 && previewPan.y === 0} onClick={() => setPreviewPan(zeroOffset)} type="button">Centralizar prévia</button>}<button className="pose-button secondary" aria-pressed={!showBindingMarkers} title={showBindingMarkers ? 'Ocultar os pontos azuis de encaixe na prévia' : 'Mostrar os pontos azuis de encaixe na prévia'} onClick={() => setShowBindingMarkers((visible) => !visible)} type="button"><Icon name={showBindingMarkers ? 'eyeOff' : 'eye'} />{showBindingMarkers ? 'Ocultar pontos azuis' : 'Mostrar pontos azuis'}</button><label className="preview-background-picker" title="Mudar a cor do fundo em Modelos, Poses, Rosto e Roupas"><span>Fundo da prévia</span><input type="color" aria-label="Cor do fundo das prévias" value={previewBackground} onChange={(event) => setPreviewBackground(event.target.value)} /><code>{previewBackground.toUpperCase()}</code></label></div>}
        <div ref={previewRef} className={`wardrobe-preview-stage${testPose ? ' testing-pose' : ''}${edition === 2 && !moveBodyMode && !calibratingPartId && !testPose ? ' pan-ready' : ''}`} onPointerDown={handlePreviewPointerDown} onPointerMove={movePreviewPan} onPointerUp={finishPreviewPan} onPointerCancel={finishPreviewPan} style={{ '--preview-background': previewBackground } as import('react').CSSProperties}>{previewProject && <div ref={artboardRef} className={`wardrobe-artboard${calibratingPartId ? ' calibrating-origin' : ''}${edition === 2 && !moveBodyMode && !calibratingPartId && !testPose ? ' pan-ready' : ''}`} onPointerDown={handleArtboardPointerDown} style={{ width: previewProject.width * scale, height: previewProject.height * scale, transform: edition === 2 ? `translate(${previewPan.x}px, ${previewPan.y}px)` : undefined }}>
        {!testPose && model && !sourceParts && referencePreview?.sourceDataUrl === referenceSource && <img className="wardrobe-base-image" src={referencePreview.imageDataUrl} alt={`Folha original desmontada do modelo ${model.name}`} style={{ left: 0, top: 0, width: previewProject.width * scale, height: previewProject.height * scale, zIndex: 1 }} />}
        {!testPose && model && sourceParts && model.parts.map((part, index) => { const source = sourceParts[part.id]; if (!source) return null; const offset = bodyOffsets[part.id] ?? zeroOffset; const frame = sourcePreviewFrame(part, source); return <img key={part.id} className={`wardrobe-reference-body-part${moveBodyMode ? ' movable' : ''}`} src={source.imageDataUrl} alt={part.name} title={moveBodyMode ? `Arraste ${part.name} para conferir o vínculo` : part.name} draggable={false} onPointerDown={(event) => beginBodyDrag(event, part.id)} onPointerMove={moveBodyDrag} onPointerUp={finishBodyDrag} onPointerCancel={finishBodyDrag} style={{ left: (frame.x + offset.x) * scale, top: (frame.y + offset.y) * scale, width: frame.width * scale, height: frame.height * scale, zIndex: moveBodyMode ? 1000 + index : 1 }} /> })}
        {testPose && previewPoseParts.map((part, index) => <img key={part.id} className="wardrobe-pose-body-part" src={part.dataUrl} alt={part.name} draggable={false} style={{ left: part.x * scale, top: part.y * scale, width: part.width * scale, height: part.height * scale, zIndex: 2 + index * previewLayerStride, transform: `rotate(${part.rotation}deg)` }} />)}
        {draft?.components.map((component, index) => {
          const layer = getBodyLayer(model, component.attachedPartId)
          const layerBand = testPose ? previewLayerStride : draft.components.length + 1
           const modelBone = referenceBone(component.attachedPartId)
          const poseBone = testPose?.parts.find((part) => part.id === component.attachedPartId)
          const testOffset = testDragOffsets[component.id] ?? { x: 0, y: 0 }
           const bodyOffset = !testPose && component.binding?.boneId === component.attachedPartId ? bodyOffsets[component.attachedPartId] ?? zeroOffset : zeroOffset
           const componentX = component.x + (testPose ? testOffset.x : bodyOffset.x)
           const componentY = component.y + (testPose ? testOffset.y : bodyOffset.y)
          const testComponent = { ...component, x: componentX, y: componentY }
          if (testPose && modelBone && (testOffset.x !== 0 || testOffset.y !== 0)) testComponent.binding = bindWardrobeComponent(testComponent, modelBone)
          const hasThighAndCalf = Boolean(draft?.components.some((item) => item.category === 'calca-coxa') && draft?.components.some((item) => item.category === 'calca-canela'))
          const kneeOverlap = testPose && hasThighAndCalf && (component.category === 'calca-coxa' || component.category === 'calca-canela') ? 18 : 0
          const sleeveEdgePadding = testPose && (component.category === 'manga-superior' || component.category === 'manga-inferior') ? Math.max(8, Math.min(14, Math.round(Math.min(component.width, component.height) * .06))) : 0
          const poseTransform = testPose && modelBone?.sourceTransform && poseBone
            ? mapWardrobeComponentToPose(testComponent, modelBone, poseBone, kneeOverlap, sleeveEdgePadding)
            : null
          const poseLayer = testPose?.layerOrder.indexOf(component.attachedPartId) ?? -1
          const zIndex = testPose ? 3 + Math.max(0, poseLayer) * layerBand + index : 2 + layer * layerBand + index
          const imageClassName = `wardrobe-preview-part${component.id === selectedId ? ' selected' : ''}`
          const imageTitle = `${component.name} · ${categoryNames[component.category]} · camada do modelo ${layer + 1}`
           if (!testPose || !poseTransform) return <img key={component.id} className={imageClassName} src={component.dataUrl} alt={component.name} title={imageTitle} draggable={false} onClick={() => setSelectedId(component.id)} onPointerDown={(event) => beginPieceDrag(event, component)} onPointerMove={movePieceDrag} onPointerUp={finishPieceDrag} onPointerCancel={finishPieceDrag} style={{ left: componentX * scale, top: componentY * scale, width: component.width * scale, height: component.height * scale, zIndex, transform: `rotate(${component.rotation}deg)` }} />
          const image = <img className={imageClassName} src={component.dataUrl} alt={component.name} title={imageTitle} draggable={false} onClick={() => setSelectedId(component.id)} onPointerDown={(event) => beginPieceDrag(event, component)} onPointerMove={movePieceDrag} onPointerUp={finishPieceDrag} onPointerCancel={finishPieceDrag} style={{ left: poseTransform.localLeft * scale, top: poseTransform.localTop * scale, width: poseTransform.renderWidth * scale, height: poseTransform.renderHeight * scale, transformOrigin: 'center', transform: `rotate(${poseTransform.localRotation}deg)` }} />
          return <div key={component.id} className="wardrobe-pose-garment" style={{ left: poseTransform.origin.x * scale, top: poseTransform.origin.y * scale, width: 0, height: 0, zIndex, transformOrigin: '0 0', transform: poseTransform.matrix }}>{image}</div>
        })}
        {!testPose && showBindingMarkers && draft?.components.map((component) => { if (component.binding?.boneId !== component.attachedPartId) return null; const bone = referenceBone(component.attachedPartId); if (!bone) return null; const offset = bodyOffsets[bone.id] ?? zeroOffset; const marker = bindingMarker(component, bone); return <span key={`binding-${component.id}`} className={`wardrobe-binding-marker${selectedId === component.id ? ' selected' : ''}`} role="button" aria-label={`Encaixe de ${component.name} em ${bone.name}`} tabIndex={0} title={`Arraste para mover ${component.name} e ajustar o encaixe em ${bone.name}`} onPointerDown={(event) => beginPieceDrag(event, component)} onPointerMove={movePieceDrag} onPointerUp={finishPieceDrag} onPointerCancel={finishPieceDrag} onKeyDown={(event) => { const step = event.shiftKey ? 10 : 1; const delta = event.key === 'ArrowLeft' ? { x: -step, y: 0 } : event.key === 'ArrowRight' ? { x: step, y: 0 } : event.key === 'ArrowUp' ? { x: 0, y: -step } : event.key === 'ArrowDown' ? { x: 0, y: step } : null; if (!delta) return; event.preventDefault(); updateComponent(component.id, { x: component.x + delta.x, y: component.y + delta.y }) }} style={{ left: (marker.x + offset.x) * scale, top: (marker.y + offset.y) * scale }} /> })}
      </div>}{!model && <div className="wardrobe-empty"><Icon name="shirt" /><strong>Selecione um modelo salvo</strong><small>O modelo será usado como guia na prévia de encaixe.</small></div>}{model && !draft && !testPose && <div className="wardrobe-stage-hint">Importe uma folha para começar · fundo transparente preservado</div>}{testPose && <div className="wardrobe-stage-hint wardrobe-test-hint">Teste temporário · a pose salva não será alterada</div>}{calibratingPartId && <div className="wardrobe-stage-hint wardrobe-calibration-hint">Clique na junta de “{model?.parts.find((part) => part.id === calibratingPartId)?.name}” na folha original</div>}<div className="wardrobe-zoom"><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.min(2.2, value + .1))} type="button">+</button><button onClick={() => setZoom((value) => Math.max(.55, value - .1))} type="button">−</button></div>{processing && <div className="wardrobe-processing"><span className="model-spinner" />Detectando peças transparentes…</div>}</div><footer>{testPose ? 'Arraste as roupas para testar o encaixe. Use “Sair do teste” para voltar à folha original.' : 'Arraste a roupa para encaixar. Ative Mover corpo para arrastar a peça corporal com a roupa fixada e conferir o vínculo azul.'}</footer></section>
      <aside className={`wardrobe-edit-panel${edition === 2 ? ' wardrobe-edit-panel-v2' : ''}`}><header><span><strong>{edition === 2 ? 'Ajuste da peça' : 'Peças do conjunto'}</strong><small>{edition === 2 ? selected?.name ?? 'Escolha uma peça no catálogo' : draft ? `${draft.components.length} partes detectadas` : 'Recortes automáticos'}</small></span>{edition !== 2 && draft && <span className="wardrobe-count">{draft.components.length}</span>}</header>
        {draft ? <>{edition !== 2 && renderComponentList()}{selected && <div className="wardrobe-fields"><div className="wardrobe-field-title"><strong>Editar peça · camada do modelo {getBodyLayer(model, selected.attachedPartId) + 1}</strong><button title="Subir camada" aria-label="Subir camada" disabled={selectedIndex === (draft?.components.length ?? 0) - 1} onClick={() => moveComponentLayer(selected.id, 1)} type="button">↑</button><button title="Descer camada" aria-label="Descer camada" disabled={selectedIndex <= 0} onClick={() => moveComponentLayer(selected.id, -1)} type="button">↓</button><button title="Remover esta peça do conjunto" onClick={() => { setDraft((current) => current ? { ...current, components: current.components.filter((component) => component.id !== selected.id) } : current); setSelectedId(draft.components.find((component) => component.id !== selected.id)?.id ?? null); setDirty(true) }} type="button"><Icon name="trash" /></button></div><label>Nome<input value={selected.name} onChange={(event) => updateComponent(selected.id, { name: event.target.value })} /></label><label>Categoria<select value={selected.category} onChange={(event) => updateComponent(selected.id, { category: event.target.value as WardrobeCategory })}>{categories.map((category) => <option key={category} value={category}>{categoryNames[category]}</option>)}</select></label><label>Parte correspondente<select value={selected.attachedPartId} onChange={(event) => updateComponent(selected.id, { attachedPartId: event.target.value })}>{model?.parts.map((part) => <option key={part.id} value={part.id}>{part.name}{part.sourceTransform ? '' : ' · calibrar origem'}</option>)}</select></label>{(() => { const linkedPart = model?.parts.find((part) => part.id === selected.attachedPartId); return linkedPart && !linkedPart.sourceTransform ? <button className="pose-button secondary wardrobe-calibrate-button" onClick={() => { setTestPose(null); setCalibratingPartId(linkedPart.id); setError('') }} type="button"><Icon name="frame" /> Calibrar origem na folha</button> : null })()}<button className={`pose-button ${selected.binding?.boneId === selected.attachedPartId ? 'primary' : 'secondary'} wardrobe-bind-button`} onClick={fixSelectedBinding} disabled={!selected.attachedPartId} type="button"><span className="wardrobe-bind-dot" /><Icon name="link" />{selected.binding?.boneId === selected.attachedPartId ? 'Refixar roupa à peça do corpo' : 'Fixar roupa à peça do corpo'}</button><small className="wardrobe-note">O encaixe guarda posição, rotação e escala em relação ao osso. Ajustes manuais atualizam esse vínculo automaticamente.</small><div className="wardrobe-quick-controls"><div className="wardrobe-nudge-pad"><button aria-label="Mover para cima" title="Mover para cima" onClick={() => nudgeSelected(0, -5)} type="button">↑</button><button aria-label="Mover para esquerda" title="Mover para esquerda" onClick={() => nudgeSelected(-5, 0)} type="button">←</button><span>mover</span><button aria-label="Mover para direita" title="Mover para direita" onClick={() => nudgeSelected(5, 0)} type="button">→</button><button aria-label="Mover para baixo" title="Mover para baixo" onClick={() => nudgeSelected(0, 5)} type="button">↓</button></div><div className="wardrobe-quick-actions"><button title="Diminuir tamanho em 10%" onClick={() => resizeSelected(.9)} type="button">− Tamanho</button><button title="Aumentar tamanho em 10%" onClick={() => resizeSelected(1.1)} type="button">+ Tamanho</button><button title="Girar 15 graus para a esquerda" onClick={() => updateComponent(selected.id, { rotation: selected.rotation - 15 })} type="button">↶ 15°</button><button title="Girar 15 graus para a direita" onClick={() => updateComponent(selected.id, { rotation: selected.rotation + 15 })} type="button">↷ 15°</button><button className="wardrobe-origin-button" onClick={restoreSelectedOrigin} type="button">Voltar à posição original</button></div></div><section className="wardrobe-scale-controls" aria-label="Escala horizontal e vertical"><div className="wardrobe-scale-heading"><strong>Escala da peça</strong><label className="wardrobe-aspect-lock"><input type="checkbox" checked={lockAspectRatio} onChange={(event) => setLockAspectRatio(event.target.checked)} /><span>Manter proporção</span></label></div><label className="wardrobe-scale-row"><span><b>↔ Horizontal</b><output>{Math.round(selected.width / (selected.originWidth ?? selected.width) * 100)}%</output></span><input aria-label="Escala horizontal" type="range" min="10" max="300" step="1" value={Math.max(10, Math.min(300, Math.round(selected.width / (selected.originWidth ?? selected.width) * 100)))} onChange={(event) => scaleSelectedAxis('width', (selected.originWidth ?? selected.width) * Number(event.target.value) / 100)} /></label><label className="wardrobe-scale-row"><span><b>↕ Vertical</b><output>{Math.round(selected.height / (selected.originHeight ?? selected.height) * 100)}%</output></span><input aria-label="Escala vertical" type="range" min="10" max="300" step="1" value={Math.max(10, Math.min(300, Math.round(selected.height / (selected.originHeight ?? selected.height) * 100)))} onChange={(event) => scaleSelectedAxis('height', (selected.originHeight ?? selected.height) * Number(event.target.value) / 100)} /></label></section><div className="wardrobe-number-grid">{([['x', 'X'], ['y', 'Y'], ['width', 'Largura'], ['height', 'Altura'], ['rotation', 'Ângulo']] as const).map(([field, label]) => <label key={field}>{label}<input type="number" step={field === 'rotation' ? 1 : 2} value={Number(selected[field].toFixed(1))} onChange={(event) => { const value = Number(event.target.value); if (field === 'width' || field === 'height') scaleSelectedAxis(field, value); else updateComponent(selected.id, { [field]: value }) }} /></label>)}</div><small className="wardrobe-note">Este vínculo ficará salvo para a futura integração em Customizar.</small></div>}{edition === 2 && !selected && <div className="wardrobe-edit-empty"><Icon name="shirt" /><strong>Escolha uma peça</strong><small>Selecione no catálogo para ajustar posição, tamanho e vínculo.</small></div>}</> : <div className="wardrobe-edit-empty"><Icon name="sparkles" /><strong>Pré-encaixe automático</strong><small>A folha é separada por transparência. Depois você revisa categoria, peça do corpo e posição de cada recorte.</small></div>}
      </aside>
    </div>
    {testPosePickerOpen && <div className="pose-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !testPoseLoading) setTestPosePickerOpen(false) }}><section className="pose-model-picker" role="dialog" aria-modal="true" aria-labelledby="wardrobe-test-picker-title"><header><span><small>TESTE DE ROUPA</small><strong id="wardrobe-test-picker-title">Escolha uma pose</strong></span><button onClick={() => setTestPosePickerOpen(false)} aria-label="Fechar" type="button">×</button></header><p>A roupa será exibida sobre uma cópia visual da pose. A pose salva não será modificada.</p><div className="pose-model-options">{testPoseLoading && <div className="pose-model-none">Carregando poses…</div>}{testPoseSlots.map((pose) => pose && <button key={`pose-${pose.slot}`} className="pose-model-option" disabled={testPoseLoading} onClick={() => void loadTestPose(pose.slot)} type="button"><span className="pose-model-number">{String(pose.slot).padStart(2, '0')}</span><span><b>{pose.name}</b><small>{pose.partCount} peças · {new Date(pose.updatedAt).toLocaleDateString('pt-BR')}</small></span><Icon name="chevronRight" /></button>)}{!testPoseLoading && testPoseSlots.length === 0 && <div className="pose-model-none">Este modelo ainda não tem poses salvas.</div>}</div></section></div>}
  </section>
}
