import { useEffect, useMemo, useRef, useState } from 'react'
import type { BaseVideoCategory, BaseVideoDetails, RoteiroTimeline } from '../../../../shared/roteiros'
import type { VideoLibraryItem } from '../../../../shared/studio'
import { Icon } from '../../ui/components/Icon'

const emptyDetails = (videoId: string): BaseVideoDetails => ({ videoId, categoryId: null, description: '', additionalContext: '', timeline: 'unspecified' })
const formatDuration = (frames: number | null) => {
  if (frames === null) return 'Duração não reconhecida'
  const seconds = Math.floor(frames / 60)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

async function recognizeDuration(item: VideoLibraryItem): Promise<VideoLibraryItem> {
  if (item.durationFrames !== null) return item
  const media = document.createElement('video')
  media.preload = 'metadata'
  media.muted = true
  try {
    const seconds = await new Promise<number>((resolve, reject) => {
      const timer = window.setTimeout(() => { cleanup(); reject(new Error(`Não foi possível reconhecer a duração de “${item.name}”.`)) }, 30000)
      const cleanup = () => { window.clearTimeout(timer); media.onloadedmetadata = null; media.onerror = null }
      media.onloadedmetadata = () => { cleanup(); resolve(media.duration) }
      media.onerror = () => { cleanup(); reject(new Error(`Não foi possível ler “${item.name}”.`)) }
      media.src = `gacha-video://library/${item.id}`
      media.load()
    })
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 60 * 60 * 24) throw new Error(`A duração de “${item.name}” não é válida.`)
    return await window.desktop.finishVideoLibraryImport(item.id, Math.max(1, Math.ceil(seconds * 60)))
  } finally {
    media.pause()
    media.removeAttribute('src')
    media.load()
  }
}

