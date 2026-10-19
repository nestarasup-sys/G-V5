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

const videoMedia = loadTs('src/shared/videoMedia.ts', {
  './videoAudio': { isValidVideoAudioSettings: () => true },
})
const geometry = loadTs('src/shared/videoStageGeometry.ts', { './videoMedia': videoMedia })

test('canonical stage geometry maps percentages exactly to 1920x1080', () => {
  assert.deepEqual(geometry.videoStageRect(0, 0, 100, 100), {
    centerX: 960, centerY: 540, width: 1920, height: 1080,
    left: 0, top: 0, right: 1920, bottom: 1080,
  })
  assert.deepEqual(geometry.videoStageRect(-25, 25, 50, 20), {
    centerX: 480, centerY: 810, width: 960, height: 216,
    left: 0, top: 702, right: 960, bottom: 918,
  })
})

test('character scale is applied once before stage conversion', () => {
  const element = {
    id: 'actor', kind: 'character', x: 0, y: 0, width: 20, height: 30, rotation: 0, zIndex: 1,
    characterScale: 150, characterWidthScale: 80, characterHeightScale: 120,
  }
  assert.deepEqual(geometry.videoCharacterElementSize(element), { width: 24, height: 54 })
  const rect = geometry.videoElementStageRect(element)
  assert.ok(Math.abs(rect.width - 460.8) < 1e-9)
  assert.ok(Math.abs(rect.height - 583.2) < 1e-9)
})

test('video transform fallback and CSS geometry share the authored percentage contract', () => {
  const rect = geometry.videoClipStageRect(undefined)
  assert.equal(rect.width, 960)
  assert.equal(rect.height, 540)
  assert.deepEqual(geometry.videoStageCssTransform(5, -10, 25, 30, 45, true), {
    left: 'calc(50% + 5%)',
    top: 'calc(50% + -10%)',
    width: '25%',
    height: '30%',
    transform: 'translate(-50%, -50%) rotate(45deg) scaleX(-1)',
  })
})
