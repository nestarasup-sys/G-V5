import type { ModelPart, WardrobeBinding, WardrobeComponent } from '../../../../../shared/fabricator'

type Point = { x: number; y: number }

function referenceFrame(bone: ModelPart) {
  const source = bone.sourceTransform
  return {
    x: source?.x ?? bone.x,
    y: source?.y ?? bone.y,
    width: Math.max(1, source?.width ?? bone.width),
    height: Math.max(1, source?.height ?? bone.height),
    rotation: source?.rotation ?? 0
  }
}

/** Capture the complete fitted garment transform in the bone's original local frame. */
export function bindWardrobeComponent(component: WardrobeComponent, bone: ModelPart): WardrobeBinding {
  const frame = referenceFrame(bone)
  const boneCenter = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }
  const garmentCenter = { x: component.x + component.width / 2, y: component.y + component.height / 2 }
  const radians = -frame.rotation * Math.PI / 180
  const dx = garmentCenter.x - boneCenter.x
  const dy = garmentCenter.y - boneCenter.y
  return {
    version: 1,
    boneId: bone.id,
    referenceX: frame.x,
    referenceY: frame.y,
    boneWidth: frame.width,
    boneHeight: frame.height,
    boneRotation: frame.rotation,
    localCenterX: (dx * Math.cos(radians) - dy * Math.sin(radians)) / frame.width,
    localCenterY: (dx * Math.sin(radians) + dy * Math.cos(radians)) / frame.height,
    widthRatio: component.width / frame.width,
    heightRatio: component.height / frame.height,
    relativeRotation: component.rotation - frame.rotation
  }
}

export type WardrobePoseTransform = {
  origin: Point
  localLeft: number
  localTop: number
  renderWidth: number
  renderHeight: number
  localRotation: number
  matrix: string
  scaleX: number
  scaleY: number
}

/**
 * Map a garment from the source sheet into the posed bone's local frame.
 * The garment's own x/y/width/height/rotation are intentionally kept in this
 * calculation so manual fitting and non-uniform scaling survive every pose.
 */
export function mapWardrobeComponentToPose(
  component: WardrobeComponent,
  sourceBone: ModelPart,
  poseBone: ModelPart,
  kneeOverlap = 0,
  edgePadding = 0
): WardrobePoseTransform {
  const storedBinding = component.binding?.boneId === sourceBone.id ? component.binding : null
  const frame = referenceFrame(sourceBone)
  // Bindings written before the source-frame coordinates were recorded can
  // silently drift when a model part is resized or moved in Model Dev. Rebuild
  // those bindings from the saved garment geometry so Customizer and the
  // wardrobe editor agree on the current model.
  const bindingMatchesSource = storedBinding
    && storedBinding.referenceX !== undefined
    && storedBinding.referenceY !== undefined
    && Math.abs(storedBinding.referenceX - frame.x) < 0.01
    && Math.abs(storedBinding.referenceY - frame.y) < 0.01
    && Math.abs(storedBinding.boneWidth - frame.width) < 0.01
    && Math.abs(storedBinding.boneHeight - frame.height) < 0.01
    && Math.abs(storedBinding.boneRotation - frame.rotation) < 0.01
  const binding = bindingMatchesSource ? storedBinding : bindWardrobeComponent(component, sourceBone)
  if (binding) return mapBoundWardrobeComponentToPose(binding, poseBone, kneeOverlap, edgePadding)
  const source = sourceBone.sourceTransform
  const sourceWidth = Math.max(1, source?.width ?? sourceBone.width)
  const sourceHeight = Math.max(1, source?.height ?? sourceBone.height)
  const scaleX = Math.max(0.0001, poseBone.width / sourceWidth)
  const scaleY = Math.max(0.0001, poseBone.height / sourceHeight)
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
  const overlap = Math.max(0, kneeOverlap)
  const edge = Math.max(0, edgePadding)
  const renderWidth = component.width + edge * 2
  const renderHeight = component.height + overlap + edge * 2
  return {
    origin: { x: poseBone.x + poseBone.width / 2, y: poseBone.y + poseBone.height / 2 },
    localLeft: localCenter.x - renderWidth / 2,
    // Expand evenly around the fitted center so the overlap cannot shift the
    // garment away from its bone. This tiny test-only stretch closes the knee.
    localTop: localCenter.y - renderHeight / 2,
    renderWidth,
    renderHeight,
    localRotation: component.rotation - sourceRotation,
    matrix: `matrix(${matrix})`, scaleX, scaleY
  }
}

function mapBoundWardrobeComponentToPose(binding: WardrobeBinding, poseBone: ModelPart, kneeOverlap: number, edgePadding: number): WardrobePoseTransform {
  const scaleX = Math.max(0.0001, poseBone.width / binding.boneWidth)
  const scaleY = Math.max(0.0001, poseBone.height / binding.boneHeight)
  const localCenter = { x: binding.localCenterX * poseBone.width, y: binding.localCenterY * poseBone.height }
  const radians = poseBone.rotation * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const overlap = Math.max(0, kneeOverlap)
  const edge = Math.max(0, edgePadding)
  const width = Math.max(1, binding.widthRatio * poseBone.width) + edge * 2
  const height = Math.max(1, binding.heightRatio * poseBone.height) + edge * 2
  const matrix = [cosine, sine, -sine, cosine, 0, 0].map((value) => Number(value.toFixed(8))).join(',')
  return {
    origin: { x: poseBone.x + poseBone.width / 2, y: poseBone.y + poseBone.height / 2 },
    localLeft: localCenter.x - width / 2,
    localTop: localCenter.y - (height + overlap) / 2,
    renderWidth: width,
    renderHeight: height + overlap,
    localRotation: binding.relativeRotation,
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
