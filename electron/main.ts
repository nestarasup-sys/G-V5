import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { mkdir, readFile, writeFile, readdir, unlink, rename, stat, access, rm } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { FabricatorAssetSave, FabricatorHistoryEntry, FabricatorHistorySaveEntry, FabricatorHistorySaveState, FabricatorHistoryState, FabricatorProject, FabricatorProjectSave, FabricatorSlotSummary, ModelPart } from '../src/shared/fabricator'

const slotCount = 10
const libraryPath = () => join(app.getPath('userData'), 'fabricator', 'models')
const slotPath = (slot: number) => join(libraryPath(), `slot-${slot}`)
const fabricatorSaveQueues = new Map<number, Promise<void>>()

function isValidSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 1 && slot <= slotCount
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url
  if (!senderUrl) throw new Error('Origem da solicitação inválida.')
  const expectedUrl = process.env.ELECTRON_RENDERER_URL
  if (expectedUrl) {
    if (new URL(senderUrl).origin !== new URL(expectedUrl).origin) throw new Error('Origem da solicitação não autorizada.')
  } else if (resolve(fileURLToPath(senderUrl)) !== resolve(join(__dirname, '../renderer/index.html'))) {
    throw new Error('Origem da solicitação não autorizada.')
  }
}

function dataUrlBuffer(dataUrl: string): Buffer {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!match) throw new Error('Arquivo de peça inválido.')
  return Buffer.from(match[1], 'base64')
}

type StoredHistoryEntry = {
  action: FabricatorHistoryEntry['action']
  project: Omit<FabricatorProject, 'sourceDataUrl' | 'parts'>
  parts: Array<{ part: Omit<ModelPart, 'dataUrl'>; hash: string }>
}

async function writeFabricatorHistory(slot: number, history: FabricatorHistorySaveState): Promise<void> {
  if (!isValidSlot(slot) || !Array.isArray(history.undo) || !Array.isArray(history.redo) || history.undo.length > 50 || history.redo.length > 50) throw new Error('Histórico inválido.')
  const folder = join(slotPath(slot), 'history')
  const assetsFolder = join(folder, 'assets')
  await mkdir(assetsFolder, { recursive: true })
  const referencedAssets = new Set<string>()
  const storeAsset = async (bytes: Buffer, extension: string): Promise<string> => {
    const hash = createHash('sha256').update(bytes).digest('hex')
    const filename = `${hash}.${extension}`
    referencedAssets.add(filename)
    try { await access(join(assetsFolder, filename)) } catch { await writeFile(join(assetsFolder, filename), bytes) }
    return hash
  }
  const serializeEntry = async (entry: FabricatorHistorySaveEntry): Promise<StoredHistoryEntry> => {
    const snapshot = entry.project
    if (snapshot.slot !== slot || snapshot.schemaVersion !== 1 || snapshot.parts.length > 500) throw new Error('Snapshot de histórico inválido.')
    if (!/^source-[a-f0-9-]+\.(png|jpe?g|webp)$/i.test(snapshot.sourceAssetName)) throw new Error('Imagem original no histórico inválida.')
    await access(join(slotPath(slot), snapshot.sourceAssetName))
    const parts = await Promise.all(snapshot.parts.map(async (part) => {
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(part.id)) throw new Error('Peça de histórico inválida.')
      return { part: (({ dataUrl: _dataUrl, ...metadata }) => metadata)(part), hash: await storeAsset(dataUrlBuffer(part.dataUrl), 'png') }
    }))
    const { parts: _parts, ...metadata } = snapshot
    return { action: entry.action, project: metadata, parts }
  }
  const stored = {
    version: 1,
    undo: await Promise.all(history.undo.map(serializeEntry)),
    redo: await Promise.all(history.redo.map(serializeEntry))
  }
  const temporaryManifest = join(folder, 'history.json.tmp')
  await writeFile(temporaryManifest, JSON.stringify(stored), 'utf8')
  await rename(temporaryManifest, join(folder, 'history.json'))
  for (const filename of await readdir(assetsFolder)) if (!referencedAssets.has(filename)) await unlink(join(assetsFolder, filename))
  const keptSources = new Set([
    ...stored.undo.map((entry) => entry.project.sourceAssetName),
    ...stored.redo.map((entry) => entry.project.sourceAssetName)
  ])
  try {
    const current = JSON.parse(await readFile(join(slotPath(slot), 'project.json'), 'utf8')) as { sourceFile?: string }
    if (current.sourceFile) keptSources.add(current.sourceFile)
  } catch { /* The current project may not yet have a manifest. */ }
  for (const filename of await readdir(slotPath(slot))) {
    if (/^source-[a-f0-9-]+\.(png|jpe?g|webp)$/i.test(filename) && !keptSources.has(filename)) await unlink(join(slotPath(slot), filename))
  }
}

