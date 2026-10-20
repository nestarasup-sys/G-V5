'use strict'

const { app, BrowserWindow, ipcMain } = require('electron')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')

const jobId = 'f3c40c08-5be8-476f-8132-4dafca4f3d57'
const studioId = '360d7ac8-27c8-4aab-b8be-2397e1c46a76'
const rendererFile = process.env.GACHA_E2E_RENDERER_FILE
  ? path.resolve(process.env.GACHA_E2E_RENDERER_FILE)
  : path.resolve(__dirname, '../../out/renderer/index.html')
const preloadPath = process.env.GACHA_E2E_PRELOAD_FILE
  ? path.resolve(process.env.GACHA_E2E_PRELOAD_FILE)
  : path.resolve(__dirname, '../../out/preload/video-export-preload.cjs')
const ffmpeg = process.env.GACHA_FFMPEG_PATH
const ffprobe = process.env.GACHA_FFPROBE_PATH
const width = 1920
const height = 1080
const frameCount = 60

function loadPureTs(relativePath) {
  const source = fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8')
  const compiled = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
  const mod = { exports: {} }
  new Function('require','module','exports',compiled)(require,mod,mod.exports)
  return mod.exports
}

function requireTool(value, label) {
  if (!value || !path.isAbsolute(value) || !fs.existsSync(value)) throw new Error(`${label} absoluto é obrigatório para o smoke end-to-end.`)
  return value
}

