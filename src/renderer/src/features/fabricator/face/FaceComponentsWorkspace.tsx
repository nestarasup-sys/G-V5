import { useEffect, useMemo, useState, type ChangeEvent, type CSSProperties } from 'react'
import type { FaceCatalogItem, FaceCatalogItemSummary, FaceComponentAsset, FaceComponentAssetSave, FaceComponentAssetSummary, FaceComponentKind, FaceTransform, FabricatorProject, FabricatorSlotSummary, ModelPart } from '../../../../../shared/fabricator'
import { Icon } from '../../../ui/components/Icon'
import { FaceWorkspace } from './FaceWorkspace'
import './face-components.css'

type PartId = 'eye-left' | 'eye-right' | 'pupil-left' | 'pupil-right' | 'brow-left' | 'brow-right'
type CatalogTab = 'eyes' | 'eyebrows' | 'mouth' | 'nose'
type FaceModal = 'import' | 'delete' | 'sheet-editor' | null
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
  const [faceCatalog, setFaceCatalog] = useState<FaceCatalogItemSummary[]>([])
  const [faceCatalogDetails, setFaceCatalogDetails] = useState<Record<string, FaceCatalogItem>>({})
  const [selectedPart, setSelectedPart] = useState<PartId>('eye-left')
  const [selectedAssets, setSelectedAssets] = useState<Partial<Record<PartId, string>>>({})
  const [linked, setLinked] = useState<Record<FaceComponentKind, boolean>>({ eye: true, pupil: true, eyebrow: true })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('Importe assets PNG transparentes; o formato de folha pode ser definido depois.')
  const [showNoseMouthEditor, setShowNoseMouthEditor] = useState(false)
  const [catalogTab, setCatalogTab] = useState<CatalogTab>('eyes')
  const [modal, setModal] = useState<FaceModal>(null)
  const [deleteSelection, setDeleteSelection] = useState<string[]>([])
  const [selectedLegacyId, setSelectedLegacyId] = useState<string | null>(null)
  const head = useMemo(() => model?.parts.find((part) => /cabe[çc]a|head/i.test(part.name)) ?? null, [model])
  const selectedCategory = partCategory(selectedPart)
  const selectedId = selectedAssets[selectedPart] ?? (linked[selectedCategory.kind] && selectedPart.endsWith('right') ? selectedAssets[selectedCategory.parts[0]] : undefined)
  const selectedAsset = selectedId && !selectedLegacyId && (catalogTab === 'eyes' ? selectedCategory.kind !== 'eyebrow' : catalogTab === 'eyebrows' && selectedCategory.kind === 'eyebrow') ? details[selectedId] : undefined

  useEffect(() => { void window.desktop.listFabricatorSlots().then((slots) => { setModels(slots); const first = slots.findIndex(Boolean); if (first >= 0) setModelSlot(first + 1) }).catch((reason) => setError(String(reason))) }, [])
  useEffect(() => {
    let active = true
    setModel(null); setAssets([]); setDetails({}); setSelectedAssets({}); setFaceCatalog([]); setFaceCatalogDetails({}); setSelectedLegacyId(null)
    void Promise.all([window.desktop.loadFabricatorSlot(modelSlot), window.desktop.listFaceComponentAssets(modelSlot), window.desktop.listFaceCatalog(modelSlot)]).then(async ([project, list, oldCatalog]) => {
      const loaded = await Promise.all(list.map((entry) => window.desktop.loadFaceComponentAsset(modelSlot, entry.id)))
      if (!active) return
      setModel(project); setAssets(list); setDetails(Object.fromEntries(loaded.filter((item): item is FaceComponentAsset => Boolean(item)).map((item) => [item.id, item])))
      setFaceCatalog(oldCatalog.filter((entry) => ['nose', 'mouth-closed', 'mouth-open'].includes(entry.category)))
    }).catch((reason) => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [modelSlot])

  async function openLegacyCatalogItem(summary: FaceCatalogItemSummary) {
    setSelectedLegacyId(summary.id)
    if (faceCatalogDetails[summary.id]) return
    const item = await window.desktop.loadFaceCatalogItem(summary.modelSlot, summary.id)
    if (item) setFaceCatalogDetails((current) => ({ ...current, [item.id]: item }))
  }

  async function refreshFaceCatalog() {
    const summaries = (await window.desktop.listFaceCatalog(modelSlot)).filter((entry) => ['nose', 'mouth-closed', 'mouth-open'].includes(entry.category))
    setFaceCatalog(summaries)
    setFaceCatalogDetails((current) => Object.fromEntries(Object.entries(current).filter(([id]) => summaries.some((item) => item.id === id))))
  }

  async function importLegacyCategory(category: 'nose' | 'mouth-closed') {
    setCatalogTab(category === 'nose' ? 'nose' : 'mouth')
    setModal('sheet-editor')
    setShowNoseMouthEditor(true)
  }

  async function confirmDeleteAssets() {
    if (!deleteSelection.length) return
    setBusy(true); setError('')
    try {
      for (const id of deleteSelection) {
        if (id.startsWith('component:')) await window.desktop.deleteFaceComponentAsset(modelSlot, id.slice(10))
        else await window.desktop.deleteFaceCatalogItem(modelSlot, id.slice(8))
      }
      const [nextComponents, nextCatalog] = await Promise.all([window.desktop.listFaceComponentAssets(modelSlot), window.desktop.listFaceCatalog(modelSlot)])
      const loaded = await Promise.all(nextComponents.map((entry) => window.desktop.loadFaceComponentAsset(modelSlot, entry.id)))
      setAssets(nextComponents); setDetails(Object.fromEntries(loaded.filter((item): item is FaceComponentAsset => Boolean(item)).map((item) => [item.id, item])))
      setFaceCatalog(nextCatalog.filter((entry) => ['nose', 'mouth-closed', 'mouth-open'].includes(entry.category)))
      setFaceCatalogDetails((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !deleteSelection.includes(`catalog:${id}`))))
      setSelectedAssets((current) => Object.fromEntries(Object.entries(current).filter(([, id]) => !deleteSelection.includes(`component:${id}`))))
      setSelectedLegacyId((current) => current && deleteSelection.includes(`catalog:${current}`) ? null : current)
      setDeleteSelection([]); setModal(null); setNotice('Peças selecionadas excluídas do catálogo.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) }
  }

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
      setCatalogTab(kind === 'eye' || kind === 'pupil' ? 'eyes' : 'eyebrows'); setModal(null)
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

  if (modal === 'sheet-editor' && showNoseMouthEditor) return <div className="face-sheet-editor-modal"><header><strong>Importar {catalogTab === 'nose' ? 'nariz' : 'boca'}</strong><button type="button" onClick={() => { setShowNoseMouthEditor(false); setModal(null); void refreshFaceCatalog() }}>Voltar para Rosto Dev</button></header><FaceWorkspace initialCategory={catalogTab === 'nose' ? 'nose' : 'mouth-closed'} /></div>

  const tabItems = catalogTab === 'eyes' ? assets.filter((item) => item.kind === 'eye' || item.kind === 'pupil') : catalogTab === 'eyebrows' ? assets.filter((item) => item.kind === 'eyebrow') : []
  const tabLegacyItems = catalogTab === 'nose' ? faceCatalog.filter((item) => item.category === 'nose') : catalogTab === 'mouth' ? faceCatalog.filter((item) => item.category.startsWith('mouth')) : []
  const selectedLegacy = selectedLegacyId ? faceCatalogDetails[selectedLegacyId] : undefined
  const selectedLegacyPart = selectedLegacy?.pieces.find((piece) => piece.sheet === selectedLegacy.category && piece.index === (selectedLegacy.category === 'nose' ? selectedLegacy.selectedNose : selectedLegacy.selectedExpression))
  const legacyTransform = selectedLegacy?.transforms[selectedLegacy.category === 'nose' ? 'nose' : 'mouth']
  const tabNames: Array<[CatalogTab,string]> = [['eyes','Olhos'],['eyebrows','Sobrancelhas'],['mouth','Boca'],['nose','Nariz']]
  const allDeleteItems = [...assets.map((item) => ({ id:`component:${item.id}`, label:item.name, type: item.kind === 'pupil' ? 'Pupila' : item.kind === 'eye' ? 'Olho' : 'Sobrancelha' })), ...faceCatalog.filter((item) => !item.id.startsWith('legacy_')).map((item) => ({ id:`catalog:${item.id}`, label:item.name, type:item.category === 'nose' ? 'Nariz' : 'Boca' }))]

  return <section className="fabricator-workspace face-components-workspace" aria-label="Rosto Dev">
    <aside className="face-components-left">
      <div className="face-components-actions"><button type="button" onClick={() => setModal('import')}><Icon name="plus" /> Importar</button><button className="delete" type="button" onClick={() => setModal('delete')}><Icon name="trash" /> Excluir</button></div>
      <h2>Catálogo</h2>
      <nav className="face-components-category-tabs" aria-label="Categorias do rosto">{tabNames.map(([id,label]) => <button key={id} type="button" className={catalogTab === id ? 'active' : ''} onClick={() => { setCatalogTab(id); setSelectedLegacyId(null); if (id === 'eyes') setSelectedPart('eye-left'); if (id === 'eyebrows') setSelectedPart('brow-left') }}>{label}</button>)}</nav>
      <div className="face-components-catalog-list">
        {tabItems.map((asset) => <button key={asset.id} type="button" className={selectedId === asset.id ? 'selected' : ''} onClick={() => { const kind = asset.kind; const part: PartId = selectedCategory.kind === kind ? selectedPart : kind === 'eye' ? 'eye-left' : kind === 'pupil' ? 'pupil-left' : 'brow-left'; setSelectedPart(part); setSelectedAssets((current) => ({ ...current, [part]: asset.id })); setSelectedLegacyId(null) }}><img src={details[asset.id]?.dataUrl} alt="" /><span>{asset.kind === 'pupil' ? 'Pupila' : asset.kind === 'eye' ? 'Olho' : 'Sobrancelha'} · {asset.name}</span></button>)}
        {tabLegacyItems.map((item) => <button key={item.id} type="button" className={selectedLegacyId === item.id ? 'selected' : ''} onClick={() => void openLegacyCatalogItem(item)}><span className="face-components-catalog-placeholder">{item.category === 'nose' ? 'Nariz' : 'Boca'}</span><span>{item.name}<small>{item.pieceCount} peças</small></span></button>)}
        {!tabItems.length && !tabLegacyItems.length && <p>Este catálogo ainda está vazio. Use Importar para adicionar peças.</p>}
      </div>
    </aside>
    <main className="face-components-stage-column"><div className="face-components-model"><strong>Prévia do Modelo</strong></div><div className="face-components-stage" style={head ? { aspectRatio: `${head.width}/${head.height}` } : undefined}>{head && <img className="face-components-head" src={head.dataUrl} alt="Cabeça do modelo" />}{(['eye-left','eye-right','pupil-left','pupil-right','brow-left','brow-right'] as PartId[]).map((id) => renderPart(id, true, selectedAssets))}{selectedLegacyPart && legacyTransform && head && <img className="face-component-layer" src={selectedLegacyPart.dataUrl} alt={selectedLegacy.category === 'nose' ? 'Nariz selecionado' : 'Boca selecionada'} style={{ left:`${legacyTransform.x/head.width*100}%`,top:`${legacyTransform.y/head.height*100}%`,width:`${selectedLegacyPart.width*legacyTransform.scaleX/head.width*100}%`,height:`${selectedLegacyPart.height*legacyTransform.scaleY/head.height*100}%`,transform:`translate(-50%,-50%) rotate(${legacyTransform.rotation}deg)` }} />}{!head && <span>Selecione um modelo com cabeça.</span>}</div><div className="face-components-stage-footer">{notice}</div></main>
    <aside className="face-components-controls"><header><strong>Controles</strong></header><label className="face-controls-model">Modelo<select value={modelSlot} disabled={busy} onChange={(event) => setModelSlot(Number(event.target.value))}>{models.map((entry,index) => entry && <option key={index+1} value={index+1}>Modelo {index+1} · {entry.name}</option>)}</select></label><label className="face-controls-model">Peça a ajustar<select value={selectedPart} onChange={(event) => { setSelectedPart(event.target.value as PartId); setSelectedLegacyId(null) }}>{categories.flatMap((category) => category.parts.map((id,side) => <option key={id} value={id}>{category.names[side]}</option>))}</select></label><h3>Espelhar lados</h3>{categories.map((category) => <label className="face-component-link" key={category.kind}><input type="checkbox" checked={linked[category.kind]} onChange={(event) => setLinked((current) => ({ ...current, [category.kind]: event.target.checked }))} /> {category.label} direito acompanha o esquerdo</label>)}{selectedAsset ? <><strong className="face-component-selected-name">Peça: {selectedAsset.name}</strong>{(['x','y','scaleX','scaleY','rotation'] as const).map((field) => <label className="face-component-number" key={field}>{({ x:'Mover para os lados', y:'Mover para cima ou baixo', scaleX:'Largura', scaleY:'Altura', rotation:'Inclinação' })[field]}<input type="range" min={field.startsWith('scale') ? .1 : field === 'rotation' ? -180 : 0} max={field.startsWith('scale') ? 4 : field === 'rotation' ? 180 : field === 'x' ? head?.width ?? 1000 : head?.height ?? 1000} step={field.startsWith('scale') ? .01 : 1} value={selectedAsset.defaultTransform[field]} onChange={(event) => { const value = Number(event.target.value); void updateTransform({ [field]: field.startsWith('scale') ? clamp(value, .1, 4) : value }) }} /><output>{field.startsWith('scale') ? `${Math.round(selectedAsset.defaultTransform[field]*100)}%` : Math.round(selectedAsset.defaultTransform[field])}</output></label>)}</> : selectedLegacy ? <><strong className="face-component-selected-name">{selectedLegacy.name}</strong><p>Para ajustar esta folha, use o botão Importar e abra o editor de boca/nariz.</p><button className="face-open-sheet-editor" type="button" onClick={() => { setCatalogTab(selectedLegacy.category === 'nose' ? 'nose' : 'mouth'); setShowNoseMouthEditor(true); setModal('sheet-editor') }}>Abrir editor de folha</button></> : <p>Escolha uma peça no catálogo. Depois use as barras para mover, redimensionar ou inclinar.</p>}</aside>
    {error && <div className="face-components-error" role="alert">{error}</div>}
    {modal === 'import' && <div className="face-components-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null) }}><section className="face-components-modal" role="dialog" aria-modal="true" aria-labelledby="face-import-title"><header><h2 id="face-import-title">O que você quer importar?</h2><button type="button" onClick={() => setModal(null)}>Fechar</button></header><div className="face-components-import-options">{categories.map((category) => <label key={category.kind}><strong>{category.kind === 'eye' ? 'Olhos' : category.kind === 'pupil' ? 'Pupilas' : 'Sobrancelhas'}</strong><span>Escolher imagem transparente</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !head} onChange={(event) => void importAsset(category.kind,event)} /></label>)}<button type="button" onClick={() => void importLegacyCategory('mouth-closed')}>Importar boca<span>Folha de expressões</span></button><button type="button" onClick={() => void importLegacyCategory('nose')}>Importar nariz<span>Folha de narizes</span></button></div></section></div>}
    {modal === 'delete' && <div className="face-components-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null) }}><section className="face-components-modal face-components-delete-modal" role="dialog" aria-modal="true" aria-labelledby="face-delete-title"><header><h2 id="face-delete-title">Escolha as peças para excluir</h2><button type="button" onClick={() => setModal(null)}>Fechar</button></header><div className="face-components-delete-list">{allDeleteItems.map((item) => <label key={item.id}><input type="checkbox" checked={deleteSelection.includes(item.id)} onChange={(event) => setDeleteSelection((current) => event.target.checked ? [...current,item.id] : current.filter((id) => id !== item.id))} /><span>{item.label}</span><small>{item.type}</small></label>)}{!allDeleteItems.length && <p>Não há peças salvas para excluir.</p>}</div><footer><button type="button" onClick={() => setModal(null)}>Cancelar</button><button className="danger" type="button" disabled={!deleteSelection.length || busy} onClick={() => void confirmDeleteAssets()}>Excluir {deleteSelection.length ? `(${deleteSelection.length})` : ''}</button></footer></section></div>}
  </section>
}
