import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import type { DomainFileSystem } from './domainFileSystem.cjs'

let storage: Pick<DomainFileSystem, 'readFile' | 'writeFile'> = { readFile, writeFile }
export function configureAssetImageStorage(adapter: DomainFileSystem) { storage = adapter }

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const sidecar = (path: string) => `${path}.paint.png`
const metadata = (path: string) => `${path}.paint.json`

/** Reads an asset image override while keeping the original source file intact. */
export async function readAssetImage(path: string): Promise<Buffer> {
  const original = await storage.readFile(path)
  try {
    const record = JSON.parse(await storage.readFile(metadata(path), 'utf8')) as { sourceHash: string }
    if (record.sourceHash === hash(original)) return await storage.readFile(sidecar(path))
  } catch { /* No valid override: use the original asset. */ }
  return original
}

/** Keeps a valid override intact when another Fabricator editor saves its effective pixels. */
export async function writeAssetImageSource(path: string, bytes: Buffer): Promise<void> {
  try {
    const original = await storage.readFile(path)
    if (original.equals(bytes)) return
    const record = JSON.parse(await storage.readFile(metadata(path), 'utf8')) as { sourceHash: string }
    if (record.sourceHash === hash(original) && (await storage.readFile(sidecar(path))).equals(bytes)) return
  } catch { /* New or independently changed asset. */ }
  await storage.writeFile(path, bytes)
}
