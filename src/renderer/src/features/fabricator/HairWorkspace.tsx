import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent } from 'react'
import type { FabricatorProject, FabricatorSlotSummary, HairStyle, HairStyleSave, HairTransform, HairWorkspace as HairWorkspaceData, HairWorkspaceSave, ModelPart } from '../../../../shared/fabricator'
import type { HairPartId } from '../../../../shared/customizer'
import { hairCategories, hairStyleSupportsCategory, type HairAssetSide } from '../../../../shared/hairCategories'
import { emptyHairTransform, normalizeHairTransforms } from '../../../../shared/hairPersistence'
import { HairPiecePreview as HairPiece } from './HairPiecePreview'
import { Icon } from '../../ui/components/Icon'
import { usePreviewBackground } from './usePreviewBackground'
import { normalizeEditableImageFile } from './normalizeImage'

type HairSide = HairAssetSide
type HairAsset = NonNullable<HairWorkspaceData['front']>
type HairDrag = { pointerId: number; side: HairSide; clientX: number; clientY: number; x: number; y: number }
const defaultCategories: Record<HairSide, HairPartId> = { front: 'rearHair', back: 'backHair', fringe: 'frontHair' }

function headPart(project: FabricatorProject | null): ModelPart | null {
  return project?.parts.find((part) => /cabe[çc]a|head/i.test(part.name)) ?? null
}

function initialTransform(side: HairSide, head: ModelPart, asset: Pick<HairAsset, 'width' | 'height'>): HairTransform {
  const isFringe = side === 'fringe'
  const width = head.width * (isFringe ? 1.05 : 1.12)
  const height = head.height * (isFringe ? .55 : .92)
  return { x: head.width / 2, y: head.height * (isFringe ? .29 : .49), scaleX: width / asset.width, scaleY: height / asset.height, rotation: 0 }
}

function emptyHairWorkspace(modelSlot: number): HairWorkspaceData {
  return { schemaVersion: 1, modelSlot, front: null, back: null, fringe: null, transforms: { front: emptyHairTransform(), back: emptyHairTransform(), fringe: emptyHairTransform() }, categoryBySide: defaultCategories, chromaTolerance: 70, chromaMode: 'auto', updatedAt: new Date().toISOString() }
}

