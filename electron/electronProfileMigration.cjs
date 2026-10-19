'use strict'

const fs = require('node:fs')
const path = require('node:path')

const SESSION_ENTRIES = new Set([
  'blob_storage', 'dips', 'dips-wal', 'indexeddb', 'local storage', 'network', 'session storage',
  'shared_proto_db', 'declarative_performance_observer.db', 'declarative_performance_observer.db-journal'
])
const DISPOSABLE_ENTRIES = new Set([
  'cache', 'code cache', 'dawngraphitecache', 'dawnwebgpucache', 'gpucache', 'gpupersistentcache',
  'grshadercache', 'shadercache', 'videodecodestats', 'shared dictionary', 'devtoolsactiveport'
])
const LEGACY_DOMAIN_ENTRIES = new Set(['fabricator', 'customizer', 'studios', 'video-studios'])

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function ensureDirectory(directory, root) {
  if (!isWithin(root, directory)) throw new Error('Perfil Electron fora de app-data.')
  fs.mkdirSync(directory, { recursive: true })
  const stat = fs.lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.resolve(directory) !== fs.realpathSync(directory)) {
    throw new Error(`Diretório de perfil Electron não canônico: ${directory}`)
  }
}

function removeDisposable(target) {
  const stat = fs.lstatSync(target)
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('Arquivo temporário Electron não suportado.')
  fs.rmSync(target, { recursive: stat.isDirectory(), force: false })
}

function migrateElectronProfile({ dataRoot, legacyRoot, profileRoot, sessionRoot }) {
  const root = path.resolve(dataRoot)
  const legacy = path.resolve(legacyRoot)
  const profile = path.resolve(profileRoot)
  const session = path.resolve(sessionRoot)
  for (const directory of [legacy, profile, session]) {
    if (!isWithin(root, directory)) throw new Error('Migração de perfil Electron fora de app-data.')
  }
  ensureDirectory(profile, root)
  ensureDirectory(session, root)

  if (!fs.existsSync(legacy)) return splitElectronSessionData({ dataRoot: root, profileRoot: profile, sessionRoot: session })
  const stat = fs.lstatSync(legacy)
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.resolve(legacy) !== fs.realpathSync(legacy)) {
    throw new Error('Perfil Electron antigo não é uma pasta canônica.')
  }

  let movedProfile = 0
  let movedSession = 0
  let removedDisposable = 0
  let removedLegacyDomainDirs = 0
  for (const entry of fs.readdirSync(legacy, { withFileTypes: true })) {
    const source = path.join(legacy, entry.name)
    const key = entry.name.toLowerCase()
    const sourceStat = fs.lstatSync(source)
    if (sourceStat.isSymbolicLink() || (!sourceStat.isDirectory() && !sourceStat.isFile())) {
      throw new Error(`Entrada não suportada no perfil Electron antigo: ${entry.name}`)
    }
    if (LEGACY_DOMAIN_ENTRIES.has(key)) {
      if (!sourceStat.isDirectory()) throw new Error(`Entrada antiga de domínio inválida em ${entry.name}.`)
      const destination = path.join(profile, entry.name)
      if (fs.existsSync(destination)) throw new Error(`Domínio legado já existe no perfil de destino; nada foi sobrescrito: ${entry.name}`)
      fs.renameSync(source, destination)
      movedProfile += 1
      continue
    }
    if (DISPOSABLE_ENTRIES.has(key)) {
      removeDisposable(source)
      removedDisposable += 1
      continue
    }

    const destinationRoot = SESSION_ENTRIES.has(key) ? session : profile
    const destination = path.join(destinationRoot, entry.name)
    if (!isWithin(destinationRoot, destination)) throw new Error('Destino de perfil Electron fora do root esperado.')
    if (fs.existsSync(destination)) throw new Error(`Destino de perfil já existe; nada foi sobrescrito: ${entry.name}`)
    fs.renameSync(source, destination)
    if (SESSION_ENTRIES.has(key)) movedSession += 1
    else movedProfile += 1
  }

  if (fs.readdirSync(legacy).length !== 0) throw new Error('Perfil Electron antigo não ficou vazio após a migração.')
  fs.rmdirSync(legacy)
  const split = splitElectronSessionData({ dataRoot: root, profileRoot: profile, sessionRoot: session })
  return {
    movedProfile: movedProfile + split.movedProfile,
    movedSession: movedSession + split.movedSession,
    removedDisposable: removedDisposable + split.removedDisposable,
    removedLegacyDomainDirs: removedLegacyDomainDirs + split.removedLegacyDomainDirs
  }
}

function splitElectronSessionData({ dataRoot, profileRoot, sessionRoot }) {
  const root = path.resolve(dataRoot)
  const profile = path.resolve(profileRoot)
  const session = path.resolve(sessionRoot)
  for (const directory of [profile, session]) {
    if (!isWithin(root, directory)) throw new Error('Migração de sessão Electron fora de app-data.')
    ensureDirectory(directory, root)
  }
  let movedProfile = 0
  let movedSession = 0
  let removedDisposable = 0
  let removedLegacyDomainDirs = 0
  for (const entry of fs.readdirSync(profile, { withFileTypes: true })) {
    const source = path.join(profile, entry.name)
    const key = entry.name.toLowerCase()
    if (LEGACY_DOMAIN_ENTRIES.has(key)) continue
    const sourceStat = fs.lstatSync(source)
    if (sourceStat.isSymbolicLink() || (!sourceStat.isDirectory() && !sourceStat.isFile())) throw new Error(`Entrada não suportada no perfil Electron: ${entry.name}`)
    if (DISPOSABLE_ENTRIES.has(key)) {
      removeDisposable(source)
      removedDisposable += 1
      continue
    }
    if (!SESSION_ENTRIES.has(key)) continue
    const destination = path.join(session, entry.name)
    if (fs.existsSync(destination)) throw new Error(`Destino de sessão Electron já existe; nada foi sobrescrito: ${entry.name}`)
    fs.renameSync(source, destination)
    movedSession += 1
  }
  for (const entry of fs.readdirSync(session, { withFileTypes: true })) {
    if (!DISPOSABLE_ENTRIES.has(entry.name.toLowerCase())) continue
    removeDisposable(path.join(session, entry.name))
    removedDisposable += 1
  }
  return { movedProfile, movedSession, removedDisposable, removedLegacyDomainDirs }
}

module.exports = { migrateElectronProfile, splitElectronSessionData }
