const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { createReadStream, createWriteStream } = require('node:fs')
const { Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const Database = require('better-sqlite3')

const BUILTIN_DOMAINS = [
  'fabricator.models', 'fabricator.poses', 'fabricator.animations', 'fabricator.wardrobe',
  'fabricator.face-sets', 'fabricator.face-catalog', 'fabricator.face-components',
  'fabricator.expression-presets', 'fabricator.hair', 'fabricator.accessories',
  'customizer.characters', 'studio.projects', 'studio.prints', 'video-studio.projects',
  'video-studio.media', 'video-studio.backgrounds'
]

function isWithin(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
}

function assertCanonicalDirectory(root, label) {
  fs.mkdirSync(root, { recursive: true })
  const stat = fs.lstatSync(root)
  if (!stat.isDirectory() || stat.isSymbolicLink() || path.resolve(root) !== fs.realpathSync(root)) {
    throw new Error(`${label} precisa ser uma pasta real e canônica.`)
  }
}

async function ensureSafeDirectory(root, target) {
  const canonicalRoot = path.resolve(root)
  const absolute = path.resolve(target)
  if (!isWithin(canonicalRoot, absolute)) throw new Error('Tentativa de gravação fora de app-data.')
  assertCanonicalDirectory(canonicalRoot, 'Raiz app-data')
  const relativePath = path.relative(canonicalRoot, absolute)
  let current = canonicalRoot
  for (const segment of relativePath ? relativePath.split(path.sep) : []) {
    current = path.join(current, segment)
    await fsp.mkdir(current, { recursive: false }).catch((error) => {
      if (error.code !== 'EEXIST') throw error
    })
    const stat = await fsp.lstat(current)
    if (!stat.isDirectory() || stat.isSymbolicLink() || path.resolve(current) !== await fsp.realpath(current)) {
      throw new Error(`Diretório de dados não canônico: ${current}`)
    }
  }
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

function validateDomainId(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9.-]{1,79}$/.test(value)) throw new Error('Identificador de domínio inválido.')
}

function validateId(value, label = 'Identificador') {
  if (typeof value !== 'string' || value.length < 1 || value.length > 160 || /[\u0000-\u001f]/.test(value)) throw new Error(`${label} inválido.`)
}

function validateExtension(value) {
  if (typeof value !== 'string' || !/^\.[a-z0-9]{1,10}$/i.test(value)) throw new Error('Extensão de asset inválida.')
  return value.toLowerCase()
}

function normalizeAssetInput(input, now) {
  const { id, domainId, kind, displayName, schemaVersion = 1, metadata = {}, archived = false } = input ?? {}
  validateId(id, 'ID do asset')
  validateDomainId(domainId)
  validateId(kind, 'Tipo do asset')
  if (typeof displayName !== 'string' || displayName.length > 500) throw new Error('Nome do asset inválido.')
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) throw new Error('Versão do asset inválida.')
  if (typeof archived !== 'boolean') throw new Error('Estado de arquivamento inválido.')
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') throw new Error('Metadados do asset inválidos.')
  return { id, domainId, kind, displayName, schemaVersion, metadata: JSON.stringify(metadata), archived: archived ? 1 : 0, now }
}

function upsertAssetRows(db, rows) {
  const insert = db.prepare(`INSERT INTO assets(id, domain_id, kind, display_name, schema_version, metadata_json, archived, created_at, updated_at)
    VALUES (@id, @domainId, @kind, @displayName, @schemaVersion, @metadata, @archived, @now, @now)
    ON CONFLICT(id) DO UPDATE SET domain_id=excluded.domain_id, kind=excluded.kind, display_name=excluded.display_name,
    schema_version=excluded.schema_version, metadata_json=excluded.metadata_json, archived=excluded.archived, updated_at=excluded.updated_at`)
  db.transaction((items) => items.forEach((item) => insert.run(item)))(rows)
}

class DataPlatform {
  constructor(dataRoot) {
    this.root = path.resolve(dataRoot)
    this.database = null
  }

