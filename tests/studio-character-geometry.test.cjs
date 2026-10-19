'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const sourcePath = path.join(__dirname, '../src/shared/studioCharacterGeometry.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const compiled = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const loadedModule = { exports: {} }
new Function('require', 'module', 'exports', compiled)(require, loadedModule, loadedModule.exports)
const { fitStudioCharacterToStage } = loadedModule.exports

test('Studio uses the neutral character bounds as the same base scale for every selected pose', () => {
  const referenceRendered = { width: 1000, height: 1000 }
  const referenceCrop = { width: 300, height: 800 }
  const stage = { width: 1000, height: 562 }
  const standing = fitStudioCharacterToStage(referenceRendered, referenceCrop, referenceRendered, referenceCrop, stage.width, stage.height)
  const sitting = fitStudioCharacterToStage(referenceRendered, referenceCrop, referenceRendered, { width: 450, height: 600 }, stage.width, stage.height)
  const raisedArms = fitStudioCharacterToStage(referenceRendered, referenceCrop, referenceRendered, { width: 380, height: 900 }, stage.width, stage.height)

  assert.equal(standing.characterCanvasWidth, sitting.characterCanvasWidth)
  assert.equal(standing.characterCanvasWidth, raisedArms.characterCanvasWidth)
  assert.equal(standing.width, standing.characterCanvasWidth * referenceCrop.width / referenceRendered.width)
  assert.equal(sitting.width, sitting.characterCanvasWidth * 450 / referenceRendered.width)
  assert.equal(raisedArms.height, raisedArms.characterCanvasWidth * stage.width / stage.height * 900 / referenceRendered.width)
  assert.notEqual(standing.height, sitting.height, 'A articulação pode mudar a silhueta visível sem redefinir a escala-base.')
})

test('Studio fit clamps invalid dimensions and never emits non-finite geometry', () => {
  const fitted = fitStudioCharacterToStage({ width: 0, height: 0 }, { width: 0, height: 0 }, { width: 0, height: 0 }, { width: 0, height: 0 }, 0, 0)
  for (const value of Object.values(fitted)) assert.equal(Number.isFinite(value), true)
})
