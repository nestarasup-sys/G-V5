import type { JointLink, ModelPart } from '../../../../shared/fabricator'
import type { CharacterBodyDimensions } from '../../../../shared/customizer'
import { resizeAroundAnchor } from '../../../../shared/headShape'
import { autoConnectParts } from '../fabricator/models/rig'

type Point = { x: number; y: number }
type BodyArtwork = { width: number; height: number; parts: ModelPart[]; joints?: JointLink[] }
type BodyGroup = 'torso' | 'head' | 'arms' | 'legs' | 'unknown'

const center = (part: ModelPart): Point => ({ x: part.x + part.width / 2, y: part.y + part.height / 2 })

function groupOf(part: ModelPart): BodyGroup {
  if (/tronco|corpo|torso|chest|peito/i.test(part.name)) return 'torso'
  if (/cabe[çc]a|head/i.test(part.name)) return 'head'
  if (/bra[cç]o|m[aã]o|arm|hand/i.test(part.name)) return 'arms'
  if (/coxa|perna|canela|panturrilha|joelho|p[eé]|thigh|calf|leg|foot|knee/i.test(part.name)) return 'legs'
  return 'unknown'
}

/** Map a canvas point through the same resize and translation used to draw a part. */
function mapPoint(before: ModelPart, after: ModelPart, point: Point): Point {
  const origin = center(before)
  const target = center(after)
  const angle = before.rotation * Math.PI / 180
  const cosine = Math.cos(angle), sine = Math.sin(angle)
  const dx = point.x - origin.x, dy = point.y - origin.y
  const localX = dx * cosine + dy * sine
  const localY = -dx * sine + dy * cosine
  const scaledX = localX * after.width / before.width
  const scaledY = localY * after.height / before.height
  return { x: target.x + scaledX * cosine - scaledY * sine, y: target.y + scaledX * sine + scaledY * cosine }
}

function translated<T extends ModelPart>(part: T, dx: number, dy: number): T {
  return { ...part, x: part.x + dx, y: part.y + dy }
}

function rotatedBounds(part: ModelPart) {
  const angle = part.rotation * Math.PI / 180
  const halfWidth = (Math.abs(Math.cos(angle)) * part.width + Math.abs(Math.sin(angle)) * part.height) / 2
  const halfHeight = (Math.abs(Math.sin(angle)) * part.width + Math.abs(Math.cos(angle)) * part.height) / 2
  const point = center(part)
  return { left: point.x - halfWidth, top: point.y - halfHeight, right: point.x + halfWidth, bottom: point.y + halfHeight }
}

/**
 * The torso is the root. A child resizes around its own incoming joint, then
 * follows the displacement of that joint on the transformed parent. This also
 * moves unchanged descendants such as the head, face anchor and lower limbs.
 */
