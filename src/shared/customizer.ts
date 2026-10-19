import type { FaceComponentKind, FaceDetailKind, FaceElementKind, FaceTransform } from './fabricator'

export type HairColorRole = 'base' | 'fade' | 'outline' | 'highlight' | 'accent'
export type FaceComponentPartId = 'eye-left' | 'eye-right' | 'pupil-left' | 'pupil-right' | 'brow-left' | 'brow-right'
export type FacePalettePartId = 'nose' | 'mouth' | FaceDetailKind
export type HairPartId = 'backHair' | 'rearHair' | 'ponytail' | 'frontHair' | 'ahoge'
export type HairColorOverrides = Partial<Record<HairColorRole, string>>

export type CharacterCustomization = {
  /** Reference to the read-only Fabricator source selected for this character. */
  modelSlot: number | null
  poseSlot: number | null
  /** Optional per-character skin tint applied to the read-only model preview. */
  modelSkinTone?: string
  /** Proportions belong to this character; Fabricator models and poses stay unchanged. */
  proportions?: CharacterProportions
  /** Per-character body shaping for the Customizer model preview. */
  bodyDimensions?: CharacterBodyDimensions
  /** Character-only edits are stored here, never written to the Fabricator library. */
  partOverrides: Record<string, { x?: number; y?: number; scaleX?: number; scaleY?: number; rotation?: number; opacity?: number; hidden?: boolean }>
  layerOrder: string[]
  /** Garments are character-owned placements; pants stay one group across thigh and calf pieces. */
  wardrobeGroups?: CustomizerWardrobeGroup[]
  /** Preset palettes persist independently for each clothing slot; hair and face colors remain independent. */
  wardrobePalettes?: Partial<Record<CustomizerWardrobePaletteKey, HairColorOverrides>>
  /** Facial features chosen from the read-only face library, isolated per character. */
  faceAppearance?: CustomizerFaceAppearance
  /** Rear, posterior and fringe hair layers are selected independently per character. */
  hairAppearance?: {
    modelSlot: number
    styleId?: string
    frontStyleId?: string | null
    backStyleId?: string | null
    /** Character-only recoloring overrides for the selected raster hair assets. */
    colors?: HairColorOverrides
    /** Overrides by piece. A changed global role clears only that role from every piece. */
    partColors?: Partial<Record<HairPartId, HairColorOverrides>>
    /** Independent hair parts selected from Fabricator Dev's rear, posterior and fringe layers. */
    parts?: Partial<Record<HairPartId, string | null>>
  }
}

