import type { FabricatorProject, JointLink } from '../../../../../shared/fabricator'
import { partJointAnchor } from '../models/rig'

export type MotionId = 'walk' | 'arms' | 'sit' | 'run' | 'wave' | 'clap' | 'cheer' | 'point' | 'jump' | 'kick' | 'stretch' | 'dance' | 'crouch'
export type MotionRole = 'head' | 'thigh' | 'calf' | 'upperArm' | 'forearm'
export type MotionSide = 'left' | 'right'
export type MotionRigMap = Partial<Record<MotionRole, Partial<Record<MotionSide, string>>>>
export type MotionDefinition = { id: MotionId; title: string; detail: string; duration: number; loop: boolean; category: 'Locomoção' | 'Gestos' | 'Posturas' }

export const motionDefinitions: MotionDefinition[] = [
  { id: 'walk', title: 'Andar', detail: 'Caminhada contínua com braços em oposição às pernas.', duration: 1.05, loop: true, category: 'Locomoção' },
  { id: 'arms', title: 'Cruzar os braços', detail: 'Leva os antebraços ao peito e mantém a posição.', duration: 1.2, loop: false, category: 'Gestos' },
  { id: 'sit', title: 'Sentar e cruzar os braços', detail: 'Dobra as pernas e cruza os braços em seguida.', duration: 2.2, loop: false, category: 'Posturas' },
  { id: 'run', title: 'Correr', detail: 'Passadas rápidas com maior balanço das pernas e braços.', duration: .72, loop: true, category: 'Locomoção' },
  { id: 'wave', title: 'Acenar', detail: 'Levanta o braço direito e faz pequenos movimentos com o antebraço.', duration: 1.8, loop: true, category: 'Gestos' },
  { id: 'clap', title: 'Bater palmas', detail: 'Aproxima e afasta os antebraços em ciclos curtos.', duration: 1.25, loop: true, category: 'Gestos' },
  { id: 'cheer', title: 'Comemorar', detail: 'Ergue os braços e dá um pequeno salto.', duration: 1.4, loop: false, category: 'Gestos' },
  { id: 'point', title: 'Apontar', detail: 'Estende o braço direito e sustenta o gesto.', duration: 1.1, loop: false, category: 'Gestos' },
  { id: 'jump', title: 'Pular', detail: 'Flexiona as pernas, salta e retorna ao chão.', duration: 1.15, loop: false, category: 'Locomoção' },
  { id: 'kick', title: 'Chutar', detail: 'Levanta a perna direita, estende a canela e recolhe.', duration: 1.2, loop: false, category: 'Locomoção' },
  { id: 'stretch', title: 'Espreguiçar', detail: 'Estica os dois braços acima dos ombros.', duration: 1.7, loop: false, category: 'Gestos' },
  { id: 'dance', title: 'Dançar', detail: 'Alterna pernas e braços num balanço contínuo.', duration: 1.65, loop: true, category: 'Locomoção' },
  { id: 'crouch', title: 'Agachar', detail: 'Flexiona as pernas e leva os braços para a frente.', duration: 1.4, loop: false, category: 'Posturas' }
]

const center = (part: FabricatorProject['parts'][number]) => ({ x: part.x + part.width / 2, y: part.y + part.height / 2 })
const normalizeName = (name: string) => name.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '')

function findTorso(project: FabricatorProject) {
  return project.parts.find((part) => /tronco|corpo|torso/.test(normalizeName(part.name)))
}

function rigDepths(project: FabricatorProject, rootId?: string): Map<string, number> {
  const depths = new Map<string, number>()
  if (!rootId) return depths
  depths.set(rootId, 0)
  const queue = [rootId]
  while (queue.length) {
    const parentId = queue.shift()!
    const depth = depths.get(parentId) ?? 0
    for (const joint of project.joints) {
      if (joint.parentPartId !== parentId || depths.has(joint.childPartId)) continue
      depths.set(joint.childPartId, depth + 1)
      queue.push(joint.childPartId)
    }
  }
  return depths
}