export function applyCharacterBodyShape<T extends BodyArtwork>(artwork: T, dimensions: CharacterBodyDimensions): T {
  const { torsoWidth, torsoHeight, armsWidth, armsHeight, legsWidth, legsHeight, balance } = dimensions
  if ([torsoWidth, torsoHeight, armsWidth, armsHeight, legsWidth, legsHeight].every((value) => value === 100)) return artwork
  if (!artwork.parts.length) return artwork

  const joints = artwork.joints?.length ? artwork.joints : autoConnectParts(artwork.parts)
  const torso = artwork.parts.find((part) => groupOf(part) === 'torso')
    ?? artwork.parts.find((part) => !joints.some((joint) => joint.childPartId === part.id))
    ?? artwork.parts[0]
  const body = new Map(artwork.parts.map((part) => [part.id, part]))
  const children = new Map<string, JointLink[]>()
  for (const joint of joints) {
    if (!body.has(joint.parentPartId) || !body.has(joint.childPartId)) continue
    const list = children.get(joint.parentPartId) ?? []
    list.push(joint)
    children.set(joint.parentPartId, list)
  }

  const influence = balance / 100
  const scales: Record<'torso' | 'head' | 'arms' | 'legs', Point> = {
    torso: {
      x: (torsoWidth + influence * (.12 * (armsWidth - 100) + .18 * (legsWidth - 100))) / 100,
      y: (torsoHeight + influence * (.08 * (armsHeight - 100) + .12 * (legsHeight - 100))) / 100
    },
    head: { x: 1, y: 1 },
    arms: { x: armsWidth / 100, y: armsHeight / 100 },
    legs: { x: legsWidth / 100, y: legsHeight / 100 }
  }
  const result = new Map<string, ModelPart>()

  function visit(part: ModelPart, incoming?: JointLink, inherited: BodyGroup = 'unknown') {
    if (result.has(part.id)) return
    const named = groupOf(part)
    const location = center(part)
    const group: BodyGroup = part.id === torso.id ? 'torso'
      : named !== 'unknown' ? named
        : inherited !== 'unknown' ? inherited
          : location.y < torso.y + torso.height * .15 ? 'head'
            : location.y > torso.y + torso.height * .65 ? 'legs' : 'arms'
    const scale = scales[group]
    const attachment = incoming?.childAnchor ?? center(part)
    let shaped = resizeAroundAnchor(part, part.width * scale.x, part.height * scale.y, attachment)
    if (incoming) {
      const parent = body.get(incoming.parentPartId)
      const shapedParent = result.get(incoming.parentPartId)
      if (parent && shapedParent) {
        // The child's anchor is the anatomical connection. Fabricator can use
        // one shared parent pivot for every joint, so parentAnchor alone cannot
        // distinguish shoulder, neck and hip attachment points.
        const target = mapPoint(parent, shapedParent, attachment)
        shaped = translated(shaped, target.x - attachment.x, target.y - attachment.y)
      }
    }
    result.set(part.id, { ...shaped, ...(part.jointAnchor ? { jointAnchor: mapPoint(part, shaped, part.jointAnchor) } : {}) })
    for (const joint of children.get(part.id) ?? []) {
      const child = body.get(joint.childPartId)
      if (child) visit(child, joint, group)
    }
  }

  visit(torso)
  for (const part of artwork.parts) visit(part)
  const parts = artwork.parts.map((part) => result.get(part.id) ?? part)
  const transformedJoints = artwork.joints?.map((joint) => {
    const parent = body.get(joint.parentPartId), child = body.get(joint.childPartId)
    const newParent = result.get(joint.parentPartId), newChild = result.get(joint.childPartId)
    if (!parent || !child || !newParent || !newChild) return joint
    const parentAnchor = mapPoint(parent, newParent, joint.parentAnchor)
    const childAnchor = mapPoint(child, newChild, joint.childAnchor)
    return { ...joint, parentAnchor, childAnchor, pivot: { x: (parentAnchor.x + childAnchor.x) / 2, y: (parentAnchor.y + childAnchor.y) / 2 } }
  })
  // Keep extreme sizes and rotated poses inside the exported/preview canvas.
  const bounds = parts.map(rotatedBounds)
  const bodyLeft = Math.min(...bounds.map((item) => item.left))
  const bodyTop = Math.min(...bounds.map((item) => item.top))
  const bodyRight = Math.max(...bounds.map((item) => item.right))
  const bodyBottom = Math.max(...bounds.map((item) => item.bottom))
  const margin = 16 // Leave room for garments slightly larger than their body piece.
  const left = bodyLeft < 0 ? bodyLeft - margin : 0
  const top = bodyTop < 0 ? bodyTop - margin : 0
  const right = bodyRight > artwork.width ? bodyRight + margin : artwork.width
  const bottom = bodyBottom > artwork.height ? bodyBottom + margin : artwork.height
  const offsetX = -left, offsetY = -top
  const shiftedParts = offsetX || offsetY ? parts.map((part) => ({
    ...part, x: part.x + offsetX, y: part.y + offsetY,
    ...(part.jointAnchor ? { jointAnchor: { x: part.jointAnchor.x + offsetX, y: part.jointAnchor.y + offsetY } } : {})
  })) : parts
  const shiftedJoints = transformedJoints && (offsetX || offsetY) ? transformedJoints.map((joint) => ({
    ...joint,
    parentAnchor: { x: joint.parentAnchor.x + offsetX, y: joint.parentAnchor.y + offsetY },
    childAnchor: { x: joint.childAnchor.x + offsetX, y: joint.childAnchor.y + offsetY },
    ...(joint.pivot ? { pivot: { x: joint.pivot.x + offsetX, y: joint.pivot.y + offsetY } } : {})
  })) : transformedJoints
  return { ...artwork, width: Math.ceil(right - left), height: Math.ceil(bottom - top), parts: shiftedParts, ...(shiftedJoints ? { joints: shiftedJoints } : {}) }
}
