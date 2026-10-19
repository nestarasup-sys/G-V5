import type { CustomizerWardrobeGroup } from './customizer'
import type { ModelPart, WardrobeComponent } from './fabricator'

type Bone = Pick<ModelPart, 'id' | 'x' | 'y' | 'width' | 'height' | 'rotation'>
type Linear = [number, number, number, number]
type Point = { x: number; y: number }
type Adjustment = Pick<CustomizerWardrobeGroup, 'offsetX' | 'offsetY' | 'scaleX' | 'scaleY' | 'rotation'>
export type WardrobeAdjustmentMatrix = [number, number, number, number, number, number]

const identity: Linear = [1, 0, 0, 1]
const multiply = (a: Linear, b: Linear): Linear => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3]
]
const rotate = (degrees: number): Linear => {
  const angle = degrees * Math.PI / 180
  return [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle)]
}
const inverse = (m: Linear): Linear => {
  const determinant = m[0] * m[3] - m[1] * m[2]
  return [m[3] / determinant, -m[1] / determinant, -m[2] / determinant, m[0] / determinant]
}
const point = (m: Linear, p: Point): Point => ({ x: m[0] * p.x + m[2] * p.y, y: m[1] * p.x + m[3] * p.y })
const adjustmentLinear = (group: Adjustment): Linear => multiply(rotate(group.rotation), [group.scaleX, 0, 0, group.scaleY])

export function validWardrobeAdjustmentReference(reference: NonNullable<CustomizerWardrobeGroup['adjustmentReference']>): boolean {
  return !!reference && reference.version === 1 && typeof reference.boneId === 'string'
    && reference.boneId.length > 0 && reference.boneId.length <= 120
    && [reference.width, reference.height, reference.rotation].every(Number.isFinite)
    && reference.width > 0 && reference.height > 0
}

/** Transport from the adjustment's original bone frame to the current pose. */
function poseTransport(group: CustomizerWardrobeGroup, bone?: Bone): Linear {
  const reference = group.adjustmentReference
  if (!reference || !bone || bone.width <= 0 || bone.height <= 0 || reference.boneId !== bone.id || !validWardrobeAdjustmentReference(reference)) return identity
  if (bone.width === reference.width && bone.height === reference.height && bone.rotation === reference.rotation) return identity
  return multiply(multiply(rotate(bone.rotation), [bone.width / reference.width, 0, 0, bone.height / reference.height]), rotate(-reference.rotation))
}

/** Conjugating the whole affine adjustment preserves nonuniform scaling too. */
export function wardrobeAdjustmentMatrix(group: CustomizerWardrobeGroup, bone: Bone | undefined, center: Point): WardrobeAdjustmentMatrix {
  const transport = poseTransport(group, bone)
  const linear = multiply(multiply(transport, adjustmentLinear(group)), inverse(transport))
  const offset = point(transport, { x: group.offsetX, y: group.offsetY })
  const pivot = point(linear, center)
  return [...linear, center.x + offset.x - pivot.x, center.y + offset.y - pivot.y]
}

/** Arrows and pointer drags remain screen-directed after changing poses. */
export function moveWardrobeAdjustment(group: CustomizerWardrobeGroup, bone: Bone | undefined, delta: Point): CustomizerWardrobeGroup {
  const local = point(inverse(poseTransport(group, bone)), delta)
  return { ...group, offsetX: group.offsetX + local.x, offsetY: group.offsetY + local.y }
}

export function editWardrobeAdjustment(group: CustomizerWardrobeGroup, bone: Bone | undefined, patch: Partial<Adjustment>, displayed: Adjustment = group): CustomizerWardrobeGroup {
  const moved = moveWardrobeAdjustment(group, bone, {
    x: patch.offsetX === undefined ? 0 : patch.offsetX - displayed.offsetX,
    y: patch.offsetY === undefined ? 0 : patch.offsetY - displayed.offsetY
  })
  const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
  return { ...group, ...defined, offsetX: moved.offsetX, offsetY: moved.offsetY }
}

/**
 * Upgrade legacy screen adjustments using the currently displayed pose. Split
 * whole-category placements and rebase their pivots without changing pixels.
 * Nothing is inferred about the historical pose of an already saved edit.
 */
export function anchorWardrobeAdjustments(
  groups: readonly CustomizerWardrobeGroup[], modelSlot: number, bones: readonly Bone[],
  componentsFor: (group: CustomizerWardrobeGroup) => readonly WardrobeComponent[]
): CustomizerWardrobeGroup[] {
  return groups.flatMap((group) => {
    if (group.modelSlot !== modelSlot || group.adjustmentReference) return [group]
    const components = componentsFor(group)
    const pieces = components.flatMap((component) => {
      const bone = bones.find((part) => part.id === component.attachedPartId)
      return bone && bone.width > 0 && bone.height > 0 ? [{ component, bone }] : []
    })
    if (!pieces.length || pieces.length !== components.length) return [group]
    const center = pieces.reduce((sum, { bone }) => ({
      x: sum.x + (bone.x + bone.width / 2) / pieces.length,
      y: sum.y + (bone.y + bone.height / 2) / pieces.length
    }), { x: 0, y: 0 })
    const linear = adjustmentLinear(group)
    return pieces.map(({ component, bone }) => {
      const delta = { x: center.x - bone.x - bone.width / 2, y: center.y - bone.y - bone.height / 2 }
      const transformed = point(linear, delta)
      return { ...group, componentId: component.id,
        offsetX: group.offsetX + delta.x - transformed.x,
        offsetY: group.offsetY + delta.y - transformed.y,
        adjustmentReference: { version: 1 as const, boneId: bone.id, width: bone.width, height: bone.height, rotation: bone.rotation }
      }
    })
  })
}
