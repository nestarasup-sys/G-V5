import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

async function loadPureTs(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove }
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}
const { bindWardrobeComponent, mapWardrobeComponentToPose } =
  await loadPureTs('../src/renderer/src/features/fabricator/wardrobe/poseTransform.ts')
const { suggestWardrobeBone } =
  await loadPureTs('../src/renderer/src/features/fabricator/wardrobe/boneSelection.ts')
const { validateWardrobeFlow, applyCharacterWardrobeAdjustment } =
  await loadPureTs('../src/shared/assetFlow.ts')

const bone = (id, name, x, y, width, height, overrides = {}) => ({
  id, name, x, y, width, height, rotation: 0, sourceTransform: { x, y, width, height, rotation: 0 }, ...overrides
})
const source = {
  slot: 1, width: 1000, height: 1000, updatedAt: '2026-01-01',
  parts: [bone('head', 'Cabeça', 400, 70, 180, 190), bone('torso', 'Corpo', 360, 330, 280, 240),
    bone('leg-left', 'Canela esquerda', 220, 720, 170, 220), bone('leg-right', 'Canela direita', 630, 720, 170, 220)]
}
const pose = {
  sourceModelSlot: 1, sourceModelUpdatedAt: source.updatedAt,
  parts: [
    bone('head', 'Cabeça', 410, 40, 180, 190),
    bone('torso', 'Corpo', 370, 320, 280, 240),
    bone('leg-left', 'Canela esquerda', 190, 700, 170, 220),
    bone('leg-right', 'Canela direita', 670, 700, 170, 220)
  ]
}
const comp = (id, category, attachedPartId, x, y, width, height) => ({
  id, category, attachedPartId, name: id, x, y, width, height, rotation: 0, dataUrl: 'synthetic-no-image'
})
const garment = comp('shoe-left', 'sapato', 'leg-left', 230, 830, 135, 80)
garment.binding = bindWardrobeComponent(garment, source.parts[2])
const other = comp('glasses', 'oculos', 'head', 420, 115, 135, 45)
other.binding = bindWardrobeComponent(other, source.parts[0])
const set = { id: 'wardrobe-fixture', modelSlot: 1, components: [garment, other] }
const equipped = [{ modelSlot: 1, setId: set.id, componentId: 'shoe-left', category: 'sapato',
  offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotation: 0 }]
const beforeSource = JSON.stringify(source), beforePose = JSON.stringify(pose), beforeSet = JSON.stringify(set)
const initial = mapWardrobeComponentToPose(garment, source.parts[2], source.parts[2])
assert.ok(Math.abs(initial.origin.x + initial.localLeft + initial.renderWidth / 2 - (garment.x + garment.width / 2)) < 1e-7,
  'Uma pose idêntica deve reproduzir exatamente o pré-ajuste do Fabricador')
assert.ok(Math.abs(initial.origin.y + initial.localTop + initial.renderHeight / 2 - (garment.y + garment.height / 2)) < 1e-7)
assert.ok(Math.abs(initial.renderWidth - garment.width) < 1e-7)
assert.ok(Math.abs(initial.renderHeight - garment.height) < 1e-7)
const posed = mapWardrobeComponentToPose(garment, source.parts[2], pose.parts[2])
assert.ok(Math.abs(posed.origin.x - (pose.parts[2].x + pose.parts[2].width / 2)) < 1e-7)
assert.equal(validateWardrobeFlow(set, source, pose, equipped).ok, true)
assert.equal(validateWardrobeFlow(set, source, pose, equipped).resolved, 1)
assert.equal(JSON.stringify(source), beforeSource)
assert.equal(JSON.stringify(pose), beforePose)
assert.equal(JSON.stringify(set), beforeSet)

// Customizer deltas belong to characters; changing one cannot change Fabricator
// sources or another character. No runtime/stored model mutation is possible.
const baseCustomization = { modelSlot: 1, poseSlot: 1, partOverrides: {}, layerOrder: [], wardrobeGroups: equipped }
const sibling = structuredClone(baseCustomization)
const character = applyCharacterWardrobeAdjustment(baseCustomization,
  { modelSlot: 1, setId: set.id, componentId: garment.id },
  { offsetX: 12, offsetY: -5, rotation: 9, scaleX: 1.2 })
