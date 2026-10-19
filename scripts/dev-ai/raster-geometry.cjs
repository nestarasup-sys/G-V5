'use strict'

function rotate(point, degrees) {
  const radians = degrees * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  return { x: point.x * cosine - point.y * sine, y: point.x * sine + point.y * cosine }
}

function boundsOfPoints(points) {
  const xs = points.map(point => point.x)
  const ys = points.map(point => point.y)
  const left = Math.floor(Math.min(...xs))
  const top = Math.floor(Math.min(...ys))
  const right = Math.ceil(Math.max(...xs))
  const bottom = Math.ceil(Math.max(...ys))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function rotatedRectangle(center, width, height, rotation) {
  const halfWidth = width / 2
  const halfHeight = height / 2
  return boundsOfPoints([
    { x: -halfWidth, y: -halfHeight }, { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight }, { x: -halfWidth, y: halfHeight }
  ].map(point => {
    const rotated = rotate(point, rotation)
    return { x: center.x + rotated.x, y: center.y + rotated.y }
  }))
}

/** Independent oracle for a saved Fabricador binding transported onto a pose. */
function boundComponentBounds(component, poseBone, group = {}) {
  const binding = component.binding
  if (!binding || binding.boneId !== poseBone.id) throw new Error('Fixture binding must target its pose bone')
  const boneCenter = { x: poseBone.x + poseBone.width / 2, y: poseBone.y + poseBone.height / 2 }
  const local = { x: binding.localCenterX * poseBone.width, y: binding.localCenterY * poseBone.height }
  const boundCenterOffset = rotate(local, poseBone.rotation)
  const center = { x: boneCenter.x + boundCenterOffset.x, y: boneCenter.y + boundCenterOffset.y }
  const width = binding.widthRatio * poseBone.width
  const height = binding.heightRatio * poseBone.height
  const halfWidth = width / 2, halfHeight = height / 2
  const componentCorners = [
    { x: -halfWidth, y: -halfHeight }, { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight }, { x: -halfWidth, y: halfHeight }
  ].map(corner => {
    const localRotated = rotate(corner, poseBone.rotation + binding.relativeRotation)
    return { x: center.x + localRotated.x, y: center.y + localRotated.y }
  })

  const groupCenter = { x: poseBone.x + poseBone.width / 2, y: poseBone.y + poseBone.height / 2 }
  const groupScaleX = group.scaleX ?? 1
  const groupScaleY = group.scaleY ?? 1
  const groupRotation = group.rotation ?? 0
  const offsetX = group.offsetX ?? 0
  const offsetY = group.offsetY ?? 0
  const moved = componentCorners.map(point => {
    const reference = group.adjustmentReference
    if (reference && reference.boneId === poseBone.id) {
      // Independent normalized-axis oracle: move each current-pose corner
      // back to the authored frame, apply the saved edit, then pose it again.
      const unrotated = rotate({ x: point.x - groupCenter.x, y: point.y - groupCenter.y }, -poseBone.rotation)
      const authored = rotate({ x: unrotated.x * reference.width / poseBone.width,
        y: unrotated.y * reference.height / poseBone.height }, reference.rotation)
      const edited = rotate({ x: authored.x * groupScaleX, y: authored.y * groupScaleY }, groupRotation)
      const local = rotate({ x: edited.x + offsetX, y: edited.y + offsetY }, -reference.rotation)
      const posed = rotate({ x: local.x * poseBone.width / reference.width,
        y: local.y * poseBone.height / reference.height }, poseBone.rotation)
      return { x: groupCenter.x + posed.x, y: groupCenter.y + posed.y }
    }
    const relative = { x: (point.x - groupCenter.x) * groupScaleX, y: (point.y - groupCenter.y) * groupScaleY }
    const rotated = rotate(relative, groupRotation)
    return { x: groupCenter.x + offsetX + rotated.x, y: groupCenter.y + offsetY + rotated.y }
  })
  return boundsOfPoints(moved)
}

/** Independent oracle for head-local hair and head-extra default transforms. */
function headLocalBounds(asset, transform, sourceHead, targetHead) {
  // Hair transforms are relative to the source head. Head-extra transforms
  // are already stored in canvas coordinates and only inherit the actor delta.
  const localX = transform.relativeToHead ? transform.x / sourceHead.width * targetHead.width : transform.x
  const localY = transform.relativeToHead ? transform.y / sourceHead.height * targetHead.height : transform.y
  const centerOffset = rotate({ x: localX - targetHead.width / 2, y: localY - targetHead.height / 2 }, targetHead.rotation)
  const center = { x: targetHead.x + targetHead.width / 2 + centerOffset.x,
    y: targetHead.y + targetHead.height / 2 + centerOffset.y }
  const width = asset.width * transform.scaleX * (transform.relativeToHead ? targetHead.width / sourceHead.width : 1)
  const height = asset.height * transform.scaleY * (transform.relativeToHead ? targetHead.height / sourceHead.height : 1)
  return rotatedRectangle(center, width, height, targetHead.rotation + transform.rotation)
}

function compareBounds(actual, expected, tolerance = 2) {
  if (!actual || !expected) return { passed: false, reason: 'missing-bounds', actual: actual ?? null, expected }
  const deltas = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, actual[key] - expected[key]]))
  return { passed: Object.values(deltas).every(delta => Math.abs(delta) <= tolerance),
    tolerancePixels: tolerance, actual, expected, deltas }
}

function expectedPoseDifference(changedPixelRatio, minimumChangedPixelRatio) {
  const expectedDifferenceObserved = Number.isFinite(changedPixelRatio)
    && Number.isFinite(minimumChangedPixelRatio)
    && minimumChangedPixelRatio >= 0
    && changedPixelRatio > minimumChangedPixelRatio
  return { identical: changedPixelRatio === 0, equivalent: null,
    expectedDifferenceObserved, passed: expectedDifferenceObserved,
    minimumChangedPixelRatio }
}

module.exports = { rotate, rotatedRectangle, boundComponentBounds, headLocalBounds, compareBounds, expectedPoseDifference }
