export type RoteiroTikTok = {
  id: string
  title: string
  videoTitle: string
}

export type RoteiroDocument = {
  id: string
  title: string
  videoTitle: string
  characterIds: string[]
  tiktoks: RoteiroTikTok[]
}

export type RoteirosDesktopApi = {
  listRoteiros: () => Promise<RoteiroDocument[]>
  saveRoteiros: (roteiros: RoteiroDocument[]) => Promise<void>
}
