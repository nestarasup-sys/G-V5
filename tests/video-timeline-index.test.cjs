'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const sourcePath = path.join(__dirname, '../src/renderer/src/features/videoStudio/videoTimelineIndex.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const compiled = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const loadedModule = { exports: {} }
new Function('require', 'module', 'exports', compiled)(require, loadedModule, loadedModule.exports)
const { characterKeysForFrameRange, characterSegmentAtFrame, clipsForFrameRange, indexVideoTimeline, nearestTimelineSnapFrame } = loadedModule.exports
const characterTrackPath = path.join(__dirname, '../src/renderer/src/features/videoStudio/characterTrack.ts')
const characterTrackSource = fs.readFileSync(characterTrackPath, 'utf8')
const characterTrackCompiled = ts.transpile(characterTrackSource, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const loadedCharacterTrack = { exports: {} }
const characterTimelinePath = path.join(__dirname, '../src/shared/videoCharacterTimeline.ts')
const characterTimelineSource = fs.readFileSync(characterTimelinePath, 'utf8')
const characterTimelineCompiled = ts.transpile(characterTimelineSource, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const loadedCharacterTimeline = { exports: {} }
new Function('require', 'module', 'exports', characterTimelineCompiled)(require, loadedCharacterTimeline, loadedCharacterTimeline.exports)
new Function('require', 'module', 'exports', characterTrackCompiled)((name) => {
  if (name === '../../../../shared/videoCharacterTimeline') return loadedCharacterTimeline.exports
  return require(name)
}, loadedCharacterTrack, loadedCharacterTrack.exports)
const { characterStateAt } = loadedCharacterTrack.exports

function timeline(overrides = {}) {
  return {
    schemaVersion: 1,
    frameRate: 60,
    durationFrames: 600,
    playheadFrame: 0,
    playing: false,
    characterKeys: [],
    textClips: [],
    saveMarkers: [],
    ...overrides
  }
}

test('timeline index resolves character segments and deleted gaps at boundaries', () => {
  const index = indexVideoTimeline(timeline({
    characterKeys: [{ id: 'k2', elementId: 'actor', frame: 30 }, { id: 'k1', elementId: 'actor', frame: 10 }],
    characterGaps: [
      { id: 'g2', elementId: 'actor', startFrame: 22, endFrame: 25 },
      { id: 'g1', elementId: 'actor', startFrame: 15, endFrame: 18 }
    ]
  }))

  assert.deepEqual(index.characterKeysByElement.get('actor').map((key) => key.frame), [10, 30])
  assert.deepEqual(characterSegmentAtFrame(index, 'actor', 9, 600), { startFrame: 0, endFrame: 10 })
  assert.deepEqual(characterSegmentAtFrame(index, 'actor', 14, 600), { startFrame: 10, endFrame: 15 })
  assert.equal(characterSegmentAtFrame(index, 'actor', 16, 600), null)
  assert.deepEqual(characterSegmentAtFrame(index, 'actor', 20, 600), { startFrame: 18, endFrame: 22 })
  assert.deepEqual(characterSegmentAtFrame(index, 'actor', 28, 600), { startFrame: 25, endFrame: 30 })
  assert.deepEqual(characterSegmentAtFrame(index, 'actor', 40, 600), { startFrame: 30, endFrame: 600 })
})

test('snap index is ordered, keeps shared boundaries, and ignores only the dragged clip', () => {
  const index = indexVideoTimeline(timeline({
    characterKeys: [{ id: 'key', elementId: 'actor', frame: 100 }],
    textClips: [
      { id: 'dragged', elementId: 'speech', kind: 'speech', startFrame: 200, endFrame: 240 },
      { id: 'other', elementId: 'thought', kind: 'thought', startFrame: 240, endFrame: 300 }
    ],
    videoClips: [{ id: 'video', assetId: 'asset', startFrame: 400, endFrame: 500, sourceStartFrame: 0, sourceEndFrame: 100 }]
  }))

  assert.deepEqual(index.snapFrames, [100, 200, 240, 300, 400, 500])
  assert.equal(nearestTimelineSnapFrame(index, 241, 0, 60, 'dragged'), 240, 'a coincident boundary from the other clip remains usable')
  assert.equal(nearestTimelineSnapFrame(index, 201, 0, 60, 'dragged'), 201, 'the dragged clip cannot snap back to its own start')
  assert.equal(nearestTimelineSnapFrame(index, 101, 0, 60), 100)
})

test('timeline indexes handle large synthetic keyframe sets without changing lookup results', () => {
  const keys = Array.from({ length: 10000 }, (_, frame) => ({ id: `k${frame}`, elementId: `actor${frame % 10}`, frame: frame * 2 }))
  const index = indexVideoTimeline(timeline({ durationFrames: 20001, characterKeys: keys }))
  assert.equal(index.characterKeysByElement.get('actor7').length, 1000)
  assert.deepEqual(characterSegmentAtFrame(index, 'actor7', 19995, 20001), { startFrame: 19994, endFrame: 20001 })
  assert.equal(nearestTimelineSnapFrame(index, 19995, 0, 60), 19994)
})

test('visible keyframe window retains only the viewport boundaries needed for segment rendering', () => {
  const keys = Array.from({ length: 10000 }, (_, frame) => ({ id: `k${frame}`, elementId: 'actor', frame: frame * 10 }))
  const visible = characterKeysForFrameRange(keys, 50000, 50100)
  assert.deepEqual(visible.map((key) => key.frame), [50000, 50010, 50020, 50030, 50040, 50050, 50060, 50070, 50080, 50090, 50100, 50110])
  assert.deepEqual(characterKeysForFrameRange(keys, 0, 0).map((key) => key.frame), [0, 10])
})

test('clip viewport query handles long overlapping clips without scanning unrelated rows', () => {
  const index = indexVideoTimeline(timeline({
    textClips: [
      { id: 'old', elementId: 'speech', kind: 'speech', startFrame: 0, endFrame: 40 },
      { id: 'long', elementId: 'speech', kind: 'speech', startFrame: 10, endFrame: 90 },
      { id: 'middle', elementId: 'speech', kind: 'speech', startFrame: 50, endFrame: 70 },
      { id: 'later', elementId: 'speech', kind: 'speech', startFrame: 75, endFrame: 100 },
      { id: 'far', elementId: 'speech', kind: 'speech', startFrame: 500, endFrame: 600 }
    ]
  }))
  const visible = clipsForFrameRange(index.textClipsByElement.get('speech'), index.textClipPrefixMaxEndByElement.get('speech'), 50, 80)
  assert.deepEqual(visible.map((clip) => clip.id), ['long', 'middle', 'later'])
})

test('character preview state lookup preserves same-frame key order and frame boundaries', () => {
  const state = (id) => ({ imageDataUrl: `data:${id}`, element: { id: 'actor', kind: 'character', x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 1, pose: id } })
  const doc = timeline({
    characterBases: { actor: state('base') },
    characterKeys: [
      { id: 'later', elementId: 'actor', frame: 10, state: state('later') },
      { id: 'first', elementId: 'actor', frame: 10, state: state('first') },
      { id: 'empty', elementId: 'actor', frame: 20 },
      { id: 'next', elementId: 'actor', frame: 30, state: state('next') }
    ]
  })

  assert.equal(characterStateAt(doc, 'actor', 9).element.pose, 'base')
  assert.equal(characterStateAt(doc, 'actor', 10).element.pose, 'first', 'same-frame ties retain original stable-sort semantics')
  assert.equal(characterStateAt(doc, 'actor', 20).element.pose, 'first', 'a key without a state does not clear the preceding appearance')
  assert.equal(characterStateAt(doc, 'actor', 29).element.pose, 'first')
  assert.equal(characterStateAt(doc, 'actor', 30).element.pose, 'next')
})

test('shared absolute character resolver preserves pose crop bounds with global placement priority', () => {
  const state = { imageDataUrl: 'data:synthetic', element: { id: 'actor', kind: 'character', x: 1, y: 2, width: 100, height: 80, rotation: 0, zIndex: 3 } }
  const legacy = timeline({ characterBases: { actor: state }, characterPositions: { actor: { x: 12, y: 34 } } })
  assert.equal(characterStateAt(legacy, 'actor', 0).element.x, 12)
  assert.equal(characterStateAt(legacy, 'actor', 0).element.y, 34)

  const global = timeline({
    characterBases: { actor: state },
    characterPositions: { actor: { x: 12, y: 34 } },
    characterTransforms: { actor: { x: 80, y: 90, width: 200, height: 160, rotation: 25, zIndex: 9 } }
  })
  const transformed = characterStateAt(global, 'actor', 0).element
  assert.deepEqual([transformed.x, transformed.y, transformed.width, transformed.height, transformed.rotation, transformed.zIndex], [80, 90, 100, 80, 25, 9])
})


test('sparse character keys resolve to the last authored artwork without replaying empty metadata', () => {
  const state = (pose) => ({ imageDataUrl: `data:${pose}`, element: { id: 'actor', kind: 'character', x: 1, y: 2, width: 60, height: 80, rotation: 0, zIndex: 1, poseSlot: pose } })
  const keys = Array.from({ length: 12000 }, (_, frame) => ({ id: `metadata-${frame}`, elementId: 'actor', frame: frame + 1 }))
  keys.push({ id: 'visual-in-middle', elementId: 'actor', frame: 6000, state: state('middle') })
  keys.push({ id: 'visual-at-end', elementId: 'actor', frame: 12000, state: state('last') })
  keys.push({ id: 'visual-at-end-later-tie', elementId: 'actor', frame: 12000, state: state('latest-tie') })
  const doc = timeline({ durationFrames: 13000, characterBases: { actor: state('base') }, characterKeys: keys })
  assert.equal(characterStateAt(doc, 'actor', 0).element.poseSlot, 'base')
  assert.equal(characterStateAt(doc, 'actor', 5999).element.poseSlot, 'base')
  assert.equal(characterStateAt(doc, 'actor', 6000).element.poseSlot, 'middle')
  assert.equal(characterStateAt(doc, 'actor', 11999).element.poseSlot, 'middle')
  assert.equal(characterStateAt(doc, 'actor', 12000).element.poseSlot, 'latest-tie')
  assert.equal(characterStateAt(doc, 'actor', 12999).element.poseSlot, 'latest-tie')
  assert.equal(characterStateAt(doc, 'actor', 5999).element.poseSlot, 'base', 'reverse seek remains deterministic')
  assert.deepEqual(doc.characterKeys, keys, 'lookup never mutates authored keyframe order')
})
