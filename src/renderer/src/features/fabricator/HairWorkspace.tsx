import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent } from 'react'
import type { FabricatorProject, FabricatorSlotSummary, HairStyle, HairStyleSave, HairTransform, HairWorkspace as HairWorkspaceData, HairWorkspaceSave, ModelPart } from '../../../../shared/fabricator'
import { Icon } from '../../ui/components/Icon'
import { usePreviewBackground } from './usePreviewBackground'

type HairSide = 'front' | 'back' | 'fringe'
type HairAsset = NonNullable<HairWorkspaceData['front']>
type HairDrag = { pointerId: number; side: HairSide; clientX: number; clientY: number; x: number; y: number }

function headPart(project: FabricatorProject | null): ModelPart | null {
  return project?.parts.find((part) => /cabe[çc]a|head/i.test(part.name)) ?? null
}

function initialTransform(side: HairSide, head: ModelPart, asset: Pick<HairAsset, 'width' | 'height'>): HairTransform {
  const isFringe = side === 'fringe'
  const width = head.width * (isFringe ? 1.05 : 1.12)
  const height = head.height * (isFringe ? .55 : .92)
  return { x: head.width / 2, y: head.height * (isFringe ? .29 : .49), scaleX: width / asset.width, scaleY: height / asset.height, rotation: 0 }
}

function emptyHairWorkspace(modelSlot: number, head: ModelPart): HairWorkspaceData {
  const fallback = { width: 1, height: 1 }
  return { schemaVersion: 1, modelSlot, front: null, back: null, fringe: null, transforms: { front: initialTransform('front', head, fallback), back: initialTransform('back', head, fallback), fringe: initialTransform('fringe', head, fallback) }, chromaTolerance: 70, chromaMode: 'auto', updatedAt: new Date().toISOString() }
}

function readFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Arquivo de imagem inválido.'))
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'))
    reader.readAsDataURL(file)
  })
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Não foi possível abrir a folha de cabelo.'))
    image.src = dataUrl
  })
}

function imageAsPng(image: HTMLImageElement): string {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Não foi possível preparar a folha original para o chroma key.')
  context.drawImage(image, 0, 0)
  return canvas.toDataURL('image/png')
}

function preserveHairFit(previous: HairTransform, oldAsset: HairAsset | null, nextAsset: HairAsset): HairTransform {
  if (!oldAsset) return previous
  return { ...previous, scaleX: previous.scaleX * oldAsset.width / nextAsset.width, scaleY: previous.scaleY * oldAsset.height / nextAsset.height }
}

function processHairSheet(dataUrl: string, tolerance: number, mode: 'auto' | 'green' | 'checker'): Promise<{ front: HairAsset; back: HairAsset }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./hairProcessor.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<{ type: 'complete'; front: { png: ArrayBuffer; width: number; height: number }; back: { png: ArrayBuffer; width: number; height: number } } | { type: 'error'; message: string }>) => {
      worker.terminate()
      if (data.type === 'error') { reject(new Error(data.message)); return }
      // Convert binary PNGs without spreading large arrays onto the call stack.
      const toDataUrl = (buffer: ArrayBuffer) => {
        const bytes = new Uint8Array(buffer); let binary = ''
        for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)))
        return `data:image/png;base64,${btoa(binary)}`
      }
      resolve({ front: { dataUrl: toDataUrl(data.front.png), width: data.front.width, height: data.front.height }, back: { dataUrl: toDataUrl(data.back.png), width: data.back.width, height: data.back.height } })
    }
    worker.onerror = () => { worker.terminate(); reject(new Error('Não foi possível processar o chroma da folha de cabelo.')) }
    worker.postMessage({ dataUrl, tolerance, mode })
  })
}

