'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function loadPureTs(file, deps = {}) {
  const text = fs.readFileSync(path.resolve(__dirname, file), 'utf8')
  const compiled = ts.transpile(text, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((name) => {
    if (name in deps) return deps[name]
    throw new Error(`Import não permitido na fixture: ${name}`)
  }, mod, mod.exports)
  return mod.exports
}

const frame = loadPureTs('../src/shared/videoFrame.ts')
const { createVideoExportSnapshot, serializeVideoExportSnapshot, parseVideoExportSnapshot, resolveVideoExportFrameSelection } = loadPureTs(
  '../src/shared/videoExportSnapshot.ts',
  { './videoFrame': frame }
)

function fixture() {
  return {
    schemaVersion: 1,
    id: 'synthetic-studio',
    title: 'Fixture sem mídia privada',
    color: '#333333',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    backgroundColor: '#ffffff',
    backgroundAssetId: null,
    backgroundX: 0,
    backgroundY: 0,
    backgroundWidth: 1920,
    backgroundHeight: 1080,
    backgroundRotation: 0,
    assets: [],
    elements: [{
      id: 'synthetic-actor', kind: 'character', text: '', x: 0, y: 0,
      width: 100, height: 100, rotation: 0, zIndex: 10
    }],
    videoTimeline: {
      schemaVersion: 1,
      frameRate: 60,
      durationFrames: 30,
      playheadFrame: 17,
      playing: true,
      characterKeys: [],
      textClips: [{
        id: 'synthetic-text', elementId: 'bubble-a',
        kind: 'speech', startFrame: 12, endFrame: 20
      }],
      characterGaps: [{
        id: 'synthetic-gap', elementId: 'synthetic-actor',
        startFrame: 14, endFrame: 17
      }],
      videoClips: [{
        id: 'synthetic-clip', assetId: 'synthetic-video',
        startFrame: 10, endFrame: 20, sourceStartFrame: 30, sourceEndFrame: 40
      }],
      saveMarkers: []
    }
  }
}

test('job snapshot isolates playback and is immutable without changing source', () => {
  const source = fixture()
  const snap = createVideoExportSnapshot(source)
  assert.equal(source.videoTimeline.playing, true)
  assert.equal(source.videoTimeline.playheadFrame, 17)
  assert.equal(snap.timeline.playing, false)
  assert.equal(snap.timeline.playheadFrame, 0)
  assert.equal(snap.studio.videoTimeline, snap.timeline)
  assert.notEqual(snap.studio, source)
  assert.ok(Object.isFrozen(snap.studio))
  assert.ok(Object.isFrozen(snap.timeline.videoClips[0]))
  assert.throws(() => { snap.timeline.durationFrames = 999 }, TypeError)
  source.videoTimeline.videoClips[0].sourceStartFrame = 900
  assert.equal(snap.timeline.videoClips[0].sourceStartFrame, 30)
  assert.deepEqual(resolveVideoExportFrameSelection(snap, 10).videos.map((v) => v.sourceFrame), [30])
})

test('canonical snapshot serialization survives round-trip and ignores object key insertion order', () => {
  const original = fixture()
  const reordered = Object.fromEntries(Object.entries(original).reverse())
  const serialized = serializeVideoExportSnapshot(createVideoExportSnapshot(original))
  const reorderedSerialized = serializeVideoExportSnapshot(createVideoExportSnapshot(reordered))
  assert.equal(serialized, reorderedSerialized)

  const restored = parseVideoExportSnapshot(serialized)
  assert.deepEqual(serializeVideoExportSnapshot(restored), serialized)
  assert.equal(restored.studio.videoTimeline.playheadFrame, 0)
  assert.equal(restored.studio.videoTimeline.playing, false)
  assert.ok(Object.isFrozen(restored.studio))
  assert.throws(() => parseVideoExportSnapshot('{broken'), /corrompido/)
  assert.throws(() => parseVideoExportSnapshot(JSON.stringify({ schemaVersion: 2 })), /incompatível/)
})

test('absolute frame selection is reproducible at half-open clip, gap and text boundaries', () => {
  const snap = createVideoExportSnapshot(fixture())
  assert.equal(resolveVideoExportFrameSelection(snap, 9).videos.length, 0)
  assert.deepEqual(resolveVideoExportFrameSelection(snap, 10).videos.map((v) => v.sourceFrame), [30])
  assert.deepEqual(resolveVideoExportFrameSelection(snap, 19).videos.map((v) => v.sourceFrame), [39])
  assert.equal(resolveVideoExportFrameSelection(snap, 20).videos.length, 0)
  assert.deepEqual(resolveVideoExportFrameSelection(snap, 12).texts.map((v) => v.clipId), ['synthetic-text'])
  assert.equal(resolveVideoExportFrameSelection(snap, 20).texts.length, 0)
  assert.equal(resolveVideoExportFrameSelection(snap, 13).characters[0].hidden, false)
  assert.equal(resolveVideoExportFrameSelection(snap, 14).characters[0].hidden, true)
  assert.equal(resolveVideoExportFrameSelection(snap, 16).characters[0].hidden, true)
  assert.equal(resolveVideoExportFrameSelection(snap, 17).characters[0].hidden, false)
  assert.deepEqual(resolveVideoExportFrameSelection(snap, 15), resolveVideoExportFrameSelection(snap, 15))
  assert.equal(resolveVideoExportFrameSelection(snap, 29).timeSeconds, 29 / 60)
})

test('invalid ranges and malformed timelines fail before scheduling frames', () => {
  const snap = createVideoExportSnapshot(fixture())
  for (const bad of [-1, 30, 1.5, NaN, Infinity]) {
    assert.throws(() => resolveVideoExportFrameSelection(snap, bad), RangeError)
  }
  const invalid = fixture()
  invalid.videoTimeline.videoClips[0].sourceEndFrame = 35
  assert.throws(() => createVideoExportSnapshot(invalid), /limites incompatíveis/)
  invalid.videoTimeline.videoClips[0].sourceEndFrame = 40
  invalid.videoTimeline.frameRate = 30
  assert.throws(() => createVideoExportSnapshot(invalid), /60 FPS/)
  assert.throws(() => createVideoExportSnapshot({ ...invalid, videoTimeline: undefined }), /Video Studio/)
})
