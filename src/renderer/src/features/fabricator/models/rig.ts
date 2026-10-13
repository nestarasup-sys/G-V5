import type { JointLink, ModelPart } from '../../../../../shared/fabricator'

type Point = { x: number; y: number }

const center = (part: ModelPart): Point => ({ x: part.x + part.width / 2, y: part.y + part.height / 2 })

function edgePoint(part: ModelPart, target: ModelPart): Point {
  const origin = center(part)
  const destination = center(target)
  const dx = destination.x - origin.x
  const dy = destination.y - origin.y
  const horizontal = Math.abs(dx / Math.max(1, part.width)) > Math.abs(dy / Math.max(1, part.height))
  return horizontal
    ? { x: origin.x + Math.sign(dx || 1) * part.width / 2, y: origin.y + dy * part.width / (2 * Math.max(1, Math.abs(dx))) }
    : { x: origin.x + dx * part.height / (2 * Math.max(1, Math.abs(dy))), y: origin.y + Math.sign(dy || 1) * part.height / 2 }
}

export function createJoint(parent: ModelPart, child: ModelPart, suggested = false): JointLink {
  const parentAnchor = edgePoint(parent, child)
  const childAnchor = edgePoint(child, parent)
  return {
    id: crypto.randomUUID(), parentPartId: parent.id, childPartId: child.id,
    parentAnchor, childAnchor,
    pivot: { x: (parentAnchor.x + childAnchor.x) / 2, y: (parentAnchor.y + childAnchor.y) / 2 },
    suggested
  }
}

export function jointPivot(joint: JointLink): Point {
  return joint.pivot ?? { x: (joint.parentAnchor.x + joint.childAnchor.x) / 2, y: (joint.parentAnchor.y + joint.childAnchor.y) / 2 }
}

export function normalizeLayerOrder(parts: ModelPart[], order?: string[]): string[] {
  const valid = new Set(parts.map((part) => part.id))
  const normalized = (order ?? []).filter((id, index, list) => valid.has(id) && list.indexOf(id) === index)
  for (const part of parts) if (!normalized.includes(part.id)) normalized.push(part.id)
  return normalized
}

export function orderedParts(parts: ModelPart[], order?: string[]): ModelPart[] {
  const byId = new Map(parts.map((part) => [part.id, part]))
  return normalizeLayerOrder(parts, order).flatMap((id) => {
    const part = byId.get(id)
    return part ? [part] : []
  })
}

/**
 * Finds the body center, then connects head, arms, forearms, thighs, and lower
 * legs by their actual position on the uploaded sheet. Unnamed pieces are
 * attached to the nearest already-connected piece so the result stays usable.
 */
export function autoConnectParts(parts: ModelPart[]): JointLink[] {
  if (parts.length < 2) return []
  const sheetLeft = Math.min(...parts.map((part) => part.x))
  const sheetRight = Math.max(...parts.map((part) => part.x + part.width))
  const sheetTop = Math.min(...parts.map((part) => part.y))
  const sheetBottom = Math.max(...parts.map((part) => part.y + part.height))
  const sheetWidth = Math.max(1, sheetRight - sheetLeft)
  const sheetHeight = Math.max(1, sheetBottom - sheetTop)
  const sheetCenterX = (sheetLeft + sheetRight) / 2

  const torso = parts.find((part) => /tronco|corpo/i.test(part.name))
    ?? [...parts].sort((a, b) => {
      const score = (part: ModelPart) => {
        const point = center(part)
        const areaPenalty = part.width * part.height / (sheetWidth * sheetHeight)
        return Math.hypot((point.x - sheetCenterX) / sheetWidth, (point.y - (sheetTop + sheetHeight * 0.38)) / sheetHeight) - areaPenalty * 0.4
      }
      return score(a) - score(b)
    })[0]
  const torsoCenter = center(torso)
  const torsoBottom = torso.y + torso.height
  const head = parts.find((part) => /cabeça|cabeca/i.test(part.name))
    ?? parts.filter((part) => part.id !== torso.id && center(part).y < torsoCenter.y)
      .sort((a, b) => Math.abs(center(a).x - torsoCenter.x) - Math.abs(center(b).x - torsoCenter.x))[0]

  const joints: JointLink[] = []
  const connected = new Set<string>([torso.id])
  const linkedChildren = new Set<string>()
  const add = (parent: ModelPart, child: ModelPart) => {
    if (parent.id === child.id || linkedChildren.has(child.id)) return
    joints.push(createJoint(parent, child, true))
    linkedChildren.add(child.id)
    connected.add(child.id)
  }
  if (head) add(torso, head)

  const excludes = new Set([torso.id, ...(head ? [head.id] : [])])
  const limbs = parts.filter((part) => !excludes.has(part.id) && Math.abs(center(part).x - torsoCenter.x) > Math.max(torso.width * 0.35, sheetWidth * 0.035))
  for (const side of ['left', 'right'] as const) {
    const onSide = limbs.filter((part) => side === 'left' ? center(part).x < torsoCenter.x : center(part).x >= torsoCenter.x)
    const armSegments = onSide.filter((part) => center(part).y < torsoBottom + sheetHeight * 0.015).sort((a, b) => center(a).y - center(b).y)
    const legSegments = onSide.filter((part) => center(part).y >= torsoBottom + sheetHeight * 0.015).sort((a, b) => center(a).y - center(b).y)
    if (armSegments[0]) add(torso, armSegments[0])
    for (let index = 1; index < armSegments.length; index += 1) add(armSegments[index - 1], armSegments[index])
    if (legSegments[0]) add(torso, legSegments[0])
    for (let index = 1; index < legSegments.length; index += 1) add(legSegments[index - 1], legSegments[index])
  }

  while (connected.size < parts.length) {
    let nearest: { parent: ModelPart; child: ModelPart; distance: number } | null = null
    for (const parent of parts) {
      if (!connected.has(parent.id)) continue
      const parentCenter = center(parent)
      for (const child of parts) {
        if (connected.has(child.id) || linkedChildren.has(child.id)) continue
        const childCenter = center(child)
        const distance = Math.hypot((childCenter.x - parentCenter.x) / sheetWidth, (childCenter.y - parentCenter.y) / sheetHeight)
        if (!nearest || distance < nearest.distance) nearest = { parent, child, distance }
      }
    }
    if (!nearest) break
    add(nearest.parent, nearest.child)
  }
  return joints
}

export function reorderLayer(order: string[], partId: string, targetId: string): string[] {
  if (partId === targetId) return order
  const next = order.slice()
  const from = next.indexOf(partId)
  const to = next.indexOf(targetId)
  if (from < 0 || to < 0) return order
  next.splice(to, 0, next.splice(from, 1)[0])
  return next
}
