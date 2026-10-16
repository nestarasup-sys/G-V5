import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { mkdir, readFile, writeFile, readdir, unlink, rename, stat, access, rm, copyFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import type { AnimatorAnimation, AnimatorAnimationAsset, AnimatorAnimationDraft, AnimatorAnimationSave, AnimatorAnimationSummary, FaceAssetSave, FaceCatalogItem, FaceCatalogItemSave, FaceCatalogItemSummary, FaceComponentAsset, FaceComponentAssetSave, FaceComponentAssetSummary, FaceComponentKind, FaceElementKind, FaceSet, FaceSetSave, FaceSetSummary, FaceSheetKind, FabricatorAssetSave, FabricatorHistoryEntry, FabricatorHistorySaveEntry, FabricatorHistorySaveState, FabricatorHistoryState, FabricatorPose, FabricatorPoseDraft, FabricatorPoseDraftSave, FabricatorPoseSave, FabricatorPoseSummary, FabricatorProject, FabricatorProjectSave, FabricatorSlotSummary, HairStyle, HairStyleAsset, HairStyleSave, HairStyleSummary, HairWorkspace, HairWorkspaceAsset, HairWorkspaceSave, ModelPart, PosePart, WardrobeAssetSave, WardrobeCategory, WardrobeSet, WardrobeSetSave, WardrobeSetSummary } from '../src/shared/fabricator'
import { resolvePoseCategory } from '../src/shared/fabricator'
import type { CustomizerCharacter } from '../src/shared/customizer'
import { characterBodyDimensionLimits, characterProportionLimits } from '../src/shared/customizer'
import type { StudioAsset, StudioDocument, StudioFaceTransform, StudioFaceTransforms } from '../src/shared/studio'
import { applyModelHeadShape } from '../src/shared/headShape'

const slotCount = 10
const poseSlotCount = 12
const libraryPath = () => join(app.getPath('userData'), 'fabricator', 'models')
const slotPath = (slot: number) => join(libraryPath(), `slot-${slot}`)
const poseLibraryPath = () => join(app.getPath('userData'), 'fabricator', 'poses')
const poseModelPath = (modelSlot: number) => join(poseLibraryPath(), `model-${modelSlot}`)
const poseSlotPath = (modelSlot: number, slot: number) => join(poseModelPath(modelSlot), `slot-${slot}`)
const poseDraftPath = (modelSlot: number) => join(poseModelPath(modelSlot), 'draft')
const animatorLibraryPath = () => join(app.getPath('userData'), 'fabricator', 'animations')
const animatorModelPath = (modelSlot: number) => join(animatorLibraryPath(), `model-${modelSlot}`)
const animatorSlotPath = (modelSlot: number, slot: number) => join(animatorModelPath(modelSlot), `slot-${slot}`)
const animatorDraftPath = (modelSlot: number) => join(animatorModelPath(modelSlot), 'draft')
const wardrobeLibraryPath = () => join(app.getPath('userData'), 'fabricator', 'wardrobe')
const wardrobeModelPath = (modelSlot: number) => join(wardrobeLibraryPath(), `model-${modelSlot}`)
const wardrobeSetPath = (modelSlot: number, id: string) => join(wardrobeModelPath(modelSlot), `set-${id}`)
const faceModelPath = (modelSlot: number) => join(app.getPath('userData'), 'fabricator', 'faces', `model-${modelSlot}`)
const faceSetPath = (modelSlot: number, id: string) => join(faceModelPath(modelSlot), `set-${id}`)
const faceCatalogPath = (modelSlot: number) => join(faceModelPath(modelSlot), 'catalog')
const faceCatalogItemPath = (modelSlot: number, id: string) => join(faceCatalogPath(modelSlot), `item-${id}`)
const faceComponentPath = (modelSlot: number) => join(app.getPath('userData'), 'fabricator', 'face-components', `model-${modelSlot}`)
const faceComponentItemPath = (modelSlot: number, id: string) => join(faceComponentPath(modelSlot), `item-${id}`)
const hairModelPath = (modelSlot: number) => join(app.getPath('userData'), 'fabricator', 'hair', `model-${modelSlot}`)
const hairStylePath = (modelSlot: number, id: string) => join(hairModelPath(modelSlot), 'styles', `style-${id}`)
const characterLibraryPath = () => join(app.getPath('userData'), 'customizer', 'characters')
const studioLibraryPath = () => join(app.getPath('userData'), 'studios', 'Studio Principal')
const studioPath = (id: string) => join(studioLibraryPath(), `studio-${id}`)
let studioSaveQueue: Promise<void> = Promise.resolve()
const characterManifestPath = () => join(characterLibraryPath(), 'characters.json')
const fabricatorSaveQueues = new Map<number, Promise<void>>()
let poseSaveQueue: Promise<void> = Promise.resolve()
const poseSaveWrites = new Set<Promise<void>>()
let poseMigration: Promise<void> | null = null
let animatorSaveQueue: Promise<void> = Promise.resolve()
let wardrobeSaveQueue: Promise<void> = Promise.resolve()
let faceSaveQueue: Promise<void> = Promise.resolve()
const hairSaveQueues = new Map<number, Promise<void>>()
let characterSaveQueue: Promise<void> = Promise.resolve()

const starterCharacters: Array<Pick<CustomizerCharacter, 'name' | 'hair' | 'outfit' | 'skin'>> = [
  { name: 'Chloe', hair: '#cfaa78', outfit: '#f2d771', skin: '#f5d7c7' },
  { name: 'Miri', hair: '#7c7aa4', outfit: '#a8b7e8', skin: '#f2d6c5' },
  { name: 'Drystan', hair: '#c18b50', outfit: '#7194ad', skin: '#f1d4c3' },
  { name: 'Drogo', hair: '#c8cbd5', outfit: '#adb6c9', skin: '#f2d9cc' },
  { name: 'Loki', hair: '#282933', outfit: '#b898dd', skin: '#e8c5b5' },
  { name: 'Henry', hair: '#4b3335', outfit: '#d89593', skin: '#c58e78' },
  { name: 'Lauren', hair: '#d1c3a1', outfit: '#a8c5ba', skin: '#f0d3c0' },
  { name: 'Luka', hair: '#263f57', outfit: '#88adcc', skin: '#eccdbb' },
  { name: 'Marinette', hair: '#24527e', outfit: '#bc8bce', skin: '#f2d9c9' },
  { name: 'Ayla', hair: '#47354b', outfit: '#df9ab6', skin: '#d69d85' }
]

const hairColorRoles = ['base', 'fade', 'outline', 'highlight', 'accent'] as const
const hairPartIds = ['backHair', 'rearHair', 'ponytail', 'frontHair', 'ahoge'] as const
function isHairColorMap(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([role, color]) => hairColorRoles.includes(role as typeof hairColorRoles[number]) && typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color))
}

function isCustomizerCharacter(value: unknown): value is CustomizerCharacter {
  if (!value || typeof value !== 'object') return false
  const character = value as Partial<CustomizerCharacter>
  return typeof character.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(character.id)
    && typeof character.name === 'string' && character.name.trim().length > 0 && character.name.length <= 80
    && typeof character.hair === 'string' && /^#[0-9a-fA-F]{6}$/.test(character.hair)
    && typeof character.outfit === 'string' && /^#[0-9a-fA-F]{6}$/.test(character.outfit)
    && typeof character.skin === 'string' && /^#[0-9a-fA-F]{6}$/.test(character.skin)
    && !!character.customization && typeof character.customization === 'object'
    && (character.customization.modelSlot === null || isValidModelSlot(character.customization.modelSlot))
    && (character.customization.poseSlot === null || (Number.isInteger(character.customization.poseSlot) && character.customization.poseSlot >= 1 && character.customization.poseSlot <= poseSlotCount))
    && (character.customization.proportions === undefined || (
      !!character.customization.proportions && typeof character.customization.proportions === 'object'
      && (Object.keys(characterProportionLimits) as Array<keyof typeof characterProportionLimits>).every((key) => {
        const value = character.customization!.proportions?.[key]
        const { min, max } = characterProportionLimits[key]
        return (value === undefined && (key === 'headWidth' || key === 'headHeight'))
          || (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max)
      })
    ))
    && (character.customization.bodyDimensions === undefined || (
      !!character.customization.bodyDimensions && typeof character.customization.bodyDimensions === 'object'
      && (Object.keys(characterBodyDimensionLimits) as Array<keyof typeof characterBodyDimensionLimits>).every((key) => {
        const value = character.customization!.bodyDimensions?.[key]
        const { min, max } = characterBodyDimensionLimits[key]
        return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max)
      })
    ))
    && !!character.customization.partOverrides && typeof character.customization.partOverrides === 'object'
    && Object.keys(character.customization.partOverrides).length <= 1000
    && Array.isArray(character.customization.layerOrder)
    && character.customization.layerOrder.length <= 1000
    && character.customization.layerOrder.every((id) => typeof id === 'string' && id.length <= 120)
    && (character.customization.wardrobeGroups === undefined || (
      Array.isArray(character.customization.wardrobeGroups) && character.customization.wardrobeGroups.length <= 100
      && character.customization.wardrobeGroups.every((group) => group && isValidModelSlot(group.modelSlot)
        && isValidWardrobeId(group.setId)
        && ['camisa', 'manga-superior', 'manga-inferior', 'calca', 'shorts'].includes(group.category)
        && [group.offsetX, group.offsetY, group.scaleX, group.scaleY, group.rotation].every(Number.isFinite)
        && group.scaleX > 0 && group.scaleY > 0)
    ))
    && (character.customization.faceAppearance === undefined || (
      !!character.customization.faceAppearance
      && isValidModelSlot(character.customization.faceAppearance.modelSlot)
      && (character.customization.faceAppearance.setId === undefined || isValidWardrobeId(character.customization.faceAppearance.setId))
      && [character.customization.faceAppearance.eyeCatalogId, character.customization.faceAppearance.eyebrowCatalogId, character.customization.faceAppearance.noseCatalogId, character.customization.faceAppearance.mouthClosedCatalogId, character.customization.faceAppearance.mouthOpenCatalogId].every((id) => id === undefined || isValidFaceCatalogId(id))
      && Boolean(character.customization.faceAppearance.setId || character.customization.faceAppearance.eyeCatalogId || character.customization.faceAppearance.eyebrowCatalogId || character.customization.faceAppearance.noseCatalogId || character.customization.faceAppearance.mouthClosedCatalogId || character.customization.faceAppearance.mouthOpenCatalogId)
      && [0, 1, 2].includes(character.customization.faceAppearance.eyeState)
      && typeof character.customization.faceAppearance.eyebrows === 'boolean'
      && Number.isInteger(character.customization.faceAppearance.noseIndex) && character.customization.faceAppearance.noseIndex >= 0 && character.customization.faceAppearance.noseIndex <= 5
      && Number.isInteger(character.customization.faceAppearance.expressionIndex) && character.customization.faceAppearance.expressionIndex >= 0 && character.customization.faceAppearance.expressionIndex <= 20
      && typeof character.customization.faceAppearance.mouthOpen === 'boolean'
    ))
    && (character.customization.hairAppearance === undefined || (
      !!character.customization.hairAppearance
      && isValidModelSlot(character.customization.hairAppearance.modelSlot)
      && (character.customization.hairAppearance.styleId === undefined || isValidWardrobeId(character.customization.hairAppearance.styleId))
      && (character.customization.hairAppearance.frontStyleId === undefined || character.customization.hairAppearance.frontStyleId === null || isValidWardrobeId(character.customization.hairAppearance.frontStyleId))
      && (character.customization.hairAppearance.backStyleId === undefined || character.customization.hairAppearance.backStyleId === null || isValidWardrobeId(character.customization.hairAppearance.backStyleId))
      && (character.customization.hairAppearance.colors === undefined || isHairColorMap(character.customization.hairAppearance.colors))
      && (character.customization.hairAppearance.parts === undefined || (
        !!character.customization.hairAppearance.parts && typeof character.customization.hairAppearance.parts === 'object'
        && Object.entries(character.customization.hairAppearance.parts).every(([part, id]) => hairPartIds.includes(part as typeof hairPartIds[number]) && (id === null || typeof id === 'string' && isValidWardrobeId(id)))
      ))
      && (character.customization.hairAppearance.partColors === undefined || (
        !!character.customization.hairAppearance.partColors && typeof character.customization.hairAppearance.partColors === 'object'
        && Object.entries(character.customization.hairAppearance.partColors).every(([part, colors]) => hairPartIds.includes(part as typeof hairPartIds[number]) && isHairColorMap(colors))
      ))
    ))
    && typeof character.createdAt === 'string' && typeof character.updatedAt === 'string'
}

