'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { createReadStream, createWriteStream } = require('node:fs')
const { pipeline } = require('node:stream/promises')
const Database = require('better-sqlite3')
const { createDatabaseSnapshot } = require('./dataPlatform.cjs')

const BACKUP_ID = /^user-[0-9]{8}T[0-9]{6}Z-[0-9a-f-]{36}$/i
const ROOTS = ['runtime/profile', 'cache/electron-session', 'media/objects', 'media/thumbnails', 'libraries', 'characters', 'projects', 'manifests']
const CACHE_NAMES = new Set(['cache', 'code cache', 'gpu cache', 'shadercache', 'grshadercache', 'dawnwebgpucache', 'dawngraphitecache', 'blob_storage'.toLowerCase(), 'shared dictionary'])
const RESTORE_TARGETS = ['database', 'runtime/profile', 'cache/electron-session', 'media/objects', 'media/thumbnails', 'libraries', 'characters', 'projects', 'manifests']

function isWithin(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
}

function assertSafeDirectory(directory, root) {
  if (!isWithin(root, directory)) throw new Error('Pasta do backup fora de app-data.')
  const stat = fs.lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.resolve(directory) !== fs.realpathSync(directory)) throw new Error('Pasta do backup não canônica.')
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function walk(root, { skipCaches = true } = {}) {
  const files = []
  async function visit(directory) {
    let entries
    try { entries = await fsp.readdir(directory, { withFileTypes: true }) } catch (error) { if (error.code === 'ENOENT') return; throw error }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (skipCaches && CACHE_NAMES.has(entry.name.toLowerCase())) continue
      const absolute = path.join(directory, entry.name)
      const stat = await fsp.lstat(absolute)
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error('Backup recusou link simbólico ou arquivo especial.')
      if (stat.isDirectory()) await visit(absolute)
      else files.push({ absolute, relativePath: path.relative(root, absolute).split(path.sep).join('/'), byteLength: stat.size, sha256: await hashFile(absolute) })
    }
  }
  if (fs.existsSync(root)) await visit(root)
  return files
}

async function copyTree(source, destination, appRoot, manifestFiles, { skipCaches = true } = {}) {
  if (!fs.existsSync(source)) return false
  assertSafeDirectory(source, appRoot)
  await fsp.mkdir(destination, { recursive: true })
  assertSafeDirectory(destination, appRoot)
  async function visit(current) {
    const entries = await fsp.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (skipCaches && CACHE_NAMES.has(entry.name.toLowerCase())) continue
      const absolute = path.join(current, entry.name)
      const stat = await fsp.lstat(absolute)
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error('Backup recusou link simbólico ou arquivo especial.')
      const target = path.join(destination, path.relative(source, absolute))
      if (!isWithin(destination, target)) throw new Error('Destino de backup fora do staging.')
      if (stat.isDirectory()) { await fsp.mkdir(target, { recursive: true }); await visit(absolute); continue }
      await fsp.mkdir(path.dirname(target), { recursive: true })
      const before = await fsp.stat(absolute)
      await pipeline(createReadStream(absolute), createWriteStream(target, { flags: 'wx' }))
      const after = await fsp.stat(absolute)
      const digest = await hashFile(target)
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || digest !== await hashFile(absolute) || (await fsp.stat(target)).size !== stat.size) {
        throw new Error('Um arquivo mudou durante a criação do backup; o backup foi cancelado.')
      }
      manifestFiles.push({ path: path.relative(appRoot, target).split(path.sep).join('/'), byteLength: stat.size, sha256: digest })
    }
  }
  await visit(source)
  return true
}

class DataBackupService {
  constructor({ dataRoot, catalog }) {
    this.root = path.resolve(dataRoot)
    this.backupsRoot = path.join(this.root, 'backups')
    this.catalog = catalog
    fs.mkdirSync(this.backupsRoot, { recursive: true })
    assertSafeDirectory(this.root, path.dirname(this.root))
    assertSafeDirectory(this.backupsRoot, this.root)
  }