async function readFabricatorHistory(slot: number): Promise<FabricatorHistoryState> {
  const folder = join(slotPath(slot), 'history')
  const assetsFolder = join(folder, 'assets')
  const stored = JSON.parse(await readFile(join(folder, 'history.json'), 'utf8')) as {
    version: number
    undo: StoredHistoryEntry[]
    redo: StoredHistoryEntry[]
  }
  if (stored.version !== 1 || !Array.isArray(stored.undo) || !Array.isArray(stored.redo) || stored.undo.length > 50 || stored.redo.length > 50) throw new Error('Arquivo de histórico inválido.')
  const cache = new Map<string, Buffer>()
  const readAsset = async (hash: string, extension: string) => {
    if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error('Referência de histórico inválida.')
    const key = `${hash}.${extension}`
    let bytes = cache.get(key)
    if (!bytes) { bytes = await readFile(join(assetsFolder, key)); cache.set(key, bytes) }
    return bytes
  }
  const restoreEntry = async (entry: StoredHistoryEntry): Promise<FabricatorHistoryEntry> => {
    if (!['edit', 'mixer', 'reset'].includes(entry.action) || entry.project.slot !== slot) throw new Error('Snapshot de histórico inválido.')
    if (!/^source-[a-f0-9-]+\.(png|jpe?g|webp)$/i.test(entry.project.sourceAssetName)) throw new Error('Imagem original do histórico inválida.')
    const source = await readFile(join(slotPath(slot), entry.project.sourceAssetName))
    const extension = extname(entry.project.sourceAssetName).toLowerCase()
    const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg'
    const parts = await Promise.all(entry.parts.map(async ({ part, hash }) => ({
      ...part,
      dataUrl: `data:image/png;base64,${(await readAsset(hash, 'png')).toString('base64')}`
    })))
    return {
      action: entry.action,
      project: { ...entry.project, sourceDataUrl: `data:${mime};base64,${source.toString('base64')}`, parts }
    }
  }
  return { undo: await Promise.all(stored.undo.map(restoreEntry)), redo: await Promise.all(stored.redo.map(restoreEntry)) }
}

