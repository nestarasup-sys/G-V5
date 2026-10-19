import { constants } from 'node:fs'
import { access as nativeAccess, copyFile as nativeCopyFile, mkdir as nativeMkdir, readFile as nativeReadFile, readdir as nativeReaddir, rename as nativeRename, stat as nativeStat, unlink as nativeUnlink, writeFile as nativeWriteFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { StudioAsset, StudioDocument, VideoBackgroundLibraryItem } from '../src/shared/studio'
import type { DomainFileSystem } from './domainFileSystem.cjs'
import { normalizeImageBuffer } from './imageIngestion.cjs'

type StorageAdapter = Pick<DomainFileSystem, 'access' | 'copyFile' | 'mkdir' | 'readFile' | 'readdir' | 'rename' | 'stat' | 'unlink' | 'writeFile'>
let storage: StorageAdapter = { access: nativeAccess, copyFile: nativeCopyFile, mkdir: nativeMkdir, readFile: nativeReadFile,
  readdir: nativeReaddir, rename: nativeRename, stat: nativeStat, unlink: nativeUnlink, writeFile: nativeWriteFile }
export function configureBackgroundLibraryStorage(adapter: StorageAdapter) { storage = adapter }
const access = (path: Parameters<StorageAdapter['access']>[0], mode?: Parameters<StorageAdapter['access']>[1]) => storage.access(path, mode)
const copyFile = (source: Parameters<StorageAdapter['copyFile']>[0], destination: Parameters<StorageAdapter['copyFile']>[1], mode?: Parameters<StorageAdapter['copyFile']>[2]) => storage.copyFile(source, destination, mode)
const mkdir = (path: Parameters<StorageAdapter['mkdir']>[0], options?: Parameters<StorageAdapter['mkdir']>[1]) => storage.mkdir(path, options)
function readFile(path: string): Promise<Buffer>
function readFile(path: string, options: BufferEncoding): Promise<string>
function readFile(path: string, options: { encoding: BufferEncoding }): Promise<string>
function readFile(path: string, options?: BufferEncoding | { encoding: BufferEncoding }): Promise<Buffer | string> { return storage.readFile(path, options as BufferEncoding | { encoding: BufferEncoding }) }
function readdir(path: string, options: { withFileTypes: true }): Promise<import('node:fs').Dirent[]>
function readdir(path: string, options?: { withFileTypes?: false } | BufferEncoding): Promise<string[]>
function readdir(path: string, options?: { withFileTypes?: boolean } | BufferEncoding): Promise<import('node:fs').Dirent[] | string[]> { return storage.readdir(path, options as never) }
const rename = (oldPath: Parameters<StorageAdapter['rename']>[0], newPath: Parameters<StorageAdapter['rename']>[1]) => storage.rename(oldPath, newPath)
const stat = (path: Parameters<StorageAdapter['stat']>[0]) => storage.stat(path)
const unlink = (path: Parameters<StorageAdapter['unlink']>[0]) => storage.unlink(path)
const writeFile = (path: string, data: string | NodeJS.ArrayBufferView, options?: BufferEncoding): Promise<void> => storage.writeFile(path, data, options)

const formats = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' } as const
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
type Extension = keyof typeof formats
type Entry = Omit<VideoBackgroundLibraryItem, 'available' | 'studios'>
type Catalog = { schemaVersion: 1; items: Entry[]; deleted: Array<{ id: string; extension: Extension }> }
type Project = { id: string; title: string; createdAt: string; assets: Array<Omit<StudioAsset, 'dataUrl'>> }
const validId = (id: unknown): id is string => typeof id === 'string' && uuid.test(id)
const requireId = (id: unknown) => { if (!validId(id)) throw new Error('Identificador de fundo ou roteiro inválido.') }
const imageExtension = (mimeType: string): Extension | undefined => {
  for (const extension of Object.keys(formats) as Extension[]) if (formats[extension] === mimeType) return extension
  return undefined
}
const exists = async (path: string) => { try { await access(path); return true } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return false; throw reason } }
function validEntry(value: unknown): value is Entry {
  if (!value || typeof value !== 'object') return false
  const item = value as Entry
  return validId(item.id) && typeof item.name === 'string' && item.name.length > 0 && item.name.length <= 255
    && Object.hasOwn(formats, item.extension) && formats[item.extension] === item.mimeType
    && Number.isSafeInteger(item.size) && item.size > 0 && item.size <= 50 * 1024 ** 2
    && typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt))
}