export type CharacterProportions = { scale: number; head: number; headWidth: number; headHeight: number; width: number; height: number }
export type CharacterBodyDimensions = { torsoWidth: number; torsoHeight: number; armsWidth: number; armsHeight: number; thighsWidth: number; thighsHeight: number; lowerLegsWidth: number; lowerLegsHeight: number; balance: number }
export const defaultCharacterBodyDimensions: CharacterBodyDimensions = { torsoWidth: 100, torsoHeight: 100, armsWidth: 100, armsHeight: 100, thighsWidth: 100, thighsHeight: 100, lowerLegsWidth: 100, lowerLegsHeight: 100, balance: 35 }
export const characterBodyDimensionLimits: Record<keyof CharacterBodyDimensions, { min: number; max: number }> = {
  torsoWidth: { min: 60, max: 160 }, torsoHeight: { min: 60, max: 160 },
  armsWidth: { min: 60, max: 160 }, armsHeight: { min: 60, max: 160 },
  thighsWidth: { min: 60, max: 160 }, thighsHeight: { min: 60, max: 160 },
  lowerLegsWidth: { min: 60, max: 160 }, lowerLegsHeight: { min: 60, max: 160 },
  balance: { min: 0, max: 100 }
}
export function getCharacterBodyDimensions(customization: CharacterCustomization | undefined): CharacterBodyDimensions {
  const values = customization?.bodyDimensions as (Partial<CharacterBodyDimensions> & { chestWidth?: number; chestHeight?: number; legsWidth?: number; legsHeight?: number }) | undefined
  return Object.fromEntries((Object.keys(defaultCharacterBodyDimensions) as Array<keyof CharacterBodyDimensions>).map((key) => {
    // Older panels had one control for both leg segments and called the torso "chest".
    const legacy = key === 'torsoWidth' ? values?.chestWidth : key === 'torsoHeight' ? values?.chestHeight
      : key === 'thighsWidth' || key === 'lowerLegsWidth' ? values?.legsWidth
        : key === 'thighsHeight' || key === 'lowerLegsHeight' ? values?.legsHeight : undefined
    const value = values?.[key] ?? legacy
    const { min, max } = characterBodyDimensionLimits[key]
    return [key, typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : defaultCharacterBodyDimensions[key]]
  })) as CharacterBodyDimensions
}
export const defaultCharacterProportions: CharacterProportions = { scale: 100, head: 100, headWidth: 100, headHeight: 100, width: 100, height: 100 }
export const characterProportionLimits: Record<keyof CharacterProportions, { min: number; max: number }> = {
  scale: { min: 50, max: 150 },
  head: { min: 60, max: 150 },
  headWidth: { min: 60, max: 140 },
  headHeight: { min: 60, max: 140 },
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
  /** Independent eye sheets for future one-eye-at-a-time authoring; fall back to eyeCatalogId for legacy characters. */
  eyeLeftCatalogId?: string | null
  eyeRightCatalogId?: string | null
  eyebrowCatalogId?: string
  /** Independent brow sheets for future one-brow-at-a-time authoring; fall back to eyebrowCatalogId for legacy characters. */
  eyebrowLeftCatalogId?: string | null
  eyebrowRightCatalogId?: string | null
  /** Character-only recoloring for each independently selected facial feature. */
  partColors?: Partial<Record<'eye-left' | 'eye-right' | 'brow-left' | 'brow-right', HairColorOverrides>>
  /** New single-image face assets selected independently for this character. */
  components?: Partial<Record<FaceComponentPartId, { assetId: string | null; transform?: FaceTransform; colors?: HairColorOverrides; manualColorRoles?: HairColorRole[] }>>
  /** Character-owned placement for pieces from catalog sheets. */
  transforms?: Partial<Record<FaceElementKind, FaceTransform>>
  /** Independently selected face details managed by Rosto Dev. */
  faceDetails?: Partial<Record<FaceDetailKind, string | null>>
  /** Head accessory assets from Cabeças extra dev, selectable by Customizer category. */
  headExtras?: Partial<Record<'glasses' | 'head-accessory', string | null>>
  /** Per-piece color palette for nose, mouth, and face details. */
  facePalettes?: Partial<Record<FacePalettePartId, HairColorOverrides>>
  /** Roles the user changed manually; these may recolor near-white pixels. */
  facePaletteManualRoles?: Partial<Record<FacePalettePartId, HairColorRole[]>>
  /** Right side mirrors the left asset by default; each feature can be unlinked. */
  linkedSides?: Partial<Record<FaceComponentKind, boolean>>
  noseCatalogId?: string
  /** Nose-only skin tone override; the character model skin tone remains unchanged. */
  noseSkinTone?: string
  /** Opacity of the selected nose asset, from 0 (transparent) to 1 (opaque). */
  noseOpacity?: number
  /** Character-level switch for mouth blush in the Studio base and expression presets. */
  mouthBlushEnabled?: boolean
  /** Shared mouth blush tone and strength used across the base and expression presets. */
  mouthBlushColor?: string
  mouthBlushOpacity?: number
  mouthClosedCatalogId?: string
  mouthOpenCatalogId?: string
  eyeState: 0 | 1 | 2
  eyebrows: boolean
  noseIndex: number
  expressionIndex: number
  mouthOpen: boolean
}

export type CustomizerWardrobeCategory = 'camisa' | 'jaqueta' | 'manga-superior' | 'manga-inferior' | 'luvas' | 'capa' | 'cinto' | 'oculos' | 'acessorio-cabeca' | 'saia' | 'saia-superior' | 'saia-inferior' | 'calca' | 'shorts' | 'meia' | 'sapato'
export type CustomizerWardrobePaletteKey = 'shirt' | 'jacket' | 'upper-left' | 'upper-right' | 'lower-left' | 'lower-right' | 'gloves-left' | 'gloves-right' | 'cape' | 'belt' | 'glasses' | 'head-accessory' | 'skirt' | 'pants-left' | 'shorts-right' | 'sock-left' | 'sock-right' | 'shoe-left' | 'shoe-right' | 'lower-skirt'
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
  /** Bone frame in which this character-only adjustment was authored. */
  adjustmentReference?: { version: 1; boneId: string; width: number; height: number; rotation: number }
  /** Per-character dimming used to temporarily de-emphasize one garment piece. */
  opacity?: number
  /** Soft deletion from Adjust: omit this component from the preview while keeping it restorable. */
  hidden?: boolean
  /** Color overrides belong to this individual garment component. */
  colors?: HairColorOverrides
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
