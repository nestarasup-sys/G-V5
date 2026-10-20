'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
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


test('media process runner aborts a live child instead of waiting for timeout', async () => {
  const controller = new AbortController()
  const started = Date.now()
  const pending = capabilities.runVideoStudioProcess(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    { timeoutMs: 30_000, signal: controller.signal },
  )
  setTimeout(() => controller.abort(new Error('cancelled-by-test')), 100)
  await assert.rejects(pending, /cancelled-by-test/)
  assert.ok(Date.now() - started < 5_000, 'abort should kill the child promptly')
})


test('Windows media cancellation kills descendants instead of orphaning wrapper children', { skip: process.platform !== 'win32' }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gv5-media-tree-kill-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const pidFile = path.join(root, 'child.pid')
  const wrapper = [
    "const {spawn}=require('node:child_process');",
    "const fs=require('node:fs');",
    "const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});",
    `fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));`,
    "setInterval(()=>{},1000);",
  ].join('')
  const controller = new AbortController()
  const pending = capabilities.runVideoStudioProcess(process.execPath, ['-e', wrapper], { timeoutMs: 30_000, signal: controller.signal })
  const started = Date.now()
  while (!fs.existsSync(pidFile)) {
    if (Date.now() - started > 5000) throw new Error('Wrapper não publicou PID do descendente.')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  const descendantPid = Number(fs.readFileSync(pidFile, 'utf8'))
  controller.abort(new Error('tree-kill-test'))
  await assert.rejects(pending, /tree-kill-test/)
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.throws(() => process.kill(descendantPid, 0), /ESRCH|not found|no such process/i)
})
