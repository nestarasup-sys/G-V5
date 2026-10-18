import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/shared/videoMedia.ts', import.meta.url), 'utf8')
const audioSource = await readFile(new URL('../src/shared/videoAudio.ts', import.meta.url), 'utf8')
const audioCompiled = ts.transpileModule(audioSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const audioUrl = `data:text/javascript;base64,${Buffer.from(audioCompiled).toString('base64')}`
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace("'./videoAudio'", JSON.stringify(audioUrl))
const { editVideoMediaClip, isValidVideoMediaClip, splitVideoMediaClip } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const clip = { id: 'clip', assetId: 'asset', startFrame: 180, endFrame: 780, sourceStartFrame: 120, sourceEndFrame: 720 }
const original = JSON.stringify(clip)
const edit = (mode, frame) => editVideoMediaClip(clip, mode, frame, 1200, 36000)
assert.deepEqual(edit('move', 600), { ...clip, startFrame: 600, endFrame: 1200 })
assert.deepEqual(edit('move', -100), { ...clip, startFrame: 0, endFrame: 600 })
assert.deepEqual(edit('move', 36000), { ...clip, startFrame: 35400, endFrame: 36000 })
assert.deepEqual(edit('start', 300), { ...clip, startFrame: 300, sourceStartFrame: 240 })
assert.deepEqual(edit('end', 660), { ...clip, endFrame: 660, sourceEndFrame: 600 })
assert.deepEqual(edit('start', -100), { ...clip, startFrame: 60, sourceStartFrame: 0 })
assert.deepEqual(edit('end', 2000), { ...clip, endFrame: 1260, sourceEndFrame: 1200 })
assert.equal(edit('start', 1000).endFrame - edit('start', 1000).startFrame, 1)
assert.equal(edit('end', 0).endFrame - edit('end', 0).startFrame, 1)
assert.equal(edit('move', Infinity), clip)

const [left, right] = splitVideoMediaClip(clip, 480, 'right')
assert.deepEqual(left, { ...clip, endFrame: 480, sourceEndFrame: 420 })
assert.deepEqual(right, { ...clip, id: 'right', startFrame: 480, sourceStartFrame: 420 })
assert.equal(left.sourceEndFrame, right.sourceStartFrame, 'A split must preserve source continuity')
assert.equal(splitVideoMediaClip(clip, 180, 'right'), null)
assert.equal(splitVideoMediaClip(clip, 780, 'right'), null)
assert.equal(splitVideoMediaClip(clip, 480.5, 'right'), null)
const movedRight = editVideoMediaClip(right, 'move', 900, 1200, 36000)
assert.equal(movedRight.sourceStartFrame, 420, 'Moving a split segment must not restart the source')
const restoredLeft = editVideoMediaClip(left, 'end', 780, 1200, 36000)
assert.deepEqual(restoredLeft, clip, 'An edge can reveal trimmed footage again')
for (const value of [clip, left, right, movedRight, edit('start', 300), edit('end', 660)]) {
  assert.ok(isValidVideoMediaClip(JSON.parse(JSON.stringify(value)), 1200, 36000), 'Saved source and timeline windows must remain valid')
}
assert.equal(isValidVideoMediaClip({ ...clip, sourceEndFrame: 721 }, 1200, 36000), false)
assert.equal(isValidVideoMediaClip({ ...clip, sourceEndFrame: 1300 }, 1200, 36000), false)
assert.equal(JSON.stringify(clip), original, 'Editing must not mutate the original clip')
console.log('Video media audit passed: move, trim, limits, split continuity, source recovery, serialization, and immutability.')
