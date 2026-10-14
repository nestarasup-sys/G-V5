import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { mkdir, readFile, writeFile, readdir, unlink, rename, stat, access, rm, copyFile, cp } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { FabricatorAssetSave, FabricatorHistoryEntry, FabricatorHistorySaveEntry, FabricatorHistorySaveState, FabricatorHistoryState, FabricatorPose, FabricatorPoseDraft, FabricatorPoseDraftSave, FabricatorPoseSave, FabricatorPoseSummary, FabricatorProject, FabricatorProjectSave, FabricatorSlotSummary, ModelPart, PosePart, WardrobeAssetSave, WardrobeCategory, WardrobeSet, WardrobeSetSave, WardrobeSetSummary } from '../src/shared/fabricator'

const slotCount = 10
const poseSlotCount = 12
const libraryPath = () => join(app.getPath('userData'), 'fabricator', 'models')
const slotPath = (slot: number) => join(libraryPath(), `slot-${slot}`)
const poseLibraryPath = () => join(app.getPath('userData'), 'fabricator', 'poses')
const poseModelPath = (modelSlot: number) => join(poseLibraryPath(), `model-${modelSlot}`)
const poseSlotPath = (modelSlot: number, slot: number) => join(poseModelPath(modelSlot), `slot-${slot}`)
const poseDraftPath = (modelSlot: number) => join(poseModelPath(modelSlot), 'draft')
const wardrobeLibraryPath = () => join(app.getPath('userData'), 'fabricator', 'wardrobe')
const wardrobeModelPath = (modelSlot: number) => join(wardrobeLibraryPath(), `model-${modelSlot}`)
const wardrobeSetPath = (modelSlot: number, id: string) => join(wardrobeModelPath(modelSlot), `set-${id}`)
const fabricatorSaveQueues = new Map<number, Promise<void>>()
let poseSaveQueue: Promise<void> = Promise.resolve()
const poseSaveWrites = new Set<Promise<void>>()
let poseMigration: Promise<void> | null = null
let wardrobeSaveQueue: Promise<void> = Promise.resolve()

const wardrobeCategories: WardrobeCategory[] = ['camisa', 'manga-superior', 'manga-inferior', 'calca-coxa', 'calca-canela', 'shorts']
const isValidWardrobeId = (id: string) => /^[a-zA-Z0-9_-]{1,80}$/.test(id)

async function writeWardrobeSet(modelSlot: number, set: WardrobeSetSave, assets: WardrobeAssetSave[]): Promise<void> {
  if (!isValidModelSlot(modelSlot) || set.schemaVersion !== 1 || set.modelSlot !== modelSlot || !isValidWardrobeId(set.id) || !Array.isArray(set.components) || set.components.length < 1 || set.components.length > 100) throw new Error('Conjunto de roupa inválido.')
  const folder = wardrobeSetPath(modelSlot, set.id)
  const partsFolder = join(folder, 'parts')
  await mkdir(partsFolder, { recursive: true })
  const ids = new Set(set.components.map((component) => component.id))
  if (ids.size !== set.components.length || set.components.some((component) => !isValidWardrobeId(component.id) || !wardrobeCategories.includes(component.category) || !isValidWardrobeId(component.attachedPartId))) throw new Error('Peças do conjunto inválidas.')
  for (const asset of assets) if (ids.has(asset.id)) await writeFile(join(partsFolder, `${asset.id}.png`), dataUrlBuffer(asset.dataUrl))
  for (const component of set.components) {
    try { await access(join(partsFolder, `${component.id}.png`)) } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
      throw new Error(`Imagem ausente no conjunto: ${component.name} (${component.id}).`)
    }
  }
  const temporary = join(folder, 'wardrobe.json.tmp')
  await writeFile(temporary, JSON.stringify(set), 'utf8')
  await rename(temporary, join(folder, 'wardrobe.json'))
  const retained = new Set(set.components.map((component) => `${component.id}.png`))
  for (const filename of await readdir(partsFolder)) if (filename.endsWith('.png') && !retained.has(filename)) await unlink(join(partsFolder, filename))
}

