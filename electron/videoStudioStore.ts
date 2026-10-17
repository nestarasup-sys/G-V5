import { app, dialog } from 'electron'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { VideoAsset, VideoProject } from '../src/shared/videoStudio'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const hashFilePattern = /^[a-f0-9]{64}\.(?:png|jpg|webp)$/
const validMime = new Set(['image/png', 'image/jpeg', 'image/webp'])
const validCategories = new Set(['background', 'object', 'character'])
const MAX_IMAGE_BYTES = 50 * 1024 * 1024

export const videoStudioLibraryPath = () => join(app.getPath('userData'), 'video-studios')

function projectFolder(id: string): string {
  if (!uuidPattern.test(id)) throw new Error('Identificador de Video Studio inválido.')
  const folder = resolve(videoStudioLibraryPath(), 'video-' + id)
  if (dirname(folder) !== resolve(videoStudioLibraryPath())) throw new Error('Caminho inválido.')
  return folder
}

function imageExtension(mimeType: string): 'png' | 'jpg' | 'webp' {
  if (!validMime.has(mimeType)) throw new Error('Tipo de imagem inválido.')
  return mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png'
}

function validProject(project: VideoProject): boolean {
  if (!project || project.schemaVersion !== 1 || !uuidPattern.test(project.id)
    || typeof project.title !== 'string' || !project.title.trim() || project.title.length > 100
    || ![project.createdAt, project.updatedAt].every(value => typeof value === 'string' && Number.isFinite(Date.parse(value)))
    || !Number.isInteger(project.frameRate) || project.frameRate < 1 || project.frameRate > 120
    || !Number.isInteger(project.durationFrames) || project.durationFrames < 1 || project.durationFrames > project.frameRate * 36000
    || !project.canvas || !Number.isInteger(project.canvas.width) || !Number.isInteger(project.canvas.height)
    || project.canvas.width < 64 || project.canvas.height < 64 || project.canvas.width > 8192 || project.canvas.height > 8192
    || typeof project.canvas.backgroundColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(project.canvas.backgroundColor)
    || (project.canvas.backgroundAssetId !== null && typeof project.canvas.backgroundAssetId !== 'string')
    || !Array.isArray(project.assets) || project.assets.length > 250
    || !Array.isArray(project.elements) || project.elements.length > 250
    || !Array.isArray(project.characterTracks) || project.characterTracks.length > 250
    || !Array.isArray(project.textTracks) || project.textTracks.length > 30
    || !Array.isArray(project.saveMarkers) || project.saveMarkers.length > 50000) return false

  if (!project.assets.every(asset => uuidPattern.test(asset.id) && validCategories.has(asset.category)
      && validMime.has(asset.mimeType) && typeof asset.name === 'string'
      && asset.name.length <= 255 && typeof asset.dataUrl === 'string'
      && asset.dataUrl.startsWith('data:' + asset.mimeType + ';base64,')
      && asset.dataUrl.length <= MAX_IMAGE_BYTES * 1.5)) return false

  const assets = new Set(project.assets.map(asset => asset.id))
  const elements = new Set(project.elements.map(element => element.id))
  if (assets.size !== project.assets.length || elements.size !== project.elements.length) return false
  if (project.canvas.backgroundAssetId && !assets.has(project.canvas.backgroundAssetId)) return false
  if (!project.elements.every(element => uuidPattern.test(element.id) && assets.has(element.assetId)
      && (element.kind === 'image' || element.kind === 'character')
      && typeof element.name === 'string' && element.name.length <= 120
      && [element.x, element.y, element.width, element.height, element.rotation, element.zIndex].every(Number.isFinite)
      && typeof element.flipX === 'boolean'
      && (element.faceAssets === undefined || Object.entries(element.faceAssets).every(([role, id]) =>
        ['idle', 'blink', 'talk'].includes(role) && typeof id === 'string' && assets.has(id))))) return false

  const trackIds = new Set<string>()
  for (const track of project.characterTracks) {
    if (!uuidPattern.test(track.id) || trackIds.has(track.id) || !elements.has(track.elementId)
      || !Number.isFinite(track.order) || typeof track.locked !== 'boolean' || !Array.isArray(track.segments)
      || track.segments.length < 1 || track.segments.length > 50000) return false
    trackIds.add(track.id)
    let end = 0
    for (const segment of track.segments) {
      if (!uuidPattern.test(segment.id) || segment.startFrame !== end || !Number.isInteger(segment.endFrameExclusive)
        || segment.endFrameExclusive <= segment.startFrame || segment.endFrameExclusive > project.durationFrames
        || !segment.state || !['idle', 'blink', 'talk'].includes(segment.state.faceMode)
        || (segment.state.poseId !== null && typeof segment.state.poseId !== 'string')
        || (segment.state.expressionId !== null && typeof segment.state.expressionId !== 'string')
        || !Number.isFinite(segment.transitionInMs) || segment.transitionInMs < 0 || segment.transitionInMs > 1000) return false
      end = segment.endFrameExclusive
    }
    if (end !== project.durationFrames) return false
  }
  for (const track of project.textTracks) {
    if ((track.kind !== 'dialogue' && track.kind !== 'thought') || !Array.isArray(track.clips)
      || track.clips.length > 50000 || !track.clips.every(clip =>
        uuidPattern.test(clip.id) && Number.isInteger(clip.startFrame) && clip.startFrame >= 0
        && Number.isInteger(clip.endFrameExclusive) && clip.endFrameExclusive <= project.durationFrames
        && clip.endFrameExclusive > clip.startFrame && typeof clip.text === 'string' && clip.text.length <= 20000)) return false
  }
  if (!project.saveMarkers.every(marker => Number.isInteger(marker.frame) && marker.frame >= 0
      && marker.frame < project.durationFrames && Array.isArray(marker.affectedTrackIds)
      && marker.affectedTrackIds.every(id => trackIds.has(id)))) return false
  return true
}

