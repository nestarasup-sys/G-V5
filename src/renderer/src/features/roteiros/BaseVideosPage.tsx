import { useEffect, useMemo, useRef, useState } from 'react'
import type { BaseVideoDetails, RoteiroTimeline } from '../../../../shared/roteiros'
import type { VideoLibraryItem } from '../../../../shared/studio'
import { Icon } from '../../ui/components/Icon'

const emptyDetails = (videoId: string): BaseVideoDetails => ({ videoId, description: '', timeline: 'unspecified' })

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
  const [loaded, setLoaded] = useState(false)
  const [activeView, setActiveView] = useState<'main' | 'drafts'>('main')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteMode, setDeleteMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [visibleCount, setVisibleCount] = useState(18)
  const pendingSaves = useRef(new Map<string, BaseVideoDetails>())
  const saveTimers = useRef(new Map<string, number>())

  useEffect(() => {
    let cancelled = false
    void Promise.all([window.desktop.listVideoLibrary(), window.desktop.listBaseVideoDetails()]).then(([library, saved]) => {
      if (cancelled) return
      const savedById = Object.fromEntries(saved.map((entry) => [entry.videoId, entry]))
      const merged = Object.fromEntries(library.map((item) => [item.id, savedById[item.id] ?? emptyDetails(item.id)]))
      setItems(library)
      setDetailsById(merged)
      setLoaded(true)
    }).catch((reason: unknown) => {
      if (!cancelled) { setError(reason instanceof Error ? reason.message : 'Não foi possível abrir a Base de vídeos.'); setLoaded(true) }
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => () => {
    for (const timer of saveTimers.current.values()) window.clearTimeout(timer)
    for (const details of pendingSaves.current.values()) void window.desktop.saveBaseVideoDetails(details).catch((reason: unknown) => console.error('Falha ao salvar dados da Base de vídeos.', reason))
    saveTimers.current.clear()
    pendingSaves.current.clear()
  }, [])

  const scheduleSave = (details: BaseVideoDetails) => {
    pendingSaves.current.set(details.videoId, details)
    const existing = saveTimers.current.get(details.videoId)
    if (existing !== undefined) window.clearTimeout(existing)
    const timer = window.setTimeout(() => {
      saveTimers.current.delete(details.videoId)
      pendingSaves.current.delete(details.videoId)
      void window.desktop.saveBaseVideoDetails(details).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Não foi possível salvar este vídeo.'))
    }, 350)
    saveTimers.current.set(details.videoId, timer)
  }

  const updateDetails = (videoId: string, patch: Partial<BaseVideoDetails>) => {
    const next = { ...(detailsById[videoId] ?? emptyDetails(videoId)), ...patch, videoId }
    scheduleSave(next)
    setDetailsById((current) => ({ ...current, [videoId]: next }))
  }

  const visibleItems = useMemo(() => items.filter((item) => {
    const details = detailsById[item.id] ?? emptyDetails(item.id)
    return activeView === 'drafts' ? details.videoNumber === undefined : details.videoNumber !== undefined
  }).sort((a, b) => {
    const numberA = detailsById[a.id]?.videoNumber
    const numberB = detailsById[b.id]?.videoNumber
    if (activeView === 'main') return (numberA ?? Number.MAX_SAFE_INTEGER) - (numberB ?? Number.MAX_SAFE_INTEGER)
    return b.createdAt.localeCompare(a.createdAt)
  }), [items, detailsById, activeView])

  useEffect(() => { setVisibleCount(18) }, [activeView])

  const addVideo = async () => {
    setBusy(true); setError(null)
    try {
      const imported = await window.desktop.importVideoLibrary()
      if (!imported) return
      const ready = await recognizeDuration(imported)
      const details = emptyDetails(ready.id)
      await window.desktop.saveBaseVideoDetails(details)
      setItems((current) => [ready, ...current.filter((item) => item.id !== ready.id)])
      setDetailsById((current) => ({ ...current, [ready.id]: details }))
      setActiveView('drafts')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível adicionar o vídeo.')
    } finally { setBusy(false) }
  }

  const sendToBase = async (videoId: string) => {
    setBusy(true); setError(null)
    try {
      const videoNumber = await window.desktop.publishBaseVideo(videoId)
      setDetailsById((current) => ({ ...current, [videoId]: { ...(current[videoId] ?? emptyDetails(videoId)), videoNumber } }))
      setActiveView('main')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível enviar o vídeo para a Base.')
    } finally { setBusy(false) }
  }

  const handleDelete = async () => {
    if (!deleteMode) { setDeleteMode(true); setSelectedIds([]); return }
    if (!selectedIds.length || busy) return
    setBusy(true); setError(null)
    const deletedIds: string[] = []
    try {
      for (const id of selectedIds) {
        const timer = saveTimers.current.get(id)
        if (timer !== undefined) window.clearTimeout(timer)
        saveTimers.current.delete(id)
        const pending = pendingSaves.current.get(id)
        if (pending) await window.desktop.saveBaseVideoDetails(pending)
        pendingSaves.current.delete(id)
        await window.desktop.deleteVideoLibraryItem(id)
        await window.desktop.deleteBaseVideoDetails(id)
        deletedIds.push(id)
      }
      setItems((current) => current.filter((item) => !deletedIds.includes(item.id)))
      setDetailsById((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !deletedIds.includes(id))))
      setDeleteMode(false); setSelectedIds([])
    } catch (reason) {
      setItems((current) => current.filter((item) => !deletedIds.includes(item.id)))
      setDetailsById((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !deletedIds.includes(id))))
      setSelectedIds((current) => current.filter((id) => !deletedIds.includes(id)))
      setError(reason instanceof Error ? reason.message : 'Não foi possível excluir os vídeos selecionados.')
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

  return <main className="base-videos-page">
    <header className="base-videos-subbar">
      <div className="base-videos-heading"><span className="base-videos-heading-icon"><Icon name="frame" /></span><div><h1>Base de vídeos</h1><small>Descrições e tempos compartilhados com os roteiros</small></div></div>
      <div className="base-videos-actions">
        <button className="base-videos-add" type="button" onClick={() => void addVideo()} disabled={busy}>{busy ? 'Importando…' : 'Adicionar'}</button>
        <button className={deleteMode ? 'base-videos-cancel-delete' : 'base-videos-delete'} type="button" onClick={() => void handleDelete()} disabled={busy || (!deleteMode && !items.length) || (deleteMode && !selectedIds.length)}>{deleteMode ? `Confirmar (${selectedIds.length})` : 'Excluir'}</button>
        {deleteMode && <button className="base-videos-cancel" type="button" disabled={busy} onClick={() => { setDeleteMode(false); setSelectedIds([]) }}>Cancelar</button>}
        <span className="base-videos-action-divider" />
        <button className={`base-videos-view${activeView === 'drafts' ? ' active' : ''}`} type="button" onClick={() => { setActiveView((view) => view === 'main' ? 'drafts' : 'main'); setDeleteMode(false); setSelectedIds([]) }}>{activeView === 'drafts' ? 'Vídeos' : 'Rascunhos'} <span>{items.filter((item) => detailsById[item.id]?.videoNumber === undefined).length}</span></button>
      </div>
    </header>
    <div className="base-videos-content">
      {error && <div className="base-videos-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)}>Fechar</button></div>}
      <div className="base-videos-view-heading"><div><h2>{activeView === 'main' ? 'Vídeos' : 'Rascunhos'}</h2><p>{activeView === 'main' ? 'Vídeos enviados para a Base, em ordem de identificação.' : 'Vídeos aguardando envio para a Base de vídeos.'}</p></div><span>{visibleItems.length} vídeo{visibleItems.length === 1 ? '' : 's'}</span></div>
      {!loaded ? <div className="base-videos-empty">Carregando vídeos…</div> : visibleItems.length ? <><div className="base-videos-grid">{visibleItems.slice(0, visibleCount).map((item) => {
        const details = detailsById[item.id] ?? emptyDetails(item.id)
        const selected = selectedIds.includes(item.id)
        return <article className={`base-video-card${deleteMode ? ' selecting' : ''}${selected ? ' selected' : ''}`} key={item.id}>
          {deleteMode && <button className="base-video-select" type="button" aria-pressed={selected} onClick={() => setSelectedIds((current) => selected ? current.filter((id) => id !== item.id) : [...current, item.id])}><span>{selected ? '✓' : ''}</span>{selected ? 'Selecionado' : 'Selecionar'}</button>}
          <header className="base-video-card-header"><div>{details.videoNumber !== undefined && <span className="base-video-number">VÍDEO {String(details.videoNumber).padStart(2, '0')}</span>}<strong title={item.name}>{item.name}</strong><small>ID {item.id.slice(0, 8).toUpperCase()} · {item.durationFrames ? `${(item.durationFrames / 60).toFixed(1)} s` : 'Duração não reconhecida'} · {(item.size / 1024 / 1024).toFixed(1)} MB</small></div>{!item.available && <span className="base-video-unavailable">Arquivo indisponível</span>}</header>
          {activeView === 'drafts' && !deleteMode && <button className="base-video-send" type="button" disabled={busy || !item.available} onClick={() => void sendToBase(item.id)}>{busy ? 'Enviando…' : 'Enviar para base de vídeos'}<span>Ao enviar, recebe um número permanente</span></button>}
          <div className="roteiro-video-preview-panel base-video-notes-panel">
            <div className="roteiro-video-stage"><video src={`gacha-video://library/${item.id}`} controls playsInline preload="none" aria-label={`Prévia de ${item.name}`} /></div>
            <label className="roteiro-video-description"><span>Descrição do que acontece no vídeo</span><textarea value={details.description} onChange={(event) => updateDetails(item.id, { description: event.target.value })} placeholder="Descreva o que acontece neste vídeo…" maxLength={20000} /></label>
            <div className="roteiro-scene-settings">
              <label className="roteiro-timeline-field"><span>Linha do tempo</span><select value={details.timeline} onChange={(event) => updateDetails(item.id, { timeline: event.target.value as RoteiroTimeline })}><option value="unspecified">Indefinido</option><option value="past">Passado</option><option value="present">Presente</option><option value="future">Futuro</option></select></label>
              <label className="roteiro-scene-end-field"><span>Fim da cena da descrição</span><div className="roteiro-timing-input"><input aria-label={`Fim da descrição de ${item.name} em segundos`} type="number" min="0" max="86400" step="0.01" value={details.sceneEndSeconds ?? ''} onChange={(event) => updateSeconds(item.id, 'sceneEndSeconds', event.target.value)} placeholder="0" /><small>segundos</small></div></label>
              <section className="roteiro-group-reaction first"><header><strong>Primeira reação em grupo</strong><span>REAÇÃO 1</span></header><div className="roteiro-timing-input"><input aria-label={`Primeira reação de ${item.name} em segundos`} type="number" min="0" max="86400" step="0.01" value={details.firstGroupReactionSeconds ?? ''} onChange={(event) => updateSeconds(item.id, 'firstGroupReactionSeconds', event.target.value)} placeholder="0" /><button type="button" onClick={(event) => captureTime(item.id, 'firstGroupReactionSeconds', event.currentTarget.closest('.base-video-card')?.querySelector('video') ?? null)}>Tempo real</button><small>segundos</small></div></section>
              <section className="roteiro-group-reaction second"><header><strong>Segunda reação em grupo</strong><span>REAÇÃO 2</span></header><div className="roteiro-timing-input"><input aria-label={`Segunda reação de ${item.name} em segundos`} type="number" min="0" max="86400" step="0.01" value={details.secondGroupReactionSeconds ?? ''} onChange={(event) => updateSeconds(item.id, 'secondGroupReactionSeconds', event.target.value)} placeholder="0" /><button type="button" onClick={(event) => captureTime(item.id, 'secondGroupReactionSeconds', event.currentTarget.closest('.base-video-card')?.querySelector('video') ?? null)}>Tempo real</button><small>segundos</small></div></section>
            </div>
          </div>
        </article>
      })}</div>{visibleItems.length > visibleCount && <button className="base-videos-load-more" type="button" onClick={() => setVisibleCount((current) => current + 18)}>Carregar mais vídeos ({visibleItems.length - visibleCount} restantes)</button>}</> : <div className="base-videos-empty"><span className="base-videos-empty-icon"><Icon name={activeView === 'main' ? 'frame' : 'edit'} /></span><strong>{activeView === 'main' ? 'A Base de vídeos está vazia' : 'Nenhum rascunho'}</strong><span>{activeView === 'main' ? 'Envie vídeos a partir da área Rascunhos para gerar a numeração permanente.' : 'Adicione um vídeo para começar a organizar os rascunhos.'}</span></div>}
    </div>
  </main>
}
