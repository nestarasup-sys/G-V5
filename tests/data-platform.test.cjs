const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const sharp = require('sharp')
const { ContentAddressedStore, DataPlatform, createDatabaseSnapshot, getAppDataUsage, registerObjectMetadata, sha256 } = require('../electron/dataPlatform.cjs')
const activeCatalogs = new Set()

function catalogAt(root) {
  const catalog = new DataPlatform(root).initialize()
  activeCatalogs.add(catalog)
  return catalog
}

async function withRoot(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-data-platform-'))
  try { await run(root) } finally {
    for (const catalog of activeCatalogs) { catalog.close(); activeCatalogs.delete(catalog) }
    await fs.rm(root, { recursive: true, force: true })
  }
}

test('catalog supports new domains, stable IDs, metadata search and bounded pagination', async () => withRoot(async (root) => {
  const catalog = catalogAt(root)
  catalog.registerDomain({ id: 'extensions.clothing-tools', schemaVersion: 1, manifest: { title: 'Synthetic extension' } })
  assert.throws(() => catalog.registerDomain({ id: 'extensions.clothing-tools', schemaVersion: 2 }), /migração explícita/)
  for (let index = 0; index < 135; index += 1) {
    catalog.upsertAsset({ id: `hair-${String(index).padStart(3, '0')}`, domainId: 'fabricator.hair', kind: index % 2 ? 'front-hair' : 'back-hair', displayName: `Cabelo ${index}`, metadata: { tags: ['loiro', 'synthetic'], slot: index } })
  }
  catalog.upsertAsset({ id: 'extension-item-1', domainId: 'extensions.clothing-tools', kind: 'brush', displayName: 'Pincel de brilho', metadata: { feature: 'paint' } })
  catalog.registerDomain({ id: 'extensions.clothing-tools', schemaVersion: 2, manifest: { title: 'Synthetic extension', v: 2 }, migrate: (db) => {
    db.prepare("UPDATE assets SET metadata_json = json_set(metadata_json, '$.migrated', 1) WHERE domain_id = ?").run('extensions.clothing-tools')
  } })
  assert.equal(catalog.search({ query: 'Pincel', domainId: 'extensions.clothing-tools' })[0].metadata.migrated, 1)
  assert.throws(() => catalog.registerDomain({ id: 'extensions.clothing-tools', schemaVersion: 3, migrate: () => Promise.resolve() }), /síncronas/)
  assert.equal(catalog.database.prepare('SELECT schema_version FROM domains WHERE domain_id=?').get('extensions.clothing-tools').schema_version, 2)
  assert.equal(catalog.database.prepare('SELECT count(*) AS count FROM domain_migrations').get().count, 1)
  const page = catalog.search({ domainId: 'fabricator.hair', limit: 50, offset: 50 })
  const preceding = catalog.search({ domainId: 'fabricator.hair', limit: 50, offset: 0 })
  assert.equal(page.length, 50)
  assert.equal(new Set([...preceding, ...page].map((asset) => asset.id)).size, 100)
  assert.ok(preceding.at(-1).displayName.localeCompare(page[0].displayName, undefined, { sensitivity: 'base' }) <= 0)
  assert.equal(catalog.search({ query: 'loiro synthetic', domainId: 'fabricator.hair', limit: 20 }).length, 20)
  assert.equal(catalog.search({ query: 'Pincel', domainId: 'extensions.clothing-tools' })[0].id, 'extension-item-1')
  assert.equal(catalog.storageSummary().assets, 136)
  assert.throws(() => catalog.upsertAsset({ id: 'bad', domainId: 'missing.domain', kind: 'x', displayName: 'bad' }), /Domínio não registrado/)
  catalog.close()
}))

test('synthetic scale index handles 600 characters and 2000 hair assets with bounded first-page latency', async (t) => withRoot(async (root) => {
  const catalog = catalogAt(root)
  const fixture = [
    ...Array.from({ length: 600 }, (_, index) => ({ id: `character-${index}`, domainId: 'customizer.characters', kind: 'character', displayName: `Synthetic character ${index}`, metadata: { fixture: true } })),
    ...Array.from({ length: 1000 }, (_, index) => ({ id: `front-hair-${index}`, domainId: 'fabricator.hair', kind: 'front-hair', displayName: `Synthetic front hair ${index}`, metadata: { fixture: true, side: 'front' } })),
    ...Array.from({ length: 1000 }, (_, index) => ({ id: `lower-hair-${index}`, domainId: 'fabricator.hair', kind: 'lower-hair', displayName: `Synthetic lower hair ${index}`, metadata: { fixture: true, side: 'lower' } }))
  ]
  const started = process.hrtime.bigint()
  catalog.upsertAssets(fixture)
  const insertMs = Number(process.hrtime.bigint() - started) / 1_000_000
  assert.equal(catalog.storageSummary().assets, 2600)
  const timings = []
  for (let index = 0; index < 20; index += 1) {
    const queryStarted = process.hrtime.bigint()
    const page = catalog.search({ domainId: 'fabricator.hair', kind: 'front-hair', query: 'Synthetic front hair', limit: 100 })
    timings.push(Number(process.hrtime.bigint() - queryStarted) / 1_000_000)
    assert.equal(page.length, 100)
  }
  timings.sort((a, b) => a - b)
  assert.ok(timings[18] < 250, `synthetic catalog P95 search took ${timings[18].toFixed(1)}ms; insert ${insertMs.toFixed(1)}ms`)
  t.diagnostic(`synthetic_assets=${fixture.length} bulk_insert_ms=${insertMs.toFixed(1)} search_p95_ms=${timings[18].toFixed(2)}`)
  assert.equal(catalog.search({ domainId: 'fabricator.hair', kind: 'lower-hair', limit: 500 }).length, 500)
  assert.equal(catalog.search({ domainId: 'fabricator.hair', kind: 'lower-hair', limit: 500, offset: 500 }).length, 500)
  catalog.close()
}))

