import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { adjustedGarment, equippedGarments, garmentKey, garmentSlot } from '../src/renderer/src/features/customizer/wardrobeSelection.ts'
import { applyAffine, mapWardrobeComponentToPose } from '../src/renderer/src/features/fabricator/wardrobe/poseTransform.ts'

const fixture = (file) => JSON.parse(readFileSync(resolve('app-data/fabricator', file), 'utf8'))
const model = fixture('models/slot-1/project.json')
const neutral = fixture('poses/model-1/slot-2/pose.json')
const rotated = fixture('poses/model-1/slot-1/pose.json')
const set = fixture('wardrobe/model-1/set-7d926ec7-1545-4bda-a139-cbe1f84234ad/wardrobe.json')

test('selecting trousers equips all four leg pieces as one outfit', () => {
  const selected = equippedGarments([set], { calca: set.id })
  assert.equal(selected.length, 4)
  assert.deepEqual(new Set(selected.map(({ component }) => component.category)), new Set(['calca-coxa', 'calca-canela']))
  assert.deepEqual(new Set(selected.map(({ component }) => component.attachedPartId)).size, 4)
  assert.ok(selected.every(({ component }) => garmentSlot(component) === 'calca'))
  assert.equal(equippedGarments([set], {}).length, 0)
})

test('a single sleeve selection does not accidentally equip its opposite sleeve', () => {
  const left = set.components.find((part) => part.name === 'Manga superior esquerda')
  const selected = equippedGarments([set], { [garmentSlot(left)]: garmentKey(set, left) })
  assert.equal(selected.length, 1)
  assert.equal(selected[0].component.id, left.id)
})

test('a character can modify an equipped garment without altering the saved garment or the pose', () => {
  const original = JSON.stringify([set, model, neutral, rotated])
  const selected = equippedGarments([set], { calca: set.id })
  const part = selected.find(({ component }) => component.category === 'calca-coxa').component
  const edited = adjustedGarment(part, { dx: 9, dy: -4, scaleX: 1.3, scaleY: .8, rotation: 21 })
  assert.equal(edited.width, part.width * 1.3)
  assert.equal(edited.height, part.height * .8)
  assert.equal(edited.x, part.x + 9 + (part.width - edited.width) / 2)
  assert.equal(edited.rotation, part.rotation + 21)
  for (const pose of [neutral, rotated]) {
    const source = model.parts.find((value) => value.id === part.attachedPartId)
    const to = pose.parts.find((value) => value.id === part.attachedPartId)
    const before = mapWardrobeComponentToPose(part, source, to)
    const after = mapWardrobeComponentToPose(edited, source, to)
    assert.notDeepEqual(applyAffine(before, { x: 0, y: 0 }), applyAffine(after, { x: 0, y: 0 }))
  }
  assert.equal(JSON.stringify([set, model, neutral, rotated]), original)
})

test('different characters keep independent adjustments and category choices', () => {
  const part = set.components.find((piece) => piece.category === 'camisa')
  const slot = garmentSlot(part)
  const key = garmentKey(set, part)
  const first = { equipped: { [slot]: key }, adjustments: { [key]: { dx: 80, dy: 0, scaleX: 1, scaleY: 1, rotation: 0 } } }
  const second = { equipped: {}, adjustments: {} }
  assert.equal(equippedGarments([set], first.equipped).length, 1)
  assert.equal(equippedGarments([set], second.equipped).length, 0)
  assert.equal(adjustedGarment(part, first.adjustments[key]).x, part.x + 80)
  assert.equal(adjustedGarment(part, second.adjustments[key]).x, part.x)
})
