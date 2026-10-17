import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/shared/hairPersistence.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const { normalizeHairTransforms, emptyHairTransform } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const active = { x: 10.510490475594969, y: 162.2963077175987, scaleX: .37, scaleY: .39, rotation: 0, flipX: true }
const missing = { x: 105, y: 71, scaleX: 222, scaleY: 135, rotation: 0 }
const draft = { front: null, back: { width: 818, height: 729 }, fringe: null, transforms: { front: missing, back: active, fringe: missing } }
const before = JSON.stringify(draft)
const result = normalizeHairTransforms(draft)
assert.deepEqual(result.back, active, 'Recovery must preserve every active transform value, including precision and mirroring')
assert.deepEqual(result.front, emptyHairTransform())
assert.deepEqual(result.fringe, emptyHairTransform())
assert.equal(JSON.stringify(draft), before, 'Serialization must not mutate the live editor state')
assert.deepEqual(normalizeHairTransforms({ front: null, back: null, transforms: {} }), { front: emptyHairTransform(), back: emptyHairTransform(), fringe: emptyHairTransform() })
assert.throws(() => normalizeHairTransforms({ ...draft, transforms: {} }), /encaixe/)
const other = { ...active, scaleX: .42, scaleY: .47 }
assert.deepEqual(normalizeHairTransforms({ ...draft, front: { width: 876, height: 733 }, transforms: { ...draft.transforms, front: other } }).front, other)
if (process.argv[2]) {
  const { workspace } = JSON.parse(await readFile(process.argv[2], 'utf8'))
  const normalized = normalizeHairTransforms(workspace)
  for (const side of ['front', 'back', 'fringe']) {
    assert.deepEqual(normalized[side], workspace[side] ? workspace.transforms[side] : emptyHairTransform())
    assert.ok(normalized[side].scaleX > 0 && normalized[side].scaleX <= 20)
    assert.ok(normalized[side].scaleY > 0 && normalized[side].scaleY <= 20)
  }
}
console.log('Hair persistence checks passed: empty slots, old drafts, exact active transforms, mirroring, multiple assets, and no live-state mutation.')
