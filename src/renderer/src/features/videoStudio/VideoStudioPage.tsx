import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type {
  VideoActorState, VideoAsset, VideoCharacterTrack, VideoFaceMode, VideoProject, VideoSceneElement, VideoTextClip
} from '../../../../shared/videoStudio'
import { createVideoProject } from '../../../../shared/videoStudio'
import type { StudioDocument } from '../../../../shared/studio'
import {
  evaluateVideoProject, equalActorState, moveCharacterBoundary, recordVideoFrame,
  stateAtFrame, updateVideoDuration
} from './videoRuntime'
import { Icon } from '../../ui/components/Icon'
import './videoStudio.css'

const initialState: VideoActorState = { poseId: null, expressionId: null, faceMode: 'idle' }
const modeNames: Record<VideoFaceMode, string> = { idle: 'Idle', blink: 'Blink', talk: 'Talk' }
const HISTORY_LIMIT = 100
type BoundaryDrag = { trackId: string; leftId: string; rightId: string; frame: number }

function assetById(project: VideoProject, id: string | null | undefined) {
  return project.assets.find(asset => asset.id === id)
}
function formattedTime(frame: number, fps: number) {
  const time = Math.max(0, frame) / fps
  const m = Math.floor(time / 60)
  const s = Math.floor(time % 60)
  const f = Math.floor(frame % fps)
  return [m, s, f].map(n => String(n).padStart(2, '0')).join(':')
}
function safeLabel(value: string, fallback: string) { return value.trim().slice(0, 80) || fallback }

