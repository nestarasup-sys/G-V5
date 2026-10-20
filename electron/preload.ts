import { contextBridge, ipcRenderer } from 'electron'
import type { FabricatorDesktopApi } from '../src/shared/fabricator'
import type { CustomizerDesktopApi } from '../src/shared/customizer'
import type { StudioDesktopApi, VideoStudioDesktopApi } from '../src/shared/studio'
import type { VideoExportProgress } from '../src/shared/videoExportRuntime'
import type { RoteirosDesktopApi } from '../src/shared/roteiros'

const fabricatorApi: FabricatorDesktopApi = {
  listFabricatorSlots: () => ipcRenderer.invoke('fabricator:list-slots'),
  importFabricatorModel: (slot) => ipcRenderer.invoke('fabricator:import-model', slot),
  loadFabricatorSlot: (slot) => ipcRenderer.invoke('fabricator:load-slot', slot),
  saveFabricatorProject: (project, changedAssets) => ipcRenderer.invoke('fabricator:save-project', project, changedAssets),
  loadFabricatorHistory: (slot) => ipcRenderer.invoke('fabricator:load-history', slot),
  saveFabricatorHistory: (slot, history, current, changedAssets) => ipcRenderer.invoke('fabricator:save-history', slot, history, current, changedAssets),
  deleteFabricatorSlot: (slot) => ipcRenderer.invoke('fabricator:delete-slot', slot),
  listFabricatorPoseSlots: (modelSlot) => ipcRenderer.invoke('fabricator:poses:list', modelSlot),
  getFabricatorExportPoseSlots: (modelSlot) => ipcRenderer.invoke('fabricator:poses:export-slots:get', modelSlot),
  saveFabricatorExportPoseSlots: (modelSlot, slots) => ipcRenderer.invoke('fabricator:poses:export-slots:save', modelSlot, slots),
  loadFabricatorPose: (modelSlot, slot) => ipcRenderer.invoke('fabricator:poses:load', modelSlot, slot),
  saveFabricatorPose: (modelSlot, slot, project, assets) => ipcRenderer.invoke('fabricator:poses:save', modelSlot, slot, project, assets),
  deleteFabricatorPose: (modelSlot, slot) => ipcRenderer.invoke('fabricator:poses:delete', modelSlot, slot),
  loadFabricatorPoseDraft: (modelSlot) => ipcRenderer.invoke('fabricator:poses:draft:load', modelSlot),
  saveFabricatorPoseDraft: (modelSlot, draft, assets) => ipcRenderer.invoke('fabricator:poses:draft:save', modelSlot, draft, assets),
  deleteFabricatorPoseDraft: (modelSlot) => ipcRenderer.invoke('fabricator:poses:draft:delete', modelSlot),
  listAnimatorModelSlots: () => ipcRenderer.invoke('fabricator:animator:model-slots'),
  listAnimatorAnimations: (modelSlot) => ipcRenderer.invoke('fabricator:animator:list', modelSlot),
  loadAnimatorAnimation: (modelSlot, slot) => ipcRenderer.invoke('fabricator:animator:load', modelSlot, slot),
  saveAnimatorAnimation: (modelSlot, slot, animation, assets) => ipcRenderer.invoke('fabricator:animator:save', modelSlot, slot, animation, assets),
  deleteAnimatorAnimation: (modelSlot, slot) => ipcRenderer.invoke('fabricator:animator:delete', modelSlot, slot),
  loadAnimatorDraft: (modelSlot) => ipcRenderer.invoke('fabricator:animator:draft:load', modelSlot),
  saveAnimatorDraft: (modelSlot, draft, assets) => ipcRenderer.invoke('fabricator:animator:draft:save', modelSlot, draft, assets),
  deleteAnimatorDraft: (modelSlot) => ipcRenderer.invoke('fabricator:animator:draft:delete', modelSlot),
  listWardrobeSets: (modelSlot) => ipcRenderer.invoke('fabricator:wardrobe:list', modelSlot),
  loadWardrobeSet: (modelSlot, id) => ipcRenderer.invoke('fabricator:wardrobe:load', modelSlot, id),
  saveWardrobeSet: (modelSlot, set, assets) => ipcRenderer.invoke('fabricator:wardrobe:save', modelSlot, set, assets),
  deleteWardrobeSet: (modelSlot, id) => ipcRenderer.invoke('fabricator:wardrobe:delete', modelSlot, id),
  listFaceSets: (modelSlot) => ipcRenderer.invoke('fabricator:face:list', modelSlot),
  loadFaceSet: (modelSlot, id) => ipcRenderer.invoke('fabricator:face:load', modelSlot, id),
  saveFaceSet: (modelSlot, set, assets) => ipcRenderer.invoke('fabricator:face:save', modelSlot, set, assets),
  deleteFaceSet: (modelSlot, id) => ipcRenderer.invoke('fabricator:face:delete', modelSlot, id),
  listFaceCatalog: (modelSlot) => ipcRenderer.invoke('fabricator:face-catalog:list', modelSlot),
  loadFaceCatalogItem: (modelSlot, id) => ipcRenderer.invoke('fabricator:face-catalog:load', modelSlot, id),
  saveFaceCatalogItem: (modelSlot, item, assets) => ipcRenderer.invoke('fabricator:face-catalog:save', modelSlot, item, assets),
  deleteFaceCatalogItem: (modelSlot, id) => ipcRenderer.invoke('fabricator:face-catalog:delete', modelSlot, id),
  listFaceExpressionPresets: (modelSlot) => ipcRenderer.invoke('fabricator:expression-presets:list', modelSlot),
  listFaceExpressionCollections: (modelSlot) => ipcRenderer.invoke('fabricator:expression-collections:list', modelSlot),
  saveFaceExpressionCollection: (modelSlot, collection) => ipcRenderer.invoke('fabricator:expression-collections:save', modelSlot, collection),
  loadFaceExpressionPreset: (modelSlot, id) => ipcRenderer.invoke('fabricator:expression-presets:load', modelSlot, id),
  saveFaceExpressionPreset: (modelSlot, preset) => ipcRenderer.invoke('fabricator:expression-presets:save', modelSlot, preset),
  deleteFaceExpressionPreset: (modelSlot, id) => ipcRenderer.invoke('fabricator:expression-presets:delete', modelSlot, id),
  saveFaceAnimationExport: (modelSlot, data) => ipcRenderer.invoke('fabricator:face-animation:export', modelSlot, data),
  loadFaceExpressionWorkspaceDraft: (modelSlot) => ipcRenderer.invoke('fabricator:expression-workspace:load', modelSlot),
  saveFaceExpressionWorkspaceDraft: (modelSlot, draft) => ipcRenderer.invoke('fabricator:expression-workspace:save', modelSlot, draft),
  listFaceComponentAssets: (modelSlot, kind) => ipcRenderer.invoke('fabricator:face-components:list', modelSlot, kind),
  loadFaceComponentAsset: (modelSlot, id) => ipcRenderer.invoke('fabricator:face-components:load', modelSlot, id),
  saveFaceComponentAsset: (modelSlot, asset, dataUrl) => ipcRenderer.invoke('fabricator:face-components:save', modelSlot, asset, dataUrl),
  deleteFaceComponentAsset: (modelSlot, id) => ipcRenderer.invoke('fabricator:face-components:delete', modelSlot, id),
  loadFaceGuides: (profile) => ipcRenderer.invoke('fabricator:face-guides:load', profile),
  saveFaceGuides: (profile, guides) => ipcRenderer.invoke('fabricator:face-guides:save', profile, guides),
  loadHairWorkspace: (modelSlot) => ipcRenderer.invoke('fabricator:hair:load', modelSlot),
  saveHairWorkspace: (modelSlot, workspace, assets) => ipcRenderer.invoke('fabricator:hair:save', modelSlot, workspace, assets),
  listHairStyles: (modelSlot) => ipcRenderer.invoke('fabricator:hair:styles:list', modelSlot),
  loadHairStyle: (modelSlot, id) => ipcRenderer.invoke('fabricator:hair:styles:load', modelSlot, id),
  saveHairStyle: (modelSlot, style, assets) => ipcRenderer.invoke('fabricator:hair:styles:save', modelSlot, style, assets),
  deleteHairStyle: (modelSlot, id) => ipcRenderer.invoke('fabricator:hair:styles:delete', modelSlot, id)
}

