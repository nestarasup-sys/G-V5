export type RoteiroTikTok = {
  id: string
  title: string
  videoTitle: string
  video?: RoteiroVideoReference | null
  blocks?: RoteiroReactionBlock[]
  description?: string
  timeline?: RoteiroTimeline
  sceneEndSeconds?: number
  firstGroupReactionSeconds?: number
  secondGroupReactionSeconds?: number
  additionalContext?: string
}

export type RoteiroVideoReference = {
  id: string
  name: string
  mimeType: 'video/mp4' | 'video/webm' | 'video/quicktime' | 'video/x-m4v'
  extension: 'mp4' | 'webm' | 'mov' | 'm4v'
  size: number
  durationFrames: number
}

export type RoteiroReactionBlock = {
  id: string
  characterId: string
  kind: 'fala' | 'pensamento'
  expression: string
  textPortuguese: string
  textEnglish: string
}

export type RoteiroSectionContent = {
  video: RoteiroVideoReference | null
  blocks: RoteiroReactionBlock[]
  description?: string
  timeline?: RoteiroTimeline
  sceneEndSeconds?: number
  firstGroupReactionSeconds?: number
  secondGroupReactionSeconds?: number
  additionalContext?: string
}

export type RoteiroTimeline = 'unspecified' | 'past' | 'present' | 'future'

export type BaseVideoDetails = {
  videoId: string
  videoNumber?: number
  categoryId?: string | null
  description: string
  timeline: RoteiroTimeline
  sceneEndSeconds?: number
  firstGroupReactionSeconds?: number
  secondGroupReactionSeconds?: number
  additionalContext?: string
}

export type BaseVideoCategory = { id: string; name: string; color: string; createdAt: string }
export type RoteiroExportLog = { id: string; roteiroId: string; createdAt: string; action: string; status: 'success' | 'error'; details: string }

export type RoteiroDocument = {
  id: string
  title: string
  videoTitle: string
  characterIds: string[]
  backgroundAssetId?: string | null
  uiGifAssetId?: string | null
  previewDetailsCollapsed?: boolean
  opening?: RoteiroSectionContent
  tiktoks: RoteiroTikTok[]
}

export type RoteiroExportCharacterInfo = {
  id: string
  name: string
  modelSlot: number
  hair: string
  outfit: string
  skin: string
  hasFaceAppearance: boolean
  poseSlots: number[]
  expressions: string[]
}

export type RoteiroUiGifItem = { id: string; name: string; size: number; createdAt: string; builtIn?: boolean; available: boolean }

export type RoteirosDesktopApi = {
  listRoteiros: () => Promise<RoteiroDocument[]>
  saveRoteiros: (roteiros: RoteiroDocument[]) => Promise<void>
  listBaseVideoDetails: () => Promise<BaseVideoDetails[]>
  saveBaseVideoDetails: (details: BaseVideoDetails) => Promise<void>
  listBaseVideoCategories: () => Promise<BaseVideoCategory[]>
  createBaseVideoCategory: (name: string) => Promise<BaseVideoCategory>
  renameBaseVideoCategory: (id: string, name: string) => Promise<BaseVideoCategory>
  deleteBaseVideoCategory: (id: string) => Promise<void>
  listRoteiroExportLogs: (roteiroId: string) => Promise<RoteiroExportLog[]>
  appendRoteiroExportLog: (roteiroId: string, entry: RoteiroExportLog) => Promise<void>
  clearRoteiroExportLogs: (roteiroId: string) => Promise<void>
  deleteBaseVideoDetails: (videoId: string) => Promise<void>
  deleteBaseVideo: (videoId: string) => Promise<void>
  publishBaseVideo: (videoId: string) => Promise<number>
  startRoteiroCharacterExport: (request: { id: string; title: string; characters: Array<{ id: string; name: string }> }) => Promise<{ jobId: string; folderName: string; assetCountLimit: number }>
  writeRoteiroCharacterExportAsset: (jobId: string, asset: { characterId: string; pose: number; expression: string; role: 'base' | 'blink' | 'talk' | 'pt' | 'pt-blink' | 'pt-talk'; dataUrl: string }) => Promise<void>
  finishRoteiroCharacterExport: (jobId: string) => Promise<{ folderName: string; path: string; characters: number; files: number }>
  cancelRoteiroCharacterExport: (jobId: string) => Promise<void>
  exportRoteiroAssets: (request: { roteiro: RoteiroDocument; kind: 'background' | 'videos' | 'script' | 'gif'; characters?: RoteiroExportCharacterInfo[] }) => Promise<{ path: string; files: number }>
  openRoteiroExportFolder: (request: { roteiro: RoteiroDocument; kind: 'characters' | 'background' | 'videos' | 'script' | 'ui' }) => Promise<void>
  listRoteiroUiGifs: () => Promise<RoteiroUiGifItem[]>
  importRoteiroUiGif: () => Promise<RoteiroUiGifItem | null>
  deleteRoteiroUiGif: (id: string) => Promise<void>
}
