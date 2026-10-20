import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { TopBar } from './components/TopBar'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { Icon } from './components/Icon'
import { CharacterPortrait } from './components/CharacterPortrait'
import type { CustomizerCharacter } from '../../../shared/customizer'

const LazyCustomizerPage = lazy(async () => ({ default: (await import('../features/customizer/CustomizerPage')).CustomizerPage }))
const LazyStudioPage = lazy(async () => ({ default: (await import('../features/studio/StudioPage')).StudioPage }))
const LazyVideoStudioPage = lazy(async () => ({ default: (await import('../features/videoStudio/VideoStudioPage')).VideoStudioPage }))
const LazyOptionsPage = lazy(async () => ({ default: (await import('../features/options/OptionsPage')).OptionsPage }))
const LazyFabricatorPage = lazy(async () => ({ default: (await import('../features/fabricator/FabricatorPage')).FabricatorPage }))

const roteiroAreas = [
  { id: 'roteiros', label: 'Roteiros', icon: 'message' },
  { id: 'fichas', label: 'Ficha dos personagens', icon: 'user' },
  { id: 'configuracoes', label: 'Configurações', icon: 'settings' }
] as const

type RoteiroTikTok = { id: string; title: string; videoTitle: string }
type SidebarRoteiro = { id: string; title: string; videoTitle: string; characterIds: string[]; tiktoks: RoteiroTikTok[] }

