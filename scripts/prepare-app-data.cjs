'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

function assertNoRunningApp(projectRoot) {
  if (process.platform !== 'win32') return
  const electronExe = path.resolve(projectRoot, 'node_modules/electron/dist/electron.exe')
  const quotePs = value => `'${String(value).replace(/'/g, "''")}'`
  const command = `$expected=${quotePs(electronExe)}; $running=@(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.ExecutablePath -ieq $expected } | Select-Object ProcessId,CommandLine); $running | ConvertTo-Json -Compress`
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true })
  if (result.error || result.status !== 0) throw new Error(`Não foi possível confirmar se o GACHA V5 está fechado. ${result.stderr || result.error?.message || ''}`.trim())
  const text = result.stdout.trim()
  if (text && text !== 'null' && text !== '[]') throw new Error('Feche todas as janelas do GACHA V5 antes de migrar os dados. Nenhum dado foi alterado.')
}

function scanTree(root) {
  const rootStat = fs.lstatSync(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`Raiz de migração não é uma pasta canônica: ${root}`)
  const entries = []
  function walk(folder, prefix = '') {
    for (const item of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(folder, item.name)
      const relative = prefix ? `${prefix}/${item.name}` : item.name
      const stat = fs.lstatSync(absolute)
      if (stat.isSymbolicLink()) throw new Error(`Link simbólico não permitido na migração: ${relative}`)
      if (stat.isDirectory()) {
        entries.push({ path: relative, type: 'directory' })
        walk(absolute, relative)
      } else if (stat.isFile()) {
        const hash = crypto.createHash('sha256')
        const fd = fs.openSync(absolute, 'r')
        try {
          const buffer = Buffer.allocUnsafe(1024 * 1024)
          let bytes
          while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes))
        } finally { fs.closeSync(fd) }
        entries.push({ path: relative, type: 'file', bytes: stat.size, sha256: hash.digest('hex') })
      } else {
        throw new Error(`Tipo de arquivo não suportado na migração: ${relative}`)
      }
    }
  }
  walk(root)
  return entries
}

function sameInventory(left, right) {
  return left.length === right.length && left.every((entry, index) => {
    const other = right[index]
    return other && entry.path === other.path && entry.type === other.type
      && entry.bytes === other.bytes && entry.sha256 === other.sha256
  })
}

function inventorySummary(entries) {
  const canonical = JSON.stringify(entries)
  return {
    entries: entries.length,
    files: entries.filter(entry => entry.type === 'file').length,
    bytes: entries.reduce((sum, entry) => sum + (entry.bytes || 0), 0),
    sha256: crypto.createHash('sha256').update(canonical).digest('hex')
  }
}

function hashFile(filePath) {
  const hash = crypto.createHash('sha256')
  const fd = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let bytes
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes))
  } finally { fs.closeSync(fd) }
  return hash.digest('hex')
}