  initialize() {
    if (this.database?.open) return this
    assertCanonicalDirectory(this.root, 'Raiz app-data')
    const directories = [
      'database/migrations', 'database/journal', 'libraries', 'characters', 'projects',
      'media/objects/sha256', 'media/thumbnails', 'media/imports-staging', 'cache',
      'temp', 'logs', 'crash-dumps', 'backups', 'manifests'
    ]
    for (const relativePath of directories) {
      const folder = path.join(this.root, relativePath)
      if (!isWithin(this.root, folder)) throw new Error('Diretório de dados fora de app-data.')
      assertCanonicalDirectory(folder, `Diretório ${relativePath}`)
    }

    const dbPath = path.join(this.root, 'database', 'catalog.sqlite')
    if (!isWithin(this.root, dbPath)) throw new Error('Banco fora de app-data.')
    this.database = new Database(dbPath, { timeout: 5000 })
    this.database.pragma('foreign_keys = ON')
    const currentSchema = this.database.pragma('user_version', { simple: true })
    if (currentSchema > 1) {
      this.database.close()
      this.database = null
      throw new Error(`O catálogo usa schema ${currentSchema}, mais novo que esta versão do app.`)
    }
    this.database.pragma('journal_mode = WAL')
    this.database.pragma('synchronous = FULL')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS domains (
        domain_id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL CHECK(schema_version > 0),
        manifest_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS domain_migrations (
        domain_id TEXT NOT NULL REFERENCES domains(domain_id),
        from_version INTEGER NOT NULL,
        to_version INTEGER NOT NULL,
        migration_id TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        PRIMARY KEY(domain_id, to_version)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        domain_id TEXT NOT NULL REFERENCES domains(domain_id),
        kind TEXT NOT NULL,
        display_name TEXT NOT NULL,
        schema_version INTEGER NOT NULL CHECK(schema_version > 0),
        metadata_json TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS assets_by_domain_kind_name ON assets(domain_id, kind, display_name COLLATE NOCASE, id);
      CREATE INDEX IF NOT EXISTS assets_by_updated ON assets(updated_at DESC);
      CREATE TABLE IF NOT EXISTS objects (
        sha256 TEXT PRIMARY KEY CHECK(length(sha256) = 64),
        byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
        mime_type TEXT NOT NULL,
        extension TEXT NOT NULL,
        relative_path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS asset_objects (
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        sha256 TEXT NOT NULL REFERENCES objects(sha256),
        role TEXT NOT NULL,
        PRIMARY KEY(asset_id, role)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS asset_objects_by_hash ON asset_objects(sha256);
      CREATE TABLE IF NOT EXISTS entity_references (
        source_domain TEXT NOT NULL,
        source_id TEXT NOT NULL,
        target_domain TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        PRIMARY KEY(source_domain, source_id, target_domain, target_id, relation)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS entity_references_by_target ON entity_references(target_domain, target_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS asset_search USING fts5(asset_id UNINDEXED, domain_id UNINDEXED, kind, display_name, metadata_text, tokenize='unicode61 remove_diacritics 2');
      CREATE TRIGGER IF NOT EXISTS assets_search_insert AFTER INSERT ON assets BEGIN
        INSERT INTO asset_search(asset_id, domain_id, kind, display_name, metadata_text)
        VALUES (new.id, new.domain_id, new.kind, new.display_name, new.metadata_json);
      END;
      CREATE TRIGGER IF NOT EXISTS assets_search_update AFTER UPDATE ON assets BEGIN
        DELETE FROM asset_search WHERE asset_id = old.id;
        INSERT INTO asset_search(asset_id, domain_id, kind, display_name, metadata_text)
        VALUES (new.id, new.domain_id, new.kind, new.display_name, new.metadata_json);
      END;
      CREATE TRIGGER IF NOT EXISTS assets_search_delete AFTER DELETE ON assets BEGIN
        DELETE FROM asset_search WHERE asset_id = old.id;
      END;
    `)

    const now = new Date().toISOString()
    this.database.prepare(`INSERT OR IGNORE INTO schema_migrations(version, name, checksum, applied_at) VALUES (1, 'initial-catalog', ?, ?)`)
      .run(sha256('gacha-data-catalog-schema-v1'), now)
    this.database.pragma('user_version = 1')
    const insertDomain = this.database.prepare(`INSERT OR IGNORE INTO domains(domain_id, schema_version, manifest_json, updated_at) VALUES (?, 1, '{}', ?)`)
    const registerBuiltins = this.database.transaction(() => BUILTIN_DOMAINS.forEach((id) => insertDomain.run(id, now)))
    registerBuiltins()
    this.database.prepare("INSERT OR IGNORE INTO app_metadata(key, value) VALUES ('schema_version', '1')").run()
    return this
  }

  assertReady() {
    if (!this.database || !this.database.open) throw new Error('Catálogo de dados não inicializado.')
    return this.database
  }

  registerDomain({ id, schemaVersion, manifest = {}, migrate }) {
    validateDomainId(id)
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) throw new Error('Versão de schema inválida.')
    if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') throw new Error('Manifesto de domínio inválido.')
    const db = this.assertReady()
    const current = db.prepare('SELECT schema_version FROM domains WHERE domain_id = ?').get(id)
    if (current && schemaVersion < current.schema_version) throw new Error('Downgrade de schema de domínio recusado.')
    const now = new Date().toISOString()
    if (!current) {
      db.prepare('INSERT INTO domains(domain_id, schema_version, manifest_json, updated_at) VALUES (?, ?, ?, ?)')
        .run(id, schemaVersion, JSON.stringify(manifest), now)
      return
    }
    if (schemaVersion > current.schema_version) {
      if (typeof migrate !== 'function') throw new Error('Atualização de domínio exige uma migração explícita.')
      const migrationId = `${current.schema_version}-to-${schemaVersion}`
      const migration = db.transaction(() => {
        const result = migrate(db)
        if (result && typeof result.then === 'function') throw new Error('Migrações de domínio devem ser síncronas e transacionais.')
        db.prepare('UPDATE domains SET schema_version=?, manifest_json=?, updated_at=? WHERE domain_id=?')
          .run(schemaVersion, JSON.stringify(manifest), now, id)
        db.prepare('INSERT INTO domain_migrations(domain_id, from_version, to_version, migration_id, applied_at) VALUES (?, ?, ?, ?, ?)')
          .run(id, current.schema_version, schemaVersion, migrationId, now)
      })
      migration()
      return
    }
    db.prepare('UPDATE domains SET manifest_json=?, updated_at=? WHERE domain_id=?').run(JSON.stringify(manifest), now, id)
  }

  upsertAsset(input) {
    const db = this.assertReady()
    const row = normalizeAssetInput(input, new Date().toISOString())
    if (!db.prepare('SELECT 1 FROM domains WHERE domain_id = ?').get(row.domainId)) throw new Error(`Domínio não registrado: ${row.domainId}`)
    upsertAssetRows(db, [row])
  }

  upsertAssets(inputs) {
    if (!Array.isArray(inputs) || inputs.length > 20000) throw new Error('Lote de assets inválido ou acima do limite.')
    if (!inputs.length) return
    const db = this.assertReady()
    const now = new Date().toISOString()
    const rows = inputs.map((input) => normalizeAssetInput(input, now))
    const hasDomain = db.prepare('SELECT 1 FROM domains WHERE domain_id = ?')
    const missingDomains = [...new Set(rows.map((row) => row.domainId))].filter((domainId) => !hasDomain.get(domainId))
    if (missingDomains.length) throw new Error(`Domínio não registrado: ${missingDomains.join(', ')}`)
    upsertAssetRows(db, rows)
  }

  linkObject({ assetId, sha256: hash, role = 'original' }) {
    validateId(assetId, 'ID do asset')
    validateId(role, 'Função do objeto')
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('SHA-256 inválido.')
    this.assertReady().prepare(`INSERT INTO asset_objects(asset_id, sha256, role) VALUES (?, ?, ?)
      ON CONFLICT(asset_id, role) DO UPDATE SET sha256=excluded.sha256`).run(assetId, hash, role)
  }

  addReference({ sourceDomain, sourceId, targetDomain, targetId, relation }) {
    validateDomainId(sourceDomain); validateId(sourceId, 'ID de origem')
    validateDomainId(targetDomain); validateId(targetId, 'ID de destino'); validateId(relation, 'Relação')
    const db = this.assertReady()
    const hasDomain = db.prepare('SELECT 1 FROM domains WHERE domain_id = ?')
    if (!hasDomain.get(sourceDomain) || !hasDomain.get(targetDomain)) throw new Error('Referência usa domínio ainda não registrado.')
    db.prepare(`INSERT OR IGNORE INTO entity_references(source_domain, source_id, target_domain, target_id, relation)
      VALUES (?, ?, ?, ?, ?)`).run(sourceDomain, sourceId, targetDomain, targetId, relation)
  }

  search({ query = '', domainId, kind, limit = 100, offset = 0 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500 || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Paginação inválida.')
    if (domainId !== undefined) validateDomainId(domainId)
    if (kind !== undefined) validateId(kind, 'Tipo do asset')
    const db = this.assertReady()
    if (query.trim()) {
      const terms = query.trim().replace(/["*:^(){}\[\]]/g, ' ').split(/\s+/).filter(Boolean)
      if (!terms.length) return []
      const expression = terms.map((term) => `"${term.replace(/"/g, '""')}"*`).join(' AND ')
      const rows = db.prepare(`SELECT a.* FROM asset_search s JOIN assets a ON a.id=s.asset_id
        WHERE asset_search MATCH ? AND a.archived=0 ${domainId ? 'AND a.domain_id=?' : ''} ${kind ? 'AND a.kind=?' : ''}
        ORDER BY bm25(asset_search), a.display_name COLLATE NOCASE, a.id LIMIT ? OFFSET ?`)
      return rows.all(...[expression, ...(domainId ? [domainId] : []), ...(kind ? [kind] : []), limit, offset]).map(parseAssetRow)
    }
    const clauses = ['archived=0']; const params = []
    if (domainId) { validateDomainId(domainId); clauses.push('domain_id=?'); params.push(domainId) }
    if (kind) { validateId(kind, 'Tipo do asset'); clauses.push('kind=?'); params.push(kind) }
    return db.prepare(`SELECT * FROM assets WHERE ${clauses.join(' AND ')} ORDER BY display_name COLLATE NOCASE, id LIMIT ? OFFSET ?`)
      .all(...params, limit, offset).map(parseAssetRow)
  }

  storageSummary() {
    const db = this.assertReady()
    return {
      assets: db.prepare('SELECT count(*) AS count FROM assets WHERE archived=0').get().count,
      archivedAssets: db.prepare('SELECT count(*) AS count FROM assets WHERE archived=1').get().count,
      uniqueObjects: db.prepare('SELECT count(*) AS count FROM objects').get().count,
      referencedObjects: db.prepare('SELECT count(DISTINCT sha256) AS count FROM asset_objects').get().count,
      objectBytes: db.prepare('SELECT coalesce(sum(byte_length), 0) AS bytes FROM objects').get().bytes,
      unreferencedObjects: db.prepare('SELECT count(*) AS count FROM objects o WHERE NOT EXISTS (SELECT 1 FROM asset_objects ao WHERE ao.sha256=o.sha256)').get().count
    }
  }

  close() {
    if (this.database?.open) {
      this.database.pragma('wal_checkpoint(TRUNCATE)')
      this.database.close()
    }
  }
}

function parseAssetRow(row) {
  return { id: row.id, domainId: row.domain_id, kind: row.kind, displayName: row.display_name,
    schemaVersion: row.schema_version, metadata: JSON.parse(row.metadata_json), archived: Boolean(row.archived),
    createdAt: row.created_at, updatedAt: row.updated_at }
}

class ContentAddressedStore {
  constructor(dataRoot) {
    this.root = path.resolve(dataRoot)
    this.objectsRoot = path.join(this.root, 'media', 'objects', 'sha256')
    this.thumbnailsRoot = path.join(this.root, 'media', 'thumbnails')
    this.tempRoot = path.join(this.root, 'temp')
  }

  async putObject(bytes, { mimeType, extension }) {
    if (!Buffer.isBuffer(bytes) || !mimeType || typeof mimeType !== 'string') throw new Error('Conteúdo de asset inválido.')
    extension = validateExtension(extension)
    const hash = sha256(bytes)
    const folder = path.join(this.objectsRoot, hash.slice(0, 2))
    const destination = path.join(folder, hash)
    if (!isWithin(this.root, destination)) throw new Error('Objeto fora de app-data.')
    await ensureSafeDirectory(this.root, folder)
    if (fs.existsSync(destination)) {
      const existing = await fsp.stat(destination)
      if (existing.size !== bytes.length || await hashFile(destination) !== hash) throw new Error('Objeto existente com hash divergente; gravação interrompida.')
      return { sha256: hash, byteLength: bytes.length, mimeType, extension: extension.toLowerCase(), relativePath: path.relative(this.root, destination).split(path.sep).join('/'), reused: true }
    }
    const temporary = path.join(this.tempRoot, `object-${crypto.randomUUID()}.tmp`)
    if (!isWithin(this.root, temporary)) throw new Error('Temporário fora de app-data.')
    await ensureSafeDirectory(this.root, this.tempRoot)
    try {
      const handle = await fsp.open(temporary, 'wx')
      try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
      try { await fsp.rename(temporary, destination) } catch (error) {
        if (!fs.existsSync(destination)) throw error
        const existing = await fsp.stat(destination)
        if (existing.size !== bytes.length || await hashFile(destination) !== hash) throw new Error('Conflito ao publicar objeto de mídia.')
        await fsp.unlink(temporary).catch(() => undefined)
        return { sha256: hash, byteLength: bytes.length, mimeType, extension: extension.toLowerCase(), relativePath: path.relative(this.root, destination).split(path.sep).join('/'), reused: true }
      }
    } catch (error) {
      await fsp.unlink(temporary).catch(() => undefined)
      throw error
    }
    return { sha256: hash, byteLength: bytes.length, mimeType, extension: extension.toLowerCase(), relativePath: path.relative(this.root, destination).split(path.sep).join('/'), reused: false }
  }

  async putFile(sourcePath, { mimeType, extension }) {
    if (!mimeType || typeof mimeType !== 'string') throw new Error('Tipo de mídia inválido.')
    extension = validateExtension(extension)
    const source = path.resolve(sourcePath)
    const sourceStat = await fsp.stat(source)
    if (!sourceStat.isFile()) throw new Error('A origem da mídia não é um arquivo regular.')
    const folder = this.objectsRoot
    await ensureSafeDirectory(this.root, folder)
    await ensureSafeDirectory(this.root, this.tempRoot)
    const temporary = path.join(this.tempRoot, `object-${crypto.randomUUID()}.tmp`)
    const hash = crypto.createHash('sha256')
    let bytes = 0
    const digestTransform = new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk)
        bytes += chunk.length
        callback(null, chunk)
      }
    })
    try {
      await pipeline(createReadStream(source), digestTransform, createWriteStream(temporary, { flags: 'wx' }))
      const digest = hash.digest('hex')
      const destinationFolder = path.join(folder, digest.slice(0, 2))
      const destination = path.join(destinationFolder, digest)
      if (!isWithin(this.root, destination) || !isWithin(this.root, temporary)) throw new Error('Mídia fora de app-data.')
      await ensureSafeDirectory(this.root, destinationFolder)
      if (fs.existsSync(destination)) {
        const targetStat = await fsp.stat(destination)
        if (targetStat.size !== bytes || await hashFile(destination) !== digest) throw new Error('Objeto existente com hash divergente; gravação interrompida.')
        await fsp.unlink(temporary)
        return { sha256: digest, byteLength: bytes, mimeType, extension: extension.toLowerCase(), relativePath: path.relative(this.root, destination).split(path.sep).join('/'), reused: true }
      }
      try { await fsp.rename(temporary, destination) } catch (error) {
        if (!fs.existsSync(destination)) throw error
        const targetStat = await fsp.stat(destination)
        if (targetStat.size !== bytes || await hashFile(destination) !== digest) throw new Error('Conflito ao publicar mídia.')
        await fsp.unlink(temporary).catch(() => undefined)
        return { sha256: digest, byteLength: bytes, mimeType, extension: extension.toLowerCase(), relativePath: path.relative(this.root, destination).split(path.sep).join('/'), reused: true }
      }
      return { sha256: digest, byteLength: bytes, mimeType, extension: extension.toLowerCase(), relativePath: path.relative(this.root, destination).split(path.sep).join('/'), reused: false }
    } catch (error) {
      await fsp.unlink(temporary).catch(() => undefined)
      throw error
    }
  }

  async createPngThumbnail(bytes, { maxDimension = 384 } = {}) {
    if (!Buffer.isBuffer(bytes) || !Number.isSafeInteger(maxDimension) || maxDimension < 32 || maxDimension > 2048) throw new Error('Pedido de miniatura inválido.')
    const sharp = require('sharp')
    const sourceHash = sha256(bytes)
    const output = await sharp(bytes, { limitInputPixels: 100_000_000, failOn: 'error' })
      .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9, effort: 10, adaptiveFiltering: true }).toBuffer()
    const thumbnailHash = sha256(output)
    const destination = path.join(this.thumbnailsRoot, `png-v1-${sourceHash}-${maxDimension}.png`)
    if (!isWithin(this.root, destination)) throw new Error('Miniatura fora de app-data.')
    await ensureSafeDirectory(this.root, this.thumbnailsRoot)
    if (fs.existsSync(destination)) {
      const current = await fsp.readFile(destination)
      if (sha256(current) !== thumbnailHash) throw new Error('Miniatura existente divergente; geração interrompida.')
      return { path: path.relative(this.root, destination).split(path.sep).join('/'), sha256: thumbnailHash, byteLength: output.length, reused: true }
    }
    const temporary = path.join(this.tempRoot, `thumbnail-${crypto.randomUUID()}.tmp`)
    await ensureSafeDirectory(this.root, this.tempRoot)
    try {
      await fsp.writeFile(temporary, output, { flag: 'wx' })
      await fsp.rename(temporary, destination)
    } catch (error) {
      await fsp.unlink(temporary).catch(() => undefined)
      if (!fs.existsSync(destination)) throw error
      const current = await fsp.readFile(destination)
      if (sha256(current) !== thumbnailHash) throw new Error('Conflito ao publicar miniatura.')
      return { path: path.relative(this.root, destination).split(path.sep).join('/'), sha256: thumbnailHash, byteLength: current.length, reused: true }
    }
    return { path: path.relative(this.root, destination).split(path.sep).join('/'), sha256: thumbnailHash, byteLength: output.length, reused: false }
  }

  async createPngThumbnailFromFile(sourcePath, { maxDimension = 384 } = {}) {
    if (!Number.isSafeInteger(maxDimension) || maxDimension < 32 || maxDimension > 2048) throw new Error('Pedido de miniatura inválido.')
    const sharp = require('sharp')
    const source = path.resolve(sourcePath)
    const sourceHash = await hashFile(source)
    const destination = path.join(this.thumbnailsRoot, `png-v1-${sourceHash}-${maxDimension}.png`)
    if (!isWithin(this.root, destination)) throw new Error('Miniatura fora de app-data.')
    await ensureSafeDirectory(this.root, this.thumbnailsRoot)
    await ensureSafeDirectory(this.root, this.tempRoot)
    if (fs.existsSync(destination)) {
      const bytes = await fsp.readFile(destination)
      return { path: path.relative(this.root, destination).split(path.sep).join('/'), sha256: sha256(bytes), byteLength: bytes.length, reused: true }
    }
    const temporary = path.join(this.tempRoot, `thumbnail-${crypto.randomUUID()}.tmp`)
    try {
      await sharp(source, { limitInputPixels: 100_000_000, failOn: 'error' })
        .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9, effort: 10, adaptiveFiltering: true }).toFile(temporary)
      const digest = await hashFile(temporary)
      const stat = await fsp.stat(temporary)
      try { await fsp.rename(temporary, destination) } catch (error) {
        if (!fs.existsSync(destination)) throw error
        if (await hashFile(destination) !== digest) throw new Error('Conflito ao publicar miniatura.')
        await fsp.unlink(temporary).catch(() => undefined)
      }
      return { path: path.relative(this.root, destination).split(path.sep).join('/'), sha256: digest, byteLength: stat.size, reused: false }
    } catch (error) {
      await fsp.unlink(temporary).catch(() => undefined)
      throw error
    }
  }

  async evaluateLosslessPng(bytes) {
    if (!Buffer.isBuffer(bytes)) throw new Error('PNG inválido.')
    const sharp = require('sharp')
    const startedAt = process.hrtime.bigint()
    const source = sharp(bytes, { limitInputPixels: 100_000_000, failOn: 'error' })
    const metadata = await source.metadata()
    if (metadata.format !== 'png') throw new Error('A avaliação lossless aceita somente PNG.')
    const originalPixels = await sharp(bytes).ensureAlpha().raw().toBuffer()
    const candidate = await sharp(bytes).png({ compressionLevel: 9, effort: 10, adaptiveFiltering: true }).toBuffer()
    const candidatePixels = await sharp(candidate).ensureAlpha().raw().toBuffer()
    const pixelIdentical = originalPixels.equals(candidatePixels)
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
    return { pixelIdentical, originalBytes: bytes.length, candidateBytes: candidate.length, durationMs,
      savedBytes: pixelIdentical ? Math.max(0, bytes.length - candidate.length) : 0,
      candidate, originalSha256: sha256(bytes), candidateSha256: sha256(candidate) }
  }
}

