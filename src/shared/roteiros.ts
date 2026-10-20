export type RoteiroTikTok = {
  id: string
  title: string
  videoTitle: string
  video?: RoteiroVideoReference | null
  blocks?: RoteiroReactionBlock[]
  description?: string
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
}
