import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { mkdir, readFile, writeFile, readdir, unlink, rename } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { FabricatorAssetSave, FabricatorProject, FabricatorProjectSave, FabricatorSlotSummary, ModelPart } from '../src/shared/fabricator'

const slotCount = 10
const libraryPath = () => join(app.getPath('userData'), 'fabricator', 'models')
const slotPath = (slot: number) => join(libraryPath(), `slot-${slot}`)

function isValidSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 1 && slot <= slotCount
}

function dataUrlBuffer(dataUrl: string): Buffer {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!match) throw new Error('Arquivo de peça inválido.')
  return Buffer.from(match[1], 'base64')
}

async function registerFabricatorHandlers(): Promise<void> {
  ipcMain.handle('fabricator:list-slots', async (): Promise<FabricatorSlotSummary[]> => {
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

  ipcMain.handle('fabricator:import-model', async (_event, slot: number) => {
    if (!isValidSlot(slot)) throw new Error('Slot inválido.')
    const result = await dialog.showOpenDialog({
      title: 'Importar folha de modelo',
      properties: ['openFile'],
      filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const path = result.filePaths[0]
    const extension = extname(path).toLowerCase()
    const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg'
    const bytes = await readFile(path)
    const sourceDataUrl = `data:${mime};base64,${bytes.toString('base64')}`
    const destination = slotPath(slot)
    const sourceAssetName = `source-${randomUUID()}${extension}`
    await mkdir(destination, { recursive: true })
    await writeFile(join(destination, sourceAssetName), bytes)
    return { sourceName: basename(path), sourceAssetName, sourceDataUrl }
  })

  ipcMain.handle('fabricator:load-slot', async (_event, slot: number): Promise<FabricatorProject | null> => {
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

  ipcMain.handle('fabricator:save-project', async (_event, project: FabricatorProjectSave, changedAssets: FabricatorAssetSave[]): Promise<void> => {
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
    for (const part of parts) await readFile(join(partsFolder, `${part.id}.png`))
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
    for (const file of await readdir(folder)) {
      if (/^source-[a-f0-9-]+\.(png|jpe?g|webp)$/i.test(file) && file !== sourceFile) await unlink(join(folder, file))
    }
  })
}

function createMainWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#f7f8fa',
    title: 'Gacha Nymi',
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
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
