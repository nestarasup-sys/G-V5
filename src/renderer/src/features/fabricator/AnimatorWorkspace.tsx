import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { FabricatorProject, FabricatorSlotSummary } from '../../../../shared/fabricator'
import { Icon } from '../../ui/components/Icon'
import { orderedParts } from './models/rig'
import { detectMotionRig, evaluateMotion, motionDefinitions, motionRigDiagnostics, motionRootOffsetY, type MotionDefinition, type MotionId, type MotionRigMap } from './animator/motions'
import { usePreviewBackground } from './usePreviewBackground'

export function AnimatorWorkspace() {
  const [models, setModels] = useState<FabricatorSlotSummary[]>([])
  const [modelSlot, setModelSlot] = useState<number | null>(null)
  const [source, setSource] = useState<FabricatorProject | null>(null)
  const [motion, setMotion] = useState<MotionId>('walk')
  const [motionCategory, setMotionCategory] = useState<'Todas' | MotionDefinition['category']>('Todas')
  const [progress, setProgress] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [intensity, setIntensity] = useState(1)
  const [stage, setStage] = useState({ width: 0, height: 0 })
  const [loadError, setLoadError] = useState('')
  const [background] = usePreviewBackground()
  const stageRef = useRef<HTMLDivElement | null>(null)
  const progressRef = useRef(0)
  const activeMotion = motionDefinitions.find((item) => item.id === motion) ?? motionDefinitions[0]
  const duration = activeMotion.duration
  const rig: MotionRigMap = useMemo(() => source ? detectMotionRig(source) : {}, [source])
  const diagnostics = useMemo(() => source ? motionRigDiagnostics(source, rig) : [], [source, rig])
  const animated = useMemo(() => source ? evaluateMotion(source, rig, motion, progress, intensity) : null, [source, rig, motion, progress, intensity])
  const parts = useMemo(() => animated ? orderedParts(animated.parts, animated.layerOrder).filter((part) => !animated.hiddenPartIds?.includes(part.id)) : [], [animated])
  const visibleMotions = motionDefinitions.filter((item) => motionCategory === 'Todas' || item.category === motionCategory)
  const scale = animated && stage.width && stage.height ? Math.max(0.05, Math.min((stage.width - 64) / animated.width, (stage.height - 64) / animated.height)) : 1

  useEffect(() => {
    let live = true
    void window.desktop.listFabricatorSlots().then((slots) => {
      if (!live) return
      setModels(slots)
      const defaultSlot = slots.findIndex(Boolean) + 1
      if (defaultSlot > 0) setModelSlot(defaultSlot)
    }).catch((reason: unknown) => { if (live) setLoadError(reason instanceof Error ? reason.message : 'Não foi possível carregar os modelos.') })
    return () => { live = false }
  }, [])

  useEffect(() => {
    let live = true
    setSource(null); setPlaying(false); setProgress(0); setLoadError('')
    if (modelSlot === null) return
    void window.desktop.loadFabricatorSlot(modelSlot).then((project) => { if (live) { setSource(project); if (!project) setLoadError('Este slot ainda não tem um modelo salvo.') } }).catch((reason: unknown) => { if (live) setLoadError(reason instanceof Error ? reason.message : 'Não foi possível abrir este modelo.') })
    return () => { live = false }
  }, [modelSlot])

  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setStage({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [source])

  useEffect(() => {
    if (!playing) return
    let frame = 0
    let previous = performance.now()
    let lastPaint = 0
    const tick = (now: number) => {
      const delta = Math.min(80, now - previous) / 1000
      previous = now
      const next = progressRef.current + delta * speed / duration
      if (next >= 1) {
        if (loop || activeMotion.loop) progressRef.current = next % 1
        else { progressRef.current = 1; setProgress(1); setPlaying(false); return }
      } else progressRef.current = next
      if (now - lastPaint > 32) { setProgress(progressRef.current); lastPaint = now }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, duration, loop, motion, activeMotion.loop])

  function selectMotion(id: MotionId) {
    const definition = motionDefinitions.find((item) => item.id === id)
    setMotion(id); setProgress(0); progressRef.current = 0; setPlaying(false); setLoop(definition?.loop ?? false)
  }

  function seek(value: number) {
    const next = Math.max(0, Math.min(1, value))
    progressRef.current = next; setProgress(next)
  }

  return <section className="fabricator-workspace animator-workspace" aria-label="Animador Dev">
    <header className="animator-toolbar"><span className="animator-title"><Icon name="sparkles" /><span><strong>Animador Dev</strong><small>Animações experimentais calculadas pelo rig</small></span></span><label className="animator-model">Modelo<select value={modelSlot ?? ''} onChange={(event) => setModelSlot(Number(event.target.value))}><option value="" disabled>Escolher modelo</option>{models.map((model, index) => model && <option key={index + 1} value={index + 1}>Modelo {String(index + 1).padStart(2, '0')} · {model.name}</option>)}</select></label><span className="animator-readonly">Prévia temporária · modelo protegido</span></header>
    <div className="animator-content">
      <aside className="animator-motion-list"><header><strong>Animações</strong><small>{motionDefinitions.length} movimentos experimentais</small></header><nav className="animator-categories">{(['Todas', 'Locomoção', 'Gestos', 'Posturas'] as const).map((category) => <button key={category} className={motionCategory === category ? 'active' : ''} onClick={() => setMotionCategory(category)} type="button">{category}</button>)}</nav>{visibleMotions.map((item, index) => <button key={item.id} className={`animator-motion-card${motion === item.id ? ' active' : ''}`} onClick={() => selectMotion(item.id)} type="button"><span className="animator-motion-icon">{String(index + 1).padStart(2, '0')}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span></button>)}<div className="animator-controls"><strong>Ajustes</strong><label>Velocidade <output>{speed.toFixed(1)}×</output><input type="range" min="0.35" max="2" step="0.05" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /></label><label>Intensidade <output>{Math.round(intensity * 100)}%</output><input type="range" min="0.35" max="1.5" step="0.05" value={intensity} onChange={(event) => setIntensity(Number(event.target.value))} /></label><label className="animator-loop"><input type="checkbox" checked={loop} disabled={activeMotion.loop} onChange={(event) => setLoop(event.target.checked)} /> Repetir animação</label></div></aside>
      <div className="animator-preview-column"><div className="animator-preview-heading"><span><i /> PRÉVIA DA ANIMAÇÃO</span><span>{source ? `${source.width} × ${source.height}` : 'Selecione um modelo salvo'}</span></div><div ref={stageRef} className="animator-stage" style={{ '--preview-background': background } as CSSProperties}>
        {animated && <div className="animator-artboard" style={{ width: animated.width * scale, height: animated.height * scale, marginTop: motionRootOffsetY(motion, progress, intensity) * scale }}>
          {parts.map((part) => <img key={part.id} className="animator-part" src={part.dataUrl} alt={part.name} draggable={false} style={{ left: part.x * scale, top: part.y * scale, width: part.width * scale, height: part.height * scale, transform: `rotate(${part.rotation}deg)` }} />)}
        </div>}
        {!source && <div className="animator-empty"><Icon name="body" /><strong>{loadError || (models.some(Boolean) ? 'Carregando modelo…' : 'Salve um modelo para animar')}</strong><small>O animador usa as imagens e juntas do modelo selecionado.</small></div>}
      </div><footer className="animator-player"><div className="animator-player-actions"><button onClick={() => { setPlaying(false); seek(0) }} type="button" title="Voltar ao início">⏮</button><button className="animator-play" onClick={() => { if (progress >= 1) seek(0); setPlaying((value) => !value) }} type="button">{playing ? '❚❚ Pausar' : '▶ Reproduzir'}</button><button onClick={() => setPlaying(false)} type="button" title="Pausar">■</button></div><input className="animator-timeline" type="range" min="0" max="1000" value={Math.round(progress * 1000)} onChange={(event) => seek(Number(event.target.value) / 1000)} aria-label="Posição da animação"/><span className="animator-time">{(progress * duration).toFixed(2)}s / {duration.toFixed(2)}s</span></footer></div>
      <aside className="animator-info"><header><strong>{activeMotion.title}</strong><small>{Object.values(rig).flatMap((sides) => Object.values(sides ?? {})).length} segmentos reconhecidos</small></header><p>{activeMotion.detail} A rotação usa a âncora da própria peça e propaga o movimento às subpeças conectadas.</p><div className="animator-rig-list">{diagnostics.map((entry) => <div key={entry.role}><span>{entry.label}</span><small>Esq.: {entry.left ?? 'não identificada'} · Dir.: {entry.right ?? 'não identificada'}</small></div>)}</div>{source && source.joints.length === 0 && <p className="animator-warning">Este modelo ainda não tem juntas. Conecte as peças em Modelos Dev para animar os segmentos ligados.</p>}{source && diagnostics.some((entry) => !entry.left || !entry.right) && <p className="animator-warning">Alguns segmentos não foram encontrados dos dois lados. A identificação usa nomes e a hierarquia das juntas; revise as conexões em Modelos Dev.</p>}<small className="animator-note">A animação é uma demonstração temporária e não salva alterações no Modelo Dev.</small></aside>
    </div>
  </section>
}