async function writeFabricatorProject(project: FabricatorProjectSave, changedAssets: FabricatorAssetSave[]): Promise<void> {
  if (!isValidSlot(project.slot) || project.schemaVersion !== 1 || project.parts.length > 500) throw new Error('Projeto inválido.')
  const folder = slotPath(project.slot)
  const partsFolder = join(folder, 'parts')
  await mkdir(partsFolder, { recursive: true })
  const sourceFile = project.sourceAssetName
  if (!/^source-[a-f0-9-]+\.(png|jpe?g|webp)$/i.test(sourceFile)) throw new Error('Imagem original inválida.')
  await readFile(join(folder, sourceFile))
  const parts = project.parts.map((part) => {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(part.id)) throw new Error('Identificador de peça inválido.')
    return part
  })
  const validPartIds = new Set(parts.map((part) => part.id))
  for (const asset of changedAssets) {
    if (!validPartIds.has(asset.id)) continue
    await writeFile(join(partsFolder, `${asset.id}.png`), dataUrlBuffer(asset.dataUrl))
  }
  // Never publish a manifest until every referenced image exists. Serializing
  // saves per slot also prevents an older save from deleting a newer asset.
  const missingAssets: string[] = []
  for (const part of parts) {
    try { await access(join(partsFolder, `${part.id}.png`)) } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
      missingAssets.push(part.id)
    }
  }
  if (missingAssets.length) throw new Error(`FABRICATOR_MISSING_ASSETS:${missingAssets.join(',')}`)
  const projectDocument = {
    schemaVersion: project.schemaVersion,
    slot: project.slot,
    name: project.name,
    sourceName: project.sourceName,
    sourceAssetName: project.sourceAssetName,
    width: project.width,
    height: project.height,
    tolerance: project.tolerance,
    joints: project.joints,
    layerOrder: project.layerOrder,
    hiddenPartIds: project.hiddenPartIds,
    updatedAt: project.updatedAt
  }
  const manifest = { ...projectDocument, parts, sourceFile }
  const manifestTemp = join(folder, 'project.json.tmp')
  await writeFile(manifestTemp, JSON.stringify(manifest), 'utf8')
  await rename(manifestTemp, join(folder, 'project.json'))
  const keepFiles = new Set(parts.map((part) => `${part.id}.png`))
  for (const file of await readdir(partsFolder)) {
    if (file.endsWith('.png') && !keepFiles.has(file)) await unlink(join(partsFolder, file))
  }
  const keptSources = new Set([sourceFile])
  try {
    const history = JSON.parse(await readFile(join(folder, 'history', 'history.json'), 'utf8')) as { undo?: Array<{ project?: { sourceAssetName?: string } }>; redo?: Array<{ project?: { sourceAssetName?: string } }> }
    for (const entry of [...(history.undo ?? []), ...(history.redo ?? [])]) if (entry.project?.sourceAssetName) keptSources.add(entry.project.sourceAssetName)
  } catch { /* No persisted history yet. */ }
  for (const file of await readdir(folder)) {
    if (/^source-[a-f0-9-]+\.(png|jpe?g|webp)$/i.test(file) && !keptSources.has(file)) await unlink(join(folder, file))
  }
}

