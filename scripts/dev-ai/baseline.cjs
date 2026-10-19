#!/usr/bin/env node
'use strict'

const { spawn, execFileSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { existsSync, lstatSync, realpathSync } = require('node:fs')
const { mkdir, writeFile } = require('node:fs/promises')
const { dirname, isAbsolute, join, relative, resolve, sep } = require('node:path')
const { performance } = require('node:perf_hooks')
const { audits, selected } = require('./catalog.cjs')

const ROOT = resolve(__dirname, '../..')
const OUTPUT_ROOT = join(ROOT, 'out', 'dev-ai', 'runs')
const MAX_OUTPUT_BYTES = 160_000
const TIMEOUT_MS = 120_000
const VERSION = 1

function parseArgs(argv) {
  const options = { suite: 'fast', list: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--suite' && argv[i + 1] && !argv[i + 1].startsWith('-')) options.suite = argv[++i]
    else if (argv[i] === '--list') options.list = true
    else if (argv[i] === '--help' || argv[i] === '-h') options.help = true
    else throw new Error(`Argumento não reconhecido: ${argv[i]}`)
  }
  if (!['fast', 'isolation', 'ipc', 'all'].includes(options.suite)) throw new Error('Use --suite fast|isolation|ipc|all')
  return options
}

function within(parent, child) {
  const value = relative(parent, child)
  return value !== '' && value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value)
}

// Pre-existing out/ symlinks are forbidden: even diagnostic output must not
// follow a link into a user's actual projects or home directory.
function assertSafeOutputRoot() {
  const out = join(ROOT, 'out')
  if (existsSync(out)) {
    if (lstatSync(out).isSymbolicLink()) throw new Error('out/ não pode ser um symlink')
    if (!within(realpathSync(ROOT), realpathSync(out))) throw new Error('out/ fora do repositório')
  }
  for (const path of [join(ROOT, 'out', 'dev-ai'), OUTPUT_ROOT]) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Diretório de resultados não pode ser symlink')
  }
}

function safeEnvironment(sandbox) {
  const keys = [
    'PATH', 'Path', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'LANG', 'LC_ALL',
    'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS',
    'LIBGL_ALWAYS_SOFTWARE', 'ELECTRON_OZONE_PLATFORM_HINT'
  ]
  const env = Object.fromEntries(keys.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]))
  return {
    ...env, HOME: sandbox, USERPROFILE: sandbox,
    APPDATA: join(sandbox, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(sandbox, 'AppData', 'Local'),
    XDG_CONFIG_HOME: join(sandbox, 'config'),
    XDG_CACHE_HOME: join(sandbox, 'cache'),
    TMP: join(sandbox, 'tmp'), TEMP: join(sandbox, 'tmp'), TMPDIR: join(sandbox, 'tmp'),
    npm_config_cache: join(sandbox, 'npm-cache'),
    CI: '1', GACHA_DEV_AI_SANDBOX: sandbox
  }
}

function cleanOutput(value, sandbox) {
  let text = String(value)
  for (const secret of [process.env.HOME, process.env.USERPROFILE, sandbox].filter(Boolean)) {
    text = text.split(secret).join('<redacted-path>')
  }
  text = text.replace(/(token|password|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=<redacted>')
  text = text.replace(/data:[a-z0-9.+-]+[/][a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '<redacted-data-url>')
  text = text.replace(/(?:[a-z]:[\\]Users[\\]|[/]Users[/]|[/]home[/])[^\s"'<>]+/gi, '<redacted-user-path>')
  return text.slice(0, MAX_OUTPUT_BYTES)
}

function currentCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000
    }).trim()
  } catch { return 'unresolved' }
}

function executableElectron() {
  try {
    const candidate = require('electron')
    return typeof candidate === 'string' && existsSync(candidate) ? candidate : null
  } catch { return null }
}

function runCommand(label, executable, args, options) {
  return new Promise(resolveCase => {
    const started = performance.now()
    let stdout = '', stderr = '', killed = false, finished = false, termination = null
    let child
    const complete = (status, exitCode, signal) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolveCase({
        id: label, status, exitCode, signal: signal ?? null,
        durationMs: Math.round(performance.now() - started),
        ...(termination ? { termination } : {}),
        ...(options.adapter ? { adapter: options.adapter } : {}),
        stdout: cleanOutput(stdout, options.sandbox),
        stderr: cleanOutput(stderr, options.sandbox)
      })
    }
    try {
      child = spawn(executable, args, {
        cwd: ROOT, env: options.env, shell: options.shell ?? false, windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32'
      })
    } catch (error) {
      return resolveCase({ id: label, status: 'failed', exitCode: null, durationMs: 0,
        stdout: '', stderr: cleanOutput(error.message, options.sandbox) })
    }
    const append = (prev, next) => prev.length < MAX_OUTPUT_BYTES ? (prev + next).slice(0, MAX_OUTPUT_BYTES) : prev
    child.stdout.on('data', data => { stdout = append(stdout, data.toString('utf8')) })
    child.stderr.on('data', data => { stderr = append(stderr, data.toString('utf8')) })
    const timer = setTimeout(() => {
      killed = true
      termination = terminateProcessTree(child).then(result => { termination = result })
    }, options.timeoutMs ?? TIMEOUT_MS)
    child.on('error', error => complete('failed', null, cleanOutput(error.message, options.sandbox)))
    child.on('close', async (code, signal) => {
      if (termination instanceof Promise) await termination
      complete(killed ? 'failed' : code === 0 ? 'passed' : 'failed', code, signal)
    })
  })
}

