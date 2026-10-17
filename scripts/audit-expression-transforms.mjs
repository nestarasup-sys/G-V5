import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'

const source = await readFile(new URL('../src/renderer/src/features/studio/expressionTransforms.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const { transferExpressionTransform: transfer, buildStudioExpressionTransforms: build } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const base = { x: 100, y: 50, scaleX: .05, scaleY: .08, rotation: 10 }
const target = { x: 250, y: 70, scaleX: 2, scaleY: .6, rotation: -5 }
assert.deepEqual(transfer(base, base, target), { ...target, flipX: false }, 'An unchanged preset must preserve a differently calibrated target')
const changed = { ...base, x: 110, y: 47, scaleX: .075, scaleY: .04, rotation: 30, flipX: true }
const actual = transfer(base, changed, target)
assert.ok(Math.abs(actual.scaleX - 3) < 1e-10)
assert.ok(Math.abs(actual.scaleY - .3) < 1e-10)
assert.ok(Math.abs(transfer(target, { ...target, scaleX: 3 }, base).scaleX - .075) < 1e-10, 'A large source calibration must not enlarge a small-scale target by 60x')
assert.equal(actual.x, 260)
assert.equal(actual.rotation, 15)
assert.equal(actual.flipX, true)
const mirrored = transfer(base, changed, target, true, false)
assert.equal(mirrored.x, 240)
assert.equal(mirrored.rotation, -25)
assert.deepEqual(transfer(base, changed, target, true, true), actual)
assert.equal(transfer(base, changed, target, false, false, { x: 2, y: .5 }).x, 270)
assert.throws(() => transfer({ ...base, scaleX: 0 }, changed, target))
assert.throws(() => transfer(base, { ...changed, y: NaN }, target))

const asset = (id, defaultTransform, rightSidePositioned = false) => ({ id, kind: 'eye', width: 100, height: 60, defaultTransform, rightSidePositioned })
const assets = { source: asset('source', base), target: asset('target', target) }
const empty = { left: null, right: null }
const transforms = Object.fromEntries(['eyeLeft', 'eyeRight', 'pupilLeft', 'pupilRight', 'browLeft', 'browRight', 'nose', 'mouth'].map((key) => [key, changed]))
const preset = { selections: { eyes: { left: 'source', right: 'source' }, pupils: empty, eyebrows: empty, nose: null, mouth: null }, transforms }
const appearance = { modelSlot: 1, components: { 'eye-left': { assetId: 'target' }, 'eye-right': { assetId: 'target' } } }
const original = JSON.stringify(appearance)
const previous = { eyes: { x: 3, y: 1, width: 90, height: 100, rotation: 2 }, 'expression-component:eye-left': { sourceTransformOverride: changed } }
const first = await build(preset, appearance, previous, async (id) => assets[id], async () => null)
const again = await build(preset, appearance, first, async (id) => assets[id], async () => null)
assert.deepEqual(first, again, 'Applying an expression twice must not accumulate scaling')
assert.equal(JSON.stringify(appearance), original, 'Expression application must not change asset choices')
assert.deepEqual(first.eyes, previous.eyes, 'Studio manual adjustments must survive')
assert.deepEqual(first['expression-component:eye-left'].sourceTransformOverride, actual)
const snapshotPreset = { ...preset, referenceTransforms: { eyeLeft: base, eyeRight: base } }
const recalibrated = { ...assets, source: asset('source', { ...base, scaleX: 10 }) }
assert.deepEqual(await build(snapshotPreset, appearance, {}, async (id) => recalibrated[id], async () => null), await build(snapshotPreset, appearance, {}, async (id) => assets[id], async () => null), 'Saved calibration must survive subsequent Dev edits')
const catalogAppearance = { modelSlot: 1, eyeCatalogId: 'current-sheet' }
const catalog = { transforms: { 'eye-left': target, 'eye-right': { ...target, x: 500 } } }
const catalogTransforms = await build(preset, catalogAppearance, {}, async (id) => assets[id], async () => catalog)
assert.equal(catalogTransforms['expression:eye-left:current-sheet'].sourceTransformOverride.x, 260)
assert.equal(catalogTransforms['expression:eye-right:current-sheet'].sourceTransformOverride.x, 490)
assert.ok(!Object.keys(catalogTransforms).some((key) => key.includes(':source')), 'Transforms must address the current sheet rather than the authoring asset')
await assert.rejects(build(preset, appearance, {}, async () => null, async () => null), /referência/)
const sharedSource = await readFile(new URL('../src/shared/studio.ts', import.meta.url), 'utf8')
const sharedCompiled = ts.transpileModule(sharedSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const { isStudioFaceTransforms } = await import(`data:text/javascript;base64,${Buffer.from(sharedCompiled).toString('base64')}`)
assert.ok(isStudioFaceTransforms(JSON.parse(JSON.stringify(first))), 'Applied expressions must survive the Studio save/load boundary')
assert.equal(isStudioFaceTransforms({ ...first, invalid: first.eyes }), false)
assert.equal(isStudioFaceTransforms({ 'expression-component:eye-left': { ...first.eyes, sourceTransformOverride: { ...base, scaleX: -1 } } }), false)
console.log('Expression transfer regression checks passed (calibration, scale, mirrored sides, invalid input, repetition, asset preservation).')

// Optional read-only audit of the user's real library across every matching asset.
if (process.argv[2]) {
  const root = process.argv[2]
  const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
  const folder = join(root, 'fabricator', 'face-components', 'model-1')
  const components = (await Promise.all((await readdir(folder)).filter((name) => name.startsWith('item-')).map((name) => readJson(join(folder, name, 'asset.json')))))
  const expressionFolder = join(root, 'fabricator', 'expression-presets', 'model-1')
  const presets = await Promise.all((await readdir(expressionFolder)).filter((name) => name.startsWith('preset-')).map((name) => readJson(join(expressionFolder, name))))
  let combinations = 0
  let maximumRatio = 1
  for (const saved of presets) for (const [kind, group, prefix] of [['eye', 'eyes', 'eye'], ['pupil', 'pupils', 'pupil'], ['eyebrow', 'eyebrows', 'brow']]) for (const side of ['left', 'right']) {
    const reference = components.find((item) => item.id === saved.selections[group]?.[side])
    if (!reference) continue
    const key = `${prefix}${side === 'right' ? 'Right' : 'Left'}`
    const calibration = saved.referenceTransforms?.[key] ?? reference.defaultTransform
    for (const candidate of components.filter((item) => item.kind === kind)) {
      const converted = transfer(calibration, saved.transforms[key], candidate.defaultTransform, side === 'right' && !reference.rightSidePositioned, side === 'right' && !candidate.rightSidePositioned)
      assert.ok(Object.values(converted).every((value) => typeof value !== 'number' || Number.isFinite(value)))
      const ratio = converted.scaleX / candidate.defaultTransform.scaleX
      assert.ok(Math.abs(ratio - saved.transforms[key].scaleX / calibration.scaleX) < 1e-8)
      maximumRatio = Math.max(maximumRatio, ratio)
      combinations++
    }
  }
  console.log(JSON.stringify({ realPresets: presets.length, realAssets: components.length, verifiedCombinations: combinations, maximumRelativeWidth: maximumRatio }))
}
