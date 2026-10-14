import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { applyAffine, cssAffine, invertAffine, kneeBand, mapWardrobeComponentToPose, multiplyAffine, poseDeltaToSource, sourceSheetToPose } from '../src/renderer/src/features/fabricator/wardrobe/poseTransform.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = (path) => JSON.parse(readFileSync(resolve(root, 'app-data/fabricator', path), 'utf8'))
const model = fixture('models/slot-1/project.json')
const neutral = fixture('poses/model-1/slot-2/pose.json')
const rotated = fixture('poses/model-1/slot-1/pose.json')
const wardrobe = fixture('wardrobe/model-1/set-7d926ec7-1545-4bda-a139-cbe1f84234ad/wardrobe.json')
const byId = (parts, id) => {
  const part = parts.find((value) => value.id === id)
  assert.ok(part, `Missing linked part ${id}`)
  return part
}
const center = (part) => ({ x: part.x + part.width / 2, y: part.y + part.height / 2 })
const approximate = (got, expected, message, epsilon = 1e-7) => assert.ok(Math.abs(got - expected) <= epsilon, `${message}: expected ${expected}, got ${got}`)
const pointNear = (got, wanted, title) => {
  approximate(got.x, wanted.x, title + ' x')
  approximate(got.y, wanted.y, title + ' y')
}
const poseAt = (part, pose) => byId(pose.parts, part.attachedPartId)
const sourceAt = (part) => byId(model.parts, part.attachedPartId)

test('fixture preserves linked thighs and calves, dimensions, and original data', () => {
  assert.equal(model.width, 1122)
  assert.equal(model.height, 1402)
  assert.equal(neutral.parts.length, 10)
  assert.equal(rotated.parts.length, 10)
  assert.equal(wardrobe.components.length, 7)
  assert.equal(wardrobe.components.filter((piece) => piece.category.startsWith('calca-')).length, 4)
  for (const garment of wardrobe.components) assert.ok(sourceAt(garment).sourceTransform)
  for (const id of ['25c3d637-8a2e-4d16-abe1-cbfef87819c1', 'a321f7c6-11a6-4035-a96f-11dabc356635', '6929ad17-be23-4233-9018-cd0ad7cf8043', '03348d1e-c7bb-4e8a-acd4-9c3e8a01bdba']) {
    assert.equal(byId(neutral.parts, id).rotation, 0)
    assert.notEqual(byId(rotated.parts, id).rotation, 0)
  }
  const widths = wardrobe.components.filter((p) => p.category.startsWith('calca-'))
  assert.ok(widths.every((p) => p.originWidth !== p.width && p.originHeight !== p.height))
})

test('neutral pose is the assembled frame, not original sheet coordinates', () => {
  for (const garment of wardrobe.components) {
    const source = sourceAt(garment)
    const pose = poseAt(garment, neutral)
    const matrix = mapWardrobeComponentToPose(garment, source, pose)
    const original = source.sourceTransform
    const shiftX = pose.x - original.x
    const shiftY = pose.y - original.y
    const target = { x: garment.x + garment.width / 2 + shiftX, y: garment.y + garment.height / 2 + shiftY }
    pointNear(applyAffine(matrix, { x: garment.width / 2, y: garment.height / 2 }), target, garment.name)
    pointNear(applyAffine(sourceSheetToPose(source, pose), { x: original.x + original.width / 2, y: original.y + original.height / 2 }), center(pose), garment.name + ' bone centers')
  }
})

test('rotated pose and independent X/Y scales preserve full affine correspondence', () => {
  for (const garment of wardrobe.components) {
    const source = sourceAt(garment)
    const pose = poseAt(garment, rotated)
    const matrix = mapWardrobeComponentToPose({ ...garment, rotation: 31, width: garment.width * 0.67, height: garment.height * 1.39 }, source, pose)
    const inverse = invertAffine(matrix)
    for (const point of [{ x: 0, y: 0 }, { x: garment.width * .3, y: garment.height * .7 }, { x: garment.width * .67, y: garment.height * 1.39 }]) {
      pointNear(applyAffine(inverse, applyAffine(matrix, point)), point, garment.name + ' round trip')
    }
    // The actual bone origin must be stationary under its own source->pose matrix.
    const from = source.sourceTransform
    pointNear(applyAffine(sourceSheetToPose(source, pose), { x: from.x + from.width / 2, y: from.y + from.height / 2 }), center(pose), garment.name + ' center')
  }
})

