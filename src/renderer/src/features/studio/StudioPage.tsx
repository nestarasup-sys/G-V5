import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../ui/components/Icon'
import type { StudioDocument } from '../../../../shared/studio'

type StudioCard = StudioDocument

const STORAGE_KEY = 'gacha-nymi-studio-catalog-v1'
const studioColor = (number: number) => `hsl(${(number * 137.508) % 360} 45% 78%)`
const studioTools = [
  { id: 'background', label: 'Fundo', icon: 'frame' },
  { id: 'objects', label: 'Objetos', icon: 'sparkles' },
  { id: 'narrator', label: 'Narrador', icon: 'message' },
  { id: 'speech', label: 'Fala', icon: 'message' },
  { id: 'thought', label: 'Pensamento', icon: 'face' }
] as const

function loadLegacyStudios(): Array<{ id: string; title: string; color: string }> {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(saved)) return []
    return saved.filter((item): item is StudioCard => Boolean(item && typeof item === 'object'
      && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.color === 'string'))
  } catch { return [] }
}

export function StudioPage() {
  const [studios, setStudios] = useState<StudioCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [studioFolder, setStudioFolder] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeStudioId, setActiveStudioId] = useState<string | null>(null)
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const [fullView, setFullView] = useState(false)
  const [saved, setSaved] = useState(true)
  const nextStudioNumber = useRef(1)
  const selectedStudio = studios.find((studio) => studio.id === selectedId) ?? null
  const activeStudio = studios.find((studio) => studio.id === activeStudioId) ?? null

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const existing = await window.desktop.listStudios()
        const knownIds = new Set(existing.map((studio) => studio.id))
        const legacy = loadLegacyStudios()
        const now = new Date().toISOString()
        for (const old of legacy) {
          if (knownIds.has(old.id) || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(old.id)) continue
          await window.desktop.saveStudio({ schemaVersion: 1, ...old, createdAt: now, updatedAt: now })
        }
        const loaded = await window.desktop.listStudios()
        const folder = await window.desktop.getStudioFolder()
        if (cancelled) return
        setStudios(loaded)
        setStudioFolder(folder)
        if (legacy.length) window.localStorage.removeItem(STORAGE_KEY)
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os Studios.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const allocateNumber = () => {
    const highest = studios.reduce((max, studio) => {
      const number = Number(studio.title.match(/^Studio\s+(\d+)/i)?.[1] ?? 0)
      return Math.max(max, number)
    }, 0)
    const number = Math.max(nextStudioNumber.current, highest + 1)
    nextStudioNumber.current = number + 1
    return number
  }

  const createStudio = async () => {
    const number = allocateNumber()
    const now = new Date().toISOString()
    const studio: StudioCard = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      title: `Studio ${String(number).padStart(2, '0')}`,
      color: studioColor(number),
      createdAt: now,
      updatedAt: now
    }
    try {
      setError(null)
      await window.desktop.saveStudio(studio)
      setStudios((current) => [...current, studio])
      setSelectedId(studio.id)
      setSaved(true)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar o Studio.') }
  }

  const duplicateStudio = async () => {
    if (!selectedStudio) return
    const number = allocateNumber()
    const duplicate: StudioCard = {
      ...selectedStudio,
      id: crypto.randomUUID(),
      title: `Studio ${String(number).padStart(2, '0')}`,
      color: studioColor(number),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    try {
      setError(null)
      await window.desktop.saveStudio(duplicate)
      setStudios((current) => [...current, duplicate])
      setSelectedId(duplicate.id)
      setSaved(true)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível duplicar o Studio.') }
  }

  const saveStudio = async () => {
    if (!activeStudio) return true
    try {
      const updated = { ...activeStudio, updatedAt: new Date().toISOString() }
      await window.desktop.saveStudio(updated)
      setStudios((current) => current.map((studio) => studio.id === updated.id ? updated : studio))
      setError(null)
      setSaved(true)
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o Studio neste dispositivo.')
      return false
    }
  }

  const deleteStudio = async () => {
    if (!selectedStudio || !window.confirm(`Excluir ${selectedStudio.title}?`)) return
    try {
      await window.desktop.deleteStudio(selectedStudio.id)
      setStudios((current) => current.filter((studio) => studio.id !== selectedStudio.id))
      setSelectedId(null)
      setSaved(true)
      setError(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível excluir o Studio.') }
  }

  const leaveStudio = async () => {
    if (!await saveStudio()) return
    setActiveStudioId(null)
    setActiveTool(null)
    setFullView(false)
  }

  useEffect(() => {
    if (!fullView) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullView(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [fullView])

  if (activeStudio) {
    return (
      <main className={`studio-editor${fullView ? ' full-view' : ''}`} aria-label={`Editor do ${activeStudio.title}`}>
        {!fullView && <aside className="studio-editor-rail studio-editor-left" aria-label="Ferramentas do Studio">
          <div className="studio-editor-quick-actions">
            <button className="studio-round-action" onClick={leaveStudio} title="Salvar e voltar à lista" aria-label="Voltar para Seus Studios" type="button"><span>←</span></button>
            <button className="studio-round-action" onClick={() => void saveStudio()} title="Salvar no dispositivo" aria-label="Salvar Studio" type="button"><Icon name="check" /></button>
          </div>
          <div className="studio-editor-quick-actions studio-history-actions">
            <button className="studio-round-action" disabled title="Desfazer ficará disponível ao editar a cena" aria-label="Desfazer" type="button"><Icon name="undo" /></button>
            <button className="studio-round-action" disabled title="Refazer ficará disponível ao editar a cena" aria-label="Refazer" type="button"><Icon name="redo" /></button>
          </div>
          <nav className="studio-tool-list" aria-label="Adicionar elementos à cena">
            {studioTools.map((tool) => <button className={`studio-tool-button${activeTool === tool.id ? ' active' : ''}`} key={tool.id} onClick={() => setActiveTool(tool.id)} type="button"><Icon name={tool.icon} /><span>{tool.label}</span><i aria-hidden="true">✦</i></button>)}
            <span className="studio-tool-separator" />
            <button className="studio-tool-button" onClick={() => setActiveTool('print')} type="button"><Icon name="download" /><span>Print</span><i aria-hidden="true">✦</i></button>
            <button className="studio-tool-button" onClick={() => setActiveTool('folder')} type="button"><Icon name="box" /><span>Pasta</span><i aria-hidden="true">✦</i></button>
            <button className="studio-tool-button studio-view-button" onClick={() => setFullView(true)} type="button"><Icon name="expand" /><span>View</span></button>
          </nav>
          <small className={`studio-save-indicator${saved ? '' : ' unsaved'}`}><i />{saved ? 'Salvo neste dispositivo' : 'Alterações não salvas'}</small>
          {error && <small className="studio-error-message" role="alert">{error}</small>}
        </aside>}
        <section className="studio-scene-area" aria-label="Prévia da cena">
          <div className="studio-scene-canvas" style={{ backgroundColor: activeStudio.color }}>
            {fullView && <button className="studio-exit-view" onClick={() => setFullView(false)} type="button">Sair da visualização <kbd>Esc</kbd></button>}
            {!fullView && <span className="studio-scene-title">{activeStudio.title}</span>}
            {activeTool && !fullView && <span className="studio-tool-hint">Ferramenta selecionada: {studioTools.find((tool) => tool.id === activeTool)?.label ?? activeTool}</span>}
          </div>
        </section>
        {!fullView && <aside className="studio-editor-rail studio-editor-right" aria-label="Painel vazio do Studio" />}
      </main>
    )
  }

  return (
    <main className="studio-page" aria-label="Studio">
      <header className="studio-page-header"><h1>Seus Studios</h1>{studioFolder && <small>Dados locais: {studioFolder}</small>}</header>
      <div className="studio-toolbar" aria-label="Ações dos Studios">
        <button className="studio-action studio-action-primary" onClick={() => void createStudio()} disabled={loading} type="button"><Icon name="plus" />Criar</button>
        <button className="studio-action" onClick={() => selectedStudio && setActiveStudioId(selectedStudio.id)} disabled={!selectedStudio} type="button"><Icon name="expand" />Abrir</button>
        <button className="studio-action" onClick={duplicateStudio} disabled={!selectedStudio} type="button"><span className="studio-duplicate-icon" aria-hidden="true">▢</span>Duplicar</button>
        <button className="studio-action studio-action-danger" onClick={deleteStudio} disabled={!selectedStudio} type="button"><Icon name="trash" />Excluir</button>
      </div>
      {error && <p className="studio-error-message" role="alert">{error}</p>}
      {loading ? <section className="studio-empty-state"><strong>Carregando Studios…</strong></section> : studios.length ? (
        <section className="studio-grid" aria-label="Studios criados">
          {studios.map((studio) => (
            <article className={`studio-card${selectedId === studio.id ? ' selected' : ''}`} key={studio.id}>
              <h2>{studio.title}</h2>
              <button className="studio-cover" style={{ backgroundColor: studio.color }} onClick={() => setSelectedId(studio.id)} onDoubleClick={() => setActiveStudioId(studio.id)} aria-label={`Selecionar ${studio.title}; clique duas vezes para abrir`} aria-pressed={selectedId === studio.id} type="button" />
            </article>
          ))}
        </section>
      ) : (
        <section className="studio-empty-state">
          <span><Icon name="camera" /></span>
          <strong>Nenhum Studio criado</strong>
          <small>Crie um Studio para começar sua coleção.</small>
        </section>
      )}
    </main>
  )
}
