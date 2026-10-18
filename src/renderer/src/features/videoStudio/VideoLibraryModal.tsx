import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { VideoLibraryItem } from '../../../../shared/studio'
import { Icon } from '../../ui/components/Icon'

const durationLabel = (frames: number | null) => frames === null ? 'Duração pendente' : `${Math.floor(frames / 3600)}:${String(Math.floor(frames / 60) % 60).padStart(2, '0')}`
const sizeLabel = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`

async function recognizeDuration(item: VideoLibraryItem): Promise<VideoLibraryItem> {
  if (item.durationFrames !== null) return item
  const media = document.createElement('video')
  media.preload = 'metadata'
  media.muted = true
  try {
    const seconds = await new Promise<number>((resolve, reject) => {
      const timer = window.setTimeout(() => { cleanup(); reject(new Error(`Não foi possível reconhecer a duração de ${item.name}.`)) }, 30000)
      const cleanup = () => { window.clearTimeout(timer); media.onloadedmetadata = null; media.onerror = null }
      media.onloadedmetadata = () => { cleanup(); resolve(media.duration) }
      media.onerror = () => { cleanup(); reject(new Error(`Não foi possível abrir ${item.name}. Confira o formato do vídeo.`)) }
      media.src = `gacha-video://library/${item.id}`
      media.load()
    })
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds * 60 > 60 * 60 * 60 * 24) throw new Error('O vídeo deve ter uma duração válida de até 24 horas.')
    return window.desktop.finishVideoLibraryImport(item.id, Math.max(1, Math.ceil(seconds * 60)))
  } finally { media.pause(); media.removeAttribute('src'); media.load() }
}