function RoteiroWorkspace({ roteiro, onBack, onUpdate }: { roteiro: SidebarRoteiro; onBack: () => void; onUpdate: (next: SidebarRoteiro) => void }) {
  const [editingTikTok, setEditingTikTok] = useState<RoteiroTikTok | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [editingVideoTitle, setEditingVideoTitle] = useState('')
  const addTikTok = () => {
    const number = roteiro.tiktoks.length + 1
    onUpdate({ ...roteiro, tiktoks: [...roteiro.tiktoks, { id: crypto.randomUUID(), title: 'TikTok ' + number, videoTitle: 'Vídeo ' + String(number).padStart(2, '0') }] })
  }
  const moveTikTok = (index: number, direction: -1 | 1) => {
    const destination = index + direction
    if (destination < 0 || destination >= roteiro.tiktoks.length) return
    const next = [...roteiro.tiktoks]
    ;[next[index], next[destination]] = [next[destination], next[index]]
    onUpdate({ ...roteiro, tiktoks: next })
  }
  const saveTikTok = () => {
    if (!editingTikTok || !editingTitle.trim() || !editingVideoTitle.trim()) return
    onUpdate({ ...roteiro, tiktoks: roteiro.tiktoks.map((item) => item.id === editingTikTok.id ? { ...item, title: editingTitle.trim(), videoTitle: editingVideoTitle.trim() } : item) })
    setEditingTikTok(null)
  }

  return <div className="roteiro-workspace-layout">
    <aside className="roteiro-workspace-sidebar">
      <button className="roteiro-back-button" onClick={onBack} type="button"><span aria-hidden="true">←</span>Voltar</button>
      <section className="roteiro-tiktoks-panel" aria-label="TikToks deste roteiro">
        <header><strong>TIKTOKS</strong><button onClick={addTikTok} title="Adicionar TikTok" aria-label="Adicionar TikTok" type="button"><Icon name="plus" /></button></header>
        <div className="roteiro-tiktoks-list">{roteiro.tiktoks.map((item, index) => <article className="roteiro-tiktok-card" key={item.id}>
          <span className="roteiro-tiktok-number">{index + 1}</span>
          <div className="roteiro-tiktok-info"><strong>{item.title}</strong><span>{item.videoTitle}</span></div>
          <span className="roteiro-tiktok-cast">{roteiro.characterIds.length}/{roteiro.characterIds.length}</span>
          <div className="roteiro-tiktok-actions"><button onClick={() => moveTikTok(index, -1)} disabled={index === 0} aria-label={'Mover ' + item.title + ' para cima'} type="button">↑</button><button onClick={() => moveTikTok(index, 1)} disabled={index === roteiro.tiktoks.length - 1} aria-label={'Mover ' + item.title + ' para baixo'} type="button">↓</button><button onClick={() => { setEditingTikTok(item); setEditingTitle(item.title); setEditingVideoTitle(item.videoTitle) }} type="button">Editar</button></div>
        </article>)}</div>
      </section>
    </aside>
    <main className="roteiro-workspace-empty" aria-label={'Conteúdo do roteiro ' + roteiro.title} />
    {editingTikTok && <div className="roteiro-modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setEditingTikTok(null) }}><section className="roteiro-video-title-modal" role="dialog" aria-modal="true" aria-labelledby="roteiro-tiktok-edit-heading"><header><strong id="roteiro-tiktok-edit-heading">Editar TikTok</strong><button onClick={() => setEditingTikTok(null)} aria-label="Fechar" type="button">×</button></header><label>Nome do TikTok<input autoFocus value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} maxLength={100} /></label><label>Título do vídeo<input value={editingVideoTitle} onChange={(event) => setEditingVideoTitle(event.target.value)} maxLength={100} /></label><footer><button onClick={() => setEditingTikTok(null)} type="button">Cancelar</button><button className="roteiro-create-confirm" onClick={saveTikTok} disabled={!editingTitle.trim() || !editingVideoTitle.trim()} type="button"><Icon name="check" />Salvar</button></footer></section></div>}
  </div>
}

function EmptyRoteirosPage() {
  const [activeArea, setActiveArea] = useState<(typeof roteiroAreas)[number]['id']>('roteiros')
  const [roteiros, setRoteiros] = useState<SidebarRoteiro[]>([])
  const [roteirosLoaded, setRoteirosLoaded] = useState(false)
  const [characters, setCharacters] = useState<CustomizerCharacter[]>([])
  const [selectedRoteiroId, setSelectedRoteiroId] = useState<string | null>(null)
  const [openedRoteiroId, setOpenedRoteiroId] = useState<string | null>(null)
  const [deleteMode, setDeleteMode] = useState(false)
  const [deleteSelection, setDeleteSelection] = useState<string[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newCharacterIds, setNewCharacterIds] = useState<string[]>([])
  const [editingVideoId, setEditingVideoId] = useState<string | null>(null)
  const [editingVideoTitle, setEditingVideoTitle] = useState('')
  const active = roteiroAreas.find((area) => area.id === activeArea) ?? roteiroAreas[0]
  const openedRoteiro = roteiros.find((roteiro) => roteiro.id === openedRoteiroId) ?? null

  useEffect(() => {
    let cancelled = false
    void window.desktop.listCustomizerCharacters().then((items) => { if (!cancelled) setCharacters(items) }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.desktop.listRoteiros().then((items) => {
      if (!cancelled) {
        setRoteiros(items)
        setRoteirosLoaded(true)
      }
    }).catch((error) => console.error('Não foi possível carregar os roteiros salvos.', error))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!roteirosLoaded) return
    void window.desktop.saveRoteiros(roteiros).catch((error) => console.error('Não foi possível salvar os roteiros.', error))
  }, [roteiros, roteirosLoaded])

  useEffect(() => {
    if (!deleteMode) return
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setDeleteMode(false); setDeleteSelection([]) }
    }
    window.addEventListener('keydown', cancelOnEscape)
    return () => window.removeEventListener('keydown', cancelOnEscape)
  }, [deleteMode])

  const createRoteiro = () => {
    const title = newTitle.trim()
    if (!title) return
    const roteiro: SidebarRoteiro = { id: crypto.randomUUID(), title, videoTitle: 'Vídeo 01', characterIds: newCharacterIds, tiktoks: [] }
    setRoteiros((current) => [roteiro, ...current])
    setSelectedRoteiroId(roteiro.id)
    setNewTitle(''); setNewCharacterIds([]); setCreateOpen(false)
  }

  const handleDeleteButton = () => {
    if (!deleteMode) {
      setDeleteSelection([])
      setDeleteMode(true)
      return
    }
    if (deleteSelection.length === 0) return
    setRoteiros((current) => current.filter((roteiro) => !deleteSelection.includes(roteiro.id)))
    if (selectedRoteiroId && deleteSelection.includes(selectedRoteiroId)) setSelectedRoteiroId(null)
    if (openedRoteiroId && deleteSelection.includes(openedRoteiroId)) setOpenedRoteiroId(null)
    setDeleteSelection([])
    setDeleteMode(false)
  }

  const toggleRoteiroSelection = (roteiroId: string) => {
    if (!deleteMode) {
      setSelectedRoteiroId(roteiroId)
      return
    }
    setDeleteSelection((current) => current.includes(roteiroId) ? current.filter((id) => id !== roteiroId) : [...current, roteiroId])
  }

  const saveVideoTitle = () => {
    if (!editingVideoId || !editingVideoTitle.trim()) return
    setRoteiros((current) => current.map((roteiro) => roteiro.id === editingVideoId ? { ...roteiro, videoTitle: editingVideoTitle.trim() } : roteiro))
    setEditingVideoId(null); setEditingVideoTitle('')
  }

  if (openedRoteiro) return <RoteiroWorkspace roteiro={openedRoteiro} onBack={() => setOpenedRoteiroId(null)} onUpdate={(updated) => setRoteiros((current) => current.map((item) => item.id === updated.id ? updated : item))} />

  return <div className="roteiros-layout">
    <aside className="roteiros-sidebar-empty" aria-label="Navegação de roteiros">
      <nav className="roteiros-subnav" aria-label="Subáreas de Roteiros">
        {roteiroAreas.map((area) => <button key={area.id} className={`roteiros-subnav-button${activeArea === area.id ? ' active' : ''}`} onClick={() => { setActiveArea(area.id); setDeleteMode(false); setDeleteSelection([]) }} aria-current={activeArea === area.id ? 'page' : undefined} type="button"><Icon name={area.icon} /><span>{area.label}</span></button>)}
      </nav>
    </aside>
    <section className="roteiros-main-empty" aria-label={`Área ${active.label}`}>
      <header className="roteiros-area-titlebar"><div className="roteiros-title-content">{activeArea === 'roteiros' && <div className="roteiros-title-actions"><button className="add" onClick={() => { setDeleteMode(false); setDeleteSelection([]); setNewTitle(''); setNewCharacterIds([]); setCreateOpen(true) }} title="Adicionar roteiro" type="button">Adicionar</button><button className={deleteMode ? 'confirm-delete' : 'delete'} onClick={handleDeleteButton} disabled={deleteMode ? deleteSelection.length === 0 : roteiros.length === 0} title={deleteMode ? `Confirmar exclusão de ${deleteSelection.length} roteiro(s)` : 'Selecionar roteiros para excluir'} type="button">{deleteMode ? 'Confirmar' : 'Excluir'}</button></div>}<h1>{active.label}</h1></div></header>
      {activeArea === 'roteiros' && <div className="roteiro-main-library" aria-label="Lista de roteiros"><div className="roteiro-main-cards">{roteiros.map((roteiro) => {
        const firstCharacter = characters.find((character) => roteiro.characterIds.includes(character.id))
        const markedForDelete = deleteSelection.includes(roteiro.id)
        return <article className={`roteiro-main-card${selectedRoteiroId === roteiro.id && !deleteMode ? ' selected' : ''}${deleteMode ? ' delete-mode' : ''}${markedForDelete ? ' delete-selected' : ''}`} key={roteiro.id}>
          <div className="roteiro-main-video-strip"><span title={roteiro.videoTitle}>{roteiro.videoTitle}</span><button onClick={() => { setEditingVideoId(roteiro.id); setEditingVideoTitle(roteiro.videoTitle) }} disabled={deleteMode} aria-label={`Editar título de ${roteiro.videoTitle}`} title="Editar título do vídeo" type="button"><Icon name="edit" /></button></div>
          <button className="roteiro-main-thumbnail" onClick={() => { if (deleteMode) toggleRoteiroSelection(roteiro.id); else { setSelectedRoteiroId(roteiro.id); setOpenedRoteiroId(roteiro.id) } }} aria-pressed={deleteMode ? markedForDelete : selectedRoteiroId === roteiro.id} type="button">{firstCharacter ? <CharacterPortrait character={firstCharacter} /> : <span className="roteiro-thumbnail-placeholder"><Icon name="message" /></span>}<strong title={roteiro.title}>{roteiro.title}</strong></button>
        </article>
      })}</div></div>}
    </section>
    {createOpen && <div className="roteiro-modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setCreateOpen(false) }}><section className="roteiro-create-modal" role="dialog" aria-modal="true" aria-labelledby="roteiro-create-title"><header><div><span>NOVO ROTEIRO</span><h2 id="roteiro-create-title">Criar roteiro</h2></div><button onClick={() => setCreateOpen(false)} aria-label="Fechar" type="button">×</button></header><label className="roteiro-modal-name">Nome do roteiro<input autoFocus value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Digite o nome do roteiro" maxLength={100} /></label><div className="roteiro-modal-cast-heading"><strong>Seleção de elenco</strong><span>{newCharacterIds.length} selecionado(s)</span></div><div className="roteiro-modal-cast-list">{characters.length ? characters.map((character) => { const checked = newCharacterIds.includes(character.id); return <button className={checked ? 'selected' : ''} key={character.id} onClick={() => setNewCharacterIds((current) => checked ? current.filter((id) => id !== character.id) : [...current, character.id])} type="button"><CharacterPortrait character={character} /><span>{character.name}</span><i>{checked ? '✓' : '+'}</i></button> }) : <p>Não há personagens disponíveis no Customizador.</p>}</div><footer><button onClick={() => setCreateOpen(false)} type="button">Cancelar</button><button className="roteiro-create-confirm" onClick={createRoteiro} disabled={!newTitle.trim()} type="button"><Icon name="check" />Criar roteiro</button></footer></section></div>}
    {editingVideoId && <div className="roteiro-modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setEditingVideoId(null) }}><section className="roteiro-video-title-modal" role="dialog" aria-modal="true" aria-labelledby="roteiro-video-title-heading"><header><strong id="roteiro-video-title-heading">Editar título do vídeo</strong><button onClick={() => setEditingVideoId(null)} aria-label="Fechar" type="button">×</button></header><label>Título<input autoFocus value={editingVideoTitle} onChange={(event) => setEditingVideoTitle(event.target.value)} maxLength={100} /></label><footer><button onClick={() => setEditingVideoId(null)} type="button">Cancelar</button><button className="roteiro-create-confirm" onClick={saveVideoTitle} disabled={!editingVideoTitle.trim()} type="button"><Icon name="check" />Salvar</button></footer></section></div>}
  </div>
}

export function App() {
  const location = useLocation()
  const [videoEditorActive, setVideoEditorActive] = useState(false)

  useEffect(() => {
    if (location.pathname !== '/video-studio') setVideoEditorActive(false)
  }, [location.pathname])

  return (
    <main className="app-shell">
      {!videoEditorActive && <TopBar />}
      <div className="route-content">
        <AppErrorBoundary key={location.pathname}>
          <Suspense fallback={<div className="blank-page" aria-busy="true">Carregando área…</div>}>
            <Routes>
              <Route path="/" element={<Navigate to="/customizar" replace />} />
              <Route path="/customizar" element={<LazyCustomizerPage />} />
              <Route path="/estudio" element={<LazyStudioPage />} />
              <Route path="/video-studio" element={<LazyVideoStudioPage onEditorActiveChange={setVideoEditorActive} />} />
              <Route path="/roteiros" element={<EmptyRoteirosPage />} />
              <Route path="/opcoes" element={<LazyOptionsPage />} />
              <Route path="/fabricador-dev" element={<LazyFabricatorPage />} />
              <Route path="*" element={<Navigate to="/customizar" replace />} />
            </Routes>
          </Suspense>
        </AppErrorBoundary>
      </div>
    </main>
  )
}
