'use strict'
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')

const jobId = 'f3c40c08-5be8-476f-8132-4dafca4f3d57'
const studioId = '360d7ac8-27c8-4aab-b8be-2397e1c46a76'
const rendererFile = path.resolve(__dirname, '../../out/renderer/index.html')
const preloadPath = path.resolve(__dirname, '../../out/preload/video-export-preload.cjs')

function fail(reason) {
  console.error(reason instanceof Error ? reason.stack || reason.message : String(reason))
  app.exit(1)
}

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-background-timer-throttling')

app.whenReady().then(async () => {
  const timeline = {
    schemaVersion: 1, frameRate: 60, durationFrames: 2, playheadFrame: 0, playing: false,
    characterKeys: [], textClips: [], videoClips: [], videoAssets: [], saveMarkers: [],
  }
  const studio = {
    schemaVersion: 1, id: studioId, title: 'Synthetic offscreen surface', color: '#333333',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    backgroundColor: '#123456', backgroundAssetId: null,
    backgroundX: 0, backgroundY: 0, backgroundWidth: 100, backgroundHeight: 100, backgroundRotation: 0,
    assets: [], elements: [], videoTimeline: timeline,
  }
  const bootstrap = {
    jobId,
    snapshot: { studio, timeline, frameRate: 60, durationFrames: 2 },
    characters: { schemaVersion: 1, characters: [] },
    characterAssets: { schemaVersion: 1, entries: [] },
    renderVariant: 'static-characters',
  }

  let window
  let timer
  const cleanup = () => {
    clearTimeout(timer)
    try { ipcMain.removeHandler('video-studio:export-surface:prepare') } catch {}
    ipcMain.removeAllListeners('video-studio:export-surface:ready')
    ipcMain.removeAllListeners('video-studio:export-surface:frame-ready')
    if (window && !window.isDestroyed()) window.destroy()
  }
  timer = setTimeout(() => { cleanup(); fail(new Error('Electron surface smoke excedeu 30 segundos.')) }, 30000)

  ipcMain.handle('video-studio:export-surface:prepare', (event, requestedJobId) => {
    if (requestedJobId !== jobId) throw new Error('Smoke recebeu jobId inesperado.')
    if (!window || event.sender.id !== window.webContents.id) throw new Error('Sender inesperado no smoke.')
    return bootstrap
  })

  ipcMain.on('video-studio:export-surface:ready', (_event, ready) => {
    if (ready.jobId !== jobId || ready.error) {
      cleanup()
      fail(new Error(ready.error || 'Surface pronta respondeu com job diferente.'))
      return
    }
    window.webContents.send('video-studio:export-surface:render', { requestId: 'surface-smoke-frame-0', frame: 0 })
  })

  ipcMain.on('video-studio:export-surface:frame-ready', async (_event, ready) => {
    if (ready.requestId !== 'surface-smoke-frame-0') return
    if (ready.error) {
      cleanup()
      fail(new Error(ready.error))
      return
    }
    try {
      const pixels = ready.pixels
      if (!(pixels instanceof Uint8Array)) throw new Error('Surface não retornou Uint8Array RGBA.')
      if (pixels.byteLength !== 1920 * 1080 * 4) throw new Error(`Bitmap inesperado: ${pixels.byteLength} bytes`)
      if (!pixels.some((value) => value !== 0)) throw new Error('Bitmap da surface veio completamente vazio.')
      console.log(JSON.stringify({ ok: true, width: 1920, height: 1080, bytes: pixels.byteLength }))
      cleanup()
      app.exit(0)
    } catch (reason) {
      cleanup()
      fail(reason)
    }
  })

  window = new BrowserWindow({
    show: false,
    width: 1920,
    height: 1080,
    useContentSize: true,
    backgroundColor: '#000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      offscreen: true,
    },
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    cleanup()
    fail(new Error(`Renderer da surface encerrou: ${details.reason}`))
  })
  await window.loadFile(rendererFile, { hash: `/video-export-surface?jobId=${jobId}` })
}).catch(fail)