function terminateProcessTree(child) {
  if (!child?.pid) return Promise.resolve({ method: 'unavailable', status: 'unsupported' })
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGKILL')
      return Promise.resolve({ method: 'process-group', status: 'requested' })
    } catch (error) {
      try { child.kill('SIGKILL') } catch {}
      return Promise.resolve({ method: 'process-group', status: 'failed', code: error.code ?? 'UNKNOWN' })
    }
  }

  return new Promise(resolveResult => {
    let killer
    try {
      killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'], shell: false
      })
    } catch (error) {
      try { child.kill('SIGKILL') } catch {}
      resolveResult({ method: 'taskkill-tree', status: 'failed', code: error.code ?? 'SPAWN_FAILED' })
      return
    }
    let settled = false
    const finish = result => {
      if (settled) return
      settled = true
      clearTimeout(fallbackTimer)
      resolveResult(result)
    }
    const fallbackTimer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
      finish({ method: 'taskkill-tree', status: 'timeout-fallback' })
    }, 10_000)
    killer.once('error', error => {
      try { child.kill('SIGKILL') } catch {}
      finish({ method: 'taskkill-tree', status: 'failed', code: error.code ?? 'SPAWN_FAILED' })
    })
    killer.once('close', code => {
      if (code !== 0) {
        try { child.kill('SIGKILL') } catch {}
        finish({ method: 'taskkill-tree', status: 'failed', exitCode: code })
      } else finish({ method: 'taskkill-tree', status: 'requested' })
    })
  })
}

function npmCommand(script) {
  // Fixed allowlist; no arbitrary commands from renderer or CLI.
  if (!['typecheck', 'build'].includes(script)) throw new Error('Comando npm não permitido')
  if (process.platform !== 'win32') return { executable: 'npm', args: ['run', script], shell: false }

  // Invoke the trusted npm JavaScript entry point through Node. This avoids
  // shell parsing of npm.cmd while keeping the command allowlist above.
  const candidates = [
    process.env.npm_execpath,
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ].filter(Boolean)
  const npmCli = candidates.find(candidate => existsSync(candidate) && /\.m?js$/i.test(candidate))
  if (!npmCli) throw new Error('npm-cli.js não encontrado; recusando fallback para shell no Windows')
  return { executable: process.execPath, args: [npmCli, 'run', script], shell: false }
}

