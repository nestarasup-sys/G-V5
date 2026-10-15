import type { FabricatorProject, ModelPart } from '../../../../../shared/fabricator'
import { resizeAroundAnchor } from '../../../../../shared/headShape'
import { partJointAnchor } from './rig'

export function isHeadPart(part: ModelPart): boolean {
  return /cabe[çc]a|head/i.test(part.name)
}

export function headSizePercent(part: ModelPart, axis: 'width' | 'height'): number {
  const base = part.resizeBase?.[axis] ?? part.sourceTransform?.[axis] ?? part[axis]
  return Math.round(part[axis] / Math.max(1, base) * 100)
}

/** Stretch the image around its joint so the neck remains attached to the torso. */
export function resizeHeadPart(project: FabricatorProject, id: string, axis: 'width' | 'height', percent: number): FabricatorProject {
  const part = project.parts.find((item) => item.id === id)
  if (!part || !isHeadPart(part) || !Number.isFinite(percent)) return project
  const resizeBase = part.resizeBase ?? {
    width: part.sourceTransform?.width ?? part.width,
    height: part.sourceTransform?.height ?? part.height
  }
  const requested = resizeBase[axis] * Math.max(.2, Math.min(3, percent / 100))
  if (Math.abs(part[axis] - requested) < .001) return project

  const width = axis === 'width' ? requested : part.width
  const height = axis === 'height' ? requested : part.height
  const anchor = partJointAnchor(part, project.joints) ?? { x: part.x + part.width / 2, y: part.y + part.height / 2 }
  return {
    ...project,
    parts: project.parts.map((item) => item.id === id
      ? { ...resizeAroundAnchor(item, width, height, anchor), resizeBase }
      : item)
  }
}
