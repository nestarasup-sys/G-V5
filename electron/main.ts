import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell, type IpcMainInvokeEvent, type MessageBoxOptions } from 'electron'
import { createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { mkdir as nativeMkdir, readFile as nativeReadFile, writeFile as nativeWriteFile, readdir as nativeReaddir, unlink as nativeUnlink, rename as nativeRename, stat as nativeStat, access as nativeAccess, rm as nativeRm, copyFile as nativeCopyFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import type { AnimatorAnimation, AnimatorAnimationAsset, AnimatorAnimationDraft, AnimatorAnimationSave, AnimatorAnimationSummary, FaceAssetKind, FaceAssetSave, FaceCatalogItem, FaceCatalogItemSave, FaceCatalogItemSummary, FaceComponentAsset, FaceComponentAssetSave, FaceComponentAssetSummary, FaceElementKind, FaceExpressionCollection, FaceExpressionPreset, FaceExpressionPresetSummary, FaceExpressionTransforms, FaceExpressionWorkspaceDraft, FaceSet, FaceSetSave, FaceSetSummary, FaceSheetKind, FaceTransform, FabricatorAssetSave, FabricatorHistoryEntry, FabricatorHistorySaveEntry, FabricatorHistorySaveState, FabricatorHistoryState, FabricatorPose, FabricatorPoseDraft, FabricatorPoseDraftSave, FabricatorPoseSave, FabricatorPoseSummary, FabricatorProject, FabricatorProjectSave, FabricatorSlotSummary, HairStyle, HairStyleAsset, HairStyleSave, HairStyleSummary, HairWorkspace, HairWorkspaceAsset, HairWorkspaceSave, ModelPart, PosePart, WardrobeAssetSave, WardrobeCategory, WardrobeSet, WardrobeSetSave, WardrobeSetSummary } from '../src/shared/fabricator'
import { resolvePoseCategory } from '../src/shared/fabricator'
import { hairCategories } from '../src/shared/hairCategories'
import type { CustomizerCharacter, CustomizerFaceAppearance, CustomizerWardrobePaletteKey, HairColorOverrides } from '../src/shared/customizer'
import { characterBodyDimensionLimits, characterProportionLimits } from '../src/shared/customizer'
import { validWardrobeAdjustmentReference } from '../src/shared/wardrobeAdjustment'
import type { StudioAsset, StudioDocument, VideoStudioAsset, VideoTimelineDocument } from '../src/shared/studio'
import { applyModelHeadShape } from '../src/shared/headShape'
import { isStudioExpressionEffects, isStudioFaceTransforms } from '../src/shared/studio'
import { isValidVideoMediaClip } from '../src/shared/videoMedia'
import { isValidVideoAudioSettings } from '../src/shared/videoAudio'
import { VideoLibraryStore, configureVideoLibraryStorage } from './videoLibrary'
import { VideoBackgroundLibraryStore, configureBackgroundLibraryStorage } from './backgroundLibrary'
import { VideoExportLibrary } from './videoExports'
import { VideoExportJobStore } from './videoExportJobs'
import { VideoExportSurfaceHost } from './videoExportSurfaceHost'
import { VideoExportCoordinator } from './videoExportCoordinator'
import { VideoPreviewProxyStore } from './videoPreviewProxyStore'
import { resolveVideoStudioTools } from './videoToolsResolver'
import { probeVideoStudioFfmpeg, type VideoStudioFfmpegCapabilities } from './videoFfmpegCapabilities'
import type { VideoExportProgress, VideoExportStartRequest } from '../src/shared/videoExportRuntime'
import type { BaseVideoDetails, RoteiroDocument, RoteiroReactionBlock, RoteiroSectionContent, RoteiroTikTok, RoteiroVideoReference } from '../src/shared/roteiros'
import { serializeVideoCharacterRenderAssetSnapshot } from '../src/shared/videoCharacterRenderAssets'
import { DataPlatform, getAppDataUsage } from './dataPlatform.cjs'
import { DomainFileSystem } from './domainFileSystem.cjs'
import { DataMigrationService } from './dataMigration.cjs'
import { DataBackupService } from './dataBackups.cjs'
import { configureAssetImageStorage, readAssetImage, writeAssetImageSource } from './assetImageOverrides'
import { legacyStandardExpressionEffects } from '../src/shared/legacyExpressionEffects'
import { migrateElectronProfile } from './electronProfileMigration.cjs'
import { normalizeImageBuffer } from './imageIngestion.cjs'

let configuredAppDataRoot: string | null = null
let videoExportLibrary: VideoExportLibrary | null = null
let videoExportJobStore: VideoExportJobStore | null = null
let videoExportSurfaceHost: VideoExportSurfaceHost | null = null
let videoExportCoordinator: VideoExportCoordinator | null = null
let videoPreviewProxyStore: VideoPreviewProxyStore | null = null
let videoPreviewToolsPromise: Promise<{ ffmpeg: VideoStudioFfmpegCapabilities }> | null = null
const videoExportJobOwners = new Map<string, number>()
let roteirosSaveQueue: Promise<void> = Promise.resolve()

function isRoteiroDocument(value: unknown): value is RoteiroDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const roteiro = value as Partial<RoteiroDocument>
  const isText = (text: unknown, max: number) => typeof text === 'string' && text.trim().length > 0 && text.length <= max
  const isId = (id: unknown) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  const isOptionalSeconds = (seconds: unknown) => seconds === undefined || typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 && seconds <= 86400
  const isVideo = (video: unknown): video is RoteiroVideoReference | null | undefined => video === undefined || video === null || Boolean(video && typeof video === 'object' && !Array.isArray(video)
    && isId((video as RoteiroVideoReference).id) && isText((video as RoteiroVideoReference).name, 255)
    && ({ mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v' } as Record<string, string>)[(video as RoteiroVideoReference).extension] === (video as RoteiroVideoReference).mimeType
    && Number.isSafeInteger((video as RoteiroVideoReference).size) && (video as RoteiroVideoReference).size > 0 && (video as RoteiroVideoReference).size <= 5 * 1024 ** 3
    && Number.isSafeInteger((video as RoteiroVideoReference).durationFrames) && (video as RoteiroVideoReference).durationFrames > 0)
  const isContent = (content: unknown, characters: string[]): content is RoteiroSectionContent | undefined => content === undefined || Boolean(content && typeof content === 'object' && !Array.isArray(content)
    && isVideo((content as RoteiroSectionContent).video) && Array.isArray((content as RoteiroSectionContent).blocks) && (content as RoteiroSectionContent).blocks.length <= 200
    && ((content as RoteiroSectionContent).description === undefined || typeof (content as RoteiroSectionContent).description === 'string' && (content as RoteiroSectionContent).description!.length <= 20_000)
    && ((content as RoteiroSectionContent).timeline === undefined || ['unspecified', 'past', 'present', 'future'].includes((content as RoteiroSectionContent).timeline!))
    && isOptionalSeconds((content as RoteiroSectionContent).sceneEndSeconds)
    && isOptionalSeconds((content as RoteiroSectionContent).firstGroupReactionSeconds)
    && isOptionalSeconds((content as RoteiroSectionContent).secondGroupReactionSeconds)
    && (content as RoteiroSectionContent).blocks.every((block: RoteiroReactionBlock) => Boolean(block && isId(block.id)
      && (block.characterId === '' || isId(block.characterId) && characters.includes(block.characterId))
      && (block.kind === 'fala' || block.kind === 'pensamento')
      && typeof block.expression === 'string' && block.expression.length <= 500
      && typeof block.textPortuguese === 'string' && block.textPortuguese.length <= 10000
      && typeof block.textEnglish === 'string' && block.textEnglish.length <= 10000)))
  return isId(roteiro.id) && isText(roteiro.title, 100) && isText(roteiro.videoTitle, 100)
    && Array.isArray(roteiro.characterIds) && roteiro.characterIds.length <= 500 && roteiro.characterIds.every(isId)
    && Array.isArray(roteiro.tiktoks) && roteiro.tiktoks.length <= 500
    && isContent(roteiro.opening, roteiro.characterIds ?? [])
    && roteiro.tiktoks.every((item: RoteiroTikTok) => Boolean(item && isId(item.id) && isText(item.title, 100) && isText(item.videoTitle, 100)
      && isVideo(item.video) && isContent({ video: item.video ?? null, blocks: item.blocks ?? [], description: item.description, timeline: item.timeline, sceneEndSeconds: item.sceneEndSeconds, firstGroupReactionSeconds: item.firstGroupReactionSeconds, secondGroupReactionSeconds: item.secondGroupReactionSeconds }, roteiro.characterIds ?? [])))
}

function configureDevAiDataRoot(): void {
  const privateCopyTest = process.env.GACHA_DEV_AI_PRIVATE_TEST === '1'
  if (privateCopyTest && process.env.GACHA_DEV_AI_TEST !== '1') {
    throw new Error('O modo privado DEV AI exige o runner local isolado.')
  }
  if (process.env.GACHA_DEV_AI_TEST !== '1') return
  if (app.isPackaged || app.isReady()) throw new Error('DEV AI IPC só pode configurar o root antes do boot em build de desenvolvimento.')
  const requestedSandbox = process.env.GACHA_DEV_AI_SANDBOX
  if (!requestedSandbox || !resolve(requestedSandbox)) throw new Error('Root sintético DEV AI ausente.')

  if (privateCopyTest) {
    const privateRoot = resolve(process.env.GACHA_DEV_AI_PRIVATE_ROOT ?? '')
    const allowedRoot = resolve(process.env.GACHA_DEV_AI_PRIVATE_ALLOWED_ROOT ?? '')
    const sandbox = resolve(requestedSandbox)
    const userData = join(privateRoot, 'userData')
    const markerPath = join(privateRoot, 'private-copy-marker.json')
    const relativePrivate = relative(allowedRoot, privateRoot)
    const relativeSandbox = relative(privateRoot, sandbox)
    const isWithin = (root: string, path: string): boolean => {
      const pathRelative = relative(root, path)
      return !!pathRelative && pathRelative !== '..' && !pathRelative.startsWith(`..${sep}`)
    }
    const sameCanonicalPath = (left: string, right: string): boolean => process.platform === 'win32'
      ? left.toLowerCase() === right.toLowerCase()
      : left === right
    if (!relativePrivate || !isWithin(allowedRoot, privateRoot) || relativeSandbox !== 'userData'
      || !sameCanonicalPath(sandbox, userData)) {
      throw new Error('Cópia privada DEV AI fora da raiz local autorizada.')
    }
    const marker = existsSync(markerPath) ? JSON.parse(readFileSync(markerPath, 'utf8')) as {
      schemaVersion?: number; privateDataCopy?: boolean; verifiedSha256?: boolean; sourceBackup?: string; copyMode?: string
    } : null
    const sourceBackup = marker?.sourceBackup ? resolve(marker.sourceBackup) : ''
    const backupManifest = sourceBackup ? join(sourceBackup, 'backup-manifest.json') : ''
    if (marker?.schemaVersion !== 1 || marker.privateDataCopy !== true || marker.verifiedSha256 !== true
      || !['baseline', 'wardrobe-reset'].includes(marker.copyMode ?? '')
      || !isWithin(allowedRoot, sourceBackup) || sourceBackup.toLowerCase() === privateRoot.toLowerCase()
      || !existsSync(backupManifest) || !existsSync(sandbox)) {
      throw new Error('Cópia privada DEV AI sem backup local validado.')
    }
    for (const path of [allowedRoot, privateRoot, markerPath, sourceBackup, backupManifest, sandbox]) {
      if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !sameCanonicalPath(realpathSync(path), path)) {
        throw new Error('Path não canônico ou symlink recusado no teste privado.')
      }
    }
    const sessionData = join(privateRoot, 'session-data')
    mkdirSync(sessionData, { recursive: true })
    if (lstatSync(sessionData).isSymbolicLink() || !sameCanonicalPath(realpathSync(sessionData), sessionData)) {
      throw new Error('Diretório de sessão privado inválido.')
    }
    app.setPath('userData', userData)
    app.setPath('sessionData', sessionData)
    return
  }

  const repoRoot = resolve(__dirname, '../..')
  const runsRoot = resolve(repoRoot, 'out', 'dev-ai', 'runs')
  const sandbox = resolve(requestedSandbox)
  const runRoot = dirname(sandbox)
  const relativeRun = relative(runsRoot, runRoot)
  if (!relativeRun || relativeRun === '..' || relativeRun.startsWith(`..${sep}`) || relativeRun.includes(sep)
    || basename(sandbox) !== 'sandbox' || !existsSync(sandbox)) {
    throw new Error('Root sintético DEV AI fora do diretório autorizado.')
  }

  const sameCanonicalPath = (left: string, right: string): boolean => process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
  for (const path of [resolve(repoRoot, 'out'), resolve(repoRoot, 'out', 'dev-ai'), runsRoot, runRoot, sandbox]) {
    if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !sameCanonicalPath(realpathSync(path), path)) {
      throw new Error('Root sintético DEV AI ausente, não canônico ou ligado por symlink.')
    }
  }
  const markerPath = join(runRoot, '.dev-ai-sandbox.json')
  if (!existsSync(markerPath) || lstatSync(markerPath).isSymbolicLink() || !sameCanonicalPath(realpathSync(markerPath), markerPath)) {
    throw new Error('Marcador do sandbox DEV AI ausente ou inválido.')
  }
  const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as { schemaVersion?: number; runId?: string; syntheticOnly?: boolean }
  if (marker.schemaVersion !== 1 || marker.runId !== basename(runRoot) || marker.syntheticOnly !== true) {
    throw new Error('Marcador do sandbox DEV AI não identifica uma execução sintética válida.')
  }

  const userData = join(sandbox, 'electron-user-data')
  const sessionData = join(sandbox, 'electron-session-data')
  mkdirSync(userData, { recursive: true })
  mkdirSync(sessionData, { recursive: true })
  app.setPath('userData', userData)
  app.setPath('sessionData', sessionData)
}

configureDevAiDataRoot()

function configureLocalAppDataRoot(): string | null {
  if (process.env.GACHA_DEV_AI_TEST === '1') return null

  const defaultRoot = app.isPackaged
    ? join(dirname(process.execPath), 'app-data')
    : join(app.getAppPath(), 'app-data')
  const dataRoot = resolve(defaultRoot)
  const legacyUserData = join(dataRoot, 'user-data')
  const profileRoot = join(dataRoot, 'runtime', 'profile')
  const sessionDataRoot = join(dataRoot, 'cache', 'electron-session')
  const paths = [dataRoot, join(dataRoot, 'runtime'), profileRoot, join(dataRoot, 'cache'), sessionDataRoot,
    join(dataRoot, 'logs'), join(dataRoot, 'crash-dumps'), join(dataRoot, 'temp')]
  for (const path of paths) {
    mkdirSync(path, { recursive: true })
    if (lstatSync(path).isSymbolicLink() || resolve(path) !== realpathSync(path)) {
      throw new Error(`Diretório local de dados não canônico: ${path}`)
    }
  }

  // Keep Chromium's persistent profile and session storage inside the portable
  // app-data root, separate from the app's domain data and from each other.
  migrateElectronProfile({ dataRoot, legacyRoot: legacyUserData, profileRoot, sessionRoot: sessionDataRoot })
  app.setPath('appData', dataRoot)
  app.setPath('userData', profileRoot)
  app.setPath('sessionData', sessionDataRoot)
  app.setPath('logs', join(dataRoot, 'logs'))
  app.setPath('crashDumps', join(dataRoot, 'crash-dumps'))
  app.setPath('temp', join(dataRoot, 'temp'))
  process.env.TEMP = join(dataRoot, 'temp')
  process.env.TMP = join(dataRoot, 'temp')
  process.env.TMPDIR = join(dataRoot, 'temp')
  return dataRoot
}

configuredAppDataRoot = configureLocalAppDataRoot()

// The catalog starts empty and does not scan or rewrite legacy libraries.
// Existing JSON/file stores remain authoritative until each domain is migrated.
const dataPlatform = new DataPlatform(configuredAppDataRoot ?? dirname(app.getPath('userData')))
const dataFileSystem = new DomainFileSystem(dataPlatform, app.getPath('userData'))
configureVideoLibraryStorage(dataFileSystem)
configureBackgroundLibraryStorage(dataFileSystem)
configureAssetImageStorage(dataFileSystem)
const mkdir = dataFileSystem.mkdir.bind(dataFileSystem) as typeof nativeMkdir
const readFile = dataFileSystem.readFile.bind(dataFileSystem) as typeof nativeReadFile
const writeFile = dataFileSystem.writeFile.bind(dataFileSystem) as typeof nativeWriteFile
const readdir = dataFileSystem.readdir.bind(dataFileSystem) as typeof nativeReaddir
const unlink = dataFileSystem.unlink.bind(dataFileSystem) as typeof nativeUnlink
const rename = dataFileSystem.rename.bind(dataFileSystem) as typeof nativeRename
const stat = dataFileSystem.stat.bind(dataFileSystem) as typeof nativeStat
const access = dataFileSystem.access.bind(dataFileSystem) as typeof nativeAccess
const rm = dataFileSystem.rm.bind(dataFileSystem) as typeof nativeRm
const copyFile = dataFileSystem.copyFile.bind(dataFileSystem) as typeof nativeCopyFile
let dataMigration: InstanceType<typeof DataMigrationService> | null = null
let dataBackupService: InstanceType<typeof DataBackupService> | null = null
let dataMigrationRunning = false
let dataMigrationPauseRequested = false
let dataMigrationTask: Promise<unknown> | null = null

protocol.registerSchemesAsPrivileged([
  { scheme: 'gacha-video', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'gacha-background', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
])

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
const faceExpressionPresetPath = (modelSlot: number, id: string) => join(app.getPath('userData'), 'fabricator', 'expression-presets', `model-${modelSlot}`, `preset-${id}.json`)
const faceExpressionCollectionsPath = (modelSlot: number) => join(app.getPath('userData'), 'fabricator', 'expression-presets', `model-${modelSlot}`, 'collections.json')
const faceExpressionWorkspaceDraftPath = (modelSlot: number) => join(app.getPath('userData'), 'fabricator', 'expression-presets', `model-${modelSlot}`, 'workspace-draft.json')
const faceComponentPath = (modelSlot: number) => join(app.getPath('userData'), 'fabricator', 'face-components', `model-${modelSlot}`)
const faceComponentItemPath = (modelSlot: number, id: string) => join(faceComponentPath(modelSlot), `item-${id}`)
const hairModelPath = (modelSlot: number) => join(app.getPath('userData'), 'fabricator', 'hair', `model-${modelSlot}`)
const hairStylePath = (modelSlot: number, id: string) => join(hairModelPath(modelSlot), 'styles', `style-${id}`)
const characterLibraryPath = () => join(app.getPath('userData'), 'customizer', 'characters')
type StudioWorkspaceStorage = 'studio' | 'video'
const studioLibraryPath = (workspace: StudioWorkspaceStorage = 'studio') => join(app.getPath('userData'), 'studios', workspace === 'video' ? 'Video Studio' : 'Studio Principal')
const studioPath = (id: string, workspace: StudioWorkspaceStorage = 'studio') => join(studioLibraryPath(workspace), `studio-${id}`)
const videoLibrary = new VideoLibraryStore(() => studioLibraryPath('video'))
const videoBackgroundLibrary = new VideoBackgroundLibraryStore(() => studioLibraryPath('video'))
const studioSaveQueues: Record<StudioWorkspaceStorage, Promise<void>> = { studio: Promise.resolve(), video: Promise.resolve() }
const characterManifestPath = () => join(characterLibraryPath(), 'characters.json')
const fabricatorSaveQueues = new Map<number, Promise<void>>()
let poseSaveQueue: Promise<void> = Promise.resolve()
const poseSaveWrites = new Set<Promise<void>>()
let poseMigration: Promise<void> | null = null
let animatorSaveQueue: Promise<void> = Promise.resolve()
let wardrobeSaveQueue: Promise<void> = Promise.resolve()
let faceSaveQueue: Promise<void> = Promise.resolve()
let expressionPresetSaveQueue: Promise<void> = Promise.resolve()
let faceGuideSaveQueue: Promise<void> = Promise.resolve()
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
const wardrobePaletteKeys: CustomizerWardrobePaletteKey[] = ['shirt', 'jacket', 'upper-left', 'upper-right', 'lower-left', 'lower-right', 'gloves-left', 'gloves-right', 'cape', 'belt', 'glasses', 'head-accessory', 'skirt', 'pants-left', 'shorts-right', 'sock-left', 'sock-right', 'shoe-left', 'shoe-right', 'lower-skirt']
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
    && ((character.customization as CustomizerCharacter['customization'] & { wardrobeColors?: HairColorOverrides }).wardrobeColors === undefined || isHairColorMap((character.customization as CustomizerCharacter['customization'] & { wardrobeColors?: HairColorOverrides }).wardrobeColors))
    && (character.customization.wardrobePalettes === undefined || (
      !!character.customization.wardrobePalettes && typeof character.customization.wardrobePalettes === 'object' && !Array.isArray(character.customization.wardrobePalettes)
      && Object.entries(character.customization.wardrobePalettes).every(([key, colors]) => wardrobePaletteKeys.includes(key as CustomizerWardrobePaletteKey) && isHairColorMap(colors))
    ))
    && (character.customization.wardrobeGroups === undefined || (
      Array.isArray(character.customization.wardrobeGroups) && character.customization.wardrobeGroups.length <= 100
      && character.customization.wardrobeGroups.every((group) => group && isValidModelSlot(group.modelSlot)
        && isValidWardrobeId(group.setId)
        && ['camisa', 'jaqueta', 'manga-superior', 'manga-inferior', 'luvas', 'capa', 'cinto', 'oculos', 'acessorio-cabeca', 'saia', 'saia-superior', 'saia-inferior', 'cinto-saia-1', 'cinto-saia-2', 'calca', 'shorts', 'meia', 'sapato'].includes(group.category)
        && [group.offsetX, group.offsetY, group.scaleX, group.scaleY, group.rotation].every(Number.isFinite)
        && group.scaleX > 0 && group.scaleY > 0
        && (group.adjustmentReference === undefined || typeof group.componentId === 'string'
          && validWardrobeAdjustmentReference(group.adjustmentReference)))
    ))
    && (character.customization.faceAppearance === undefined || isValidCustomizerFaceAppearance(character.customization.faceAppearance))
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
  const target = characterManifestPath()
  try { await access(target) } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
    try { await rename(`${target}.backup`, target) } catch (restoreReason) {
      if ((restoreReason as NodeJS.ErrnoException).code !== 'ENOENT') throw restoreReason
    }
  }
  try {
    const parsed = JSON.parse(await readFile(target, 'utf8')) as unknown
    if (!Array.isArray(parsed) || !parsed.every(isCustomizerCharacter)) throw new Error('A biblioteca de personagens está inválida.')
    return parsed.map((character) => {
      const storedCustomization = character.customization as CustomizerCharacter['customization'] & { wardrobeColors?: HairColorOverrides }
      const { wardrobeColors: legacyWardrobeColors, ...customization } = storedCustomization
      return {
        ...character,
        customization: {
          ...customization,
          wardrobeGroups: customization.wardrobeGroups?.map((group) => ({
            ...group,
            category: group.category === ('cinto-saia-1' as typeof group.category) ? 'cinto' : group.category === ('cinto-saia-2' as typeof group.category) ? 'saia-superior' : group.category === 'saia' ? 'saia-superior' : group.category,
            ...(legacyWardrobeColors && !group.colors ? { colors: legacyWardrobeColors } : {})
          }))
        }
      }
    })
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
  const target = characterManifestPath()
  const temporary = `${target}.tmp`
  await writeFile(temporary, JSON.stringify(characters), 'utf8')
  await publishRecoverableManifest(target, temporary)
}

async function publishRecoverableManifest(target: string, temporary: string): Promise<void> {
  const backup = `${target}.backup`
  // Restore the last committed file if a previous process stopped between the
  // two renames. If the target exists, a leftover backup came from a commit
  // that reached its destination and is now safe to clean up.
  try { await access(target) } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
    try { await rename(backup, target) } catch (restoreReason) {
      if ((restoreReason as NodeJS.ErrnoException).code !== 'ENOENT') throw restoreReason
    }
  }
  try { await access(target); await unlink(backup).catch((reason) => {
    if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
  }) } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
  }
  let previousManifest = false
  try { await rename(target, backup); previousManifest = true } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
  }
  try { await rename(temporary, target) } catch (reason) {
    if (previousManifest) await rename(backup, target).catch(() => undefined)
    throw reason
  }
  if (previousManifest) await unlink(backup)
}