async function readCustomizerCharacters(): Promise<CustomizerCharacter[]> {
  try {
    const parsed = JSON.parse(await readFile(characterManifestPath(), 'utf8')) as unknown
    if (!Array.isArray(parsed) || !parsed.every(isCustomizerCharacter)) throw new Error('A biblioteca de personagens está inválida.')
    return parsed
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
    const now = new Date().toISOString()
    const seeded = starterCharacters.map((character) => ({
      ...character,
      id: randomUUID(),
      customization: { modelSlot: 1, poseSlot: 1, partOverrides: {}, layerOrder: [] },
      createdAt: now,
      updatedAt: now
    }))
    await writeCustomizerCharacters(seeded)
    return seeded
  }
}

async function writeCustomizerCharacters(characters: CustomizerCharacter[]): Promise<void> {
  if (!Array.isArray(characters) || characters.length > 500 || !characters.every(isCustomizerCharacter)) throw new Error('Dados de personagem inválidos.')
  if (new Set(characters.map((character) => character.id)).size !== characters.length) throw new Error('Há personagens com identificadores repetidos.')
  await mkdir(characterLibraryPath(), { recursive: true })
  const temporary = `${characterManifestPath()}.tmp`
  await writeFile(temporary, JSON.stringify(characters), 'utf8')
  await rename(temporary, characterManifestPath())
}

const wardrobeCategories: WardrobeCategory[] = ['camisa', 'manga-superior', 'manga-inferior', 'calca-coxa', 'calca-canela', 'shorts']
const isValidWardrobeId = (id: string) => /^[a-zA-Z0-9_-]{1,80}$/.test(id)
const isValidFaceCatalogId = (id: string) => /^[a-zA-Z0-9_-]{1,120}$/.test(id)
const faceSheetKinds: FaceSheetKind[] = ['eyes', 'eyebrows', 'nose', 'mouth-closed', 'mouth-open']
const faceElementKinds: FaceElementKind[] = ['eye-left', 'eye-right', 'brow-left', 'brow-right', 'nose', 'mouth']

function validFaceSet(modelSlot: number, set: FaceSetSave): boolean {
  if (!isValidModelSlot(modelSlot) || set?.schemaVersion !== 1 || set.modelSlot !== modelSlot || !isValidWardrobeId(set.id)
    || typeof set.name !== 'string' || !set.name.trim() || set.name.length > 80
    || !Array.isArray(set.pieces) || set.pieces.length > 60 || !set.sheets || typeof set.sheets !== 'object'
    || !set.transforms || typeof set.transforms !== 'object') return false
  const ids = new Set<string>()
  for (const piece of set.pieces) {
    if (!isValidWardrobeId(piece.id) || ids.has(piece.id) || !faceSheetKinds.includes(piece.sheet)
      || !Number.isInteger(piece.index) || piece.index < 0 || piece.index > 20
      || (piece.side !== undefined && piece.side !== 'left' && piece.side !== 'right')
      || !piece.crop || ![piece.crop.x, piece.crop.y, piece.crop.width, piece.crop.height, piece.width, piece.height].every(Number.isFinite)
      || piece.crop.width <= 0 || piece.crop.height <= 0 || piece.width <= 0 || piece.height <= 0) return false
    ids.add(piece.id)
  }
  for (const [kind, sheet] of Object.entries(set.sheets)) {
    if (!faceSheetKinds.includes(kind as FaceSheetKind) || !sheet || !Number.isFinite(sheet.width)
      || !Number.isFinite(sheet.height) || sheet.width <= 0 || sheet.height <= 0 || sheet.width * sheet.height > 32_000_000
      || !Number.isFinite(sheet.tolerance) || sheet.tolerance < 0 || sheet.tolerance > 280) return false
  }
  for (const kind of faceElementKinds) {
    const transform = set.transforms[kind]
    if (!transform || ![transform.x, transform.y, transform.scaleX, transform.scaleY, transform.rotation].every(Number.isFinite)
      || transform.scaleX <= 0 || transform.scaleY <= 0) return false
  }
  return Number.isInteger(set.selectedNose) && set.selectedNose >= 0 && set.selectedNose <= 5
    && Number.isInteger(set.selectedExpression) && set.selectedExpression >= 0 && set.selectedExpression <= 20
    && typeof set.eyeLinked === 'boolean' && typeof set.browLinked === 'boolean'
}

async function writeFaceSet(modelSlot: number, set: FaceSetSave, assets: FaceAssetSave[]): Promise<void> {
  if (!validFaceSet(modelSlot, set)) throw new Error('Rosto inválido.')
  const folder = faceSetPath(modelSlot, set.id)
  const partsFolder = join(folder, 'images')
  await mkdir(partsFolder, { recursive: true })
  const expected = new Set([...set.pieces.map((piece) => piece.id), ...Object.keys(set.sheets).map((kind) => `sheet-${kind}`)])
  if (assets.some((asset) => !expected.has(asset.id)) || new Set(assets.map((asset) => asset.id)).size !== assets.length) throw new Error('Imagens do rosto inválidas.')
  for (const asset of assets) await writeFile(join(partsFolder, `${asset.id}.png`), dataUrlBuffer(asset.dataUrl))
  for (const id of expected) await access(join(partsFolder, `${id}.png`))
  const temporary = join(folder, 'face.json.tmp')
  await writeFile(temporary, JSON.stringify(set), 'utf8')
  await rename(temporary, join(folder, 'face.json'))
  for (const filename of await readdir(partsFolder)) if (filename.endsWith('.png') && !expected.has(filename.slice(0, -4))) await unlink(join(partsFolder, filename))
}

async function readFaceSet(modelSlot: number, id: string): Promise<FaceSet | null> {
  if (!isValidModelSlot(modelSlot) || !isValidWardrobeId(id)) throw new Error('Rosto inválido.')
  try {
    const folder = faceSetPath(modelSlot, id)
    const set = JSON.parse(await readFile(join(folder, 'face.json'), 'utf8')) as FaceSetSave
    if (!validFaceSet(modelSlot, set) || set.id !== id) return null
    const sheets = { ...set.sheets } as FaceSet['sheets']
    for (const kind of faceSheetKinds) if (sheets[kind]) sheets[kind] = { ...sheets[kind], dataUrl: `data:image/png;base64,${(await readFile(join(folder, 'images', `sheet-${kind}.png`))).toString('base64')}` }
    const pieces = await Promise.all(set.pieces.map(async (piece) => ({ ...piece, dataUrl: `data:image/png;base64,${(await readFile(join(folder, 'images', `${piece.id}.png`))).toString('base64')}` })))
    return { ...set, sheets, pieces }
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw reason
  }
}

