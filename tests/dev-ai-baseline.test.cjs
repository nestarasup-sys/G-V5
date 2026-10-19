'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { mkdtempSync, symlinkSync, rmSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { audits, selected } = require('../scripts/dev-ai/catalog.cjs')
const {
  ROOT, parseArgs, within, safeEnvironment, cleanOutput,
  assertSafeOutputRoot, npmCommand
} = require('../scripts/dev-ai/baseline.cjs')

test('catalog: every audit is registered and unsafe audits excluded from unattended suites', () => {
  assert.equal(audits.length, 15)
  assert.equal(new Set(audits.map(a => a.id)).size, audits.length)
  for (const entry of audits) {
    assert.match(entry.file, /^scripts\/audit-[\w-]+\.(mjs|cjs)$/)
    assert.ok(entry.requires.length > 0)
    if (['fast', 'isolation', 'ipc'].includes(entry.suite)) assert.equal(entry.data, 'synthetic')
  }
  assert.equal(selected('fast').length, 9)
  assert.deepEqual(selected('isolation').map(a => a.id), ['studio-isolation'])
  assert.equal(selected('all').length, 11)
  assert.deepEqual(selected('ipc').map(a => a.id), ['studio-ipc-real'])
  assert.equal(audits.find(a => a.id === 'studio-ipc-real').mode, 'electron-controller')
  assert.ok(audits.some(a => a.id === 'animator-rig' && a.data === 'real-by-default' && a.suite === 'manual'))
})

test('CLI only accepts fixed suites and commands', () => {
  assert.equal(parseArgs([]).suite, 'fast')
  assert.equal(parseArgs(['--suite', 'isolation']).suite, 'isolation')
  assert.equal(parseArgs(['--list']).list, true)
  assert.equal(parseArgs(['--suite', 'ipc']).suite, 'ipc')
  assert.throws(() => parseArgs(['--suite', 'private-path']), /fast\|isolation\|ipc\|all/)
  assert.throws(() => parseArgs(['--exec', 'rm -rf']), /não reconhecido/)
  assert.throws(() => npmCommand('arbitrary-command'), /não permitido/)
  const npm = npmCommand('build')
  assert.equal(npm.shell, false, 'O runner não deve usar shell para chamar npm')
  if (process.platform === 'win32') {
    assert.equal(npm.executable, process.execPath)
    assert.match(npm.args[0], /npm-cli\.js$/i)
  }
})

test('path containment handles prefix collisions and traversal', () => {
  assert.equal(within('/repo/out', '/repo/out/a'), true)
  assert.equal(within('/repo/out', '/repo/out-private/a'), false)
  assert.equal(within('/repo/out', '/repo/out/../secret'), false)
  assert.equal(within('/repo/out', '/repo/out'), false)
})

test('child environment strips inherited tokens and points userData to sandbox', () => {
  const before = process.env.GACHA_FAKE_SECRET_FOR_TEST
  const sandbox = join(tmpdir(), 'gacha-sandbox')
  process.env.GACHA_FAKE_SECRET_FOR_TEST = 'DO_NOT_INHERIT'
  try {
    const env = safeEnvironment(sandbox)
    assert.equal(env.GACHA_FAKE_SECRET_FOR_TEST, undefined)
    assert.equal(env.APPDATA, join(sandbox, 'AppData', 'Roaming'))
    assert.equal(env.HOME, sandbox)
    assert.equal(env.TMPDIR, join(sandbox, 'tmp'))
    assert.equal(env.TEMP, env.TMPDIR)
    assert.match(cleanOutput('password=my-password token=abc', sandbox), /password=<redacted> token=<redacted>/)
    assert.equal(cleanOutput('data:image/png;base64,SGVsbG8=', sandbox), '<redacted-data-url>')
    assert.equal(cleanOutput('/home/example/private-file.json', sandbox), '<redacted-user-path>')
  } finally {
    if (before === undefined) delete process.env.GACHA_FAKE_SECRET_FOR_TEST
    else process.env.GACHA_FAKE_SECRET_FOR_TEST = before
  }
})

