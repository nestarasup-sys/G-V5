import { useCallback, useEffect, useState } from 'react'

type StorageGroup = { files: number; bytes: number; unreadable: number }
type StorageSummary = {
  disk: { measuredAt: string; groups: Record<string, StorageGroup> }
  catalog: { assets: number; archivedAssets: number; uniqueObjects: number; referencedObjects: number; objectBytes: number; unreferencedObjects: number }
}

const groupLabels: Record<string, string> = {
  characters: 'Personagens', libraries: 'Bibliotecas do Fabricador', projects: 'Projetos dos Studios',
  media: 'Mídia compartilhada', database: 'Catálogo e índices', backups: 'Backups', cache: 'Caches recriáveis',
  temporary: 'Temporários', operations: 'Logs e relatórios locais', profile: 'Perfil Electron', other: 'Outros dados locais'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024; let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${units[unit]}`
}

export function OptionsPage() {
  const [summary, setSummary] = useState<StorageSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try { setSummary(await window.desktop.getAppDataStorageSummary()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível medir o armazenamento local.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  return <main aria-label="Opções" style={{ height: '100%', overflow: 'auto', padding: 'clamp(16px, 3vw, 32px)', color: 'var(--text-primary, #fff)' }}>
    <section style={{ maxWidth: 1000, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0 }}>Dados e armazenamento</h1>
          <p style={{ margin: '6px 0 0', opacity: 0.8 }}>Uso local de app-data, separado por função.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading}>
          {loading ? 'Medindo…' : 'Atualizar medição'}
        </button>
      </header>
      <p role="status" aria-live="polite" style={{ opacity: 0.8 }}>
        A medição é somente leitura. Nenhum arquivo é movido ou apagado nesta tela.
        {summary ? ` Atualizado ${new Date(summary.disk.measuredAt).toLocaleString('pt-BR')}.` : ''}
      </p>
      {error && <p role="alert" style={{ color: '#ff9a9a' }}>{error}</p>}
      {summary && <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
          {Object.entries(summary.disk.groups).map(([id, group]) => <article key={id} style={{ padding: 14, border: '1px solid #ffffff35', borderRadius: 8, background: '#1d12384d' }}>
            <strong>{groupLabels[id] ?? id}</strong>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8 }}>{formatBytes(group.bytes)}</div>
            <small>{group.files.toLocaleString('pt-BR')} arquivos{group.unreadable ? ` · ${group.unreadable} não puderam ser lidos` : ''}</small>
          </article>)}
        </div>
        <section style={{ marginTop: 18, padding: 16, border: '1px solid #ffffff35', borderRadius: 8 }}>
          <h2 style={{ margin: '0 0 10px' }}>Catálogo novo</h2>
          <p style={{ margin: 0 }}>
            {summary.catalog.assets.toLocaleString('pt-BR')} assets indexados · {summary.catalog.uniqueObjects.toLocaleString('pt-BR')} objetos únicos · {formatBytes(summary.catalog.objectBytes)} em binários catalogados
          </p>
          <small style={{ display: 'block', marginTop: 8, opacity: 0.78 }}>
            Os dados atuais ainda ficam nos formatos existentes. O catálogo novo não os importou nem alterou.
            {summary.catalog.unreferencedObjects ? ` Há ${summary.catalog.unreferencedObjects} objetos sem referência; nenhum foi removido.` : ''}
          </small>
        </section>
      </>}
    </section>
  </main>
}
