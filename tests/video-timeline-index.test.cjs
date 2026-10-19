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
