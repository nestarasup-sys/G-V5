import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { FaceComponentAsset, FaceComponentAssetSave, FaceComponentAssetSummary, FaceGuideSettings, FabricatorProject, FabricatorSlotSummary, FaceTransform } from '../../../../../shared/fabricator'
import { Icon } from '../../../ui/components/Icon'
import { usePreviewBackground } from '../usePreviewBackground'
import { normalizeEditableImageFile } from '../normalizeImage'
import './face-components.css'
import './head-extras.css'

const headPart = (model: FabricatorProject | null) => model?.parts.find((part) => /cabe[çc]a|head/i.test(part.name)) ?? null
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const initialExtraTransform = (head: NonNullable<ReturnType<typeof headPart>>, width: number, height: number): FaceTransform =>
  ({ x: head.width * .5, y: head.height * .25, scaleX: Math.min(.6, head.width * .55 / width), scaleY: Math.min(.35, head.height * .3 / height), rotation: 0 })
function normalizeExtraTransform(asset: FaceComponentAsset, head: NonNullable<ReturnType<typeof headPart>>): FaceTransform {
  const source = asset.defaultTransform
  const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback
  const maxWidth = head.width * 2
  const maxHeight = head.height * 2
  const width = clamp(finite(source.scaleX, 1) * asset.width, 0, maxWidth)
  const height = clamp(finite(source.scaleY, 1) * asset.height, 0, maxHeight)
  return {
    ...source,
    x: clamp(finite(source.x, head.width / 2), 0, head.width),
    y: clamp(finite(source.y, head.height / 4), 0, head.height),
    scaleX: width / Math.max(1, asset.width),
    scaleY: height / Math.max(1, asset.height),
    rotation: clamp(finite(source.rotation, 0), -180, 180)
  }
}
function sameTransform(a: FaceTransform, b: FaceTransform): boolean {
  return a.x === b.x && a.y === b.y && a.scaleX === b.scaleX && a.scaleY === b.scaleY && a.rotation === b.rotation && a.flipX === b.flipX
}
const GUIDE_STORAGE_KEY = 'gacha-nymi:rosto-dev-guides'
type FaceGuide = FaceGuideSettings
type PreviewDrag = { pointerId: number; assetId: string; startX: number; startY: number; startTransform: FaceTransform; currentTransform: FaceTransform; scale: number }
const defaultGuide: FaceGuide = { visible: true, verticalX: 50, horizontalY: 45, lowerHorizontalY: 65, angle: 12 }
function readSharedGuides(): Record<number, FaceGuide> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(GUIDE_STORAGE_KEY) ?? '{}') as Record<string, Partial<FaceGuide>>
    return Object.fromEntries(Object.entries(stored).filter(([slot, value]) => /^[1-9]\d*$/.test(slot) && Number(slot) <= 10 && value && typeof value === 'object').map(([slot, value]) => {
      const read = (candidate: unknown, fallback: number) => typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback
      const horizontalY = clamp(read(value.horizontalY, defaultGuide.horizontalY), 10, 90)
      return [Number(slot), { visible: value.visible !== false, verticalX: clamp(read(value.verticalX, defaultGuide.verticalX), 20, 80), horizontalY, lowerHorizontalY: Math.max(horizontalY + 1, clamp(read(value.lowerHorizontalY, defaultGuide.lowerHorizontalY), 11, 99)), angle: clamp(read(value.angle, defaultGuide.angle), -30, 30) }]
    }))
  } catch { return {} }
}
function HeadGuideOverlay({ head, guide }: { head: NonNullable<ReturnType<typeof headPart>>; guide: FaceGuide }) {
  const x = head.width * guide.verticalX / 100, y = head.height * guide.horizontalY / 100, lowerY = head.height * guide.lowerHorizontalY / 100
  return <svg className="face-components-guide-overlay" viewBox={`0 0 ${head.width} ${head.height}`} preserveAspectRatio="none" aria-hidden="true"><g transform={`rotate(${guide.angle} ${x} ${head.height / 2})`}>
    <line className="face-components-guide-halo" x1={x} y1={-head.height} x2={x} y2={head.height * 2} /><line className="face-components-guide-halo" x1={-head.width} y1={y} x2={head.width * 2} y2={y} /><line className="face-components-guide-halo" x1={-head.width} y1={lowerY} x2={head.width * 2} y2={lowerY} />
    <line className="face-components-guide-line" x1={x} y1={-head.height} x2={x} y2={head.height * 2} /><line className="face-components-guide-line" x1={-head.width} y1={y} x2={head.width * 2} y2={y} /><line className="face-components-guide-line" x1={-head.width} y1={lowerY} x2={head.width * 2} y2={lowerY} /><circle className="face-components-guide-center" cx={x} cy={y} r={2.4} />
  </g></svg>
}
function processHeadExtraImage(dataUrl: string): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./headExtraChroma.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<{ type: 'complete'; id: number; width: number; height: number; png: ArrayBuffer } | { type: 'error'; id: number; message: string }>) => {
      if (data.id !== 1) return
      worker.terminate()
      if (data.type === 'error') { reject(new Error(data.message)); return }
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('Não foi possível preparar a imagem processada.'))
      reader.onload = () => resolve({ dataUrl: String(reader.result), width: data.width, height: data.height })
      reader.readAsDataURL(new Blob([data.png], { type: 'image/png' }))
    }
    worker.onerror = () => { worker.terminate(); reject(new Error('Falha ao processar a imagem dos óculos.')) }
    worker.postMessage({ id: 1, dataUrl })
  })
}