const wardrobeCategories: WardrobeCategory[] = ['camisa', 'jaqueta', 'manga-superior', 'manga-inferior', 'luvas', 'capa', 'cinto', 'oculos', 'acessorio-cabeca', 'saia', 'calca-coxa', 'calca-canela', 'shorts', 'meia', 'sapato']
const isValidWardrobeId = (id: string) => /^[a-zA-Z0-9_-]{1,80}$/.test(id)
const isValidFaceCatalogId = (id: string) => /^[a-zA-Z0-9_-]{1,120}$/.test(id)
const faceSheetKinds: FaceSheetKind[] = ['eyes', 'eyebrows', 'nose', 'mouth-closed', 'mouth-open']
const faceElementKinds: FaceElementKind[] = ['eye-left', 'eye-right', 'brow-left', 'brow-right', 'nose', 'mouth']
const faceComponentPartIds = ['eye-left', 'eye-right', 'pupil-left', 'pupil-right', 'brow-left', 'brow-right'] as const

function isValidCustomizerFaceAppearance(appearance: CustomizerFaceAppearance): boolean {
  const componentEntries = Object.entries(appearance.components ?? {})
  const faceDetailEntries = Object.entries(appearance.faceDetails ?? {})
  const headExtraEntries = Object.entries(appearance.headExtras ?? {})
  const headExtrasValid = appearance.headExtras === undefined || (
    !!appearance.headExtras && typeof appearance.headExtras === 'object'
    && !Array.isArray(appearance.headExtras) && headExtraEntries.length <= 2
    && headExtraEntries.every(([category, id]) => ['glasses', 'head-accessory'].includes(category)
      && (id === null || typeof id === 'string' && isValidWardrobeId(id)))
  )
  const componentParts = new Set<string>(faceComponentPartIds)
  const catalogIds = [appearance.eyeCatalogId, appearance.eyeLeftCatalogId, appearance.eyeRightCatalogId, appearance.eyebrowCatalogId, appearance.eyebrowLeftCatalogId, appearance.eyebrowRightCatalogId, appearance.noseCatalogId, appearance.mouthClosedCatalogId, appearance.mouthOpenCatalogId]
  const componentsValid = appearance.components === undefined || (!!appearance.components && typeof appearance.components === 'object' && !Array.isArray(appearance.components)
    && componentEntries.length <= faceComponentPartIds.length
    && componentEntries.every(([part, component]) => componentParts.has(part) && !!component && typeof component === 'object'
      && (component.assetId === null || isValidWardrobeId(component.assetId))
      && (component.transform === undefined || [component.transform.x, component.transform.y, component.transform.scaleX, component.transform.scaleY, component.transform.rotation].every(Number.isFinite)
        && component.transform.scaleX > 0 && component.transform.scaleX <= 20 && component.transform.scaleY > 0 && component.transform.scaleY <= 20
        && (component.transform.flipX === undefined || typeof component.transform.flipX === 'boolean'))
      && (component.colors === undefined || isHairColorMap(component.colors))))
  const transformsValid = appearance.transforms === undefined || (!!appearance.transforms && typeof appearance.transforms === 'object' && !Array.isArray(appearance.transforms)
    && Object.entries(appearance.transforms).every(([key, value]) => faceElementKinds.includes(key as FaceElementKind) && !!value
      && [value.x, value.y, value.scaleX, value.scaleY, value.rotation].every(Number.isFinite) && value.scaleX > 0 && value.scaleY > 0
      && (value.flipX === undefined || typeof value.flipX === 'boolean')))
  const faceDetailsValid = appearance.faceDetails === undefined || (!!appearance.faceDetails && typeof appearance.faceDetails === 'object' && !Array.isArray(appearance.faceDetails)
    && faceDetailEntries.length <= 4
    && faceDetailEntries.every(([kind, id]) => ['eye-highlight-left', 'eye-highlight-right', 'blush', 'facial-shadow'].includes(kind)
      && (id === null || typeof id === 'string' && isValidWardrobeId(id))))
  const linksValid = appearance.linkedSides === undefined || (!!appearance.linkedSides && typeof appearance.linkedSides === 'object' && !Array.isArray(appearance.linkedSides)
    && Object.entries(appearance.linkedSides).every(([kind, linked]) => ['eye', 'pupil', 'eyebrow'].includes(kind) && typeof linked === 'boolean'))
  const partColorsValid = appearance.partColors === undefined || (!!appearance.partColors && typeof appearance.partColors === 'object' && !Array.isArray(appearance.partColors)
    && Object.entries(appearance.partColors).every(([part, colors]) => ['eye-left', 'eye-right', 'brow-left', 'brow-right'].includes(part) && isHairColorMap(colors)))
  // Head-only accessories are valid independent selections. Previously a
  // glasses-only faceAppearance was rejected by character:save, even though
  // Customizer can render and select it. Do not silently lose the pre-fit.
  const hasSelection = Boolean(appearance.setId || catalogIds.some(Boolean)
    || componentEntries.some(([, component]) => component?.assetId)
    || faceDetailEntries.some(([, id]) => id)
    || headExtraEntries.some(([, id]) => Boolean(id))
    || appearance.mouthBlushEnabled !== undefined)

  return isValidModelSlot(appearance.modelSlot)
    && (appearance.setId === undefined || isValidWardrobeId(appearance.setId))
    && catalogIds.every((id) => id === undefined || id === null || isValidFaceCatalogId(id))
    && componentsValid && transformsValid && faceDetailsValid && headExtrasValid && linksValid && partColorsValid && hasSelection
    && [0, 1, 2].includes(appearance.eyeState)
    && typeof appearance.eyebrows === 'boolean'
    && Number.isInteger(appearance.noseIndex) && appearance.noseIndex >= 0 && appearance.noseIndex <= 5
    && Number.isInteger(appearance.expressionIndex) && appearance.expressionIndex >= 0 && appearance.expressionIndex <= 20
    && typeof appearance.mouthOpen === 'boolean'
    && (appearance.mouthBlushEnabled === undefined || typeof appearance.mouthBlushEnabled === 'boolean')
    && (appearance.mouthBlushColor === undefined || /^#[0-9a-f]{6}$/i.test(appearance.mouthBlushColor))
    && (appearance.mouthBlushOpacity === undefined || Number.isFinite(appearance.mouthBlushOpacity) && appearance.mouthBlushOpacity >= 0 && appearance.mouthBlushOpacity <= 1)
}

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

function validFaceExpressionPreset(modelSlot: number, preset: FaceExpressionPreset): boolean {
  const validTransform = (transform: unknown) => {
    if (!transform || typeof transform !== 'object') return false
    const candidate = transform as FaceTransform
    return [candidate.x, candidate.y, candidate.scaleX, candidate.scaleY, candidate.rotation].every(Number.isFinite)
      && candidate.scaleX > 0 && candidate.scaleX <= 20 && candidate.scaleY > 0 && candidate.scaleY <= 20
      && (candidate.flipX === undefined || typeof candidate.flipX === 'boolean')
  }
  const selections = preset?.selections
  const validSideSelections = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const candidate = value as Record<string, unknown>
    return ['left', 'right'].every((side) => candidate[side] === null || typeof candidate[side] === 'string' && isValidWardrobeId(candidate[side] as string))
  }
  const validCatalogSelection = (value: unknown, kinds: string[]) => {
    if (value === null) return true
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const candidate = value as Record<string, unknown>
    return typeof candidate.catalogId === 'string' && isValidFaceCatalogId(candidate.catalogId)
      && Number.isInteger(candidate.index) && (candidate.index as number) >= 0 && (candidate.index as number) <= 20
      && (candidate.kind === undefined || kinds.includes(String(candidate.kind)))
  }
  return isValidModelSlot(modelSlot) && !!preset && preset.schemaVersion === 1 && preset.modelSlot === modelSlot
    && isValidWardrobeId(preset.id) && typeof preset.name === 'string' && Boolean(preset.name.trim()) && preset.name.length <= 80
    && ((preset.collectionId === undefined && preset.expressionIndex === undefined)
      || (typeof preset.collectionId === 'string' && isValidWardrobeId(preset.collectionId)
        && Number.isInteger(preset.expressionIndex) && (preset.expressionIndex as number) >= 0 && (preset.expressionIndex as number) <= 999))
    && typeof preset.updatedAt === 'string' && Number.isFinite(Date.parse(preset.updatedAt))
    && !!selections && validSideSelections(selections.eyes) && validSideSelections(selections.pupils)
    && (selections.eyebrows === undefined || validSideSelections(selections.eyebrows))
    && validCatalogSelection(selections.nose, ['nose'])
    && validCatalogSelection(selections.mouth, ['mouth-closed', 'mouth-open'])
    && !!preset.transforms && (['eyeLeft', 'eyeRight', 'pupilLeft', 'pupilRight', 'nose', 'mouth'] as Array<keyof FaceExpressionTransforms>).every((key) => validTransform(preset.transforms[key]))
    && (preset.transforms.browLeft === undefined || validTransform(preset.transforms.browLeft))
    && (preset.transforms.browRight === undefined || validTransform(preset.transforms.browRight))
    && (preset.referenceTransforms === undefined || Object.values(preset.referenceTransforms).every(validTransform))
    && Number.isFinite(preset.noseOpacity) && preset.noseOpacity >= 0 && preset.noseOpacity <= 1
    && (preset.effects === undefined || isStudioExpressionEffects(preset.effects))
}

