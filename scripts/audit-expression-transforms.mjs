import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'

const source = await readFile(new URL('../src/renderer/src/features/studio/expressionTransforms.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const { transferExpressionTransform: transfer, buildStudioExpressionTransforms: build, resolveStudioExpressionBase: resolveBase, buildStudioExpressionAppearance: expressionAppearance, studioExpressionCollection: collectionFor } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
assert.equal(collectionFor({}, []), 'standard', 'A new actor starts in the default collection')
const selection = { activeExpressionCollectionId: 'custom-set', activeExpressionPresetId: 'aliviada' }
const restoredSelection = JSON.parse(JSON.stringify(selection))
assert.equal(collectionFor(restoredSelection, []), 'custom-set', 'Stored collection is actor-owned and does not need the catalog to load')
assert.equal(restoredSelection.activeExpressionPresetId, 'aliviada')
assert.equal(collectionFor({ activeExpressionPresetId: 'legacy' }, [{ id: 'legacy', collectionId: 'legacy-set' }]), 'legacy-set', 'Recover the collection of previously applied expressions')
assert.equal(collectionFor({ activeExpressionCollectionId: 'another-set', activeExpressionPresetId: null }, []), 'another-set', 'Base also remembers the collection chosen by the user')
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
assert.deepEqual(first['expression-component:eye-left'].sourceTransformOverride, transfer(base, changed, target, false, false, { x: 40, y: 7.5 }))
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
// A user-calibrated character remains the neutral reference across presets and sets.
const userTransform = { x: 310, y: 95, scaleX: 3, scaleY: 1.2, rotation: 25, flipX: true }
const userAppearance = { ...appearance, components: { ...appearance.components, 'eye-left': { assetId: 'target', transform: userTransform } }, expressionIndex: 6, mouthOpen: false, mouthClosedCatalogId: 'user-mouth', mouthOpenCatalogId: 'user-mouth-open' }
const neutral = resolveBase({ faceTransforms: previous }, userAppearance)
const neutralJson = JSON.stringify(neutral)
const userApplied = await build(preset, neutral.appearance, neutral.transforms, async (id) => assets[id], async () => null)
const userEye = userApplied['expression-component:eye-left'].sourceTransformOverride
assert.ok(Math.abs(userEye.scaleX - 4.5) < 1e-9, 'Preset scale must multiply the user-selected size')
assert.equal(userEye.rotation, 45, 'Preset rotation must be added to the user-selected angle')
assert.equal(userEye.x, 910, 'Displacement must follow the actual size of the personalized eye')
const presetB = { ...preset, transforms: { ...transforms, eyeLeft: { ...base, scaleX: .025, rotation: 0 } } }
const savedActor = JSON.parse(JSON.stringify({ expressionBase: neutral, faceTransforms: userApplied }))
const baseForB = resolveBase(savedActor, { ...userAppearance, expressionIndex: 99 })
const second = await build(presetB, baseForB.appearance, baseForB.transforms, async (id) => assets[id], async () => null)
assert.ok(Math.abs(second['expression-component:eye-left'].sourceTransformOverride.scaleX - 1.5) < 1e-9)
assert.equal(JSON.stringify(resolveBase({ ...savedActor, faceTransforms: second }, userAppearance)), neutralJson, 'Base must restore all initial choices after A, B and persistence')
assert.equal(JSON.stringify(neutral), neutralJson, 'The stored neutral face must never be mutated')
const mouthPreset = { ...preset, selections: { ...preset.selections, mouth: { catalogId: 'author-mouth', kind: 'mouth-open', index: 12 } } }
const mouthResult = await expressionAppearance(mouthPreset, neutral.appearance, async (id) => {
  assert.equal(id, 'user-mouth-open')
  return { pieces: [{ sheet: 'mouth-open', index: 12 }] }
})
assert.equal(mouthResult.mouthOpenCatalogId, 'user-mouth-open')
assert.equal(mouthResult.expressionIndex, 12)
assert.equal(mouthResult.mouthOpen, true)
assert.equal(neutral.appearance.expressionIndex, 6)
const missingFrame = await expressionAppearance(mouthPreset, neutral.appearance, async () => ({ pieces: [] }))
assert.equal(missingFrame.expressionIndex, 6, 'A missing frame must preserve the character variant')
assert.deepEqual(missingFrame, neutral.appearance, 'An unavailable mouth frame must preserve both the sheet and its variant')
const nosePreset = { ...preset, noseOpacity: 1, selections: { ...preset.selections, nose: { catalogId: 'author-nose', kind: 'nose', index: 0 } } }
for (const noseOpacity of [0, .15, .5, 1, undefined]) {
  const personalized = {
    ...neutral.appearance,
    noseCatalogId: 'user-nose',
    noseOpacity,
    noseSkinTone: '#a76d50',
    facePalettes: { eyes: 'custom' },
    facePaletteManualRoles: { eyes: ['base'] },
    components: { ...neutral.appearance.components, 'eye-left': { assetId: 'target', transform: userTransform, colors: { base: '#514636' }, manualColorRoles: ['base'] } }
  }
  const before = structuredClone(personalized)
  const result = await expressionAppearance(nosePreset, personalized, async () => { throw new Error('A nose expression must not replace the character catalog') })
  assert.deepEqual(result, before, `Preserve all Base appearance properties with nose opacity ${noseOpacity}`)
  assert.deepEqual(personalized, before, 'Expression application must not mutate the Base')
  const withMouth = await expressionAppearance({ ...nosePreset, selections: { ...nosePreset.selections, mouth: mouthPreset.selections.mouth } }, personalized, async () => ({ pieces: [{ sheet: 'mouth-open', index: 12 }] }))
  assert.deepEqual(withMouth, { ...before, mouthOpen: true, expressionIndex: 12 }, 'Only the available mouth variant may change; colors and opacity remain personalized')
}
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
