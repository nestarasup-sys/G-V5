'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { compareBitmaps, evaluateVisualComparison } = require('../scripts/dev-ai/visual-regression.cjs')

function bitmap(width, height, fill = [0, 0, 0, 255]) {
  const result = Buffer.alloc(width * height * 4)
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    for (let channel = 0; channel < 4; channel += 1) result[pixel * 4 + channel] = fill[channel]
  }
  return result
}

test('identical captures produce no changed pixels', () => {
  const before = bitmap(10, 10, [10, 20, 30, 255])
  const result = compareBitmaps(before, Buffer.from(before), 10, 10)
  assert.equal(result.changedPixels, 0)
  assert.equal(result.changeBounds, null)
  assert.equal(evaluateVisualComparison(result).passed, true)
  assert.equal(result.diffBitmap.length, 400)
})

test('single changed pixel reports bounds and fails strict policy', () => {
  const before = bitmap(10, 10)
  const after = Buffer.from(before)
  const pixel = 7 * 10 + 3
  after[pixel * 4 + 2] = 40
  const result = compareBitmaps(before, after, 10, 10)
  assert.equal(result.changedPixels, 1)
  assert.deepEqual(result.changeBounds, { x: 3, y: 7, width: 1, height: 1 })
  assert.equal(evaluateVisualComparison(result).passed, false)
  assert.equal(result.diffBitmap[pixel * 4], 255)
  assert.equal(result.diffBitmap[pixel * 4 + 3], 255)
})

test('antialias tolerance ignores small per-channel fluctuations', () => {
  const before = bitmap(4, 4, [200, 200, 200, 255])
  const after = Buffer.from(before)
  after[0] = 202; after[1] = 198; after[2] = 203
  const metrics = compareBitmaps(before, after, 4, 4, { channelTolerance: 3 })
  assert.equal(metrics.changedPixels, 0)
  assert.equal(metrics.maxChannelDelta, 3)
  assert.equal(evaluateVisualComparison(metrics).passed, true)
  assert.equal(compareBitmaps(before, after, 4, 4, { channelTolerance: 2 }).changedPixels, 1)
})

test('material visual regression fails even if hashes were computed separately', () => {
  const before = bitmap(100, 100, [0, 0, 0, 255])
  const after = bitmap(100, 100, [255, 255, 255, 255])
  const result = compareBitmaps(before, after, 100, 100)
  assert.equal(result.changedPixels, 10_000)
  assert.equal(evaluateVisualComparison(result).passed, false)
  assert.deepEqual(result.changeBounds, { x: 0, y: 0, width: 100, height: 100 })
})

test('dimensions and threshold cannot silently pass', () => {
  const before = bitmap(2, 2)
  assert.throws(() => compareBitmaps(before, Buffer.alloc(0), 2, 2), /Invalid bitmap/)
  assert.throws(() => compareBitmaps(before, before, 2, 2, { channelTolerance: -1 }), /channelTolerance/)
  assert.throws(() => evaluateVisualComparison({ changedPixelRatio: 0 }, { maxChangedPixelRatio: -0.1 }), /maxChangedPixelRatio/)
})

test('only an explicitly scoped tiny difference is tolerated', () => {
  const before = bitmap(100, 100)
  const after = Buffer.from(before)
  for (let i = 0; i < 8; i += 1) after[i * 4] = 10
  const result = compareBitmaps(before, after, 100, 100)
  assert.equal(result.changedPixels, 8)
  assert.equal(evaluateVisualComparison(result, { maxChangedPixelRatio: 0.001 }).passed, true)
  assert.equal(evaluateVisualComparison(result, { maxChangedPixelRatio: 0.0005 }).passed, false)
})
