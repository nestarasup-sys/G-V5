import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FabricatorAssetSave, FabricatorProject, FabricatorSlotSummary, ModelPart } from '../../../../shared/fabricator'
import { Icon, type IconName } from '../../ui/components/Icon'
import { despillGreenFringes, sampleBackground } from './models/chroma'
import { autoConnectParts, createJoint, jointPivot, normalizeLayerOrder, normalizePartAnchors, orderedParts, partJointAnchor, reorderLayer } from './models/rig'

const sections: { label: string; icon: IconName }[] = [
  { label: 'Modelos', icon: 'sparkles' }, { label: 'Personagens', icon: 'user' },
  { label: 'Corpo', icon: 'body' }, { label: 'Cabeça', icon: 'face' },
  { label: 'Rostos', icon: 'user' }, { label: 'Cabelos', icon: 'flower' },
  { label: 'Roupas', icon: 'shirt' }, { label: 'Acessórios', icon: 'bow' },
  { label: 'Mascotes', icon: 'paw' }, { label: 'Objetos', icon: 'box' },
  { label: 'Cenários', icon: 'frame' }, { label: 'Animações', icon: 'expand' },
  { label: 'Exportação', icon: 'download' }
]

type ProcessedPart = Omit<ModelPart, 'dataUrl'> & { png: ArrayBuffer }
type ProcessorMessage =
  | { type: 'progress'; id: number; value: number }
  | { type: 'complete'; id: number; width: number; height: number; parts: ProcessedPart[] }
  | { type: 'error'; id: number; message: string }
type DragState = { partId: string; pointerId: number; x: number; y: number }
type AnchorDragState = { partId: string; pointerId: number; x: number; y: number; offsetX: number }
type PanState = { pointerId: number; x: number; y: number; originX: number; originY: number }
type PanelTab = 'parts' | 'layers' | 'joints'

function bytesToDataUrl(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunk, bytes.length)))
  }
  return `data:image/png;base64,${btoa(binary)}`
}

function makeId(): string { return crypto.randomUUID() }

function rotatePoint(point: { x: number; y: number }, origin: { x: number; y: number }, angle: number) {
  const radians = angle * Math.PI / 180
  const x = point.x - origin.x
  const y = point.y - origin.y
  return { x: origin.x + x * Math.cos(radians) - y * Math.sin(radians), y: origin.y + x * Math.sin(radians) + y * Math.cos(radians) }
}

async function imageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Não foi possível abrir o recorte.'))
    image.src = dataUrl
  })
}

async function cleanSavedPartEdges(parts: ModelPart[], sourceDataUrl: string, tolerance: number): Promise<ModelPart[]> {
  const source = await imageFromDataUrl(sourceDataUrl)
  const sampleCanvas = document.createElement('canvas')
  sampleCanvas.width = 128; sampleCanvas.height = 128
  const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true })
  if (!sampleContext) throw new Error('Não foi possível analisar a cor do fundo.')
  sampleContext.drawImage(source, 0, 0, sampleCanvas.width, sampleCanvas.height)
  const background = sampleBackground(sampleContext.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data, sampleCanvas.width, sampleCanvas.height)

  const cleaned: ModelPart[] = []
  for (const part of parts) {
    const image = await imageFromDataUrl(part.dataUrl)
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error(`Não foi possível limpar a borda de ${part.name}.`)
    context.drawImage(image, 0, 0)
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    const changed = despillGreenFringes(imageData.data, background, tolerance)
    if (changed > 0) {
      context.putImageData(imageData, 0, 0)
      cleaned.push({ ...part, dataUrl: canvas.toDataURL('image/png') })
    } else cleaned.push(part)
  }
  return cleaned
}

async function splitImage(part: ModelPart, axis: 'horizontal' | 'vertical'): Promise<ModelPart[]> {
  const image = await imageFromDataUrl(part.dataUrl)
  const firstWidth = axis === 'vertical' ? Math.floor(part.width / 2) : part.width
  const firstHeight = axis === 'horizontal' ? Math.floor(part.height / 2) : part.height
  const regions = axis === 'vertical'
    ? [{ x: 0, y: 0, width: firstWidth, height: part.height }, { x: firstWidth, y: 0, width: part.width - firstWidth, height: part.height }]
    : [{ x: 0, y: 0, width: part.width, height: firstHeight }, { x: 0, y: firstHeight, width: part.width, height: part.height - firstHeight }]
  return Promise.all(regions.map(async (region, index) => {
    const canvas = document.createElement('canvas')
    canvas.width = region.width; canvas.height = region.height
    canvas.getContext('2d')?.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height)
    return { ...part, id: makeId(), name: `${part.name} ${index === 0 ? 'A' : 'B'}`, x: part.x + region.x, y: part.y + region.y, width: region.width, height: region.height, rotation: 0, jointAnchor: { x: part.x + region.x + region.width / 2, y: part.y + region.y + region.height / 2 }, dataUrl: canvas.toDataURL('image/png') }
  }))
}

async function mergeImages(parts: ModelPart[]): Promise<ModelPart> {
  const x = Math.min(...parts.map((part) => part.x)); const y = Math.min(...parts.map((part) => part.y))
  const right = Math.max(...parts.map((part) => part.x + part.width)); const bottom = Math.max(...parts.map((part) => part.y + part.height))
  const canvas = document.createElement('canvas'); canvas.width = Math.ceil(right - x); canvas.height = Math.ceil(bottom - y)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Não foi possível mesclar as peças.')
  for (const part of parts) {
    const image = await imageFromDataUrl(part.dataUrl)
    context.save()
    context.translate(part.x - x + part.width / 2, part.y - y + part.height / 2)
    context.rotate(part.rotation * Math.PI / 180)
    context.drawImage(image, -part.width / 2, -part.height / 2, part.width, part.height)
    context.restore()
  }
  return { id: makeId(), name: 'Peças mescladas', x, y, width: canvas.width, height: canvas.height, rotation: 0, dataUrl: canvas.toDataURL('image/png') }
}

