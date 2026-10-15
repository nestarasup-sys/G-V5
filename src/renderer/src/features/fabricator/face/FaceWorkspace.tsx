import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent, type WheelEvent } from 'react'
import type { FaceCrop, FaceElementKind, FacePiece, FaceSet, FaceSetSave, FaceSetSummary, FaceSheetKind, FaceTransform, FabricatorProject, FabricatorSlotSummary, ModelPart } from '../../../../../shared/fabricator'
import { Icon } from '../../../ui/components/Icon'
import { usePreviewBackground } from '../usePreviewBackground'
import './face.css'

type EyeState = 0 | 1 | 2
type WorkerPiece = Omit<FacePiece, 'dataUrl'> & { png: ArrayBuffer }
type WorkerResult = { type: 'complete'; id: number; width: number; height: number; sheetPng: ArrayBuffer; pieces: WorkerPiece[] } | { type: 'error'; id: number; message: string }
type Drag = { pointerId: number; mode: 'pan' | 'piece'; x: number; y: number; element?: FaceElementKind }

const sheetLabels: Record<FaceSheetKind, string> = { eyes: 'Olhos · 1 × 3', eyebrows: 'Sobrancelhas · par', nose: 'Nariz · 1 ou 3 × 2', 'mouth-closed': 'Bocas fechadas · 7 × 3', 'mouth-open': 'Bocas abertas · 7 × 3' }
const sheetKinds: FaceSheetKind[] = ['eyes', 'eyebrows', 'nose', 'mouth-closed', 'mouth-open']
const elementLabels: Record<FaceElementKind, string> = { 'eye-left': 'Olho esquerdo', 'eye-right': 'Olho direito', 'brow-left': 'Sobrancelha esquerda', 'brow-right': 'Sobrancelha direita', nose: 'Nariz', mouth: 'Boca' }
const eyeLabels = ['Direita', 'Esquerda', 'Fechado']
const sheetSelection: Record<FaceSheetKind, FaceElementKind> = { eyes: 'eye-left', eyebrows: 'brow-left', nose: 'nose', 'mouth-closed': 'mouth', 'mouth-open': 'mouth' }

function isSheetSelected(kind: FaceSheetKind, element: FaceElementKind, mouthOpen: boolean): boolean {
  if (kind === 'eyes') return element.startsWith('eye')
  if (kind === 'eyebrows') return element.startsWith('brow')
  if (kind === 'nose') return element === 'nose'
  return element === 'mouth' && mouthOpen === (kind === 'mouth-open')
}

function toDataUrl(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return `data:image/png;base64,${btoa(binary)}`
}

function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Arquivo inválido.'))
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'))
    reader.readAsDataURL(file)
  })
}

function processSheet(kind: FaceSheetKind, sourceDataUrl: string, tolerance: number, crops: Record<string, FaceCrop>, noseMode: 'auto' | 'one' | 'six'): Promise<{ width: number; height: number; sourcePng: string; pieces: FacePiece[] }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./faceProcessor.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<WorkerResult>) => {
      worker.terminate()
      if (data.type === 'error') { reject(new Error(data.message)); return }
      resolve({ width: data.width, height: data.height, sourcePng: toDataUrl(data.sheetPng), pieces: data.pieces.map(({ png, ...piece }) => ({ ...piece, dataUrl: toDataUrl(png) })) })
    }
    worker.onerror = () => { worker.terminate(); reject(new Error('Falha ao processar a folha.')) }
    worker.postMessage({ id: 1, kind, sourceDataUrl, tolerance, crops, noseMode })
  })
}

function headPart(project: FabricatorProject | null): ModelPart | null {
  if (!project) return null
  return project.parts.find((part) => /cabe[çc]a|head/i.test(part.name)) ?? null
}

function initialTransforms(head: ModelPart): FaceSet['transforms'] {
  const point = (x: number, y: number): FaceTransform => ({ x: head.width * x, y: head.height * y, scaleX: .25, scaleY: .25, rotation: 0 })
  return { 'eye-left': point(.37, .45), 'eye-right': point(.63, .45), 'brow-left': point(.37, .32), 'brow-right': point(.63, .32), nose: point(.5, .61), mouth: point(.5, .78) }
}

