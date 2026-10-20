'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const source = fs.readFileSync(path.resolve(__dirname, '../electron/videoPixelFormat.ts'), 'utf8')
const compiled = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const mod = { exports: {} }
new Function('require','module','exports',compiled)(require,mod,mod.exports)

test('RGBA to BGRA swaps red/blue and preserves green/alpha without mutating input', () => {
  const input = Uint8Array.from([255, 2, 3, 4, 10, 20, 200, 128])
  const original = Uint8Array.from(input)
  const output = mod.exports.rgbaToBgra(input)
  assert.deepEqual([...output], [3, 2, 255, 4, 200, 20, 10, 128])
  assert.deepEqual([...input], [...original])
})

test('RGBA to BGRA rejects partial pixels', () => {
  assert.throws(() => mod.exports.rgbaToBgra(Uint8Array.from([1,2,3])), /tamanho inválido/)
})
