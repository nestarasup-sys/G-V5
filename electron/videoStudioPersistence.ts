import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { mkdir, readFile, writeFile, rename, readdir, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { StudioAsset, StudioDocument } from '../src/shared/studio'
import type { VideoProject, VideoProjectSummary } from '../src/shared/videoStudio'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH = /^[a-f0-9]{64}$/
const root = () => join(app.getPath('userData'), 'video-studios')
const folderFor = (id: string) => {
  if (!UUID.test(id)) throw new Error('Identificador de Video Studio inválido.')
  return join(root(), `video-${id}`)
}
type StoredAsset = Omit<StudioAsset, 'dataUrl'> & { hash: string }
type StoredVideoProject = Omit<VideoProject, 'scene'> & {
  scene: Omit<StudioDocument, 'assets'> & { assets: StoredAsset[] }
}
let queue: Promise<void> = Promise.resolve()
export function waitForVideoStudioWrites(): Promise<void> { return queue }

function isValidProject(value: unknown): value is VideoProject {
  if (!value || typeof value !== 'object') return false
  const p = value as VideoProject
  if (p.schemaVersion !== 1 || !UUID.test(p.id ?? '') || typeof p.title !== 'string'
    || !p.title.trim() || p.title.length > 100 || !Number.isFinite(Date.parse(p.createdAt))
    || !Number.isFinite(Date.parse(p.updatedAt)) || !Number.isInteger(p.frameRate)
    || p.frameRate < 1 || p.frameRate > 240 || !Number.isInteger(p.durationFrames)
    || p.durationFrames < 1 || p.durationFrames > 240 * 60 * 60 * 8
    || !p.scene || p.scene.schemaVersion !== 1 || !Array.isArray(p.scene.assets)
    || !Array.isArray(p.scene.elements) || p.scene.assets.length > 500
    || p.scene.elements.length > 1000 || !/^#[0-9a-f]{6}$/i.test(p.scene.backgroundColor ?? '')
    || !Array.isArray(p.characterTracks) || p.characterTracks.length > 1000
    || !Array.isArray(p.textTracks) || p.textTracks.length !== 2
    || !Array.isArray(p.saveMarkers) || p.saveMarkers.length > 100000) return false
  if (!p.scene.assets.every((a) => UUID.test(a.id)
    && ['background','object','character'].includes(a.category)
    && ['image/png','image/jpeg','image/webp'].includes(a.mimeType)
    && typeof a.dataUrl === 'string' && a.dataUrl.startsWith(`data:${a.mimeType};base64,`)
    && a.dataUrl.length <= 70_000_000)) return false
  const actors = new Set(p.scene.elements.filter((e) => e.kind === 'character').map((e) => e.id))
  const seen = new Set<string>()
  for (const track of p.characterTracks) {
    if (!actors.has(track.characterElementId) || seen.has(track.characterElementId)) return false
    seen.add(track.characterElementId)
    if (typeof track.id !== 'string' || !track.id || !Array.isArray(track.segments) || track.segments.length < 1) return false
    let frame = 0
    for (const segment of track.segments) {
      if (typeof segment.id !== 'string' || !segment.id
        || segment.startFrame !== frame || !Number.isInteger(segment.endFrameExclusive)
        || segment.endFrameExclusive <= frame || segment.endFrameExclusive > p.durationFrames
        || !segment.state || !['idle','blink','talk'].includes(segment.state.faceMode)
        || segment.transitionInMs !== 20
        || !(segment.state.poseSlot === null || Number.isInteger(segment.state.poseSlot))
        || !(segment.state.expressionPresetId === null || typeof segment.state.expressionPresetId === 'string')) return false
      frame = segment.endFrameExclusive
    }
    if (frame !== p.durationFrames) return false
  }
  if (actors.size !== seen.size) return false
  if (p.textTracks.some((track) => !['dialogue','thought'].includes(track.id)
    || !Array.isArray(track.clips) || track.clips.length > 20000
    || track.clips.some((clip) => !clip.id || typeof clip.text !== 'string' || clip.text.length > 10000
      || !Number.isInteger(clip.startFrame) || clip.startFrame < 0
      || !Number.isInteger(clip.endFrameExclusive) || clip.endFrameExclusive <= clip.startFrame
      || clip.endFrameExclusive > p.durationFrames))) return false
  if (new Set(p.textTracks.map((t) => t.id)).size !== 2) return false
  return p.saveMarkers.every((m) => Number.isInteger(m.frame) && m.frame >= 0
    && m.frame < p.durationFrames && Array.isArray(m.affectedTrackIds))
}

async function saveProject(project: VideoProject): Promise<void> {
  if (!isValidProject(project)) throw new Error('Documento do Video Studio inválido.')
  const folder = folderFor(project.id)
  const assetsDir = join(folder, 'assets')
  await mkdir(assetsDir, { recursive: true })
  const manifest: StoredAsset[] = []
  for (const asset of project.scene.assets) {
    const prefix = `data:${asset.mimeType};base64,`
    const base64 = asset.dataUrl.slice(prefix.length)
    if (!/^[a-z0-9+/]*={0,2}$/i.test(base64)) throw new Error('Asset inválido.')
    const data = Buffer.from(base64, 'base64')
    if (data.length > 50 * 1024 * 1024) throw new Error('Asset excede 50 MB.')
    const hash = createHash('sha256').update(data).digest('hex')
    const extension = asset.mimeType === 'image/jpeg' ? 'jpg' : asset.mimeType.slice(6)
    const final = join(assetsDir, `${hash}.${extension}`)
    try {
      await access(final)
    } catch {
      const temp = join(assetsDir, `.${randomUUID()}.tmp`)
      await writeFile(temp, data)
      await rename(temp, final)
    }
    const { dataUrl: _dataUrl, ...metadata } = asset
    manifest.push({ ...metadata, hash })
  }
  const { assets: _assets, ...scene } = project.scene
  const stored: StoredVideoProject = { ...project, scene: { ...scene, assets: manifest } }
  const temp = join(folder, `project-${randomUUID()}.tmp`)
  await writeFile(temp, JSON.stringify(stored, null, 2), 'utf8')
  await rename(temp, join(folder, 'project.json'))
}

async function readStored(id: string): Promise<StoredVideoProject> {
  const data = JSON.parse(await readFile(join(folderFor(id), 'project.json'), 'utf8')) as StoredVideoProject
  if (data.id !== id || data.schemaVersion !== 1 || !Array.isArray(data.scene?.assets)) throw new Error('Manifesto inválido.')
  return data
}
async function loadProject(id: string): Promise<VideoProject> {
  const stored = await readStored(id)
  const assets = await Promise.all(stored.scene.assets.map(async (asset) => {
    if (!HASH.test(asset.hash) || !['image/png','image/jpeg','image/webp'].includes(asset.mimeType)) throw new Error('Referência de mídia inválida.')
    const ext = asset.mimeType === 'image/jpeg' ? 'jpg' : asset.mimeType.slice(6)
    const data = await readFile(join(folderFor(id), 'assets', `${asset.hash}.${ext}`))
    if (createHash('sha256').update(data).digest('hex') !== asset.hash) throw new Error('Asset alterado/corrompido.')
    const { hash: _hash, ...metadata } = asset
    return { ...metadata, dataUrl: `data:${asset.mimeType};base64,${data.toString('base64')}` }
  }))
  const project: VideoProject = { ...stored, scene: { ...stored.scene, assets } }
  if (!isValidProject(project)) throw new Error('Projeto de vídeo corrompido ou incompatível.')
  return project
}
async function listProjects(): Promise<VideoProjectSummary[]> {
  await mkdir(root(), { recursive: true })
  const entries = await readdir(root(), { withFileTypes: true })
  const items = await Promise.all(entries.filter((e) => e.isDirectory() && /^video-[0-9a-f-]{36}$/i.test(e.name))
    .map(async (entry): Promise<VideoProjectSummary | null> => {
      try {
        const p = await readStored(entry.name.slice('video-'.length))
        return { id: p.id, title: p.title, createdAt: p.createdAt, updatedAt: p.updatedAt,
          frameRate: p.frameRate, durationFrames: p.durationFrames, characterCount: p.characterTracks.length }
      } catch { return null }
    }))
  return items.filter((x): x is VideoProjectSummary => x !== null)
    .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Restricted IPC entry points; no caller-supplied disk paths are accepted. */
export function registerVideoStudioHandlers(assertTrustedSender: (event: IpcMainInvokeEvent) => void): void {
  ipcMain.handle('video-studio:list', (event) => { assertTrustedSender(event); return queue.then(listProjects) })
  ipcMain.handle('video-studio:load', (event, id: string) => { assertTrustedSender(event); return queue.then(() => loadProject(id)) })
  ipcMain.handle('video-studio:save', (event, project: VideoProject) => {
    assertTrustedSender(event)
    const next = queue.catch(() => undefined).then(() => saveProject(project))
    queue = next
    return next
  })
  ipcMain.handle('video-studio:delete', (event, id: string) => {
    assertTrustedSender(event)
    const next = queue.catch(() => undefined).then(async () => {
      await rm(folderFor(id), { recursive: true, force: true })
    })
    queue = next
    return next
  })
}
