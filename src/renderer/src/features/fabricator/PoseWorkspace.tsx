import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FabricatorPose, FabricatorPoseDraft, FabricatorPoseDraftSave, FabricatorPoseSave, FabricatorPoseSummary, FabricatorProject, FabricatorSlotSummary, PosePart } from '../../../../shared/fabricator'
import { resolvePoseCategory } from '../../../../shared/fabricator'
import { Icon } from '../../ui/components/Icon'
import { usePreviewBackground } from './usePreviewBackground'
import { normalizeLayerOrder, orderedParts, partJointAnchor } from './models/rig'

type DraftProject = Omit<FabricatorPose, 'slot'>
type PanelTab = 'parts' | 'layers' | 'joints'
type PoseHistory = { undo: DraftProject[]; redo: DraftProject[] }
type PanGesture = { pointerId: number; x: number; y: number; originX: number; originY: number }
type PartGesture = { pointerId: number; partId: string; x: number; y: number; lastAngle: number; startRotation: number; accumulatedRotation: number; pivotX: number; pivotY: number; includeConnectedChildren: boolean; movePiece: boolean; canMove: boolean; before: DraftProject }

const SLOT_COUNT = 12
const EXPORT_POSE_SLOT_COUNT = 5
const HISTORY_LIMIT = 50
const emptyHistory = (): PoseHistory => ({ undo: [], redo: [] })

function defaultExportPoseSlots(summaries: FabricatorPoseSummary[], modelSlot: number): Array<number | null> {
  const available = summaries.filter((pose): pose is NonNullable<FabricatorPoseSummary> => Boolean(pose && pose.sourceModelSlot === modelSlot)).sort((a, b) => a.slot - b.slot).slice(0, EXPORT_POSE_SLOT_COUNT)
  return [...available.map((pose) => pose.slot), ...Array.from({ length: EXPORT_POSE_SLOT_COUNT - available.length }, () => null)]
}

function cloneProject(project: DraftProject): DraftProject {
  return structuredClone(project)
}

function rotatePoint(point: { x: number; y: number }, origin: { x: number; y: number }, angle: number) {
  const radians = angle * Math.PI / 180
  const x = point.x - origin.x
  const y = point.y - origin.y
  return { x: origin.x + x * Math.cos(radians) - y * Math.sin(radians), y: origin.y + x * Math.sin(radians) + y * Math.cos(radians) }
}

function isMovablePosePart(project: DraftProject, partId: string): boolean {
  const part = project.parts.find((item) => item.id === partId)
  return Boolean(part && !/tronco|corpo|cabeça|cabeca/i.test(part.name))
}

function fixedPoseBranch(project: DraftProject, rootId: string): Set<string> {
  const movingIds = new Set([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const joint of project.joints) if (joint.fixed && movingIds.has(joint.parentPartId) && !movingIds.has(joint.childPartId)) {
      movingIds.add(joint.childPartId)
      changed = true
    }
  }
  return movingIds
}

function translateParts(project: DraftProject, partIds: Set<string>, dx: number, dy: number): DraftProject {
  return {
    ...project,
    parts: project.parts.map((part) => partIds.has(part.id) ? {
      ...part,
      x: part.x + dx,
      y: part.y + dy,
      ...(part.jointAnchor ? { jointAnchor: { x: part.jointAnchor.x + dx, y: part.jointAnchor.y + dy } } : {})
    } : part),
    joints: project.joints.map((joint) => {
      const parentAnchor = partIds.has(joint.parentPartId) ? { x: joint.parentAnchor.x + dx, y: joint.parentAnchor.y + dy } : joint.parentAnchor
      const childAnchor = partIds.has(joint.childPartId) ? { x: joint.childAnchor.x + dx, y: joint.childAnchor.y + dy } : joint.childAnchor
      return { ...joint, parentAnchor, childAnchor, pivot: { x: (parentAnchor.x + childAnchor.x) / 2, y: (parentAnchor.y + childAnchor.y) / 2 } }
    })
  }
}

function translatePoseBranch(project: DraftProject, rootId: string, dx: number, dy: number): DraftProject {
  return translateParts(project, fixedPoseBranch(project, rootId), dx, dy)
}

function toSavedPose(project: DraftProject, slot: number): FabricatorPoseSave {
  return {
    ...project,
    slot,
    parts: project.parts.map(({ dataUrl: _dataUrl, ...part }) => part)
  }
}

function toDraftSave(project: DraftProject, editingSlot: number | null): FabricatorPoseDraftSave {
  return {
    editingSlot,
    updatedAt: new Date().toISOString(),
    project: { ...project, parts: project.parts.map(({ dataUrl: _dataUrl, ...part }) => part) }
  }
}

function poseFromModel(model: FabricatorProject): DraftProject {
  return {
    schemaVersion: 1,
    name: `Pose de ${model.name}`,
    category: 'Parado',
    sourceModelSlot: model.slot,
    sourceModelName: model.name,
    sourceModelUpdatedAt: model.updatedAt,
    width: model.width,
    height: model.height,
    parts: model.parts.map((part) => ({
      id: part.id, name: part.name, x: part.x, y: part.y, width: part.width, height: part.height,
      rotation: part.rotation, jointAnchor: part.jointAnchor ? { ...part.jointAnchor } : undefined, sourceTransform: part.sourceTransform ? { ...part.sourceTransform, ...(part.sourceTransform.jointAnchor ? { jointAnchor: { ...part.sourceTransform.jointAnchor } } : {}) } : undefined, dataUrl: part.dataUrl
    })),
    joints: model.joints.map((joint) => structuredClone(joint)),
    layerOrder: normalizeLayerOrder(model.parts, model.layerOrder),
    hiddenPartIds: [...(model.hiddenPartIds ?? [])],
    updatedAt: new Date().toISOString()
  }
}

