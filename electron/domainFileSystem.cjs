'use strict'

const path = require('node:path')
const fs = require('node:fs')
const { decodeImageDataUrl } = require('./imageIngestion.cjs')

const ROOTS = [
  { id: 'fabricator.models', path: 'fabricator/models' },
  { id: 'fabricator.design-settings', path: 'fabricator/design-settings' },
  { id: 'fabricator.poses', path: 'fabricator/poses' },
  { id: 'fabricator.animations', path: 'fabricator/animations' },
  { id: 'fabricator.wardrobe', path: 'fabricator/wardrobe' },
  { id: 'fabricator.face-components', path: 'fabricator/face-components' },
  { id: 'fabricator.expression-presets', path: 'fabricator/expression-presets' },
  { id: 'fabricator.hair', path: 'fabricator/hair' },
  { id: 'fabricator.face-sets', path: 'fabricator/faces' },
  { id: 'fabricator.face-sets', path: 'fabricator/guides-eyes.json', file: true },
  { id: 'fabricator.face-sets', path: 'fabricator/guides-face.json', file: true },
  { id: 'customizer.characters', path: 'customizer/characters' },
  { id: 'studio.projects', path: 'studios/Studio Principal' },
  { id: 'video-studio.media', path: 'studios/Video Studio/media-library' },
  { id: 'video-studio.backgrounds', path: 'studios/Video Studio/background-library' },
  { id: 'video-studio.projects', path: 'studios/Video Studio' }
].sort((a, b) => b.path.length - a.path.length)

function isWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function codedError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function escapeJsonPointerSegment(value) { return String(value).replace(/~/g, '~0').replace(/\//g, '~1') }

async function externalizeImages(value, catalog, pointer = '', refs = []) {
  if (typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,/i.test(value)) {
    const bytes = decodeImageDataUrl(value)
    const generatedOutput = /\/(?:thumbnailDataUrl|chromaBaseDataUrl|coverDataUrl)$/.test(pointer)
    const image = generatedOutput ? await catalog.storeGeneratedImage(bytes) : await catalog.ingestImage(bytes)
    refs.push({ pointer: pointer || '/', sha256: image.sha256 })
    return `@gacha-image:${image.sha256}`
  }
  if (Array.isArray(value)) return Promise.all(value.map((item, index) => externalizeImages(item, catalog, `${pointer}/${index}`, refs)))
  if (value && typeof value === 'object') {
    const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await externalizeImages(item, catalog, `${pointer}/${escapeJsonPointerSegment(key)}`, refs)]))
    return Object.fromEntries(entries)
  }
  return value
}

async function hydrateImages(value, catalog) {
  if (typeof value === 'string') {
    const match = /^@gacha-image:([a-f0-9]{64})$/.exec(value)
    if (!match) return value
    const bytes = await catalog.readObject(match[1])
    return `data:image/png;base64,${bytes.toString('base64')}`
  }
  if (Array.isArray(value)) return Promise.all(value.map((item) => hydrateImages(item, catalog)))
  if (value && typeof value === 'object') {
    const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await hydrateImages(item, catalog)]))
    return Object.fromEntries(entries)
  }
  return value
}

function makeDirent(name, directory) {
  return {
    name,
    parentPath: '',
    path: '',
    isFile: () => !directory,
    isDirectory: () => directory,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false
  }
}

function makeStats({ size = 0, directory = false, mtime = new Date(0) } = {}) {
  return {
    size, mtime, mtimeMs: mtime.getTime(), isFile: () => !directory, isDirectory: () => directory,
    isBlockDevice: () => false, isCharacterDevice: () => false, isSymbolicLink: () => false,
    isFIFO: () => false, isSocket: () => false
  }
}

class DomainFileSystem {
  constructor(catalog, userDataRoot) {
    this.catalog = catalog
    this.root = path.resolve(userDataRoot)
    this.native = {
      readFile: fs.promises.readFile.bind(fs.promises), writeFile: fs.promises.writeFile.bind(fs.promises),
      readdir: fs.promises.readdir.bind(fs.promises), mkdir: fs.promises.mkdir.bind(fs.promises),
      access: fs.promises.access.bind(fs.promises), stat: fs.promises.stat.bind(fs.promises),
      unlink: fs.promises.unlink.bind(fs.promises), rename: fs.promises.rename.bind(fs.promises),
      rm: fs.promises.rm.bind(fs.promises), copyFile: fs.promises.copyFile.bind(fs.promises)
    }
  }