const USAGE_GROUPS = {
  characters: ['user-data/customizer', 'characters'],
  libraries: ['user-data/fabricator', 'libraries'],
  projects: ['user-data/studios', 'user-data/video-studios', 'projects'],
  media: ['media'],
  database: ['database'],
  backups: ['backups'],
  cache: ['cache', ...[
    'Cache', 'Code Cache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GPUCache',
    'GPUPersistentCache', 'GrShaderCache', 'ShaderCache', 'VideoDecodeStats', 'blob_storage', 'Shared Dictionary'
  ].map((name) => `user-data/${name}`)],
  temporary: ['temp'],
  operations: ['logs', 'crash-dumps', 'manifests', 'migration-manifest.json'],
  other: [],
  profile: ['user-data']
}

async function measureTree(root) {
  let files = 0; let bytes = 0; let unreadable = 0
  try {
    const rootStat = await fsp.lstat(root)
    if (rootStat.isSymbolicLink()) return { files, bytes, unreadable }
    if (rootStat.isFile()) return { files: 1, bytes: rootStat.size, unreadable }
  } catch (error) {
    if (error.code === 'ENOENT') return { files, bytes, unreadable }
    unreadable += 1; return { files, bytes, unreadable }
  }
  async function walk(folder) {
    let entries
    try { entries = await fsp.readdir(folder, { withFileTypes: true }) } catch (error) {
      if (error.code === 'ENOENT') return
      unreadable += 1; return
    }
    for (const entry of entries) {
      const absolute = path.join(folder, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) { await walk(absolute); continue }
      if (!entry.isFile()) continue
      try {
        const stat = await fsp.stat(absolute)
        files += 1; bytes += stat.size
      } catch { unreadable += 1 }
    }
  }
  await walk(root)
  return { files, bytes, unreadable }
}