/** Identify limbs from names and their depth in the saved parent→child rig. */
export function detectMotionRig(project: FabricatorProject): MotionRigMap {
  const torso = findTorso(project)
  const depths = rigDepths(project, torso?.id)
  const torsoCenter = torso ? center(torso) : { x: project.width / 2, y: project.height / 2 }
  const candidates: Array<{ role: MotionRole; side: MotionSide; id: string; depth: number; explicit: boolean; proximity: number; y: number }> = []

  for (const part of project.parts) {
    const name = normalizeName(part.name)
    const point = center(part)
    if (part.id === torso?.id) continue
    const side: MotionSide = /esquerd|left|(?:^|\s)l(?:$|\s)|_l\b/.test(name) ? 'left' : /direit|right|(?:^|\s)r(?:$|\s)|_r\b/.test(name) ? 'right' : point.x < torsoCenter.x ? 'left' : 'right'
    const depth = depths.get(part.id) ?? Number.MAX_SAFE_INTEGER
    const arm = /braco|arm|manga/.test(name)
    const leg = /perna|coxa|thigh|leg|canela|panturrilha|calf/.test(name)
    let role: MotionRole | null = null
    let explicit = false
    if (/cabeca|head/.test(name)) { role = 'head'; explicit = true }
    else if (/antebraco|forearm|lower.?arm/.test(name)) { role = 'forearm'; explicit = true }
    else if (/canela|panturrilha|calf|lower.?leg|perna.?inferior/.test(name)) { role = 'calf'; explicit = true }
    else if (/braco|arm|manga/.test(name) && /superior|upper/.test(name)) { role = 'upperArm'; explicit = true }
    else if (/coxa|thigh|upper.?leg|perna.?superior/.test(name)) { role = 'thigh'; explicit = true }
    else if (arm) role = depth >= 2 ? 'forearm' : 'upperArm'
    else if (leg) role = depth >= 2 ? 'calf' : 'thigh'
    if (!role) continue
    candidates.push({ role, side, id: part.id, depth, explicit, proximity: Math.hypot(point.x - torsoCenter.x, point.y - torsoCenter.y), y: point.y })
  }

  const rig: MotionRigMap = {}
  for (const role of ['head', 'thigh', 'calf', 'upperArm', 'forearm'] as MotionRole[]) {
    for (const side of ['left', 'right'] as MotionSide[]) {
      const matching = candidates.filter((candidate) => candidate.role === role && candidate.side === side)
      matching.sort((a, b) => {
        if (a.explicit !== b.explicit) return Number(b.explicit) - Number(a.explicit)
        if (role === 'forearm' || role === 'calf') return b.depth - a.depth || b.y - a.y || b.proximity - a.proximity
        return a.depth - b.depth || a.proximity - b.proximity
      })
      const selected = matching[0]
      if (selected) rig[role] = { ...rig[role], [side]: selected.id }
    }
  }
  return rig
}

export function motionRigDiagnostics(project: FabricatorProject, rig: MotionRigMap) {
  const names = new Map(project.parts.map((part) => [part.id, part.name]))
  const expected: Array<[MotionRole, string]> = [['thigh', 'Coxa/perna superior'], ['calf', 'Canela/perna inferior'], ['upperArm', 'Braço superior'], ['forearm', 'Antebraço']]
  return expected.map(([role, label]) => ({ role, label, left: rig[role]?.left ? names.get(rig[role]!.left!) ?? 'Peça' : null, right: rig[role]?.right ? names.get(rig[role]!.right!) ?? 'Peça' : null }))
}

function rotatePoint(point: { x: number; y: number }, origin: { x: number; y: number }, degrees: number) {
  const radians = degrees * Math.PI / 180
  const dx = point.x - origin.x, dy = point.y - origin.y
  return { x: origin.x + dx * Math.cos(radians) - dy * Math.sin(radians), y: origin.y + dx * Math.sin(radians) + dy * Math.cos(radians) }
}

