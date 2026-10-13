import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { FabricatorProject, FabricatorSlotSummary, ModelPart } from '../src/shared/fabricator'

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
    await mkdir(destination, { recursive: true })
    await writeFile(join(destination, `source${extension}`), bytes)
    for (const item of await readdir(destination)) {
      if (/^source\.(png|jpe?g|webp)$/i.test(item) && item !== `source${extension}`) {
        const { unlink } = await import('node:fs/promises')
        await unlink(join(destination, item))
      }
    }
    return { sourceName: basename(path), sourceDataUrl, width: 0, height: 0 }
  })

  ipcMain.handle('fabricator:load-slot', async (_event, slot: number): Promise<FabricatorProject | null> => {
    if (!isValidSlot(slot)) throw new Error('Slot inválido.')
    try {
      const folder = slotPath(slot)
      const manifest = JSON.parse(await readFile(join(folder, 'project.json'), 'utf8')) as Omit<FabricatorProject, 'sourceDataUrl' | 'parts'> & {
        sourceFile: string
        parts: Array<Omit<ModelPart, 'dataUrl'>>
      }
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

  ipcMain.handle('fabricator:save-project', async (_event, project: FabricatorProject): Promise<void> => {
    if (!isValidSlot(project.slot) || project.schemaVersion !== 1 || project.parts.length > 500) throw new Error('Projeto inválido.')
    const folder = slotPath(project.slot)
    const partsFolder = join(folder, 'parts')
    await mkdir(partsFolder, { recursive: true })
    const sourceExtension = extname(project.sourceName).toLowerCase()
    const sourceFile = `source${['.png', '.jpg', '.jpeg', '.webp'].includes(sourceExtension) ? sourceExtension : '.png'}`
    const sourceMatch = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(project.sourceDataUrl)
    if (!sourceMatch) throw new Error('Imagem original inválida.')
    await writeFile(join(folder, sourceFile), Buffer.from(sourceMatch[2], 'base64'))
    const parts = project.parts.map(({ dataUrl, ...part }) => {
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(part.id)) throw new Error('Identificador de peça inválido.')
      return part
    })
    for (const part of project.parts) await writeFile(join(partsFolder, `${part.id}.png`), dataUrlBuffer(part.dataUrl))
    const manifest = { ...project, sourceDataUrl: undefined, parts, sourceFile }
    await writeFile(join(folder, 'project.json'), JSON.stringify(manifest), 'utf8')
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
