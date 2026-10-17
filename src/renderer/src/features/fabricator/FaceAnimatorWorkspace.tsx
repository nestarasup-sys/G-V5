import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { FaceCatalogItem, FaceComponentAsset, FaceExpressionEffect, FaceExpressionPreset, FaceExpressionTransforms, FaceTransform, FabricatorProject } from '../../../../shared/fabricator'
import { Icon } from '../../ui/components/Icon'
import { eyeInteriorMask } from './face/eyeInteriorMask'

type TransitionRecipe = { id: string; name: string; from: string; to: string; durationMs: number; easing: 'smooth' | 'linear' }
const expressions = ['Aliviada', 'Animada', 'Apaixonada', 'Cansada', 'Ciumenta', 'Confusa', 'Decepcionada', 'Desconfiada', 'Envergonhada', 'Impressionada', 'Indignada', 'Irritada', 'Nojo', 'Normal', 'Orgulhosa', 'Preocupada', 'Séria', 'Sorrindo de canto', 'Sorriso maligno', 'Surpresa', 'Triste/magoada']
const recipes: TransitionRecipe[] = [
  { id: 'normal-irritada', name: 'Normal → Irritada', from: 'Normal', to: 'Irritada', durationMs: 700, easing: 'smooth' },
  { id: 'normal-surpresa', name: 'Normal → Surpresa', from: 'Normal', to: 'Surpresa', durationMs: 650, easing: 'smooth' },
  { id: 'indignada-normal', name: 'Indignada → Normal', from: 'Indignada', to: 'Normal', durationMs: 800, easing: 'smooth' },
  { id: 'normal-apaixonada', name: 'Normal → Apaixonada', from: 'Normal', to: 'Apaixonada', durationMs: 750, easing: 'smooth' },
  { id: 'cansada-animada', name: 'Cansada → Animada', from: 'Cansada', to: 'Animada', durationMs: 900, easing: 'smooth' },
  { id: 'desconfiada-surpresa', name: 'Desconfiada → Surpresa', from: 'Desconfiada', to: 'Surpresa', durationMs: 700, easing: 'smooth' },
  { id: 'seria-sorriso', name: 'Séria → Sorrindo de canto', from: 'Séria', to: 'Sorrindo de canto', durationMs: 800, easing: 'smooth' },
  { id: 'triste-aliviada', name: 'Triste/magoada → Aliviada', from: 'Triste/magoada', to: 'Aliviada', durationMs: 900, easing: 'smooth' }
]
const transformKeys: Array<keyof FaceExpressionTransforms> = ['eyeLeft', 'eyeRight', 'pupilLeft', 'pupilRight', 'browLeft', 'browRight', 'nose', 'mouth']
const effectKeys = ['shadow', 'blush', 'mouthBlush'] as const
type EffectKey = typeof effectKeys[number]
const defaultEffect: FaceExpressionEffect = { enabled: false, color: '#000000', opacity: 0, softness: 0, size: 0, offsetX: 0, offsetY: 0 }
const colorLerp = (a: string, b: string, t: number) => {
  const parse = (value: string) => /^#[\da-f]{6}$/i.test(value) ? [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16)) : [0, 0, 0]
  const aa = parse(a); const bb = parse(b)
  return `#${aa.map((value, i) => Math.round(value + (bb[i] - value) * t).toString(16).padStart(2, '0')).join('')}`
}
function interpolateTransform(a: FaceTransform, b: FaceTransform, t: number): FaceTransform {
  const delta = ((b.rotation - a.rotation + 540) % 360) - 180
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, scaleX: a.scaleX + (b.scaleX - a.scaleX) * t, scaleY: a.scaleY + (b.scaleY - a.scaleY) * t, rotation: a.rotation + delta * t, flipX: t < .5 ? a.flipX : b.flipX }
}
function interpolateEffect(a: FaceExpressionEffect | undefined, b: FaceExpressionEffect | undefined, t: number): FaceExpressionEffect {
  const from = a ?? defaultEffect; const to = b ?? defaultEffect
  const result: FaceExpressionEffect = { ...from, enabled: t < .5 ? from.enabled : to.enabled, color: colorLerp(from.color, to.color, t) }
  for (const key of ['opacity', 'softness', 'size', 'offsetX', 'offsetY', 'aspectRatio', 'width', 'height', 'rotation'] as const) {
    const left = key === 'opacity' && !from.enabled ? 0 : from[key] ?? 0
    const right = key === 'opacity' && !to.enabled ? 0 : to[key] ?? 0
    result[key] = left + (right - left) * t
  }
  result.style = t < .5 ? from.style : to.style
  result.enabled = from.enabled || to.enabled
  return result
}
function transformStyle(transform: FaceTransform, width: number, height: number, artWidth: number, artHeight: number, zIndex: number): CSSProperties {
  return { position: 'absolute', left: `${transform.x / artWidth * 100}%`, top: `${transform.y / artHeight * 100}%`, width: `${width * transform.scaleX / artWidth * 100}%`, height: `${height * transform.scaleY / artHeight * 100}%`, objectFit: 'fill', zIndex, transform: `translate(-50%,-50%) rotate(${transform.rotation}deg) scaleX(${transform.flipX ? -1 : 1})`, pointerEvents: 'none' }
}
function pieceFor(catalog: FaceCatalogItem | undefined, index: number) { return catalog?.pieces.find((piece) => piece.index === index) }
function loadExportImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Não foi possível preparar um asset facial para o vídeo.'))
    image.src = dataUrl
  })
}
function rgbaFromHex(hex: string, alpha: number): string {
  const value = /^#[\da-f]{6}$/i.test(hex) ? hex.slice(1) : '000000'
  return `rgba(${parseInt(value.slice(0, 2), 16)},${parseInt(value.slice(2, 4), 16)},${parseInt(value.slice(4, 6), 16)},${Math.max(0, Math.min(1, alpha))})`
}
function drawFacialLayer(context: CanvasRenderingContext2D, image: CanvasImageSource, transform: FaceTransform, width: number, height: number, artWidth: number, mirrorRight = false, opacity = 1): void {
  const x = mirrorRight ? artWidth - transform.x : transform.x
  const rotation = mirrorRight ? -transform.rotation : transform.rotation
  const flip = Boolean(transform.flipX) !== mirrorRight
  context.save()
  context.globalAlpha *= opacity
  context.translate(x, transform.y)
  context.rotate(rotation * Math.PI / 180)
  context.scale(flip ? -1 : 1, 1)
  context.drawImage(image, -width * transform.scaleX / 2, -height * transform.scaleY / 2, width * transform.scaleX, height * transform.scaleY)
  context.restore()
}

