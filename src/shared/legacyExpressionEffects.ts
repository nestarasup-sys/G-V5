import legacyEffects from './legacyStandardEffects.json'
import type { FaceExpressionEffects, FaceExpressionPreset } from './fabricator'

/** The original project's active Ayla profile, indexed by its 7 × 3 mouth-sheet order. */
export function legacyStandardExpressionEffects(preset: Pick<FaceExpressionPreset, 'modelSlot' | 'collectionId' | 'expressionIndex'>): FaceExpressionEffects | undefined {
  if (preset.modelSlot !== 1 || preset.collectionId !== 'standard' || !Number.isInteger(preset.expressionIndex)) return undefined
  const effects = legacyEffects[preset.expressionIndex!]
  return effects ? structuredClone(effects) as FaceExpressionEffects : undefined
}