async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv)
  if (opts.help) {
    console.log('Uso: node scripts/dev-ai/baseline.cjs [--list] [--suite fast|isolation|ipc|all]')
    console.log('Não instala dependências, não lê APPDATA real e não executa auditorias que requerem mídia pessoal.')
    return 0
  }
  if (opts.list) {
    console.log(JSON.stringify({ schemaVersion: VERSION, audits }, null, 2))
    return 0
  }

  assertSafeOutputRoot()
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`
  const runRoot = join(OUTPUT_ROOT, runId)
  await mkdir(runRoot, { recursive: true })
  await writeFile(join(runRoot, '.dev-ai-sandbox.json'), JSON.stringify({ schemaVersion: 1, runId, syntheticOnly: true }), { flag: 'wx' })
  const sandbox = join(runRoot, 'sandbox')
  await Promise.all(['AppData/Roaming', 'AppData/Local', 'config', 'cache', 'npm-cache', 'tmp']
    .map(p => mkdir(join(sandbox, p), { recursive: true })))
  const env = safeEnvironment(sandbox)
  const report = {
    schemaVersion: VERSION, runId, suite: opts.suite, commit: currentCommit(),
    platform: process.platform, node: process.version, startedAt: new Date().toISOString(),
    policies: {
      network: 'not-invoked-by-runner; NOT OS-level blocked',
      filesystem: 'child HOME/APPDATA isolated; legacy fast tests may write under out/',
      electron: 'per-case adapter; studio-isolation uses fixture-preload, studio-ipc-real uses production preload and real IPC in synthetic userData'
    },
    cases: [], status: 'inconclusive'
  }
  try {
    const selection = selected(opts.suite)
    if (!existsSync(join(ROOT, 'node_modules', 'typescript'))) {
      report.cases.push({
        id: 'prerequisites', status: 'unsupported',
        reason: 'node_modules/typescript ausente; executar npm ci manualmente em ambiente autorizado'
      })
    } else {
      if (selection.some(a => ['electron', 'electron-controller'].includes(a.mode))) {
        const npm = npmCommand('typecheck')
        const typecheck = await runCommand('typecheck', npm.executable, npm.args,
          { env, sandbox, shell: npm.shell, timeoutMs: 180_000 })
        report.cases.push(typecheck)
        if (typecheck.status === 'passed') {
          const build = npmCommand('build')
          report.cases.push(await runCommand('build', build.executable, build.args,
            { env, sandbox, shell: build.shell, timeoutMs: 240_000 }))
        }
      }
      const prereqFailed = report.cases.some(c => c.status === 'failed')
      for (const audit of selection) {
        if (prereqFailed || report.cases.some(c => c.id === 'build' && c.status !== 'passed')) {
          report.cases.push({ id: audit.id, status: 'skipped', reason: 'typecheck/build não passou' })
          continue
        }
        let binary = process.execPath
        if (['electron', 'electron-controller'].includes(audit.mode)) {
          binary = executableElectron()
          if (!binary) {
            report.cases.push({ id: audit.id, status: 'unsupported', reason: 'Executável Electron ausente' })
            continue
          }
          env.GACHA_AUDIT_OUTPUT_DIR = join(runRoot, audit.id)
          env.GACHA_AUDIT_RUN_ROOT = runRoot
          await mkdir(env.GACHA_AUDIT_OUTPUT_DIR, { recursive: true })
        }
        if (audit.mode === 'electron-controller') {
          env.GACHA_DEV_AI_TEST = '1'
          const artifacts = join(runRoot, `${audit.id}-artifacts`)
          await mkdir(artifacts, { recursive: true })
          const electronEnv = { ...env, GACHA_DEV_AI_AUDIT_OUTPUT: artifacts }
          const ipcTimeoutMs = 900_000
          report.cases.push(await runCommand(audit.id, process.execPath,
            [join(ROOT, audit.file), binary, sandbox, env.GACHA_AUDIT_OUTPUT_DIR, artifacts], {
            env: electronEnv, sandbox, timeoutMs: ipcTimeoutMs, adapter: 'controller + production Electron/preload/IPC; synthetic userData'
          }))
        } else {
          report.cases.push(await runCommand(audit.id, binary, [join(ROOT, audit.file)], {
            env: { ...env }, sandbox, timeoutMs: audit.mode === 'electron' ? 180_000 : 120_000,
            ...(audit.mode === 'electron' ? { adapter: 'Electron hidden window + fixture-preload; no real IPC' } : {})
          }))
        }
      }
    }
    report.status = report.cases.some(c => c.status === 'failed') ? 'failed'
      : report.cases.some(c => ['unsupported', 'skipped'].includes(c.status)) ? 'inconclusive'
        : 'passed'
  } catch (error) {
    report.status = 'failed'
    report.cases.push({ id: 'runner', status: 'failed', reason: cleanOutput(error?.stack ?? error, sandbox) })
  } finally {
    report.endedAt = new Date().toISOString()
    assertSafeOutputRoot()
    await writeFile(join(runRoot, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({
      runId, suite: opts.suite, status: report.status,
      cases: report.cases.map(c => ({ id: c.id, status: c.status, durationMs: c.durationMs })),
      report: relative(ROOT, join(runRoot, 'report.json')).replaceAll('\\', '/')
    }, null, 2))
  }
  return report.status === 'passed' ? 0 : report.status === 'failed' ? 1 : 2
}

if (require.main === module) {
  console.log('Auditorias DEV AI desativadas neste projeto por solicitação do usuário.')
}

module.exports = { ROOT, parseArgs, within, assertSafeOutputRoot, safeEnvironment, cleanOutput, npmCommand, runCommand, main }
