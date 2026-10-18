import { createHash } from 'node:crypto'
import { nativeImage } from 'electron'
import type { Dirent } from 'node:fs'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type { PaintAsset, PaintDocument } from '../src/shared/paint'

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const dataUrl = (bytes: Buffer) => `data:image/png;base64,${bytes.toString('base64')}`
const sidecar = (path: string) => `${path}.paint.png`
const metadata = (path: string) => `${path}.paint.json`
const labelsFor = (category: string) => ({ models: 'Modelo', poses: 'Pose', wardrobe: 'Roupa', faces: 'Rosto', 'face-components': 'Face', hair: 'Cabelo', animations: 'Animação' }[category] ?? 'Conjunto')

export class PaintStore {
  constructor(private readonly root: () => string) {}

  private pathFor(id: string): string {
    if (!/^[a-zA-Z0-9._/-]+\.png$/.test(id) || id.split('/').some((part) => part === '..' || part === '.') || id.endsWith('.paint.png') || id.endsWith('.base.png')) throw new Error('Asset inválido.')
    const base = resolve(this.root())
    const path = resolve(base, ...id.split('/'))
    if (!path.startsWith(`${base}${sep}`)) throw new Error('Asset fora do Fabricador.')
    return path
  }

  async readEffective(path: string): Promise<Buffer> {
    const original = await readFile(path)
    try {
      const record = JSON.parse(await readFile(metadata(path), 'utf8')) as { sourceHash: string }
      if (record.sourceHash === hash(original)) return await readFile(sidecar(path))
    } catch { /* No edit or invalid sidecar: use the original. */ }
    return original
  }

  async writeSource(path: string, bytes: Buffer): Promise<void> {
    // Other Fabricator editors may save an already painted image while changing
    // position or metadata. Keep the source intact in that case.
    try {
      const original = await readFile(path)
      if (original.equals(bytes)) return
      const record = JSON.parse(await readFile(metadata(path), 'utf8')) as { sourceHash: string }
      if (record.sourceHash === hash(original) && (await readFile(sidecar(path))).equals(bytes)) return
    } catch { /* New or independently changed asset. */ }
    await writeFile(path, bytes)
  }

  private async edited(path: string, original: Buffer): Promise<boolean> {
    try {
      const record = JSON.parse(await readFile(metadata(path), 'utf8')) as { sourceHash: string }
      if (record.sourceHash !== hash(original)) return false
      await readFile(sidecar(path))
      return true
    } catch { return false }
  }