const customizerApi: CustomizerDesktopApi = {
  listCustomizerCharacters: () => ipcRenderer.invoke('customizer:characters:list'),
  saveCustomizerCharacter: (character) => ipcRenderer.invoke('customizer:characters:save', character),
  createCustomizerCharacter: (name) => ipcRenderer.invoke('customizer:characters:create', name),
  deleteCustomizerCharacter: (id) => ipcRenderer.invoke('customizer:characters:delete', id)
}

const studioApi: StudioDesktopApi = {
  flushPendingWrites: () => ipcRenderer.invoke('app:flush-pending-writes'),
  listStudios: () => ipcRenderer.invoke('studio:list'),
  saveStudio: (studio) => ipcRenderer.invoke('studio:save', studio),
  deleteStudio: (id) => ipcRenderer.invoke('studio:delete', id),
  getStudioFolder: () => ipcRenderer.invoke('studio:folder'),
  importStudioImage: (category) => ipcRenderer.invoke('studio:import-image', category),
  saveStudioPrint: (studioId, dataUrl) => ipcRenderer.invoke('studio:save-print', studioId, dataUrl),
  openStudioPrints: (studioId) => ipcRenderer.invoke('studio:open-prints', studioId)
}

const videoStudioApi: VideoStudioDesktopApi = {
  listVideoStudios: () => ipcRenderer.invoke('video-studio:list'),
  loadVideoStudio: (id) => ipcRenderer.invoke('video-studio:get', id),
  saveVideoStudio: (studio) => ipcRenderer.invoke('video-studio:save', studio),
  deleteVideoStudio: (id) => ipcRenderer.invoke('video-studio:delete', id),
  getVideoStudioFolder: () => ipcRenderer.invoke('video-studio:folder'),
  importVideoStudioImage: (category) => ipcRenderer.invoke('video-studio:import-image', category),
  listVideoLibrary: () => ipcRenderer.invoke('video-studio:video-library:list'),
  importVideoLibrary: () => ipcRenderer.invoke('video-studio:video-library:import'),
  finishVideoLibraryImport: (id, durationFrames) => ipcRenderer.invoke('video-studio:video-library:finish', id, durationFrames),
  deleteVideoLibraryItem: (id) => ipcRenderer.invoke('video-studio:video-library:delete', id),
  renameVideoLibraryItem: (id, name) => ipcRenderer.invoke('video-studio:video-library:rename', id, name),
  attachVideoLibraryItems: (studioId, ids) => ipcRenderer.invoke('video-studio:video-library:attach', studioId, ids),
  prepareVideoPreviewMedia: (studioId, asset) => ipcRenderer.invoke('video-studio:preview-media:prepare', studioId, asset),
  listVideoBackgroundLibrary: () => ipcRenderer.invoke('video-studio:background-library:list'),
  importVideoBackground: () => ipcRenderer.invoke('video-studio:background-library:import'),
  deleteVideoBackground: (id) => ipcRenderer.invoke('video-studio:background-library:delete', id),
  attachVideoBackground: (studioId, id) => ipcRenderer.invoke('video-studio:background-library:attach', studioId, id),
  saveVideoStudioPrint: (studioId, dataUrl) => ipcRenderer.invoke('video-studio:save-print', studioId, dataUrl),
  openVideoStudioPrints: (studioId) => ipcRenderer.invoke('video-studio:open-prints', studioId),
  listVideoExports: () => ipcRenderer.invoke('video-studio:exports:list'),
  openVideoExportsFolder: (studioId) => ipcRenderer.invoke('video-studio:exports:open-folder', studioId),
  deleteVideoExport: (id) => ipcRenderer.invoke('video-studio:exports:delete', id),
  startVideoExport: (request) => ipcRenderer.invoke('video-studio:export:start', request),
  cancelVideoExport: (jobId) => ipcRenderer.invoke('video-studio:export:cancel', jobId),
  getVideoExportStatus: (jobId) => ipcRenderer.invoke('video-studio:export:status', jobId),
  onVideoExportProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: VideoExportProgress) => callback(progress)
    ipcRenderer.on('video-studio:export:progress', listener)
    return () => ipcRenderer.removeListener('video-studio:export:progress', listener)
  },
  listRecoverableVideoExports: () => ipcRenderer.invoke('video-studio:export:recoverable'),
  resumeVideoExport: (jobId) => ipcRenderer.invoke('video-studio:export:resume', jobId),
  discardVideoExportRecovery: (jobId) => ipcRenderer.invoke('video-studio:export:discard-recovery', jobId)
}

