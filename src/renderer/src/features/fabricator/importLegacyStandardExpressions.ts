import legacyExpressions from './legacyStandardExpressions.json'
import type { FaceExpressionPreset, FaceExpressionTransforms, FaceTransform } from '../../../../shared/fabricator'
import { legacyStandardExpressionEffects } from '../../../../shared/legacyExpressionEffects'

type Side = 'left' | 'right'
type LegacyTransform = { scaleX: number; scaleY: number; rotation: number; x: number; y: number }
type LegacyExpression = { key: string; name: string; index: number; eyes: Record<Side, LegacyTransform>; eyebrows: Record<Side, LegacyTransform>; mouth: LegacyTransform }

/** Convert the old 1000px face-editor offsets to a head-relative delta. */
function applyLegacyDelta(base: FaceTransform, source: LegacyTransform, headWidth: number, headHeight: number): FaceTransform {
  return {
    ...base,
    x: base.x + source.x * headWidth / 1000,
    y: base.y + source.y * headHeight / 1000,
    scaleX: base.scaleX * source.scaleX,
    scaleY: base.scaleY * source.scaleY,
    rotation: base.rotation + source.rotation
  }
}

/**
 * The legacy editor authored eyes as one composite layer. Its eye transform
 * therefore moves/scales/rotates both the new eye and its independently
 * selected pupil; pupil-local calibration itself remains untouched.
 */
export function importLegacyStandardExpressions(
  modelSlot: number,
  selections: FaceExpressionPreset['selections'],
  base: FaceExpressionTransforms,
  head: { width: number; height: number },
  mouthPieces: Array<{ sheet: string; index: number }>,
  existingByIndex: Map<number, FaceExpressionPresetSummaryLike>,
  noseOpacity: number,
  updatedAt: string
): FaceExpressionPreset[] {
  return (legacyExpressions as LegacyExpression[]).map((legacy) => {
    const transforms: FaceExpressionTransforms = structuredClone(base)
    for (const side of ['left', 'right'] as const) {
      const suffix = side === 'left' ? 'Left' : 'Right'
      transforms[`eye${suffix}`] = applyLegacyDelta(base[`eye${suffix}`], legacy.eyes[side], head.width, head.height)
      transforms[`brow${suffix}`] = applyLegacyDelta(base[`brow${suffix}`], legacy.eyebrows[side], head.width, head.height)
    }
    transforms.mouth = applyLegacyDelta(base.mouth, legacy.mouth, head.width, head.height)
    const mouthKind = selections.mouth?.kind
    const mouthIndex = mouthKind && mouthPieces.some((piece) => piece.sheet === mouthKind && piece.index === legacy.index)
      ? legacy.index
      : selections.mouth?.index ?? 0
    const previous = existingByIndex.get(legacy.index)
    return {
      schemaVersion: 1,
      id: previous?.id ?? crypto.randomUUID(),
      modelSlot,
      name: legacy.name,
      collectionId: 'standard',
      expressionIndex: legacy.index,
      selections: { ...structuredClone(selections), mouth: selections.mouth ? { ...selections.mouth, index: mouthIndex } : null },
      transforms,
      referenceTransforms: structuredClone(base),
      noseOpacity,
      effects: legacyStandardExpressionEffects({ modelSlot, collectionId: 'standard', expressionIndex: legacy.index }),
      updatedAt
    }
  })
}

type FaceExpressionPresetSummaryLike = { id: string; expressionIndex?: number }
