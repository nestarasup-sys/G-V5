export type CharacterCustomization = {
  /** Reference to the read-only Fabricator source selected for this character. */
  modelSlot: number | null
  poseSlot: number | null
  /** Character-only edits are stored here, never written to the Fabricator library. */
  partOverrides: Record<string, { x?: number; y?: number; scaleX?: number; scaleY?: number; rotation?: number; hidden?: boolean }>
  layerOrder: string[]
  /** Garments are character-owned placements; pants stay one group across thigh and calf pieces. */
  wardrobeGroups?: CustomizerWardrobeGroup[]
}

export type CustomizerWardrobeCategory = 'camisa' | 'manga-superior' | 'manga-inferior' | 'calca' | 'shorts'
export type CustomizerWardrobeGroup = {
  modelSlot: number
  setId: string
  category: CustomizerWardrobeCategory
  offsetX: number
  offsetY: number
  scaleX: number
  scaleY: number
  rotation: number
}

export type CustomizerCharacter = {
  id: string
  name: string
  hair: string
  outfit: string
  skin: string
  customization: CharacterCustomization
  createdAt: string
  updatedAt: string
}

export type CustomizerDesktopApi = {
  listCustomizerCharacters: () => Promise<CustomizerCharacter[]>
  saveCustomizerCharacter: (character: CustomizerCharacter) => Promise<void>
  createCustomizerCharacter: (name: string) => Promise<CustomizerCharacter>
  deleteCustomizerCharacter: (id: string) => Promise<void>
}