function emptyFace(modelSlot: number, head: ModelPart): FaceSet {
  return { schemaVersion: 1, id: crypto.randomUUID(), modelSlot, name: `Rosto ${new Date().toLocaleDateString('pt-BR')}`, sheets: {}, pieces: [], transforms: initialTransforms(head), eyeLinked: true, browLinked: true, selectedNose: 0, selectedExpression: 0, updatedAt: new Date().toISOString() }
}

function fitImportedElement(transforms: FaceSet['transforms'], head: ModelPart, kind: FaceSheetKind, pieces: FacePiece[]): FaceSet['transforms'] {
  const first = pieces[0]
  if (!first) return transforms
  const targetRatio = kind === 'eyes' ? .17 : kind === 'eyebrows' ? .16 : kind === 'nose' ? .075 : .2
  const scale = clamp(head.width * targetRatio / first.width, .04, 4)
  const next = { ...transforms }
  const elements: FaceElementKind[] = kind === 'eyes' ? ['eye-left', 'eye-right'] : kind === 'eyebrows' ? ['brow-left', 'brow-right'] : kind === 'nose' ? ['nose'] : ['mouth']
  for (const element of elements) next[element] = { ...next[element], scaleX: scale, scaleY: scale }
  return next
}

function activePiece(set: FaceSet, element: FaceElementKind, eyeState: EyeState, mouthOpen: boolean): FacePiece | undefined {
  const sheet: FaceSheetKind = element.startsWith('eye') ? 'eyes' : element.startsWith('brow') ? 'eyebrows' : element === 'nose' ? 'nose' : mouthOpen ? 'mouth-open' : 'mouth-closed'
  const index = sheet === 'eyes' ? eyeState : sheet === 'nose' ? set.selectedNose : sheet.startsWith('mouth') ? set.selectedExpression : 0
  const side = element.endsWith('left') ? 'left' : element.endsWith('right') ? 'right' : undefined
  return set.pieces.find((piece) => piece.sheet === sheet && piece.index === index && piece.side === side)
}

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)) }

