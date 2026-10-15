import type { JointLink, ModelPart, PosePart } from './fabricator'

type Point = { x: number; y: number }
type SizedPart = { x: number; y: number; width: number; height: number; rotation: number }

/** Resize in local image coordinates while keeping one canvas point fixed. */
export function resizeAroundAnchor<T extends SizedPart>(part: T, width: number, height: number, anchor: Point): T {
  if (Math.abs(part.width - width) < .001 && Math.abs(part.height - height) < .001) return part
  const radians = part.rotation * Math.PI / 180
  const cosine = Math.cos(radians), sine = Math.sin(radians)
  const dx = anchor.x - part.x - part.width / 2
  const dy = anchor.y - part.y - part.height / 2
  const localX = dx * cosine + dy * sine
  const localY = -dx * sine + dy * cosine
  const scaledX = localX * width / part.width
  const scaledY = localY * height / part.height
  const centerX = anchor.x - (scaledX * cosine - scaledY * sine)
  const centerY = anchor.y - (scaledX * sine + scaledY * cosine)
  return { ...part, x: centerX - width / 2, y: centerY - height / 2, width, height }
}

/** A saved pose owns its geometry; copy only the model's later head proportions. */
export function applyModelHeadShape<T extends { parts: PosePart[]; joints: JointLink[] }>(pose: T, modelParts: Array<Pick<ModelPart, 'id' | 'name' | 'width' | 'height' | 'resizeBase'>>): T {
  const head = modelParts.find((part) => part.resizeBase && /cabe[çc]a|head/i.test(part.name))
  if (!head || !Number.isFinite(head.width) || !Number.isFinite(head.height) || head.width <= 0 || head.height <= 0) return pose
  const part = pose.parts.find((item) => item.id === head.id)
  if (!part || Math.abs(part.width - head.width) < .001 && Math.abs(part.height - head.height) < .001) return pose
  const joint = pose.joints.find((item) => item.childPartId === part.id)
  const anchor = part.jointAnchor ?? joint?.childAnchor ?? { x: part.x + part.width / 2, y: part.y + part.height / 2 }
  return {
    ...pose,
    parts: pose.parts.map((item) => item.id === part.id
      ? { ...resizeAroundAnchor(item, head.width, head.height, anchor), resizeBase: head.resizeBase }
      : item)
  }
}