test('binary objects deduplicate by content and never escape app-data', async () => withRoot(async (root) => {
  const catalog = catalogAt(root)
  const store = new ContentAddressedStore(root)
  const bytes = Buffer.from('synthetic asset bytes')
  const first = await store.putObject(bytes, { mimeType: 'application/octet-stream', extension: '.bin' })
  const second = await store.putObject(bytes, { mimeType: 'application/octet-stream', extension: '.dat' })
  catalog.upsertAsset({ id: 'asset-a', domainId: 'fabricator.models', kind: 'model-part', displayName: 'Synthetic A' })
  catalog.upsertAsset({ id: 'asset-b', domainId: 'fabricator.models', kind: 'model-part', displayName: 'Synthetic B' })
  await registerObjectMetadata(catalog, 'asset-a', first)
  await registerObjectMetadata(catalog, 'asset-b', second)
  assert.equal(first.sha256, sha256(bytes))
  assert.equal(second.reused, true)
  assert.equal(catalog.storageSummary().uniqueObjects, 1)
  assert.equal(catalog.storageSummary().objectBytes, bytes.length)
  await assert.rejects(store.putObject(bytes, { mimeType: 'application/octet-stream', extension: '..\\outside' }), /Extensão de asset inválida/)
  catalog.close()
}))

test('large binary import streams to the object store and deduplicates identical bytes', async () => withRoot(async (root) => {
  const store = new ContentAddressedStore(root)
  const bytes = Buffer.alloc(2 * 1024 * 1024, 42)
  const source = path.join(root, 'synthetic-source.bin')
  await fs.writeFile(source, bytes)
  const first = await store.putFile(source, { mimeType: 'application/octet-stream', extension: '.bin' })
  const second = await store.putFile(source, { mimeType: 'application/octet-stream', extension: '.dat' })
  assert.equal(first.sha256, sha256(bytes))
  assert.equal(first.byteLength, bytes.length)
  assert.equal(second.reused, true)
  assert.equal((await fs.stat(path.join(root, first.relativePath))).size, bytes.length)
}))

test('PNG thumbnail is deterministic, lossless encoding preserves decoded pixels, and original is unchanged', async () => withRoot(async (root) => {
  const catalog = catalogAt(root)
  const store = new ContentAddressedStore(root)
  const source = await sharp({ create: { width: 640, height: 400, channels: 4, background: { r: 232, g: 90, b: 135, alpha: 0.73 } } }).png({ compressionLevel: 1 }).toBuffer()
  const sourceHash = sha256(source)
  const first = await store.createPngThumbnail(source, { maxDimension: 128 })
  const second = await store.createPngThumbnail(source, { maxDimension: 128 })
  const lossless = await store.evaluateLosslessPng(source)
  assert.equal(first.reused, false)
  assert.equal(second.reused, true)
  assert.equal(lossless.pixelIdentical, true)
  assert.equal(sha256(source), sourceHash)
  const dimensions = await sharp(path.join(root, first.path)).metadata()
  assert.deepEqual([dimensions.width, dimensions.height], [128, 80])
  catalog.close()
}))

test('SQLite snapshot is created through the database backup API and reopens with the same catalog', async () => withRoot(async (root) => {
  const catalog = catalogAt(root)
  catalog.upsertAsset({ id: 'snapshot-item', domainId: 'fabricator.poses', kind: 'pose', displayName: 'Pose snapshot' })
  const snapshot = await createDatabaseSnapshot(catalog, path.join(root, 'backups', 'catalog-test.sqlite'))
  assert.ok(snapshot.byteLength > 0)
  assert.match(snapshot.sha256, /^[a-f0-9]{64}$/)
  catalog.close()
  const Database = require('better-sqlite3')
  const restored = new Database(path.join(root, snapshot.path), { readonly: true })
  assert.equal(restored.prepare('SELECT display_name FROM assets WHERE id=?').get('snapshot-item').display_name, 'Pose snapshot')
  assert.equal(restored.pragma('integrity_check', { simple: true }), 'ok')
  restored.close()
}))

test('storage report separates app data, Chromium cache, profile metadata and backups without exposing paths', async () => withRoot(async (root) => {
  const files = [
    ['user-data/customizer/character.json', 5],
    ['user-data/Cache/data.bin', 7],
    ['user-data/Network/Cookies', 11],
    ['media/objects/sha256/aa/object', 13],
    ['backups/snapshot/catalog.sqlite', 17],
    ['migration-manifest.json', 19],
    ['unclassified-local-file.bin', 23],
    ['unclassified-local-directory/large-blob.bin', 29]
  ]
  for (const [relative, bytes] of files) {
    const absolute = path.join(root, relative)
    await fs.mkdir(path.dirname(absolute), { recursive: true })
    await fs.writeFile(absolute, Buffer.alloc(bytes, 1))
  }
  const report = await getAppDataUsage(root)
  assert.equal(report.groups.characters.bytes, 5)
  assert.equal(report.groups.cache.bytes, 7)
  assert.equal(report.groups.profile.bytes, 11)
  assert.equal(report.groups.media.bytes, 13)
  assert.equal(report.groups.backups.bytes, 17)
  assert.equal(report.groups.operations.bytes, 19)
  assert.equal(report.groups.other.bytes, 52)
  assert.equal(JSON.stringify(report).includes('character.json'), false)
}))
