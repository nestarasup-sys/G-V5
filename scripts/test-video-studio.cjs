/**
 * Focused deterministic tests without a heavyweight test runner.
 * TypeScript is a direct devDependency; imported type references vanish at transpile.
 */
const fs = require('node:fs')
const assert = require('node:assert/strict')
const nodeCrypto = require('node:crypto')
const ts = require('typescript')
const { join } = require('node:path')

global.crypto ??= nodeCrypto.webcrypto
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  module._compile(js, filename)
}

const { createVideoProject } = require(join(__dirname, '../src/shared/videoStudio.ts'))
const {
  frameAtTime, stateAtFrame, evaluateVideoProject, recordVideoFrame, moveCharacterBoundary,
  updateVideoDuration
} = require(join(__dirname, '../src/renderer/src/features/videoStudio/videoRuntime.ts'))

const uid = () => nodeCrypto.randomUUID()
const make = () => {
  const project = createVideoProject(uid(), 'Teste', new Date().toISOString())
  const [one, two] = [uid(), uid()]
  project.elements.push(...[one, two].map((id, index) => ({
    id, kind: 'character', name: 'Personagem ' + index,
    assetId: uid(), x: 960, y: 540, width: 300, height: 600,
    rotation: 0, flipX: false, zIndex: index + 10
  })))
  project.characterTracks = [one, two].map((elementId, index) => ({
    id: uid(), elementId, name: 'Faixa ' + index, order: index, locked: false, collapsed: false,
    segments: [{ id: uid(), startFrame: 0, endFrameExclusive: project.durationFrames,
      state: { faceMode: 'idle', poseId: null, expressionId: null }, transitionInMs: 20 }]
  }))
  return project
}

const tests = []
const test = (name, run) => tests.push({ name, run })

test('new video: ten minutes at 60fps', () => {
  const project = make()
  assert.equal(project.durationFrames, 36000)
  assert.equal(frameAtTime(project, -10), 0)
  assert.equal(frameAtTime(project, 1 / 60), 1)
  assert.equal(frameAtTime(project, 9999), 35999)
  assert.equal(evaluateVideoProject(project, 0).characters.length, 2)
})

test('save frame affects only one character and preserves authoring range', () => {
  const original = make()
  const first = original.characterTracks[0]
  const next = recordVideoFrame(original, 90, { [first.elementId]: { faceMode: 'blink', poseId: null, expressionId: null } })
  assert.equal(original.characterTracks[0].segments.length, 1)
  assert.equal(next.characterTracks[0].segments.length, 2)
  assert.equal(next.characterTracks[1], original.characterTracks[1])
  assert.deepEqual(next.characterTracks[0].segments.map(s => [s.startFrame, s.endFrameExclusive]), [[0, 90], [90, 36000]])
  assert.equal(stateAtFrame(next.characterTracks[0], 89).faceMode, 'idle')
  assert.equal(stateAtFrame(next.characterTracks[0], 90).faceMode, 'blink')
  assert.equal(next.saveMarkers[0].frame, 90)
  assert.deepEqual(next.saveMarkers[0].affectedTrackIds, [first.id])
})

test('saving the same frame edits the segment, does not duplicate a boundary', () => {
  const original = make()
  const id = original.characterTracks[0].elementId
  const first = recordVideoFrame(original, 30, { [id]: { faceMode: 'blink', poseId: null, expressionId: null } })
  const second = recordVideoFrame(first, 30, { [id]: { faceMode: 'talk', poseId: null, expressionId: null } })
  assert.equal(second.characterTracks[0].segments.length, 2)
  assert.equal(second.characterTracks[0].segments[1].state.faceMode, 'talk')
  assert.equal(second.saveMarkers.length, 1)
})

test('one-frame segments are valid; shared boundary only changes adjacent sizes', () => {
  const original = make()
  const id = original.characterTracks[0].elementId
  const first = recordVideoFrame(original, 1, { [id]: { faceMode: 'blink', poseId: null, expressionId: null } })
  const a = first.characterTracks[0].segments[0]
  const b = first.characterTracks[0].segments[1]
  assert.deepEqual([a.startFrame, a.endFrameExclusive], [0, 1])
  const shifted = moveCharacterBoundary(first, first.characterTracks[0].id, a.id, b.id, 35)
  assert.deepEqual([shifted.characterTracks[0].segments[0].endFrameExclusive, shifted.characterTracks[0].segments[1].startFrame], [35, 35])
  assert.equal(shifted.characterTracks[0].segments[1].endFrameExclusive, 36000)
  assert.equal(shifted.characterTracks[0].segments[0].id, a.id)
  assert.equal(shifted.characterTracks[0].segments[1].id, b.id)
})

test('locks prevent editing and boundary changes', () => {
  const original = make()
  const locked = { ...original, characterTracks: original.characterTracks.map((track, index) => index === 0 ? { ...track, locked: true } : track) }
  const id = locked.characterTracks[0].elementId
  const next = recordVideoFrame(locked, 50, { [id]: { faceMode: 'talk', poseId: null, expressionId: null } })
  assert.equal(next.characterTracks[0], locked.characterTracks[0])
  assert.equal(next.saveMarkers[0].affectedTrackIds.length, 0)
  const from = recordVideoFrame(original, 50, { [id]: { faceMode: 'talk', poseId: null, expressionId: null } })
  const lockedSplit = { ...from, characterTracks: from.characterTracks.map((track, index) => index === 0 ? { ...track, locked: true } : track) }
  const segments = lockedSplit.characterTracks[0].segments
  assert.equal(moveCharacterBoundary(lockedSplit, lockedSplit.characterTracks[0].id, segments[0].id, segments[1].id, 80), lockedSplit)
})

test('duration extends existing tracks and refuses destructive reductions', () => {
  const original = make()
  const extended = updateVideoDuration(original, original.durationFrames + 60)
  assert.equal(extended.characterTracks[0].segments[0].endFrameExclusive, extended.durationFrames)
  const id = original.characterTracks[0].elementId
  const changed = recordVideoFrame(original, 35900, { [id]: { faceMode: 'talk', poseId: null, expressionId: null } })
  assert.equal(updateVideoDuration(changed, 35800), changed)
})

let failures = 0
for (const { name, run } of tests) {
  try { run(); process.stdout.write('✓ ' + name + '\n') }
  catch (error) { failures++; process.stderr.write('✗ ' + name + '\n' + String(error.stack ?? error) + '\n') }
}
if (failures) process.exitCode = 1
else process.stdout.write(tests.length + ' checks do Video Studio passaram.\n')
