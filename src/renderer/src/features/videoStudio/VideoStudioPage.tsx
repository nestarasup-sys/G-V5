import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { VideoActorState, VideoAsset, VideoProject, VideoSceneElement, VideoTextTrack } from '../../../../shared/videoStudio'
import { createVideoProject } from '../../../../shared/videoStudio'
import { evaluateVideoProject, moveCharacterBoundary, recordVideoFrame, updateVideoDuration, stateAtFrame } from './videoRuntime'
import { Icon } from '../../ui/components/Icon'
import './videoStudio.css'

const editorColors = ['#d8a1ca', '#a2b6e9', '#c4a8de', '#f0b3a8', '#accbb5']
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))
const formatFrame = (frame: number, fps: number) => {
  const total = Math.max(0, Math.floor(frame))
  const minutes = Math.floor(total / (fps * 60))
  const seconds = Math.floor(total / fps) % 60
  const frames = total % fps
  return [minutes, seconds, frames].map(number => String(number).padStart(2, '0')).join(':')
}
const prettyDuration = (project: VideoProject) => Math.round(project.durationFrames / project.frameRate / 60) + ' min'

export function VideoStudioPage() {
  const [projects, setProjects] = useState<VideoProject[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [folder, setFolder] = useState('')
  const [saveStatus, setSaveStatus] = useState('Pronto')
  const [dirty, setDirty] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [zoom, setZoom] = useState(24)
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [selectedClip, setSelectedClip] = useState<{ trackId: string; clipId: string } | null>(null)
  const [drafts, setDrafts] = useState<Record<string, VideoActorState>>({})
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const projectRef = useRef<VideoProject | null>(null)
  const dirtyRef = useRef(false)
  const pastRef = useRef<VideoProject[]>([])
  const futureRef = useRef<VideoProject[]>([])
  const laneScrollRef = useRef<HTMLDivElement>(null)

  const activeProject = projects.find(item => item.id === activeId) ?? null

  useEffect(() => {
    let canceled = false
    void Promise.all([window.desktop.listVideoProjects(), window.desktop.getVideoProjectFolder()])
      .then(([items, path]) => { if (!canceled) { setProjects(items); setFolder(path) } })
      .catch(reason => { if (!canceled) setError(String(reason instanceof Error ? reason.message : reason)) })
      .finally(() => { if (!canceled) setLoading(false) })
    return () => { canceled = true }
  }, [])

  useEffect(() => { projectRef.current = activeProject }, [activeProject])
  useEffect(() => { dirtyRef.current = dirty }, [dirty])

  const save = useCallback(async (target?: VideoProject | null) => {
    const current = target ?? projectRef.current
    if (!current) return
    try {
      setSaveStatus('Salvando…')
      await window.desktop.saveVideoProject(current)
      if (projectRef.current === current) { dirtyRef.current = false; setDirty(false) }
      setSaveStatus('Salvo')
    } catch (reason) {
      setSaveStatus('Falha ao salvar')
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [])

  useEffect(() => {
    if (!activeProject || !dirty) return
    const id = window.setTimeout(() => { void save(activeProject) }, 800)
    return () => window.clearTimeout(id)
  }, [activeProject, dirty, save])

  useEffect(() => () => {
    if (dirtyRef.current && projectRef.current) void window.desktop.saveVideoProject(projectRef.current)
  }, [])

  const commit = (recipe: (current: VideoProject) => VideoProject, record = true) => {
    const current = projectRef.current
    if (!current) return
    const next = recipe(current)
    if (next === current) return
    if (record) {
      pastRef.current = [...pastRef.current.slice(-79), current]
      futureRef.current = []
    }
    projectRef.current = next
    setProjects(items => items.map(item => item.id === current.id ? next : item))
    dirtyRef.current = true
    setDirty(true)
    setSaveStatus('Alterações pendentes')
  }

  const open = (id: string) => {
    if (dirtyRef.current && projectRef.current) void save(projectRef.current)
    setActiveId(id)
    projectRef.current = projects.find(item => item.id === id) ?? null
    pastRef.current = []
    futureRef.current = []
    setDirty(false)
    dirtyRef.current = false
    setPlaying(false)
    setPlayhead(0)
    setDrafts({})
    setSelectedClip(null)
    setSelectedElementId(null)
    setError('')
  }

  const exit = () => {
    if (dirtyRef.current && projectRef.current) void save(projectRef.current)
    setActiveId(null)
    setPlaying(false)
    setSelectedClip(null)
    setSelectedElementId(null)
  }

  const create = async () => {
    const nextNumber = 1 + projects.reduce((high, item) => Math.max(high, Number(item.title.match(/^Video\s+(\d+)/)?.[1] ?? 0)), 0)
    const now = new Date().toISOString()
    const project = createVideoProject(crypto.randomUUID(), 'Video ' + String(nextNumber).padStart(2, '0'), now)
    project.color = editorColors[(nextNumber - 1) % editorColors.length]
    setBusy(true)
    try {
      await window.desktop.saveVideoProject(project)
      setProjects(items => [project, ...items])
      setSelectedProjectId(project.id)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  const duplicate = async (source: VideoProject) => {
    setBusy(true)
    try {
      const now = new Date().toISOString()
      const copy: VideoProject = {
        ...structuredClone(source), id: crypto.randomUUID(), title: source.title + ' — Cópia',
        createdAt: now, updatedAt: now
      }
      await window.desktop.saveVideoProject(copy)
      setProjects(items => [copy, ...items])
      setSelectedProjectId(copy.id)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  const remove = async (project: VideoProject) => {
    if (!window.confirm('Excluir "' + project.title + '" permanentemente?')) return
    setBusy(true)
    try {
      await window.desktop.deleteVideoProject(project.id)
      setProjects(items => items.filter(item => item.id !== project.id))
      setSelectedProjectId(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  const undo = () => {
    const previous = pastRef.current.pop()
    const current = projectRef.current
    if (!previous || !current) return
    futureRef.current.push(current)
    commit(() => previous, false)
  }
  const redo = () => {
    const next = futureRef.current.pop()
    const current = projectRef.current
    if (!next || !current) return
    pastRef.current.push(current)
    commit(() => next, false)
  }

  const addAsset = async (category: VideoAsset['category']) => {
    const currentId = projectRef.current?.id
    if (!currentId) return
    try {
      const asset = await window.desktop.importVideoImage(category)
      if (!asset || projectRef.current?.id !== currentId) return
      const elementId = crypto.randomUUID()
      commit(project => {
        const nextAssets = [...project.assets, asset]
        if (category === 'background') return { ...project, assets: nextAssets, canvas: { ...project.canvas, backgroundAssetId: asset.id } }
        const isCharacter = category === 'character'
        const element: VideoSceneElement = {
          id: elementId, kind: isCharacter ? 'character' : 'image',
          name: asset.name.replace(/\.[^.]+$/, ''), assetId: asset.id,
          x: project.canvas.width / 2, y: project.canvas.height / 2,
          width: isCharacter ? 420 : 480, height: isCharacter ? 650 : 320,
          rotation: 0, zIndex: project.elements.length + 10, flipX: false
        }
        return {
          ...project, assets: nextAssets, elements: [...project.elements, element],
          characterTracks: isCharacter ? [...project.characterTracks, {
            id: crypto.randomUUID(), elementId, name: element.name, order: project.characterTracks.length,
            locked: false, collapsed: false,
            segments: [{ id: crypto.randomUUID(), startFrame: 0, endFrameExclusive: project.durationFrames,
              state: { poseId: null, expressionId: null, faceMode: 'idle' as const }, transitionInMs: 20 }]
          }] : project.characterTracks
        }
      })
      setSelectedElementId(elementId)
      setSelectedClip(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const importFace = async (elementId: string, mode: 'idle' | 'blink' | 'talk') => {
    const source = projectRef.current
    if (!source) return
    try {
      const asset = await window.desktop.importVideoImage('character')
      if (!asset || projectRef.current?.id !== source.id) return
      commit(project => ({
        ...project, assets: [...project.assets, asset],
        elements: project.elements.map(element => element.id === elementId
          ? { ...element, faceAssets: { ...element.faceAssets, [mode]: asset.id } } : element)
      }))
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const addText = (kind: VideoTextTrack['kind']) => {
    if (!activeProject) return
    const currentFrame = Math.min(playhead, activeProject.durationFrames - 1)
    const id = crypto.randomUUID()
    commit(project => ({
      ...project,
      textTracks: project.textTracks.map(track => track.kind !== kind || track.locked ? track : {
        ...track, clips: [...track.clips, {
          id, startFrame: currentFrame,
          endFrameExclusive: Math.min(project.durationFrames, currentFrame + project.frameRate * 3),
          text: kind === 'dialogue' ? 'Nova fala' : 'Novo pensamento'
        }]
      })
    }))
    setSelectedClip({ trackId: kind, clipId: id })
    setSelectedElementId(null)
  }

  useEffect(() => {
    if (!playing || !activeProject) return
    const startFrame = playhead
    const started = performance.now()
    let request = 0
    const tick = (now: number) => {
      const elapsedFrames = (now - started) * activeProject.frameRate / 1000
      const next = Math.min(activeProject.durationFrames - 1, startFrame + Math.floor(elapsedFrames))
      setPlayhead(current => current === next ? current : next)
      if (next >= activeProject.durationFrames - 1) { setPlaying(false); return }
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
    // Playback must start from the chosen frame; playhead updates do not restart the clock.
  }, [playing, activeProject?.id, activeProject?.durationFrames, activeProject?.frameRate])

  const updateDraft = (elementId: string, patch: Partial<VideoActorState>) => {
    if (!activeProject) return
    const track = activeProject.characterTracks.find(item => item.elementId === elementId)
    const state = track ? stateAtFrame(track, playhead) : null
    setDrafts(values => ({ ...values, [elementId]: { poseId: null, expressionId: null, faceMode: 'idle', ...state, ...values[elementId], ...patch } }))
  }

  const saveFrame = () => {
    if (!activeProject) return
    commit(project => recordVideoFrame(project, playhead, drafts))
    setDrafts({})
  }

  const changeDuration = (minutes: number) => {
    if (!activeProject) return
    const desired = activeProject.durationFrames + activeProject.frameRate * minutes * 60
    const next = updateVideoDuration(activeProject, desired)
    if (next === activeProject) setError('Não é possível reduzir: existem estados ou textos além do limite solicitado.')
    else { commit(() => next); setPlayhead(frame => Math.min(frame, next.durationFrames - 1)) }
  }

  const beginElementDrag = (event: ReactPointerEvent<HTMLElement>, element: VideoSceneElement) => {
    if (!activeProject) return
    event.preventDefault()
    event.stopPropagation()
    setSelectedElementId(element.id)
    setSelectedClip(null)
    setPlaying(false)
    const rect = event.currentTarget.closest('.vs-stage')?.getBoundingClientRect()
    if (!rect) return
    const initial = { x: element.x, y: element.y }
    const beginX = event.clientX, beginY = event.clientY
    let recorded = false
    const onMove = (next: PointerEvent) => {
      const x = clamp(initial.x + (next.clientX - beginX) * activeProject.canvas.width / rect.width, 0, activeProject.canvas.width)
      const y = clamp(initial.y + (next.clientY - beginY) * activeProject.canvas.height / rect.height, 0, activeProject.canvas.height)
      commit(project => ({
        ...project, elements: project.elements.map(item => item.id === element.id ? { ...item, x, y } : item)
      }), !recorded)
      recorded = true
    }
    const onEnd = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onEnd) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd, { once: true })
  }

  const beginBoundaryDrag = (event: ReactPointerEvent<HTMLButtonElement>, trackId: string, leftId: string, rightId: string) => {
    if (!activeProject) return
    event.preventDefault()
    event.stopPropagation()
    setPlaying(false)
    const row = event.currentTarget.closest('.vs-lane-body') as HTMLElement | null
    if (!row) return
    const start = event.clientX
    const track = activeProject.characterTracks.find(item => item.id === trackId)
    const original = track?.segments.find(item => item.id === leftId)?.endFrameExclusive
    if (original === undefined) return
    let recorded = false
    const move = (next: PointerEvent) => {
      const delta = Math.round((next.clientX - start) * activeProject.frameRate / zoom)
      commit(project => moveCharacterBoundary(project, trackId, leftId, rightId, original + delta), !recorded)
      recorded = true
    }
    const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end, { once: true })
  }

  if (!activeProject) return (
    <main className="vs-library studio-page" aria-label="Video Studio">
      <header className="studio-page-header">
        <h1>Video Studio</h1>
        <small>{folder ? 'Projetos locais: ' + folder : 'Sua biblioteca de projetos de animação'}</small>
      </header>
      <div className="studio-toolbar">
        <button className="studio-action studio-action-primary" type="button" disabled={busy || loading} onClick={() => void create()}><Icon name="plus" />Criar projeto</button>
      </div>
      {error && <p className="studio-error-message" role="alert">{error}</p>}
      {loading ? <section className="studio-empty-state"><strong>Carregando projetos…</strong></section>
        : projects.length > 0 ? (
          <section className="studio-grid" aria-label="Projetos do Video Studio">
            {projects.map(project => <article className={'studio-card' + (selectedProjectId === project.id ? ' selected' : '')} key={project.id}>
              <header className="studio-card-heading">
                <button type="button" className="studio-card-open" onClick={() => open(project.id)}>{project.title}</button>
                <div className="studio-card-actions">
                  <button type="button" className="studio-card-action" title="Duplicar projeto" aria-label={'Duplicar ' + project.title} disabled={busy} onClick={() => void duplicate(project)}>▢</button>
                  <button type="button" className="studio-card-action danger" title="Excluir projeto" aria-label={'Excluir ' + project.title} disabled={busy} onClick={() => void remove(project)}><Icon name="trash" /></button>
                </div>
              </header>
              <button className="studio-cover vs-project-cover" style={{ backgroundColor: project.color }} type="button" onClick={() => open(project.id)}>
                <span><Icon name="camera" /> {prettyDuration(project)} · {project.frameRate} FPS</span>
                <strong>{project.title}</strong>
              </button>
            </article>)}
          </section>
        ) : <section className="studio-empty-state"><span><Icon name="camera" /></span><strong>Nenhum vídeo criado</strong><small>Crie um projeto de animação para começar.</small></section>}
    </main>
  )

  const project = activeProject
  const canvas = project.canvas
  const evaluation = evaluateVideoProject(project, playhead / project.frameRate)
  const evaluatedById = new Map(evaluation.characters.map(item => [item.elementId, item]))
  const assetById = new Map(project.assets.map(asset => [asset.id, asset]))
  const seconds = project.durationFrames / project.frameRate
  const totalWidth = Math.max(200, seconds * zoom)
  const selectedElement = project.elements.find(item => item.id === selectedElementId) ?? null
  const currentTrack = selectedElement ? project.characterTracks.find(item => item.elementId === selectedElement.id) : undefined
  const initialState = currentTrack ? stateAtFrame(currentTrack, playhead) : null
  const previewState = selectedElement && initialState ? (drafts[selectedElement.id] ?? initialState) : null
  const selectedTextTrack = project.textTracks.find(track => track.id === selectedClip?.trackId)
  const selectedTextItem = selectedTextTrack?.clips.find(item => item.id === selectedClip?.clipId)
  const background = assetById.get(canvas.backgroundAssetId ?? '')
  const pixelsPerFrame = zoom / project.frameRate
  const rulerTicks = Array.from({ length: Math.ceil(seconds / 5) + 1 }, (_, i) => i * 5)

  const seekAtX = (clientX: number, body: HTMLElement) => {
    const rect = body.getBoundingClientRect()
    const next = Math.round((clientX - rect.left) * project.frameRate / zoom)
    setPlayhead(clamp(next, 0, project.durationFrames - 1))
    setPlaying(false)
  }

  return (
    <main className="vs-editor" aria-label={'Editando ' + project.title}>
      <header className="vs-header">
        <button type="button" onClick={exit} className="vs-back">← Projetos</button>
        <input aria-label="Nome do projeto" value={project.title} maxLength={100} onChange={event => {
          const title = event.target.value
          commit(current => ({ ...current, title, updatedAt: new Date().toISOString() }))
        }} />
        <span className="vs-save-status" role="status">{saveStatus}</span>
        <button type="button" onClick={undo} disabled={!pastRef.current.length}>↶ Desfazer</button>
        <button type="button" onClick={redo} disabled={!futureRef.current.length}>↷ Refazer</button>
        <button type="button" onClick={() => void save(project)}><Icon name="save" /> Salvar</button>
      </header>
      {error && <p className="vs-error" role="alert">{error}<button type="button" onClick={() => setError('')}>Fechar</button></p>}
      <div className="vs-workspace">
        <aside className="vs-rail">
          <h2>Cena</h2>
          <button type="button" onClick={() => void addAsset('background')}><Icon name="frame" /> Adicionar fundo</button>
          <button type="button" onClick={() => void addAsset('character')}><Icon name="user" /> Adicionar personagem</button>
          <button type="button" onClick={() => void addAsset('object')}><Icon name="plus" /> Adicionar objeto</button>
          <div className="vs-divider" />
          <h3>Elementos</h3>
          {project.elements.length === 0 && <p>Nenhum elemento. Importe uma imagem para começar.</p>}
          {[...project.elements].sort((a, b) => b.zIndex - a.zIndex).map(element =>
            <button type="button" key={element.id} className={selectedElementId === element.id ? 'selected' : ''}
              onClick={() => { setSelectedElementId(element.id); setSelectedClip(null) }}>{element.name}</button>
          )}
        </aside>
        <section className="vs-preview-panel">
          <div className="vs-preview-caption"><strong>PREVIEW</strong><span>{canvas.width} × {canvas.height} · {project.frameRate} FPS</span></div>
          <div className="vs-preview-surround">
            <div className="vs-stage" style={{ aspectRatio: canvas.width + ' / ' + canvas.height, backgroundColor: canvas.backgroundColor }}
              onPointerDown={() => { setSelectedElementId(null); setSelectedClip(null) }}>
              {background && <img className="vs-background" src={background.dataUrl} alt="" draggable={false} />}
              {[...project.elements].sort((a, b) => a.zIndex - b.zIndex).map(element => {
                const actor = evaluatedById.get(element.id)
                const faceMode = element.id === selectedElementId ? drafts[element.id]?.faceMode ?? actor?.state.faceMode : actor?.state.faceMode
                const imageId = element.kind === 'character' && faceMode ? element.faceAssets?.[faceMode] ?? element.assetId : element.assetId
                const asset = assetById.get(imageId)
                if (!asset) return null
                return <img key={element.id} className={'vs-stage-element' + (selectedElementId === element.id ? ' selected' : '')}
                  src={asset.dataUrl} alt={element.name} draggable={false}
                  onPointerDown={event => beginElementDrag(event, element)}
                  style={{
                    left: 100 * element.x / canvas.width + '%', top: 100 * element.y / canvas.height + '%',
                    width: 100 * element.width / canvas.width + '%', height: 100 * element.height / canvas.height + '%',
                    transform: 'translate(-50%, -50%) rotate(' + element.rotation + 'deg) scaleX(' + (element.flipX ? -1 : 1) + ')',
                    zIndex: element.zIndex
                  }} />
              })}
              <div className="vs-text-preview" aria-live="off">
                {evaluation.texts.map(text => <div key={text.id} className={text.kind}>{text.text}</div>)}
              </div>
            </div>
          </div>
          <div className="vs-transport">
            <button type="button" onClick={() => { setPlaying(false); setPlayhead(0) }}>|‹</button>
            <button type="button" onClick={() => setPlaying(value => !value)}>{playing ? '❚❚' : '▶'}</button>
            <button type="button" onClick={() => { setPlaying(false); setPlayhead(value => Math.max(0, value - 1)) }}>‹ 1f</button>
            <button type="button" onClick={() => { setPlaying(false); setPlayhead(value => Math.min(project.durationFrames - 1, value + 1)) }}>1f ›</button>
            <strong>{formatFrame(playhead, project.frameRate)}</strong><span> / {formatFrame(project.durationFrames, project.frameRate)}</span>
            <button type="button" className="vs-record" onClick={saveFrame} title="Gravar alterações de pose/expressão/modo facial no frame atual">● Salvar frame</button>
          </div>
        </section>
        <aside className="vs-inspector">
          <h2>Inspector</h2>
          {selectedElement ? <>
            <h3>{selectedElement.name}</h3>
            <label>Posição X <input type="number" value={Math.round(selectedElement.x)} onChange={event => commit(current => ({
              ...current, elements: current.elements.map(element => element.id === selectedElement.id ? { ...element, x: Number(event.target.value) } : element)
            }))} /></label>
            <label>Posição Y <input type="number" value={Math.round(selectedElement.y)} onChange={event => commit(current => ({
              ...current, elements: current.elements.map(element => element.id === selectedElement.id ? { ...element, y: Number(event.target.value) } : element)
            }))} /></label>
            <label>Escala · largura <input type="number" value={Math.round(selectedElement.width)} min="1" onChange={event => commit(current => ({
              ...current, elements: current.elements.map(element => element.id === selectedElement.id ? { ...element, width: Math.max(1, Number(event.target.value)) } : element)
            }))} /></label>
            <label>Escala · altura <input type="number" value={Math.round(selectedElement.height)} min="1" onChange={event => commit(current => ({
              ...current, elements: current.elements.map(element => element.id === selectedElement.id ? { ...element, height: Math.max(1, Number(event.target.value)) } : element)
            }))} /></label>
            <label>Rotação <input type="number" value={selectedElement.rotation} onChange={event => commit(current => ({
              ...current, elements: current.elements.map(element => element.id === selectedElement.id ? { ...element, rotation: Number(event.target.value) } : element)
            }))} /></label>
            <button type="button" onClick={() => commit(current => ({ ...current, elements: current.elements.map(element => element.id === selectedElement.id ? { ...element, flipX: !element.flipX } : element) }))}>↔ Inverter</button>
            {currentTrack && previewState && <>
              <div className="vs-divider" /><h3>Atuação — rascunho</h3>
              <p>As alterações abaixo só entram na timeline quando você clicar em <b>Salvar frame</b>.</p>
              <label>Modo facial
                <select value={previewState.faceMode} onChange={event => updateDraft(selectedElement.id, { faceMode: event.target.value as VideoActorState['faceMode'] })}>
                  <option value="idle">Idle</option><option value="blink">Blink</option><option value="talk">Talk</option>
                </select>
              </label>
              <label>Pose (ID provisório) <input value={previewState.poseId ?? ''} placeholder="Aguardando adapter de pose" onChange={event => updateDraft(selectedElement.id, { poseId: event.target.value || null })} /></label>
              <label>Expressão (ID provisório) <input value={previewState.expressionId ?? ''} placeholder="Aguardando adapter facial" onChange={event => updateDraft(selectedElement.id, { expressionId: event.target.value || null })} /></label>
              <div className="vs-face-assets">
                {(['idle', 'blink', 'talk'] as const).map(mode => <button type="button" key={mode} onClick={() => void importFace(selectedElement.id, mode)}>Imagem {mode} {selectedElement.faceAssets?.[mode] ? '✓' : '+'}</button>)}
              </div>
              <p>Idle/Blink/Talk usam imagens associadas até a integração com o compositor real. Não há automação facial nesta fase.</p>
            </>}
          </> : selectedTextItem && selectedTextTrack ? <>
            <h3>{selectedTextTrack.name}</h3>
            <label>Texto <textarea value={selectedTextItem.text} onChange={event => commit(current => ({
              ...current, textTracks: current.textTracks.map(track => track.id !== selectedTextTrack.id ? track : {
                ...track, clips: track.clips.map(clip => clip.id !== selectedTextItem.id ? clip : { ...clip, text: event.target.value })
              })
            }))} /></label>
            <button type="button" onClick={() => {
              commit(current => ({ ...current, textTracks: current.textTracks.map(track => track.id !== selectedTextTrack.id ? track : {
                ...track, clips: track.clips.filter(clip => clip.id !== selectedTextItem.id)
              }) }))
              setSelectedClip(null)
            }}>Excluir bloco</button>
          </> : <p>Selecione um personagem, objeto ou bloco na timeline.</p>}
          <div className="vs-divider" />
          <h3>Projeto</h3>
          <label>Fundo <input type="color" value={canvas.backgroundColor} onChange={event => commit(current => ({ ...current, canvas: { ...current.canvas, backgroundColor: event.target.value } }))} /></label>
          <p>Projeto independente dos dados do Studio normal e do Fabricador.</p>
        </aside>
      </div>
      <section className="vs-timeline" aria-label="Timeline do Video Studio">
        <header className="vs-timeline-header">
          <strong>TIMELINE</strong>
          <button type="button" onClick={() => addText('dialogue')}>+ Fala</button>
          <button type="button" onClick={() => addText('thought')}>+ Pensamento</button>
          <span className="vs-flex" />
          <span>Duração</span>
          <button type="button" onClick={() => changeDuration(-1)}>− 1 min</button>
          <span>{prettyDuration(project)}</span>
          <button type="button" onClick={() => changeDuration(1)}>+ 1 min</button>
          <span>Zoom</span>
          <button type="button" onClick={() => setZoom(value => Math.max(1, value / 2))}>−</button>
          <button type="button" onClick={() => setZoom(value => Math.min(160, value * 2))}>+</button>
          <button type="button" onClick={() => {
            const width = laneScrollRef.current?.clientWidth ?? 800
            setZoom(clamp(width / seconds, 1, 160))
          }}>Fit</button>
        </header>
        <div className="vs-timeline-grid">
          <div className="vs-lane-labels">
            <div className="vs-ruler-label">TRILHAS · {project.characterTracks.length + project.textTracks.length}</div>
            {project.characterTracks.map(track => <div className="vs-lane-label" key={track.id}>
              <button type="button" onClick={() => { setSelectedElementId(track.elementId); setSelectedClip(null) }}>{track.name}</button>
              <button type="button" title={track.locked ? 'Desbloquear faixa' : 'Bloquear faixa'} onClick={() => commit(current => ({
                ...current, characterTracks: current.characterTracks.map(item => item.id === track.id ? { ...item, locked: !item.locked } : item)
              }))}>{track.locked ? '🔒' : '🔓'}</button>
            </div>)}
            {project.textTracks.map(track => <div className="vs-lane-label" key={track.id}>
              <button type="button">{track.name}</button>
              <button type="button" onClick={() => commit(current => ({ ...current, textTracks: current.textTracks.map(item => item.id === track.id ? { ...item, locked: !item.locked } : item) }))}>{track.locked ? '🔒' : '🔓'}</button>
            </div>)}
          </div>
          <div className="vs-scroll-lanes" ref={laneScrollRef}>
            <div className="vs-lanes-content" style={{ width: totalWidth }}>
              <div className="vs-ruler" onPointerDown={event => seekAtX(event.clientX, event.currentTarget)}>
                {rulerTicks.map(t => <span key={t} className="vs-tick" style={{ left: t * zoom }}><i />{Math.floor(t / 60)}:{String(t % 60).padStart(2, '0')}</span>)}
              </div>
              {project.characterTracks.map(track => <div className={'vs-lane-body' + (track.locked ? ' locked' : '')} key={track.id}>
                {track.segments.map((segment, index) => <div key={segment.id}
                  className={'vs-segment' + (segment.startFrame <= playhead && playhead < segment.endFrameExclusive ? ' active' : '')}
                  style={{ left: segment.startFrame * pixelsPerFrame, width: Math.max(1, (segment.endFrameExclusive - segment.startFrame) * pixelsPerFrame) }}
                  title={track.name + ' · ' + formatFrame(segment.startFrame, project.frameRate) + '–' + formatFrame(segment.endFrameExclusive, project.frameRate)}
                  onClick={() => { setSelectedElementId(track.elementId); setSelectedClip(null); setPlayhead(segment.startFrame); setPlaying(false) }}>
                  <span>{segment.state.faceMode.toUpperCase()}</span>
                  {index > 0 && !track.locked && <button type="button" className="vs-boundary-handle"
                    title="Arrastar fronteira compartilhada" onPointerDown={event => beginBoundaryDrag(event, track.id, track.segments[index - 1].id, segment.id)} />}
                </div>)}
              </div>)}
              {project.textTracks.map(track => <div className="vs-lane-body vs-text-lane" key={track.id}>
                {track.clips.map(clip => <button type="button" key={clip.id}
                  className={'vs-text-clip' + (selectedClip?.clipId === clip.id ? ' selected' : '')}
                  style={{ left: clip.startFrame * pixelsPerFrame, width: Math.max(5, (clip.endFrameExclusive - clip.startFrame) * pixelsPerFrame) }}
                  onClick={() => { setSelectedClip({ trackId: track.id, clipId: clip.id }); setSelectedElementId(null); setPlayhead(clip.startFrame); setPlaying(false) }}>
                  {clip.text}
                </button>)}
              </div>)}
              {project.saveMarkers.map(marker => <div className="vs-save-marker" key={marker.frame} style={{ left: marker.frame * pixelsPerFrame }} title={'Frame salvo: ' + marker.frame} />)}
              <div className="vs-playhead" style={{ left: playhead * pixelsPerFrame }} />
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