function validFaceExpressionWorkspaceDraft(modelSlot: number, draft: FaceExpressionWorkspaceDraft): boolean {
  if (!isValidModelSlot(modelSlot) || !draft || draft.schemaVersion !== 1 || draft.modelSlot !== modelSlot
    || !(draft.selectedCollectionId === 'standard' || isValidWardrobeId(draft.selectedCollectionId))
    || !Number.isInteger(draft.selectedExpressionIndex) || draft.selectedExpressionIndex < 0 || draft.selectedExpressionIndex > 999
    || typeof draft.updatedAt !== 'string' || !Number.isFinite(Date.parse(draft.updatedAt))) return false
  const validEntry = (entry: FaceExpressionWorkspaceDraft['current'], collectionId: string, expressionIndex: number): boolean => {
    if (!entry || typeof entry !== 'object') return false
    return validFaceExpressionPreset(modelSlot, {
      schemaVersion: 1, id: entry.id, modelSlot, name: 'Rascunho', collectionId,
      expressionIndex, selections: entry.selections, transforms: entry.transforms,
      noseOpacity: entry.noseOpacity, effects: entry.effects, updatedAt: draft.updatedAt
    })
  }
  if (!validEntry(draft.current, draft.selectedCollectionId, draft.selectedExpressionIndex) || !draft.workingCopies || typeof draft.workingCopies !== 'object' || Array.isArray(draft.workingCopies)
    || Object.keys(draft.workingCopies).length > 1000 || !draft.customExpressionNames || typeof draft.customExpressionNames !== 'object'
    || Array.isArray(draft.customExpressionNames) || Object.keys(draft.customExpressionNames).length > 1000) return false
  for (const [key, entry] of Object.entries(draft.workingCopies)) {
    const separator = key.lastIndexOf(':')
    const collectionId = key.slice(0, separator)
    const index = Number(key.slice(separator + 1))
    if (separator < 1 || !(collectionId === 'standard' || isValidWardrobeId(collectionId)) || !Number.isInteger(index) || index < 0 || index > 999) return false
    if (!validEntry(entry, collectionId, index)) return false
  }
  for (const [key, name] of Object.entries(draft.customExpressionNames)) {
    if (!/^.{1,80}:\d{1,3}$/.test(key) || typeof name !== 'string' || !name.trim() || name.length > 80) return false
  }
  return true
}

async function readFaceExpressionWorkspaceDraft(modelSlot: number): Promise<FaceExpressionWorkspaceDraft | null> {
  if (!isValidModelSlot(modelSlot)) throw new Error('Modelo inválido.')
  try {
    const draft = JSON.parse(await readFile(faceExpressionWorkspaceDraftPath(modelSlot), 'utf8')) as FaceExpressionWorkspaceDraft
    return validFaceExpressionWorkspaceDraft(modelSlot, draft) ? draft : null
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT' || reason instanceof SyntaxError) return null
    throw reason
  }
}

async function writeFaceExpressionWorkspaceDraft(modelSlot: number, draft: FaceExpressionWorkspaceDraft): Promise<void> {
  if (!validFaceExpressionWorkspaceDraft(modelSlot, draft)) throw new Error('Rascunho de expressão inválido.')
  const target = faceExpressionWorkspaceDraftPath(modelSlot)
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.tmp`
  await writeFile(temporary, JSON.stringify(draft), 'utf8')
  await rename(temporary, target)
}

async function listFaceExpressionPresets(modelSlot: number): Promise<FaceExpressionPresetSummary[]> {
  if (!isValidModelSlot(modelSlot)) throw new Error('Modelo inválido.')
  const folder = join(app.getPath('userData'), 'fabricator', 'expression-presets', `model-${modelSlot}`)
  try {
    const entries = await readdir(folder, { withFileTypes: true })
    const presets: FaceExpressionPresetSummary[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !/^preset-[a-zA-Z0-9_-]{1,80}\.json$/.test(entry.name)) continue
      try {
        const preset = JSON.parse(await readFile(join(folder, entry.name), 'utf8')) as FaceExpressionPreset
        if (validFaceExpressionPreset(modelSlot, preset) && entry.name === `preset-${preset.id}.json`) {
          presets.push({ id: preset.id, modelSlot, name: preset.name, updatedAt: preset.updatedAt, collectionId: preset.collectionId, expressionIndex: preset.expressionIndex })
        }
      } catch { /* Arquivos incompletos não aparecem na biblioteca. */ }
    }
    return presets.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw reason
  }
}

function isValidFaceExpressionCollection(modelSlot: number, collection: FaceExpressionCollection): boolean {
  return isValidModelSlot(modelSlot) && !!collection && collection.schemaVersion === 1 && collection.modelSlot === modelSlot
    && isValidWardrobeId(collection.id) && typeof collection.name === 'string' && Boolean(collection.name.trim()) && collection.name.length <= 80
    && typeof collection.createdAt === 'string' && Number.isFinite(Date.parse(collection.createdAt))
    && typeof collection.updatedAt === 'string' && Number.isFinite(Date.parse(collection.updatedAt))
}

async function listFaceExpressionCollections(modelSlot: number): Promise<FaceExpressionCollection[]> {
  if (!isValidModelSlot(modelSlot)) throw new Error('Modelo inválido.')
  try {
    const collections = JSON.parse(await readFile(faceExpressionCollectionsPath(modelSlot), 'utf8')) as unknown
    if (!Array.isArray(collections)) return []
    return collections.filter((item): item is FaceExpressionCollection => isValidFaceExpressionCollection(modelSlot, item))
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw reason
  }
}

async function writeFaceExpressionCollection(modelSlot: number, collection: FaceExpressionCollection): Promise<void> {
  if (!isValidFaceExpressionCollection(modelSlot, collection)) throw new Error('Conjunto de expressões inválido.')
  const filePath = faceExpressionCollectionsPath(modelSlot)
  const existing = await listFaceExpressionCollections(modelSlot)
  const next = [...existing.filter((item) => item.id !== collection.id), collection]
  await mkdir(dirname(filePath), { recursive: true })
  const temporary = `${filePath}.tmp`
  await writeFile(temporary, JSON.stringify(next), 'utf8')
  await rename(temporary, filePath)
}

async function readFaceExpressionPreset(modelSlot: number, id: string): Promise<FaceExpressionPreset | null> {
  if (!isValidModelSlot(modelSlot) || !isValidWardrobeId(id)) throw new Error('Preset de expressão inválido.')
  try {
    const preset = JSON.parse(await readFile(faceExpressionPresetPath(modelSlot, id), 'utf8')) as FaceExpressionPreset
    if (!validFaceExpressionPreset(modelSlot, preset) || preset.id !== id) return null
    return {
      ...preset,
      effects: preset.effects ?? legacyStandardExpressionEffects(preset),
      selections: { ...preset.selections, eyebrows: preset.selections.eyebrows ?? { left: null, right: null } },
      transforms: { ...preset.transforms, browLeft: preset.transforms.browLeft ?? { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }, browRight: preset.transforms.browRight ?? { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } }
    }
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw reason
  }
}

async function writeFaceExpressionPreset(modelSlot: number, preset: FaceExpressionPreset): Promise<void> {
  if (!validFaceExpressionPreset(modelSlot, preset)) throw new Error('Preset de expressão inválido.')
  const target = faceExpressionPresetPath(modelSlot, preset.id)
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.tmp`
  await writeFile(temporary, JSON.stringify(preset), 'utf8')
  await rename(temporary, target)
}

async function writeFaceSet(modelSlot: number, set: FaceSetSave, assets: FaceAssetSave[]): Promise<void> {
  if (!validFaceSet(modelSlot, set)) throw new Error('Rosto inválido.')
  const folder = faceSetPath(modelSlot, set.id)
  const partsFolder = join(folder, 'images')
  await mkdir(partsFolder, { recursive: true })
  const expected = new Set([...set.pieces.map((piece) => piece.id), ...Object.keys(set.sheets).map((kind) => `sheet-${kind}`)])
  if (assets.some((asset) => !expected.has(asset.id)) || new Set(assets.map((asset) => asset.id)).size !== assets.length) throw new Error('Imagens do rosto inválidas.')
  for (const asset of assets) await writeAssetImageSource(join(partsFolder, `${asset.id}.png`), dataUrlBuffer(asset.dataUrl))
  for (const id of expected) await access(join(partsFolder, `${id}.png`))
  const temporary = join(folder, 'face.json.tmp')
  await writeFile(temporary, JSON.stringify(set), 'utf8')
  await rename(temporary, join(folder, 'face.json'))
  for (const filename of await readdir(partsFolder)) if (filename.endsWith('.png') && !filename.endsWith('.paint.png') && !expected.has(filename.slice(0, -4))) await unlink(join(partsFolder, filename))
}