async function getAppDataUsage(dataRoot) {
  const root = path.resolve(dataRoot)
  const rootStat = await fsp.lstat(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || path.resolve(root) !== await fsp.realpath(root)) throw new Error('Raiz app-data não canônica.')
  const result = {}
  for (const [group, relatives] of Object.entries(USAGE_GROUPS)) {
    const accountedRootEntries = new Set(Object.values(USAGE_GROUPS).flat().filter(Boolean).map((relative) => relative.split('/')[0]))
    const roots = group === 'other'
      ? (await fsp.readdir(root, { withFileTypes: true })).filter((entry) => !accountedRootEntries.has(entry.name) && !entry.isSymbolicLink()).map((entry) => path.join(root, entry.name))
      : group === 'profile'
      ? relatives.map((relative) => path.join(root, relative)).filter((candidate) => fs.existsSync(candidate)).flatMap((profileRoot) => {
        const excluded = new Set(Object.values(USAGE_GROUPS).flat().filter((entry) => entry.startsWith('user-data/')).map((entry) => entry.slice('user-data/'.length)))
        if (path.basename(profileRoot) !== 'user-data') return [profileRoot]
        return fs.readdirSync(profileRoot, { withFileTypes: true })
          .filter((entry) => !excluded.has(entry.name) && !entry.isSymbolicLink())
          .map((entry) => path.join(profileRoot, entry.name))
      })
      : relatives.map((relative) => path.join(root, relative))
    const totals = await Promise.all(roots.map(measureTree))
    result[group] = totals.reduce((sum, item) => ({ files: sum.files + item.files, bytes: sum.bytes + item.bytes, unreadable: sum.unreadable + item.unreadable }), { files: 0, bytes: 0, unreadable: 0 })
  }
  return { groups: result, measuredAt: new Date().toISOString() }
}

