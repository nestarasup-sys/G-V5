import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { TopBar } from './components/TopBar'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { Icon } from './components/Icon'
import { CharacterPortrait } from './components/CharacterPortrait'
import { RenderedCharacterPortrait } from './components/RenderedCharacterPortrait'
import type { CustomizerCharacter } from '../../../shared/customizer'
import type { BaseVideoDetails, RoteiroDocument, RoteiroReactionBlock, RoteiroSectionContent, RoteiroTikTok, RoteiroVideoReference } from '../../../shared/roteiros'
import type { VideoLibraryItem } from '../../../shared/studio'

const LazyCustomizerPage = lazy(async () => ({ default: (await import('../features/customizer/CustomizerPage')).CustomizerPage }))
const LazyStudioPage = lazy(async () => ({ default: (await import('../features/studio/StudioPage')).StudioPage }))
const LazyVideoStudioPage = lazy(async () => ({ default: (await import('../features/videoStudio/VideoStudioPage')).VideoStudioPage }))
const LazyOptionsPage = lazy(async () => ({ default: (await import('../features/options/OptionsPage')).OptionsPage }))
const LazyFabricatorPage = lazy(async () => ({ default: (await import('../features/fabricator/FabricatorPage')).FabricatorPage }))
const LazyBaseVideosPage = lazy(async () => ({ default: (await import('../features/roteiros/BaseVideosPage')).BaseVideosPage }))

const roteiroAreas = [
  { id: 'roteiros', label: 'Roteiros', icon: 'message' },
  { id: 'fichas', label: 'Ficha dos personagens', icon: 'user' },
  { id: 'configuracoes', label: 'Configurações', icon: 'settings' }
] as const

type SidebarRoteiro = RoteiroDocument

const emptyRoteiroContent = (): RoteiroSectionContent => ({ video: null, blocks: [], description: '', timeline: 'unspecified' })
const roteiroThumbnailColors = ['#dcecff', '#ffe3ec', '#e2f4df', '#fff0cf', '#e9e1ff', '#d9f2ef']

function roteiroThumbnailColor(id: string): string {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  return roteiroThumbnailColors[hash % roteiroThumbnailColors.length]
}

function roteiroVideoReference(item: VideoLibraryItem): RoteiroVideoReference {
  if (item.durationFrames === null) throw new Error('A duração do vídeo ainda não foi reconhecida.')
  return { id: item.id, name: item.name, mimeType: item.mimeType, extension: item.extension, size: item.size, durationFrames: item.durationFrames }
}

