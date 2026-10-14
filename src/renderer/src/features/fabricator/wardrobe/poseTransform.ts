import type { ModelPart, WardrobeComponent } from '../../../../../shared/fabricator'

type Point = { x: number; y: number }

export type WardrobePoseTransform = {
  origin: Point
  localLeft: number
  localTop: number
  localRotation: number
  matrix: string
  scaleX: number
  scaleY: number
}

/** Map a garment through the fitted bone frame, independent of the rig ball. */
export function mapWardrobeComponentToPose(component: WardrobeComponent, sourceBone: ModelPart, poseBone: ModelPart): WardrobePoseTransform {
  const source = sourceBone.sourceTransform
  const sourceWidth = Math.max(1, source?.width ?? sourceBone.width)
  const sourceHeight = Math.max(1, source?.height ?? sourceBone.height)
  const scaleX = poseBone.width / sourceWidth
  const scaleY = poseBone.height / sourceHeight
  const sourceRotation = source?.rotation ?? 0
  const sourceCenter = { x: (source?.x ?? sourceBone.x) + sourceWidth / 2, y: (source?.y ?? sourceBone.y) + sourceHeight / 2 }
  const garmentCenter = { x: component.x + component.width / 2, y: component.y + component.height / 2 }
  const toLocalRadians = -sourceRotation * Math.PI / 180
  const dx = garmentCenter.x - sourceCenter.x
  const dy = garmentCenter.y - sourceCenter.y
  const localCenter = {
    x: dx * Math.cos(toLocalRadians) - dy * Math.sin(toLocalRadians),
    y: dx * Math.sin(toLocalRadians) + dy * Math.cos(toLocalRadians)
  }
  const radians = poseBone.rotation * Math.PI / 180
  const matrix = [Math.cos(radians) * scaleX, Math.sin(radians) * scaleX, -Math.sin(radians) * scaleY, Math.cos(radians) * scaleY, 0, 0]
    .map((value) => Number(value.toFixed(8))).join(',')
  return {
    origin: { x: poseBone.x + poseBone.width / 2, y: poseBone.y + poseBone.height / 2 },
    localLeft: localCenter.x - component.width / 2,
    localTop: localCenter.y - component.height / 2,
    localRotation: component.rotation - sourceRotation,
    matrix: `matrix(${matrix})`, scaleX, scaleY
  }
}

/** Convert a screen-space drag back into the wardrobe sheet's source axes. */
export function poseDeltaToSource(delta: Point, sourceBone: ModelPart, poseBone: ModelPart): Point {
  const sourceRotation = (sourceBone.sourceTransform?.rotation ?? 0) * Math.PI / 180
  const poseRotation = -poseBone.rotation * Math.PI / 180
  const scaleX = poseBone.width / Math.max(1, sourceBone.sourceTransform?.width ?? sourceBone.width)
  const scaleY = poseBone.height / Math.max(1, sourceBone.sourceTransform?.height ?? sourceBone.height)
  const poseLocal = { x: delta.x * Math.cos(poseRotation) - delta.y * Math.sin(poseRotation), y: delta.x * Math.sin(poseRotation) + delta.y * Math.cos(poseRotation) }
  const unscaled = { x: poseLocal.x / Math.max(0.0001, scaleX), y: poseLocal.y / Math.max(0.0001, scaleY) }
  return { x: unscaled.x * Math.cos(sourceRotation) - unscaled.y * Math.sin(sourceRotation), y: unscaled.x * Math.sin(sourceRotation) + unscaled.y * Math.cos(sourceRotation) }
}