async function registerObjectMetadata(catalog, assetId, object, role = 'original') {
  const db = catalog.assertReady()
  const relative = object.relativePath
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('Caminho relativo de objeto inválido.')
  const absolute = path.resolve(catalog.root, relative)
  if (!isWithin(catalog.root, absolute)) throw new Error('Referência de objeto fora de app-data.')
  if (absolute !== await fsp.realpath(absolute)) throw new Error('Referência de objeto não canônica recusada.')
  const stat = await fsp.stat(absolute)
  if (!stat.isFile() || stat.size !== object.byteLength || await hashFile(absolute) !== object.sha256) throw new Error('Objeto não passou na validação de tamanho e SHA-256.')
  db.prepare(`INSERT OR IGNORE INTO objects(sha256, byte_length, mime_type, extension, relative_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run(object.sha256, object.byteLength, object.mimeType, object.extension ?? path.extname(relative), relative, new Date().toISOString())
  catalog.linkObject({ assetId, sha256: object.sha256, role })
}

async function createDatabaseSnapshot(catalog, destination) {
  const db = catalog.assertReady()
  const absolute = path.resolve(destination)
  if (!isWithin(path.join(catalog.root, 'backups'), absolute)) throw new Error('Snapshot precisa ficar dentro de app-data/backups.')
  await ensureSafeDirectory(catalog.root, path.dirname(absolute))
  if (fs.existsSync(absolute)) throw new Error('Snapshot existente não será sobrescrito.')
  const temporary = `${absolute}.${crypto.randomUUID()}.tmp`
  try {
    await db.backup(temporary)
    const verify = new Database(temporary, { readonly: true })
    try {
      if (verify.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Snapshot SQLite falhou na verificação de integridade.')
    } finally { verify.close() }
    await fsp.rename(temporary, absolute)
  } catch (error) {
    await fsp.unlink(temporary).catch(() => undefined)
    throw error
  }
  const snapshotStat = await fsp.stat(absolute)
  return { path: path.relative(catalog.root, absolute).split(path.sep).join('/'), byteLength: snapshotStat.size, sha256: await hashFile(absolute) }
}

module.exports = { BUILTIN_DOMAINS, ContentAddressedStore, DataPlatform, createDatabaseSnapshot, getAppDataUsage, registerObjectMetadata, sha256 }