/** Rotate a rig branch exactly like Poses: around the selected part's own blue joint anchor. */
export function rotateMotionBranch(project: FabricatorProject, partId: string, degrees: number): FabricatorProject {
  if (Math.abs(degrees) < 0.01) return project
  const selected = project.parts.find((part) => part.id === partId)
  if (!selected) return project
  const origin = partJointAnchor(selected, project.joints) ?? center(selected)
  const affected = new Set([partId])
  let changed = true
  while (changed) {
    changed = false
    for (const joint of project.joints) {
      if (!joint.fixed) continue
      if (affected.has(joint.parentPartId) && !affected.has(joint.childPartId)) { affected.add(joint.childPartId); changed = true }
    }
  }
  const parts = project.parts.map((part) => {
    if (!affected.has(part.id)) return part
    const nextCenter = rotatePoint(center(part), origin, degrees)
    const anchor = partJointAnchor(part, project.joints)
    return { ...part, x: nextCenter.x - part.width / 2, y: nextCenter.y - part.height / 2, rotation: part.rotation + degrees, ...(anchor ? { jointAnchor: rotatePoint(anchor, origin, degrees) } : {}) }
  })
  const partById = new Map(parts.map((part) => [part.id, part]))
  const joints: JointLink[] = project.joints.map((joint) => {
    const parent = partById.get(joint.parentPartId)
    const child = partById.get(joint.childPartId)
    const parentAnchor = parent ? partJointAnchor(parent, project.joints) ?? joint.parentAnchor : joint.parentAnchor
    const childAnchor = child ? partJointAnchor(child, project.joints) ?? joint.childAnchor : joint.childAnchor
    return { ...joint, parentAnchor, childAnchor, pivot: { x: (parentAnchor.x + childAnchor.x) / 2, y: (parentAnchor.y + childAnchor.y) / 2 } }
  })
  return { ...project, parts, joints }
}

const smooth = (t: number) => { const clamped = Math.max(0, Math.min(1, t)); return clamped * clamped * (3 - 2 * clamped) }

export function motionRootOffsetY(motion: MotionId, progress: number, intensity: number) {
  if (motion === 'jump' || motion === 'cheer') return -Math.sin(Math.PI * Math.max(0, Math.min(1, progress))) * 55 * intensity
  if (motion === 'walk' || motion === 'run' || motion === 'dance') return -Math.abs(Math.sin(progress * Math.PI * 2)) * (motion === 'run' ? 7 : 3) * intensity
  return 0
}