export function PoseWorkspace() {
  const [previewBackground] = usePreviewBackground()
  const [models, setModels] = useState<FabricatorSlotSummary[]>(Array.from({ length: 10 }, () => null))
  const [allPoseSlots, setAllPoseSlots] = useState<FabricatorPoseSummary[]>([])
  const [exportPoseSlots, setExportPoseSlots] = useState<Array<number | null>>(Array.from({ length: EXPORT_POSE_SLOT_COUNT }, () => null))
  const [savingExportPoseSlots, setSavingExportPoseSlots] = useState(false)
  const [selectedModelSlot, setSelectedModelSlot] = useState(1)
  const [activeSlot, setActiveSlot] = useState(1)
  const [project, setProject] = useState<DraftProject | null>(null)
  const [sourcePreview, setSourcePreview] = useState<DraftProject | null>(null)
  const [editingSlot, setEditingSlot] = useState<number | null>(null)
  const [history, setHistory] = useState<PoseHistory>(emptyHistory)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<PanelTab>('parts')
  const [rotationMode, setRotationMode] = useState<'part' | 'branch'>('branch')
  const [moveToolActive, setMoveToolActive] = useState(false)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [stageSize, setStageSize] = useState({ width: 1, height: 1 })
  const [panning, setPanning] = useState(false)
  const [selectingModel, setSelectingModel] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [recoveredDraft, setRecoveredDraft] = useState<FabricatorPoseDraft | null>(null)
  const [showJoints, setShowJoints] = useState(true)
  const [partFilter, setPartFilter] = useState('')
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const stageRef = useRef<HTMLDivElement>(null)
  const projectRef = useRef<DraftProject | null>(null)
  const editingSlotRef = useRef<number | null>(null)
  const dirtyRef = useRef(false)
  const panRef = useRef<PanGesture | null>(null)
  const partDragRef = useRef<PartGesture | null>(null)
  const pendingAssets = useRef<Map<string, string>>(new Map())
  const writeQueue = useRef<Promise<void>>(Promise.resolve())
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const slots = useMemo(() => Array.from({ length: SLOT_COUNT }, (_, index) => allPoseSlots.find((slot) => slot?.sourceModelSlot === selectedModelSlot && slot.slot === index + 1) ?? null), [allPoseSlots, selectedModelSlot])
  const selectedModelName = models[selectedModelSlot - 1]?.name ?? allPoseSlots.find((slot) => slot?.sourceModelSlot === selectedModelSlot)?.sourceModelName ?? 'Escolher modelo'
  const categoryOptions = Array.from(new Set(['Parado', 'Sentado', ...allPoseSlots.filter((pose): pose is NonNullable<FabricatorPoseSummary> => pose?.sourceModelSlot === selectedModelSlot).map(resolvePoseCategory), ...(project ? [resolvePoseCategory({ ...project, slot: editingSlot ?? undefined })] : [])]))

  const publishProject = useCallback((next: DraftProject | null, isDirty = true) => {
    projectRef.current = next
    dirtyRef.current = isDirty
    setProject(next)
    setDirty(isDirty)
  }, [])

  const loadLibraries = useCallback(async () => {
    setLoading(true)
    try {
      const [modelSlots, poseSummaries] = await Promise.all([
        window.desktop.listFabricatorSlots(),
        window.desktop.listFabricatorPoseSlots()
      ])
      const preferredModelSlot = modelSlots.find((slot) => slot)?.slot ?? poseSummaries[0]?.sourceModelSlot ?? 1
      const draft = await window.desktop.loadFabricatorPoseDraft(preferredModelSlot)
      const displayedModelSlot = draft?.project.sourceModelSlot ?? preferredModelSlot
      const sourceModel = await window.desktop.loadFabricatorSlot(displayedModelSlot)
      setModels(modelSlots)
      setAllPoseSlots(poseSummaries)
      setSelectedModelSlot(displayedModelSlot)
      const configuredExportSlots = await window.desktop.getFabricatorExportPoseSlots(displayedModelSlot)
      const initialExportSlots = configuredExportSlots ?? defaultExportPoseSlots(poseSummaries, displayedModelSlot)
      if (configuredExportSlots === null) await window.desktop.saveFabricatorExportPoseSlots(displayedModelSlot, initialExportSlots)
      setExportPoseSlots(initialExportSlots)
      setRecoveredDraft(draft)
      setSourcePreview(sourceModel ? poseFromModel(sourceModel) : null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a biblioteca de poses.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadLibraries() }, [loadLibraries])

  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [project])

  const writeDraft = useCallback((snapshot: DraftProject, targetSlot: number | null) => {
    const assets = snapshot.parts.flatMap((part) => {
      const dataUrl = pendingAssets.current.get(part.id)
      return dataUrl ? [{ id: part.id, dataUrl }] : []
    })
    const serialized = toDraftSave(snapshot, targetSlot)
    const write = writeQueue.current.catch(() => undefined).then(() => window.desktop.saveFabricatorPoseDraft(snapshot.sourceModelSlot, serialized, assets))
    writeQueue.current = write
    return write.then(() => {
      for (const asset of assets) if (pendingAssets.current.get(asset.id) === asset.dataUrl) pendingAssets.current.delete(asset.id)
      setSaveMessage('Rascunho salvo')
    })
  }, [])

  useEffect(() => {
    if (!project || !dirty) return
    setSaveMessage('Salvando rascunho…')
    if (draftTimer.current) clearTimeout(draftTimer.current)
    const snapshot = project
    const targetSlot = editingSlot
    draftTimer.current = setTimeout(() => {
      void writeDraft(snapshot, targetSlot).catch((reason: unknown) => setError(reason instanceof Error ? `Não foi possível guardar o rascunho: ${reason.message}` : 'Não foi possível guardar o rascunho.'))
    }, 350)
    return () => { if (draftTimer.current) clearTimeout(draftTimer.current) }
  }, [project, editingSlot, dirty, writeDraft])

  useEffect(() => () => {
    if (draftTimer.current) clearTimeout(draftTimer.current)
    const snapshot = projectRef.current
    if (snapshot && dirtyRef.current) void writeDraft(snapshot, editingSlotRef.current).catch(() => undefined)
  }, [writeDraft])

  useEffect(() => { editingSlotRef.current = editingSlot }, [editingSlot])

  const remember = (before: DraftProject) => {
    setHistory((current) => ({ undo: [...current.undo, cloneProject(before)].slice(-HISTORY_LIMIT), redo: [] }))
  }

  const changeProject = (updater: (current: DraftProject) => DraftProject, record = true) => {
    const current = projectRef.current
    if (!current) return
    const next = updater(current)
    if (next === current) return
    if (record) remember(current)
    publishProject(next)
  }

  const assignCategory = (category: string) => {
    const normalized = category.trim().replace(/\s+/g, ' ')
    if (!normalized || normalized.length > 32) return
    const existing = categoryOptions.find((option) => option.toLocaleLowerCase('pt-BR') === normalized.toLocaleLowerCase('pt-BR'))
    changeProject((current) => current.category === (existing ?? normalized) ? current : { ...current, category: existing ?? normalized })
    setCategoryPickerOpen(false)
    setNewCategoryName('')
  }

  const restoreHistory = (direction: 'undo' | 'redo') => {
    const current = projectRef.current
    const stack = history[direction]
    const target = stack.at(-1)
    if (!current || !target) return
    const snapshot = cloneProject(target)
    setHistory((state) => direction === 'undo'
      ? { undo: state.undo.slice(0, -1), redo: [...state.redo, cloneProject(current)].slice(-HISTORY_LIMIT) }
      : { undo: [...state.undo, cloneProject(current)].slice(-HISTORY_LIMIT), redo: state.redo.slice(0, -1) })
    publishProject(snapshot)
    setSelectedId((id) => snapshot.parts.some((part) => part.id === id) ? id : snapshot.parts[0]?.id ?? null)
  }

  const discardDraft = async () => {
    if (draftTimer.current) clearTimeout(draftTimer.current)
    const sourceModelSlot = projectRef.current?.sourceModelSlot ?? recoveredDraft?.project.sourceModelSlot ?? selectedModelSlot
    try { await window.desktop.deleteFabricatorPoseDraft(sourceModelSlot) } catch { /* O conteúdo em memória continua editável. */ }
    try {
      const sourceModel = await window.desktop.loadFabricatorSlot(sourceModelSlot)
      setSourcePreview(sourceModel ? poseFromModel(sourceModel) : null)
    } catch { setSourcePreview(null) }
    pendingAssets.current.clear()
    setRecoveredDraft(null)
    setEditingSlot(null)
    editingSlotRef.current = null
    setHistory(emptyHistory())
    publishProject(null, false)
    setSelectedId(null)
    setSaveMessage('')
  }

  const canReplaceCurrent = async () => {
    if (!project || !dirty) return true
    if (!window.confirm('Há alterações no rascunho atual. Descartar e abrir outro conteúdo? O rascunho salvo automaticamente continuará recuperável se você cancelar.')) return false
    await discardDraft()
    return true
  }

  const assignExportPose = async (index: number, value: number | null) => {
    const next = [...exportPoseSlots]
    if (value !== null && next.some((slot, slotIndex) => slotIndex !== index && slot === value)) {
      setError('Cada pose pode ocupar apenas um dos cinco slots de exportação.')
      return
    }
    next[index] = value
    setSavingExportPoseSlots(true)
    setError('')
    try {
      await window.desktop.saveFabricatorExportPoseSlots(selectedModelSlot, next)
      setExportPoseSlots(next)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar os slots de poses para exportação.')
    } finally { setSavingExportPoseSlots(false) }
  }

  const beginNewPose = async (modelSlot: number) => {
    const model = await window.desktop.loadFabricatorSlot(modelSlot)
    if (!model) { setError('Não foi possível carregar esse modelo.'); return }
    const next = poseFromModel(model)
    pendingAssets.current = new Map(next.parts.map((part) => [part.id, part.dataUrl]))
    setSourcePreview(null)
    setSelectedModelSlot(modelSlot)
    setSourcePreview(null)
    const modelPoseSlots = Array.from({ length: SLOT_COUNT }, (_, index) => allPoseSlots.find((slot) => slot?.sourceModelSlot === modelSlot && slot.slot === index + 1) ?? null)
    const nextSlot = modelPoseSlots.findIndex((slot) => !slot) + 1 || SLOT_COUNT
    next.category = nextSlot === 2 ? 'Sentado' : 'Parado'
    setActiveSlot(nextSlot)
    setEditingSlot(null)
    editingSlotRef.current = null
    setHistory(emptyHistory())
    setSelectedId(next.parts[0]?.id ?? null)
    publishProject(next)
    setSelectingModel(false)
    setRecoveredDraft(null)
    setError('')
  }

  const selectPoseSlot = async (slot: number) => {
    if (slot === editingSlot && project) return
    if (!await canReplaceCurrent()) return
    setActiveSlot(slot)
    const summary = slots[slot - 1]
    if (!summary) {
      setEditingSlot(null)
      editingSlotRef.current = null
      setHistory(emptyHistory())
      publishProject(null, false)
      setSelectedId(null)
      return
    }
    setLoading(true)
    try {
      const saved = await window.desktop.loadFabricatorPose(selectedModelSlot, slot)
      if (!saved) throw new Error('O slot de pose não pôde ser carregado.')
      const { slot: _slot, ...editable } = saved
      // The draft is stored in a different folder from the saved pose, so copy
      // the pose's part images into the draft library on its next autosave.
      pendingAssets.current = new Map(editable.parts.map((part) => [part.id, part.dataUrl]))
      setSourcePreview(null)
      setEditingSlot(slot)
      editingSlotRef.current = slot
      setHistory(emptyHistory())
      setSelectedId(editable.parts[0]?.id ?? null)
      publishProject(editable, false)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível abrir a pose.')
    } finally {
      setLoading(false)
    }
  }

  const recoverDraft = () => {
    if (!recoveredDraft) return
    setEditingSlot(recoveredDraft.editingSlot)
    setSelectedModelSlot(recoveredDraft.project.sourceModelSlot)
    setSourcePreview(null)
    editingSlotRef.current = recoveredDraft.editingSlot
    publishProject(recoveredDraft.project)
    setSelectedId(recoveredDraft.project.parts[0]?.id ?? null)
    setHistory(emptyHistory())
    setRecoveredDraft(null)
    setActiveSlot(recoveredDraft.editingSlot ?? (slots.findIndex((slot) => !slot) + 1 || SLOT_COUNT))
  }

  const savePose = async () => {
    const snapshot = projectRef.current
    if (!snapshot || saving) return
    let slot = editingSlotRef.current
    if (slot === null) {
      slot = slots.findIndex((item) => !item) + 1
      if (slot === 0) { setError('Os 12 slots de pose estão preenchidos. Exclua uma pose para liberar espaço.'); return }
    }
    setSaving(true)
    setError('')
    try {
      const assets = snapshot.parts.flatMap((part) => {
        const dataUrl = pendingAssets.current.get(part.id)
        return dataUrl ? [{ id: part.id, dataUrl }] : []
      })
      const saved: FabricatorPose = { ...snapshot, slot, category: resolvePoseCategory({ ...snapshot, slot }), updatedAt: new Date().toISOString() }
      await window.desktop.saveFabricatorPose(snapshot.sourceModelSlot, slot, toSavedPose(saved, slot), assets)
      window.dispatchEvent(new Event('fabricator:assets-updated'))
      for (const asset of assets) if (pendingAssets.current.get(asset.id) === asset.dataUrl) pendingAssets.current.delete(asset.id)
      await window.desktop.deleteFabricatorPoseDraft(snapshot.sourceModelSlot)
      setRecoveredDraft(null)
      setEditingSlot(slot)
      editingSlotRef.current = slot
      setActiveSlot(slot)
      publishProject({ ...snapshot, category: saved.category, updatedAt: saved.updatedAt }, false)
      setAllPoseSlots((current) => [...current.filter((item) => !(item?.sourceModelSlot === snapshot.sourceModelSlot && item.slot === slot)), { slot, sourceModelSlot: snapshot.sourceModelSlot, name: saved.name, category: saved.category, sourceModelName: saved.sourceModelName, partCount: saved.parts.length, updatedAt: saved.updatedAt }])
      setSaveMessage('Pose salva')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar a pose.')
    } finally {
      setSaving(false)
    }
  }

  const deletePose = async () => {
    if (!editingSlot || !project) return
    if (!window.confirm(`Excluir permanentemente a pose “${project.name}” do slot ${editingSlot}?`)) return
    try {
      await window.desktop.deleteFabricatorPose(selectedModelSlot, editingSlot)
      const nextExportSlots = exportPoseSlots.map((slot) => slot === editingSlot ? null : slot)
      if (nextExportSlots.some((slot, index) => slot !== exportPoseSlots[index])) {
        await window.desktop.saveFabricatorExportPoseSlots(selectedModelSlot, nextExportSlots)
        setExportPoseSlots(nextExportSlots)
      }
      await discardDraft()
      setAllPoseSlots((current) => current.filter((slot) => !(slot?.sourceModelSlot === selectedModelSlot && slot.slot === editingSlot)))
      setActiveSlot(editingSlot)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível excluir a pose.')
    }
  }

    const displayProject = project ?? sourcePreview
    const parts = useMemo(() => displayProject ? orderedParts(displayProject.parts, displayProject.layerOrder) : [], [displayProject])
    const selectedPart = displayProject?.parts.find((part) => part.id === selectedId) ?? null
    const selectedCanMove = Boolean(project && selectedPart && isMovablePosePart(project, selectedPart.id))
    const visibleParts = useMemo(() => parts.filter((part) => !displayProject?.hiddenPartIds.includes(part.id)), [parts, displayProject?.hiddenPartIds])
  const filteredParts = useMemo(() => parts.filter((part) => part.name.toLocaleLowerCase().includes(partFilter.toLocaleLowerCase())), [parts, partFilter])
  const scale = displayProject ? Math.max(0.05, Math.min((stageSize.width - 48) / displayProject.width, (stageSize.height - 48) / displayProject.height)) * zoom : 1

  const movePart = (partId: string, dx: number, dy: number) => changeProject((current) => isMovablePosePart(current, partId) ? translatePoseBranch(current, partId, dx, dy) : current, false)

  const setPartPosition = (partId: string, axis: 'x' | 'y', value: number) => changeProject((current) => {
    const part = current.parts.find((item) => item.id === partId)
    if (!part || !Number.isFinite(value) || !isMovablePosePart(current, partId)) return current
    const delta = value - part[axis]
    return axis === 'x' ? translatePoseBranch(current, partId, delta, 0) : translatePoseBranch(current, partId, 0, delta)
  })

  const rotateSelected = (partId: string, targetAngle: number, includeConnectedChildren: boolean) => changeProject((current) => {
    const selected = current.parts.find((part) => part.id === partId)
    if (!selected) return current
    const amount = targetAngle - selected.rotation
    if (!amount) return current
    const origin = partJointAnchor(selected, current.joints) ?? { x: selected.x + selected.width / 2, y: selected.y + selected.height / 2 }
    const affected = new Set<string>([selected.id])
    if (includeConnectedChildren) {
      let changed = true
      while (changed) {
        changed = false
        for (const joint of current.joints) if (joint.fixed && affected.has(joint.parentPartId) && !affected.has(joint.childPartId)) {
          affected.add(joint.childPartId)
          changed = true
        }
      }
    }
    const parts = current.parts.map((part) => {
      if (!affected.has(part.id)) return part
      const center = rotatePoint({ x: part.x + part.width / 2, y: part.y + part.height / 2 }, origin, amount)
      const anchor = partJointAnchor(part, current.joints)
      return {
        ...part,
        x: center.x - part.width / 2,
        y: center.y - part.height / 2,
        rotation: part.rotation + amount,
        ...(anchor ? { jointAnchor: rotatePoint(anchor, origin, amount) } : {})
      }
    })
    const partById = new Map(parts.map((part) => [part.id, part]))
    const joints = current.joints.map((joint) => {
      const parent = partById.get(joint.parentPartId)
      const child = partById.get(joint.childPartId)
      const parentAnchor = parent ? partJointAnchor(parent, current.joints) ?? joint.parentAnchor : joint.parentAnchor
      const childAnchor = child ? partJointAnchor(child, current.joints) ?? joint.childAnchor : joint.childAnchor
      return { ...joint, parentAnchor, childAnchor, pivot: { x: (parentAnchor.x + childAnchor.x) / 2, y: (parentAnchor.y + childAnchor.y) / 2 } }
    })
    return { ...current, parts, joints }
  })

  const changeLayer = (partId: string, direction: -1 | 1) => changeProject((current) => {
    const topDown = normalizeLayerOrder(current.parts, current.layerOrder).reverse()
    const index = topDown.indexOf(partId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= topDown.length) return current
    ;[topDown[index], topDown[target]] = [topDown[target], topDown[index]]
    return { ...current, layerOrder: topDown.reverse() }
  })

  const selectModelLibrary = async (modelSlot: number) => {
    if (modelSlot === selectedModelSlot) { setSelectingModel(false); return }
    if (!await canReplaceCurrent()) return
    setSelectedModelSlot(modelSlot)
    setProject(null)
    projectRef.current = null
    setDirty(false)
    dirtyRef.current = false
    setEditingSlot(null)
    editingSlotRef.current = null
    setSelectedId(null)
    setHistory(emptyHistory())
    setActiveSlot(1)
    setRecoveredDraft(null)
    setSelectingModel(false)
    setLoading(true)
    try {
      const draft = await window.desktop.loadFabricatorPoseDraft(modelSlot)
      setRecoveredDraft(draft)
      if (draft) setActiveSlot(draft.editingSlot ?? 1)
      const sourceModel = await window.desktop.loadFabricatorSlot(modelSlot)
      const savedExportSlots = await window.desktop.getFabricatorExportPoseSlots(modelSlot)
      const initialExportSlots = savedExportSlots ?? defaultExportPoseSlots(allPoseSlots, modelSlot)
      if (savedExportSlots === null) await window.desktop.saveFabricatorExportPoseSlots(modelSlot, initialExportSlots)
      setExportPoseSlots(initialExportSlots)
      if (sourceModel) setSourcePreview(poseFromModel(sourceModel))
      else {
        const firstSavedPose = allPoseSlots.find((pose) => pose?.sourceModelSlot === modelSlot)
        const savedPose = firstSavedPose ? await window.desktop.loadFabricatorPose(modelSlot, firstSavedPose.slot) : null
        setSourcePreview(savedPose ? (({ slot: _slot, ...pose }) => pose)(savedPose) : null)
      }
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível abrir a biblioteca deste modelo.')
    } finally {
      setLoading(false)
    }
  }

  const beginPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!displayProject || event.target instanceof Element && event.target.closest('.pose-stage-tools, .pose-part, .pose-joint-marker')) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: pan.x, originY: pan.y }
    setPanning(true)
  }

  const moveCanvas = (event: React.PointerEvent<HTMLDivElement>) => {
    const panGesture = panRef.current
    if (panGesture?.pointerId === event.pointerId) setPan({ x: panGesture.originX + event.clientX - panGesture.x, y: panGesture.originY + event.clientY - panGesture.y })
    const drag = partDragRef.current
    if (drag?.pointerId === event.pointerId && project && scale) {
      if (drag.movePiece) {
        const dx = (event.clientX - drag.x) / scale
        const dy = (event.clientY - drag.y) / scale
        if (drag.canMove && (dx || dy)) movePart(drag.partId, dx, dy)
        drag.x = event.clientX
        drag.y = event.clientY
      } else {
        const pointerAngle = Math.atan2(event.clientY - drag.pivotY, event.clientX - drag.pivotX) * 180 / Math.PI
        let step = pointerAngle - drag.lastAngle
        if (step > 180) step -= 360
        if (step < -180) step += 360
        drag.accumulatedRotation += step
        drag.lastAngle = pointerAngle
        rotateSelected(drag.partId, drag.startRotation + drag.accumulatedRotation, drag.includeConnectedChildren)
      }
    }
  }

  const stopCanvasGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (panRef.current?.pointerId === event.pointerId) { panRef.current = null; setPanning(false) }
    const drag = partDragRef.current
    if (drag?.pointerId === event.pointerId) {
      partDragRef.current = null
      const current = projectRef.current
      if (current && JSON.stringify(drag.before) !== JSON.stringify(current)) remember(drag.before)
    }
  }

  const startPartDrag = (event: React.PointerEvent<HTMLImageElement>, part: PosePart) => {
    if (!project) return
    event.preventDefault(); event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedId(part.id)
    const anchor = partJointAnchor(part, project.joints) ?? { x: part.x + part.width / 2, y: part.y + part.height / 2 }
    const artboardRect = event.currentTarget.closest('.pose-artboard')?.getBoundingClientRect()
    const pivotX = (artboardRect?.left ?? 0) + anchor.x * scale
    const pivotY = (artboardRect?.top ?? 0) + anchor.y * scale
    partDragRef.current = {
      pointerId: event.pointerId,
      partId: part.id,
      x: event.clientX,
      y: event.clientY,
      lastAngle: Math.atan2(event.clientY - pivotY, event.clientX - pivotX) * 180 / Math.PI,
      startRotation: part.rotation,
      accumulatedRotation: 0,
      pivotX,
      pivotY,
      includeConnectedChildren: rotationMode === 'branch',
      movePiece: moveToolActive,
      canMove: isMovablePosePart(project, part.id),
      before: cloneProject(project)
    }
  }

  return (
    <section className="fabricator-workspace pose-workspace" aria-label="Editor de poses">
      <header className="pose-toolbar">
        <div className="pose-toolbar-title"><span className="model-slot-logo"><Icon name="expand" /></span><span><strong>Poses</strong><small>Biblioteca independente por modelo</small></span><button className="pose-model-select" onClick={() => setSelectingModel(true)} type="button" title="Selecionar modelo"><Icon name="box" /><span>{selectedModelName}</span><Icon name="chevronRight" /></button></div>
        <div className="pose-toolbar-actions">
          <button className="pose-button secondary" onClick={() => void (async () => { if (!await canReplaceCurrent()) return; if (recoveredDraft && !project) { if (!window.confirm('Existe um rascunho recuperável para este modelo. Descartar e começar uma pose nova?')) return; await discardDraft() } await beginNewPose(selectedModelSlot) })()} disabled={!models[selectedModelSlot - 1]} type="button"><Icon name="plus" /> Nova pose</button>
          <button className="pose-icon-button" title="Desfazer" aria-label="Desfazer" disabled={!history.undo.length || !project} onClick={() => restoreHistory('undo')} type="button"><Icon name="undo" /></button>
          <button className="pose-icon-button" title="Refazer" aria-label="Refazer" disabled={!history.redo.length || !project} onClick={() => restoreHistory('redo')} type="button"><Icon name="redo" /></button>
          {editingSlot && <button className="pose-button danger" onClick={() => void deletePose()} disabled={saving} type="button"><Icon name="trash" /> Excluir</button>}
          <button className="pose-button primary" onClick={() => void savePose()} disabled={!project || saving || loading} type="button"><Icon name="check" />{saving ? 'Salvando…' : 'Salvar pose'}</button>
          <span className={`pose-save-state${dirty ? ' pending' : ''}`}><i />{saveMessage || (dirty ? 'Alterações no rascunho' : editingSlot ? 'Pose salva' : 'Rascunho novo')}</span>
        </div>
      </header>

      {error && <div className="pose-error" role="alert"><span>{error}</span><button onClick={() => setError('')} type="button">Fechar</button></div>}
      {recoveredDraft && <div className="pose-recovery"><span><strong>Encontramos um rascunho salvo</strong><small>{recoveredDraft.project.name}{recoveredDraft.editingSlot ? ` · edição do slot ${recoveredDraft.editingSlot}` : ` · baseada em ${recoveredDraft.project.sourceModelName}`}</small></span><div><button onClick={() => void discardDraft()} type="button">Descartar</button><button className="pose-recover-button" onClick={recoverDraft} type="button">Retomar</button></div></div>}

      <div className="pose-editor-body">
        <section className="pose-canvas-column" aria-label="Prévia da pose">
          <div className="pose-canvas-heading"><span><i />{project ? 'PRÉVIA DA POSE' : sourcePreview ? 'MODELO BASE · SOMENTE PRÉVIA' : 'PRÉVIA DA POSE'}</span><span>{displayProject ? `${displayProject.width} × ${displayProject.height}` : 'Escolha um modelo para começar'}</span></div>
          <div ref={stageRef} className={`pose-stage${panning ? ' panning' : ''}${moveToolActive ? ' move-tool-active' : ''}`} style={{ '--preview-background': previewBackground } as import('react').CSSProperties} onPointerDown={beginPan} onPointerMove={moveCanvas} onPointerUp={stopCanvasGesture} onPointerCancel={stopCanvasGesture}>
            {displayProject ? <div className={`pose-artboard${!project ? ' source-preview' : ''}`} style={{ width: displayProject.width * scale, height: displayProject.height * scale, left: `calc(50% + ${pan.x}px)`, top: `calc(50% + ${pan.y}px)` }}>
              {visibleParts.map((part, index) => {
                const attachment = part.wardrobeAttachment
                const bone = attachment ? displayProject.parts.find((item) => item.id === attachment.attachedPartId) : undefined
                const currentAnchor = bone ? partJointAnchor(bone, displayProject.joints) ?? { x: bone.x + bone.width / 2, y: bone.y + bone.height / 2 } : null
                const offsetX = attachment && currentAnchor ? currentAnchor.x - attachment.referenceAnchor.x : 0
                const offsetY = attachment && currentAnchor ? currentAnchor.y - attachment.referenceAnchor.y : 0
                const bodyRotation = attachment && bone ? bone.rotation - attachment.referenceRotation : 0
                const image = <img key={part.id} className={`pose-part${attachment ? ' pose-wardrobe-part' : ''}${selectedId === part.id ? ' selected' : ''}${project && !attachment && !isMovablePosePart(project, part.id) ? ' move-locked' : ''}`} src={part.dataUrl} alt={part.name} draggable={false} onClick={(event) => { event.stopPropagation(); setSelectedId(part.id) }} onPointerDown={(event) => startPartDrag(event, part)} style={attachment ? { left: 0, top: 0, width: part.width * scale, height: part.height * scale, transform: `rotate(${part.rotation}deg)` } : { left: part.x * scale, top: part.y * scale, width: part.width * scale, height: part.height * scale, zIndex: index + 1, transform: `rotate(${part.rotation}deg)` }} />
                return attachment
                  ? <div key={part.id} className="pose-wardrobe-anchor" style={{ left: (part.x + offsetX) * scale, top: (part.y + offsetY) * scale, width: part.width * scale, height: part.height * scale, zIndex: index + 1, transformOrigin: `${(attachment.referenceAnchor.x - part.x) * scale}px ${(attachment.referenceAnchor.y - part.y) * scale}px`, transform: `rotate(${bodyRotation}deg)` }}>{image}</div>
                  : image
              })}
              {showJoints && <svg className="pose-joints" viewBox={`0 0 ${displayProject.width} ${displayProject.height}`} preserveAspectRatio="none">{displayProject.parts.filter((part) => !/tronco|corpo/i.test(part.name)).map((part) => {
                const anchor = partJointAnchor(part, displayProject.joints)
                if (!anchor) return null
                const connected = displayProject.joints.some((joint) => joint.childPartId === part.id && joint.fixed)
                return <circle key={part.id} className={`pose-joint-marker${connected ? ' fixed' : ''}${selectedId === part.id ? ' selected' : ''}`} cx={anchor.x} cy={anchor.y} r={Math.max(8, 9 / scale)} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); if (project) setSelectedId(part.id) }} aria-label={`Bolinha de junta de ${part.name}`} />
              })}</svg>}
            </div> : <div className="pose-canvas-empty"><span><Icon name="expand" /></span><strong>{loading ? 'Carregando poses…' : 'Sua pose começa aqui'}</strong><small>Escolha um modelo salvo e crie uma pose independente.</small><button className="pose-button primary" onClick={() => setSelectingModel(true)} type="button"><Icon name="plus" /> Escolher modelo</button></div>}
            <div className="pose-stage-tools"><span>{Math.round(zoom * 100)}%</span><button title="Aumentar zoom" onClick={() => setZoom((value) => Math.min(2.5, value + 0.15))} type="button">+</button><button title="Diminuir zoom" onClick={() => setZoom((value) => Math.max(0.45, value - 0.15))} type="button">−</button><button title="Centralizar" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} type="button"><Icon name="frame" /></button></div>
          </div>
          <footer className="pose-canvas-footer"><span><kbd>Arraste o fundo</kbd> para mover a prévia {project && <><i /> <kbd>Arraste a peça</kbd> para {moveToolActive ? 'mover' : 'girar pela bolinha'}</>}</span><span>{displayProject ? `${displayProject.parts.length} peças · ${displayProject.joints.length} juntas` : 'O modelo original fica protegido'}</span></footer>
        </section>

        <aside className="pose-side-panel" aria-label="Slots e ferramentas de pose">
          <section className="pose-export-slots-panel" aria-label="Poses usadas na exportação de personagens">
            <header><span><strong>Poses para exportação</strong><small>Escolha até cinco poses deste modelo</small></span><span className="pose-slot-count">{exportPoseSlots.filter((slot) => slot !== null).length}/5</span></header>
            <div className="pose-export-slot-list">
              {exportPoseSlots.map((poseSlot, index) => {
                const available = allPoseSlots.filter((pose): pose is NonNullable<FabricatorPoseSummary> => Boolean(pose && pose.sourceModelSlot === selectedModelSlot))
                const selectedPose = available.find((pose) => pose.slot === poseSlot)
                return <label className="pose-export-slot-row" key={index}><b>{String(index + 1).padStart(2, '0')}</b><select aria-label={`Pose do slot de exportação ${index + 1}`} disabled={savingExportPoseSlots} value={poseSlot ?? ''} onChange={(event) => void assignExportPose(index, event.target.value ? Number(event.target.value) : null)}><option value="">Escolher pose</option>{poseSlot !== null && !selectedPose && <option value={poseSlot}>Pose {String(poseSlot).padStart(2, '0')} · indisponível</option>}{available.map((pose) => <option key={pose.slot} value={pose.slot} disabled={exportPoseSlots.some((slot, slotIndex) => slotIndex !== index && slot === pose.slot)}>Pose {String(pose.slot).padStart(2, '0')}</option>)}</select></label>
              })}
            </div>
          </section>

          <section className="pose-slots-panel">
            <header><span><strong>Slots de poses</strong><small>12 espaços · 6 visíveis</small></span><span className="pose-slot-count">{slots.filter(Boolean).length}/12</span></header>
            <div className="pose-slot-grid" role="tablist" aria-label="Slots de poses">
              {slots.map((slot, index) => {
                const number = index + 1
                return <button key={number} role="tab" aria-selected={activeSlot === number} className={`pose-slot${activeSlot === number ? ' active' : ''}${slot ? ' filled' : ' empty'}`} onClick={() => { setCategoryPickerOpen(false); void selectPoseSlot(number) }} title={slot ? `${slot.name} · ${resolvePoseCategory(slot)}` : `Slot ${number}: vazio`} type="button"><b>{String(number).padStart(2, '0')}</b><small>{slot ? resolvePoseCategory(slot) : 'Vazio'}</small></button>
              })}
            </div>
          </section>

          <section className="pose-category-panel" aria-label="Categoria da pose">
            <span><strong>Categoria da pose</strong><small>Organiza as poses no Customizar</small></span>
            <button className="pose-category-trigger" disabled={!project} aria-expanded={categoryPickerOpen} onClick={() => setCategoryPickerOpen((open) => !open)} type="button">{project ? resolvePoseCategory({ ...project, slot: editingSlot ?? undefined }) : 'Crie ou abra uma pose'} <Icon name="chevronRight" /></button>
            {categoryPickerOpen && project && <div className="pose-category-picker">
              <div className="pose-category-options">{categoryOptions.map((category) => <button className={resolvePoseCategory({ ...project, slot: editingSlot ?? undefined }) === category ? 'active' : ''} key={category} onClick={() => assignCategory(category)} type="button">{category}</button>)}</div>
              <form onSubmit={(event) => { event.preventDefault(); assignCategory(newCategoryName) }}><input aria-label="Nome da nova categoria" maxLength={32} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="Nova categoria" value={newCategoryName} /><button disabled={!newCategoryName.trim()} type="submit">Adicionar</button></form>
            </div>}
          </section>

          <section className="pose-tools-panel">
            <header className="pose-tools-heading"><span><small>EDIÇÃO</small><strong>{project ? selectedPart?.name ?? 'Selecione uma peça' : 'Controles'}</strong></span>{project && <div className="pose-heading-actions"><button className={`pose-move-tool${moveToolActive ? ' active' : ''}`} aria-pressed={moveToolActive} title={moveToolActive ? 'Desativar modo mover peça' : 'Ativar modo mover peça'} onClick={() => setMoveToolActive((value) => !value)} type="button"><Icon name="move" /><span>{moveToolActive ? 'Mover ligado' : 'Mover peça'}</span></button><button className={`pose-eye-button${showJoints ? ' active' : ''}`} title={showJoints ? 'Ocultar juntas' : 'Mostrar juntas'} onClick={() => setShowJoints((value) => !value)} type="button"><Icon name={showJoints ? 'eye' : 'eyeOff'} /></button></div>}</header>
            <nav className="pose-tabs" aria-label="Painel da pose">{([['parts', 'Peças'], ['layers', 'Camadas'], ['joints', 'Rig']] as const).map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)} type="button">{label}</button>)}</nav>
            {project && tab === 'parts' && <div className="pose-tool-content">
              <label className="pose-search"><Icon name="search" /><input value={partFilter} onChange={(event) => setPartFilter(event.target.value)} placeholder="Localizar peça" /></label>
              <div className="pose-piece-list">{filteredParts.map((part) => <button key={part.id} className={`pose-piece-row${selectedId === part.id ? ' selected' : ''}`} onClick={() => setSelectedId(part.id)} type="button"><span className="pose-piece-thumb"><img src={part.dataUrl} alt="" /></span><span><b>{part.name}</b><small>{Math.round(part.rotation)}°</small></span></button>)}</div>
              {selectedPart && <div className="pose-transform-controls">
                <div className="pose-control-heading"><strong>Posição e rotação</strong><span>A bolinha destacada é o pivô usado no modelo.</span></div>
                <div className="pose-number-row"><label>X<input aria-label="Posição X" title={selectedCanMove ? 'Mover esta peça e as filhas conectadas' : 'Cabeça e tronco não podem ser movidos por esta ferramenta'} disabled={!selectedCanMove} type="number" step="1" value={Number(selectedPart.x.toFixed(1))} onChange={(event) => setPartPosition(selectedPart.id, 'x', Number(event.target.value))} /></label><label>Y<input aria-label="Posição Y" title={selectedCanMove ? 'Mover esta peça e as filhas conectadas' : 'Cabeça e tronco não podem ser movidos por esta ferramenta'} disabled={!selectedCanMove} type="number" step="1" value={Number(selectedPart.y.toFixed(1))} onChange={(event) => setPartPosition(selectedPart.id, 'y', Number(event.target.value))} /></label></div>
                <small className="pose-pivot-hint">{selectedCanMove ? 'Mover esta peça também leva os segmentos conectados abaixo dela.' : 'Cabeça e tronco não podem ser movidos por esta ferramenta.'}</small>
                <div className="pose-rotation-card">
                  <span className="pose-rotation-title">Como quer girar?</span>
                  <div className="pose-mode-selector"><button className={rotationMode === 'branch' ? 'active' : ''} onClick={() => setRotationMode('branch')} type="button">Peça + conectadas</button><button className={rotationMode === 'part' ? 'active' : ''} onClick={() => setRotationMode('part')} type="button">Só esta peça</button></div>
                  {rotationMode === 'branch' && <small className="pose-pivot-hint">{project.joints.find((joint) => joint.childPartId === selectedPart.id) ? `Gira em torno da bolinha de ${selectedPart.name}. Filhas fixadas acompanham.` : 'Peça central: gira em torno da própria bolinha.'}</small>}
                  <label className="pose-rotation-label">Ângulo <output>{Math.round(selectedPart.rotation)}°</output></label>
                  <input className="pose-rotation-range" aria-label="Ângulo de rotação" type="range" min={-360} max={360} value={Math.max(-360, Math.min(360, selectedPart.rotation))} onChange={(event) => rotateSelected(selectedPart.id, Number(event.target.value), rotationMode === 'branch')} />
                  <div className="pose-rotation-actions"><button onClick={() => rotateSelected(selectedPart.id, selectedPart.rotation - 15, rotationMode === 'branch')} type="button">−15°</button><label><input aria-label="Ângulo em graus" type="number" step="1" value={Number(selectedPart.rotation.toFixed(1))} onChange={(event) => { if (event.target.value !== '' && Number.isFinite(Number(event.target.value))) rotateSelected(selectedPart.id, Number(event.target.value), rotationMode === 'branch') }} />°</label><button onClick={() => rotateSelected(selectedPart.id, selectedPart.rotation + 15, rotationMode === 'branch')} type="button">+15°</button><button className="pose-rotation-reset" title="Zerar rotação" onClick={() => rotateSelected(selectedPart.id, 0, rotationMode === 'branch')} type="button">Zerar</button></div>
                </div>
              </div>}
            </div>}
            {project && tab === 'layers' && <div className="pose-tool-content pose-layer-list">{[...parts].reverse().map((part, index, ordered) => <div key={part.id} className={`pose-layer-row${selectedId === part.id ? ' selected' : ''}`}><button className="pose-layer-select" onClick={() => setSelectedId(part.id)} type="button"><span className="pose-piece-thumb"><img src={part.dataUrl} alt="" /></span><span><b>{part.name}</b><small>Camada {ordered.length - index}</small></span></button><div><button title="Trazer para frente" disabled={index === 0} onClick={() => changeLayer(part.id, -1)} type="button">↑</button><button title="Enviar para trás" disabled={index === ordered.length - 1} onClick={() => changeLayer(part.id, 1)} type="button">↓</button><button title={project.hiddenPartIds.includes(part.id) ? 'Mostrar peça' : 'Ocultar peça'} onClick={() => changeProject((current) => ({ ...current, hiddenPartIds: current.hiddenPartIds.includes(part.id) ? current.hiddenPartIds.filter((id) => id !== part.id) : [...current.hiddenPartIds, part.id] }))} type="button"><Icon name={project.hiddenPartIds.includes(part.id) ? 'eyeOff' : 'eye'} /></button></div></div>)}</div>}
            {project && tab === 'joints' && <div className="pose-tool-content pose-rig-list"><p>Estas conexões vêm de Modelos. Selecione uma peça em Peças e use “Peça + conectadas” para girar o ramo pela mesma bolinha.</p>{project.joints.map((joint) => {
              const parent = project.parts.find((part) => part.id === joint.parentPartId)
              const child = project.parts.find((part) => part.id === joint.childPartId)
              return <article key={joint.id} className={`pose-rig-row${joint.fixed ? ' fixed' : ''}`}><div className="pose-rig-title"><b>{parent?.name ?? 'Peça'}</b><Icon name="chevronRight" /><b>{child?.name ?? 'Peça'}</b></div><div className="pose-rig-status"><i />{joint.fixed ? 'Conectada no modelo' : 'Solta no modelo'}</div><button className="pose-rig-select" onClick={() => { setSelectedId(joint.childPartId); setTab('parts') }} type="button">Selecionar {child?.name ?? 'peça'} para girar</button></article>
            })}{project.joints.length === 0 && <small>Este modelo ainda não tem juntas. Prepare o rig na aba Modelos para usá-lo em poses.</small>}</div>}
            {!project && <div className="pose-panel-empty"><Icon name="sparkles" /><strong>{sourcePreview ? 'Prévia do modelo selecionado' : 'Crie ou abra uma pose'}</strong><small>{sourcePreview ? 'Clique em Nova pose para editar uma cópia independente.' : 'As ferramentas aparecem aqui.'}</small></div>}
          </section>
        </aside>
      </div>

      {selectingModel && <div className="pose-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectingModel(false) }}><section className="pose-model-picker" role="dialog" aria-modal="true" aria-labelledby="pose-model-picker-title"><header><span><small>BIBLIOTECA DE POSES</small><strong id="pose-model-picker-title">Escolha o modelo</strong></span><button onClick={() => setSelectingModel(false)} aria-label="Fechar" type="button">×</button></header><p>Cada modelo tem seus próprios 12 slots. As poses salvas continuam disponíveis se o modelo de origem for excluído.</p><div className="pose-model-options">{models.map((model, index) => model && <button key={`model-${model.slot}`} className="pose-model-option" onClick={() => void selectModelLibrary(model.slot)} type="button"><span className="pose-model-number">{String(index + 1).padStart(2, '0')}</span><span><b>{model.name}</b><small>{model.partCount} peças · modelo pronto</small></span><Icon name="chevronRight" /></button>)}{Array.from(new Set(allPoseSlots.filter((pose) => pose && !models[pose.sourceModelSlot - 1]).map((pose) => pose!.sourceModelSlot))).map((modelSlot) => { const archivedName = allPoseSlots.find((pose) => pose?.sourceModelSlot === modelSlot)?.sourceModelName ?? `Modelo ${modelSlot}`; return <button key={`archive-${modelSlot}`} className="pose-model-option archived" onClick={() => void selectModelLibrary(modelSlot)} type="button"><span className="pose-model-number"><Icon name="box" /></span><span><b>{archivedName}</b><small>Modelo de origem removido · poses preservadas</small></span><Icon name="chevronRight" /></button>})}{models.every((model) => !model) && allPoseSlots.length === 0 && <div className="pose-model-none">Salve primeiro um modelo na aba Modelos para começar.</div>}</div></section></div>}
    </section>
  )
}