function validFaceCatalogItem(modelSlot: number, item: FaceCatalogItemSave): boolean {
  const requiredElements: Record<FaceSheetKind, FaceElementKind[]> = {
    eyes: ['eye-left', 'eye-right'], eyebrows: ['brow-left', 'brow-right'], nose: ['nose'],
    'mouth-closed': ['mouth'], 'mouth-open': ['mouth']
  }
  if (!isValidModelSlot(modelSlot) || item?.schemaVersion !== 1 || item.modelSlot !== modelSlot || !isValidFaceCatalogId(item.id)
    || !faceSheetKinds.includes(item.category) || item.sheet?.kind !== item.category
    || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120
    || !Array.isArray(item.pieces) || item.pieces.length > 60 || !item.transforms || typeof item.transforms !== 'object'
    || !Number.isFinite(item.sheet.width) || !Number.isFinite(item.sheet.height) || item.sheet.width <= 0 || item.sheet.height <= 0
    || item.sheet.width * item.sheet.height > 32_000_000 || !Number.isFinite(item.sheet.tolerance) || item.sheet.tolerance < 0 || item.sheet.tolerance > 280) return false
  const ids = new Set<string>()
  for (const piece of item.pieces) {
    if (!isValidWardrobeId(piece.id) || ids.has(piece.id) || piece.sheet !== item.category
      || !Number.isInteger(piece.index) || piece.index < 0 || piece.index > 20
      || (piece.side !== undefined && piece.side !== 'left' && piece.side !== 'right')
      || !piece.crop || ![piece.crop.x, piece.crop.y, piece.crop.width, piece.crop.height, piece.width, piece.height].every(Number.isFinite)
      || piece.crop.width <= 0 || piece.crop.height <= 0 || piece.width <= 0 || piece.height <= 0) return false
    ids.add(piece.id)
  }
  for (const element of requiredElements[item.category]) {
    const transform = item.transforms[element]
    if (!transform || ![transform.x, transform.y, transform.scaleX, transform.scaleY, transform.rotation].every(Number.isFinite)
      || transform.scaleX <= 0 || transform.scaleY <= 0) return false
  }
  return typeof item.eyeLinked === 'boolean' && typeof item.browLinked === 'boolean'
    && Number.isInteger(item.selectedNose) && item.selectedNose >= 0 && item.selectedNose <= 5
    && Number.isInteger(item.selectedExpression) && item.selectedExpression >= 0 && item.selectedExpression <= 20
    && typeof item.updatedAt === 'string'
}

async function writeFaceCatalogItem(modelSlot: number, item: FaceCatalogItemSave, assets: FaceAssetSave[]): Promise<void> {
  if (!validFaceCatalogItem(modelSlot, item)) throw new Error('Peça facial inválida.')
  const folder = faceCatalogItemPath(modelSlot, item.id)
  const images = join(folder, 'images')
  const expected = new Set([`sheet-${item.category}`, ...item.pieces.map((piece) => piece.id)])
  if (assets.some((asset) => !expected.has(asset.id)) || new Set(assets.map((asset) => asset.id)).size !== assets.length) throw new Error('Imagens da peça facial inválidas.')
  await mkdir(images, { recursive: true })
  for (const asset of assets) await writeFile(join(images, `${asset.id}.png`), dataUrlBuffer(asset.dataUrl))
  for (const id of expected) await access(join(images, `${id}.png`))
  await writeFile(join(folder, 'item.json.tmp'), JSON.stringify(item), 'utf8')
  await rename(join(folder, 'item.json.tmp'), join(folder, 'item.json'))
  for (const filename of await readdir(images)) if (filename.endsWith('.png') && !expected.has(filename.slice(0, -4))) await unlink(join(images, filename))
}

function legacyFaceCatalogId(id: string): { setId: string; category: FaceSheetKind } | null {
  if (!id.startsWith('legacy_')) return null
  for (const category of faceSheetKinds) {
    const suffix = `_${category}`
    if (id.endsWith(suffix)) {
      const setId = id.slice('legacy_'.length, -suffix.length)
      if (isValidWardrobeId(setId)) return { setId, category }
    }
  }
  return null
}

async function readFaceCatalogItem(modelSlot: number, id: string): Promise<FaceCatalogItem | null> {
  if (!isValidModelSlot(modelSlot) || !isValidFaceCatalogId(id)) throw new Error('Peça facial inválida.')
  try {
    const folder = faceCatalogItemPath(modelSlot, id)
    const item = JSON.parse(await readFile(join(folder, 'item.json'), 'utf8')) as FaceCatalogItemSave
    if (!validFaceCatalogItem(modelSlot, item) || item.id !== id) return null
    const sheet = { ...item.sheet, dataUrl: `data:image/png;base64,${(await readFile(join(folder, 'images', `sheet-${item.category}.png`))).toString('base64')}` }
    const pieces = await Promise.all(item.pieces.map(async (piece) => ({ ...piece, dataUrl: `data:image/png;base64,${(await readFile(join(folder, 'images', `${piece.id}.png`))).toString('base64')}` })))
    return { ...item, sheet, pieces }
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
    const legacy = legacyFaceCatalogId(id)
    if (!legacy) return null
    const set = await readFaceSet(modelSlot, legacy.setId)
    const sheet = set?.sheets[legacy.category]
    if (!set || !sheet) return null
    const elements: FaceElementKind[] = legacy.category === 'eyes' ? ['eye-left', 'eye-right'] : legacy.category === 'eyebrows' ? ['brow-left', 'brow-right'] : legacy.category === 'nose' ? ['nose'] : ['mouth']
    return {
      schemaVersion: 1, id, modelSlot, category: legacy.category, name: sheet.name.replace(/\.[^.]+$/, ''), sheet,
      pieces: set.pieces.filter((piece) => piece.sheet === legacy.category),
      transforms: Object.fromEntries(elements.map((element) => [element, set.transforms[element]])),
      eyeLinked: set.eyeLinked, browLinked: set.browLinked, selectedNose: set.selectedNose,
      selectedExpression: set.selectedExpression, updatedAt: set.updatedAt
    }
  }
}

async function listFaceCatalogItems(modelSlot: number): Promise<FaceCatalogItemSummary[]> {
  if (!isValidModelSlot(modelSlot)) throw new Error('Modelo inválido.')
  const items = new Map<string, FaceCatalogItemSummary>()
  try {
    for (const entry of await readdir(faceCatalogPath(modelSlot), { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^item-[a-zA-Z0-9_-]{1,120}$/.test(entry.name)) continue
      try {
        const item = JSON.parse(await readFile(join(faceCatalogPath(modelSlot), entry.name, 'item.json'), 'utf8')) as FaceCatalogItemSave
        if (validFaceCatalogItem(modelSlot, item) && item.id === entry.name.slice(5)) items.set(item.id, { id: item.id, modelSlot, category: item.category, name: item.name, updatedAt: item.updatedAt, pieceCount: item.pieces.length })
      } catch { /* Incomplete catalog items are hidden. */ }
    }
  } catch (reason) { if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason }
  // Surface old complete face saves as category items until the user edits or saves them individually.
  try {
    for (const entry of await readdir(faceModelPath(modelSlot), { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^set-[a-zA-Z0-9_-]{1,80}$/.test(entry.name)) continue
      const setId = entry.name.slice(4)
      try {
        const set = JSON.parse(await readFile(join(faceModelPath(modelSlot), entry.name, 'face.json'), 'utf8')) as FaceSetSave
        if (!validFaceSet(modelSlot, set) || set.id !== setId) continue
        for (const category of faceSheetKinds) {
          const sheet = set.sheets[category]
          if (!sheet) continue
          const id = `legacy_${setId}_${category}`
          if (items.has(id)) continue
          items.set(id, { id, modelSlot, category, name: sheet.name.replace(/\.[^.]+$/, ''), updatedAt: set.updatedAt, pieceCount: set.pieces.filter((piece) => piece.sheet === category).length })
        }
      } catch { /* Invalid legacy sets do not enter the new catalog. */ }
    }
  } catch (reason) { if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason }
  return [...items.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

function validFaceComponentAsset(modelSlot: number, asset: FaceComponentAssetSave): boolean {
  const transform = asset?.defaultTransform
  return isValidModelSlot(modelSlot) && asset?.schemaVersion === 1 && asset.modelSlot === modelSlot
    && isValidWardrobeId(asset.id) && ['eye', 'pupil', 'eye-closed', 'eyebrow'].includes(asset.kind)
    && typeof asset.name === 'string' && asset.name.trim().length > 0 && asset.name.length <= 120
    && Number.isFinite(asset.width) && Number.isFinite(asset.height) && asset.width > 0 && asset.height > 0 && asset.width * asset.height <= 32_000_000
    && (asset.rightSidePositioned === undefined || typeof asset.rightSidePositioned === 'boolean')
    && Boolean(transform) && [transform.x, transform.y, transform.scaleX, transform.scaleY, transform.rotation].every(Number.isFinite)
    && (transform.flipX === undefined || typeof transform.flipX === 'boolean')
    && transform.scaleX > 0 && transform.scaleY > 0 && transform.scaleX <= 20 && transform.scaleY <= 20
    && typeof asset.updatedAt === 'string'
}

async function listFaceComponentAssets(modelSlot: number, kind?: FaceComponentKind): Promise<FaceComponentAssetSummary[]> {
  if (!isValidModelSlot(modelSlot)) throw new Error('Modelo inválido.')
  const directory = faceComponentPath(modelSlot)
  const output: FaceComponentAssetSummary[] = []
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^item-[a-zA-Z0-9_-]{1,120}$/.test(entry.name)) continue
      try {
        const asset = JSON.parse(await readFile(join(directory, entry.name, 'asset.json'), 'utf8')) as FaceComponentAssetSave
        if (!validFaceComponentAsset(modelSlot, asset) || asset.id !== entry.name.slice(5) || kind && asset.kind !== kind) continue
        const { defaultTransform: _transform, ...summary } = asset
        output.push(summary)
      } catch { /* Hide incomplete component assets. */ }
    }
  } catch (reason) { if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason }
  return output.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

async function readFaceComponentAsset(modelSlot: number, id: string): Promise<FaceComponentAsset | null> {
  if (!isValidModelSlot(modelSlot) || !isValidWardrobeId(id)) throw new Error('Asset facial inválido.')
  try {
    const folder = faceComponentItemPath(modelSlot, id)
    const asset = JSON.parse(await readFile(join(folder, 'asset.json'), 'utf8')) as FaceComponentAssetSave
    if (!validFaceComponentAsset(modelSlot, asset) || asset.id !== id) return null
    const dataUrl = `data:image/png;base64,${(await readFile(join(folder, 'asset.png'))).toString('base64')}`
    return { ...asset, dataUrl }
  } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return null; throw reason }
}

async function writeFaceComponentAsset(modelSlot: number, asset: FaceComponentAssetSave, dataUrl: string): Promise<void> {
  if (!validFaceComponentAsset(modelSlot, asset) || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) throw new Error('Asset facial inválido; use uma imagem PNG.')
  const folder = faceComponentItemPath(modelSlot, asset.id)
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'asset.png'), dataUrlBuffer(dataUrl))
  await writeFile(join(folder, 'asset.json.tmp'), JSON.stringify(asset), 'utf8')
  await rename(join(folder, 'asset.json.tmp'), join(folder, 'asset.json'))
}

