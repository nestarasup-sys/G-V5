import type { HairPartId } from './customizer'
import type { HairStyle, HairStyleSummary } from './fabricator'

export type HairAssetSide = 'front' | 'back' | 'fringe'

const legacyCategoryBySide: Record<HairAssetSide, HairPartId> = {
  front: 'rearHair',
  back: 'backHair',
  fringe: 'frontHair'
}

export const hairCategories: ReadonlyArray<{ id: HairPartId; label: string; side: HairAssetSide }> = [
  { id: 'backHair', label: 'Cabelo traseiro', side: 'back' },
  { id: 'rearHair', label: 'Cabelo posterior', side: 'front' },
  { id: 'ponytail', label: 'Rabo de cavalo', side: 'back' },
  { id: 'frontHair', label: 'Franja frontal', side: 'fringe' },
  { id: 'ahoge', label: 'Ahoge', side: 'fringe' }
]

export function hairStyleSupportsCategory(style: HairStyle | HairStyleSummary, category: HairPartId): boolean {
  const side = hairCategories.find((item) => item.id === category)?.side
  return Boolean(side && style[side] && (style.category === category || (!style.category && legacyCategoryBySide[side] === category)))
}
