'use strict'

// Pure comparison logic; accepts Electron nativeImage.toBitmap() BGRA buffers.
// Keep threshold policy explicit; never silently turn a visual failure into pass.
function assertBitmap(bitmap, width, height, label) {
  if (!Buffer.isBuffer(bitmap) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width <= 0 || height <= 0 || bitmap.length !== width * height * 4) {
    throw new Error(`Invalid bitmap for ${label}: dimensions/bytes inconsistent`)
  }
}

function compareBitmaps(before, after, width, height, options = {}) {
  assertBitmap(before, width, height, 'before')
  assertBitmap(after, width, height, 'after')
  const channelTolerance = options.channelTolerance ?? 3
  if (!Number.isInteger(channelTolerance) || channelTolerance < 0 || channelTolerance > 255) {
    throw new Error('channelTolerance must be an integer [0,255]')
  }
  const pixels = width * height
  let changedPixels = 0, channelAbsoluteSum = 0, maxChannelDelta = 0
  let minX = width, minY = height, maxX = -1, maxY = -1
  const diff = Buffer.alloc(before.length)
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const i = pixel * 4
    let changed = false
    let largest = 0
    // Alpha matters, too; a transparent change still affects compositing.
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(before[i + channel] - after[i + channel])
      channelAbsoluteSum += delta
      largest = Math.max(largest, delta)
      if (delta > channelTolerance) changed = true
    }
    maxChannelDelta = Math.max(maxChannelDelta, largest)
    if (changed) {
      changedPixels++
      const x = pixel % width, y = Math.floor(pixel / width)
      minX = Math.min(minX, x); minY = Math.min(minY, y)
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
      // Mark changed pixels in opaque magenta, others transparent.
      diff[i] = 255; diff[i + 1] = 0; diff[i + 2] = 255; diff[i + 3] = 255
    }
  }
  return {
    schemaVersion: 1, width, height, pixels, channelTolerance,
    changedPixels, changedPixelRatio: changedPixels / pixels,
    meanAbsoluteChannelDelta: channelAbsoluteSum / (pixels * 4),
    maxChannelDelta,
    changeBounds: changedPixels ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
    diffBitmap: diff
  }
}

function evaluateVisualComparison(result, options = {}) {
  const maxChangedPixelRatio = options.maxChangedPixelRatio ?? 0.001
  if (!Number.isFinite(maxChangedPixelRatio) || maxChangedPixelRatio < 0 || maxChangedPixelRatio > 1) {
    throw new Error('maxChangedPixelRatio must be between 0 and 1')
  }
  const passed = result.changedPixelRatio <= maxChangedPixelRatio
  return {
    passed, maxChangedPixelRatio, changedPixels: result.changedPixels,
    changedPixelRatio: result.changedPixelRatio, changeBounds: result.changeBounds,
    meanAbsoluteChannelDelta: result.meanAbsoluteChannelDelta, maxChannelDelta: result.maxChannelDelta
  }
}

module.exports = { compareBitmaps, evaluateVisualComparison }
