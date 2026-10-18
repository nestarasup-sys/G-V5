import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { VideoBackgroundLibraryItem } from '../../../../shared/studio'
import { Icon } from '../../ui/components/Icon'

const sizeLabel = (bytes: number) => bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

export function BackgroundLibraryModal({ studioTitle, onClose, onUse }: {
  studioTitle: string
  onClose: () => void
  onUse: (id: string) => Promise<void>
}) {
  const [items, setItems] = useState<VideoBackgroundLibraryItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const previousFocus = useRef(document.activeElement)
  const selected = items.find((item) => item.id === selectedId)
  const filtered = items.filter((item) => `${item.name} ${item.studios.map((studio) => studio.title).join(' ')}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')))

  useEffect(() => {
    let cancelled = false
    void window.desktop.listVideoBackgroundLibrary().then((library) => { if (!cancelled) setItems(library) })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a biblioteca de fundos.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    closeRef.current?.focus()
    return () => { cancelled = true; if (previousFocus.current instanceof HTMLElement && previousFocus.current.isConnected) previousFocus.current.focus() }
  }, [])

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!busy) onClose() }
      if (event.key === 'Tab') {
        const controls = Array.from(document.querySelectorAll<HTMLElement>('.video-background-library-modal button:not(:disabled), .video-background-library-modal input:not(:disabled)'))
        const first = controls[0], last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', keyDown, true)
    return () => window.removeEventListener('keydown', keyDown, true)
  }, [busy, onClose])

  const importBackground = async () => {
    setBusy('Importando fundo…'); setError(null)
    try {
      const item = await window.desktop.importVideoBackground()
      if (item) { setItems((current) => [item, ...current]); setSelectedId(item.id) }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível importar o fundo.') }
    finally { setBusy(null) }
  }
  const remove = async (item: VideoBackgroundLibraryItem) => {
    setBusy('Excluindo da biblioteca…'); setError(null)
    try {
      await window.desktop.deleteVideoBackground(item.id)
      setItems((current) => current.filter((entry) => entry.id !== item.id))
      setSelectedId((current) => current === item.id ? null : current)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível excluir o fundo.') }
    finally { setBusy(null) }
  }
  const useBackground = async () => {
    if (!selected?.available) return
    setBusy('Adicionando ao roteiro…'); setError(null)
    try { await onUse(selected.id); onClose() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível adicionar o fundo ao roteiro.') }
    finally { setBusy(null) }
  }

  return createPortal(<div className="video-library-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="video-library-modal video-background-library-modal" role="dialog" aria-modal="true" aria-labelledby="video-background-library-title" aria-busy={loading || Boolean(busy)}>
      <header><div><h2 id="video-background-library-title">Biblioteca de fundos</h2><p>Fundos compartilhados entre os roteiros do Video Studio</p></div><button type="button" className="video-library-import" onClick={() => void importBackground()} disabled={loading || Boolean(busy)}><Icon name="plus" />Importar</button><button ref={closeRef} type="button" className="video-library-close" aria-label="Fechar biblioteca de fundos" disabled={Boolean(busy)} onClick={onClose}>×</button></header>
      <div className="video-library-search"><Icon name="search" /><input type="search" aria-label="Buscar fundos ou roteiros" placeholder="Buscar fundo ou roteiro…" value={search} onChange={(event) => setSearch(event.currentTarget.value)} /><span>{items.length} fundo{items.length === 1 ? '' : 's'}</span></div>
      {error && <p className="video-library-error" role="alert">{error}</p>}
      <div className="video-library-content">
        <div className="video-library-grid" aria-label="Fundos disponíveis">
          {loading ? <p className="video-library-empty">Carregando biblioteca…</p> : filtered.length ? filtered.map((item) => <article className={`video-library-card${selectedId === item.id ? ' selected' : ''}`} key={item.id}>
            <button type="button" className="video-library-select" aria-label={`Selecionar ${item.name}`} aria-pressed={selectedId === item.id} disabled={Boolean(busy) || !item.available} onClick={() => setSelectedId(item.id)}><span className="video-library-art video-background-library-art" aria-hidden="true"><img src={`gacha-background://library/${item.id}`} alt="" /><i>{selectedId === item.id ? '✓' : '+'}</i></span><strong title={item.name}>{item.name}</strong><small>{item.available ? `${item.extension.toUpperCase()} · ${sizeLabel(item.size)}` : 'Arquivo indisponível'}</small><span className="video-library-origins" title={item.studios.map((studio) => studio.title).join(', ')}>{item.studios.length ? item.studios.map((studio) => studio.title).join(', ') : 'Biblioteca'}</span></button>
            <button type="button" className="video-library-delete" aria-label={`Excluir ${item.name} da biblioteca`} disabled={Boolean(busy)} onClick={() => void remove(item)}><Icon name="trash" /></button>
          </article>) : <p className="video-library-empty">{search ? 'Nenhum fundo encontrado.' : 'Importe um fundo para começar.'}</p>}
        </div>
        <aside className="video-library-preview video-background-library-preview" aria-label="Prévia do fundo selecionado">{selected?.available ? <><img src={`gacha-background://library/${selected.id}`} alt={`Prévia de ${selected.name}`} /><strong>{selected.name}</strong><small>{selected.extension.toUpperCase()} · {sizeLabel(selected.size)}</small></> : <p>Selecione um fundo para ver a prévia.</p>}</aside>
      </div>
      <footer><div><strong>{selected ? `Selecionado: ${selected.name}` : 'Nenhum fundo selecionado'}</strong><small>O fundo selecionado será copiado para “{studioTitle}”. Excluir da biblioteca preserva os roteiros que já o usam.</small></div><button type="button" className="video-library-add" disabled={loading || Boolean(busy) || !selected?.available} onClick={() => void useBackground()}>{busy ?? 'Usar fundo no roteiro'}</button></footer>
    </section>
  </div>, document.body)
}