async function readFaceSet(modelSlot: number, id: string): Promise<FaceSet | null> {
  if (!isValidModelSlot(modelSlot) || !isValidWardrobeId(id)) throw new Error('Rosto inválido.')
  try {
    const folder = faceSetPath(modelSlot, id)
    const set = JSON.parse(await readFile(join(folder, 'face.json'), 'utf8')) as FaceSetSave
    if (!validFaceSet(modelSlot, set) || set.id !== id) return null
    const sheets = { ...set.sheets } as FaceSet['sheets']
    for (const kind of faceSheetKinds) if (sheets[kind]) sheets[kind] = { ...sheets[kind], dataUrl: `data:image/png;base64,${(await readAssetImage(join(folder, 'images', `sheet-${kind}.png`))).toString('base64')}` }
    const pieces = await Promise.all(set.pieces.map(async (piece) => ({ ...piece, dataUrl: `data:image/png;base64,${(await readAssetImage(join(folder, 'images', `${piece.id}.png`))).toString('base64')}` })))
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
    && (item.opacity === undefined || item.category === 'nose' && Number.isFinite(item.opacity) && item.opacity >= 0 && item.opacity <= 1)
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
  for (const asset of assets) await writeAssetImageSource(join(images, `${asset.id}.png`), dataUrlBuffer(asset.dataUrl))
  for (const id of expected) await access(join(images, `${id}.png`))
  await writeFile(join(folder, 'item.json.tmp'), JSON.stringify(item), 'utf8')
  await rename(join(folder, 'item.json.tmp'), join(folder, 'item.json'))
  for (const filename of await readdir(images)) if (filename.endsWith('.png') && !filename.endsWith('.paint.png') && !expected.has(filename.slice(0, -4))) await unlink(join(images, filename))
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
    const sheet = { ...item.sheet, dataUrl: `data:image/png;base64,${(await readAssetImage(join(folder, 'images', `sheet-${item.category}.png`))).toString('base64')}` }
    const pieces = await Promise.all(item.pieces.map(async (piece) => ({ ...piece, dataUrl: `data:image/png;base64,${(await readAssetImage(join(folder, 'images', `${piece.id}.png`))).toString('base64')}` })))
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
    && isValidWardrobeId(asset.id) && ['eye', 'pupil', 'eye-closed', 'eyebrow', 'eye-highlight-left', 'eye-highlight-right', 'blush', 'facial-shadow', 'head-extra'].includes(asset.kind)
    && typeof asset.name === 'string' && asset.name.trim().length > 0 && asset.name.length <= 120
    && Number.isFinite(asset.width) && Number.isFinite(asset.height) && asset.width > 0 && asset.height > 0 && asset.width * asset.height <= 32_000_000
    && (asset.rightSidePositioned === undefined || typeof asset.rightSidePositioned === 'boolean')
    && (asset.pairId === undefined || isValidWardrobeId(asset.pairId))
    && Boolean(transform) && [transform.x, transform.y, transform.scaleX, transform.scaleY, transform.rotation].every(Number.isFinite)
    && (transform.flipX === undefined || typeof transform.flipX === 'boolean')
    && transform.scaleX > 0 && transform.scaleY > 0 && transform.scaleX <= 20 && transform.scaleY <= 20
    && typeof asset.updatedAt === 'string'
}

function validFaceGuideProfile(profile: unknown): profile is 'eyes' | 'face' { return profile === 'eyes' || profile === 'face' }
function validFaceGuides(value: unknown): value is Record<number, { visible: boolean; verticalX: number; horizontalY: number; lowerHorizontalY: number; angle: number }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(value).every(([slot, guide]) => {
    if (!/^([1-9]|10)$/.test(slot) || !guide || typeof guide !== 'object') return false
    const item = guide as Record<string, unknown>
    return typeof item.visible === 'boolean' && typeof item.verticalX === 'number' && Number.isFinite(item.verticalX) && item.verticalX >= 20 && item.verticalX <= 80
      && typeof item.horizontalY === 'number' && Number.isFinite(item.horizontalY) && item.horizontalY >= 10 && item.horizontalY <= 90
      && typeof item.lowerHorizontalY === 'number' && Number.isFinite(item.lowerHorizontalY) && item.lowerHorizontalY > item.horizontalY && item.lowerHorizontalY <= 99
      && typeof item.angle === 'number' && Number.isFinite(item.angle) && item.angle >= -30 && item.angle <= 30
  })
}
const faceGuidePath = (profile: 'eyes' | 'face') => join(app.getPath('userData'), 'fabricator', `guides-${profile}.json`)
async function readFaceGuides(profile: 'eyes' | 'face') {
  try {
    const guides = JSON.parse(await readFile(faceGuidePath(profile), 'utf8')) as unknown
    if (!validFaceGuides(guides)) return null
    if (profile !== 'face') return guides
    // Preserve existing eye-only model settings while unifying all guide editors.
    try {
      const eyeGuides = JSON.parse(await readFile(faceGuidePath('eyes'), 'utf8')) as unknown
      return validFaceGuides(eyeGuides) ? { ...eyeGuides, ...guides } : guides
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return guides
      throw reason
    }
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw reason
  }
}
async function writeFaceGuides(profile: 'eyes' | 'face', guides: unknown): Promise<void> {
  if (!validFaceGuideProfile(profile) || !validFaceGuides(guides)) throw new Error('Guias de desenho inválidas.')
  const target = faceGuidePath(profile)
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.tmp`
  await writeFile(temporary, JSON.stringify(guides), 'utf8')
  await rename(temporary, target)
}

async function listFaceComponentAssets(modelSlot: number, kind?: FaceAssetKind): Promise<FaceComponentAssetSummary[]> {
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
    const dataUrl = `data:image/png;base64,${(await readAssetImage(join(folder, 'asset.png'))).toString('base64')}`
    return { ...asset, dataUrl }
  } catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return null; throw reason }
}

async function writeFaceComponentAsset(modelSlot: number, asset: FaceComponentAssetSave, dataUrl: string): Promise<void> {
  if (!validFaceComponentAsset(modelSlot, asset) || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) throw new Error('Asset facial inválido; use uma imagem PNG.')
  const folder = faceComponentItemPath(modelSlot, asset.id)
  await mkdir(folder, { recursive: true })
  await writeAssetImageSource(join(folder, 'asset.png'), dataUrlBuffer(dataUrl))
  await writeFile(join(folder, 'asset.json.tmp'), JSON.stringify(asset), 'utf8')
  await rename(join(folder, 'asset.json.tmp'), join(folder, 'asset.json'))
}

function validHairWorkspace(modelSlot: number, workspace: HairWorkspaceSave): boolean {
  if (!isValidModelSlot(modelSlot) || workspace?.schemaVersion !== 1 || workspace.modelSlot !== modelSlot || !workspace.transforms) return false
  for (const side of ['front', 'back', 'fringe'] as const) {
    const category = workspace.categoryBySide?.[side]
    if (category !== undefined && !hairCategories.some((item) => item.id === category && item.side === side)) return false
  }
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
  if (workspace.sourceAppliesToDraft !== undefined && typeof workspace.sourceAppliesToDraft !== 'boolean') return false
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
  for (const asset of assets) await writeAssetImageSource(join(images, `${asset.id}.png`), dataUrlBuffer(asset.dataUrl))
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
      ? { ...saved[side]!, dataUrl: `data:image/png;base64,${(await readAssetImage(join(folder, 'images', `${side}.png`))).toString('base64')}` }
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
  if (style.category !== undefined) {
    const category = hairCategories.find((item) => item.id === style.category)
    if (!category || !style[category.side]) return false
  }
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
  for (const asset of assets) await writeAssetImageSource(join(images, `${asset.id}.png`), dataUrlBuffer(asset.dataUrl))
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
      ? { ...saved[side]!, dataUrl: `data:image/png;base64,${(await readAssetImage(join(folder, 'images', `${side}.png`))).toString('base64')}` }
      : null
    return { ...saved, front: await loadPart('front'), back: await loadPart('back'), fringe: await loadPart('fringe') }
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw reason
  }
}

async function recoverWardrobeManifest(folder: string): Promise<void> {
  const target = join(folder, 'wardrobe.json')
  const backup = join(folder, 'wardrobe.json.backup')
  try { await access(target); return } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
  }
  try { await rename(backup, target) } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
  }
}

async function writeWardrobeSet(modelSlot: number, set: WardrobeSetSave, assets: WardrobeAssetSave[]): Promise<void> {
  if (!isValidModelSlot(modelSlot) || set.schemaVersion !== 1 || (set.edition !== undefined && set.edition !== 1 && set.edition !== 2) || set.modelSlot !== modelSlot || !isValidWardrobeId(set.id) || !Array.isArray(set.components) || set.components.length < 1 || set.components.length > 100) throw new Error('Conjunto de roupa inválido.')
  const folder = wardrobeSetPath(modelSlot, set.id)
  const partsFolder = join(folder, 'parts')
  await mkdir(partsFolder, { recursive: true })
  const ids = new Set(set.components.map((component) => component.id))
  if (ids.size !== set.components.length || set.components.some((component) => !isValidWardrobeId(component.id) || !wardrobeCategories.includes(component.category) || !isValidWardrobeId(component.attachedPartId))) throw new Error('Peças do conjunto inválidas.')
  for (const asset of assets) if (ids.has(asset.id)) await writeAssetImageSource(join(partsFolder, `${asset.id}.png`), dataUrlBuffer(asset.dataUrl))
  for (const component of set.components) {
    try { await access(join(partsFolder, `${component.id}.png`)) } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
      throw new Error(`Imagem ausente no conjunto: ${component.name} (${component.id}).`)
    }
  }
  const target = join(folder, 'wardrobe.json')
  const backup = join(folder, 'wardrobe.json.backup')
  await recoverWardrobeManifest(folder)
  // On Windows, rename(newFile, existingFile) fails with EPERM. Keep the last
  // valid manifest under a recoverable name while publishing the replacement.
  // A stale backup with a present target means the new manifest was already
  // published before a previous process stopped during cleanup.
  try { await access(target); await unlink(backup).catch((reason) => {
    if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
  }) } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
  }
  const temporary = join(folder, 'wardrobe.json.tmp')
  await writeFile(temporary, JSON.stringify(set), 'utf8')
  let previousManifest = false
  try { await rename(target, backup); previousManifest = true } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
  }
  try { await rename(temporary, target) } catch (reason) {
    if (previousManifest) await rename(backup, target).catch(() => undefined)
    throw reason
  }
  if (previousManifest) await unlink(backup)
  const retained = new Set(set.components.map((component) => `${component.id}.png`))
  for (const filename of await readdir(partsFolder)) if (filename.endsWith('.png') && !filename.endsWith('.paint.png') && !retained.has(filename)) await unlink(join(partsFolder, filename))
}

async function readWardrobeSet(modelSlot: number, id: string): Promise<WardrobeSet | null> {
  if (!isValidModelSlot(modelSlot) || !isValidWardrobeId(id)) throw new Error('Conjunto de roupa inválido.')
  try {
    await wardrobeSaveQueue.catch(() => undefined)
    const folder = wardrobeSetPath(modelSlot, id)
    await recoverWardrobeManifest(folder)
    const set = JSON.parse(await readFile(join(folder, 'wardrobe.json'), 'utf8')) as WardrobeSetSave
    if (set.schemaVersion !== 1 || (set.edition !== undefined && set.edition !== 1 && set.edition !== 2) || set.modelSlot !== modelSlot || set.id !== id || !Array.isArray(set.components) || set.components.length > 100) return null
    const components = await Promise.all(set.components.map(async (component) => ({
      ...component,
      category: (component.category as string) === 'cinto-saia-1' ? 'cinto' as const : (component.category as string) === 'cinto-saia-2' ? 'saia' as const : component.category,
      renderAboveHair: (component.category === 'oculos' || component.category === 'acessorio-cabeca') && component.renderAboveHair === true,
      dataUrl: `data:image/png;base64,${(await readAssetImage(join(folder, 'parts', `${component.id}.png`))).toString('base64')}`
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
    && (studio.thumbnailDataUrl === undefined || typeof studio.thumbnailDataUrl === 'string' && /^data:image\/(jpeg|png);base64,/.test(studio.thumbnailDataUrl) && studio.thumbnailDataUrl.length <= 1_500_000)
    && [studio.backgroundX, studio.backgroundY, studio.backgroundWidth, studio.backgroundHeight, studio.backgroundRotation].every(Number.isFinite)
    && Array.isArray(assets) && assets.length <= 500
    && assets.every((asset) => isStudioAsset(asset))
    && Array.isArray(elements) && elements.length <= 1000
    && (studio.videoTimeline === undefined || isVideoTimelineDocument(studio.videoTimeline, elements))
    && (studio.backgroundAssetId === null || assets.some((asset) => asset.id === studio.backgroundAssetId && asset.category === 'background'))
    && elements.every((element) => Boolean(element && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(element.id) && typeof element.text === 'string'
      && ['image', 'character', 'narrator', 'speech', 'thought'].includes(element.kind)
      && (element.timelineColor === undefined || typeof element.timelineColor === 'string' && /^#[0-9a-f]{6}$/i.test(element.timelineColor))
      && isStudioFaceTransforms(element.faceTransforms)
      && (element.expressionBase === undefined || Boolean(element.expressionBase && element.expressionBase.appearance && isValidCustomizerFaceAppearance(element.expressionBase.appearance)
        && element.expressionBase.transforms && isStudioFaceTransforms(element.expressionBase.transforms)))
      && (element.activeExpressionPresetId === undefined || element.activeExpressionPresetId === null || typeof element.activeExpressionPresetId === 'string' && isValidWardrobeId(element.activeExpressionPresetId))
      && isStudioExpressionEffects(element.activeExpressionEffects)
      && (element.activeExpressionCollectionId === undefined || typeof element.activeExpressionCollectionId === 'string' && isValidWardrobeId(element.activeExpressionCollectionId))
      && (element.characterSourceUpdatedAt === undefined || (typeof element.characterSourceUpdatedAt === 'string' && Number.isFinite(Date.parse(element.characterSourceUpdatedAt))))
      && (element.kind !== 'image' || assets.some((asset) => asset.id === element.assetId && asset.category === 'object'))
      && (element.kind !== 'character' || (typeof element.characterId === 'string' && assets.some((asset) => asset.id === element.assetId && asset.category === 'character')))
      && [element.x, element.y, element.width, element.height, element.rotation, element.zIndex].every(Number.isFinite)))
}

function isVideoTimelineDocument(value: unknown, elements: StudioDocument['elements']): value is VideoTimelineDocument {
  if (!value || typeof value !== 'object') return false
  const timeline = value as Partial<VideoTimelineDocument>
  const characterIds = new Set(elements.filter((element) => element?.kind === 'character').map((element) => element.id))
  const textIds = new Set(elements.filter((element) => element?.kind === 'speech' || element?.kind === 'thought').map((element) => element.id))
  const validState = (state: VideoTimelineDocument['characterKeys'][number]['state'], id: string) => Boolean(state
    && state.element?.kind === 'character' && state.element.id === id
    && typeof state.element.characterId === 'string' && typeof state.element.assetId === 'string'
    && [state.element.x, state.element.y, state.element.width, state.element.height, state.element.rotation, state.element.zIndex].every(Number.isFinite)
    && isStudioFaceTransforms(state.element.faceTransforms) && isStudioExpressionEffects(state.element.activeExpressionEffects)
    && typeof state.imageDataUrl === 'string' && state.imageDataUrl.startsWith('data:image/png;base64,') && state.imageDataUrl.length <= 70_000_000)
  return timeline.schemaVersion === 1 && timeline.frameRate === 60
    && typeof timeline.playing === 'boolean'
    && (timeline.coverDataUrl === undefined || typeof timeline.coverDataUrl === 'string' && /^data:image\/(jpeg|png);base64,/.test(timeline.coverDataUrl) && timeline.coverDataUrl.length <= 1_500_000)
    && isValidVideoAudioSettings(timeline.videoAudio)
    && (timeline.trackSettings === undefined || Object.keys(timeline.trackSettings).length <= 1002 && Object.entries(timeline.trackSettings).every(([id, settings]) => (characterIds.has(id) || id === 'speech' || id === 'thought' || id === 'video') && settings && (settings.visible === undefined || typeof settings.visible === 'boolean') && (settings.locked === undefined || typeof settings.locked === 'boolean') && (settings.collapsed === undefined || typeof settings.collapsed === 'boolean') && (settings.order === undefined || Number.isInteger(settings.order) && settings.order >= 0 && settings.order <= 1002) && (settings.label === undefined || typeof settings.label === 'string' && settings.label.length <= 80)))
    && Number.isInteger(timeline.durationFrames) && timeline.durationFrames! >= 60 && timeline.durationFrames! <= 60 * 60 * 60 * 24
    && Number.isInteger(timeline.playheadFrame) && timeline.playheadFrame! >= 0 && timeline.playheadFrame! <= timeline.durationFrames!
    && Array.isArray(timeline.characterKeys) && timeline.characterKeys.length <= 100_000
    && (timeline.characterBases === undefined || Object.entries(timeline.characterBases).every(([id, state]) => characterIds.has(id) && validState(state, id)))
    && (timeline.characterPositions === undefined || Object.entries(timeline.characterPositions).every(([id, position]) => characterIds.has(id) && position && Number.isFinite(position.x) && Number.isFinite(position.y)))
    && (timeline.characterTransforms === undefined || Object.entries(timeline.characterTransforms).every(([id, transform]) => characterIds.has(id) && transform && [transform.x, transform.y, transform.rotation, transform.zIndex].every(Number.isFinite) && (transform.flipX === undefined || typeof transform.flipX === 'boolean') && [transform.characterScale, transform.characterWidthScale, transform.characterHeightScale].every((value) => value === undefined || Number.isFinite(value))))
    && timeline.characterKeys.every((key) => Boolean(key && typeof key.id === 'string' && characterIds.has(key.elementId) && Number.isInteger(key.frame) && key.frame >= 0 && key.frame <= timeline.durationFrames! && (key.poseSlot === null || Number.isInteger(key.poseSlot)) && (key.expressionCollectionId === null || typeof key.expressionCollectionId === 'string') && (key.expressionPresetId === null || typeof key.expressionPresetId === 'string') && ['idle', 'blink', 'talk'].includes(key.faceMode) && (key.state === undefined || validState(key.state, key.elementId))))
    && Array.isArray(timeline.textClips) && timeline.textClips.length <= 100_000
    && timeline.textClips.every((clip) => Boolean(clip && typeof clip.id === 'string' && textIds.has(clip.elementId) && (clip.kind === 'speech' || clip.kind === 'thought') && Number.isInteger(clip.startFrame) && Number.isInteger(clip.endFrame) && clip.startFrame >= 0 && clip.endFrame > clip.startFrame && clip.endFrame <= timeline.durationFrames! && (clip.state === undefined || clip.state.id === clip.elementId && clip.state.kind === clip.kind && typeof clip.state.text === 'string' && [clip.state.x, clip.state.y, clip.state.width, clip.state.height, clip.state.rotation, clip.state.zIndex].every(Number.isFinite))))
    && (timeline.videoAssets === undefined || Array.isArray(timeline.videoAssets) && timeline.videoAssets.length <= 1000 && timeline.videoAssets.every((asset) => Boolean(asset && typeof asset.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(asset.id) && typeof asset.name === 'string' && asset.name.length <= 255 && (asset.extension === 'mp4' && asset.mimeType === 'video/mp4' || asset.extension === 'webm' && asset.mimeType === 'video/webm' || asset.extension === 'mov' && asset.mimeType === 'video/quicktime' || asset.extension === 'm4v' && asset.mimeType === 'video/x-m4v') && Number.isInteger(asset.size) && asset.size > 0 && asset.size <= 5 * 1024 * 1024 * 1024 && Number.isInteger(asset.durationFrames) && asset.durationFrames > 0 && asset.durationFrames <= 60 * 60 * 60 * 24)))
    && (timeline.videoClips === undefined || Array.isArray(timeline.videoClips) && timeline.videoClips.length <= 100_000 && timeline.videoClips.every((clip) => {
      const asset = timeline.videoAssets?.find((item) => item.id === clip?.assetId)
      return Boolean(asset && isValidVideoMediaClip(clip, asset.durationFrames, timeline.durationFrames!))
    }))
    && Array.isArray(timeline.saveMarkers) && timeline.saveMarkers.length <= 100_000
    && timeline.saveMarkers.every((marker) => Boolean(marker && typeof marker.id === 'string' && Number.isInteger(marker.frame) && marker.frame >= 0 && marker.frame <= timeline.durationFrames! && Array.isArray(marker.affectedTrackIds) && marker.affectedTrackIds.every((id) => typeof id === 'string')))
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

function normalizeStudio(value: Record<string, unknown>, id: string, workspace: StudioWorkspaceStorage = 'studio'): StudioDocument {
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
    ...(typeof value.thumbnailDataUrl === 'string' && /^data:image\/(jpeg|png);base64,/.test(value.thumbnailDataUrl) && value.thumbnailDataUrl.length <= 1_500_000 ? { thumbnailDataUrl: value.thumbnailDataUrl } : {}),
    assets: Array.isArray(value.assets) ? value.assets as StudioAsset[] : [],
    elements: Array.isArray(value.elements) ? value.elements as StudioDocument['elements'] : [],
    ...(workspace === 'video' && value.videoTimeline && typeof value.videoTimeline === 'object' ? { videoTimeline: value.videoTimeline as VideoTimelineDocument } : {})
  }
}

async function readStudio(id: string, workspace: StudioWorkspaceStorage = 'studio'): Promise<StudioDocument | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Identificador de Studio inválido.')
  try {
    const raw = JSON.parse(await readFile(join(studioPath(id, workspace), 'studio.json'), 'utf8')) as Record<string, unknown>
    const normalized = normalizeStudio(raw, id, workspace)
    const folder = studioPath(id, workspace)
    const assets = await Promise.all(normalized.assets.map(async (asset) => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(asset.id)
        || !['background', 'object', 'character'].includes(asset.category)
        || !['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType)) throw new Error('Biblioteca de imagens do Studio inválida.')
      const extension = asset.mimeType === 'image/jpeg' ? 'jpg' : asset.mimeType.slice('image/'.length)
      const categoryFolder = asset.category === 'background' ? 'backgrounds' : asset.category === 'character' ? 'characters' : 'objects'
      const data = await readFile(join(folder, 'assets', categoryFolder, `${asset.id}.${extension}`))
      return { ...asset, dataUrl: `data:${asset.mimeType};base64,${data.toString('base64')}` }
    }))
    if (workspace === 'video' && normalized.videoTimeline) {
      const restoreImage = async (state: VideoTimelineDocument['characterKeys'][number]['state']) => {
        if (!state?.imageDataUrl.startsWith('@video-frame:')) return
        const hash = state.imageDataUrl.slice('@video-frame:'.length)
        if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Quadro de vídeo inválido.')
        const bytes = await readFile(join(folder, 'assets', 'video-frames', `${hash}.png`))
        if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Quadro de vídeo corrompido.')
        state.imageDataUrl = `data:image/png;base64,${bytes.toString('base64')}`
      }
      await Promise.all([
        ...Object.values(normalized.videoTimeline.characterBases ?? {}).map(restoreImage),
        ...normalized.videoTimeline.characterKeys.map((key) => restoreImage(key.state))
      ])
    }
    const document = { ...normalized, assets }
    if (!isStudioDocument(document)) throw new Error(`Os dados do Studio ${id} estão inválidos.`)
    return document
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw reason
  }
}

async function writeStudio(studio: StudioDocument, workspace: StudioWorkspaceStorage = 'studio'): Promise<void> {
  if (!isStudioDocument(studio)) throw new Error('Dados do Studio inválidos.')
  const folder = studioPath(studio.id, workspace)
  await Promise.all([
    mkdir(join(folder, 'assets', 'backgrounds'), { recursive: true }),
    mkdir(join(folder, 'assets', 'objects'), { recursive: true }),
    mkdir(join(folder, 'assets', 'characters'), { recursive: true }),
    mkdir(join(folder, 'prints'), { recursive: true })
  ])
  if (workspace === 'video' && studio.videoTimeline?.videoAssets?.length) await videoLibrary.ensureProjectAssets(studio.id, studio.videoTimeline.videoAssets)
  const assetManifest: Array<Omit<StudioAsset, 'dataUrl'>> = []
  for (const asset of studio.assets) {
    const sourceBytes = importedImageDataUrlBuffer(asset.dataUrl)
    const canonical = asset.mimeType === 'image/png'
      ? { bytes: sourceBytes }
      : await normalizeImageBuffer(sourceBytes)
    const extension = 'png'
    const bytes = canonical.bytes
    const categoryFolder = asset.category === 'background' ? 'backgrounds' : asset.category === 'character' ? 'characters' : 'objects'
    await writeFile(join(folder, 'assets', categoryFolder, `${asset.id}.${extension}`), bytes)
    const { dataUrl: _dataUrl, ...metadata } = asset
    assetManifest.push({ ...metadata, mimeType: 'image/png' })
  }
  const temporary = join(folder, `studio.json.${randomUUID()}.tmp`)
  const { assets: _assets, ...metadata } = studio
  const savedMetadata = { ...metadata, videoTimeline: studio.videoTimeline ? structuredClone(studio.videoTimeline) : undefined }
  if (workspace === 'video' && savedMetadata.videoTimeline) {
    const frameFolder = join(folder, 'assets', 'video-frames')
    await mkdir(frameFolder, { recursive: true })
    const storeImage = async (state: VideoTimelineDocument['characterKeys'][number]['state']) => {
      if (!state) return
      const bytes = Buffer.from(state.imageDataUrl.slice(state.imageDataUrl.indexOf(',') + 1), 'base64')
      const hash = createHash('sha256').update(bytes).digest('hex')
      const path = join(frameFolder, `${hash}.png`)
      try { await access(path) } catch { await writeFile(path, bytes) }
      state.imageDataUrl = `@video-frame:${hash}`
    }
    await Promise.all([
      ...Object.values(savedMetadata.videoTimeline.characterBases ?? {}).map(storeImage),
      ...savedMetadata.videoTimeline.characterKeys.map((key) => storeImage(key.state))
    ])
  }
  try {
    await writeFile(temporary, JSON.stringify({ ...savedMetadata, title: studio.title.trim(), assets: assetManifest }, null, 2), 'utf8')
    const target = join(folder, 'studio.json')
    const maxAttempts = process.platform === 'win32' ? 5 : 1
    for (let attempt = 1; ; attempt += 1) {
      try {
        await rename(temporary, target)
        break
      } catch (reason) {
        const error = reason as NodeJS.ErrnoException
        const retryable = process.platform === 'win32' && ['EPERM', 'EACCES', 'EBUSY'].includes(error.code ?? '')
        if (!retryable || attempt >= maxAttempts) throw reason
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 20 * (2 ** (attempt - 1))))
      }
    }
  } finally {
    // Only this save operation owns the UUID-named temporary manifest.
    // Never touch the prior committed studio.json on a failed rename.
    try { await unlink(temporary) } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Não foi possível remover o manifesto temporário do Studio após gravar.')
      }
    }
  }
}

async function listStudios(workspace: StudioWorkspaceStorage = 'studio'): Promise<StudioDocument[]> {
  const libraryPath = studioLibraryPath(workspace)
  await mkdir(libraryPath, { recursive: true })
  const entries = await readdir(libraryPath, { withFileTypes: true })
  const documents = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && /^studio-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entry.name))
    .map((entry) => readStudio(entry.name.slice('studio-'.length), workspace)))
  return documents.filter((studio): studio is StudioDocument => studio !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.title.localeCompare(b.title))
}

function dataUrlBuffer(dataUrl: string): Buffer {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!match) throw new Error('Arquivo de peça inválido.')
  return Buffer.from(match[1], 'base64')
}

function importedImageDataUrlBuffer(dataUrl: string): Buffer {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl)
  if (!match) throw new Error('Imagem inválida. Selecione PNG, JPG ou WebP estático.')
  return Buffer.from(match[2], 'base64')
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
    await writeAssetImageSource(join(partsFolder, `${asset.id}.png`), dataUrlBuffer(asset.dataUrl))
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
    if (file.endsWith('.png') && !file.endsWith('.paint.png') && !keepFiles.has(file)) await unlink(join(partsFolder, file))
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
    await writeAssetImageSource(join(partsFolder, `${asset.id}.png`), dataUrlBuffer(asset.dataUrl))
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
  for (const filename of await readdir(partsFolder)) if (filename.endsWith('.png') && !filename.endsWith('.paint.png') && !keepFiles.has(filename)) await unlink(join(partsFolder, filename))
}

async function readPoseAssets(folder: string, parts: Array<Omit<PosePart, 'dataUrl'>>): Promise<PosePart[]> {
  const partsFolder = join(folder, 'parts')
  return Promise.all(parts.map(async (part) => ({
    ...part,
    dataUrl: `data:image/png;base64,${(await readAssetImage(join(partsFolder, `${part.id}.png`))).toString('base64')}`
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
      if (transform.width !== undefined && (!Number.isFinite(transform.width) || transform.width <= 0 || transform.width > 10000)) throw new Error('Largura de frame inválida.')
      if (transform.height !== undefined && (!Number.isFinite(transform.height) || transform.height <= 0 || transform.height > 10000)) throw new Error('Altura de frame inválida.')
    }
  }
  if (!document.thumbnailDataUrl.startsWith('data:image/png;base64,') || document.thumbnailDataUrl.length > 3_000_000) throw new Error('Miniatura da animação inválida.')
}

async function writeAnimatorParts(folder: string, parts: Array<Omit<PosePart, 'dataUrl'>>, assets: AnimatorAnimationAsset[]): Promise<void> {
  const partsFolder = join(folder, 'parts')
  await mkdir(partsFolder, { recursive: true })
  const validIds = new Set(parts.map((part) => part.id))
  for (const asset of assets) if (validIds.has(asset.id)) await writeAssetImageSource(join(partsFolder, `${asset.id}.png`), dataUrlBuffer(asset.dataUrl))
  for (const part of parts) {
    const target = join(partsFolder, `${part.id}.png`)
    try { await access(target) } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
      throw new Error(`Imagem-base ausente na animação: ${part.name} (${part.id}).`)
    }
  }
  const keep = new Set(parts.map((part) => `${part.id}.png`))
  for (const filename of await readdir(partsFolder)) if (filename.endsWith('.png') && !filename.endsWith('.paint.png') && !keep.has(filename)) await unlink(join(partsFolder, filename))
}

async function readAnimatorParts(folder: string, parts: Array<Omit<PosePart, 'dataUrl'>>): Promise<PosePart[]> {
  return Promise.all(parts.map(async (part) => ({ ...part, dataUrl: `data:image/png;base64,${(await readAssetImage(join(folder, 'parts', `${part.id}.png`))).toString('base64')}` })))
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
  ipcMain.handle('app:flush-pending-writes', async (event): Promise<void> => {
    assertTrustedSender(event)
    const pendingWrites = [...fabricatorSaveQueues.values(), ...poseSaveWrites, ...hairSaveQueues.values(),
      studioSaveQueues.studio, studioSaveQueues.video, roteirosSaveQueue]
    const results = await Promise.allSettled(pendingWrites)
    const failedWrite = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failedWrite) throw failedWrite.reason
  })

  const registerStudioWorkspace = (workspace: StudioWorkspaceStorage, channel: 'studio' | 'video-studio') => {
    ipcMain.handle(`${channel}:list`, async (event): Promise<StudioDocument[]> => {
      assertTrustedSender(event)
      return listStudios(workspace)
    })

    ipcMain.handle(`${channel}:save`, async (event, studio: StudioDocument): Promise<void> => {
      assertTrustedSender(event)
      const next = studioSaveQueues[workspace].catch(() => undefined).then(() => writeStudio(studio, workspace))
      studioSaveQueues[workspace] = next
      await next
    })

    ipcMain.handle(`${channel}:delete`, async (event, id: string): Promise<void> => {
      assertTrustedSender(event)
      if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Identificador de Studio inválido.')
      const next = studioSaveQueues[workspace].catch(() => undefined).then(async () => {
        const folder = resolve(studioPath(id, workspace))
        if (dirname(folder) !== resolve(studioLibraryPath(workspace)) || basename(folder) !== `studio-${id}`) throw new Error('Pasta do Studio inválida.')
        if (workspace === 'video') await videoLibrary.list()
        await rm(folder, { recursive: true, force: true })
      })
      studioSaveQueues[workspace] = next
      await next
    })

    ipcMain.handle(`${channel}:folder`, (event): string => {
      assertTrustedSender(event)
      return join(app.getPath('appData'), 'projects', workspace === 'video' ? 'video-studio' : 'studio')
    })

    ipcMain.handle(`${channel}:import-image`, async (event, category: StudioAsset['category']): Promise<StudioAsset | null> => {
      assertTrustedSender(event)
      if (category !== 'background' && category !== 'object') throw new Error('Categoria de imagem inválida.')
      const label = workspace === 'video' ? 'Video Studio' : 'Studio'
      const result = await dialog.showOpenDialog({
        title: `${label}: ${category === 'background' ? 'adicionar imagem de fundo' : 'adicionar objeto à cena'}`,
        properties: ['openFile'],
        filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
      })
      if (result.canceled || !result.filePaths[0]) return null
      const path = result.filePaths[0]
      const size = (await stat(path)).size
      if (size > 50 * 1024 * 1024) throw new Error('A imagem excede o limite de 50 MB.')
      const bytes = await readFile(path)
      const canonical = await normalizeImageBuffer(bytes)
      return { id: randomUUID(), category, name: basename(path), mimeType: 'image/png', dataUrl: `data:image/png;base64,${canonical.bytes.toString('base64')}` }
    })

    if (workspace === 'video') {
      videoExportLibrary ??= new VideoExportLibrary(app.getPath('appData'))
  videoPreviewProxyStore ??= new VideoPreviewProxyStore(join(app.getPath('appData'), 'CACHE', 'video-studio', 'preview-media'))
      ipcMain.handle('video-studio:exports:list', async (event) => {
        assertTrustedSender(event)
        return videoExportLibrary!.list()
      })
      ipcMain.handle('video-studio:exports:open-folder', async (event, studioId?: string) => {
        assertTrustedSender(event)
        const folder = await videoExportLibrary!.folder(studioId)
        const error = await shell.openPath(folder)
        if (error) throw new Error(`Não foi possível abrir a pasta de exportações: ${error}`)
      })
      ipcMain.handle('video-studio:exports:delete', async (event, id: string) => {
        assertTrustedSender(event)
        await videoExportLibrary!.delete(id)
      })
      ipcMain.handle('video-studio:export:start', async (event, request: VideoExportStartRequest) => {
        assertTrustedSender(event)
        if (!videoExportCoordinator) throw new Error('Coordenador de exportação ainda não foi inicializado.')
        if (!request || !isStudioDocument(request.studio) || !request.studio.videoTimeline
          || !Array.isArray(request.characters) || request.characters.length > 500 || !request.characters.every(isCustomizerCharacter)
          || !['animated', 'static-characters'].includes(request.renderVariant)) {
          throw new Error('Solicitação de exportação inválida.')
        }
        // Validate the transitively captured dependency snapshot before accepting
        // a long-running job from the renderer.
        serializeVideoCharacterRenderAssetSnapshot(request.characterAssets)
        await studioSaveQueues.video.catch(() => undefined)
        await videoLibrary.ensureProjectAssets(request.studio.id, request.studio.videoTimeline.videoAssets ?? [])
        const jobId = videoExportCoordinator.start(request)
        videoExportJobOwners.set(jobId, event.sender.id)
        const current = videoExportCoordinator.status(jobId)
        if (current) event.sender.send('video-studio:export:progress', current)
        return { jobId }
      })
      ipcMain.handle('video-studio:export:status', (event, jobId: string) => {
        assertTrustedSender(event)
        if (!videoExportCoordinator || videoExportJobOwners.get(jobId) !== event.sender.id) throw new Error('Job de exportação não pertence a esta janela.')
        return videoExportCoordinator.status(jobId)
      })
      ipcMain.handle('video-studio:export:cancel', async (event, jobId: string) => {
        assertTrustedSender(event)
        if (!videoExportCoordinator || videoExportJobOwners.get(jobId) !== event.sender.id) throw new Error('Job de exportação não pertence a esta janela.')
        await videoExportCoordinator.cancel(jobId)
      })
      ipcMain.handle('video-studio:export:recoverable', async (event) => {
        assertTrustedSender(event)
        if (!videoExportCoordinator) throw new Error('Coordenador de exportação ainda não foi inicializado.')
        return videoExportCoordinator.listRecoverable()
      })
      ipcMain.handle('video-studio:export:resume', async (event, jobId: string) => {
        assertTrustedSender(event)
        if (!videoExportCoordinator) throw new Error('Coordenador de exportação ainda não foi inicializado.')
        const resumed = await videoExportCoordinator.resume(jobId)
        videoExportJobOwners.set(resumed, event.sender.id)
        const current = videoExportCoordinator.status(resumed)
        if (current) event.sender.send('video-studio:export:progress', current)
        return { jobId: resumed }
      })
      ipcMain.handle('video-studio:export:discard-recovery', async (event, jobId: string) => {
        assertTrustedSender(event)
        if (!videoExportCoordinator) throw new Error('Coordenador de exportação ainda não foi inicializado.')
        const owner = videoExportJobOwners.get(jobId)
        if (owner !== undefined && owner !== event.sender.id) throw new Error('Job de exportação pertence a outra janela.')
        await videoExportCoordinator.discardRecovery(jobId)
        videoExportJobOwners.delete(jobId)
      })
      ipcMain.handle('video-studio:video-library:list', async (event) => { assertTrustedSender(event); return videoLibrary.list() })
      ipcMain.handle('video-studio:video-library:import', async (event) => {
        assertTrustedSender(event)
        const result = await dialog.showOpenDialog({ title: 'Biblioteca de vídeos: importar', properties: ['openFile'], filters: [{ name: 'Vídeos', extensions: ['mp4', 'webm', 'mov', 'm4v'] }] })
        if (result.canceled || !result.filePaths[0]) return null
        return videoLibrary.importFile(result.filePaths[0])
      })
      ipcMain.handle('video-studio:video-library:finish', async (event, id: string, durationFrames: number) => { assertTrustedSender(event); return videoLibrary.finishImport(id, durationFrames) })
      ipcMain.handle('video-studio:video-library:delete', async (event, id: string) => {
        assertTrustedSender(event)
        const next = roteirosSaveQueue.catch(() => undefined).then(async () => {
          const reference = dataPlatform.database?.prepare("SELECT 1 FROM roteiro_sections WHERE json_extract(video_asset_json, '$.id') = ? LIMIT 1").get(id)
          if (reference) throw new Error('Este vídeo está sendo usado em uma abertura ou TikTok. Remova a referência no roteiro antes de excluí-lo da biblioteca.')
          await videoLibrary.delete(id)
        })
        roteirosSaveQueue = next
        await next
      })
      ipcMain.handle('video-studio:video-library:attach', async (event, studioId: string, ids: string[]) => { assertTrustedSender(event); return videoLibrary.attach(studioId, ids) })
      ipcMain.handle('video-studio:preview-media:prepare', async (event, studioId: string, asset: VideoStudioAsset) => {
        assertTrustedSender(event)
        if (!videoPreviewProxyStore) throw new Error('Cache de preview ainda não foi inicializado.')
        if (!asset || typeof asset !== 'object' || typeof asset.id !== 'string') throw new Error('Asset de preview inválido.')
        const source = await videoLibrary.resolveProjectMediaDependency(studioId, asset.id, asset)
        videoPreviewToolsPromise ??= resolveVideoStudioTools().then(async (paths) => ({ ffmpeg: await probeVideoStudioFfmpeg(paths.ffmpeg) }))
        void videoPreviewToolsPromise.catch(() => { videoPreviewToolsPromise = null })
        const tools = await videoPreviewToolsPromise
        const record = await videoPreviewProxyStore.ensure({ sourcePath: source.path, ffmpeg: tools.ffmpeg })
        return {
          sourceSha256: record.sourceSha256,
          proxyUrl: `gacha-video://preview-proxy/${record.sourceSha256}`,
          waveformUrl: record.waveformFilename ? `gacha-video://preview-waveform/${record.sourceSha256}` : null,
        }
      })
      ipcMain.handle('video-studio:background-library:list', async (event) => { assertTrustedSender(event); return videoBackgroundLibrary.list() })
      ipcMain.handle('video-studio:background-library:import', async (event) => {
        assertTrustedSender(event)
        const result = await dialog.showOpenDialog({ title: 'Biblioteca de fundos: importar', properties: ['openFile'], filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
        if (result.canceled || !result.filePaths[0]) return null
        return videoBackgroundLibrary.importFile(result.filePaths[0])
      })
      ipcMain.handle('video-studio:background-library:delete', async (event, id: string) => { assertTrustedSender(event); return videoBackgroundLibrary.delete(id) })
      ipcMain.handle('video-studio:background-library:attach', async (event, studioId: string, id: string) => { assertTrustedSender(event); return videoBackgroundLibrary.attach(studioId, id) })

    }
    ipcMain.handle(`${channel}:save-print`, async (event, id: string, dataUrl: string): Promise<string | null> => {
      assertTrustedSender(event)
      if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Identificador de Studio inválido.')
      const bytes = dataUrlBuffer(dataUrl)
      if (bytes.length > 50 * 1024 * 1024) throw new Error('O print excede o limite de 50 MB.')
      const printsFolder = join(studioPath(id, workspace), 'prints')
      await mkdir(printsFolder, { recursive: true })
      const printPath = join(printsFolder, `print-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.png`)
      await writeFile(printPath, bytes)
      return printPath
    })

    ipcMain.handle(`${channel}:open-prints`, async (event, id: string): Promise<void> => {
      assertTrustedSender(event)
      if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('Identificador de Studio inválido.')
      const studioFolder = resolve(studioPath(id, workspace))
      const printsFolder = resolve(studioFolder, 'prints')
      if (dirname(printsFolder) !== studioFolder) throw new Error('Pasta de prints inválida.')
      let folderToOpen = printsFolder
      if (dataFileSystem.locate(printsFolder) && dataPlatform.getDomainState(dataFileSystem.locate(printsFolder)!.domainId).state !== 'legacy') {
        folderToOpen = join(app.getPath('temp'), 'exports', workspace, `studio-${id}`, 'prints')
        await rm(folderToOpen, { recursive: true, force: true })
        await dataFileSystem.materializeDirectory(printsFolder, folderToOpen)
      } else await mkdir(printsFolder, { recursive: true })
      const error = await shell.openPath(folderToOpen)
      if (error) throw new Error(`Não foi possível abrir a pasta de prints: ${error}`)
    })
  }

  registerStudioWorkspace('studio', 'studio')
  registerStudioWorkspace('video', 'video-studio')

  ipcMain.handle('roteiros:list', async (event): Promise<RoteiroDocument[]> => {
    assertTrustedSender(event)
    await roteirosSaveQueue.catch(() => undefined)
    const db = dataPlatform.database
    if (!db) throw new Error('Catálogo de dados não inicializado.')
    const roteiroRows = db.prepare('SELECT id, title, video_title, character_ids_json FROM roteiros ORDER BY position, created_at, id').all() as Array<{ id: string; title: string; video_title: string; character_ids_json: string }>
    const tiktokRows = db.prepare('SELECT id, roteiro_id, title, video_title FROM roteiro_tiktoks ORDER BY roteiro_id, position').all() as Array<{ id: string; roteiro_id: string; title: string; video_title: string }>
    const sectionRows = db.prepare('SELECT section_id, roteiro_id, section_kind, video_asset_json, blocks_json, description_text, timeline, scene_end_seconds, first_group_reaction_seconds, second_group_reaction_seconds FROM roteiro_sections').all() as Array<{ section_id: string; roteiro_id: string; section_kind: 'opening' | 'tiktok'; video_asset_json: string | null; blocks_json: string; description_text: string; timeline: RoteiroSectionContent['timeline']; scene_end_seconds: number | null; first_group_reaction_seconds: number | null; second_group_reaction_seconds: number | null }>
    const contentById = new Map(sectionRows.map((row) => [row.section_id, {
      video: row.video_asset_json ? JSON.parse(row.video_asset_json) as RoteiroVideoReference : null,
      blocks: JSON.parse(row.blocks_json) as RoteiroReactionBlock[],
      description: row.description_text,
      timeline: row.timeline,
      ...(row.scene_end_seconds === null ? {} : { sceneEndSeconds: row.scene_end_seconds }),
      ...(row.first_group_reaction_seconds === null ? {} : { firstGroupReactionSeconds: row.first_group_reaction_seconds }),
      ...(row.second_group_reaction_seconds === null ? {} : { secondGroupReactionSeconds: row.second_group_reaction_seconds })
    }]))
    const tiktoksByRoteiro = new Map<string, RoteiroDocument['tiktoks']>()
    for (const row of tiktokRows) {
      const items = tiktoksByRoteiro.get(row.roteiro_id) ?? []
      items.push({ id: row.id, title: row.title, videoTitle: row.video_title, ...(contentById.get(row.id) ?? { video: null, blocks: [], description: '' }) })
      tiktoksByRoteiro.set(row.roteiro_id, items)
    }
    return roteiroRows.map((row) => ({
      id: row.id, title: row.title, videoTitle: row.video_title,
      characterIds: JSON.parse(row.character_ids_json) as string[],
      opening: contentById.get(`${row.id}:opening`) ?? { video: null, blocks: [], description: '' },
      tiktoks: tiktoksByRoteiro.get(row.id) ?? []
    }))
  })

  ipcMain.handle('roteiros:save', async (event, roteiros: unknown): Promise<void> => {
    assertTrustedSender(event)
    if (!Array.isArray(roteiros) || roteiros.length > 2000 || !roteiros.every(isRoteiroDocument)
      || new Set(roteiros.map((roteiro: RoteiroDocument) => roteiro.id)).size !== roteiros.length
      || new Set(roteiros.flatMap((roteiro: RoteiroDocument) => roteiro.tiktoks.map((tiktok) => tiktok.id))).size !== roteiros.reduce((total: number, roteiro: RoteiroDocument) => total + roteiro.tiktoks.length, 0)) {
      throw new Error('A lista de roteiros enviada para salvar é inválida.')
    }
    const next = roteirosSaveQueue.catch(() => undefined).then(() => {
      const db = dataPlatform.database
      if (!db) throw new Error('Catálogo de dados não inicializado.')
      const now = new Date().toISOString()
      const save = db.transaction((documents: RoteiroDocument[]) => {
        const oldRoteiros = db.prepare('SELECT id, title, video_title, character_ids_json, position FROM roteiros').all() as Array<{ id: string; title: string; video_title: string; character_ids_json: string; position: number }>
        const oldTikToks = db.prepare('SELECT id, roteiro_id, title, video_title, position FROM roteiro_tiktoks').all() as Array<{ id: string; roteiro_id: string; title: string; video_title: string; position: number }>
        const oldSections = db.prepare('SELECT section_id FROM roteiro_sections').all() as Array<{ section_id: string }>
        const routeIds = new Set(documents.map((item) => item.id))
        const tikTokIds = new Set(documents.flatMap((item) => item.tiktoks.map((tiktok) => tiktok.id)))
        const sectionIds = new Set(documents.flatMap((item) => [`${item.id}:opening`, ...item.tiktoks.map((tiktok) => tiktok.id)]))
        const deleteSection = db.prepare('DELETE FROM roteiro_sections WHERE section_id=?')
        const deleteTikTok = db.prepare('DELETE FROM roteiro_tiktoks WHERE id=?')
        const deleteRoteiro = db.prepare('DELETE FROM roteiros WHERE id=?')
        for (const row of oldSections) if (!sectionIds.has(row.section_id)) deleteSection.run(row.section_id)
        for (const row of oldTikToks) if (!tikTokIds.has(row.id)) deleteTikTok.run(row.id)
        for (const row of oldRoteiros) if (!routeIds.has(row.id)) deleteRoteiro.run(row.id)

        // Positions are unique per roteiro. Shift only parents whose order changed,
        // then write their final positions without transient uniqueness collisions.
        const oldTikToksByParent = new Map<string, typeof oldTikToks>()
        for (const row of oldTikToks) {
          if (!tikTokIds.has(row.id)) continue
          const rows = oldTikToksByParent.get(row.roteiro_id) ?? []
          rows.push(row)
          oldTikToksByParent.set(row.roteiro_id, rows)
        }
        const shiftTikTokPositions = db.prepare('UPDATE roteiro_tiktoks SET position=position+1000000 WHERE roteiro_id=?')
        for (const roteiro of documents) {
          const old = oldTikToksByParent.get(roteiro.id) ?? []
          const oldById = new Map(old.map((row) => [row.id, row]))
          if (roteiro.tiktoks.some((tiktok, position) => oldById.has(tiktok.id) && oldById.get(tiktok.id)!.position !== position)) shiftTikTokPositions.run(roteiro.id)
        }

        const upsertRoteiro = db.prepare(`INSERT INTO roteiros(id, title, video_title, character_ids_json, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET title=excluded.title, video_title=excluded.video_title, character_ids_json=excluded.character_ids_json, position=excluded.position, updated_at=excluded.updated_at
          WHERE roteiros.title IS NOT excluded.title OR roteiros.video_title IS NOT excluded.video_title OR roteiros.character_ids_json IS NOT excluded.character_ids_json OR roteiros.position IS NOT excluded.position`)
        const upsertTikTok = db.prepare(`INSERT INTO roteiro_tiktoks(id, roteiro_id, title, video_title, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET roteiro_id=excluded.roteiro_id, title=excluded.title, video_title=excluded.video_title, position=excluded.position, updated_at=excluded.updated_at
          WHERE roteiro_tiktoks.roteiro_id IS NOT excluded.roteiro_id OR roteiro_tiktoks.title IS NOT excluded.title OR roteiro_tiktoks.video_title IS NOT excluded.video_title OR roteiro_tiktoks.position IS NOT excluded.position`)
        const upsertSection = db.prepare(`INSERT INTO roteiro_sections(section_id, roteiro_id, section_kind, video_asset_json, blocks_json, description_text, timeline, scene_end_seconds, first_group_reaction_seconds, second_group_reaction_seconds, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(section_id) DO UPDATE SET roteiro_id=excluded.roteiro_id, section_kind=excluded.section_kind, video_asset_json=excluded.video_asset_json, blocks_json=excluded.blocks_json, description_text=excluded.description_text, timeline=excluded.timeline, scene_end_seconds=excluded.scene_end_seconds, first_group_reaction_seconds=excluded.first_group_reaction_seconds, second_group_reaction_seconds=excluded.second_group_reaction_seconds, updated_at=excluded.updated_at
          WHERE roteiro_sections.roteiro_id IS NOT excluded.roteiro_id OR roteiro_sections.section_kind IS NOT excluded.section_kind OR roteiro_sections.video_asset_json IS NOT excluded.video_asset_json OR roteiro_sections.blocks_json IS NOT excluded.blocks_json OR roteiro_sections.description_text IS NOT excluded.description_text OR roteiro_sections.timeline IS NOT excluded.timeline OR roteiro_sections.scene_end_seconds IS NOT excluded.scene_end_seconds OR roteiro_sections.first_group_reaction_seconds IS NOT excluded.first_group_reaction_seconds OR roteiro_sections.second_group_reaction_seconds IS NOT excluded.second_group_reaction_seconds`)
        documents.forEach((roteiro, position) => {
          upsertRoteiro.run(roteiro.id, roteiro.title.trim(), roteiro.videoTitle.trim(), JSON.stringify(roteiro.characterIds), position, now, now)
          const opening = roteiro.opening ?? { video: null, blocks: [], description: '' }
          upsertSection.run(`${roteiro.id}:opening`, roteiro.id, 'opening', opening.video ? JSON.stringify(opening.video) : null, JSON.stringify(opening.blocks), opening.description ?? '', opening.timeline ?? 'unspecified', opening.sceneEndSeconds ?? null, opening.firstGroupReactionSeconds ?? null, opening.secondGroupReactionSeconds ?? null, now)
          roteiro.tiktoks.forEach((tiktok, tiktokPosition) => {
            upsertTikTok.run(tiktok.id, roteiro.id, tiktok.title.trim(), tiktok.videoTitle.trim(), tiktokPosition, now, now)
            const content = { video: tiktok.video ?? null, blocks: tiktok.blocks ?? [], description: tiktok.description ?? '', timeline: tiktok.timeline ?? 'unspecified', sceneEndSeconds: tiktok.sceneEndSeconds, firstGroupReactionSeconds: tiktok.firstGroupReactionSeconds, secondGroupReactionSeconds: tiktok.secondGroupReactionSeconds }
            upsertSection.run(tiktok.id, roteiro.id, 'tiktok', content.video ? JSON.stringify(content.video) : null, JSON.stringify(content.blocks), content.description, content.timeline, content.sceneEndSeconds ?? null, content.firstGroupReactionSeconds ?? null, content.secondGroupReactionSeconds ?? null, now)
          })
        })
      })
      save(roteiros as RoteiroDocument[])
    })
    roteirosSaveQueue = next
    await next
  })

  ipcMain.handle('base-videos:list-details', async (event): Promise<BaseVideoDetails[]> => {
    assertTrustedSender(event)
    const db = dataPlatform.database
    if (!db) throw new Error('Catálogo de dados não inicializado.')
    const rows = db.prepare('SELECT video_id, video_number, description_text, timeline, scene_end_seconds, first_group_reaction_seconds, second_group_reaction_seconds FROM base_video_details ORDER BY CASE WHEN video_number IS NULL THEN 1 ELSE 0 END, video_number, updated_at DESC').all() as Array<{ video_id: string; video_number: number | null; description_text: string; timeline: BaseVideoDetails['timeline']; scene_end_seconds: number | null; first_group_reaction_seconds: number | null; second_group_reaction_seconds: number | null }>
    return rows.map((row) => ({ videoId: row.video_id, ...(row.video_number === null ? {} : { videoNumber: row.video_number }), description: row.description_text, timeline: row.timeline,
      ...(row.scene_end_seconds === null ? {} : { sceneEndSeconds: row.scene_end_seconds }),
      ...(row.first_group_reaction_seconds === null ? {} : { firstGroupReactionSeconds: row.first_group_reaction_seconds }),
      ...(row.second_group_reaction_seconds === null ? {} : { secondGroupReactionSeconds: row.second_group_reaction_seconds }) }))
  })

  ipcMain.handle('base-videos:save-details', async (event, value: unknown): Promise<void> => {
    assertTrustedSender(event)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Dados do vídeo inválidos.')
    const details = value as BaseVideoDetails
    const secondsValid = (seconds: unknown) => seconds === undefined || typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 && seconds <= 86400
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(details.videoId)
      || typeof details.description !== 'string' || details.description.length > 20000
      || !['unspecified', 'past', 'present', 'future'].includes(details.timeline)
      || !secondsValid(details.sceneEndSeconds) || !secondsValid(details.firstGroupReactionSeconds) || !secondsValid(details.secondGroupReactionSeconds)) throw new Error('Dados do vídeo inválidos.')
    const db = dataPlatform.database
    if (!db) throw new Error('Catálogo de dados não inicializado.')
    const next = roteirosSaveQueue.catch(() => undefined).then(() => {
      db.prepare(`INSERT INTO base_video_details(video_id, description_text, timeline, scene_end_seconds, first_group_reaction_seconds, second_group_reaction_seconds, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(video_id) DO UPDATE SET description_text=excluded.description_text, timeline=excluded.timeline,
        scene_end_seconds=excluded.scene_end_seconds, first_group_reaction_seconds=excluded.first_group_reaction_seconds,
        second_group_reaction_seconds=excluded.second_group_reaction_seconds, updated_at=excluded.updated_at`)
        .run(details.videoId, details.description, details.timeline, details.sceneEndSeconds ?? null, details.firstGroupReactionSeconds ?? null, details.secondGroupReactionSeconds ?? null, new Date().toISOString())
    })
    roteirosSaveQueue = next
    await next
  })

  ipcMain.handle('base-videos:delete-details', async (event, videoId: unknown): Promise<void> => {
    assertTrustedSender(event)
    if (typeof videoId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(videoId)) throw new Error('Identificador de vídeo inválido.')
    const db = dataPlatform.database
    if (!db) throw new Error('Catálogo de dados não inicializado.')
    const next = roteirosSaveQueue.catch(() => undefined).then(() => { db.prepare('DELETE FROM base_video_details WHERE video_id=?').run(videoId) })
    roteirosSaveQueue = next
    await next
  })

  ipcMain.handle('base-videos:delete', async (event, videoId: unknown): Promise<void> => {
    assertTrustedSender(event)
    if (typeof videoId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(videoId)) throw new Error('Identificador de vídeo inválido.')
    const next = roteirosSaveQueue.catch(() => undefined).then(async () => {
      const db = dataPlatform.database
      if (!db) throw new Error('Catálogo de dados não inicializado.')
      const reference = db.prepare("SELECT 1 FROM roteiro_sections WHERE json_extract(video_asset_json, '$.id') = ? LIMIT 1").get(videoId)
      if (reference) throw new Error('Este vídeo está sendo usado em uma abertura ou TikTok. Remova a referência no roteiro antes de excluí-lo da biblioteca.')
      // Commit the library tombstone first. If the app exits between the two
      // stores, the video is already logically deleted and a stale detail row
      // is harmless; reversing this order could lose the user's description
      // while leaving the video available.
      await videoLibrary.delete(videoId)
      db.prepare('DELETE FROM base_video_details WHERE video_id=?').run(videoId)
    })
    roteirosSaveQueue = next
    await next
  })

  ipcMain.handle('base-videos:publish', async (event, videoId: unknown): Promise<number> => {
    assertTrustedSender(event)
    if (typeof videoId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(videoId)) throw new Error('Identificador de vídeo inválido.')
    const media = await videoLibrary.resolveMedia(videoId)
    if (media.durationFrames === null) throw new Error('A duração deste vídeo ainda não foi reconhecida. Reabra a prévia ou importe o arquivo novamente antes de enviá-lo à Base.')
    // Library paths are virtual when media is in the content-addressed catalog; resolve those
    // references before using native filesystem APIs. Legacy files still use their logical path.
    const physicalMediaPath = await dataFileSystem.resolvePhysicalPath(media.path)
    if (physicalMediaPath) await nativeAccess(physicalMediaPath)
    else await dataFileSystem.access(media.path)
    const db = dataPlatform.database
    if (!db) throw new Error('Catálogo de dados não inicializado.')
    const publish = db.transaction((id: string) => {
      const existing = db.prepare('SELECT video_number FROM base_video_details WHERE video_id=?').get(id) as { video_number: number | null } | undefined
      if (existing?.video_number !== null && existing?.video_number !== undefined) return existing.video_number
      let sequence = db.prepare('SELECT next_number FROM base_video_sequence WHERE sequence_id=1').get() as { next_number: number } | undefined
      if (!sequence) {
        db.prepare('INSERT INTO base_video_sequence(sequence_id, next_number) SELECT 1, COALESCE(MAX(video_number), 0) + 1 FROM base_video_details').run()
        sequence = db.prepare('SELECT next_number FROM base_video_sequence WHERE sequence_id=1').get() as { next_number: number }
      }
      const videoNumber = sequence.next_number
      if (!Number.isSafeInteger(videoNumber) || videoNumber < 1 || !Number.isSafeInteger(videoNumber + 1)) throw new Error('A sequência numérica da Base de vídeos atingiu um valor inválido.')
      db.prepare('UPDATE base_video_sequence SET next_number=? WHERE sequence_id=1').run(videoNumber + 1)
      db.prepare(`INSERT INTO base_video_details(video_id, video_number, description_text, timeline, updated_at)
        VALUES (?, ?, '', 'unspecified', ?) ON CONFLICT(video_id) DO UPDATE SET video_number=excluded.video_number, updated_at=excluded.updated_at`)
        .run(id, videoNumber, new Date().toISOString())
      return videoNumber
    })
    const next = roteirosSaveQueue.catch(() => undefined).then(() => publish(videoId))
    roteirosSaveQueue = next.then(() => undefined)
    return next
  })

  ipcMain.handle('customizer:characters:list', async (event): Promise<CustomizerCharacter[]> => {
    assertTrustedSender(event)
    await characterSaveQueue.catch(() => undefined)
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
    const supportedExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp'])
    if (!supportedExtensions.has(extension)) throw new Error('Formato incompatível. Use PNG, JPG ou WebP.')
    const fileStat = await stat(path)
    if (fileStat.size > 50 * 1024 * 1024) throw new Error('A imagem excede o limite de 50 MB.')
    if (fileStat.size === 0) throw new Error('O arquivo de imagem está vazio.')
    const bytes = await readFile(path)
    const canonical = await normalizeImageBuffer(bytes)
    if (canonical.bitDepth > 8) throw new Error('O Fabricador processa a folha em 8 bits. O PNG de 16 bits não foi alterado; converta uma cópia para 8 bits para importar neste editor.')
    const sourceDataUrl = `data:image/png;base64,${canonical.bytes.toString('base64')}`
    const destination = slotPath(slot)
    const sourceAssetName = `source-${randomUUID()}.png`
    await mkdir(destination, { recursive: true })
    await writeFile(join(destination, sourceAssetName), canonical.bytes)
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
        dataUrl: `data:image/png;base64,${(await readAssetImage(join(folder, 'parts', `${part.id}.png`))).toString('base64')}`,
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
          if (set.schemaVersion === 1 && (set.edition === undefined || set.edition === 1 || set.edition === 2) && set.modelSlot === modelSlot && set.id === entry.name.slice(4) && Array.isArray(set.components)) sets.push({ id: set.id, modelSlot, modelName: set.modelName, name: set.name, updatedAt: set.updatedAt, edition: set.edition ?? 1, componentCount: set.components.length })
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

  ipcMain.handle('fabricator:expression-presets:list', async (event, modelSlot: number): Promise<FaceExpressionPresetSummary[]> => {
    assertTrustedSender(event)
    return listFaceExpressionPresets(modelSlot)
  })
  ipcMain.handle('fabricator:expression-collections:list', async (event, modelSlot: number): Promise<FaceExpressionCollection[]> => {
    assertTrustedSender(event)
    return listFaceExpressionCollections(modelSlot)
  })
  ipcMain.handle('fabricator:expression-collections:save', async (event, modelSlot: number, collection: FaceExpressionCollection): Promise<void> => {
    assertTrustedSender(event)
    const next = expressionPresetSaveQueue.catch(() => undefined).then(() => writeFaceExpressionCollection(modelSlot, collection))
    expressionPresetSaveQueue = next
    await next
  })
  ipcMain.handle('fabricator:expression-presets:load', async (event, modelSlot: number, id: string): Promise<FaceExpressionPreset | null> => {
    assertTrustedSender(event)
    return readFaceExpressionPreset(modelSlot, id)
  })
  ipcMain.handle('fabricator:expression-presets:save', async (event, modelSlot: number, preset: FaceExpressionPreset): Promise<void> => {
    assertTrustedSender(event)
    const next = expressionPresetSaveQueue.catch(() => undefined).then(() => writeFaceExpressionPreset(modelSlot, preset))
    expressionPresetSaveQueue = next
    await next
  })
  ipcMain.handle('fabricator:expression-presets:delete', async (event, modelSlot: number, id: string): Promise<void> => {
    assertTrustedSender(event)
    if (!isValidModelSlot(modelSlot) || !isValidWardrobeId(id)) throw new Error('Preset de expressão inválido.')
    const target = resolve(faceExpressionPresetPath(modelSlot, id))
    const base = resolve(join(app.getPath('userData'), 'fabricator', 'expression-presets', `model-${modelSlot}`))
    if (dirname(target) !== base || basename(target) !== `preset-${id}.json`) throw new Error('Caminho de exclusão inválido.')
    const next = expressionPresetSaveQueue.catch(() => undefined).then(() => rm(target, { force: true }))
    expressionPresetSaveQueue = next
    await next
  })
  ipcMain.handle('fabricator:face-animation:export', async (event, modelSlot: number, data: Uint8Array): Promise<boolean> => {
    assertTrustedSender(event)
    if (!isValidModelSlot(modelSlot) || !(data instanceof Uint8Array) || data.byteLength < 4 || data.byteLength > 250 * 1024 * 1024 || data[0] !== 0x1a || data[1] !== 0x45 || data[2] !== 0xdf || data[3] !== 0xa3) {
      throw new Error('Arquivo de animação facial inválido ou maior que 250 MB.')
    }
    const options = {
      title: 'Exportar animação do rosto',
      defaultPath: `animador-rosto-modelo-${String(modelSlot).padStart(2, '0')}.webm`,
      filters: [{ name: 'Vídeo WebM', extensions: ['webm'] }]
    }
    const owner = BrowserWindow.fromWebContents(event.sender)
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return false
    const destination = result.filePath.toLowerCase().endsWith('.webm') ? result.filePath : `${result.filePath}.webm`
    await writeFile(destination, Buffer.from(data))
    return true
  })
  ipcMain.handle('fabricator:expression-workspace:load', async (event, modelSlot: number): Promise<FaceExpressionWorkspaceDraft | null> => {
    assertTrustedSender(event)
    return readFaceExpressionWorkspaceDraft(modelSlot)
  })
  ipcMain.handle('fabricator:expression-workspace:save', async (event, modelSlot: number, draft: FaceExpressionWorkspaceDraft): Promise<void> => {
    assertTrustedSender(event)
    const next = expressionPresetSaveQueue.catch(() => undefined).then(() => writeFaceExpressionWorkspaceDraft(modelSlot, draft))
    expressionPresetSaveQueue = next
    await next
  })

  ipcMain.handle('fabricator:face-components:list', async (event, modelSlot: number, kind?: FaceAssetKind): Promise<FaceComponentAssetSummary[]> => {
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
  ipcMain.handle('fabricator:face-guides:load', async (event, profile: string) => {
    assertTrustedSender(event)
    if (!validFaceGuideProfile(profile)) throw new Error('Perfil de guias inválido.')
    return readFaceGuides(profile)
  })
  ipcMain.handle('fabricator:face-guides:save', async (event, profile: string, guides: unknown): Promise<void> => {
    assertTrustedSender(event)
    if (!validFaceGuideProfile(profile)) throw new Error('Perfil de guias inválido.')
    const next = faceGuideSaveQueue.catch(() => undefined).then(() => writeFaceGuides(profile, guides))
    faceGuideSaveQueue = next
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
  Menu.setApplicationMenu(null)
  const window = new BrowserWindow({
    show: process.env.GACHA_DEV_AI_TEST !== '1',
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
      sandbox: true,
      // Deterministic paint and requestAnimationFrame behavior for the hidden
      // DEV AI Electron window; normal user windows retain Chromium throttling.
      backgroundThrottling: process.env.GACHA_DEV_AI_TEST === '1' ? false : true
    }
  })
  window.removeMenu()
  window.webContents.once('did-finish-load', () => {
    if (dataBackupService) {
      void dataBackupService.finalizePendingRestore().catch((reason: unknown) => {
        console.error('A restauração foi aplicada, mas a limpeza do staging falhou; a cópia anterior foi preservada.', reason)
      })
    }
    if (!dataMigration) return
    void dataMigration.finalizeAfterHealthyLoad().catch((reason: unknown) => {
      console.error('A validação final do armazenamento local falhou; as cópias de segurança temporárias foram preservadas.', reason)
    })
  })

  let closeAfterFlush = false
  let flushingBeforeClose = false
  window.on('close', (event) => {
    if (closeAfterFlush) return
    event.preventDefault()
    if (flushingBeforeClose) return
    flushingBeforeClose = true
    const flushRendererWrites = window.webContents.isLoading()
      ? Promise.resolve()
      : window.webContents.executeJavaScript("window.desktop?.flushPendingWrites ? window.desktop.flushPendingWrites() : undefined")
    void flushRendererWrites.then(() => {
      closeAfterFlush = true
      flushingBeforeClose = false
      if (!window.isDestroyed()) window.close()
    }).catch(async (reason: unknown) => {
      flushingBeforeClose = false
      console.error('Não foi possível concluir os salvamentos antes de fechar o editor:', reason)
      if (!window.isDestroyed()) await dialog.showMessageBox(window, {
        type: 'error',
        title: 'Salvamento pendente',
        message: 'Não foi possível concluir os salvamentos. O editor continuará aberto para proteger suas alterações.',
        buttons: ['Voltar ao editor']
      })
    })
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerVideoAssetProtocol(): void {
  protocol.handle('gacha-video', async (request) => {
    try {
      const url = new URL(request.url)
      const parts = url.pathname.split('/').filter(Boolean)
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      const candidates = ['mp4', 'webm', 'mov', 'm4v'] as const
      let path: string | undefined
      let extension: typeof candidates[number] | undefined
      if (url.hostname === 'library' && parts.length === 1 && uuid.test(parts[0])) {
        const media = await videoLibrary.resolveMedia(parts[0])
        path = media.path
        extension = media.extension
      } else if (url.hostname === 'studio' && parts.length === 2 && parts.every((part) => uuid.test(part))) {
        const folder = join(studioPath(parts[0], 'video'), 'videos')
        for (const candidate of candidates) {
          const candidatePath = join(folder, `${parts[1]}.${candidate}`)
          try { await access(candidatePath); path = candidatePath; extension = candidate; break } catch { /* try next extension */ }
        }
      } else if (url.hostname === 'export-job' && parts.length === 2 && parts.every((part) => uuid.test(part))) {
        if (!videoExportJobStore) return new Response('Export job unavailable', { status: 503 })
        const media = await videoExportJobStore.resolvePinnedMedia(parts[0], parts[1])
        path = media.path
        extension = media.extension
      } else if ((url.hostname === 'preview-proxy' || url.hostname === 'preview-waveform') && parts.length === 1 && /^[a-f0-9]{64}$/i.test(parts[0])) {
        if (!videoPreviewProxyStore) return new Response('Preview cache unavailable', { status: 503 })
        const kind = url.hostname === 'preview-proxy' ? 'proxy' : 'waveform'
        path = await videoPreviewProxyStore.resolveFile(parts[0].toLowerCase(), kind)
        if (kind === 'proxy') extension = 'mp4'
        else {
          const file = await stat(path)
          const range = request.headers.get('range')
          const headers = new Headers({ 'content-type': 'image/png', 'content-length': String(file.size), 'cache-control': 'public, max-age=31536000, immutable' })
          if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
          if (range) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${file.size}` } })
          return new Response(Readable.toWeb(createReadStream(path)) as unknown as BodyInit, { status: 200, headers })
        }
      }
      if (!path || !extension) return new Response('Not found', { status: 404 })
      path = await dataFileSystem.resolvePhysicalPath(path) ?? path
      const file = await stat(path)
      const mimeType = ({ mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v' } as const)[extension]
      const range = request.headers.get('range')
      const headers = new Headers({ 'accept-ranges': 'bytes', 'content-type': mimeType, 'cache-control': 'no-store' })
      if (request.method === 'HEAD') {
        headers.set('content-length', String(file.size))
        return new Response(null, { status: 200, headers })
      }
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range)
        if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${file.size}` } })
        const start = match[1] ? Number(match[1]) : Math.max(0, file.size - Number(match[2]))
        const end = match[2] && match[1] ? Math.min(file.size - 1, Number(match[2])) : file.size - 1
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= file.size || end < start) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${file.size}` } })
        headers.set('content-range', `bytes ${start}-${end}/${file.size}`)
        headers.set('content-length', String(end - start + 1))
        return new Response(Readable.toWeb(createReadStream(path, { start, end })) as unknown as BodyInit, { status: 206, headers })
      }
      headers.set('content-length', String(file.size))
      return new Response(Readable.toWeb(createReadStream(path)) as unknown as BodyInit, { status: 200, headers })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

function registerVideoBackgroundProtocol(): void {
  protocol.handle('gacha-background', async (request) => {
    try {
      const url = new URL(request.url)
      const parts = url.pathname.split('/').filter(Boolean)
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      if (url.hostname !== 'library' || parts.length !== 1 || !uuid.test(parts[0])) return new Response('Not found', { status: 404 })
      const image = await videoBackgroundLibrary.resolve(parts[0])
      const bytes = await readFile(image.path)
      return new Response(bytes, { headers: { 'content-type': image.mimeType, 'cache-control': 'no-store' } })
    } catch { return new Response('Not found', { status: 404 }) }
  })
}

let fabricatorDesignSettingsActivation: Promise<void> | null = null
async function activateFabricatorDesignSettingsDomain(): Promise<void> {
  if (fabricatorDesignSettingsActivation) return fabricatorDesignSettingsActivation
  fabricatorDesignSettingsActivation = (async () => {
    const domainId = 'fabricator.design-settings'
    const current = dataPlatform.getDomainState(domainId).state
    if (current === 'active' || current === 'verified') return
    if (current !== 'legacy') throw new Error(`O armazenamento de Design Dev está em estado ${current}; a gravação foi interrompida.`)

    // Preserve and copy a pre-catalog settings file before switching this new
    // domain to app-data. The source remains untouched for rollback.
    const legacyPath = join(app.getPath('userData'), 'fabricator', 'design-settings', 'settings.json')
    let legacy: Buffer | null = null
    try { legacy = await nativeReadFile(legacyPath) }
    catch (reason) { if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason }
    dataPlatform.setDomainState(domainId, 'active', { activatedAt: new Date().toISOString(), legacySourcePreserved: Boolean(legacy) })
    try {
      if (legacy) await writeFile(legacyPath, legacy)
    } catch (reason) {
      dataPlatform.setDomainState(domainId, 'legacy', { activationFailed: true, sourcePreserved: true })
      throw reason
    }
  })()
  try { await fabricatorDesignSettingsActivation }
  catch (reason) { fabricatorDesignSettingsActivation = null; throw reason }
}

app.whenReady().then(async () => {
  const packagedToolsSmokeOutput = process.env.GACHA_VIDEO_TOOLS_SMOKE_OUTPUT
  if (packagedToolsSmokeOutput) {
    if (!app.isPackaged) throw new Error('O smoke de ferramentas empacotadas exige app.isPackaged=true.')
    const output = resolve(packagedToolsSmokeOutput)
    if (output !== packagedToolsSmokeOutput) throw new Error('Smoke output precisa usar caminho absoluto.')
    const paths = await resolveVideoStudioTools()
    if (paths.source !== 'packaged') throw new Error(`Smoke empacotado resolveu ferramentas de origem inesperada: ${paths.source}.`)
    const capability = await probeVideoStudioFfmpeg(paths.ffmpeg)
    const report = {
      schemaVersion: 1,
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      toolSource: paths.source,
      videoEncoder: capability.videoEncoder,
      audioEncoder: capability.audioEncoder,
      smokeEncoded: capability.smokeEncoded,
      versionLine: capability.versionLine,
    }
    await nativeWriteFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    app.quit()
    return
  }
  dataBackupService = new DataBackupService({ dataRoot: app.getPath('appData'), catalog: dataPlatform })
  await dataBackupService.applyPendingRestore()
  dataPlatform.initialize()
  ipcMain.handle('app:image:normalize', async (event, input: Uint8Array) => {
    assertTrustedSender(event)
    if (!(input instanceof Uint8Array) || input.byteLength === 0 || input.byteLength > 50 * 1024 * 1024) throw new Error('O arquivo de imagem está vazio ou excede 50 MB.')
    const canonical = await normalizeImageBuffer(Buffer.from(input.buffer, input.byteOffset, input.byteLength))
    return { dataUrl: `data:image/png;base64,${canonical.bytes.toString('base64')}`, width: canonical.width,
      height: canonical.height, bitDepth: canonical.bitDepth, sourceBytes: canonical.sourceBytes, outputBytes: canonical.outputBytes }
  })
  ipcMain.handle('fabricator:design-settings:load', async (event) => {
    assertTrustedSender(event)
    await activateFabricatorDesignSettingsDomain()
    const target = join(app.getPath('userData'), 'fabricator', 'design-settings', 'settings.json')
    try { return JSON.parse(await readFile(target, 'utf8')) as unknown }
    catch (reason) { if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return null; throw reason }
  })
  ipcMain.handle('fabricator:design-settings:save', async (event, settings: unknown) => {
    assertTrustedSender(event)
    await activateFabricatorDesignSettingsDomain()
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Configuração de Design Dev inválida.')
    const value = settings as { bannerSlides?: unknown[] }
    if (!Array.isArray(value.bannerSlides) || value.bannerSlides.length < 1 || value.bannerSlides.length > 8) throw new Error('O Design Dev deve ter entre 1 e 8 slides.')
    const serialized = JSON.stringify(settings)
    if (serialized.length > 70_000_000) throw new Error('As imagens do Design Dev excedem o limite de armazenamento.')
    for (const raw of value.bannerSlides) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Slide do Design Dev inválido.')
      const slide = raw as { id?: unknown; title?: unknown; subtitle?: unknown; imageDataUrl?: unknown }
      if (typeof slide.id !== 'string' || slide.id.length > 160 || typeof slide.title !== 'string' || slide.title.length > 80
        || typeof slide.subtitle !== 'string' || slide.subtitle.length > 120
        || (slide.imageDataUrl !== null && (typeof slide.imageDataUrl !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(slide.imageDataUrl)))) {
        throw new Error('Dados ou imagem inválidos em um slide do Design Dev.')
      }
    }
    await mkdir(join(app.getPath('userData'), 'fabricator', 'design-settings'), { recursive: true })
    await writeFile(join(app.getPath('userData'), 'fabricator', 'design-settings', 'settings.json'), JSON.stringify(settings, null, 2), 'utf8')
  })
  dataMigration = new DataMigrationService({
    dataRoot: app.getPath('appData'),
    userDataRoot: app.getPath('userData'),
    catalog: dataPlatform,
    onProgress: (progress) => {
      for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('app:data-migration:progress', progress)
    }
  })
  ipcMain.handle('app:data-storage-summary', async (event) => {
    assertTrustedSender(event)
    return { disk: await getAppDataUsage(app.getPath('appData')), catalog: dataPlatform.storageSummary() }
  })
  ipcMain.handle('app:data-backups:list', async (event) => {
    assertTrustedSender(event)
    if (!dataBackupService) throw new Error('Serviço de backup ainda não inicializado.')
    return dataBackupService.listBackups()
  })
  ipcMain.handle('app:data-backups:create', async (event) => {
    assertTrustedSender(event)
    if (!dataBackupService) throw new Error('Serviço de backup ainda não inicializado.')
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window && !window.webContents.isLoading()) await window.webContents.executeJavaScript('window.desktop?.flushPendingWrites?.()')
    const pending = [
      ...fabricatorSaveQueues.values(), ...poseSaveWrites, ...hairSaveQueues.values(), animatorSaveQueue,
      wardrobeSaveQueue, faceSaveQueue, expressionPresetSaveQueue, faceGuideSaveQueue, characterSaveQueue,
      studioSaveQueues.studio, studioSaveQueues.video
    ]
    const results = await Promise.allSettled(pending)
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failed) throw failed.reason
    return dataBackupService.createBackup()
  })
  ipcMain.handle('app:data-backups:verify', async (event, id: string) => {
    assertTrustedSender(event)
    if (!dataBackupService) throw new Error('Serviço de backup ainda não inicializado.')
    return dataBackupService.verifyBackup(id)
  })
  ipcMain.handle('app:data-backups:restore', async (event, id: string) => {
    assertTrustedSender(event)
    if (!dataBackupService) throw new Error('Serviço de backup ainda não inicializado.')
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: MessageBoxOptions = {
      type: 'warning', title: 'Restaurar dados',
      message: 'O app será reiniciado usando este backup. Antes disso, criará uma cópia de segurança do estado atual. A restauração só será concluída após o novo app abrir.',
      detail: 'Esse processo substitui as bibliotecas e os projetos atuais pelos dados do backup escolhido.',
      buttons: ['Restaurar e reiniciar', 'Cancelar'], defaultId: 1, cancelId: 1
    }
    const choice = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options)
    if (choice.response !== 0) return { cancelled: true }
    const safety = await dataBackupService.createBackup()
    const staged = await dataBackupService.stageRestore(id)
    app.relaunch()
    app.quit()
    return { cancelled: false, safetyBackupId: safety.id, ...staged }
  })
  ipcMain.handle('app:data-backups:delete', async (event, id: string) => {
    assertTrustedSender(event)
    if (!dataBackupService) throw new Error('Serviço de backup ainda não inicializado.')
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options: MessageBoxOptions = {
      type: 'warning', title: 'Excluir backup', message: 'Excluir este backup permanentemente?',
      detail: 'A exclusão não altera os dados atuais do aplicativo.', buttons: ['Excluir backup', 'Cancelar'], defaultId: 1, cancelId: 1
    }
    const choice = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options)
    if (choice.response !== 0) return { deleted: false }
    await dataBackupService.deleteBackup(id)
    return { deleted: true }
  })
  ipcMain.handle('app:data-migration:prepare', async (event) => {
    assertTrustedSender(event)
    if (!dataMigration) throw new Error('Serviço de migração ainda não inicializado.')
    return dataMigration.prepare()
  })
  ipcMain.handle('app:data-migration:run-all', async (event) => {
    assertTrustedSender(event)
    if (!dataMigration) throw new Error('Serviço de migração ainda não inicializado.')
    if (dataMigrationRunning) throw new Error('Uma migração já está em andamento.')
    dataMigrationRunning = true
    dataMigrationPauseRequested = false
    const outcomes: Array<{ domainId: string; state: string; fileCount: number; byteLength: number }> = []
    const task = (async () => {
      const prepared = await dataMigration.prepare()
      if (!prepared.hasEnoughSpace) throw new Error('Espaço livre insuficiente para validar os dados com segurança.')
      for (const domain of prepared.domains) {
        if (dataMigrationPauseRequested) break
        if (domain.state === 'active' || domain.state === 'verified') continue
        outcomes.push(await dataMigration.migrateDomain(domain.domainId))
      }
      return { outcomes, paused: dataMigrationPauseRequested, summary: await dataMigration.prepare() }
    })()
    dataMigrationTask = task
    try { return await task }
    finally { dataMigrationRunning = false; dataMigrationTask = null }
  })
  ipcMain.handle('app:data-migration:pause', async (event) => {
    assertTrustedSender(event)
    dataMigrationPauseRequested = true
    return { paused: dataMigrationRunning }
  })
  ipcMain.handle('app:data-migration:restart', async (event) => {
    assertTrustedSender(event)
    if (dataMigrationRunning) throw new Error('Aguarde a migração atual terminar antes de reiniciar.')
    const summary = await dataMigration?.prepare()
    if (!summary || summary.domains.some((domain) => domain.state !== 'active' && domain.state !== 'verified')) throw new Error('Ainda há domínios que não foram migrados.')
    app.relaunch()
    app.quit()
  })
  if (process.env.GACHA_DEV_AI_TEST === '1') {
    // Defense in depth for fixture-only Electron tests: no renderer-originated
    // HTTP(S), WebSocket or FTP traffic, including images or fetch calls.
    // This is NOT an OS firewall and does not confine Node subprocesses.
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const blocked = /^(?:https?|wss?|ftp):/i.test(details.url)
      callback({ cancel: blocked })
    })
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  }
  videoExportLibrary ??= new VideoExportLibrary(app.getPath('appData'))
  videoExportJobStore ??= new VideoExportJobStore(videoExportLibrary.jobRoot, (studioId, asset) =>
    videoLibrary.resolveProjectMediaDependency(studioId, asset.id, asset))
  videoExportSurfaceHost ??= new VideoExportSurfaceHost(videoExportJobStore, {
    preloadPath: join(__dirname, '../preload/video-export-preload.cjs'),
    ...(process.env.ELECTRON_RENDERER_URL
      ? { rendererUrl: process.env.ELECTRON_RENDERER_URL }
      : { rendererFile: join(__dirname, '../renderer/index.html') }),
  })
  videoExportCoordinator ??= new VideoExportCoordinator(
    videoExportJobStore,
    videoExportLibrary,
    videoExportSurfaceHost,
    (studioId, asset) => videoLibrary.resolveProjectMediaDependency(studioId, asset.id, asset),
    (progress: VideoExportProgress) => {
      const ownerId = videoExportJobOwners.get(progress.jobId)
      const owner = ownerId === undefined ? undefined : BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.id === ownerId)
      if (owner && !owner.isDestroyed()) owner.webContents.send('video-studio:export:progress', progress)
    },
  )
  registerVideoAssetProtocol()
  registerVideoBackgroundProtocol()
  await registerFabricatorHandlers()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let waitingForPersistenceWritesBeforeQuit = false
let persistenceWritesDrainedForQuit = false
app.on('before-quit', (event) => {
  if (persistenceWritesDrainedForQuit) return
  // Always prevent quit while an asynchronous drain is in flight. A second
  // before-quit must not bypass the first drain.
  event.preventDefault()
  if (waitingForPersistenceWritesBeforeQuit) return
  waitingForPersistenceWritesBeforeQuit = true
  const pendingWrites = [
    ...fabricatorSaveQueues.values(), ...poseSaveWrites, ...hairSaveQueues.values(),
    studioSaveQueues.studio, studioSaveQueues.video, roteirosSaveQueue,
    ...(dataMigrationTask ? [dataMigrationTask] : [])
  ]
  void Promise.allSettled(pendingWrites).then((results) => {
    waitingForPersistenceWritesBeforeQuit = false
    const failed = results.some((result) => result.status === 'rejected')
    if (failed) {
      // Do not report successful shutdown after a persistence failure.
      // Keep the application available for retry/recovery instead.
      if (!BrowserWindow.getAllWindows().some((window) => !window.isDestroyed())) createMainWindow()
      dialog.showErrorBox('Falha no salvamento', 'Uma gravação pendente falhou. O aplicativo permanecerá aberto para proteger suas alterações.')
      return
    }
    persistenceWritesDrainedForQuit = true
    dataPlatform.close()
    app.quit()
  })
})