export function FaceWorkspace() {
  const [models, setModels] = useState<FabricatorSlotSummary[]>([])
  const [modelSlot, setModelSlot] = useState(1)
  const [model, setModel] = useState<FabricatorProject | null>(null)
  const [library, setLibrary] = useState<FaceSetSummary[]>([])
  const [draft, setDraft] = useState<FaceSet | null>(null)
  const [selected, setSelected] = useState<FaceElementKind>('eye-left')
  const [eyeState, setEyeState] = useState<EyeState>(0)
  const [mouthOpen, setMouthOpen] = useState(false)
  const [showAllEyes, setShowAllEyes] = useState(false)
  const [cropDraft, setCropDraft] = useState<FaceCrop | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [background] = usePreviewBackground()
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [noseMode, setNoseMode] = useState<'auto' | 'one' | 'six'>('auto')
  const [toleranceDraft, setToleranceDraft] = useState(42)
  const drag = useRef<Drag | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const head = useMemo(() => headPart(model), [model])
  const selectedPiece = draft ? activePiece(draft, selected, eyeState, mouthOpen) : undefined

  useEffect(() => {
    let active = true
    void window.desktop.listFabricatorSlots().then((slots) => {
      if (!active) return
      setModels(slots)
      const first = slots.findIndex(Boolean)
      if (first >= 0) setModelSlot(first + 1)
    }).catch((reason) => setError(String(reason)))
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    setModel(null); setLibrary([]); setDraft(null); setDirty(false); setError('')
    void Promise.all([window.desktop.loadFabricatorSlot(modelSlot), window.desktop.listFaceSets(modelSlot)]).then(([project, sets]) => {
      if (!active) return
      setModel(project); setLibrary(sets)
    }).catch((reason) => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [modelSlot])

  useEffect(() => { setCropDraft(selectedPiece ? { ...selectedPiece.crop } : null) }, [selectedPiece?.id, draft?.sheets[selectedPiece?.sheet ?? 'eyes']?.tolerance])
  useEffect(() => { if (selectedPiece) setToleranceDraft(draft?.sheets[selectedPiece.sheet]?.tolerance ?? 42) }, [selectedPiece?.sheet, draft?.id])

  function changeModel(slot: number) {
    if (slot === modelSlot || dirty && !window.confirm('Descartar alterações não salvas deste rosto?')) return
    setModelSlot(slot)
  }

  function create() {
    if (!head || dirty && !window.confirm('Descartar alterações não salvas deste rosto?')) return
    setDraft(emptyFace(modelSlot, head)); setDirty(false); setSelected('eye-left'); setEyeState(0); setNoseMode('auto'); setNotice('Novo rosto. Importe uma folha para começar.')
  }

  async function open(id: string) {
    if (dirty && !window.confirm('Descartar alterações não salvas deste rosto?')) return
    setBusy(true); setError('')
    try {
      const loaded = await window.desktop.loadFaceSet(modelSlot, id)
      if (!loaded) throw new Error('Rosto não encontrado.')
      setDraft(loaded); setDirty(false); setSelected('eye-left'); setEyeState(0); setMouthOpen(false); setNoseMode('auto')
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }

  function changeDraft(update: (current: FaceSet) => FaceSet) {
    setDraft((current) => current ? update(current) : current)
    setDirty(true); setNotice('Alterações não salvas')
  }

  async function importSheet(kind: FaceSheetKind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !head) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { setError('Use PNG, JPG ou WebP.'); return }
    setBusy(true); setError(''); setNotice(`Recortando ${sheetLabels[kind]}…`)
    try {
      const source = await fileDataUrl(file)
      const processed = await processSheet(kind, source, 42, {}, noseMode)
      const base = draft ?? emptyFace(modelSlot, head)
      const next: FaceSet = { ...base, sheets: { ...base.sheets, [kind]: { kind, name: file.name, width: processed.width, height: processed.height, tolerance: 42, dataUrl: processed.sourcePng } }, pieces: [...base.pieces.filter((piece) => piece.sheet !== kind), ...processed.pieces], transforms: base.sheets[kind] ? base.transforms : fitImportedElement(base.transforms, head, kind, processed.pieces), selectedNose: kind === 'nose' ? 0 : base.selectedNose }
      setDraft(next); setDirty(true); setNotice(`${processed.pieces.length} recortes prontos em ${sheetLabels[kind]}.`)
      setSelected(kind === 'eyes' ? 'eye-left' : kind === 'eyebrows' ? 'brow-left' : kind === 'nose' ? 'nose' : 'mouth')
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }

  function selectSheet(kind: FaceSheetKind) {
    if (!head || busy) return
    if (!draft) { setDraft(emptyFace(modelSlot, head)); setDirty(false) }
    setSelected(sheetSelection[kind])
    if (kind === 'eyes') setEyeState(0)
    if (kind === 'mouth-closed') setMouthOpen(false)
    if (kind === 'mouth-open') setMouthOpen(true)
    setNotice(draft?.sheets[kind] ? `${sheetLabels[kind]} selecionada. Arraste a peça na prévia para ajustar.` : `Selecione a peça na prévia; use Importar para escolher uma folha.`)
  }

  async function recut(kind: FaceSheetKind, tolerance: number, updatedCrop?: FaceCrop, mode: 'auto' | 'one' | 'six' = noseMode) {
    const sheet = draft?.sheets[kind]
    if (!sheet || !draft) return
    if (updatedCrop && (!Object.values(updatedCrop).every(Number.isFinite) || updatedCrop.x < 0 || updatedCrop.y < 0 || updatedCrop.width < 1 || updatedCrop.height < 1 || updatedCrop.x + updatedCrop.width > sheet.width || updatedCrop.y + updatedCrop.height > sheet.height)) {
      setError('O recorte precisa ficar dentro da folha original.')
      return
    }
    setBusy(true); setError('')
    try {
      const oldCount = draft.pieces.filter((piece) => piece.sheet === kind).length
      const effectiveMode = kind === 'nose' && mode === 'auto' ? oldCount === 6 ? 'six' : oldCount === 1 ? 'one' : 'auto' : mode
      const changedNoseLayout = kind === 'nose' && (effectiveMode === 'one' && oldCount === 6 || effectiveMode === 'six' && oldCount === 1)
      const crops = changedNoseLayout ? {} : Object.fromEntries(draft.pieces.filter((piece) => piece.sheet === kind).map((piece) => [piece.id, piece.crop])) as Record<string, FaceCrop>
      if (updatedCrop && selectedPiece?.sheet === kind) crops[selectedPiece.id] = updatedCrop
      const processed = await processSheet(kind, sheet.dataUrl, tolerance, crops, effectiveMode)
      changeDraft((current) => ({ ...current, sheets: { ...current.sheets, [kind]: { ...sheet, tolerance } }, pieces: [...current.pieces.filter((piece) => piece.sheet !== kind), ...processed.pieces], selectedNose: kind === 'nose' ? 0 : current.selectedNose }))
      setNotice('Recortes atualizados. Revise a prévia antes de salvar.')
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }

  function updateTransform(element: FaceElementKind, patch: Partial<FaceTransform>) {
    changeDraft((current) => {
      const previous = current.transforms[element]
      const next = { ...previous, ...patch }
      const transforms = { ...current.transforms, [element]: next }
      const linked = element.startsWith('eye') ? current.eyeLinked : element.startsWith('brow') ? current.browLinked : false
      if (linked) {
        const partner = element.endsWith('left') ? element.replace('left', 'right') as FaceElementKind : element.replace('right', 'left') as FaceElementKind
        const other = current.transforms[partner]
        transforms[partner] = { x: other.x + next.x - previous.x, y: other.y + next.y - previous.y, scaleX: other.scaleX * next.scaleX / previous.scaleX, scaleY: other.scaleY * next.scaleY / previous.scaleY, rotation: other.rotation + next.rotation - previous.rotation }
      }
      return { ...current, transforms }
    })
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>, element?: FaceElementKind) {
    if (!head) return
    const movingElement = element ? selected : undefined
    if (movingElement && (!draft || !activePiece(draft, movingElement, eyeState, mouthOpen))) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, mode: movingElement ? 'piece' : 'pan', x: event.clientX, y: event.clientY, element: movingElement }
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId || !head) return
    const dx = event.clientX - current.x, dy = event.clientY - current.y
    drag.current = { ...current, x: event.clientX, y: event.clientY }
    if (current.mode === 'pan') setPan((previous) => ({ x: previous.x + dx, y: previous.y + dy }))
    else if (current.element && draft) {
      const pixelsPerHeadPixel = (stageRef.current?.getBoundingClientRect().width ?? head.width) / head.width
      const element = current.element
      changeDraft((value) => {
        const transform = value.transforms[element]
        const partner = element.endsWith('left') ? element.replace('left', 'right') as FaceElementKind : element.replace('right', 'left') as FaceElementKind
        const linked = element.startsWith('eye') ? value.eyeLinked : element.startsWith('brow') ? value.browLinked : false
        return { ...value, transforms: { ...value.transforms, [element]: { ...transform, x: transform.x + dx / pixelsPerHeadPixel, y: transform.y + dy / pixelsPerHeadPixel }, ...(linked ? { [partner]: { ...value.transforms[partner], x: value.transforms[partner].x + dx / pixelsPerHeadPixel, y: value.transforms[partner].y + dy / pixelsPerHeadPixel } } : {}) } }
      })
    }
  }

  function pointerUp(event: PointerEvent<HTMLDivElement>) { if (drag.current?.pointerId === event.pointerId) drag.current = null }
  function wheel(event: WheelEvent<HTMLDivElement>) { event.preventDefault(); setZoom((value) => clamp(value * (event.deltaY < 0 ? 1.1 : .9), .5, 4)) }

  async function save() {
    if (!draft) return
    setBusy(true); setError('')
    try {
      const set = { ...draft, updatedAt: new Date().toISOString() }
      const serialized: FaceSetSave = { ...set, sheets: Object.fromEntries(Object.entries(set.sheets).map(([kind, { dataUrl: _dataUrl, ...sheet }]) => [kind, sheet])), pieces: set.pieces.map(({ dataUrl: _dataUrl, ...piece }) => piece) }
      const assets = [...Object.entries(set.sheets).map(([kind, sheet]) => ({ id: `sheet-${kind}`, dataUrl: sheet.dataUrl })), ...set.pieces.map((piece) => ({ id: piece.id, dataUrl: piece.dataUrl }))]
      await window.desktop.saveFaceSet(modelSlot, serialized, assets)
      setDraft(set); setLibrary(await window.desktop.listFaceSets(modelSlot)); setDirty(false); setNotice('Rosto salvo neste dispositivo.')
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }

  async function remove() {
    if (!draft || !library.some((set) => set.id === draft.id) || !window.confirm(`Excluir permanentemente “${draft.name}”?`)) return
    setBusy(true); setError('')
    try {
      await window.desktop.deleteFaceSet(modelSlot, draft.id)
      setDraft(null); setDirty(false); setLibrary(await window.desktop.listFaceSets(modelSlot)); setNotice('Rosto excluído.')
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }

  function renderLayer(element: FaceElementKind, state: EyeState, interactive: boolean) {
    if (!draft || !head) return null
    const piece = activePiece(draft, element, state, mouthOpen)
    if (!piece) return null
    const transform = draft.transforms[element]
    return <img key={`${element}-${state}`} className={`face-layer${interactive && selected === element ? ' selected' : ''}`} src={piece.dataUrl} alt={elementLabels[element]} draggable={false} onPointerDown={interactive ? (event) => { event.stopPropagation(); pointerDown(event as unknown as PointerEvent<HTMLDivElement>, selected) } : undefined} style={{ left: `${transform.x / head.width * 100}%`, top: `${transform.y / head.height * 100}%`, width: `${piece.width * transform.scaleX / head.width * 100}%`, height: `${piece.height * transform.scaleY / head.height * 100}%`, transform: `translate(-50%, -50%) rotate(${transform.rotation}deg)`, pointerEvents: interactive ? 'auto' : 'none' }} />
  }

  function renderHead(state: EyeState, interactive: boolean) {
    if (!head) return null
    return <div className={`face-head-stage${interactive ? ' interactive' : ''}`} ref={interactive ? stageRef : undefined} style={{ aspectRatio: `${head.width} / ${head.height}` }}>
      <img className="face-head-base" src={head.dataUrl} alt="Cabeça do modelo selecionado" draggable={false} />
      {(['brow-left', 'brow-right', 'eye-left', 'eye-right', 'nose', 'mouth'] as FaceElementKind[]).map((element) => renderLayer(element, state, interactive))}
    </div>
  }

  const currentSheet = selectedPiece?.sheet
  return <section className="fabricator-workspace face-workspace" aria-label="Editor de rostos">
    <header className="face-toolbar"><span className="face-toolbar-title"><Icon name="face" /><span><strong>Rosto</strong><small>Biblioteca independente por modelo</small></span></span><label>Modelo de referência<select value={modelSlot} disabled={busy} onChange={(event) => changeModel(Number(event.target.value))}>{models.map((entry, index) => entry && <option key={index + 1} value={index + 1}>Modelo {String(index + 1).padStart(2, '0')} · {entry.name}</option>)}</select></label><button onClick={create} disabled={!head || busy} type="button"><Icon name="plus" /> Novo rosto</button><button className="primary" onClick={() => void save()} disabled={!draft || busy || !dirty} type="button"><Icon name="check" /> Salvar</button></header>
    <div className="face-body">
      <aside className="face-library"><header><strong>Rostos do modelo</strong><small>{library.length} salvos</small></header><div className="face-library-list">{library.map((item) => <button key={item.id} className={draft?.id === item.id ? 'active' : ''} onClick={() => void open(item.id)} disabled={busy} type="button"><Icon name="face" /><span>{item.name}</span><small>{item.pieceCount}</small></button>)}{!library.length && <p>Crie o primeiro rosto deste modelo.</p>}</div><div className="face-sheet-list"><strong>Folhas</strong>{sheetKinds.map((kind) => { const active = isSheetSelected(kind, selected, mouthOpen); return <div key={kind} className={`face-sheet-card${draft?.sheets[kind] ? ' ready' : ''}${active ? ' selected' : ''}`}><button className="face-sheet-select" aria-pressed={active} onClick={() => selectSheet(kind)} disabled={busy || !head} type="button"><span>{sheetLabels[kind]}</span><small>{active ? `Selecionada · ${elementLabels[sheetSelection[kind]]}` : draft?.sheets[kind] ? 'Pronta' : 'Não importada'}</small></button><label className="face-sheet-change" title={`${draft?.sheets[kind] ? 'Trocar' : 'Importar'} apenas ${sheetLabels[kind].toLowerCase()}`}><span>{draft?.sheets[kind] ? 'Trocar' : 'Importar'}</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void importSheet(kind, event)} disabled={busy || !head} /></label></div>})}</div></aside>
      <div className="face-preview-column"><div className="face-preview-header"><strong>PRÉVIA DA CABEÇA</strong><span>{head ? `${Math.round(head.width)} × ${Math.round(head.height)}` : 'Selecione um modelo com cabeça'}</span></div><div className="face-preview-tools"><div className="face-segment" aria-label="Estado dos olhos">{eyeLabels.map((label, index) => <button key={label} className={eyeState === index ? 'active' : ''} onClick={() => setEyeState(index as EyeState)} type="button">{label}</button>)}</div><button className={showAllEyes ? 'active' : ''} onClick={() => setShowAllEyes((value) => !value)} type="button">{showAllEyes ? 'Ocultar comparação' : 'Ver os 3 olhos'}</button><button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} type="button"><Icon name="frame" /> Centralizar</button></div><div className="face-viewport" style={{ backgroundColor: background }} onPointerDown={(event) => { if (event.target === event.currentTarget) pointerDown(event) }} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onWheel={wheel}><div className="face-stage-zoom" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} onPointerDown={(event) => { if (event.target === event.currentTarget || (event.target as HTMLElement).classList.contains('face-head-base')) pointerDown(event) }}>{renderHead(eyeState, true)}</div>{!head && <p className="face-preview-empty">Este modelo ainda não tem uma peça chamada Cabeça.</p>}</div><div className="face-preview-footer"><span>Arraste o elemento selecionado para mover · arraste o fundo para mover a prévia · roda para zoom</span><span>{Math.round(zoom * 100)}%</span></div>{showAllEyes && head && <div className="face-comparison">{eyeLabels.map((label, index) => <div key={label}><strong>{label}</strong>{renderHead(index as EyeState, false)}</div>)}</div>}</div>
      <aside className="face-controls"><header><strong>Editar rosto</strong>{draft && <button className="danger" onClick={() => void remove()} disabled={busy} title="Excluir rosto salvo" type="button"><Icon name="trash" /></button>}</header>{draft ? <><label className="face-field">Nome do rosto<input value={draft.name} onChange={(event) => changeDraft((current) => ({ ...current, name: event.target.value }))} maxLength={80} /></label><div className="face-control-group"><strong>Elemento</strong><div className="face-element-grid">{(Object.keys(elementLabels) as FaceElementKind[]).map((element) => <button key={element} className={selected === element ? 'active' : ''} onClick={() => setSelected(element)} type="button">{elementLabels[element]}</button>)}</div></div>{(selected.startsWith('eye') || selected.startsWith('brow')) && <label className="face-check"><input type="checkbox" checked={selected.startsWith('eye') ? draft.eyeLinked : draft.browLinked} onChange={(event) => changeDraft((current) => selected.startsWith('eye') ? { ...current, eyeLinked: event.target.checked } : { ...current, browLinked: event.target.checked })} /> Mover e dimensionar o par junto</label>}{selected === 'nose' && draft.pieces.some((piece) => piece.sheet === 'nose') && <><label className="face-field">Nariz<select value={draft.selectedNose} onChange={(event) => changeDraft((current) => ({ ...current, selectedNose: Number(event.target.value) }))}>{draft.pieces.filter((piece) => piece.sheet === 'nose').map((piece) => <option key={piece.id} value={piece.index}>Variante {piece.index + 1}</option>)}</select></label><label className="face-field">Formato da folha<select value={draft.pieces.filter((piece) => piece.sheet === 'nose').length === 6 ? 'six' : 'one'} onChange={(event) => { setNoseMode(event.target.value as 'one' | 'six'); void recut('nose', draft.sheets.nose?.tolerance ?? 42, undefined, event.target.value as 'one' | 'six') }}><option value="one">Um nariz</option><option value="six">Seis narizes · 3 × 2</option></select></label></>}{selected === 'mouth' && <><label className="face-field">Expressão<select value={draft.selectedExpression} onChange={(event) => changeDraft((current) => ({ ...current, selectedExpression: Number(event.target.value) }))}>{Array.from({ length: 21 }, (_, index) => <option key={index} value={index}>Expressão {String(index + 1).padStart(2, '0')}</option>)}</select></label><div className="face-segment"><button className={!mouthOpen ? 'active' : ''} onClick={() => setMouthOpen(false)} type="button">Fechada</button><button className={mouthOpen ? 'active' : ''} onClick={() => setMouthOpen(true)} type="button">Aberta</button></div></>}
      <div className="face-control-group"><strong>Encaixe · {elementLabels[selected]}</strong><div className="face-number-grid">{(['x', 'y', 'scaleX', 'scaleY', 'rotation'] as const).map((field) => <label key={field}>{({ x: 'Posição X', y: 'Posição Y', scaleX: 'Largura %', scaleY: 'Altura %', rotation: 'Rotação °' })[field]}<input type="number" step={field.startsWith('scale') ? 1 : 1} value={field.startsWith('scale') ? Math.round(draft.transforms[selected][field] * 100) : Math.round(draft.transforms[selected][field] * 10) / 10} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) updateTransform(selected, { [field]: field.startsWith('scale') ? clamp(value / 100, .01, 10) : value }) }} /></label>)}</div><div className="face-nudge"><button onClick={() => updateTransform(selected, { x: draft.transforms[selected].x - 1 })} type="button">←</button><button onClick={() => updateTransform(selected, { y: draft.transforms[selected].y - 1 })} type="button">↑</button><button onClick={() => updateTransform(selected, { y: draft.transforms[selected].y + 1 })} type="button">↓</button><button onClick={() => updateTransform(selected, { x: draft.transforms[selected].x + 1 })} type="button">→</button></div></div>
      {currentSheet && draft.sheets[currentSheet] && <div className="face-control-group"><strong>Recorte e chroma</strong><small>{draft.sheets[currentSheet]?.name}</small>{cropDraft && <div className="face-sheet-preview"><img src={draft.sheets[currentSheet]!.dataUrl} alt="Folha original para revisar o recorte" /><span style={{ left: `${cropDraft.x / draft.sheets[currentSheet]!.width * 100}%`, top: `${cropDraft.y / draft.sheets[currentSheet]!.height * 100}%`, width: `${cropDraft.width / draft.sheets[currentSheet]!.width * 100}%`, height: `${cropDraft.height / draft.sheets[currentSheet]!.height * 100}%` }} /></div>}<label className="face-field">Remoção do fundo · {toleranceDraft}<input type="range" min="0" max="180" value={toleranceDraft} onChange={(event) => setToleranceDraft(Number(event.target.value))} /></label><button onClick={() => void recut(currentSheet, toleranceDraft)} disabled={busy} type="button">Aplicar chroma e recortar</button>{cropDraft && <><div className="face-number-grid">{(['x', 'y', 'width', 'height'] as const).map((field) => <label key={field}>{({ x: 'Recorte X', y: 'Recorte Y', width: 'Largura', height: 'Altura' })[field]}<input type="number" min={field === 'width' || field === 'height' ? 1 : 0} value={Math.round(cropDraft[field])} onChange={(event) => setCropDraft((current) => current ? { ...current, [field]: Number(event.target.value) } : current)} /></label>)}</div><button onClick={() => { if (cropDraft) void recut(currentSheet, toleranceDraft, cropDraft) }} disabled={busy} type="button">Aplicar recorte manual</button></>}</div>}</> : <p className="face-controls-empty">Escolha um rosto salvo ou clique em Novo rosto. Depois importe as folhas e ajuste cada elemento sobre a cabeça.</p>}</aside>
    </div>{error && <div className="face-status error" role="alert">{error}</div>}{notice && <div className="face-status" role="status">{notice}</div>}
  </section>
}