test('drag inverse is exactly the inverse of source-to-pose linear mapping', () => {
  for (const pose of [neutral, rotated]) for (const garment of wardrobe.components) {
    const source = sourceAt(garment), posed = poseAt(garment, pose)
    const matrix = sourceSheetToPose(source, posed)
    for (const sourceDelta of [{ x: 31, y: -19 }, { x: -0.23, y: 3.1 }]) {
      const posedDelta = { x: matrix.a * sourceDelta.x + matrix.c * sourceDelta.y, y: matrix.b * sourceDelta.x + matrix.d * sourceDelta.y }
      pointNear(poseDeltaToSource(posedDelta, source, posed), sourceDelta, garment.name + ' drag')
    }
  }
})

test('knee bands cover neutral seams without resizing the original garment', () => {
  const thighs = wardrobe.components.filter((p) => p.category === 'calca-coxa')
  const calves = wardrobe.components.filter((p) => p.category === 'calca-canela')
  for (const thigh of thighs) {
    const childJoint = neutral.joints.find((joint) => joint.parentPartId === thigh.attachedPartId)
    const calf = calves.find((part) => part.attachedPartId === childJoint?.childPartId)
    assert.ok(calf, 'Every fitted thigh has a linked calf')
    const thighBand = kneeBand(thigh, 18), calfBand = kneeBand(calf, 18)
    assert.ok(thighBand && calfBand)
    assert.equal(thighBand.shiftY, 18)
    assert.equal(calfBand.shiftY, -18)
    assert.equal(thighBand.clipTop, thigh.height - 18)
    assert.equal(calfBand.clipBottom, calf.height - 18)
    const upper = mapWardrobeComponentToPose(thigh, sourceAt(thigh), poseAt(thigh, neutral))
    const lower = mapWardrobeComponentToPose(calf, sourceAt(calf), poseAt(calf, neutral))
    const upperEnd = applyAffine(upper, { x: thigh.width / 2, y: thigh.height })
    const lowerStart = applyAffine(lower, { x: calf.width / 2, y: 0 })
    // The attached limbs in the user's neutral fixture have a small raw seam gap.
    const gap = lowerStart.y - upperEnd.y
    assert.ok(gap > 0 && gap < 36, `Unexpected knee seam gap ${gap}`)
    assert.ok(upperEnd.y + 18 >= lowerStart.y - 18, 'Knee bands must overlap')
    assert.equal(thigh.height, 280)
    assert.equal(calf.height, 352)
  }
})

test('CSS zoom applies once, and transformations never change model, pose or wardrobe JSON', () => {
  const before = JSON.stringify([model, neutral, rotated, wardrobe])
  for (const garment of wardrobe.components) {
    const source = sourceAt(garment)
    const matrix = mapWardrobeComponentToPose(garment, source, poseAt(garment, rotated))
    const css = cssAffine(matrix, .4)
    assert.ok(css.startsWith('matrix('))
    const numbers = css.slice(7, -1).split(',').map(Number)
    approximate(numbers[0], matrix.a, 'linear zoom X')
    approximate(numbers[3], matrix.d, 'linear zoom Y')
    approximate(numbers[4], matrix.e * .4, 'translate zoom X')
    approximate(numbers[5], matrix.f * .4, 'translate zoom Y')
    const shifted = cssAffine(matrix, .4, 18).slice(7, -1).split(',').map(Number)
    approximate(shifted[4], (matrix.e + matrix.c * 18) * .4, 'knee X shift')
    approximate(shifted[5], (matrix.f + matrix.d * 18) * .4, 'knee Y shift')
    // Exercise inversion/composition as well: no hidden mutation or rounding.
    const product = multiplyAffine(matrix, invertAffine(matrix))
    pointNear(applyAffine(product, { x: 19, y: 37 }), { x: 19, y: 37 }, garment.name + ' identity')
  }
  assert.equal(JSON.stringify([model, neutral, rotated, wardrobe]), before)
})

test('legacy bones without sourceTransform remain finite and readable', () => {
  const garment = wardrobe.components[0], source = sourceAt(garment), posed = poseAt(garment, neutral)
  const matrix = mapWardrobeComponentToPose(garment, { ...source, sourceTransform: undefined }, posed)
  assert.ok(Object.values(matrix).every(Number.isFinite))
})
