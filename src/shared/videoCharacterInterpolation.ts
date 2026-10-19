import type { CustomizerFaceAppearance } from './customizer'
import type { FaceExpressionEffect, FaceExpressionEffects, FaceTransform, JointLink, ModelPart } from './fabricator'
import type { StudioElement, StudioFaceTransforms } from './studio'

export type PoseArtwork = { width: number; height: number; parts: ModelPart[]; joints?: JointLink[]; layerOrder?: string[]; hiddenPartIds?: string[] }

export const mix = (a: number, b: number, t: number) => a + (b - a) * t
export const mixAngle = (a: number, b: number, t: number) => a + (((b - a) % 360 + 540) % 360 - 180) * t
export const smoothProgress = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t) }

/** Work in fractional timeline frames; transition windows are half-open at their authored boundary. */
export function transitionProgress(transition: { startFrame: number; boundaryFrame: number }, frame: number): number {
  return Math.max(0, Math.min(1, (frame - transition.startFrame) / (transition.boundaryFrame - transition.startFrame)))
}

export function mixFaceTransform(a: FaceTransform, b: FaceTransform, t: number): FaceTransform {
  return { x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), scaleX: mix(a.scaleX, b.scaleX, t), scaleY: mix(a.scaleY, b.scaleY, t), rotation: mixAngle(a.rotation, b.rotation, t), flipX: t < .5 ? a.flipX : b.flipX }
}

export function mixStudioTransforms(a: StudioFaceTransforms, b: StudioFaceTransforms, t: number): StudioFaceTransforms {
  const neutral = { x: 0, y: 0, width: 100, height: 100, rotation: 0 }
  return Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map((key) => {
    const left = a[key] ?? neutral, right = b[key] ?? neutral
    return [key, { x: mix(left.x, right.x, t), y: mix(left.y, right.y, t), width: mix(left.width, right.width, t), height: mix(left.height, right.height, t), rotation: mixAngle(left.rotation, right.rotation, t),
      ...(left.sourceTransformOverride && right.sourceTransformOverride ? { sourceTransformOverride: mixFaceTransform(left.sourceTransformOverride, right.sourceTransformOverride, t) } : {}) }]
  }))
}

function mixColor(a: string, b: string, t: number) {
  return '#' + [1, 3, 5].map((index) => Math.round(mix(parseInt(a.slice(index, index + 2), 16), parseInt(b.slice(index, index + 2), 16), t)).toString(16).padStart(2, '0')).join('')
}

export function mixEffects(a: FaceExpressionEffects | undefined, b: FaceExpressionEffects | undefined, t: number): FaceExpressionEffects {
  return Object.fromEntries((['shadow', 'blush', 'mouthBlush'] as const).map((key) => {
    const fallback: FaceExpressionEffect = { enabled: false, color: '#000000', opacity: 0, softness: .5, size: .1, offsetX: 0, offsetY: 0 }
    const left = a?.[key] ?? { ...(b?.[key] ?? fallback), enabled: false, opacity: 0 }
    const right = b?.[key] ?? { ...left, enabled: false, opacity: 0 }
    const effect = { ...(t < .5 ? left : right), enabled: left.enabled || right.enabled, opacity: mix(left.enabled ? left.opacity : 0, right.enabled ? right.opacity : 0, t), color: mixColor(left.color, right.color, t) }
    for (const field of ['softness', 'size', 'offsetX', 'offsetY', 'aspectRatio', 'width', 'height', 'rotation'] as const) {
      const av = left[field] ?? right[field], bv = right[field] ?? left[field]
      if (av !== undefined && bv !== undefined) effect[field] = field === 'rotation' ? mixAngle(av, bv, t) : mix(av, bv, t)
    }
    return [key, effect]
  })) as FaceExpressionEffects
}

export function mixAppearance(a: CustomizerFaceAppearance, b: CustomizerFaceAppearance, t: number): CustomizerFaceAppearance {
  const result = structuredClone(t < .5 ? a : b)
  result.noseOpacity = mix(a.noseOpacity ?? 1, b.noseOpacity ?? 1, t)
  for (const key of Object.keys(result.transforms ?? {}) as Array<keyof NonNullable<typeof result.transforms>>) {
    const left = a.transforms?.[key], right = b.transforms?.[key]
    if (left && right) result.transforms![key] = mixFaceTransform(left, right, t)
  }
  for (const key of Object.keys(result.components ?? {}) as Array<keyof NonNullable<typeof result.components>>) {
    const left = a.components?.[key]?.transform, right = b.components?.[key]?.transform
    if (left && right && a.components?.[key]?.assetId === b.components?.[key]?.assetId) result.components![key]!.transform = mixFaceTransform(left, right, t)
  }
  return result
}

