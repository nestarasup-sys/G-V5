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
}

export type RoteiroTimeline = 'unspecified' | 'past' | 'present' | 'future'

export type BaseVideoDetails = {
  videoId: string
  videoNumber?: number
  description: string
  timeline: RoteiroTimeline
  sceneEndSeconds?: number
  firstGroupReactionSeconds?: number
  secondGroupReactionSeconds?: number
}

export type RoteiroDocument = {
  id: string
  title: string
  videoTitle: string
  characterIds: string[]
  opening?: RoteiroSectionContent
  tiktoks: RoteiroTikTok[]
}

export type RoteirosDesktopApi = {
  listRoteiros: () => Promise<RoteiroDocument[]>
  saveRoteiros: (roteiros: RoteiroDocument[]) => Promise<void>
  listBaseVideoDetails: () => Promise<BaseVideoDetails[]>
  saveBaseVideoDetails: (details: BaseVideoDetails) => Promise<void>
  deleteBaseVideoDetails: (videoId: string) => Promise<void>
  deleteBaseVideo: (videoId: string) => Promise<void>
  publishBaseVideo: (videoId: string) => Promise<number>
  startRoteiroCharacterExport: (request: { id: string; title: string; characters: Array<{ id: string; name: string }> }) => Promise<{ jobId: string; folderName: string; assetCountLimit: number }>
  writeRoteiroCharacterExportAsset: (jobId: string, asset: { characterId: string; pose: number; expression: string; role: 'base' | 'blink' | 'talk'; dataUrl: string }) => Promise<void>
  finishRoteiroCharacterExport: (jobId: string) => Promise<{ folderName: string; path: string; characters: number; files: number }>
  cancelRoteiroCharacterExport: (jobId: string) => Promise<void>
}