export function evaluateMotion(source: FabricatorProject, rig: MotionRigMap, motion: MotionId, progress: number, intensity: number): FabricatorProject {
  let project: FabricatorProject = { ...source, parts: source.parts.map((part) => ({ ...part })), joints: source.joints.map((joint) => ({ ...joint, parentAnchor: { ...joint.parentAnchor }, childAnchor: { ...joint.childAnchor }, ...(joint.pivot ? { pivot: { ...joint.pivot } } : {}) })) }
  const angle = (role: MotionRole, side: MotionSide, degrees: number) => {
    const id = rig[role]?.[side]
    if (id) project = rotateMotionBranch(project, id, degrees * intensity)
  }
  const crossArms = (amount: number) => {
    angle('upperArm', 'left', -42 * amount); angle('upperArm', 'right', 42 * amount)
    angle('forearm', 'left', -112 * amount); angle('forearm', 'right', 112 * amount)
  }
  const gait = (stride: number, lift: number, arms: number) => {
    angle('thigh', 'left', -stride); angle('thigh', 'right', stride)
    angle('calf', 'left', lift * Math.max(0, Math.sin(progress * Math.PI * 2)))
    angle('calf', 'right', lift * Math.max(0, -Math.sin(progress * Math.PI * 2)))
    angle('upperArm', 'left', arms * Math.sin(progress * Math.PI * 2)); angle('upperArm', 'right', -arms * Math.sin(progress * Math.PI * 2))
    angle('forearm', 'left', -6 * Math.sin(progress * Math.PI * 2)); angle('forearm', 'right', 6 * Math.sin(progress * Math.PI * 2))
  }
  const amount = smooth(progress)
  const wave = Math.sin(progress * Math.PI * 2)
  switch (motion) {
    case 'walk': gait(25 * wave, 32, 16); break
    case 'arms': crossArms(smooth(Math.min(1, progress * 2.5))); break
    case 'sit': {
      const sitting = smooth(Math.min(1, progress * 1.65))
      angle('thigh', 'left', 58 * sitting); angle('thigh', 'right', -58 * sitting)
      angle('calf', 'left', -52 * sitting); angle('calf', 'right', 52 * sitting)
      crossArms(smooth(Math.max(0, Math.min(1, (progress - .36) * 2.2))))
      break
    }
    case 'run': gait(39 * wave, 48, 27); break
    case 'wave':
      angle('upperArm', 'right', -125 * amount); angle('forearm', 'right', (-72 + 24 * Math.sin(progress * Math.PI * 6)) * amount)
      angle('upperArm', 'left', 7 * amount); break
    case 'clap': {
      const beat = Math.abs(Math.sin(progress * Math.PI * 4))
      angle('upperArm', 'left', -32 + 8 * beat); angle('upperArm', 'right', 32 - 8 * beat)
      angle('forearm', 'left', -102 + 24 * beat); angle('forearm', 'right', 102 - 24 * beat)
      break
    }
    case 'cheer':
      angle('upperArm', 'left', 118 * amount); angle('upperArm', 'right', -118 * amount)
      angle('forearm', 'left', 24 * amount); angle('forearm', 'right', -24 * amount)
      angle('thigh', 'left', -8 * amount); angle('thigh', 'right', 8 * amount); break
    case 'point':
      angle('upperArm', 'right', -78 * amount); angle('forearm', 'right', 12 * amount)
      angle('upperArm', 'left', -12 * amount); break
    case 'jump': {
      const jump = Math.sin(Math.PI * progress)
      angle('thigh', 'left', -28 * jump); angle('thigh', 'right', 28 * jump)
      angle('calf', 'left', 42 * jump); angle('calf', 'right', -42 * jump)
      angle('upperArm', 'left', 95 * jump); angle('upperArm', 'right', -105 * jump)
      break
    }
    case 'kick': {
      const kick = smooth(Math.min(1, progress * 2.3)) * (1 - smooth(Math.max(0, (progress - .55) * 2.2)))
      angle('thigh', 'right', -54 * kick); angle('calf', 'right', -24 * kick)
      angle('thigh', 'left', 8 * kick); angle('upperArm', 'left', -18 * kick); angle('upperArm', 'right', 18 * kick)
      break
    }
    case 'stretch':
      angle('upperArm', 'left', 105 * amount); angle('upperArm', 'right', -105 * amount)
      angle('forearm', 'left', -18 * amount); angle('forearm', 'right', 18 * amount); break
    case 'dance':
      angle('thigh', 'left', -24 * wave); angle('thigh', 'right', 24 * wave)
      angle('calf', 'left', 28 * Math.max(0, wave)); angle('calf', 'right', 28 * Math.max(0, -wave))
      angle('upperArm', 'left', 38 * Math.sin(progress * Math.PI * 4)); angle('upperArm', 'right', -38 * Math.sin(progress * Math.PI * 4))
      angle('forearm', 'left', 24 * wave); angle('forearm', 'right', -24 * wave); break
    case 'crouch':
      angle('thigh', 'left', -54 * amount); angle('thigh', 'right', 51 * amount)
      angle('calf', 'left', 48 * amount); angle('calf', 'right', -39 * amount)
      angle('upperArm', 'left', -22 * amount); angle('upperArm', 'right', 22 * amount)
      angle('forearm', 'left', -45 * amount); angle('forearm', 'right', 45 * amount); break
  }
  return project
}