function run(executable, args, encoding = 'utf8') {
  return execFileSync(executable, args, { encoding, timeout: 180_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
}

function fail(reason) {
  console.error(reason instanceof Error ? reason.stack || reason.message : String(reason))
  app.exit(1)
}

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-background-timer-throttling')

app.whenReady().then(async () => {
  requireTool(ffmpeg, 'GACHA_FFMPEG_PATH')
  requireTool(ffprobe, 'GACHA_FFPROBE_PATH')
  requireTool(rendererFile, 'Renderer do smoke')
  requireTool(preloadPath, 'Preload do smoke')

  const rawWriter = loadPureTs('electron/videoRawFrameWriter.ts')
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gacha-v5-e2e-'))
  const outputPath = path.join(tempRoot, 'surface-e2e.mp4')

  const narrator = {
    id: 'narrator-e2e', kind: 'narrator', text: 'G-V5 E2E 1080p60', x: 0, y: 0,
    width: 48, height: 16, rotation: 0, zIndex: 2,
  }
  const timeline = {
    schemaVersion: 1, frameRate: 60, durationFrames: frameCount, playheadFrame: 0, playing: false,
    characterKeys: [], textClips: [{ id: 'narrator-clip', elementId: narrator.id, kind: 'narrator', startFrame: 0, endFrame: frameCount }],
    videoClips: [], videoAssets: [], saveMarkers: [],
  }
  const studio = {
    schemaVersion: 1, id: studioId, title: 'Synthetic E2E surface', color: '#333333',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    backgroundColor: '#17375e', backgroundAssetId: null,
    backgroundX: 0, backgroundY: 0, backgroundWidth: 100, backgroundHeight: 100, backgroundRotation: 0,
    assets: [], elements: [narrator], videoTimeline: timeline,
  }
  const bootstrap = {
    jobId,
    snapshot: { studio, timeline, frameRate: 60, durationFrames: frameCount },
    characters: { schemaVersion: 1, characters: [] },
    characterAssets: { schemaVersion: 1, entries: [] },
    renderVariant: 'static-characters',
  }

  let window
  let writer
  let nextFrame = 0
  let renderedFrames = 0
  let timer
  let chain = Promise.resolve()

  const cleanup = () => {
    clearTimeout(timer)
    try { ipcMain.removeHandler('video-studio:export-surface:prepare') } catch {}
    ipcMain.removeAllListeners('video-studio:export-surface:ready')
    ipcMain.removeAllListeners('video-studio:export-surface:frame-ready')
    if (window && !window.isDestroyed()) window.destroy()
    try { fs.rmSync(tempRoot, { recursive: true, force: true }) } catch {}
  }
  const finishFailure = (reason) => {
    cleanup()
    fail(reason)
  }
  timer = setTimeout(() => finishFailure(new Error('Smoke end-to-end excedeu 150 segundos.')), 150000)

  ipcMain.handle('video-studio:export-surface:prepare', (event, requestedJobId) => {
    if (requestedJobId !== jobId) throw new Error('Smoke recebeu jobId inesperado.')
    if (!window || event.sender.id !== window.webContents.id) throw new Error('Sender inesperado no smoke end-to-end.')
    return bootstrap
  })

  const requestNext = () => {
    if (nextFrame >= frameCount) return
    window.webContents.send('video-studio:export-surface:render', { requestId: `e2e-${nextFrame}`, frame: nextFrame })
  }

  ipcMain.on('video-studio:export-surface:ready', async (_event, ready) => {
    try {
      if (ready.jobId !== jobId || ready.error) throw new Error(ready.error || 'Surface pronta respondeu com job diferente.')
      writer = new rawWriter.VideoRawFrameWriter({
        executable: ffmpeg,
        args: rawWriter.buildVideoStudioChunkArgs(outputPath, frameCount, 'rgba'),
        outputPath,
        frameBytes: width * height * 4,
        frameCount,
      })
      await writer.ready()
      requestNext()
    } catch (reason) { finishFailure(reason) }
  })

  ipcMain.on('video-studio:export-surface:frame-ready', (_event, ready) => {
    chain = chain.then(async () => {
      if (ready.requestId !== `e2e-${nextFrame}` || ready.frame !== nextFrame) return
      if (ready.error) throw new Error(ready.error)
      if (!(ready.pixels instanceof Uint8Array) || ready.pixels.byteLength !== width * height * 4) {
        throw new Error(`Surface devolveu ${ready.pixels?.byteLength ?? 0} bytes RGBA.`)
      }
      const rgba = Buffer.from(ready.pixels.buffer, ready.pixels.byteOffset, ready.pixels.byteLength)
      await writer.writeFrame(rgba, { copy: false })
      renderedFrames += 1
      nextFrame += 1
      if (nextFrame < frameCount) {
        requestNext()
        return
      }

      const encoded = await writer.finish()
      if (encoded.framesWritten !== frameCount) throw new Error(`Writer confirmou ${encoded.framesWritten}/${frameCount} frames.`)
      const probe = JSON.parse(run(ffprobe, [
        '-v', 'error', '-count_frames', '-select_streams', 'v:0',
        '-show_entries', 'stream=codec_name,width,height,r_frame_rate,nb_read_frames,duration', '-of', 'json', outputPath,
      ]))
      const stream = probe.streams?.[0]
      if (!stream || stream.codec_name !== 'h264' || stream.width !== width || stream.height !== height
        || stream.r_frame_rate !== '60/1' || Number(stream.nb_read_frames) !== frameCount) {
        throw new Error(`MP4 end-to-end inválido: ${JSON.stringify(probe)}`)
      }
      run(ffmpeg, ['-v', 'error', '-i', outputPath, '-f', 'null', '-'])
      const sample = run(ffmpeg, [
        '-v', 'error', '-i', outputPath, '-frames:v', '1',
        '-vf', 'crop=2:2:100:100', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1',
      ], null)
      const [red, green, blue] = sample.subarray(0, 3)
      if (!(blue > red + 25 && green > red + 10)) {
        throw new Error(`Canal RGBA foi trocado no encode/decode: rgb=${red},${green},${blue}`)
      }

      console.log(JSON.stringify({
        ok: true,
        pipeline: 'Electron ExportSurface -> Canvas RGBA -> VideoRawFrameWriter -> FFmpeg -> FFprobe/decode',
        width, height, frameRate: 60, renderedFrames,
        mp4Bytes: fs.statSync(outputPath).size,
        sampledBackgroundRgb: [red, green, blue],
        ffprobe: stream,
      }))
      cleanup()
      app.exit(0)
    }).catch(finishFailure)
  })

  window = new BrowserWindow({
    show: false,
    width,
    height,
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
  window.webContents.on('render-process-gone', (_event, details) => finishFailure(new Error(`Renderer encerrou: ${details.reason}`)))
  await window.loadFile(rendererFile, { hash: `/video-export-surface?jobId=${jobId}` })
}).catch(fail)