async function registerFabricatorHandlers(): Promise<void> {
  ipcMain.handle('fabricator:list-slots', async (event): Promise<FabricatorSlotSummary[]> => {
    assertTrustedSender(event)
    const slots: FabricatorSlotSummary[] = Array.from({ length: slotCount }, () => null)
    for (let slot = 1; slot <= slotCount; slot += 1) {
      try {
        const manifest = JSON.parse(await readFile(join(slotPath(slot), 'project.json'), 'utf8')) as Omit<FabricatorProject, 'sourceDataUrl' | 'parts'> & {
          sourceFile: string
          parts: Array<Omit<ModelPart, 'dataUrl'>>
        }
        slots[slot - 1] = { slot, name: manifest.name, sourceName: manifest.sourceName, partCount: manifest.parts.length, updatedAt: manifest.updatedAt }
      } catch { /* Slots without a valid manifest are empty. */ }
    }
    return slots
  })

  ipcMain.handle('fabricator:import-model', async (event, slot: number) => {
    assertTrustedSender(event)
    if (!isValidSlot(slot)) throw new Error('Slot inválido.')
    const result = await dialog.showOpenDialog({
      title: 'Importar folha de modelo',
      properties: ['openFile'],
      filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const path = result.filePaths[0]
    const extension = extname(path).toLowerCase()
    if ((await stat(path)).size > 50 * 1024 * 1024) throw new Error('A imagem excede o limite de 50 MB.')
    const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg'
    const bytes = await readFile(path)
    const sourceDataUrl = `data:${mime};base64,${bytes.toString('base64')}`
    const destination = slotPath(slot)
    const sourceAssetName = `source-${randomUUID()}${extension}`
    await mkdir(destination, { recursive: true })
    await writeFile(join(destination, sourceAssetName), bytes)
    return { sourceName: basename(path), sourceAssetName, sourceDataUrl }
  })

  ipcMain.handle('fabricator:load-slot', async (event, slot: number): Promise<FabricatorProject | null> => {
    assertTrustedSender(event)
    if (!isValidSlot(slot)) throw new Error('Slot inválido.')
    try {
      const folder = slotPath(slot)
      const manifest = JSON.parse(await readFile(join(folder, 'project.json'), 'utf8')) as Omit<FabricatorProject, 'sourceDataUrl' | 'parts'> & {
        sourceFile: string
        parts: Array<Omit<ModelPart, 'dataUrl'>>
      }
      if (!/^source-[a-f0-9-]+\.(png|jpe?g|webp)$/i.test(manifest.sourceFile) || manifest.parts.length > 500 || manifest.parts.some((part) => !/^[a-zA-Z0-9_-]{1,80}$/.test(part.id))) return null
      const sourceBytes = await readFile(join(folder, manifest.sourceFile))
      const extension = extname(manifest.sourceFile).toLowerCase()
      const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg'
      const sourceDataUrl = `data:${mime};base64,${sourceBytes.toString('base64')}`
      const parts = await Promise.all(manifest.parts.map(async (part) => ({
        ...part,
        dataUrl: `data:image/png;base64,${(await readFile(join(folder, 'parts', `${part.id}.png`))).toString('base64')}`
      })))
      return { ...manifest, sourceDataUrl, parts }
    } catch { return null }
  })

  ipcMain.handle('fabricator:save-project', async (event, project: FabricatorProjectSave, changedAssets: FabricatorAssetSave[]): Promise<void> => {
    assertTrustedSender(event)
    if (!isValidSlot(project.slot)) throw new Error('Projeto inválido.')
    const slot = project.slot
    const previous = fabricatorSaveQueues.get(slot) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(() => writeFabricatorProject(project, changedAssets))
    fabricatorSaveQueues.set(slot, current)
    try { await current } finally {
      if (fabricatorSaveQueues.get(slot) === current) fabricatorSaveQueues.delete(slot)
    }
  })

  ipcMain.handle('fabricator:load-history', async (event, slot: number): Promise<FabricatorHistoryState> => {
    assertTrustedSender(event)
    if (!isValidSlot(slot)) throw new Error('Slot inválido.')
    try { return await readFabricatorHistory(slot) } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return { undo: [], redo: [] }
      throw reason
    }
  })

  ipcMain.handle('fabricator:save-history', async (event, slot: number, history: FabricatorHistorySaveState, current: FabricatorProjectSave, changedAssets: FabricatorAssetSave[]): Promise<void> => {
    assertTrustedSender(event)
    if (!isValidSlot(slot) || current.slot !== slot) throw new Error('Slot inválido.')
    const previous = fabricatorSaveQueues.get(slot) ?? Promise.resolve()
    const save = previous.catch(() => undefined).then(async () => {
      await writeFabricatorHistory(slot, history)
      await writeFabricatorProject(current, changedAssets)
    })
    fabricatorSaveQueues.set(slot, save)
    try { await save } finally {
      if (fabricatorSaveQueues.get(slot) === save) fabricatorSaveQueues.delete(slot)
    }
  })

  ipcMain.handle('fabricator:delete-slot', async (event, slot: number): Promise<void> => {
    assertTrustedSender(event)
    if (!isValidSlot(slot)) throw new Error('Slot inválido.')
    const previous = fabricatorSaveQueues.get(slot) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(async () => {
      const base = resolve(libraryPath())
      const target = resolve(slotPath(slot))
      if (dirname(target) !== base || basename(target) !== `slot-${slot}`) throw new Error('Caminho de exclusão inválido.')
      await rm(target, { recursive: true, force: true })
    })
    fabricatorSaveQueues.set(slot, current)
    try { await current } finally {
      if (fabricatorSaveQueues.get(slot) === current) fabricatorSaveQueues.delete(slot)
    }
  })
}

function createMainWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#f7f8fa',
    title: 'Gacha Nymi',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  await registerFabricatorHandlers()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let waitingForFabricatorWritesBeforeQuit = false
app.on('before-quit', (event) => {
  const pendingWrites = Array.from(fabricatorSaveQueues.values())
  if (pendingWrites.length === 0 || waitingForFabricatorWritesBeforeQuit) return
  event.preventDefault()
  waitingForFabricatorWritesBeforeQuit = true
  void Promise.allSettled(pendingWrites).then(() => {
    waitingForFabricatorWritesBeforeQuit = false
    app.quit()
  })
})