  async createBackup() {
    const id = `user-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${crypto.randomUUID()}`
    const staging = path.join(this.backupsRoot, `.staging-${crypto.randomUUID()}`)
    const final = path.join(this.backupsRoot, id)
    const payload = path.join(staging, 'payload')
    await fsp.mkdir(payload, { recursive: true })
    assertSafeDirectory(staging, this.root)
    const files = []
    try {
      const disk = await fsp.statfs(this.root)
      let sourceBytes = 0
      for (const relative of ROOTS) {
        const source = path.join(this.root, relative)
        for (const file of await walk(source)) sourceBytes += file.byteLength
      }
      const databasePath = path.join(this.root, 'database', 'catalog.sqlite')
      try { sourceBytes += (await fsp.stat(databasePath)).size } catch (error) { if (error.code !== 'ENOENT') throw error }
      if (disk.bavail * Number(disk.bsize) < sourceBytes + 64 * 1024 * 1024) throw new Error('Espaço livre insuficiente para manter este backup completo.')
      for (const relative of ROOTS) {
        const source = path.join(this.root, relative)
        const destination = path.join(payload, relative)
        await copyTree(source, destination, this.root, files)
      }
      const databaseSnapshot = path.join(staging, 'payload', 'database', 'catalog.sqlite')
      const snapshot = await createDatabaseSnapshot(this.catalog, databaseSnapshot)
      files.push({ path: 'payload/database/catalog.sqlite', byteLength: snapshot.byteLength, sha256: snapshot.sha256 })
      for (const file of files) {
        if (file.path.startsWith('backups/')) file.path = file.path.slice(`backups/${path.basename(staging)}/`.length)
      }
      const manifest = { schemaVersion: 1, id, createdAt: new Date().toISOString(), fileCount: files.length,
        byteLength: files.reduce((sum, file) => sum + file.byteLength, 0), files, roots: ROOTS, databaseSchema: this.catalog.database.pragma('user_version', { simple: true }) }
      await fsp.writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' })
      await fsp.rename(staging, final)
      const result = await this.verifyBackup(id)
      if (!result.valid) { await fsp.rm(final, { recursive: true, force: true }); throw new Error('O backup recém-criado falhou na verificação.') }
      return result
    } catch (error) {
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
  }

  async listBackups() {
    const entries = await fsp.readdir(this.backupsRoot, { withFileTypes: true })
    const result = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !BACKUP_ID.test(entry.name)) continue
      try {
        const manifest = JSON.parse(await fsp.readFile(path.join(this.backupsRoot, entry.name, 'manifest.json'), 'utf8'))
        if (manifest.schemaVersion === 1 && manifest.id === entry.name) result.push({ id: entry.name, createdAt: manifest.createdAt, fileCount: manifest.fileCount, byteLength: manifest.byteLength, verifiedAt: manifest.verifiedAt ?? null })
      } catch { /* Incomplete or invalid backup is reported by integrity scan, not exposed as restorable. */ }
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async verifyBackup(id) {
    if (!BACKUP_ID.test(id)) throw new Error('Identificador de backup inválido.')
    const folder = path.resolve(this.backupsRoot, id)
    if (!isWithin(this.backupsRoot, folder)) throw new Error('Backup fora da pasta permitida.')
    assertSafeDirectory(folder, this.root)
    const manifestPath = path.join(folder, 'manifest.json')
    const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'))
    if (manifest.schemaVersion !== 1 || manifest.id !== id || !Array.isArray(manifest.files) || manifest.files.length > 2_000_000) throw new Error('Manifesto de backup inválido.')
    let checkedBytes = 0
    for (const file of manifest.files) {
      if (typeof file.path !== 'string' || path.isAbsolute(file.path) || file.path.split(/[\\/]/).includes('..') || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.byteLength) || file.byteLength < 0) throw new Error('Entrada de manifesto inválida.')
      const absolute = path.resolve(folder, file.path)
      if (!isWithin(folder, absolute) || absolute === manifestPath) throw new Error('Manifesto aponta para fora do backup.')
      const stat = await fsp.lstat(absolute)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.byteLength || await hashFile(absolute) !== file.sha256) throw new Error(`Integridade do backup falhou em ${path.basename(file.path)}.`)
      checkedBytes += stat.size
    }
    const databasePath = path.join(folder, 'payload', 'database', 'catalog.sqlite')
    const database = new Database(databasePath, { readonly: true, fileMustExist: true })
    try { if (database.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('O catálogo do backup não passou no integrity_check.') }
    finally { database.close() }
    manifest.verifiedAt = new Date().toISOString()
    await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
    return { id, valid: true, fileCount: manifest.files.length, byteLength: checkedBytes, createdAt: manifest.createdAt, verifiedAt: manifest.verifiedAt, databaseSchema: manifest.databaseSchema }
  }