function validHairWorkspace(modelSlot: number, workspace: HairWorkspaceSave): boolean {
  if (!isValidModelSlot(modelSlot) || workspace?.schemaVersion !== 1 || workspace.modelSlot !== modelSlot || !workspace.transforms) return false
  for (const side of ['front', 'back', 'fringe'] as const) {
    const asset = workspace[side]
    const transform = workspace.transforms[side]
    if (side === 'fringe' && !asset && !transform) continue
    if (asset && (!Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width <= 0 || asset.height <= 0 || asset.width * asset.height > 32_000_000)) return false
    if (!transform || ![transform.x, transform.y, transform.scaleX, transform.scaleY, transform.rotation].every(Number.isFinite)
      || Math.abs(transform.x) > 100_000 || Math.abs(transform.y) > 100_000 || transform.scaleX <= 0 || transform.scaleY <= 0 || transform.scaleX > 20 || transform.scaleY > 20
      || (transform.flipX !== undefined && typeof transform.flipX !== 'boolean')) return false
  }
  if (workspace.chromaTolerance !== undefined && (!Number.isFinite(workspace.chromaTolerance) || workspace.chromaTolerance < 0 || workspace.chromaTolerance > 100)) return false
  if (workspace.chromaMode !== undefined && !['auto', 'green', 'checker'].includes(workspace.chromaMode)) return false
  if (workspace.sourceImageSaved !== undefined && typeof workspace.sourceImageSaved !== 'boolean') return false
  return typeof workspace.updatedAt === 'string'
}

async function writeHairWorkspace(modelSlot: number, workspace: HairWorkspaceSave, assets: HairWorkspaceAsset[]): Promise<void> {
  if (!validHairWorkspace(modelSlot, workspace)) throw new Error('Configuração de cabelo inválida.')
  const folder = hairModelPath(modelSlot)
  const images = join(folder, 'images')
  await mkdir(images, { recursive: true })
  const expected = new Set<string>((['front', 'back', 'fringe'] as const).filter((side) => workspace[side] != null))
  if (workspace.sourceImageSaved) expected.add('source')
  if (assets.some((asset) => !expected.has(asset.id)) || new Set(assets.map((asset) => asset.id)).size !== assets.length) throw new Error('Imagens de cabelo inválidas.')
  for (const asset of assets) await writeFile(join(images, `${asset.id}.png`), dataUrlBuffer(asset.dataUrl))
  for (const side of expected) {
    try { await access(join(images, `${side}.png`)) } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
      throw new Error(`Imagem de cabelo ausente: ${side}.`)
    }
  }
  for (const side of ['front', 'back', 'fringe', 'source'] as const) if (!expected.has(side)) await unlink(join(images, `${side}.png`)).catch((reason: NodeJS.ErrnoException) => { if (reason.code !== 'ENOENT') throw reason })
  const temporary = join(folder, 'hair.json.tmp')
  await writeFile(temporary, JSON.stringify(workspace), 'utf8')
  await rename(temporary, join(folder, 'hair.json'))
}

async function readHairWorkspace(modelSlot: number): Promise<HairWorkspace | null> {
  if (!isValidModelSlot(modelSlot)) throw new Error('Modelo inválido.')
  try {
    const folder = hairModelPath(modelSlot)
    const saved = JSON.parse(await readFile(join(folder, 'hair.json'), 'utf8')) as HairWorkspaceSave
    if (!validHairWorkspace(modelSlot, saved)) return null
    const loadPart = async (side: 'front' | 'back' | 'fringe') => saved[side]
      ? { ...saved[side]!, dataUrl: `data:image/png;base64,${(await readFile(join(folder, 'images', `${side}.png`))).toString('base64')}` }
      : null
    let sourceImageDataUrl: string | undefined
    if (saved.sourceImageSaved) {
      try { sourceImageDataUrl = `data:image/png;base64,${(await readFile(join(folder, 'images', 'source.png'))).toString('base64')}` }
      catch (reason) { if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason }
    }
    return { ...saved, front: await loadPart('front'), back: await loadPart('back'), fringe: await loadPart('fringe'), ...(sourceImageDataUrl ? { sourceImageDataUrl } : {}) }
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw reason
  }
}

function validHairStyle(modelSlot: number, style: HairStyleSave): boolean {
  if (!isValidModelSlot(modelSlot) || style?.schemaVersion !== 1 || style.modelSlot !== modelSlot || !isValidWardrobeId(style.id)
    || typeof style.name !== 'string' || !style.name.trim() || style.name.length > 80 || !style.transforms) return false
  if (!style.front && !style.back && !style.fringe) return false
  for (const side of ['front', 'back', 'fringe'] as const) {
    const asset = style[side]
    const transform = style.transforms[side]
    if (side === 'fringe' && !asset && !transform) continue
    if (asset && (!Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width <= 0 || asset.height <= 0 || asset.width * asset.height > 32_000_000)) return false
    if (!transform || ![transform.x, transform.y, transform.scaleX, transform.scaleY, transform.rotation].every(Number.isFinite)
      || Math.abs(transform.x) > 100_000 || Math.abs(transform.y) > 100_000 || transform.scaleX <= 0 || transform.scaleY <= 0 || transform.scaleX > 20 || transform.scaleY > 20
      || (transform.flipX !== undefined && typeof transform.flipX !== 'boolean')) return false
  }
  return typeof style.createdAt === 'string' && typeof style.updatedAt === 'string'
}

async function writeHairStyle(modelSlot: number, style: HairStyleSave, assets: HairStyleAsset[]): Promise<void> {
  if (!validHairStyle(modelSlot, style)) throw new Error('Estilo de cabelo inválido.')
  const folder = hairStylePath(modelSlot, style.id)
  const images = join(folder, 'images')
  await mkdir(images, { recursive: true })
  const expected = new Set((['front', 'back', 'fringe'] as const).filter((side) => style[side] != null))
  if (assets.some((asset) => !expected.has(asset.id)) || new Set(assets.map((asset) => asset.id)).size !== assets.length) throw new Error('Imagens do cabelo inválidas.')
  for (const asset of assets) await writeFile(join(images, `${asset.id}.png`), dataUrlBuffer(asset.dataUrl))
  for (const side of expected) {
    try { await access(join(images, `${side}.png`)) } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
      throw new Error(`Imagem de cabelo ausente: ${side}.`)
    }
  }
  for (const side of ['front', 'back', 'fringe'] as const) if (!expected.has(side)) await unlink(join(images, `${side}.png`)).catch((reason: NodeJS.ErrnoException) => { if (reason.code !== 'ENOENT') throw reason })
  const temporary = join(folder, 'hair-style.json.tmp')
  await writeFile(temporary, JSON.stringify(style), 'utf8')
  await rename(temporary, join(folder, 'hair-style.json'))
}

async function readHairStyle(modelSlot: number, id: string): Promise<HairStyle | null> {
  if (!isValidModelSlot(modelSlot) || !isValidWardrobeId(id)) throw new Error('Estilo de cabelo inválido.')
  try {
    const folder = hairStylePath(modelSlot, id)
    const saved = JSON.parse(await readFile(join(folder, 'hair-style.json'), 'utf8')) as HairStyleSave
    if (!validHairStyle(modelSlot, saved) || saved.id !== id) return null
    const loadPart = async (side: 'front' | 'back' | 'fringe') => saved[side]
      ? { ...saved[side]!, dataUrl: `data:image/png;base64,${(await readFile(join(folder, 'images', `${side}.png`))).toString('base64')}` }
      : null
    return { ...saved, front: await loadPart('front'), back: await loadPart('back'), fringe: await loadPart('fringe') }
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw reason
  }
}

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

function isStudioFaceTransforms(value: unknown): value is StudioFaceTransforms {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(value).every(([key, entry]) => {
    if (!/^(eyes|eyebrows|nose|mouth|mouth-closed|mouth-open)(:[^:]+)?$/i.test(key)) return false
    if (!entry || typeof entry !== 'object') return false
    const transform = entry as Partial<StudioFaceTransform>
    return [transform.x, transform.y, transform.width, transform.height, transform.rotation].every((number) => typeof number === 'number' && Number.isFinite(number))
  })
}