async function readWardrobeSet(modelSlot: number, id: string): Promise<WardrobeSet | null> {
  if (!isValidModelSlot(modelSlot) || !isValidWardrobeId(id)) throw new Error('Conjunto de roupa inválido.')
  try {
    const folder = wardrobeSetPath(modelSlot, id)
    const set = JSON.parse(await readFile(join(folder, 'wardrobe.json'), 'utf8')) as WardrobeSetSave
    if (set.schemaVersion !== 1 || set.modelSlot !== modelSlot || set.id !== id || !Array.isArray(set.components) || set.components.length > 100) return null
    const components = await Promise.all(set.components.map(async (component) => ({
      ...component,
      dataUrl: `data:image/png;base64,${(await readFile(join(folder, 'parts', `${component.id}.png`))).toString('base64')}`
    })))
    return { ...set, components }
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw reason
  }
}

function queuePoseWrite(operation: () => Promise<void>): Promise<void> {
  const next = poseSaveQueue.catch(() => undefined).then(operation)
  poseSaveQueue = next
  poseSaveWrites.add(next)
  void next.then(() => poseSaveWrites.delete(next), () => poseSaveWrites.delete(next))
  return next
}

function isValidSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 1 && slot <= slotCount
}

function isValidPoseSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 1 && slot <= poseSlotCount
}

function isValidModelSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 1 && slot <= slotCount
}

