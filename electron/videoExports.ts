import { createReadStream } from 'node:fs'
import { mkdir, lstat, readFile, readdir, rename, rm, rmdir, realpath, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type VideoExportRecord = {
  schemaVersion: 1
  id: string
  studioId: string
  studioTitle: string
  filename: string
  sizeBytes: number
  sha256: string
  width: 1920
  height: 1080
  frameRate: 60
  durationFrames: number
  videoCodec: 'h264'
  audioCodec: 'aac' | null
  createdAt: string
}

export class VideoExportLibrary {
  readonly exportRoot: string
  readonly jobRoot: string
  readonly frameCacheRoot: string

  constructor(appDataRoot: string) {
    const root = resolve(appDataRoot)
    this.exportRoot = join(root, 'EXPORT')
    this.jobRoot = join(root, 'temp', 'video-studio', 'export')
    this.frameCacheRoot = join(root, 'CACHE', 'video-studio', 'frames')
  }

  private assertUuid(value: string, label: string): void {
    if (!uuidPattern.test(value)) throw new Error(`${label} inválido.`)
  }

  private async ensureDirectory(path: string): Promise<void> {
    await mkdir(path, { recursive: true })
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Pasta de exportação inválida.')
  }

  private async hashFile(path: string): Promise<string> {
    const hash = createHash('sha256')
    await new Promise<void>((resolvePromise, reject) => {
      const stream = createReadStream(path)
      stream.on('data', (chunk) => hash.update(chunk))
      stream.once('error', reject)
      stream.once('end', resolvePromise)
    })
    return hash.digest('hex')
  }

  async list(): Promise<Array<VideoExportRecord & { available: boolean }>> {
    await this.ensureDirectory(this.exportRoot)
    const records: Array<VideoExportRecord & { available: boolean }> = []
    for (const projectEntry of await readdir(this.exportRoot, { withFileTypes: true })) {
      if (!projectEntry.isDirectory() || projectEntry.isSymbolicLink() || !uuidPattern.test(projectEntry.name)) continue
      const projectRoot = join(this.exportRoot, projectEntry.name)
      for (const entry of await readdir(projectRoot, { withFileTypes: true })) {
        if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) continue
        try {
          const metadataPath = join(projectRoot, entry.name)
          const record = JSON.parse(await readFile(metadataPath, 'utf8')) as VideoExportRecord
          if (record.schemaVersion !== 1 || !uuidPattern.test(record.id) || record.studioId !== projectEntry.name
            || entry.name !== `${record.id}.json` || basename(record.filename) !== record.filename || !record.filename.endsWith('.mp4')
            || !/^[a-f0-9]{64}$/.test(record.sha256) || !Number.isSafeInteger(record.sizeBytes) || record.sizeBytes < 1
            || record.width !== 1920 || record.height !== 1080 || record.frameRate !== 60 || !Number.isSafeInteger(record.durationFrames) || record.durationFrames < 1) continue
          const outputPath = join(projectRoot, record.filename)
          const info = await lstat(outputPath).catch(() => null)
          const available = Boolean(info?.isFile() && !info.isSymbolicLink() && info.size === record.sizeBytes)
          records.push({ ...record, available })
        } catch { /* Ignore malformed sidecars; never infer a project from an untrusted filename. */ }
      }
    }
    return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  async finalize(jobId: string, metadata: Omit<VideoExportRecord, 'schemaVersion' | 'filename' | 'sizeBytes' | 'sha256' | 'createdAt'>): Promise<VideoExportRecord> {
    this.assertUuid(jobId, 'Job')
    this.assertUuid(metadata.id, 'Exportação')
    this.assertUuid(metadata.studioId, 'Projeto')
    if (!Number.isSafeInteger(metadata.durationFrames) || metadata.durationFrames < 1 || !metadata.studioTitle.trim()) throw new Error('Metadados de exportação inválidos.')
    const jobFolder = resolve(this.jobRoot, jobId)
    const sourcePath = join(jobFolder, 'final.mp4')
    const outputFolder = resolve(this.exportRoot, metadata.studioId)
    const rootRelative = relative(this.jobRoot, jobFolder)
    if (!rootRelative || rootRelative.startsWith(`..${sep}`) || resolve(sourcePath) !== join(jobFolder, 'final.mp4')) throw new Error('Pasta temporária de exportação inválida.')
    const jobDirectoryInfo = await lstat(jobFolder)
    if (!jobDirectoryInfo.isDirectory() || jobDirectoryInfo.isSymbolicLink()) throw new Error('Pasta temporária de exportação inválida.')
    // Windows realpath may canonicalize drive/path casing differently from path.resolve.
    // Validate containment against the canonical trusted root, not string equality
    // with a noncanonical path. Reject symlink/junction escapes outside this root.
    const canonicalRoot = await realpath(this.jobRoot)
    const canonicalJobFolder = await realpath(jobFolder)
    if (relative(canonicalRoot, canonicalJobFolder).toLowerCase() !== jobId.toLowerCase()) {
      throw new Error('Pasta temporária de exportação inválida.')
    }
    const sourceInfo = await lstat(sourcePath)
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink() || sourceInfo.size < 1) throw new Error('Arquivo MP4 temporário ausente ou inválido.')
    const sourceReal = resolve(sourcePath)
    if (sourceReal !== sourcePath) throw new Error('Arquivo temporário fora do caminho esperado.')
    await this.ensureDirectory(this.exportRoot)
    await this.ensureDirectory(outputFolder)
    const safeTitle = metadata.studioTitle.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'video-studio'
    const createdAt = new Date().toISOString()
    const filename = `${metadata.id}-${safeTitle}-${createdAt.replace(/[:.]/g, '-')}.mp4`
    const destination = join(outputFolder, filename)
    const record: VideoExportRecord = {
      ...metadata, schemaVersion: 1, filename, sizeBytes: sourceInfo.size,
      sha256: await this.hashFile(sourcePath), createdAt
    }
    const metadataPath = join(outputFolder, `${metadata.id}.json`)
    const metadataTemp = join(outputFolder, `.${metadata.id}-${randomUUID()}.tmp`)
    if (await lstat(destination).then(() => true, () => false) || await lstat(metadataPath).then(() => true, () => false)) throw new Error('Esta exportação já existe.')
    await rename(sourcePath, destination)
    try {
      await writeFile(metadataTemp, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' })
      await rename(metadataTemp, metadataPath)
    } catch (error) {
      await rm(metadataTemp, { force: true }).catch(() => undefined)
      await rename(destination, sourcePath).catch(() => undefined)
      throw error
    }
    return record
  }

  async delete(exportId: string): Promise<void> {
    this.assertUuid(exportId, 'Exportação')
    const matches = (await this.list()).filter((record) => record.id === exportId)
    if (matches.length !== 1) throw new Error('Exportação não encontrada ou ambígua.')
    const record = matches[0]
    if (!record.available) throw new Error('O arquivo exportado está ausente ou foi alterado; nada foi excluído.')
    const folder = resolve(this.exportRoot, record.studioId)
    if (dirname(join(folder, record.filename)) !== folder || dirname(join(folder, `${record.id}.json`)) !== folder) throw new Error('Caminho da exportação inválido.')
    const outputPath = join(folder, record.filename)
    if (await this.hashFile(outputPath) !== record.sha256) throw new Error('O hash do arquivo não corresponde ao catálogo; nada foi excluído.')
    await rm(outputPath)
    await rm(join(folder, `${record.id}.json`))
    const remaining = await readdir(folder)
    if (!remaining.length) await rmdir(folder)
  }

  async folder(studioId?: string): Promise<string> {
    if (studioId) this.assertUuid(studioId, 'Projeto')
    const folder = studioId ? join(this.exportRoot, studioId) : this.exportRoot
    await this.ensureDirectory(folder)
    return folder
  }
}