export function mixStageElement(a: StudioElement, b: StudioElement, t: number): StudioElement {
  const element = { ...(t < .5 ? a : b) }
  for (const field of ['x', 'y', 'width', 'height'] as const) element[field] = mix(a[field], b[field], t)
  element.rotation = mixAngle(a.rotation, b.rotation, t)
  for (const field of ['characterScale', 'characterWidthScale', 'characterHeightScale'] as const) element[field] = mix(a[field] ?? 100, b[field] ?? 100, t)
  if (a.characterCanvasWidth && b.characterCanvasWidth) element.characterCanvasWidth = mix(a.characterCanvasWidth, b.characterCanvasWidth, t)
  return element
}

type Point = { x: number; y: number }
function localPoint(part: ModelPart, point: Point): Point {
  const angle = part.rotation * Math.PI / 180, dx = point.x - part.x - part.width / 2, dy = point.y - part.y - part.height / 2
  return { x: (dx * Math.cos(angle) + dy * Math.sin(angle)) / part.width, y: (-dx * Math.sin(angle) + dy * Math.cos(angle)) / part.height }
}
function worldPoint(part: ModelPart, point: Point): Point {
  const angle = part.rotation * Math.PI / 180, x = point.x * part.width, y = point.y * part.height
  return { x: part.x + part.width / 2 + x * Math.cos(angle) - y * Math.sin(angle), y: part.y + part.height / 2 + x * Math.sin(angle) + y * Math.cos(angle) }
}
const mixPoint = (a: Point, b: Point, t: number) => ({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) })

/** Interpolate articulated parts, then constrain matching parent/child joint anchors. */
export function mixPoseArtwork(a: PoseArtwork, b: PoseArtwork, t: number): PoseArtwork {
  if (t <= 0) return a
  if (t >= 1) return b
  const left = new Map(a.parts.map((part) => [part.id, part])), right = new Map(b.parts.map((part) => [part.id, part]))
  const parts = [...new Set([...left.keys(), ...right.keys()])].filter((id) => left.has(id) && right.has(id) || (t < .5 ? left.has(id) : right.has(id))).map((id) => {
    const av = left.get(id), bv = right.get(id)
    if (!av || !bv) return { ...(av ?? bv)! }
    return { ...(t < .5 ? av : bv), x: mix(av.x, bv.x, t), y: mix(av.y, bv.y, t), width: mix(av.width, bv.width, t), height: mix(av.height, bv.height, t), rotation: mixAngle(av.rotation, bv.rotation, t), ...(av.jointAnchor && bv.jointAnchor ? { jointAnchor: mixPoint(av.jointAnchor, bv.jointAnchor, t) } : {}) }
  })
  const current = new Map(parts.map((part) => [part.id, part]))
  const otherJoints = new Map((b.joints ?? []).map((joint) => [`${joint.parentPartId}:${joint.childPartId}`, joint]))
  const joints: JointLink[] = []
  const visited = new Set<string>(), visiting = new Set<string>()
  const solve = (id: string) => {
    if (visited.has(id) || visiting.has(id)) return
    visiting.add(id)
    const joint = a.joints?.find((item) => item.childPartId === id)
    const target = joint && otherJoints.get(`${joint.parentPartId}:${id}`)
    if (joint && target && !visiting.has(joint.parentPartId)) {
      solve(joint.parentPartId)
      const ap = left.get(joint.parentPartId), ac = left.get(id), bp = right.get(joint.parentPartId), bc = right.get(id), parent = current.get(joint.parentPartId), child = current.get(id)
      if (ap && ac && bp && bc && parent && child) {
        const parentAnchor = worldPoint(parent, mixPoint(localPoint(ap, joint.parentAnchor), localPoint(bp, target.parentAnchor), t))
        const childAnchor = worldPoint(child, mixPoint(localPoint(ac, joint.childAnchor), localPoint(bc, target.childAnchor), t))
        // Preserve deliberate separation present in the source poses, including hands/feet.
        const gap = mixPoint({ x: joint.childAnchor.x - joint.parentAnchor.x, y: joint.childAnchor.y - joint.parentAnchor.y }, { x: target.childAnchor.x - target.parentAnchor.x, y: target.childAnchor.y - target.parentAnchor.y }, t)
        const dx = parentAnchor.x + gap.x - childAnchor.x, dy = parentAnchor.y + gap.y - childAnchor.y
        child.x += dx; child.y += dy
        if (child.jointAnchor) child.jointAnchor = { x: child.jointAnchor.x + dx, y: child.jointAnchor.y + dy }
        const adjustedChild = { x: childAnchor.x + dx, y: childAnchor.y + dy }
        joints.push({ ...joint, parentAnchor, childAnchor: adjustedChild, pivot: mixPoint(parentAnchor, adjustedChild, .5) })
      }
    }
    visiting.delete(id); visited.add(id)
  }
  parts.forEach((part) => solve(part.id))
  return { width: mix(a.width, b.width, t), height: mix(a.height, b.height, t), parts, joints, layerOrder: t < .5 ? a.layerOrder : b.layerOrder, hiddenPartIds: t < .5 ? a.hiddenPartIds : b.hiddenPartIds }
}
