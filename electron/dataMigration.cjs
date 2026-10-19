'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { pipeline } = require('node:stream/promises')
const { createReadStream, createWriteStream } = require('node:fs')
const { sha256 } = require('./dataPlatform.cjs')

const DOMAINS = [
  { id: 'fabricator.models', roots: ['fabricator/models'] },
  { id: 'fabricator.poses', roots: ['fabricator/poses'] },
  { id: 'fabricator.animations', roots: ['fabricator/animations'] },
  { id: 'fabricator.wardrobe', roots: ['fabricator/wardrobe'] },
  { id: 'fabricator.face-sets', roots: ['fabricator/faces'], files: ['fabricator/guides-eyes.json', 'fabricator/guides-face.json'], excludeCatalog: true },
  { id: 'fabricator.face-catalog', roots: ['fabricator/faces'], includeCatalog: true },
  { id: 'fabricator.face-components', roots: ['fabricator/face-components'] },
  { id: 'fabricator.expression-presets', roots: ['fabricator/expression-presets'] },
  { id: 'fabricator.hair', roots: ['fabricator/hair'] },
  { id: 'customizer.characters', roots: ['customizer/characters'] },
  { id: 'studio.projects', roots: ['studios/Studio Principal'] },
  { id: 'video-studio.projects', roots: ['studios/Video Studio'], exclude: ['studios/Video Studio/media-library/', 'studios/Video Studio/background-library/'] },
  { id: 'video-studio.media', roots: ['studios/Video Studio/media-library'] },
  { id: 'video-studio.backgrounds', roots: ['studios/Video Studio/background-library'] }
]

