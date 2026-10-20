const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const sharp = require('sharp')
const Database = require('better-sqlite3')
const { ContentAddressedStore, DataPlatform, createDatabaseSnapshot, getAppDataUsage, registerObjectMetadata, sha256 } = require('../electron/dataPlatform.cjs')
const { DomainFileSystem } = require('../electron/domainFileSystem.cjs')
const { DataMigrationService } = require('../electron/dataMigration.cjs')
const { DataBackupService } = require('../electron/dataBackups.cjs')
const { migrateElectronProfile } = require('../electron/electronProfileMigration.cjs')
const { normalizeImageBuffer } = require('../electron/imageIngestion.cjs')
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

test('roteiros migra JSON para SQLite sem apagar a origem e adapta o schema legado', async () => withRoot(async (root) => {
  await fs.mkdir(path.join(root, 'database'), { recursive: true })
  await fs.mkdir(path.join(root, 'projects', 'roteiros'), { recursive: true })
  const legacyDb = new Database(path.join(root, 'database', 'catalog.sqlite'))
  legacyDb.exec(`CREATE TABLE roteiros (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    video_title TEXT NOT NULL,
    character_ids_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) WITHOUT ROWID; PRAGMA user_version = 4;`)
  legacyDb.close()

  const fixture = [{
    id: 'b794825b-b298-4dd8-911c-2d183099f0e6',
    title: 'Roteiro sintético',
    videoTitle: 'Vídeo 01',
    characterIds: ['61038909-9c02-4bf3-b194-b93927d06dcd'],
    tiktoks: [{
      id: '9a4d298f-8bc9-4fca-a379-1b0e409f891a',
      title: 'TikTok sintético',
      videoTitle: 'Cena 01'
    }]
  }]
  const sourcePath = path.join(root, 'projects', 'roteiros', 'library.json')
  const sourceBytes = Buffer.from(JSON.stringify(fixture))
  await fs.writeFile(sourcePath, sourceBytes)

  const catalog = catalogAt(root)
  const db = catalog.database
  assert.equal(db.pragma('user_version', { simple: true }), 16)
  assert.ok(db.prepare('PRAGMA table_info(roteiros)').all().some((column) => column.name === 'position'))
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='roteiro_sections'").get())
  assert.deepEqual(db.prepare('SELECT id, title, video_title, character_ids_json, position FROM roteiros ORDER BY position').all(), [{
    id: fixture[0].id,
    title: fixture[0].title,
    video_title: fixture[0].videoTitle,
    character_ids_json: JSON.stringify(fixture[0].characterIds),
    position: 0
  }])
  assert.deepEqual(db.prepare('SELECT id, roteiro_id, title, video_title, position FROM roteiro_tiktoks ORDER BY position').all(), [{
    id: fixture[0].tiktoks[0].id,
    roteiro_id: fixture[0].id,
    title: fixture[0].tiktoks[0].title,
    video_title: fixture[0].tiktoks[0].videoTitle,
    position: 0
  }])
  const categoryId = 'f29e855f-79a2-4b21-a938-650ef8df645b'
  const videoId = '7c44e765-c7aa-4412-9187-7c828cb36cdf'
  db.prepare('INSERT INTO base_video_categories(category_id, name, color_hex, created_at) VALUES (?, ?, ?, ?)').run(categoryId, 'Categoria sintética', '#dc5368', new Date().toISOString())
  db.prepare("INSERT INTO base_video_details(video_id, video_number, description_text, timeline, additional_context, updated_at) VALUES (?, 1, 'Descrição preservada', 'past', 'Contexto sintético', ?)").run(videoId, new Date().toISOString())
  db.prepare('INSERT INTO base_video_category_assignments(video_id, category_id, assigned_at) VALUES (?, ?, ?)').run(videoId, categoryId, new Date().toISOString())
  const exportLogId = '40a2d12e-96e3-4bd9-9c9e-f21f837a468f'
  db.prepare("INSERT INTO roteiro_export_logs(id, roteiro_id, created_at, action, status, details) VALUES (?, ?, ?, 'Exportar teste', 'success', 'Resultado sintético')").run(exportLogId, fixture[0].id, new Date().toISOString())
  const migration = JSON.parse(db.prepare("SELECT value FROM app_metadata WHERE key = 'roteiros-json-to-sqlite-v1'").get().value)
  assert.equal(migration.sourceSha256, sha256(sourceBytes))
  assert.deepEqual(await fs.readFile(sourcePath), sourceBytes)
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
  assert.deepEqual(db.pragma('foreign_key_check'), [])

  catalog.close()
  const reopened = catalogAt(root)
  assert.equal(reopened.database.prepare('SELECT count(*) AS count FROM roteiros').get().count, 1)
  assert.equal(reopened.database.prepare('SELECT count(*) AS count FROM roteiro_tiktoks').get().count, 1)
  assert.deepEqual(reopened.database.prepare('SELECT description_text, timeline, additional_context FROM base_video_details WHERE video_id=?').get(videoId), { description_text: 'Descrição preservada', timeline: 'past', additional_context: 'Contexto sintético' })
  assert.equal(reopened.database.prepare('SELECT category_id FROM base_video_category_assignments WHERE video_id=?').get(videoId).category_id, categoryId)
  assert.equal(reopened.database.prepare('SELECT count(*) AS count FROM roteiro_export_logs WHERE id=?').get(exportLogId).count, 1)
  reopened.database.prepare('DELETE FROM base_video_categories WHERE category_id=?').run(categoryId)
  assert.equal(reopened.database.prepare('SELECT count(*) AS count FROM base_video_category_assignments WHERE video_id=?').get(videoId).count, 0)
  assert.equal(reopened.database.prepare('SELECT count(*) AS count FROM base_video_details WHERE video_id=?').get(videoId).count, 1)
  assert.equal(reopened.database.pragma('integrity_check', { simple: true }), 'ok')
  assert.deepEqual(reopened.database.pragma('foreign_key_check'), [])
  assert.equal(JSON.parse(reopened.database.prepare("SELECT value FROM app_metadata WHERE key = 'roteiros-json-to-sqlite-v1'").get().value).migratedAt, migration.migratedAt)
  reopened.close()
}))

