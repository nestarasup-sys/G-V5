'use strict'

const { spawn } = require('node:child_process')
const { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } = require('node:fs')
const { dirname, join, relative, resolve, sep } = require('node:path')

const ROOT = resolve(__dirname, '..')
const electron = resolve(process.argv[2] ?? '')
const sandbox = resolve(process.argv[3] ?? '')
const output = resolve(process.argv[4] ?? '')
const driver = join(ROOT, 'scripts', 'dev-ai', 'studio-ipc-driver.cjs')
const runRoot = dirname(sandbox)
const runsRoot = resolve(ROOT, 'out', 'dev-ai', 'runs')

function validatePaths() {
  const relativeRun = relative(runsRoot, runRoot)
  const relativeOutput = relative(runRoot, output)
  if (!existsSync(electron) || !existsSync(driver) || !existsSync(sandbox)
    || !relativeOutput
    || !relativeRun || relativeRun === '..' || relativeRun.startsWith(`..${sep}`) || relativeRun.includes(sep)
    || relativeOutput === '..' || relativeOutput.startsWith(`..${sep}`) || relativeOutput.includes(sep)) {
    throw new Error('Pré-requisitos ou paths DEV AI inválidos.')
  }
  if (!existsSync(output)) mkdirSync(output)
  for (const path of [resolve(ROOT, 'out'), resolve(ROOT, 'out', 'dev-ai'), runsRoot, runRoot, sandbox, output]) {
    if (!existsSync(path) || lstatSync(path).isSymbolicLink() || realpathSync(path) !== path) throw new Error('Symlink ou path não canônico recusado.')
  }
  const marker = JSON.parse(readFileSync(join(runRoot, '.dev-ai-sandbox.json'), 'utf8'))
  if (marker.schemaVersion !== 1 || marker.runId !== require('node:path').basename(runRoot) || marker.syntheticOnly !== true) throw new Error('Sandbox sem marcador sintético válido.')
  mkdirSync(output, { recursive: true })
}

function runElectron(mode, sandboxOverride = sandbox) {
  return new Promise((resolveRun) => {
    let stdout = '', stderr = '', done = false
    const env = { ...process.env, GACHA_DEV_AI_TEST: '1', GACHA_DEV_AI_AUDIT_SANDBOX: sandbox,
      GACHA_DEV_AI_SANDBOX: sandboxOverride, GACHA_AUDIT_OUTPUT_DIR: output }
    const child = spawn(electron, [driver, mode], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
    const finish = (result) => { if (done) return; done = true; clearTimeout(timer); resolveRun(result) }
    child.stdout.on('data', (data) => { stdout = (stdout + data.toString('utf8')).slice(-50_000) })
    child.stderr.on('data', (data) => { stderr = (stderr + data.toString('utf8')).slice(-50_000) })
    const timer = setTimeout(() => {
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.unref()
      } else if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL') } catch {}
      }
    }, 90_000)
    child.on('error', (error) => finish({ mode, exitCode: null, stdout, stderr: `${stderr}\n${error.message}` }))
    child.on('close', (code, signal) => finish({ mode, exitCode: code, signal, stdout, stderr }))
  })
}

async function main() {
  validatePaths()
  const seed = await runElectron('seed')
  if (seed.exitCode !== 0) throw new Error(`IPC seed falhou (${seed.exitCode}): ${seed.stderr}`)
  const restart = await runElectron('verify-restart')
  if (restart.exitCode !== 0) throw new Error(`IPC após reinício falhou (${restart.exitCode}): ${restart.stderr}`)
  const invalidRoot = await runElectron('invalid-root', join(sandbox, 'not-authorized'))
  if (invalidRoot.exitCode !== 0 || !invalidRoot.stdout.includes('invalidRootRejected')) throw new Error('Main não rejeitou de forma controlada um root DEV AI inválido.')
  const report = { schemaVersion: 1, adapter: 'production-preload-real-ipc', realIpcCovered: true,
    status: 'passed', phases: [
      { id: 'seed', status: 'passed', exitCode: seed.exitCode },
      { id: 'process-restart', status: 'passed', exitCode: restart.exitCode },
      { id: 'invalid-root-rejected', status: 'passed', exitCode: invalidRoot.exitCode }
    ], logs: { seed: seed.stdout.trim(), restart: restart.stdout.trim(), invalidRootRejected: true },
    userDataRoot: 'out/dev-ai/runs/<run-id>/sandbox/electron-user-data',
    limitations: ['outsideSandboxWritesObserved=0 significa que as APIs testadas só resolveram os dois diretórios validados; não é monitoramento global do filesystem.'] }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: report.status, adapter: report.adapter, realIpcCovered: true, phases: report.phases }))
}

main().catch((error) => { console.error(`DEV AI real IPC: ${error?.stack ?? error}`); process.exitCode = 1 })