export function FabricatorPage() {
  const [activeSection, setActiveSection] = useState('Modelos')
  const [slots, setSlots] = useState<FabricatorSlotSummary[]>(Array.from({ length: 10 }, () => null))
  const [slotsLoaded, setSlotsLoaded] = useState(false)
  const [activeSlot, setActiveSlot] = useState(1)
  const [project, setProject] = useState<FabricatorProject | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [processing, setProcessing] = useState(false)
  const [deletingSlot, setDeletingSlot] = useState<number | null>(null)
  const [progress, setProgress] = useState(0)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [connectMode, setConnectMode] = useState(false)
  const [connectFromId, setConnectFromId] = useState<string | null>(null)
  const [panelTab, setPanelTab] = useState<PanelTab>('parts')
  const [layerDragId, setLayerDragId] = useState<string | null>(null)
  const [showJointPivots, setShowJointPivots] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const [stageSize, setStageSize] = useState({ width: 1, height: 1 })
  const [renamingPartId, setRenamingPartId] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const anchorDragRef = useRef<AnchorDragState | null>(null)
  const panRef = useRef<PanState | null>(null)
  const layerDragRef = useRef<string | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const requestId = useRef(0)
  const dirtyAssets = useRef<Map<string, string>>(new Map())
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initialSlotLoad = useRef(false)

  const persistProject = useCallback(async (snapshot: FabricatorProject) => {
    let assets: FabricatorAssetSave[] = Array.from(dirtyAssets.current, ([id, dataUrl]) => ({ id, dataUrl }))
    const { sourceDataUrl: _sourceDataUrl, parts, ...metadata } = snapshot
    const serialized = { ...metadata, parts: parts.map(({ dataUrl: _dataUrl, ...part }) => part) }
    try {
      await window.desktop.saveFabricatorProject(serialized, assets)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      const missing = /FABRICATOR_MISSING_ASSETS:([a-zA-Z0-9_,.-]+)/.exec(message)?.[1]?.split(',') ?? []
      if (!missing.length) throw reason
      const recoverable = missing.flatMap((id) => {
        const part = snapshot.parts.find((item) => item.id === id)
        return part ? [{ id, dataUrl: part.dataUrl }] : []
      })
      if (recoverable.length !== missing.length) throw reason
      for (const asset of recoverable) dirtyAssets.current.set(asset.id, asset.dataUrl)
      const byId = new Map([...assets, ...recoverable].map((asset) => [asset.id, asset]))
      assets = Array.from(byId.values())
      await window.desktop.saveFabricatorProject(serialized, assets)
    }
    for (const asset of assets) if (dirtyAssets.current.get(asset.id) === asset.dataUrl) dirtyAssets.current.delete(asset.id)
    setSaveState('saved')
    setSlots((current) => current.map((item, index) => index + 1 === snapshot.slot ? { slot: snapshot.slot, name: snapshot.name, sourceName: snapshot.sourceName, partCount: snapshot.parts.length, updatedAt: snapshot.updatedAt } : item))
  }, [])

  useEffect(() => {
    void window.desktop.listFabricatorSlots()
      .then((items) => { setSlots(items); setSlotsLoaded(true) })
      .catch((reason: unknown) => { setSlotsLoaded(true); setError(reason instanceof Error ? reason.message : 'Não foi possível abrir a biblioteca.') })
    return () => { workerRef.current?.terminate(); if (savedTimer.current) clearTimeout(savedTimer.current) }
  }, [])

  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [project])

  useEffect(() => {
    if (!project) { setSaveState('saved'); return }
    setSaveState('saving')
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => {
      void persistProject(project).catch((reason: unknown) => {
        setSaveState('error')
        setError(reason instanceof Error ? `Falha ao salvar: ${reason.message}` : 'Falha ao salvar o projeto.')
      })
    }, 700)
    return () => { if (savedTimer.current) clearTimeout(savedTimer.current) }
  }, [persistProject, project])

  const selectedPartIds = selectedIds
  const selectedPart = project?.parts.find((part) => part.id === selectedPartIds[0]) ?? null
  const visibleParts = useMemo(() => (project?.parts ?? []).filter((part) => part.name.toLowerCase().includes(filter.toLowerCase())), [project, filter])
  const canvasParts = useMemo(() => project ? orderedParts(project.parts, project.layerOrder) : [], [project])
  const frontToBackLayers = useMemo(() => canvasParts.slice().reverse(), [canvasParts])
  const jointedParts = useMemo(() => {
    if (!project) return []
    const withAnchors = project.parts.flatMap((part) => {
      const anchor = partJointAnchor(part, project.joints)
      return anchor ? [{ part, anchor, offset: 0 }] : []
    })
    const groups = new Map<string, typeof withAnchors>()
    for (const item of withAnchors) {
      const key = `${item.anchor.x.toFixed(2)}:${item.anchor.y.toFixed(2)}`
      groups.set(key, [...(groups.get(key) ?? []), item])
    }
    return withAnchors.map((item) => {
      const key = `${item.anchor.x.toFixed(2)}:${item.anchor.y.toFixed(2)}`
      const group = groups.get(key) ?? []
      return { ...item, offset: (group.findIndex((candidate) => candidate.part.id === item.part.id) - (group.length - 1) / 2) * 20 }
    })
  }, [project])
  const jointMarkers = useMemo(() => jointedParts
    .filter(({ part }) => !/tronco|corpo/i.test(part.name))
    .map((item) => ({ ...item, fixed: Boolean(project?.joints.some((joint) => joint.childPartId === item.part.id && joint.fixed)) }))
    .sort((a, b) => Number(selectedIds.includes(a.part.id)) - Number(selectedIds.includes(b.part.id))), [jointedParts, project?.joints, selectedIds])
  const hiddenPartIds = project?.hiddenPartIds ?? []
  const scale = project ? Math.max(0.05, Math.min((stageSize.width - 48) / project.width, (stageSize.height - 48) / project.height)) * zoom : 1

  const updateProject = useCallback((updater: (current: FabricatorProject) => FabricatorProject) => {
    setProject((current) => {
      if (!current) return current
      const next = updater(current)
      const validIds = new Set(next.parts.map((part) => part.id))
      return {
        ...next,
        layerOrder: normalizeLayerOrder(next.parts, next.layerOrder),
        hiddenPartIds: (next.hiddenPartIds ?? []).filter((id) => validIds.has(id)),
        joints: next.joints.filter((joint) => validIds.has(joint.parentPartId) && validIds.has(joint.childPartId)),
        updatedAt: new Date().toISOString()
      }
    })
  }, [])

  const moveLayer = (partId: string, direction: -1 | 1) => {
    updateProject((current) => {
      const topDown = normalizeLayerOrder(current.parts, current.layerOrder).reverse()
      const index = topDown.indexOf(partId)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= topDown.length) return current
      ;[topDown[index], topDown[nextIndex]] = [topDown[nextIndex], topDown[index]]
      return { ...current, layerOrder: topDown.reverse() }
    })
  }

  const dropLayer = (sourceId: string, targetId: string) => {
    updateProject((current) => ({ ...current, layerOrder: reorderLayer(normalizeLayerOrder(current.parts, current.layerOrder).reverse(), sourceId, targetId).reverse() }))
  }

  const toggleLayerVisibility = (partId: string) => updateProject((current) => {
    const hidden = new Set(current.hiddenPartIds ?? [])
    if (hidden.has(partId)) hidden.delete(partId)
    else hidden.add(partId)
    return { ...current, hiddenPartIds: Array.from(hidden) }
  })

  const selectSlot = async (slot: number) => {
    if (project) {
      if (savedTimer.current) clearTimeout(savedTimer.current)
      try { await persistProject(project) } catch (reason) { setError(reason instanceof Error ? `Falha ao salvar antes de trocar de slot: ${reason.message}` : 'Falha ao salvar antes de trocar de slot.'); return }
    }
    workerRef.current?.terminate(); workerRef.current = null
    setActiveSlot(slot); setProject(null); setSelectedIds([]); setError(''); dirtyAssets.current.clear(); setZoom(1); setPan({ x: 0, y: 0 })
    const summary = slots[slot - 1]
    if (!summary) return
    try {
      const loaded = await window.desktop.loadFabricatorSlot(slot)
      if (!loaded) throw new Error('O projeto salvo não pôde ser carregado.')
      const rig = normalizePartAnchors(loaded.parts, loaded.joints)
      let loadedParts = rig.parts
      let chromaVersion = loaded.chromaVersion ?? 0
      if (chromaVersion < 2) {
        try {
          loadedParts = await cleanSavedPartEdges(rig.parts, loaded.sourceDataUrl, loaded.tolerance)
          for (const part of loadedParts) {
            const previous = rig.parts.find((item) => item.id === part.id)
            if (previous?.dataUrl !== part.dataUrl) dirtyAssets.current.set(part.id, part.dataUrl)
          }
          chromaVersion = 2
        } catch {
          setError('O modelo abriu, mas não foi possível corrigir automaticamente o contorno verde.')
        }
      }
      setProject({
        ...loaded,
        chromaVersion,
        parts: loadedParts,
        layerOrder: normalizeLayerOrder(loaded.parts, loaded.layerOrder),
        hiddenPartIds: loaded.hiddenPartIds ?? [],
        joints: rig.joints
      }); setSelectedIds(loaded.parts[0] ? [loaded.parts[0].id] : [])
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao abrir modelo.') }
  }

  useEffect(() => {
    if (!slotsLoaded || initialSlotLoad.current) return
    initialSlotLoad.current = true
    if (slots[0]) void selectSlot(1)
  }, [slotsLoaded, slots[0]])

  const deleteSlot = async (slot: number) => {
    const summary = slots[slot - 1]
    if (!summary || deletingSlot !== null) return
    if (!window.confirm(`Excluir permanentemente “${summary.name}” do slot ${slot}? A imagem original e todas as peças salvas serão apagadas.`)) return
    setDeletingSlot(slot)
    if (activeSlot === slot) {
      if (savedTimer.current) clearTimeout(savedTimer.current)
      workerRef.current?.terminate(); workerRef.current = null
      setProcessing(false)
    }
    try {
      await window.desktop.deleteFabricatorSlot(slot)
      setSlots((current) => current.map((item, index) => index === slot - 1 ? null : item))
      if (activeSlot === slot) {
        workerRef.current?.terminate(); workerRef.current = null
        setProcessing(false); setProgress(0); setProject(null); setSelectedIds([]); dirtyAssets.current.clear(); setError('')
      }
    } catch (reason) {
      setError(reason instanceof Error ? `Não foi possível excluir o modelo: ${reason.message}` : 'Não foi possível excluir o modelo.')
      if (activeSlot === slot) {
        if (project) setProject({ ...project, updatedAt: new Date().toISOString() })
        else await selectSlot(slot)
      }
    } finally {
      setDeletingSlot(null)
    }
  }

  const runProcessor = (sourceDataUrl: string, tolerance: number, metadata: { slot: number; name: string; sourceName: string; sourceAssetName: string }) => {
    workerRef.current?.terminate()
    const worker = new Worker(new URL('./models/imageProcessor.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    const id = ++requestId.current
    setProcessing(true); setProgress(1); setError('')
    worker.onmessage = (event: MessageEvent<ProcessorMessage>) => {
      if (event.data.id !== id) return
      const message = event.data
      if (message.type === 'progress') { setProgress(message.value); return }
      worker.terminate(); workerRef.current = null; setProcessing(false)
      if (message.type === 'error') { setError(message.message); return }
      if (message.parts.length === 0) { setError('Nenhuma peça foi encontrada. Aumente a tolerância ou escolha outra imagem.'); return }
      const parts: ModelPart[] = message.parts.map(({ png, ...part }) => ({ ...part, rotation: 0, dataUrl: bytesToDataUrl(png) }))
      for (const part of parts) dirtyAssets.current.set(part.id, part.dataUrl)
      const detectedJoints = autoConnectParts(parts)
      const rig = normalizePartAnchors(parts, detectedJoints)
      const nextProject: FabricatorProject = {
        schemaVersion: 1, chromaVersion: 2, slot: metadata.slot, name: metadata.name, sourceName: metadata.sourceName,
        sourceAssetName: metadata.sourceAssetName, sourceDataUrl, width: message.width, height: message.height,
        tolerance, parts: rig.parts, joints: rig.joints, layerOrder: parts.map((part) => part.id), hiddenPartIds: [], updatedAt: new Date().toISOString()
      }
      setProject(nextProject); setSelectedIds(parts[0] ? [parts[0].id] : [])
    }
    worker.onerror = () => { worker.terminate(); workerRef.current = null; setProcessing(false); setError('O processamento da imagem falhou.') }
    worker.postMessage({ id, sourceDataUrl, tolerance })
  }

  const importSlot = async (slot: number) => {
    if (slots[slot - 1] && !window.confirm(`Substituir o modelo do slot ${slot}? O projeto atual será trocado.`)) return
    if (project) {
      if (savedTimer.current) clearTimeout(savedTimer.current)
      try { await persistProject(project) } catch (reason) { setError(reason instanceof Error ? `Falha ao salvar antes da importação: ${reason.message}` : 'Falha ao salvar antes da importação.'); return }
    }
    setError('')
    try {
      const selected = await window.desktop.importFabricatorModel(slot)
      if (!selected) return
      setActiveSlot(slot); setProject(null); setSelectedIds([]); dirtyAssets.current.clear()
      const name = selected.sourceName.replace(/\.[^.]+$/, '') || `Modelo ${slot}`
      runProcessor(selected.sourceDataUrl, 74, { slot, name, sourceName: selected.sourceName, sourceAssetName: selected.sourceAssetName })
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível importar a imagem.') }
  }

  const removePart = (partId: string) => {
    updateProject((current) => ({ ...current, parts: current.parts.filter((part) => part.id !== partId), joints: current.joints.filter((joint) => joint.parentPartId !== partId && joint.childPartId !== partId) }))
    setSelectedIds((current) => current.filter((id) => id !== partId))
    dirtyAssets.current.delete(partId)
  }

  const splitSelected = async (axis: 'horizontal' | 'vertical') => {
    if (!selectedPart || selectedPart.rotation !== 0) return
    const split = await splitImage(selectedPart, axis)
    for (const part of split) dirtyAssets.current.set(part.id, part.dataUrl)
    updateProject((current) => ({ ...current, parts: [...current.parts.filter((part) => part.id !== selectedPart.id), ...split], joints: current.joints.filter((joint) => joint.parentPartId !== selectedPart.id && joint.childPartId !== selectedPart.id) }))
    setSelectedIds(split.map((part) => part.id)); dirtyAssets.current.delete(selectedPart.id)
  }

  const mergeSelected = async () => {
    if (!project || selectedPartIds.length < 2) return
    const parts = project.parts.filter((part) => selectedPartIds.includes(part.id))
    const merged = await mergeImages(parts)
    dirtyAssets.current.set(merged.id, merged.dataUrl)
    const ids = new Set(parts.map((part) => part.id))
    updateProject((current) => ({ ...current, parts: [...current.parts.filter((part) => !ids.has(part.id)), merged], joints: current.joints.filter((joint) => !ids.has(joint.parentPartId) && !ids.has(joint.childPartId)) }))
    for (const id of ids) dirtyAssets.current.delete(id)
    setSelectedIds([merged.id])
  }

  const handlePartClick = (partId: string, toggle = false) => {
    if (connectMode) {
      if (!connectFromId) { setConnectFromId(partId); setSelectedIds([partId]); return }
      if (connectFromId !== partId && project) {
        const parent = project.parts.find((part) => part.id === connectFromId)
        const child = project.parts.find((part) => part.id === partId)
        if (parent && child && !project.joints.some((joint) => joint.parentPartId === parent.id && joint.childPartId === child.id)) {
          updateProject((current) => {
            const currentParent = current.parts.find((part) => part.id === parent.id) ?? parent
            const currentChild = current.parts.find((part) => part.id === child.id) ?? child
            const created = createJoint(currentParent, currentChild)
            const parentAnchor = currentParent.jointAnchor ?? created.parentAnchor
            const childAnchor = currentChild.jointAnchor ?? created.childAnchor
            const joint = { ...created, parentAnchor, childAnchor, pivot: { x: (parentAnchor.x + childAnchor.x) / 2, y: (parentAnchor.y + childAnchor.y) / 2 } }
            return {
              ...current,
              parts: current.parts.map((part) => part.id === parent.id ? { ...part, jointAnchor: parentAnchor } : part.id === child.id ? { ...part, jointAnchor: childAnchor } : part),
              joints: [...current.joints, joint]
            }
          })
        }
        setConnectFromId(null); setConnectMode(false); setSelectedIds([partId]); return
      }
    }
    setSelectedIds((current) => toggle
      ? current.includes(partId) ? current.filter((id) => id !== partId) : [...current, partId]
      : [partId])
  }

  const updatePartPosition = (partId: string, dx: number, dy: number) => {
    updateProject((current) => {
      // A fixed connection moves only its immediate pair. It does not turn the
      // entire connected rig into one rigid group.
      const movingIds = new Set([partId, ...current.joints.filter((joint) => joint.fixed && joint.parentPartId === partId).map((joint) => joint.childPartId)])
      return {
        ...current,
        parts: current.parts.map((part) => movingIds.has(part.id) ? { ...part, x: part.x + dx, y: part.y + dy, ...(part.jointAnchor ? { jointAnchor: { x: part.jointAnchor.x + dx, y: part.jointAnchor.y + dy } } : {}) } : part),
        joints: current.joints.map((joint) => ({
          ...joint,
          ...(movingIds.has(joint.parentPartId) ? { parentAnchor: { x: joint.parentAnchor.x + dx, y: joint.parentAnchor.y + dy } } : {}),
          ...(movingIds.has(joint.childPartId) ? { childAnchor: { x: joint.childAnchor.x + dx, y: joint.childAnchor.y + dy } } : {}),
          ...((movingIds.has(joint.parentPartId) || movingIds.has(joint.childPartId)) ? { pivot: { x: jointPivot(joint).x + dx, y: jointPivot(joint).y + dy } } : {})
        }))
      }
    })
  }

  const toggleJointFix = (partId: string) => updateProject((current) => {
    const incoming = current.joints.find((joint) => joint.childPartId === partId)
    if (!incoming) return current
    // Fixing preserves the pose and intentional overlaps. The fixed flag links
    // this pair for subsequent movement without snapping either pivot or image.
    return { ...current, joints: current.joints.map((joint) => joint.id === incoming.id ? { ...joint, fixed: !joint.fixed } : joint) }
  })

  const rotateBranch = (jointId: string, amount: number) => {
    if (!project) return
    const joint = project.joints.find((item) => item.id === jointId)
    if (!joint) return
    const affected = new Set<string>([joint.childPartId])
    let changed = true
    while (changed) {
      changed = false
      for (const item of project.joints) if (affected.has(item.parentPartId) && !affected.has(item.childPartId)) { affected.add(item.childPartId); changed = true }
    }
    const origin = jointPivot(joint)
    updateProject((current) => ({
      ...current,
      parts: current.parts.map((part) => {
        if (!affected.has(part.id)) return part
        const center = rotatePoint({ x: part.x + part.width / 2, y: part.y + part.height / 2 }, origin, amount)
        return { ...part, x: center.x - part.width / 2, y: center.y - part.height / 2, rotation: (part.rotation + amount) % 360, ...(part.jointAnchor ? { jointAnchor: rotatePoint(part.jointAnchor, origin, amount) } : {}) }
      }),
      joints: current.joints.map((item) => ({
        ...item,
        ...((affected.has(item.parentPartId) || affected.has(item.childPartId)) ? { pivot: rotatePoint(jointPivot(item), origin, amount) } : {}),
        ...(affected.has(item.parentPartId) ? { parentAnchor: rotatePoint(item.parentAnchor, origin, amount) } : {}),
        ...(affected.has(item.childPartId) ? { childAnchor: rotatePoint(item.childAnchor, origin, amount) } : {})
      }))
    }))
  }

  const beginPartDrag = (event: React.PointerEvent<HTMLImageElement>, part: ModelPart) => {
    if (connectMode || !project) return
    event.preventDefault(); event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedIds((current) => current.includes(part.id) ? current : [part.id])
    dragRef.current = { partId: part.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY }
  }

  const beginPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!project || (event.target instanceof Element && event.target.closest('.model-canvas-part, .model-joint-anchor, .model-stage-tools'))) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: pan.x, originY: pan.y }
    setPanning(true)
  }

  const movePan = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = panRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setPan({ x: drag.originX + event.clientX - drag.x, y: drag.originY + event.clientY - drag.y })
  }

  const movePartDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || !project || drag.pointerId !== event.pointerId || !scale) return
    const dx = (event.clientX - drag.x) / scale; const dy = (event.clientY - drag.y) / scale
    if (Math.abs(dx) + Math.abs(dy) > 0) updatePartPosition(drag.partId, dx, dy)
    drag.x = event.clientX; drag.y = event.clientY
  }

  const moveAnchorDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = anchorDragRef.current
    if (!drag || !project || drag.pointerId !== event.pointerId || !scale) return
    const dx = (event.clientX - drag.x) / scale + drag.offsetX; const dy = (event.clientY - drag.y) / scale
    updateProject((current) => {
      const part = current.parts.find((item) => item.id === drag.partId)
      if (!part) return current
      const anchor = partJointAnchor(part, current.joints)
      if (!anchor) return current
      const movedAnchor = { x: anchor.x + dx, y: anchor.y + dy }
      return {
        ...current,
        parts: current.parts.map((item) => item.id === drag.partId ? { ...item, jointAnchor: movedAnchor } : item),
        joints: current.joints.map((joint) => {
          const parentAnchor = joint.parentPartId === drag.partId ? movedAnchor : joint.parentAnchor
          const childAnchor = joint.childPartId === drag.partId ? movedAnchor : joint.childAnchor
          return { ...joint, parentAnchor, childAnchor, pivot: { x: (parentAnchor.x + childAnchor.x) / 2, y: (parentAnchor.y + childAnchor.y) / 2 } }
        })
      }
    })
    drag.x = event.clientX; drag.y = event.clientY; drag.offsetX = 0
  }

  const beginAnchorDrag = (event: React.PointerEvent<SVGCircleElement>, partId: string, displayOffset: number) => {
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
    anchorDragRef.current = { partId, pointerId: event.pointerId, x: event.clientX, y: event.clientY, offsetX: displayOffset / scale }
  }

  const renderEmptyState = () => (
    <div className="model-empty-state">
      <div className="model-empty-symbol"><Icon name="sparkles" /></div>
      <p className="model-eyebrow">BIBLIOTECA DE MODELOS</p>
      <h1>{slots[activeSlot - 1] ? 'Abrindo projeto…' : 'Sua mesa de montagem'}</h1>
      <p>Importe uma folha de peças. O Nymi remove o fundo, recorta cada elemento e abre o canvas para você montar e articular o modelo.</p>
      <button className="model-primary-button" onClick={() => void importSlot(activeSlot)} type="button"><Icon name="plus" /> Importar imagem</button>
      <span className="model-supported-formats">PNG · JPG · WEBP · processamento local</span>
    </div>
  )

  return (
    <main className="fabricator-layout" aria-label="Fabricador Dev">
      <aside className="fabricator-sidebar">
        <div className="fabricator-sidebar-heading">
          <span className="fabricator-heading-icon"><Icon name="box" /></span>
          <span><strong>Fabricador Dev</strong><small>ÁREAS DE PRODUÇÃO</small></span>
        </div>
        <nav className="fabricator-section-list" aria-label="Seções do Fabricador Dev">
          {sections.map((section) => (
            <button aria-pressed={activeSection === section.label} className={`fabricator-section-button${activeSection === section.label ? ' active' : ''}`} key={section.label} onClick={() => setActiveSection(section.label)} type="button">
              <Icon name={section.icon} /><span>{section.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {activeSection !== 'Modelos' ? (
        <section className="fabricator-workspace fabricator-coming-soon"><span><Icon name="sparkles" /></span><strong>{activeSection}</strong><small>Esta área será criada em uma próxima etapa.</small></section>
      ) : (
        <section className="fabricator-model-editor" aria-label="Editor de modelos">
          <header className="model-slotbar">
            <div className="model-slot-title"><span className="model-slot-logo"><Icon name="sparkles" /></span><span><strong>Modelos</strong><small>10 espaços de trabalho</small></span></div>
            <div className="model-slots" role="tablist" aria-label="Slots de modelos">
              {slots.map((slot, index) => {
                const number = index + 1
                return <button key={number} className={`model-slot${activeSlot === number ? ' active' : ''}${slot ? ' filled' : ' empty'}`} onClick={() => void selectSlot(number)} disabled={deletingSlot !== null} role="tab" aria-selected={activeSlot === number} aria-label={`Slot ${number}, ${slot ? 'preenchido' : 'vazio'}`} title={slot ? `Slot ${number}: ${slot.name} — ${slot.partCount} peças` : `Slot ${number}: vazio`} type="button">
                  <span>{String(number).padStart(2, '0')}</span><small>{slot ? 'Preenchido' : 'Vazio'}</small>
                </button>
              })}
            </div>
            {slots[activeSlot - 1] && <button className="model-delete-compact" onClick={() => void deleteSlot(activeSlot)} disabled={deletingSlot === activeSlot} title="Excluir permanentemente este modelo" type="button"><Icon name="trash" /><span>{deletingSlot === activeSlot ? 'Excluindo…' : 'Excluir modelo'}</span></button>}
            <button className="model-import-compact" onClick={() => void importSlot(activeSlot)} disabled={deletingSlot !== null} type="button"><Icon name="plus" /><span>Importar</span></button>
          </header>

          {!project ? (
            <div className="model-editor-content model-editor-empty">
              {processing ? <div className="model-processing"><div className="model-spinner" /><p className="model-eyebrow">PROCESSANDO LOCALMENTE</p><h2>Separando as peças…</h2><p>Removendo o fundo e encontrando cada área da imagem.</p><div className="model-progress"><span style={{ width: `${progress}%` }} /></div><small>{progress}%</small></div> : renderEmptyState()}
            </div>
          ) : (
            <>
              <div className="model-editor-toolbar">
                <div className="model-current-title"><span className="model-eyebrow">MODELO {String(project.slot).padStart(2, '0')}</span><input aria-label="Nome do modelo" value={project.name} onChange={(event) => updateProject((current) => ({ ...current, name: event.target.value }))} /></div>
                <div className="model-toolbar-actions">
                  <span className={`model-save-state ${saveState}`}><i />{saveState === 'saving' ? 'Salvando…' : saveState === 'error' ? 'Erro ao salvar' : 'Salvo localmente'}</span>
                  <button className={`model-tool-button model-pivot-visibility${showJointPivots ? ' active' : ''}`} aria-pressed={showJointPivots} onClick={() => setShowJointPivots((visible) => !visible)} title={showJointPivots ? 'Ocultar bolinhas das juntas' : 'Mostrar bolinhas das juntas'} type="button"><Icon name={showJointPivots ? 'eye' : 'eyeOff'} /><span>{showJointPivots ? 'Ocultar bolinhas' : 'Mostrar bolinhas'}</span></button>
                </div>
              </div>
              <div className="model-editor-content">
                <section className="model-canvas-column" aria-label="Prévia e montagem">
                  <div className="model-canvas-topline"><span><i /> CANVAS DE MONTAGEM</span><span>{project.width} × {project.height}</span></div>
                  <div ref={stageRef} className={`model-stage${panning ? ' panning' : ''}`} onPointerDown={beginPan} onPointerMove={(event) => { movePan(event); movePartDrag(event); moveAnchorDrag(event) }} onPointerUp={(event) => { if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null; if (anchorDragRef.current?.pointerId === event.pointerId) anchorDragRef.current = null; if (panRef.current?.pointerId === event.pointerId) { panRef.current = null; setPanning(false) } }} onPointerCancel={() => { dragRef.current = null; anchorDragRef.current = null; panRef.current = null; setPanning(false) }}>
                    <div className="model-artboard" style={{ width: `${project.width * scale}px`, height: `${project.height * scale}px`, left: `calc(50% + ${pan.x}px)`, top: `calc(50% + ${pan.y}px)` }}>
                      {canvasParts.filter((part) => !hiddenPartIds.includes(part.id)).map((part) => <img key={part.id} className={`model-canvas-part${selectedIds.includes(part.id) ? ' selected' : ''}${connectFromId === part.id ? ' connect-source' : ''}`} src={part.dataUrl} alt={part.name} draggable={false} onClick={(event) => { event.stopPropagation(); handlePartClick(part.id, event.ctrlKey || event.metaKey) }} onPointerDown={(event) => beginPartDrag(event, part)} style={{ left: part.x * scale, top: part.y * scale, width: part.width * scale, height: part.height * scale, transform: `rotate(${part.rotation}deg)` }} />)}
                      <svg className="model-joint-layer" viewBox={`0 0 ${project.width} ${project.height}`} preserveAspectRatio="none" aria-label="Conexões entre as peças">
                        {showJointPivots && jointMarkers.map(({ part, anchor, offset, fixed }) => <circle key={part.id} className={`model-joint-anchor${fixed ? ' fixed' : selectedIds.includes(part.id) ? ' selected' : ''}`} cx={anchor.x + offset / scale} cy={anchor.y} r={Math.max(selectedIds.includes(part.id) ? 11 : 8, (selectedIds.includes(part.id) ? 13 : 10) / scale)} aria-label={`Pivô de ${part.name}`} onPointerDown={(event) => beginAnchorDrag(event, part.id, offset)} />)}
                      </svg>
                    </div>
                    <div className="model-stage-tools"><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.min(2.4, value + 0.15))} title="Aumentar zoom" type="button"><Icon name="zoomIn" /></button><button onClick={() => setZoom((value) => Math.max(0.5, value - 0.15))} title="Diminuir zoom" type="button"><Icon name="zoomOut" /></button><button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} title="Centralizar prévia" type="button"><Icon name="frame" /></button></div>
                  </div>
                  <div className="model-canvas-footer"><span><kbd>Arraste o fundo</kbd> para mover a prévia <i /> <kbd>Arraste a peça</kbd> para posicionar <i /> <kbd>Ctrl</kbd> + clique para selecionar várias</span><span>{project.parts.length} peças <i /> {project.joints.length} conexões</span></div>
                </section>

                <aside className="model-parts-panel model-work-panel" aria-label="Painel de edição">
                  <div className="model-panel-header"><div><span className="model-eyebrow">MONTAGEM</span><h2>{panelTab === 'parts' ? 'Peças' : panelTab === 'layers' ? 'Camadas' : 'Articulações'} <small>{panelTab === 'joints' ? project.joints.length : project.parts.length}</small></h2></div><button className="model-icon-button" title="Adicionar outra folha" onClick={() => void importSlot(project.slot)} type="button"><Icon name="plus" /></button></div>
                  <div className="model-panel-tabs" role="tablist" aria-label="Ferramentas do modelo">
                    {([['parts', 'Peças'], ['layers', 'Camadas'], ['joints', 'Juntas']] as const).map(([tab, label]) => <button key={tab} role="tab" aria-selected={panelTab === tab} className={panelTab === tab ? 'active' : ''} onClick={() => setPanelTab(tab)} type="button">{label}</button>)}
                  </div>
                  {panelTab === 'parts' && <div className="model-panel-body">
                    <label className="model-part-search"><Icon name="search" /><input placeholder="Buscar peça…" value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
                    <div className="model-part-grid">{visibleParts.map((part) => <button key={part.id} className={`model-part-card${selectedIds.includes(part.id) ? ' selected' : ''}`} onClick={(event) => handlePartClick(part.id, event.ctrlKey || event.metaKey)} type="button" title={`${part.name} · selecione ou arraste no canvas`}><span className="model-part-thumb"><img src={part.dataUrl} alt="" /></span><span className="model-part-card-name">{part.name}</span><small>{Math.round(part.width)} × {Math.round(part.height)}</small></button>)}{visibleParts.length === 0 && <p className="model-no-parts">Nenhuma peça encontrada.</p>}</div>
                    {selectedPart && <div className="model-selected-tools"><div className="model-selected-name">{renamingPartId === selectedPart.id ? <input autoFocus value={selectedPart.name} onBlur={() => setRenamingPartId(null)} onChange={(event) => updateProject((current) => ({ ...current, parts: current.parts.map((part) => part.id === selectedPart.id ? { ...part, name: event.target.value } : part) }))} onKeyDown={(event) => { if (event.key === 'Enter') setRenamingPartId(null) }} /> : <><strong>{selectedPart.name}</strong><button title="Renomear peça" onClick={() => setRenamingPartId(selectedPart.id)} type="button"><Icon name="edit" /></button></>}</div><div className="model-action-row"><button className="model-tool-button" onClick={() => void splitSelected('vertical')} disabled={selectedPart.rotation !== 0 || selectedPart.width < 2} type="button">Dividir ↔</button><button className="model-tool-button" onClick={() => void splitSelected('horizontal')} disabled={selectedPart.rotation !== 0 || selectedPart.height < 2} type="button">Dividir ↕</button><button className="model-tool-button danger" onClick={() => removePart(selectedPart.id)} type="button">Excluir</button></div>{selectedPartIds.length > 1 && <button className="model-merge-button" onClick={() => void mergeSelected()} type="button">Mesclar {selectedPartIds.length} peças selecionadas</button>}</div>}
                    <div className="model-source-info"><span><Icon name="frame" /> Fonte</span><small title={project.sourceName}>{project.sourceName}</small></div>
                  </div>}
                  {panelTab === 'layers' && <div className="model-panel-body model-layer-panel"><p className="model-panel-intro">Arraste uma linha ou use as setas. O item no topo fica na frente. Fixar mantém a posição e a sobreposição atuais, e faz esse par acompanhar os próximos movimentos.</p><div className="model-layer-list">{frontToBackLayers.map((part, index) => { const joint = project.joints.find((item) => item.childPartId === part.id); const fixed = Boolean(joint?.fixed); return <div key={part.id} draggable className={`model-layer-row${selectedIds.includes(part.id) ? ' selected' : ''}${layerDragId === part.id ? ' dragging' : ''}`} onDragStart={(event) => { layerDragRef.current = part.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', part.id); setLayerDragId(part.id) }} onDragEnd={() => { layerDragRef.current = null; setLayerDragId(null) }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }} onDrop={(event) => { event.preventDefault(); const sourceId = event.dataTransfer.getData('text/plain') || layerDragRef.current; if (sourceId) dropLayer(sourceId, part.id); layerDragRef.current = null; setLayerDragId(null) }}><button className="model-layer-select" onClick={() => { setSelectedIds([part.id]); setPanelTab('parts') }} type="button"><span className="model-layer-thumb"><img src={part.dataUrl} alt="" /></span><span><strong>{part.name}</strong><small>Camada {frontToBackLayers.length - index} · {hiddenPartIds.includes(part.id) ? 'Oculta' : 'Visível'}{joint ? ` · ${fixed ? 'Fixada' : 'Solta'}` : ''}</small></span></button><div className="model-layer-controls"><button title="Mover para frente" aria-label={`Mover ${part.name} para frente`} disabled={index === 0} onClick={() => moveLayer(part.id, -1)} type="button">↑</button><button title="Mover para trás" aria-label={`Mover ${part.name} para trás`} disabled={index === frontToBackLayers.length - 1} onClick={() => moveLayer(part.id, 1)} type="button">↓</button><button className={`model-layer-fix${fixed ? ' fixed' : ''}`} title={joint ? fixed ? 'Desfixar do pai' : 'Fixar ao pai' : 'Esta peça não tem junta com uma peça-pai'} aria-label={joint ? fixed ? `Desfixar ${part.name} do pai` : `Fixar ${part.name} ao pai` : `${part.name} não tem junta pai`} aria-pressed={fixed} disabled={!joint} onClick={() => toggleJointFix(part.id)} type="button"><Icon name="link" /></button><button title={hiddenPartIds.includes(part.id) ? 'Mostrar peça' : 'Ocultar peça'} aria-label={hiddenPartIds.includes(part.id) ? `Mostrar ${part.name}` : `Ocultar ${part.name}`} aria-pressed={!hiddenPartIds.includes(part.id)} onClick={() => toggleLayerVisibility(part.id)} type="button">{hiddenPartIds.includes(part.id) ? '○' : '◉'}</button></div></div>})}</div></div>}
                  {panelTab === 'joints' && <div className="model-panel-body model-joint-panel"><button className="model-auto-connect" onClick={() => updateProject((current) => { const rig = normalizePartAnchors(current.parts, [...current.joints.filter((joint) => !joint.suggested), ...autoConnectParts(current.parts)]); return { ...current, parts: rig.parts, joints: rig.joints } })} type="button"><Icon name="sparkles" /><span><strong>Conectar automaticamente</strong><small>Detectar cabeça, braços, pernas e encaixes</small></span></button><button className={`model-tool-button model-manual-connect${connectMode ? ' active' : ''}`} onClick={() => { setConnectMode((value) => !value); setConnectFromId(null) }} type="button"><span className="model-link-dot" />{connectMode ? 'Selecione duas peças no canvas' : 'Ligar peças manualmente'}</button>{connectMode && <p className="model-connect-hint">Clique primeiro na peça que ficará parada e depois na peça que ela movimenta.</p>}<p className="model-panel-intro">Cada peça conectada tem uma única bolinha. Todas as conexões dessa peça usam o mesmo pivô; selecione a peça para destacar e arraste essa bolinha. O tronco é o centro e não recebe bolinha.</p><div className="model-joint-legend"><span><i className="loose" />Solta</span><span><i className="selected" />Selecionada</span><span><i className="fixed" />Fixada</span></div><div className="model-joint-list"><div className="model-joint-list-heading"><strong>Conexões do esqueleto</strong><small>{project.joints.length}</small></div>{project.joints.length === 0 ? <p className="model-joint-empty">Ainda não há conexões. Use a sugestão automática ou ligue duas peças manualmente.</p> : project.joints.map((joint) => { const parent = project.parts.find((part) => part.id === joint.parentPartId); const child = project.parts.find((part) => part.id === joint.childPartId); return <div className="model-joint-row" key={joint.id}><span className="model-joint-row-name"><b>{parent?.name ?? 'Peça'}</b><Icon name="chevronRight" /><b>{child?.name ?? 'Peça'}</b>{joint.suggested && <small>AUTO</small>}</span><span className="model-joint-controls"><button title="Girar ramo à esquerda" onClick={() => rotateBranch(joint.id, -15)} type="button">−15°</button><button title="Girar ramo à direita" onClick={() => rotateBranch(joint.id, 15)} type="button">+15°</button><button title="Desconectar" onClick={() => updateProject((current) => ({ ...current, joints: current.joints.filter((item) => item.id !== joint.id) }))} type="button">×</button></span></div>})}</div></div>}
                </aside>
              </div>
            </>
          )}
          {error && <div className="model-toast" role="status"><span>{error}</span><button onClick={() => setError('')} type="button" aria-label="Fechar aviso">×</button></div>}
          {processing && project && <div className="model-processing-overlay"><div className="model-spinner" /><span>Reanalisando imagem · {progress}%</span></div>}
        </section>
      )}
    </main>
  )
}
