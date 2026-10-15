import { useRef, useState } from 'react'
import { Icon } from '../../ui/components/Icon'

type StudioCard = { id: string; title: string; color: string }

const studioColors = ['#d8a8c8', '#a9c9d6', '#e2bd8d', '#b9c9a4', '#c5b0dd', '#e2a6a0', '#9cb6d8', '#d5c17e']

export function StudioPage() {
  const [studios, setStudios] = useState<StudioCard[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const nextStudioNumber = useRef(1)
  const selectedStudio = studios.find((studio) => studio.id === selectedId) ?? null

  const createStudio = () => {
    const number = nextStudioNumber.current++
    const studio: StudioCard = {
      id: crypto.randomUUID(),
      title: `Studio ${String(number).padStart(2, '0')}`,
      color: studioColors[(number - 1) % studioColors.length]
    }
    setStudios((current) => [...current, studio])
    setSelectedId(studio.id)
  }

  const duplicateStudio = () => {
    if (!selectedStudio) return
    const number = nextStudioNumber.current++
    const duplicate: StudioCard = {
      ...selectedStudio,
      id: crypto.randomUUID(),
      title: `Studio ${String(number).padStart(2, '0')}`,
      color: studioColors[(number - 1) % studioColors.length]
    }
    setStudios((current) => [...current, duplicate])
    setSelectedId(duplicate.id)
  }

  const deleteStudio = () => {
    if (!selectedStudio || !window.confirm(`Excluir ${selectedStudio.title}?`)) return
    setStudios((current) => current.filter((studio) => studio.id !== selectedStudio.id))
    setSelectedId(null)
  }

  return (
    <main className="studio-page" aria-label="Studio">
      <header className="studio-page-header"><h1>Seus Studios</h1></header>
      <div className="studio-toolbar" aria-label="Ações dos Studios">
        <button className="studio-action studio-action-primary" onClick={createStudio} type="button"><Icon name="plus" />Criar</button>
        <button className="studio-action" onClick={duplicateStudio} disabled={!selectedStudio} type="button"><span className="studio-duplicate-icon" aria-hidden="true">▢</span>Duplicar</button>
        <button className="studio-action studio-action-danger" onClick={deleteStudio} disabled={!selectedStudio} type="button"><Icon name="trash" />Excluir</button>
      </div>
      {studios.length ? (
        <section className="studio-grid" aria-label="Studios criados">
          {studios.map((studio) => (
            <article className={`studio-card${selectedId === studio.id ? ' selected' : ''}`} key={studio.id}>
              <h2>{studio.title}</h2>
              <button
                className="studio-cover"
                style={{ backgroundColor: studio.color }}
                onClick={() => setSelectedId(studio.id)}
                aria-label={`Selecionar ${studio.title}`}
                aria-pressed={selectedId === studio.id}
                type="button"
              />
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
