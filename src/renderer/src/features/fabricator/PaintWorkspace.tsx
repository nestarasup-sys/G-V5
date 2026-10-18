import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PaintAsset } from '../../../../shared/paint'
import { Icon } from '../../ui/components/Icon'
import './paint.css'

type Tool = 'brush' | 'eraser' | 'edge' | 'picker' | 'magic'
const labels: Record<string, string> = { models: 'Modelos', poses: 'Poses', wardrobe: 'Roupas', faces: 'Rosto', 'face-components': 'Olhos e extras', hair: 'Cabelos', animations: 'Animações' }
const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = url })
function trimTransparentEdge(canvas: HTMLCanvasElement, width: number, center?: { x: number; y: number; radius: number }): void {
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  const { data } = image
  const w = image.width; const h = image.height
  for (let pass = 0; pass < width; pass += 1) {
    const previous = new Uint8ClampedArray(data)
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
      if (center && (x - center.x) ** 2 + (y - center.y) ** 2 > center.radius ** 2) continue
      const offset = (y * w + x) * 4 + 3
      if (!previous[offset]) continue
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !previous[offset - 4] || !previous[offset + 4] || !previous[offset - w * 4] || !previous[offset + w * 4]) data[offset] = 0
    }
  }
  context.putImageData(image, 0, 0)
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
  const visible = useMemo(() => assets.filter((asset) => (category === 'all' || asset.category === category) && `${asset.name} ${asset.location}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [assets, category, query])

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
      for (let index = 0; index <= steps; index += 1) trimTransparentEdge(canvas, 1, { x: fromX + (x - fromX) * index / steps, y: fromY + (y - fromY) * index / steps, radius: size / 2 })
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

  const save = async () => { if (!selected || !hash) return; setBusy(true); setMessage(''); try { await window.desktop.savePaintAsset(selected, hash, snapshot()); setDirty(false); setEdited(true); await refresh(); window.dispatchEvent(new Event('fabricator:assets-updated')); setMessage('Edição salva.') } catch (error) { setMessage(`Falha ao salvar: ${String(error)}`) } finally { setBusy(false) } }
  const remove = async () => { if (!selected || !original || !window.confirm('Remover a edição desta peça e voltar ao original?')) return; setBusy(true); try { await window.desktop.removePaintEdit(selected); await restore(original); setEdited(false); setDirty(false); undoRef.current = []; redoRef.current = []; setHistoryVersion((value) => value + 1); await refresh(); window.dispatchEvent(new Event('fabricator:assets-updated')); setMessage('Edição removida. Original restaurado.') } catch (error) { setMessage(String(error)) } finally { setBusy(false) } }
  const trim = () => { if (!canvasRef.current) return; checkpoint(); trimTransparentEdge(canvasRef.current, Math.min(8, Math.max(1, Math.round(size / 8)))); setDirty(true) }

  return <section className="fabricator-workspace paint-workspace" aria-label="Paint Nymi">
    <header className="paint-heading"><span><strong>Paint Nymi</strong><small>Edite pixels sem alterar a imagem original</small></span><div><button disabled={!selected || !dirty || busy} onClick={() => void save()}><Icon name="save" /> Salvar edição</button><button disabled={!selected || (!edited && !dirty) || busy} onClick={() => void remove()}><Icon name="reset" /> Remover edição</button></div></header>
    <div className="paint-body"><aside className="paint-library"><div className="paint-library-controls"><input aria-label="Buscar asset" placeholder="Buscar peça…" value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label="Área" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">Todas as áreas</option>{Object.entries(labels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><button onClick={() => void refresh()}><Icon name="reset" /> Atualizar lista</button></div><div className="paint-asset-list">{visible.map((asset) => <button key={asset.id} className={selected === asset.id ? 'active' : ''} onClick={() => void select(asset.id)}><strong>{asset.name}{asset.edited && <span className="paint-edited">Editado</span>}</strong><small>{labels[asset.category] ?? asset.category} · {asset.location}</small></button>)}{!visible.length && <p>Nenhum asset nesta área.</p>}</div></aside>
    <div className="paint-editor"><div className="paint-toolbar"><div className="paint-tool-row"><button className={tool === 'brush' ? 'active' : ''} onClick={() => setTool('brush')} title="Pincel"><Icon name="brush" /> Pincel</button><button className={tool === 'eraser' ? 'active' : ''} onClick={() => setTool('eraser')} title="Borracha"><Icon name="eraser" /> Borracha</button><button className={tool === 'edge' ? 'active' : ''} onClick={() => setTool('edge')} title="Apaga apenas pixels no contorno"><Icon name="eraser" /> Borda</button><button className={tool === 'magic' ? 'active' : ''} onClick={() => setTool('magic')} title="Remove a região de cor parecida conectada ao clique">Borracha mágica</button><button className={tool === 'picker' ? 'active' : ''} onClick={() => setTool('picker')} title="Escolher cor da imagem">Conta-gotas</button><button disabled={!selected} onClick={trim} title="Remove uma faixa fina em todo o contorno">Limpar bordas</button><button disabled={!undoRef.current.length} onClick={() => void undo()} title="Desfazer"><Icon name="undo" /></button><button disabled={!redoRef.current.length} onClick={() => void redo()} title="Refazer"><Icon name="redo" /></button></div><div className="paint-tool-row"><label>Cor <input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label><label>Tamanho {size}px <input type="range" min="1" max="100" value={size} onChange={(event) => setSize(Number(event.target.value))} /></label><label>Opacidade {opacity}% <input type="range" min="1" max="100" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /></label><label>Tolerância {tolerance} <input type="range" min="0" max="100" value={tolerance} onChange={(event) => setTolerance(Number(event.target.value))} /></label><label>Zoom {Math.round(zoom * 100)}% <input type="range" min="0.25" max="6" step="0.25" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label><button disabled={!selected} onPointerDown={() => setCompare(true)} onPointerUp={() => setCompare(false)} onPointerLeave={() => setCompare(false)}>Ver original</button></div></div>
    <div className="paint-stage"><div className="paint-canvas-wrap" style={{ display: selected ? undefined : 'none', width: canvasRef.current?.width ? canvasRef.current.width * zoom : undefined, height: canvasRef.current?.height ? canvasRef.current.height * zoom : undefined }}><canvas ref={canvasRef} style={{ visibility: compare ? 'hidden' : 'visible' }} onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} />{compare && <img src={original} alt="Imagem original" />}</div>{!selected && <p>Selecione uma peça à esquerda para começar.</p>}</div><footer className="paint-status"><span>{selected ? `${canvasRef.current?.width ?? 0} × ${canvasRef.current?.height ?? 0} px${dirty ? ' · alterações não salvas' : edited ? ' · edição salva' : ' · original'}` : 'O original permanece intacto.'}</span><span role="status">{message}</span></footer></div></div>
  </section>
}