  locate(input) {
    const absolute = path.resolve(input)
    if (!isWithin(this.root, absolute)) return null
    const relative = path.relative(this.root, absolute).split(path.sep).join('/')
    const lower = relative.toLowerCase()
    let candidate
    for (const root of ROOTS) {
      const prefix = root.path.toLowerCase()
      if (root.file ? lower === prefix || lower === `${prefix}.tmp` : lower === prefix || lower.startsWith(`${prefix}/`)) { candidate = root; break }
    }
    if (!candidate) return null
    let domainId = candidate.id
    if (domainId === 'fabricator.face-sets' && /(?:^|\/)catalog(?:\/|$)/i.test(relative)) domainId = 'fabricator.face-catalog'
    const prefixLength = candidate.path.length
    const relativePath = candidate.file
      ? `${path.posix.basename(candidate.path)}${lower === `${candidate.path.toLowerCase()}.tmp` ? '.tmp' : ''}`
      : relative.slice(prefixLength).replace(/^\//, '')
    return { absolute, domainId, relativePath }
  }

  active(location) {
    if (!location) return false
    const state = this.catalog.getDomainState(location.domainId).state
    return state === 'active' || state === 'verified'
  }

  async readFile(filePath, options) {
    const location = this.locate(filePath)
    if (!this.active(location)) return this.native.readFile(filePath, options)
    let bytes = await this.catalog.readDomainFile(location.domainId, location.relativePath)
    if (!bytes) throw codedError('ENOENT', `Arquivo não encontrado no domínio ${location.domainId}.`)
    if (/\.json(?:\.tmp)?$/i.test(location.relativePath) && /@gacha-image:[a-f0-9]{64}/.test(bytes.toString('utf8'))) {
      const document = JSON.parse(bytes.toString('utf8'))
      bytes = Buffer.from(JSON.stringify(await hydrateImages(document, this.catalog)), 'utf8')
    }
    const encoding = typeof options === 'string' ? options : options?.encoding
    return encoding ? bytes.toString(encoding) : bytes
  }

  async resolvePhysicalPath(filePath) {
    const location = this.locate(filePath)
    if (!this.active(location)) return null
    const row = this.catalog.assertReady().prepare('SELECT object_sha256 FROM domain_files WHERE domain_id=? AND relative_path=?').get(location.domainId, location.relativePath)
    if (!row?.object_sha256) return null
    const object = this.catalog.assertReady().prepare('SELECT relative_path FROM objects WHERE sha256=?').get(row.object_sha256)
    if (!object) throw codedError('ENOENT', 'O objeto de mídia não está no catálogo.')
    const result = path.resolve(this.catalog.root, object.relative_path)
    if (!isWithin(this.catalog.root, result) || result !== await fs.promises.realpath(result)) throw new Error('Objeto de mídia fora do armazenamento canônico.')
    return result
  }

  async materializeDirectory(sourcePath, destinationPath) {
    const location = this.locate(sourcePath)
    if (!this.active(location)) return null
    const destination = path.resolve(destinationPath)
    if (!isWithin(this.catalog.root, destination)) throw new Error('Exportação fora de app-data.')
    await fs.promises.mkdir(destination, { recursive: true })
    const entries = this.catalog.listDomainDirectory(location.domainId, location.relativePath)
    for (const entry of entries) {
      const source = path.join(sourcePath, entry.name)
      const target = path.join(destination, entry.name)
      if (entry.directory) await this.materializeDirectory(source, target)
      else await fs.promises.writeFile(target, await this.readFile(source))
    }
    return destination
  }

  async writeFile(filePath, data, options) {
    const location = this.locate(filePath)
    if (!this.active(location)) return this.native.writeFile(filePath, data, options)
    let bytes = Buffer.isBuffer(data) ? data : Buffer.from(String(data), typeof options === 'string' ? options : options?.encoding ?? 'utf8')
    const text = /\.json(?:\.tmp)?$/i.test(location.relativePath) || /\.txt$/i.test(location.relativePath)
    let imageRefs = []
    if (/\.json(?:\.tmp)?$/i.test(location.relativePath) && bytes.includes(Buffer.from('data:image/'))) {
      const document = JSON.parse(bytes.toString('utf8'))
      const refs = []
      const canonical = await externalizeImages(document, this.catalog, '', refs)
      imageRefs = refs
      bytes = Buffer.from(JSON.stringify(canonical), 'utf8')
    }
    await this.catalog.writeDomainFile(location.domainId, location.relativePath, bytes, { text, imageRefs })
  }

  async mkdir(directoryPath, options) {
    const location = this.locate(directoryPath)
    if (!this.active(location)) {
      const absolute = path.resolve(directoryPath)
      if (isWithin(this.root, absolute)) {
        const relative = path.relative(this.root, absolute).split(path.sep).join('/').toLowerCase()
        const singleFileParent = ROOTS.find((root) => root.file && path.posix.dirname(root.path).toLowerCase() === relative)
        if (singleFileParent && this.catalog.getDomainState(singleFileParent.id).state !== 'legacy') {
          this.catalog.ensureDomainDirectory(singleFileParent.id, '')
          return undefined
        }
      }
      return this.native.mkdir(directoryPath, options)
    }
    this.catalog.ensureDomainDirectory(location.domainId, location.relativePath)
    return undefined
  }

  async readdir(directoryPath, options) {
    const location = this.locate(directoryPath)
    if (!this.active(location)) return this.native.readdir(directoryPath, options)
    const entries = this.catalog.listDomainDirectory(location.domainId, location.relativePath)
    return options?.withFileTypes ? entries.map((entry) => makeDirent(entry.name, entry.directory)) : entries.map((entry) => entry.name)
  }

  async access(filePath, mode) {
    const location = this.locate(filePath)
    if (!this.active(location)) return this.native.access(filePath, mode)
    if (location.relativePath === '') return
    const file = this.catalog.listDomainFiles(location.domainId, location.relativePath).some((entry) => entry.relativePath === location.relativePath)
    if (file || this.catalog.hasDomainDirectory(location.domainId, location.relativePath)) return
    throw codedError('ENOENT', 'Caminho não encontrado no armazenamento do domínio.')
  }

  async stat(filePath) {
    const location = this.locate(filePath)
    if (!this.active(location)) return this.native.stat(filePath)
    const row = this.catalog.listDomainFiles(location.domainId, location.relativePath).find((entry) => entry.relativePath === location.relativePath)
    if (row) return makeStats({ size: row.byteLength })
    if (location.relativePath === '' || this.catalog.hasDomainDirectory(location.domainId, location.relativePath)) return makeStats({ directory: true })
    throw codedError('ENOENT', 'Caminho não encontrado no armazenamento do domínio.')
  }

  async unlink(filePath) {
    const location = this.locate(filePath)
    if (!this.active(location)) return this.native.unlink(filePath)
    this.catalog.removeDomainPath(location.domainId, location.relativePath, false)
  }

  async rename(oldPath, newPath) {
    const from = this.locate(oldPath); const to = this.locate(newPath)
    if (this.active(from) && this.active(to) && from.domainId === to.domainId) {
      return this.catalog.renameDomainPath(from.domainId, from.relativePath, to.relativePath)
    }
    return this.native.rename(oldPath, newPath)
  }

  async rm(targetPath, options = {}) {
    const location = this.locate(targetPath)
    if (!this.active(location)) return this.native.rm(targetPath, options)
    try { this.catalog.removeDomainPath(location.domainId, location.relativePath, options.recursive === true) }
    catch (error) { if (options.force && error.code === 'ENOENT') return; throw error }
  }

  async copyFile(sourcePath, destinationPath, mode = 0) {
    const destination = this.locate(destinationPath)
    if (!this.active(destination)) return this.native.copyFile(sourcePath, destinationPath, mode)
    if (mode & fs.constants.COPYFILE_EXCL) {
      try { await this.access(destinationPath); throw codedError('EEXIST', 'Destino já existe.') }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    const bytes = await this.readFile(sourcePath)
    await this.writeFile(destinationPath, bytes)
  }
}

module.exports = { DomainFileSystem, ROOTS, externalizeImages }