function isStudioDocument(value: unknown): value is StudioDocument {
  if (!value || typeof value !== 'object') return false
  const studio = value as Partial<StudioDocument>
  const assets = studio.assets
  const elements = studio.elements
  return studio.schemaVersion === 1
    && typeof studio.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(studio.id)
    && typeof studio.title === 'string' && studio.title.trim().length > 0 && studio.title.length <= 100
    && typeof studio.color === 'string' && /^(#[0-9a-f]{6}|hsl\([\d.]+\s+[\d.]+%\s+[\d.]+%\))$/i.test(studio.color)
    && typeof studio.createdAt === 'string' && Number.isFinite(Date.parse(studio.createdAt))
    && typeof studio.updatedAt === 'string' && Number.isFinite(Date.parse(studio.updatedAt))
    && typeof studio.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(studio.backgroundColor)
    && (studio.backgroundAssetId === null || typeof studio.backgroundAssetId === 'string')
    && [studio.backgroundX, studio.backgroundY, studio.backgroundWidth, studio.backgroundHeight, studio.backgroundRotation].every(Number.isFinite)
    && Array.isArray(assets) && assets.length <= 500
    && assets.every((asset) => isStudioAsset(asset))
    && Array.isArray(elements) && elements.length <= 1000
    && (studio.backgroundAssetId === null || assets.some((asset) => asset.id === studio.backgroundAssetId && asset.category === 'background'))
    && elements.every((element) => Boolean(element && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(element.id) && typeof element.text === 'string'
      && ['image', 'character', 'narrator', 'speech', 'thought'].includes(element.kind)
      && isStudioFaceTransforms(element.faceTransforms)
      && (element.characterSourceUpdatedAt === undefined || (typeof element.characterSourceUpdatedAt === 'string' && Number.isFinite(Date.parse(element.characterSourceUpdatedAt))))
      && (element.kind !== 'image' || assets.some((asset) => asset.id === element.assetId && asset.category === 'object'))
      && (element.kind !== 'character' || (typeof element.characterId === 'string' && assets.some((asset) => asset.id === element.assetId && asset.category === 'character')))
      && [element.x, element.y, element.width, element.height, element.rotation, element.zIndex].every(Number.isFinite)))
}

function isStudioAsset(value: unknown): value is StudioAsset {
  if (!value || typeof value !== 'object') return false
  const asset = value as Partial<StudioAsset>
  return typeof asset.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(asset.id)
    && (asset.category === 'background' || asset.category === 'object' || asset.category === 'character')
    && typeof asset.name === 'string' && asset.name.length <= 255
    && (asset.mimeType === 'image/png' || asset.mimeType === 'image/jpeg' || asset.mimeType === 'image/webp')
    && typeof asset.dataUrl === 'string' && asset.dataUrl.startsWith(`data:${asset.mimeType};base64,`) && asset.dataUrl.length <= 70_000_000
}

function normalizeStudio(value: Record<string, unknown>, id: string): StudioDocument {
  return {
    schemaVersion: 1,
    id,
    title: String(value.title ?? 'Studio').slice(0, 100),
    color: String(value.color ?? '#d7b5cd'),
    createdAt: String(value.createdAt ?? new Date().toISOString()),
    updatedAt: String(value.updatedAt ?? new Date().toISOString()),
    backgroundColor: typeof value.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(value.backgroundColor) ? value.backgroundColor : '#d7b5cd',
    backgroundAssetId: typeof value.backgroundAssetId === 'string' ? value.backgroundAssetId : null,
    backgroundX: typeof value.backgroundX === 'number' && Number.isFinite(value.backgroundX) ? value.backgroundX : 0,
    backgroundY: typeof value.backgroundY === 'number' && Number.isFinite(value.backgroundY) ? value.backgroundY : 0,
    backgroundWidth: typeof value.backgroundWidth === 'number' && Number.isFinite(value.backgroundWidth) ? value.backgroundWidth : 100,
    backgroundHeight: typeof value.backgroundHeight === 'number' && Number.isFinite(value.backgroundHeight) ? value.backgroundHeight : 100,
    backgroundRotation: typeof value.backgroundRotation === 'number' && Number.isFinite(value.backgroundRotation) ? value.backgroundRotation : 0,
    assets: Array.isArray(value.assets) ? value.assets as StudioAsset[] : [],
    elements: Array.isArray(value.elements) ? value.elements as StudioDocument['elements'] : []
  }
}

async function readStudio(id: string): Promise<StudioDocument | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Identificador de Studio inválido.')
  try {
    const raw = JSON.parse(await readFile(join(studioPath(id), 'studio.json'), 'utf8')) as Record<string, unknown>
    const normalized = normalizeStudio(raw, id)
    const folder = studioPath(id)
    const assets = await Promise.all(normalized.assets.map(async (asset) => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(asset.id)
        || !['background', 'object', 'character'].includes(asset.category)
        || !['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType)) throw new Error('Biblioteca de imagens do Studio inválida.')
      const extension = asset.mimeType === 'image/jpeg' ? 'jpg' : asset.mimeType.slice('image/'.length)
      const categoryFolder = asset.category === 'background' ? 'backgrounds' : asset.category === 'character' ? 'characters' : 'objects'
      const data = await readFile(join(folder, 'assets', categoryFolder, `${asset.id}.${extension}`))
      return { ...asset, dataUrl: `data:${asset.mimeType};base64,${data.toString('base64')}` }
    }))
    const document = { ...normalized, assets }
    if (!isStudioDocument(document)) throw new Error(`Os dados do Studio ${id} estão inválidos.`)
    return document
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw reason
  }
}

async function writeStudio(studio: StudioDocument): Promise<void> {
  if (!isStudioDocument(studio)) throw new Error('Dados do Studio inválidos.')
  const folder = studioPath(studio.id)
  await Promise.all([
    mkdir(join(folder, 'assets', 'backgrounds'), { recursive: true }),
    mkdir(join(folder, 'assets', 'objects'), { recursive: true }),
    mkdir(join(folder, 'assets', 'characters'), { recursive: true }),
    mkdir(join(folder, 'prints'), { recursive: true })
  ])
  const assetManifest: Array<Omit<StudioAsset, 'dataUrl'>> = []
  for (const asset of studio.assets) {
    const extension = asset.mimeType === 'image/jpeg' ? 'jpg' : asset.mimeType.slice('image/'.length)
    const bytes = Buffer.from(asset.dataUrl.slice(asset.dataUrl.indexOf(',') + 1), 'base64')
    const categoryFolder = asset.category === 'background' ? 'backgrounds' : asset.category === 'character' ? 'characters' : 'objects'
    await writeFile(join(folder, 'assets', categoryFolder, `${asset.id}.${extension}`), bytes)
    const { dataUrl: _dataUrl, ...metadata } = asset
    assetManifest.push(metadata)
  }
  const temporary = join(folder, 'studio.json.tmp')
  const { assets: _assets, ...metadata } = studio
  await writeFile(temporary, JSON.stringify({ ...metadata, title: studio.title.trim(), assets: assetManifest }, null, 2), 'utf8')
  await rename(temporary, join(folder, 'studio.json'))
}

async function listStudios(): Promise<StudioDocument[]> {
  await mkdir(studioLibraryPath(), { recursive: true })
  const entries = await readdir(studioLibraryPath(), { withFileTypes: true })
  const documents = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && /^studio-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry.name))
    .map((entry) => readStudio(entry.name.slice('studio-'.length))))
  return documents.filter((studio): studio is StudioDocument => studio !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.title.localeCompare(b.title))
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

async function modelHeadParts(modelSlot: number): Promise<Array<Pick<ModelPart, 'id' | 'name' | 'width' | 'height' | 'resizeBase'>>> {
  try {
    const model = JSON.parse(await readFile(join(slotPath(modelSlot), 'project.json'), 'utf8')) as FabricatorProjectSave
    return model.parts.filter((part) => part.resizeBase).map(({ id, name, width, height, resizeBase }) => ({ id, name, width, height, resizeBase }))
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw reason
  }
}

async function preserveAndWritePoseManifest(path: string, document: FabricatorPoseSave | FabricatorPoseDraftSave): Promise<void> {
  const backup = `${path}.before-head-shape`
  try { await access(backup) } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
    await copyFile(path, backup)
  }
  const temporary = `${path}.tmp`
  await writeFile(temporary, JSON.stringify(document), 'utf8')
  await rename(temporary, path)
}

async function writePoseProject(modelSlot: number, slot: number, project: FabricatorPoseSave, assets: FabricatorAssetSave[]): Promise<void> {
  if (!isValidModelSlot(modelSlot) || project.sourceModelSlot !== modelSlot || !isValidPoseSlot(slot) || project.slot !== slot || project.schemaVersion !== 1 || project.parts.length === 0 || project.parts.length > 500) throw new Error('Pose inválida.')
  if (project.category !== undefined && (typeof project.category !== 'string' || !project.category.trim() || project.category.trim().length > 32 || /[\r\n\t]/.test(project.category))) throw new Error('Categoria de pose inválida.')
  const folder = poseSlotPath(modelSlot, slot)
  // A edição automática salva primeiro no diretório de rascunho e consome as
  // imagens pendentes no renderer. Ao salvar no slot, copie as partes já
  // persistidas no rascunho para que o slot independente tenha sua biblioteca.
  await writePoseAssets(folder, project.parts, assets, poseDraftPath(modelSlot))
  const temporary = join(folder, 'pose.json.tmp')
  await writeFile(temporary, JSON.stringify({ ...project, category: resolvePoseCategory(project) }), 'utf8')
  await rename(temporary, join(folder, 'pose.json'))
}

async function readPoseProject(modelSlot: number, slot: number): Promise<FabricatorPose | null> {
  if (!isValidModelSlot(modelSlot)) throw new Error('Modelo da pose inválido.')
  if (!isValidPoseSlot(slot)) throw new Error('Slot de pose inválido.')
  try {
    const folder = poseSlotPath(modelSlot, slot)
    const manifest = JSON.parse(await readFile(join(folder, 'pose.json'), 'utf8')) as FabricatorPoseSave
    if (manifest.slot !== slot || manifest.sourceModelSlot !== modelSlot || manifest.schemaVersion !== 1 || manifest.parts.length === 0 || manifest.parts.length > 500) return null
    const pose = { ...manifest, parts: await readPoseAssets(folder, manifest.parts) }
    const shaped = applyModelHeadShape(pose, await modelHeadParts(modelSlot))
    if (shaped !== pose) {
      const { parts, ...metadata } = shaped
      await preserveAndWritePoseManifest(join(folder, 'pose.json'), { ...metadata, parts: parts.map(({ dataUrl: _dataUrl, ...part }) => part) })
    }
    return shaped
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw reason
  }
}

async function writePoseDraft(modelSlot: number, draft: FabricatorPoseDraftSave, assets: FabricatorAssetSave[]): Promise<void> {
  if (!isValidModelSlot(modelSlot) || draft.project.sourceModelSlot !== modelSlot) throw new Error('Modelo do rascunho inválido.')
  if (draft.editingSlot !== null && !isValidPoseSlot(draft.editingSlot)) throw new Error('Rascunho de pose inválido.')
  if (draft.project.schemaVersion !== 1 || draft.project.parts.length === 0 || draft.project.parts.length > 500) throw new Error('Rascunho de pose inválido.')
  if (draft.project.category !== undefined && (typeof draft.project.category !== 'string' || !draft.project.category.trim() || draft.project.category.trim().length > 32 || /[\r\n\t]/.test(draft.project.category))) throw new Error('Categoria de pose inválida.')
  const folder = poseDraftPath(modelSlot)
  await writePoseAssets(folder, draft.project.parts, assets)
  const temporary = join(folder, 'draft.json.tmp')
  await writeFile(temporary, JSON.stringify({ ...draft, project: { ...draft.project, category: resolvePoseCategory({ ...draft.project, slot: draft.editingSlot ?? undefined }) } }), 'utf8')
  await rename(temporary, join(folder, 'draft.json'))
}