export function FaceAnimatorWorkspace({ modelSlot }: { modelSlot: number }) {
  const [project, setProject] = useState<FabricatorProject | null>(null)
  const [presets, setPresets] = useState<FaceExpressionPreset[]>([])
  const [assets, setAssets] = useState<Record<string, FaceComponentAsset>>({})
  const [catalog, setCatalog] = useState<Record<string, FaceCatalogItem>>({})
  const [eyeMasks, setEyeMasks] = useState<Record<string, string>>({})
  const [selectedId, setSelectedId] = useState(recipes[0].id)
  const [activeRecipe, setActiveRecipe] = useState<TransitionRecipe>(recipes[0])
  const [progress, setProgress] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportStatus, setExportStatus] = useState('')
  const [exportError, setExportError] = useState('')
  const [transitionDuration, setTransitionDuration] = useState(recipes[0].durationMs)
  const frameRef = useRef<number | null>(null)
  const startedRef = useRef<number | null>(null)
  const exportCancelRef = useRef(false)
  const exportRecorderRef = useRef<MediaRecorder | null>(null)
  const recipe = activeRecipe
  const head = useMemo(() => project?.parts.find((part) => /cabe[çc]a|head/i.test(part.name)) ?? null, [project])
  const presetsByName = useMemo(() => new Map(presets.map((preset) => [preset.name, preset])), [presets])
  const fromPreset = presetsByName.get(recipe.from)
  const toPreset = presetsByName.get(recipe.to)
  const canExportSequence = Boolean(head) && expressions.every((name) => presetsByName.has(name))
  const eased = recipe.easing === 'smooth' ? progress * progress * (3 - 2 * progress) : progress
  const discretePreset = eased < .5 ? fromPreset : toPreset
  const transforms = useMemo(() => {
    if (!fromPreset || !toPreset) return fromPreset?.transforms ?? toPreset?.transforms
    return Object.fromEntries(transformKeys.map((key) => [key, interpolateTransform(fromPreset.transforms[key], toPreset.transforms[key], eased)])) as FaceExpressionTransforms
  }, [fromPreset, toPreset, eased])
  const effects = useMemo(() => Object.fromEntries(effectKeys.map((key) => [key, interpolateEffect(fromPreset?.effects?.[key], toPreset?.effects?.[key], eased)])) as FaceExpressionPreset['effects'], [fromPreset, toPreset, eased])
  const noseOpacity = fromPreset && toPreset ? fromPreset.noseOpacity + (toPreset.noseOpacity - fromPreset.noseOpacity) * eased : discretePreset?.noseOpacity ?? 1

  useEffect(() => {
    let active = true
    setLoadError('')
    void (async () => {
      try {
        const [model, summaries, componentSummaries, catalogSummaries] = await Promise.all([
          window.desktop.loadFabricatorSlot(modelSlot), window.desktop.listFaceExpressionPresets(modelSlot),
          window.desktop.listFaceComponentAssets(modelSlot), window.desktop.listFaceCatalog(modelSlot)
        ])
        const [loadedPresets, loadedComponents, loadedCatalog] = await Promise.all([
          Promise.all(summaries.map((entry) => window.desktop.loadFaceExpressionPreset(modelSlot, entry.id))),
          Promise.all(componentSummaries.map((entry) => window.desktop.loadFaceComponentAsset(modelSlot, entry.id))),
          Promise.all(catalogSummaries.map((entry) => window.desktop.loadFaceCatalogItem(modelSlot, entry.id)))
        ])
        if (!active) return
        setProject(model)
        setPresets(loadedPresets.filter((entry): entry is FaceExpressionPreset => !!entry && entry.collectionId === 'standard'))
        setAssets(Object.fromEntries(loadedComponents.filter((entry): entry is FaceComponentAsset => !!entry).map((entry) => [entry.id, entry])))
        setCatalog(Object.fromEntries(loadedCatalog.filter((entry): entry is FaceCatalogItem => !!entry).map((entry) => [entry.id, entry])))
      } catch (reason) { if (active) setLoadError(reason instanceof Error ? reason.message : 'Não foi possível carregar os presets de rosto.') }
    })()
    return () => { active = false }
  }, [modelSlot])

  useEffect(() => {
    let active = true
    const eyeAssets = Object.values(assets).filter((asset) => asset.kind === 'eye')
    void Promise.all(eyeAssets.map(async (asset) => [asset.id, await eyeInteriorMask(asset.dataUrl)] as const)).then((entries) => {
      if (active) setEyeMasks(Object.fromEntries(entries))
    })
    return () => { active = false }
  }, [assets])

  useEffect(() => {
    if (!playing) { if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); frameRef.current = null; return }
    startedRef.current = null
    const tick = (now: number) => {
      if (startedRef.current === null) startedRef.current = now - progress * transitionDuration
      const next = Math.min(1, (now - startedRef.current) / transitionDuration)
      setProgress(next)
      if (next >= 1) { setPlaying(false); return }
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => { if (frameRef.current !== null) cancelAnimationFrame(frameRef.current) }
  }, [playing, transitionDuration])

  const selectRecipe = (item: TransitionRecipe) => { setSelectedId(item.id); setActiveRecipe(item); setProgress(0); setPlaying(false); setTransitionDuration(item.durationMs) }
  const renderComponent = (kind: 'eye' | 'pupil' | 'eyebrow', side: 'left' | 'right') => {
    if (!head || !discretePreset || !transforms) return null
    const id = kind === 'eye' ? discretePreset.selections.eyes[side] : kind === 'pupil' ? discretePreset.selections.pupils[side] : discretePreset.selections.eyebrows[side]
    const asset = id ? assets[id] : undefined
    if (!asset) return null
    const key = kind === 'eye' ? side === 'left' ? 'eyeLeft' : 'eyeRight' : kind === 'pupil' ? side === 'left' ? 'pupilLeft' : 'pupilRight' : side === 'left' ? 'browLeft' : 'browRight'
    const transform = transforms[key]
    if (kind === 'pupil') {
      const eyeId = discretePreset.selections.eyes[side]
      const eye = eyeId ? assets[eyeId] : undefined
      if (!eye) return null
      const eyeKey = side === 'left' ? 'eyeLeft' : 'eyeRight'
      const eyeTransform = transforms[eyeKey]
      const mirroredEye = side === 'right' && eye.rightSidePositioned !== true
      const eyeX = mirroredEye ? head.width - eyeTransform.x : eyeTransform.x
      const eyeStyle = transformStyle({ ...eyeTransform, x: eyeX, rotation: mirroredEye ? -eyeTransform.rotation : eyeTransform.rotation }, eye.width, eye.height, head.width, head.height, 3)
      const eyeFlip = mirroredEye !== Boolean(eyeTransform.flipX)
      const eyeFlipDirection = eyeFlip ? -1 : 1
      eyeStyle.transform = `translate(-50%,-50%) rotate(${mirroredEye ? -eyeTransform.rotation : eyeTransform.rotation}deg) scaleX(${eyeFlip ? -1 : 1})`
      const mask = eyeMasks[eye.id] ?? eye.dataUrl
      eyeStyle.maskImage = `url(${mask})`
      eyeStyle.WebkitMaskImage = `url(${mask})`
      eyeStyle.maskSize = '100% 100%'
      eyeStyle.WebkitMaskSize = '100% 100%'
      eyeStyle.overflow = 'hidden'
      const pupilMirror = side === 'right' && asset.rightSidePositioned !== true
      const pupilFlip = Boolean(transform.flipX) !== eyeFlip
      const pupilStyle: CSSProperties = { left: `${50 + (pupilMirror ? -transform.x : transform.x) / (eyeFlipDirection * eyeTransform.scaleX * eye.width) * 100}%`, top: `${50 + transform.y / (eye.height * eyeTransform.scaleY) * 100}%`, width: `${transform.scaleX * 100}%`, height: `${transform.scaleY * 100}%`, transform: `translate(-50%,-50%) rotate(${transform.rotation * (pupilMirror ? -1 : 1) * eyeFlipDirection}deg) scaleX(${pupilFlip ? -1 : 1})` }
      return <span key={`pupil-${side}`} className="expression-head-pupil-mask" style={eyeStyle}><img src={asset.dataUrl} alt="" style={pupilStyle} /></span>
    }
    const rightMirror = side === 'right' && asset.rightSidePositioned !== true
    const x = rightMirror ? head.width - transform.x : transform.x
    const mirrored = rightMirror !== Boolean(transform.flipX)
    const style = transformStyle({ ...transform, x, rotation: rightMirror ? -transform.rotation : transform.rotation }, asset.width, asset.height, head.width, head.height, kind === 'eyebrow' ? 4 : 2)
    style.transform = `translate(-50%,-50%) rotate(${rightMirror ? -transform.rotation : transform.rotation}deg) scaleX(${mirrored ? -1 : 1})`
    return <img key={`${kind}-${side}`} className="expression-head-piece" src={asset.dataUrl} alt="" style={style} />
  }
  const renderCatalog = (kind: 'nose' | 'mouth') => {
    if (!head || !discretePreset || !transforms) return null
    const choice = discretePreset.selections[kind]
    if (!choice) return null
    const item = catalog[choice.catalogId]
    const piece = pieceFor(item, choice.index)
    if (!piece) return null
    const style = transformStyle(transforms[kind], piece.width, piece.height, head.width, head.height, kind === 'nose' ? 5 : 6)
    if (kind === 'nose') style.opacity = noseOpacity
    return <img key={kind} className="expression-head-piece" src={piece.dataUrl} alt="" style={style} />
  }
  const renderEffects = () => {
    if (!head || !effects) return null
    return <div className="expression-head-effects face-animator-effects" style={{ WebkitMaskImage: `url(${head.dataUrl})`, maskImage: `url(${head.dataUrl})` }}>
      {effectKeys.map((key: EffectKey) => {
        const effect = effects[key]
        if (!effect?.enabled) return null
        const color = `color-mix(in srgb, ${effect.color} ${Math.round(effect.opacity * 100)}%, transparent)`
        if (key === 'shadow') return <span key={key} className="expression-preview-shadow" style={{ top: `${effect.offsetY * 100}%`, height: `${effect.size * 100}%`, background: `linear-gradient(180deg, ${color}, transparent)` }} />
        if (key === 'blush') {
          const shape = effect.style ?? 'cheeks'
          const blushColor = `color-mix(in srgb, ${effect.color} ${Math.round(effect.opacity * .54 * 100)}%, transparent)`
          const radial = (at: string) => `radial-gradient(ellipse at ${at}, ${blushColor}, transparent ${Math.round((.4 + effect.softness * .6) * 100)}%)`
          const background = shape === 'cheeks' ? `${radial('27% 50%')}, ${radial('73% 50%')}` : shape === 'bands' ? `${radial('50% 25%')}, ${radial('50% 50%')}, ${radial('50% 75%')}` : radial('50% 50%')
          return <span key={key} className="expression-preview-blush" style={{ left: `${50 + (effect.offsetX ?? 0) * 100}%`, top: `${50 + effect.offsetY * 100}%`, width: `${effect.size * 100}%`, height: `${effect.size * (effect.aspectRatio ?? .52) * 100}%`, background, transform: `translate(-50%,-50%) rotate(${shape === 'diagonal' ? -16 : 0}deg)` }} />
        }
        const mouth = transforms?.mouth
        return <span key={key} className="expression-preview-mouth-blush" style={{ left: `${((mouth?.x ?? 0) + (effect.offsetX ?? 0) * head.width) / (head.width || 1) * 100}%`, top: `${((mouth?.y ?? 0) + effect.offsetY * head.height) / (head.height || 1) * 100}%`, width: `${(effect.width ?? effect.size) * 100}%`, height: `${(effect.height ?? effect.size * (effect.aspectRatio ?? .52)) * 100}%`, background: `radial-gradient(ellipse, ${color}, transparent ${Math.round((.4 + effect.softness * .58) * 100)}%)`, transform: `translate(-50%,-50%) rotate(${(mouth?.rotation ?? 0) + (effect.rotation ?? 0)}deg)` }} />
      })}
    </div>
  }

  const exportExpressionSequence = async () => {
    if (!head) return
    const orderedPresets = expressions.map((name) => presetsByName.get(name))
    const missing = expressions.filter((name) => !presetsByName.has(name))
    if (missing.length) { setExportError(`Faltam presets no conjunto Padrão: ${missing.join(', ')}.`); return }
    if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
      setExportError('Este ambiente não oferece gravação de vídeo WebM.'); return
    }
    setPlaying(false); setExportError(''); setExportProgress(0); setExportStatus('Preparando os assets faciais…'); setExporting(true)
    exportCancelRef.current = false
    let stream: MediaStream | null = null
    let recorder: MediaRecorder | null = null
    try {
      const frameCanvas = document.createElement('canvas')
      const artScale = Math.min(2, 1920 / Math.max(head.width, head.height))
      frameCanvas.width = Math.max(1, Math.round(head.width * artScale))
      frameCanvas.height = Math.max(1, Math.round(head.height * artScale))
      const context = frameCanvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('Não foi possível preparar o canvas do vídeo.')
      const effectCanvas = document.createElement('canvas')
      effectCanvas.width = frameCanvas.width; effectCanvas.height = frameCanvas.height
      const effectContext = effectCanvas.getContext('2d')
      if (!effectContext) throw new Error('Não foi possível preparar a camada de efeitos.')

      const usedEyeIds = new Set((orderedPresets as FaceExpressionPreset[]).flatMap((entry) => Object.values(entry.selections.eyes).filter((id): id is string => Boolean(id))))
      const exportEyeMasks = Object.fromEntries(await Promise.all([...usedEyeIds].map(async (id) => {
        const eye = assets[id]
        return eye ? [id, await eyeInteriorMask(eye.dataUrl)] as const : [id, ''] as const
      })))
      const dataUrls = new Set<string>([head.dataUrl])
      for (const entry of orderedPresets as FaceExpressionPreset[]) {
        for (const id of [...Object.values(entry.selections.eyes), ...Object.values(entry.selections.pupils), ...Object.values(entry.selections.eyebrows)]) {
          const image = id ? assets[id] : undefined
          if (image) dataUrls.add(image.dataUrl)
          if (image?.kind === 'eye') dataUrls.add(exportEyeMasks[image.id] || image.dataUrl)
        }
        for (const choice of [entry.selections.nose, entry.selections.mouth]) {
          if (!choice) continue
          const piece = pieceFor(catalog[choice.catalogId], choice.index)
          if (piece) dataUrls.add(piece.dataUrl)
        }
      }
      const loadedImages = new Map<string, HTMLImageElement>()
      await Promise.all([...dataUrls].map(async (url) => loadedImages.set(url, await loadExportImage(url))))
      if (exportCancelRef.current) { setExportStatus('Exportação cancelada.'); return }
      const headImage = loadedImages.get(head.dataUrl)!
      const scratchByEye = new Map<string, { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }>()
      stream = frameCanvas.captureStream(30)
      const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((candidate) => MediaRecorder.isTypeSupported(candidate))
      if (!mimeType) throw new Error('O codificador WebM não está disponível neste computador.')
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 })
      exportRecorderRef.current = recorder
      const drawSoftSpot = (cx: number, cy: number, width: number, height: number, color: string, opacity: number, softness: number, rotation = 0) => {
        if (width <= 0 || height <= 0 || opacity <= 0) return
        effectContext.save(); effectContext.translate(cx, cy); effectContext.rotate(rotation * Math.PI / 180); effectContext.scale(width / 2, height / 2)
        const gradient = effectContext.createRadialGradient(0, 0, 0, 0, 0, 1)
        gradient.addColorStop(0, rgbaFromHex(color, opacity)); gradient.addColorStop(Math.max(.01, Math.min(1, .4 + softness * .6)), rgbaFromHex(color, opacity)); gradient.addColorStop(1, rgbaFromHex(color, 0))
        effectContext.fillStyle = gradient; effectContext.beginPath(); effectContext.ellipse(0, 0, 1, 1, 0, 0, Math.PI * 2); effectContext.fill(); effectContext.restore()
      }
      const renderAt = (from: FaceExpressionPreset, to: FaceExpressionPreset, rawProgress: number) => {
        const t = rawProgress * rawProgress * (3 - 2 * rawProgress)
        const frameTransforms = Object.fromEntries(transformKeys.map((key) => [key, interpolateTransform(from.transforms[key], to.transforms[key], t)])) as FaceExpressionTransforms
        const frameEffects = Object.fromEntries(effectKeys.map((key) => [key, interpolateEffect(from.effects?.[key], to.effects?.[key], t)])) as NonNullable<FaceExpressionPreset['effects']>
        const composition = t < .5 ? from : to
        context.setTransform(artScale, 0, 0, artScale, 0, 0)
        context.fillStyle = '#fdfcfd'; context.fillRect(0, 0, head.width, head.height)
        context.drawImage(headImage, 0, 0, head.width, head.height)
        effectContext.setTransform(artScale, 0, 0, artScale, 0, 0)
        effectContext.clearRect(0, 0, head.width, head.height)
        const shadow = frameEffects.shadow
        if (shadow.enabled && shadow.opacity > 0 && shadow.size > 0) {
          const top = shadow.offsetY * head.height
          const gradient = effectContext.createLinearGradient(0, top, 0, top + shadow.size * head.height)
          gradient.addColorStop(0, rgbaFromHex(shadow.color, shadow.opacity)); gradient.addColorStop(1, rgbaFromHex(shadow.color, 0))
          effectContext.fillStyle = gradient; effectContext.fillRect(0, top, head.width, shadow.size * head.height)
        }
        const blush = frameEffects.blush
        if (blush.enabled && blush.opacity > 0) {
          const w = blush.size * head.width; const h = blush.size * (blush.aspectRatio ?? .52) * head.height
          const x = (50 + (blush.offsetX ?? 0) * 100) / 100 * head.width; const y = (50 + blush.offsetY * 100) / 100 * head.height
          const blushOpacity = blush.opacity * .54
          if (blush.style === 'cheeks') { drawSoftSpot(x - w * .23, y, w * .9, h, blush.color, blushOpacity, blush.softness); drawSoftSpot(x + w * .23, y, w * .9, h, blush.color, blushOpacity, blush.softness) }
          else if (blush.style === 'bands') { for (const offset of [-.25, 0, .25]) drawSoftSpot(x, y + h * offset, w, h * .72, blush.color, blushOpacity, blush.softness) }
          else drawSoftSpot(x, y, w, h, blush.color, blushOpacity, blush.softness, blush.style === 'diagonal' ? -16 : 0)
        }
        const mouthBlush = frameEffects.mouthBlush
        if (mouthBlush.enabled && mouthBlush.opacity > 0) {
          const mouth = frameTransforms.mouth
          drawSoftSpot(mouth.x + (mouthBlush.offsetX ?? 0) * head.width, mouth.y + mouthBlush.offsetY * head.height,
            (mouthBlush.width ?? mouthBlush.size) * head.width, (mouthBlush.height ?? mouthBlush.size * (mouthBlush.aspectRatio ?? .52)) * head.height,
            mouthBlush.color, mouthBlush.opacity, mouthBlush.softness, mouth.rotation + (mouthBlush.rotation ?? 0))
        }
        effectContext.globalCompositeOperation = 'destination-in'; effectContext.drawImage(headImage, 0, 0, head.width, head.height); effectContext.globalCompositeOperation = 'source-over'
        context.drawImage(effectCanvas, 0, 0, head.width, head.height)

        for (const side of ['left', 'right'] as const) {
          const id = composition.selections.eyes[side]; const eye = id ? assets[id] : undefined
          if (eye && eye.kind === 'eye') drawFacialLayer(context, loadedImages.get(eye.dataUrl)!, frameTransforms[side === 'left' ? 'eyeLeft' : 'eyeRight'], eye.width, eye.height, head.width, side === 'right' && eye.rightSidePositioned !== true)
        }
        for (const side of ['left', 'right'] as const) {
          const pupilId = composition.selections.pupils[side]; const eyeId = composition.selections.eyes[side]
          const pupil = pupilId ? assets[pupilId] : undefined; const eye = eyeId ? assets[eyeId] : undefined
          if (!pupil || pupil.kind !== 'pupil' || !eye || eye.kind !== 'eye') continue
          const eyeTransform = frameTransforms[side === 'left' ? 'eyeLeft' : 'eyeRight']; const pupilTransform = frameTransforms[side === 'left' ? 'pupilLeft' : 'pupilRight']
          const mirrorEye = side === 'right' && eye.rightSidePositioned !== true; const mirrorPupil = side === 'right' && pupil.rightSidePositioned !== true
          const eyeFlip = Boolean(eyeTransform.flipX) !== mirrorEye; const eyeFlipDirection = eyeFlip ? -1 : 1
          let scratch = scratchByEye.get(`${eye.id}:${pupil.id}`)
          if (!scratch) { const canvas = document.createElement('canvas'); canvas.width = eye.width; canvas.height = eye.height; const scratchContext = canvas.getContext('2d'); if (!scratchContext) throw new Error('Não foi possível preparar a máscara da pupila.'); scratch = { canvas, context: scratchContext }; scratchByEye.set(`${eye.id}:${pupil.id}`, scratch) }
          const pupilContext = scratch.context; pupilContext.setTransform(1, 0, 0, 1, 0, 0); pupilContext.globalCompositeOperation = 'source-over'; pupilContext.clearRect(0, 0, scratch.canvas.width, scratch.canvas.height)
          const pupilX = mirrorPupil ? -pupilTransform.x : pupilTransform.x
          const pupilCenterX = eye.width / 2 + pupilX / eyeFlipDirection
          const pupilCenterY = eye.height / 2 + pupilTransform.y / eyeTransform.scaleY
          pupilContext.save(); pupilContext.translate(pupilCenterX, pupilCenterY); pupilContext.rotate(pupilTransform.rotation * (mirrorPupil ? -1 : 1) * eyeFlipDirection * Math.PI / 180); pupilContext.scale(Boolean(pupilTransform.flipX) !== eyeFlip ? -1 : 1, 1)
          pupilContext.drawImage(loadedImages.get(pupil.dataUrl)!, -eye.width * pupilTransform.scaleX / 2, -eye.height * pupilTransform.scaleY / 2, eye.width * pupilTransform.scaleX, eye.height * pupilTransform.scaleY); pupilContext.restore()
          pupilContext.globalCompositeOperation = 'destination-in'; pupilContext.drawImage(loadedImages.get(exportEyeMasks[eye.id] || eye.dataUrl)!, 0, 0, eye.width, eye.height); pupilContext.globalCompositeOperation = 'source-over'
          drawFacialLayer(context, scratch.canvas, eyeTransform, eye.width, eye.height, head.width, mirrorEye)
        }
        for (const side of ['left', 'right'] as const) {
          const id = composition.selections.eyebrows[side]; const brow = id ? assets[id] : undefined
          if (brow && brow.kind === 'eyebrow') drawFacialLayer(context, loadedImages.get(brow.dataUrl)!, frameTransforms[side === 'left' ? 'browLeft' : 'browRight'], brow.width, brow.height, head.width, side === 'right' && brow.rightSidePositioned !== true)
        }
        for (const kind of ['nose', 'mouth'] as const) {
          const choice = composition.selections[kind]; if (!choice) continue
          const piece = pieceFor(catalog[choice.catalogId], choice.index); if (!piece) continue
          context.save(); context.globalAlpha *= kind === 'nose' ? from.noseOpacity + (to.noseOpacity - from.noseOpacity) * t : 1
          drawFacialLayer(context, loadedImages.get(piece.dataUrl)!, frameTransforms[kind], piece.width, piece.height, head.width)
          context.restore()
        }
      }

      const videoStream = stream
      const preferredMime = mimeType
      let recorderFailure: Error | null = null
      const completed = new Promise<Blob>((resolve) => {
        const chunks: BlobPart[] = []
        recorder!.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
        recorder!.onerror = () => { recorderFailure = new Error('O codificador interrompeu a gravação do vídeo.'); exportCancelRef.current = true; if (recorder?.state === 'recording') recorder.stop() }
        recorder!.onstop = () => resolve(new Blob(chunks, { type: preferredMime }))
      })
      renderAt(orderedPresets[0] as FaceExpressionPreset, orderedPresets[1] as FaceExpressionPreset, 0)
      recorder.start(1000)
      setExportStatus('Exportando 21 expressões · 60 segundos · WebM 30 fps…')
      const durationMs = 60_000
      let recordingStart = 0; let lastFrame = -Infinity; let lastUiUpdate = -Infinity
      await new Promise<void>((resolve) => {
        const drawTick = (now: number) => {
          if (exportCancelRef.current) { if (recorder?.state === 'recording') recorder.stop(); resolve(); return }
          if (!recordingStart) recordingStart = now
          const elapsed = Math.min(durationMs, now - recordingStart)
          if (now - lastFrame >= 1000 / 30 || elapsed >= durationMs) {
            const segment = Math.min(19, Math.floor(elapsed / 3000))
            const localProgress = elapsed >= durationMs ? 1 : (elapsed - segment * 3000) / 3000
            renderAt(orderedPresets[segment] as FaceExpressionPreset, orderedPresets[segment + 1] as FaceExpressionPreset, localProgress)
            lastFrame = now
            if (now - lastUiUpdate >= 250 || elapsed >= durationMs) { setExportProgress(elapsed / durationMs); lastUiUpdate = now }
          }
          if (elapsed >= durationMs) { if (recorder?.state === 'recording') recorder.stop(); resolve(); return }
          requestAnimationFrame(drawTick)
        }
        requestAnimationFrame(drawTick)
      })
      const blob = await completed
      if (recorderFailure) throw recorderFailure
      videoStream.getTracks().forEach((track) => track.stop())
      stream = null
      if (exportCancelRef.current) { setExportStatus('Exportação cancelada.'); return }
      setExportStatus('Abrindo local para salvar…')
      const saved = await window.desktop.saveFaceAnimationExport(modelSlot, new Uint8Array(await blob.arrayBuffer()))
      setExportStatus(saved ? 'Vídeo exportado com sucesso.' : 'Salvamento cancelado.')
      setExportProgress(saved ? 1 : 0)
    } catch (reason) {
      exportCancelRef.current = true
      if (recorder?.state === 'recording') recorder.stop()
      setExportError(reason instanceof Error ? reason.message : 'Não foi possível exportar a animação facial.')
      setExportStatus('Falha na exportação.')
    } finally {
      stream?.getTracks().forEach((track) => track.stop())
      exportRecorderRef.current = null; setExporting(false)
    }
  }

  const cancelExport = () => {
    exportCancelRef.current = true
    if (exportRecorderRef.current?.state === 'recording') exportRecorderRef.current.stop()
  }

  return <section className="fabricator-workspace face-animator-workspace" aria-label="Animador Rosto Dev">
    <header className="face-animator-toolbar"><div className="face-animator-title"><Icon name="face" /><span><strong>Animador Rosto Dev</strong><small>Transições entre presets faciais · modelo {modelSlot}</small></span></div><label>Duração <output>{(transitionDuration / 1000).toFixed(2)} s</output><input type="range" min="250" max="3000" step="50" value={transitionDuration} onChange={(event) => { setTransitionDuration(Number(event.target.value)); setPlaying(false) }} /></label><button type="button" disabled={exporting} onClick={() => { setProgress(0); setPlaying(false) }}>⟲ Reiniciar</button><button className="face-animator-export" type="button" disabled={exporting || !canExportSequence} title={canExportSequence ? 'Exporta as 21 expressões em um vídeo de 60 segundos' : 'Salve as 21 expressões do conjunto Padrão para exportar'} onClick={() => void exportExpressionSequence()}>{exporting ? 'Exportando…' : 'Exportar sequência · 1 min'}</button>{exporting && <button className="face-animator-cancel" type="button" onClick={cancelExport}>Cancelar</button>}</header>
    {(exportStatus || exportError) && <div className={`face-animator-export-status${exportError ? ' error' : ''}`} role="status" aria-live="polite"><span>{exportError || exportStatus}</span>{exporting && <div><i style={{ width: `${Math.round(exportProgress * 100)}%` }} /></div>}</div>}
    <div className="face-animator-layout">
      <aside className="face-animator-recipes"><header><strong>Pré combinações</strong><small>Transições prontas do conjunto Padrão</small></header>{recipes.map((item) => <button key={item.id} type="button" className={selectedId === item.id ? 'active' : ''} onClick={() => selectRecipe(item)}><Icon name="face" /><span><strong>{item.name}</strong><small>{item.durationMs} ms · Suave</small></span></button>)}</aside>
      <main className="face-animator-stage-column"><div className="face-animator-stage-heading"><span>PRÉVIA ANIMADA</span><span>{fromPreset && toPreset ? `${fromPreset.name} → ${toPreset.name}` : 'Aguardando presets'}</span></div><div className="face-animator-stage">{loadError ? <div className="face-animator-empty">{loadError}</div> : head ? <div className="expression-head-canvas face-animator-head" style={{ aspectRatio: `${head.width} / ${head.height}` }}><img className="expression-head-base" src={head.dataUrl} alt="Cabeça do modelo" />{renderEffects()}{renderComponent('eye', 'left')}{renderComponent('eye', 'right')}{renderComponent('pupil', 'left')}{renderComponent('pupil', 'right')}{renderComponent('eyebrow', 'left')}{renderComponent('eyebrow', 'right')}{renderCatalog('nose')}{renderCatalog('mouth')}</div> : <div className="face-animator-empty">Importe uma cabeça no slot {modelSlot} e salve presets no conjunto Padrão de Preset Expressão Dev.</div>}</div><div className="face-animator-playback"><button className="face-animator-play" type="button" disabled={!fromPreset || !toPreset} onClick={() => { if (progress >= 1) setProgress(0); setPlaying((value) => !value) }}>{playing ? '❚❚ Pausar' : '▶ Reproduzir'}</button><input type="range" min="0" max="1" step="0.001" value={progress} onChange={(event) => { setPlaying(false); setProgress(Number(event.target.value)) }} aria-label="Posição da transição"/><span>{Math.round(progress * 100)}%</span></div><div className="face-animator-track"><div><strong>{recipe.from}</strong><small>Início</small></div><span className="face-animator-track-line"><i style={{ left: `${progress * 100}%` }} /></span><div><strong>{recipe.to}</strong><small>Fim</small></div></div></main>
      <aside className="face-animator-inspector"><header><strong>Composição da transição</strong><small>Os presets de origem ficam intactos</small></header><label>Expressão inicial<select value={recipe.from} onChange={(event) => { setActiveRecipe((current) => ({ ...current, from: event.target.value, name: `${event.target.value} → ${current.to}` })); setProgress(0); setPlaying(false) }}><option value={recipe.from}>{recipe.from}</option>{expressions.filter((name) => name !== recipe.from).map((name) => <option key={name}>{name}</option>)}</select></label><label>Expressão final<select value={recipe.to} onChange={(event) => { setActiveRecipe((current) => ({ ...current, to: event.target.value, name: `${current.from} → ${event.target.value}` })); setProgress(0); setPlaying(false) }}><option value={recipe.to}>{recipe.to}</option>{expressions.filter((name) => name !== recipe.to).map((name) => <option key={name}>{name}</option>)}</select></label><div className="face-animator-effects-summary"><strong>Camadas animadas</strong>{[['Olhos e sobrancelhas', 'Posição · escala · rotação'], ['Pupilas', 'Posição · escala · rotação'], ['Nariz e boca', 'Posição · escala · rotação · opacidade'], ['Blush, sombra e blush da boca', 'Cor · intensidade · posição · forma']].map(([title, detail]) => <div key={title}><Icon name="check" /><span><b>{title}</b><small>{detail}</small></span></div>)}</div><p>Transformações e efeitos fazem interpolação suave. Quando os assets dos presets são diferentes, a composição troca no ponto médio da transição.</p></aside>
    </div>
  </section>
}
