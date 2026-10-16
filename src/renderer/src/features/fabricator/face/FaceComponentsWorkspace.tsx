import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import type { FaceComponentAsset, FaceComponentAssetSave, FaceComponentAssetSummary, FaceComponentKind, FaceTransform, FabricatorProject, FabricatorSlotSummary, ModelPart } from '../../../../../shared/fabricator'
import { Icon } from '../../../ui/components/Icon'
import { FaceWorkspace } from './FaceWorkspace'
import './face-components.css'

type PartId = 'eye-left' | 'eye-right' | 'pupil-left' | 'pupil-right' | 'brow-left' | 'brow-right'
const categories: Array<{ kind: FaceComponentKind; label: string; parts: [PartId, PartId]; names: [string, string] }> = [
  { kind: 'eye', label: 'Olhos', parts: ['eye-left', 'eye-right'], names: ['Olho esquerdo', 'Olho direito'] },
  { kind: 'pupil', label: 'Pupilas', parts: ['pupil-left', 'pupil-right'], names: ['Pupila esquerda', 'Pupila direita'] },
  { kind: 'eyebrow', label: 'Sobrancelhas', parts: ['brow-left', 'brow-right'], names: ['Sobrancelha esquerda', 'Sobrancelha direita'] }
]
const initialTransform = (kind: FaceComponentKind, head: ModelPart, width: number, height: number): FaceTransform => ({
  x: kind === 'pupil' ? 0 : head.width * (kind === 'eyebrow' ? .38 : .37),
  y: kind === 'pupil' ? 0 : head.height * (kind === 'eyebrow' ? .32 : .46),
  scaleX: kind === 'pupil' ? .35 : head.width * (kind === 'eyebrow' ? .16 : .19) / width,
  scaleY: kind === 'pupil' ? .35 : head.height * (kind === 'eyebrow' ? .12 : .17) / height,
  rotation: 0
})
const partCategory = (id: PartId) => categories.find((category) => category.parts.includes(id))!
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const readImage = async (file: File): Promise<{ dataUrl: string; width: number; height: number }> => {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width; canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Não foi possível abrir a imagem.')
  context.drawImage(bitmap, 0, 0); bitmap.close()
  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
}