async function readPoseDraft(modelSlot: number): Promise<FabricatorPoseDraft | null> {
  if (!isValidModelSlot(modelSlot)) throw new Error('Modelo do rascunho inválido.')
  try {
    const folder = poseDraftPath(modelSlot)
    const draft = JSON.parse(await readFile(join(folder, 'draft.json'), 'utf8')) as FabricatorPoseDraftSave
    if (draft.editingSlot !== null && !isValidPoseSlot(draft.editingSlot)) return null
    if (draft.project.sourceModelSlot !== modelSlot || draft.project.schemaVersion !== 1 || draft.project.parts.length === 0 || draft.project.parts.length > 500) return null
    const project = { ...draft.project, parts: await readPoseAssets(folder, draft.project.parts) }
    const shaped = applyModelHeadShape(project, await modelHeadParts(modelSlot))
    if (shaped !== project) {
      const { parts, ...metadata } = shaped
      await preserveAndWritePoseManifest(join(folder, 'draft.json'), { ...draft, project: { ...metadata, parts: parts.map(({ dataUrl: _dataUrl, ...part }) => part) } })
    }
    return { ...draft, project: shaped }
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw reason
  }
}

function isValidAnimatorSlot(slot: number): boolean { return isValidPoseSlot(slot) }

function validateAnimatorDocument(modelSlot: number, document: Pick<AnimatorAnimation, 'schemaVersion' | 'sourceModelSlot' | 'parts' | 'frames' | 'interpolation' | 'loopMode' | 'speed' | 'thumbnailDataUrl'>): void {
  if (!isValidModelSlot(modelSlot) || document.schemaVersion !== 1 || document.sourceModelSlot !== modelSlot || !Array.isArray(document.parts) || document.parts.length === 0 || document.parts.length > 500 || !Array.isArray(document.frames) || document.frames.length === 0 || document.frames.length > 300) throw new Error('Animação inválida.')
  if (!['smooth', 'stepped'].includes(document.interpolation) || !['once', 'loop', 'pingpong'].includes(document.loopMode) || !Number.isFinite(document.speed) || document.speed < 0.1 || document.speed > 4) throw new Error('Configurações da animação inválidas.')
  const partIds = new Set(document.parts.map((part) => part.id))
  if (partIds.size !== document.parts.length || [...partIds].some((id) => !/^[a-zA-Z0-9_-]{1,80}$/.test(id))) throw new Error('Identificadores de peças da animação inválidos.')
  for (const frame of document.frames) {
    if (!frame.id || !Number.isFinite(frame.durationMs) || frame.durationMs < 40 || frame.durationMs > 10000 || !frame.thumbnailDataUrl.startsWith('data:image/png;base64,') || frame.thumbnailDataUrl.length > 3_000_000) throw new Error('Frame de animação inválido.')
    for (const id of partIds) {
      const transform = frame.transforms[id]
      if (!transform || !Number.isFinite(transform.x) || !Number.isFinite(transform.y) || !Number.isFinite(transform.rotation)) throw new Error('Transformação de frame inválida.')
    }
  }
  if (!document.thumbnailDataUrl.startsWith('data:image/png;base64,') || document.thumbnailDataUrl.length > 3_000_000) throw new Error('Miniatura da animação inválida.')
}

async function writeAnimatorParts(folder: string, parts: Array<Omit<PosePart, 'dataUrl'>>, assets: AnimatorAnimationAsset[]): Promise<void> {
  const partsFolder = join(folder, 'parts')
  await mkdir(partsFolder, { recursive: true })
  const validIds = new Set(parts.map((part) => part.id))
  for (const asset of assets) if (validIds.has(asset.id)) await writeFile(join(partsFolder, `${asset.id}.png`), dataUrlBuffer(asset.dataUrl))
  for (const part of parts) {
    const target = join(partsFolder, `${part.id}.png`)
    try { await access(target) } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
      throw new Error(`Imagem-base ausente na animação: ${part.name} (${part.id}).`)
    }
  }
  const keep = new Set(parts.map((part) => `${part.id}.png`))
  for (const filename of await readdir(partsFolder)) if (filename.endsWith('.png') && !keep.has(filename)) await unlink(join(partsFolder, filename))
}

async function readAnimatorParts(folder: string, parts: Array<Omit<PosePart, 'dataUrl'>>): Promise<PosePart[]> {
  return Promise.all(parts.map(async (part) => ({ ...part, dataUrl: `data:image/png;base64,${(await readFile(join(folder, 'parts', `${part.id}.png`))).toString('base64')}` })))
}

async function writeAnimatorAnimation(modelSlot: number, slot: number, animation: AnimatorAnimationSave, assets: AnimatorAnimationAsset[]): Promise<void> {
  if (!isValidAnimatorSlot(slot) || animation.slot !== slot) throw new Error('Slot de animação inválido.')
  validateAnimatorDocument(modelSlot, animation as AnimatorAnimation)
  const folder = animatorSlotPath(modelSlot, slot)
  await writeAnimatorParts(folder, animation.parts, assets)
  await mkdir(folder, { recursive: true })
  const temporary = join(folder, 'animation.json.tmp')
  await writeFile(temporary, JSON.stringify(animation), 'utf8')
  await rename(temporary, join(folder, 'animation.json'))
}

async function readAnimatorAnimation(modelSlot: number, slot: number): Promise<AnimatorAnimation | null> {
  if (!isValidModelSlot(modelSlot) || !isValidAnimatorSlot(slot)) throw new Error('Slot de animação inválido.')
  try {
    const folder = animatorSlotPath(modelSlot, slot)
    const saved = JSON.parse(await readFile(join(folder, 'animation.json'), 'utf8')) as AnimatorAnimationSave
    if (saved.slot !== slot) return null
    validateAnimatorDocument(modelSlot, saved as AnimatorAnimation)
    return { ...saved, parts: await readAnimatorParts(folder, saved.parts) }
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw reason
  }
}

async function writeAnimatorDraft(modelSlot: number, draft: AnimatorAnimationDraft, assets: AnimatorAnimationAsset[]): Promise<void> {
  if (!isValidModelSlot(modelSlot) || draft.animation.sourceModelSlot !== modelSlot || (draft.editingSlot !== null && !isValidAnimatorSlot(draft.editingSlot))) throw new Error('Rascunho de animação inválido.')
  validateAnimatorDocument(modelSlot, { ...draft.animation, slot: draft.editingSlot ?? 1 } as AnimatorAnimation)
  const folder = animatorDraftPath(modelSlot)
  await writeAnimatorParts(folder, draft.animation.parts, assets)
  await mkdir(folder, { recursive: true })
  const temporary = join(folder, 'draft.json.tmp')
  await writeFile(temporary, JSON.stringify(draft), 'utf8')
  await rename(temporary, join(folder, 'draft.json'))
}

async function readAnimatorDraft(modelSlot: number): Promise<AnimatorAnimationDraft | null> {
  if (!isValidModelSlot(modelSlot)) throw new Error('Modelo de rascunho inválido.')
  try {
    const folder = animatorDraftPath(modelSlot)
    const draft = JSON.parse(await readFile(join(folder, 'draft.json'), 'utf8')) as AnimatorAnimationDraft
    if (draft.editingSlot !== null && !isValidAnimatorSlot(draft.editingSlot)) return null
    validateAnimatorDocument(modelSlot, { ...draft.animation, slot: draft.editingSlot ?? 1 } as AnimatorAnimation)
    return { ...draft, animation: { ...draft.animation, parts: await readAnimatorParts(folder, draft.animation.parts) } }
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw reason
  }
}