assert.equal(character.wardrobeGroups[0].offsetX, 12)
assert.equal(baseCustomization.wardrobeGroups[0].offsetX, 0)
assert.deepEqual(sibling, baseCustomization)
assert.equal(JSON.stringify(set), beforeSet, 'Nenhum ajuste do Customizador altera a biblioteca original')
assert.throws(() => applyCharacterWardrobeAdjustment(baseCustomization,
  { modelSlot: 1, setId: set.id, componentId: garment.id }, { scaleX: 0 }), /inválido/)
assert.throws(() => applyCharacterWardrobeAdjustment(baseCustomization,
  { modelSlot: 1, setId: set.id, componentId: 'wrong' }, { offsetX: 1 }), /não está equipada/)

// Reject silent disappearance on missing IDs. Legacy unbound garments are
// reported as warnings, rather than mutated or silently accepted as calibrated.
const badPose = { ...pose, parts: pose.parts.filter(part => part.id !== 'leg-left') }
assert.ok(validateWardrobeFlow(set, source, badPose, equipped).issues.some(x => x.code === 'missing-pose-bone'))
const mismatch = structuredClone(set)
mismatch.components[0].binding.boneId = 'torso'
assert.ok(validateWardrobeFlow(mismatch, source, pose, equipped).issues.some(x => x.code === 'binding-bone-mismatch'))
const unbound = structuredClone(set)
delete unbound.components[0].binding
assert.ok(validateWardrobeFlow(unbound, source, pose, equipped).issues.some(x => x.code === 'missing-binding'))
const nonexistent = [{ ...equipped[0], componentId: 'missing' }]
assert.ok(validateWardrobeFlow(set, source, pose, nonexistent).issues.some(x => x.code === 'missing-component'))
assert.ok(validateWardrobeFlow(set, source, { ...pose, sourceModelSlot: 2 }, equipped).issues.some(x => x.code === 'model-slot-mismatch'))
assert.ok(validateWardrobeFlow(set, source, { ...pose, sourceModelUpdatedAt: 'changed' }, equipped).issues.some(x => x.code === 'model-revision-mismatch'))

const leftShoe = suggestWardrobeBone('sapato', 250, 1000, source)
const rightShoe = suggestWardrobeBone('sapato', 750, 1000, source)
assert.equal(leftShoe.bone?.id, 'leg-left')
assert.equal(rightShoe.bone?.id, 'leg-right')
assert.equal(suggestWardrobeBone('oculos', 500, 1000, source).bone?.id, 'head')
assert.equal(suggestWardrobeBone('acessorio-cabeca', 500, 1000,
  { ...source, parts: source.parts.filter(x => x.id !== 'head') }).bone, null)
assert.equal(suggestWardrobeBone('sapato', 750, 1000,
  { ...source, parts: source.parts.filter(x => x.id !== 'leg-right') }).bone, null,
  'Não prender automaticamente um sapato direito à perna esquerda')
assert.equal(suggestWardrobeBone('sapato', NaN, 1000, source).bone, null)

// The reference source sheet is authoritative even after the model is posed,
// resized, or moved. Using the assembled part.width was the root of an
// erroneous center/side estimate in the old guessing implementation.
const resized = { ...source, parts: [
  bone('source-left', 'left', 0, 0, 900, 200,
    { sourceTransform: { x: 100, y: 700, width: 100, height: 100, rotation: 0 } }),
  bone('source-right', 'right', 500, 0, 10, 100,
    { sourceTransform: { x: 600, y: 700, width: 100, height: 100, rotation: 0 } })
] }
assert.equal(suggestWardrobeBone('sapato', 750, 1000, resized).bone?.id, 'source-right',
  'Seleção precisa usar sourceTransform.width, não part.width montada')
console.log('Asset flow checks passed: pre-fit binding, posed bone mapping, immutable character deltas, missing references, shoe/head selection and source-frame geometry.')
