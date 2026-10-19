'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function loadPureTs(file) {
  const source = fs.readFileSync(path.resolve(__dirname, file), 'utf8')
  const compiled = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((name) => { throw new Error(`Import inesperado: ${name}`) }, mod, mod.exports)
  return mod.exports
}

const { mixAngle, mixPoseArtwork, mixStageElement, transitionProgress } = loadPureTs('../src/shared/videoCharacterInterpolation.ts')

function part(id, x, y, rotation, jointAnchor = { x: 0, y: 0 }) {
  return { id, name: id, x, y, width: 20, height: 30, rotation, jointAnchor, dataUrl: 'data:image/png;base64,SYNTHETIC' }
}

function articulatedPose(offset, childRotation) {
  const root = part('arm-upper', 20 + offset, 10, 0, { x: 30 + offset, y: 25 })
  const child = part('arm-lower', 48 + offset, 20, childRotation, { x: 50 + offset, y: 25 })
  return {
    width: 120, height: 100, parts: [root, child], layerOrder: ['arm-upper', 'arm-lower'], hiddenPartIds: [],
    joints: [{ id: 'elbow', parentPartId: root.id, childPartId: child.id, parentAnchor: { x: 38 + offset, y: 25 }, childAnchor: { x: 50 + offset, y: 25 } }],
  }
}

test('rotation interpolation follows the shortest angular path and transition samples are clamped', () => {
  assert.equal(mixAngle(350, 10, .5), 360)
  assert.equal(mixAngle(10, 350, .5), 0)
  assert.equal(transitionProgress({ startFrame: 5, boundaryFrame: 20 }, 12.5), .5)
  assert.equal(transitionProgress({ startFrame: 5, boundaryFrame: 20 }, -1), 0)
  assert.equal(transitionProgress({ startFrame: 5, boundaryFrame: 20 }, 25), 1)
})

test('stage transforms interpolate continuously without changing authored inputs', () => {
  const left = { id: 'actor', kind: 'character', x: 10, y: 20, width: 100, height: 200, rotation: 350, zIndex: 2, characterScale: 80 }
  const right = { ...left, x: 30, y: 60, width: 200, height: 300, rotation: 10, zIndex: 8, characterScale: 120 }
  const result = mixStageElement(left, right, .5)
  assert.deepEqual([result.x, result.y, result.width, result.height, result.rotation, result.characterScale], [20, 40, 150, 250, 360, 100])
  assert.equal(result.zIndex, right.zIndex, 'the exact midpoint selects discrete properties from the right state')
  assert.equal(left.x, 10)
  assert.equal(right.x, 30)
})

test('pose interpolation preserves articulated member links and is repeatable after reverse seeks', () => {
  const from = articulatedPose(0, 350)
  const to = articulatedPose(14, 10)
  const middle = mixPoseArtwork(from, to, .5)
  const reverseOrderMiddle = mixPoseArtwork(from, to, .5)
  assert.deepEqual(middle, reverseOrderMiddle)
  assert.equal(middle.width, 120)
  assert.deepEqual(middle.layerOrder, from.layerOrder)
  assert.deepEqual(middle.parts.map(({ id }) => id), ['arm-upper', 'arm-lower'])
  assert.equal(middle.parts[1].rotation, 360, 'the articulated forearm rotates through the shortest angle')
  assert.equal(middle.joints.length, 1)
  assert.equal(middle.joints[0].parentPartId, 'arm-upper')
  assert.equal(middle.joints[0].childPartId, 'arm-lower')
  assert.ok(Number.isFinite(middle.joints[0].parentAnchor.x) && Number.isFinite(middle.joints[0].childAnchor.x))
  assert.equal(mixPoseArtwork(from, to, 0), from, 'the start boundary returns the exact authored pose')
  assert.equal(mixPoseArtwork(from, to, 1), to, 'the end boundary returns the exact authored pose')
  assert.equal(from.parts[1].x, 48, 'interpolation does not mutate the first authored pose')
  assert.equal(to.parts[1].x, 62, 'interpolation does not mutate the second authored pose')
})
