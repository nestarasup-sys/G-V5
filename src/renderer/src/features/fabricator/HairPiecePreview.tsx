import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { HairTransform, HairWorkspace, ModelPart } from '../../../../shared/fabricator'
import type { HairAssetSide } from '../../../../shared/hairCategories'
import { Icon } from '../../ui/components/Icon'
import { eraseHairSegment, hairErasePoint, type HairErasePoint } from './hairEraser'

type HairAsset = NonNullable<HairWorkspace['front']>
type Props = {
  side: HairAssetSide; asset: HairAsset; transform: HairTransform; head: ModelPart; selected: boolean; disabled: boolean
  onPointerDown: (event: PointerEvent<HTMLImageElement>, side: HairAssetSide) => void
  onErase: (dataUrl: string) => void
}

export function HairPiecePreview({ side, asset, transform, head, selected, disabled, onPointerDown, onErase }: Props) {
  const [enabled, setEnabled] = useState(false)
  const [brushSize, setBrushSize] = useState(24)
  const [controls, setControls] = useState<HTMLElement | null>(null)
  const [history, setHistory] = useState<Array<{ before: string; after: string }>>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const readyRef = useRef(false)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const strokeRef = useRef<{ pointerId: number; last: HairErasePoint; before: string } | null>(null)
  const active = selected && enabled

  useEffect(() => {
    setControls(selected ? document.querySelector<HTMLElement>('[data-hair-eraser-controls]') : null)
    if (!selected) setEnabled(false)
  }, [selected])

  useEffect(() => {
    readyRef.current = false
    strokeRef.current = null
    if (!active) return
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (cancelled) return
      const canvas = canvasRef.current, context = canvas?.getContext('2d')
      if (!canvas || !context) return
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      imageRef.current = image
      readyRef.current = true
    }
    image.src = asset.dataUrl
    return () => { cancelled = true }
  }, [active, asset.dataUrl, asset.width, asset.height])

  const geometry = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget, bounds = canvas.getBoundingClientRect()
    const stage = canvas.closest<HTMLElement>('.hair-dev-head-stage')!
    const zoom = stage.getBoundingClientRect().width / parseFloat(getComputedStyle(stage).width)
    const rendered = { width: parseFloat(getComputedStyle(canvas).width) * zoom, height: parseFloat(getComputedStyle(canvas).height) * zoom }
    if (!(rendered.width > 0 && rendered.height > 0)) return null
    return {
      point: hairErasePoint({ x: event.clientX, y: event.clientY }, { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }, rendered, asset, transform.rotation, Boolean(transform.flipX)),
      radiusX: brushSize / 2 * asset.width / rendered.width,
      radiusY: brushSize / 2 * asset.height / rendered.height
    }
  }
  const erase = (event: PointerEvent<HTMLCanvasElement>, start: boolean) => {
    event.stopPropagation()
    event.preventDefault()
    if (disabled || !readyRef.current || start && event.button !== 0) return
    const point = geometry(event), context = event.currentTarget.getContext('2d')
    if (!point || !context) return
    if (start) {
      event.currentTarget.setPointerCapture(event.pointerId)
      strokeRef.current = { pointerId: event.pointerId, last: point.point, before: asset.dataUrl }
    }
    const stroke = strokeRef.current
    if (!stroke || stroke.pointerId !== event.pointerId) return
    eraseHairSegment(context, stroke.last, point.point, point.radiusX, point.radiusY)
    stroke.last = point.point
  }
  const finish = (event: PointerEvent<HTMLCanvasElement>, cancel = false) => {
    event.stopPropagation()
    const stroke = strokeRef.current
    if (!stroke || stroke.pointerId !== event.pointerId) return
    strokeRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (cancel) {
      const context = event.currentTarget.getContext('2d')
      if (context && imageRef.current) { context.clearRect(0, 0, asset.width, asset.height); context.drawImage(imageRef.current, 0, 0, asset.width, asset.height) }
      return
    }
    const after = event.currentTarget.toDataURL('image/png')
    setHistory((previous) => [...previous.slice(-9), { before: stroke.before, after }])
    onErase(after)
  }
  const last = history.at(-1)
  const style: CSSProperties = {
    left: transform.x / head.width * 100 + '%', top: transform.y / head.height * 100 + '%',
    width: asset.width * transform.scaleX / head.width * 100 + '%', height: asset.height * transform.scaleY / head.height * 100 + '%',
    transform: `translate(-50%, -50%) rotate(${transform.rotation}deg) scaleX(${transform.flipX ? -1 : 1})`, pointerEvents: selected ? 'auto' : 'none'
  }
  const className = `hair-dev-piece hair-dev-piece-${side}${selected ? ' selected' : ''}`
  return <>
    <img className={className} src={asset.dataUrl} alt={'Cabelo ' + (side === 'back' ? 'traseiro' : side === 'front' ? 'posterior' : 'franja frontal')} draggable={false} onPointerDown={(event) => onPointerDown(event, side)} style={{ ...style, visibility: active ? 'hidden' : 'visible' }} />
    {active && <canvas ref={canvasRef} className={className + ' hair-dev-eraser-canvas'} width={asset.width} height={asset.height} style={style} aria-label="Apagar partes do cabelo selecionado" onPointerDown={(event) => erase(event, true)} onPointerMove={(event) => erase(event, false)} onPointerUp={(event) => finish(event)} onPointerCancel={(event) => finish(event, true)} onLostPointerCapture={(event) => finish(event, true)} />}
    {selected && controls && createPortal(<div className="hair-dev-eraser-controls">
      <button className={'hair-dev-reset hair-dev-eraser-toggle' + (enabled ? ' active' : '')} type="button" aria-pressed={enabled} disabled={disabled} onClick={() => setEnabled((value) => !value)}><Icon name="eraser" />Borracha</button>
      {enabled && <>
        <label className="hair-dev-range"><span><b>Tamanho da borracha</b><output>{brushSize}px</output></span><input aria-label="Tamanho da borracha" type="range" min="4" max="80" step="1" value={brushSize} disabled={disabled} onChange={(event) => setBrushSize(Number(event.target.value))} /></label>
        <button className="hair-dev-reset" type="button" disabled={disabled || !last || last.after !== asset.dataUrl} onClick={() => { if (last?.after === asset.dataUrl) { onErase(last.before); setHistory((previous) => previous.slice(0, -1)) } }}><Icon name="undo" />Desfazer borracha</button>
        <small>Arraste sobre a peça na prévia. Salve para guardar o recorte.</small>
      </>}
    </div>, controls)}
  </>
}
