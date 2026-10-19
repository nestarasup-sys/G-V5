import { useCallback, useEffect, useState } from 'react'

type StorageGroup = { files: number; bytes: number; unreadable: number }
type StorageSummary = {
  disk: { measuredAt: string; groups: Record<string, StorageGroup> }
  catalog: { assets: number; archivedAssets: number; uniqueObjects: number; referencedObjects: number; objectBytes: number; unreferencedObjects: number }
}
type MigrationSummary = Awaited<ReturnType<Window['desktop']['getDataMigrationSummary']>>
type MigrationProgress = Parameters<Parameters<Window['desktop']['onDataMigrationProgress']>[0]>[0]
type StoredBackup = Awaited<ReturnType<Window['desktop']['listDataBackups']>>[number]

const groupLabels: Record<string, string> = {
  characters: 'Personagens', libraries: 'Bibliotecas do Fabricador', projects: 'Projetos dos Studios',
  media: 'Mídia compartilhada', database: 'Catálogo e índices', backups: 'Backups', cache: 'Caches recriáveis',
  temporary: 'Temporários', operations: 'Logs e relatórios locais', profile: 'Perfil Electron', other: 'Outros dados locais'
}
const domainLabels: Record<string, string> = {
  'fabricator.models': 'Modelos e folhas', 'fabricator.poses': 'Poses', 'fabricator.animations': 'Animações',
  'fabricator.wardrobe': 'Roupas', 'fabricator.face-sets': 'Rosto', 'fabricator.face-catalog': 'Catálogo do rosto',
  'fabricator.face-components': 'Peças do rosto', 'fabricator.expression-presets': 'Expressões', 'fabricator.hair': 'Cabelos',
  'customizer.characters': 'Personagens e ajustes', 'studio.projects': 'Studio normal', 'video-studio.projects': 'Projetos do Video Studio',
  'video-studio.media': 'Vídeos', 'video-studio.backgrounds': 'Fundos do Video Studio'
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
  const [migration, setMigration] = useState<MigrationSummary | null>(null)
  const [migrationError, setMigrationError] = useState<string | null>(null)
  const [migrationBusy, setMigrationBusy] = useState(false)
  const [pauseRequested, setPauseRequested] = useState(false)
  const [progress, setProgress] = useState<MigrationProgress | null>(null)
  const [backups, setBackups] = useState<StoredBackup[]>([])
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMessage, setBackupMessage] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try { setSummary(await window.desktop.getAppDataStorageSummary()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível medir o armazenamento local.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const refreshMigration = useCallback(async () => {
    try { setMigration(await window.desktop.getDataMigrationSummary()); setMigrationError(null) }
    catch (reason) { setMigrationError(reason instanceof Error ? reason.message : 'Não foi possível inventariar os domínios.') }
  }, [])
  useEffect(() => {
    void refreshMigration()
    return window.desktop.onDataMigrationProgress(setProgress)
  }, [refreshMigration])
  const refreshBackups = useCallback(async () => {
    try { setBackups(await window.desktop.listDataBackups()); setBackupError(null) }
    catch (reason) { setBackupError(reason instanceof Error ? reason.message : 'Não foi possível listar os backups.') }
  }, [])
  useEffect(() => { void refreshBackups() }, [refreshBackups])
  const runMigration = useCallback(async () => {
    setMigrationBusy(true); setPauseRequested(false); setMigrationError(null); setProgress(null)
    try {
      await window.desktop.runDataMigration()
      await refreshMigration()
      await refresh()
    } catch (reason) { setMigrationError(reason instanceof Error ? reason.message : 'A migração foi interrompida; os dados de origem foram preservados.') }
    finally { setMigrationBusy(false); setPauseRequested(false); setProgress(null) }
  }, [refresh, refreshMigration])
  const requestPause = useCallback(async () => {
    setPauseRequested(true)
    try { await window.desktop.pauseDataMigration() }
    catch (reason) { setMigrationError(reason instanceof Error ? reason.message : 'Não foi possível pausar a migração.') }
  }, [])
  const restart = useCallback(async () => {
    setMigrationError(null)
    try { await window.desktop.restartAfterDataMigration() }
    catch (reason) { setMigrationError(reason instanceof Error ? reason.message : 'Não foi possível reiniciar o aplicativo.') }
  }, [])
  const createBackup = useCallback(async () => {
    setBackupBusy(true); setBackupError(null); setBackupMessage(null)
    try {
      const created = await window.desktop.createDataBackup()
      setBackupMessage(`Backup ${created.id} criado e verificado · ${created.fileCount.toLocaleString('pt-BR')} arquivos · ${formatBytes(created.byteLength)}.`)
      await refreshBackups()
      await refresh()
    } catch (reason) { setBackupError(reason instanceof Error ? reason.message : 'Não foi possível criar o backup.') }
    finally { setBackupBusy(false) }
  }, [refresh, refreshBackups])
  const verifyBackup = useCallback(async (backup: StoredBackup) => {
    setBackupBusy(true); setBackupError(null); setBackupMessage(null)
    try {
      const result = await window.desktop.verifyDataBackup(backup.id)
      setBackupMessage(result.valid ? `Backup íntegro: ${result.fileCount.toLocaleString('pt-BR')} arquivos e catálogo SQLite verificados.` : 'O backup não passou na validação.')
      await refreshBackups()
    } catch (reason) { setBackupError(reason instanceof Error ? reason.message : 'A verificação falhou.') }
    finally { setBackupBusy(false) }
  }, [refreshBackups])
  const restoreBackup = useCallback(async (backup: StoredBackup) => {
    setBackupBusy(true); setBackupError(null); setBackupMessage(null)
    try {
      const result = await window.desktop.restoreDataBackup(backup.id)
      if (result.cancelled) setBackupMessage('Restauração cancelada; os dados atuais não foram alterados.')
      else setBackupMessage('Backup preparado. O aplicativo vai reiniciar para aplicar e verificar a restauração.')
    } catch (reason) { setBackupError(reason instanceof Error ? reason.message : 'Não foi possível preparar a restauração.') }
    finally { setBackupBusy(false) }
  }, [])
  const deleteBackup = useCallback(async (backup: StoredBackup) => {
    setBackupBusy(true); setBackupError(null); setBackupMessage(null)
    try {
      const result = await window.desktop.deleteDataBackup(backup.id)
      setBackupMessage(result.deleted ? 'Backup excluído.' : 'Exclusão cancelada.')
      await refreshBackups()
      await refresh()
    } catch (reason) { setBackupError(reason instanceof Error ? reason.message : 'Não foi possível excluir o backup.') }
    finally { setBackupBusy(false) }
  }, [refresh, refreshBackups])
  const allMigrated = !!migration?.domains.length && migration.domains.every((domain) => domain.state === 'active' || domain.state === 'verified')
  const pendingDomains = migration?.domains.filter((domain) => domain.state !== 'active' && domain.state !== 'verified').length ?? 0

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
        <section aria-label="Migração dos dados" style={{ marginTop: 18, padding: 16, border: '1px solid #ffffff35', borderRadius: 8, background: '#1d12384d' }}>
          <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ margin: 0 }}>Organizar os dados existentes</h2>
              <p style={{ margin: '6px 0 0', opacity: 0.8 }}>Migração guiada por domínio, com conferência de integridade e retomada segura.</p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {migrationBusy
                ? <button type="button" onClick={() => void requestPause()} disabled={pauseRequested}>{pauseRequested ? 'Pausando…' : 'Pausar após este domínio'}</button>
                : <button type="button" onClick={() => void runMigration()} disabled={!migration || !migration.hasEnoughSpace || pendingDomains === 0}>Migrar {pendingDomains ? `${pendingDomains} domínio(s)` : 'dados'}</button>}
              {allMigrated && !migrationBusy && <button type="button" onClick={() => void restart()}>Reiniciar e validar</button>}
            </div>
          </header>
          <p role="status" aria-live="polite" style={{ margin: '12px 0', opacity: 0.86 }}>
            A origem só será removida depois que o app abrir corretamente usando a nova estrutura. O snapshot temporário de migração é removido junto com a origem; backups criados por você permanecem até exclusão explícita.
            {migration ? ` Espaço livre: ${formatBytes(migration.availableBytes)} · estimativa de staging: ${formatBytes(migration.estimatedRequiredBytes)}.` : ''}
          </p>
          {migration && !migration.hasEnoughSpace && <p role="alert" style={{ color: '#ffbb88' }}>Não há espaço livre suficiente para copiar e verificar os dados com segurança. Nada foi migrado.</p>}
          {migrationError && <p role="alert" style={{ color: '#ff9a9a' }}>{migrationError}</p>}
          {progress && <p>Copiando {domainLabels[progress.domainId] ?? progress.domainId}: {progress.completedFiles.toLocaleString('pt-BR')} / {progress.totalFiles.toLocaleString('pt-BR')} arquivos · {formatBytes(progress.completedBytes)} / {formatBytes(progress.totalBytes)}</p>}
          {migration && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 8 }}>
            {migration.domains.map((domain) => <article key={domain.domainId} style={{ padding: 10, border: '1px solid #ffffff28', borderRadius: 7 }}>
              <strong>{domainLabels[domain.domainId] ?? domain.domainId}</strong>
              <div style={{ marginTop: 4, fontSize: 13, opacity: 0.8 }}>{domain.fileCount.toLocaleString('pt-BR')} arquivos · {formatBytes(domain.byteLength)}</div>
              <small>{domain.state === 'verified' ? 'Concluído e validado' : domain.state === 'active' ? 'Migrado; aguardando reinício' : domain.state === 'migrating' ? 'Retomável' : 'Pendente'}</small>
            </article>)}
          </div>}
        </section>
        <section aria-label="Backups e restauração" style={{ marginTop: 18, padding: 16, border: '1px solid #ffffff35', borderRadius: 8, background: '#1d12384d' }}>
          <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ margin: 0 }}>Backups de recuperação</h2>
              <p style={{ margin: '6px 0 0', opacity: 0.8 }}>Criados somente quando você pedir e guardados dentro de app-data.</p>
            </div>
            <button type="button" onClick={() => void createBackup()} disabled={backupBusy}>{backupBusy ? 'Processando…' : 'Criar backup agora'}</button>
          </header>
          {backupMessage && <p role="status" aria-live="polite">{backupMessage}</p>}
          {backupError && <p role="alert" style={{ color: '#ff9a9a' }}>{backupError}</p>}
          {!backups.length && <p style={{ opacity: 0.8 }}>Nenhum backup manual disponível.</p>}
          <div style={{ display: 'grid', gap: 8 }}>
            {backups.map((backup) => <article key={backup.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: 10, border: '1px solid #ffffff28', borderRadius: 7 }}>
              <div>
                <strong>{new Date(backup.createdAt).toLocaleString('pt-BR')}</strong>
                <div style={{ fontSize: 13, opacity: 0.8 }}>{backup.fileCount.toLocaleString('pt-BR')} arquivos · {formatBytes(backup.byteLength)}{backup.verifiedAt ? ' · verificado' : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => void verifyBackup(backup)} disabled={backupBusy}>Verificar</button>
                <button type="button" onClick={() => void restoreBackup(backup)} disabled={backupBusy}>Restaurar</button>
                <button type="button" onClick={() => void deleteBackup(backup)} disabled={backupBusy}>Excluir</button>
              </div>
            </article>)}
          </div>
        </section>
      </>}
    </section>
  </main>
}
