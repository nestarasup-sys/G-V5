export type CharacterCustomization = {
  /** Reference to the read-only Fabricator source selected for this character. */
  modelSlot: number | null
  poseSlot: number | null
  /** Optional per-character skin tint applied to the read-only model preview. */
  modelSkinTone?: string
  /** Proportions belong to this character; Fabricator models and poses stay unchanged. */
  proportions?: CharacterProportions
  /** Character-only edits are stored here, never written to the Fabricator library. */
  partOverrides: Record<string, { x?: number; y?: number; scaleX?: number; scaleY?: number; rotation?: number; hidden?: boolean }>
  layerOrder: string[]
  /** Garments are character-owned placements; pants stay one group across thigh and calf pieces. */
  wardrobeGroups?: CustomizerWardrobeGroup[]
  /** Facial features chosen from the read-only face library, isolated per character. */
  faceAppearance?: CustomizerFaceAppearance
  /** Front and back hair styles are selected independently per character. styleId reads legacy whole-style selections. */
  hairAppearance?: { modelSlot: number; styleId?: string; frontStyleId?: string | null; backStyleId?: string | null }
}

export type CharacterProportions = { scale: number; head: number; width: number; height: number }
export const defaultCharacterProportions: CharacterProportions = { scale: 100, head: 100, width: 100, height: 100 }
export const characterProportionLimits: Record<keyof CharacterProportions, { min: number; max: number }> = {
  scale: { min: 50, max: 150 },
  head: { min: 60, max: 150 },
  width: { min: 60, max: 140 },
  height: { min: 60, max: 140 }
}
export function getCharacterProportions(customization: CharacterCustomization | undefined): CharacterProportions {
  const values = customization?.proportions
  return Object.fromEntries((Object.keys(defaultCharacterProportions) as Array<keyof CharacterProportions>).map((key) => {
    const value = values?.[key]
    const { min, max } = characterProportionLimits[key]
    return [key, typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : 100]
  })) as CharacterProportions
}

export type CustomizerFaceAppearance = {
  modelSlot: number
  /** Legacy complete-face selection, kept readable for existing characters. */
  setId?: string
  /** Each prepared sheet is selected independently from the Fabricator face catalog. */
  eyeCatalogId?: string
  eyebrowCatalogId?: string
  noseCatalogId?: string
  mouthClosedCatalogId?: string
  mouthOpenCatalogId?: string
  eyeState: 0 | 1 | 2
  eyebrows: boolean
  noseIndex: number
  expressionIndex: number
  mouthOpen: boolean
}

export type CustomizerWardrobeCategory = 'camisa' | 'manga-superior' | 'manga-inferior' | 'calca' | 'shorts'
export type CustomizerWardrobeGroup = {
  modelSlot: number
  setId: string
  category: CustomizerWardrobeCategory
  /** New placements are independent per garment component; missing means a legacy whole-category placement. */
  componentId?: string
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