  async stageRestore(id) {
    const verified = await this.verifyBackup(id)
    if (!verified.valid) throw new Error('Backup inválido.')
    const disk = await fsp.statfs(this.root)
    if (disk.bavail * Number(disk.bsize) < verified.byteLength + 64 * 1024 * 1024) throw new Error('Espaço livre insuficiente para preparar a restauração. Os dados atuais foram preservados.')
    const backupFolder = path.join(this.backupsRoot, id)
    const restoreId = crypto.randomUUID()
    const stagingRoot = path.join(this.root, 'temp', 'restore', restoreId)
    const nextRoot = path.join(stagingRoot, 'next')
    await fsp.mkdir(nextRoot, { recursive: true })
    const manifest = JSON.parse(await fsp.readFile(path.join(backupFolder, 'manifest.json'), 'utf8'))
    const copied = []
    for (const relative of RESTORE_TARGETS) {
      if (relative === 'database') {
        const source = path.join(backupFolder, 'payload', 'database', 'catalog.sqlite')
        const target = path.join(nextRoot, 'database', 'catalog.sqlite')
        await fsp.mkdir(path.dirname(target), { recursive: true })
        await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL)
        copied.push({ root: relative, present: true })
      } else {
        const source = path.join(backupFolder, 'payload', relative)
        const target = path.join(nextRoot, relative)
        const present = fs.existsSync(source)
        if (present) {
          await fsp.mkdir(path.dirname(target), { recursive: true })
          await copyTree(source, target, this.root, [], { skipCaches: false })
        }
        copied.push({ root: relative, present })
      }
    }
    const pending = { schemaVersion: 1, restoreId, backupId: id, stagingRelative: path.relative(this.root, stagingRoot).split(path.sep).join('/'), roots: copied,
      originalRoots: RESTORE_TARGETS.map((root) => ({ root, present: fs.existsSync(path.join(this.root, root)) })),
      state: 'staged', createdAt: new Date().toISOString() }
    const pendingPath = path.join(this.root, 'temp', 'restore', 'pending-restore.json')
    await fsp.mkdir(path.dirname(pendingPath), { recursive: true })
    const temporary = `${pendingPath}.${restoreId}.tmp`
    await fsp.writeFile(temporary, JSON.stringify(pending, null, 2), { flag: 'wx' })
    await fsp.rename(temporary, pendingPath)
    return { restoreId, backupId: id, fileCount: verified.fileCount, byteLength: verified.byteLength }
  }

  async applyPendingRestore() {
    const pendingPath = path.join(this.root, 'temp', 'restore', 'pending-restore.json')
    let pending
    try { pending = JSON.parse(await fsp.readFile(pendingPath, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    if (pending.schemaVersion !== 1 || !/^[0-9a-f-]{36}$/i.test(pending.restoreId) || !Array.isArray(pending.roots)) throw new Error('Jornal de restauração inválido.')
    if (pending.state === 'applied') {
      const restoredDb = new Database(path.join(this.root, 'database', 'catalog.sqlite'), { readonly: true, fileMustExist: true })
      try { if (restoredDb.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('O banco restaurado falhou na verificação de integridade.') }
      finally { restoredDb.close() }
      return pending
    }
    if (pending.state !== 'staged') throw new Error('Restauração anterior interrompida; dados antigos foram preservados para recuperação.')
    const verified = await this.verifyBackup(pending.backupId)
    if (!verified.valid) throw new Error('Backup inválido antes da restauração.')
    const stagingRoot = path.resolve(this.root, pending.stagingRelative)
    if (!isWithin(path.join(this.root, 'temp', 'restore'), stagingRoot)) throw new Error('Staging de restauração fora de app-data.')
    const previousRoot = path.join(stagingRoot, 'previous')
    await fsp.mkdir(previousRoot, { recursive: true })
    if (Array.isArray(pending.originalRoots)) {
      // Recover a prior launch that stopped partway through the multi-root
      // swap before retrying. The journal and previous tree remain local.
      for (const original of pending.originalRoots) {
        if (!RESTORE_TARGETS.includes(original.root) || typeof original.present !== 'boolean') throw new Error('Jornal de rollback inválido.')
        const target = path.resolve(this.root, original.root)
        const previous = path.resolve(previousRoot, original.root)
        if (!isWithin(this.root, target) || !isWithin(previousRoot, previous)) throw new Error('Caminho de rollback inseguro.')
        if (original.present && fs.existsSync(previous)) {
          await fsp.rm(target, { recursive: true, force: true })
          await fsp.mkdir(path.dirname(target), { recursive: true })
          await fsp.rename(previous, target)
        } else if (!original.present) await fsp.rm(target, { recursive: true, force: true })
      }
    }
    const moved = []
    try {
      for (const item of pending.roots) {
        if (!RESTORE_TARGETS.includes(item.root) || typeof item.present !== 'boolean') throw new Error('Raiz de restauração não permitida.')
        const target = path.resolve(this.root, item.root)
        const staged = path.resolve(stagingRoot, 'next', item.root)
        const previous = path.resolve(previousRoot, item.root)
        if (!isWithin(this.root, target) || !isWithin(stagingRoot, staged) || !isWithin(previousRoot, previous)) throw new Error('Caminho de restauração inseguro.')
        await fsp.mkdir(path.dirname(target), { recursive: true })
        if (fs.existsSync(target)) { await fsp.mkdir(path.dirname(previous), { recursive: true }); await fsp.rename(target, previous) }
        moved.push({ target, previous, hadPrevious: fs.existsSync(previous) })
        if (item.present) {
          if (!fs.existsSync(staged)) throw new Error(`Staging de restauração ausente: ${item.root}`)
          await fsp.rename(staged, target)
        }
      }
      const restoredDb = new Database(path.join(this.root, 'database', 'catalog.sqlite'), { readonly: true, fileMustExist: true })
      try { if (restoredDb.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('O banco restaurado falhou na verificação.') }
      finally { restoredDb.close() }
      pending.state = 'applied'
      pending.appliedAt = new Date().toISOString()
      await fsp.writeFile(pendingPath, JSON.stringify(pending, null, 2))
      return pending
    } catch (error) {
      for (const item of moved.reverse()) {
        if (fs.existsSync(item.target)) await fsp.rm(item.target, { recursive: true, force: true }).catch(() => undefined)
        if (item.hadPrevious && fs.existsSync(item.previous)) await fsp.rename(item.previous, item.target).catch(() => undefined)
      }
      throw error
    }
  }

  async finalizePendingRestore() {
    const pendingPath = path.join(this.root, 'temp', 'restore', 'pending-restore.json')
    let pending
    try { pending = JSON.parse(await fsp.readFile(pendingPath, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    if (pending.state !== 'applied') return null
    const stagingRoot = path.resolve(this.root, pending.stagingRelative)
    if (!isWithin(path.join(this.root, 'temp', 'restore'), stagingRoot)) throw new Error('Staging final da restauração fora de app-data.')
    await fsp.rm(path.join(stagingRoot, 'previous'), { recursive: true, force: true })
    await fsp.rm(stagingRoot, { recursive: true, force: true })
    await fsp.unlink(pendingPath)
    return { backupId: pending.backupId, finalized: true }
  }

  async deleteBackup(id) {
    if (!BACKUP_ID.test(id)) throw new Error('Identificador de backup inválido.')
    const folder = path.resolve(this.backupsRoot, id)
    if (!isWithin(this.backupsRoot, folder)) throw new Error('Backup fora da pasta permitida.')
    assertSafeDirectory(folder, this.root)
    await fsp.rm(folder, { recursive: true, force: true })
  }
}

module.exports = { DataBackupService }
