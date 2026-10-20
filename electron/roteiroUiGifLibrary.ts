import { access as nativeAccess, mkdir as nativeMkdir, readFile as nativeReadFile, rename as nativeRename, stat as nativeStat, unlink as nativeUnlink, writeFile as nativeWriteFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DomainFileSystem } from './domainFileSystem.cjs'

type StorageAdapter = Pick<DomainFileSystem, 'access' | 'mkdir' | 'readFile' | 'rename' | 'stat' | 'unlink' | 'writeFile'>
let storage: StorageAdapter = { access: nativeAccess, mkdir: nativeMkdir, readFile: nativeReadFile, rename: nativeRename, stat: nativeStat, unlink: nativeUnlink, writeFile: nativeWriteFile }
export function configureRoteiroUiGifStorage(adapter: StorageAdapter) { storage = adapter }
const access = (path: string) => storage.access(path)
const mkdir = (path: string) => storage.mkdir(path, { recursive: true })
const readFile = (path: string) => storage.readFile(path)
const rename = (from: string, to: string) => storage.rename(from, to)
const stat = (path: string) => storage.stat(path)
const unlink = (path: string) => storage.unlink(path)
const writeFile = (path: string, data: string | NodeJS.ArrayBufferView, options?: BufferEncoding | { encoding?: BufferEncoding; flag?: string }) => storage.writeFile(path, data, options)

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const maxBytes = 50 * 1024 ** 2
type Entry = { id: string; name: string; size: number; createdAt: string; builtIn?: boolean }
type Catalog = { schemaVersion: 1; initialized: true; items: Entry[] }
const validEntry = (entry: unknown): entry is Entry => Boolean(entry && typeof entry === 'object'
  && idPattern.test((entry as Entry).id) && typeof (entry as Entry).name === 'string' && (entry as Entry).name.length > 0 && (entry as Entry).name.length <= 255
  && Number.isSafeInteger((entry as Entry).size) && (entry as Entry).size > 0 && (entry as Entry).size <= maxBytes
  && typeof (entry as Entry).createdAt === 'string' && Number.isFinite(Date.parse((entry as Entry).createdAt))
  && ((entry as Entry).builtIn === undefined || typeof (entry as Entry).builtIn === 'boolean'))

export type RoteiroUiGifItem = Entry & { available: boolean }
export class RoteiroUiGifLibraryStore {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly root: () => string) {}
  private folder() { return join(this.root(), 'roteiro-ui-gif-library') }
  private file(id: string) { return join(this.folder(), 'gifs', `${id}.gif`) }
  private async run<T>(operation: () => Promise<T>): Promise<T> { const next = this.queue.catch(() => undefined).then(operation); this.queue = next; return next }
  private async catalog(): Promise<Catalog | null> {
    try {
      const result = JSON.parse(await readFile(join(this.folder(), 'catalog.json')).then((bytes) => bytes.toString('utf8'))) as Catalog
      if (result.schemaVersion !== 1 || result.initialized !== true || !Array.isArray(result.items) || !result.items.every(validEntry) || new Set(result.items.map((item) => item.id)).size !== result.items.length) throw new Error('Catálogo de GIFs inválido.')
      return result
    } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return null; throw reason }
  }
  private async save(value: Catalog) {
    await mkdir(join(this.folder(), 'gifs'))
    const temporary = join(this.folder(), `catalog-${randomUUID()}.tmp`)
    await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8')
    await rename(temporary, join(this.folder(), 'catalog.json'))
  }
  private validateGif(bytes: Buffer) {
    if (bytes.length < 14 || bytes.length > maxBytes || !['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)) || bytes.at(-1) !== 0x3b) throw new Error('Arquivo GIF inválido ou acima do limite de 50 MB.')
  }
  async list(defaultGifPath: string): Promise<RoteiroUiGifItem[]> {
    return this.run(async () => {
      let catalog = await this.catalog()
      if (!catalog) {
        const bytes = await readFile(defaultGifPath)
        this.validateGif(bytes)
        const entry: Entry = { id: randomUUID(), name: 'loading.gif', size: bytes.length, createdAt: new Date().toISOString(), builtIn: true }
        await mkdir(join(this.folder(), 'gifs'))
        const target = this.file(entry.id), temporary = `${target}.${randomUUID()}.tmp`
        await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, target)
        catalog = { schemaVersion: 1, initialized: true, items: [entry] }
        await this.save(catalog)
      }
      return Promise.all(catalog.items.map(async (item) => ({ ...item, available: await access(this.file(item.id)).then(() => true, (reason: NodeJS.ErrnoException) => { if (reason.code === 'ENOENT') return false; throw reason }) })))
    })
  }
  async importFile(source: string): Promise<RoteiroUiGifItem> {
    return this.run(async () => {
      if (extname(source).toLowerCase() !== '.gif') throw new Error('Selecione um arquivo .gif.')
      const sourceInfo = await nativeStat(source)
      if (!sourceInfo.isFile() || sourceInfo.size <= 0 || sourceInfo.size > maxBytes) throw new Error('O GIF está vazio ou excede o limite de 50 MB.')
      const sourceBytes = await readFile(source)
      this.validateGif(sourceBytes)
      const entry: Entry = { id: randomUUID(), name: basename(source).slice(0, 255) || 'animacao.gif', size: sourceBytes.length, createdAt: new Date().toISOString() }
      const catalog = await this.catalog() ?? { schemaVersion: 1, initialized: true, items: [] }
      await mkdir(join(this.folder(), 'gifs'))
      const target = this.file(entry.id), temporary = `${target}.${randomUUID()}.tmp`
      await writeFile(temporary, sourceBytes, { flag: 'wx' })
      if ((await stat(temporary)).size !== entry.size) { await unlink(temporary); throw new Error('A cópia do GIF não passou na verificação de tamanho.') }
      await rename(temporary, target)
      catalog.items.unshift(entry)
      await this.save(catalog)
      return { ...entry, available: true }
    })
  }
  async delete(id: string): Promise<void> {
    if (!idPattern.test(id)) throw new Error('Identificador de GIF inválido.')
    return this.run(async () => {
      const catalog = await this.catalog()
      if (!catalog) return
      const item = catalog.items.find((entry) => entry.id === id)
      if (!item) return
      if (item.builtIn) throw new Error('O GIF padrão incluído no Gacha V5 não pode ser removido da biblioteca.')
      catalog.items = catalog.items.filter((entry) => entry.id !== id)
      await this.save(catalog)
      try { await unlink(this.file(id)) } catch (reason) { if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason }
    })
  }
  async resolve(id: string): Promise<string> {
    if (!idPattern.test(id)) throw new Error('Identificador de GIF inválido.')
    return this.run(async () => {
      const catalog = await this.catalog()
      if (!catalog?.items.some((item) => item.id === id)) throw new Error('GIF não encontrado na biblioteca.')
      const target = this.file(id)
      if (!(await stat(target)).isFile()) throw new Error('GIF indisponível na biblioteca.')
      return target
    })
  }
}