export function FaceComponentsWorkspace() {
  const [models, setModels] = useState<FabricatorSlotSummary[]>([])
  const [modelSlot, setModelSlot] = useState(1)
  const [model, setModel] = useState<FabricatorProject | null>(null)
  const [assets, setAssets] = useState<FaceComponentAssetSummary[]>([])
  const [details, setDetails] = useState<Record<string, FaceComponentAsset>>({})
  const [selectedPart, setSelectedPart] = useState<PartId>('eye-left')
  const [selectedAssets, setSelectedAssets] = useState<Partial<Record<PartId, string>>>({})
  const [linked, setLinked] = useState<Record<FaceComponentKind, boolean>>({ eye: true, pupil: true, eyebrow: true })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('Importe assets PNG transparentes; o formato de folha pode ser definido depois.')
  const [showNoseMouthEditor, setShowNoseMouthEditor] = useState(false)
  const [openModal, setOpenModal] = useState<'import' | 'delete' | null>(null)
  const [markedForDeletion, setMarkedForDeletion] = useState<string[]>([])
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const head = useMemo(() => model?.parts.find((part) => /cabe[çc]a|head/i.test(part.name)) ?? null, [model])
  const previewScale = head && stageSize.width > 0 && stageSize.height > 0
    ? Math.min((stageSize.width - 24) / head.width, (stageSize.height - 24) / head.height) * .9
    : 0
  const selectedCategory = partCategory(selectedPart)
  const selectedId = selectedAssets[selectedPart] ?? (linked[selectedCategory.kind] && selectedPart.endsWith('right') ? selectedAssets[selectedCategory.parts[0]] : undefined)
  const selectedAsset = selectedId ? details[selectedId] : undefined

  useEffect(() => { void window.desktop.listFabricatorSlots().then((slots) => { setModels(slots); const first = slots.findIndex(Boolean); if (first >= 0) setModelSlot(first + 1) }).catch((reason) => setError(String(reason))) }, [])
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setStageSize((current) => current.width === width && current.height === height ? current : { width, height })
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [showNoseMouthEditor])
  useEffect(() => {
    if (!openModal) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) setOpenModal(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [openModal, busy])
  useEffect(() => {
    let active = true
    setModel(null); setAssets([]); setDetails({}); setSelectedAssets({})
    void Promise.all([window.desktop.loadFabricatorSlot(modelSlot), window.desktop.listFaceComponentAssets(modelSlot)]).then(async ([project, list]) => {
      const loaded = await Promise.all(list.map((entry) => window.desktop.loadFaceComponentAsset(modelSlot, entry.id)))
      if (!active) return
      setModel(project); setAssets(list); setDetails(Object.fromEntries(loaded.filter((item): item is FaceComponentAsset => Boolean(item)).map((item) => [item.id, item])))
    }).catch((reason) => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [modelSlot])

  async function importAsset(kind: FaceComponentKind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file || !head) return
    setBusy(true); setError('')
    try {
      const image = await readImage(file)
      const id = crypto.randomUUID()
      const activePart = partCategory(selectedPart).kind === kind ? selectedPart : categories.find((category) => category.kind === kind)!.parts[0]
      const asset: FaceComponentAssetSave = { schemaVersion: 1, id, modelSlot, kind, name: file.name.replace(/\.[^.]+$/, '').slice(0, 120) || categories.find((item) => item.kind === kind)!.label, width: image.width, height: image.height, defaultTransform: initialTransform(kind, head, image.width, image.height), updatedAt: new Date().toISOString() }
      await window.desktop.saveFaceComponentAsset(modelSlot, asset, image.dataUrl)
      const loaded = { ...asset, dataUrl: image.dataUrl }
      setDetails((current) => ({ ...current, [id]: loaded })); setAssets((current) => [asset, ...current]); setSelectedPart(activePart); setSelectedAssets((current) => ({ ...current, [activePart]: id }))
      setNotice(`${asset.name} salvo. Ajuste o encaixe na prévia do modelo.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) }
  }

  async function updateTransform(patch: Partial<FaceTransform>) {
    if (!selectedAsset) return
    const next: FaceComponentAsset = { ...selectedAsset, defaultTransform: { ...selectedAsset.defaultTransform, ...patch }, updatedAt: new Date().toISOString() }
    const { dataUrl, ...saved } = next
    setBusy(true); setError('')
    try { await window.desktop.saveFaceComponentAsset(modelSlot, saved, dataUrl); setDetails((current) => ({ ...current, [next.id]: next })); setAssets((current) => current.map((item) => item.id === next.id ? saved : item)) }
    catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }

  async function removeSelectedAssets() {
    if (markedForDeletion.length === 0) return
    setBusy(true)
    setError('')
    const removed: string[] = []
    try {
      for (const id of markedForDeletion) {
        await window.desktop.deleteFaceComponentAsset(modelSlot, id)
        removed.push(id)
      }
      setNotice(`${removed.length} ${removed.length === 1 ? 'peça excluída' : 'peças excluídas'} da biblioteca.`)
      setOpenModal(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally {
      if (removed.length > 0) {
        const removedIds = new Set(removed)
        setAssets((current) => current.filter((item) => !removedIds.has(item.id)))
        setDetails((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !removedIds.has(id))))
        setSelectedAssets((current) => Object.fromEntries(Object.entries(current).filter(([, id]) => !removedIds.has(id))))
        setMarkedForDeletion((current) => current.filter((id) => !removedIds.has(id)))
      }
      setBusy(false)
    }
  }

  function renderPart(id: PartId, mirror: boolean, overrides: Partial<Record<PartId, string>>) {
    if (!head) return null
    const category = partCategory(id)
    const assetId = overrides[id] ?? (mirror && linked[category.kind] ? overrides[category.parts[0]] : selectedAssets[id] ?? (id.endsWith('right') && linked[category.kind] ? selectedAssets[category.parts[0]] : undefined))
    const asset = assetId ? details[assetId] : undefined
    if (!asset) return null
    const transform = asset.defaultTransform
    const rightSide = id.endsWith('right')
    const eyeLinked = linked.eye
    const eyeId = rightSide && !eyeLinked ? selectedAssets['eye-right'] : selectedAssets['eye-left']
    const eyeAsset = category.kind === 'pupil' ? details[eyeId ?? ''] : undefined
    const eyeTransform = eyeAsset?.defaultTransform
    const eyeWidth = eyeAsset ? eyeAsset.width * eyeTransform!.scaleX : head.width * .19
    const eyeHeight = eyeAsset ? eyeAsset.height * eyeTransform!.scaleY : head.height * .17
    let localX = transform.x
    let localY = transform.y
    if (category.kind === 'pupil') {
      const eyeX = eyeTransform?.x ?? head.width * .37
      localX = (rightSide ? head.width - eyeX : eyeX) + (rightSide && linked.pupil ? -transform.x : transform.x)
      localY = (eyeTransform?.y ?? head.height * .46) + transform.y
    }
    const mirroredPosition = rightSide && category.kind !== 'pupil'
    const mirroredAsset = rightSide && linked[category.kind]
    const x = mirroredPosition ? head.width - localX : localX
    const shouldFlip = Boolean(mirroredAsset) !== Boolean(transform.flipX)
    const width = category.kind === 'pupil' ? eyeWidth * transform.scaleX : asset.width * transform.scaleX
    const height = category.kind === 'pupil' ? eyeHeight * transform.scaleY : asset.height * transform.scaleY
    const style: CSSProperties = { left: `${x / head.width * 100}%`, top: `${localY / head.height * 100}%`, width: `${width / head.width * 100}%`, height: `${height / head.height * 100}%`, transform: `translate(-50%,-50%) rotate(${transform.rotation * (mirroredPosition ? -1 : 1)}deg) scaleX(${shouldFlip ? -1 : 1})` }
    return <img key={`${id}-${assetId}`} className="face-component-layer" src={asset.dataUrl} alt={category.names[rightSide ? 1 : 0]} style={style} />
  }

  if (showNoseMouthEditor) return <div className="face-components-legacy-mode"><button type="button" onClick={() => setShowNoseMouthEditor(false)}>← Voltar para olhos, pupilas e sobrancelhas</button><FaceWorkspace /></div>

  return <section className="fabricator-workspace face-components-workspace" aria-label="Biblioteca de olhos, pupilas e sobrancelhas">
    <header className="face-components-toolbar"><label>Modelo<select value={modelSlot} disabled={busy} onChange={(event) => setModelSlot(Number(event.target.value))}>{models.map((entry, index) => entry && <option key={index + 1} value={index + 1}>Modelo {String(index + 1).padStart(2, '0')} · {entry.name}</option>)}</select></label><button type="button" onClick={() => setShowNoseMouthEditor(true)}>Editar nariz e boca</button></header>
    <div className="face-components-body">
      <aside className="face-components-library"><header><strong>Biblioteca</strong><small>{assets.length} assets</small></header><div className="face-components-library-actions"><button type="button" onClick={() => setOpenModal('import')} disabled={!head || busy}><Icon name="plus" /> Importar</button><button type="button" onClick={() => { setMarkedForDeletion([]); setOpenModal('delete') }} disabled={busy}><Icon name="trash" /> Excluir</button></div>{categories.map((category) => <section key={category.kind}><h3>{category.label}</h3><div className="face-components-assets">{assets.filter((asset) => asset.kind === category.kind).map((asset) => <button key={asset.id} className={selectedId === asset.id ? 'active' : ''} onClick={() => setSelectedAssets((current) => ({ ...current, [selectedPart]: asset.id }))} type="button"><img src={details[asset.id]?.dataUrl} alt="" /><span>{asset.name}</span></button>)}{!assets.some((asset) => asset.kind === category.kind) && <small>Nenhum asset salvo</small>}</div></section>)}</aside>
      <main className="face-components-stage-column"><nav className="face-components-part-tabs">{categories.flatMap((category) => category.parts.map((id, side) => <button key={id} className={selectedPart === id ? 'active' : ''} onClick={() => setSelectedPart(id)} type="button">{category.names[side]}</button>))}</nav><div className="face-components-stage" ref={stageRef}>{head && previewScale > 0 && <div className="face-components-preview-canvas" style={{ width: head.width * previewScale, height: head.height * previewScale }}><img className="face-components-head" src={head.dataUrl} alt="Cabeça do modelo" />{(['eye-left','eye-right','pupil-left','pupil-right','brow-left','brow-right'] as PartId[]).map((id) => renderPart(id, true, selectedAssets))}</div>}{!head && <span>Selecione um modelo com cabeça.</span>}</div><div className="face-components-stage-footer">{notice}</div></main>
      <aside className="face-components-controls"><header><strong>Ajuste da peça</strong></header>{categories.map((category) => <label className="face-component-link" key={category.kind}><input type="checkbox" checked={linked[category.kind]} onChange={(event) => setLinked((current) => ({ ...current, [category.kind]: event.target.checked }))} /> Espelhar lado direito · {category.label}</label>)}{selectedAsset ? <><strong className="face-component-selected-name">{selectedAsset.name}</strong>{(['x','y','scaleX','scaleY','rotation'] as const).map((field) => <label className="face-component-number" key={field}>{({ x:'Posição X', y:'Posição Y', scaleX:'Escala horizontal', scaleY:'Escala vertical', rotation:'Rotação' })[field]}<input type="number" step={field.startsWith('scale') ? .01 : 1} value={selectedAsset.defaultTransform[field]} onChange={(event) => { const value = Number(event.target.value); if (Number.isFinite(value)) void updateTransform({ [field]: field.startsWith('scale') ? clamp(value, .01, 20) : value }) }} /></label>)}</> : <p>Selecione uma peça ou importe um asset para ajustar.</p>}</aside>
    </div>{error && <div className={`face-components-error${openModal ? ' face-components-error-modal' : ''}`} role="alert">{error}</div>}
    {openModal && <div className="face-components-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setOpenModal(null) }}><div className="face-components-modal" role="dialog" aria-modal="true" aria-labelledby="face-components-modal-title"><header><div><strong id="face-components-modal-title">{openModal === 'import' ? 'Importar peças do rosto' : 'Excluir peças do rosto'}</strong><small>{openModal === 'import' ? 'Selecione o tipo e envie uma imagem para cada peça.' : 'Escolha as peças já importadas que deseja remover.'}</small></div><button type="button" aria-label="Fechar" disabled={busy} onClick={() => setOpenModal(null)}>×</button></header>{openModal === 'import' ? <div className="face-components-import-options">{categories.map((category) => <label className="face-components-import-option" key={category.kind}><span className="face-components-import-sheet"><span>1 peça</span></span><strong>{category.label}</strong><small>{category.kind === 'eyebrow' ? 'Uma sobrancelha por imagem' : `Um${category.kind === 'eye' ? ' olho' : 'a pupila'} por imagem; o lado direito pode ser espelhado.`}</small><span className="face-components-import-action"><Icon name="plus" /> Escolher imagem</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !head} onChange={(event) => void importAsset(category.kind, event)} /></label>)}</div> : <><div className="face-components-delete-list">{categories.map((category) => <section key={category.kind}><h3>{category.label}</h3>{assets.filter((asset) => asset.kind === category.kind).map((asset) => <label key={asset.id} className="face-components-delete-item"><input type="checkbox" checked={markedForDeletion.includes(asset.id)} disabled={busy} onChange={(event) => setMarkedForDeletion((current) => event.target.checked ? [...current, asset.id] : current.filter((id) => id !== asset.id))} /><img src={details[asset.id]?.dataUrl} alt="" /><span>{asset.name}</span></label>)}{!assets.some((asset) => asset.kind === category.kind) && <small>Nenhuma peça importada</small>}</section>)}</div><footer><span>{markedForDeletion.length} {markedForDeletion.length === 1 ? 'peça selecionada' : 'peças selecionadas'}</span><button type="button" className="face-components-delete-confirm" disabled={busy || markedForDeletion.length === 0} onClick={() => void removeSelectedAssets()}>Excluir selecionadas</button></footer></>}</div></div>}
  </section>
}