/** Library originals are shared; every Video Studio script gets an independent background copy. */
export class VideoBackgroundLibraryStore {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly workspacePath: () => string) {}
  private libraryPath() { return join(this.workspacePath(), 'background-library') }
  private libraryFile(item: Pick<Entry, 'id' | 'extension'>) { return join(this.libraryPath(), 'images', `${item.id}.${item.extension}`) }
  private projectFile(studioId: string, item: Pick<Entry, 'id' | 'extension'>) { return join(this.workspacePath(), `studio-${studioId}`, 'assets', 'backgrounds', `${item.id}.${item.extension === 'jpeg' ? 'jpg' : item.extension}`) }
  private run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(operation)
    this.queue = next
    return next
  }
  private async readCatalog(): Promise<Catalog> {
    try {
      const catalog = JSON.parse(await readFile(join(this.libraryPath(), 'catalog.json'), 'utf8')) as Catalog
      if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.items) || !catalog.items.every(validEntry)
        || new Set(catalog.items.map((item) => item.id)).size !== catalog.items.length
        || !Array.isArray(catalog.deleted) || !catalog.deleted.every((item) => validId(item?.id) && Object.hasOwn(formats, item.extension))) throw new Error('O catálogo de fundos do Video Studio está inválido.')
      return catalog
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, items: [], deleted: [] }
      throw reason
    }
  }
  private async writeCatalog(catalog: Catalog) {
    await mkdir(join(this.libraryPath(), 'images'), { recursive: true })
    const temporary = join(this.libraryPath(), `catalog-${randomUUID()}.tmp`)
    await writeFile(temporary, JSON.stringify(catalog, null, 2), 'utf8')
    await rename(temporary, join(this.libraryPath(), 'catalog.json'))
  }
  private async projects(): Promise<Project[]> {
    await mkdir(this.workspacePath(), { recursive: true })
    const directories = await readdir(this.workspacePath(), { withFileTypes: true })
    const projects: Project[] = []
    for (const directory of directories) {
      const id = directory.name.slice('studio-'.length)
      if (!directory.isDirectory() || !directory.name.startsWith('studio-') || !validId(id)) continue
      try {
        const document = JSON.parse(await readFile(join(this.workspacePath(), directory.name, 'studio.json'), 'utf8')) as StudioDocument
        if (!document || typeof document !== 'object') continue
        projects.push({ id, title: typeof document.title === 'string' ? document.title.slice(0, 100) : 'Roteiro', createdAt: document.createdAt,
          assets: (Array.isArray(document.assets) ? document.assets : []).filter((asset) => asset?.category === 'background' && validId(asset.id) && Object.hasOwn(formats, imageExtension(asset.mimeType) ?? '')) })
      } catch (reason) {
        if ((reason as NodeJS.ErrnoException).code !== 'ENOENT' && !(reason instanceof SyntaxError)) throw reason
      }
    }
    return projects
  }
  private async copyVerified(source: string, destination: string, size: number) {
    if (!await exists(destination)) {
      await mkdir(dirname(destination), { recursive: true })
      const temporary = `${destination}.${randomUUID()}.tmp`
      try {
        await copyFile(source, temporary, constants.COPYFILE_EXCL)
        if ((await stat(temporary)).size !== size) throw new Error('A imagem mudou durante a cópia. Tente importar novamente.')
        if (!await exists(destination)) await rename(temporary, destination)
      } finally {
        try { await unlink(temporary) } catch (reason) { if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason }
      }
    }
    if ((await stat(destination)).size !== size) throw new Error('A cópia do fundo tem tamanho inesperado. O arquivo existente foi preservado.')
  }
  private async migrate(catalog: Catalog, projects: Project[]) {
    let changed = false
    for (const project of projects) for (const asset of project.assets) {
      if (catalog.deleted.some((item) => item.id === asset.id)) continue
      const extension = imageExtension(asset.mimeType)
      if (!extension) continue
      const source = this.projectFile(project.id, { id: asset.id, extension })
      if (!await exists(source)) continue
      const size = (await stat(source)).size
      if (size <= 0 || size > 50 * 1024 ** 2) continue
      const existing = catalog.items.find((item) => item.id === asset.id)
      if (existing && (existing.extension !== extension || existing.size !== size)) continue
      await this.copyVerified(source, this.libraryFile({ id: asset.id, extension }), size)
      if (!existing) { catalog.items.push({ id: asset.id, name: asset.name, extension, mimeType: asset.mimeType as Entry['mimeType'], size, createdAt: project.createdAt }); changed = true }
    }
    if (changed) await this.writeCatalog(catalog)
    for (const item of catalog.deleted) {
      try { await unlink(this.libraryFile(item)) } catch (reason) { if (!['ENOENT', 'EPERM', 'EBUSY', 'EACCES'].includes((reason as NodeJS.ErrnoException).code ?? '')) throw reason }
    }
  }
  async list(): Promise<VideoBackgroundLibraryItem[]> {
    return this.run(async () => {
      const catalog = await this.readCatalog()
      const projects = await this.projects()
      await this.migrate(catalog, projects)
      return Promise.all(catalog.items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(async (item) => ({ ...item,
        available: await exists(this.libraryFile(item)), studios: projects.filter((project) => project.assets.some((asset) => asset.id === item.id)).map(({ id, title }) => ({ id, title })) })))
    })
  }
  async importFile(source: string): Promise<VideoBackgroundLibraryItem> {
    return this.run(async () => {
      const extension = extname(source).slice(1).toLowerCase() as Extension
      if (!Object.hasOwn(formats, extension)) throw new Error('Formato não compatível. Use PNG, JPG, JPEG ou WebP.')
      const file = await stat(source)
      if (!file.isFile() || file.size <= 0 || file.size > 50 * 1024 ** 2) throw new Error('O fundo deve ter até 50 MB.')
      const canonical = await normalizeImageBuffer(await readFile(source))
      const item: Entry = { id: randomUUID(), name: basename(source), extension: 'png', mimeType: 'image/png', size: canonical.bytes.length, createdAt: new Date().toISOString() }
      const catalog = await this.readCatalog()
      await mkdir(join(this.libraryPath(), 'images'), { recursive: true })
      await writeFile(this.libraryFile(item), canonical.bytes)
      if ((await stat(this.libraryFile(item))).size !== item.size) throw new Error('O PNG canônico do fundo não passou na verificação de tamanho.')
      catalog.items.push(item)
      await this.writeCatalog(catalog)
      return { ...item, available: true, studios: [] }
    })
  }
  async delete(id: string): Promise<void> {
    requireId(id)
    return this.run(async () => {
      const catalog = await this.readCatalog()
      const item = catalog.items.find((entry) => entry.id === id)
      if (!item) return
      catalog.items = catalog.items.filter((entry) => entry.id !== id)
      catalog.deleted.push({ id, extension: item.extension })
      await this.writeCatalog(catalog)
      await this.migrate(catalog, [])
    })
  }
  async attach(studioId: string, id: string): Promise<StudioAsset> {
    requireId(studioId); requireId(id)
    return this.run(async () => {
      const item = (await this.readCatalog()).items.find((entry) => entry.id === id)
      if (!item || !await exists(this.libraryFile(item))) throw new Error('Este fundo está indisponível na biblioteca.')
      const destination = this.projectFile(studioId, item)
      await this.copyVerified(this.libraryFile(item), destination, item.size)
      const bytes = await readFile(destination)
      return { id: item.id, category: 'background', name: item.name, mimeType: item.mimeType, dataUrl: `data:${item.mimeType};base64,${bytes.toString('base64')}` }
    })
  }
  async resolve(id: string): Promise<{ path: string; mimeType: Entry['mimeType'] }> {
    requireId(id)
    return this.run(async () => {
      const item = (await this.readCatalog()).items.find((entry) => entry.id === id)
      if (!item) throw new Error('Fundo não encontrado na biblioteca.')
      return { path: this.libraryFile(item), mimeType: item.mimeType }
    })
  }
}
