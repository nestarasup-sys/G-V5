'use strict'

const { spawn } = require('node:child_process')
const { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } = require('node:fs')
const { dirname, join, relative, resolve, sep } = require('node:path')

const ROOT = resolve(__dirname, '..')
const electron = resolve(process.argv[2] ?? '')
const sandbox = resolve(process.argv[3] ?? '')
const output = resolve(process.argv[4] ?? '')
const artifacts = resolve(process.argv[5] ?? '')
const driver = join(ROOT, 'scripts', 'dev-ai', 'studio-ipc-driver.cjs')
const runRoot = dirname(sandbox)
const runsRoot = resolve(ROOT, 'out', 'dev-ai', 'runs')

function validatePaths() {
  const relativeRun = relative(runsRoot, runRoot)
  const relativeOutput = relative(runRoot, output)
  const relativeArtifacts = relative(runRoot, artifacts)
  if (!existsSync(electron) || !existsSync(driver) || !existsSync(sandbox)
    || !relativeOutput
    || !relativeArtifacts
    || !relativeRun || relativeRun === '..' || relativeRun.startsWith(`..${sep}`) || relativeRun.includes(sep)
    || relativeOutput === '..' || relativeOutput.startsWith(`..${sep}`) || relativeOutput.includes(sep)
    || relativeArtifacts === '..' || relativeArtifacts.startsWith(`..${sep}`) || relativeArtifacts.includes(sep)) {
    throw new Error('Pré-requisitos ou paths DEV AI inválidos.')
  }
  if (relativeOutput !== 'studio-ipc-real' || relativeArtifacts !== 'studio-ipc-real-artifacts') {
    throw new Error('Os diretórios de resultados IPC devem ser pastas irmãs autorizadas dentro do run-id.')
  }
  if (!existsSync(output)) mkdirSync(output)
  if (!existsSync(artifacts)) mkdirSync(artifacts)
  for (const path of [resolve(ROOT, 'out'), resolve(ROOT, 'out', 'dev-ai'), runsRoot, runRoot, sandbox, output, artifacts]) {
    if (!existsSync(path) || lstatSync(path).isSymbolicLink() || realpathSync(path) !== path) throw new Error('Symlink ou path não canônico recusado.')
  }
  const marker = JSON.parse(readFileSync(join(runRoot, '.dev-ai-sandbox.json'), 'utf8'))
  if (marker.schemaVersion !== 1 || marker.runId !== require('node:path').basename(runRoot) || marker.syntheticOnly !== true) throw new Error('Sandbox sem marcador sintético válido.')
  mkdirSync(output, { recursive: true })
  mkdirSync(artifacts, { recursive: true })
}

function runElectron(mode, sandboxOverride = sandbox) {
  return new Promise((resolveRun) => {
    let stdout = '', stderr = '', done = false
    const env = { ...process.env, GACHA_DEV_AI_TEST: '1', GACHA_DEV_AI_AUDIT_SANDBOX: sandbox,
      GACHA_DEV_AI_SANDBOX: sandboxOverride, GACHA_AUDIT_OUTPUT_DIR: artifacts,
      GACHA_DEV_AI_AUDIT_OUTPUT: artifacts }
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
  if (seed.exitCode !== 0) throw new Error(`IPC seed falhou (${seed.exitCode}): stdout=${seed.stdout}; stderr=${seed.stderr}`)
  if (!existsSync(join(artifacts, 'seed-result.json'))) throw new Error(`IPC seed encerrou sem artefato: stdout=${seed.stdout}; stderr=${seed.stderr}`)
  const areaSmoke = await runElectron('area-smoke')
  if (areaSmoke.exitCode !== 0) throw new Error(`Smoke Customizer/Fabricador falhou (${areaSmoke.exitCode}): stdout=${areaSmoke.stdout}; stderr=${areaSmoke.stderr}`)
  if (!existsSync(join(artifacts, 'area-smoke-result.json'))) throw new Error(`Smoke Customizer/Fabricador encerrou sem artefato: stdout=${areaSmoke.stdout}; stderr=${areaSmoke.stderr}`)
  const restart = await runElectron('verify-restart')
  if (restart.exitCode !== 0) throw new Error(`IPC após reinício falhou (${restart.exitCode}): stdout=${restart.stdout}; stderr=${restart.stderr}`)
  if (!existsSync(join(artifacts, 'restart-result.json'))) throw new Error(`IPC após reinício encerrou sem artefato: stdout=${restart.stdout}; stderr=${restart.stderr}`)
  const deletion = await runElectron('delete')
  if (deletion.exitCode !== 0) throw new Error(`Exclusão por namespace falhou (${deletion.exitCode}): stdout=${deletion.stdout}; stderr=${deletion.stderr}`)
  if (!existsSync(join(artifacts, 'delete-result.json'))) throw new Error(`Exclusão encerrou sem artefato: stdout=${deletion.stdout}; stderr=${deletion.stderr}`)
  const invalidRoot = await runElectron('invalid-root', join(sandbox, 'not-authorized'))
  if (invalidRoot.exitCode !== 0 || !invalidRoot.stdout.includes('invalidRootRejected')) throw new Error(`Main não rejeitou de forma controlada um root DEV AI inválido: stdout=${invalidRoot.stdout}; stderr=${invalidRoot.stderr}`)
  const seeds = JSON.parse(readFileSync(join(artifacts, 'seed-result.json'), 'utf8'))
  const smoke = JSON.parse(readFileSync(join(artifacts, 'area-smoke-result.json'), 'utf8'))
  const restarted = JSON.parse(readFileSync(join(artifacts, 'restart-result.json'), 'utf8'))
  const deleted = JSON.parse(readFileSync(join(artifacts, 'delete-result.json'), 'utf8'))
  const report = { schemaVersion: 1, adapter: 'production-preload-real-ipc', realIpcCovered: true,
    status: 'passed', phases: [
      { id: 'seed', status: 'passed', exitCode: seed.exitCode },
      { id: 'area-smoke', status: 'passed', exitCode: areaSmoke.exitCode },
      { id: 'process-restart', status: 'passed', exitCode: restart.exitCode },
      { id: 'namespace-delete', status: 'passed', exitCode: deletion.exitCode },
      { id: 'invalid-root-rejected', status: 'passed', exitCode: invalidRoot.exitCode }
    ], results: { seed: seeds, areaSmoke: smoke, restart: restarted, deletion: deleted, invalidRootRejected: true },
    userDataRoot: 'out/dev-ai/runs/<run-id>/sandbox/electron-user-data',
    limitations: ['outsideSandboxWritesObserved=0 significa que as APIs testadas só resolveram os diretórios validados; não é monitoramento global do filesystem.', 'O smoke de Customizer/Fabricador valida montagem e leitura de bibliotecas sintéticas, não edição e persistência de projetos dessas áreas.'] }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: report.status, adapter: report.adapter, realIpcCovered: true, phases: report.phases }))
}

main().catch((error) => { console.error(`DEV AI real IPC: ${error?.stack ?? error}`); process.exitCode = 1 })
