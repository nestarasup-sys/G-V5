'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { existsSync, lstatSync, readdirSync, readFileSync } = require('node:fs')
const { writeFile } = require('node:fs/promises')
const { basename, dirname, join, relative, resolve, sep } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow } = require('electron')

const ROOT = resolve(__dirname, '../..')
const mode = process.argv[2]
const output = resolve(process.env.GACHA_DEV_AI_AUDIT_OUTPUT ?? process.env.GACHA_AUDIT_OUTPUT_DIR ?? '')
const sandbox = resolve(process.env.GACHA_DEV_AI_AUDIT_SANDBOX ?? process.env.GACHA_DEV_AI_SANDBOX ?? '')
let exitCode = 1

function assertOutputSandbox() {
  const runsRoot = resolve(ROOT, 'out', 'dev-ai', 'runs')
  const runRoot = dirname(sandbox)
  const relativeRun = relative(runsRoot, runRoot)
  const markerPath = join(runRoot, '.dev-ai-sandbox.json')
  assert.ok(relativeRun && relativeRun !== '..' && !relativeRun.startsWith(`..${sep}`) && !relativeRun.includes(sep))
  assert.equal(basename(sandbox), 'sandbox')
  assert.ok(existsSync(markerPath) && !lstatSync(markerPath).isSymbolicLink())
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
  assert.equal(marker.syntheticOnly, true)
  assert.equal(marker.runId, basename(runRoot))
  const relativeOutput = relative(runRoot, output)
  assert.ok(['sandbox', 'studio-ipc-real', 'studio-ipc-real-artifacts'].includes(relativeOutput),
    'Diretório da fase deve ser uma das pastas de execução autorizadas')
  assert.ok(!existsSync(output) || !lstatSync(output).isSymbolicLink())
}

function treeHash(folder) {
  const digest = createHash('sha256')
  if (!existsSync(folder)) return digest.update('<missing>').digest('hex')
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name)
      const relativePath = relative(folder, path).replaceAll('\\', '/')
      const stat = lstatSync(path)
      assert.equal(stat.isSymbolicLink(), false, `Symlink inesperado no sandbox: ${relativePath}`)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) digest.update(relativePath).update('\0').update(readFileSync(path)).update('\0')
      else assert.fail(`Tipo de arquivo inesperado: ${relativePath}`)
    }
  }
  visit(folder)
  return digest.digest('hex')
}

function syntheticStudio(title, video = false) {
  const now = '2026-10-18T00:00:00.000Z'
  return {
    schemaVersion: 1,
    id: '1f50a2e4-7da4-4e28-9566-63dbf9403001',
    title,
    color: '#7768c8',
    createdAt: now,
    updatedAt: now,
    backgroundColor: '#d7b5cd',
    backgroundAssetId: null,
    backgroundX: 0,
    backgroundY: 0,
    backgroundWidth: 100,
    backgroundHeight: 100,
    backgroundRotation: 0,
    assets: [],
    elements: [],
    ...(video ? { videoTimeline: {
      schemaVersion: 1, frameRate: 60, durationFrames: 600, playheadFrame: 0,
      playing: false, characterKeys: [], textClips: [], saveMarkers: []
    } } : {})
  }
}