function writeManifest(manifestPath, value) {
  const temporary = `${manifestPath}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' })
  fs.renameSync(temporary, manifestPath)
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function archiveProfileSafely(source, root, expectedInventory, now) {
  const backupRoot = path.join(root, 'backups')
  fs.mkdirSync(backupRoot, { recursive: true })
  const token = `${now.toISOString().replace(/[:.]/g, '-')}-${process.pid}-${crypto.randomUUID()}`
  const verificationCopy = path.join(backupRoot, `.verify-profile-${token}`)
  const archive = path.join(backupRoot, `roaming-profile-${token}`)
  fs.cpSync(source, verificationCopy, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true, verbatimSymlinks: true })
  if (!sameInventory(expectedInventory, scanTree(verificationCopy))) throw new Error('A cópia de recuperação do perfil não passou na verificação SHA-256; origem e cópia foram preservadas.')
  fs.renameSync(source, archive)
  if (fs.existsSync(source) || !sameInventory(expectedInventory, scanTree(archive))) {
    throw new Error(`A movimentação do perfil não correspondeu ao inventário. Cópia verificada preservada em ${verificationCopy}; não inicie o app até revisar.`)
  }
  if (!isInside(backupRoot, verificationCopy)) throw new Error('Recusa de remoção da cópia de verificação fora de app-data/backups.')
  fs.rmSync(verificationCopy, { recursive: true, force: false })
  return archive
}

function restoreMissingDomainFiles(source, destination) {
  const domains = ['customizer', 'fabricator', 'studios', 'video-studios']
  const result = { restoredFiles: 0, alreadyPresentFiles: 0, preservedConflicts: 0 }
  for (const domain of domains) {
    const from = path.join(source, domain)
    if (!fs.existsSync(from)) continue
    const to = path.join(destination, domain)
    function walk(sourceFolder, destinationFolder) {
      fs.mkdirSync(destinationFolder, { recursive: true })
      if (fs.lstatSync(destinationFolder).isSymbolicLink()) throw new Error(`Link simbólico recusado no destino ${domain}`)
      for (const item of fs.readdirSync(sourceFolder, { withFileTypes: true })) {
        const sourcePath = path.join(sourceFolder, item.name)
        const destinationPath = path.join(destinationFolder, item.name)
        const stat = fs.lstatSync(sourcePath)
        if (stat.isSymbolicLink()) throw new Error(`Link simbólico recusado ao reconciliar ${domain}/${item.name}`)
        if (stat.isDirectory()) {
          if (fs.existsSync(destinationPath) && (fs.lstatSync(destinationPath).isSymbolicLink() || !fs.lstatSync(destinationPath).isDirectory())) {
            result.preservedConflicts += 1
            continue
          }
          walk(sourcePath, destinationPath)
        } else if (stat.isFile()) {
          if (fs.existsSync(destinationPath)) {
            const destinationStat = fs.lstatSync(destinationPath)
            if (destinationStat.isSymbolicLink()) throw new Error(`Link simbólico recusado no destino ${domain}/${item.name}`)
            if (destinationStat.isFile() && destinationStat.size === stat.size && hashFile(destinationPath) === hashFile(sourcePath)) result.alreadyPresentFiles += 1
            else result.preservedConflicts += 1
            continue
          }
          fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL)
          const copiedStat = fs.statSync(destinationPath)
          if (copiedStat.size !== stat.size || hashFile(destinationPath) !== hashFile(sourcePath)) {
            throw new Error(`Arquivo recuperado não passou no SHA-256: ${domain}/${item.name}`)
          }
          result.restoredFiles += 1
        } else {
          throw new Error(`Tipo de arquivo não suportado ao reconciliar ${domain}/${item.name}`)
        }
      }
    }
    walk(from, to)
  }
  return result
}

function migrateProfile({ sourceProfile, dataRoot, now = new Date() }) {
  const source = path.resolve(sourceProfile)
  const root = path.resolve(dataRoot)
  const destination = path.join(root, 'runtime', 'profile')
  const backupRoot = path.join(root, 'backups')
  const manifestPath = path.join(root, 'manifests', 'electron-profile-migration.json')
  fs.mkdirSync(root, { recursive: true })
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
  if (fs.lstatSync(root).isSymbolicLink() || path.resolve(root) !== fs.realpathSync(root)) throw new Error('A raiz app-data não pode ser link simbólico ou caminho não canônico.')
  const sourceExists = fs.existsSync(source)
  const destinationExists = fs.existsSync(destination)

  if (!sourceExists && !destinationExists) {
    fs.mkdirSync(destination, { recursive: true })
    return { status: 'initialized-empty', destination, files: 0 }
  }
  if (!sourceExists && destinationExists) return { status: 'already-portable', destination }

  const sourceInventory = scanTree(source)
  if (destinationExists) {
    if (!fs.existsSync(manifestPath)) throw new Error('O perfil Electron portátil já existe sem manifesto de migração; origem preservada e nenhuma mesclagem foi feita.')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    if (manifest.status === 'complete') {
      const reconciliation = restoreMissingDomainFiles(source, destination)
      const recoveredArchive = archiveProfileSafely(source, root, sourceInventory, now)
      manifest.recoveredProfileRelative = path.relative(root, recoveredArchive).split(path.sep).join('/')
      manifest.recoveredAt = now.toISOString()
      manifest.recoveredProfileInventory = inventorySummary(sourceInventory)
      manifest.reconciliation = reconciliation
      writeManifest(manifestPath, manifest)
      return { status: 'reconciled-existing-portable', destination, archivedOriginal: recoveredArchive, ...inventorySummary(sourceInventory), ...reconciliation }
    }
    if (manifest.status !== 'copy-verified-source-pending-archive'
      || !sameInventory(sourceInventory, scanTree(destination))) throw new Error('A origem e app-data/runtime/profile divergem. Ambas foram preservadas; migração interrompida.')
  } else {
    const runId = `${now.toISOString().replace(/[:.]/g, '-')}-${process.pid}`
    const staging = path.join(root, `.migration-staging-${runId}`)
    if (fs.existsSync(staging)) throw new Error('Já existe staging de migração. Ele foi preservado para inspeção.')
    fs.mkdirSync(staging, { recursive: false })
    fs.cpSync(source, staging, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true, verbatimSymlinks: true })
    const copiedInventory = scanTree(staging)
    if (!sameInventory(sourceInventory, copiedInventory)) throw new Error('A cópia não passou na verificação SHA-256. Origem e staging foram preservados.')
    fs.cpSync(staging, destination, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true, verbatimSymlinks: true })
    if (!sameInventory(copiedInventory, scanTree(destination))) throw new Error('A publicação do perfil Electron não passou na verificação SHA-256. Origem e staging foram preservados.')
    if (!isInside(root, staging)) throw new Error('Recusa de limpeza do staging fora da raiz app-data.')
    fs.rmSync(staging, { recursive: true, force: false })
    writeManifest(manifestPath, {
      schemaVersion: 1,
      status: 'copy-verified-source-pending-archive',
      verifiedAt: now.toISOString(),
      sourceLabel: 'Electron userData legado',
      destinationRelative: 'runtime/profile',
      entries: copiedInventory
    })
  }

  if (path.parse(source).root.toLowerCase() !== path.parse(root).root.toLowerCase()) throw new Error('Origem e app-data estão em unidades diferentes. Cópia verificada concluída, mas a origem não foi movida.')
  const archive = archiveProfileSafely(source, root, sourceInventory, now)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  manifest.status = 'complete'
  manifest.archivedOriginalRelative = path.relative(root, archive).split(path.sep).join('/')
  manifest.completedAt = now.toISOString()
  writeManifest(manifestPath, manifest)
  return { status: 'migrated', destination, archivedOriginal: archive, files: sourceInventory.filter(entry => entry.type === 'file').length, bytes: sourceInventory.reduce((sum, entry) => sum + (entry.bytes || 0), 0) }
}

if (require.main === module) {
  const projectRoot = path.resolve(__dirname, '..')
  const dataRoot = path.join(projectRoot, 'app-data')
  try {
    if (process.platform === 'win32' && !process.env.APPDATA) throw new Error('APPDATA não está definido; migração interrompida para evitar escolher a origem errada.')
    const sourceProfile = path.join(process.env.APPDATA || '', 'gacha-nymi-work-app')
    assertNoRunningApp(projectRoot)
    const result = migrateProfile({ sourceProfile, dataRoot })
    console.log(`[app-data] ${result.status}: ${result.destination}`)
    if (result.archivedOriginal) console.log(`[app-data] Perfil anterior arquivado dentro de app-data: ${result.archivedOriginal}`)
    if (result.files !== undefined) console.log(`[app-data] ${result.files} arquivos, ${result.bytes} bytes verificados por SHA-256.`)
    if (result.restoredFiles !== undefined) console.log(`[app-data] Arquivos de domínio restaurados sem sobrescrever dados atuais: ${result.restoredFiles}; conflitos preservados: ${result.preservedConflicts}.`)
  } catch (error) {
    console.error(`[app-data] ${error.message}`)
    process.exitCode = 1
  }
}

module.exports = { assertNoRunningApp, inventorySummary, migrateProfile, scanTree }
