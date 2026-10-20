import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FabricatorAssetSave, FabricatorHistoryAction, FabricatorHistorySaveState, FabricatorHistoryState, FabricatorProject, FabricatorSlotSummary, ModelPart } from '../../../../shared/fabricator'
import { Icon, type IconName } from '../../ui/components/Icon'
import { usePreviewBackground } from './usePreviewBackground'
import { despillGreenFringes, sampleBackground } from './models/chroma'
import { autoConnectParts, createJoint, jointPivot, normalizeLayerOrder, normalizePartAnchors, orderedParts, partJointAnchor, reorderLayer, sourcePointFromCanvas } from './models/rig'
import { headSizePercent, isHeadPart, resizeHeadPart } from './models/resize'
import { PoseWorkspace } from './PoseWorkspace'
import { WardrobeWorkspace } from './wardrobe/WardrobeWorkspace'
import { FaceComponentsWorkspace } from './face/FaceComponentsWorkspace'
import { HeadExtrasWorkspace } from './face/HeadExtrasWorkspace'
import { HairWorkspace } from './HairWorkspace'
import { AnimatorWorkspace } from './AnimatorWorkspace'
import { DesignWorkspace } from './DesignWorkspace'
import { ExpressionPresetWorkspace } from './ExpressionPresetWorkspace'
import { FaceAnimatorWorkspace } from './FaceAnimatorWorkspace'

const sections: { id: string; label: string; icon: IconName }[] = [
  { id: 'Modelos', label: 'Modelos Dev', icon: 'sparkles' }, { id: 'Poses', label: 'Poses Dev', icon: 'expand' }, { id: 'Roupas', label: 'Roupas Dev', icon: 'shirt' }, { id: 'Olhos', label: 'Olhos Dev', icon: 'face' }, { id: 'Rosto', label: 'Rosto Dev', icon: 'face' }, { id: 'Preset Expressão Dev', label: 'Preset Expressão Dev', icon: 'face' }, { id: 'Animador Rosto Dev', label: 'Animador Rosto Dev', icon: 'face' }, { id: 'Cabeças extra', label: 'Cabeças extra dev', icon: 'face' }, { id: 'Cabelos Dev', label: 'Cabelos Dev', icon: 'bow' }, { id: 'Animador Dev', label: 'Animador Dev', icon: 'body' }, { id: 'Design Dev', label: 'Design Dev', icon: 'flower' }
]

type ProcessedPart = Omit<ModelPart, 'dataUrl' | 'chromaBaseDataUrl'> & { png: ArrayBuffer; basePng: ArrayBuffer }
type ProcessorMessage =
  | { type: 'progress'; id: number; value: number }
  | { type: 'complete'; id: number; width: number; height: number; parts: ProcessedPart[] }
  | { type: 'error'; id: number; message: string }
type ChromaAdjustMessage =
  | { type: 'complete'; id: number; parts: Array<{ id: string; png: ArrayBuffer }> }
  | { type: 'error'; id: number; message: string }
type DragState = { partId: string; pointerId: number; x: number; y: number }
type AnchorDragState = { partId: string; pointerId: number; x: number; y: number; offsetX: number }
type PanState = { pointerId: number; x: number; y: number; originX: number; originY: number }
type MixerSurface = { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }
type MixerStrokeState = { pointerId: number; x: number; y: number }
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

const DEFAULT_CHROMA_TOLERANCE = 74
const MAX_CHROMA_TOLERANCE = 280
const emptyHistory = (): FabricatorHistoryState => ({ undo: [], redo: [] })

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
  const baseImage = await imageFromDataUrl(part.chromaBaseDataUrl ?? part.dataUrl)
  const firstWidth = axis === 'vertical' ? Math.floor(part.width / 2) : part.width
  const firstHeight = axis === 'horizontal' ? Math.floor(part.height / 2) : part.height
  const regions = axis === 'vertical'
    ? [{ x: 0, y: 0, width: firstWidth, height: part.height }, { x: firstWidth, y: 0, width: part.width - firstWidth, height: part.height }]
    : [{ x: 0, y: 0, width: part.width, height: firstHeight }, { x: 0, y: firstHeight, width: part.width, height: part.height - firstHeight }]
  return Promise.all(regions.map(async (region, index) => {
    const canvas = document.createElement('canvas')
    canvas.width = region.width; canvas.height = region.height
    canvas.getContext('2d')?.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height)
    const baseCanvas = document.createElement('canvas')
    baseCanvas.width = region.width; baseCanvas.height = region.height
    baseCanvas.getContext('2d')?.drawImage(baseImage, region.x, region.y, region.width, region.height, 0, 0, region.width, region.height)
    const sourceX = (part.sourceTransform?.x ?? part.x) + region.x
    const sourceY = (part.sourceTransform?.y ?? part.y) + region.y
    return { ...part, id: makeId(), name: `${part.name} ${index === 0 ? 'A' : 'B'}`, x: part.x + region.x, y: part.y + region.y, width: region.width, height: region.height, rotation: 0, jointAnchor: { x: part.x + region.x + region.width / 2, y: part.y + region.y + region.height / 2 }, sourceTransform: part.sourceTransform ? { x: sourceX, y: sourceY, width: region.width, height: region.height, rotation: part.sourceTransform.rotation, anchorVersion: 1, jointAnchor: { x: sourceX + region.width / 2, y: sourceY + region.height / 2 } } : undefined, chromaBaseSaved: true, chromaBaseDataUrl: baseCanvas.toDataURL('image/png'), dataUrl: canvas.toDataURL('image/png') }
  }))
}

async function mergeImages(parts: ModelPart[]): Promise<ModelPart> {
  const x = Math.min(...parts.map((part) => part.x)); const y = Math.min(...parts.map((part) => part.y))
  const right = Math.max(...parts.map((part) => part.x + part.width)); const bottom = Math.max(...parts.map((part) => part.y + part.height))
  const canvas = document.createElement('canvas'); canvas.width = Math.ceil(right - x); canvas.height = Math.ceil(bottom - y)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Não foi possível mesclar as peças.')
  const baseCanvas = document.createElement('canvas'); baseCanvas.width = canvas.width; baseCanvas.height = canvas.height
  const baseContext = baseCanvas.getContext('2d')
  if (!baseContext) throw new Error('Não foi possível mesclar as bases do chroma.')
  for (const part of parts) {
    const image = await imageFromDataUrl(part.dataUrl)
    const baseImage = await imageFromDataUrl(part.chromaBaseDataUrl ?? part.dataUrl)
    context.save()
    context.translate(part.x - x + part.width / 2, part.y - y + part.height / 2)
    context.rotate(part.rotation * Math.PI / 180)
    context.drawImage(image, -part.width / 2, -part.height / 2, part.width, part.height)
    context.restore()
    baseContext.save()
    baseContext.translate(part.x - x + part.width / 2, part.y - y + part.height / 2)
    baseContext.rotate(part.rotation * Math.PI / 180)
    baseContext.drawImage(baseImage, -part.width / 2, -part.height / 2, part.width, part.height)
    baseContext.restore()
  }
  return { id: makeId(), name: 'Peças mescladas', x, y, width: canvas.width, height: canvas.height, rotation: 0, chromaBaseSaved: true, chromaBaseDataUrl: baseCanvas.toDataURL('image/png'), dataUrl: canvas.toDataURL('image/png') }
}

