import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { FabricatorProject, FabricatorSlotSummary, JointLink } from '../../../../shared/fabricator'
import { Icon } from '../../ui/components/Icon'
import { jointPivot, orderedParts, partJointAnchor } from './models/rig'
import { usePreviewBackground } from './usePreviewBackground'

type Role = 'torso' | 'thigh' | 'calf' | 'upperArm' | 'forearm'
type Side = 'left' | 'right'
type Motion = 'walk' | 'arms' | 'sit'
type RigMap = Partial<Record<Role, Partial<Record<Side, string>>>>

const motionCards: Array<{ id: Motion; title: string; detail: string; duration: number }> = [
  { id: 'walk', title: 'Andar', detail: 'Ciclo contínuo com pernas e braços alternados.', duration: 1.05 },
  { id: 'arms', title: 'Cruzar os braços', detail: 'Movimento de entrada e pausa com os braços cruzados.', duration: 1.2 },
  { id: 'sit', title: 'Sentar e cruzar os braços', detail: 'Abaixa as pernas para sentar e depois cruza os braços.', duration: 2.2 }
]

function normalizeName(name: string) {
  return name.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function detectRig(project: FabricatorProject): RigMap {
  const torso = project.parts.find((part) => /tronco|corpo|torso/.test(normalizeName(part.name)))
  const centerX = torso ? torso.x + torso.width / 2 : project.width / 2
  const centerY = torso ? torso.y + torso.height / 2 : project.height / 2
  const candidates = project.parts.filter((part) => part.id !== torso?.id)
  const rig: RigMap = {}
  if (torso) rig.torso = { left: torso.id }
  for (const part of candidates) {
    const name = normalizeName(part.name)
    const x = part.x + part.width / 2
    const y = part.y + part.height / 2
    const side: Side = /esquerd|left|\bl\b|_l\b/.test(name) ? 'left' : /direit|right|\br\b|_r\b/.test(name) ? 'right' : x < centerX ? 'left' : 'right'
    let role: Role | null = null
    if (/antebraco|forearm|lower.?arm/.test(name)) role = 'forearm'
    else if (/braco|arm|manga/.test(name)) role = 'upperArm'
    else if (/canela|panturrilha|calf|lower.?leg/.test(name)) role = 'calf'
    else if (/coxa|thigh|upper.?leg|perna.?superior/.test(name)) role = 'thigh'
    else if (/perna|leg/.test(name)) role = y > centerY ? 'calf' : 'thigh'
    if (!role) continue
    const current = rig[role] ?? {}
    // Keep the closest matching segment to the body when names are duplicated.
    const existingId = current[side]
    if (!existingId) rig[role] = { ...current, [side]: part.id }
    else {
      const existing = project.parts.find((item) => item.id === existingId)
      if (existing && Math.abs(x - centerX) + Math.abs(y - centerY) < Math.abs(existing.x + existing.width / 2 - centerX) + Math.abs(existing.y + existing.height / 2 - centerY)) rig[role] = { ...current, [side]: part.id }
    }
  }
  return rig
}

function rotatePoint(point: { x: number; y: number }, origin: { x: number; y: number }, angle: number) {
  const radians = angle * Math.PI / 180
  const dx = point.x - origin.x, dy = point.y - origin.y
  return { x: origin.x + dx * Math.cos(radians) - dy * Math.sin(radians), y: origin.y + dx * Math.sin(radians) + dy * Math.cos(radians) }
}

function rotateJointBranch(project: FabricatorProject, partId: string, amount: number): FabricatorProject {
  if (Math.abs(amount) < 0.01) return project
  const incoming = project.joints.find((joint) => joint.childPartId === partId)
  const selected = project.parts.find((part) => part.id === partId)
  if (!selected) return project
  const origin = incoming ? jointPivot(incoming) : partJointAnchor(selected, project.joints) ?? { x: selected.x + selected.width / 2, y: selected.y + selected.height / 2 }
  const affected = new Set([partId])
  let changed = true
  while (changed) {
    changed = false
    for (const joint of project.joints) if (joint.fixed && affected.has(joint.parentPartId) && !affected.has(joint.childPartId)) { affected.add(joint.childPartId); changed = true }
  }
  const parts = project.parts.map((part) => {
    if (!affected.has(part.id)) return part
    const center = rotatePoint({ x: part.x + part.width / 2, y: part.y + part.height / 2 }, origin, amount)
    return { ...part, x: center.x - part.width / 2, y: center.y - part.height / 2, rotation: part.rotation + amount, ...(part.jointAnchor ? { jointAnchor: rotatePoint(part.jointAnchor, origin, amount) } : {}) }
  })
  const joints: JointLink[] = project.joints.map((joint) => {
    return {
      ...joint,
      ...(affected.has(joint.parentPartId) ? { parentAnchor: rotatePoint(joint.parentAnchor, origin, amount) } : {}),
      ...(affected.has(joint.childPartId) ? { childAnchor: rotatePoint(joint.childAnchor, origin, amount) } : {}),
      ...((affected.has(joint.parentPartId) || affected.has(joint.childPartId)) ? { pivot: rotatePoint(jointPivot(joint), origin, amount) } : {})
    }
  })
  return { ...project, parts, joints }
}

function blend(a: number, b: number, t: number) {
  const eased = t * t * (3 - 2 * t)
  return a + (b - a) * eased
}

function applyMotion(source: FabricatorProject, rig: RigMap, motion: Motion, progress: number, intensity: number): FabricatorProject {
  let project: FabricatorProject = { ...source, parts: source.parts.map((part) => ({ ...part })), joints: source.joints.map((joint) => ({ ...joint, parentAnchor: { ...joint.parentAnchor }, childAnchor: { ...joint.childAnchor }, ...(joint.pivot ? { pivot: { ...joint.pivot } } : {}) })) }
  const angle = (role: Role, side: Side, degrees: number) => {
    const id = rig[role]?.[side]
    if (id) project = rotateJointBranch(project, id, degrees * intensity)
  }
  const armsCross = (amount: number) => {
    angle('upperArm', 'left', -42 * amount); angle('upperArm', 'right', 42 * amount)
    angle('forearm', 'left', 112 * amount); angle('forearm', 'right', -112 * amount)
  }
  if (motion === 'walk') {
    const phase = progress * Math.PI * 2
    const stride = Math.sin(phase)
    angle('thigh', 'left', -25 * stride)
    angle('thigh', 'right', 25 * stride)
    angle('calf', 'left', Math.max(0, stride) * 34)
    angle('calf', 'right', Math.max(0, -stride) * 34)
    angle('upperArm', 'left', 16 * stride)
    angle('upperArm', 'right', -16 * stride)
    angle('forearm', 'left', -7 * stride)
    angle('forearm', 'right', 7 * stride)
  } else if (motion === 'arms') {
    armsCross(blend(0, 1, Math.min(1, progress * 2.5)))
  } else {
    const sit = blend(0, 1, Math.min(1, progress * 1.65))
    angle('thigh', 'left', 58 * sit); angle('thigh', 'right', -58 * sit)
    angle('calf', 'left', -52 * sit); angle('calf', 'right', 52 * sit)
    const cross = blend(0, 1, Math.max(0, Math.min(1, (progress - 0.36) * 2.2)))
    armsCross(cross)
  }
  return project
}

export function AnimatorWorkspace() {
  const [models, setModels] = useState<FabricatorSlotSummary[]>([])
  const [modelSlot, setModelSlot] = useState<number | null>(null)
  const [source, setSource] = useState<FabricatorProject | null>(null)
  const [motion, setMotion] = useState<Motion>('walk')
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
  const duration = motionCards.find((item) => item.id === motion)?.duration ?? 1
  const rig = useMemo(() => source ? detectRig(source) : {}, [source])
  const animated = useMemo(() => source ? applyMotion(source, rig, motion, progress, intensity) : null, [source, rig, motion, progress, intensity])
  const parts = useMemo(() => animated ? orderedParts(animated.parts, animated.layerOrder).filter((part) => !animated.hiddenPartIds?.includes(part.id)) : [], [animated])
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
        if (loop || motion === 'walk') progressRef.current = next % 1
        else { progressRef.current = 1; setProgress(1); setPlaying(false); return }
      } else progressRef.current = next
      if (now - lastPaint > 32) { setProgress(progressRef.current); lastPaint = now }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, duration, loop, motion])

  function selectMotion(id: Motion) {
    setMotion(id); setProgress(0); progressRef.current = 0; setPlaying(false); setLoop(id === 'walk')
  }

  function seek(value: number) {
    const next = Math.max(0, Math.min(1, value))
    progressRef.current = next; setProgress(next)
  }

  return <section className="fabricator-workspace animator-workspace" aria-label="Animador Dev">
    <header className="animator-toolbar"><span className="animator-title"><Icon name="sparkles" /><span><strong>Animador Dev</strong><small>Animações experimentais calculadas pelo rig</small></span></span><label className="animator-model">Modelo<select value={modelSlot ?? ''} onChange={(event) => setModelSlot(Number(event.target.value))}><option value="" disabled>Escolher modelo</option>{models.map((model, index) => model && <option key={index + 1} value={index + 1}>Modelo {String(index + 1).padStart(2, '0')} · {model.name}</option>)}</select></label><span className="animator-readonly">Prévia temporária · modelo protegido</span></header>
    <div className="animator-content">
      <aside className="animator-motion-list"><header><strong>Animações</strong><small>3 movimentos prontos</small></header>{motionCards.map((item) => <button key={item.id} className={`animator-motion-card${motion === item.id ? ' active' : ''}`} onClick={() => selectMotion(item.id)} type="button"><span className="animator-motion-icon">{item.id === 'walk' ? '↔' : item.id === 'arms' ? '×' : '⌒'}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span></button>)}<div className="animator-controls"><strong>Ajustes</strong><label>Velocidade <output>{speed.toFixed(1)}×</output><input type="range" min="0.35" max="2" step="0.05" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /></label><label>Intensidade <output>{Math.round(intensity * 100)}%</output><input type="range" min="0.35" max="1.5" step="0.05" value={intensity} onChange={(event) => setIntensity(Number(event.target.value))} /></label><label className="animator-loop"><input type="checkbox" checked={loop || motion === 'walk'} disabled={motion === 'walk'} onChange={(event) => setLoop(event.target.checked)} /> Repetir animação</label></div></aside>
      <div className="animator-preview-column"><div className="animator-preview-heading"><span><i /> PRÉVIA DA ANIMAÇÃO</span><span>{source ? `${source.width} × ${source.height}` : 'Selecione um modelo salvo'}</span></div><div ref={stageRef} className="animator-stage" style={{ '--preview-background': background } as CSSProperties}>
        {animated && <div className="animator-artboard" style={{ width: animated.width * scale, height: animated.height * scale, marginTop: -Math.abs(Math.sin(progress * Math.PI * 2)) * 4 * scale }}>
          {parts.map((part) => <img key={part.id} className="animator-part" src={part.dataUrl} alt={part.name} draggable={false} style={{ left: part.x * scale, top: part.y * scale, width: part.width * scale, height: part.height * scale, transform: `rotate(${part.rotation}deg)` }} />)}
        </div>}
        {!source && <div className="animator-empty"><Icon name="body" /><strong>{loadError || (models.some(Boolean) ? 'Carregando modelo…' : 'Salve um modelo para animar')}</strong><small>O animador usa as imagens e juntas do modelo selecionado.</small></div>}
      </div><footer className="animator-player"><div className="animator-player-actions"><button onClick={() => { setPlaying(false); seek(0) }} type="button" title="Voltar ao início">⏮</button><button className="animator-play" onClick={() => { if (progress >= 1) seek(0); setPlaying((value) => !value) }} type="button">{playing ? '❚❚ Pausar' : '▶ Reproduzir'}</button><button onClick={() => setPlaying(false)} type="button" title="Pausar">■</button></div><input className="animator-timeline" type="range" min="0" max="1000" value={Math.round(progress * 1000)} onChange={(event) => seek(Number(event.target.value) / 1000)} aria-label="Posição da animação"/><span className="animator-time">{(progress * duration).toFixed(2)}s / {duration.toFixed(2)}s</span></footer></div>
      <aside className="animator-info"><header><strong>{motionCards.find((item) => item.id === motion)?.title}</strong><small>{Object.values(rig).flatMap((sides) => Object.values(sides ?? {})).length} segmentos reconhecidos</small></header><p>{motionCards.find((item) => item.id === motion)?.detail} A reprodução usa a hierarquia das juntas e respeita as camadas atuais.</p><div className="animator-rig-list">{(['thigh', 'calf', 'upperArm', 'forearm'] as Exclude<Role, 'torso'>[]).map((role) => <div key={role}><span>{({ thigh: 'Coxas', calf: 'Canelas', upperArm: 'Braços superiores', forearm: 'Antebraços' })[role]}</span><small>{rig[role]?.left ? 'Esquerda ✓' : 'Esquerda —'} · {rig[role]?.right ? 'Direita ✓' : 'Direita —'}</small></div>)}</div>{source && source.joints.length === 0 && <p className="animator-warning">Este modelo ainda não tem juntas. Conecte as peças em Modelos Dev para animar os segmentos ligados.</p>}<small className="animator-note">A animação é uma demonstração temporária e não salva alterações no Modelo Dev.</small></aside>
    </div>
  </section>
}
