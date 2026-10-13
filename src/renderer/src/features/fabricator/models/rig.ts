import type { JointLink, ModelPart } from '../../../../../shared/fabricator'

function makeId(): string {
  return crypto.randomUUID()
}

function edgePoint(part: ModelPart, target: ModelPart): { x: number; y: number } {
  const center = { x: part.x + part.width / 2, y: part.y + part.height / 2 }
  const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 }
  const dx = targetCenter.x - center.x
  const dy = targetCenter.y - center.y
  const horizontal = Math.abs(dx / Math.max(1, part.width)) > Math.abs(dy / Math.max(1, part.height))
  return horizontal
    ? { x: center.x + Math.sign(dx || 1) * part.width / 2, y: center.y + dy * part.width / (2 * Math.max(1, Math.abs(dx))) }
    : { x: center.x + dx * part.height / (2 * Math.max(1, Math.abs(dy))), y: center.y + Math.sign(dy || 1) * part.height / 2 }
}

export function linkParts(parent: ModelPart, child: ModelPart, suggested = false): JointLink {
  return {
    id: makeId(), parentPartId: parent.id, childPartId: child.id,
    parentAnchor: edgePoint(parent, child), childAnchor: edgePoint(child, parent), suggested
  }
}

function rectangleGap(a: ModelPart, b: ModelPart): number {
  const horizontal = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width))
  const vertical = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height))
  return Math.hypot(horizontal, vertical)
}

function preferredPairBonus(a: ModelPart, b: ModelPart, torsoId: string | undefined): number {
  const names = `${a.name} ${b.name}`.toLocaleLowerCase('pt-BR')
  const has = (pattern: RegExp) => pattern.test(names)
  if (torsoId && (a.id === torsoId || b.id === torsoId)) {
    if (has(/cabeça|cabeca/)) return 0.02
    if (has(/braço|braco|perna|antebraço|antebraco/)) return 0.12
  }
  if (has(/braço|braco/) && has(/antebraço|antebraco/)) return 0.03
  if (has(/perna/) && (a.id !== torsoId && b.id !== torsoId)) return 0.18
  return 1
}

/** Builds an acyclic, connected rig while retaining meaningful body-part relationships. */
export function suggestJoints(parts: ModelPart[]): JointLink[] {
  if (parts.length < 2) return []

  const left = Math.min(...parts.map((part) => part.x))
  const top = Math.min(...parts.map((part) => part.y))
  const right = Math.max(...parts.map((part) => part.x + part.width))
  const bottom = Math.max(...parts.map((part) => part.y + part.height))
  const sheetCenter = { x: (left + right) / 2, y: (top + bottom) / 2 }
  const torso = parts.find((part) => /tronco|corpo/i.test(part.name))
    ?? [...parts].sort((a, b) => {
      const score = (part: ModelPart) => {
        const centerX = part.x + part.width / 2
        const centerY = part.y + part.height / 2
        const scale = Math.max(1, Math.hypot(right - left, bottom - top))
        return Math.hypot(centerX - sheetCenter.x, centerY - sheetCenter.y) / scale - (part.width * part.height) / Math.max(1, (right - left) * (bottom - top)) * 0.2
      }
      return score(a) - score(b)
    })[0]
  const parentByChild = new Map<string, string>()
  const pairs = new Set<string>()
  const joints: JointLink[] = []

  const add = (parent: ModelPart, child: ModelPart) => {
    const pair = [parent.id, child.id].sort().join(':')
    if (parent.id === child.id || pairs.has(pair) || parentByChild.has(child.id)) return
    pairs.add(pair)
    parentByChild.set(child.id, parent.id)
    joints.push(linkParts(parent, child, true))
  }

  const head = parts.find((part) => /cabeça|cabeca/i.test(part.name))
  if (torso && head) add(torso, head)

  const arms = parts.filter((part) => /^(braço|braco)\b/i.test(part.name))
  const forearms = parts.filter((part) => /^antebraço|^antebraco/i.test(part.name))
  for (const arm of arms) {
    if (torso) add(torso, arm)
    const side = /esquerdo/i.test(arm.name) ? 'esquerdo' : 'direito'
    const forearm = forearms.find((part) => part.name.toLocaleLowerCase('pt-BR').includes(side))
    if (forearm) add(arm, forearm)
  }

  const legs = parts.filter((part) => /perna/i.test(part.name))
  for (const leg of legs) if (torso) add(torso, leg)

  const rootId = torso?.id ?? parts[0].id
  const root = parts.find((part) => part.id === rootId) ?? parts[0]
  const connected = new Set([root.id])
  let expanded = true
  while (expanded) {
    expanded = false
    for (const joint of joints) {
      if (connected.has(joint.parentPartId) && !connected.has(joint.childPartId)) {
        connected.add(joint.childPartId)
        expanded = true
      }
    }
  }
  while (connected.size < parts.length) {
    let best: { parent: ModelPart; child: ModelPart; score: number } | null = null
    for (const parent of parts) {
      if (!connected.has(parent.id)) continue
      for (const child of parts) {
        if (connected.has(child.id) || parentByChild.has(child.id)) continue
        const scale = Math.max(1, Math.sqrt(Math.min(parent.width * parent.height, child.width * child.height)))
        const score = (rectangleGap(parent, child) / scale) * preferredPairBonus(parent, child, torso?.id)
        if (!best || score < best.score) best = { parent, child, score }
      }
    }
    if (!best) break
    add(best.parent, best.child)
    connected.add(best.child.id)
  }

  return joints
}

export function orderedParts(parts: ModelPart[], layerOrder?: string[]): ModelPart[] {
  const byId = new Map(parts.map((part) => [part.id, part]))
  const ids = [...(layerOrder ?? []), ...parts.map((part) => part.id)]
  const seen = new Set<string>()
  return ids.flatMap((id) => {
    const part = byId.get(id)
    if (!part || seen.has(id)) return []
    seen.add(id)
    return [part]
  })
}

export function normalizedLayerOrder(parts: ModelPart[], layerOrder?: string[]): string[] {
  return orderedParts(parts, layerOrder).map((part) => part.id)
}
