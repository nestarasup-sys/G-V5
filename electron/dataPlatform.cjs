const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { createReadStream, createWriteStream } = require('node:fs')
const { Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const Database = require('better-sqlite3')
const { normalizeImageBuffer } = require('./imageIngestion.cjs')

const BUILTIN_DOMAINS = [
  'fabricator.models', 'fabricator.poses', 'fabricator.animations', 'fabricator.wardrobe', 'fabricator.design-settings',
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

function categoryHslColor(hue) {
  const saturation = 0.62
  const lightness = 0.52
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const segment = hue / 60
  const secondary = chroma * (1 - Math.abs(segment % 2 - 1))
  const rgb = segment < 1 ? [chroma, secondary, 0] : segment < 2 ? [secondary, chroma, 0] : segment < 3 ? [0, chroma, secondary] : segment < 4 ? [0, secondary, chroma] : segment < 5 ? [secondary, 0, chroma] : [chroma, 0, secondary]
  const offset = lightness - chroma / 2
  return `#${rgb.map((channel) => Math.round((channel + offset) * 255).toString(16).padStart(2, '0')).join('')}`
}

function nextCategoryColor(usedColors) {
  const palette = ['#dc5368', '#e58b3a', '#b39a32', '#4d9b68', '#279e9b', '#3988c7', '#5262bd', '#8559c5', '#c14d9d', '#8a684f', '#536f8b', '#698b42', '#d36b48', '#3c9ab8', '#a84e69', '#7663c2']
  for (const color of palette) if (!usedColors.has(color)) return color
  for (let index = 0; index < 10000; index += 1) {
    const color = categoryHslColor((index * 137.508) % 360)
    if (!usedColors.has(color)) return color
  }
  throw new Error('Não foi possível gerar uma cor exclusiva para a categoria.')
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
  // Domain files preserve their original logical filenames. Some existing
  // sidecars use descriptive suffixes such as `.before-head-shape`; CAS object
  // paths are hash-only, so allowing a bounded alphanumeric suffix is safe.
  if (typeof value !== 'string' || !/^\.[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/i.test(value)) throw new Error('Extensão de asset inválida.')
  return value.toLowerCase()
}

function normalizeDomainPath(value, allowEmpty = false) {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error('Caminho lógico inválido.')
  const normalized = value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!normalized && allowEmpty) return ''
  if (!normalized || normalized.split('/').some((part) => !part || part === '.' || part === '..' || /^[a-z]:$/i.test(part))) {
    throw new Error('Caminho lógico fora do domínio.')
  }
  return normalized
}

function escapeLike(value) { return value.replace(/[\\%_]/g, '\\$&') }

function mimeFromExtension(extension) {
  return ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.m4v': 'video/x-m4v', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
    '.json': 'application/json', '.txt': 'text/plain' })[extension] ?? 'application/octet-stream'
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
    this.imageIngestCache = new Map()
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
    if (currentSchema > 16) {
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
      CREATE TABLE IF NOT EXISTS roteiros (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        video_title TEXT NOT NULL,
        character_ids_json TEXT NOT NULL,
        background_asset_id TEXT,
        ui_gif_asset_id TEXT,
        preview_details_collapsed INTEGER NOT NULL DEFAULT 0 CHECK(preview_details_collapsed IN (0, 1)),
        position INTEGER NOT NULL CHECK(position >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS roteiro_tiktoks (
        id TEXT PRIMARY KEY,
        roteiro_id TEXT NOT NULL REFERENCES roteiros(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        video_title TEXT NOT NULL,
        position INTEGER NOT NULL CHECK(position >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(roteiro_id, position)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS roteiro_tiktoks_by_parent_order ON roteiro_tiktoks(roteiro_id, position);
      CREATE TABLE IF NOT EXISTS roteiro_sections (
        section_id TEXT PRIMARY KEY,
        roteiro_id TEXT NOT NULL REFERENCES roteiros(id) ON DELETE CASCADE,
        section_kind TEXT NOT NULL CHECK(section_kind IN ('opening', 'tiktok')),
        video_asset_json TEXT,
        blocks_json TEXT NOT NULL DEFAULT '[]',
        description_text TEXT NOT NULL DEFAULT '',
        timeline TEXT NOT NULL DEFAULT 'unspecified' CHECK(timeline IN ('unspecified', 'past', 'present', 'future')),
        scene_end_seconds REAL,
        first_group_reaction_seconds REAL,
        second_group_reaction_seconds REAL,
        additional_context TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS roteiro_sections_by_parent ON roteiro_sections(roteiro_id, section_kind);
      CREATE TABLE IF NOT EXISTS base_video_details (
        video_id TEXT PRIMARY KEY,
        video_number INTEGER,
        description_text TEXT NOT NULL DEFAULT '',
        timeline TEXT NOT NULL DEFAULT 'unspecified' CHECK(timeline IN ('unspecified', 'past', 'present', 'future')),
        scene_end_seconds REAL,
        first_group_reaction_seconds REAL,
        second_group_reaction_seconds REAL,
        additional_context TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS base_video_categories (
        category_id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        color_hex TEXT NOT NULL DEFAULT '#7955c4',
        created_at TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS base_video_category_assignments (
        video_id TEXT PRIMARY KEY REFERENCES base_video_details(video_id) ON DELETE CASCADE,
        category_id TEXT NOT NULL REFERENCES base_video_categories(category_id) ON DELETE CASCADE,
        assigned_at TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS base_video_category_by_category ON base_video_category_assignments(category_id);
      CREATE TABLE IF NOT EXISTS roteiro_export_logs (
        id TEXT PRIMARY KEY,
        roteiro_id TEXT NOT NULL REFERENCES roteiros(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('success', 'error')),
        details TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS roteiro_export_logs_by_parent ON roteiro_export_logs(roteiro_id, created_at DESC, id DESC);
      CREATE TABLE IF NOT EXISTS base_video_sequence (
        sequence_id INTEGER PRIMARY KEY CHECK(sequence_id = 1),
        next_number INTEGER NOT NULL CHECK(next_number > 0)
      );
      CREATE TABLE IF NOT EXISTS domain_files (
        domain_id TEXT NOT NULL REFERENCES domains(domain_id),
        relative_path TEXT NOT NULL,
        content_text TEXT,
        object_sha256 TEXT REFERENCES objects(sha256),
        byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
        content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64),
        updated_at TEXT NOT NULL,
        PRIMARY KEY(domain_id, relative_path),
        CHECK ((content_text IS NULL) <> (object_sha256 IS NULL))
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS domain_image_refs (
        domain_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        json_pointer TEXT NOT NULL,
        object_sha256 TEXT NOT NULL REFERENCES objects(sha256),
        PRIMARY KEY(domain_id, relative_path, json_pointer),
        FOREIGN KEY(domain_id, relative_path) REFERENCES domain_files(domain_id, relative_path) ON DELETE CASCADE
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS domain_image_refs_by_object ON domain_image_refs(object_sha256);
      CREATE INDEX IF NOT EXISTS domain_files_by_domain_path ON domain_files(domain_id, relative_path);
      CREATE TABLE IF NOT EXISTS domain_directories (
        domain_id TEXT NOT NULL REFERENCES domains(domain_id),
        relative_path TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(domain_id, relative_path)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS domain_storage_state (
        domain_id TEXT PRIMARY KEY REFERENCES domains(domain_id),
        state TEXT NOT NULL CHECK(state IN ('legacy', 'migrating', 'active', 'verified')),
        manifest_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS migration_runs (
        id TEXT PRIMARY KEY,
        state TEXT NOT NULL CHECK(state IN ('prepared', 'copying', 'copied', 'verified', 'cutover', 'complete', 'failed')),
        manifest_json TEXT NOT NULL,
        error_text TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) WITHOUT ROWID;
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
    this.database.prepare(`INSERT OR IGNORE INTO schema_migrations(version, name, checksum, applied_at) VALUES (2, 'domain-file-store-and-migration-journal', ?, ?)`)
      .run(sha256('gacha-domain-files-schema-v2'), now)
    this.database.prepare(`INSERT OR IGNORE INTO schema_migrations(version, name, checksum, applied_at) VALUES (3, 'canonical-image-references', ?, ?)`)
      .run(sha256('gacha-canonical-image-references-schema-v3'), now)
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version, name, checksum, applied_at) VALUES (4, 'roteiros-and-tiktoks-sqlite-store', ?, ?)")
      .run(sha256('gacha-roteiros-sqlite-schema-v4'), now)
    const roteiroColumns = new Set(this.database.prepare('PRAGMA table_info(roteiros)').all().map((column) => column.name))
    if (!roteiroColumns.has('position')) {
      this.database.exec('ALTER TABLE roteiros ADD COLUMN position INTEGER NOT NULL DEFAULT 0 CHECK(position >= 0)')
      const existingRoutes = this.database.prepare('SELECT id FROM roteiros ORDER BY created_at, id').all()
      const updatePosition = this.database.prepare('UPDATE roteiros SET position = ? WHERE id = ?')
      this.database.transaction(() => existingRoutes.forEach((route, index) => updatePosition.run(index, route.id)))()
    }
    if (!roteiroColumns.has('background_asset_id')) this.database.exec('ALTER TABLE roteiros ADD COLUMN background_asset_id TEXT')
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version, name, checksum, applied_at) VALUES (10, 'roteiro-background-library-reference', ?, ?)")
      .run(sha256('gacha-roteiro-background-library-reference-schema-v10'), now)
    if (!roteiroColumns.has('ui_gif_asset_id')) this.database.exec('ALTER TABLE roteiros ADD COLUMN ui_gif_asset_id TEXT')
    if (!roteiroColumns.has('preview_details_collapsed')) this.database.exec('ALTER TABLE roteiros ADD COLUMN preview_details_collapsed INTEGER NOT NULL DEFAULT 0 CHECK(preview_details_collapsed IN (0, 1))')
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version, name, checksum, applied_at) VALUES (11, 'roteiro-ui-gif-library-reference', ?, ?)")
      .run(sha256('gacha-roteiro-ui-gif-library-reference-schema-v11'), now)
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version, name, checksum, applied_at) VALUES (5, 'roteiros-position-compatibility', ?, ?)")
      .run(sha256('gacha-roteiros-position-compatibility-schema-v5'), now)
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version, name, checksum, applied_at) VALUES (6, 'roteiro-section-content-and-blocks', ?, ?)")
      .run(sha256('gacha-roteiro-section-content-and-blocks-schema-v6'), now)
    const sectionColumns = new Set(this.database.prepare('PRAGMA table_info(roteiro_sections)').all().map((column) => column.name))
    if (!sectionColumns.has('description_text')) this.database.exec("ALTER TABLE roteiro_sections ADD COLUMN description_text TEXT NOT NULL DEFAULT ''")
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version, name, checksum, applied_at) VALUES (7, 'roteiro-section-video-description', ?, ?)")
      .run(sha256('gacha-roteiro-section-video-description-schema-v7'), now)
    if (!sectionColumns.has('timeline')) this.database.exec("ALTER TABLE roteiro_sections ADD COLUMN timeline TEXT NOT NULL DEFAULT 'unspecified' CHECK(timeline IN ('unspecified', 'past', 'present', 'future'))")
    if (!sectionColumns.has('scene_end_seconds')) this.database.exec('ALTER TABLE roteiro_sections ADD COLUMN scene_end_seconds REAL')
    if (!sectionColumns.has('first_group_reaction_seconds')) this.database.exec('ALTER TABLE roteiro_sections ADD COLUMN first_group_reaction_seconds REAL')
    if (!sectionColumns.has('second_group_reaction_seconds')) this.database.exec('ALTER TABLE roteiro_sections ADD COLUMN second_group_reaction_seconds REAL')
    if (!sectionColumns.has('additional_context')) this.database.exec("ALTER TABLE roteiro_sections ADD COLUMN additional_context TEXT NOT NULL DEFAULT ''")
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version, name, checksum, applied_at) VALUES (8, 'roteiro-section-timeline-and-reaction-timing', ?, ?)")
      .run(sha256('gacha-roteiro-section-timeline-and-reaction-timing-schema-v8'), now)
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version, name, checksum, applied_at) VALUES (9, 'base-video-details', ?, ?)")
      .run(sha256('gacha-base-video-details-schema-v9'), now)
    const baseVideoColumns = new Set(this.database.prepare('PRAGMA table_info(base_video_details)').all().map((column) => column.name))
    if (!baseVideoColumns.has('video_number')) this.database.exec('ALTER TABLE base_video_details ADD COLUMN video_number INTEGER')
    if (!baseVideoColumns.has('additional_context')) this.database.exec("ALTER TABLE base_video_details ADD COLUMN additional_context TEXT NOT NULL DEFAULT ''")
    this.database.exec('CREATE UNIQUE INDEX IF NOT EXISTS base_video_details_by_number ON base_video_details(video_number) WHERE video_number IS NOT NULL')
    this.database.exec('INSERT OR IGNORE INTO base_video_sequence(sequence_id, next_number) SELECT 1, COALESCE(MAX(video_number), 0) + 1 FROM base_video_details')
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version, name, checksum, applied_at) VALUES (10, 'base-video-stable-sequence-numbers', ?, ?)")
      .run(sha256('gacha-base-video-stable-sequence-numbers-schema-v10'), now)
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version, name, checksum, applied_at) VALUES (12, 'roteiro-ai-additional-context', ?, ?)")
      .run(sha256('gacha-roteiro-ai-additional-context-schema-v12'), now)
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version, name, checksum, applied_at) VALUES (13, 'roteiro-preview-details-collapsed', ?, ?)")
      .run(sha256('gacha-roteiro-preview-details-collapsed-schema-v13'), now)
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version, name, checksum, applied_at) VALUES (14, 'base-video-categories', ?, ?)")
      .run(sha256('gacha-base-video-categories-schema-v14'), now)
    const categoryColumns = new Set(this.database.prepare('PRAGMA table_info(base_video_categories)').all().map((column) => column.name))
    if (!categoryColumns.has('color_hex')) {
      this.database.exec("ALTER TABLE base_video_categories ADD COLUMN color_hex TEXT NOT NULL DEFAULT '#7955c4'")
      const categoryRows = this.database.prepare('SELECT category_id FROM base_video_categories ORDER BY created_at, category_id').all()
      const assignColor = this.database.prepare('UPDATE base_video_categories SET color_hex=? WHERE category_id=?')
      const migrationUsedColors = new Set()
      this.database.transaction(() => categoryRows.forEach((row) => {
        const color = nextCategoryColor(migrationUsedColors)
        migrationUsedColors.add(color)
        assignColor.run(color, row.category_id)
      }))()
    }
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version, name, checksum, applied_at) VALUES (15, 'base-video-category-colors', ?, ?)")
      .run(sha256('gacha-base-video-category-colors-schema-v15'), now)
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations(version, name, checksum, applied_at) VALUES (16, 'roteiro-export-log-persistence', ?, ?)")
      .run(sha256('gacha-roteiro-export-log-persistence-schema-v16'), now)
    if (currentSchema < 16) this.database.pragma('user_version = 16')
    const insertDomain = this.database.prepare(`INSERT OR IGNORE INTO domains(domain_id, schema_version, manifest_json, updated_at) VALUES (?, 1, '{}', ?)`)
    const registerBuiltins = this.database.transaction(() => BUILTIN_DOMAINS.forEach((id) => insertDomain.run(id, now)))
    registerBuiltins()
    this.database.prepare("INSERT OR IGNORE INTO app_metadata(key, value) VALUES ('schema_version', '1')").run()
    this.database.prepare("UPDATE app_metadata SET value='16' WHERE key='schema_version'").run()
    this.migrateRoteirosJson()
    return this
  }

  migrateRoteirosJson() {
    const db = this.assertReady()
    const migrationKey = 'roteiros-json-to-sqlite-v1'
    if (db.prepare('SELECT 1 FROM app_metadata WHERE key=?').get(migrationKey)) return
    const source = path.join(this.root, 'projects', 'roteiros', 'library.json')
    let documents = []
    let sourceSha256 = null
    if (fs.existsSync(source)) {
      const contents = fs.readFileSync(source, 'utf8')
      sourceSha256 = sha256(contents)
      let parsed
      try { parsed = JSON.parse(contents) }
      catch { throw new Error('O arquivo antigo de roteiros não contém JSON válido; ele foi preservado sem alterações.') }
      if (!Array.isArray(parsed) || parsed.length > 2000) {
        throw new Error('O arquivo antigo de roteiros tem formato ou quantidade inválida; ele foi preservado sem alterações.')
      }
      const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
      const isText = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 100
      documents = parsed.map((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
        ? { ...entry, tiktoks: entry.tiktoks ?? [] }
        : entry)
      const routeIds = new Set()
      const tiktokIds = new Set()
      for (const roteiro of documents) {
        if (!roteiro || typeof roteiro !== 'object' || !isUuid(roteiro.id) || !isText(roteiro.title) || !isText(roteiro.videoTitle)
          || !Array.isArray(roteiro.characterIds) || roteiro.characterIds.length > 500 || !roteiro.characterIds.every(isUuid)
          || !Array.isArray(roteiro.tiktoks) || roteiro.tiktoks.length > 500 || routeIds.has(roteiro.id)) {
          throw new Error('Foram encontrados dados inválidos ou IDs repetidos no arquivo antigo de roteiros; ele foi preservado sem alterações.')
        }
        routeIds.add(roteiro.id)
        for (const tiktok of roteiro.tiktoks) {
          if (!tiktok || !isUuid(tiktok.id) || !isText(tiktok.title) || !isText(tiktok.videoTitle) || tiktokIds.has(tiktok.id)) {
            throw new Error('Foram encontrados TikToks inválidos ou IDs repetidos no arquivo antigo; ele foi preservado sem alterações.')
          }
          tiktokIds.add(tiktok.id)
        }
      }
    }

    const now = new Date().toISOString()
    const insertRoteiro = db.prepare('INSERT OR IGNORE INTO roteiros(id, title, video_title, character_ids_json, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    const insertTikTok = db.prepare('INSERT OR IGNORE INTO roteiro_tiktoks(id, roteiro_id, title, video_title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    const migrate = db.transaction(() => {
      documents.forEach((roteiro, position) => {
        const inserted = insertRoteiro.run(roteiro.id, roteiro.title.trim(), roteiro.videoTitle.trim(), JSON.stringify(roteiro.characterIds), position, now, now).changes
        if (!inserted) return
        roteiro.tiktoks.forEach((tiktok, tiktokPosition) => {
          insertTikTok.run(tiktok.id, roteiro.id, tiktok.title.trim(), tiktok.videoTitle.trim(), tiktokPosition, now, now)
        })
      })
      db.prepare('INSERT INTO app_metadata(key, value) VALUES (?, ?)')
        .run(migrationKey, JSON.stringify({ migratedAt: now, sourceSha256, roteiroCount: documents.length }))
    })
    migrate()
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

  setDomainState(domainId, state, manifest = {}) {
    validateDomainId(domainId)
    if (!['legacy', 'migrating', 'active', 'verified'].includes(state)) throw new Error('Estado de armazenamento inválido.')
    const db = this.assertReady()
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO domain_storage_state(domain_id, state, manifest_json, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(domain_id) DO UPDATE SET state=excluded.state, manifest_json=excluded.manifest_json, updated_at=excluded.updated_at`)
      .run(domainId, state, JSON.stringify(manifest), now)
  }

  getDomainState(domainId) {
    validateDomainId(domainId)
    const row = this.assertReady().prepare('SELECT state, manifest_json, updated_at FROM domain_storage_state WHERE domain_id=?').get(domainId)
    return row ? { state: row.state, manifest: JSON.parse(row.manifest_json), updatedAt: row.updated_at } : { state: 'legacy', manifest: {}, updatedAt: null }
  }

  beginMigration({ id, manifest }) {
    validateId(id, 'ID de migração')
    if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') throw new Error('Manifesto de migração inválido.')
    const now = new Date().toISOString()
    this.assertReady().prepare(`INSERT INTO migration_runs(id, state, manifest_json, error_text, created_at, updated_at)
      VALUES (?, 'prepared', ?, NULL, ?, ?)`).run(id, JSON.stringify(manifest), now, now)
  }

  updateMigration(id, { state, manifest, error = null }) {
    validateId(id, 'ID de migração')
    if (!['prepared', 'copying', 'copied', 'verified', 'cutover', 'complete', 'failed'].includes(state)) throw new Error('Estado de migração inválido.')
    const db = this.assertReady()
    const current = db.prepare('SELECT manifest_json FROM migration_runs WHERE id=?').get(id)
    if (!current) throw new Error('Migração não encontrada.')
    db.prepare('UPDATE migration_runs SET state=?, manifest_json=?, error_text=?, updated_at=? WHERE id=?')
      .run(state, JSON.stringify(manifest ?? JSON.parse(current.manifest_json)), typeof error === 'string' ? error.slice(0, 2000) : null, new Date().toISOString(), id)
  }

  getMigration(id) {
    validateId(id, 'ID de migração')
    const row = this.assertReady().prepare('SELECT * FROM migration_runs WHERE id=?').get(id)
    return row ? { id: row.id, state: row.state, manifest: JSON.parse(row.manifest_json), error: row.error_text, createdAt: row.created_at, updatedAt: row.updated_at } : null
  }

  migrationSummary() {
    const db = this.assertReady()
    return db.prepare(`SELECT d.domain_id AS domainId, coalesce(s.state, 'legacy') AS state, coalesce(s.manifest_json, '{}') AS manifest
      FROM domains d LEFT JOIN domain_storage_state s ON s.domain_id=d.domain_id ORDER BY d.domain_id`).all()
      .map((row) => ({ domainId: row.domainId, state: row.state, manifest: JSON.parse(row.manifest) }))
  }

  ensureDomainDirectory(domainId, relativePath = '') {
    validateDomainId(domainId)
    const normalized = normalizeDomainPath(relativePath, true)
    const db = this.assertReady()
    const now = new Date().toISOString()
    const segments = normalized ? normalized.split('/') : []
    const insert = db.prepare('INSERT OR IGNORE INTO domain_directories(domain_id, relative_path, updated_at) VALUES (?, ?, ?)')
    const txn = db.transaction(() => {
      insert.run(domainId, '', now)
      let current = ''
      for (const segment of segments) { current = current ? `${current}/${segment}` : segment; insert.run(domainId, current, now) }
    })
    txn()
  }

  hasDomainDirectory(domainId, relativePath = '') {
    validateDomainId(domainId)
    const normalized = normalizeDomainPath(relativePath, true)
    return Boolean(this.assertReady().prepare('SELECT 1 FROM domain_directories WHERE domain_id=? AND relative_path=?').get(domainId, normalized))
  }

  async writeDomainFile(domainId, relativePath, bytes, { text = false, imageRefs = [] } = {}) {
    validateDomainId(domainId)
    const normalized = normalizeDomainPath(relativePath)
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    const digest = sha256(buffer)
    let objectHash = null
    let contentText = null
    if (text) {
      contentText = buffer.toString('utf8')
      if (!Buffer.from(contentText, 'utf8').equals(buffer)) throw new Error('Arquivo textual não preserva bytes UTF-8.')
    } else {
      const extension = path.extname(normalized).toLowerCase() || '.bin'
      const object = await new ContentAddressedStore(this.root).putObject(buffer, { mimeType: mimeFromExtension(extension), extension })
      objectHash = object.sha256
      const db = this.assertReady()
      db.prepare(`INSERT OR IGNORE INTO objects(sha256, byte_length, mime_type, extension, relative_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(object.sha256, object.byteLength, object.mimeType, object.extension, object.relativePath, new Date().toISOString())
    }
    const db = this.assertReady()
    const now = new Date().toISOString()
    if (!Array.isArray(imageRefs) || imageRefs.some((ref) => !ref || typeof ref.pointer !== 'string' || !/^[a-f0-9]{64}$/.test(ref.sha256))) throw new Error('Referências de imagem inválidas.')
    const txn = db.transaction(() => {
      this.ensureDomainDirectory(domainId, path.posix.dirname(normalized) === '.' ? '' : path.posix.dirname(normalized))
      db.prepare(`INSERT INTO domain_files(domain_id, relative_path, content_text, object_sha256, byte_length, content_sha256, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(domain_id, relative_path) DO UPDATE SET content_text=excluded.content_text,
        object_sha256=excluded.object_sha256, byte_length=excluded.byte_length, content_sha256=excluded.content_sha256, updated_at=excluded.updated_at`)
        .run(domainId, normalized, contentText, objectHash, buffer.length, digest, now)
      db.prepare('DELETE FROM domain_image_refs WHERE domain_id=? AND relative_path=?').run(domainId, normalized)
      const insertImageRef = db.prepare('INSERT INTO domain_image_refs(domain_id, relative_path, json_pointer, object_sha256) VALUES (?, ?, ?, ?)')
      for (const ref of imageRefs) insertImageRef.run(domainId, normalized, ref.pointer, ref.sha256)
    })
    txn()
    return { relativePath: normalized, byteLength: buffer.length, sha256: digest, objectSha256: objectHash }
  }

  async readDomainFile(domainId, relativePath) {
    validateDomainId(domainId)
    const normalized = normalizeDomainPath(relativePath)
    const row = this.assertReady().prepare('SELECT * FROM domain_files WHERE domain_id=? AND relative_path=?').get(domainId, normalized)
    if (!row) return null
    let bytes
    if (row.content_text !== null) bytes = Buffer.from(row.content_text, 'utf8')
    else {
      const object = this.assertReady().prepare('SELECT relative_path FROM objects WHERE sha256=?').get(row.object_sha256)
      if (!object) throw new Error(`Objeto do arquivo ausente: ${normalized}`)
      const absolute = path.resolve(this.root, object.relative_path)
      if (!isWithin(this.root, absolute)) throw new Error('Objeto armazenado fora de app-data.')
      bytes = await fsp.readFile(absolute)
    }
    if (bytes.length !== row.byte_length || sha256(bytes) !== row.content_sha256) throw new Error(`Integridade do arquivo falhou: ${normalized}`)
    return bytes
  }

  async ingestImage(bytes) {
    const sourceHash = sha256(bytes)
    const cached = this.imageIngestCache.get(sourceHash)
    if (cached) return { ...cached, reused: true }
    const normalized = await normalizeImageBuffer(bytes)
    const object = await new ContentAddressedStore(this.root).putObject(normalized.bytes, { mimeType: 'image/png', extension: '.png' })
    this.assertReady().prepare(`INSERT OR IGNORE INTO objects(sha256, byte_length, mime_type, extension, relative_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(object.sha256, object.byteLength, object.mimeType, object.extension, object.relativePath, new Date().toISOString())
    const result = { ...normalized, sha256: object.sha256, reused: object.reused }
    this.imageIngestCache.set(sourceHash, result)
    if (this.imageIngestCache.size > 512) this.imageIngestCache.delete(this.imageIngestCache.keys().next().value)
    return result
  }

  async storeGeneratedImage(bytes) {
    const sharp = require('sharp')
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? [])
    if (!buffer.length || buffer.length > 50 * 1024 * 1024) throw new Error('Imagem gerada vazia ou acima do limite permitido.')
    let metadata
    try { metadata = await sharp(buffer, { limitInputPixels: 32_000_000, failOn: 'error', animated: true }).metadata() }
    catch (reason) { throw new Error(`Imagem gerada inválida ou corrompida: ${reason?.message ?? 'erro de decodificação'}`) }
    if (!['png', 'jpeg', 'webp'].includes(metadata.format) || (metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height
      || metadata.width * metadata.height > 32_000_000) throw new Error('A saída gerada precisa ser PNG estático dentro do limite de pixels.')
    let png = buffer
    if (metadata.format !== 'png') {
      png = await sharp(buffer, { limitInputPixels: 32_000_000, failOn: 'error' }).rotate().toColourspace('srgb')
        .ensureAlpha().png({ compressionLevel: 9, adaptiveFiltering: true, palette: false }).toBuffer()
      if (png.length > 50 * 1024 * 1024) throw new Error('O PNG gerado excede o limite permitido.')
    }
    const object = await new ContentAddressedStore(this.root).putObject(png, { mimeType: 'image/png', extension: '.png' })
    this.assertReady().prepare(`INSERT OR IGNORE INTO objects(sha256, byte_length, mime_type, extension, relative_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(object.sha256, object.byteLength, object.mimeType, object.extension, object.relativePath, new Date().toISOString())
    const output = await sharp(png, { limitInputPixels: 32_000_000, failOn: 'error' }).metadata()
    return { sha256: object.sha256, byteLength: object.byteLength, width: output.width, height: output.height, reused: object.reused }
  }

  async readObject(hash) {
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Hash de imagem inválido.')
    const row = this.assertReady().prepare('SELECT relative_path, byte_length FROM objects WHERE sha256=?').get(hash)
    if (!row) throw new Error('Imagem referenciada não encontrada no catálogo.')
    const absolute = path.resolve(this.root, row.relative_path)
    if (!isWithin(this.root, absolute)) throw new Error('Imagem referenciada fora de app-data.')
    const bytes = await fsp.readFile(absolute)
    if (bytes.length !== row.byte_length || sha256(bytes) !== hash) throw new Error('A imagem canônica falhou na verificação de integridade.')
    return bytes
  }

  listDomainFiles(domainId, prefix = '') {
    validateDomainId(domainId)
    const normalized = normalizeDomainPath(prefix, true)
    const rows = normalized
      ? this.assertReady().prepare(`SELECT relative_path, byte_length, content_sha256, object_sha256 FROM domain_files WHERE domain_id=? AND (relative_path=? OR relative_path LIKE ? ESCAPE '\\') ORDER BY relative_path`)
        .all(domainId, normalized, `${escapeLike(normalized)}/%`)
      : this.assertReady().prepare('SELECT relative_path, byte_length, content_sha256, object_sha256 FROM domain_files WHERE domain_id=? ORDER BY relative_path').all(domainId)
    return rows.map((row) => ({ relativePath: row.relative_path, byteLength: row.byte_length, sha256: row.content_sha256, objectSha256: row.object_sha256 }))
  }

  listDomainDirectory(domainId, relativePath = '') {
    validateDomainId(domainId)
    const normalized = normalizeDomainPath(relativePath, true)
    const prefix = normalized ? `${normalized}/` : ''
    const rows = this.listDomainFiles(domainId, normalized)
    const names = new Map()
    for (const row of rows) {
      const rest = row.relativePath.startsWith(prefix) ? row.relativePath.slice(prefix.length) : ''
      if (!rest) continue
      const [name, ...tail] = rest.split('/')
      if (!names.has(name)) names.set(name, { name, directory: tail.length > 0, file: tail.length === 0 })
      else if (tail.length > 0) names.get(name).directory = true
    }
    const dirRows = this.assertReady().prepare('SELECT relative_path FROM domain_directories WHERE domain_id=? AND relative_path LIKE ? ESCAPE \'\\\' ORDER BY relative_path')
      .all(domainId, `${escapeLike(prefix)}%`)
    for (const row of dirRows) {
      const rest = row.relative_path.startsWith(prefix) ? row.relative_path.slice(prefix.length) : ''
      if (!rest) continue
      const [name] = rest.split('/')
      if (!names.has(name)) names.set(name, { name, directory: true, file: false })
      else names.get(name).directory = true
    }
    return [...names.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  removeDomainPath(domainId, relativePath, recursive = false) {
    validateDomainId(domainId)
    const normalized = normalizeDomainPath(relativePath, true)
    if (!normalized) throw new Error('Não é permitido remover a raiz de um domínio.')
    const db = this.assertReady()
    const prefix = `${escapeLike(normalized)}/%`
    const txn = db.transaction(() => {
      const files = db.prepare(`SELECT relative_path FROM domain_files WHERE domain_id=? AND (relative_path=? OR relative_path LIKE ? ESCAPE '\\')`)
        .all(domainId, normalized, prefix)
      const dirs = db.prepare(`SELECT relative_path FROM domain_directories WHERE domain_id=? AND (relative_path=? OR relative_path LIKE ? ESCAPE '\\')`)
        .all(domainId, normalized, prefix)
      if (!recursive && (files.some((row) => row.relative_path !== normalized) || dirs.some((row) => row.relative_path !== normalized))) throw new Error('Diretório não está vazio.')
      db.prepare(`DELETE FROM domain_files WHERE domain_id=? AND (relative_path=? OR relative_path LIKE ? ESCAPE '\\')`).run(domainId, normalized, prefix)
      db.prepare(`DELETE FROM domain_directories WHERE domain_id=? AND (relative_path=? OR relative_path LIKE ? ESCAPE '\\')`).run(domainId, normalized, prefix)
    })
    txn()
  }

  renameDomainPath(domainId, fromPath, toPath) {
    validateDomainId(domainId)
    const from = normalizeDomainPath(fromPath, true); const to = normalizeDomainPath(toPath)
    if (!from) throw new Error('Não é permitido renomear a raiz de um domínio.')
    const db = this.assertReady(); const fromPrefix = `${escapeLike(from)}/%`; const toPrefix = `${to}/`
    const txn = db.transaction(() => {
      const files = db.prepare(`SELECT * FROM domain_files WHERE domain_id=? AND (relative_path=? OR relative_path LIKE ? ESCAPE '\\') ORDER BY relative_path`).all(domainId, from, fromPrefix)
      const refsByPath = new Map(files.map((row) => [row.relative_path,
        db.prepare('SELECT json_pointer, object_sha256 FROM domain_image_refs WHERE domain_id=? AND relative_path=?').all(domainId, row.relative_path)]))
      const dirs = db.prepare(`SELECT relative_path FROM domain_directories WHERE domain_id=? AND (relative_path=? OR relative_path LIKE ? ESCAPE '\\') ORDER BY relative_path`).all(domainId, from, fromPrefix)
      if (!files.length && !dirs.length) throw new Error('Origem não encontrada.')
      const insertFile = db.prepare(`INSERT INTO domain_files(domain_id, relative_path, content_text, object_sha256, byte_length, content_sha256, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(domain_id, relative_path) DO UPDATE SET content_text=excluded.content_text, object_sha256=excluded.object_sha256,
        byte_length=excluded.byte_length, content_sha256=excluded.content_sha256, updated_at=excluded.updated_at`)
      const now = new Date().toISOString()
      for (const row of files) {
        const target = row.relative_path === from ? to : `${toPrefix}${row.relative_path.slice(from.length + 1)}`
        insertFile.run(domainId, target, row.content_text, row.object_sha256, row.byte_length, row.content_sha256, now)
        db.prepare('DELETE FROM domain_image_refs WHERE domain_id=? AND relative_path=?').run(domainId, target)
        const insertRef = db.prepare('INSERT INTO domain_image_refs(domain_id, relative_path, json_pointer, object_sha256) VALUES (?, ?, ?, ?)')
        for (const ref of refsByPath.get(row.relative_path) ?? []) insertRef.run(domainId, target, ref.json_pointer, ref.object_sha256)
      }
      for (const row of dirs) {
        const target = row.relative_path === from ? to : `${toPrefix}${row.relative_path.slice(from.length + 1)}`
        db.prepare('INSERT OR IGNORE INTO domain_directories(domain_id, relative_path, updated_at) VALUES (?, ?, ?)').run(domainId, target, now)
      }
      db.prepare(`DELETE FROM domain_files WHERE domain_id=? AND (relative_path=? OR relative_path LIKE ? ESCAPE '\\')`).run(domainId, from, fromPrefix)
      db.prepare(`DELETE FROM domain_directories WHERE domain_id=? AND (relative_path=? OR relative_path LIKE ? ESCAPE '\\')`).run(domainId, from, fromPrefix)
    })
    txn()
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
      referencedObjects: db.prepare(`SELECT count(DISTINCT sha256) AS count FROM (
        SELECT sha256 FROM asset_objects UNION SELECT object_sha256 AS sha256 FROM domain_files WHERE object_sha256 IS NOT NULL
        UNION SELECT object_sha256 AS sha256 FROM domain_image_refs)`).get().count,
      objectBytes: db.prepare('SELECT coalesce(sum(byte_length), 0) AS bytes FROM objects').get().bytes,
      unreferencedObjects: db.prepare(`SELECT count(*) AS count FROM objects o WHERE
        NOT EXISTS (SELECT 1 FROM asset_objects ao WHERE ao.sha256=o.sha256)
        AND NOT EXISTS (SELECT 1 FROM domain_files df WHERE df.object_sha256=o.sha256)
        AND NOT EXISTS (SELECT 1 FROM domain_image_refs ir WHERE ir.object_sha256=o.sha256)`).get().count
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
  characters: ['characters'],
  libraries: ['libraries'],
  projects: ['projects'],
  media: ['media'],
  database: ['database'],
  backups: ['backups'],
  cache: ['cache'],
  temporary: ['temp'],
  operations: ['logs', 'crash-dumps', 'manifests'],
  other: [],
  profile: ['runtime/profile', 'cache/electron-session']
}
const ELECTRON_CACHE_NAMES = [
    'Cache', 'Code Cache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GPUCache',
    'GPUPersistentCache', 'GrShaderCache', 'ShaderCache', 'VideoDecodeStats', 'blob_storage', 'Shared Dictionary'
  ]
const ELECTRON_CACHE_NAME_SET = new Set(ELECTRON_CACHE_NAMES.map((name) => name.toLowerCase()))

async function measureTree(root, { excludeNames = null } = {}) {
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
      if (excludeNames?.has(entry.name.toLowerCase())) continue
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
      : group === 'cache'
      ? await (async () => {
        const cacheRoot = path.join(root, 'cache')
        let entries = []
        try { entries = await fsp.readdir(cacheRoot, { withFileTypes: true }) } catch (error) { if (error.code !== 'ENOENT') throw error }
        const sessionRoot = path.join(cacheRoot, 'electron-session')
        const roots = entries.filter((entry) => entry.name !== 'electron-session' && !entry.isSymbolicLink()).map((entry) => path.join(cacheRoot, entry.name))
        for (const name of ELECTRON_CACHE_NAMES) {
          const candidate = path.join(sessionRoot, name)
          if (fs.existsSync(candidate)) roots.push(candidate)
        }
        return roots
      })()
      : group === 'profile'
      ? relatives.map((relative) => path.join(root, relative)).filter((candidate) => fs.existsSync(candidate))
      : relatives.map((relative) => path.join(root, relative))
    const totals = await Promise.all(roots.map((candidate) => measureTree(candidate, { excludeNames: group === 'profile' ? ELECTRON_CACHE_NAME_SET : null })))
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