test('schema de categorias V14 migra para cores exclusivas e persiste os valores', async () => withRoot(async (root) => {
  await fs.mkdir(path.join(root, 'database'), { recursive: true })
  const legacyDb = new Database(path.join(root, 'database', 'catalog.sqlite'))
  legacyDb.exec(`CREATE TABLE base_video_categories (
    category_id TEXT PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL
  ) WITHOUT ROWID;
  INSERT INTO base_video_categories VALUES ('cat-a', 'A', '2026-01-01T00:00:00.000Z');
  INSERT INTO base_video_categories VALUES ('cat-b', 'B', '2026-01-02T00:00:00.000Z');
  PRAGMA user_version = 14;`)
  legacyDb.close()
  const catalog = catalogAt(root)
  const colors = catalog.database.prepare('SELECT color_hex FROM base_video_categories ORDER BY category_id').all().map((row) => row.color_hex)
  assert.equal(catalog.database.pragma('user_version', { simple: true }), 16)
  assert.equal(new Set(colors).size, 2)
  catalog.close()
  const reopened = catalogAt(root)
  assert.deepEqual(reopened.database.prepare('SELECT category_id, color_hex FROM base_video_categories ORDER BY category_id').all(), [
    { category_id: 'cat-a', color_hex: colors[0] },
    { category_id: 'cat-b', color_hex: colors[1] }
  ])
  assert.equal(reopened.database.pragma('integrity_check', { simple: true }), 'ok')
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

test('image ingestion canonicalizes PNG, JPEG and WebP to static non-palette PNG without reducing source bit depth', async () => {
  const rgba = await sharp({ create: { width: 7, height: 5, channels: 4, background: { r: 63, g: 128, b: 211, alpha: 0.42 } } }).png().toBuffer()
  const normalized = await normalizeImageBuffer(rgba)
  const meta = await sharp(normalized.bytes).metadata()
  assert.equal(meta.format, 'png')
  assert.equal(meta.isPalette, false)
  assert.equal(meta.width, 7)
  assert.equal(meta.height, 5)
  assert.equal(meta.hasAlpha, true)
  assert.deepEqual(await sharp(rgba).ensureAlpha().raw().toBuffer(), await sharp(normalized.bytes).ensureAlpha().raw().toBuffer())

  for (const encoded of [await sharp(rgba).jpeg().toBuffer(), await sharp(rgba).webp({ lossless: true }).toBuffer()]) {
    const converted = await normalizeImageBuffer(encoded)
    assert.equal((await sharp(converted.bytes).metadata()).format, 'png')
    assert.equal((await sharp(converted.bytes).metadata()).hasAlpha, true)
    assert.deepEqual([converted.width, converted.height], [7, 5])
  }

  const png16 = await sharp({ create: { width: 3, height: 2, channels: 4, background: { r: 1024, g: 24576, b: 50112, alpha: 0.5 } } })
    .toColourspace('rgb16').png({ palette: false }).toBuffer()
  const normalized16 = await normalizeImageBuffer(png16)
  const meta16 = await sharp(normalized16.bytes).metadata()
  assert.equal(meta16.depth, 'ushort')
  assert.equal(meta16.isPalette, false)
  assert.deepEqual(await sharp(png16).ensureAlpha().toColourspace('rgb16').raw().toBuffer(),
    await sharp(normalized16.bytes).ensureAlpha().toColourspace('rgb16').raw().toBuffer())

  const orientedJpeg = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#7a54c2' } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer()
  const orientedPng = await normalizeImageBuffer(orientedJpeg)
  assert.deepEqual([orientedPng.width, orientedPng.height], [2, 3])
  assert.equal((await sharp(orientedPng.bytes).metadata()).orientation, undefined)

  const frameA = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255])
  const frameB = Buffer.from([0, 0, 255, 255, 255, 255, 0, 255])
  const animatedGif = await sharp(Buffer.concat([frameA, frameB]), { raw: { width: 2, height: 2, channels: 4, pageHeight: 1 } }).gif({ loop: 0 }).toBuffer()
  await assert.rejects(normalizeImageBuffer(animatedGif), /animadas não são aceitas/)

  await assert.rejects(normalizeImageBuffer(Buffer.from('not an image')), /decodificar/)
  await assert.rejects(normalizeImageBuffer(rgba, { maxBytes: 4 }), /limite permitido/)
  await assert.rejects(normalizeImageBuffer(rgba, { maxPixels: 10 }), /pixels/)
})

test('domain JSON stores embedded images as shared CAS references and hydrates legacy-compatible reads', async () => withRoot(async (root) => {
  const catalog = catalogAt(root)
  const userData = path.join(root, 'user-data')
  await fs.mkdir(path.join(userData, 'customizer', 'characters'), { recursive: true })
  const adapter = new DomainFileSystem(catalog, userData)
  catalog.setDomainState('customizer.characters', 'active', { fixture: true })
  const png = await sharp({ create: { width: 5, height: 4, channels: 4, background: { r: 219, g: 68, b: 143, alpha: 0.55 } } }).png().toBuffer()
  const generatedPng = await sharp({ create: { width: 3, height: 2, channels: 4, background: { r: 70, g: 190, b: 120, alpha: 0.7 } } }).png({ compressionLevel: 1 }).toBuffer()
  const generatedJpeg = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#c369a2' } }).jpeg().toBuffer()
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`
  const input = JSON.stringify({ id: 'synthetic-character', outfit: { left: dataUrl, right: dataUrl },
    thumbnailDataUrl: `data:image/png;base64,${generatedPng.toString('base64')}`,
    coverDataUrl: `data:image/jpeg;base64,${generatedJpeg.toString('base64')}` })
  const target = path.join(userData, 'customizer', 'characters', 'synthetic.json')
  await adapter.writeFile(target, input, 'utf8')
  const stored = await catalog.readDomainFile('customizer.characters', 'synthetic.json')
  assert.match(stored.toString('utf8'), /@gacha-image:[a-f0-9]{64}/)
  assert.doesNotMatch(stored.toString('utf8'), /data:image\//)
  assert.equal(catalog.database.prepare('SELECT count(*) AS n FROM domain_image_refs WHERE domain_id=?').get('customizer.characters').n, 4)
  assert.equal(catalog.storageSummary().uniqueObjects, 3)
  assert.equal(catalog.storageSummary().referencedObjects, 3)
  assert.equal(catalog.storageSummary().unreferencedObjects, 0)
  const loaded = JSON.parse(await adapter.readFile(target, 'utf8'))
  assert.equal(loaded.outfit.left, loaded.outfit.right)
  assert.match(loaded.outfit.left, /^data:image\/png;base64,/)
  assert.equal(catalog.database.pragma('integrity_check', { simple: true }), 'ok')
  catalog.close()
  activeCatalogs.delete(catalog)
  const reopenedCatalog = catalogAt(root)
  const reopenedAdapter = new DomainFileSystem(reopenedCatalog, userData)
  const afterRestart = JSON.parse(await reopenedAdapter.readFile(target, 'utf8'))
  assert.equal(afterRestart.outfit.left, afterRestart.outfit.right)
  assert.deepEqual(Buffer.from(afterRestart.thumbnailDataUrl.split(',')[1], 'base64'), generatedPng)
  assert.deepEqual(Buffer.from(afterRestart.coverDataUrl.split(',')[1], 'base64'), (await normalizeImageBuffer(generatedJpeg)).bytes)
  assert.match(afterRestart.coverDataUrl, /^data:image\/png;base64,/)
  assert.equal(reopenedCatalog.database.pragma('integrity_check', { simple: true }), 'ok')
  await reopenedAdapter.rename(target, path.join(userData, 'customizer', 'characters', 'renamed.json'))
  assert.equal(reopenedCatalog.database.prepare('SELECT count(*) AS n FROM domain_image_refs WHERE relative_path=?').get('renamed.json').n, 4)
  await reopenedAdapter.unlink(path.join(userData, 'customizer', 'characters', 'renamed.json'))
  assert.equal(reopenedCatalog.database.prepare('SELECT count(*) AS n FROM domain_image_refs WHERE domain_id=?').get('customizer.characters').n, 0)
  assert.equal(reopenedCatalog.storageSummary().unreferencedObjects, 3)
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

test('domain file store preserves JSON bytes, deduplicates binary files and supports filesystem operations after cutover', async () => withRoot(async (root) => {
  const catalog = catalogAt(root)
  const userData = path.join(root, 'user-data')
  await fs.mkdir(path.join(userData, 'fabricator', 'models', 'slot-1'), { recursive: true })
  const fsAdapter = new DomainFileSystem(catalog, userData)
  const legacyJson = '{"schemaVersion":1,"name":"Fixture\u00e9"}\n'
  await fs.writeFile(path.join(userData, 'fabricator', 'models', 'slot-1', 'project.json'), legacyJson)
  const sourcePng = await sharp({ create: { width: 4, height: 3, channels: 4, background: '#cb3378' } }).png().toBuffer()
  catalog.setDomainState('fabricator.models', 'active', { fixture: true })
  await fsAdapter.writeFile(path.join(userData, 'fabricator', 'models', 'slot-1', 'project.json'), legacyJson)
  await fsAdapter.writeFile(path.join(userData, 'fabricator', 'models', 'slot-1', 'source.png'), sourcePng)
  await fsAdapter.mkdir(path.join(userData, 'fabricator', 'models', 'slot-1', 'parts'), { recursive: true })
  await fsAdapter.writeFile(path.join(userData, 'fabricator', 'models', 'slot-1', 'parts', 'part.json'), '{}')
  assert.equal(await fsAdapter.readFile(path.join(userData, 'fabricator', 'models', 'slot-1', 'project.json'), 'utf8'), legacyJson)
  assert.deepEqual(await fsAdapter.readFile(path.join(userData, 'fabricator', 'models', 'slot-1', 'source.png')), sourcePng)
  const entries = await fsAdapter.readdir(path.join(userData, 'fabricator', 'models', 'slot-1'), { withFileTypes: true })
  assert.deepEqual(entries.map((entry) => [entry.name, entry.isDirectory()]).sort(), [['parts', true], ['project.json', false], ['source.png', false]])
  assert.equal((await fsAdapter.stat(path.join(userData, 'fabricator', 'models', 'slot-1', 'source.png'))).size, sourcePng.length)
  await fsAdapter.rename(path.join(userData, 'fabricator', 'models', 'slot-1', 'project.json'), path.join(userData, 'fabricator', 'models', 'slot-1', 'renamed.json'))
  assert.equal(await fsAdapter.readFile(path.join(userData, 'fabricator', 'models', 'slot-1', 'renamed.json'), 'utf8'), legacyJson)
  await fsAdapter.rm(path.join(userData, 'fabricator', 'models', 'slot-1', 'parts'), { recursive: true, force: true })
  assert.equal(catalog.storageSummary().uniqueObjects, 1)
  assert.equal(catalog.listDomainFiles('fabricator.models').length, 2)
  assert.equal(catalog.database.pragma('integrity_check', { simple: true }), 'ok')
}))

test('guided migration snapshots and verifies a synthetic domain; source is removed only after healthy cutover', async () => withRoot(async (root) => {
  const catalog = catalogAt(root)
  const userData = path.join(root, 'user-data')
  const models = path.join(userData, 'fabricator', 'models', 'slot-1')
  await fs.mkdir(models, { recursive: true })
  const json = Buffer.from('{"name":"synthetic model","schemaVersion":1}\n')
  const image = await sharp({ create: { width: 17, height: 9, channels: 4, background: '#7a54c2' } }).png().toBuffer()
  await fs.writeFile(path.join(models, 'project.json'), json)
  await fs.writeFile(path.join(models, 'source.png'), image)
  const originalHashes = [sha256(json), sha256(image)]
  const service = new DataMigrationService({ dataRoot: root, userDataRoot: userData, catalog })
  const prepared = await service.prepare()
  assert.ok(prepared.hasEnoughSpace)
  const result = await service.migrateDomain('fabricator.models')
  assert.equal(result.state, 'active')
  assert.deepEqual([await fs.readFile(path.join(models, 'project.json')).then(sha256), await fs.readFile(path.join(models, 'source.png')).then(sha256)], originalHashes)
  assert.equal(catalog.getDomainState('fabricator.models').state, 'active')
  const adapter = new DomainFileSystem(catalog, userData)
  assert.deepEqual(await adapter.readFile(path.join(models, 'project.json')), json)
  assert.deepEqual(await adapter.readFile(path.join(models, 'source.png')), image)
  const beforeRestart = await service.finalizeAfterHealthyLoad()
  assert.equal(beforeRestart.find((item) => item.domainId === 'fabricator.models').cleaned, true)
  await assert.rejects(fs.access(models), { code: 'ENOENT' })
  assert.equal(catalog.getDomainState('fabricator.models').state, 'verified')
  assert.equal(catalog.getMigration(result.migrationId).state, 'complete')
}))

test('guided migration preserves valid long sidecar extensions used by existing pose projects', async () => withRoot(async (root) => {
  const catalog = catalogAt(root)
  const userData = path.join(root, 'user-data')
  const poses = path.join(userData, 'fabricator', 'poses', 'model-1', 'slot-1')
  await fs.mkdir(poses, { recursive: true })
  const sidecar = Buffer.from('synthetic preserved pose sidecar')
  const sidecarPath = path.join(poses, 'rig.before-head-shape')
  await fs.writeFile(sidecarPath, sidecar)
  const service = new DataMigrationService({ dataRoot: root, userDataRoot: userData, catalog })
  const result = await service.migrateDomain('fabricator.poses')
  assert.equal(result.state, 'active')
  const adapter = new DomainFileSystem(catalog, userData)
  assert.deepEqual(await adapter.readFile(sidecarPath), sidecar)
  assert.equal((await service.finalizeAfterHealthyLoad()).find((item) => item.domainId === 'fabricator.poses').cleaned, true)
  await assert.rejects(fs.access(sidecarPath), { code: 'ENOENT' })
  catalog.close()
}))

test('guided migration mounts and cleans up Fabricator face-guide single files', async () => withRoot(async (root) => {
  const catalog = catalogAt(root)
  const userData = path.join(root, 'user-data')
  await fs.mkdir(path.join(userData, 'fabricator'), { recursive: true })
  const guides = Buffer.from('{"eyes":{"x":0.25}}\n')
  const guidePath = path.join(userData, 'fabricator', 'guides-eyes.json')
  await fs.writeFile(guidePath, guides)
  const service = new DataMigrationService({ dataRoot: root, userDataRoot: userData, catalog })
  const result = await service.migrateDomain('fabricator.face-sets')
  assert.equal(result.state, 'active')
  const adapter = new DomainFileSystem(catalog, userData)
  assert.equal(adapter.locate(guidePath).relativePath, 'guides-eyes.json')
  assert.deepEqual(await adapter.readFile(guidePath), guides)
  const finalized = await service.finalizeAfterHealthyLoad()
  assert.equal(finalized.find((item) => item.domainId === 'fabricator.face-sets').cleaned, true)
  await assert.rejects(fs.access(guidePath), { code: 'ENOENT' })
  assert.deepEqual(await adapter.readFile(guidePath), guides)
  const updatedGuides = Buffer.from('{"eyes":{"x":0.5}}\n')
  await adapter.mkdir(path.dirname(guidePath), { recursive: true })
  await adapter.writeFile(`${guidePath}.tmp`, updatedGuides)
  await adapter.rename(`${guidePath}.tmp`, guidePath)
  assert.deepEqual(await adapter.readFile(guidePath), updatedGuides)
  await assert.rejects(fs.access(path.join(userData, 'fabricator')))
  catalog.close()
}))

test('Electron profile data moves inside app-data while session data is split and caches are discarded', async () => withRoot(async (root) => {
  const legacy = path.join(root, 'user-data')
  const profile = path.join(root, 'runtime', 'profile')
  const session = path.join(root, 'cache', 'electron-session')
  await fs.mkdir(path.join(legacy, 'Local Storage', 'leveldb'), { recursive: true })
  await fs.mkdir(path.join(legacy, 'Cache'), { recursive: true })
  await fs.writeFile(path.join(legacy, 'Local State'), '{"profile":true}')
  await fs.writeFile(path.join(legacy, 'Preferences'), '{"preferences":true}')
  await fs.writeFile(path.join(legacy, 'Local Storage', 'leveldb', 'data.log'), 'preserve')
  await fs.writeFile(path.join(legacy, 'Cache', 'throwaway.bin'), 'disposable')

  const result = migrateElectronProfile({ dataRoot: root, legacyRoot: legacy, profileRoot: profile, sessionRoot: session })
  assert.deepEqual(result, { movedProfile: 2, movedSession: 1, removedDisposable: 1, removedLegacyDomainDirs: 0 })
  assert.equal(await fs.readFile(path.join(profile, 'Local State'), 'utf8'), '{"profile":true}')
  assert.equal(await fs.readFile(path.join(profile, 'Preferences'), 'utf8'), '{"preferences":true}')
  assert.equal(await fs.readFile(path.join(session, 'Local Storage', 'leveldb', 'data.log'), 'utf8'), 'preserve')
  await assert.rejects(fs.access(legacy))
  await assert.rejects(fs.access(path.join(session, 'Cache')))
}))

test('Electron profile migration preserves legacy domain data and refuses to overwrite profile files', async () => withRoot(async (root) => {
  const legacy = path.join(root, 'user-data')
  const profile = path.join(root, 'runtime', 'profile')
  const session = path.join(root, 'cache', 'electron-session')
  await fs.mkdir(path.join(legacy, 'fabricator'), { recursive: true })
  await fs.writeFile(path.join(legacy, 'fabricator', 'asset.json'), '{}')
  const moved = migrateElectronProfile({ dataRoot: root, legacyRoot: legacy, profileRoot: profile, sessionRoot: session })
  assert.equal(moved.movedProfile, 1)
  assert.equal(await fs.readFile(path.join(profile, 'fabricator', 'asset.json'), 'utf8'), '{}')
  await assert.rejects(fs.access(legacy))

  await fs.mkdir(legacy, { recursive: true })
  await fs.mkdir(profile, { recursive: true })
  await fs.mkdir(legacy, { recursive: true })
  await fs.writeFile(path.join(profile, 'Preferences'), 'existing')
  await fs.writeFile(path.join(legacy, 'Preferences'), 'source')
  assert.throws(() => migrateElectronProfile({ dataRoot: root, legacyRoot: legacy, profileRoot: profile, sessionRoot: session }), /já existe/)
  assert.equal(await fs.readFile(path.join(legacy, 'Preferences'), 'utf8'), 'source')
  assert.equal(await fs.readFile(path.join(profile, 'Preferences'), 'utf8'), 'existing')
}))

test('video project cleanup cannot delete separate media-library or background-library roots', async () => withRoot(async (root) => {
  const catalog = catalogAt(root)
  const userData = path.join(root, 'user-data')
  const video = path.join(userData, 'studios', 'Video Studio')
  await fs.mkdir(path.join(video, 'studio-00000000-0000-4000-8000-000000000001'), { recursive: true })
  await fs.mkdir(path.join(video, 'media-library', 'videos'), { recursive: true })
  await fs.mkdir(path.join(video, 'background-library', 'images'), { recursive: true })
  await fs.writeFile(path.join(video, 'studio-00000000-0000-4000-8000-000000000001', 'studio.json'), '{"title":"synthetic"}')
  await fs.writeFile(path.join(video, 'media-library', 'videos', 'asset.mp4'), Buffer.from('video-fixture'))
  await fs.writeFile(path.join(video, 'background-library', 'images', 'asset.png'), Buffer.from('image-fixture'))
  const service = new DataMigrationService({ dataRoot: root, userDataRoot: userData, catalog })
  const projects = await service.migrateDomain('video-studio.projects')
  assert.equal(projects.state, 'active')
  await service.finalizeAfterHealthyLoad()
  await assert.rejects(fs.access(path.join(video, 'studio-00000000-0000-4000-8000-000000000001', 'studio.json')),{ code: 'ENOENT' })
  assert.equal((await fs.readFile(path.join(video, 'media-library', 'videos', 'asset.mp4'))).toString(), 'video-fixture')
  assert.equal((await fs.readFile(path.join(video, 'background-library', 'images', 'asset.png'))).toString(), 'image-fixture')
}))

test('on-demand app backup verifies every file and restore swaps into place only after staging', async () => withRoot(async (root) => {
  const catalog = catalogAt(root)
  const profile = path.join(root, 'runtime', 'profile')
  const session = path.join(root, 'cache', 'electron-session')
  await fs.mkdir(profile, { recursive: true })
  await fs.mkdir(path.join(session, 'Local Storage'), { recursive: true })
  await fs.mkdir(path.join(session, 'Cache'), { recursive: true })
  const preferences = path.join(profile, 'Preferences')
  const localStorage = path.join(session, 'Local Storage', 'state.json')
  await fs.writeFile(preferences, '{"theme":"dark"}')
  await fs.writeFile(localStorage, '{"lastWorkspace":"customizer"}')
  await fs.writeFile(path.join(session, 'Cache', 'regenerable.bin'), 'cache')
  catalog.upsertAsset({ id: 'backup-fixture', domainId: 'customizer.characters', kind: 'character', displayName: 'Synthetic backup character' })
  const backups = new DataBackupService({ dataRoot: root, catalog })
  const saved = await backups.createBackup()
  assert.equal(saved.valid, true)
  assert.ok(saved.fileCount > 1)
  assert.equal((await backups.listBackups()).length, 1)
  await assert.rejects(fs.access(path.join(root, 'backups', saved.id, 'payload', 'cache', 'electron-session', 'Cache')))
  await fs.writeFile(preferences, '{"theme":"light"}')
  await fs.writeFile(localStorage, '{"lastWorkspace":"fabricator"}')
  assert.equal((await backups.verifyBackup(saved.id)).valid, true)
  const staged = await backups.stageRestore(saved.id)
  assert.equal(staged.backupId, saved.id)
  catalog.close()
  const applied = await backups.applyPendingRestore()
  assert.equal(applied.state, 'applied')
  const restoredCatalog = catalogAt(root)
  assert.equal(restoredCatalog.search({ query: 'Synthetic backup character', domainId: 'customizer.characters' })[0].id, 'backup-fixture')
  assert.equal(await fs.readFile(preferences, 'utf8'), '{"theme":"dark"}')
  assert.equal(await fs.readFile(localStorage, 'utf8'), '{"lastWorkspace":"customizer"}')
  const finished = await backups.finalizePendingRestore()
  assert.equal(finished.finalized, true)
  await backups.deleteBackup(saved.id)
  assert.equal((await backups.listBackups()).length, 0)
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
    ['characters/character.json', 5],
    ['cache/electron-session/Cache/data.bin', 7],
    ['cache/electron-session/Network/Cookies', 11],
    ['media/objects/sha256/aa/object', 13],
    ['backups/snapshot/catalog.sqlite', 17],
    ['manifests/electron-profile-migration.json', 19],
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