function RoteiroSectionEditor({ title, subtitle, content, characters, characterIds, saveStatus, onUpdate, onDeleteDraftVideo }: {
  title: string
  subtitle: string
  content: RoteiroSectionContent
  characters: CustomizerCharacter[]
  characterIds: string[]
  saveStatus: 'saving' | 'saved' | 'error'
  onUpdate: (content: RoteiroSectionContent) => void
  onDeleteDraftVideo: (videoId: string, content: RoteiroSectionContent) => Promise<boolean>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [libraryActionMessage, setLibraryActionMessage] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerItems, setPickerItems] = useState<Array<VideoLibraryItem & { durationFrames: number }>>([])
  const [pickerNumbers, setPickerNumbers] = useState<Record<string, number>>({})
  const [pickerDetails, setPickerDetails] = useState<Record<string, BaseVideoDetails>>({})
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerTimeline, setPickerTimeline] = useState('all')
  const [pickerSort, setPickerSort] = useState<'number' | 'name' | 'duration' | 'newest'>('number')
  const [pickerPreviewId, setPickerPreviewId] = useState<string | null>(null)
  const [blocksCollapsed, setBlocksCollapsed] = useState(false)
  const previewRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (!pickerOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (pickerPreviewId) setPickerPreviewId(null)
        else setPickerOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pickerOpen, pickerPreviewId])
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
  const openVideoPicker = async () => {
    setPickerOpen(true)
    setPickerLoading(true)
    setPickerItems([])
    setPickerQuery(''); setPickerTimeline('all'); setPickerSort('number'); setPickerPreviewId(null)
    try {
      const [library, details] = await Promise.all([window.desktop.listVideoLibrary(), window.desktop.listBaseVideoDetails()])
      const numberById = Object.fromEntries(details.flatMap((item: BaseVideoDetails) => item.videoNumber === undefined ? [] : [[item.videoId, item.videoNumber]])) as Record<string, number>
      setPickerDetails(Object.fromEntries(details.map((item) => [item.videoId, item])))
      setPickerNumbers(numberById)
      setPickerItems(library.filter((item): item is VideoLibraryItem & { durationFrames: number } => item.available && item.durationFrames !== null && numberById[item.id] !== undefined)
        .sort((a, b) => numberById[a.id] - numberById[b.id]))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os vídeos da Base.')
      setPickerOpen(false)
    } finally { setPickerLoading(false) }
  }
  const selectBaseVideo = (item: VideoLibraryItem) => {
    onUpdate({ ...content, video: roteiroVideoReference(item) })
    setPickerOpen(false)
    setLibraryActionMessage(`Vídeo ${String(pickerNumbers[item.id]).padStart(2, '0')} vinculado ao roteiro pelo ID.`)
  }
  const filteredPickerItems = useMemo(() => pickerItems.filter((item) => {
    const details = pickerDetails[item.id]
    const query = pickerQuery.trim().toLocaleLowerCase('pt-BR')
    const matchesQuery = !query || item.name.toLocaleLowerCase('pt-BR').includes(query)
      || item.id.toLocaleLowerCase().includes(query)
      || String(pickerNumbers[item.id] ?? '').includes(query)
      || (details?.description ?? '').toLocaleLowerCase('pt-BR').includes(query)
    return matchesQuery && (pickerTimeline === 'all' || details?.timeline === pickerTimeline)
  }).sort((a, b) => {
    if (pickerSort === 'name') return a.name.localeCompare(b.name, 'pt-BR')
    if (pickerSort === 'duration') return (a.durationFrames ?? 0) - (b.durationFrames ?? 0)
    if (pickerSort === 'newest') return b.createdAt.localeCompare(a.createdAt)
    return (pickerNumbers[a.id] ?? Number.MAX_SAFE_INTEGER) - (pickerNumbers[b.id] ?? Number.MAX_SAFE_INTEGER)
  }), [pickerItems, pickerDetails, pickerQuery, pickerTimeline, pickerSort, pickerNumbers])
  const removeVideo = async () => {
    if (!video) return
    setBusy(true)
    setError(null)
    setLibraryActionMessage(null)
    const nextContent = { ...content, video: null }
    try {
      const details = await window.desktop.listBaseVideoDetails()
      const existing = details.find((item) => item.videoId === video.id)
      if (existing?.videoNumber !== undefined) {
        onUpdate(nextContent)
        setLibraryActionMessage(`Referência do VÍDEO ${String(existing.videoNumber).padStart(2, '0')} removida deste roteiro. O vídeo continua na Base.`)
      } else {
        const deleted = await onDeleteDraftVideo(video.id, nextContent)
        setLibraryActionMessage(deleted
          ? 'Vídeo não publicado removido deste roteiro e dos Rascunhos.'
          : 'Referência removida. O vídeo foi mantido porque outro roteiro ainda o utiliza.')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível remover o vídeo do roteiro.')
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
  const saveVideoDestination = async (destination: 'base' | 'draft') => {
    if (!video) { setError('Adicione um vídeo antes de enviá-lo.'); return }
    setBusy(true)
    setError(null)
    setLibraryActionMessage(null)
    const details = {
      videoId: video.id,
      description: content.description ?? '',
      timeline: content.timeline ?? 'unspecified',
      sceneEndSeconds: content.sceneEndSeconds,
      firstGroupReactionSeconds: content.firstGroupReactionSeconds,
      secondGroupReactionSeconds: content.secondGroupReactionSeconds
    }
    try {
      await window.desktop.saveBaseVideoDetails(details)
      const saved = await window.desktop.listBaseVideoDetails()
      const existing = saved.find((item) => item.videoId === video.id)
      const hasFilledContent = Boolean(details.description.trim()
        || details.timeline !== 'unspecified'
        || details.sceneEndSeconds !== undefined
        || details.firstGroupReactionSeconds !== undefined
        || details.secondGroupReactionSeconds !== undefined
        || content.blocks.some((block) => block.expression.trim() || block.textPortuguese.trim() || block.textEnglish.trim()))
      if (destination === 'base' && !hasFilledContent) {
        setLibraryActionMessage(existing?.videoNumber === undefined
          ? 'Sem conteúdo preenchido: o vídeo ficou em Rascunhos.'
          : `Este vídeo já está na Base como VÍDEO ${String(existing.videoNumber).padStart(2, '0')}.`)
        return
      }
      if (destination === 'base') {
        const number = await window.desktop.publishBaseVideo(video.id)
        setLibraryActionMessage(`Enviado para a Base de vídeos como VÍDEO ${String(number).padStart(2, '0')}.`)
      } else {
        setLibraryActionMessage(existing?.videoNumber === undefined
          ? 'Vídeo salvo em Rascunhos.'
          : `Este vídeo já está na Base como VÍDEO ${String(existing.videoNumber).padStart(2, '0')}.`)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar a Base de vídeos.')
    } finally { setBusy(false) }
  }

  return <><main className="roteiro-workspace-editor" aria-label={'Área de edição: ' + title}>
    <header className="roteiro-editor-subbar"><div><strong>{title}</strong><span>{subtitle}</span></div><span className={`roteiro-save-indicator ${saveStatus}`} role="status">{saveStatus === 'saving' ? 'Salvando roteiro…' : saveStatus === 'error' ? 'Falha ao salvar roteiro' : 'Roteiro salvo'}</span></header>
    {error && <p className="roteiro-editor-error" role="alert">{error}</p>}
    <section className="roteiro-video-stage-wrap" aria-label="Preview 1920 por 1080">
      <div className="roteiro-video-preview-panel">
        <div className="roteiro-library-actions" aria-label="Destino do vídeo">
          <button type="button" onClick={() => void addVideo()} disabled={busy}>{busy ? 'Importando…' : 'Adicionar vídeo'}</button>
          <button type="button" className="danger" onClick={() => void removeVideo()} disabled={!video || busy}>Excluir vídeo</button>
          <button type="button" onClick={() => void openVideoPicker()} disabled={busy}>Selecionar da base de vídeos</button>
          <button type="button" className="primary" onClick={() => void saveVideoDestination('base')} disabled={busy || !video}>{busy ? 'Salvando…' : 'Enviar para base de vídeos'}</button>
          <button type="button" onClick={() => void saveVideoDestination('draft')} disabled={busy || !video}>Salvar como rascunho</button>
          {libraryActionMessage && <span role="status">{libraryActionMessage}</span>}
        </div>
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
        {video && [content.sceneEndSeconds, content.firstGroupReactionSeconds, content.secondGroupReactionSeconds].some((seconds) => seconds !== undefined && seconds > video.durationFrames / 60) && <p className="roteiro-time-warning" role="status"><Icon name="warning" /> Um ou mais tempos ultrapassam a duração do vídeo ({(video.durationFrames / 60).toFixed(2)} s).</p>}
      </div>
    </section>
    <section className="roteiro-reaction-sequence" aria-label="Sequência de reações">
      <header><div><button className="roteiro-sequence-collapse" type="button" onClick={() => setBlocksCollapsed((collapsed) => !collapsed)} aria-label={blocksCollapsed ? 'Expandir sequência de reações' : 'Recolher sequência de reações'} aria-expanded={!blocksCollapsed}><Icon name="chevronDown" /></button><span>{content.blocks.length}</span><h2>Sequência de reações</h2></div><button className="roteiro-add-block" type="button" onClick={addBlock}><Icon name="plus" />Adicionar bloco</button></header>
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
  </main>{pickerOpen && <div className="roteiro-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPickerOpen(false) }}>
    <section className="roteiro-video-picker-modal" role="dialog" aria-modal="true" aria-labelledby="roteiro-video-picker-title">
      <header><div><span>BASE DE VÍDEOS</span><h2 id="roteiro-video-picker-title">Selecionar vídeo</h2><p>Escolha um vídeo publicado para vincular a esta seção.</p></div><button type="button" aria-label="Fechar" onClick={() => setPickerOpen(false)}>×</button></header>
      {pickerPreviewId ? (() => {
        const item = pickerItems.find((candidate) => candidate.id === pickerPreviewId)
        if (!item) return null
        return <div className="roteiro-picker-focused"><button type="button" className="roteiro-picker-back" onClick={() => setPickerPreviewId(null)}>← Voltar à galeria</button><div className="roteiro-picker-large-preview"><video key={item.id} src={`gacha-video://library/${item.id}`} controls autoPlay playsInline preload="metadata" /></div><div className="roteiro-picker-focus-info"><span className="roteiro-video-picker-number">VÍDEO {String(pickerNumbers[item.id]).padStart(2, '0')}</span><div><strong>{item.name}</strong><small>{(item.durationFrames / 60).toFixed(2)} s · {(item.size / 1024 ** 2).toFixed(1)} MB · ID {item.id.slice(0, 8).toUpperCase()}</small></div><button className="primary" type="button" onClick={() => selectBaseVideo(item)}>{content.video?.id === item.id ? 'Manter este vídeo' : 'Usar este vídeo'}</button></div></div>
      })() : <>
        <div className="roteiro-video-picker-filters"><label className="roteiro-picker-search"><Icon name="search" /><input autoFocus value={pickerQuery} onChange={(event) => setPickerQuery(event.target.value)} placeholder="Buscar por nome, número, ID ou descrição" /></label><label><span>Linha do tempo</span><select value={pickerTimeline} onChange={(event) => setPickerTimeline(event.target.value)}><option value="all">Todas</option><option value="past">Passado</option><option value="present">Presente</option><option value="future">Futuro</option><option value="unspecified">Indefinido</option></select></label><label><span>Ordenar</span><select value={pickerSort} onChange={(event) => setPickerSort(event.target.value as typeof pickerSort)}><option value="number">Número</option><option value="name">Nome</option><option value="duration">Duração</option><option value="newest">Mais recente</option></select></label><span className="roteiro-picker-result-count">{filteredPickerItems.length} vídeo(s)</span></div>
        <div className="roteiro-video-picker-list">{pickerLoading ? <div className="roteiro-picker-skeleton-grid" aria-label="Carregando vídeos">{Array.from({ length: 6 }, (_, index) => <div className="roteiro-picker-skeleton" key={index}><i /><span /><span /></div>)}</div> : filteredPickerItems.length ? filteredPickerItems.map((item) => <article className={`roteiro-video-picker-card${content.video?.id === item.id ? ' linked' : ''}`} key={item.id} onDoubleClick={() => selectBaseVideo(item)}>
          <button className="roteiro-picker-thumb" type="button" onClick={() => setPickerPreviewId(item.id)} aria-label={`Abrir prévia de ${item.name}`}><video src={`gacha-video://library/${item.id}`} muted playsInline preload="metadata" tabIndex={-1} /><span className="roteiro-picker-play">▶</span><small>{(item.durationFrames / 60).toFixed(2)} s</small></button>
          <div className="roteiro-picker-card-info"><div><span className="roteiro-video-picker-number">VÍDEO {String(pickerNumbers[item.id]).padStart(2, '0')}</span><strong title={item.name}>{item.name}</strong>{content.video?.id === item.id && <span className="roteiro-picker-linked-badge">Vinculado</span>}</div><small>{(item.size / 1024 ** 2).toFixed(1)} MB · ID {item.id.slice(0, 8).toUpperCase()}</small><div className="roteiro-picker-card-actions"><button type="button" onClick={() => setPickerPreviewId(item.id)}>▶ Prévia</button><button className="primary" type="button" onClick={() => selectBaseVideo(item)}>{content.video?.id === item.id ? 'Selecionado' : 'Selecionar'}</button></div></div>
        </article>) : <div className="roteiro-picker-empty"><Icon name="frame" /><strong>{pickerItems.length ? 'Nenhum resultado para esse filtro' : 'A Base de vídeos está vazia'}</strong><span>{pickerItems.length ? 'Tente outro nome ou ajuste os filtros.' : 'Os rascunhos não aparecem aqui. Publique um vídeo na Base para selecioná-lo.'}</span></div>}</div>
      </>}
      <footer><button type="button" onClick={() => setPickerOpen(false)}>Fechar</button></footer>
    </section>
  </div>}</>
}

function RoteiroWorkspace({ roteiro, onBack, onUpdate, onDeleteDraftVideo, characters, saveStatus }: { roteiro: SidebarRoteiro; onBack: () => void; onUpdate: (next: SidebarRoteiro) => void; onDeleteDraftVideo: (next: SidebarRoteiro, videoId: string) => Promise<boolean>; characters: CustomizerCharacter[]; saveStatus: 'saving' | 'saved' | 'error' }) {
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
  const removeDraftVideo = (videoId: string, content: RoteiroSectionContent) => {
    const next = activeContentId === 'opening'
      ? { ...roteiro, opening: content }
      : { ...roteiro, tiktoks: roteiro.tiktoks.map((item) => item.id === activeContentId ? { ...item, video: content.video, blocks: content.blocks, description: content.description ?? '', timeline: content.timeline, sceneEndSeconds: content.sceneEndSeconds, firstGroupReactionSeconds: content.firstGroupReactionSeconds, secondGroupReactionSeconds: content.secondGroupReactionSeconds } : item) }
    return onDeleteDraftVideo(next, videoId)
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
          </article>)}{roteiro.tiktoks.length === 0 && <div className="roteiro-first-tiktok"><Icon name="message" /><strong>Seu roteiro começa aqui</strong><span>Adicione o primeiro TikTok quando estiver pronto.</span><button type="button" onClick={addTikTok}>Adicionar primeiro TikTok</button></div>}</div>
      </section>
    </aside>
    <RoteiroSectionEditor title={activeContentId === 'opening' ? 'Abertura' : activeTikTok?.title ?? 'TikTok'} subtitle={activeContentId === 'opening' ? 'Início do roteiro' : activeTikTok?.videoTitle ?? ''} content={activeContent} characters={characters} characterIds={roteiro.characterIds} saveStatus={saveStatus} onUpdate={updateActiveContent} onDeleteDraftVideo={removeDraftVideo} />
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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [roteiroSearch, setRoteiroSearch] = useState('')
  const [roteiroSaveStatus, setRoteiroSaveStatus] = useState<'saving' | 'saved' | 'error'>('saved')
  const [libraryItems, setLibraryItems] = useState<VideoLibraryItem[]>([])
  const [libraryLoaded, setLibraryLoaded] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newCharacterIds, setNewCharacterIds] = useState<string[]>([])
  const [editingVideoId, setEditingVideoId] = useState<string | null>(null)
  const [editingVideoTitle, setEditingVideoTitle] = useState('')
  const [editingCharacterIds, setEditingCharacterIds] = useState<string[]>([])
  const roteiroListRef = useRef<HTMLDivElement>(null)
  const roteiroListScroll = useRef(0)
  const saveRevision = useRef(0)
  const active = roteiroAreas.find((area) => area.id === activeArea) ?? roteiroAreas[0]
  const openedRoteiro = roteiros.find((roteiro) => roteiro.id === openedRoteiroId) ?? null

  useEffect(() => {
    let cancelled = false
    void window.desktop.listCustomizerCharacters().then((items) => { if (!cancelled) setCharacters(items) }).catch(() => undefined)
    void window.desktop.listVideoLibrary().then((items) => { if (!cancelled) { setLibraryItems(items); setLibraryLoaded(true) } }).catch(() => { if (!cancelled) setLibraryLoaded(true) })
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
    const revision = ++saveRevision.current
    setRoteiroSaveStatus('saving')
    void window.desktop.saveRoteiros(roteiros).then(() => { if (revision === saveRevision.current) setRoteiroSaveStatus('saved') }).catch((error) => {
      console.error('Não foi possível salvar os roteiros.', error)
      if (revision === saveRevision.current) setRoteiroSaveStatus('error')
    })
  }, [roteiros, roteirosLoaded])

  useEffect(() => {
    if (!openedRoteiroId && roteiroListRef.current) roteiroListRef.current.scrollTop = roteiroListScroll.current
  }, [openedRoteiroId])

  useEffect(() => {
    if (!deleteMode) return
    const cancelOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { if (deleteDialogOpen) setDeleteDialogOpen(false); else { setDeleteMode(false); setDeleteSelection([]) } }
    }
    window.addEventListener('keydown', cancelOnEscape)
    return () => window.removeEventListener('keydown', cancelOnEscape)
  }, [deleteMode, deleteDialogOpen])

  const createRoteiro = () => {
    const title = newTitle.trim()
    if (!title) return
    const roteiro: SidebarRoteiro = { id: crypto.randomUUID(), title, videoTitle: 'Vídeo 01', characterIds: newCharacterIds, tiktoks: [] }
    setRoteiros((current) => [roteiro, ...current])
    setSelectedRoteiroId(roteiro.id)
    setNewTitle(''); setNewCharacterIds([]); setCreateOpen(false)
  }

  const deleteDraftVideoFromRoteiro = async (updatedRoteiro: SidebarRoteiro, videoId: string) => {
    const nextRoteiros = roteiros.map((item) => item.id === updatedRoteiro.id ? updatedRoteiro : item)
    await window.desktop.saveRoteiros(nextRoteiros)
    setRoteiros(nextRoteiros)
    const stillReferenced = nextRoteiros.some((item) => item.opening?.video?.id === videoId || item.tiktoks.some((tiktok) => tiktok.video?.id === videoId))
    if (stillReferenced) return false
    await window.desktop.deleteBaseVideo(videoId)
    return true
  }

  const duplicateRoteiro = (source: SidebarRoteiro) => {
    const remapBlocks = (blocks: RoteiroReactionBlock[] = []) => blocks.map((block) => ({ ...block, id: crypto.randomUUID() }))
    const copy: SidebarRoteiro = {
      ...source,
      id: crypto.randomUUID(),
      title: `${source.title.slice(0, 92)} (cópia)`,
      opening: source.opening ? { ...source.opening, blocks: remapBlocks(source.opening.blocks) } : emptyRoteiroContent(),
      tiktoks: source.tiktoks.map((item) => ({ ...item, id: crypto.randomUUID(), blocks: remapBlocks(item.blocks) }))
    }
    setRoteiros((current) => [copy, ...current])
    setSelectedRoteiroId(copy.id)
  }

  const handleDeleteButton = () => {
    if (!deleteMode) {
      setDeleteSelection([])
      setDeleteMode(true)
      return
    }
    if (deleteSelection.length === 0) {
      setDeleteSelection([])
      setDeleteMode(false)
      return
    }
    setDeleteDialogOpen(true)
  }

  const confirmDeleteRoteiros = () => {
    if (deleteSelection.length === 0) return
    setRoteiros((current) => current.filter((roteiro) => !deleteSelection.includes(roteiro.id)))
    if (selectedRoteiroId && deleteSelection.includes(selectedRoteiroId)) setSelectedRoteiroId(null)
    if (openedRoteiroId && deleteSelection.includes(openedRoteiroId)) setOpenedRoteiroId(null)
    setDeleteSelection([])
    setDeleteMode(false)
    setDeleteDialogOpen(false)
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

  const visibleRoteiros = roteiros.filter((roteiro) => !roteiroSearch.trim() || roteiro.title.toLocaleLowerCase('pt-BR').includes(roteiroSearch.trim().toLocaleLowerCase('pt-BR')) || roteiro.videoTitle.toLocaleLowerCase('pt-BR').includes(roteiroSearch.trim().toLocaleLowerCase('pt-BR')))
  const availableVideoIds = new Set(libraryItems.filter((item) => item.available).map((item) => item.id))

  if (openedRoteiro) return <RoteiroWorkspace roteiro={openedRoteiro} characters={characters} saveStatus={roteiroSaveStatus} onBack={() => setOpenedRoteiroId(null)} onUpdate={(updated) => setRoteiros((current) => current.map((item) => item.id === updated.id ? updated : item))} onDeleteDraftVideo={deleteDraftVideoFromRoteiro} />

  return <div className="roteiros-layout">
    <aside className="roteiros-sidebar-empty" aria-label="Navegação de roteiros">
      <nav className="roteiros-subnav" aria-label="Subáreas de Roteiros">
        {roteiroAreas.map((area) => <button key={area.id} className={`roteiros-subnav-button${activeArea === area.id ? ' active' : ''}`} onClick={() => { setActiveArea(area.id); setDeleteMode(false); setDeleteSelection([]) }} aria-current={activeArea === area.id ? 'page' : undefined} type="button"><Icon name={area.icon} /><span>{area.label}</span></button>)}
      </nav>
    </aside>
    <section className="roteiros-main-empty" aria-label={`Área ${active.label}`}>
      <header className="roteiros-area-titlebar"><div className="roteiros-title-content">{activeArea === 'roteiros' && <div className="roteiros-title-actions"><button className="add" onClick={() => { setDeleteMode(false); setDeleteSelection([]); setNewTitle(''); setNewCharacterIds([]); setCreateOpen(true) }} title="Adicionar roteiro" type="button">Adicionar</button><button className={deleteMode ? deleteSelection.length ? 'confirm-delete' : 'cancel-delete' : 'delete'} onClick={handleDeleteButton} disabled={!deleteMode && roteiros.length === 0} title={deleteMode ? deleteSelection.length ? `Confirmar exclusão de ${deleteSelection.length} roteiro(s)` : 'Voltar sem excluir roteiros' : 'Selecionar roteiros para excluir'} type="button">{deleteMode ? deleteSelection.length ? 'Confirmar' : 'Voltar' : 'Excluir'}</button></div>}<h1>{active.label}</h1></div></header>
      {activeArea === 'roteiros' && <div className="roteiro-main-library" aria-label="Lista de roteiros" ref={roteiroListRef}><div className="roteiro-library-toolbar"><label><Icon name="search" /><input value={roteiroSearch} onChange={(event) => setRoteiroSearch(event.target.value)} placeholder="Buscar roteiro…" /></label><span className={`roteiro-save-indicator ${roteiroSaveStatus}`} role="status">{roteiroSaveStatus === 'saving' ? 'Salvando…' : roteiroSaveStatus === 'error' ? 'Falha ao salvar' : 'Tudo salvo'}</span>{roteiroSaveStatus === 'error' && <button className="roteiro-save-retry" type="button" onClick={() => { void window.desktop.saveRoteiros(roteiros).then(() => setRoteiroSaveStatus('saved')).catch(() => setRoteiroSaveStatus('error')) }}>Tentar novamente</button>}</div><div className="roteiro-main-cards">{visibleRoteiros.map((roteiro) => {
        const roteiroCharacters = roteiro.characterIds.map((id) => characters.find((character) => character.id === id)).filter((character): character is CustomizerCharacter => Boolean(character))
        const markedForDelete = deleteSelection.includes(roteiro.id)
        const refs = [roteiro.opening?.video, ...roteiro.tiktoks.map((item) => item.video)].filter((item): item is RoteiroVideoReference => Boolean(item))
        const hasUnavailableVideo = libraryLoaded && refs.some((item) => !availableVideoIds.has(item.id))
        return <article className={`roteiro-main-card${selectedRoteiroId === roteiro.id && !deleteMode ? ' selected' : ''}${deleteMode ? ' delete-mode' : ''}${markedForDelete ? ' delete-selected' : ''}`} key={roteiro.id}>
          <div className="roteiro-main-video-strip"><span title={roteiro.videoTitle}>{roteiro.videoTitle}</span><div><button className="roteiro-card-duplicate" onClick={() => duplicateRoteiro(roteiro)} disabled={deleteMode} type="button">Duplicar</button><button onClick={() => { setEditingVideoId(roteiro.id); setEditingVideoTitle(roteiro.videoTitle); setEditingCharacterIds([...roteiro.characterIds]) }} disabled={deleteMode} aria-label={`Editar roteiro ${roteiro.title}`} title="Editar roteiro e elenco" type="button"><Icon name="edit" /></button></div></div>
          <button className="roteiro-main-thumbnail" onClick={() => { if (deleteMode) toggleRoteiroSelection(roteiro.id); else { setSelectedRoteiroId(roteiro.id); roteiroListScroll.current = roteiroListRef.current?.scrollTop ?? 0; setOpenedRoteiroId(roteiro.id) } }} aria-pressed={deleteMode ? markedForDelete : selectedRoteiroId === roteiro.id} type="button">{roteiroCharacters.length ? <span className="roteiro-character-strip" style={{ backgroundColor: roteiroThumbnailColor(roteiro.id) }} aria-label={`Personagens de ${roteiro.title}`}>{roteiroCharacters.map((character) => <span className="roteiro-character-mini" key={character.id} title={character.name}><CharacterPortrait character={character} /></span>)}</span> : <span className="roteiro-thumbnail-placeholder" style={{ backgroundColor: roteiroThumbnailColor(roteiro.id) }}><Icon name="message" /></span>}<strong title={roteiro.title}>{roteiro.title}</strong><small>{roteiro.tiktoks.length} TikTok(s) · {roteiro.characterIds.length} personagem(ns)</small>{hasUnavailableVideo && <em className="roteiro-missing-video"><Icon name="warning" /> Vídeo indisponível</em>}</button>
        </article>
      })}{visibleRoteiros.length === 0 && <div className="roteiro-library-empty"><Icon name="message" /><strong>{roteiros.length ? 'Nenhum roteiro encontrado' : 'Crie seu primeiro roteiro'}</strong><span>{roteiros.length ? 'Tente outra busca.' : 'Adicione um roteiro para organizar abertura, TikToks e reações.'}</span>{!roteiros.length && <button type="button" onClick={() => setCreateOpen(true)}>Adicionar roteiro</button>}</div>}</div></div>}
    </section>
    {createOpen && <div className="roteiro-modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setCreateOpen(false) }}><section className="roteiro-create-modal" role="dialog" aria-modal="true" aria-labelledby="roteiro-create-title"><header><div><span>NOVO ROTEIRO</span><h2 id="roteiro-create-title">Criar roteiro</h2></div><button onClick={() => setCreateOpen(false)} aria-label="Fechar" type="button">×</button></header><label className="roteiro-modal-name">Nome do roteiro<input autoFocus value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Digite o nome do roteiro" maxLength={100} /></label><div className="roteiro-modal-cast-heading"><strong>Seleção de elenco</strong><span>{newCharacterIds.length} selecionado(s)</span></div><div className="roteiro-modal-cast-list">{characters.length ? characters.map((character) => { const checked = newCharacterIds.includes(character.id); return <button className={checked ? 'selected' : ''} key={character.id} onClick={() => setNewCharacterIds((current) => checked ? current.filter((id) => id !== character.id) : [...current, character.id])} type="button"><CharacterPortrait character={character} /><span>{character.name}</span><i>{checked ? '✓' : '+'}</i></button> }) : <p>Não há personagens disponíveis no Customizador.</p>}</div><footer><button onClick={() => setCreateOpen(false)} type="button">Cancelar</button><button className="roteiro-create-confirm" onClick={createRoteiro} disabled={!newTitle.trim()} type="button"><Icon name="check" />Criar roteiro</button></footer></section></div>}
    {editingVideoId && <div className="roteiro-modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setEditingVideoId(null) }}><section className="roteiro-video-title-modal" role="dialog" aria-modal="true" aria-labelledby="roteiro-video-title-heading"><header><strong id="roteiro-video-title-heading">Editar roteiro e elenco</strong><button onClick={() => setEditingVideoId(null)} aria-label="Fechar" type="button">×</button></header><label>Título do vídeo<input autoFocus value={editingVideoTitle} onChange={(event) => setEditingVideoTitle(event.target.value)} maxLength={100} /></label><div className="roteiro-modal-cast-heading"><strong>Elenco</strong><span>{editingCharacterIds.length} selecionado(s)</span></div><div className="roteiro-modal-cast-list">{characters.length ? characters.map((character) => { const checked = editingCharacterIds.includes(character.id); return <button className={checked ? 'selected' : ''} key={character.id} onClick={() => setEditingCharacterIds((current) => checked ? current.filter((id) => id !== character.id) : [...current, character.id])} type="button"><CharacterPortrait character={character} /><span>{character.name}</span><i>{checked ? '✓' : '+'}</i></button> }) : <p>Não há personagens disponíveis no Customizador.</p>}</div><footer><button onClick={() => setEditingVideoId(null)} type="button">Cancelar</button><button className="roteiro-create-confirm" onClick={saveVideoTitle} disabled={!editingVideoTitle.trim()} type="button"><Icon name="check" />Salvar</button></footer></section></div>}
    {deleteDialogOpen && <div className="roteiro-modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) setDeleteDialogOpen(false) }}><section className="roteiro-delete-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="roteiro-delete-confirm-title"><span className="roteiro-delete-confirm-icon"><Icon name="trash" /></span><h2 id="roteiro-delete-confirm-title">Excluir {deleteSelection.length} roteiro(s)?</h2><p>O conteúdo desses roteiros será removido do armazenamento local. Os vídeos publicados na Base continuam preservados.</p><footer><button type="button" onClick={() => setDeleteDialogOpen(false)}>Cancelar</button><button type="button" className="danger" onClick={confirmDeleteRoteiros}>Excluir roteiro(s)</button></footer></section></div>}
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
              <Route path="/base-videos" element={<LazyBaseVideosPage />} />
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
