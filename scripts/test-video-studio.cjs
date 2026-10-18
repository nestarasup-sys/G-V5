'use strict'

// Run deterministic Video Studio contracts without adding a second test runtime.
// TypeScript is already a locked development dependency of the G-V5 app.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { webcrypto } = require('node:crypto')

function loadTs(relativePath) {
  const code = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
  const output = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const exports = {}
  vm.runInNewContext(output, { exports, crypto: webcrypto }, { filename: relativePath })
  return exports
}

const domain = loadTs('src/shared/videoStudio.ts')
const runtime = loadTs('src/renderer/src/features/videoStudio/videoRuntime.ts')
const createId = () => webcrypto.randomUUID()
const at = (track, frame) => runtime.stateAtFrame(track, frame)
const initial = { poseId: null, expressionId: null, faceMode: 'idle' }

function fixture() {
  const project = domain.createVideoProject(createId(), 'Teste', new Date().toISOString())
  const elementId = createId()
  const trackId = createId()
  project.elements.push({
    id: elementId, kind: 'character', name: 'Personagem',
    assetId: createId(), x: 0, y: 0, width: 20, height: 40,
    rotation: 0, zIndex: 10, flipX: false
  })
  project.characterTracks.push({
    id: trackId, elementId, name: 'Personagem', order: 0, locked: false, collapsed: false,
    segments: [{ id: createId(), startFrame: 0, endFrameExclusive: project.durationFrames,
      state: { ...initial }, transitionInMs: 20 }]
  })
  return { project, elementId, trackId }
}

function testBasics() {
  const { project } = fixture()
  assert.equal(project.frameRate, 60)
  assert.equal(project.durationFrames, 36000)
  assert.equal(runtime.frameAtTime(project, -3), 0)
  assert.equal(runtime.frameAtTime(project, 0.5), 30)
  assert.equal(runtime.frameAtTime(project, 600), 35999)
  assert.equal(runtime.frameAtTime(project, 60.00000000000001), 3600)
  assert.equal(runtime.evaluateVideoProject(project, 0).characters[0].state.faceMode, 'idle')
  assert.equal(runtime.evaluateVideoProject(project, 600).frame, 35999)
}

function testSaveFrame() {
  const { project, elementId, trackId } = fixture()
  const next = runtime.recordVideoFrame(project, 120, { [elementId]: { ...initial, faceMode: 'talk' } })
  const segments = next.characterTracks[0].segments
  assert.equal(segments.length, 2)
  assert.equal(segments[0].startFrame, 0)
  assert.equal(segments[0].endFrameExclusive, 120)
  assert.equal(segments[1].startFrame, 120)
  assert.equal(segments[1].endFrameExclusive, 36000)
  assert.equal(at(next.characterTracks[0], 119).faceMode, 'idle')
  assert.equal(at(next.characterTracks[0], 120).faceMode, 'talk')
  assert.equal(next.saveMarkers[0].frame, 120)
  assert.equal(next.saveMarkers[0].affectedTrackIds[0], trackId)

  const updated = runtime.recordVideoFrame(next, 120, { [elementId]: { ...initial, faceMode: 'blink' } })
  assert.equal(updated.characterTracks[0].segments.length, 2, 'save in same frame must not create a split')
  assert.equal(updated.saveMarkers.length, 1, 'markers should not duplicate')
  assert.equal(at(updated.characterTracks[0], 120).faceMode, 'blink')
  const same = runtime.recordVideoFrame(updated, 150, { [elementId]: { ...initial, faceMode: 'blink' } })
  assert.equal(same.characterTracks[0].segments.length, 2)
  assert.equal(same.saveMarkers.length, 2, 'no-op user save may still create marker')
  assert.equal(same.saveMarkers[1].affectedTrackIds.length, 0)
}

function testBoundary() {
  const { project, elementId } = fixture()
  const next = runtime.recordVideoFrame(project, 120, { [elementId]: { ...initial, faceMode: 'talk' } })
  const [left, right] = next.characterTracks[0].segments
  const moved = runtime.moveCharacterBoundary(next, next.characterTracks[0].id, left.id, right.id, 140)
  assert.equal(moved.characterTracks[0].segments[0].endFrameExclusive, 140)
  assert.equal(moved.characterTracks[0].segments[1].startFrame, 140)
  assert.equal(moved.characterTracks[0].segments[1].endFrameExclusive, 36000)

  const clamped = runtime.moveCharacterBoundary(next, next.characterTracks[0].id, left.id, right.id, 999999)
  assert.equal(clamped.characterTracks[0].segments[1].startFrame, 35999)
  assert.equal(clamped.characterTracks[0].segments[1].endFrameExclusive, 36000)
  const locked = {
    ...next, characterTracks: next.characterTracks.map(track => ({ ...track, locked: true }))
  }
  assert.equal(runtime.moveCharacterBoundary(locked, locked.characterTracks[0].id, left.id, right.id, 140), locked)
  assert.equal(runtime.recordVideoFrame(locked, 150, { [elementId]: { ...initial, faceMode: 'blink' } }).characterTracks[0].segments.length, 2)
}

function testDuration() {
  const { project, elementId } = fixture()
  const extended = runtime.updateVideoDuration(project, 720 * 60)
  assert.equal(extended.durationFrames, 43200)
  assert.equal(extended.characterTracks[0].segments[0].endFrameExclusive, 43200)
  const shorter = runtime.updateVideoDuration(extended, 540 * 60)
  assert.equal(shorter.characterTracks[0].segments[0].endFrameExclusive, 32400)
  const authored = runtime.recordVideoFrame(project, 35500, { [elementId]: { ...initial, faceMode: 'blink' } })
  assert.equal(runtime.updateVideoDuration(authored, 540 * 60), authored, 'must not silently truncate authored states')
}

function testText() {
  const { project } = fixture()
  project.textTracks[0].clips.push({
    id: createId(), startFrame: 61, endFrameExclusive: 121, text: 'Teste'
  })
  const before = runtime.evaluateVideoProject(project, 1).texts
  const active = runtime.evaluateVideoProject(project, 61/60).texts
  const after = runtime.evaluateVideoProject(project, 121/60).texts
  assert.equal(before.length, 0)
  assert.equal(active[0].text, 'Teste')
  assert.equal(after.length, 0)
}

for (const test of [testBasics, testSaveFrame, testBoundary, testDuration, testText]) {
  test()
  process.stdout.write('PASS ' + test.name + '\n')
}