export function FabricatorPage() {
  const [previewBackground] = usePreviewBackground()
  const [activeSection, setActiveSection] = useState('Modelos')
  const [slots, setSlots] = useState<FabricatorSlotSummary[]>(Array.from({ length: 10 }, () => null))
  const [slotsLoaded, setSlotsLoaded] = useState(false)
  const [activeSlot, setActiveSlot] = useState(1)
  const [project, setProject] = useState<FabricatorProject | null>(null)
  const [history, setHistory] = useState<FabricatorHistoryState>(emptyHistory)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [processing, setProcessing] = useState(false)
  const [chromaApplying, setChromaApplying] = useState(false)
  const [chromaValue, setChromaValue] = useState(DEFAULT_CHROMA_TOLERANCE)
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
  const [mixerActive, setMixerActive] = useState(false)
  const [mixerPainting, setMixerPainting] = useState(false)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [renamingPartId, setRenamingPartId] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const projectRef = useRef<FabricatorProject | null>(null)
  const historyRef = useRef<FabricatorHistoryState>(emptyHistory())
  const historyGestureRef = useRef(false)
  const historyGestureChangedRef = useRef(false)
  const historyGestureSnapshotRef = useRef<FabricatorProject | null>(null)
  const historyGestureActionRef = useRef<FabricatorHistoryAction>('edit')
  const dragRef = useRef<DragState | null>(null)
  const anchorDragRef = useRef<AnchorDragState | null>(null)
  const panRef = useRef<PanState | null>(null)
  const mixerStrokeRef = useRef<MixerStrokeState | null>(null)
  const mixerTouchedRef = useRef<Map<string, Uint8Array>>(new Map())
  const mixerSurfacesRef = useRef<Map<string, MixerSurface>>(new Map())
  const mixerQueueRef = useRef<Promise<void>>(Promise.resolve())
  const mixerSessionRef = useRef(0)
  const layerDragRef = useRef<string | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const chromaWorkerRef = useRef<Worker | null>(null)
  const requestId = useRef(0)
  const dirtyAssets = useRef<Map<string, string>>(new Map())
  const dirtyChromaBases = useRef<Map<string, string>>(new Map())
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initialSlotLoad = useRef(false)

  const persistProject = useCallback(async (snapshot: FabricatorProject) => {
    let assets: FabricatorAssetSave[] = Array.from(dirtyAssets.current, ([id, dataUrl]) => ({
      id, dataUrl,
      ...(dirtyChromaBases.current.has(id) ? { chromaBaseDataUrl: dirtyChromaBases.current.get(id)! } : {})
    }))
    const baseAssets = snapshot.parts.flatMap((part) => dirtyChromaBases.current.has(part.id) && !dirtyAssets.current.has(part.id)
      ? [{ id: part.id, dataUrl: part.dataUrl, chromaBaseDataUrl: part.chromaBaseDataUrl! }]
      : [])
    assets = [...assets, ...baseAssets]
    const { sourceDataUrl: _sourceDataUrl, parts, ...metadata } = snapshot
    const serialized = { ...metadata, parts: parts.map(({ dataUrl: _dataUrl, chromaBaseDataUrl: _baseDataUrl, ...part }) => part) }
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
    for (const asset of assets) {
      if (dirtyAssets.current.get(asset.id) === asset.dataUrl) dirtyAssets.current.delete(asset.id)
      if (asset.chromaBaseDataUrl && dirtyChromaBases.current.get(asset.id) === asset.chromaBaseDataUrl) dirtyChromaBases.current.delete(asset.id)
    }
    setSaveState('saved')
    window.dispatchEvent(new Event('fabricator:assets-updated'))
    setSlots((current) => current.map((item, index) => index + 1 === snapshot.slot ? { slot: snapshot.slot, name: snapshot.name, sourceName: snapshot.sourceName, partCount: snapshot.parts.length, updatedAt: snapshot.updatedAt } : item))
  }, [])

  const publishHistory = (next: FabricatorHistoryState, currentProject: FabricatorProject) => {
    const bounded = { undo: next.undo.slice(-50), redo: next.redo.slice(-50) }
    historyRef.current = bounded
    setHistory(bounded)
    const forDisk: FabricatorHistorySaveState = {
      undo: bounded.undo.map(({ action, project: snapshot }) => { const { sourceDataUrl: _sourceDataUrl, ...project } = snapshot; return { action, project } }),
      redo: bounded.redo.map(({ action, project: snapshot }) => { const { sourceDataUrl: _sourceDataUrl, ...project } = snapshot; return { action, project } })
    }
    const { sourceDataUrl: _sourceDataUrl, parts, ...metadata } = currentProject
    const currentForDisk = { ...metadata, parts: parts.map(({ dataUrl: _dataUrl, chromaBaseDataUrl: _baseDataUrl, ...part }) => part) }
    const changedAssets = parts.flatMap((part) => {
      const dataUrl = dirtyAssets.current.get(part.id)
      const chromaBaseDataUrl = dirtyChromaBases.current.get(part.id)
      return dataUrl || chromaBaseDataUrl ? [{ id: part.id, dataUrl: dataUrl ?? part.dataUrl, ...(chromaBaseDataUrl ? { chromaBaseDataUrl } : {}) }] : []
    })
    setSaveState('saving')
    void window.desktop.saveFabricatorHistory(currentProject.slot, forDisk, currentForDisk, changedAssets).then(() => {
      for (const asset of changedAssets) if (dirtyAssets.current.get(asset.id) === asset.dataUrl) dirtyAssets.current.delete(asset.id)
      setSaveState('saved')
      setSlots((current) => current.map((item, index) => index + 1 === currentProject.slot ? { slot: currentProject.slot, name: currentProject.name, sourceName: currentProject.sourceName, partCount: currentProject.parts.length, updatedAt: currentProject.updatedAt } : item))
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? `Falha ao salvar o histórico: ${reason.message}` : 'Falha ao salvar o histórico local.')
      setSaveState('error')
    })
  }

  const recordHistorySnapshot = (snapshot: FabricatorProject, action: FabricatorHistoryAction, currentProject: FabricatorProject) => {
    const current = historyRef.current
    publishHistory({ undo: [...current.undo, { action, project: snapshot }].slice(-50), redo: [] }, currentProject)
  }

  const startHistoryGesture = (action: FabricatorHistoryAction) => {
    if (historyGestureRef.current) return
    historyGestureRef.current = true
    historyGestureChangedRef.current = false
    historyGestureSnapshotRef.current = projectRef.current
    historyGestureActionRef.current = action
  }

  const finishHistoryGesture = () => {
    const snapshot = historyGestureSnapshotRef.current
    const changed = historyGestureChangedRef.current
    const action = historyGestureActionRef.current
    historyGestureRef.current = false
    historyGestureChangedRef.current = false
    historyGestureSnapshotRef.current = null
    if (snapshot && changed && projectRef.current) recordHistorySnapshot(snapshot, action, projectRef.current)
  }

  const restoreHistory = async (direction: 'undo' | 'redo') => {
    const currentProject = projectRef.current
    const currentHistory = historyRef.current
    const sourceStack = currentHistory[direction]
    const entry = sourceStack[sourceStack.length - 1]
    if (!currentProject || !entry || historyBusy || processing || chromaApplying) return
    setHistoryBusy(true)
    try {
      const target = entry.project
      const nextHistory: FabricatorHistoryState = direction === 'undo'
        ? { undo: currentHistory.undo.slice(0, -1), redo: [...currentHistory.redo, { action: entry.action, project: currentProject }].slice(-50) }
        : { undo: [...currentHistory.undo, { action: entry.action, project: currentProject }].slice(-50), redo: currentHistory.redo.slice(0, -1) }
      for (const part of target.parts) {
        dirtyAssets.current.set(part.id, part.dataUrl)
        if (part.chromaBaseDataUrl && part.chromaBaseSaved) dirtyChromaBases.current.set(part.id, part.chromaBaseDataUrl)
      }
      projectRef.current = target
      setProject(target); setSelectedIds((ids) => { const valid = ids.filter((id) => target.parts.some((part) => part.id === id)); return valid.length ? valid : target.parts[0] ? [target.parts[0].id] : [] })
      publishHistory(nextHistory, target)
    } catch (reason) {
      setError(reason instanceof Error ? `Não foi possível restaurar o histórico: ${reason.message}` : 'Não foi possível restaurar esse estado.')
    } finally {
      setHistoryBusy(false)
    }
  }

  useEffect(() => {
    void window.desktop.listFabricatorSlots()
      .then((items) => { setSlots(items); setSlotsLoaded(true) })
      .catch((reason: unknown) => { setSlotsLoaded(true); setError(reason instanceof Error ? reason.message : 'Não foi possível abrir a biblioteca.') })
    return () => { workerRef.current?.terminate(); chromaWorkerRef.current?.terminate(); if (savedTimer.current) clearTimeout(savedTimer.current) }
  }, [])

  useEffect(() => { projectRef.current = project }, [project])

  useEffect(() => {
    if (activeSection !== 'Modelos') return
    const element = stageRef.current
    if (!element) return
    const measure = () => {
      const bounds = element.getBoundingClientRect()
      setStageSize((previous) => previous.width === bounds.width && previous.height === bounds.height ? previous : { width: bounds.width, height: bounds.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [activeSection, project])

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

  useEffect(() => {
    if (connectMode && mixerActive) setMixerActive(false)
  }, [connectMode, mixerActive])

  const selectedPartIds = selectedIds
  const selectedPart = project?.parts.find((part) => part.id === selectedPartIds[0]) ?? null
  const normalizedPartFilter = useMemo(() => filter.toLowerCase(), [filter])
  const visibleParts = useMemo(() => (project?.parts ?? []).filter((part) => part.name.toLowerCase().includes(normalizedPartFilter)), [project, normalizedPartFilter])
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
  const measuredWidth = Math.max(stageSize.width, stageRef.current?.clientWidth ?? 0)
  const measuredHeight = Math.max(stageSize.height, stageRef.current?.clientHeight ?? 0)
  const scale = project ? Math.max(0.05, Math.min((measuredWidth - 48) / project.width, (measuredHeight - 48) / project.height)) * zoom : 1

  const updateProject = (updater: (current: FabricatorProject) => FabricatorProject, action: FabricatorHistoryAction = 'edit') => {
    const current = projectRef.current
    if (!current) return
    const next = updater(current)
    if (next === current) return
    const validIds = new Set(next.parts.map((part) => part.id))
    const normalized: FabricatorProject = {
      ...next,
      layerOrder: normalizeLayerOrder(next.parts, next.layerOrder),
      hiddenPartIds: (next.hiddenPartIds ?? []).filter((id) => validIds.has(id)),
      joints: next.joints.filter((joint) => validIds.has(joint.parentPartId) && validIds.has(joint.childPartId)),
      updatedAt: new Date().toISOString()
    }
    projectRef.current = normalized
    setProject(normalized)
    if (historyGestureRef.current) historyGestureChangedRef.current = true
    else recordHistorySnapshot(current, action, normalized)
  }

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
    chromaWorkerRef.current?.terminate(); chromaWorkerRef.current = null; setChromaApplying(false)
    mixerSessionRef.current += 1
    historyGestureRef.current = false; historyGestureChangedRef.current = false; historyGestureSnapshotRef.current = null
    historyRef.current = emptyHistory(); setHistory(historyRef.current)
    setActiveSlot(slot); setProject(null); setSelectedIds([]); setError(''); dirtyAssets.current.clear(); dirtyChromaBases.current.clear(); mixerSurfacesRef.current.clear(); mixerStrokeRef.current = null; setMixerActive(false); setMixerPainting(false); setZoom(1); setPan({ x: 0, y: 0 })
    const summary = slots[slot - 1]
    if (!summary) return
    try {
      const loaded = await window.desktop.loadFabricatorSlot(slot)
      if (!loaded) throw new Error('O projeto salvo não pôde ser carregado.')
      let loadedHistory = emptyHistory()
      try { loadedHistory = await window.desktop.loadFabricatorHistory(slot) } catch { setError('O modelo abriu, mas o histórico persistido não pôde ser carregado.') }
      historyRef.current = loadedHistory; setHistory(loadedHistory)
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
      const historicalBaselines = [loaded, ...loadedHistory.undo, ...loadedHistory.redo]
        .map((entry) => 'project' in entry ? entry.project : entry)
        .filter((candidate) => candidate.parts.length === loaded.parts.length && loaded.parts.every((part) => candidate.parts.some((item) => item.id === part.id)))
        .sort((a, b) => a.tolerance - b.tolerance)
      const historicalBaseline = historicalBaselines[0]
      const chromaBaseTolerance = loaded.chromaBaseTolerance ?? (loaded.parts.every((part) => part.chromaBaseDataUrl) ? 0 : historicalBaseline?.tolerance ?? loaded.tolerance)
      const partsWithBases = loadedParts.map((part) => {
        const storedPart = loaded.parts.find((item) => item.id === part.id)
        const historicalPart = historicalBaseline?.parts.find((item) => item.id === part.id)
        const chromaBaseDataUrl = storedPart?.chromaBaseDataUrl ?? historicalPart?.dataUrl ?? part.dataUrl
        const chromaBaseSaved = storedPart?.chromaBaseSaved ?? Boolean(historicalPart)
        if (chromaBaseSaved && !storedPart?.chromaBaseDataUrl && chromaBaseDataUrl) dirtyChromaBases.current.set(part.id, chromaBaseDataUrl)
        return { ...part, chromaBaseSaved, chromaBaseDataUrl }
      })
      setProject({
        ...loaded,
        chromaVersion,
        chromaBaseTolerance,
        parts: partsWithBases,
        layerOrder: normalizeLayerOrder(loaded.parts, loaded.layerOrder),
        hiddenPartIds: loaded.hiddenPartIds ?? [],
        joints: rig.joints
      }); setSelectedIds(loaded.parts[0] ? [loaded.parts[0].id] : [])
      setChromaValue(loaded.tolerance)
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
      chromaWorkerRef.current?.terminate(); chromaWorkerRef.current = null; setChromaApplying(false)
      setProcessing(false)
    }
    try {
      await window.desktop.deleteFabricatorSlot(slot)
      setSlots((current) => current.map((item, index) => index === slot - 1 ? null : item))
      if (activeSlot === slot) {
        workerRef.current?.terminate(); workerRef.current = null
        setProcessing(false); setProgress(0); setProject(null); setSelectedIds([]); dirtyAssets.current.clear(); dirtyChromaBases.current.clear(); setError('')
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

  const runProcessor = (sourceDataUrl: string, tolerance: number, metadata: { slot: number; name: string; sourceName: string; sourceAssetName: string }, recordBefore?: FabricatorProject) => {
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
      const parts: ModelPart[] = message.parts.map(({ png, basePng, ...part }) => ({ ...part, rotation: 0, chromaBaseSaved: true, dataUrl: bytesToDataUrl(png), chromaBaseDataUrl: bytesToDataUrl(basePng) }))
      for (const part of parts) { dirtyAssets.current.set(part.id, part.dataUrl); if (part.chromaBaseDataUrl) dirtyChromaBases.current.set(part.id, part.chromaBaseDataUrl) }
      const detectedJoints = autoConnectParts(parts)
      const rig = normalizePartAnchors(parts, detectedJoints)
      const sourceParts = rig.parts.map((part) => ({ ...part, sourceTransform: { x: part.x, y: part.y, width: part.width, height: part.height, rotation: part.rotation, anchorVersion: 1 as const, ...(part.jointAnchor ? { jointAnchor: { ...part.jointAnchor } } : {}) } }))
      const nextProject: FabricatorProject = {
        schemaVersion: 1, chromaVersion: 2, chromaBaseTolerance: 0, slot: metadata.slot, name: metadata.name, sourceName: metadata.sourceName,
        sourceAssetName: metadata.sourceAssetName, sourceDataUrl, width: message.width, height: message.height,
        tolerance, parts: sourceParts, joints: rig.joints, layerOrder: parts.map((part) => part.id), hiddenPartIds: [], updatedAt: new Date().toISOString()
      }
      if (recordBefore) recordHistorySnapshot(recordBefore, 'reset', nextProject)
      setChromaValue(tolerance)
      projectRef.current = nextProject
      setProject(nextProject); setSelectedIds(parts[0] ? [parts[0].id] : [])
    }
    worker.onerror = () => { worker.terminate(); workerRef.current = null; setProcessing(false); setError('O processamento da imagem falhou.') }
    worker.postMessage({ id, sourceDataUrl, tolerance })
  }

  const applyChromaKey = () => {
    if (!project || chromaApplying || processing || historyBusy || chromaValue === project.tolerance) return
    chromaWorkerRef.current?.terminate()
    const worker = new Worker(new URL('./models/chromaAdjust.worker.ts', import.meta.url), { type: 'module' })
    chromaWorkerRef.current = worker
    const id = ++requestId.current
    const slot = project.slot
    const tolerance = chromaValue
    setChromaApplying(true); setError('')
    worker.onmessage = (event: MessageEvent<ChromaAdjustMessage>) => {
      if (event.data.id !== id) return
      worker.terminate(); chromaWorkerRef.current = null; setChromaApplying(false)
      if (event.data.type === 'error') { setError(`Chroma key: ${event.data.message}`); return }
      const updatedAssets = new Map(event.data.parts.map(({ id: partId, png }) => [partId, bytesToDataUrl(png)]))
      for (const [partId, dataUrl] of updatedAssets) dirtyAssets.current.set(partId, dataUrl)
      mixerSurfacesRef.current.clear()
      updateProject((current) => current.slot !== slot ? current : {
        ...current,
        tolerance,
        parts: current.parts.map((part) => updatedAssets.has(part.id) ? { ...part, dataUrl: updatedAssets.get(part.id)! } : part)
      })
    }
    worker.onerror = () => {
      worker.terminate(); chromaWorkerRef.current = null; setChromaApplying(false)
      setError('O ajuste do chroma key falhou. Suas posições e conexões foram preservadas.')
    }
    worker.postMessage({
      id,
      sourceDataUrl: project.sourceDataUrl,
      tolerance,
      parts: project.parts.map(({ id: partId, dataUrl, chromaBaseDataUrl }) => ({ id: partId, dataUrl: chromaBaseDataUrl ?? dataUrl }))
    })
  }

  const resetModel = async () => {
    if (!project || processing || chromaApplying || historyBusy) return
    const originalName = project.sourceName.replace(/\.[^.]+$/, '') || `Modelo ${project.slot}`
    if (!window.confirm('Resetar este modelo para a importação original? Isso vai apagar os recortes, posições, camadas, juntas e ajustes atuais.')) return
    if (savedTimer.current) clearTimeout(savedTimer.current)
    setProcessing(true)
    try {
      await persistProject(project)
    } catch (reason) {
      setProcessing(false)
      setError(reason instanceof Error ? `Não foi possível salvar antes de resetar: ${reason.message}` : 'Não foi possível salvar antes de resetar.')
      setProject((current) => current ? { ...current, updatedAt: new Date().toISOString() } : current)
      return
    }
    chromaWorkerRef.current?.terminate(); chromaWorkerRef.current = null; setChromaApplying(false)
    setChromaValue(DEFAULT_CHROMA_TOLERANCE)
    dirtyAssets.current.clear(); dirtyChromaBases.current.clear()
    runProcessor(project.sourceDataUrl, DEFAULT_CHROMA_TOLERANCE, {
      slot: project.slot,
      name: originalName,
      sourceName: project.sourceName,
      sourceAssetName: project.sourceAssetName
    }, project)
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
      chromaWorkerRef.current?.terminate(); chromaWorkerRef.current = null; setChromaApplying(false)
      mixerSessionRef.current += 1
      setActiveSlot(slot); setProject(null); setSelectedIds([]); dirtyAssets.current.clear(); dirtyChromaBases.current.clear(); mixerSurfacesRef.current.clear(); mixerStrokeRef.current = null; setMixerActive(false); setMixerPainting(false)
      const name = selected.sourceName.replace(/\.[^.]+$/, '') || `Modelo ${slot}`
      const recordBefore = project?.slot === slot ? project : undefined
      if (!recordBefore) { historyRef.current = emptyHistory(); setHistory(historyRef.current) }
      runProcessor(selected.sourceDataUrl, 74, { slot, name, sourceName: selected.sourceName, sourceAssetName: selected.sourceAssetName }, recordBefore)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível importar a imagem.') }
  }

  const removePart = (partId: string) => {
    updateProject((current) => ({ ...current, parts: current.parts.filter((part) => part.id !== partId), joints: current.joints.filter((joint) => joint.parentPartId !== partId && joint.childPartId !== partId) }))
    setSelectedIds((current) => current.filter((id) => id !== partId))
    dirtyAssets.current.delete(partId)
    dirtyChromaBases.current.delete(partId)
  }

  const splitSelected = async (axis: 'horizontal' | 'vertical') => {
    if (!selectedPart || selectedPart.rotation !== 0) return
    const split = await splitImage(selectedPart, axis)
    for (const part of split) { dirtyAssets.current.set(part.id, part.dataUrl); if (part.chromaBaseDataUrl) dirtyChromaBases.current.set(part.id, part.chromaBaseDataUrl) }
    updateProject((current) => ({ ...current, parts: [...current.parts.filter((part) => part.id !== selectedPart.id), ...split], joints: current.joints.filter((joint) => joint.parentPartId !== selectedPart.id && joint.childPartId !== selectedPart.id) }))
    setSelectedIds(split.map((part) => part.id)); dirtyAssets.current.delete(selectedPart.id)
  }

  const mergeSelected = async () => {
    if (!project || selectedPartIds.length < 2) return
    const parts = project.parts.filter((part) => selectedPartIds.includes(part.id))
    const merged = await mergeImages(parts)
    dirtyAssets.current.set(merged.id, merged.dataUrl)
    if (merged.chromaBaseDataUrl) dirtyChromaBases.current.set(merged.id, merged.chromaBaseDataUrl)
    const ids = new Set(parts.map((part) => part.id))
    updateProject((current) => ({ ...current, parts: [...current.parts.filter((part) => !ids.has(part.id)), merged], joints: current.joints.filter((joint) => !ids.has(joint.parentPartId) && !ids.has(joint.childPartId)) }))
    for (const id of ids) { dirtyAssets.current.delete(id); dirtyChromaBases.current.delete(id) }
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
      // A fixed joint carries its whole child branch. Without walking the
      // hierarchy, moving (for example) the torso would leave forearms and
      // lower legs behind even when their parent pieces were fixed together.
      const movingIds = new Set<string>([partId])
      let addedPart = true
      while (addedPart) {
        addedPart = false
        for (const joint of current.joints) {
          if (joint.fixed && movingIds.has(joint.parentPartId) && !movingIds.has(joint.childPartId)) {
            movingIds.add(joint.childPartId)
            addedPart = true
          }
        }
      }
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

  const paintMixerSegment = async (fromX: number, fromY: number, toX: number, toY: number, touchedPixels: Map<string, Uint8Array>, session: number) => {
    if (!project || !scale || session !== mixerSessionRef.current) return
    const stage = stageRef.current
    if (!stage) return
    const bounds = stage.getBoundingClientRect()
    const candidates = canvasParts.slice().reverse().filter((part) => !hiddenPartIds.includes(part.id))
    const imageDataById = new Map<string, ImageData>()
    const affectedParts = new Map<string, ModelPart>()
    const getImageData = async (part: ModelPart) => {
      let surface = mixerSurfacesRef.current.get(part.id)
      if (!surface) {
        const image = await imageFromDataUrl(part.dataUrl)
        if (session !== mixerSessionRef.current) return null
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) return null
        context.drawImage(image, 0, 0)
        surface = { canvas, context }
        mixerSurfacesRef.current.set(part.id, surface)
      }
      let imageData = imageDataById.get(part.id)
      if (!imageData) {
        imageData = surface.context.getImageData(0, 0, surface.canvas.width, surface.canvas.height)
        imageDataById.set(part.id, imageData)
      }
      return imageData
    }
    const getLocalPoint = (part: ModelPart, x: number, y: number) => {
      const centerX = part.x + part.width / 2
      const centerY = part.y + part.height / 2
      const radians = -part.rotation * Math.PI / 180
      const offsetX = x - centerX
      const offsetY = y - centerY
      return {
        x: centerX + offsetX * Math.cos(radians) - offsetY * Math.sin(radians) - part.x,
        y: centerY + offsetX * Math.sin(radians) + offsetY * Math.cos(radians) - part.y
      }
    }
    const distance = Math.hypot(toX - fromX, toY - fromY)
    const steps = Math.max(1, Math.ceil(distance / 10))
    const radius = 24 / scale

    for (let step = 0; step <= steps; step += 1) {
      const screenX = fromX + (toX - fromX) * (step / steps)
      const screenY = fromY + (toY - fromY) * (step / steps)
      const boardX = (screenX - bounds.left - bounds.width / 2 - pan.x) / scale + project.width / 2
      const boardY = (screenY - bounds.top - bounds.height / 2 - pan.y) / scale + project.height / 2

      for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
        const part = candidates[candidateIndex]
        const { x: localX, y: localY } = getLocalPoint(part, boardX, boardY)
        if (localX < 0 || localY < 0 || localX >= part.width || localY >= part.height) continue

        const imageData = await getImageData(part)
        if (!imageData) return
        const width = imageData.width
        const height = imageData.height
        const pixelX = Math.floor(localX / part.width * width)
        const pixelY = Math.floor(localY / part.height * height)
        if (imageData.data[(pixelY * width + pixelX) * 4 + 3] === 0) continue

        // The mixer is a seam tool: only soften pixels where another visible
        // piece exists underneath. This per-pixel mask protects the rest of
        // the brush footprint from fading isolated parts.
        const lowerLayers: Array<{ part: ModelPart; imageData: ImageData }> = []
        for (let lowerIndex = candidateIndex + 1; lowerIndex < candidates.length; lowerIndex += 1) {
          const lowerPart = candidates[lowerIndex]
          const lowerData = await getImageData(lowerPart)
          if (!lowerData) return
          lowerLayers.push({ part: lowerPart, imageData: lowerData })
        }
        if (!lowerLayers.length) break

        let touched = touchedPixels.get(part.id)
        if (!touched) { touched = new Uint8Array(width * height); touchedPixels.set(part.id, touched) }
        const centerPixelX = localX / part.width * width
        const centerPixelY = localY / part.height * height
        const radiusX = radius / part.width * width
        const radiusY = radius / part.height * height
        const minX = Math.max(0, Math.floor(centerPixelX - radiusX))
        const maxX = Math.min(width - 1, Math.ceil(centerPixelX + radiusX))
        const minY = Math.max(0, Math.floor(centerPixelY - radiusY))
        const maxY = Math.min(height - 1, Math.ceil(centerPixelY + radiusY))
        let changed = false
        for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
          const dx = (x + 0.5 - centerPixelX) / radiusX
          const dy = (y + 0.5 - centerPixelY) / radiusY
          const radial = dx * dx + dy * dy
          const index = y * width + x
          if (radial > 1 || touched[index]) continue
          const pixelLocalX = (x + 0.5) / width * part.width
          const pixelLocalY = (y + 0.5) / height * part.height
          const rotation = part.rotation * Math.PI / 180
          const partCenterX = part.x + part.width / 2
          const partCenterY = part.y + part.height / 2
          const relativeX = pixelLocalX - part.width / 2
          const relativeY = pixelLocalY - part.height / 2
          const pixelBoardX = partCenterX + relativeX * Math.cos(rotation) - relativeY * Math.sin(rotation)
          const pixelBoardY = partCenterY + relativeX * Math.sin(rotation) + relativeY * Math.cos(rotation)
          const coveredByLowerLayer = lowerLayers.some(({ part: lowerPart, imageData: lowerData }) => {
            const lowerPoint = getLocalPoint(lowerPart, pixelBoardX, pixelBoardY)
            if (lowerPoint.x < 0 || lowerPoint.y < 0 || lowerPoint.x >= lowerPart.width || lowerPoint.y >= lowerPart.height) return false
            const lowerX = Math.floor(lowerPoint.x / lowerPart.width * lowerData.width)
            const lowerY = Math.floor(lowerPoint.y / lowerPart.height * lowerData.height)
            return lowerData.data[(lowerY * lowerData.width + lowerX) * 4 + 3] > 0
          })
          if (!coveredByLowerLayer) continue
          touched[index] = 1
          const alphaOffset = index * 4 + 3
          const alpha = imageData.data[alphaOffset]
          if (alpha === 0) continue
          const falloff = 1 - radial
          imageData.data[alphaOffset] = Math.round(alpha * (1 - 0.3 * falloff))
          changed = true
        }
        if (changed) affectedParts.set(part.id, part)
        break
      }
    }

    if (session !== mixerSessionRef.current || affectedParts.size === 0) return
    const changedAssets = new Map<string, string>()
    for (const [partId] of affectedParts) {
      const surface = mixerSurfacesRef.current.get(partId)
      const imageData = imageDataById.get(partId)
      if (!surface || !imageData) continue
      surface.context.putImageData(imageData, 0, 0)
      const dataUrl = surface.canvas.toDataURL('image/png')
      dirtyAssets.current.set(partId, dataUrl)
      changedAssets.set(partId, dataUrl)
    }
    if (changedAssets.size > 0) updateProject((current) => ({ ...current, parts: current.parts.map((part) => changedAssets.has(part.id) ? { ...part, dataUrl: changedAssets.get(part.id)! } : part) }), 'mixer')
  }

  const queueMixerSegment = (fromX: number, fromY: number, toX: number, toY: number) => {
    const touchedPixels = mixerTouchedRef.current
    const session = mixerSessionRef.current
    mixerQueueRef.current = mixerQueueRef.current
      .then(() => paintMixerSegment(fromX, fromY, toX, toY, touchedPixels, session))
      .catch((reason: unknown) => { if (session === mixerSessionRef.current) setError(reason instanceof Error ? `Misturador: ${reason.message}` : 'O misturador não conseguiu editar essa peça.') })
  }

  const startMixerStroke = <T extends Element,>(event: React.PointerEvent<T>) => {
    if (!project || !stageRef.current) return
    event.preventDefault(); event.stopPropagation()
    stageRef.current.setPointerCapture(event.pointerId)
    startHistoryGesture('mixer')
    mixerTouchedRef.current = new Map()
    mixerStrokeRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    setMixerPainting(true)
    queueMixerSegment(event.clientX, event.clientY, event.clientX, event.clientY)
  }

  const moveMixerStroke = (event: React.PointerEvent<HTMLDivElement>) => {
    const stroke = mixerStrokeRef.current
    if (!stroke || stroke.pointerId !== event.pointerId) return
    queueMixerSegment(stroke.x, stroke.y, event.clientX, event.clientY)
    stroke.x = event.clientX; stroke.y = event.clientY
  }

  const beginPartDrag = (event: React.PointerEvent<HTMLImageElement>, part: ModelPart) => {
    if (mixerActive) { startMixerStroke(event); return }
    if (connectMode || !project) return
    event.preventDefault(); event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    startHistoryGesture('edit')
    setSelectedIds((current) => current.includes(part.id) ? current : [part.id])
    dragRef.current = { partId: part.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY }
  }

  const beginPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!project || (event.target instanceof Element && event.target.closest('.model-stage-tools'))) return
    if (mixerActive) { startMixerStroke(event); return }
    if (event.target instanceof Element && event.target.closest('.model-canvas-part, .model-joint-anchor')) return
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
      const sourceAnchor = sourcePointFromCanvas(part, movedAnchor)
      return {
        ...current,
        parts: current.parts.map((item) => item.id === drag.partId ? { ...item, jointAnchor: movedAnchor, ...(sourceAnchor && item.sourceTransform ? { sourceTransform: { ...item.sourceTransform, jointAnchor: sourceAnchor, anchorVersion: 1 as const } } : {}) } : item),
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
    if (mixerActive) { startMixerStroke(event); return }
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
    startHistoryGesture('edit')
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
            <button aria-pressed={activeSection === section.id} className={`fabricator-section-button${activeSection === section.id ? ' active' : ''}`} key={section.id} onClick={() => setActiveSection(section.id)} type="button">
              <Icon name={section.icon} /><span>{section.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {activeSection === 'Design Dev' ? <DesignWorkspace /> : activeSection === 'Poses' ? <PoseWorkspace /> : activeSection === 'Roupas' ? <WardrobeWorkspace /> : activeSection === 'Olhos' ? <FaceComponentsWorkspace mode="eyes" /> : activeSection === 'Rosto' ? <FaceComponentsWorkspace mode="face" /> : activeSection === 'Preset Expressão Dev' ? <ExpressionPresetWorkspace modelSlot={activeSlot} /> : activeSection === 'Animador Rosto Dev' ? <FaceAnimatorWorkspace modelSlot={activeSlot} /> : activeSection === 'Cabeças extra' ? <HeadExtrasWorkspace /> : activeSection === 'Cabelos Dev' ? <HairWorkspace /> : activeSection === 'Animador Dev' ? <AnimatorWorkspace /> : (
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
                <div className="model-history-controls" aria-label="Histórico de alterações">
                  <button className="model-history-button" onClick={() => void restoreHistory('undo')} disabled={!history.undo.length || historyBusy || processing || chromaApplying} title={`Desfazer${history.undo.length ? ` — ${history.undo.length} alterações disponíveis` : ''}`} aria-label={`Desfazer, ${history.undo.length} alterações disponíveis`} type="button"><Icon name="undo" /></button>
                  <button className="model-history-button" onClick={() => void restoreHistory('redo')} disabled={!history.redo.length || historyBusy || processing || chromaApplying} title={`Refazer${history.redo.length ? ` — ${history.redo.length} alterações disponíveis` : ''}`} aria-label={`Refazer, ${history.redo.length} alterações disponíveis`} type="button"><Icon name="redo" /></button>
                  <small className="model-history-count" title="Histórico salvo localmente; mantém até 50 alterações">{history.undo.length}/50</small>
                </div>
                <div className="model-current-title" aria-label={`Modelo ${String(project.slot).padStart(2, '0')}`}><span className="model-eyebrow">MODELO {String(project.slot).padStart(2, '0')}</span></div>
                <div className="model-toolbar-actions">
                  <span className={`model-save-state ${saveState}`}><i />{saveState === 'saving' ? 'Salvando…' : saveState === 'error' ? 'Erro ao salvar' : 'Salvo localmente'}</span>
                  <div className="model-chroma-control">
                    <div className="model-chroma-heading"><label htmlFor="model-chroma-range"><Icon name="sliders" />Chroma key</label><output htmlFor="model-chroma-range">{chromaValue}</output></div>
                    <div className="model-chroma-adjust"><input id="model-chroma-range" aria-label="Intensidade do chroma key" type="range" min={project.chromaBaseTolerance ?? project.tolerance} max={MAX_CHROMA_TOLERANCE} value={Math.max(chromaValue, project.chromaBaseTolerance ?? project.tolerance)} disabled={chromaApplying || processing || historyBusy} onChange={(event) => setChromaValue(Number(event.target.value))} /><button className="model-chroma-apply" onClick={applyChromaKey} disabled={chromaApplying || processing || historyBusy || chromaValue === project.tolerance} type="button">{chromaApplying ? 'Aplicando…' : 'Aplicar'}</button></div>
                    <small>Arraste para ajustar em qualquer direção · Resetar restaura a importação</small>
                  </div>
                  <button className="model-tool-button model-reset-button" onClick={() => void resetModel()} disabled={processing || chromaApplying || historyBusy} title="Voltar o modelo inteiro ao estado da imagem importada" type="button"><Icon name="reset" /><span>{processing ? 'Resetando…' : 'Resetar'}</span></button>
                  <button className={`model-tool-button model-mixer-toggle${mixerActive ? ' active' : ''}`} aria-pressed={mixerActive} onClick={() => { setMixerActive((active) => !active); setConnectMode(false); setConnectFromId(null) }} disabled={processing || chromaApplying || historyBusy} title="Pinte sobre a junta: o pincel edita a peça visível mais alta, mesmo que outra esteja selecionada" type="button"><Icon name="brush" /><span>Misturador</span></button>
                  <button className="model-tool-button model-mixer-clear" onClick={() => { setMixerActive(false); void restoreHistory('undo') }} disabled={history.undo[history.undo.length - 1]?.action !== 'mixer' || historyBusy || processing || chromaApplying} title="Limpar o último traço do Misturador" aria-label="Limpar último traço do Misturador" type="button"><Icon name="eraser" /></button>
                  <button className={`model-tool-button model-pivot-visibility${showJointPivots ? ' active' : ''}`} aria-pressed={showJointPivots} onClick={() => setShowJointPivots((visible) => !visible)} disabled={processing || chromaApplying || historyBusy} title={showJointPivots ? 'Ocultar bolinhas das juntas' : 'Mostrar bolinhas das juntas'} type="button"><Icon name={showJointPivots ? 'eye' : 'eyeOff'} /><span>{showJointPivots ? 'Ocultar bolinhas' : 'Mostrar bolinhas'}</span></button>
                </div>
              </div>
              <div className={`model-editor-content${processing || chromaApplying || historyBusy ? ' chroma-applying' : ''}`} aria-busy={processing || chromaApplying || historyBusy}>
                <section className="model-canvas-column" aria-label="Prévia e montagem">
                  <div className="model-canvas-topline"><span><i /> CANVAS DE MONTAGEM</span><span>{project.width} × {project.height}</span></div>
                  <div ref={stageRef} className={`model-stage${panning ? ' panning' : ''}${mixerActive ? ' mixer-active' : ''}${mixerPainting ? ' mixer-painting' : ''}`} style={{ '--preview-background': previewBackground } as import('react').CSSProperties} onPointerDown={beginPan} onPointerMove={(event) => { moveMixerStroke(event); movePan(event); movePartDrag(event); moveAnchorDrag(event) }} onPointerUp={(event) => { if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null; if (anchorDragRef.current?.pointerId === event.pointerId) anchorDragRef.current = null; if (panRef.current?.pointerId === event.pointerId) { panRef.current = null; setPanning(false) } if (mixerStrokeRef.current?.pointerId === event.pointerId) { mixerStrokeRef.current = null; setMixerPainting(false) } void mixerQueueRef.current.then(() => finishHistoryGesture()) }} onPointerCancel={() => { dragRef.current = null; anchorDragRef.current = null; panRef.current = null; mixerStrokeRef.current = null; setPanning(false); setMixerPainting(false); void mixerQueueRef.current.then(() => finishHistoryGesture()) }}>
                    <div className="model-artboard" style={{ width: `${project.width * scale}px`, height: `${project.height * scale}px`, left: `calc(50% + ${pan.x}px)`, top: `calc(50% + ${pan.y}px)` }}>
                      {canvasParts.filter((part) => !hiddenPartIds.includes(part.id)).map((part) => <img key={part.id} className={`model-canvas-part${selectedIds.includes(part.id) ? ' selected' : ''}${connectFromId === part.id ? ' connect-source' : ''}`} src={part.dataUrl} alt={part.name} draggable={false} onClick={(event) => { event.stopPropagation(); if (!mixerActive) handlePartClick(part.id, event.ctrlKey || event.metaKey) }} onPointerDown={(event) => beginPartDrag(event, part)} style={{ left: part.x * scale, top: part.y * scale, width: part.width * scale, height: part.height * scale, transform: `rotate(${part.rotation}deg)` }} />)}
                      <svg className="model-joint-layer" viewBox={`0 0 ${project.width} ${project.height}`} preserveAspectRatio="none" aria-label="Conexões entre as peças">
                        {showJointPivots && jointMarkers.map(({ part, anchor, offset, fixed }) => <circle key={part.id} className={`model-joint-anchor${fixed ? ' fixed' : selectedIds.includes(part.id) ? ' selected' : ''}`} cx={anchor.x + offset / scale} cy={anchor.y} r={Math.max(selectedIds.includes(part.id) ? 11 : 8, (selectedIds.includes(part.id) ? 13 : 10) / scale)} aria-label={`Pivô de ${part.name}`} onPointerDown={(event) => beginAnchorDrag(event, part.id, offset)} />)}
                      </svg>
                    </div>
                    <div className="model-stage-tools"><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.min(2.4, value + 0.15))} title="Aumentar zoom" type="button"><Icon name="zoomIn" /></button><button onClick={() => setZoom((value) => Math.max(0.5, value - 0.15))} title="Diminuir zoom" type="button"><Icon name="zoomOut" /></button><button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} title="Centralizar prévia" type="button"><Icon name="frame" /></button></div>
                  </div>
                  <div className="model-canvas-footer"><span>{mixerActive ? <><kbd>Misturador ativo</kbd> passe sobre a junta; ele afeta a camada visível mais alta</> : <><kbd>Arraste o fundo</kbd> para mover a prévia <i /> <kbd>Arraste a peça</kbd> para posicionar <i /> <kbd>Ctrl</kbd> + clique para selecionar várias</>}</span><span>{project.parts.length} peças <i /> {project.joints.length} conexões</span></div>
                </section>

                <aside className="model-parts-panel model-work-panel" aria-label="Painel de edição">
                  <div className="model-panel-header"><div><span className="model-eyebrow">MONTAGEM</span><h2>{panelTab === 'parts' ? 'Peças' : panelTab === 'layers' ? 'Camadas' : 'Articulações'} <small>{panelTab === 'joints' ? project.joints.length : project.parts.length}</small></h2></div><button className="model-icon-button" title="Adicionar outra folha" onClick={() => void importSlot(project.slot)} type="button"><Icon name="plus" /></button></div>
                  <div className="model-panel-tabs" role="tablist" aria-label="Ferramentas do modelo">
                    {([['parts', 'Peças'], ['layers', 'Camadas'], ['joints', 'Juntas']] as const).map(([tab, label]) => <button key={tab} role="tab" aria-selected={panelTab === tab} className={panelTab === tab ? 'active' : ''} onClick={() => setPanelTab(tab)} type="button">{label}</button>)}
                  </div>
                  {panelTab === 'parts' && <div className="model-panel-body">
                    <label className="model-part-search"><Icon name="search" /><input placeholder="Buscar peça…" value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
                    <div className="model-part-grid">{visibleParts.map((part) => <button key={part.id} className={`model-part-card${selectedIds.includes(part.id) ? ' selected' : ''}`} onClick={(event) => handlePartClick(part.id, event.ctrlKey || event.metaKey)} type="button" title={`${part.name} · selecione ou arraste no canvas`}><span className="model-part-thumb"><img src={part.dataUrl} alt="" /></span><span className="model-part-card-name">{part.name}</span><small>{Math.round(part.width)} × {Math.round(part.height)}</small></button>)}{visibleParts.length === 0 && <p className="model-no-parts">Nenhuma peça encontrada.</p>}</div>
                    {selectedPart && <div className="model-selected-tools"><div className="model-selected-name">{renamingPartId === selectedPart.id ? <input autoFocus value={selectedPart.name} onBlur={() => setRenamingPartId(null)} onChange={(event) => updateProject((current) => ({ ...current, parts: current.parts.map((part) => part.id === selectedPart.id ? { ...part, name: event.target.value } : part) }))} onKeyDown={(event) => { if (event.key === 'Enter') setRenamingPartId(null) }} /> : <><strong>{selectedPart.name}</strong><button title="Renomear peça" onClick={() => setRenamingPartId(selectedPart.id)} type="button"><Icon name="edit" /></button></>}</div><div className="model-transform-controls"><strong>Transformação</strong><label>X<input type="number" step="1" value={Number(selectedPart.x.toFixed(1))} onChange={(event) => updateProject((current) => ({ ...current, parts: current.parts.map((part) => part.id === selectedPart.id ? { ...part, x: Number(event.target.value) || 0 } : part) }))} /></label><label>Y<input type="number" step="1" value={Number(selectedPart.y.toFixed(1))} onChange={(event) => updateProject((current) => ({ ...current, parts: current.parts.map((part) => part.id === selectedPart.id ? { ...part, y: Number(event.target.value) || 0 } : part) }))} /></label><label>Rotação<input type="number" step="1" value={Number(selectedPart.rotation.toFixed(1))} onChange={(event) => updateProject((current) => ({ ...current, parts: current.parts.map((part) => part.id === selectedPart.id ? { ...part, rotation: Number(event.target.value) || 0 } : part) }))} /></label></div>{isHeadPart(selectedPart) && <div className="model-head-resize">
                      <div className="model-head-resize-heading"><div><strong>Formato da cabeça</strong><small>Ajuste cada direção sem soltar o encaixe do pescoço.</small></div><button type="button" onClick={() => updateProject((current) => resizeHeadPart(resizeHeadPart(current, selectedPart.id, 'width', 100), selectedPart.id, 'height', 100))}>Restaurar 100%</button></div>
                      {(['width', 'height'] as const).map((axis) => <label className="model-head-resize-row" key={axis}><span>{axis === 'width' ? 'Largura' : 'Altura'}</span><input type="range" min="20" max="300" step="1" value={headSizePercent(selectedPart, axis)} onPointerDown={() => startHistoryGesture('edit')} onPointerUp={finishHistoryGesture} onPointerCancel={finishHistoryGesture} onChange={(event) => updateProject((current) => resizeHeadPart(current, selectedPart.id, axis, Number(event.target.value)))} /><span className="model-head-resize-number"><input type="number" min="20" max="300" step="1" value={headSizePercent(selectedPart, axis)} onChange={(event) => updateProject((current) => resizeHeadPart(current, selectedPart.id, axis, Number(event.target.value)))} />%</span></label>)}
                    </div>}<div className="model-action-row"><button className="model-tool-button" onClick={() => void splitSelected('vertical')} disabled={selectedPart.rotation !== 0 || selectedPart.width < 2} type="button">Dividir ↔</button><button className="model-tool-button" onClick={() => void splitSelected('horizontal')} disabled={selectedPart.rotation !== 0 || selectedPart.height < 2} type="button">Dividir ↕</button><button className="model-tool-button danger" onClick={() => removePart(selectedPart.id)} type="button">Excluir</button></div>{selectedPartIds.length > 1 && <button className="model-merge-button" onClick={() => void mergeSelected()} type="button">Mesclar {selectedPartIds.length} peças selecionadas</button>}</div>}
                    <div className="model-source-info"><span><Icon name="frame" /> Fonte</span><small title={project.sourceName}>{project.sourceName}</small></div>
                  </div>}
                  {panelTab === 'layers' && <div className="model-panel-body model-layer-panel"><p className="model-panel-intro">Arraste uma linha ou use as setas. O item no topo fica na frente. Fixar mantém a posição e a sobreposição atuais, e faz esse par acompanhar os próximos movimentos.</p><div className="model-layer-list">{frontToBackLayers.map((part, index) => { const joint = project.joints.find((item) => item.childPartId === part.id); const fixed = Boolean(joint?.fixed); return <div key={part.id} draggable className={`model-layer-row${selectedIds.includes(part.id) ? ' selected' : ''}${layerDragId === part.id ? ' dragging' : ''}`} onDragStart={(event) => { layerDragRef.current = part.id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', part.id); setLayerDragId(part.id) }} onDragEnd={() => { layerDragRef.current = null; setLayerDragId(null) }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }} onDrop={(event) => { event.preventDefault(); const sourceId = event.dataTransfer.getData('text/plain') || layerDragRef.current; if (sourceId) dropLayer(sourceId, part.id); layerDragRef.current = null; setLayerDragId(null) }}><button className="model-layer-select" onClick={() => setSelectedIds([part.id])} type="button"><span className="model-layer-thumb"><img src={part.dataUrl} alt="" /></span><span><strong>{part.name}</strong><small>Camada {frontToBackLayers.length - index} · {hiddenPartIds.includes(part.id) ? 'Oculta' : 'Visível'}{joint ? ` · ${fixed ? 'Fixada' : 'Solta'}` : ''}</small></span></button><div className="model-layer-controls"><button title="Mover para frente" aria-label={`Mover ${part.name} para frente`} disabled={index === 0} onClick={() => moveLayer(part.id, -1)} type="button">↑</button><button title="Mover para trás" aria-label={`Mover ${part.name} para trás`} disabled={index === frontToBackLayers.length - 1} onClick={() => moveLayer(part.id, 1)} type="button">↓</button><button className={`model-layer-fix${fixed ? ' fixed' : ''}`} title={joint ? fixed ? 'Desfixar do pai' : 'Fixar ao pai' : 'Esta peça não tem junta com uma peça-pai'} aria-label={joint ? fixed ? `Desfixar ${part.name} do pai` : `Fixar ${part.name} ao pai` : `${part.name} não tem junta pai`} aria-pressed={fixed} disabled={!joint} onClick={() => toggleJointFix(part.id)} type="button"><Icon name="link" /></button><button title={hiddenPartIds.includes(part.id) ? 'Mostrar peça' : 'Ocultar peça'} aria-label={hiddenPartIds.includes(part.id) ? `Mostrar ${part.name}` : `Ocultar ${part.name}`} aria-pressed={!hiddenPartIds.includes(part.id)} onClick={() => toggleLayerVisibility(part.id)} type="button">{hiddenPartIds.includes(part.id) ? '○' : '◉'}</button></div></div>})}</div></div>}
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
