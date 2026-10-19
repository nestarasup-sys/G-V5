import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { VideoExportSurfaceBootstrap, VideoExportSurfaceFrameReady } from '../src/shared/videoExportSurface'
import { VIDEO_STAGE_HEIGHT, VIDEO_STAGE_WIDTH } from '../src/shared/videoStageGeometry'
import type { VideoExportJobStore } from './videoExportJobs'

type SurfaceSession = {
  jobId: string
  window: BrowserWindow
  pending: Map<string, { frame: number; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>
}

export type VideoExportSurfaceHostOptions = Readonly<{
  preloadPath: string
  rendererUrl?: string
  rendererFile?: string
}>

/**
 * Owns isolated hidden renderer windows. All bootstrap/frame IPC is accepted
 * only from registered webContents ids; normal application windows cannot read
 * pinned job snapshots or impersonate frame acknowledgements.
 */
export class VideoExportSurfaceHost {
  private readonly sessions = new Map<number, SurfaceSession>()
  private handlersInstalled = false

  constructor(private readonly jobs: VideoExportJobStore, private readonly options: VideoExportSurfaceHostOptions) {
    if (!isAbsolute(options.preloadPath)) throw new Error('Preload da surface precisa usar caminho absoluto.')
    if (!options.rendererUrl && (!options.rendererFile || !isAbsolute(options.rendererFile))) throw new Error('Entrada do renderer da surface inválida.')
    this.installHandlers()
  }

  private sessionFor(event: { sender: Electron.WebContents }): SurfaceSession {
    const session = this.sessions.get(event.sender.id)
    if (!session || session.window.isDestroyed() || session.window.webContents.id !== event.sender.id) {
      throw new Error('IPC de export surface rejeitado: sender não registrado.')
    }
    return session
  }

  private installHandlers(): void {
    if (this.handlersInstalled) return
    this.handlersInstalled = true
    ipcMain.handle('video-studio:export-surface:prepare', async (event: IpcMainInvokeEvent, jobId: string): Promise<VideoExportSurfaceBootstrap> => {
      const session = this.sessionFor(event)
      if (jobId !== session.jobId) throw new Error('A surface tentou abrir outro job de exportação.')
      const reopened = await this.jobs.reopen(jobId)
      const variant = reopened.manifest.renderVariant
      if (!reopened.snapshot || !reopened.characters || !reopened.characterAssets || !variant) {
        throw new Error('Job ainda não contém snapshot, personagens e assets suficientes para render canônico.')
      }
      return {
        jobId,
        snapshot: reopened.snapshot,
        characters: reopened.characters,
        characterAssets: reopened.characterAssets,
        renderVariant: variant,
      }
    })
    ipcMain.on('video-studio:export-surface:frame-ready', (event, ready: VideoExportSurfaceFrameReady) => {
      let session: SurfaceSession
      try { session = this.sessionFor(event) } catch { return }
      if (!ready || typeof ready.requestId !== 'string' || !Number.isSafeInteger(ready.frame)) return
      const pending = session.pending.get(ready.requestId)
      if (!pending || pending.frame !== ready.frame) return
      clearTimeout(pending.timer)
      session.pending.delete(ready.requestId)
      if (ready.error) pending.reject(new Error(ready.error))
      else pending.resolve()
    })
  }

  async open(jobId: string): Promise<VideoExportSurfaceSession> {
    const window = new BrowserWindow({
      show: false,
      frame: false,
      useContentSize: true,
      width: VIDEO_STAGE_WIDTH,
      height: VIDEO_STAGE_HEIGHT,
      minWidth: VIDEO_STAGE_WIDTH,
      minHeight: VIDEO_STAGE_HEIGHT,
      maxWidth: VIDEO_STAGE_WIDTH,
      maxHeight: VIDEO_STAGE_HEIGHT,
      resizable: false,
      backgroundColor: '#000000',
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        offscreen: true,
      },
    })
    window.removeMenu()
    const session: SurfaceSession = { jobId, window, pending: new Map() }
    this.sessions.set(window.webContents.id, session)
    const cleanup = () => {
      this.sessions.delete(window.webContents.id)
      for (const pending of session.pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(new Error('Surface de exportação foi encerrada.'))
      }
      session.pending.clear()
    }
    window.once('closed', cleanup)
    try {
      if (this.options.rendererUrl) {
        const url = new URL(this.options.rendererUrl)
        url.hash = `/video-export-surface?jobId=${encodeURIComponent(jobId)}`
        await window.loadURL(url.toString())
      } else {
        await window.loadFile(this.options.rendererFile!, { hash: `/video-export-surface?jobId=${encodeURIComponent(jobId)}` })
      }
      return new VideoExportSurfaceSession(session)
    } catch (error) {
      if (!window.isDestroyed()) window.destroy()
      cleanup()
      throw error
    }
  }
}

export class VideoExportSurfaceSession {
  constructor(private readonly session: SurfaceSession) {}

  get jobId(): string { return this.session.jobId }

  async renderFrame(frame: number, timeoutMs = 30_000): Promise<Buffer> {
    if (!Number.isSafeInteger(frame) || frame < 0) throw new Error('Frame inválido para a surface de exportação.')
    const { window } = this.session
    if (window.isDestroyed()) throw new Error('Surface de exportação já foi encerrada.')
    const requestId = randomUUID()
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.session.pending.delete(requestId)
        reject(new Error(`Surface excedeu ${timeoutMs} ms ao renderizar frame ${frame}.`))
      }, Math.max(1_000, Math.min(120_000, timeoutMs)))
      this.session.pending.set(requestId, { frame, resolve, reject, timer })
    })
    window.webContents.send('video-studio:export-surface:render', { requestId, frame })
    await ready
    const image = await window.webContents.capturePage({ x: 0, y: 0, width: VIDEO_STAGE_WIDTH, height: VIDEO_STAGE_HEIGHT })
    const size = image.getSize()
    if (size.width !== VIDEO_STAGE_WIDTH || size.height !== VIDEO_STAGE_HEIGHT) {
      throw new Error(`Surface capturou ${size.width}×${size.height}; esperava ${VIDEO_STAGE_WIDTH}×${VIDEO_STAGE_HEIGHT}.`)
    }
    const bitmap = image.toBitmap()
    const expectedBytes = VIDEO_STAGE_WIDTH * VIDEO_STAGE_HEIGHT * 4
    if (bitmap.byteLength !== expectedBytes) throw new Error(`Bitmap da surface contém ${bitmap.byteLength} bytes; esperava ${expectedBytes}.`)
    return Buffer.from(bitmap)
  }

  async dispose(): Promise<void> {
    const { window } = this.session
    if (!window.isDestroyed()) window.destroy()
  }
}
