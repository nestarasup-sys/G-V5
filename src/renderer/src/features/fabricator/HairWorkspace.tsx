import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent } from 'react'
import type { FabricatorProject, FabricatorSlotSummary, HairTransform, HairWorkspace as HairWorkspaceData, HairWorkspaceSave, ModelPart } from '../../../../shared/fabricator'
import { Icon } from '../../ui/components/Icon'
import { usePreviewBackground } from './usePreviewBackground'

type HairSide = 'front' | 'back'
type HairAsset = NonNullable<HairWorkspaceData['front']>
type HairDrag = { pointerId: number; side: HairSide; clientX: number; clientY: number; x: number; y: number }

function headPart(project: FabricatorProject | null): ModelPart | null {
  return project?.parts.find((part) => /cabe[çc]a|head/i.test(part.name)) ?? null
}

function initialTransform(side: HairSide, head: ModelPart, asset: Pick<HairAsset, 'width' | 'height'>): HairTransform {
  const width = head.width * (side === 'front' ? 1.05 : 1.12)
  const height = head.height * (side === 'front' ? .55 : .92)
  return { x: head.width / 2, y: head.height * (side === 'front' ? .29 : .49), scaleX: width / asset.width, scaleY: height / asset.height, rotation: 0 }
}

function emptyHairWorkspace(modelSlot: number, head: ModelPart): HairWorkspaceData {
  const fallback = { width: 1, height: 1 }
  return { schemaVersion: 1, modelSlot, front: null, back: null, transforms: { front: initialTransform('front', head, fallback), back: initialTransform('back', head, fallback) }, updatedAt: new Date().toISOString() }
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

async function cropHalf(image: HTMLImageElement, top: number, height: number): Promise<HairAsset> {
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth; canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Não foi possível separar as duas partes da folha.')
  context.drawImage(image, 0, top, image.naturalWidth, height, 0, 0, image.naturalWidth, height)
  const alpha = context.getImageData(0, 0, canvas.width, canvas.height).data
  let left = canvas.width, right = -1, upper = canvas.height, lower = -1
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    if (alpha[(y * canvas.width + x) * 4 + 3] < 8) continue
    left = Math.min(left, x); right = Math.max(right, x); upper = Math.min(upper, y); lower = Math.max(lower, y)
  }
  if (right < left || lower < upper) return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
  const cropped = document.createElement('canvas')
  cropped.width = right - left + 1; cropped.height = lower - upper + 1
  const croppedContext = cropped.getContext('2d')
  if (!croppedContext) throw new Error('Não foi possível recortar uma das partes do cabelo.')
  croppedContext.drawImage(canvas, left, upper, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height)
  return { dataUrl: cropped.toDataURL('image/png'), width: cropped.width, height: cropped.height }
}

