import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { TopBar } from './components/TopBar'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { Icon } from './components/Icon'
import { CharacterPortrait } from './components/CharacterPortrait'
import { RenderedCharacterPortrait } from './components/RenderedCharacterPortrait'
import type { CustomizerCharacter } from '../../../shared/customizer'
import type { RoteiroDocument, RoteiroReactionBlock, RoteiroSectionContent, RoteiroTikTok, RoteiroVideoReference } from '../../../shared/roteiros'
import type { VideoLibraryItem } from '../../../shared/studio'

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

type SidebarRoteiro = RoteiroDocument

const emptyRoteiroContent = (): RoteiroSectionContent => ({ video: null, blocks: [], description: '', timeline: 'unspecified' })

function roteiroVideoReference(item: VideoLibraryItem): RoteiroVideoReference {
  if (item.durationFrames === null) throw new Error('A duração do vídeo ainda não foi reconhecida.')
  return { id: item.id, name: item.name, mimeType: item.mimeType, extension: item.extension, size: item.size, durationFrames: item.durationFrames }
}

function RoteiroSectionEditor({ title, subtitle, content, characters, characterIds, onUpdate }: {
  title: string
  subtitle: string
  content: RoteiroSectionContent
  characters: CustomizerCharacter[]
  characterIds: string[]
  onUpdate: (content: RoteiroSectionContent) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [blocksCollapsed, setBlocksCollapsed] = useState(false)
  const previewRef = useRef<HTMLVideoElement>(null)
  const addVideo = async () => {
    setBusy(true)
    setError(null)
    try {
      const imported = await window.desktop.importVideoLibrary()
      if (!imported) return
      let ready = imported
      if (ready.durationFrames === null) {
        const media = document.createElement('video')
        media.preload = 'metadata'
        media.muted = true
        try {
          const seconds = await new Promise<number>((resolve, reject) => {
            const timer = window.setTimeout(() => { cleanup(); reject(new Error('Não foi possível reconhecer a duração do vídeo.')) }, 30000)
            const cleanup = () => { window.clearTimeout(timer); media.onloadedmetadata = null; media.onerror = null }
            media.onloadedmetadata = () => { cleanup(); resolve(media.duration) }
            media.onerror = () => { cleanup(); reject(new Error('Não foi possível abrir esse vídeo para a prévia.')) }
            media.src = `gacha-video://library/${ready.id}`
            media.load()
          })
          if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 60 * 60 * 24) throw new Error('A duração do vídeo não é válida.')
          ready = await window.desktop.finishVideoLibraryImport(ready.id, Math.max(1, Math.ceil(seconds * 60)))
        } finally { media.pause(); media.removeAttribute('src'); media.load() }
      }
      onUpdate({ ...content, video: roteiroVideoReference(ready) })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível adicionar o vídeo.')
    } finally { setBusy(false) }
  }
  const updateBlock = (id: string, patch: Partial<RoteiroReactionBlock>) => onUpdate({ ...content, blocks: content.blocks.map((block) => block.id === id ? { ...block, ...patch } : block) })
  const moveBlock = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= content.blocks.length) return
    const blocks = [...content.blocks]
    ;[blocks[index], blocks[target]] = [blocks[target], blocks[index]]
    onUpdate({ ...content, blocks })
  }
  const addBlock = () => onUpdate({ ...content, blocks: [...content.blocks, {
    id: crypto.randomUUID(), characterId: characterIds[0] ?? '', kind: 'fala', expression: '', textPortuguese: '', textEnglish: ''
  }] })
  const video = content.video
  const captureReactionTime = (field: 'firstGroupReactionSeconds' | 'secondGroupReactionSeconds') => {
    const currentTime = previewRef.current?.currentTime
    if (typeof currentTime !== 'number' || !Number.isFinite(currentTime) || currentTime < 0) {
      setError('Adicione um vídeo e pause na posição desejada para registrar o tempo real.')
      return
    }
    setError(null)
    onUpdate({ ...content, [field]: Number(currentTime.toFixed(2)) })
  }
  const updateSeconds = (field: 'sceneEndSeconds' | 'firstGroupReactionSeconds' | 'secondGroupReactionSeconds', value: string) => {
    const seconds = value === '' ? undefined : Number(value)
    if (seconds !== undefined && (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400)) return
    onUpdate({ ...content, [field]: seconds })
  }

  return <main className="roteiro-workspace-editor" aria-label={'Área de edição: ' + title}>
    <header className="roteiro-editor-subbar"><div><strong>{title}</strong><span>{subtitle}</span></div><div className="roteiro-video-actions">
      <button type="button" onClick={() => void addVideo()} disabled={busy}>{busy ? 'Importando…' : video ? 'Substituir vídeo' : 'Adicionar vídeo'}</button>
      <button type="button" className="danger" onClick={() => onUpdate({ ...content, video: null })} disabled={!video || busy}>Excluir vídeo</button>
    </div></header>
    {error && <p className="roteiro-editor-error" role="alert">{error}</p>}
    <section className="roteiro-video-stage-wrap" aria-label="Preview 1920 por 1080">
      <div className="roteiro-video-preview-panel">
        <div className="roteiro-video-stage">
          {video ? <video ref={previewRef} key={video.id} src={`gacha-video://library/${video.id}`} controls playsInline preload="metadata" aria-label={'Prévia de ' + video.name} /> : <div className="roteiro-video-placeholder"><Icon name="camera" /><strong>Preview 1920 × 1080</strong><span>Adicione um vídeo para visualizar esta seção.</span></div>}
        </div>
        <label className="roteiro-video-description"><span>Descrição do que acontece no vídeo</span><textarea value={content.description ?? ''} onChange={(event) => onUpdate({ ...content, description: event.target.value })} placeholder="Descreva o que acontece neste vídeo…" maxLength={20000} /></label>
        <div className="roteiro-scene-settings">
          <label className="roteiro-timeline-field"><span>Linha do tempo</span><select value={content.timeline ?? 'unspecified'} onChange={(event) => onUpdate({ ...content, timeline: event.target.value as RoteiroSectionContent['timeline'] })}><option value="unspecified">Indefinido</option><option value="past">Passado</option><option value="present">Presente</option><option value="future">Futuro</option></select></label>
          <label className="roteiro-scene-end-field"><span>Fim da cena da descrição</span><div className="roteiro-timing-input"><input aria-label="Fim da cena da descrição em segundos" type="number" min="0" max="86400" step="0.01" value={content.sceneEndSeconds ?? ''} onChange={(event) => updateSeconds('sceneEndSeconds', event.target.value)} placeholder="0" /><small>segundos</small></div></label>
          <section className="roteiro-group-reaction first"><header><strong>Primeira reação em grupo</strong><span>REAÇÃO 1</span></header><div className="roteiro-timing-input"><input aria-label="Primeira reação em grupo em segundos" type="number" min="0" max="86400" step="0.01" value={content.firstGroupReactionSeconds ?? ''} onChange={(event) => updateSeconds('firstGroupReactionSeconds', event.target.value)} placeholder="0" /><button type="button" onClick={() => captureReactionTime('firstGroupReactionSeconds')}>Tempo real</button><small>segundos</small></div></section>
          <section className="roteiro-group-reaction second"><header><strong>Segunda reação em grupo</strong><span>REAÇÃO 2</span></header><div className="roteiro-timing-input"><input aria-label="Segunda reação em grupo em segundos" type="number" min="0" max="86400" step="0.01" value={content.secondGroupReactionSeconds ?? ''} onChange={(event) => updateSeconds('secondGroupReactionSeconds', event.target.value)} placeholder="0" /><button type="button" onClick={() => captureReactionTime('secondGroupReactionSeconds')}>Tempo real</button><small>segundos</small></div></section>
        </div>
      </div>
    </section>
    <section className="roteiro-reaction-sequence" aria-label="Sequência de reações">
      <header><div><button className="roteiro-sequence-collapse" type="button" onClick={() => setBlocksCollapsed((collapsed) => !collapsed)} aria-label={blocksCollapsed ? 'Expandir sequência de reações' : 'Recolher sequência de reações'} aria-expanded={!blocksCollapsed}><Icon name="chevronDown" /></button><span>{content.blocks.length}</span><h2>Sequência de reações</h2></div></header>
      <button className="roteiro-add-block" type="button" onClick={addBlock}><Icon name="plus" />Adicionar bloco</button>
      {!blocksCollapsed && <div className="roteiro-reaction-blocks">{content.blocks.map((block, index) => <article className={`roteiro-reaction-block tone-${index % 3}`} key={block.id}>
        <div className="roteiro-reaction-identity">{(() => { const character = characters.find((item) => item.id === block.characterId); return character ? <RenderedCharacterPortrait className="roteiro-reaction-avatar" character={character} /> : <span className="roteiro-reaction-avatar-empty"><Icon name="user" /></span> })()}<span className="roteiro-reaction-index">{String(index + 1).padStart(2, '0')}</span></div>
        <div className="roteiro-reaction-fields">
          <label>Personagem<select value={block.characterId} onChange={(event) => updateBlock(block.id, { characterId: event.target.value })}><option value="">Selecione personagem</option>{characters.filter((character) => characterIds.includes(character.id)).map((character) => <option value={character.id} key={character.id}>{character.name}</option>)}</select></label>
          <label>Tipo<select value={block.kind} onChange={(event) => updateBlock(block.id, { kind: event.target.value as RoteiroReactionBlock['kind'] })}><option value="fala">Fala</option><option value="pensamento">Pensamento</option></select></label>
          <label>Expressão ou emoção<input value={block.expression} onChange={(event) => updateBlock(block.id, { expression: event.target.value })} placeholder="Ex.: sério, desviando o olhar" maxLength={500} /></label>
          <label className="roteiro-reaction-text">{block.kind === 'pensamento' ? 'Pensamento em português' : 'Fala em português'}<textarea value={block.textPortuguese} onChange={(event) => updateBlock(block.id, { textPortuguese: event.target.value })} placeholder="Escreva o texto em português…" maxLength={10000} /></label>
          <label className="roteiro-reaction-text">Versão em inglês<textarea value={block.textEnglish} onChange={(event) => updateBlock(block.id, { textEnglish: event.target.value })} placeholder="A tradução aparecerá aqui…" maxLength={10000} /></label>
        </div>
        <div className="roteiro-reaction-actions">
          <button type="button" onClick={() => moveBlock(index, -1)} disabled={index === 0}>↑ Subir</button><button type="button" onClick={() => moveBlock(index, 1)} disabled={index === content.blocks.length - 1}>↓ Descer</button>
          <button type="button" disabled title="Ação de IA ainda não configurada">✦ Melhorar frase</button><button type="button" disabled title="Ação de IA ainda não configurada">✎ Refazer frase</button><button type="button" disabled title="Ação de tradução ainda não configurada">◎ Traduzir</button>
          <button type="button" onClick={() => onUpdate({ ...content, blocks: [...content.blocks.slice(0, index + 1), { ...block, id: crypto.randomUUID() }, ...content.blocks.slice(index + 1)] })}>⊞ Duplicar</button>
          <button type="button" className="danger" onClick={() => onUpdate({ ...content, blocks: content.blocks.filter((item) => item.id !== block.id) })}>Excluir</button>
        </div>
      </article>)}</div>}
    </section>
  </main>
}

