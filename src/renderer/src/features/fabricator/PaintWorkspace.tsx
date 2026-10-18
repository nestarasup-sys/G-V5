import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PaintAsset } from '../../../../shared/paint'
import { Icon } from '../../ui/components/Icon'
import './paint.css'

type Tool = 'brush' | 'eraser' | 'edge' | 'picker' | 'magic'
const sections = ['Modelos Dev', 'Roupas Dev 2.0', 'Cabeças extra Dev', 'Cabelos Dev', 'Olhos Dev', 'Rosto Dev']
const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = url })
function copyLabel(asset: PaintAsset, assets: PaintAsset[], index: number): string {
  const side = asset.catalogSide === 'left' ? 'E' : asset.catalogSide === 'right' ? 'D' : ''
  const sameSide = side ? assets.filter((item) => item.catalogSide === asset.catalogSide) : []
  if (side && sameSide.length > 1) return `${side}${sameSide.filter((item) => assets.indexOf(item) <= index).length}`
  return side || (asset.catalogSide === 'front' ? 'F' : asset.catalogSide === 'back' ? 'T' : asset.catalogSide === 'fringe' ? 'Fr' : `${index + 1}`)
}
function trimTransparentEdge(canvas: HTMLCanvasElement, center: { x: number; y: number; radius: number }): void {
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  const left = Math.max(0, Math.floor(center.x - center.radius - 1))
  const top = Math.max(0, Math.floor(center.y - center.radius - 1))
  const right = Math.min(canvas.width, Math.ceil(center.x + center.radius + 1))
  const bottom = Math.min(canvas.height, Math.ceil(center.y + center.radius + 1))
  const image = context.getImageData(left, top, right - left, bottom - top)
  const { data } = image
  const w = image.width; const h = image.height
  const previous = new Uint8ClampedArray(data)
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const imageX = left + x; const imageY = top + y
    if ((imageX - center.x) ** 2 + (imageY - center.y) ** 2 > center.radius ** 2) continue
    const offset = (y * w + x) * 4 + 3
    if (!previous[offset]) continue
    if (imageX === 0 || imageY === 0 || imageX === canvas.width - 1 || imageY === canvas.height - 1 || !previous[offset - 4] || !previous[offset + 4] || !previous[offset - w * 4] || !previous[offset + w * 4]) data[offset] = 0
  }
  context.putImageData(image, left, top)
}

function magicErase(canvas: HTMLCanvasElement, x: number, y: number, tolerance: number): void {
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const w = image.width; const h = image.height
  const start = Math.floor(y) * w + Math.floor(x)
  if (start < 0 || start >= w * h) return
  const offset = start * 4; const source = image.data.slice(offset, offset + 4)
  if (source[3] === 0) return
  const seen = new Uint8Array(w * h); const queue = [start]; seen[start] = 1
  for (let index = 0; index < queue.length; index += 1) {
    const pixel = queue[index]; const at = pixel * 4
    if (Math.abs(source[0] - image.data[at]) > tolerance || Math.abs(source[1] - image.data[at + 1]) > tolerance || Math.abs(source[2] - image.data[at + 2]) > tolerance || Math.abs(source[3] - image.data[at + 3]) > tolerance) continue
    image.data[at + 3] = 0
    const px = pixel % w
    for (const neighbor of [px > 0 ? pixel - 1 : -1, px < w - 1 ? pixel + 1 : -1, pixel >= w ? pixel - w : -1, pixel < w * (h - 1) ? pixel + w : -1]) if (neighbor >= 0 && !seen[neighbor]) { seen[neighbor] = 1; queue.push(neighbor) }
  }
  context.putImageData(image, 0, 0)
}

