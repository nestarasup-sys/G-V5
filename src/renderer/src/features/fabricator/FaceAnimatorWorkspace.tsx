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
  const [transitionDuration, setTransitionDuration] = useState(recipes[0].durationMs)
  const frameRef = useRef<number | null>(null)
  const startedRef = useRef<number | null>(null)
  const recipe = activeRecipe
  const head = useMemo(() => project?.parts.find((part) => /cabe[çc]a|head/i.test(part.name)) ?? null, [project])
  const presetsByName = useMemo(() => new Map(presets.map((preset) => [preset.name, preset])), [presets])
  const fromPreset = presetsByName.get(recipe.from)
  const toPreset = presetsByName.get(recipe.to)
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
      eyeStyle.transform = `translate(-50%,-50%) rotate(${mirroredEye ? -eyeTransform.rotation : eyeTransform.rotation}deg) scaleX(${eyeFlip ? -1 : 1})`
      const mask = eyeMasks[eye.id] ?? eye.dataUrl
      eyeStyle.maskImage = `url(${mask})`
      eyeStyle.WebkitMaskImage = `url(${mask})`
      eyeStyle.maskSize = '100% 100%'
      eyeStyle.WebkitMaskSize = '100% 100%'
      eyeStyle.overflow = 'hidden'
      const pupilMirror = side === 'right' && asset.rightSidePositioned !== true
      const pupilFlip = Boolean(transform.flipX) !== eyeFlip
      const pupilStyle: CSSProperties = { position: 'absolute', left: `${50 + (pupilMirror ? -transform.x : transform.x) / Math.max(1, eye.width * eyeTransform.scaleX) * 100}%`, top: `${50 + transform.y / Math.max(1, eye.height * eyeTransform.scaleY) * 100}%`, width: `${transform.scaleX * 100}%`, height: `${transform.scaleY * 100}%`, objectFit: 'fill', transform: `translate(-50%,-50%) rotate(${transform.rotation * (pupilMirror ? -1 : 1) * (eyeFlip ? -1 : 1)}deg) scaleX(${pupilFlip ? -1 : 1})` }
      return <span key={`pupil-${side}`} style={eyeStyle}><img src={asset.dataUrl} alt="" style={pupilStyle} /></span>
    }
    const rightMirror = side === 'right' && asset.rightSidePositioned !== true
    const x = rightMirror ? head.width - transform.x : transform.x
    const mirrored = rightMirror !== Boolean(transform.flipX)
    const style = transformStyle({ ...transform, x, rotation: rightMirror ? -transform.rotation : transform.rotation }, asset.width, asset.height, head.width, head.height, kind === 'eyebrow' ? 4 : 2)
    style.transform = `translate(-50%,-50%) rotate(${rightMirror ? -transform.rotation : transform.rotation}deg) scaleX(${mirrored ? -1 : 1})`
    return <img key={`${kind}-${side}`} src={asset.dataUrl} alt="" style={style} />
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
    return <img key={kind} src={piece.dataUrl} alt="" style={style} />
  }
  const renderEffects = () => {
    if (!head || !effects) return null
    return <div className="face-animator-effects" style={{ WebkitMaskImage: `url(${head.dataUrl})`, maskImage: `url(${head.dataUrl})` }}>
      {effectKeys.map((key: EffectKey) => {
        const effect = effects[key]
        if (!effect?.enabled) return null
        const color = `color-mix(in srgb, ${effect.color} ${Math.round(effect.opacity * 100)}%, transparent)`
        if (key === 'shadow') return <span key={key} className="face-animator-shadow" style={{ top: `${effect.offsetY * 100}%`, height: `${effect.size * 100}%`, background: `linear-gradient(180deg,${color},transparent)` }} />
        if (key === 'blush') return <span key={key} className="face-animator-blush" style={{ left: `${50 + (effect.offsetX ?? 0) * 100}%`, top: `${50 + effect.offsetY * 100}%`, width: `${effect.size * 100}%`, height: `${effect.size * (effect.aspectRatio ?? .52) * 100}%`, background: `radial-gradient(ellipse,${color},transparent ${Math.round((.4 + effect.softness * .6) * 100)}%)` }} />
        const mouth = transforms?.mouth
        return <span key={key} className="face-animator-mouth-blush" style={{ left: `${(mouth?.x ?? 0) / head.width * 100}%`, top: `${((mouth?.y ?? 0) + effect.offsetY * head.height) / head.height * 100}%`, width: `${(effect.width ?? effect.size) * 100}%`, height: `${(effect.height ?? effect.size * (effect.aspectRatio ?? .52)) * 100}%`, background: `radial-gradient(ellipse,${color},transparent ${Math.round((.4 + effect.softness * .58) * 100)}%)`, transform: `translate(-50%,-50%) rotate(${(mouth?.rotation ?? 0) + (effect.rotation ?? 0)}deg)` }} />
      })}
    </div>
  }

  return <section className="fabricator-workspace face-animator-workspace" aria-label="Animador Rosto Dev">
    <header className="face-animator-toolbar"><div className="face-animator-title"><Icon name="face" /><span><strong>Animador Rosto Dev</strong><small>Transições entre presets faciais · modelo {modelSlot}</small></span></div><label>Duração <output>{(transitionDuration / 1000).toFixed(2)} s</output><input type="range" min="250" max="3000" step="50" value={transitionDuration} onChange={(event) => { setTransitionDuration(Number(event.target.value)); setPlaying(false) }} /></label><button type="button" onClick={() => { setProgress(0); setPlaying(false) }}>⟲ Reiniciar</button></header>
    <div className="face-animator-layout">
      <aside className="face-animator-recipes"><header><strong>Pré combinações</strong><small>Transições prontas do conjunto Padrão</small></header>{recipes.map((item) => <button key={item.id} type="button" className={selectedId === item.id ? 'active' : ''} onClick={() => selectRecipe(item)}><Icon name="face" /><span><strong>{item.name}</strong><small>{item.durationMs} ms · Suave</small></span></button>)}</aside>
      <main className="face-animator-stage-column"><div className="face-animator-stage-heading"><span>PRÉVIA ANIMADA</span><span>{fromPreset && toPreset ? `${fromPreset.name} → ${toPreset.name}` : 'Aguardando presets'}</span></div><div className="face-animator-stage">{loadError ? <div className="face-animator-empty">{loadError}</div> : head ? <div className="face-animator-head" style={{ aspectRatio: `${head.width}/${head.height}` }}><img className="face-animator-head-base" src={head.dataUrl} alt="Cabeça do modelo" />{renderEffects()}{renderComponent('eye', 'left')}{renderComponent('eye', 'right')}{renderComponent('pupil', 'left')}{renderComponent('pupil', 'right')}{renderComponent('eyebrow', 'left')}{renderComponent('eyebrow', 'right')}{renderCatalog('nose')}{renderCatalog('mouth')}</div> : <div className="face-animator-empty">Importe uma cabeça no slot {modelSlot} e salve presets no conjunto Padrão de Preset Expressão Dev.</div>}</div><div className="face-animator-playback"><button className="face-animator-play" type="button" disabled={!fromPreset || !toPreset} onClick={() => { if (progress >= 1) setProgress(0); setPlaying((value) => !value) }}>{playing ? '❚❚ Pausar' : '▶ Reproduzir'}</button><input type="range" min="0" max="1" step="0.001" value={progress} onChange={(event) => { setPlaying(false); setProgress(Number(event.target.value)) }} aria-label="Posição da transição"/><span>{Math.round(progress * 100)}%</span></div><div className="face-animator-track"><div><strong>{recipe.from}</strong><small>Início</small></div><span className="face-animator-track-line"><i style={{ left: `${progress * 100}%` }} /></span><div><strong>{recipe.to}</strong><small>Fim</small></div></div></main>
      <aside className="face-animator-inspector"><header><strong>Composição da transição</strong><small>Os presets de origem ficam intactos</small></header><label>Expressão inicial<select value={recipe.from} onChange={(event) => { setActiveRecipe((current) => ({ ...current, from: event.target.value, name: `${event.target.value} → ${current.to}` })); setProgress(0); setPlaying(false) }}><option value={recipe.from}>{recipe.from}</option>{expressions.filter((name) => name !== recipe.from).map((name) => <option key={name}>{name}</option>)}</select></label><label>Expressão final<select value={recipe.to} onChange={(event) => { setActiveRecipe((current) => ({ ...current, to: event.target.value, name: `${current.from} → ${event.target.value}` })); setProgress(0); setPlaying(false) }}><option value={recipe.to}>{recipe.to}</option>{expressions.filter((name) => name !== recipe.to).map((name) => <option key={name}>{name}</option>)}</select></label><div className="face-animator-effects-summary"><strong>Camadas animadas</strong>{[['Olhos e sobrancelhas', 'Posição · escala · rotação'], ['Pupilas', 'Posição · escala · rotação'], ['Nariz e boca', 'Posição · escala · rotação · opacidade'], ['Blush, sombra e blush da boca', 'Cor · intensidade · posição · forma']].map(([title, detail]) => <div key={title}><Icon name="check" /><span><b>{title}</b><small>{detail}</small></span></div>)}</div><p>Transformações e efeitos fazem interpolação suave. Quando os assets dos presets são diferentes, a composição troca no ponto médio da transição.</p></aside>
    </div>
  </section>
}
