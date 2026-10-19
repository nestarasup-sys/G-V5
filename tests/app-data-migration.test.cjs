'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { ROOT } = require('../scripts/dev-ai/baseline.cjs')
const { migrateProfile, scanTree } = require('../scripts/prepare-app-data.cjs')

function createFixtureRoot() {
  const root = path.join(ROOT, 'out', 'dev-ai', `app-data-migration-${process.pid}-${randomUUID()}`)
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, '.synthetic-app-data-migration-fixture'), 'synthetic-only')
  return root
}

function makeFixture(root) {
  fs.mkdirSync(path.join(root, 'source', 'fabricator', 'models'), { recursive: true })
  fs.mkdirSync(path.join(root, 'source', 'Local Storage', 'leveldb'), { recursive: true })
  fs.mkdirSync(path.join(root, 'source', 'customizer', 'characters'), { recursive: true })
  fs.writeFileSync(path.join(root, 'source', 'fabricator', 'models', 'project.json'), '{"fixture":"synthetic"}')
  fs.writeFileSync(path.join(root, 'source', 'Local Storage', 'leveldb', 'CURRENT'), 'MANIFEST-000001\n')
  fs.writeFileSync(path.join(root, 'source', 'customizer', 'characters', 'manifest.json'), '{"fixture":"actor-list"}')
  fs.mkdirSync(path.join(root, 'source', 'empty-folder'))
  return { sourceProfile: path.join(root, 'source'), dataRoot: path.join(root, 'app-data') }
}

function cleanupFixture(fixtureRoot) {
  const canonicalRoot = path.resolve(fixtureRoot)
  const allowedRoot = path.resolve(ROOT, 'out', 'dev-ai')
  const relative = path.relative(allowedRoot, canonicalRoot)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Recusa de limpeza fora da fixture DEV AI sintética.')
  const marker = path.join(canonicalRoot, '.synthetic-app-data-migration-fixture')
  if (fs.existsSync(canonicalRoot) && fs.existsSync(marker)) fs.rmSync(canonicalRoot, { recursive: true, force: true })
}

test('app-data: migra fixture, verifica hashes e arquiva a origem dentro do root portátil', () => {
  const root = createFixtureRoot()
  try {
    const fixture = makeFixture(root)
    const original = scanTree(fixture.sourceProfile)
    const result = migrateProfile({ ...fixture, now: new Date('2026-10-19T12:00:00.000Z') })
    assert.equal(result.status, 'migrated')
    assert.equal(result.files, 3)
    assert.deepEqual(scanTree(path.join(fixture.dataRoot, 'runtime', 'profile')), original)
    assert.deepEqual(scanTree(result.archivedOriginal), original)
    assert.equal(fs.existsSync(fixture.sourceProfile), false)
    const manifest = JSON.parse(fs.readFileSync(path.join(fixture.dataRoot, 'manifests', 'electron-profile-migration.json'), 'utf8'))
    assert.equal(manifest.status, 'complete')
    assert.equal(manifest.archivedOriginalRelative.startsWith('backups/'), true)
    assert.equal(migrateProfile(fixture).status, 'already-portable')
  } finally { cleanupFixture(root) }
})

test('app-data: recusa mesclar origem e destino divergentes e preserva ambos', () => {
  const root = createFixtureRoot()
  try {
    const fixture = makeFixture(root)
    const destination = path.join(fixture.dataRoot, 'runtime', 'profile')
    fs.mkdirSync(path.join(destination, 'fabricator'), { recursive: true })
    fs.writeFileSync(path.join(destination, 'fabricator', 'different.json'), 'preserve')
    assert.throws(() => migrateProfile(fixture), /já existe sem manifesto/)
    assert.equal(fs.existsSync(path.join(fixture.sourceProfile, 'fabricator', 'models', 'project.json')), true)
    assert.equal(fs.existsSync(path.join(destination, 'fabricator', 'different.json')), true)
  } finally { cleanupFixture(root) }
})

test('app-data: reconcilia perfil Roaming reaparecido sem sobrescrever o perfil portátil', () => {
  const root = createFixtureRoot()
  try {
    const fixture = makeFixture(root)
    migrateProfile({ ...fixture, now: new Date('2026-10-19T12:00:00.000Z') })
    fs.mkdirSync(path.join(fixture.sourceProfile, 'fabricator', 'models'), { recursive: true })
    fs.mkdirSync(path.join(fixture.sourceProfile, 'customizer', 'characters'), { recursive: true })
    fs.mkdirSync(path.join(fixture.sourceProfile, 'studios', 'legacy-project'), { recursive: true })
    fs.writeFileSync(path.join(fixture.sourceProfile, 'fabricator', 'models', 'project.json'), 'older-source-copy')
    fs.writeFileSync(path.join(fixture.sourceProfile, 'customizer', 'characters', 'manifest.json'), '{"fixture":"actor-list"}')
    fs.writeFileSync(path.join(fixture.sourceProfile, 'studios', 'legacy-project', 'studio.json'), '{"fixture":"restored"}')
    const recoveredSourceSnapshot = scanTree(fixture.sourceProfile)

    const result = migrateProfile({ ...fixture, now: new Date('2026-10-19T12:05:00.000Z') })
    assert.equal(result.status, 'reconciled-existing-portable')
    assert.equal(result.restoredFiles, 1)
    assert.equal(result.alreadyPresentFiles, 1)
    assert.equal(result.preservedConflicts, 1)
    assert.equal(fs.existsSync(fixture.sourceProfile), false)
    assert.equal(fs.readFileSync(path.join(fixture.dataRoot, 'runtime', 'profile', 'fabricator', 'models', 'project.json'), 'utf8'), '{"fixture":"synthetic"}')
    assert.equal(fs.readFileSync(path.join(fixture.dataRoot, 'runtime', 'profile', 'studios', 'legacy-project', 'studio.json'), 'utf8'), '{"fixture":"restored"}')
    assert.deepEqual(scanTree(result.archivedOriginal), recoveredSourceSnapshot)
    const manifest = JSON.parse(fs.readFileSync(path.join(fixture.dataRoot, 'manifests', 'electron-profile-migration.json'), 'utf8'))
    assert.equal(manifest.status, 'complete')
    assert.equal(manifest.recoveredProfileInventory.files, recoveredSourceSnapshot.filter(entry => entry.type === 'file').length)
    assert.match(manifest.recoveredProfileInventory.sha256, /^[a-f0-9]{64}$/)
    assert.equal(manifest.reconciliation.restoredFiles, 1)
    assert.equal(manifest.reconciliation.alreadyPresentFiles, 1)
  } finally { cleanupFixture(root) }
})

test('app-data: inicia raiz vazia quando ainda não há perfil legado', () => {
  const root = createFixtureRoot()
  try {
    const result = migrateProfile({ sourceProfile: path.join(root, 'missing-source'), dataRoot: path.join(root, 'empty-app-data') })
    assert.equal(result.status, 'initialized-empty')
    assert.equal(fs.existsSync(path.join(root, 'empty-app-data', 'runtime', 'profile')), true)
  } finally { cleanupFixture(root) }
})
