import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FabricatorAssetSave, FabricatorProject, FabricatorSlotSummary, JointLink, ModelPart } from '../../../../shared/fabricator'
import { Icon, type IconName } from '../../ui/components/Icon'

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
type AnchorDragState = { jointId: string; side: 'parentAnchor' | 'childAnchor'; pointerId: number; x: number; y: number }

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

function edgePoint(part: ModelPart, target: ModelPart): { x: number; y: number } {
  const center = { x: part.x + part.width / 2, y: part.y + part.height / 2 }
  const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 }
  const dx = targetCenter.x - center.x
  const dy = targetCenter.y - center.y
  const horizontal = Math.abs(dx / Math.max(1, part.width)) > Math.abs(dy / Math.max(1, part.height))
  return horizontal
    ? { x: center.x + Math.sign(dx || 1) * part.width / 2, y: center.y + dy * part.width / (2 * Math.max(1, Math.abs(dx))) }
    : { x: center.x + dx * part.height / (2 * Math.max(1, Math.abs(dy))), y: center.y + Math.sign(dy || 1) * part.height / 2 }
}

function linkParts(parent: ModelPart, child: ModelPart, suggested = false): JointLink {
  return { id: makeId(), parentPartId: parent.id, childPartId: child.id, parentAnchor: edgePoint(parent, child), childAnchor: edgePoint(child, parent), suggested }
}