export function HairWorkspace() {
  const [background] = usePreviewBackground()
  const [models, setModels] = useState<FabricatorSlotSummary[]>([])
  const [modelSlot, setModelSlot] = useState(1)
  const [project, setProject] = useState<FabricatorProject | null>(null)
  const [hairWorkspace, setHairWorkspace] = useState<HairWorkspaceData | null>(null)
  const [hairStyles, setHairStyles] = useState<HairStyle[]>([])
  const [activeStyleId, setActiveStyleId] = useState<string | null>(null)
  const [selectedSide, setSelectedSide] = useState<HairSide>('front')
  const [loadingModels, setLoadingModels] = useState(true)
  const [loadingProject, setLoadingProject] = useState(false)
  const [loadingHair, setLoadingHair] = useState(false)
  const [saving, setSaving] = useState(false)
  const [processingChroma, setProcessingChroma] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const fringeFileInputRef = useRef<HTMLInputElement | null>(null)
  const dragRef = useRef<HairDrag | null>(null)
  const head = useMemo(() => headPart(project), [project])
  const selectedAsset = hairWorkspace?.[selectedSide] ?? null
  const selectedTransform = hairWorkspace?.transforms[selectedSide] ?? null

  useEffect(() => {
    let cancelled = false
    void window.desktop.listFabricatorSlots().then((slots) => {
      if (cancelled) return
      setModels(slots)
      const firstAvailable = slots.find((slot): slot is NonNullable<typeof slot> => slot !== null)
      if (!slots[modelSlot - 1] && firstAvailable) setModelSlot(firstAvailable.slot)
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os modelos.')
    }).finally(() => { if (!cancelled) setLoadingModels(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    setActiveStyleId(null)
    setProject(null)
    setHairWorkspace(null)
    setDirty(false)
    setError('')
    setLoadingProject(true)
    void window.desktop.loadFabricatorSlot(modelSlot).then((loaded) => {
      if (cancelled) return
      setProject(loaded)
      if (!loaded) setError('Este slot ainda não tem um modelo salvo.')
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o modelo selecionado.')
    }).finally(() => { if (!cancelled) setLoadingProject(false) })
    return () => { cancelled = true }
  }, [modelSlot])

  useEffect(() => {
    if (!head) return
    let cancelled = false
    setLoadingHair(true)
    void window.desktop.loadHairWorkspace(modelSlot).then((saved) => {
      if (cancelled) return
      setHairWorkspace(saved ? { chromaTolerance: 70, chromaMode: 'auto', ...saved, fringe: saved.fringe ?? null, transforms: { ...saved.transforms, fringe: saved.transforms.fringe ?? initialTransform('fringe', head, saved.fringe ?? { width: 1, height: 1 }) } } : emptyHairWorkspace(modelSlot, head))
      setDirty(false)
    }).catch((reason: unknown) => {
      if (!cancelled) {
        setHairWorkspace(emptyHairWorkspace(modelSlot, head))
        setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os cabelos deste modelo.')
      }
    }).finally(() => { if (!cancelled) setLoadingHair(false) })
    return () => { cancelled = true }
  }, [modelSlot, head])

  useEffect(() => {
    let cancelled = false
    void window.desktop.listHairStyles(modelSlot).then(async (summaries) => {
      const styles = await Promise.all(summaries.map((summary) => window.desktop.loadHairStyle(modelSlot, summary.id)))
      if (!cancelled) setHairStyles(styles.filter((style): style is HairStyle => Boolean(style)))
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o catálogo de cabelos.')
    })
    return () => { cancelled = true }
  }, [modelSlot])

  function updateWorkspace(updater: (current: HairWorkspaceData) => HairWorkspaceData) {
    setHairWorkspace((current) => current ? { ...updater(current), updatedAt: new Date().toISOString() } : current)
    setDirty(true)
    setNotice('')
  }

  async function importSheet(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !head || !hairWorkspace) return
    setError(''); setNotice('')
    try {
      const uploadDataUrl = await readFileDataUrl(file)
      const image = await loadImage(uploadDataUrl)
      if (image.naturalHeight < 2) throw new Error('A folha precisa ter o cabelo posterior em cima e o traseiro em baixo.')
      const sourceImageDataUrl = imageAsPng(image)
      const tolerance = hairWorkspace.chromaTolerance ?? 70
      const mode = hairWorkspace.chromaMode ?? 'auto'
      const { front, back } = await processHairSheet(sourceImageDataUrl, tolerance, mode)
      updateWorkspace((current) => ({ ...current, front, back, sourceImageDataUrl, sourceImageSaved: true, chromaTolerance: tolerance, chromaMode: mode, transforms: { ...current.transforms, front: initialTransform('front', head, front), back: initialTransform('back', head, back) } }))
      setActiveStyleId(null)
      setSelectedSide('front')
      setNotice('Folha separada: posterior na metade de cima e traseiro na metade de baixo. A franja pode ser importada separadamente.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível separar a folha de cabelo.') }
  }

  async function importFringe(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !head || !hairWorkspace) return
    setError(''); setNotice('')
    try {
      const image = await loadImage(await readFileDataUrl(file))
      const fringe = { dataUrl: imageAsPng(image), width: image.naturalWidth, height: image.naturalHeight }
      updateWorkspace((current) => ({ ...current, fringe, transforms: { ...current.transforms, fringe: initialTransform('fringe', head, fringe) } }))
      setSelectedSide('fringe')
      setActiveStyleId(null)
      setNotice('Franja importada. Ajuste a posição e salve no catálogo junto com as outras camadas.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível importar a franja.') }
  }

  async function applyChroma(tolerance = hairWorkspace?.chromaTolerance ?? 70, mode = hairWorkspace?.chromaMode ?? 'auto') {
    if (!hairWorkspace?.sourceImageDataUrl || !head || processingChroma) return
    setProcessingChroma(true); setError(''); setNotice('')
    try {
      const { front, back } = await processHairSheet(hairWorkspace.sourceImageDataUrl, tolerance, mode)
      updateWorkspace((current) => ({
        ...current,
        front, back, chromaTolerance: tolerance, chromaMode: mode,
        transforms: {
          front: preserveHairFit(current.transforms.front, current.front, front),
          back: preserveHairFit(current.transforms.back, current.back, back)
        }
      }))
      setNotice(tolerance === 0 ? 'Chroma zerado. A folha original foi restaurada na prévia.' : 'Chroma aplicado novamente a partir da folha original.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível aplicar o chroma key.') }
    finally { setProcessingChroma(false) }
  }

  function startDrag(event: PointerEvent<HTMLImageElement>, side: HairSide) {
    if (!head || !hairWorkspace || side !== selectedSide) return
    event.preventDefault(); event.stopPropagation()
    const stage = event.currentTarget.parentElement
    if (!stage) return
    stage.setPointerCapture(event.pointerId)
    const transform = hairWorkspace.transforms[side]
    if (!transform) return
    dragRef.current = { pointerId: event.pointerId, side, clientX: event.clientX, clientY: event.clientY, x: transform.x, y: transform.y }
  }

  function moveHair(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !head) return
    const rect = event.currentTarget.getBoundingClientRect()
    const width = rect.width / zoom, height = rect.height / zoom
    if (!width || !height) return
    const dx = (event.clientX - drag.clientX) / width * head.width
    const dy = (event.clientY - drag.clientY) / height * head.height
    updateWorkspace((current) => ({ ...current, transforms: { ...current.transforms, [drag.side]: { ...current.transforms[drag.side], x: drag.x + dx, y: drag.y + dy } } }))
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
  }

  function changeTransform(patch: Partial<HairTransform>) {
    if (!head || !selectedAsset) return
    updateWorkspace((current) => ({ ...current, transforms: { ...current.transforms, [selectedSide]: { ...(current.transforms[selectedSide] ?? initialTransform(selectedSide, head, selectedAsset)), ...patch } } }))
  }

  async function persistWorkspace() {
    if (!hairWorkspace) return
    const { front, back, fringe, sourceImageDataUrl, ...rest } = hairWorkspace
    const saved: HairWorkspaceSave = { ...rest, sourceImageSaved: Boolean(sourceImageDataUrl), front: front ? { width: front.width, height: front.height } : null, back: back ? { width: back.width, height: back.height } : null, fringe: fringe ? { width: fringe.width, height: fringe.height } : null }
    const assets = [front ? { id: 'front' as const, dataUrl: front.dataUrl } : null, back ? { id: 'back' as const, dataUrl: back.dataUrl } : null, fringe ? { id: 'fringe' as const, dataUrl: fringe.dataUrl } : null, sourceImageDataUrl ? { id: 'source' as const, dataUrl: sourceImageDataUrl } : null].filter((asset): asset is NonNullable<typeof asset> => asset !== null)
    await window.desktop.saveHairWorkspace(modelSlot, saved, assets)
  }

  async function saveHair() {
    if (!hairWorkspace) return
    setSaving(true); setError(''); setNotice('')
    try {
      await persistWorkspace()
      setDirty(false); setNotice('Rascunho, folha original e ajustes salvos para este modelo.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar os cabelos.') }
    finally { setSaving(false) }
  }

  async function saveStyle() {
    if (!hairWorkspace || (!hairWorkspace.front && !hairWorkspace.back && !hairWorkspace.fringe) || saving) return
    setSaving(true); setError(''); setNotice('')
    try {
      const id = activeStyleId ?? crypto.randomUUID()
      const existing = hairStyles.find((style) => style.id === id)
      const { front, back, fringe, sourceImageDataUrl: _source, sourceImageSaved: _sourceSaved, chromaTolerance: _tolerance, chromaMode: _mode, ...rest } = hairWorkspace
      const now = new Date().toISOString()
      const saved: HairStyleSave = {
        ...rest, id, name: existing?.name ?? `Cabelo ${String(hairStyles.length + 1).padStart(2, '0')}`,
        front: front ? { width: front.width, height: front.height } : null,
        back: back ? { width: back.width, height: back.height } : null,
        fringe: fringe ? { width: fringe.width, height: fringe.height } : null,
        createdAt: existing?.createdAt ?? now, updatedAt: now
      }
      const assets = [front && { id: 'front' as const, dataUrl: front.dataUrl }, back && { id: 'back' as const, dataUrl: back.dataUrl }, fringe && { id: 'fringe' as const, dataUrl: fringe.dataUrl }].filter((asset): asset is NonNullable<typeof asset> => asset !== null)
      await persistWorkspace()
      await window.desktop.saveHairStyle(modelSlot, saved, assets)
      const detail: HairStyle = { ...saved, front: front ? { ...front } : null, back: back ? { ...back } : null, fringe: fringe ? { ...fringe } : null }
      setHairStyles((current) => [detail, ...current.filter((style) => style.id !== id)])
      setActiveStyleId(id); setDirty(false); setNotice('Cabelo salvo no catálogo deste modelo e disponível em Customizar.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o cabelo no catálogo.') }
    finally { setSaving(false) }
  }

  function openStyle(style: HairStyle, side: HairSide) {
    if (dirty && !window.confirm('Há alterações não salvas. Abrir este cabelo e descartar as alterações?')) return
    setHairWorkspace((current) => current ? { ...current, front: style.front ? { ...style.front } : null, back: style.back ? { ...style.back } : null, fringe: style.fringe ? { ...style.fringe } : null, transforms: { ...structuredClone(style.transforms), fringe: style.transforms.fringe ?? initialTransform('fringe', head!, style.fringe ?? { width: 1, height: 1 }) }, updatedAt: new Date().toISOString() } : current)
    setSelectedSide(side)
    setActiveStyleId(style.id); setDirty(false); setError(''); setNotice(`Editando ${style.name}. Salve para atualizar ou use Salvar como novo cabelo após importar outra folha.`)
  }

  async function deleteStyle(style: HairStyle) {
    if (!window.confirm(`Excluir ${style.name} do catálogo deste modelo? Personagens que já usam esse cabelo deixarão de encontrá-lo.`)) return
    try {
      await window.desktop.deleteHairStyle(modelSlot, style.id)
      setHairStyles((current) => current.filter((item) => item.id !== style.id))
      if (activeStyleId === style.id) setActiveStyleId(null)
      setNotice(`${style.name} foi excluído do catálogo.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível excluir o cabelo.') }
  }

  function flipSelectedHair() {
    changeTransform({ flipX: !selectedTransform?.flipX })
  }

  function resetSelectedTransform() {
    if (!head || !selectedAsset) return
    changeTransform(initialTransform(selectedSide, head, selectedAsset))
  }

  return <section className="fabricator-workspace hair-dev-workspace" aria-label="Cabelos Dev">
    <header className="hair-dev-toolbar">
      <span className="model-slot-logo"><Icon name="bow" /></span>
      <span><strong>Cabelos Dev</strong><small>Monte os cabelos para cada modelo</small></span>
      <label>Modelo de referência<select value={modelSlot} onChange={(event) => setModelSlot(Number(event.target.value))} disabled={loadingModels}>{models.map((model, index) => model && <option key={model.slot} value={model.slot}>Modelo {String(index + 1).padStart(2, '0')} · {model.name}</option>)}</select></label>
      <button className="hair-dev-save" onClick={() => void saveHair()} disabled={!hairWorkspace || !dirty || saving || loadingHair} title="Salvar a edição de trabalho deste modelo" type="button"><Icon name="check" />Salvar rascunho</button>
    </header>
    <div className="hair-dev-body">
      <section className="hair-dev-preview" aria-label="Prévia da cabeça">
        <div className="hair-dev-preview-heading"><strong>PRÉVIA DA CABEÇA</strong><span>{head ? Math.round(head.width) + ' × ' + Math.round(head.height) : ''}</span></div>
        <div className="hair-dev-preview-stage" style={{ backgroundColor: background }} onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.max(.5, Math.min(3, value * (event.deltaY < 0 ? 1.1 : .9)))) }}>
          {head && <div className="hair-dev-head-stage" style={{ aspectRatio: head.width + ' / ' + head.height, transform: 'scale(' + zoom + ')' }} onPointerMove={moveHair} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
            {hairWorkspace?.back && <HairPiece side="back" asset={hairWorkspace.back} transform={hairWorkspace.transforms.back} head={head} selected={selectedSide === 'back'} onPointerDown={startDrag} />}
            <img className="hair-dev-head-base" src={head.dataUrl} alt="Cabeça do modelo de referência" draggable={false} />
            {hairWorkspace?.front && <HairPiece side="front" asset={hairWorkspace.front} transform={hairWorkspace.transforms.front} head={head} selected={selectedSide === 'front'} onPointerDown={startDrag} />}
            {hairWorkspace?.fringe && hairWorkspace.transforms.fringe && <HairPiece side="fringe" asset={hairWorkspace.fringe} transform={hairWorkspace.transforms.fringe} head={head} selected={selectedSide === 'fringe'} onPointerDown={startDrag} />}
          </div>}
          {(loadingModels || loadingProject || loadingHair) && <span className="hair-dev-message">Carregando modelo e cabelos…</span>}
          {!loadingModels && !loadingProject && !head && <span className="hair-dev-message">{error || 'O modelo não tem uma peça chamada Cabeça.'}</span>}
          {head && !hairWorkspace?.front && !hairWorkspace?.back && !loadingHair && <span className="hair-dev-message">Envie a folha com Posterior em cima e Traseiro em baixo.</span>}
          <div className="hair-dev-zoom-tools"><button onClick={() => setZoom((value) => Math.min(3, value * 1.15))} aria-label="Aproximar" type="button">+</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.max(.5, value / 1.15))} aria-label="Afastar" type="button">−</button></div>
        </div>
        {(error || notice) && <div className={'hair-dev-status' + (error ? ' error' : '')} role={error ? 'alert' : 'status'}>{error || notice}</div>}
      </section>
      <section className="hair-dev-controls" aria-label="Controles de cabelo">
        <header><strong>Camadas do cabelo</strong><small>Traseiro atrás do personagem · Posterior atrás da franja</small></header>
        <button className="hair-dev-upload" onClick={() => fileInputRef.current?.click()} disabled={!head || loadingHair} type="button"><Icon name="plus" />{hairWorkspace?.front || hairWorkspace?.back ? 'Trocar folha Posterior/Traseiro' : 'Enviar folha Posterior/Traseiro'}</button>
        <input ref={fileInputRef} className="hair-dev-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void importSheet(event)} />
        <button className="hair-dev-upload" onClick={() => fringeFileInputRef.current?.click()} disabled={!head || loadingHair} type="button"><Icon name="plus" />{hairWorkspace?.fringe ? 'Trocar franja frontal' : 'Importar franja frontal'}</button>
        <input ref={fringeFileInputRef} className="hair-dev-file" type="file" accept="image/png" onChange={(event) => void importFringe(event)} />
        <small className="hair-dev-chroma-hint">Use uma imagem PNG transparente para a franja, separada das camadas Posterior e Traseiro.</small>
        <section className="hair-dev-chroma" aria-label="Controles do chroma key">
          <header><span><strong>Chroma key</strong><small>Remoção do fundo da folha</small></span><output>{hairWorkspace?.chromaTolerance ?? 70}%</output></header>
          <label className="hair-dev-chroma-mode">Tipo de fundo<select aria-label="Tipo de fundo para chroma key" value={hairWorkspace?.chromaMode ?? 'auto'} disabled={!hairWorkspace?.sourceImageDataUrl || processingChroma} onChange={(event) => updateWorkspace((current) => ({ ...current, chromaMode: event.target.value as 'auto' | 'green' | 'checker' }))}><option value="auto">Detectar automaticamente</option><option value="green">Verde / chroma verde</option><option value="checker">Quadriculado cinza e preto</option></select></label>
          <label className="hair-dev-chroma-range"><span><small>Menos</small><small>Mais</small></span><input aria-label="Intensidade do chroma key" type="range" min="0" max="100" step="1" value={hairWorkspace?.chromaTolerance ?? 70} disabled={!hairWorkspace?.sourceImageDataUrl || processingChroma} onChange={(event) => updateWorkspace((current) => ({ ...current, chromaTolerance: Number(event.target.value) }))} /></label>
          <div className="hair-dev-chroma-actions"><button className="hair-dev-catalog-save" onClick={() => void applyChroma()} disabled={!hairWorkspace?.sourceImageDataUrl || processingChroma} type="button"><Icon name={processingChroma ? 'reset' : 'check'} />{processingChroma ? 'Aplicando…' : 'Aplicar chroma'}</button><button className="hair-dev-reset" onClick={() => { updateWorkspace((current) => ({ ...current, chromaTolerance: 0 })); void applyChroma(0) }} disabled={!hairWorkspace?.sourceImageDataUrl || processingChroma} type="button">Voltar ao original</button></div>
          <small className="hair-dev-chroma-hint">O ajuste sempre parte da folha original e mantém o encaixe das peças.</small>
        </section>
        <div className="hair-dev-part-tabs" role="tablist" aria-label="Parte do cabelo">
          {([{ id: 'front', label: 'Posterior · metade de cima' }, { id: 'back', label: 'Traseiro · metade de baixo' }, { id: 'fringe', label: 'Frontal · franja' }] as const).map((part) => <button className={selectedSide === part.id ? 'active' : ''} key={part.id} onClick={() => setSelectedSide(part.id)} aria-pressed={selectedSide === part.id} disabled={!hairWorkspace?.[part.id]} type="button"><span>{part.label}</span><small>{hairWorkspace?.[part.id] ? 'Disponível' : 'Não importado'}</small></button>)}
        </div>
        {selectedAsset && selectedTransform ? <>
          <div className="hair-dev-control-title"><b>{selectedSide === 'front' ? 'Cabelo posterior' : selectedSide === 'back' ? 'Cabelo traseiro' : 'Franja frontal'}</b><small>Arraste a parte selecionada na prévia.</small></div>
          <div className="hair-dev-position-grid">
            {([['x', 'Posição X'], ['y', 'Posição Y']] as const).map(([field, label]) => <label key={field}>{label}<input type="number" step="1" value={Math.round(selectedTransform[field])} onChange={(event) => changeTransform({ [field]: Number(event.target.value) })} /></label>)}
          </div>
          {([['scaleX', 'Largura · espremer/esticar'], ['scaleY', 'Altura · espremer/esticar']] as const).map(([field, label]) => <label className="hair-dev-range" key={field}><span><b>{label}</b><output>{Math.round(selectedTransform[field] * 100)}%</output></span><input type="range" min="10" max="500" step="1" value={Math.max(10, Math.min(500, Math.round(selectedTransform[field] * 100)))} onChange={(event) => changeTransform({ [field]: Number(event.target.value) / 100 })} /><input className="hair-dev-range-number" type="number" min="10" max="1000" step="1" aria-label={label + ' em porcentagem'} value={Math.round(selectedTransform[field] * 100)} onChange={(event) => changeTransform({ [field]: Math.max(.1, Math.min(10, Number(event.target.value) / 100)) })} /></label>)}
          <label className="hair-dev-range"><span><b>Rotação</b><output>{Math.round(selectedTransform.rotation)}°</output></span><input type="range" min="-180" max="180" step="1" value={Math.max(-180, Math.min(180, Math.round(selectedTransform.rotation)))} onChange={(event) => changeTransform({ rotation: Number(event.target.value) })} /></label>
          <div className="hair-dev-piece-actions"><button className="hair-dev-reset" onClick={flipSelectedHair} type="button"><Icon name="flipHorizontal" /> Inverter na horizontal</button><button className="hair-dev-reset" onClick={resetSelectedTransform} type="button">Restaurar encaixe inicial</button></div>
        </> : <p className="hair-dev-empty">Envie a folha para selecionar e ajustar cada parte do cabelo separadamente.</p>}
        <section className="hair-dev-catalog" aria-label="Catálogo de cabelos">
          <header><span><strong>Catálogo deste modelo</strong><small>{hairStyles.length} cabelos salvos</small></span><button className="hair-dev-catalog-save" onClick={() => void saveStyle()} disabled={!hairWorkspace || (!hairWorkspace.front && !hairWorkspace.back && !hairWorkspace.fringe) || saving || loadingHair} type="button"><Icon name="check" />{activeStyleId ? 'Salvar cabelo' : 'Salvar no catálogo'}</button></header>
          {hairStyles.length ? <>
            <nav className="hair-dev-catalog-tabs" aria-label="Categoria do catálogo de cabelos">
              {([{ id: 'front', label: 'Posterior' }, { id: 'back', label: 'Traseiro' }, { id: 'fringe', label: 'Franja frontal' }] as const).map((side) => <button className={selectedSide === side.id ? 'active' : ''} key={side.id} onClick={() => setSelectedSide(side.id)} aria-pressed={selectedSide === side.id} type="button">{side.label}</button>)}
            </nav>
            <div className="hair-dev-catalog-grid">{hairStyles.filter((style) => Boolean(style[selectedSide])).map((style) => <article className={'hair-dev-catalog-card' + (style.id === activeStyleId ? ' active' : '')} key={style.id}>
            <button className="hair-dev-catalog-open" onClick={() => openStyle(style, selectedSide)} title={`Editar ${selectedSide === 'front' ? 'posterior' : selectedSide === 'back' ? 'traseiro' : 'franja frontal'} de ${style.name}`} type="button"><span>{style[selectedSide] && <img src={style[selectedSide]!.dataUrl} alt="" />}</span><b>{style.name} · {selectedSide === 'front' ? 'Posterior' : selectedSide === 'back' ? 'Traseiro' : 'Franja frontal'}</b></button>
            <button className="hair-dev-catalog-delete" onClick={() => void deleteStyle(style)} aria-label={`Excluir ${style.name}`} title="Excluir cabelo" type="button"><Icon name="trash" /></button>
          </article>)}</div>
            {hairStyles.every((style) => !style[selectedSide]) && <p className="hair-dev-catalog-empty">Nenhum cabelo {selectedSide === 'front' ? 'posterior' : selectedSide === 'back' ? 'traseiro' : 'franja frontal'} salvo para este modelo.</p>}
          </> : <p className="hair-dev-catalog-empty">Ajuste o cabelo na prévia e clique em “Salvar no catálogo”.</p>}
        </section>
      </section>
    </div>
  </section>
}

function HairPiece({ side, asset, transform, head, selected, onPointerDown }: { side: HairSide; asset: HairAsset; transform: HairTransform; head: ModelPart; selected: boolean; onPointerDown: (event: PointerEvent<HTMLImageElement>, side: HairSide) => void }) {
  const width = asset.width * transform.scaleX / head.width * 100
  const height = asset.height * transform.scaleY / head.height * 100
  const label = side === 'front' ? 'posterior' : side === 'back' ? 'traseiro' : 'franja frontal'
  return <img className={'hair-dev-piece hair-dev-piece-' + side + (selected ? ' selected' : '')} src={asset.dataUrl} alt={'Cabelo ' + label} draggable={false} onPointerDown={(event) => onPointerDown(event, side)} style={{ left: transform.x / head.width * 100 + '%', top: transform.y / head.height * 100 + '%', width: width + '%', height: height + '%', transform: 'translate(-50%, -50%) rotate(' + transform.rotation + 'deg) scaleX(' + (transform.flipX ? -1 : 1) + ')', pointerEvents: selected ? 'auto' : 'none' }} />
}
