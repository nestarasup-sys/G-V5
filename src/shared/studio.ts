import type { CustomizerFaceAppearance } from './customizer'

export type StudioAsset = {
  id: string
  category: 'background' | 'object' | 'character'
  name: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  dataUrl: string
}

/** Studio-local adjustment shared by both eyes and all their expression frames. */
export type StudioFaceTransform = { x: number; y: number; width: number; height: number; rotation: number }

export type StudioElement = {
  id: string
  kind: 'image' | 'character' | 'narrator' | 'speech' | 'thought'
  assetId?: string
  characterId?: string
  flipX?: boolean
  /** Face choices made to this actor inside this Studio only. */
  faceAppearance?: CustomizerFaceAppearance
  /** Face-piece transforms are stored on the Studio actor, never on its source character. */
  faceTransforms?: Partial<Record<'eyes', StudioFaceTransform>>
  text: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  zIndex: number
}

export type StudioDocument = {
  schemaVersion: 1
  id: string
  title: string
  color: string
  createdAt: string
  updatedAt: string
  backgroundColor: string
  backgroundAssetId: string | null
  backgroundX: number
  backgroundY: number
  backgroundWidth: number
  backgroundHeight: number
  backgroundRotation: number
  assets: StudioAsset[]
  elements: StudioElement[]
}

export type StudioDesktopApi = {
  listStudios: () => Promise<StudioDocument[]>
  saveStudio: (studio: StudioDocument) => Promise<void>
  deleteStudio: (id: string) => Promise<void>
  getStudioFolder: () => Promise<string>
  importStudioImage: (category: StudioAsset['category']) => Promise<StudioAsset | null>
  saveStudioPrint: (studioId: string, dataUrl: string) => Promise<string | null>
  openStudioPrints: (studioId: string) => Promise<void>
}