test('runner timeout terminates the spawned process tree', async (t) => {
  const { runCommand } = require('../scripts/dev-ai/baseline.cjs')
  const dir = mkdtempSync(join(tmpdir(), 'gacha-audit-process-tree-'))
  const pidFile = join(dir, 'pids.json')
  const script = [
    "const fs=require('node:fs')",
    "const {spawn}=require('node:child_process')",
    "const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true})",
    "fs.writeFileSync(process.env.DEV_AI_PID_FILE,JSON.stringify({parent:process.pid,child:child.pid}))",
    "setInterval(()=>{},1000)"
  ].join(';')
  try {
    const result = await runCommand('tree-timeout', process.execPath, ['-e', script], {
      env: { ...process.env, DEV_AI_PID_FILE: pidFile }, sandbox: dir, timeoutMs: 750
    })
    assert.equal(result.status, 'failed', 'Timeout deve falhar a suite, não reportar sucesso')
    assert.ok(result.termination, 'Relatório deve registrar o método usado para encerrar processos')
    if (process.platform === 'win32') assert.equal(result.termination.status, 'requested')
    assert.ok(existsSync(pidFile), 'Fixture precisa registrar os PIDs antes do timeout')
    const pids = JSON.parse(require('node:fs').readFileSync(pidFile, 'utf8'))
    const isRunning = pid => {
      try { process.kill(pid, 0); return true }
      catch (error) { if (error.code === 'ESRCH') return false; throw error }
    }
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && (isRunning(pids.parent) || isRunning(pids.child))) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.equal(isRunning(pids.parent), false, 'Processo pai continuou vivo após o timeout')
    assert.equal(isRunning(pids.child), false, 'Processo descendente ficou órfão após o timeout')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('runner lists audits without npm dependencies or Electron', () => {
  const child = spawnSync(process.execPath, [join(ROOT, 'scripts/dev-ai/baseline.cjs'), '--list'], {
    encoding: 'utf8', timeout: 10_000
  })
  assert.equal(child.status, 0, child.stderr)
  const listing = JSON.parse(child.stdout)
  assert.equal(listing.audits.length, 15)
  assert.equal(listing.schemaVersion, 1)
})

test('out/ symlink is rejected rather than following a user-controlled directory', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'gacha-audit-symlink-'))
  const out = join(ROOT, 'out')
  // Never replace a real build/output folder.
  if (existsSync(out)) { rmSync(dir, { recursive: true, force: true }); return t.skip('out/ já existe; não alterar dados gerados') }
  try {
    try { symlinkSync(dir, out, 'dir') }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return t.skip('SO impede criar symlink')
      throw error
    }
    assert.throws(() => assertSafeOutputRoot(), /symlink/)
  } finally {
    try { rmSync(out) } catch {}
    rmSync(dir, { recursive: true, force: true })
  }
})

test('static feature boundary scanner detects cross-feature imports on synthetic tree', () => {
  const { scan } = require('../scripts/dev-ai/boundary-scan.cjs')
  const { mkdirSync, writeFileSync } = require('node:fs')
  const root = mkdtempSync(join(tmpdir(), 'gacha-boundaries-'))
  try {
    const studio = join(root, 'src/renderer/src/features/studio')
    const video = join(root, 'src/renderer/src/features/videoStudio')
    mkdirSync(studio, { recursive: true })
    mkdirSync(video, { recursive: true })
    writeFileSync(join(studio, 'helper.ts'), 'export const hello = 1')
    writeFileSync(join(video, 'page.ts'), "import { hello } from '../studio/helper'\\n")
    const report = scan(root)
    assert.equal(report.crossFeature.length, 1)
    assert.equal(report.crossFeature[0].fromFeature, 'videoStudio')
    assert.equal(report.crossFeature[0].toFeature, 'studio')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('boundary scanner is non-destructive and ignores linked source trees', (t) => {
  const { scan } = require('../scripts/dev-ai/boundary-scan.cjs')
  const { mkdirSync, writeFileSync } = require('node:fs')
  const root = mkdtempSync(join(tmpdir(), 'gacha-boundaries-safe-'))
  const outside = mkdtempSync(join(tmpdir(), 'gacha-outside-'))
  try {
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(outside, 'secret.ts'), "export const privateValue='PRIVATE'\\n")
    try { symlinkSync(outside, join(root, 'src', 'external'), 'dir') }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return t.skip('SO impede criar symlink')
      throw error
    }
    const report = scan(root)
    assert.equal(report.scannedFiles, 0)
    assert.equal(report.edges.length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})