export function VideoStudioPage() {
  const [projects, setProjects] = useState<VideoProject[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [folder, setFolder] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, VideoActorState>>({})
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [zoom, setZoom] = useState(4)
  const [boundaryPreview, setBoundaryPreview] = useState<BoundaryDrag | null>(null)
  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number } | null>(null)
  const [selectedClip, setSelectedClip] = useState<{ trackId: string; id: string } | null>(null)
  const [studioSources, setStudioSources] = useState<StudioDocument[] | null>(null)
  const [sourceCharacterNames, setSourceCharacterNames] = useState<Record<string, string>>({})

  const undoStack = useRef<VideoProject[]>([])
  const redoStack = useRef<VideoProject[]>([])
  const latestRef = useRef<VideoProject | null>(null)
  const dirtyRef = useRef(false)
  const playheadRef = useRef(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const activeProject = useMemo(() => projects.find(project => project.id === activeId) ?? null, [projects, activeId])
  latestRef.current = activeProject
  dirtyRef.current = dirty

  const seek = useCallback((frame: number) => {
    const duration = latestRef.current?.durationFrames ?? 1
    const target = Math.max(0, Math.min(duration - 1, Math.floor(frame)))
    playheadRef.current = target
    setPlayhead(target)
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.all([window.desktop.listVideoProjects(), window.desktop.getVideoProjectFolder()])
      .then(([loaded, root]) => {
        if (cancelled) return
        setProjects(loaded)
        setFolder(root)
      })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Saves are serialized by the main process. Keep the last document even
  // if the user leaves the area before the debounce timer fires.
  useEffect(() => () => {
    if (dirtyRef.current && latestRef.current) void window.desktop.saveVideoProject(latestRef.current)
  }, [])

  useEffect(() => {
    if (!activeProject || !dirty) return
    const timer = window.setTimeout(() => {
      const snapshot = latestRef.current
      if (!snapshot) return
      void window.desktop.saveVideoProject(snapshot).then(() => {
        if (latestRef.current === snapshot) setDirty(false)
      }).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
    }, 850)
    return () => window.clearTimeout(timer)
  }, [activeProject, dirty])

  const saveNow = async (document = latestRef.current): Promise<boolean> => {
    if (!document) return false
    try {
      setError(null)
      await window.desktop.saveVideoProject(document)
      if (latestRef.current === document) setDirty(false)
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o projeto.')
      return false
    }
  }

  const commit = (edit: (current: VideoProject) => VideoProject) => {
    const current = latestRef.current
    if (!current) return
    const next = edit(current)
    if (next === current) return
    undoStack.current = [...undoStack.current.slice(1 - HISTORY_LIMIT), current]
    redoStack.current = []
    const stamped = { ...next, updatedAt: new Date().toISOString() }
    latestRef.current = stamped
    dirtyRef.current = true
    setDirty(true)
    setProjects(existing => existing.map(project => project.id === stamped.id ? stamped : project))
  }

  const undo = () => {
    const previous = undoStack.current.pop()
    const current = latestRef.current
    if (!previous || !current) return
    redoStack.current.push(current)
    const next = { ...previous, updatedAt: new Date().toISOString() }
    latestRef.current = next
    setProjects(items => items.map(item => item.id === next.id ? next : item))
    setDirty(true)
  }
  const redo = () => {
    const next = redoStack.current.pop()
    const current = latestRef.current
    if (!next || !current) return
    undoStack.current.push(current)
    const restored = { ...next, updatedAt: new Date().toISOString() }
    latestRef.current = restored
    setProjects(items => items.map(item => item.id === restored.id ? restored : item))
    setDirty(true)
  }

  const create = async () => {
    const nextNumber = projects.length + 1
    const title = 'Video Studio ' + String(nextNumber).padStart(2, '0')
    const project = createVideoProject(crypto.randomUUID(), title, new Date().toISOString())
    try {
      setWorking(true)
      setError(null)
      await window.desktop.saveVideoProject(project)
      setProjects(current => [project, ...current])
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setWorking(false) }
  }

  const duplicate = async (project: VideoProject) => {
    const now = new Date().toISOString()
    const next: VideoProject = {
      ...structuredClone(project), id: crypto.randomUUID(),
      title: project.title + ' (cópia)', createdAt: now, updatedAt: now
    }
    try {
      setWorking(true)
      await window.desktop.saveVideoProject(next)
      setProjects(current => [next, ...current])
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setWorking(false) }
  }

  const remove = async (project: VideoProject) => {
    if (!window.confirm('Excluir permanentemente o projeto "' + project.title + '" e seus assets?')) return
    try {
      setWorking(true)
      await window.desktop.deleteVideoProject(project.id)
      setProjects(current => current.filter(item => item.id !== project.id))
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setWorking(false) }
  }

  const open = (project: VideoProject) => {
    setPlaying(false)
    setActiveId(project.id)
    setSelectedElementId(null)
    setSelectedClip(null)
    setDrafts({})
    seek(0)
    undoStack.current = []
    redoStack.current = []
    setDirty(false)
    setError(null)
  }

  const back = async () => {
    setPlaying(false)
    if (dirty && !(await saveNow())) return
    setActiveId(null)
    setSelectedElementId(null)
    setDrafts({})
    setSelectedClip(null)
    undoStack.current = []
    redoStack.current = []
  }

  useEffect(() => {
    if (!playing || !activeProject) return
    const from = playheadRef.current
    const startedAt = performance.now()
    let request = 0
    const tick = (now: number) => {
      const elapsed = Math.floor((now - startedAt) / 1000 * activeProject.frameRate)
      const frame = Math.min(activeProject.durationFrames - 1, from + elapsed)
      seek(frame)
      if (frame < activeProject.durationFrames - 1) request = requestAnimationFrame(tick)
      else setPlaying(false)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [playing, activeProject?.id, activeProject?.frameRate, activeProject?.durationFrames, seek])

  const importImage = async (category: VideoAsset['category']) => {
    if (!activeProject) return
    try {
      setPlaying(false)
      const asset = await window.desktop.importVideoImage(category)
      if (!asset) return
      commit(project => {
        const assets = [...project.assets, asset]
        if (category === 'background') return {
          ...project, assets, canvas: { ...project.canvas, backgroundAssetId: asset.id }
        }
        const element: VideoSceneElement = {
          id: crypto.randomUUID(), kind: category === 'character' ? 'character' : 'image',
          name: asset.name, assetId: asset.id,
          x: 0, y: 0, width: category === 'character' ? 26 : 28,
          height: category === 'character' ? 68 : 28,
          rotation: 0, flipX: false, zIndex: project.elements.length + 1,
          ...(category === 'character' ? { faceAssets: { idle: asset.id } } : {})
        }
        const track: VideoCharacterTrack = {
          id: crypto.randomUUID(), elementId: element.id, name: element.name,
          order: project.characterTracks.length, locked: false, collapsed: false,
          segments: [{
            id: crypto.randomUUID(), startFrame: 0, endFrameExclusive: project.durationFrames,
            state: { ...initialState }, transitionInMs: 20
          }]
        }
        return {
          ...project, assets, elements: [...project.elements, element],
          characterTracks: category === 'character' ? [...project.characterTracks, track] : project.characterTracks
        }
      })
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  /**
   * A Studio normal is a SOURCE, never the destination: read the existing scene
   * through IPC, clone its rendered PNG assets into a separate VideoProject and
   * give every actor a fresh canonical full-duration track.
   */
  const browseStudios = async () => {
    try {
      setError(null)
      const [studios, characters] = await Promise.all([
        window.desktop.listStudios(),
        window.desktop.listCustomizerCharacters()
      ])
      setSourceCharacterNames(Object.fromEntries(characters.map(character => [character.id, character.name])))
      setStudioSources(studios)
      if (!studios.length) setError('Não há cenas no Studio normal para importar.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const importStudioScene = (source: StudioDocument) => {
    if (!activeProject) return
    const hasContent = activeProject.elements.length > 0 || activeProject.assets.length > 0
      || activeProject.saveMarkers.length > 0 || activeProject.textTracks.some(track => track.clips.length > 0)
    if (hasContent && !window.confirm('Substituir a composição, as faixas de personagens e os textos deste vídeo por uma cópia de "' + source.title + '"?')) return
    const availableIds = new Set(source.assets.map(asset => asset.id))
    const visualElements = source.elements.filter(element =>
      (element.kind === 'character' || element.kind === 'image') && !!element.assetId && availableIds.has(element.assetId))
    const usedIds = new Set<string>()
    for (const item of visualElements) if (item.assetId) usedIds.add(item.assetId)
    if (source.backgroundAssetId && availableIds.has(source.backgroundAssetId)) usedIds.add(source.backgroundAssetId)
    const assets = source.assets.filter(asset => usedIds.has(asset.id)).map(asset => ({ ...asset }))
    const sceneElements: VideoSceneElement[] = visualElements.map(item => {
      const size = item.kind === 'character' ? (item.characterScale ?? 100) / 100 : 1
      const widthScale = item.kind === 'character' ? (item.characterWidthScale ?? 100) / 100 : 1
      const heightScale = item.kind === 'character' ? (item.characterHeightScale ?? 100) / 100 : 1
      return {
        id: crypto.randomUUID(), kind: item.kind,
        name: item.kind === 'character' && item.characterId
          ? sourceCharacterNames[item.characterId] ?? 'Personagem' : item.kind === 'character' ? 'Personagem' : 'Objeto',
        assetId: item.assetId!, x: item.x, y: item.y,
        width: Math.max(1, item.width * size * widthScale),
        height: Math.max(1, item.height * size * heightScale),
        rotation: item.rotation, zIndex: item.zIndex, flipX: item.flipX === true
      }
    })
    const tracks: VideoCharacterTrack[] = sceneElements.filter(item => item.kind === 'character').map((item, index) => ({
      id: crypto.randomUUID(), elementId: item.id, name: item.name,
      order: index, locked: false, collapsed: false,
      segments: [{
        id: crypto.randomUUID(), startFrame: 0, endFrameExclusive: activeProject.durationFrames,
        state: { ...initialState }, transitionInMs: 20
      }]
    }))
    commit(project => ({
      ...project,
      canvas: {
        ...project.canvas, backgroundColor: source.backgroundColor,
        backgroundAssetId: source.backgroundAssetId && usedIds.has(source.backgroundAssetId) ? source.backgroundAssetId : null,
        backgroundPlacement: {
          x: source.backgroundX, y: source.backgroundY, width: source.backgroundWidth,
          height: source.backgroundHeight, rotation: source.backgroundRotation
        }
      },
      assets, elements: sceneElements, characterTracks: tracks, saveMarkers: [],
      textTracks: project.textTracks.map(track => ({ ...track, clips: [] }))
    }))
    setSelectedElementId(null)
    setSelectedClip(null)
    setStudioSources(null)
    setDrafts({})
    if (source.elements.length !== visualElements.length)
      setError('Cena copiada. Os blocos de texto do Studio normal não foram importados nesta etapa.')
  }

  const attachFaceRole = async (element: VideoSceneElement, role: VideoFaceMode) => {
    try {
      const asset = await window.desktop.importVideoImage('character')
      if (!asset) return
      commit(project => ({
        ...project,
        assets: [...project.assets, asset],
        elements: project.elements.map(item => item.id === element.id
          ? { ...item, faceAssets: { ...item.faceAssets, [role]: asset.id } } : item)
      }))
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const updateElement = (id: string, patch: Partial<VideoSceneElement>) => {
    commit(project => ({
      ...project, elements: project.elements.map(element => element.id === id ? { ...element, ...patch } : element)
    }))
  }

  const removeElement = (element: VideoSceneElement) => {
    const associatedTrack = activeProject?.characterTracks.find(track => track.elementId === element.id)
    commit(project => ({
      ...project,
      elements: project.elements.filter(item => item.id !== element.id),
      characterTracks: project.characterTracks.filter(track => track.elementId !== element.id),
      saveMarkers: project.saveMarkers.map(marker => ({
        ...marker, affectedTrackIds: marker.affectedTrackIds.filter(id => id !== associatedTrack?.id)
      }))
    }))
    setSelectedElementId(null)
    setDrafts(current => {
      const next = { ...current }
      delete next[element.id]
      return next
    })
  }

  const beginElementDrag = (event: ReactPointerEvent<HTMLButtonElement>, element: VideoSceneElement) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    setPlaying(false)
    setSelectedElementId(element.id)
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return
    const clientX = event.clientX, clientY = event.clientY
    const updated = (pointer: PointerEvent) => ({
      x: Math.round((element.x + (pointer.clientX - clientX) * 100 / rect.width) * 100) / 100,
      y: Math.round((element.y + (pointer.clientY - clientY) * 100 / rect.height) * 100) / 100
    })
    const onMove = (next: PointerEvent) => setDragPreview({ id: element.id, ...updated(next) })
    const onEnd = (next: PointerEvent) => {
      const position = updated(next)
      if (position.x !== element.x || position.y !== element.y) updateElement(element.id, position)
      setDragPreview(null)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd, { once: true })
  }

  const saveFrame = () => {
    commit(project => recordVideoFrame(project, playheadRef.current, drafts))
    setDrafts({})
  }

  const editDraft = (elementId: string, patch: Partial<VideoActorState>) => {
    if (!activeProject) return
    const track = activeProject.characterTracks.find(item => item.elementId === elementId)
    if (!track || track.locked) return
    const base = stateAtFrame(track, playheadRef.current) ?? initialState
    setDrafts(current => ({ ...current, [elementId]: { ...(current[elementId] ?? base), ...patch } }))
  }

  const addText = (kind: 'dialogue' | 'thought') => {
    commit(project => ({
      ...project, textTracks: project.textTracks.map(track => track.kind !== kind || track.locked ? track : {
        ...track, clips: [...track.clips, {
          id: crypto.randomUUID(), startFrame: playheadRef.current,
          endFrameExclusive: Math.min(project.durationFrames, playheadRef.current + 3 * project.frameRate),
          text: kind === 'dialogue' ? 'Nova fala' : 'Novo pensamento'
        }]
      })
    }))
  }

  const patchText = (trackId: string, id: string, patch: Partial<VideoTextClip>) => {
    commit(project => ({
      ...project, textTracks: project.textTracks.map(track => track.id !== trackId || track.locked ? track : {
        ...track, clips: track.clips.map(clip => clip.id !== id ? clip : { ...clip, ...patch })
      })
    }))
  }

  const changeDuration = (deltaSeconds: number) => {
    if (!activeProject) return
    const next = updateVideoDuration(activeProject, activeProject.durationFrames + deltaSeconds * activeProject.frameRate)
    if (next === activeProject) { setError('Não é possível reduzir a duração: existe conteúdo além do novo limite.'); return }
    setError(null)
    commit(() => next)
    seek(playheadRef.current)
  }

  const beginBoundaryDrag = (event: ReactPointerEvent<HTMLButtonElement>, track: VideoCharacterTrack, index: number) => {
    event.preventDefault()
    event.stopPropagation()
    if (track.locked || !activeProject || index < 1) return
    setPlaying(false)
    const left = track.segments[index - 1], right = track.segments[index]
    const started = right.startFrame, clientX = event.clientX
    const onMove = (next: PointerEvent) => {
      const deltaFrames = Math.round((next.clientX - clientX) / zoom * activeProject.frameRate)
      const frame = Math.max(left.startFrame + 1, Math.min(right.endFrameExclusive - 1, started + deltaFrames))
      setBoundaryPreview({ trackId: track.id, leftId: left.id, rightId: right.id, frame })
    }
    const onEnd = (next: PointerEvent) => {
      onMove(next)
      const deltaFrames = Math.round((next.clientX - clientX) / zoom * activeProject.frameRate)
      const frame = Math.max(left.startFrame + 1, Math.min(right.endFrameExclusive - 1, started + deltaFrames))
      commit(project => moveCharacterBoundary(project, track.id, left.id, right.id, frame))
      setBoundaryPreview(null)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd, { once: true })
  }

  if (!activeProject) return (
    <main className="studio-page video-studio-library" aria-label="Video Studio">
      <header className="studio-page-header"><h1>Seus Video Studios</h1><small>{folder || 'Projetos salvos localmente'}</small></header>
      <div className="studio-toolbar">
        <button className="studio-action studio-action-primary" type="button" disabled={loading || working} onClick={() => void create()}><Icon name="plus" /> Criar projeto</button>
      </div>
      {error && <p className="studio-error-message" role="alert">{error}</p>}
      {loading
        ? <section className="studio-empty-state"><strong>Carregando projetos de vídeo…</strong></section>
        : projects.length
          ? <section className="studio-grid" aria-label="Projetos de vídeo">
              {projects.map(project => <article key={project.id} className="studio-card">
                <header className="studio-card-heading">
                  <button className="studio-card-open" type="button" onClick={() => open(project)}>{project.title}</button>
                  <div className="studio-card-actions">
                    <button className="studio-card-action" title="Duplicar" aria-label={'Duplicar ' + project.title} type="button" onClick={() => void duplicate(project)} disabled={working}>▢</button>
                    <button className="studio-card-action danger" title="Excluir" aria-label={'Excluir ' + project.title} type="button" onClick={() => void remove(project)} disabled={working}><Icon name="trash" /></button>
                  </div>
                </header>
                <button type="button" className="studio-cover video-studio-cover" style={{ backgroundColor: project.canvas.backgroundColor }} onClick={() => open(project)} aria-label={'Abrir ' + project.title}>
                  <span>▶</span><small>{formattedTime(project.durationFrames, project.frameRate)} · {project.frameRate} FPS</small>
                </button>
              </article>)}
            </section>
          : <section className="studio-empty-state"><span><Icon name="camera" /></span><strong>Nenhum Video Studio criado</strong><small>Crie um projeto vazio para começar a animar.</small></section>}
    </main>
  )

  const currentTime = playhead / activeProject.frameRate
  const evaluated = evaluateVideoProject(activeProject, currentTime)
  const selectedElement = activeProject.elements.find(item => item.id === selectedElementId) ?? null
  const selectedTrack = selectedElement?.kind === 'character'
    ? activeProject.characterTracks.find(track => track.elementId === selectedElement.id) : null
  const baseState = selectedTrack ? stateAtFrame(selectedTrack, playhead) : null
  const displayedState = selectedElement && selectedTrack ? drafts[selectedElement.id] ?? baseState : null
  const stagedChanges = selectedElement && baseState && displayedState && !equalActorState(baseState, displayedState)
  const timelineWidth = Math.max(1000, activeProject.durationFrames / activeProject.frameRate * zoom)
  const previewActors = new Map(evaluated.characters.map(character => [character.elementId, character]))
  const selectedTextTrack = activeProject.textTracks.find(track => track.id === selectedClip?.trackId)
  const selectedTextClip = selectedTextTrack?.clips.find(clip => clip.id === selectedClip?.id)

  return (
    <main className="video-studio-editor" aria-label="Editor de Video Studio">
      <header className="video-studio-toolbar">
        <button type="button" onClick={() => void back()}>← Projetos</button>
        <input aria-label="Nome do projeto" className="video-studio-project-title" value={activeProject.title}
          maxLength={100} onChange={event => commit(project => ({ ...project, title: safeLabel(event.target.value, 'Sem título') }))} />
        <span className="video-studio-save-indicator">{dirty ? '● Alterações pendentes' : '✓ Salvo'}</span>
        <button type="button" onClick={() => void saveNow()}>Salvar</button>
        <button type="button" disabled={!undoStack.current.length} onClick={undo} title="Desfazer">↶</button>
        <button type="button" disabled={!redoStack.current.length} onClick={redo} title="Refazer">↷</button>
        <span className="video-studio-toolbar-spacer" />
        <span>{formattedTime(playhead, activeProject.frameRate)}</span>
        <button type="button" onClick={() => setPlaying(value => !value)}>{playing ? '⏸ Pausar' : '▶ Play'}</button>
        <button type="button" onClick={saveFrame} title="Gravar alterações pendentes no quadro atual">◆ Salvar frame</button>
      </header>

      {error && <div className="video-studio-error" role="alert">{error}<button type="button" onClick={() => setError(null)}>×</button></div>}
      <div className="video-studio-workspace">
        <aside className="video-studio-sidebar">
          <h3>Composição</h3>
          <button type="button" onClick={() => void importImage('background')}>+ Fundo</button>
          {activeProject.canvas.backgroundAssetId && <button type="button" onClick={() => commit(project => ({
            ...project, canvas: { ...project.canvas, backgroundAssetId: null }
          }))}>Remover fundo</button>}
          <button type="button" onClick={() => void importImage('character')}>+ Personagem (PNG)</button>
          <button type="button" onClick={() => void importImage('object')}>+ Objeto</button>
          <button type="button" onClick={() => void browseStudios()}>↗ Importar cena do Studio</button>
          {studioSources !== null && <div className="video-studio-import-picker">
            <strong>Cenas do Studio</strong>
            {studioSources.map(studio => <button type="button" key={studio.id} onClick={() => importStudioScene(studio)}>{studio.title} · {studio.elements.length} itens</button>)}
            <button type="button" onClick={() => setStudioSources(null)}>Cancelar</button>
          </div>}
          <p>Assets são copiados para a pasta do projeto. A ponte de personagens renderizados do Fabricador será integrada depois.</p>
          <label>Cor de fundo <input type="color" value={activeProject.canvas.backgroundColor}
            onChange={event => commit(project => ({ ...project, canvas: { ...project.canvas, backgroundColor: event.target.value } }))} /></label>
          <h3>Elementos</h3>
          {activeProject.elements.map(element => <button type="button" key={element.id}
            className={selectedElementId === element.id ? 'selected' : ''}
            onClick={() => { setSelectedElementId(element.id); setSelectedClip(null) }}>
            {element.kind === 'character' ? '♟ ' : '▧ '}{element.name}
          </button>)}
          {!activeProject.elements.length && <small>Adicione personagens, imagens ou um fundo para montar a cena.</small>}
        </aside>

        <section className="video-studio-preview-column">
          <div className="video-studio-preview-heading"><strong>Preview · {activeProject.canvas.width}×{activeProject.canvas.height}</strong><span>{activeProject.frameRate} FPS · quadro {playhead}</span></div>
          <div className="video-studio-stage-wrap">
            <div ref={stageRef} className="video-studio-stage" style={{
              aspectRatio: activeProject.canvas.width + ' / ' + activeProject.canvas.height,
              backgroundColor: activeProject.canvas.backgroundColor
            }}>
              {assetById(activeProject, activeProject.canvas.backgroundAssetId) && <img className="video-studio-background"
                alt="" draggable={false} src={assetById(activeProject, activeProject.canvas.backgroundAssetId)!.dataUrl}
                style={activeProject.canvas.backgroundPlacement ? {
                  left: 'calc(50% + ' + activeProject.canvas.backgroundPlacement.x + '%)',
                  top: 'calc(50% + ' + activeProject.canvas.backgroundPlacement.y + '%)',
                  width: activeProject.canvas.backgroundPlacement.width + '%',
                  height: activeProject.canvas.backgroundPlacement.height + '%',
                  transform: 'translate(-50%, -50%) rotate(' + activeProject.canvas.backgroundPlacement.rotation + 'deg)'
                } : undefined} />}
              {activeProject.elements.slice().sort((a,b) => a.zIndex - b.zIndex).map(element => {
                const displayPosition = dragPreview?.id === element.id ? dragPreview : element
                const visual = previewActors.get(element.id)
                const state = element.id === selectedElementId && !playing && drafts[element.id] ? drafts[element.id] : visual?.state
                const roleAssetId = element.kind === 'character' && state ? element.faceAssets?.[state.faceMode] : undefined
                const asset = assetById(activeProject, roleAssetId ?? element.assetId)
                const transition = element.id === selectedElementId && !playing && drafts[element.id] ? 1 : visual?.transitionProgress ?? 1
                const previousRoleId = element.kind === 'character' && visual?.previousState
                  ? element.faceAssets?.[visual.previousState.faceMode] : undefined
                const previousAsset = transition < 1 && visual?.previousState
                  ? assetById(activeProject, previousRoleId ?? element.assetId) : undefined
                return <button className={'video-studio-stage-element' + (selectedElementId === element.id ? ' selected' : '')}
                  type="button" key={element.id} onClick={() => setSelectedElementId(element.id)}
                  onPointerDown={event => beginElementDrag(event, element)}
                  style={{
                    left: 'calc(50% + ' + displayPosition.x + '%)', top: 'calc(50% + ' + displayPosition.y + '%)',
                    width: element.width + '%', height: element.height + '%',
                    transform: 'translate(-50%, -50%) rotate(' + element.rotation + 'deg) scaleX(' + (element.flipX ? -1 : 1) + ')',
                    zIndex: 10 + element.zIndex
                  }}>
                  {asset && <img alt={element.name} src={asset.dataUrl} draggable={false}
                    style={previousAsset ? { opacity: transition } : undefined} />}
                  {previousAsset && <img className="video-studio-transition-previous" alt="" src={previousAsset.dataUrl} draggable={false}
                    style={{ opacity: 1 - transition }} />}
                  {!asset && <span>{element.name}</span>}
                </button>
              })}
              {evaluated.texts.map(text => <div key={text.id} className={'video-studio-stage-text ' + text.kind}>{text.text}</div>)}
              {!activeProject.elements.length && !activeProject.canvas.backgroundAssetId && <div className="video-studio-stage-empty">Cena vazia · comece adicionando um fundo ou personagem</div>}
            </div>
          </div>
          <div className="video-studio-transport">
            <button type="button" onClick={() => seek(0)}>⏮</button>
            <button type="button" onClick={() => seek(playhead - 1)}>◀ 1f</button>
            <input type="range" min={0} max={activeProject.durationFrames - 1} value={playhead} onChange={event => seek(Number(event.target.value))} aria-label="Posição do vídeo" />
            <button type="button" onClick={() => seek(playhead + 1)}>1f ▶</button>
            <button type="button" onClick={() => seek(activeProject.durationFrames - 1)}>⏭</button>
          </div>
        </section>

        <aside className="video-studio-sidebar">
          <h3>Inspetor</h3>
          {selectedElement ? <>
            <strong>{selectedElement.name}</strong>
            <label>Posição X <input type="number" value={selectedElement.x} onChange={e => updateElement(selectedElement.id, { x: Number(e.target.value) })} /></label>
            <label>Posição Y <input type="number" value={selectedElement.y} onChange={e => updateElement(selectedElement.id, { y: Number(e.target.value) })} /></label>
            <label>Largura (%) <input type="number" min="1" value={selectedElement.width} onChange={e => updateElement(selectedElement.id, { width: Math.max(1, Number(e.target.value)) })} /></label>
            <label>Altura (%) <input type="number" min="1" value={selectedElement.height} onChange={e => updateElement(selectedElement.id, { height: Math.max(1, Number(e.target.value)) })} /></label>
            <label>Camada <input type="number" value={selectedElement.zIndex} onChange={e => updateElement(selectedElement.id, { zIndex: Number(e.target.value) })} /></label>
            <label>Inverter <input type="checkbox" checked={selectedElement.flipX} onChange={e => updateElement(selectedElement.id, { flipX: e.target.checked })} /></label>
            <button type="button" onClick={() => removeElement(selectedElement)}>Remover elemento</button>
            {selectedTrack && displayedState && <>
              <h3>Animação facial</h3>
              <label>Modo facial
                <select value={displayedState.faceMode} disabled={selectedTrack.locked} onChange={event => editDraft(selectedElement.id, { faceMode: event.target.value as VideoFaceMode })}>
                  {(['idle', 'blink', 'talk'] as const).map(mode => <option key={mode} value={mode}>{modeNames[mode]}</option>)}
                </select>
              </label>
              <label>Pose (ID do futuro preset)
                <input value={displayedState.poseId ?? ''} disabled={selectedTrack.locked} placeholder="Sem pose vinculada"
                  onChange={event => editDraft(selectedElement.id, { poseId: event.target.value || null })} />
              </label>
              <label>Expressão (ID do futuro preset)
                <input value={displayedState.expressionId ?? ''} disabled={selectedTrack.locked} placeholder="Sem expressão vinculada"
                  onChange={event => editDraft(selectedElement.id, { expressionId: event.target.value || null })} />
              </label>
              <label>Bloquear faixa <input type="checkbox" checked={selectedTrack.locked}
                onChange={event => commit(project => ({ ...project, characterTracks: project.characterTracks.map(track => track.id === selectedTrack.id ? { ...track, locked: event.target.checked } : track) }))} /></label>
              <div className="video-studio-role-buttons">
                {(['idle', 'blink', 'talk'] as const).map(mode => <button key={mode} type="button" onClick={() => void attachFaceRole(selectedElement, mode)}>Imagem {modeNames[mode]}</button>)}
              </div>
              <p>Idle/Blink/Talk podem usar imagens diferentes. Alterações de modo, pose e expressão só entram na timeline ao clicar em Salvar frame.</p>
              {stagedChanges && <div className="video-studio-draft">Rascunho pendente · ainda não gravado</div>}
            </>}
          </> : selectedTextClip && selectedTextTrack ? <>
            <strong>Texto · {selectedTextTrack.name}</strong>
            <label>Conteúdo <textarea value={selectedTextClip.text} onChange={event => patchText(selectedTextTrack.id, selectedTextClip.id, { text: event.target.value })} /></label>
            <label>Início (frame) <input type="number" min="0" max={selectedTextClip.endFrameExclusive - 1} value={selectedTextClip.startFrame}
              onChange={event => patchText(selectedTextTrack.id, selectedTextClip.id, { startFrame: Math.max(0, Math.min(selectedTextClip.endFrameExclusive - 1, Number(event.target.value))) })} /></label>
            <label>Fim (frame exclusivo) <input type="number" min={selectedTextClip.startFrame + 1} max={activeProject.durationFrames} value={selectedTextClip.endFrameExclusive}
              onChange={event => patchText(selectedTextTrack.id, selectedTextClip.id, { endFrameExclusive: Math.max(selectedTextClip.startFrame + 1, Math.min(activeProject.durationFrames, Number(event.target.value))) })} /></label>
            <button type="button" onClick={() => commit(project => ({ ...project, textTracks: project.textTracks.map(track => track.id !== selectedTextTrack.id ? track : { ...track, clips: track.clips.filter(clip => clip.id !== selectedTextClip.id) }) }))}>Excluir texto</button>
          </> : <p>Selecione um elemento na cena ou um bloco de texto na timeline.</p>}
          <div className="video-studio-help">Primeira fase: engine e projetos independentes. A composição nativa de personagens do G-V5 e o export MP4 serão conectados em etapas posteriores.</div>
        </aside>
      </div>

      <section className="video-studio-timeline">
        <header>
          <strong>Timeline</strong><span>{formattedTime(activeProject.durationFrames, activeProject.frameRate)} total</span>
          <button type="button" onClick={() => changeDuration(-60)}>− 1 min</button>
          <button type="button" onClick={() => changeDuration(60)}>+ 1 min</button>
          <span className="video-studio-toolbar-spacer" />
          <button type="button" onClick={() => addText('dialogue')}>+ Fala</button>
          <button type="button" onClick={() => addText('thought')}>+ Pensamento</button>
          <label>Zoom <input type="range" min={2} max={48} step={1} value={zoom} onChange={event => setZoom(Number(event.target.value))} /></label>
        </header>
        <div className="video-studio-timeline-scroll">
          <div className="video-studio-timeline-content" style={{ width: timelineWidth + 180 }}>
            <div className="video-studio-timeline-ruler">
              <span>Faixas</span>
              <div style={{ width: timelineWidth, position: 'relative' }} onPointerDown={event => {
                if (event.target instanceof HTMLButtonElement) return
                const rect = event.currentTarget.getBoundingClientRect()
                seek(Math.round((event.clientX - rect.left) / zoom * activeProject.frameRate))
              }}>
                {Array.from({ length: Math.ceil(activeProject.durationFrames / activeProject.frameRate / 30) + 1 }, (_, i) =>
                  <mark key={i} style={{ left: i * 30 * zoom }}>{Math.floor(i / 2)}:{i % 2 ? '30' : '00'}</mark>)}
                <i className="video-studio-playhead" style={{ left: playhead / activeProject.frameRate * zoom }} />
              </div>
            </div>
            {activeProject.characterTracks.map(track => <div className="video-studio-lane" key={track.id}>
              <div className="video-studio-lane-label">{track.locked ? '🔒 ' : '♟ '}{track.name}</div>
              <div className="video-studio-lane-body" style={{ width: timelineWidth }}>
                {track.segments.map((segment, index) => {
                  const isCurrent = segment.startFrame <= playhead && playhead < segment.endFrameExclusive
                  const start = segment.startFrame / activeProject.frameRate * zoom
                  const end = segment.endFrameExclusive / activeProject.frameRate * zoom
                  return <div key={segment.id} className={'video-studio-segment' + (isCurrent ? ' current' : '')}
                    title={modeNames[segment.state.faceMode] + ' · ' + formattedTime(segment.startFrame, activeProject.frameRate)}
                    style={{ left: start, width: Math.max(1, end - start) }}
                    onClick={() => { seek(segment.startFrame); setSelectedElementId(track.elementId); setSelectedClip(null) }}>
                    {index > 0 && <button type="button" className="video-studio-segment-boundary" title="Arrastar fronteira" onPointerDown={event => beginBoundaryDrag(event, track, index)} disabled={track.locked} />}
                    <span>{modeNames[segment.state.faceMode]}</span>
                  </div>
                })}
                {boundaryPreview?.trackId === track.id && <i className="video-studio-boundary-preview" style={{ left: boundaryPreview.frame / activeProject.frameRate * zoom }} />}
              </div>
            </div>)}
            {activeProject.textTracks.map(track => <div className="video-studio-lane" key={track.id}>
              <div className="video-studio-lane-label">{track.name}</div>
              <div className="video-studio-lane-body" style={{ width: timelineWidth }}>
                {track.clips.map(clip => <button type="button" key={clip.id}
                  className={'video-studio-text-block ' + track.kind + (selectedClip?.id === clip.id ? ' selected' : '')}
                  style={{ left: clip.startFrame / activeProject.frameRate * zoom, width: Math.max(10, (clip.endFrameExclusive - clip.startFrame) / activeProject.frameRate * zoom) }}
                  onClick={() => { setSelectedClip({ trackId: track.id, id: clip.id }); setSelectedElementId(null); seek(clip.startFrame) }}
                  title={clip.text}>{clip.text}</button>)}
              </div>
            </div>)}
            <div className="video-studio-marker-lane">
              <div className="video-studio-lane-label">Frames salvos</div>
              <div className="video-studio-lane-body" style={{ width: timelineWidth }}>
                {activeProject.saveMarkers.map(marker => <button type="button" key={marker.frame}
                  className="video-studio-marker" style={{ left: marker.frame / activeProject.frameRate * zoom }}
                  title={'Frame salvo: ' + marker.frame + ' · ' + marker.affectedTrackIds.length + ' faixas modificadas'}
                  onClick={() => seek(marker.frame)}>◆</button>)}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