async function registerFabricatorHandlers(): Promise<void> {
  ipcMain.handle('studio:list', async (event): Promise<StudioDocument[]> => {
    assertTrustedSender(event)
    return listStudios()
  })

  ipcMain.handle('studio:save', async (event, studio: StudioDocument): Promise<void> => {
    assertTrustedSender(event)
    const next = studioSaveQueue.catch(() => undefined).then(() => writeStudio(studio))
    studioSaveQueue = next
    await next
  })

  ipcMain.handle('studio:delete', async (event, id: string): Promise<void> => {
    assertTrustedSender(event)
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Identificador de Studio inválido.')
    const next = studioSaveQueue.catch(() => undefined).then(async () => {
      const folder = resolve(studioPath(id))
      if (dirname(folder) !== resolve(studioLibraryPath()) || basename(folder) !== `studio-${id}`) throw new Error('Pasta do Studio inválida.')
      await rm(folder, { recursive: true, force: true })
    })
    studioSaveQueue = next
    await next
  })

  ipcMain.handle('studio:folder', (event): string => {
    assertTrustedSender(event)
    return studioLibraryPath()
  })

  ipcMain.handle('studio:import-image', async (event, category: StudioAsset['category']): Promise<StudioAsset | null> => {
    assertTrustedSender(event)
    if (category !== 'background' && category !== 'object') throw new Error('Categoria de imagem inválida.')
    const result = await dialog.showOpenDialog({
      title: category === 'background' ? 'Adicionar imagem de fundo' : 'Adicionar objeto à cena',
      properties: ['openFile'],
      filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const path = result.filePaths[0]
    const extension = extname(path).toLowerCase()
    const size = (await stat(path)).size
    if (size > 50 * 1024 * 1024) throw new Error('A imagem excede o limite de 50 MB.')
    const mimeType: StudioAsset['mimeType'] = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg'
    const bytes = await readFile(path)
    return { id: randomUUID(), category, name: basename(path), mimeType, dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}` }
  })

  ipcMain.handle('studio:save-print', async (event, id: string, dataUrl: string): Promise<string | null> => {
    assertTrustedSender(event)
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Identificador de Studio inválido.')
    const bytes = dataUrlBuffer(dataUrl)
    if (bytes.length > 50 * 1024 * 1024) throw new Error('O print excede o limite de 50 MB.')
    const printsFolder = join(studioPath(id), 'prints')
    await mkdir(printsFolder, { recursive: true })
    const printPath = join(printsFolder, `print-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.png`)
    await writeFile(printPath, bytes)
    return printPath
  })

  ipcMain.handle('studio:open-prints', async (event, id: string): Promise<void> => {
    assertTrustedSender(event)
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Identificador de Studio inválido.')
    const printsFolder = resolve(studioPath(id), 'prints')
    if (dirname(printsFolder) !== resolve(studioPath(id))) throw new Error('Pasta de prints inválida.')
    await mkdir(printsFolder, { recursive: true })
    const error = await shell.openPath(printsFolder)
    if (error) throw new Error(`Não foi possível abrir a pasta de prints: ${error}`)
  })

  ipcMain.handle('customizer:characters:list', async (event): Promise<CustomizerCharacter[]> => {
    assertTrustedSender(event)
    return readCustomizerCharacters()
  })

  ipcMain.handle('customizer:characters:save', async (event, character: CustomizerCharacter): Promise<void> => {
    assertTrustedSender(event)
    if (!isCustomizerCharacter(character)) throw new Error('Dados de personagem inválidos.')
    const next = characterSaveQueue.catch(() => undefined).then(async () => {
      const characters = await readCustomizerCharacters()
      const index = characters.findIndex((item) => item.id === character.id)
      if (index < 0) throw new Error('Personagem não encontrado.')
      characters[index] = { ...character, name: character.name.trim(), updatedAt: new Date().toISOString() }
      await writeCustomizerCharacters(characters)
    })
    characterSaveQueue = next
    await next
  })

  ipcMain.handle('customizer:characters:create', async (event, requestedName: string): Promise<CustomizerCharacter> => {
    assertTrustedSender(event)
    const name = typeof requestedName === 'string' ? requestedName.trim().slice(0, 80) : ''
    if (!name) throw new Error('Digite um nome para o personagem.')
    let created!: CustomizerCharacter
    const next = characterSaveQueue.catch(() => undefined).then(async () => {
      const characters = await readCustomizerCharacters()
      const now = new Date().toISOString()
      created = {
        id: randomUUID(), name,
        hair: '#47354b', outfit: '#df9ab6', skin: '#f2d9c9',
        customization: { modelSlot: 1, poseSlot: 1, partOverrides: {}, layerOrder: [] },
        createdAt: now, updatedAt: now
      }
      characters.push(created)
      await writeCustomizerCharacters(characters)
    })
    characterSaveQueue = next
    await next
    return created
  })

  ipcMain.handle('customizer:characters:delete', async (event, id: string): Promise<void> => {
    assertTrustedSender(event)
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Identificador de personagem inválido.')
    const next = characterSaveQueue.catch(() => undefined).then(async () => {
      const characters = await readCustomizerCharacters()
      if (!characters.some((character) => character.id === id)) throw new Error('Personagem não encontrado.')
      await writeCustomizerCharacters(characters.filter((character) => character.id !== id))
    })
    characterSaveQueue = next
    await next
  })

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
      for (let slot = 1; slot <= poseSlotCount; slot += 1) {
        try {
          const manifest = JSON.parse(await readFile(join(poseSlotPath(modelSlot, slot), 'pose.json'), 'utf8')) as FabricatorPoseSave
          if (manifest.sourceModelSlot !== modelSlot || manifest.slot !== slot) continue
          allSlots.push({ slot, sourceModelSlot: modelSlot, name: manifest.name, category: resolvePoseCategory(manifest), sourceModelName: manifest.sourceModelName, partCount: manifest.parts.length, updatedAt: manifest.updatedAt })
        } catch { /* Slots sem manifest válido aparecem vazios. */ }
      }
    }
    return requestedModelSlot === undefined ? allSlots : Array.from({ length: poseSlotCount }, (_, index) => allSlots.find((item) => item?.slot === index + 1) ?? null)
  })

  ipcMain.handle('fabricator:poses:load', async (event, modelSlot: number, slot: number): Promise<FabricatorPose | null> => {
    assertTrustedSender(event)
    let loaded: FabricatorPose | null = null
    await queuePoseWrite(async () => { loaded = await readPoseProject(modelSlot, slot) })
    return loaded
  })

  ipcMain.handle('fabricator:poses:save', async (event, modelSlot: number, slot: number, project: FabricatorPoseSave, assets: FabricatorAssetSave[]): Promise<void> => {
    assertTrustedSender(event)
    await queuePoseWrite(() => writePoseProject(modelSlot, slot, project, assets))
  })

  ipcMain.handle('fabricator:poses:delete', async (event, modelSlot: number, slot: number): Promise<void> => {
    assertTrustedSender(event)
    if (!isValidModelSlot(modelSlot) || !isValidPoseSlot(slot)) throw new Error('Slot de pose inválido.')
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
    let loaded: FabricatorPoseDraft | null = null
    await queuePoseWrite(async () => { loaded = await readPoseDraft(modelSlot) })
    return loaded
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

  ipcMain.handle('fabricator:animator:model-slots', async (event): Promise<number[]> => {
    assertTrustedSender(event)
    try {
      const entries = await readdir(animatorLibraryPath(), { withFileTypes: true })
      return entries.flatMap((entry) => {
        const match = entry.isDirectory() ? /^model-(\d{1,3})$/.exec(entry.name) : null
        const slot = match ? Number(match[1]) : 0
        return slot && isValidModelSlot(slot) ? [slot] : []
      }).sort((a, b) => a - b)
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw reason
    }
  })

  ipcMain.handle('fabricator:animator:list', async (event, modelSlot: number): Promise<AnimatorAnimationSummary[]> => {
    assertTrustedSender(event)
    if (!isValidModelSlot(modelSlot)) throw new Error('Modelo inválido.')
    const entries: AnimatorAnimationSummary[] = []
    for (let slot = 1; slot <= poseSlotCount; slot += 1) {
      try {
        const animation = JSON.parse(await readFile(join(animatorSlotPath(modelSlot, slot), 'animation.json'), 'utf8')) as AnimatorAnimationSave
        if (animation.schemaVersion !== 1 || animation.sourceModelSlot !== modelSlot || animation.slot !== slot) continue
        entries.push({ slot, sourceModelSlot: modelSlot, name: animation.name, sourceModelName: animation.sourceModelName, sourceModelUpdatedAt: animation.sourceModelUpdatedAt, sourceModelPartCount: animation.sourceModelPartCount, thumbnailDataUrl: animation.thumbnailDataUrl, updatedAt: animation.updatedAt })
      } catch { /* Slots inválidos ou ainda vazios são ignorados. */ }
    }
    return entries
  })

  ipcMain.handle('fabricator:animator:load', async (event, modelSlot: number, slot: number): Promise<AnimatorAnimation | null> => {
    assertTrustedSender(event)
    let loaded: AnimatorAnimation | null = null
    const next = animatorSaveQueue.catch(() => undefined).then(async () => { loaded = await readAnimatorAnimation(modelSlot, slot) })
    animatorSaveQueue = next
    await next
    return loaded
  })

  ipcMain.handle('fabricator:animator:save', async (event, modelSlot: number, slot: number, animation: AnimatorAnimationSave, assets: AnimatorAnimationAsset[]): Promise<void> => {
    assertTrustedSender(event)
    const next = animatorSaveQueue.catch(() => undefined).then(() => writeAnimatorAnimation(modelSlot, slot, animation, assets))
    animatorSaveQueue = next
    await next
  })

  ipcMain.handle('fabricator:animator:delete', async (event, modelSlot: number, slot: number): Promise<void> => {
    assertTrustedSender(event)
    if (!isValidModelSlot(modelSlot) || !isValidAnimatorSlot(slot)) throw new Error('Slot de animação inválido.')
    const next = animatorSaveQueue.catch(() => undefined).then(async () => {
      const base = resolve(animatorModelPath(modelSlot))
      const target = resolve(animatorSlotPath(modelSlot, slot))
      if (dirname(target) !== base || basename(target) !== `slot-${slot}`) throw new Error('Caminho de exclusão de animação inválido.')
      await rm(target, { recursive: true, force: true })
    })
    animatorSaveQueue = next
    await next
  })

  ipcMain.handle('fabricator:animator:draft:load', async (event, modelSlot: number): Promise<AnimatorAnimationDraft | null> => {
    assertTrustedSender(event)
    let loaded: AnimatorAnimationDraft | null = null
    const next = animatorSaveQueue.catch(() => undefined).then(async () => { loaded = await readAnimatorDraft(modelSlot) })
    animatorSaveQueue = next
    await next
    return loaded
  })

  ipcMain.handle('fabricator:animator:draft:save', async (event, modelSlot: number, draft: AnimatorAnimationDraft, assets: AnimatorAnimationAsset[]): Promise<void> => {
    assertTrustedSender(event)
    const next = animatorSaveQueue.catch(() => undefined).then(() => writeAnimatorDraft(modelSlot, draft, assets))
    animatorSaveQueue = next
    await next
  })

  ipcMain.handle('fabricator:animator:draft:delete', async (event, modelSlot: number): Promise<void> => {
    assertTrustedSender(event)
    if (!isValidModelSlot(modelSlot)) throw new Error('Modelo de rascunho inválido.')
    const next = animatorSaveQueue.catch(() => undefined).then(async () => {
      const base = resolve(animatorModelPath(modelSlot))
      const target = resolve(animatorDraftPath(modelSlot))
      if (dirname(target) !== base || basename(target) !== 'draft') throw new Error('Caminho de rascunho inválido.')
      await rm(target, { recursive: true, force: true })
    })
    animatorSaveQueue = next
    await next
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

  ipcMain.handle('fabricator:face:list', async (event, modelSlot: number): Promise<FaceSetSummary[]> => {
    assertTrustedSender(event)
    if (!isValidModelSlot(modelSlot)) throw new Error('Modelo inválido.')
    try {
      const entries = await readdir(faceModelPath(modelSlot), { withFileTypes: true })
      const sets: FaceSetSummary[] = []
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^set-[a-zA-Z0-9_-]{1,80}$/.test(entry.name)) continue
        try {
          const set = JSON.parse(await readFile(join(faceModelPath(modelSlot), entry.name, 'face.json'), 'utf8')) as FaceSetSave
          if (validFaceSet(modelSlot, set) && set.id === entry.name.slice(4)) sets.push({ id: set.id, modelSlot, name: set.name, updatedAt: set.updatedAt, pieceCount: set.pieces.length })
        } catch { /* Rostos incompletos não aparecem na biblioteca. */ }
      }
      return sets.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw reason
    }
  })

  ipcMain.handle('fabricator:face:load', async (event, modelSlot: number, id: string): Promise<FaceSet | null> => {
    assertTrustedSender(event)
    return readFaceSet(modelSlot, id)
  })

  ipcMain.handle('fabricator:face:save', async (event, modelSlot: number, set: FaceSetSave, assets: FaceAssetSave[]): Promise<void> => {
    assertTrustedSender(event)
    const next = faceSaveQueue.catch(() => undefined).then(() => writeFaceSet(modelSlot, set, assets))
    faceSaveQueue = next
    await next
  })

  ipcMain.handle('fabricator:face:delete', async (event, modelSlot: number, id: string): Promise<void> => {
    assertTrustedSender(event)
    if (!isValidModelSlot(modelSlot) || !isValidWardrobeId(id)) throw new Error('Rosto inválido.')
    const base = resolve(faceModelPath(modelSlot))
    const target = resolve(faceSetPath(modelSlot, id))
    if (dirname(target) !== base || basename(target) !== `set-${id}`) throw new Error('Caminho de exclusão inválido.')
    const next = faceSaveQueue.catch(() => undefined).then(() => rm(target, { recursive: true, force: true }))
    faceSaveQueue = next
    await next
  })

  ipcMain.handle('fabricator:face-catalog:list', async (event, modelSlot: number): Promise<FaceCatalogItemSummary[]> => {
    assertTrustedSender(event)
    return listFaceCatalogItems(modelSlot)
  })

  ipcMain.handle('fabricator:face-catalog:load', async (event, modelSlot: number, id: string): Promise<FaceCatalogItem | null> => {
    assertTrustedSender(event)
    return readFaceCatalogItem(modelSlot, id)
  })

  ipcMain.handle('fabricator:face-catalog:save', async (event, modelSlot: number, item: FaceCatalogItemSave, assets: FaceAssetSave[]): Promise<void> => {
    assertTrustedSender(event)
    const next = faceSaveQueue.catch(() => undefined).then(() => writeFaceCatalogItem(modelSlot, item, assets))
    faceSaveQueue = next
    await next
  })

  ipcMain.handle('fabricator:face-catalog:delete', async (event, modelSlot: number, id: string): Promise<void> => {
    assertTrustedSender(event)
    if (!isValidModelSlot(modelSlot) || !isValidFaceCatalogId(id)) throw new Error('Peça facial inválida.')
    const base = resolve(faceCatalogPath(modelSlot))
    const target = resolve(faceCatalogItemPath(modelSlot, id))
    if (dirname(target) !== base || basename(target) !== `item-${id}`) throw new Error('Caminho de exclusão inválido.')
    const next = faceSaveQueue.catch(() => undefined).then(() => rm(target, { recursive: true, force: true }))
    faceSaveQueue = next
    await next
  })

  ipcMain.handle('fabricator:face-components:list', async (event, modelSlot: number, kind?: FaceComponentKind): Promise<FaceComponentAssetSummary[]> => {
    assertTrustedSender(event)
    return listFaceComponentAssets(modelSlot, kind)
  })
  ipcMain.handle('fabricator:face-components:load', async (event, modelSlot: number, id: string): Promise<FaceComponentAsset | null> => {
    assertTrustedSender(event)
    return readFaceComponentAsset(modelSlot, id)
  })
  ipcMain.handle('fabricator:face-components:save', async (event, modelSlot: number, asset: FaceComponentAssetSave, dataUrl: string): Promise<void> => {
    assertTrustedSender(event)
    const next = faceSaveQueue.catch(() => undefined).then(() => writeFaceComponentAsset(modelSlot, asset, dataUrl))
    faceSaveQueue = next
    await next
  })
  ipcMain.handle('fabricator:face-components:delete', async (event, modelSlot: number, id: string): Promise<void> => {
    assertTrustedSender(event)
    if (!isValidModelSlot(modelSlot) || !isValidWardrobeId(id)) throw new Error('Asset facial inválido.')
    const base = resolve(faceComponentPath(modelSlot))
    const target = resolve(faceComponentItemPath(modelSlot, id))
    if (dirname(target) !== base || basename(target) !== `item-${id}`) throw new Error('Caminho de exclusão inválido.')
    const next = faceSaveQueue.catch(() => undefined).then(() => rm(target, { recursive: true, force: true }))
    faceSaveQueue = next
    await next
  })

  ipcMain.handle('fabricator:hair:load', async (event, modelSlot: number): Promise<HairWorkspace | null> => {
    assertTrustedSender(event)
    return readHairWorkspace(modelSlot)
  })

  ipcMain.handle('fabricator:hair:save', async (event, modelSlot: number, workspace: HairWorkspaceSave, assets: HairWorkspaceAsset[]): Promise<void> => {
    assertTrustedSender(event)
    const previous = hairSaveQueues.get(modelSlot) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(() => writeHairWorkspace(modelSlot, workspace, assets))
    hairSaveQueues.set(modelSlot, current)
    try { await current } finally { if (hairSaveQueues.get(modelSlot) === current) hairSaveQueues.delete(modelSlot) }
  })

  ipcMain.handle('fabricator:hair:styles:list', async (event, modelSlot: number): Promise<HairStyleSummary[]> => {
    assertTrustedSender(event)
    if (!isValidModelSlot(modelSlot)) throw new Error('Modelo inválido.')
    try {
      const stylesFolder = join(hairModelPath(modelSlot), 'styles')
      await mkdir(stylesFolder, { recursive: true })
      const entries = await readdir(stylesFolder, { withFileTypes: true })
      const styles: HairStyleSummary[] = []
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^style-[a-zA-Z0-9_-]{1,80}$/.test(entry.name)) continue
        try {
          const saved = JSON.parse(await readFile(join(hairModelPath(modelSlot), 'styles', entry.name, 'hair-style.json'), 'utf8')) as HairStyleSave
          if (validHairStyle(modelSlot, saved) && saved.id === entry.name.slice(6)) styles.push({ ...saved, front: saved.front, back: saved.back })
        } catch { /* Configurações incompletas não aparecem no catálogo. */ }
      }
      const migrationMarker = join(hairModelPath(modelSlot), 'hair-style-migration-v1')
      try { await access(migrationMarker) } catch (reason) {
        if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
        const legacy = await readHairWorkspace(modelSlot)
        if (legacy && (legacy.front || legacy.back || legacy.fringe) && !styles.some((style) => style.id === 'legacy-workspace')) {
          const now = legacy.updatedAt || new Date().toISOString()
          const saved: HairStyleSave = {
            schemaVersion: 1, id: 'legacy-workspace', modelSlot, name: 'Cabelo 01',
            front: legacy.front ? { width: legacy.front.width, height: legacy.front.height } : null,
            back: legacy.back ? { width: legacy.back.width, height: legacy.back.height } : null,
            fringe: legacy.fringe ? { width: legacy.fringe.width, height: legacy.fringe.height } : null,
            transforms: legacy.transforms, createdAt: now, updatedAt: now
          }
          const assets = [legacy.front && { id: 'front' as const, dataUrl: legacy.front.dataUrl }, legacy.back && { id: 'back' as const, dataUrl: legacy.back.dataUrl }, legacy.fringe && { id: 'fringe' as const, dataUrl: legacy.fringe.dataUrl }].filter((asset): asset is NonNullable<typeof asset> => asset !== null)
          await writeHairStyle(modelSlot, saved, assets)
          styles.push(saved)
        }
        await writeFile(migrationMarker, new Date().toISOString(), 'utf8')
      }
      return styles.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw reason
    }
  })

  ipcMain.handle('fabricator:hair:styles:load', async (event, modelSlot: number, id: string): Promise<HairStyle | null> => {
    assertTrustedSender(event)
    return readHairStyle(modelSlot, id)
  })

  ipcMain.handle('fabricator:hair:styles:save', async (event, modelSlot: number, style: HairStyleSave, assets: HairStyleAsset[]): Promise<void> => {
    assertTrustedSender(event)
    const previous = hairSaveQueues.get(modelSlot) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(() => writeHairStyle(modelSlot, style, assets))
    hairSaveQueues.set(modelSlot, current)
    try { await current } finally { if (hairSaveQueues.get(modelSlot) === current) hairSaveQueues.delete(modelSlot) }
  })

  ipcMain.handle('fabricator:hair:styles:delete', async (event, modelSlot: number, id: string): Promise<void> => {
    assertTrustedSender(event)
    if (!isValidModelSlot(modelSlot) || !isValidWardrobeId(id)) throw new Error('Estilo de cabelo inválido.')
    const base = resolve(join(hairModelPath(modelSlot), 'styles'))
    const target = resolve(hairStylePath(modelSlot, id))
    if (dirname(target) !== base || basename(target) !== `style-${id}`) throw new Error('Caminho de exclusão inválido.')
    const previous = hairSaveQueues.get(modelSlot) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(() => rm(target, { recursive: true, force: true }))
    hairSaveQueues.set(modelSlot, current)
    try { await current } finally { if (hairSaveQueues.get(modelSlot) === current) hairSaveQueues.delete(modelSlot) }
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
    icon: join(__dirname, '../renderer/gacha-nymi.ico'),
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
  const pendingWrites = [...fabricatorSaveQueues.values(), ...poseSaveWrites, ...hairSaveQueues.values(), studioSaveQueue]
  if (pendingWrites.length === 0 || waitingForFabricatorWritesBeforeQuit) return
  event.preventDefault()
  waitingForFabricatorWritesBeforeQuit = true
  void Promise.allSettled(pendingWrites).then(() => {
    waitingForFabricatorWritesBeforeQuit = false
    app.quit()
  })
})
