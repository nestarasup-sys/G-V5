import type { FabricatorProject, FabricatorPose, WardrobeSet } from './fabricator'
import type { CharacterCustomization, CustomizerWardrobeGroup } from './customizer'

export type AssetFlowIssueCode =
  | 'model-slot-mismatch' | 'missing-source-bone' | 'missing-pose-bone'
  | 'binding-bone-mismatch' | 'missing-binding' | 'invalid-binding'
  | 'missing-component' | 'missing-set' | 'invalid-character-offset'
  | 'pose-source-mismatch' | 'model-revision-mismatch'

export type AssetFlowIssue = {
  code: AssetFlowIssueCode
  severity: 'error' | 'warning'
  componentId?: string
  setId?: string
  boneId?: string
}

export type WardrobeFlowCheck = {
  ok: boolean
  issues: AssetFlowIssue[]
  resolved: number
}

/**
 * Pure preflight: Fabricator sets are read-only sources, Customizer stores its
 * own delta and a posed renderer must resolve the same IDs in both rigs.
 * No storage writes, hidden fallback, or silent component filtering.
 */
export function validateWardrobeFlow(
  set: Pick<WardrobeSet, 'id' | 'modelSlot' | 'components'>,
  source: Pick<FabricatorProject, 'slot' | 'parts' | 'updatedAt'>,
  pose: Pick<FabricatorPose, 'sourceModelSlot' | 'sourceModelUpdatedAt' | 'parts'>,
  groups: ReadonlyArray<CustomizerWardrobeGroup>
): WardrobeFlowCheck {
  const issues: AssetFlowIssue[] = []
  if (set.modelSlot !== source.slot || pose.sourceModelSlot !== source.slot) {
    issues.push({ code: 'model-slot-mismatch', severity: 'error', setId: set.id })
  }
  if (pose.sourceModelUpdatedAt && source.updatedAt && pose.sourceModelUpdatedAt !== source.updatedAt) {
    issues.push({ code: 'model-revision-mismatch', severity: 'warning', setId: set.id })
  }
  const sourceBones = new Map(source.parts.map((part) => [part.id, part]))
  const poseBones = new Map(pose.parts.map((part) => [part.id, part]))
  const components = new Map(set.components.map((component) => [component.id, component]))
  const visited = new Set<string>()
  let resolved = 0
  for (const group of groups) {
    if (group.setId !== set.id || group.modelSlot !== set.modelSlot || group.hidden) continue
    const selected = group.componentId ? [components.get(group.componentId)] : set.components
    for (const component of selected) {
      if (!component) {
        issues.push({ code: 'missing-component', severity: 'error', componentId: group.componentId, setId: set.id })
        continue
      }
      if (visited.has(component.id)) continue
      visited.add(component.id)
      if (!sourceBones.has(component.attachedPartId)) {
        issues.push({ code: 'missing-source-bone', severity: 'error', componentId: component.id, boneId: component.attachedPartId, setId: set.id })
        continue
      }
      if (!poseBones.has(component.attachedPartId)) {
        issues.push({ code: 'missing-pose-bone', severity: 'error', componentId: component.id, boneId: component.attachedPartId, setId: set.id })
        continue
      }
      if (!component.binding) {
        issues.push({ code: 'missing-binding', severity: 'warning', componentId: component.id, boneId: component.attachedPartId, setId: set.id })
      } else if (component.binding.boneId !== component.attachedPartId) {
        issues.push({ code: 'binding-bone-mismatch', severity: 'error', componentId: component.id, boneId: component.attachedPartId, setId: set.id })
        continue
      } else if (![component.binding.boneWidth, component.binding.boneHeight, component.binding.localCenterX,
        component.binding.localCenterY, component.binding.widthRatio, component.binding.heightRatio,
        component.binding.relativeRotation].every(Number.isFinite)
        || component.binding.boneWidth <= 0 || component.binding.boneHeight <= 0
        || component.binding.widthRatio <= 0 || component.binding.heightRatio <= 0) {
        issues.push({ code: 'invalid-binding', severity: 'error', componentId: component.id, boneId: component.attachedPartId, setId: set.id })
        continue
      }
      if (![group.offsetX, group.offsetY, group.scaleX, group.scaleY, group.rotation].every(Number.isFinite)
        || group.scaleX <= 0 || group.scaleY <= 0) {
        issues.push({ code: 'invalid-character-offset', severity: 'error', componentId: component.id, setId: set.id })
        continue
      }
      resolved += 1
    }
  }
  return { ok: issues.every((issue) => issue.severity !== 'error'), issues, resolved }
}

export type CatalogAssetLocator = { modelSlot: number; setId: string; componentId: string }

/** Character-only fitting deltas must not mutate Fabricator's wardrobe source. */
export function applyCharacterWardrobeAdjustment(
  customization: CharacterCustomization,
  locator: CatalogAssetLocator,
  adjustment: Partial<Pick<CustomizerWardrobeGroup, 'offsetX' | 'offsetY' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity' | 'hidden'>>
): CharacterCustomization {
  const before = customization.wardrobeGroups ?? []
  const match = (group: CustomizerWardrobeGroup) => group.modelSlot === locator.modelSlot
    && group.setId === locator.setId && group.componentId === locator.componentId
  if (!before.some(match)) throw new Error('A peça não está equipada neste personagem.')
  const revised = before.map((group) => {
    if (!match(group)) return group
    const after = { ...group, ...adjustment }
    if (![after.offsetX, after.offsetY, after.scaleX, after.scaleY, after.rotation].every(Number.isFinite)
      || after.scaleX <= 0 || after.scaleY <= 0 || after.opacity !== undefined
      && (!Number.isFinite(after.opacity) || after.opacity < 0 || after.opacity > 1)) {
      throw new Error('Ajuste individual inválido.')
    }
    return after
  })
  return { ...customization, wardrobeGroups: revised }
}