export function PaintWorkspace() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const undoRef = useRef<string[]>([])
  const redoRef = useRef<string[]>([])
  const currentId = useRef<string | null>(null)
  const [assets, setAssets] = useState<PaintAsset[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null)
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const [category, setCategory] = useState('all')
  const [query, setQuery] = useState('')
  const [tool, setTool] = useState<Tool>('brush')
  const [color, setColor] = useState('#ef4b83')
  const [size, setSize] = useState(12)
  const [opacity, setOpacity] = useState(100)
  const [tolerance, setTolerance] = useState(32)
  const [zoom, setZoom] = useState(1)
  const [compare, setCompare] = useState(false)
  const [original, setOriginal] = useState('')
  const [hash, setHash] = useState('')
  const [dirty, setDirty] = useState(false)
  const [edited, setEdited] = useState(false)
  const [, setHistoryVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => setAssets(await window.desktop.listPaintAssets()), [])
  useEffect(() => { void refresh().catch((error) => setMessage(String(error))) }, [refresh])
  const groups = useMemo(() => {
    const grouped = new Map<string, { id: string; name: string; category: string; location: string; items: PaintAsset[] }>()
    for (const asset of assets) {
      if ((category !== 'all' && asset.section !== category) || !`${asset.name} ${asset.location} ${asset.groupName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) continue
      const group = grouped.get(asset.groupId) ?? { id: asset.groupId, name: asset.groupName, category: asset.category, location: asset.location, items: [] }
      group.items.push(asset); grouped.set(asset.groupId, group)
    }
    return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))
  }, [assets, category, query])
  const groupItems = useMemo(() => groups.find((group) => group.id === selectedGroup)?.items ?? [], [groups, selectedGroup])
  const catalogItems = useMemo(() => {
    const parent = new Map(groupItems.map((asset) => [asset.id, asset.id]))
    const find = (id: string): string => { const root = parent.get(id) ?? id; if (root === id) return root; const resolved = find(root); parent.set(id, resolved); return resolved }
    const unionBy = (keyOf: (asset: PaintAsset) => string) => {
      const first = new Map<string, string>()
      for (const asset of groupItems) {
        const key = keyOf(asset); const known = first.get(key)
        if (known) parent.set(find(asset.id), find(known)); else first.set(key, asset.id)
      }
    }
    unionBy((asset) => `pair:${asset.catalogId}`)
    unionBy((asset) => `image:${asset.fingerprint}`)
    const grouped = new Map<string, { id: string; name: string; assets: PaintAsset[] }>()
    for (const asset of groupItems) {
      const id = find(asset.id)
      const item = grouped.get(id) ?? { id, name: asset.catalogName, assets: [] }
      item.assets.push(asset); grouped.set(id, item)
    }
    const sideOrder = { left: 0, right: 1, front: 0, back: 1, fringe: 2 }
    return [...grouped.values()].map((item) => {
      const assets = item.assets.sort((a, b) => (sideOrder[a.catalogSide ?? 'left'] ?? 3) - (sideOrder[b.catalogSide ?? 'left'] ?? 3))
      const visuals = [...new Map(assets.map((asset) => [asset.fingerprint, { id: asset.fingerprint, assets: assets.filter((candidate) => candidate.fingerprint === asset.fingerprint) }])).values()]
      return { ...item, assets, visuals }
    }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }))
  }, [groupItems])
  useEffect(() => {
    if (!groups.some((group) => group.id === selectedGroup)) setSelectedGroup(groups[0]?.id ?? null)
  }, [groups, selectedGroup])
  useEffect(() => {
    let active = true
    void Promise.all(groupItems.map(async (asset) => {
      try { return [asset.id, await window.desktop.createPaintThumbnail(asset.id)] as const } catch { return [asset.id, ''] as const }
    })).then((entries) => { if (active) setThumbnails((current) => ({ ...current, ...Object.fromEntries(entries) })) })
    return () => { active = false }
  }, [groupItems])

  const snapshot = () => canvasRef.current?.toDataURL('image/png') ?? ''
  const restore = useCallback(async (url: string) => {
    const image = await loadImage(url)
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    canvas.getContext('2d')!.drawImage(image, 0, 0)
  }, [])
  const select = useCallback(async (id: string) => {
    if (dirty && !window.confirm('Descartar alterações ainda não salvas nesta peça?')) return
    currentId.current = id; setSelected(id); setBusy(true); setMessage(''); setCompare(false)
    try {
      const doc = await window.desktop.loadPaintAsset(id)
      if (currentId.current !== id) return
      await restore(doc.currentDataUrl)
      setOriginal(doc.originalDataUrl); setHash(doc.sourceHash); setEdited(doc.edited)
      undoRef.current = []; redoRef.current = []; setHistoryVersion((value) => value + 1); setDirty(false)
    } catch (error) { setMessage(`Não foi possível abrir a peça: ${String(error)}`) }
    finally { if (currentId.current === id) setBusy(false) }
  }, [dirty, restore])
  const selectGroup = (id: string) => {
    if (dirty && !window.confirm('Descartar alterações ainda não salvas nesta peça?')) return
    setDirty(false); setSelected(null); currentId.current = null; setSelectedGroup(id); setCompare(false)
  }

  const checkpoint = () => { const state = snapshot(); if (state) { undoRef.current.push(state); if (undoRef.current.length > 40) undoRef.current.shift(); redoRef.current = []; setHistoryVersion((value) => value + 1) } }
  const undo = useCallback(async () => { const previous = undoRef.current.pop(); if (!previous) return; redoRef.current.push(snapshot()); await restore(previous); setDirty(true); setHistoryVersion((value) => value + 1) }, [restore])
  const redo = useCallback(async () => { const next = redoRef.current.pop(); if (!next) return; undoRef.current.push(snapshot()); await restore(next); setDirty(true); setHistoryVersion((value) => value + 1) }, [restore])
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z' || event.target instanceof HTMLInputElement) return
      event.preventDefault(); void (event.shiftKey ? redo() : undo())
    }
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard)
  }, [undo, redo])

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => { const rect = event.currentTarget.getBoundingClientRect(); return { x: (event.clientX - rect.left) * event.currentTarget.width / rect.width, y: (event.clientY - rect.top) * event.currentTarget.height / rect.height } }
  const stroke = (x: number, y: number, fromX: number, fromY: number) => {
    const canvas = canvasRef.current!; const context = canvas.getContext('2d')!
    if (tool === 'edge') {
      const steps = Math.max(1, Math.ceil(Math.hypot(x - fromX, y - fromY) / Math.max(1, size / 3)))
      for (let index = 0; index <= steps; index += 1) trimTransparentEdge(canvas, { x: fromX + (x - fromX) * index / steps, y: fromY + (y - fromY) * index / steps, radius: size / 2 })
      return
    }
    context.save(); context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
    context.globalAlpha = opacity / 100; context.strokeStyle = tool === 'eraser' ? '#000' : color
    context.fillStyle = context.strokeStyle; context.lineWidth = size; context.lineCap = 'round'; context.lineJoin = 'round'
    context.beginPath(); context.moveTo(fromX, fromY); context.lineTo(x, y); context.stroke()
    context.beginPath(); context.arc(x, y, size / 2, 0, Math.PI * 2); context.fill(); context.restore()
  }
  const start = (event: React.PointerEvent<HTMLCanvasElement>) => { if (busy || compare || event.button !== 0) return; const p = point(event); if (tool === 'picker') { const pixel = event.currentTarget.getContext('2d')!.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data; setColor(`#${Array.from(pixel.slice(0, 3), (value) => value.toString(16).padStart(2, '0')).join('')}`); setTool('brush'); return } checkpoint(); if (tool === 'magic') { magicErase(event.currentTarget, p.x, p.y, tolerance); setDirty(true); return } drawing.current = { pointerId: event.pointerId, ...p }; event.currentTarget.setPointerCapture(event.pointerId); stroke(p.x, p.y, p.x, p.y); setDirty(true) }
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => { if (drawing.current?.pointerId !== event.pointerId) return; const p = point(event); stroke(p.x, p.y, drawing.current.x, drawing.current.y); drawing.current = { pointerId: event.pointerId, ...p } }
  const stop = () => { drawing.current = null }

  const save = async () => {
    if (!selected || !hash) return
    setBusy(true); setMessage('')
    try {
      await window.desktop.savePaintAsset(selected, hash, snapshot())
      setDirty(false); setEdited(true); await refresh()
      setThumbnails((current) => ({ ...current, [selected]: '' }))
      const thumbnail = await window.desktop.createPaintThumbnail(selected)
      setThumbnails((current) => ({ ...current, [selected]: thumbnail }))
      window.dispatchEvent(new Event('fabricator:assets-updated')); setMessage('Edição salva.')
    } catch (error) { setMessage(`Falha ao salvar: ${String(error)}`) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!selected || !original || !window.confirm('Remover a edição desta peça e voltar ao original?')) return
    setBusy(true)
    try {
      await window.desktop.removePaintEdit(selected); await restore(original); setEdited(false); setDirty(false)
      undoRef.current = []; redoRef.current = []; setHistoryVersion((value) => value + 1); await refresh()
      const thumbnail = await window.desktop.createPaintThumbnail(selected)
      setThumbnails((current) => ({ ...current, [selected]: thumbnail }))
      window.dispatchEvent(new Event('fabricator:assets-updated')); setMessage('Edição removida. Original restaurado.')
    } catch (error) { setMessage(String(error)) } finally { setBusy(false) }
  }

  return <section className="fabricator-workspace paint-workspace" aria-label="Paint Nymi">
    <header className="paint-heading"><span><strong>Paint Nymi</strong><small>Edite pixels sem alterar a imagem original</small></span><div><button disabled={!selected || !dirty || busy} onClick={() => void save()}><Icon name="save" /> Salvar edição</button><button disabled={!selected || (!edited && !dirty) || busy} onClick={() => void remove()}><Icon name="reset" /> Remover edição</button></div></header>
    <div className="paint-body">
      <aside className="paint-groups-panel">
        <header><strong>Conjuntos</strong><small>{groups.length} conjunto(s)</small></header>
        <div className="paint-library-controls"><input aria-label="Buscar conjunto ou peça" placeholder="Buscar conjunto…" value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label="Área" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">Todas as áreas</option>{sections.map((section) => <option key={section} value={section}>{section}</option>)}</select><button onClick={() => void refresh()}><Icon name="reset" /> Atualizar</button></div>
        <div className="paint-group-list">{groups.map((group) => <button key={group.id} className={selectedGroup === group.id ? 'active' : ''} onClick={() => selectGroup(group.id)}><span className="paint-group-icon"><Icon name={group.category === 'models' || group.category === 'animations' ? 'body' : group.category === 'wardrobe' ? 'shirt' : group.category === 'hair' ? 'bow' : 'face'} /></span><span><strong title={group.name}>{group.name}</strong><small>{group.items.length} peça(s)</small></span><Icon name="chevronRight" /></button>)}{!groups.length && <p>Nenhum conjunto encontrado.</p>}</div>
      </aside>
      <aside className="paint-catalog-panel"><header><strong>{groups.find((group) => group.id === selectedGroup)?.name ?? 'Catálogo'}</strong><small>{groupItems.length} arquivo(s) · {catalogItems.length} item(ns)</small></header><div className="paint-piece-grid">{catalogItems.map((item) => <article className="paint-catalog-item" key={item.id}><strong title={item.name}>{item.name}{item.assets.length > 1 && <small className="paint-duplicate-count">{item.assets.length} arquivos relacionados</small>}</strong><div className={`paint-catalog-item-assets${item.visuals.length > 1 ? ' paired' : ''}`}>{item.visuals.map((visual) => <div className="paint-visual-group" key={visual.id}><button className="paint-visual-image" onClick={() => void select(visual.assets[0].id)} title={visual.assets.map((asset) => asset.name).join(' / ')}><span className="paint-piece-image">{thumbnails[visual.assets[0].id] ? <img src={thumbnails[visual.assets[0].id]} alt="" /> : <Icon name="frame" />}</span><small>{visual.assets.length > 1 ? `${visual.assets.length} imagens iguais` : visual.assets[0].catalogSide === 'left' ? 'Esquerda' : visual.assets[0].catalogSide === 'right' ? 'Direita' : visual.assets[0].catalogSide === 'front' ? 'Frente' : visual.assets[0].catalogSide === 'back' ? 'Trás' : visual.assets[0].catalogSide === 'fringe' ? 'Franja' : visual.assets[0].edited ? 'Editado' : 'Original'}</small></button>{visual.assets.length > 1 && <div className="paint-duplicate-selectors">{visual.assets.map((asset, index) => <button key={asset.id} aria-pressed={selected === asset.id} onClick={() => void select(asset.id)} title={asset.name}>{copyLabel(asset, visual.assets, index)}</button>)}</div>}</div>)}</div></article>)}{!catalogItems.length && <p>Escolha um conjunto para ver as peças.</p>}</div></aside>
    <div className="paint-editor"><div className="paint-toolbar"><div className="paint-tool-row"><button className={tool === 'brush' ? 'active' : ''} onClick={() => setTool('brush')} title="Pincel"><Icon name="brush" /> Pincel</button><button className={tool === 'eraser' ? 'active' : ''} onClick={() => setTool('eraser')} title="Borracha"><Icon name="eraser" /> Borracha</button><button className={tool === 'edge' ? 'active' : ''} onClick={() => setTool('edge')} title="Arraste sobre as bordas da imagem para limpar o contorno"><Icon name="eraser" /> Remover bordas</button><button className={tool === 'magic' ? 'active' : ''} onClick={() => setTool('magic')} title="Remove a região de cor parecida conectada ao clique">Borracha mágica</button><button className={tool === 'picker' ? 'active' : ''} onClick={() => setTool('picker')} title="Escolher cor da imagem">Conta-gotas</button><button disabled={!undoRef.current.length} onClick={() => void undo()} title="Desfazer"><Icon name="undo" /></button><button disabled={!redoRef.current.length} onClick={() => void redo()} title="Refazer"><Icon name="redo" /></button></div><div className="paint-tool-row"><label>Cor <input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label><label>Tamanho {size}px <input type="range" min="1" max="100" value={size} onChange={(event) => setSize(Number(event.target.value))} /></label><label>Opacidade {opacity}% <input type="range" min="1" max="100" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /></label><label>Tolerância {tolerance} <input type="range" min="0" max="100" value={tolerance} onChange={(event) => setTolerance(Number(event.target.value))} /></label><label>Zoom {Math.round(zoom * 100)}% <input type="range" min="0.25" max="6" step="0.25" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label><button disabled={!selected} onPointerDown={() => setCompare(true)} onPointerUp={() => setCompare(false)} onPointerLeave={() => setCompare(false)}>Ver original</button></div></div>
    <div className="paint-stage"><div className="paint-canvas-wrap" style={{ display: selected ? undefined : 'none', width: canvasRef.current?.width ? canvasRef.current.width * zoom : undefined, height: canvasRef.current?.height ? canvasRef.current.height * zoom : undefined }}><canvas ref={canvasRef} style={{ visibility: compare ? 'hidden' : 'visible' }} onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} />{compare && <img src={original} alt="Imagem original" />}</div>{!selected && <p>Selecione uma peça à esquerda para começar.</p>}</div><footer className="paint-status"><span>{selected ? `${canvasRef.current?.width ?? 0} × ${canvasRef.current?.height ?? 0} px${dirty ? ' · alterações não salvas' : edited ? ' · edição salva' : ' · original'}` : 'O original permanece intacto.'}</span><span role="status">{message}</span></footer></div></div>
  </section>
}