function RoteiroWorkspace({ roteiro, onBack, onUpdate, characters }: { roteiro: SidebarRoteiro; onBack: () => void; onUpdate: (next: SidebarRoteiro) => void; characters: CustomizerCharacter[] }) {
  const [activeContentId, setActiveContentId] = useState('opening')
  const [editingTikTok, setEditingTikTok] = useState<RoteiroTikTok | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [editingVideoTitle, setEditingVideoTitle] = useState('')
  const activeTikTok = roteiro.tiktoks.find((item) => item.id === activeContentId)
  const activeContent = activeContentId === 'opening' ? roteiro.opening ?? emptyRoteiroContent() : { video: activeTikTok?.video ?? null, blocks: activeTikTok?.blocks ?? [], description: activeTikTok?.description ?? '', timeline: activeTikTok?.timeline ?? 'unspecified', sceneEndSeconds: activeTikTok?.sceneEndSeconds, firstGroupReactionSeconds: activeTikTok?.firstGroupReactionSeconds, secondGroupReactionSeconds: activeTikTok?.secondGroupReactionSeconds }
  const updateActiveContent = (content: RoteiroSectionContent) => {
    if (activeContentId === 'opening') onUpdate({ ...roteiro, opening: content })
    else onUpdate({ ...roteiro, tiktoks: roteiro.tiktoks.map((item) => item.id === activeContentId ? { ...item, video: content.video, blocks: content.blocks, description: content.description ?? '', timeline: content.timeline, sceneEndSeconds: content.sceneEndSeconds, firstGroupReactionSeconds: content.firstGroupReactionSeconds, secondGroupReactionSeconds: content.secondGroupReactionSeconds } : item) })
  }
  const addTikTok = () => {
    const number = roteiro.tiktoks.length + 1
    const item = { id: crypto.randomUUID(), title: 'TikTok ' + number, videoTitle: 'Vídeo ' + String(number).padStart(2, '0') }
    onUpdate({ ...roteiro, tiktoks: [...roteiro.tiktoks, item] })
    setActiveContentId(item.id)
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
        <div className="roteiro-tiktoks-list">
          <article className={`roteiro-tiktok-card roteiro-opening-card${activeContentId === 'opening' ? ' active' : ''}`}>
            <button className="roteiro-tiktok-open" onClick={() => setActiveContentId('opening')} aria-current={activeContentId === 'opening' ? 'page' : undefined} type="button">
              <span className="roteiro-tiktok-number" aria-hidden="true">↗</span>
              <span className="roteiro-tiktok-info"><strong>Abertura</strong><span>Início do roteiro</span></span>
              <span className="roteiro-tiktok-cast">{roteiro.characterIds.length}/{roteiro.characterIds.length}</span>
            </button>
          </article>
          {roteiro.tiktoks.map((item, index) => <article className={`roteiro-tiktok-card${activeContentId === item.id ? ' active' : ''}`} key={item.id}>
            <button className="roteiro-tiktok-open" onClick={() => setActiveContentId(item.id)} aria-current={activeContentId === item.id ? 'page' : undefined} type="button">
              <span className="roteiro-tiktok-number" aria-hidden="true">{index + 1}</span>
              <span className="roteiro-tiktok-info"><strong>{item.title}</strong><span>{item.videoTitle}</span></span>
              <span className="roteiro-tiktok-cast">{roteiro.characterIds.length}/{roteiro.characterIds.length}</span>
            </button>
            <div className="roteiro-tiktok-actions"><button onClick={() => moveTikTok(index, -1)} disabled={index === 0} aria-label={'Mover ' + item.title + ' para cima'} type="button">↑</button><button onClick={() => moveTikTok(index, 1)} disabled={index === roteiro.tiktoks.length - 1} aria-label={'Mover ' + item.title + ' para baixo'} type="button">↓</button><button onClick={() => { setEditingTikTok(item); setEditingTitle(item.title); setEditingVideoTitle(item.videoTitle) }} type="button">Editar</button></div>
        </article>)}</div>
      </section>
    </aside>
    <RoteiroSectionEditor title={activeContentId === 'opening' ? 'Abertura' : activeTikTok?.title ?? 'TikTok'} subtitle={activeContentId === 'opening' ? 'Início do roteiro' : activeTikTok?.videoTitle ?? ''} content={activeContent} characters={characters} characterIds={roteiro.characterIds} onUpdate={updateActiveContent} />
    <aside className="roteiro-workspace-empty-panel" aria-label="Painel lateral vazio do roteiro" />
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
  const [editingCharacterIds, setEditingCharacterIds] = useState<string[]>([])
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
    setRoteiros((current) => current.map((roteiro) => roteiro.id === editingVideoId ? { ...roteiro, videoTitle: editingVideoTitle.trim(), characterIds: editingCharacterIds } : roteiro))
    setEditingVideoId(null); setEditingVideoTitle(''); setEditingCharacterIds([])
  }

  if (openedRoteiro) return <RoteiroWorkspace roteiro={openedRoteiro} characters={characters} onBack={() => setOpenedRoteiroId(null)} onUpdate={(updated) => setRoteiros((current) => current.map((item) => item.id === updated.id ? updated : item))} />

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
          <div className="roteiro-main-video-strip"><span title={roteiro.videoTitle}>{roteiro.videoTitle}</span><button onClick={() => { setEditingVideoId(roteiro.id); setEditingVideoTitle(roteiro.videoTitle); setEditingCharacterIds([...roteiro.characterIds]) }} disabled={deleteMode} aria-label={`Editar roteiro ${roteiro.title}`} title="Editar roteiro e elenco" type="button"><Icon name="edit" /></button></div>
          <button className="roteiro-main-thumbnail" onClick={() => { if (deleteMode) toggleRoteiroSelection(roteiro.id); else { setSelectedRoteiroId(roteiro.id); setOpenedRoteiroId(roteiro.id) } }} aria-pressed={deleteMode ? markedForDelete : selectedRoteiroId === roteiro.id} type="button">{firstCharacter ? <CharacterPortrait character={firstCharacter} /> : <span className="roteiro-thumbnail-placeholder"><Icon name="message" /></span>}<strong title={roteiro.title}>{roteiro.title}</strong></button>
        </article>
      })}</div></div>}
    </section>
    {createOpen && <div className="roteiro-modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setCreateOpen(false) }}><section className="roteiro-create-modal" role="dialog" aria-modal="true" aria-labelledby="roteiro-create-title"><header><div><span>NOVO ROTEIRO</span><h2 id="roteiro-create-title">Criar roteiro</h2></div><button onClick={() => setCreateOpen(false)} aria-label="Fechar" type="button">×</button></header><label className="roteiro-modal-name">Nome do roteiro<input autoFocus value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Digite o nome do roteiro" maxLength={100} /></label><div className="roteiro-modal-cast-heading"><strong>Seleção de elenco</strong><span>{newCharacterIds.length} selecionado(s)</span></div><div className="roteiro-modal-cast-list">{characters.length ? characters.map((character) => { const checked = newCharacterIds.includes(character.id); return <button className={checked ? 'selected' : ''} key={character.id} onClick={() => setNewCharacterIds((current) => checked ? current.filter((id) => id !== character.id) : [...current, character.id])} type="button"><CharacterPortrait character={character} /><span>{character.name}</span><i>{checked ? '✓' : '+'}</i></button> }) : <p>Não há personagens disponíveis no Customizador.</p>}</div><footer><button onClick={() => setCreateOpen(false)} type="button">Cancelar</button><button className="roteiro-create-confirm" onClick={createRoteiro} disabled={!newTitle.trim()} type="button"><Icon name="check" />Criar roteiro</button></footer></section></div>}
    {editingVideoId && <div className="roteiro-modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setEditingVideoId(null) }}><section className="roteiro-video-title-modal" role="dialog" aria-modal="true" aria-labelledby="roteiro-video-title-heading"><header><strong id="roteiro-video-title-heading">Editar roteiro e elenco</strong><button onClick={() => setEditingVideoId(null)} aria-label="Fechar" type="button">×</button></header><label>Título do vídeo<input autoFocus value={editingVideoTitle} onChange={(event) => setEditingVideoTitle(event.target.value)} maxLength={100} /></label><div className="roteiro-modal-cast-heading"><strong>Elenco</strong><span>{editingCharacterIds.length} selecionado(s)</span></div><div className="roteiro-modal-cast-list">{characters.length ? characters.map((character) => { const checked = editingCharacterIds.includes(character.id); return <button className={checked ? 'selected' : ''} key={character.id} onClick={() => setEditingCharacterIds((current) => checked ? current.filter((id) => id !== character.id) : [...current, character.id])} type="button"><CharacterPortrait character={character} /><span>{character.name}</span><i>{checked ? '✓' : '+'}</i></button> }) : <p>Não há personagens disponíveis no Customizador.</p>}</div><footer><button onClick={() => setEditingVideoId(null)} type="button">Cancelar</button><button className="roteiro-create-confirm" onClick={saveVideoTitle} disabled={!editingVideoTitle.trim()} type="button"><Icon name="check" />Salvar</button></footer></section></div>}
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