type StoredAsset = Omit<VideoAsset, 'dataUrl'> & { fileName: string }
type StoredProject = Omit<VideoProject, 'assets'> & { assets: StoredAsset[] }

export async function saveVideoProject(project: VideoProject): Promise<void> {
  if (!validProject(project)) throw new Error('Dados do Video Studio inválidos.')
  const folder = projectFolder(project.id)
  const assetsFolder = join(folder, 'assets')
  await mkdir(assetsFolder, { recursive: true })

  const manifest: StoredAsset[] = []
  for (const asset of project.assets) {
    const raw = asset.dataUrl.slice(asset.dataUrl.indexOf(',') + 1)
    const bytes = Buffer.from(raw, 'base64')
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Imagem excede 50 MB.')
    const hash = createHash('sha256').update(bytes).digest('hex')
    const fileName = hash + '.' + imageExtension(asset.mimeType)
    await writeFile(join(assetsFolder, fileName), bytes)
    const { dataUrl: _dataUrl, ...metadata } = asset
    manifest.push({ ...metadata, fileName })
  }

  const { assets: _assets, ...document } = project
  const temporary = join(folder, 'video-project.json.tmp')
  await writeFile(temporary, JSON.stringify({ ...document, title: project.title.trim(), assets: manifest }, null, 2), 'utf8')
  await rename(temporary, join(folder, 'video-project.json'))
}

async function readVideoProject(id: string): Promise<VideoProject | null> {
  try {
    const folder = projectFolder(id)
    const stored = JSON.parse(await readFile(join(folder, 'video-project.json'), 'utf8')) as StoredProject
    if (!Array.isArray(stored.assets) || stored.assets.length > 250) throw new Error('Assets inválidos.')
    const assets: VideoAsset[] = await Promise.all(stored.assets.map(async asset => {
      if (!hashFilePattern.test(asset.fileName) || !uuidPattern.test(asset.id)
        || !validMime.has(asset.mimeType) || !validCategories.has(asset.category)
        || extname(asset.fileName).slice(1) !== imageExtension(asset.mimeType)) throw new Error('Asset inválido.')
      const bytes = await readFile(join(folder, 'assets', asset.fileName))
      if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Asset grande demais.')
      const expectedHash = createHash('sha256').update(bytes).digest('hex')
      if (asset.fileName !== expectedHash + '.' + imageExtension(asset.mimeType)) throw new Error('Integridade do asset inválida.')
      const { fileName: _fileName, ...metadata } = asset
      return { ...metadata, dataUrl: 'data:' + asset.mimeType + ';base64,' + bytes.toString('base64') }
    }))
    const project = { ...stored, assets, id } as VideoProject
    if (!validProject(project)) throw new Error('Projeto de vídeo inválido.')
    return project
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw reason
  }
}

export async function listVideoProjects(): Promise<VideoProject[]> {
  await mkdir(videoStudioLibraryPath(), { recursive: true })
  const entries = await readdir(videoStudioLibraryPath(), { withFileTypes: true })
  const projects = await Promise.all(entries
    .filter(entry => entry.isDirectory() && /^video-[0-9a-f-]{36}$/i.test(entry.name))
    .map(entry => readVideoProject(entry.name.slice(6))))
  return projects.filter((project): project is VideoProject => project !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function deleteVideoProject(id: string): Promise<void> {
  await rm(projectFolder(id), { recursive: true, force: true })
}

export async function importVideoImage(category: VideoAsset['category']): Promise<VideoAsset | null> {
  if (!validCategories.has(category)) throw new Error('Categoria inválida.')
  const result = await dialog.showOpenDialog({
    title: category === 'background' ? 'Importar fundo' : category === 'character' ? 'Importar personagem' : 'Importar objeto',
    properties: ['openFile'],
    filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
  })
  if (result.canceled || !result.filePaths[0]) return null
  const file = result.filePaths[0]
  if ((await stat(file)).size > MAX_IMAGE_BYTES) throw new Error('Imagem excede 50 MB.')
  const extension = extname(file).toLowerCase()
  const mimeType: VideoAsset['mimeType'] = extension === '.png' ? 'image/png'
    : extension === '.webp' ? 'image/webp' : 'image/jpeg'
  const bytes = await readFile(file)
  return {
    id: randomUUID(), category, name: basename(file), mimeType,
    dataUrl: 'data:' + mimeType + ';base64,' + bytes.toString('base64')
  }
}
