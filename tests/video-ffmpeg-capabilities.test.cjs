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

const writer = loadTs('electron/videoRawFrameWriter.ts')
const capabilities = loadTs('electron/videoFfmpegCapabilities.ts', { './videoRawFrameWriter': writer })

test('media process runner captures stdout/stderr and rejects non-absolute executables', async () => {
  const result = await capabilities.runVideoStudioProcess(process.execPath, [
    '-e',
    'process.stdout.write("hello"); process.stderr.write("diagnostic")',
  ])
  assert.equal(result.code, 0)
  assert.equal(result.stdout, 'hello')
  assert.equal(result.stderr, 'diagnostic')
  await assert.rejects(() => capabilities.runVideoStudioProcess('ffmpeg', ['-version']), /caminho absoluto/)
})

test('media process runner bounds timeouts and kills stalled children', async () => {
  await assert.rejects(
    () => capabilities.runVideoStudioProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 1000 }),
    /excedeu 1000 ms/,
  )
})

test('FFmpeg probe rejects missing paths and non-FFmpeg executables before user media is read', async () => {
  const missing = path.resolve(__dirname, 'definitely-not-ffmpeg.exe')
  await assert.rejects(() => capabilities.probeVideoStudioFfmpeg(missing), /não foi encontrado/)
  await assert.rejects(() => capabilities.probeVideoStudioFfmpeg(process.execPath, { timeoutMs: 5000 }), /FFmpeg não iniciou corretamente|não se identificou como FFmpeg/)
})
