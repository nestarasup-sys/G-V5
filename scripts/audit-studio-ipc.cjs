'use strict'

const { spawn, execFileSync } = require('node:child_process')
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
    const timeoutMs = mode === 'area-smoke' ? 480_000 : mode === 'asset-ui-authoring' ? 300_000
      : mode === 'af13-authored' ? 480_000 : 180_000
    const timer = setTimeout(() => {
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.unref()
      } else if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL') } catch {}
      }
    }, timeoutMs)
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
  const closePending = await runElectron('close-pending')
  if (closePending.exitCode !== 0) throw new Error(`Fechamento com salvamentos pendentes falhou (${closePending.exitCode}): stdout=${closePending.stdout}; stderr=${closePending.stderr}`)
  if (!existsSync(join(artifacts, 'close-pending-result.json'))) throw new Error(`Fechamento pendente encerrou sem artefato: stdout=${closePending.stdout}; stderr=${closePending.stderr}`)
  const verifyClosePending = await runElectron('verify-close-pending')
  if (verifyClosePending.exitCode !== 0) throw new Error(`Persistência após fechamento falhou (${verifyClosePending.exitCode}): stdout=${verifyClosePending.stdout}; stderr=${verifyClosePending.stderr}`)
  if (!existsSync(join(artifacts, 'verify-close-pending-result.json'))) throw new Error(`Verificação do fechamento encerrou sem artefato: stdout=${verifyClosePending.stdout}; stderr=${verifyClosePending.stderr}`)
  const deletion = await runElectron('delete')
  if (deletion.exitCode !== 0) throw new Error(`Exclusão por namespace falhou (${deletion.exitCode}): stdout=${deletion.stdout}; stderr=${deletion.stderr}`)
  if (!existsSync(join(artifacts, 'delete-result.json'))) throw new Error(`Exclusão encerrou sem artefato: stdout=${deletion.stdout}; stderr=${deletion.stderr}`)
  const authoring = await runElectron('asset-ui-authoring')
  if (authoring.exitCode !== 0 || !existsSync(join(artifacts,'asset-ui-authoring','report.json'))) throw new Error('UI asset authoring failed ('+authoring.exitCode+'): stdout='+authoring.stdout+'; stderr='+authoring.stderr)
  const authoringRestart = await runElectron('asset-ui-verify-restart')
  if (authoringRestart.exitCode !== 0 || !existsSync(join(artifacts,'asset-ui-authoring','restart.json'))) throw new Error('UI authored asset restart failed ('+authoringRestart.exitCode+'): stdout='+authoringRestart.stdout+'; stderr='+authoringRestart.stderr)
  const authoredAf13 = await runElectron('af13-authored')
  if (authoredAf13.exitCode !== 0 || !existsSync(join(artifacts,'af13-authored','report.json'))) throw new Error('AF13 with UI-authored assets failed ('+authoredAf13.exitCode+'): stdout='+authoredAf13.stdout+'; stderr='+authoredAf13.stderr)
  const authoredAf13Restart = await runElectron('af13-authored-restart')
  if (authoredAf13Restart.exitCode !== 0 || !existsSync(join(artifacts,'af13-authored','restart.json'))) throw new Error('AF13 after Electron restart failed ('+authoredAf13Restart.exitCode+'): stdout='+authoredAf13Restart.stdout+'; stderr='+authoredAf13Restart.stderr)
  const invalidRoot = await runElectron('invalid-root', join(sandbox, 'not-authorized'))
  if (invalidRoot.exitCode !== 0 || !invalidRoot.stdout.includes('invalidRootRejected')) throw new Error(`Main não rejeitou de forma controlada um root DEV AI inválido: stdout=${invalidRoot.stdout}; stderr=${invalidRoot.stderr}`)
  const seeds = JSON.parse(readFileSync(join(artifacts, 'seed-result.json'), 'utf8'))
  const smoke = JSON.parse(readFileSync(join(artifacts, 'area-smoke-result.json'), 'utf8'))
  const restarted = JSON.parse(readFileSync(join(artifacts, 'restart-result.json'), 'utf8'))
  const closePendingResult = JSON.parse(readFileSync(join(artifacts, 'close-pending-result.json'), 'utf8'))
  const verifyClosePendingResult = JSON.parse(readFileSync(join(artifacts, 'verify-close-pending-result.json'), 'utf8'))
  const deleted = JSON.parse(readFileSync(join(artifacts, 'delete-result.json'), 'utf8'))
  const uiAuthoring = JSON.parse(readFileSync(join(artifacts, 'asset-ui-authoring', 'report.json'), 'utf8'))
  const uiAuthoringRestart = JSON.parse(readFileSync(join(artifacts, 'asset-ui-authoring', 'restart.json'), 'utf8'))
  const authoredAf13Result = JSON.parse(readFileSync(join(artifacts,'af13-authored','report.json'),'utf8'))
  const authoredAf13RestartResult = JSON.parse(readFileSync(join(artifacts,'af13-authored','restart.json'),'utf8'))
  const measuredMetrics = {
    schemaVersion: 1, status: 'partial', adapter: 'production-preload-real-ipc', realIpcCovered: true,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    environment: smoke.environment,
    fixture: { type: 'synthetic Studio documents', assets: 0, perDocumentElements: 0,
      repeatedSaveSamples: 20, repeatedRouteTransitions: smoke.realWorkspaceNavigation.routeTransitions },
    measurements: { studioSaveCommitLatencyMs: seeds.saveLatencyMs.studio,
      videoStudioSaveCommitLatencyMs: seeds.saveLatencyMs.videoStudio,
      studioVideoEditorDomReadyWallLatencyMs: smoke.realWorkspaceNavigation.openLatencyMs,
      rendererNavigationPhasesMs: smoke.realWorkspaceNavigation.rendererPhaseLatencyMs },
    visualComparison: { ...smoke.realWorkspaceNavigation.visualComparison,
      screenshotSha256: smoke.realWorkspaceNavigation.screenshotSha256,
      artifact: smoke.realWorkspaceNavigation.visualComparisonArtifact },
    memorySamples: smoke.memorySamples,
    limitations: ['Nenhum cold start foi medido nesta série.',
      'Dois snapshots de working set (KB) antes e depois de alternâncias não comprovam vazamento, pico RSS ou estabilidade em idle.',
      'CPU, heap e GPU não foram medidos; perfis de memória dependem do Chromium e dos processos ativos.',
      'A janela Electron estava oculta; backgroundThrottling foi desativado somente no modo DEV AI.',
      'A latência de navegação termina na montagem do editor no DOM, não em first meaningful paint.',
      'As medições usam documentos sintéticos pequenos, sem assets nem personagens.',
      'Capturas exigem estabilização visual, mas usam webContents.capturePage, não Electron offscreen:true.']
  }
  writeFileSync(join(output, 'metrics.json'), JSON.stringify(measuredMetrics, null, 2))
  const report = { schemaVersion: 1, adapter: 'production-preload-real-ipc', realIpcCovered: true,
    status: 'passed', phases: [
      { id: 'seed', status: 'passed', exitCode: seed.exitCode },
      { id: 'area-smoke', status: 'passed', exitCode: areaSmoke.exitCode },
      { id: 'process-restart', status: 'passed', exitCode: restart.exitCode },
      { id: 'close-with-pending-saves', status: 'passed', exitCode: closePending.exitCode },
      { id: 'pending-saves-after-restart', status: 'passed', exitCode: verifyClosePending.exitCode },
      { id: 'namespace-delete', status: 'passed', exitCode: deletion.exitCode },
      { id: 'invalid-root-rejected', status: 'passed', exitCode: invalidRoot.exitCode },
      { id: 'asset-ui-authoring', status:'passed',exitCode:authoring.exitCode },
      { id: 'asset-ui-restart', status:'passed',exitCode:authoringRestart.exitCode },
      { id: 'af13-ui-authored-assets', status:'passed',exitCode:authoredAf13.exitCode },
      { id: 'af13-ui-authored-restart', status:'passed',exitCode:authoredAf13Restart.exitCode }
    ], results: { seed: seeds, areaSmoke: smoke, restart: restarted,
      closePending: closePendingResult, verifyClosePending: verifyClosePendingResult,
      deletion: deleted, uiAuthoring, uiAuthoringRestart, authoredAf13:authoredAf13Result,
      authoredAf13Restart:authoredAf13RestartResult, invalidRootRejected: true },
    metricsArtifact: 'metrics.json',
    userDataRoot: 'out/dev-ai/runs/<run-id>/sandbox/electron-user-data',
    limitations: ['outsideSandboxWritesObserved=0 significa que as APIs testadas só resolveram os diretórios validados; não é monitoramento global do filesystem.', 'AF13 com assets realmente criados pela UI cobre roupas, dois personagens e duas poses, mas cabelo e acessórios de cabeça não são incluídos porque a fixture de autoria não os produz; AF-13 integral permanece aberto.'] }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: report.status, adapter: report.adapter, realIpcCovered: true, phases: report.phases }))
}

main().catch((error) => { console.error(`DEV AI real IPC: ${error?.stack ?? error}`); process.exitCode = 1 })