/** Biblioteca de peças extras que se encaixam sobre a cabeça do modelo. */
export function HeadExtrasWorkspace() {
  const [previewBackground] = usePreviewBackground()
  const [models, setModels] = useState<FabricatorSlotSummary[]>([])
  const [modelSlot, setModelSlot] = useState(1)
  const [model, setModel] = useState<FabricatorProject | null>(null)
  const [assets, setAssets] = useState<FaceComponentAssetSummary[]>([])
  const [details, setDetails] = useState<Record<string, FaceComponentAsset>>({})
  const detailsRef = useRef(details)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const dragRef = useRef<PreviewDrag | null>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('Importe óculos ou outro extra para a cabeça.')
  const [guidesByModel, setGuidesByModel] = useState<Record<number, FaceGuide>>(readSharedGuides)
  const [guidesLoaded, setGuidesLoaded] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const head = useMemo(() => headPart(model), [model])
  const selected = selectedId ? details[selectedId] : undefined
  const guide = guidesByModel[modelSlot] ?? defaultGuide

  useEffect(() => {
    let cancelled = false
    void window.desktop.loadFaceGuides('face').then(async (saved) => {
      if (cancelled) return
      const next = saved ?? readSharedGuides()
      setGuidesByModel(next as Record<number, FaceGuide>)
      if (!saved) await window.desktop.saveFaceGuides('face', next)
      if (!cancelled) setGuidesLoaded(true)
    }).catch((reason) => { if (!cancelled) { setError(reason instanceof Error ? reason.message : String(reason)); setGuidesLoaded(true) } })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    try { window.localStorage.setItem(GUIDE_STORAGE_KEY, JSON.stringify(guidesByModel)) } catch { /* The app data copy remains authoritative. */ }
    if (guidesLoaded) void window.desktop.saveFaceGuides('face', guidesByModel).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [guidesByModel, guidesLoaded])

  function updateGuide(patch: Partial<FaceGuide>) {
    const next = { ...guidesByModel, [modelSlot]: { ...(guidesByModel[modelSlot] ?? defaultGuide), ...patch } }
    setGuidesByModel(next)
    try { window.localStorage.setItem(GUIDE_STORAGE_KEY, JSON.stringify(next)) } catch { /* The durable app data copy remains available. */ }
    if (guidesLoaded) void window.desktop.saveFaceGuides('face', next).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
  }

  useEffect(() => {
    void window.desktop.listFabricatorSlots().then((slots) => {
      setModels(slots)
      const first = slots.findIndex(Boolean)
      if (first >= 0) setModelSlot(first + 1)
    }).catch((reason) => setError(String(reason)))
  }, [])

  useEffect(() => {
    let cancelled = false
    setModel(null)
    void window.desktop.loadFabricatorSlot(modelSlot).then((project) => { if (!cancelled) setModel(project) }).catch((reason) => { if (!cancelled) setError(String(reason)) })
    return () => { cancelled = true }
  }, [modelSlot])

  useEffect(() => {
    let cancelled = false
    setAssets([])
    detailsRef.current = {}
    setDetails({})
    dragRef.current = null
    setDragging(false)
    setSelectedId(null)
    void window.desktop.listFaceComponentAssets(modelSlot).then(async (allSummaries) => {
      const summaries = allSummaries.filter((summary) => summary.kind === 'head-extra')
      const loaded = await Promise.all(summaries.map((summary) => window.desktop.loadFaceComponentAsset(modelSlot, summary.id)))
      if (cancelled) return
      const valid = loaded.filter((asset): asset is FaceComponentAsset => Boolean(asset?.kind === 'head-extra'))
      setAssets(summaries)
      const nextDetails = Object.fromEntries(valid.map((asset) => [asset.id, asset]))
      detailsRef.current = nextDetails
      setDetails(nextDetails)
      setSelectedId(valid[0]?.id ?? null)
      setNotice(valid.length ? `${valid.length} extra${valid.length === 1 ? '' : 's'} salvo${valid.length === 1 ? '' : 's'} neste modelo.` : 'Importe óculos ou outro extra para a cabeça.')
    }).catch((reason) => { if (!cancelled) setError(String(reason)) })
    return () => { cancelled = true }
  }, [modelSlot])

  async function importAsset(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !head) return
    setBusy(true); setError('')
    try {
      const canonical = await normalizeEditableImageFile(file)
      const image = await processHeadExtraImage(canonical.dataUrl)
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      const transform = initialExtraTransform(head, image.width, image.height)
      const asset: FaceComponentAssetSave = { schemaVersion: 1, id, modelSlot, kind: 'head-extra', name: file.name.replace(/\.[^.]+$/, '') || 'Óculos', width: image.width, height: image.height, defaultTransform: transform, updatedAt: now }
      await window.desktop.saveFaceComponentAsset(modelSlot, asset, image.dataUrl)
      window.dispatchEvent(new Event('fabricator:assets-updated'))
      const saved: FaceComponentAsset = { ...asset, dataUrl: image.dataUrl }
      setAssets((current) => [{ schemaVersion: 1, id, modelSlot, kind: 'head-extra', name: asset.name, width: image.width, height: image.height, updatedAt: now }, ...current])
      detailsRef.current = { ...detailsRef.current, [id]: saved }
      setDetails(detailsRef.current)
      setSelectedId(id); setNotice(`“${asset.name}” foi adicionado à biblioteca.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  async function updateAsset(patch: Partial<Pick<FaceComponentAsset, 'name'>> & { defaultTransform?: Partial<FaceTransform> }) {
    if (!selected) return
    const storedAsset = detailsRef.current[selected.id] ?? selected
    const currentHead = headPart(model)
    // Always merge edits onto the same bounded transform shown in the preview.
    // Older saved extras may contain extreme scale values from the previous controls.
    const currentAsset = currentHead && storedAsset.kind === 'head-extra'
      ? { ...storedAsset, defaultTransform: normalizeExtraTransform(storedAsset, currentHead) }
      : storedAsset
    const merged: FaceComponentAsset = { ...currentAsset, ...patch, defaultTransform: { ...currentAsset.defaultTransform, ...patch.defaultTransform }, updatedAt: new Date().toISOString() }
    const next: FaceComponentAsset = currentHead && merged.kind === 'head-extra' ? { ...merged, defaultTransform: normalizeExtraTransform(merged, currentHead) } : merged
    detailsRef.current = { ...detailsRef.current, [next.id]: next }
    setDetails(detailsRef.current)
    setAssets((current) => current.map((asset) => asset.id === next.id ? { ...asset, name: next.name, updatedAt: next.updatedAt } : asset))
    try {
      const { dataUrl, ...save } = next
      const queuedSave = saveQueueRef.current.catch(() => undefined).then(() => window.desktop.saveFaceComponentAsset(next.modelSlot, save, dataUrl))
      saveQueueRef.current = queuedSave
      await queuedSave
      window.dispatchEvent(new Event('fabricator:assets-updated'))
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  async function removeSelected() {
    if (!selected || !window.confirm(`Excluir “${selected.name}” desta biblioteca?`)) return
    setBusy(true); setError('')
    try {
      await window.desktop.deleteFaceComponentAsset(modelSlot, selected.id)
      const remaining = assets.filter((asset) => asset.id !== selected.id)
      setAssets(remaining)
      const nextDetails = { ...detailsRef.current }; delete nextDetails[selected.id]
      detailsRef.current = nextDetails; setDetails(nextDetails)
      setSelectedId(remaining[0]?.id ?? null); setNotice('Extra removido da biblioteca.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) => setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])
  const previewScale = head && stageSize.width > 0 && stageSize.height > 0
    ? Math.min((stageSize.width - 24) / head.width, (stageSize.height - 24) / head.height) * .9
    : 0
  function beginPreviewDrag(event: ReactPointerEvent<HTMLImageElement>) {
    if (!selected || !transform || !previewScale || busy) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, assetId: selected.id, startX: event.clientX, startY: event.clientY, startTransform: { ...transform }, currentTransform: { ...transform }, scale: previewScale }
    setDragging(true)
  }
  function movePreviewDrag(event: ReactPointerEvent<HTMLImageElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !head) return
    const next = { ...drag.startTransform,
      x: clamp(drag.startTransform.x + (event.clientX - drag.startX) / drag.scale, 0, head.width),
      y: clamp(drag.startTransform.y + (event.clientY - drag.startY) / drag.scale, 0, head.height) }
    drag.currentTransform = next
    const asset = detailsRef.current[drag.assetId]
    if (!asset) return
    detailsRef.current = { ...detailsRef.current, [drag.assetId]: { ...asset, defaultTransform: next } }
    setDetails(detailsRef.current)
  }
  function endPreviewDrag(event: ReactPointerEvent<HTMLImageElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
    void updateAsset({ defaultTransform: drag.currentTransform })
  }
  const transform = selected && head ? normalizeExtraTransform(selected, head) : selected?.defaultTransform
  useEffect(() => {
    if (!selected || !head || selected.kind !== 'head-extra') return
    const normalized = normalizeExtraTransform(selected, head)
    if (!sameTransform(selected.defaultTransform, normalized)) void updateAsset({ defaultTransform: normalized })
  }, [selected?.id, selected?.defaultTransform.x, selected?.defaultTransform.y, selected?.defaultTransform.scaleX, selected?.defaultTransform.scaleY, selected?.defaultTransform.rotation, selected?.defaultTransform.flipX, head?.width, head?.height])
  const previewStyle: CSSProperties | undefined = head && selected && transform ? {
    left: `${transform.x / head.width * 100}%`, top: `${transform.y / head.height * 100}%`,
    width: `${selected.width * transform.scaleX / head.width * 100}%`, height: `${selected.height * transform.scaleY / head.height * 100}%`,
    transform: `translate(-50%,-50%) rotate(${transform.rotation}deg) scaleX(${transform.flipX ? -1 : 1})`
  } : undefined
  const changeTransform = (key: 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation', percent: number) => {
    if (!selected || !head || !transform) return
    const boundedPercent = key === 'rotation' ? clamp(percent, -180, 180) : key === 'scaleX' || key === 'scaleY' ? clamp(percent, 0, 200) : clamp(percent, 0, 100)
    const values: Partial<FaceTransform> = key === 'x' ? { x: head.width * boundedPercent / 100 }
      : key === 'y' ? { y: head.height * boundedPercent / 100 }
        : key === 'scaleX' ? { scaleX: head.width * boundedPercent / 100 / Math.max(1, selected.width) }
          : key === 'scaleY' ? { scaleY: head.height * boundedPercent / 100 / Math.max(1, selected.height) }
            : { rotation: boundedPercent }
    void updateAsset({ defaultTransform: values })
  }

  return <section className="fabricator-workspace face-components-workspace head-extras-workspace" aria-label="Biblioteca Cabeças extra dev">
    <header className="face-components-toolbar"><label>Modelo<select value={modelSlot} disabled={busy} onChange={(event) => setModelSlot(Number(event.target.value))}>{models.map((entry, index) => entry && <option key={index + 1} value={index + 1}>Modelo {String(index + 1).padStart(2, '0')} · {entry.name}</option>)}</select></label><span>Importe uma peça e ajuste a posição sobre a cabeça</span></header>
    <div className="face-components-body">
      <aside className="face-components-library">
        <header><strong>Biblioteca</strong><small>{assets.length} assets</small></header>
        <div className="face-components-library-actions"><label className="head-extra-import"><Icon name="plus" /> Importar<input type="file" accept="image/png,image/jpeg,image/webp" disabled={!head || busy} onChange={(event) => void importAsset(event)} /></label><button type="button" onClick={() => void removeSelected()} disabled={!selected || busy}><Icon name="trash" /> Excluir</button></div>
        <nav className="face-components-library-tabs" aria-label="Categorias da biblioteca" role="tablist">
          <button type="button" role="tab" aria-selected="true" className="active">Óculos</button>
        </nav>
        <section className="face-components-library-category" role="tabpanel" aria-label="Óculos"><h3>Óculos <small>{assets.length}</small></h3><div className="face-components-assets">
          {assets.map((asset) => <button key={asset.id} className={asset.id === selectedId ? 'active' : ''} type="button" onClick={() => setSelectedId(asset.id)} title={asset.name}><img src={details[asset.id]?.dataUrl} alt="" /><span>{asset.name}</span></button>)}
          {!assets.length && <small>Nenhum óculos salvo para este modelo.</small>}
        </div></section>
      </aside>
      <main className="face-components-stage-column">
        <div className="face-components-stage" ref={stageRef} style={{ '--preview-background': previewBackground } as CSSProperties}>
          {head && previewScale > 0 && <div className="face-components-preview-canvas" style={{ width: head.width * previewScale, height: head.height * previewScale }}><img className="face-components-head" src={head.dataUrl} alt="Cabeça do modelo" />{selected && previewStyle && <img className={`face-component-layer face-component-layer-draggable${dragging ? ' is-dragging' : ''}`} src={selected.dataUrl} alt={selected.name} style={previewStyle} draggable={false} title="Arraste para posicionar os óculos" onPointerDown={beginPreviewDrag} onPointerMove={movePreviewDrag} onPointerUp={endPreviewDrag} onPointerCancel={endPreviewDrag} onLostPointerCapture={endPreviewDrag} />}{guide.visible && <HeadGuideOverlay head={head} guide={guide} />}</div>}
          {!head && <p className="head-extra-empty">Selecione um modelo que tenha uma peça de cabeça para visualizar os extras.</p>}
        </div><div className="face-components-stage-footer" aria-live="polite">{notice}</div>
      </main>
      <aside className="face-components-controls"><header><strong>Ajuste da peça</strong></header>
        {selected && transform ? <>
          <label className="head-extra-name">Nome<input value={selected.name} disabled={busy} onChange={(event) => void updateAsset({ name: event.target.value })} /></label>
          {([['x', 'Horizontal', transform.x / (head?.width ?? 1) * 100, 0, 100], ['y', 'Vertical', transform.y / (head?.height ?? 1) * 100, 0, 100], ['scaleX', 'Largura', selected.width * transform.scaleX / (head?.width ?? 1) * 100, 0, 200], ['scaleY', 'Altura', selected.height * transform.scaleY / (head?.height ?? 1) * 100, 0, 200], ['rotation', 'Rotação', transform.rotation, -180, 180]] as const).map(([key, label, value, min, max]) => <label className="head-extra-control" key={key}><span>{label}<output>{Math.round(clamp(value, min, max))}{key === 'rotation' ? '°' : '%'}</output></span><input type="range" min={min} max={max} step="1" value={clamp(value, min, max)} disabled={!head || busy} onChange={(event) => changeTransform(key, Number(event.target.value))} /></label>)}
          <button className="face-component-reset-transform" type="button" disabled={!head || busy} onClick={() => head && void updateAsset({ defaultTransform: initialExtraTransform(head, selected.width, selected.height) })}>Restaurar encaixe da peça</button>
        </> : <p className="head-extra-empty">Selecione ou importe uma peça para ajustar.</p>}
        <section className="face-components-guide-controls" aria-label="Guias de desenho compartilhadas"><header><strong>Guias de desenho</strong><label><input type="checkbox" checked={guide.visible} disabled={!guidesLoaded} onChange={(event) => updateGuide({ visible: event.target.checked })} /> Mostrar</label></header>
          <label>Inclinação do eixo <output>{guide.angle}°</output><input type="range" min="-30" max="30" step="1" value={guide.angle} disabled={!guide.visible || !guidesLoaded} onChange={(event) => updateGuide({ angle: Number(event.target.value) })} /></label>
          <label>Posição do eixo <output>{guide.verticalX}%</output><input type="range" min="20" max="80" step="1" value={guide.verticalX} disabled={!guide.visible || !guidesLoaded} onChange={(event) => updateGuide({ verticalX: Number(event.target.value) })} /></label>
          <label>Altura da linha superior <output>{guide.horizontalY}%</output><input type="range" min="10" max={Math.min(90, guide.lowerHorizontalY - 1)} step="1" value={guide.horizontalY} disabled={!guide.visible || !guidesLoaded} onChange={(event) => updateGuide({ horizontalY: Number(event.target.value) })} /></label>
          <label>Altura da linha inferior <output>{guide.lowerHorizontalY}%</output><input type="range" min={guide.horizontalY + 1} max="99" step="1" value={guide.lowerHorizontalY} disabled={!guide.visible || !guidesLoaded} onChange={(event) => updateGuide({ lowerHorizontalY: Number(event.target.value) })} /></label>
          <button type="button" disabled={!guidesLoaded} onClick={() => updateGuide(defaultGuide)}>Restaurar guias</button>
        </section>
      </aside>
    </div>{error && <div className="face-components-error" role="alert">{error}</div>}
  </section>
}