function ensureLegacyPoseMigration(): Promise<void> {
  if (poseMigration) return poseMigration
  poseMigration = (async () => {
    const root = poseLibraryPath()
    for (let slot = 1; slot <= poseSlotCount; slot += 1) {
      const legacyFolder = join(root, `slot-${slot}`)
      try {
        const project = JSON.parse(await readFile(join(legacyFolder, 'pose.json'), 'utf8')) as FabricatorPoseSave
        if (!isValidModelSlot(project.sourceModelSlot)) continue
        const destination = poseSlotPath(project.sourceModelSlot, slot)
        try { await access(join(destination, 'pose.json')) } catch {
          await mkdir(dirname(destination), { recursive: true })
          await rename(legacyFolder, destination)
        }
      } catch (reason) {
        if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
      }
    }
    const legacyDraft = join(root, 'draft')
    try {
      const draft = JSON.parse(await readFile(join(legacyDraft, 'draft.json'), 'utf8')) as FabricatorPoseDraftSave
      const modelSlot = draft.project.sourceModelSlot
      if (!isValidModelSlot(modelSlot)) return
      const destination = poseDraftPath(modelSlot)
      try { await access(join(destination, 'draft.json')) } catch {
        await mkdir(dirname(destination), { recursive: true })
        await rename(legacyDraft, destination)
      }
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
    }
  })()
  return poseMigration
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
  parts: Array<{ part: Omit<ModelPart, 'dataUrl' | 'chromaBaseDataUrl'>; hash: string; chromaBaseHash?: string }>
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
      return {
        part: (({ dataUrl: _dataUrl, chromaBaseDataUrl: _baseDataUrl, ...metadata }) => metadata)(part),
        hash: await storeAsset(dataUrlBuffer(part.dataUrl), 'png'),
        ...(part.chromaBaseDataUrl ? { chromaBaseHash: await storeAsset(dataUrlBuffer(part.chromaBaseDataUrl), 'png') } : {})
      }
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
    const parts = await Promise.all(entry.parts.map(async ({ part, hash, chromaBaseHash }) => ({
      ...part,
      dataUrl: `data:image/png;base64,${(await readAsset(hash, 'png')).toString('base64')}`,
      ...(chromaBaseHash ? { chromaBaseDataUrl: `data:image/png;base64,${(await readAsset(chromaBaseHash, 'png')).toString('base64')}` } : {})
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
    if (asset.chromaBaseDataUrl) await writeFile(join(partsFolder, `${asset.id}.base.png`), dataUrlBuffer(asset.chromaBaseDataUrl))
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
    chromaBaseTolerance: project.chromaBaseTolerance,
    joints: project.joints,
    layerOrder: project.layerOrder,
    hiddenPartIds: project.hiddenPartIds,
    updatedAt: project.updatedAt
  }
  const manifest = { ...projectDocument, parts, sourceFile }
  const manifestTemp = join(folder, 'project.json.tmp')
  await writeFile(manifestTemp, JSON.stringify(manifest), 'utf8')
  await rename(manifestTemp, join(folder, 'project.json'))
  const keepFiles = new Set(parts.flatMap((part) => [
    `${part.id}.png`,
    ...(part.chromaBaseSaved ? [`${part.id}.base.png`] : [])
  ]))
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

async function writePoseAssets(folder: string, parts: Array<Omit<PosePart, 'dataUrl'>>, assets: FabricatorAssetSave[], fallbackFolder?: string): Promise<void> {
  const partsFolder = join(folder, 'parts')
  await mkdir(partsFolder, { recursive: true })
  const partIds = new Set(parts.map((part) => part.id))
  for (const asset of assets) {
    if (!partIds.has(asset.id) || !/^[a-zA-Z0-9_-]{1,80}$/.test(asset.id)) continue
    await writeFile(join(partsFolder, `${asset.id}.png`), dataUrlBuffer(asset.dataUrl))
  }
  for (const part of parts) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(part.id)) throw new Error('Peça de pose inválida.')
    const target = join(partsFolder, `${part.id}.png`)
    try { await access(target) } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
      if (!fallbackFolder) throw new Error(`Imagem ausente na pose: ${part.name} (${part.id}).`)
      try { await copyFile(join(fallbackFolder, 'parts', `${part.id}.png`), target) } catch (fallbackReason) {
        if ((fallbackReason as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Imagem ausente na pose e no rascunho: ${part.name} (${part.id}).`)
        throw fallbackReason
      }
    }
  }
  const keepFiles = new Set(parts.map((part) => `${part.id}.png`))
  for (const filename of await readdir(partsFolder)) if (filename.endsWith('.png') && !keepFiles.has(filename)) await unlink(join(partsFolder, filename))
}

async function readPoseAssets(folder: string, parts: Array<Omit<PosePart, 'dataUrl'>>): Promise<PosePart[]> {
  const partsFolder = join(folder, 'parts')
  return Promise.all(parts.map(async (part) => ({
    ...part,
    dataUrl: `data:image/png;base64,${(await readFile(join(partsFolder, `${part.id}.png`))).toString('base64')}`
  })))
}

async function writePoseProject(modelSlot: number, slot: number, project: FabricatorPoseSave, assets: FabricatorAssetSave[]): Promise<void> {
  if (!isValidModelSlot(modelSlot) || project.sourceModelSlot !== modelSlot || !isValidPoseSlot(slot) || project.slot !== slot || project.schemaVersion !== 1 || project.parts.length === 0 || project.parts.length > 500) throw new Error('Pose inválida.')
  const folder = poseSlotPath(modelSlot, slot)
  // A edição automática salva primeiro no diretório de rascunho e consome as
  // imagens pendentes no renderer. Ao salvar no slot, copie as partes já
  // persistidas no rascunho para que o slot independente tenha sua biblioteca.
  await writePoseAssets(folder, project.parts, assets, poseDraftPath(modelSlot))
  const temporary = join(folder, 'pose.json.tmp')
  await writeFile(temporary, JSON.stringify(project), 'utf8')
  await rename(temporary, join(folder, 'pose.json'))
}

async function readPoseProject(modelSlot: number, slot: number): Promise<FabricatorPose | null> {
  if (!isValidModelSlot(modelSlot)) throw new Error('Modelo da pose inválido.')
  if (!isValidPoseSlot(slot)) throw new Error('Slot de pose inválido.')
  try {
    const folder = poseSlotPath(modelSlot, slot)
    const manifest = JSON.parse(await readFile(join(folder, 'pose.json'), 'utf8')) as FabricatorPoseSave
    if (manifest.slot !== slot || manifest.sourceModelSlot !== modelSlot || manifest.schemaVersion !== 1 || manifest.parts.length === 0 || manifest.parts.length > 500) return null
    return { ...manifest, parts: await readPoseAssets(folder, manifest.parts) }
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw reason
  }
}


/**
 * Slot 01 belongs to the assembled source model. A user's pre-existing pose in
 * slot 01 is copied to the first unused slot BEFORE publishing the base pose.
 * This is intentionally lazy: reading the pose library syncs the latest saved
 * model snapshot, never an intermediate drag from the model editor.
 */
async function ensureInitialModelPose(modelSlot: number): Promise<void> {
  let model: FabricatorProjectSave
  try {
    model = JSON.parse(await readFile(join(slotPath(modelSlot), 'project.json'), 'utf8')) as FabricatorProjectSave
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return
    throw reason
  }
  if (!model.parts?.length || model.slot !== modelSlot || model.schemaVersion !== 1) return
  const firstFolder = poseSlotPath(modelSlot, 1)
  let first: FabricatorPoseSave | null = null
  try {
    first = JSON.parse(await readFile(join(firstFolder, 'pose.json'), 'utf8')) as FabricatorPoseSave
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
  }
  if (first?.isInitialModelPose && first.sourceModelUpdatedAt === model.updatedAt) return

  if (first && !first.isInitialModelPose) {
    let targetSlot: number | null = null
    for (let slot = 2; slot <= poseSlotCount; slot += 1) {
      try { await access(poseSlotPath(modelSlot, slot)) }
      catch (reason) {
        if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
        targetSlot = slot
        break
      }
    }
    if (!targetSlot) throw new Error('Não há slot livre para preservar a pose 01. Libere um slot antes de criar a pose da montagem.')
    const backupFolder = poseSlotPath(modelSlot, targetSlot)
    await cp(firstFolder, backupFolder, { recursive: true, force: false, errorOnExist: true })
    const moved = { ...first, slot: targetSlot }
    const backupTemp = join(backupFolder, 'pose.json.tmp')
    await writeFile(backupTemp, JSON.stringify(moved), 'utf8')
    await rename(backupTemp, join(backupFolder, 'pose.json'))
    // A user editing the old slot 01 must continue editing its moved copy.
    const draftFile = join(poseDraftPath(modelSlot), 'draft.json')
    try {
      const draft = JSON.parse(await readFile(draftFile, 'utf8')) as FabricatorPoseDraftSave
      if (draft.editingSlot === 1) {
        const temp = draftFile + '.tmp'
        await writeFile(temp, JSON.stringify({ ...draft, editingSlot: targetSlot }), 'utf8')
        await rename(temp, draftFile)
      }
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
    }
  }

  const parts = model.parts.map(({ chromaBaseSaved: _chromaBaseSaved, ...part }) => part)
  const basePose: FabricatorPoseSave = {
    schemaVersion: 1,
    slot: 1,
    isInitialModelPose: true,
    name: `Montagem original · ${model.name}`,
    sourceModelSlot: modelSlot,
    sourceModelName: model.name,
    sourceModelUpdatedAt: model.updatedAt,
    width: model.width,
    height: model.height,
    parts,
    joints: model.joints,
    layerOrder: model.layerOrder ?? parts.map((part) => part.id),
    hiddenPartIds: model.hiddenPartIds ?? [],
    updatedAt: new Date().toISOString()
  }
  const partsFolder = join(firstFolder, 'parts')
  await mkdir(partsFolder, { recursive: true })
  // The original model PNGs are authoritative, including after model updates.
  for (const part of parts) {
    await copyFile(join(slotPath(modelSlot), 'parts', `${part.id}.png`), join(partsFolder, `${part.id}.png`))
  }
  const temporary = join(firstFolder, 'pose.json.tmp')
  await writeFile(temporary, JSON.stringify(basePose), 'utf8')
  await rename(temporary, join(firstFolder, 'pose.json'))
}

async function writePoseDraft(modelSlot: number, draft: FabricatorPoseDraftSave, assets: FabricatorAssetSave[]): Promise<void> {
  if (!isValidModelSlot(modelSlot) || draft.project.sourceModelSlot !== modelSlot) throw new Error('Modelo do rascunho inválido.')
  if (draft.editingSlot !== null && !isValidPoseSlot(draft.editingSlot)) throw new Error('Rascunho de pose inválido.')
  if (draft.project.schemaVersion !== 1 || draft.project.parts.length === 0 || draft.project.parts.length > 500) throw new Error('Rascunho de pose inválido.')
  const folder = poseDraftPath(modelSlot)
  await writePoseAssets(folder, draft.project.parts, assets)
  const temporary = join(folder, 'draft.json.tmp')
  await writeFile(temporary, JSON.stringify(draft), 'utf8')
  await rename(temporary, join(folder, 'draft.json'))
}

async function readPoseDraft(modelSlot: number): Promise<FabricatorPoseDraft | null> {
  if (!isValidModelSlot(modelSlot)) throw new Error('Modelo do rascunho inválido.')
  try {
    const folder = poseDraftPath(modelSlot)
    const draft = JSON.parse(await readFile(join(folder, 'draft.json'), 'utf8')) as FabricatorPoseDraftSave
    if (draft.editingSlot !== null && !isValidPoseSlot(draft.editingSlot)) return null
    if (draft.project.sourceModelSlot !== modelSlot || draft.project.schemaVersion !== 1 || draft.project.parts.length === 0 || draft.project.parts.length > 500) return null
    return { ...draft, project: { ...draft.project, parts: await readPoseAssets(folder, draft.project.parts) } }
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw reason
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
          parts: Array<Omit<ModelPart, 'dataUrl' | 'chromaBaseDataUrl'>>
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
        parts: Array<Omit<ModelPart, 'dataUrl' | 'chromaBaseDataUrl'>>
      }
      if (!/^source-[a-f0-9-]+\.(png|jpe?g|webp)$/i.test(manifest.sourceFile) || manifest.parts.length > 500 || manifest.parts.some((part) => !/^[a-zA-Z0-9_-]{1,80}$/.test(part.id))) return null
      const sourceBytes = await readFile(join(folder, manifest.sourceFile))
      const extension = extname(manifest.sourceFile).toLowerCase()
      const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg'
      const sourceDataUrl = `data:${mime};base64,${sourceBytes.toString('base64')}`
      const parts = await Promise.all(manifest.parts.map(async (part) => ({
        ...part,
        dataUrl: `data:image/png;base64,${(await readFile(join(folder, 'parts', `${part.id}.png`))).toString('base64')}`,
        ...(part.chromaBaseSaved ? { chromaBaseDataUrl: `data:image/png;base64,${(await readFile(join(folder, 'parts', `${part.id}.base.png`))).toString('base64')}` } : {})
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

  ipcMain.handle('fabricator:poses:list', async (event, requestedModelSlot?: number): Promise<FabricatorPoseSummary[]> => {
    assertTrustedSender(event)
    await ensureLegacyPoseMigration()
    if (requestedModelSlot !== undefined && !isValidModelSlot(requestedModelSlot)) throw new Error('Modelo inválido.')
    const modelSlots = requestedModelSlot === undefined ? Array.from({ length: slotCount }, (_, index) => index + 1) : [requestedModelSlot]
    const allSlots: FabricatorPoseSummary[] = []
    for (const modelSlot of modelSlots) {
      await queuePoseWrite(() => ensureInitialModelPose(modelSlot))
      for (let slot = 1; slot <= poseSlotCount; slot += 1) {
        try {
          const manifest = JSON.parse(await readFile(join(poseSlotPath(modelSlot, slot), 'pose.json'), 'utf8')) as FabricatorPoseSave
          if (manifest.sourceModelSlot !== modelSlot || manifest.slot !== slot) continue
          allSlots.push({ slot, isInitialModelPose: manifest.isInitialModelPose, sourceModelSlot: modelSlot, name: manifest.name, sourceModelName: manifest.sourceModelName, partCount: manifest.parts.length, updatedAt: manifest.updatedAt })
        } catch { /* Slots sem manifest válido aparecem vazios. */ }
      }
    }
    return requestedModelSlot === undefined ? allSlots : Array.from({ length: poseSlotCount }, (_, index) => allSlots.find((item) => item?.slot === index + 1) ?? null)
  })

  ipcMain.handle('fabricator:poses:load', async (event, modelSlot: number, slot: number): Promise<FabricatorPose | null> => {
    assertTrustedSender(event)
    return readPoseProject(modelSlot, slot)
  })

  ipcMain.handle('fabricator:poses:save', async (event, modelSlot: number, slot: number, project: FabricatorPoseSave, assets: FabricatorAssetSave[]): Promise<void> => {
    assertTrustedSender(event)
    if (slot === 1) throw new Error('A pose 01 representa a montagem original. Crie ou edite uma pose em outro slot.')
    await queuePoseWrite(() => writePoseProject(modelSlot, slot, project, assets))
  })

  ipcMain.handle('fabricator:poses:delete', async (event, modelSlot: number, slot: number): Promise<void> => {
    assertTrustedSender(event)
    if (!isValidModelSlot(modelSlot) || !isValidPoseSlot(slot)) throw new Error('Slot de pose inválido.')
    if (slot === 1) throw new Error('A pose 01 da montagem original não pode ser excluída.')
    await queuePoseWrite(async () => {
      const base = resolve(poseModelPath(modelSlot))
      const target = resolve(poseSlotPath(modelSlot, slot))
      if (dirname(target) !== base || basename(target) !== `slot-${slot}`) throw new Error('Caminho de exclusão de pose inválido.')
      await rm(target, { recursive: true, force: true })
    })
  })

  ipcMain.handle('fabricator:poses:draft:load', async (event, modelSlot: number): Promise<FabricatorPoseDraft | null> => {
    assertTrustedSender(event)
    await ensureLegacyPoseMigration()
    return readPoseDraft(modelSlot)
  })

  ipcMain.handle('fabricator:poses:draft:save', async (event, modelSlot: number, draft: FabricatorPoseDraftSave, assets: FabricatorAssetSave[]): Promise<void> => {
    assertTrustedSender(event)
    await queuePoseWrite(() => writePoseDraft(modelSlot, draft, assets))
  })

  ipcMain.handle('fabricator:poses:draft:delete', async (event, modelSlot: number): Promise<void> => {
    assertTrustedSender(event)
    if (!isValidModelSlot(modelSlot)) throw new Error('Modelo de rascunho inválido.')
    await queuePoseWrite(async () => {
      const base = resolve(poseModelPath(modelSlot))
      const target = resolve(poseDraftPath(modelSlot))
      if (dirname(target) !== base || basename(target) !== 'draft') throw new Error('Caminho de rascunho inválido.')
      await rm(target, { recursive: true, force: true })
    })
  })

  ipcMain.handle('fabricator:wardrobe:list', async (event, modelSlot: number): Promise<WardrobeSetSummary[]> => {
    assertTrustedSender(event)
    if (!isValidModelSlot(modelSlot)) throw new Error('Modelo inválido.')
    const folder = wardrobeModelPath(modelSlot)
    try {
      const entries = await readdir(folder, { withFileTypes: true })
      const sets: WardrobeSetSummary[] = []
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^set-[a-zA-Z0-9_-]{1,80}$/.test(entry.name)) continue
        try {
          const set = JSON.parse(await readFile(join(folder, entry.name, 'wardrobe.json'), 'utf8')) as WardrobeSet
          if (set.schemaVersion === 1 && set.modelSlot === modelSlot && set.id === entry.name.slice(4) && Array.isArray(set.components)) sets.push({ id: set.id, modelSlot, modelName: set.modelName, name: set.name, updatedAt: set.updatedAt, componentCount: set.components.length })
        } catch { /* Manifestos inválidos não entram na biblioteca. */ }
      }
      return sets.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw reason
    }
  })

  ipcMain.handle('fabricator:wardrobe:load', async (event, modelSlot: number, id: string): Promise<WardrobeSet | null> => {
    assertTrustedSender(event)
    return readWardrobeSet(modelSlot, id)
  })

  ipcMain.handle('fabricator:wardrobe:save', async (event, modelSlot: number, set: WardrobeSetSave, assets: WardrobeAssetSave[]): Promise<void> => {
    assertTrustedSender(event)
    const next = wardrobeSaveQueue.catch(() => undefined).then(() => writeWardrobeSet(modelSlot, set, assets))
    wardrobeSaveQueue = next
    await next
  })

  ipcMain.handle('fabricator:wardrobe:delete', async (event, modelSlot: number, id: string): Promise<void> => {
    assertTrustedSender(event)
    if (!isValidModelSlot(modelSlot) || !isValidWardrobeId(id)) throw new Error('Conjunto de roupa inválido.')
    const base = resolve(wardrobeModelPath(modelSlot))
    const target = resolve(wardrobeSetPath(modelSlot, id))
    if (dirname(target) !== base || basename(target) !== `set-${id}`) throw new Error('Caminho de exclusão inválido.')
    const next = wardrobeSaveQueue.catch(() => undefined).then(() => rm(target, { recursive: true, force: true }))
    wardrobeSaveQueue = next
    await next
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
  const pendingWrites = [...fabricatorSaveQueues.values(), ...poseSaveWrites]
  if (pendingWrites.length === 0 || waitingForFabricatorWritesBeforeQuit) return
  event.preventDefault()
  waitingForFabricatorWritesBeforeQuit = true
  void Promise.allSettled(pendingWrites).then(() => {
    waitingForFabricatorWritesBeforeQuit = false
    app.quit()
  })
})
