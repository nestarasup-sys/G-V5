// Run after npm run build: electron scripts/audit-studio-isolation.cjs
// Uses in-memory documents and a separate userData directory, never the real library.
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const { mkdirSync, existsSync, lstatSync, realpathSync, readFileSync } = require('node:fs')
const { writeFile } = require('node:fs/promises')
const { join, resolve, relative, dirname, isAbsolute, sep } = require('node:path')

const root = resolve(__dirname, '..')
const defaultOutput = join(root, 'out', 'audit-studio-isolation')
let output = defaultOutput
if (process.env.GACHA_AUDIT_OUTPUT_DIR || process.env.GACHA_AUDIT_RUN_ROOT) {
  const runs = resolve(root, 'out', 'dev-ai', 'runs')
  const runRoot = resolve(process.env.GACHA_AUDIT_RUN_ROOT ?? '')
  const requested = resolve(process.env.GACHA_AUDIT_OUTPUT_DIR ?? '')
  const relativeRun = relative(runs, runRoot)
  if (!relativeRun || relativeRun === '..' || relativeRun.startsWith(`..${sep}`) || isAbsolute(relativeRun)
    || dirname(requested) !== runRoot || !existsSync(join(runRoot, '.dev-ai-sandbox.json'))) {
    throw new Error('DEV AI audit: diretório de saída não autorizado')
  }
  const marker = JSON.parse(readFileSync(join(runRoot, '.dev-ai-sandbox.json'), 'utf8'))
  if (marker.schemaVersion !== 1 || marker.syntheticOnly !== true || typeof marker.runId !== 'string') {
    throw new Error('DEV AI audit: marcador de sandbox inválido')
  }
  for (const part of [join(root, 'out'), join(root, 'out', 'dev-ai'), runs, runRoot, requested]) {
    if (existsSync(part) && lstatSync(part).isSymbolicLink()) throw new Error('DEV AI audit: symlink não permitido')
  }
  if (realpathSync(runRoot) !== runRoot) throw new Error('DEV AI audit: root não canônico')
  output = requested
}
mkdirSync(join(output, 'user-data'), { recursive: true })
app.setPath('userData', join(output, 'user-data'))
app.setPath('sessionData', join(output, 'user-data'))

async function waitFor(window, selector) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await window.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Interface não carregou: ${selector}`)
}

async function capture(window, filename) {
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  // Allow Chromium's compositor to present the new route before capturing its surface.
  await new Promise((resolve) => setTimeout(resolve, 150))
  await writeFile(join(output, filename), (await window.webContents.capturePage()).toPNG())
}

async function inspect(window, video) {
  const prefix = video ? 'video-studio' : 'studio'
  await waitFor(window, `.${prefix}-card-open`)
  await window.webContents.executeJavaScript(`document.querySelector('.${prefix}-card-open').click()`)
  await waitFor(window, `.${prefix}-editor`)
  await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.${prefix}-tool-button')).find(button => button.textContent.includes('Fundo')).click()`)
  await waitFor(window, `.${prefix}-inspector`)
  await waitFor(window, video ? '.video-timeline' : '.top-bar')
  return window.webContents.executeJavaScript(`(() => {
    const editor = document.querySelector('.${prefix}-editor')
    const inspector = document.querySelector('.${prefix}-inspector')
    const canvas = document.querySelector('.${prefix}-scene-canvas')
    return {
      columns: getComputedStyle(editor).gridTemplateColumns.split(' ').length,
      inspectorPosition: getComputedStyle(inspector).position,
      inspectorInCanvas: inspector.parentElement === canvas,
      inspectorInEditor: inspector.parentElement === editor,
      castOnRight: Boolean(document.querySelector('.${prefix}-editor-right')),
      castInToolbar: Boolean(document.querySelector('.${prefix}-cast-tool-button')),
      timeline: Boolean(document.querySelector('.video-timeline')),
      topBar: Boolean(document.querySelector('.top-bar')),
      canvasRatio: canvas.clientWidth / canvas.clientHeight
    }
  })()`)
}

function checkNormal(state) {
  assert.equal(state.columns, 3, 'Studio: ferramentas, prévia e elenco')
  assert.equal(state.castOnRight, true, 'Studio: elenco à direita')
  assert.equal(state.castInToolbar, false, 'Studio: elenco não migra para a barra')
  assert.equal(state.inspectorInCanvas, true, 'Studio: inspector sobre a prévia')
  assert.equal(state.inspectorPosition, 'absolute')
  assert.equal(state.timeline, false, 'Studio: sem timeline de vídeo')
  assert.equal(state.topBar, true, 'Studio: navegação principal visível')
}