  async list(): Promise<PaintAsset[]> {
    const root = this.root()
    const result: PaintAsset[] = []
    const manifests = new Map<string, Record<string, unknown> | null>()
    const manifest = async (path: string): Promise<Record<string, unknown> | null> => {
      if (manifests.has(path)) return manifests.get(path) ?? null
      try { const value = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>; manifests.set(path, value); return value }
      catch { manifests.set(path, null); return null }
    }
    const visit = async (folder: string): Promise<void> => {
      let entries: Dirent[]
      try { entries = await readdir(folder, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        const path = join(folder, entry.name)
        if (entry.isDirectory()) { await visit(path); continue }
        if (!entry.isFile() || !entry.name.endsWith('.png') || entry.name.endsWith('.paint.png') || entry.name.endsWith('.base.png')) continue
        const id = relative(root, path).split(sep).join('/')
        if (!/^(models|wardrobe|faces|face-components|hair)\//.test(id)) continue
        let edited = false
        try { await readFile(metadata(path)); edited = await this.edited(path, await readFile(path)) } catch { /* Unedited asset. */ }
        const category = id.split('/')[0]
        const assetId = basename(entry.name, '.png')
        const assetFolder = dirname(path)
        const collectionFolder = basename(assetFolder) === 'images' || basename(assetFolder) === 'parts' ? dirname(assetFolder) : assetFolder
        const manifestFile = category === 'models' ? 'project.json' : category === 'poses' ? basename(collectionFolder) === 'draft' ? 'draft.json' : 'pose.json' : category === 'wardrobe' ? 'wardrobe.json' : category === 'animations' ? 'animation.json' : category === 'face-components' ? 'asset.json' : category === 'faces' ? basename(collectionFolder).startsWith('item-') ? 'item.json' : 'face.json' : category === 'hair' ? basename(collectionFolder).startsWith('style-') ? 'hair-style.json' : 'hair.json' : ''
        const document = manifestFile ? await manifest(join(collectionFolder, manifestFile)) : null
        if (category === 'wardrobe' && document?.edition !== 2) continue
        const parts = document?.parts ?? document?.components ?? document?.pieces
        const named = Array.isArray(parts) ? parts.find((part: { id?: string }) => part.id === assetId) as { name?: string; side?: string; index?: number; sheet?: string } | undefined : undefined
        const side = named?.side === 'left' ? 'esquerdo' : named?.side === 'right' ? 'direito' : ''
        const facialKind = ({ eyes: 'Olho', eyebrows: 'Sobrancelha', nose: 'Nariz', 'mouth-closed': 'Boca fechada', 'mouth-open': 'Boca aberta' } as Record<string, string>)[named?.sheet ?? '']
        const name = named?.name || (facialKind ? `${facialKind}${side ? ` ${side}` : ''} ${Number(named?.index ?? 0) + 1}` : assetId === 'asset' && typeof document?.name === 'string' ? document.name : assetId === 'source' ? 'Imagem de origem' : assetId.replace(/^sheet-/, 'Folha '))
        const pairId = category === 'face-components' && typeof document?.pairId === 'string' ? document.pairId : ''
        const faceKind = category === 'face-components' ? String(document?.kind ?? '') : String(named?.sheet ?? document?.category ?? assetId.replace(/^sheet-/, ''))
        const section = category === 'models' ? 'Modelos Dev' : category === 'wardrobe' ? 'Roupas Dev 2.0' : category === 'hair' ? 'Cabelos Dev' : category === 'face-components' ? faceKind === 'head-extra' ? 'Cabeças extra Dev' : ['eye', 'pupil', 'eye-closed', 'eyebrow'].includes(faceKind) ? 'Olhos Dev' : 'Rosto Dev' : ['eyes', 'eyebrows'].includes(faceKind) ? 'Olhos Dev' : 'Rosto Dev'
        const groupId = `${pairId ? `${category}/${id.split('/')[1]}/pair-${pairId}` : relative(root, collectionFolder).split(sep).join('/')}::${section}`
        const fallbackGroup = basename(collectionFolder).replace(/^(set-|style-|item-|slot-)/, '').replace(/-/g, ' ')
        const groupName = pairId && typeof document?.kind === 'string' ? `${document.kind} · par` : typeof document?.name === 'string' ? document.name : `${labelsFor(category)} ${fallbackGroup}`
        result.push({ id, groupId, groupName, name, category, section, location: id.split('/').slice(1, -1).join(' / '), edited })
      }
    }
    await visit(root)
    return result.sort((a, b) => a.id.localeCompare(b.id, 'pt-BR', { numeric: true }))
  }

  async load(id: string): Promise<PaintDocument> {
    const path = this.pathFor(id)
    const original = await readFile(path)
    return { originalDataUrl: dataUrl(original), currentDataUrl: dataUrl(await this.readEffective(path)), sourceHash: hash(original), edited: await this.edited(path, original) }
  }

  async thumbnail(id: string): Promise<string> {
    const path = this.pathFor(id)
    const image = nativeImage.createFromBuffer(await this.readEffective(path))
    if (image.isEmpty()) throw new Error('Imagem inválida para miniatura.')
    return image.resize({ width: 128, height: 104, quality: 'good' }).toDataURL()
  }

  async save(id: string, expectedSourceHash: string, editedDataUrl: string): Promise<void> {
    const path = this.pathFor(id)
    const original = await readFile(path)
    if (hash(original) !== expectedSourceHash) throw new Error('O asset original mudou. Reabra a peça antes de salvar.')
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(editedDataUrl)
    if (!match || editedDataUrl.length > 70_000_000) throw new Error('Imagem PNG inválida ou grande demais.')
    const bytes = Buffer.from(match[1], 'base64')
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Arquivo PNG inválido.')
    if (bytes.length < 24 || !original.subarray(0, 8).equals(bytes.subarray(0, 8)) || bytes.readUInt32BE(16) !== original.readUInt32BE(16) || bytes.readUInt32BE(20) !== original.readUInt32BE(20)) throw new Error('A edição deve manter as dimensões originais da peça.')
    await mkdir(dirname(path), { recursive: true })
    const tempImage = `${sidecar(path)}.tmp`
    const tempMetadata = `${metadata(path)}.tmp`
    await writeFile(tempImage, bytes)
    await writeFile(tempMetadata, JSON.stringify({ sourceHash: expectedSourceHash, updatedAt: new Date().toISOString() }))
    await rename(tempImage, sidecar(path))
    await rename(tempMetadata, metadata(path))
  }

  async remove(id: string): Promise<void> {
    const path = this.pathFor(id)
    await Promise.all([unlink(sidecar(path)).catch(() => undefined), unlink(metadata(path)).catch(() => undefined)])
  }
}