export function BaseVideosPage() {
  const [items, setItems] = useState<VideoLibraryItem[]>([])
  const [detailsById, setDetailsById] = useState<Record<string, BaseVideoDetails>>({})
  const [categories, setCategories] = useState<BaseVideoCategory[]>([])
  const [loaded, setLoaded] = useState(false)
  const [activeView, setActiveView] = useState<'main' | 'drafts'>('main')
  const [busy, setBusy] = useState(false)
  const [publishErrors, setPublishErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [deleteMode, setDeleteMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [visibleCount, setVisibleCount] = useState(18)
  const [search, setSearch] = useState('')
  const [timelineFilter, setTimelineFilter] = useState('all')
  const [sort, setSort] = useState<'order' | 'name' | 'duration' | 'newest'>('order')
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<VideoLibraryItem | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [categoryVideoId, setCategoryVideoId] = useState<string | null>(null)
  const [categoryName, setCategoryName] = useState('')
  const [categoryEditingId, setCategoryEditingId] = useState<string | null>(null)
  const [categoryEditValue, setCategoryEditValue] = useState('')
  const [categoryError, setCategoryError] = useState<string | null>(null)
  const [saveStatusById, setSaveStatusById] = useState<Record<string, 'saving' | 'saved' | 'error'>>({})
  const pendingSaves = useRef(new Map<string, BaseVideoDetails>())
  const saveTimers = useRef(new Map<string, number>())
  const inFlightSaves = useRef(new Map<string, Promise<void>>())
  const recognizingDurations = useRef(new Set<string>())

  useEffect(() => {
    let cancelled = false
    void Promise.all([window.desktop.listVideoLibrary(), window.desktop.listBaseVideoDetails(), window.desktop.listBaseVideoCategories()]).then(([library, saved, loadedCategories]) => {
      if (cancelled) return
      const savedById = Object.fromEntries(saved.map((entry) => [entry.videoId, entry]))
      const merged = Object.fromEntries(library.map((item) => [item.id, savedById[item.id] ?? emptyDetails(item.id)]))
      setItems(library)
      setDetailsById(merged)
      setCategories(loadedCategories)
      setLoaded(true)
    }).catch((reason: unknown) => {
      if (!cancelled) { setLoadError(reason instanceof Error ? reason.message : 'Não foi possível abrir a Base de vídeos.'); setLoaded(true) }
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => () => {
    for (const timer of saveTimers.current.values()) window.clearTimeout(timer)
    for (const videoId of pendingSaves.current.keys()) void persistPendingSave(videoId, false).catch((reason: unknown) => console.error('Falha ao salvar dados da Base de vídeos.', reason))
    saveTimers.current.clear()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (deleteConfirmOpen) { setDeleteConfirmOpen(false); return }
      if (renameTarget) { setRenameTarget(null); return }
      if (categoryVideoId) { setCategoryVideoId(null); setCategoryError(null); return }
      if (deleteMode) { setDeleteMode(false); setSelectedIds([]) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [deleteConfirmOpen, renameTarget, categoryVideoId, deleteMode])

  const persistPendingSave = async (videoId: string, updateUi = true) => {
    while (true) {
      const inFlight = inFlightSaves.current.get(videoId)
      if (inFlight) { await inFlight; continue }
      const details = pendingSaves.current.get(videoId)
      if (!details) return
      if (updateUi) setSaveStatusById((current) => ({ ...current, [videoId]: 'saving' }))
      const request = window.desktop.saveBaseVideoDetails(details).catch((reason: unknown) => {
        if (updateUi) { setSaveStatusById((current) => ({ ...current, [videoId]: 'error' })); setError(reason instanceof Error ? reason.message : 'Não foi possível salvar este vídeo.') }
        throw reason
      })
      inFlightSaves.current.set(videoId, request)
      try {
        await request
        if (pendingSaves.current.get(videoId) === details) {
          pendingSaves.current.delete(videoId)
          if (updateUi) setSaveStatusById((current) => ({ ...current, [videoId]: 'saved' }))
        }
      } finally {
        if (inFlightSaves.current.get(videoId) === request) inFlightSaves.current.delete(videoId)
      }
    }
  }

  const scheduleSave = (details: BaseVideoDetails) => {
    setSaveStatusById((current) => ({ ...current, [details.videoId]: 'saving' }))
    pendingSaves.current.set(details.videoId, details)
    const existing = saveTimers.current.get(details.videoId)
    if (existing !== undefined) window.clearTimeout(existing)
    const timer = window.setTimeout(() => {
      saveTimers.current.delete(details.videoId)
      setSaveStatusById((current) => ({ ...current, [details.videoId]: 'saving' }))
      void persistPendingSave(details.videoId).catch(() => undefined)
    }, 350)
    saveTimers.current.set(details.videoId, timer)
  }

  const updateDetails = (videoId: string, patch: Partial<BaseVideoDetails>) => {
    const next = { ...(detailsById[videoId] ?? emptyDetails(videoId)), ...patch, videoId }
    scheduleSave(next)
    setDetailsById((current) => ({ ...current, [videoId]: next }))
  }

  const createCategory = async () => {
    if (!categoryVideoId || !categoryName.trim() || busy) return
    setBusy(true); setCategoryError(null)
    try {
      const category = await window.desktop.createBaseVideoCategory(categoryName)
      setCategories((current) => [...current, category].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')))
      updateDetails(categoryVideoId, { categoryId: category.id })
      setCategoryName('')
    } catch (reason) { setCategoryError(reason instanceof Error ? reason.message : 'Não foi possível criar a categoria.') }
    finally { setBusy(false) }
  }

  const renameCategory = async (id: string) => {
    if (!categoryEditValue.trim() || busy) return
    setBusy(true); setCategoryError(null)
    try {
      const renamed = await window.desktop.renameBaseVideoCategory(id, categoryEditValue)
      setCategories((current) => current.map((category) => category.id === id ? renamed : category).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')))
      setCategoryEditingId(null)
    } catch (reason) { setCategoryError(reason instanceof Error ? reason.message : 'Não foi possível renomear a categoria.') }
    finally { setBusy(false) }
  }

  const deleteCategory = async (category: BaseVideoCategory) => {
    if (busy) return
    setBusy(true); setCategoryError(null)
    try {
      for (const [videoId, details] of Object.entries(detailsById)) if (details.categoryId === category.id) await flushPendingSave(videoId)
      await window.desktop.deleteBaseVideoCategory(category.id)
      setCategories((current) => current.filter((entry) => entry.id !== category.id))
      for (const [videoId, details] of Object.entries(detailsById)) if (details.categoryId === category.id) updateDetails(videoId, { categoryId: null })
      if (categoryEditingId === category.id) setCategoryEditingId(null)
    } catch (reason) { setCategoryError(reason instanceof Error ? reason.message : 'Não foi possível excluir a categoria.') }
    finally { setBusy(false) }
  }

  const flushPendingSave = async (videoId: string) => {
    const timer = saveTimers.current.get(videoId)
    if (timer !== undefined) window.clearTimeout(timer)
    saveTimers.current.delete(videoId)
    await persistPendingSave(videoId)
  }

  const visibleItems = useMemo(() => items.filter((item) => {
    const details = detailsById[item.id] ?? emptyDetails(item.id)
    const query = search.trim().toLocaleLowerCase('pt-BR')
    const matchesQuery = !query || item.name.toLocaleLowerCase('pt-BR').includes(query) || item.id.toLocaleLowerCase('pt-BR').includes(query) || String(details.videoNumber ?? '').includes(query) || details.description.toLocaleLowerCase('pt-BR').includes(query) || (details.additionalContext ?? '').toLocaleLowerCase('pt-BR').includes(query)
    return matchesQuery && (timelineFilter === 'all' || details.timeline === timelineFilter) && (activeView === 'drafts' ? details.videoNumber === undefined : details.videoNumber !== undefined)
  }).sort((a, b) => {
    const numberA = detailsById[a.id]?.videoNumber
    const numberB = detailsById[b.id]?.videoNumber
    if (sort === 'name') return a.name.localeCompare(b.name, 'pt-BR')
    if (sort === 'duration') return (a.durationFrames ?? 0) - (b.durationFrames ?? 0)
    if (sort === 'newest') return b.createdAt.localeCompare(a.createdAt)
    if (activeView === 'main') return (numberA ?? Number.MAX_SAFE_INTEGER) - (numberB ?? Number.MAX_SAFE_INTEGER)
    return b.createdAt.localeCompare(a.createdAt)
  }), [items, detailsById, activeView, search, timelineFilter, sort])

  useEffect(() => { setVisibleCount(18) }, [activeView])

  const addVideo = async () => {
    setBusy(true); setError(null)
    let imported: VideoLibraryItem | null = null
    try {
      const importedItem = await window.desktop.importVideoLibrary()
      if (!importedItem) return
      imported = importedItem
      const details = emptyDetails(importedItem.id)
      await window.desktop.saveBaseVideoDetails(details)
      setItems((current) => [importedItem, ...current.filter((item) => item.id !== importedItem.id)])
      setDetailsById((current) => ({ ...current, [importedItem.id]: details }))
      setActiveView('drafts')
      try {
        const ready = await recognizeDuration(importedItem)
        setItems((current) => current.map((item) => item.id === ready.id ? ready : item))
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'O vídeo foi importado como rascunho, mas não foi possível reconhecer sua duração.')
      }
    } catch (reason) {
      if (imported) await window.desktop.deleteBaseVideo(imported.id).catch((cleanupReason: unknown) => console.error('Falha ao limpar a importação incompleta do vídeo.', cleanupReason))
      setError(reason instanceof Error ? reason.message : 'Não foi possível adicionar o vídeo.')
    } finally { setBusy(false) }
  }

  const sendToBase = async (videoId: string) => {
    setBusy(true); setError(null)
    setPublishErrors((current) => ({ ...current, [videoId]: '' }))
    try {
      await flushPendingSave(videoId)
      const videoNumber = await window.desktop.publishBaseVideo(videoId)
      setDetailsById((current) => ({ ...current, [videoId]: { ...(current[videoId] ?? emptyDetails(videoId)), videoNumber } }))
      setActiveView('main')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Não foi possível enviar o vídeo para a Base.'
      setPublishErrors((current) => ({ ...current, [videoId]: message }))
    } finally { setBusy(false) }
  }

  const handleDelete = async () => {
    if (!deleteMode) { setDeleteMode(true); setSelectedIds([]); return }
    if (!selectedIds.length || busy) return
    setDeleteConfirmOpen(true)
  }

  const confirmDelete = async () => {
    if (!selectedIds.length || busy) return
    setBusy(true); setError(null)
    const deletedIds: string[] = []
    try {
      for (const id of selectedIds) {
        await flushPendingSave(id)
        await window.desktop.deleteBaseVideo(id)
        deletedIds.push(id)
      }
      setItems((current) => current.filter((item) => !deletedIds.includes(item.id)))
      setDetailsById((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !deletedIds.includes(id))))
      setDeleteMode(false); setSelectedIds([]); setDeleteConfirmOpen(false)
    } catch (reason) {
      setItems((current) => current.filter((item) => !deletedIds.includes(item.id)))
      setDetailsById((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !deletedIds.includes(id))))
      setSelectedIds((current) => current.filter((id) => !deletedIds.includes(id)))
      setError(reason instanceof Error ? reason.message : 'Não foi possível excluir os vídeos selecionados.')
    } finally { setBusy(false) }
  }

  const renameVideo = async () => {
    if (!renameTarget || !renameValue.trim() || busy) return
    setBusy(true); setError(null)
    try {
      const renamed = await window.desktop.renameVideoLibraryItem(renameTarget.id, renameValue)
      setItems((current) => current.map((item) => item.id === renamed.id ? { ...item, name: renamed.name } : item))
      setRenameTarget(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível renomear o vídeo.')
    } finally { setBusy(false) }
  }

  const updateSeconds = (videoId: string, field: 'sceneEndSeconds' | 'firstGroupReactionSeconds' | 'secondGroupReactionSeconds', value: string) => {
    const seconds = value === '' ? undefined : Number(value)
    if (seconds !== undefined && (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400)) return
    updateDetails(videoId, { [field]: seconds })
  }

  const captureTime = (videoId: string, field: 'firstGroupReactionSeconds' | 'secondGroupReactionSeconds', element: HTMLVideoElement | null) => {
    const time = element?.currentTime
    if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) { setError('Não foi possível capturar o tempo da prévia.'); return }
    updateDetails(videoId, { [field]: Number(time.toFixed(2)) })
  }

  const recognizeCardDuration = (item: VideoLibraryItem, element: HTMLVideoElement) => {
    if (item.durationFrames !== null || recognizingDurations.current.has(item.id)) return
    const seconds = element.duration
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 60 * 60 * 24) {
      setPublishErrors((current) => ({ ...current, [item.id]: 'Não foi possível reconhecer a duração. Confira se o arquivo está íntegro e usa um formato compatível.' }))
      return
    }
    recognizingDurations.current.add(item.id)
    void window.desktop.finishVideoLibraryImport(item.id, Math.max(1, Math.ceil(seconds * 60))).then((ready) => {
      setItems((current) => current.map((candidate) => candidate.id === item.id ? ready : candidate))
      setPublishErrors((current) => ({ ...current, [item.id]: '' }))
    }).catch((reason) => setPublishErrors((current) => ({ ...current, [item.id]: reason instanceof Error ? reason.message : 'Não foi possível salvar a duração do vídeo.' }))).finally(() => recognizingDurations.current.delete(item.id))
  }

  const retryLoad = async () => {
    if (busy) return
    setBusy(true); setLoaded(false); setLoadError(null)
    try {
      const [library, saved, loadedCategories] = await Promise.all([window.desktop.listVideoLibrary(), window.desktop.listBaseVideoDetails(), window.desktop.listBaseVideoCategories()])
      const savedById = Object.fromEntries(saved.map((entry) => [entry.videoId, entry]))
      setItems(library)
      setDetailsById(Object.fromEntries(library.map((item) => [item.id, savedById[item.id] ?? emptyDetails(item.id)])))
      setCategories(loadedCategories)
    } catch (reason) { setLoadError(reason instanceof Error ? reason.message : 'Não foi possível abrir a Base de vídeos.') }
    finally { setLoaded(true); setBusy(false) }
  }

  return <main className="base-videos-page">
    <header className="base-videos-subbar">
      <div className="base-videos-heading"><span className="base-videos-heading-icon"><Icon name="frame" /></span><div><h1>Base de vídeos</h1><small>Descrições e tempos compartilhados com os roteiros</small></div></div>
      <div className="base-videos-actions">
        <button className="base-videos-add" type="button" onClick={() => void addVideo()} disabled={busy || !loaded || Boolean(loadError)}>{busy ? 'Importando…' : 'Adicionar'}</button>
        <button className={deleteMode ? 'base-videos-cancel-delete' : 'base-videos-delete'} type="button" onClick={() => void handleDelete()} disabled={!loaded || Boolean(loadError) || busy || (!deleteMode && !items.length) || (deleteMode && !selectedIds.length)}>{deleteMode ? `Confirmar (${selectedIds.length})` : 'Excluir'}</button>
        {deleteMode && <button className="base-videos-cancel" type="button" disabled={busy || !loaded} onClick={() => { setDeleteMode(false); setSelectedIds([]) }}>Cancelar</button>}
        <span className="base-videos-action-divider" />
        <button className={`base-videos-view${activeView === 'drafts' ? ' active' : ''}`} type="button" disabled={!loaded} onClick={() => { setActiveView((view) => view === 'main' ? 'drafts' : 'main'); setDeleteMode(false); setSelectedIds([]) }}>{activeView === 'drafts' ? 'Vídeos' : 'Rascunhos'} <span>{items.filter((item) => detailsById[item.id]?.videoNumber === undefined).length}</span></button>
      </div>
    </header>
    <div className="base-videos-content">
      {error && <div className="base-videos-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)}>Fechar</button></div>}
      <div className="base-videos-filters"><label className="base-videos-search"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, ID, número ou descrição" /></label><label><span>Linha do tempo</span><select value={timelineFilter} onChange={(event) => setTimelineFilter(event.target.value)}><option value="all">Todas</option><option value="past">Passado</option><option value="present">Presente</option><option value="future">Futuro</option><option value="unspecified">Indefinido</option></select></label><label><span>Ordenar</span><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="order">Ordem padrão</option><option value="name">Nome</option><option value="duration">Duração</option><option value="newest">Mais recente</option></select></label>{deleteMode && <strong className="base-videos-selection-count">{selectedIds.length} selecionado(s)</strong>}</div>
      <div className="base-videos-view-heading"><div><h2>{activeView === 'main' ? 'Vídeos' : 'Rascunhos'}</h2><p>{activeView === 'main' ? 'Vídeos enviados para a Base, em ordem de identificação.' : 'Vídeos aguardando envio para a Base de vídeos.'}</p></div><span>{visibleItems.length} vídeo{visibleItems.length === 1 ? '' : 's'}</span></div>
      {!loaded ? <div className="base-videos-grid base-videos-skeleton-grid" aria-label="Carregando vídeos">{Array.from({ length: 6 }, (_, index) => <div className="base-videos-skeleton-card" key={index}><i /><b /><span /><span /></div>)}</div> : loadError ? <div className="base-videos-empty"><span className="base-videos-empty-icon"><Icon name="warning" /></span><strong>Não foi possível carregar a Base de vídeos</strong><span>{loadError}</span><button type="button" disabled={busy} onClick={() => void retryLoad()}>{busy ? 'Carregando…' : 'Tentar novamente'}</button></div> : visibleItems.length ? <><div className="base-videos-grid">{visibleItems.slice(0, visibleCount).map((item) => {
        const details = detailsById[item.id] ?? emptyDetails(item.id)
        const selected = selectedIds.includes(item.id)
        const currentCategory = categories.find((category) => category.id === details.categoryId)
        return <article className={`base-video-card${deleteMode ? ' selecting' : ''}${selected ? ' selected' : ''}`} key={item.id}>
          {deleteMode && <button className="base-video-select" type="button" aria-pressed={selected} onClick={() => setSelectedIds((current) => selected ? current.filter((id) => id !== item.id) : [...current, item.id])}><span>{selected ? '✓' : ''}</span>{selected ? 'Selecionado' : 'Selecionar'}</button>}
          <div className="roteiro-video-preview-panel base-video-notes-panel">
            <header className="base-video-card-heading"><div><strong title={item.name}>{item.name}</strong><small>{details.videoNumber === undefined ? 'RASCUNHO' : `VÍDEO ${String(details.videoNumber).padStart(2, '0')}`} · {formatDuration(item.durationFrames)} · {(item.size / 1024 ** 2).toFixed(1)} MB</small></div><button type="button" disabled={busy} onClick={() => { setRenameTarget(item); setRenameValue(item.name) }} aria-label={`Renomear ${item.name}`} title="Renomear vídeo"><Icon name="edit" /></button></header>
            <div className="roteiro-video-stage"><video src={`gacha-video://library/${item.id}`} controls playsInline preload="metadata" onLoadedMetadata={(event) => recognizeCardDuration(item, event.currentTarget)} aria-label={`Prévia de ${item.name}`} />{details.videoNumber !== undefined && <span className="base-video-number" title={`ID ${item.id}`}>VÍDEO {String(details.videoNumber).padStart(2, '0')}</span>}<span className="base-video-duration-overlay">{formatDuration(item.durationFrames)}</span></div>
            {item.durationFrames === null && <p className="base-video-duration-warning" role="status"><Icon name="warning" /> Duração não reconhecida; carregue a prévia para tentar identificá-la automaticamente.</p>}
            <div className="base-video-category-row"><span className={`base-video-category-current${saveStatusById[item.id] === 'error' ? ' save-error' : ''}`} role="status">{saveStatusById[item.id] === 'saving' ? 'Salvando alterações…' : saveStatusById[item.id] === 'error' ? 'Erro ao salvar' : <><span className="base-video-category-dot" style={{ backgroundColor: currentCategory?.color ?? '#b6aebd' }} />{currentCategory?.name ?? 'Sem categoria'}</>}</span><div className="base-video-category-row-actions">{saveStatusById[item.id] === 'error' && pendingSaves.current.has(item.id) && <button className="base-video-save-retry" type="button" onClick={() => void persistPendingSave(item.id).catch(() => undefined)}>Tentar salvar</button>}<button className="base-video-category-button" type="button" disabled={busy} onClick={() => { setCategoryVideoId(item.id); setCategoryName(''); setCategoryEditingId(null); setCategoryError(null) }}>Categoria</button></div></div>
            <label className="roteiro-video-description"><span>Descrição do que acontece no vídeo</span><textarea value={details.description} disabled={busy} onChange={(event) => updateDetails(item.id, { description: event.target.value })} placeholder="Descreva o que acontece neste vídeo…" maxLength={20000} /></label>
            <div className="roteiro-scene-settings">
              <label className="roteiro-timeline-field"><span>Linha do tempo</span><select disabled={busy} value={details.timeline} onChange={(event) => updateDetails(item.id, { timeline: event.target.value as RoteiroTimeline })}><option value="unspecified">Indefinido</option><option value="past">Passado</option><option value="present">Presente</option><option value="future">Futuro</option></select></label>
              <label className="roteiro-scene-end-field"><span>Fim da cena da descrição</span><div className="roteiro-timing-input"><input disabled={busy} aria-label={`Fim da descrição de ${item.name} em segundos`} type="number" min="0" max="86400" step="0.01" value={details.sceneEndSeconds ?? ''} onChange={(event) => updateSeconds(item.id, 'sceneEndSeconds', event.target.value)} placeholder="0" /><small>segundos</small></div></label>
              <section className="roteiro-group-reaction first"><header><strong>Primeira reação em grupo</strong><span>REAÇÃO 1</span></header><div className="roteiro-timing-input"><input disabled={busy} aria-label={`Primeira reação de ${item.name} em segundos`} type="number" min="0" max="86400" step="0.01" value={details.firstGroupReactionSeconds ?? ''} onChange={(event) => updateSeconds(item.id, 'firstGroupReactionSeconds', event.target.value)} placeholder="0" /><button disabled={busy} type="button" onClick={(event) => captureTime(item.id, 'firstGroupReactionSeconds', event.currentTarget.closest('.base-video-card')?.querySelector('video') ?? null)}>Tempo real</button><small>segundos</small></div></section>
              <section className="roteiro-group-reaction second"><header><strong>Segunda reação em grupo</strong><span>REAÇÃO 2</span></header><div className="roteiro-timing-input"><input disabled={busy} aria-label={`Segunda reação de ${item.name} em segundos`} type="number" min="0" max="86400" step="0.01" value={details.secondGroupReactionSeconds ?? ''} onChange={(event) => updateSeconds(item.id, 'secondGroupReactionSeconds', event.target.value)} placeholder="0" /><button disabled={busy} type="button" onClick={(event) => captureTime(item.id, 'secondGroupReactionSeconds', event.currentTarget.closest('.base-video-card')?.querySelector('video') ?? null)}>Tempo real</button><small>segundos</small></div></section>
            </div>
            <label className="roteiro-additional-context"><span>Contexto adicional para IA</span><textarea value={details.additionalContext ?? ''} disabled={busy} onChange={(event) => updateDetails(item.id, { additionalContext: event.target.value })} placeholder="Adicione informações, regras ou detalhes que a IA deve considerar…" maxLength={20000} /></label>
            {activeView === 'drafts' && !deleteMode && <><button className="base-video-send" type="button" disabled={busy} onClick={() => void sendToBase(item.id)}>{busy ? 'Enviando…' : 'Enviar para base de vídeos'}</button>{publishErrors[item.id] && <p className="base-video-publish-error" role="alert">{publishErrors[item.id]}</p>}</>}
          </div>
        </article>
      })}</div>{visibleItems.length > visibleCount && <button className="base-videos-load-more" type="button" onClick={() => setVisibleCount((current) => current + 18)}>Carregar mais vídeos ({visibleItems.length - visibleCount} restantes)</button>}</> : <div className="base-videos-empty"><span className="base-videos-empty-icon"><Icon name={activeView === 'main' ? 'frame' : 'edit'} /></span><strong>{items.length === 0 ? activeView === 'main' ? 'A Base de vídeos está vazia' : 'Nenhum rascunho' : 'Nenhum vídeo encontrado'}</strong><span>{items.length === 0 ? activeView === 'main' ? 'Envie vídeos a partir da área Rascunhos para gerar a numeração permanente.' : 'Adicione um vídeo para começar a organizar os rascunhos.' : 'Tente outro termo ou remova filtros para ver mais resultados.'}</span></div>}
    </div>
    {deleteConfirmOpen && <div className="roteiro-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDeleteConfirmOpen(false) }}><section className="base-video-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="base-video-confirm-title"><span className="base-video-confirm-icon"><Icon name="trash" /></span><h2 id="base-video-confirm-title">Excluir {selectedIds.length} vídeo(s)?</h2><p>Os arquivos selecionados e seus dados da Base serão removidos. Vídeos ainda usados em roteiros não poderão ser excluídos.</p><footer><button type="button" disabled={busy} onClick={() => setDeleteConfirmOpen(false)}>Cancelar</button><button className="danger" type="button" disabled={busy} onClick={() => void confirmDelete()}>{busy ? 'Excluindo…' : `Excluir ${selectedIds.length} vídeo(s)`}</button></footer></section></div>}
    {renameTarget && <div className="roteiro-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setRenameTarget(null) }}><section className="base-video-confirm-modal rename" role="dialog" aria-modal="true" aria-labelledby="base-video-rename-title"><h2 id="base-video-rename-title">Renomear vídeo</h2><p>Isso altera apenas o nome mostrado no app; o arquivo original permanece intacto.</p><label>Novo nome<input autoFocus maxLength={255} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void renameVideo() }} /></label><footer><button type="button" disabled={busy} onClick={() => setRenameTarget(null)}>Cancelar</button><button className="primary" type="button" disabled={busy || !renameValue.trim()} onClick={() => void renameVideo()}>{busy ? 'Salvando…' : 'Salvar nome'}</button></footer></section></div>}
    {categoryVideoId && <div className="roteiro-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) { setCategoryVideoId(null); setCategoryError(null) } }}><section className="base-video-category-modal" role="dialog" aria-modal="true" aria-labelledby="base-video-category-title"><header><div><span className="base-video-category-modal-icon"><Icon name="frame" /></span><div><h2 id="base-video-category-title">Categoria do vídeo</h2><p>{items.find((item) => item.id === categoryVideoId)?.name ?? 'Organize este vídeo em uma categoria.'}</p></div></div><button type="button" aria-label="Fechar" disabled={busy} onClick={() => { setCategoryVideoId(null); setCategoryError(null) }}>×</button></header><div className="base-video-category-create"><label htmlFor="base-video-category-name">Nova categoria</label><div><input id="base-video-category-name" autoFocus maxLength={60} value={categoryName} placeholder="Ex.: Reações, Aberturas, Humor" onChange={(event) => setCategoryName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createCategory() }} /><button type="button" disabled={busy || !categoryName.trim()} onClick={() => void createCategory()}>{busy ? 'Salvando…' : 'Criar'}</button></div><small>Cada categoria recebe uma cor exclusiva e o vídeo recebe automaticamente a categoria criada.</small></div>{categoryError && <p className="base-video-category-error" role="alert">{categoryError}</p>}<div className="base-video-category-list"><button className={`base-video-category-option${!detailsById[categoryVideoId]?.categoryId ? ' active' : ''}`} type="button" disabled={busy} onClick={() => updateDetails(categoryVideoId, { categoryId: null })}><span><i className="uncategorized" />Sem categoria</span>{!detailsById[categoryVideoId]?.categoryId && <b>Selecionada</b>}</button>{categories.map((category) => <div className={`base-video-category-option${detailsById[categoryVideoId]?.categoryId === category.id ? ' active' : ''}`} key={category.id} style={{ borderLeftColor: category.color }}><div className="base-video-category-option-main">{categoryEditingId === category.id ? <div className="base-video-category-rename"><input autoFocus maxLength={60} value={categoryEditValue} onChange={(event) => setCategoryEditValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void renameCategory(category.id); if (event.key === 'Escape') setCategoryEditingId(null) }} /><button type="button" disabled={busy || !categoryEditValue.trim()} onClick={() => void renameCategory(category.id)}>Salvar</button><button type="button" disabled={busy} onClick={() => setCategoryEditingId(null)}>Cancelar</button></div> : <><button className="base-video-category-assign" type="button" disabled={busy} onClick={() => updateDetails(categoryVideoId, { categoryId: category.id })}><span><i style={{ backgroundColor: category.color }} />{category.name}</span>{detailsById[categoryVideoId]?.categoryId === category.id && <b>Selecionada</b>}</button><div className="base-video-category-tools"><button type="button" title="Renomear categoria" aria-label={`Renomear ${category.name}`} disabled={busy} onClick={() => { setCategoryEditingId(category.id); setCategoryEditValue(category.name) }}><Icon name="edit" /></button><button className="danger" type="button" title="Excluir categoria" aria-label={`Excluir ${category.name}`} disabled={busy} onClick={() => void deleteCategory(category)}><Icon name="trash" /></button></div></>}</div></div>)}</div><footer><span>{categories.length} categoria{categories.length === 1 ? '' : 's'}</span><button type="button" disabled={busy} onClick={() => { setCategoryVideoId(null); setCategoryError(null) }}>Concluir</button></footer></section></div>}
  </main>
}
