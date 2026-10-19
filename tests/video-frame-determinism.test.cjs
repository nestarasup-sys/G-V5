'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const sourcePath = path.join(__dirname, '../src/shared/videoFrame.ts')
const compiled = ts.transpile(fs.readFileSync(sourcePath, 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const loaded = { exports: {} }
new Function('require', 'module', 'exports', compiled)(require, loaded, loaded.exports)
const { automaticBlinkFrameFor, resolveVideoFrameSelection } = loaded.exports

function fixture(overrides = {}) {
  return {
    schemaVersion: 1,
    frameRate: 60,
    durationFrames: 1200,
    playheadFrame: 0,
    playing: false,
    characterKeys: [],
    textClips: [],
    saveMarkers: [],
    ...overrides
  }
}

test('automatic blink schedule is deterministic for the same actor and absolute frame', () => {
  const samples = Array.from({ length: 1200 }, (_, frame) => automaticBlinkFrameFor(frame, 'synthetic-character-a'))
  assert.deepEqual(samples, Array.from({ length: 1200 }, (_, frame) => automaticBlinkFrameFor(frame, 'synthetic-character-a')))
  assert.ok(samples.some(Boolean))
  assert.ok(samples.some((value) => !value))
})

test('automatic blink schedule is stable by character and rejects invalid frames', () => {
  const a = Array.from({ length: 600 }, (_, frame) => automaticBlinkFrameFor(frame, 'synthetic-a'))
  const b = Array.from({ length: 600 }, (_, frame) => automaticBlinkFrameFor(frame, 'synthetic-b'))
  assert.notDeepEqual(a, b)
  assert.equal(automaticBlinkFrameFor(-1, 'synthetic-a'), false)
  assert.equal(automaticBlinkFrameFor(1.5, 'synthetic-a'), false)
  assert.equal(automaticBlinkFrameFor(10, ''), false)
})

test('absolute frame selection uses half-open boundaries for gaps, text and overlapping video clips', () => {
  const timeline = fixture({
    characterGaps: [{ id: 'gap', elementId: 'actor-a', startFrame: 10, endFrame: 20 }],
    textClips: [
      { id: 'text-1', elementId: 'balloon-a', kind: 'speech', startFrame: 10, endFrame: 30 },
      { id: 'text-2', elementId: 'balloon-b', kind: 'thought', startFrame: 20, endFrame: 30 }
    ],
    videoClips: [
      { id: 'video-1', assetId: 'asset-1', startFrame: 0, endFrame: 20, sourceStartFrame: 0, sourceEndFrame: 20 },
      { id: 'video-2', assetId: 'asset-2', startFrame: 15, endFrame: 25, sourceStartFrame: 0, sourceEndFrame: 10 }
    ]
  })
  const atStart = resolveVideoFrameSelection(timeline, 10)
  assert.equal(atStart.hiddenCharacterIds.has('actor-a'), true)
  assert.deepEqual([...atStart.textClipByElementId.keys()], ['balloon-a'])
  assert.deepEqual(atStart.videoClips.map((clip) => clip.id), ['video-1'])
  const overlap = resolveVideoFrameSelection(timeline, 20)
  assert.equal(overlap.hiddenCharacterIds.has('actor-a'), false)
  assert.deepEqual([...overlap.textClipByElementId.keys()], ['balloon-a', 'balloon-b'])
  assert.deepEqual(overlap.videoClips.map((clip) => clip.id), ['video-2'])
  assert.deepEqual(resolveVideoFrameSelection(timeline, 1200).videoClips, [])
})