const roteirosApi: RoteirosDesktopApi = {
  listRoteiros: () => ipcRenderer.invoke('roteiros:list'),
  saveRoteiros: (roteiros) => ipcRenderer.invoke('roteiros:save', roteiros),
  listBaseVideoDetails: () => ipcRenderer.invoke('base-videos:list-details'),
  saveBaseVideoDetails: (details) => ipcRenderer.invoke('base-videos:save-details', details),
  listBaseVideoCategories: () => ipcRenderer.invoke('base-videos:categories:list'),
  createBaseVideoCategory: (name) => ipcRenderer.invoke('base-videos:categories:create', name),
  renameBaseVideoCategory: (id, name) => ipcRenderer.invoke('base-videos:categories:rename', id, name),
  deleteBaseVideoCategory: (id) => ipcRenderer.invoke('base-videos:categories:delete', id),
  listRoteiroExportLogs: (roteiroId) => ipcRenderer.invoke('roteiros:export-logs:list', roteiroId),
  appendRoteiroExportLog: (roteiroId, entry) => ipcRenderer.invoke('roteiros:export-logs:append', roteiroId, entry),
  clearRoteiroExportLogs: (roteiroId) => ipcRenderer.invoke('roteiros:export-logs:clear', roteiroId),
  deleteBaseVideoDetails: (videoId) => ipcRenderer.invoke('base-videos:delete-details', videoId),
  deleteBaseVideo: (videoId) => ipcRenderer.invoke('base-videos:delete', videoId),
  publishBaseVideo: (videoId) => ipcRenderer.invoke('base-videos:publish', videoId),
  startRoteiroCharacterExport: (request) => ipcRenderer.invoke('roteiros:characters-export:start', request),
  writeRoteiroCharacterExportAsset: (jobId, asset) => ipcRenderer.invoke('roteiros:characters-export:asset', jobId, asset),
  finishRoteiroCharacterExport: (jobId) => ipcRenderer.invoke('roteiros:characters-export:finish', jobId),
  cancelRoteiroCharacterExport: (jobId) => ipcRenderer.invoke('roteiros:characters-export:cancel', jobId),
  exportRoteiroAssets: (request) => ipcRenderer.invoke('roteiros:assets-export', request),
  openRoteiroExportFolder: (request) => ipcRenderer.invoke('roteiros:export-folder:open', request),
  listRoteiroUiGifs: () => ipcRenderer.invoke('roteiros:ui-gifs:list'),
  importRoteiroUiGif: () => ipcRenderer.invoke('roteiros:ui-gifs:import'),
  deleteRoteiroUiGif: (id) => ipcRenderer.invoke('roteiros:ui-gifs:delete', id)
}

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  appName: 'Gacha Nymi',
  normalizeImageForImport: (bytes: Uint8Array) => ipcRenderer.invoke('app:image:normalize', bytes),
  loadFabricatorDesignSettings: () => ipcRenderer.invoke('fabricator:design-settings:load'),
  saveFabricatorDesignSettings: (settings: unknown) => ipcRenderer.invoke('fabricator:design-settings:save', settings),
  getAppDataStorageSummary: () => ipcRenderer.invoke('app:data-storage-summary'),
  getDataMigrationSummary: () => ipcRenderer.invoke('app:data-migration:prepare'),
  runDataMigration: () => ipcRenderer.invoke('app:data-migration:run-all'),
  pauseDataMigration: () => ipcRenderer.invoke('app:data-migration:pause'),
  restartAfterDataMigration: () => ipcRenderer.invoke('app:data-migration:restart'),
  onDataMigrationProgress: (callback: (progress: { domainId: string; completedFiles: number; totalFiles: number; completedBytes: number; totalBytes: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { domainId: string; completedFiles: number; totalFiles: number; completedBytes: number; totalBytes: number }) => callback(progress)
    ipcRenderer.on('app:data-migration:progress', listener)
    return () => ipcRenderer.removeListener('app:data-migration:progress', listener)
  },
  listDataBackups: () => ipcRenderer.invoke('app:data-backups:list'),
  createDataBackup: () => ipcRenderer.invoke('app:data-backups:create'),
  verifyDataBackup: (id: string) => ipcRenderer.invoke('app:data-backups:verify', id),
  restoreDataBackup: (id: string) => ipcRenderer.invoke('app:data-backups:restore', id),
  deleteDataBackup: (id: string) => ipcRenderer.invoke('app:data-backups:delete', id),
  ...fabricatorApi,
  ...customizerApi,
  ...studioApi,
  ...videoStudioApi,
  ...roteirosApi
})
