import { useEffect, useRef, useState } from 'react'
import type { VideoProject } from '../../../../shared/videoStudio'
import { createVideoProject } from '../../../../shared/videoStudio'
import { Icon } from '../../ui/components/Icon'
import { StudioPage } from '../studio/StudioPage'

/**
 * Only Video Studio's PROJECT LIBRARY differs from Studio's existing workspace.
 * The editor itself is the real StudioPage, not a lookalike replacement.
 */
export function VideoStudioPage() {
  const [projects, setProjects] = useState<VideoProject[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [folder, setFolder] = useState('')
  const savingRef = useRef(Promise.resolve())

  useEffect(() => {
    let canceled = false
    void Promise.all([window.desktop.listVideoProjects(), window.desktop.getVideoProjectFolder()])
      .then(([items, path]) => { if (!canceled) { setProjects(items); setFolder(path) } })
      .catch(reason => { if (!canceled) setError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { if (!canceled) setLoading(false) })
    return () => { canceled = true }
  }, [])

  /** Serialize full-document writes on top of Electron's own serialized queue. */
  const persistProject = async (project: VideoProject) => {
    const write = savingRef.current.catch(() => undefined).then(() => window.desktop.saveVideoProject(project))
    savingRef.current = write
    await write
    setProjects(items => items.map(item => item.id === project.id ? project : item))
  }

  const create = async () => {
    const nextNumber = projects.reduce((high, item) => Math.max(high, Number(item.title.match(/^Video Studio (\d+)/)?.[1] ?? 0)), 0) + 1
    const now = new Date().toISOString()
    const project = createVideoProject(crypto.randomUUID(), 'Video Studio ' + String(nextNumber).padStart(2, '0'), now)
    setBusy(true)
    try {
      setError('')
      await window.desktop.saveVideoProject(project)
      setProjects(items => [project, ...items])
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  const duplicate = async (source: VideoProject) => {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const project: VideoProject = {
      ...structuredClone(source), id, title: source.title + ' (cópia)', createdAt: now, updatedAt: now,
      studioScene: source.studioScene ? { ...structuredClone(source.studioScene), id } : undefined,
      sceneFrames: source.sceneFrames?.map(item => ({ ...item, scene: { ...structuredClone(item.scene), id } }))
    }
    setBusy(true)
    try {
      setError('')
      await window.desktop.saveVideoProject(project)
      setProjects(items => [project, ...items])
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  const remove = async (project: VideoProject) => {
    if (!window.confirm('Excluir permanentemente "' + project.title + '" e todos os assets deste projeto de vídeo?')) return
    setBusy(true)
    try {
      await window.desktop.deleteVideoProject(project.id)
      setProjects(items => items.filter(item => item.id !== project.id))
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }

  const active = projects.find(project => project.id === activeId)
  if (active) return <StudioPage
    key={active.id} videoStudioProject={active}
    onVideoStudioChange={persistProject}
    onVideoStudioExit={() => setActiveId(null)}
  />

  return (
    <main className="studio-page" aria-label="Video Studio">
      <header className="studio-page-header">
        <h1>Seus Video Studios</h1>
        {folder && <small>Projetos locais: {folder}</small>}
      </header>
      <div className="studio-toolbar">
        <button type="button" className="studio-action studio-action-primary" disabled={loading || busy} onClick={() => void create()}>
          <Icon name="plus" />Criar projeto
        </button>
      </div>
      {error && <p className="studio-error-message" role="alert">{error}</p>}
      {loading
        ? <section className="studio-empty-state"><strong>Carregando projetos…</strong></section>
        : projects.length
          ? <section className="studio-grid" aria-label="Projetos de vídeo">
            {projects.map(project => <article key={project.id} className="studio-card">
              <header className="studio-card-heading">
                <button type="button" className="studio-card-open" onClick={() => setActiveId(project.id)}>{project.title}</button>
                <div className="studio-card-actions">
                  <button type="button" className="studio-card-action" onClick={() => void duplicate(project)} title="Duplicar projeto" disabled={busy}>▢</button>
                  <button type="button" className="studio-card-action danger" onClick={() => void remove(project)} title="Excluir projeto" disabled={busy}><Icon name="trash" /></button>
                </div>
              </header>
              <button type="button" className="studio-cover" style={{ backgroundColor: project.canvas.backgroundColor }}
                title={'Abrir ' + project.title} onClick={() => setActiveId(project.id)}>
                <span style={{ display: 'block', padding: '10px', fontSize: '10px', color: '#663d62' }}>
                  ▶ {Math.round(project.durationFrames / project.frameRate / 60)} min · {project.frameRate} FPS
                </span>
              </button>
            </article>)}
          </section>
          : <section className="studio-empty-state"><span><Icon name="camera" /></span><strong>Nenhum Video Studio criado</strong><small>Crie um projeto para abrir o mesmo editor visual do Studio com timeline de animação.</small></section>}
    </main>
  )
}