function within(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function assertRealDirectory(directory, allowedRoot) {
  if (!within(allowedRoot, directory)) throw new Error('Pasta da migração fora da raiz permitida.')
  const stat = fs.lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.resolve(directory) !== fs.realpathSync(directory)) throw new Error('A migração recusou uma pasta simbólica ou não canônica.')
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function pruneEmptyDirectories(root, allowedRoot) {
  if (!fs.existsSync(root)) return
  if (!within(allowedRoot, root)) throw new Error('Limpeza tentou sair da pasta autorizada.')
  const stat = await fsp.lstat(root)
  if (stat.isSymbolicLink() || !stat.isDirectory()) return
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Limpeza recusou link simbólico.')
    if (entry.isDirectory()) await pruneEmptyDirectories(path.join(root, entry.name), allowedRoot)
  }
  if (root !== allowedRoot) {
    try { await fsp.rmdir(root) } catch (error) { if (!['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes(error.code)) throw error }
  }
}

function definitionFor(domainId) {
  const definition = DOMAINS.find((candidate) => candidate.id === domainId)
  if (!definition) throw new Error('Domínio de migração desconhecido.')
  return definition
}

function belongs(definition, relativePath) {
  const normalized = relativePath.split(path.sep).join('/')
  const isCatalog = /(?:^|\/)catalog(?:\/|$)/i.test(normalized)
  if (definition.includeCatalog && !isCatalog) return false
  if (definition.excludeCatalog && isCatalog) return false
  if (definition.exclude?.some((part) => normalized.toLowerCase().includes(part.toLowerCase()))) return false
  return true
}

async function inventoryDomain(userDataRoot, domainId) {
  const definition = definitionFor(domainId)
  const files = []
  const directories = new Set()
  for (const relativeRoot of definition.roots) {
    const root = path.resolve(userDataRoot, relativeRoot)
    if (!within(userDataRoot, root)) throw new Error('Raiz de domínio inválida.')
    let rootStat
    try { rootStat = await fsp.lstat(root) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || path.resolve(root) !== await fsp.realpath(root)) throw new Error(`A origem do domínio ${domainId} não é uma pasta real.`)
    async function walk(directory) {
      const entries = await fsp.readdir(directory, { withFileTypes: true })
      for (const entry of entries) {
        const absolute = path.join(directory, entry.name)
        if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error(`Entrada incompatível ou link simbólico no domínio ${domainId}.`)
        const relativeFromUserData = path.relative(userDataRoot, absolute)
        if (entry.isDirectory()) {
          if (belongs(definition, relativeFromUserData)) directories.add(relativeFromUserData.split(path.sep).join('/'))
          await walk(absolute)
          continue
        }
        if (!belongs(definition, relativeFromUserData)) continue
        const stat = await fsp.stat(absolute)
        const digest = await hashFile(absolute)
        const logicalPath = path.relative(root, absolute).split(path.sep).join('/')
        files.push({ absolute, relativePath: logicalPath, backupRelativePath: logicalPath,
          sourceRelativePath: relativeFromUserData.split(path.sep).join('/'), byteLength: stat.size, mtimeMs: stat.mtimeMs, sha256: digest })
      }
    }
    await walk(root)
  }
  for (const relativeFile of definition.files ?? []) {
    const absolute = path.resolve(userDataRoot, relativeFile)
    if (!within(userDataRoot, absolute)) throw new Error('Arquivo de domínio inválido.')
    let stat
    try { stat = await fsp.lstat(absolute) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
    if (!stat.isFile() || stat.isSymbolicLink() || absolute !== await fsp.realpath(absolute)) throw new Error(`A origem do arquivo ${domainId} não é um arquivo regular.`)
    files.push({ absolute, relativePath: path.basename(relativeFile), backupRelativePath: path.basename(relativeFile),
      sourceRelativePath: relativeFile.split(path.sep).join('/'), byteLength: stat.size, mtimeMs: stat.mtimeMs, sha256: await hashFile(absolute) })
  }
  files.sort((a, b) => a.sourceRelativePath.localeCompare(b.sourceRelativePath))
  const digest = sha256(files.map((file) => `${file.sourceRelativePath}\0${file.byteLength}\0${file.sha256}`).join('\n'))
  return { domainId, files, directories: [...directories].sort(), fileCount: files.length,
    directoryCount: directories.size, byteLength: files.reduce((sum, file) => sum + file.byteLength, 0), inventorySha256: digest }
}

class DataMigrationService {
  constructor({ dataRoot, userDataRoot, catalog, onProgress = () => undefined }) {
    this.dataRoot = path.resolve(dataRoot)
    this.userDataRoot = path.resolve(userDataRoot)
    this.catalog = catalog
    this.onProgress = onProgress
    assertRealDirectory(this.dataRoot, path.dirname(this.dataRoot))
    assertRealDirectory(this.userDataRoot, this.dataRoot)
  }

  async prepare() {
    const space = await fsp.statfs(this.dataRoot)
    const inventory = []
    for (const definition of DOMAINS) {
      const state = this.catalog.getDomainState(definition.id)
      const found = state.state === 'legacy' || state.state === 'migrating'
        ? await inventoryDomain(this.userDataRoot, definition.id)
        : { domainId: definition.id, files: [], directories: [], fileCount: state.manifest.fileCount ?? 0, directoryCount: state.manifest.directoryCount ?? 0, byteLength: state.manifest.byteLength ?? 0, inventorySha256: state.manifest.inventorySha256 ?? null }
      inventory.push({ domainId: definition.id, state: state.state, fileCount: found.fileCount, directoryCount: found.directoryCount,
        byteLength: found.byteLength, inventorySha256: found.inventorySha256 })
    }
    const bytesToCopy = inventory.filter((item) => item.state === 'legacy' || item.state === 'migrating').reduce((sum, item) => sum + item.byteLength, 0)
    const availableBytes = space.bavail * Number(space.bsize)
    return { domains: inventory, availableBytes, estimatedRequiredBytes: bytesToCopy * 3 + 64 * 1024 * 1024,
      hasEnoughSpace: availableBytes >= bytesToCopy * 3 + 64 * 1024 * 1024 }
  }

  async migrateDomain(domainId) {
    const definition = definitionFor(domainId)
    const previous = this.catalog.getDomainState(domainId)
    if (previous.state === 'verified') return { domainId, state: 'verified', fileCount: previous.manifest.fileCount ?? 0, byteLength: previous.manifest.byteLength ?? 0 }
    if (previous.state === 'active') return { domainId, state: 'active', fileCount: previous.manifest.fileCount ?? 0, byteLength: previous.manifest.byteLength ?? 0 }

    const inventory = await inventoryDomain(this.userDataRoot, domainId)
    const preflight = await this.prepare()
    if (!preflight.hasEnoughSpace) throw new Error('Espaço livre insuficiente para copiar, validar e testar a restauração deste domínio com segurança.')
    const id = crypto.randomUUID()
    const backupRelative = `backups/migration/${id}/${domainId}`
    const backupRoot = path.resolve(this.dataRoot, backupRelative)
    if (!within(path.join(this.dataRoot, 'backups'), backupRoot)) throw new Error('Pasta de backup fora de app-data.')
    await fsp.mkdir(backupRoot, { recursive: true })
    assertRealDirectory(backupRoot, this.dataRoot)
    const manifest = { id, domainId, state: 'copying', fileCount: inventory.fileCount, directoryCount: inventory.directoryCount,
      byteLength: inventory.byteLength, inventorySha256: inventory.inventorySha256, backupRelative, sourceRelativeRoots: definition.roots,
      sourceRelativeFiles: definition.files ?? [],
      startedAt: new Date().toISOString() }
    this.catalog.beginMigration({ id, manifest })
    this.catalog.setDomainState(domainId, 'migrating', manifest)
    this.clearPartialDomain(domainId)
    try {
      let done = 0
      for (const directory of inventory.directories) {
        const root = definition.roots.find((candidate) => directory === candidate || directory.startsWith(`${candidate}/`))
        if (!root) continue
        const relative = directory.slice(root.length).replace(/^\//, '')
        this.catalog.ensureDomainDirectory(domainId, relative)
      }
      for (const entry of inventory.files) {
        const before = await fsp.stat(entry.absolute)
        const bytes = await fsp.readFile(entry.absolute)
        const after = await fsp.stat(entry.absolute)
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== entry.byteLength || sha256(bytes) !== entry.sha256) {
          throw new Error(`O arquivo de origem mudou durante a migração de ${domainId}; os originais foram mantidos.`)
        }
        const backupPath = path.resolve(backupRoot, entry.backupRelativePath)
        if (!within(backupRoot, backupPath)) throw new Error('Destino de backup inválido.')
        await fsp.mkdir(path.dirname(backupPath), { recursive: true })
        await pipeline(createReadStream(entry.absolute), createWriteStream(backupPath, { flags: 'wx' }))
        if (await hashFile(backupPath) !== entry.sha256) throw new Error(`Cópia de segurança divergente no domínio ${domainId}.`)
        const logicalPath = entry.relativePath
        const text = /\.json(?:\.tmp)?$/i.test(logicalPath) || /\.txt$/i.test(logicalPath)
        if (text) {
          if (/\.json(?:\.tmp)?$/i.test(logicalPath)) JSON.parse(bytes.toString('utf8'))
          if (!Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)) throw new Error(`Texto UTF-8 inválido no domínio ${domainId}.`)
        }
        await this.catalog.writeDomainFile(domainId, logicalPath, bytes, { text })
        const target = await this.catalog.readDomainFile(domainId, logicalPath)
        if (!target || !target.equals(bytes)) throw new Error(`Verificação de destino falhou no domínio ${domainId}.`)
        done += 1
        this.onProgress({ domainId, completedFiles: done, totalFiles: inventory.fileCount, completedBytes: inventory.files.slice(0, done).reduce((sum, file) => sum + file.byteLength, 0), totalBytes: inventory.byteLength })
      }
      const backupManifest = { schemaVersion: 1, migrationId: id, domainId, inventorySha256: inventory.inventorySha256,
        files: inventory.files.map(({ backupRelativePath, byteLength, sha256: hash }) => ({ path: backupRelativePath, byteLength, sha256: hash })) }
      const manifestPath = path.join(backupRoot, 'backup-manifest.json')
      await fsp.writeFile(manifestPath, JSON.stringify(backupManifest, null, 2), { flag: 'wx' })
      for (const entry of inventory.files) {
        const backupPath = path.resolve(backupRoot, entry.backupRelativePath)
        if (await hashFile(backupPath) !== entry.sha256) throw new Error(`Backup não passou na conferência final de ${domainId}.`)
      }
      manifest.state = 'cutover'
      manifest.backupManifestSha256 = sha256(await fsp.readFile(manifestPath))
      manifest.completedAt = new Date().toISOString()
      this.catalog.updateMigration(id, { state: 'verified', manifest })
      this.catalog.setDomainState(domainId, 'active', manifest)
      this.catalog.updateMigration(id, { state: 'cutover', manifest })
      return { domainId, state: 'active', migrationId: id, fileCount: inventory.fileCount, directoryCount: inventory.directoryCount,
        byteLength: inventory.byteLength, inventorySha256: inventory.inventorySha256 }
    } catch (error) {
      manifest.state = 'failed'
      manifest.failedAt = new Date().toISOString()
      this.catalog.updateMigration(id, { state: 'failed', manifest, error: error instanceof Error ? error.message : String(error) })
      this.catalog.setDomainState(domainId, 'legacy', { ...manifest, error: 'Migração interrompida; origem preservada.' })
      this.clearPartialDomain(domainId)
      throw error
    }
  }

  clearPartialDomain(domainId) {
    const db = this.catalog.assertReady()
    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM domain_files WHERE domain_id=?').run(domainId)
      db.prepare('DELETE FROM domain_directories WHERE domain_id=?').run(domainId)
    })
    transaction()
  }

  async finalizeAfterHealthyLoad() {
    const outcomes = []
    for (const item of this.catalog.migrationSummary()) {
      if (item.state !== 'active' || !item.manifest?.id || !Array.isArray(item.manifest.sourceRelativeRoots)) continue
      const definition = definitionFor(item.domainId)
      const actual = await inventoryDomain(this.userDataRoot, item.domainId)
      if (actual.inventorySha256 !== item.manifest.inventorySha256 || actual.fileCount !== item.manifest.fileCount) {
        outcomes.push({ domainId: item.domainId, cleaned: false, reason: 'A origem mudou após a migração; arquivos preservados.' })
        continue
      }
      const backupRoot = path.resolve(this.dataRoot, item.manifest.backupRelative)
      if (!within(path.join(this.dataRoot, 'backups', 'migration'), backupRoot) || !fs.existsSync(backupRoot)) {
        outcomes.push({ domainId: item.domainId, cleaned: false, reason: 'Backup temporário ausente; arquivos preservados.' })
        continue
      }
      const catalogFiles = this.catalog.listDomainFiles(item.domainId)
      let allTargetMatches = catalogFiles.length === actual.fileCount
      for (const file of actual.files) {
        const stored = await this.catalog.readDomainFile(item.domainId, file.relativePath)
        if (!stored || sha256(stored) !== file.sha256) { allTargetMatches = false; break }
      }
      if (!allTargetMatches) {
        outcomes.push({ domainId: item.domainId, cleaned: false, reason: 'O catálogo não confere com a origem; arquivos preservados.' })
        continue
      }
      for (const file of actual.files) {
        const backupPath = path.resolve(backupRoot, file.backupRelativePath)
        if (!within(backupRoot, backupPath) || !fs.existsSync(backupPath) || await hashFile(backupPath) !== file.sha256) {
          allTargetMatches = false; break
        }
      }
      if (!allTargetMatches) {
        outcomes.push({ domainId: item.domainId, cleaned: false, reason: 'O backup temporário falhou na validação; arquivos preservados.' })
        continue
      }
      // Only remove the exact, inventoried roots owned by this domain. Shared
      // face paths are excluded here; individual files are removed by manifest.
      if (item.domainId === 'fabricator.face-sets' || item.domainId === 'fabricator.face-catalog' || item.domainId === 'video-studio.projects') {
        for (const file of actual.files) {
          const absolute = path.resolve(this.userDataRoot, file.sourceRelativePath)
          if (!within(this.userDataRoot, absolute)) throw new Error('Caminho de origem inválido durante limpeza.')
          await fsp.unlink(absolute)
        }
        for (const file of actual.files) {
          const parent = path.dirname(path.resolve(this.userDataRoot, file.sourceRelativePath))
          if (!within(this.userDataRoot, parent)) throw new Error('Pasta de origem inválida durante limpeza.')
          await pruneEmptyDirectories(parent, this.userDataRoot)
        }
        for (const root of definition.roots) await pruneEmptyDirectories(path.resolve(this.userDataRoot, root), this.userDataRoot)
      } else {
        for (const root of definition.roots) {
          const sourceRoot = path.resolve(this.userDataRoot, root)
          if (!within(this.userDataRoot, sourceRoot)) throw new Error('Raiz de origem inválida durante limpeza.')
          await fsp.rm(sourceRoot, { recursive: true, force: true })
        }
      }
      await fsp.rm(backupRoot, { recursive: true, force: true })
      this.catalog.setDomainState(item.domainId, 'verified', { ...item.manifest, cleanupCompletedAt: new Date().toISOString() })
      this.catalog.updateMigration(item.manifest.id, { state: 'complete', manifest: { ...item.manifest, cleanupCompletedAt: new Date().toISOString() } })
      outcomes.push({ domainId: item.domainId, cleaned: true, reason: null })
    }
    return outcomes
  }
}

module.exports = { DataMigrationService, DOMAINS, inventoryDomain }
