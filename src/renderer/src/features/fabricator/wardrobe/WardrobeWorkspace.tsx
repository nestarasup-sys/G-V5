import { useCallback, useEffect, useRef, useState } from 'react'
import type { FabricatorProject, FabricatorSlotSummary, WardrobeCategory, WardrobeComponent, WardrobeSet, WardrobeSetSave, WardrobeSetSummary } from '../../../../../shared/fabricator'
import { Icon } from '../../../ui/components/Icon'

type WorkerPiece = Omit<WardrobeComponent, 'category' | 'attachedPartId' | 'rotation' | 'dataUrl'> & { png: ArrayBuffer }
type WorkerMessage = { type: 'complete'; id: number; width: number; height: number; pieces: WorkerPiece[] } | { type: 'error'; id: number; message: string }
type ReferenceMessage = { type: 'complete'; id: number; png: ArrayBuffer } | { type: 'error'; id: number; message: string }
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
function guessBone(category: WardrobeCategory, x: number, width: number, model: FabricatorProject): FabricatorProject['parts'][number] | undefined {
  const side = x < width / 2 ? 'left' : 'right'
  const target = category === 'camisa' ? { x: .5, y: .36 }
    : category === 'shorts' ? { x: .5, y: .42 }
      : category === 'manga-superior' ? { x: side === 'left' ? .27 : .73, y: .27 }
        : category === 'manga-inferior' ? { x: side === 'left' ? .22 : .78, y: .45 }
          : category === 'calca-coxa' ? { x: side === 'left' ? .42 : .58, y: .58 }
            : { x: side === 'left' ? .38 : .62, y: .82 }
  const candidates = model.parts.filter((part) => {
    const centerX = (part.x + part.width / 2) / model.width
    return category === 'camisa' || category === 'shorts' ? centerX > .3 && centerX < .7 : side === 'left' ? centerX < .5 : centerX >= .5
  })
  const distance = (part: FabricatorProject['parts'][number]) => {
    const dx = (part.x + part.width / 2) / model.width - target.x
    const dy = (part.y + part.height / 2) / model.height - target.y
    return dx * dx + dy * dy * 1.5
  }
  return candidates.sort((a, b) => distance(a) - distance(b))[0] ?? model.parts[0]
}
function alignComponentToPart(component: WardrobeComponent, part: FabricatorProject['parts'][number] | undefined): WardrobeComponent {
  if (!part) return component
  return { ...component, x: part.x + part.width / 2 - component.width / 2, y: part.y + part.height / 2 - component.height / 2 }
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
  const inputRef = useRef<HTMLInputElement>(null)
  const workerRef = useRef<Worker | null>(null)
  const requestRef = useRef(0)
  const previewRef = useRef<HTMLDivElement>(null)
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 })
  const [referencePreview, setReferencePreview] = useState<{ sourceDataUrl: string; imageDataUrl: string } | null>(null)
  const selected = draft?.components.find((component) => component.id === selectedId) ?? null
  const selectedIndex = draft?.components.findIndex((component) => component.id === selectedId) ?? -1
  const scale = model && previewSize.width && previewSize.height ? Math.min((previewSize.width - 48) / model.width, (previewSize.height - 48) / model.height) * zoom : 1

  const reload = useCallback(async (targetSlot: number) => {
    setError('')
    try {
      const [savedModels, reference, library] = await Promise.all([window.desktop.listFabricatorSlots(), window.desktop.loadFabricatorSlot(targetSlot), window.desktop.listWardrobeSets(targetSlot)])
      const firstAvailableModel = savedModels.find((slot) => slot)
      if (!reference && firstAvailableModel && firstAvailableModel.slot !== targetSlot) { setModels(savedModels); setModelSlot(firstAvailableModel.slot); return }
      setModels(savedModels); setModel(reference); setSets(library)
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
        const offsetX = (model.width - message.width) / 2
        const offsetY = (model.height - message.height) / 2
        const components = message.pieces.map((piece) => {
          const category = guessCategory(piece, message.width, message.height)
          const { png, ...metadata } = piece
          const centeredOnCanvas = { ...metadata, x: metadata.x + offsetX, y: metadata.y + offsetY }
          const bone = guessBone(category, piece.x + piece.width / 2, message.width, model)
          const positioned = alignComponentToPart({ ...centeredOnCanvas, category, attachedPartId: bone?.id ?? '', rotation: 0, dataUrl: dataUrl(png) }, bone)
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

  return <section className="fabricator-workspace wardrobe-workspace" aria-label="Biblioteca de roupas">
    <header className="wardrobe-toolbar">
      <div className="wardrobe-title"><span className="model-slot-logo"><Icon name="shirt" /></span><span><strong>Roupas</strong><small>Biblioteca independente por modelo</small></span></div>
      <label className="wardrobe-model-select">Modelo<select value={modelSlot} onChange={(event) => { if (dirty && !window.confirm('Há alterações não salvas. Descartar e trocar de modelo?')) return; setModelSlot(Number(event.target.value)) }}>{models.map((item, index) => <option key={index + 1} value={index + 1} disabled={!item}>{String(index + 1).padStart(2, '0')} · {item?.name ?? 'Vazio'}</option>)}</select></label>
      {draft && <input aria-label="Nome do conjunto" className="wardrobe-name-input" value={draft.name} onChange={(event) => { setDirty(true); setDraft((current) => current ? { ...current, name: event.target.value } : current) }} placeholder="Nome do conjunto" />}
      <div className="wardrobe-toolbar-actions"><span className={`wardrobe-save-state${dirty ? ' pending' : ''}`}><i />{dirty ? 'Alterações não salvas' : model ? `${model.parts.length} peças no modelo` : 'Escolha um modelo salvo'}</span><button className="pose-button secondary" disabled={!model || processing} onClick={() => { if (dirty && !window.confirm('Descartar as alterações atuais e importar outra folha?')) return; inputRef.current?.click() }} type="button"><Icon name="plus" /> Importar folha</button><button className="pose-button primary" disabled={!draft || saving} onClick={() => void save()} type="button"><Icon name="check" />{saving ? 'Salvando…' : activeSetId ? 'Salvar alterações' : 'Salvar conjunto'}</button>{activeSetId && <button className="pose-icon-button" title="Excluir conjunto" onClick={() => void deleteSet()} type="button"><Icon name="trash" /></button>}<input ref={inputRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { void importSheet(event.target.files?.[0]); event.currentTarget.value = '' }} /></div>
    </header>
    {error && <div className="wardrobe-error" role="alert">{error}<button onClick={() => setError('')} type="button">Fechar</button></div>}
    <div className="wardrobe-body">
      <aside className="wardrobe-library"><header><span><strong>Conjuntos</strong><small>{sets.length} salvos para este modelo</small></span><span className="wardrobe-count">{sets.length}</span></header><div className="wardrobe-set-list">{sets.map((set) => <button className={`wardrobe-set-row${activeSetId === set.id ? ' active' : ''}`} key={set.id} onClick={() => void openSet(set.id)} type="button"><span className="wardrobe-set-icon"><Icon name="shirt" /></span><span><b>{set.name}</b><small>{set.componentCount} peças</small></span><Icon name="chevronRight" /></button>)}{!sets.length && <div className="wardrobe-library-empty"><Icon name="box" /><span>Nenhum conjunto salvo.<br />Importe sua primeira folha.</span></div>}</div><div className="wardrobe-category-legend"><strong>Categorias</strong>{categories.map((category) => <span key={category}><i />{categoryNames[category]}</span>)}</div></aside>
      <section className="wardrobe-preview-card"><header><span><i /> PRÉVIA DE ENCAIXE · FOLHA ORIGINAL</span><span>{model ? `${model.width} × ${model.height}` : 'Sem modelo'}</span></header><div ref={previewRef} className="wardrobe-preview-stage">{model && <div className="wardrobe-artboard" style={{ width: model.width * scale, height: model.height * scale }}>
        {referencePreview?.sourceDataUrl === model.sourceDataUrl && <img className="wardrobe-base-image" src={referencePreview.imageDataUrl} alt={`Folha original desmontada do modelo ${model.name}`} title="Referência original desmontada com chroma key; o modelo salvo não será alterado" style={{ left: 0, top: 0, width: model.width * scale, height: model.height * scale, zIndex: 1 }} />}
        {draft?.components.map((component, index) => <img key={component.id} className={`wardrobe-preview-part${component.id === selectedId ? ' selected' : ''}`} src={component.dataUrl} alt={component.name} title={`${component.name} · ${categoryNames[component.category]}`} onClick={() => setSelectedId(component.id)} style={{ left: component.x * scale, top: component.y * scale, width: component.width * scale, height: component.height * scale, zIndex: index + 2, transform: `rotate(${component.rotation}deg)` }} />)}
      </div>}{!model && <div className="wardrobe-empty"><Icon name="shirt" /><strong>Selecione um modelo salvo</strong><small>O modelo será usado como guia na prévia de encaixe.</small></div>}{model && !draft && <div className="wardrobe-stage-hint">Importe uma folha para começar · fundo transparente preservado</div>}<div className="wardrobe-zoom"><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.min(2.2, value + .1))} type="button">+</button><button onClick={() => setZoom((value) => Math.max(.55, value - .1))} type="button">−</button></div>{processing && <div className="wardrobe-processing"><span className="model-spinner" />Detectando peças transparentes…</div>}</div><footer>Pré-encaixe pelo centro da peça do modelo, preservando o tamanho do recorte. Revise e ajuste antes de salvar.</footer></section>
      <aside className="wardrobe-edit-panel"><header><span><strong>Peças do conjunto</strong><small>{draft ? `${draft.components.length} partes detectadas` : 'Recortes automáticos'}</small></span>{draft && <span className="wardrobe-count">{draft.components.length}</span>}</header>
        {draft ? <><div className="wardrobe-component-list">{draft.components.map((component) => <button key={component.id} className={`wardrobe-component-row${selectedId === component.id ? ' active' : ''}`} onClick={() => setSelectedId(component.id)} type="button"><img src={component.dataUrl} alt="" /><span><b>{component.name}</b><small>{categoryNames[component.category]}</small></span></button>)}</div>{selected && <div className="wardrobe-fields"><div className="wardrobe-field-title"><strong>Ajustar recorte · camada {selectedIndex + 1}</strong><button title="Subir camada" aria-label="Subir camada" disabled={selectedIndex === (draft?.components.length ?? 0) - 1} onClick={() => moveComponentLayer(selected.id, 1)} type="button">↑</button><button title="Descer camada" aria-label="Descer camada" disabled={selectedIndex <= 0} onClick={() => moveComponentLayer(selected.id, -1)} type="button">↓</button><button title="Remover esta peça do conjunto" onClick={() => { setDraft((current) => current ? { ...current, components: current.components.filter((component) => component.id !== selected.id) } : current); setSelectedId(draft.components.find((component) => component.id !== selected.id)?.id ?? null); setDirty(true) }} type="button"><Icon name="trash" /></button></div><label>Nome<input value={selected.name} onChange={(event) => updateComponent(selected.id, { name: event.target.value })} /></label><label>Categoria<select value={selected.category} onChange={(event) => updateComponent(selected.id, { category: event.target.value as WardrobeCategory })}>{categories.map((category) => <option key={category} value={category}>{categoryNames[category]}</option>)}</select></label><label>Parte correspondente<select value={selected.attachedPartId} onChange={(event) => updateComponent(selected.id, { attachedPartId: event.target.value })}>{model?.parts.map((part) => <option key={part.id} value={part.id}>{part.name}</option>)}</select></label><div className="wardrobe-number-grid">{([['x', 'X'], ['y', 'Y'], ['width', 'Largura'], ['height', 'Altura'], ['rotation', 'Ângulo']] as const).map(([field, label]) => <label key={field}>{label}<input type="number" step={field === 'rotation' ? 1 : 2} value={Number(selected[field].toFixed(1))} onChange={(event) => updateComponent(selected.id, { [field]: Number(event.target.value) })} /></label>)}</div><small className="wardrobe-note">Este vínculo ficará salvo para a futura integração em Customizar.</small></div>}</> : <div className="wardrobe-edit-empty"><Icon name="sparkles" /><strong>Pré-encaixe automático</strong><small>A folha é separada por transparência. Depois você revisa categoria, peça do corpo e posição de cada recorte.</small></div>}
      </aside>
    </div>
  </section>
}