function suggestJoints(parts: ModelPart[]): JointLink[] {
  const torso = parts.find((part) => /tronco|corpo/i.test(part.name))
  const head = parts.find((part) => /cabeça/i.test(part.name))
  if (!torso || parts.length < 2) return []
  const links: JointLink[] = []
  if (head) links.push(linkParts(torso, head, true))
  const arms = parts.filter((part) => /braço esquerdo|braço direito/i.test(part.name))
  const forearms = parts.filter((part) => /antebraço/i.test(part.name))
  for (const arm of arms) {
    links.push(linkParts(torso, arm, true))
    const side = arm.name.toLowerCase().includes('esquerdo') ? 'esquerdo' : 'direito'
    const forearm = forearms.find((part) => part.name.toLowerCase().includes(side))
    if (forearm) links.push(linkParts(arm, forearm, true))
  }
  for (const leg of parts.filter((part) => /perna/i.test(part.name))) links.push(linkParts(torso, leg, true))
  return links
}

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
    return { ...part, id: makeId(), name: `${part.name} ${index === 0 ? 'A' : 'B'}`, x: part.x + region.x, y: part.y + region.y, width: region.width, height: region.height, rotation: 0, dataUrl: canvas.toDataURL('image/png') }
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
  const [activeSlot, setActiveSlot] = useState(1)
  const [project, setProject] = useState<FabricatorProject | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [connectMode, setConnectMode] = useState(false)
  const [connectFromId, setConnectFromId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [stageSize, setStageSize] = useState({ width: 1, height: 1 })
  const [renamingPartId, setRenamingPartId] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const anchorDragRef = useRef<AnchorDragState | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const requestId = useRef(0)
  const dirtyAssets = useRef<Map<string, string>>(new Map())
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void window.desktop.listFabricatorSlots().then(setSlots).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Não foi possível abrir a biblioteca.'))
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
      const assets: FabricatorAssetSave[] = Array.from(dirtyAssets.current, ([id, dataUrl]) => ({ id, dataUrl }))
      const { sourceDataUrl: _sourceDataUrl, parts, ...metadata } = project
      const serialized = { ...metadata, parts: parts.map(({ dataUrl: _dataUrl, ...part }) => part) }
      void window.desktop.saveFabricatorProject(serialized, assets).then(() => {
        for (const asset of assets) if (dirtyAssets.current.get(asset.id) === asset.dataUrl) dirtyAssets.current.delete(asset.id)
        setSaveState('saved')
        setSlots((current) => current.map((item, index) => index + 1 === project.slot ? { slot: project.slot, name: project.name, sourceName: project.sourceName, partCount: project.parts.length, updatedAt: project.updatedAt } : item))
      }).catch((reason: unknown) => {
        setSaveState('error')
        setError(reason instanceof Error ? `Falha ao salvar: ${reason.message}` : 'Falha ao salvar o projeto.')
      })
    }, 700)
    return () => { if (savedTimer.current) clearTimeout(savedTimer.current) }
  }, [project])

  const selectedPartIds = selectedIds
  const selectedPart = project?.parts.find((part) => part.id === selectedPartIds[0]) ?? null
  const visibleParts = useMemo(() => (project?.parts ?? []).filter((part) => part.name.toLowerCase().includes(filter.toLowerCase())), [project, filter])
  const scale = project ? Math.min((stageSize.width - 48) / project.width, (stageSize.height - 48) / project.height) * zoom : 1

  const updateProject = useCallback((updater: (current: FabricatorProject) => FabricatorProject) => {
    setProject((current) => current ? { ...updater(current), updatedAt: new Date().toISOString() } : current)
  }, [])

  const selectSlot = async (slot: number) => {
    workerRef.current?.terminate(); workerRef.current = null
    setActiveSlot(slot); setProject(null); setSelectedIds([]); setError(''); dirtyAssets.current.clear(); setZoom(1)
    const summary = slots[slot - 1]
    if (!summary) return
    try {
      const loaded = await window.desktop.loadFabricatorSlot(slot)
      if (!loaded) throw new Error('O projeto salvo não pôde ser carregado.')
      setProject(loaded); setSelectedIds(loaded.parts[0] ? [loaded.parts[0].id] : [])
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Falha ao abrir modelo.') }
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
      const nextProject: FabricatorProject = {
        schemaVersion: 1, slot: metadata.slot, name: metadata.name, sourceName: metadata.sourceName,
        sourceAssetName: metadata.sourceAssetName, sourceDataUrl, width: message.width, height: message.height,
        tolerance, parts, joints: suggestJoints(parts), updatedAt: new Date().toISOString()
      }
      setProject(nextProject); setSelectedIds(parts[0] ? [parts[0].id] : [])
    }
    worker.onerror = () => { worker.terminate(); workerRef.current = null; setProcessing(false); setError('O processamento da imagem falhou.') }
    worker.postMessage({ id, sourceDataUrl, tolerance })
  }

  const importSlot = async (slot: number) => {
    if (slots[slot - 1] && !window.confirm(`Substituir o modelo do slot ${slot}? O projeto atual será trocado.`)) return
    setActiveSlot(slot); setProject(null); setSelectedIds([]); setError('')
    try {
      const selected = await window.desktop.importFabricatorModel(slot)
      if (!selected) return
      const name = selected.sourceName.replace(/\.[^.]+$/, '') || `Modelo ${slot}`
      runProcessor(selected.sourceDataUrl, 74, { slot, name, sourceName: selected.sourceName, sourceAssetName: selected.sourceAssetName })
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível importar a imagem.') }
  }

  const reprocess = () => {
    if (!project) return
    runProcessor(project.sourceDataUrl, project.tolerance, { slot: project.slot, name: project.name, sourceName: project.sourceName, sourceAssetName: project.sourceAssetName })
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
          updateProject((current) => ({ ...current, joints: [...current.joints, linkParts(parent, child)] }))
        }
        setConnectFromId(null); setConnectMode(false); setSelectedIds([partId]); return
      }
    }
    setSelectedIds((current) => toggle
      ? current.includes(partId) ? current.filter((id) => id !== partId) : [...current, partId]
      : [partId])
  }

  const updatePartPosition = (partId: string, dx: number, dy: number) => {
    updateProject((current) => ({
      ...current,
      parts: current.parts.map((part) => part.id === partId ? { ...part, x: part.x + dx, y: part.y + dy } : part),
      joints: current.joints.map((joint) => ({
        ...joint,
        ...(joint.parentPartId === partId ? { parentAnchor: { x: joint.parentAnchor.x + dx, y: joint.parentAnchor.y + dy } } : {}),
        ...(joint.childPartId === partId ? { childAnchor: { x: joint.childAnchor.x + dx, y: joint.childAnchor.y + dy } } : {})
      }))
    }))
  }

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
    const origin = joint.parentAnchor
    updateProject((current) => ({
      ...current,
      parts: current.parts.map((part) => {
        if (!affected.has(part.id)) return part
        const center = rotatePoint({ x: part.x + part.width / 2, y: part.y + part.height / 2 }, origin, amount)
        return { ...part, x: center.x - part.width / 2, y: center.y - part.height / 2, rotation: (part.rotation + amount) % 360 }
      }),
      joints: current.joints.map((item) => ({
        ...item,
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
    const dx = (event.clientX - drag.x) / scale; const dy = (event.clientY - drag.y) / scale
    updateProject((current) => ({ ...current, joints: current.joints.map((joint) => joint.id === drag.jointId ? { ...joint, [drag.side]: { x: joint[drag.side].x + dx, y: joint[drag.side].y + dy } } : joint) }))
    drag.x = event.clientX; drag.y = event.clientY
  }

  const beginAnchorDrag = (event: React.PointerEvent<SVGCircleElement>, joint: JointLink, side: 'parentAnchor' | 'childAnchor') => {
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
    anchorDragRef.current = { jointId: joint.id, side, pointerId: event.pointerId, x: event.clientX, y: event.clientY }
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
                return <button key={number} className={`model-slot${activeSlot === number ? ' active' : ''}${slot ? ' filled' : ''}`} onClick={() => void selectSlot(number)} role="tab" aria-selected={activeSlot === number} title={slot ? `${slot.name} — ${slot.partCount} peças` : `Slot ${number} vazio`} type="button">
                  <span>{slot?.name ? slot.name.slice(0, 1).toUpperCase() : String(number).padStart(2, '0')}</span><small>{slot ? slot.name : 'Vazio'}</small>
                </button>
              })}
            </div>
            <button className="model-import-compact" onClick={() => void importSlot(activeSlot)} type="button"><Icon name="plus" /><span>Importar</span></button>
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
                  <label className="model-tolerance">Chroma <input aria-label="Tolerância do chroma key" type="range" min="20" max="150" value={project.tolerance} onChange={(event) => updateProject((current) => ({ ...current, tolerance: Number(event.target.value) }))} /><span>{project.tolerance}</span></label>
                  <button className="model-tool-button" onClick={reprocess} disabled={processing} title="Refazer chroma e recortes" type="button"><Icon name="sparkles" /> Reanalisar</button>
                </div>
              </div>
              <div className="model-editor-content">
                <section className="model-canvas-column" aria-label="Prévia e montagem">
                  <div className="model-canvas-topline"><span><i /> CANVAS DE MONTAGEM</span><span>{project.width} × {project.height}</span></div>
                  <div ref={stageRef} className="model-stage" onPointerMove={(event) => { movePartDrag(event); moveAnchorDrag(event) }} onPointerUp={(event) => { if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null; if (anchorDragRef.current?.pointerId === event.pointerId) anchorDragRef.current = null }} onPointerCancel={() => { dragRef.current = null; anchorDragRef.current = null }}>
                    <div className="model-artboard" style={{ width: `${project.width * scale}px`, height: `${project.height * scale}px` }}>
                      {project.parts.map((part) => <img key={part.id} className={`model-canvas-part${selectedIds.includes(part.id) ? ' selected' : ''}${connectFromId === part.id ? ' connect-source' : ''}`} src={part.dataUrl} alt={part.name} draggable={false} onClick={(event) => { event.stopPropagation(); handlePartClick(part.id, event.ctrlKey || event.metaKey) }} onPointerDown={(event) => beginPartDrag(event, part)} style={{ left: part.x * scale, top: part.y * scale, width: part.width * scale, height: part.height * scale, transform: `rotate(${part.rotation}deg)` }} />)}
                      <svg className="model-joint-layer" viewBox={`0 0 ${project.width} ${project.height}`} preserveAspectRatio="none" aria-label="Conexões entre as peças">
                        {project.joints.map((joint) => <g key={joint.id} className={joint.suggested ? 'suggested' : ''}>
                          <line x1={joint.parentAnchor.x} y1={joint.parentAnchor.y} x2={joint.childAnchor.x} y2={joint.childAnchor.y} />
                          <circle className="model-joint-anchor" cx={joint.parentAnchor.x} cy={joint.parentAnchor.y} r={Math.max(7, 9 / scale)} onPointerDown={(event) => beginAnchorDrag(event, joint, 'parentAnchor')} />
                          <circle className="model-joint-anchor child" cx={joint.childAnchor.x} cy={joint.childAnchor.y} r={Math.max(7, 9 / scale)} onPointerDown={(event) => beginAnchorDrag(event, joint, 'childAnchor')} />
                          <text x={(joint.parentAnchor.x + joint.childAnchor.x) / 2} y={(joint.parentAnchor.y + joint.childAnchor.y) / 2 - 8 / scale}>●</text>
                        </g>)}
                      </svg>
                    </div>
                    <div className="model-stage-tools"><button onClick={() => setZoom((value) => Math.min(2.4, value + 0.15))} title="Aumentar zoom" type="button"><Icon name="zoomIn" /></button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.max(0.5, value - 0.15))} title="Diminuir zoom" type="button"><Icon name="zoomOut" /></button><button onClick={() => setZoom(1)} title="Ajustar ao espaço" type="button"><Icon name="frame" /></button></div>
                  </div>
                  <div className="model-canvas-footer"><span><kbd>Arraste</kbd> para posicionar <i /> <kbd>Ctrl</kbd> + clique para selecionar várias</span><span>{project.parts.length} peças <i /> {project.joints.length} conexões</span></div>
                </section>

                <aside className="model-parts-panel" aria-label="Peças e articulações">
                  <div className="model-parts-heading"><div><span className="model-eyebrow">BIBLIOTECA</span><h2>Peças <small>{project.parts.length}</small></h2></div><button className="model-icon-button" title="Adicionar outra folha" onClick={() => void importSlot(project.slot)} type="button"><Icon name="plus" /></button></div>
                  <label className="model-part-search"><Icon name="search" /><input placeholder="Buscar peça…" value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
                  <div className="model-part-grid">
                    {visibleParts.map((part) => <button key={part.id} className={`model-part-card${selectedIds.includes(part.id) ? ' selected' : ''}`} onClick={(event) => { handlePartClick(part.id, event.ctrlKey || event.metaKey) }} type="button" title={`${part.name} · arraste a peça no canvas para reposicionar`}>
                      <span className="model-part-thumb"><img src={part.dataUrl} alt="" /></span><span className="model-part-card-name">{part.name}</span><small>{Math.round(part.width)} × {Math.round(part.height)}</small>
                    </button>)}
                    {visibleParts.length === 0 && <p className="model-no-parts">Nenhuma peça encontrada.</p>}
                  </div>
                  <div className="model-part-actions">
                    <div className="model-action-row"><button className={`model-tool-button${connectMode ? ' active' : ''}`} onClick={() => { setConnectMode((value) => !value); setConnectFromId(null) }} type="button"><span className="model-link-dot" />{connectMode ? 'Clique em duas peças' : 'Ligar peças'}</button><button className="model-tool-button" onClick={() => updateProject((current) => ({ ...current, joints: suggestJoints(current.parts) }))} type="button">Sugerir juntas</button></div>
                    {connectMode && <p className="model-connect-hint">Selecione a peça-pai e depois a peça que ela movimenta.</p>}
                    <div className="model-joint-list">
                      <div className="model-joint-list-heading"><strong>Articulações</strong><small>{project.joints.length}</small></div>
                      {project.joints.length === 0 ? <p className="model-joint-empty">Conecte duas peças para montar o esqueleto.</p> : project.joints.map((joint) => {
                        const parent = project.parts.find((part) => part.id === joint.parentPartId); const child = project.parts.find((part) => part.id === joint.childPartId)
                        return <div className="model-joint-row" key={joint.id}><span className="model-joint-row-name"><b>{parent?.name ?? 'Peça'}</b><Icon name="chevronRight" /><b>{child?.name ?? 'Peça'}</b>{joint.suggested && <small>SUGESTÃO</small>}</span><span className="model-joint-controls"><button title="Girar para a esquerda" onClick={() => rotateBranch(joint.id, -15)} type="button">−15°</button><button title="Girar para a direita" onClick={() => rotateBranch(joint.id, 15)} type="button">+15°</button><button title="Desconectar" onClick={() => updateProject((current) => ({ ...current, joints: current.joints.filter((item) => item.id !== joint.id) }))} type="button">×</button></span></div>
                      })}
                    </div>
                    {selectedPart && <div className="model-selected-tools">
                      <div className="model-selected-name">{renamingPartId === selectedPart.id ? <input autoFocus value={selectedPart.name} onBlur={() => setRenamingPartId(null)} onChange={(event) => updateProject((current) => ({ ...current, parts: current.parts.map((part) => part.id === selectedPart.id ? { ...part, name: event.target.value } : part) }))} onKeyDown={(event) => { if (event.key === 'Enter') setRenamingPartId(null) }} /> : <><strong>{selectedPart.name}</strong><button title="Renomear peça" onClick={() => setRenamingPartId(selectedPart.id)} type="button"><Icon name="edit" /></button></>}</div>
                      <div className="model-action-row"><button className="model-tool-button" onClick={() => void splitSelected('vertical')} disabled={selectedPart.rotation !== 0 || selectedPart.width < 2} type="button">Cortar ↔</button><button className="model-tool-button" onClick={() => void splitSelected('horizontal')} disabled={selectedPart.rotation !== 0 || selectedPart.height < 2} type="button">Cortar ↕</button><button className="model-tool-button danger" onClick={() => removePart(selectedPart.id)} type="button">Excluir</button></div>
                      {selectedPartIds.length > 1 && <button className="model-merge-button" onClick={() => void mergeSelected()} type="button">Mesclar {selectedPartIds.length} peças selecionadas</button>}
                    </div>}
                    <div className="model-source-info"><span><Icon name="frame" /> Fonte</span><small title={project.sourceName}>{project.sourceName}</small></div>
                  </div>
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