function readFileDataUrl(file: File): Promise<string> {
  return normalizeEditableImageFile(file).then((image) => image.dataUrl)
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
  const [selectedCategory, setSelectedCategory] = useState<HairPartId>('rearHair')
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
  const singleFileInputRef = useRef<HTMLInputElement | null>(null)
  const dragRef = useRef<HairDrag | null>(null)
  const head = useMemo(() => headPart(project), [project])
  const category = hairCategories.find((item) => item.id === selectedCategory)!
  const selectedSide = category.side
  const selectedAsset = (hairWorkspace?.categoryBySide?.[selectedSide] ?? defaultCategories[selectedSide]) === selectedCategory ? hairWorkspace?.[selectedSide] ?? null : null
  const selectedTransform = selectedAsset ? hairWorkspace?.transforms[selectedSide] ?? null : null
  const visibleDraft = (side: HairSide) => selectedSide !== side || selectedAsset !== null
  const categoryStyles = hairStyles.filter((style) => hairStyleSupportsCategory(style, selectedCategory))
  const activeStyle = hairStyles.find((style) => style.id === activeStyleId)
  const canUpdateActiveStyle = activeStyle?.category === selectedCategory
  const chromaReady = Boolean(hairWorkspace?.sourceImageDataUrl && hairWorkspace.sourceAppliesToDraft !== false)

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
      setHairWorkspace(saved ? { chromaTolerance: 70, chromaMode: 'auto', ...saved, fringe: saved.fringe ?? null, transforms: { ...saved.transforms, fringe: saved.transforms.fringe ?? (saved.fringe ? initialTransform('fringe', head, saved.fringe) : emptyHairTransform()) } } : emptyHairWorkspace(modelSlot))
      setDirty(false)
    }).catch((reason: unknown) => {
      if (!cancelled) {
        setHairWorkspace(emptyHairWorkspace(modelSlot))
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
    if (dirty && (hairWorkspace.front || hairWorkspace.back) && !window.confirm('Substituir a folha atual e descartar os ajustes não salvos?')) return
    setError(''); setNotice('')
    try {
      const uploadDataUrl = await readFileDataUrl(file)
      const image = await loadImage(uploadDataUrl)
      if (image.naturalHeight < 2) throw new Error('A folha precisa ter o cabelo posterior em cima e o traseiro em baixo.')
      const sourceImageDataUrl = imageAsPng(image)
      const tolerance = hairWorkspace.chromaTolerance ?? 70
      const mode = hairWorkspace.chromaMode ?? 'auto'
      const { front, back } = await processHairSheet(sourceImageDataUrl, tolerance, mode)
      updateWorkspace((current) => ({ ...current, front, back, categoryBySide: { ...current.categoryBySide, front: 'rearHair', back: 'backHair' }, sourceImageDataUrl, sourceImageSaved: true, sourceAppliesToDraft: true, chromaTolerance: tolerance, chromaMode: mode, transforms: { ...current.transforms, front: initialTransform('front', head, front), back: initialTransform('back', head, back) } }))
      setActiveStyleId(null)
      setSelectedCategory(selectedCategory === 'backHair' ? 'backHair' : 'rearHair')
      setNotice('Folha separada: posterior na metade de cima e traseiro na metade de baixo. A franja pode ser importada separadamente.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível separar a folha de cabelo.') }
  }

  async function importSinglePiece(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !head || !hairWorkspace) return
    if (dirty && hairWorkspace[selectedSide] && !window.confirm(`Substituir a peça atual de ${category.label} e descartar os ajustes não salvos?`)) return
    setError(''); setNotice('')
    try {
      const image = await loadImage(await readFileDataUrl(file))
      const asset = { dataUrl: imageAsPng(image), width: image.naturalWidth, height: image.naturalHeight }
      const side = selectedSide
      updateWorkspace((current) => ({ ...current, [side]: asset, categoryBySide: { ...current.categoryBySide, [side]: selectedCategory }, sourceAppliesToDraft: false, transforms: { ...current.transforms, [side]: initialTransform(side, head, asset) } }))
      setActiveStyleId(null)
      setNotice(`${category.label} importado. Ajuste a posição e salve nesta categoria.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível importar a peça de cabelo.') }
  }

  async function applyChroma(tolerance = hairWorkspace?.chromaTolerance ?? 70, mode = hairWorkspace?.chromaMode ?? 'auto') {
    if (!chromaReady || !hairWorkspace?.sourceImageDataUrl || !head || processingChroma) return
    setProcessingChroma(true); setError(''); setNotice('')
    try {
      const { front, back } = await processHairSheet(hairWorkspace.sourceImageDataUrl, tolerance, mode)
      updateWorkspace((current) => ({
        ...current,
        front, back, chromaTolerance: tolerance, chromaMode: mode,
        categoryBySide: { ...current.categoryBySide, front: 'rearHair', back: 'backHair' },
        transforms: {
          ...current.transforms,
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

  function updateHairPixels(side: HairSide, dataUrl: string) {
    updateWorkspace((current) => current[side] ? { ...current, [side]: { ...current[side]!, dataUrl } } : current)
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
    await window.desktop.saveHairWorkspace(modelSlot, { ...saved, transforms: normalizeHairTransforms(saved) }, assets)
  }

  async function saveHair() {
    if (!hairWorkspace) return
    setSaving(true); setError(''); setNotice('')
    try {
      await persistWorkspace()
      window.dispatchEvent(new Event('fabricator:assets-updated'))
      setDirty(false); setNotice('Rascunho, folha original e ajustes salvos para este modelo.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar os cabelos.') }
    finally { setSaving(false) }
  }

  async function saveStyle() {
    if (!hairWorkspace || !selectedAsset || saving) return
    setSaving(true); setError(''); setNotice('')
    try {
      const id = canUpdateActiveStyle ? activeStyleId! : crypto.randomUUID()
      const existing = canUpdateActiveStyle ? activeStyle : undefined
      const { front, back, fringe, sourceImageDataUrl: _source, sourceImageSaved: _sourceSaved, sourceAppliesToDraft: _sourceApplies, chromaTolerance: _tolerance, chromaMode: _mode, categoryBySide: _categories, ...rest } = hairWorkspace
      const now = new Date().toISOString()
      const saved: HairStyleSave = {
        ...rest, id, category: selectedCategory, name: existing?.name ?? `${category.label} ${String(categoryStyles.length + 1).padStart(2, '0')}`,
        front: selectedSide === 'front' && front ? { width: front.width, height: front.height } : null,
        back: selectedSide === 'back' && back ? { width: back.width, height: back.height } : null,
        fringe: selectedSide === 'fringe' && fringe ? { width: fringe.width, height: fringe.height } : null,
        createdAt: existing?.createdAt ?? now, updatedAt: now
      }
      const assets = [{ id: selectedSide, dataUrl: selectedAsset.dataUrl }]
      await persistWorkspace()
      saved.transforms = normalizeHairTransforms(saved)
      await window.desktop.saveHairStyle(modelSlot, saved, assets)
      window.dispatchEvent(new Event('fabricator:assets-updated'))
      const detail: HairStyle = { ...saved, front: saved.front && front ? { ...front } : null, back: saved.back && back ? { ...back } : null, fringe: saved.fringe && fringe ? { ...fringe } : null }
      setHairStyles((current) => [detail, ...current.filter((style) => style.id !== id)])
      setActiveStyleId(id); setDirty(false); setNotice('Cabelo salvo no catálogo deste modelo e disponível em Customizar.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o cabelo no catálogo.') }
    finally { setSaving(false) }
  }

  function openStyle(style: HairStyle) {
    if (dirty && !window.confirm('Há alterações não salvas. Abrir este cabelo e descartar as alterações?')) return
    setHairWorkspace((current) => current ? { ...current, front: style.front ? { ...style.front } : null, back: style.back ? { ...style.back } : null, fringe: style.fringe ? { ...style.fringe } : null, sourceAppliesToDraft: false, categoryBySide: { ...defaultCategories, [selectedSide]: selectedCategory }, transforms: { ...structuredClone(style.transforms), fringe: style.transforms.fringe ?? (style.fringe ? initialTransform('fringe', head!, style.fringe) : emptyHairTransform()) }, updatedAt: new Date().toISOString() } : current)
    setActiveStyleId(style.id); setDirty(false); setError(''); setNotice(style.category ? `Editando ${style.name}.` : `Cabelo antigo aberto. Ao salvar, será criada uma cópia em ${category.label}.`)
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
      <label>Modelo de referência<select value={modelSlot} onChange={(event) => { if (dirty && !window.confirm('Há alterações não salvas. Descartar e trocar de modelo?')) return; setModelSlot(Number(event.target.value)) }} disabled={loadingModels}>{models.map((model, index) => model && <option key={model.slot} value={model.slot}>Modelo {String(index + 1).padStart(2, '0')} · {model.name}</option>)}</select></label>
      <button className="hair-dev-save" onClick={() => void saveHair()} disabled={!hairWorkspace || !dirty || saving || loadingHair} title="Salvar a edição de trabalho deste modelo" type="button"><Icon name="check" />Salvar rascunho</button>
    </header>
    <div className="hair-dev-body">
      <aside className="hair-dev-library" aria-label="Biblioteca de cabelos">
        <header><strong>Biblioteca</strong><small>{hairStyles.length} assets</small></header>
        <div className="hair-dev-library-actions">
          <button type="button" onClick={() => singleFileInputRef.current?.click()} disabled={!head || loadingHair || saving}><Icon name="plus" /> Importar</button>
          <button type="button" onClick={() => { const style = hairStyles.find((item) => item.id === activeStyleId); if (style) void deleteStyle(style) }} disabled={!activeStyleId || saving}><Icon name="trash" /> Excluir</button>
        </div>
        <input ref={singleFileInputRef} className="hair-dev-file" type="file" accept="image/png,image/webp" onChange={(event) => void importSinglePiece(event)} />
        <small className="hair-dev-library-hint">Importe uma peça PNG ou WebP com fundo transparente na categoria escolhida.</small>
        {(selectedSide === 'front' || selectedCategory === 'backHair') && <><button className="hair-dev-sheet-import" onClick={() => fileInputRef.current?.click()} disabled={!head || loadingHair || saving} type="button">Importar folha Posterior/Traseiro</button><input ref={fileInputRef} className="hair-dev-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void importSheet(event)} /></>}
        <nav className="hair-dev-library-tabs" aria-label="Categorias da biblioteca" role="tablist">
          {hairCategories.map((item) => <button key={item.id} type="button" role="tab" aria-selected={selectedCategory === item.id} className={selectedCategory === item.id ? 'active' : ''} onClick={() => { setSelectedCategory(item.id); setActiveStyleId(null) }}>{item.label}</button>)}
        </nav>
        <section className="hair-dev-library-category" role="tabpanel" aria-label={`Assets de ${category.label}`}>
          <h3>{category.label} <small>{categoryStyles.length}</small></h3>
          <div className="hair-dev-library-assets">
            {categoryStyles.map((style) => <button className={style.id === activeStyleId ? 'active' : ''} key={style.id} type="button" onClick={() => openStyle(style)}><img src={style[selectedSide]?.dataUrl} alt="" /><span>{style.name}</span></button>)}
            {!categoryStyles.length && <small>Nenhum asset salvo nesta categoria</small>}
          </div>
        </section>
        <button className="hair-dev-catalog-save" onClick={() => void saveStyle()} disabled={!selectedAsset || saving || loadingHair} type="button"><Icon name="check" />{canUpdateActiveStyle ? 'Salvar alterações' : 'Salvar no catálogo'}</button>
      </aside>
      <section className="hair-dev-preview" aria-label="Prévia da cabeça">
        <div className="hair-dev-preview-heading"><strong>PRÉVIA DA CABEÇA</strong><span>{head ? Math.round(head.width) + ' × ' + Math.round(head.height) : ''}</span></div>
        <div className="hair-dev-preview-stage" style={{ backgroundColor: background }} onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.max(.5, Math.min(3, value * (event.deltaY < 0 ? 1.1 : .9)))) }}>
          {head && <div className="hair-dev-head-stage" style={{ aspectRatio: head.width + ' / ' + head.height, transform: 'scale(' + zoom + ')' }} onPointerMove={moveHair} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
            {hairWorkspace?.back && visibleDraft('back') && <HairPiece side="back" asset={hairWorkspace.back} transform={hairWorkspace.transforms.back} head={head} selected={selectedSide === 'back'} onPointerDown={startDrag} disabled={saving || loadingHair || processingChroma} onErase={(dataUrl) => updateHairPixels('back', dataUrl)} />}
            <img className="hair-dev-head-base" src={head.dataUrl} alt="Cabeça do modelo de referência" draggable={false} />
            {hairWorkspace?.front && visibleDraft('front') && <HairPiece side="front" asset={hairWorkspace.front} transform={hairWorkspace.transforms.front} head={head} selected={selectedSide === 'front'} onPointerDown={startDrag} disabled={saving || loadingHair || processingChroma} onErase={(dataUrl) => updateHairPixels('front', dataUrl)} />}
            {hairWorkspace?.fringe && hairWorkspace.transforms.fringe && visibleDraft('fringe') && <HairPiece side="fringe" asset={hairWorkspace.fringe} transform={hairWorkspace.transforms.fringe} head={head} selected={selectedSide === 'fringe'} onPointerDown={startDrag} disabled={saving || loadingHair || processingChroma} onErase={(dataUrl) => updateHairPixels('fringe', dataUrl)} />}
          </div>}
          {(loadingModels || loadingProject || loadingHair) && <span className="hair-dev-message">Carregando modelo e cabelos…</span>}
          {!loadingModels && !loadingProject && !head && <span className="hair-dev-message">{error || 'O modelo não tem uma peça chamada Cabeça.'}</span>}
          {head && !hairWorkspace?.front && !hairWorkspace?.back && !loadingHair && <span className="hair-dev-message">Envie a folha com Posterior em cima e Traseiro em baixo.</span>}
          <div className="hair-dev-zoom-tools"><button onClick={() => setZoom((value) => Math.min(3, value * 1.15))} aria-label="Aproximar" type="button">+</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.max(.5, value / 1.15))} aria-label="Afastar" type="button">−</button></div>
        </div>
        {(error || notice) && <div className={'hair-dev-status' + (error ? ' error' : '')} role={error ? 'alert' : 'status'}>{error || notice}</div>}
      </section>
      <section className="hair-dev-controls" aria-label="Controles de cabelo">
        <header><strong>Ajuste da peça</strong><small>{category.label} · arraste a peça na prévia para mover</small></header>
        <section className="hair-dev-chroma" aria-label="Controles do chroma key">
          <header><span><strong>Chroma key</strong><small>Remoção do fundo da folha</small></span><output>{hairWorkspace?.chromaTolerance ?? 70}%</output></header>
          <label className="hair-dev-chroma-mode">Tipo de fundo<select aria-label="Tipo de fundo para chroma key" value={hairWorkspace?.chromaMode ?? 'auto'} disabled={!chromaReady || processingChroma} onChange={(event) => updateWorkspace((current) => ({ ...current, chromaMode: event.target.value as 'auto' | 'green' | 'checker' }))}><option value="auto">Detectar automaticamente</option><option value="green">Verde / chroma verde</option><option value="checker">Quadriculado cinza e preto</option></select></label>
          <label className="hair-dev-chroma-range"><span><small>Menos</small><small>Mais</small></span><input aria-label="Intensidade do chroma key" type="range" min="0" max="100" step="1" value={hairWorkspace?.chromaTolerance ?? 70} disabled={!chromaReady || processingChroma} onChange={(event) => updateWorkspace((current) => ({ ...current, chromaTolerance: Number(event.target.value) }))} /></label>
          <div className="hair-dev-chroma-actions"><button className="hair-dev-catalog-save" onClick={() => void applyChroma()} disabled={!chromaReady || processingChroma} type="button"><Icon name={processingChroma ? 'reset' : 'check'} />{processingChroma ? 'Aplicando…' : 'Aplicar chroma'}</button><button className="hair-dev-reset" onClick={() => { updateWorkspace((current) => ({ ...current, chromaTolerance: 0 })); void applyChroma(0) }} disabled={!chromaReady || processingChroma} type="button">Voltar ao original</button></div>
          <small className="hair-dev-chroma-hint">O ajuste sempre parte da folha original e mantém o encaixe das peças.</small>
        </section>
        {selectedAsset && selectedTransform ? <>
          <div className="hair-dev-control-title"><b>{category.label}</b><small>Arraste a parte selecionada na prévia.</small></div>
          <div className="hair-dev-position-grid">
            {([['x', 'Posição X'], ['y', 'Posição Y']] as const).map(([field, label]) => <label key={field}>{label}<input type="number" step="1" value={Math.round(selectedTransform[field])} onChange={(event) => changeTransform({ [field]: Number(event.target.value) })} /></label>)}
          </div>
          {([['scaleX', 'Largura · espremer/esticar'], ['scaleY', 'Altura · espremer/esticar']] as const).map(([field, label]) => <label className="hair-dev-range" key={field}><span><b>{label}</b><output>{Math.round(selectedTransform[field] * 100)}%</output></span><input type="range" min="10" max="500" step="1" value={Math.max(10, Math.min(500, Math.round(selectedTransform[field] * 100)))} onChange={(event) => changeTransform({ [field]: Number(event.target.value) / 100 })} /><input className="hair-dev-range-number" type="number" min="10" max="1000" step="1" aria-label={label + ' em porcentagem'} value={Math.round(selectedTransform[field] * 100)} onChange={(event) => changeTransform({ [field]: Math.max(.1, Math.min(10, Number(event.target.value) / 100)) })} /></label>)}
          <label className="hair-dev-range"><span><b>Rotação</b><output>{Math.round(selectedTransform.rotation)}°</output></span><input type="range" min="-180" max="180" step="1" value={Math.max(-180, Math.min(180, Math.round(selectedTransform.rotation)))} onChange={(event) => changeTransform({ rotation: Number(event.target.value) })} /></label>
          <div className="hair-dev-piece-actions"><button className="hair-dev-reset" onClick={flipSelectedHair} type="button"><Icon name="flipHorizontal" /> Inverter na horizontal</button><button className="hair-dev-reset" onClick={resetSelectedTransform} type="button">Restaurar encaixe inicial</button></div>
          <div data-hair-eraser-controls />
        </> : <p className="hair-dev-empty">Importe uma peça em {category.label} para ajustar seu encaixe.</p>}
      </section>
    </div>
  </section>
}