async function run() {
  const preload = join(output, 'fixture-preload.cjs')
  await writeFile(preload, `
    const { contextBridge } = require('electron')
    const document = (id, title) => ({ schemaVersion: 1, id, title, color: '#c090b0',
      createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:00Z',
      backgroundColor: '#d7b5cd', backgroundAssetId: null, backgroundX: 0,
      backgroundY: 0, backgroundWidth: 100, backgroundHeight: 100,
      backgroundRotation: 0, assets: [], elements: [] })
    let normal = [document('11111111-1111-4111-8111-111111111111', 'Studio de conferência')]
    let video = [document('22222222-2222-4222-8222-222222222222', 'Vídeo de conferência')]
    let normalWrites = 0
    let videoWrites = 0
    contextBridge.exposeInMainWorld('desktop', {
      platform: 'win32', appName: 'Auditoria Studio',
      listStudios: async () => normal, getStudioFolder: async () => 'fixture/Studio Principal',
      saveStudio: async (value) => { normal = [value]; normalWrites += 1 },
      listVideoStudios: async () => video, getVideoStudioFolder: async () => 'fixture/Video Studio',
      saveVideoStudio: async (value) => { video = [value]; videoWrites += 1 },
      listCustomizerCharacters: async () => [], listFaceCatalog: async () => [],
      listFaceExpressionCollections: async () => [], listFaceExpressionPresets: async () => [],
      listFabricatorPoseSlots: async () => [],
      importStudioImage: async () => null, importVideoStudioImage: async () => null,
      importVideoStudioVideo: async () => null,
      __auditSnapshot: () => ({ normal, video, normalWrites, videoWrites })
    })
  `)
  await app.whenReady()
  const window = new BrowserWindow({ show: false, width: 1440, height: 900, useContentSize: true,
    webPreferences: { preload, contextIsolation: true, sandbox: true, backgroundThrottling: false } })
  await window.loadFile(join(root, 'out', 'renderer', 'index.html'), { hash: '/estudio' })
  const normalBefore = await inspect(window, false)
  checkNormal(normalBefore)
  await capture(window, 'studio-normal.png')
  // Mock bridge invariant only: does NOT prove real IPC isolation.
  const mockedBefore = await window.webContents.executeJavaScript('window.desktop.__auditSnapshot()')
  assert.equal(mockedBefore.normal.length, 1)
  assert.equal(mockedBefore.video.length, 1)
  assert.notEqual(mockedBefore.normal[0].id, mockedBefore.video[0].id)
  await window.webContents.executeJavaScript("location.hash = '/video-studio'")
  const video = await inspect(window, true)
  assert.equal(video.columns, 3, 'Video Studio: ferramentas, inspector e prévia')
  assert.equal(video.inspectorInEditor, true)
  assert.equal(video.inspectorPosition, 'relative')
  assert.equal(video.castOnRight, false)
  assert.equal(video.castInToolbar, true)
  assert.equal(video.timeline, true)
  assert.equal(video.topBar, false)
  assert.ok(Math.abs(video.canvasRatio - 16 / 9) < 0.02)
  await capture(window, 'video-studio.png')
  await window.webContents.executeJavaScript("location.hash = '/estudio'")
  const normalAfter = await inspect(window, false)
  checkNormal(normalAfter)
  assert.deepEqual(normalAfter, normalBefore, 'Os estilos do Video Studio não podem alterar o Studio após navegar')
  // Regression: multiple Studio -> Video -> Studio round trips must not leak
  // layout styles. This uses the existing synthetic fixture/preload.
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await window.webContents.executeJavaScript("location.hash = '/video-studio'")
    const nextVideo = await inspect(window, true)
    assert.deepEqual(nextVideo, video, `Video layout mudou no ciclo ${cycle + 1}`)
    await window.webContents.executeJavaScript("location.hash = '/estudio'")
    const nextNormal = await inspect(window, false)
    assert.deepEqual(nextNormal, normalBefore, `Studio mudou após o ciclo ${cycle + 1}`)
  }
  await window.webContents.executeJavaScript(`(async () => {
    const n = (await window.desktop.listStudios())[0]
    const v = (await window.desktop.listVideoStudios())[0]
    await window.desktop.saveStudio({ ...n, title: 'Normal fixture updated' })
    await window.desktop.saveVideoStudio({ ...v, title: 'Video fixture updated' })
  })()`)
  const mockedAfter = await window.webContents.executeJavaScript('window.desktop.__auditSnapshot()')
  assert.equal(mockedAfter.normal[0].title, 'Normal fixture updated')
  assert.equal(mockedAfter.video[0].title, 'Video fixture updated')
  assert.equal(mockedAfter.normalWrites, 1)
  assert.equal(mockedAfter.videoWrites, 1)
  await capture(window, 'studio-normal-after-cycles.png')
  await writeFile(join(output, 'result.json'), JSON.stringify({
    schemaVersion: 1, adapter: 'fixture-preload', realIpcCovered: false,
    cycles: 4, normalBefore, video, normalAfter,
    mockedNamespaceProbe: { normalWrites: mockedAfter.normalWrites, videoWrites: mockedAfter.videoWrites }
  }, null, 2))
  console.log(JSON.stringify({ normalBefore, video, normalAfter }, null, 2))
  console.log(`Studio isolation audit passed. Captures: ${output}`)
  window.destroy()
  app.exit(0)
}

run().catch((error) => { console.error(error); app.exit(1) })
