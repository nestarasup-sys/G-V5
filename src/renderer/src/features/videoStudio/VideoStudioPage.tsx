import { useEffect, useMemo, useRef, useState } from 'react'
import type { StudioDocument, StudioElement } from '../../../../shared/studio'
import {
  actorStateAtFrame, blankVideoProject, changeVideoDuration, commitVideoFrame,
  evaluateVideoProject, importStudioComposition, moveVideoBoundary
} from '../../../../shared/videoStudio'
import type {
  VideoActorState, VideoCharacterTrack, VideoProject, VideoProjectSummary, VideoTextClip
} from '../../../../shared/videoStudio'
import './videoStudio.css'

const LIMIT_HISTORY = 80
const stamp = () => new Date().toISOString()
const showTime = (frames: number, fps: number) => {
  const totalSeconds = frames / fps
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)
  const frame = Math.floor((totalSeconds - Math.floor(totalSeconds)) * fps + 1e-7)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frame).padStart(2, '0')}`
}
const sceneElementStyle = (element: StudioElement): React.CSSProperties => {
  const scale = element.kind === 'character' ? (element.characterScale ?? 100) / 100 : 1
  const width = element.width * scale * (element.kind === 'character' ? (element.characterWidthScale ?? 100) / 100 : 1)
  const height = element.height * scale * (element.kind === 'character' ? (element.characterHeightScale ?? 100) / 100 : 1)
  return {
    left: `calc(50% + ${element.x}%)`, top: `calc(50% + ${element.y}%)`,
    width: `${width}%`, height: `${height}%`,
    transform: `translate(-50%, -50%) rotate(${element.rotation}deg) scaleX(${element.flipX ? -1 : 1})`,
    zIndex: element.zIndex + 2
  }
}
const backgroundStyle = (scene: StudioDocument): React.CSSProperties => ({
  left: `calc(50% + ${scene.backgroundX}%)`,
  top: `calc(50% + ${scene.backgroundY}%)`,
  width: `${scene.backgroundWidth}%`, height: `${scene.backgroundHeight}%`,
  transform: `translate(-50%, -50%) rotate(${scene.backgroundRotation}deg)`
})

export function VideoStudioPage() {
  const [items, setItems] = useState<VideoProjectSummary[]>([])
  const [project, setProject] = useState<VideoProject | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [sourceStudios, setSourceStudios] = useState<StudioDocument[]>([])
  const [sourceId, setSourceId] = useState('')
  const [activeElementId, setActiveElementId] = useState<string | null>(null)
  const [activeClip, setActiveClip] = useState<{ kind: 'dialogue' | 'thought'; id: string } | null>(null)
  const [drafts, setDrafts] = useState<Record<string, VideoActorState>>({})
  const [playhead, setPlayhead] = useState(0)
  const playheadRef = useRef(0)
  const [playing, setPlaying] = useState(false)
  const [pps, setPps] = useState(24)
  const [selectedSegment, setSelectedSegment] = useState('')
  const pastRef = useRef<VideoProject[]>([])
  const futureRef = useRef<VideoProject[]>([])
  const [historyVersion, setHistoryVersion] = useState(0)
  const timelineScrollRef = useRef<HTMLDivElement>(null)

  const seek = (frame: number) => {
    const max = project ? project.durationFrames - 1 : 0
    const next = Math.max(0, Math.min(max, Math.round(frame)))
    playheadRef.current = next
    setPlayhead(next)
  }

  useEffect(() => {
    let alive = true
    void window.desktop.listVideoProjects().then((projects) => { if (alive) setItems(projects) })
      .catch((reason: unknown) => { if (alive) setError(String(reason)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!project) return
    let alive = true
    setStatus('Salvando…')
    const timer = window.setTimeout(() => {
      void window.desktop.saveVideoProject(project)
        .then(() => { if (alive) setStatus('Salvo automaticamente') })
        .catch((reason: unknown) => { if (alive) { setStatus('Falha ao salvar'); setError(String(reason)) } })
    }, 750)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [project])

  useEffect(() => {
    if (!project || !playing) return
    const started = performance.now()
    const initial = playheadRef.current
    let handle = 0
    const tick = (now: number) => {
      const frame = Math.min(project.durationFrames - 1, initial + Math.floor(((now - started) / 1000) * project.frameRate))
      seek(frame)
      if (frame >= project.durationFrames - 1) { setPlaying(false); return }
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [playing, project?.id, project?.frameRate, project?.durationFrames])

  const sceneAssets = useMemo(() => new Map(project?.scene.assets.map((asset) => [asset.id, asset]) ?? []), [project?.scene.assets])
  const stateAtFrame = useMemo(() => project ? evaluateVideoProject(project, playhead) : {}, [project, playhead])
  const selectedElement = project?.scene.elements.find((el) => el.id === activeElementId)
  const selectedTrack = project?.characterTracks.find((track) => track.characterElementId === activeElementId)
  const actor = selectedTrack ? (drafts[selectedTrack.characterElementId] ?? stateAtFrame[selectedTrack.characterElementId] ?? actorStateAtFrame(selectedTrack, playhead)) : null
  const isDraft = Boolean(selectedTrack && drafts[selectedTrack.characterElementId])
  const fps = project?.frameRate ?? 60
  const timelineWidth = Math.max(800, (project?.durationFrames ?? 36000) / fps * pps)

  const update = (next: VideoProject) => {
    if (!project || next === project) return
    pastRef.current = [...pastRef.current, project].slice(-LIMIT_HISTORY)
    futureRef.current = []
    setHistoryVersion((v) => v + 1)
    setProject(next)
  }
  const resetHistory = () => { pastRef.current = []; futureRef.current = []; setHistoryVersion((v) => v + 1) }
  const openProject = async (id: string) => {
    setBusy(true); setError('')
    try {
      const loaded = await window.desktop.loadVideoProject(id)
      setProject(loaded); setPlaying(false); seek(0); setDrafts({}); setActiveElementId(null)
      setActiveClip(null); resetHistory()
      const studios = await window.desktop.listStudios()
      setSourceStudios(studios)
      setSourceId(studios[0]?.id ?? '')
    } catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const createProject = async () => {
    setBusy(true); setError('')
    try {
      const title = `Vídeo ${String(items.length + 1).padStart(2, '0')}`
      const next = blankVideoProject(crypto.randomUUID(), title)
      await window.desktop.saveVideoProject(next)
      setItems((current) => [{ id: next.id, title: next.title, createdAt: next.createdAt, updatedAt: next.updatedAt,
        durationFrames: next.durationFrames, frameRate: next.frameRate, characterCount: 0 }, ...current])
      setProject(next); setPlaying(false); seek(0); setDrafts({}); resetHistory()
      const studios = await window.desktop.listStudios()
      setSourceStudios(studios); setSourceId(studios[0]?.id ?? '')
    } catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const duplicate = async (item: VideoProjectSummary) => {
    setBusy(true); setError('')
    try {
      const original = await window.desktop.loadVideoProject(item.id)
      const next = { ...structuredClone(original), id: crypto.randomUUID(), title: `${original.title} (cópia)`,
        createdAt: stamp(), updatedAt: stamp() }
      next.scene.id = next.id; next.scene.title = next.title
      await window.desktop.saveVideoProject(next)
      setItems((current) => [{ ...item, id: next.id, title: next.title,
        createdAt: next.createdAt, updatedAt: next.updatedAt }, ...current])
    } catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const remove = async (item: VideoProjectSummary) => {
    if (!window.confirm(`Excluir definitivamente "${item.title}" e os assets deste Video Studio?`)) return
    setBusy(true); setError('')
    try {
      await window.desktop.deleteVideoProject(item.id)
      setItems((current) => current.filter((p) => p.id !== item.id))
    } catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const exit = async () => {
    if (project) {
      setBusy(true)
      try {
        await window.desktop.saveVideoProject(project)
        const refreshed = await window.desktop.listVideoProjects()
        setItems(refreshed)
        setProject(null); setPlaying(false); setDrafts({})
      } catch (reason) { setError(String(reason)) }
      finally { setBusy(false) }
    }
  }
  const saveNow = async () => {
    if (!project) return
    setStatus('Salvando…')
    try { await window.desktop.saveVideoProject(project); setStatus('Salvo') }
    catch (reason) { setError(String(reason)); setStatus('Falha ao salvar') }
  }
  const undo = () => {
    if (!project || !pastRef.current.length) return
    const previous = pastRef.current.at(-1)!
    pastRef.current = pastRef.current.slice(0, -1)
    futureRef.current = [project, ...futureRef.current].slice(0, LIMIT_HISTORY)
    setProject(previous); setDrafts({}); setHistoryVersion((v) => v + 1)
  }
  const redo = () => {
    if (!project || !futureRef.current.length) return
    const next = futureRef.current[0]
    futureRef.current = futureRef.current.slice(1)
    pastRef.current = [...pastRef.current, project].slice(-LIMIT_HISTORY)
    setProject(next); setDrafts({}); setHistoryVersion((v) => v + 1)
  }
  const importStudio = () => {
    if (!project) return
    const source = sourceStudios.find((studio) => studio.id === sourceId)
    if (!source) return
    if (project.scene.elements.length && !window.confirm('Substituir a composição atual pelo snapshot do Studio selecionado?')) return
    update(importStudioComposition(project, source))
    setActiveElementId(null); setDrafts({}); setActiveClip(null)
  }
  const importImage = async (category: 'background' | 'object') => {
    if (!project) return
    try {
      const asset = await window.desktop.importStudioImage(category)
      if (!asset) return
      const scene = structuredClone(project.scene)
      scene.assets.push(asset)
      if (category === 'background') {
        scene.backgroundAssetId = asset.id
      } else {
        const element: StudioElement = {
          id: crypto.randomUUID(), kind: 'image', assetId: asset.id, text: '',
          x: 0, y: 0, width: 25, height: 25, rotation: 0,
          zIndex: Math.max(0, ...scene.elements.map((el) => el.zIndex)) + 1
        }
        scene.elements.push(element); setActiveElementId(element.id)
      }
      update({ ...project, scene, updatedAt: stamp() })
    } catch (reason) { setError(String(reason)) }
  }
  const updateElement = (patch: Partial<StudioElement>) => {
    if (!project || !activeElementId) return
    update({ ...project, updatedAt: stamp(), scene: { ...project.scene, elements: project.scene.elements.map((el) =>
      el.id === activeElementId ? { ...el, ...patch } : el) } })
  }
  const draftActor = (patch: Partial<VideoActorState>) => {
    if (!project || !selectedTrack || selectedTrack.locked || !actor) return
    setPlaying(false)
    setDrafts((current) => ({ ...current, [selectedTrack.characterElementId]: { ...actor, ...patch } }))
  }
  const saveFrame = () => {
    if (!project) return
    const next = commitVideoFrame(project, playhead, drafts)
    update(next); setDrafts({})
  }
  const addClip = (kind: 'dialogue' | 'thought') => {
    if (!project) return
    const clip: VideoTextClip = {
      id: crypto.randomUUID(), startFrame: playhead,
      endFrameExclusive: Math.min(project.durationFrames, playhead + fps * 3),
      text: kind === 'dialogue' ? 'Nova fala' : 'Novo pensamento'
    }
    update({ ...project, updatedAt: stamp(), textTracks: project.textTracks.map((track) =>
      track.id === kind ? { ...track, clips: [...track.clips, clip] } : track) })
    setActiveClip({ kind, id: clip.id }); setActiveElementId(null)
  }
  const editClip = (patch: Partial<VideoTextClip>) => {
    if (!project || !activeClip) return
    update({ ...project, updatedAt: stamp(), textTracks: project.textTracks.map((track) => track.id === activeClip.kind
      ? { ...track, clips: track.clips.map((clip) => clip.id === activeClip.id ? { ...clip, ...patch } : clip) }
      : track) })
  }
  const deleteClip = () => {
    if (!project || !activeClip) return
    update({ ...project, updatedAt: stamp(), textTracks: project.textTracks.map((track) => track.id === activeClip.kind
      ? { ...track, clips: track.clips.filter((clip) => clip.id !== activeClip.id) } : track) })
    setActiveClip(null)
  }
  const clickTimeline = (event: React.MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    seek((event.clientX - rect.left) / pps * fps)
    setPlaying(false)
  }
  const beginBoundary = (event: React.PointerEvent<HTMLButtonElement>, track: VideoCharacterTrack, boundaryIndex: number) => {
    if (!project || track.locked) return
    event.preventDefault(); event.stopPropagation(); setPlaying(false)
    const lane = event.currentTarget.closest('.vs-lane') as HTMLElement | null
    if (!lane) return
    const rect = lane.getBoundingClientRect()
    const original = project
    // One history entry for an entire drag, not one per pointer event.
    pastRef.current = [...pastRef.current, original].slice(-LIMIT_HISTORY)
    futureRef.current = []; setHistoryVersion((v) => v + 1)
    const move = (e: PointerEvent) => {
      const target = (e.clientX - rect.left) / pps * fps
      setProject(moveVideoBoundary(original, track.id, boundaryIndex, target))
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }

  if (loading) return <section className="vs-shell vs-wait">Carregando projetos de vídeo…</section>
  if (!project) return <section className="vs-shell vs-library">
    <header className="vs-library-header">
      <div><span className="vs-eyebrow">GACHA NYMI · PRODUÇÃO</span><h1>Video Studio</h1>
        <p>Crie animações com projetos independentes. Seus Studios e personagens originais permanecem intactos.</p></div>
      <button className="vs-button primary" disabled={busy} onClick={() => void createProject()}>+ Novo projeto</button>
    </header>
    {error && <p className="vs-error" role="alert">{error}</p>}
    {items.length === 0 ? <div className="vs-library-empty"><div className="vs-library-symbol">▶</div>
      <h2>Seu primeiro vídeo começa aqui</h2><p>Abra um projeto em branco e monte sua cena, com timeline e animação por quadros.</p>
      <button className="vs-button primary" disabled={busy} onClick={() => void createProject()}>Criar Video Studio</button></div> :
    <div className="vs-project-grid">
      {items.map((item) => <article className="vs-project-card" key={item.id}>
        <button className="vs-project-preview" disabled={busy} type="button" onClick={() => void openProject(item.id)}>
          <span>▶</span><small>{item.characterCount} personagens · {Math.round(item.durationFrames / item.frameRate)}s</small>
        </button>
        <div className="vs-project-meta"><h2>{item.title}</h2><small>Alterado em {new Date(item.updatedAt).toLocaleDateString('pt-BR')}</small></div>
        <div className="vs-project-actions">
          <button disabled={busy} onClick={() => void openProject(item.id)}>Abrir</button>
          <button disabled={busy} onClick={() => void duplicate(item)}>Duplicar</button>
          <button className="danger" disabled={busy} onClick={() => void remove(item)}>Excluir</button>
        </div>
      </article>)}
    </div>}
  </section>

  const activeText = activeClip ? project.textTracks.find((track) => track.id === activeClip.kind)?.clips.find((clip) => clip.id === activeClip.id) : undefined
  const visibleTexts = project.textTracks.flatMap((track) => track.clips.filter((clip) =>
    clip.startFrame <= playhead && playhead < clip.endFrameExclusive).map((clip) => ({ ...clip, kind: track.id })))
  const backgroundAsset = sceneAssets.get(project.scene.backgroundAssetId ?? '')
  const ticks = Array.from({ length: Math.ceil(project.durationFrames / fps / (pps >= 40 ? 5 : 20)) + 1 },
    (_, index) => index * (pps >= 40 ? 5 : 20))
  const sceneSummary = project.scene.elements.length ? '' : 'Cena vazia — importe uma composição do Studio ou uma imagem para começar.'
  return <section className="vs-shell vs-workspace">
    <header className="vs-work-header">
      <div className="vs-work-title"><button onClick={() => void exit()} disabled={busy} title="Voltar à biblioteca">←</button>
        <div><span className="vs-eyebrow">VIDEO STUDIO / PROJETO</span>
          <input aria-label="Nome do projeto" value={project.title} maxLength={100} onChange={(e) => {
            const title = e.target.value
            setProject((current) => current ? { ...current, title, updatedAt: stamp(), scene: { ...current.scene, title } } : current)
          }} /></div></div>
      <div className="vs-work-tools"><span className="vs-status" role="status">{status}</span>
        <button disabled={!pastRef.current.length} onClick={undo} title="Desfazer">↶</button>
        <button disabled={!futureRef.current.length} onClick={redo} title="Refazer">↷</button>
        <button onClick={() => void saveNow()}>Salvar</button>
        <button className="vs-button primary" onClick={saveFrame} title="Gravar estados pendentes no playhead">◇ Salvar frame</button>
      </div>
    </header>
    {error && <p className="vs-error" role="alert">{error}</p>}
    <div className="vs-work-main">
      <aside className="vs-rail" aria-label="Composição e recursos">
        <h2>Composição</h2><p>Snapshot independente. O Studio original não será alterado.</p>
        <label>Importar do Studio
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            {sourceStudios.length === 0 && <option value="">Nenhum Studio criado</option>}
            {sourceStudios.map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}
          </select>
        </label>
        <button disabled={!sourceId} onClick={importStudio}>Usar composição</button>
        <div className="vs-rule" />
        <button onClick={() => void importImage('background')}>+ Imagem de fundo</button>
        <button onClick={() => void importImage('object')}>+ Objeto (imagem)</button>
        <label>Cor do fundo<input type="color" value={project.scene.backgroundColor} onChange={(e) => update({
          ...project, scene: { ...project.scene, backgroundColor: e.target.value }, updatedAt: stamp()
        })} /></label>
        <div className="vs-rule" />
        <h3>Elementos</h3>
        {project.scene.elements.length === 0 && <small>Sem personagens ou objetos.</small>}
        {project.scene.elements.map((element) => <button key={element.id}
          className={activeElementId === element.id ? 'active' : ''}
          onClick={() => { setActiveElementId(element.id); setActiveClip(null) }}>
          {element.kind === 'character' ? '◉' : '▧'} {element.kind === 'character'
            ? project.characterTracks.find((track) => track.characterElementId === element.id)?.label ?? 'Personagem' :
            sceneAssets.get(element.assetId ?? '')?.name ?? element.kind}
        </button>)}
      </aside>
      <section className="vs-preview-region">
        <div className="vs-preview-top"><strong>Preview</strong><span>{showTime(playhead, fps)} · {fps} FPS</span>
          {Object.keys(drafts).length > 0 && <span className="vs-pending">Rascunho não gravado</span>}</div>
        <div className="vs-preview-host">
          <div className="vs-stage" style={{ backgroundColor: project.scene.backgroundColor }}>
            {backgroundAsset && <img className="vs-background" src={backgroundAsset.dataUrl} alt="" style={backgroundStyle(project.scene)} draggable={false} />}
            {[...project.scene.elements].sort((a, b) => a.zIndex - b.zIndex).map((element) => {
              const image = sceneAssets.get(element.assetId ?? '')
              return <div key={element.id}
                className={`vs-stage-element ${activeElementId === element.id ? 'selected' : ''}`}
                onClick={(event) => { event.stopPropagation(); setActiveElementId(element.id); setActiveClip(null) }}
                style={sceneElementStyle(element)}>
                {(element.kind === 'character' || element.kind === 'image') && image
                  ? <img src={image.dataUrl} alt={image.name} draggable={false} />
                  : <span>{element.text}</span>}
              </div>
            })}
            {visibleTexts.map((clip, index) => <div key={clip.id} className={`vs-text-overlay ${clip.kind}`}
              style={{ top: `${74 + index * 12}%` }}>{clip.text}</div>)}
            {sceneSummary && <div className="vs-scene-empty">{sceneSummary}</div>}
          </div>
        </div>
        <div className="vs-transport"><button onClick={() => { setPlaying(false); seek(0) }}>⏮</button>
          <button className="play" onClick={() => setPlaying((v) => !v)}>{playing ? 'Ⅱ Pausar' : '▶ Reproduzir'}</button>
          <button onClick={() => { setPlaying(false); seek(playhead - 1) }}>← 1f</button>
          <button onClick={() => { setPlaying(false); seek(playhead + 1) }}>1f →</button>
          <strong>{showTime(playhead, fps)}</strong>
        </div>
      </section>
      <aside className="vs-rail vs-inspector" aria-label="Inspector">
        <h2>Inspector</h2>
        {activeText ? <>
          <h3>{activeClip?.kind === 'dialogue' ? 'Fala' : 'Pensamento'}</h3>
          <textarea aria-label="Texto do clip" value={activeText.text} onChange={(e) => editClip({ text: e.target.value })} rows={5} />
          <label>Início (frame)<input type="number" min={0} max={activeText.endFrameExclusive - 1} value={activeText.startFrame}
            onChange={(e) => editClip({ startFrame: Math.max(0, Math.min(activeText.endFrameExclusive - 1, Number(e.target.value))) })} /></label>
          <label>Fim exclusivo (frame)<input type="number" min={activeText.startFrame + 1} max={project.durationFrames} value={activeText.endFrameExclusive}
            onChange={(e) => editClip({ endFrameExclusive: Math.max(activeText.startFrame + 1, Math.min(project.durationFrames, Number(e.target.value))) })} /></label>
          <button className="danger" onClick={deleteClip}>Excluir bloco</button>
        </> : selectedElement ? <>
          <h3>{selectedElement.kind === 'character' ? 'Personagem' : 'Objeto'}</h3>
          <div className="vs-compact-grid">
            {(['x','y','width','height','rotation'] as const).map((key) => <label key={key}>{key}
              <input type="number" value={selectedElement[key]} onChange={(e) => updateElement({ [key]: Number(e.target.value) })} />
            </label>)}
          </div>
          {selectedElement.kind === 'character' && selectedTrack && actor && <>
            <div className="vs-rule" /><h3>Estado no playhead</h3>
            <label>Pose
              <select value={actor.poseSlot ?? ''} disabled={selectedTrack.locked}
                onChange={(e) => draftActor({ poseSlot: e.target.value === '' ? null : Number(e.target.value) })}>
                <option value="">Original</option>
                {Array.from({length:12}, (_,i)=>i+1).map((number) => <option key={number} value={number}>Pose {number}</option>)}
              </select></label>
            <label>Preset de expressão (ID)<input value={actor.expressionPresetId ?? ''} disabled={selectedTrack.locked}
              placeholder="Sem preset" onChange={(e) => draftActor({ expressionPresetId: e.target.value || null })} /></label>
            <label>Modo facial
              <select value={actor.faceMode} disabled={selectedTrack.locked} onChange={(e) => draftActor({ faceMode: e.target.value as VideoActorState['faceMode'] })}>
                <option value="idle">Idle</option><option value="blink">Blink</option><option value="talk">Talk</option>
              </select></label>
            <small>Pose, expressão e modo facial são gravados nas faixas; a recomposição visual desses presets ainda será integrada ao renderer do Studio. O bitmap de origem permanece visível nesta etapa.</small>
            <button disabled={!isDraft || selectedTrack.locked} onClick={saveFrame}>Gravar alteração</button>
            <button onClick={() => { if (!selectedTrack.locked) setDrafts((cur) => {
              const next = { ...cur }; delete next[selectedTrack.characterElementId]; return next
            }) }} disabled={!isDraft}>Descartar rascunho</button>
            <label><input type="checkbox" checked={selectedTrack.locked} onChange={(e) =>
              update({ ...project, characterTracks: project.characterTracks.map((t) =>
                t.id === selectedTrack.id ? { ...t, locked: e.target.checked } : t), updatedAt: stamp() })} /> Bloquear faixa</label>
          </>}
        </> : <p>Selecione um personagem, objeto ou bloco da timeline.</p>}
      </aside>
    </div>
    <section className="vs-timeline-region" aria-label="Timeline de animação">
      <div className="vs-timeline-toolbar"><strong>Timeline</strong>
        <button onClick={() => addClip('dialogue')}>+ Fala</button>
        <button onClick={() => addClip('thought')}>+ Pensamento</button>
        <span>Zoom</span><input aria-label="Zoom temporal" type="range" min="4" max="120" value={pps} onChange={(e) => setPps(Number(e.target.value))} />
        <span>{pps}px/s</span>
        <span className="vs-flex" />
        <label>Duração <input aria-label="Duração total em minutos" type="number" min="1" max="480" step="1"
          value={Math.round(project.durationFrames / fps / 60)} onChange={(e) => {
            const minutes = Number(e.target.value)
            if (Number.isFinite(minutes) && minutes > 0) update(changeVideoDuration(project, minutes * 60 * fps))
          }} /> min</label>
      </div>
      <div className="vs-timeline-scroll" ref={timelineScrollRef}>
        <div className="vs-timeline-inner" style={{width: timelineWidth + 170}}>
          <div className="vs-time-ruler"><div className="vs-ruler-label">Faixas</div>
            <div className="vs-lane" style={{width:timelineWidth}} onClick={clickTimeline}>
              {ticks.map((second) => <span className="vs-tick" key={second} style={{left:second*pps}}>{showTime(second*fps,fps).slice(0,5)}</span>)}
            </div>
          </div>
          {project.characterTracks.map((track) => <div className="vs-track-row" key={track.id}>
            <button className="vs-track-label" onClick={() => { setActiveElementId(track.characterElementId); setActiveClip(null) }}>
              ◉ {track.label}
            </button>
            <div className="vs-lane" style={{width:timelineWidth}} onClick={clickTimeline}>
              {track.segments.map((segment, index) => <div key={segment.id} className={`vs-segment ${selectedSegment === segment.id ? 'selected' : ''}`}
                style={{left:segment.startFrame/fps*pps,width:(segment.endFrameExclusive-segment.startFrame)/fps*pps}}
                onClick={(e) => { e.stopPropagation(); setSelectedSegment(segment.id); setActiveElementId(track.characterElementId); setActiveClip(null); seek(segment.startFrame) }}
                title={`Pose ${segment.state.poseSlot ?? 'original'} · ${segment.state.faceMode}`}>
                <span>{segment.state.poseSlot ? `Pose ${segment.state.poseSlot}` : 'Base'} · {segment.state.faceMode}</span>
                {index < track.segments.length-1 && <button className="vs-boundary" disabled={track.locked}
                  aria-label={`Mover fim de ${track.label}`}
                  onPointerDown={(e) => beginBoundary(e, track, index)} />}
              </div>)}
            </div>
          </div>)}
          {project.textTracks.map((track) => <div className="vs-track-row" key={track.id}>
            <span className="vs-track-label">{track.id === 'dialogue' ? '▣ Falas' : '◇ Pensamentos'}</span>
            <div className="vs-lane" style={{width:timelineWidth}} onClick={clickTimeline}>
              {track.clips.map((clip) => <button type="button" key={clip.id} className="vs-text-clip"
                style={{left:clip.startFrame/fps*pps,width:(clip.endFrameExclusive-clip.startFrame)/fps*pps}}
                onClick={(e) => { e.stopPropagation(); setActiveClip({kind:track.id,id:clip.id}); setActiveElementId(null); seek(clip.startFrame) }}>{clip.text}</button>)}
            </div>
          </div>)}
          <div className="vs-marker-overlay" style={{left:170,width:timelineWidth}}>
            {project.saveMarkers.map((marker) => <span key={marker.frame} className="vs-global-marker"
              style={{left:marker.frame/fps*pps}} title={`Frame salvo: ${marker.frame}`} />)}
            <span className="vs-playhead" style={{left:playhead/fps*pps}} />
          </div>
        </div>
      </div>
    </section>
  </section>
}
