const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
function load(file) {
  const module = { exports: {} }
  const code = ts.transpile(fs.readFileSync(path.resolve(__dirname, file), 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
  new Function('module', 'exports', code)(module, module.exports)
  return module.exports
}
const { resizeTimelineBlock } = load('../src/shared/videoTimelineEditing.ts')
const { fitVideoTimelineDuration } = load('../src/shared/videoTimelineDuration.ts')
const key = (id, frame) => ({ id, elementId: 'actor', frame, poseSlot: null, expressionCollectionId: null, expressionPresetId: id, faceMode: 'idle', state: { imageDataUrl: id, element: { id: 'actor' } } })
const timeline = (more = {}) => ({ schemaVersion: 1, frameRate: 60, durationFrames: 600, playheadFrame: 0, playing: false, characterKeys: [key('A', 0), key('B', 120), key('C', 240), key('D', 360)], textClips: [], saveMarkers: [], ...more })
function stateAt(t, frame, id = 'actor') {
  if (t.characterGaps?.some((gap) => gap.elementId === id && gap.startFrame <= frame && frame < gap.endFrame)) return null
  return t.characterKeys.filter((key) => key.elementId === id && key.frame <= frame).sort((a, b) => a.frame - b.frame).at(-1)?.state?.imageDataUrl
}

test('character right edge consumes multiple neighbours and preserves their remaining state', () => {
  const source = timeline()
  const edited = resizeTimelineBlock(source, { kind: 'character', elementId: 'actor', startFrame: 0, endFrame: 120 }, 0, 300)
  assert.equal(stateAt(edited, 299), 'A')
  assert.equal(stateAt(edited, 300), 'C')
  assert.equal(stateAt(edited, 360), 'D')
  assert.equal(edited.characterKeys.some((key) => key.id === 'B'), false)
  assert.equal(source.characterKeys[1].frame, 120)
})
test('character left edge consumes previous blocks without changing the selected pose', () => {
  const edited = resizeTimelineBlock(timeline(), { kind: 'character', elementId: 'actor', startFrame: 240, endFrame: 360 }, 60, 360)
  assert.equal(stateAt(edited, 59), 'A')
  assert.equal(stateAt(edited, 60), 'C')
  assert.equal(stateAt(edited, 359), 'C')
  assert.equal(stateAt(edited, 360), 'D')
})
test('shrinking either edge leaves empty space and preserves all adjacent blocks', () => {
  for (const [start, end] of [[150, 240], [120, 180]]) {
    const edited = resizeTimelineBlock(timeline(), { kind: 'character', elementId: 'actor', startFrame: 120, endFrame: 240 }, start, end)
    assert.equal(stateAt(edited, 119), 'A')
    assert.equal(stateAt(edited, start), 'B')
    assert.equal(stateAt(edited, 240), 'C')
    assert.equal(stateAt(edited, start > 120 ? 120 : 239), null)
  }
})
test('the last character edge grows project duration, survives JSON reload, and sets export duration', () => {
  const edited = JSON.parse(JSON.stringify(resizeTimelineBlock(timeline(), { kind: 'character', elementId: 'actor', startFrame: 360, endFrame: 600 }, 360, 900, ['actor', 'other'])))
  assert.equal(edited.durationFrames, 900)
  assert.equal(fitVideoTimelineDuration(edited), 900)
  assert.equal(stateAt(edited, 899), 'D')
  assert.equal(stateAt(edited, 600, 'other'), null)
})
test('fully consuming the following characters leaves only the resized block', () => {
  const edited = resizeTimelineBlock(timeline(), { kind: 'character', elementId: 'actor', startFrame: 0, endFrame: 120 }, 0, 780)
  assert.deepEqual(edited.characterKeys.map((key) => key.id), ['A'])
  assert.equal(stateAt(edited, 779), 'A')
})
for (const kind of ['speech', 'thought']) {
  test(`${kind}: resizing consumes other clips in the same lane but preserves the other lane`, () => {
    const source = timeline({ textClips: [{ id: 'a', elementId: 'one', kind, startFrame: 0, endFrame: 120 }, { id: 'b', elementId: 'two', kind, startFrame: 120, endFrame: 240 }, { id: 'c', elementId: 'three', kind, startFrame: 240, endFrame: 600 }, { id: 'other', kind: kind === 'speech' ? 'thought' : 'speech', startFrame: 0, endFrame: 600 }] })
    const edited = resizeTimelineBlock(source, { kind: 'text', clipId: 'a' }, 0, 300)
    assert.deepEqual(edited.textClips.map(({ id, startFrame, endFrame }) => [id, startFrame, endFrame]), [['a', 0, 300], ['c', 300, 600], ['other', 0, 600]])
    const grown = resizeTimelineBlock(edited, { kind: 'text', clipId: 'a' }, 0, 900)
    assert.equal(grown.durationFrames, 900)
    assert.equal(grown.textClips.some((clip) => clip.id === 'c'), false)
  })
}
test('video overlap trims source audio/video windows and preserves source limits', () => {
  const source = timeline({ videoAssets: [{ id: 'asset', durationFrames: 1200 }], videoClips: [{ id: 'a', assetId: 'asset', startFrame: 0, endFrame: 120, sourceStartFrame: 0, sourceEndFrame: 120 }, { id: 'b', assetId: 'asset', startFrame: 120, endFrame: 600, sourceStartFrame: 0, sourceEndFrame: 480 }] })
  const edited = resizeTimelineBlock(source, { kind: 'video', clipId: 'a' }, 0, 300)
  assert.deepEqual(edited.videoClips.map(({ id, startFrame, endFrame, sourceStartFrame, sourceEndFrame }) => [id, startFrame, endFrame, sourceStartFrame, sourceEndFrame]), [['a', 0, 300, 0, 300], ['b', 300, 600, 180, 480]])
  assert.equal(resizeTimelineBlock(source, { kind: 'video', clipId: 'a' }, 0, 1201), source)
  assert.equal(resizeTimelineBlock(source, { kind: 'video', clipId: 'a' }, 0, 900).durationFrames, 900)
})
test('locked lanes reject the entire transaction', () => {
  const source = timeline({ trackSettings: { actor: { locked: true } } })
  assert.equal(resizeTimelineBlock(source, { kind: 'character', elementId: 'actor', startFrame: 0, endFrame: 120 }, 0, 900), source)
})
