import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FabricatorPose, FabricatorPoseDraft, FabricatorPoseDraftSave, FabricatorPoseSave, FabricatorPoseSummary, FabricatorSlotSummary, PosePart } from '../../../../shared/fabricator'
import { Icon } from '../../ui/components/Icon'
import { jointPivot, normalizeLayerOrder, orderedParts } from './models/rig'

type DraftProject = Omit<FabricatorPose, 'slot'>
type PanelTab = 'parts' | 'layers' | 'joints'
type PoseHistory = { undo: DraftProject[]; redo: DraftProject[] }
type PanGesture = { pointerId: number; x: number; y: number; originX: number; originY: number }
type PartGesture = { pointerId: number; partId: string; x: number; y: number; before: DraftProject }

const SLOT_COUNT = 12
const HISTORY_LIMIT = 50
const emptyPoseSlots = (): FabricatorPoseSummary[] => Array.from({ length: SLOT_COUNT }, () => null)
const emptyHistory = (): PoseHistory => ({ undo: [], redo: [] })

function cloneProject(project: DraftProject): DraftProject {
  return structuredClone(project)
}

function rotatePoint(point: { x: number; y: number }, origin: { x: number; y: number }, angle: number) {
  const radians = angle * Math.PI / 180
  const x = point.x - origin.x
  const y = point.y - origin.y
  return { x: origin.x + x * Math.cos(radians) - y * Math.sin(radians), y: origin.y + x * Math.sin(radians) + y * Math.cos(radians) }
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

export function PoseWorkspace() {
  const [models, setModels] = useState<FabricatorSlotSummary[]>(Array.from({ length: 10 }, () => null))
  const [slots, setSlots] = useState<FabricatorPoseSummary[]>(emptyPoseSlots)
  const [activeSlot, setActiveSlot] = useState(1)
  const [project, setProject] = useState<DraftProject | null>(null)
  const [editingSlot, setEditingSlot] = useState<number | null>(null)
  const [history, setHistory] = useState<PoseHistory>(emptyHistory)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<PanelTab>('parts')
  const [rotationMode, setRotationMode] = useState<'part' | 'branch'>('branch')
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
  const stageRef = useRef<HTMLDivElement>(null)
  const projectRef = useRef<DraftProject | null>(null)
  const editingSlotRef = useRef<number | null>(null)
  const dirtyRef = useRef(false)
  const panRef = useRef<PanGesture | null>(null)
  const partDragRef = useRef<PartGesture | null>(null)
  const pendingAssets = useRef<Map<string, string>>(new Map())
  const writeQueue = useRef<Promise<void>>(Promise.resolve())
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const publishProject = useCallback((next: DraftProject | null, isDirty = true) => {
    projectRef.current = next
    dirtyRef.current = isDirty
    setProject(next)
    setDirty(isDirty)
  }, [])

  const loadLibraries = useCallback(async () => {
    setLoading(true)
    try {
      const [modelSlots, poseSlots, draft] = await Promise.all([
        window.desktop.listFabricatorSlots(),
        window.desktop.listFabricatorPoseSlots(),
        window.desktop.loadFabricatorPoseDraft()
      ])
      setModels(modelSlots)
      setSlots(poseSlots)
      setRecoveredDraft(draft)
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
    const write = writeQueue.current.catch(() => undefined).then(() => window.desktop.saveFabricatorPoseDraft(serialized, assets))
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
    try { await window.desktop.deleteFabricatorPoseDraft() } catch { /* O conteúdo em memória continua editável. */ }
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

  const beginNewPose = async (modelSlot: number) => {
    const model = await window.desktop.loadFabricatorSlot(modelSlot)
    if (!model) { setError('Não foi possível carregar esse modelo.'); return }
    const next: DraftProject = {
      schemaVersion: 1,
      name: `Pose de ${model.name}`,
      sourceModelSlot: model.slot,
      sourceModelName: model.name,
      sourceModelUpdatedAt: model.updatedAt,
      width: model.width,
      height: model.height,
      parts: model.parts.map((part) => ({
        id: part.id, name: part.name, x: part.x, y: part.y, width: part.width, height: part.height,
        rotation: part.rotation, jointAnchor: part.jointAnchor ? { ...part.jointAnchor } : undefined, dataUrl: part.dataUrl
      })),
      joints: model.joints.map((joint) => structuredClone(joint)),
      layerOrder: normalizeLayerOrder(model.parts, model.layerOrder),
      hiddenPartIds: [...(model.hiddenPartIds ?? [])],
      updatedAt: new Date().toISOString()
    }
    pendingAssets.current = new Map(next.parts.map((part) => [part.id, part.dataUrl]))
    setActiveSlot(slots.findIndex((slot) => !slot) + 1 || SLOT_COUNT)
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
      const saved = await window.desktop.loadFabricatorPose(slot)
      if (!saved) throw new Error('O slot de pose não pôde ser carregado.')
      const { slot: _slot, ...editable } = saved
      // The draft is stored in a different folder from the saved pose, so copy
      // the pose's part images into the draft library on its next autosave.
      pendingAssets.current = new Map(editable.parts.map((part) => [part.id, part.dataUrl]))
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
      const saved: FabricatorPose = { ...snapshot, slot, updatedAt: new Date().toISOString() }
      await window.desktop.saveFabricatorPose(slot, toSavedPose(saved, slot), assets)
      for (const asset of assets) if (pendingAssets.current.get(asset.id) === asset.dataUrl) pendingAssets.current.delete(asset.id)
      await window.desktop.deleteFabricatorPoseDraft()
      setRecoveredDraft(null)
      setEditingSlot(slot)
      editingSlotRef.current = slot
      setActiveSlot(slot)
      publishProject({ ...snapshot, updatedAt: saved.updatedAt }, false)
      setSlots((current) => current.map((item, index) => index + 1 === slot ? { slot: slot!, name: saved.name, sourceModelName: saved.sourceModelName, partCount: saved.parts.length, updatedAt: saved.updatedAt } : item))
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
      await window.desktop.deleteFabricatorPose(editingSlot)
      await discardDraft()
      setSlots((current) => current.map((slot, index) => index + 1 === editingSlot ? null : slot))
      setActiveSlot(editingSlot)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível excluir a pose.')
    }
  }

  const parts = useMemo(() => project ? orderedParts(project.parts, project.layerOrder) : [], [project])
  const selectedPart = project?.parts.find((part) => part.id === selectedId) ?? null
  const visibleParts = useMemo(() => parts.filter((part) => !project?.hiddenPartIds.includes(part.id)), [parts, project?.hiddenPartIds])
  const filteredParts = useMemo(() => parts.filter((part) => part.name.toLocaleLowerCase().includes(partFilter.toLocaleLowerCase())), [parts, partFilter])
  const scale = project ? Math.max(0.05, Math.min((stageSize.width - 48) / project.width, (stageSize.height - 48) / project.height)) * zoom : 1

  const movePart = (partId: string, dx: number, dy: number) => changeProject((current) => ({
    ...current,
    parts: current.parts.map((part) => part.id === partId ? { ...part, x: part.x + dx, y: part.y + dy } : part),
    joints: current.joints.map((joint) => ({
      ...joint,
      ...((joint.parentPartId === partId || joint.childPartId === partId) ? { pivot: { x: jointPivot(joint).x + dx, y: jointPivot(joint).y + dy } } : {}),
      ...(joint.parentPartId === partId ? { parentAnchor: { x: joint.parentAnchor.x + dx, y: joint.parentAnchor.y + dy } } : {}),
      ...(joint.childPartId === partId ? { childAnchor: { x: joint.childAnchor.x + dx, y: joint.childAnchor.y + dy } } : {})
    }))
  }), false)

  const rotateBranch = (jointId: string, amount: number) => changeProject((current) => {
    const joint = current.joints.find((item) => item.id === jointId)
    if (!joint) return current
    const affected = new Set<string>([joint.childPartId])
    let changed = true
    while (changed) {
      changed = false
      for (const item of current.joints) if (item.fixed && affected.has(item.parentPartId) && !affected.has(item.childPartId)) { affected.add(item.childPartId); changed = true }
    }
    const origin = jointPivot(joint)
    return {
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
    }
  })

  const changeLayer = (partId: string, direction: -1 | 1) => changeProject((current) => {
    const topDown = normalizeLayerOrder(current.parts, current.layerOrder).reverse()
    const index = topDown.indexOf(partId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= topDown.length) return current
    ;[topDown[index], topDown[target]] = [topDown[target], topDown[index]]
    return { ...current, layerOrder: topDown.reverse() }
  })

  const beginPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!project || event.target instanceof Element && event.target.closest('.pose-stage-tools, .pose-part, .pose-joint-marker')) return
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
      const dx = (event.clientX - drag.x) / scale
      const dy = (event.clientY - drag.y) / scale
      if (dx || dy) movePart(drag.partId, dx, dy)
      drag.x = event.clientX; drag.y = event.clientY
    }
  }

  const stopCanvasGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (panRef.current?.pointerId === event.pointerId) { panRef.current = null; setPanning(false) }
    const drag = partDragRef.current
    if (drag?.pointerId === event.pointerId) {
      partDragRef.current = null
      const current = projectRef.current
      if (current && JSON.stringify(drag.before.parts) !== JSON.stringify(current.parts)) remember(drag.before)
    }
  }

  const startPartDrag = (event: React.PointerEvent<HTMLImageElement>, part: PosePart) => {
    if (!project) return
    event.preventDefault(); event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelectedId(part.id)
    partDragRef.current = { pointerId: event.pointerId, partId: part.id, x: event.clientX, y: event.clientY, before: cloneProject(project) }
  }

  return (
    <section className="fabricator-workspace pose-workspace" aria-label="Editor de poses">
      <header className="pose-toolbar">
        <div className="pose-toolbar-title"><span className="model-slot-logo"><Icon name="expand" /></span><span><strong>Poses</strong><small>{project ? `Modelo: ${project.sourceModelName}` : 'Crie poses sem alterar seus modelos'}</small></span></div>
        <div className="pose-toolbar-actions">
          <button className="pose-button secondary" onClick={() => setSelectingModel(true)} type="button"><Icon name="plus" /> Nova pose</button>
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
          <div className="pose-canvas-heading"><span><i /> PRÉVIA DA POSE</span><span>{project ? `${project.width} × ${project.height}` : 'Escolha um modelo para começar'}</span></div>
          <div ref={stageRef} className={`pose-stage${panning ? ' panning' : ''}`} onPointerDown={beginPan} onPointerMove={moveCanvas} onPointerUp={stopCanvasGesture} onPointerCancel={stopCanvasGesture}>
            {project ? <div className="pose-artboard" style={{ width: project.width * scale, height: project.height * scale, left: `calc(50% + ${pan.x}px)`, top: `calc(50% + ${pan.y}px)` }}>
              {visibleParts.map((part, index) => <img key={part.id} className={`pose-part${selectedId === part.id ? ' selected' : ''}`} src={part.dataUrl} alt={part.name} draggable={false} onClick={(event) => { event.stopPropagation(); setSelectedId(part.id) }} onPointerDown={(event) => startPartDrag(event, part)} style={{ left: part.x * scale, top: part.y * scale, width: part.width * scale, height: part.height * scale, zIndex: index + 1, transform: `rotate(${part.rotation}deg)` }} />)}
              {showJoints && <svg className="pose-joints" viewBox={`0 0 ${project.width} ${project.height}`} preserveAspectRatio="none">{project.joints.map((joint) => {
                const pivot = jointPivot(joint)
                return <circle key={joint.id} className={`pose-joint-marker${joint.fixed ? ' fixed' : ''}${selectedId === joint.childPartId ? ' selected' : ''}`} cx={pivot.x} cy={pivot.y} r={Math.max(8, 9 / scale)} />
              })}</svg>}
            </div> : <div className="pose-canvas-empty"><span><Icon name="expand" /></span><strong>{loading ? 'Carregando poses…' : 'Sua pose começa aqui'}</strong><small>Escolha um modelo salvo e crie uma pose independente.</small><button className="pose-button primary" onClick={() => setSelectingModel(true)} type="button"><Icon name="plus" /> Escolher modelo</button></div>}
            <div className="pose-stage-tools"><span>{Math.round(zoom * 100)}%</span><button title="Aumentar zoom" onClick={() => setZoom((value) => Math.min(2.5, value + 0.15))} type="button">+</button><button title="Diminuir zoom" onClick={() => setZoom((value) => Math.max(0.45, value - 0.15))} type="button">−</button><button title="Centralizar" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} type="button"><Icon name="frame" /></button></div>
          </div>
          <footer className="pose-canvas-footer"><span><kbd>Arraste o fundo</kbd> para mover a prévia <i /> <kbd>Arraste a peça</kbd> para posicionar</span><span>{project ? `${project.parts.length} peças · ${project.joints.length} juntas` : 'O modelo original fica protegido'}</span></footer>
        </section>

        <aside className="pose-side-panel" aria-label="Slots e ferramentas de pose">
          <section className="pose-slots-panel">
            <header><span><strong>Slots de poses</strong><small>12 espaços · 6 visíveis</small></span><span className="pose-slot-count">{slots.filter(Boolean).length}/12</span></header>
            <div className="pose-slot-grid" role="tablist" aria-label="Slots de poses">
              {slots.map((slot, index) => {
                const number = index + 1
                return <button key={number} role="tab" aria-selected={activeSlot === number} className={`pose-slot${activeSlot === number ? ' active' : ''}${slot ? ' filled' : ' empty'}`} onClick={() => void selectPoseSlot(number)} title={slot ? `${slot.name} · baseada em ${slot.sourceModelName}` : `Slot ${number}: vazio`} type="button"><b>{String(number).padStart(2, '0')}</b><small>{slot ? 'Preenchido' : 'Vazio'}</small></button>
              })}
            </div>
          </section>

          <section className="pose-tools-panel">
            <header className="pose-tools-heading"><span><small>EDIÇÃO</small><strong>{project ? selectedPart?.name ?? 'Selecione uma peça' : 'Controles'}</strong></span>{project && <button className={`pose-eye-button${showJoints ? ' active' : ''}`} title={showJoints ? 'Ocultar juntas' : 'Mostrar juntas'} onClick={() => setShowJoints((value) => !value)} type="button"><Icon name={showJoints ? 'eye' : 'eyeOff'} /></button>}</header>
            <nav className="pose-tabs" aria-label="Painel da pose">{([['parts', 'Peças'], ['layers', 'Camadas'], ['joints', 'Rig']] as const).map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)} type="button">{label}</button>)}</nav>
            {project && tab === 'parts' && <div className="pose-tool-content">
              <label className="pose-search"><Icon name="search" /><input value={partFilter} onChange={(event) => setPartFilter(event.target.value)} placeholder="Localizar peça" /></label>
              <div className="pose-piece-list">{filteredParts.map((part) => <button key={part.id} className={`pose-piece-row${selectedId === part.id ? ' selected' : ''}`} onClick={() => setSelectedId(part.id)} type="button"><span className="pose-piece-thumb"><img src={part.dataUrl} alt="" /></span><span><b>{part.name}</b><small>{Math.round(part.rotation)}°</small></span></button>)}</div>
              {selectedPart && <div className="pose-transform-controls">
                <div className="pose-control-heading"><strong>Transformação</strong><span>Posição e rotação independentes</span></div>
                <div className="pose-number-row"><label>X<input type="number" step="1" value={Number(selectedPart.x.toFixed(1))} onChange={(event) => changeProject((current) => ({ ...current, parts: current.parts.map((part) => part.id === selectedPart.id ? { ...part, x: Number(event.target.value) || 0 } : part) }))} /></label><label>Y<input type="number" step="1" value={Number(selectedPart.y.toFixed(1))} onChange={(event) => changeProject((current) => ({ ...current, parts: current.parts.map((part) => part.id === selectedPart.id ? { ...part, y: Number(event.target.value) || 0 } : part) }))} /></label></div>
                <div className="pose-mode-selector"><button className={rotationMode === 'branch' ? 'active' : ''} onClick={() => setRotationMode('branch')} type="button">Girar ramo</button><button className={rotationMode === 'part' ? 'active' : ''} onClick={() => setRotationMode('part')} type="button">Girar peça</button></div>
                {rotationMode === 'part' ? <><label className="pose-rotation-label">Rotação <output>{Math.round(selectedPart.rotation)}°</output></label><input className="pose-rotation-range" type="range" min={-180} max={180} value={Math.max(-180, Math.min(180, selectedPart.rotation))} onChange={(event) => changeProject((current) => ({ ...current, parts: current.parts.map((part) => part.id === selectedPart.id ? { ...part, rotation: Number(event.target.value) } : part) }))} /><input className="pose-rotation-number" aria-label="Rotação da peça em graus" type="number" min={-360} max={360} value={Number(selectedPart.rotation.toFixed(1))} onChange={(event) => changeProject((current) => ({ ...current, parts: current.parts.map((part) => part.id === selectedPart.id ? { ...part, rotation: Number(event.target.value) || 0 } : part) }))} /></> : <p className="pose-mode-hint">Use os controles de rotação na aba Rig para girar em torno de uma junta e mover as peças filhas fixadas.</p>}
              </div>}
            </div>}
            {project && tab === 'layers' && <div className="pose-tool-content pose-layer-list">{[...parts].reverse().map((part, index, ordered) => <div key={part.id} className={`pose-layer-row${selectedId === part.id ? ' selected' : ''}`}><button className="pose-layer-select" onClick={() => setSelectedId(part.id)} type="button"><span className="pose-piece-thumb"><img src={part.dataUrl} alt="" /></span><span><b>{part.name}</b><small>Camada {ordered.length - index}</small></span></button><div><button title="Trazer para frente" disabled={index === 0} onClick={() => changeLayer(part.id, -1)} type="button">↑</button><button title="Enviar para trás" disabled={index === ordered.length - 1} onClick={() => changeLayer(part.id, 1)} type="button">↓</button><button title={project.hiddenPartIds.includes(part.id) ? 'Mostrar peça' : 'Ocultar peça'} onClick={() => changeProject((current) => ({ ...current, hiddenPartIds: current.hiddenPartIds.includes(part.id) ? current.hiddenPartIds.filter((id) => id !== part.id) : [...current.hiddenPartIds, part.id] }))} type="button"><Icon name={project.hiddenPartIds.includes(part.id) ? 'eyeOff' : 'eye'} /></button></div></div>)}</div>}
            {project && tab === 'joints' && <div className="pose-tool-content pose-rig-list"><p>Juntas fixadas formam o rig. Girar um ramo move também suas peças descendentes.</p>{project.joints.map((joint) => {
              const parent = project.parts.find((part) => part.id === joint.parentPartId)
              const child = project.parts.find((part) => part.id === joint.childPartId)
              return <article key={joint.id} className={`pose-rig-row${joint.fixed ? ' fixed' : ''}`}><div className="pose-rig-title"><b>{parent?.name ?? 'Peça'}</b><Icon name="chevronRight" /><b>{child?.name ?? 'Peça'}</b></div><div className="pose-rig-actions"><button className={joint.fixed ? 'fixed' : ''} title={joint.fixed ? 'Desfixar esta conexão' : 'Fixar esta conexão ao rig'} onClick={() => changeProject((current) => ({ ...current, joints: current.joints.map((item) => item.id === joint.id ? { ...item, fixed: !item.fixed } : item) }))} type="button">{joint.fixed ? 'Fixada' : 'Fixar'}</button><button title="Girar ramo à esquerda" disabled={!joint.fixed} onClick={() => rotateBranch(joint.id, -15)} type="button">−15°</button><button title="Girar ramo à direita" disabled={!joint.fixed} onClick={() => rotateBranch(joint.id, 15)} type="button">+15°</button></div></article>
            })}{project.joints.length === 0 && <small>Este modelo ainda não tem juntas. Prepare o rig na aba Modelos para usá-lo em poses.</small>}</div>}
            {!project && <div className="pose-panel-empty"><Icon name="sparkles" /><strong>Crie ou abra uma pose</strong><small>As ferramentas aparecem aqui.</small></div>}
          </section>
        </aside>
      </div>

      {selectingModel && <div className="pose-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectingModel(false) }}><section className="pose-model-picker" role="dialog" aria-modal="true" aria-labelledby="pose-model-picker-title"><header><span><small>COMEÇAR UMA POSE</small><strong id="pose-model-picker-title">Escolha um modelo pronto</strong></span><button onClick={() => setSelectingModel(false)} aria-label="Fechar" type="button">×</button></header><p>Vamos criar uma cópia independente. Editar esta pose não altera o modelo original.</p><div className="pose-model-options">{models.map((model, index) => model && <button key={model.slot} className="pose-model-option" onClick={() => void (async () => { if (await canReplaceCurrent()) await beginNewPose(model.slot) })()} type="button"><span className="pose-model-number">{String(index + 1).padStart(2, '0')}</span><span><b>{model.name}</b><small>{model.partCount} peças · {new Date(model.updatedAt).toLocaleDateString()}</small></span><Icon name="chevronRight" /></button>)}{models.every((model) => !model) && <div className="pose-model-none">Salve primeiro um modelo na aba Modelos para começar.</div>}</div></section></div>}
    </section>
  )
}
