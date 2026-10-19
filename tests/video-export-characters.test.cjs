'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function loadTs(relativePath, deps = {}) {
  const source = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')
  const compiled = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((name) => name in deps ? deps[name] : require(name), mod, mod.exports)
  return mod.exports
}

const frame = loadTs('src/shared/videoFrame.ts')
const snapshot = loadTs('src/shared/videoExportSnapshot.ts', { './videoFrame': frame })
const characters = loadTs('src/shared/videoExportCharacters.ts', { './videoExportSnapshot': snapshot })

function character(id, updatedAt = '2026-01-01T00:00:00.000Z') {
  return {
    id, name: id, hair: '', outfit: '', skin: '',
    customization: { modelSlot: 1, poseSlot: 1, wardrobeGroups: [] },
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt,
  }
}

function studio(ids) {
  return {
    elements: ids.map((characterId, index) => ({
      id: `element-${index}`, kind: 'character', characterId, text: '', x: 0, y: 0,
      width: 10, height: 10, rotation: 0, zIndex: index,
    })),
  }
}

test('character snapshot contains only referenced characters in deterministic id order', () => {
  const library = [character('zeta'), character('alpha'), character('unused')]
  const source = studio(['zeta', 'alpha', 'zeta'])
  const snap = characters.createVideoExportCharacterSnapshot(source, library)
  assert.deepEqual(snap.characters.map((item) => item.id), ['alpha', 'zeta'])
  const serialized = characters.serializeVideoExportCharacterSnapshot(snap)
  const restored = characters.parseVideoExportCharacterSnapshot(serialized)
  assert.deepEqual(restored.characters.map((item) => item.id), ['alpha', 'zeta'])
  assert.equal(characters.characterFromVideoExportSnapshot(restored, 'zeta').id, 'zeta')
})

test('character snapshot is detached from later Customizer edits', () => {
  const original = character('actor')
  const snap = characters.createVideoExportCharacterSnapshot(studio(['actor']), [original])
  original.customization.poseSlot = 99
  original.name = 'edited after queue'
  const restored = characters.parseVideoExportCharacterSnapshot(characters.serializeVideoExportCharacterSnapshot(snap))
  assert.equal(restored.characters[0].customization.poseSlot, 1)
  assert.equal(restored.characters[0].name, 'actor')
})

test('character snapshot rejects missing, duplicate or malformed definitions', () => {
  assert.throws(() => characters.createVideoExportCharacterSnapshot(studio(['missing']), []), /não está disponível/)
  assert.throws(() => characters.createVideoExportCharacterSnapshot(studio(['actor']), [character('actor'), character('actor')]), /duplicados/)
  const snap = { schemaVersion: 1, characters: [{ ...character('actor'), updatedAt: 'not-a-date' }] }
  assert.throws(() => characters.serializeVideoExportCharacterSnapshot(snap), /inválido/)
  assert.throws(() => characters.characterFromVideoExportSnapshot({ schemaVersion: 1, characters: [] }, 'actor'), /não foi capturado/)
})