async function waitForWindow() {
  const started = Date.now()
  while (Date.now() - started < 30_000) {
    const window = BrowserWindow.getAllWindows()[0]
    if (window && !window.isDestroyed()) {
      try {
        const ready = await window.webContents.executeJavaScript("Boolean(window.desktop && typeof window.desktop.listStudios === 'function' && typeof window.desktop.listVideoStudios === 'function')")
        if (ready) return window
      } catch { /* wait for real preload and document */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('A janela real do G-V5/preload não ficou pronta.')
}

async function rejectPromise(expression, label) {
  const rejected = await expression
  assert.equal(rejected, true, `IPC deveria rejeitar: ${label}`)
}

async function rejectedError(expression) {
  return expression.then(() => null, (error) => String(error?.message ?? error))
}

async function seed(window) {
  const api = (expression) => window.webContents.executeJavaScript(expression)
  const normalFolder = await api('window.desktop.getStudioFolder()')
  const videoFolder = await api('window.desktop.getVideoStudioFolder()')
  const userData = app.getPath('userData')
  const withinData = (path) => {
    const rel = relative(userData, resolve(path))
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !require('node:path').isAbsolute(rel)
  }
  assert.ok(normalFolder.startsWith(join(userData, 'studios')))
  assert.ok(videoFolder.startsWith(join(userData, 'studios')))
  assert.notEqual(normalFolder, videoFolder)
  assert.ok(normalFolder.startsWith(sandbox) && videoFolder.startsWith(sandbox))
  assert.equal(withinData(normalFolder), true)
  assert.equal(withinData(videoFolder), true)
  await api('window.desktop.listStudios()')
  await api('window.desktop.listVideoStudios()')

  const normalPath = join(normalFolder, 'studio-1f50a2e4-7da4-4e28-9566-63dbf9403001')
  const videoPath = join(videoFolder, 'studio-1f50a2e4-7da4-4e28-9566-63dbf9403001')
  const outsideSentinel = join(sandbox, 'outside-studio-sentinel.txt')
  await writeFile(outsideSentinel, 'must remain byte-identical')
  const outsideBefore = readFileSync(outsideSentinel)
  let normalMutations = 0
  let videoMutations = 0
  for (let index = 0; index < 10; index += 1) {
    const videoBefore = treeHash(videoFolder)
    const document = syntheticStudio(`IPC normal ${index + 1}`)
    await api(`window.desktop.saveStudio(${JSON.stringify(document)})`)
    normalMutations += 1
    assert.equal(treeHash(videoFolder), videoBefore, `Salvamento normal ${index + 1} alterou Video Studio`)
    const stored = JSON.parse(readFileSync(join(normalPath, 'studio.json'), 'utf8'))
    assert.equal(stored.title, document.title)
    assert.equal((await api('window.desktop.listStudios()')).length, 1)

    const normalBefore = treeHash(normalFolder)
    const videoDocument = syntheticStudio(`IPC vídeo ${index + 1}`, true)
    await api(`window.desktop.saveVideoStudio(${JSON.stringify(videoDocument)})`)
    videoMutations += 1
    assert.equal(treeHash(normalFolder), normalBefore, `Salvamento de vídeo ${index + 1} alterou Studio normal`)
    const videoStored = JSON.parse(readFileSync(join(videoPath, 'studio.json'), 'utf8'))
    assert.equal(videoStored.title, videoDocument.title)
    assert.equal((await api('window.desktop.listVideoStudios()')).length, 1)
  }

  // Concurrent renderer calls exercise the per-namespace save queues while
  // keeping the same document ID intentionally colliding across namespaces.
  const concurrentNormal = Array.from({ length: 10 }, (_, index) => syntheticStudio(`IPC concorrente ${index + 1}`))
  const concurrentVideo = Array.from({ length: 10 }, (_, index) => syntheticStudio(`IPC vídeo concorrente ${index + 1}`, true))
  await Promise.all([
    ...concurrentNormal.map((document) => api(`window.desktop.saveStudio(${JSON.stringify(document)})`)),
    ...concurrentVideo.map((document) => api(`window.desktop.saveVideoStudio(${JSON.stringify(document)})`))
  ])
  const normalConcurrentDoc = JSON.parse(readFileSync(join(normalPath, 'studio.json'), 'utf8'))
  const videoConcurrentDoc = JSON.parse(readFileSync(join(videoPath, 'studio.json'), 'utf8'))
  assert.ok(concurrentNormal.some((document) => document.title === normalConcurrentDoc.title), 'Último documento normal concorrente não persistido')
  assert.ok(concurrentVideo.some((document) => document.title === videoConcurrentDoc.title), 'Último roteiro concorrente não persistido')

  // Verify each namespace remains byte-for-byte stable when only the other
  // namespace is concurrently writing.
  const normalBeforeVideoOnly = treeHash(normalFolder)
  await Promise.all(Array.from({ length: 10 }, (_, index) => api(`window.desktop.saveVideoStudio(${JSON.stringify(syntheticStudio(`IPC video edit ${index + 1}`, true))})`)))
  assert.equal(treeHash(normalFolder), normalBeforeVideoOnly, 'Gravações concorrentes de vídeo alteraram namespace normal')
  const videoAfterVideoOnly = treeHash(videoFolder)
  await Promise.all(Array.from({ length: 10 }, (_, index) => api(`window.desktop.saveStudio(${JSON.stringify(syntheticStudio(`IPC normal edit ${index + 1}`))})`)))
  assert.equal(treeHash(videoFolder), videoAfterVideoOnly, 'Gravações concorrentes do Studio alteraram namespace de vídeo')
  const normalFinalDoc = JSON.parse(readFileSync(join(normalPath, 'studio.json'), 'utf8'))
  assert.ok(normalFinalDoc.title.startsWith('IPC normal edit '), 'Edições concorrentes do Studio não persistidas')
  const videoFinalDoc = JSON.parse(readFileSync(join(videoPath, 'studio.json'), 'utf8'))
  assert.ok(videoFinalDoc.title.startsWith('IPC video edit '), 'Edições concorrentes de vídeo não persistidas')
  // Invalid payloads must reject before making even partial namespace writes.
  const invalidPathBefore = readFileSync(outsideSentinel)
  const invalidPathError = await rejectedError(api(`window.desktop.saveStudio(${JSON.stringify({ ...syntheticStudio('invalid path'), id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/../../outside' })})`))
  assert.ok(invalidPathError, 'ID perigoso deveria ser rejeitado')
  assert.deepEqual(readFileSync(outsideSentinel), invalidPathBefore, 'Payload inválido alterou arquivo sentinel fora dos namespaces')

  const normalBeforeNegative = treeHash(normalFolder)
  const videoBeforeNegative = treeHash(videoFolder)
  await rejectPromise(api(`window.desktop.saveStudio(${JSON.stringify({ ...syntheticStudio('bad'), id: '../outside' })}).then(() => false, () => true)`), 'ID traversal em studio:save')
  await rejectPromise(api(`window.desktop.saveVideoStudio(${JSON.stringify({ ...syntheticStudio('bad', true), title: '' })}).then(() => false, () => true)`), 'documento inválido em video-studio:save')
  await rejectPromise(api("window.desktop.deleteStudio('../outside').then(() => false, () => true)"), 'ID traversal em studio:delete')
  await rejectPromise(api("window.desktop.deleteVideoStudio('not-a-uuid').then(() => false, () => true)"), 'ID inválido em video-studio:delete')
  assert.equal(treeHash(normalFolder), normalBeforeNegative)
  assert.equal(treeHash(videoFolder), videoBeforeNegative)

  // Test the real delete handlers with colliding IDs; only the selected
  // workspace directory may be removed. Then reopen verifies absence/presence.
  const result = { schemaVersion: 1, adapter: 'production-preload-real-ipc', realIpcCovered: true,
    sameDocumentIdBothNamespaces: true, validMutations: { studio: normalMutations, videoStudio: videoMutations },
    concurrentOperations: { simultaneousCrossNamespace: concurrentNormal.length + concurrentVideo.length,
      isolatedStudioWrites: 10, isolatedVideoStudioWrites: 10 },
    malformedCallsRejected: 5, deleteOperations: 0, outsideSandboxWritesObserved: 0,
    sandboxRoot: 'out/dev-ai/runs/<run-id>/sandbox',
    relativeNamespaces: ['electron-user-data/studios/Studio Principal', 'electron-user-data/studios/Video Studio'] }
  await writeFile(join(output, 'seed-result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ mode, status: 'passed', ...result }))
}

async function deleteDocuments(window) {
  const api = (expression) => window.webContents.executeJavaScript(expression)
  const normalFolder = await api('window.desktop.getStudioFolder()')
  const videoFolder = await api('window.desktop.getVideoStudioFolder()')
  const normalPath = join(normalFolder, 'studio-1f50a2e4-7da4-4e28-9566-63dbf9403001')
  const videoPath = join(videoFolder, 'studio-1f50a2e4-7da4-4e28-9566-63dbf9403001')
  assert.equal((await api('window.desktop.listStudios()')).length, 1)
  assert.equal((await api('window.desktop.listVideoStudios()')).length, 1)
  const outsideSentinel = join(sandbox, 'outside-studio-sentinel.txt')
  await writeFile(outsideSentinel, 'must remain byte-identical')
  const outsideBefore = readFileSync(outsideSentinel)
  await api("window.desktop.deleteStudio('1f50a2e4-7da4-4e28-9566-63dbf9403001')")
  assert.equal(existsSync(normalPath), false, 'Excluir Studio normal não removeu sua pasta')
  assert.equal(existsSync(join(videoPath, 'studio.json')), true, 'Excluir Studio normal removeu roteiro de vídeo com ID igual')
  assert.equal((await api('window.desktop.listStudios()')).length, 0)
  assert.equal((await api('window.desktop.listVideoStudios()')).length, 1)
  await api("window.desktop.deleteVideoStudio('1f50a2e4-7da4-4e28-9566-63dbf9403001')")
  assert.equal(existsSync(videoPath), false, 'Excluir roteiro de vídeo não removeu sua pasta')
  assert.equal((await api('window.desktop.listVideoStudios()')).length, 0)
  assert.equal(readFileSync(outsideSentinel, 'utf8'), 'must remain byte-identical')
  assert.deepEqual(readFileSync(outsideSentinel), outsideBefore, 'As operações IPC alteraram o sentinel fora dos namespaces')

  await writeFile(join(output, 'delete-result.json'), JSON.stringify({ mode, status: 'passed', adapter: 'production-preload-real-ipc', realIpcCovered: true, deleteOperations: 2, outsideSandboxWritesObserved: 0 }, null, 2))
  console.log(JSON.stringify({ mode, status: 'passed', deleteOperations: 2, outsideSandboxWritesObserved: 0 }))
}

async function verifyRestart(window) {
  const [normal, video] = await Promise.all([
    window.webContents.executeJavaScript('window.desktop.listStudios()'),
    window.webContents.executeJavaScript('window.desktop.listVideoStudios()')
  ])
  assert.equal(normal.length, 1)
  assert.equal(video.length, 1)
  assert.equal(normal[0].id, video[0].id)
  assert.ok(normal[0].title.startsWith('IPC normal edit '))
  assert.ok(video[0].title.startsWith('IPC video edit '))
  assert.ok(normal[0].videoTimeline === undefined)
  assert.ok(video[0].videoTimeline)
  const result = { mode, status: 'passed', adapter: 'production-preload-real-ipc', realIpcCovered: true,
    restartedProcess: true, normalDocuments: normal.length, videoStudioDocuments: video.length,
    sameIdStillIsolated: true, dataRoot: 'out/dev-ai/runs/<run-id>/sandbox' }
  await writeFile(join(output, 'restart-result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
}

async function areaSmoke(window) {
  const diagnostics = []
  window.webContents.on('render-process-gone', (_event, details) => diagnostics.push({ type: 'gone', reason: details.reason, exitCode: details.exitCode }))
  window.webContents.on('console-message', (_event, ...args) => {
    const details = args[0]
    const level = details && typeof details === 'object' ? details.level : details
    const message = details && typeof details === 'object' ? details.message : args[1]
    if (Number(level) >= 2) diagnostics.push({ type: 'console', message: String(message ?? '').slice(0, 500) })
  })
  const route = async (hash, selector, label) => {
    await window.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`)
    const started = Date.now()
    while (Date.now() - started < 20_000) {
      const ready = await window.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)
      if (ready) {
        await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        const state = await window.webContents.executeJavaScript(`({ready: Boolean(document.querySelector(${JSON.stringify(selector)})), bodyLength: document.body?.innerText?.length ?? 0, error: document.querySelector('[role="alert"]')?.innerText ?? null})`)
        assert.equal(state.ready, true)
        assert.equal(state.error, null, `${label} exibiu erro: ${state.error}`)
        return { label, route: hash, durationMs: Date.now() - started, ready: true, bodyLength: state.bodyLength }
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    const state = await window.webContents.executeJavaScript(`({route: location.hash, body: (document.body?.innerText ?? '').slice(0,1000), error: document.querySelector('[role="alert"]')?.innerText ?? null})`)
    throw new Error(`${label} não montou: ${JSON.stringify(state)}; diagnostics=${JSON.stringify(diagnostics.slice(-8))}`)
  }
  const customizer = await route('/customizar', '.home-layout', 'Customizer')
  const characters = await window.webContents.executeJavaScript('window.desktop.listCustomizerCharacters()')
  assert.ok(Array.isArray(characters))
  const fabricator = await route('/fabricador-dev', '.fabricator-layout', 'Fabricador Dev')
  const slots = await window.webContents.executeJavaScript('window.desktop.listFabricatorSlots()')
  assert.ok(Array.isArray(slots) && slots.length === 10)
  const modelWorkspace = await route('/fabricador-dev', '.fabricator-model-editor', 'Fabricador modelos')
  const result = { mode, status: 'passed', adapter: 'production-preload-real-ipc', realIpcCovered: true,
    smokeAreas: [customizer, fabricator, modelWorkspace], customizerSyntheticCharacters: characters.length,
    fabricatorSlots: slots.length, rendererErrors: diagnostics }
  await writeFile(join(output, 'area-smoke-result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
}

async function main() {
  assertOutputSandbox()
  if (mode === 'invalid-root') {
    try {
      await import(pathToFileURL(join(ROOT, 'out', 'main', 'main.js')).href)
      throw new Error('Main aceitou um root DEV AI fora do sandbox autorizado.')
    } catch (error) {
      if (String(error?.message ?? error).includes('Main aceitou')) throw error
      assert.match(String(error?.message ?? error), /Root sintético DEV AI fora do diretório autorizado\./,
        'A rejeição do root inválido deve vir do guard de segurança esperado')
      console.log(JSON.stringify({ mode, status: 'passed', invalidRootRejected: true }))
      exitCode = 0
      return
    }
  }
  if (!['seed', 'verify-restart', 'area-smoke', 'delete'].includes(mode)) throw new Error('Modo inválido.')
  await import(pathToFileURL(join(ROOT, 'out', 'main', 'main.js')).href)
  await app.whenReady()
  const window = await waitForWindow()
  if (mode === 'seed') await seed(window)
  else if (mode === 'verify-restart') await verifyRestart(window)
  else if (mode === 'area-smoke') await areaSmoke(window)
  else await deleteDocuments(window)
  exitCode = 0
}

main().catch((error) => {
  console.error(`DEV AI IPC ${mode}: ${error?.stack ?? error}`)
  exitCode = 1
}).finally(() => {
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.destroy()
  app.once('will-quit', () => { process.exitCode = exitCode })
  app.quit()
})