export function HairWorkspace() {
  const [background] = usePreviewBackground()
  const [models, setModels] = useState<FabricatorSlotSummary[]>([])
  const [modelSlot, setModelSlot] = useState(1)
  const [project, setProject] = useState<FabricatorProject | null>(null)
  const [hairWorkspace, setHairWorkspace] = useState<HairWorkspaceData | null>(null)
  const [selectedSide, setSelectedSide] = useState<HairSide>('front')
  const [loadingModels, setLoadingModels] = useState(true)
  const [loadingProject, setLoadingProject] = useState(false)
  const [loadingHair, setLoadingHair] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
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
      setHairWorkspace(saved ?? emptyHairWorkspace(modelSlot, head))
      setDirty(false)
    }).catch((reason: unknown) => {
      if (!cancelled) {
        setHairWorkspace(emptyHairWorkspace(modelSlot, head))
        setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os cabelos deste modelo.')
      }
    }).finally(() => { if (!cancelled) setLoadingHair(false) })
    return () => { cancelled = true }
  }, [modelSlot, head])

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
      const image = await loadImage(await readFileDataUrl(file))
      if (image.naturalHeight < 2) throw new Error('A folha precisa ter o cabelo frontal em cima e o traseiro em baixo.')
      const upperHeight = Math.floor(image.naturalHeight / 2)
      const front = await cropHalf(image, 0, upperHeight)
      const back = await cropHalf(image, upperHeight, image.naturalHeight - upperHeight)
      updateWorkspace((current) => ({ ...current, front, back, transforms: { front: initialTransform('front', head, front), back: initialTransform('back', head, back) } }))
      setSelectedSide('front')
      setNotice('Folha separada: frontal na metade de cima e traseiro na metade de baixo. Ajuste cada parte na prévia.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível separar a folha de cabelo.') }
  }

  function startDrag(event: PointerEvent<HTMLImageElement>, side: HairSide) {
    if (!head || !hairWorkspace) return
    event.preventDefault(); event.stopPropagation()
    setSelectedSide(side)
    const stage = event.currentTarget.parentElement
    if (!stage) return
    stage.setPointerCapture(event.pointerId)
    const transform = hairWorkspace.transforms[side]
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
    updateWorkspace((current) => ({ ...current, transforms: { ...current.transforms, [selectedSide]: { ...current.transforms[selectedSide], ...patch } } }))
  }

  async function saveHair() {
    if (!hairWorkspace) return
    setSaving(true); setError(''); setNotice('')
    try {
      const { front, back, ...rest } = hairWorkspace
      const saved: HairWorkspaceSave = { ...rest, front: front ? { width: front.width, height: front.height } : null, back: back ? { width: back.width, height: back.height } : null }
      const assets = [front && { id: 'front' as const, dataUrl: front.dataUrl }, back && { id: 'back' as const, dataUrl: back.dataUrl }].filter((asset): asset is NonNullable<typeof asset> => asset !== null)
      await window.desktop.saveHairWorkspace(modelSlot, saved, assets)
      setDirty(false); setNotice('Cabelos salvos para este modelo.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar os cabelos.') }
    finally { setSaving(false) }
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
      <button className="hair-dev-save" onClick={() => void saveHair()} disabled={!hairWorkspace || !dirty || saving || loadingHair} type="button"><Icon name="check" />{saving ? 'Salvando…' : 'Salvar'}</button>
    </header>
    <div className="hair-dev-body">
      <section className="hair-dev-preview" aria-label="Prévia da cabeça">
        <div className="hair-dev-preview-heading"><strong>PRÉVIA DA CABEÇA</strong><span>{head ? Math.round(head.width) + ' × ' + Math.round(head.height) : ''}</span></div>
        <div className="hair-dev-preview-stage" style={{ backgroundColor: background }} onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.max(.5, Math.min(3, value * (event.deltaY < 0 ? 1.1 : .9)))) }}>
          {head && <div className="hair-dev-head-stage" style={{ aspectRatio: head.width + ' / ' + head.height, transform: 'scale(' + zoom + ')' }} onPointerMove={moveHair} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
            {hairWorkspace?.back && <HairPiece side="back" asset={hairWorkspace.back} transform={hairWorkspace.transforms.back} head={head} selected={selectedSide === 'back'} onPointerDown={startDrag} />}
            <img className="hair-dev-head-base" src={head.dataUrl} alt="Cabeça do modelo de referência" draggable={false} />
            {hairWorkspace?.front && <HairPiece side="front" asset={hairWorkspace.front} transform={hairWorkspace.transforms.front} head={head} selected={selectedSide === 'front'} onPointerDown={startDrag} />}
          </div>}
          {(loadingModels || loadingProject || loadingHair) && <span className="hair-dev-message">Carregando modelo e cabelos…</span>}
          {!loadingModels && !loadingProject && !head && <span className="hair-dev-message">{error || 'O modelo não tem uma peça chamada Cabeça.'}</span>}
          {head && !hairWorkspace?.front && !hairWorkspace?.back && !loadingHair && <span className="hair-dev-message">Envie a folha com o cabelo frontal em cima e o traseiro em baixo.</span>}
          <div className="hair-dev-zoom-tools"><button onClick={() => setZoom((value) => Math.min(3, value * 1.15))} aria-label="Aproximar" type="button">+</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.max(.5, value / 1.15))} aria-label="Afastar" type="button">−</button></div>
        </div>
        {(error || notice) && <div className={'hair-dev-status' + (error ? ' error' : '')} role={error ? 'alert' : 'status'}>{error || notice}</div>}
      </section>
      <section className="hair-dev-controls" aria-label="Controles de cabelo">
        <header><strong>Folha de cabelo</strong><small>Frontal na metade de cima · traseiro na metade de baixo</small></header>
        <button className="hair-dev-upload" onClick={() => fileInputRef.current?.click()} disabled={!head || loadingHair} type="button"><Icon name="plus" />{hairWorkspace?.front || hairWorkspace?.back ? 'Trocar folha de cabelo' : 'Enviar folha de cabelo'}</button>
        <input ref={fileInputRef} className="hair-dev-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void importSheet(event)} />
        <div className="hair-dev-part-tabs" role="tablist" aria-label="Parte do cabelo">
          {([{ id: 'front', label: 'Frontal · metade de cima' }, { id: 'back', label: 'Traseiro · metade de baixo' }] as const).map((part) => <button className={selectedSide === part.id ? 'active' : ''} key={part.id} onClick={() => setSelectedSide(part.id)} aria-pressed={selectedSide === part.id} disabled={!hairWorkspace?.[part.id]} type="button"><span>{part.label}</span><small>{hairWorkspace?.[part.id] ? 'Disponível' : 'Não importado'}</small></button>)}
        </div>
        {selectedAsset && selectedTransform ? <>
          <div className="hair-dev-control-title"><b>Cabelo {selectedSide === 'front' ? 'frontal' : 'traseiro'}</b><small>Arraste a parte selecionada na prévia.</small></div>
          <div className="hair-dev-position-grid">
            {([['x', 'Posição X'], ['y', 'Posição Y']] as const).map(([field, label]) => <label key={field}>{label}<input type="number" step="1" value={Math.round(selectedTransform[field])} onChange={(event) => changeTransform({ [field]: Number(event.target.value) })} /></label>)}
          </div>
          {([['scaleX', 'Largura · espremer/esticar'], ['scaleY', 'Altura · espremer/esticar']] as const).map(([field, label]) => <label className="hair-dev-range" key={field}><span><b>{label}</b><output>{Math.round(selectedTransform[field] * 100)}%</output></span><input type="range" min="10" max="500" step="1" value={Math.max(10, Math.min(500, Math.round(selectedTransform[field] * 100)))} onChange={(event) => changeTransform({ [field]: Number(event.target.value) / 100 })} /><input className="hair-dev-range-number" type="number" min="10" max="1000" step="1" aria-label={label + ' em porcentagem'} value={Math.round(selectedTransform[field] * 100)} onChange={(event) => changeTransform({ [field]: Math.max(.1, Math.min(10, Number(event.target.value) / 100)) })} /></label>)}
          <label className="hair-dev-range"><span><b>Rotação</b><output>{Math.round(selectedTransform.rotation)}°</output></span><input type="range" min="-180" max="180" step="1" value={Math.max(-180, Math.min(180, Math.round(selectedTransform.rotation)))} onChange={(event) => changeTransform({ rotation: Number(event.target.value) })} /></label>
          <button className="hair-dev-reset" onClick={resetSelectedTransform} type="button">Restaurar encaixe inicial</button>
        </> : <p className="hair-dev-empty">Envie a folha para selecionar e ajustar cada parte do cabelo separadamente.</p>}
      </section>
    </div>
  </section>
}

function HairPiece({ side, asset, transform, head, selected, onPointerDown }: { side: HairSide; asset: HairAsset; transform: HairTransform; head: ModelPart; selected: boolean; onPointerDown: (event: PointerEvent<HTMLImageElement>, side: HairSide) => void }) {
  const width = asset.width * transform.scaleX / head.width * 100
  const height = asset.height * transform.scaleY / head.height * 100
  return <img className={'hair-dev-piece hair-dev-piece-' + side + (selected ? ' selected' : '')} src={asset.dataUrl} alt={'Cabelo ' + (side === 'front' ? 'frontal' : 'traseiro')} draggable={false} onPointerDown={(event) => onPointerDown(event, side)} style={{ left: transform.x / head.width * 100 + '%', top: transform.y / head.height * 100 + '%', width: width + '%', height: height + '%', transform: 'translate(-50%, -50%) rotate(' + transform.rotation + 'deg)' }} />
}