export function VideoLibraryModal({ studioTitle, locked, onClose, onAdd }: {
  studioTitle: string
  locked: boolean
  onClose: () => void
  onAdd: (ids: string[]) => Promise<void>
}) {
  const [items, setItems] = useState<VideoLibraryItem[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const previousFocus = useRef(document.activeElement)
  const preview = items.find((item) => item.id === previewId)
  const filtered = items.filter((item) => `${item.name} ${item.studios.map((studio) => studio.title).join(' ')}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')))
  useEffect(() => {
    let cancelled = false
    void window.desktop.listVideoLibrary().then((library) => { if (!cancelled) setItems(library) }).catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a biblioteca.') }).finally(() => { if (!cancelled) setLoading(false) })
    closeRef.current?.focus()
    return () => { cancelled = true; if (previousFocus.current instanceof HTMLElement && previousFocus.current.isConnected) previousFocus.current.focus() }
  }, [])
  useEffect(() => {
    const media = previewRef.current
    return () => media?.pause()
  }, [previewId])
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!busy) onClose() }
      if (event.key === 'Tab') {
        const controls = Array.from(document.querySelectorAll<HTMLElement>('.video-library-modal button:not(:disabled), .video-library-modal input:not(:disabled), .video-library-modal video[controls]'))
        const first = controls[0], last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', keyDown, true)
    return () => window.removeEventListener('keydown', keyDown, true)
  }, [busy, onClose])
  const toggle = (item: VideoLibraryItem) => {
    previewRef.current?.pause()
    setPreviewId(item.id)
    setSelected((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])
  }
  const importVideo = async () => {
    setBusy('Importando vídeo…'); setError(null); previewRef.current?.pause()
    try {
      const imported = await window.desktop.importVideoLibrary()
      if (!imported) return
      setItems((current) => [imported, ...current]); setPreviewId(imported.id)
      const ready = await recognizeDuration(imported)
      setItems((current) => current.map((item) => item.id === ready.id ? ready : item))
      setSelected((current) => [...new Set([...current, ready.id])])
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível importar o vídeo.') }
    finally { setBusy(null) }
  }
  const remove = async (item: VideoLibraryItem) => {
    setBusy('Excluindo da biblioteca…'); setError(null)
    if (previewId === item.id) { previewRef.current?.pause(); previewRef.current?.removeAttribute('src'); previewRef.current?.load(); setPreviewId(null) }
    try {
      await window.desktop.deleteVideoLibraryItem(item.id)
      setItems((current) => current.filter((entry) => entry.id !== item.id))
      setSelected((current) => current.filter((id) => id !== item.id))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível excluir o vídeo.') }
    finally { setBusy(null) }
  }
  const add = async () => {
    if (!selected.length || locked) return
    setBusy('Adicionando ao roteiro…'); setError(null); previewRef.current?.pause()
    try {
      const resolved: VideoLibraryItem[] = []
      for (const id of selected) {
        const item = items.find((entry) => entry.id === id)
        if (!item?.available) throw new Error('Um dos vídeos selecionados está indisponível.')
        resolved.push(await recognizeDuration(item))
      }
      setItems((current) => current.map((item) => resolved.find((entry) => entry.id === item.id) ?? item))
      await onAdd(selected)
      onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível adicionar os vídeos.') }
    finally { setBusy(null) }
  }
  return createPortal(<div className="video-library-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="video-library-modal" role="dialog" aria-modal="true" aria-labelledby="video-library-title" aria-busy={loading || Boolean(busy)}>
      <header><div><h2 id="video-library-title">Biblioteca de vídeos</h2><p>Vídeos de todos os roteiros do Video Studio</p></div><button type="button" className="video-library-import" onClick={() => void importVideo()} disabled={loading || Boolean(busy)}><Icon name="plus" />Importar</button><button ref={closeRef} type="button" className="video-library-close" aria-label="Fechar biblioteca de vídeos" disabled={Boolean(busy)} onClick={onClose}>×</button></header>
      <div className="video-library-search"><Icon name="search" /><input type="search" aria-label="Buscar vídeos ou roteiros" placeholder="Buscar vídeo ou roteiro…" value={search} onChange={(event) => setSearch(event.currentTarget.value)} /><span>{items.length} vídeo{items.length === 1 ? '' : 's'}</span></div>
      {error && <p className="video-library-error" role="alert">{error}</p>}
      <div className="video-library-content">
        <div className="video-library-grid" aria-label="Vídeos disponíveis">
          {loading ? <p className="video-library-empty">Carregando biblioteca…</p> : filtered.length ? filtered.map((item) => <article className={`video-library-card${selected.includes(item.id) ? ' selected' : ''}`} key={item.id}>
            <button type="button" className="video-library-select" aria-label={`Selecionar ${item.name}`} aria-pressed={selected.includes(item.id)} disabled={Boolean(busy) || !item.available} onClick={() => toggle(item)}><span className="video-library-art" aria-hidden="true"><Icon name="camera" /><i>{selected.includes(item.id) ? '✓' : '+'}</i></span><strong title={item.name}>{item.name}</strong><small>{item.available ? `${durationLabel(item.durationFrames)} · ${sizeLabel(item.size)}` : 'Arquivo indisponível'}</small><span className="video-library-origins" title={item.studios.map((studio) => studio.title).join(', ')}>{item.studios.length ? item.studios.map((studio) => studio.title).join(', ') : 'Biblioteca'}</span></button>
            <button type="button" className="video-library-delete" aria-label={`Excluir ${item.name} da biblioteca`} disabled={Boolean(busy)} onClick={() => void remove(item)}><Icon name="trash" /></button>
          </article>) : <p className="video-library-empty">{search ? 'Nenhum vídeo encontrado.' : 'Importe um vídeo para começar.'}</p>}
        </div>
        <aside className="video-library-preview" aria-label="Prévia do vídeo selecionado">{preview?.available ? <><video key={preview.id} ref={previewRef} src={`gacha-video://library/${preview.id}`} controls preload="metadata" /><strong>{preview.name}</strong><small>{durationLabel(preview.durationFrames)} · {sizeLabel(preview.size)}</small></> : <p>Selecione um vídeo para ver a prévia.</p>}</aside>
      </div>
      <footer><div><strong>{selected.length} selecionado{selected.length === 1 ? '' : 's'}</strong><small>Excluir da biblioteca preserva os clipes já adicionados aos roteiros.</small></div><button type="button" className="video-library-add" disabled={loading || Boolean(busy) || !selected.length || locked} onClick={() => void add()} title={locked ? 'Desbloqueie a faixa de vídeo para adicionar clipes.' : `Adicionar em ${studioTitle}`}>{busy ?? (locked ? 'Faixa bloqueada' : 'Adicionar ao roteiro')}</button></footer>
    </section>
  </div>, document.body)
}
