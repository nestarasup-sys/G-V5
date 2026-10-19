import { contextBridge, ipcRenderer } from 'electron'
import type {
  VideoExportSurfaceBootstrap,
  VideoExportSurfaceFrameReady,
  VideoExportSurfaceReady,
  VideoExportSurfaceRenderRequest,
} from '../src/shared/videoExportSurface'

contextBridge.exposeInMainWorld('desktop', {
  prepareVideoExportSurface: (jobId: string): Promise<VideoExportSurfaceBootstrap> =>
    ipcRenderer.invoke('video-studio:export-surface:prepare', jobId),
  onVideoExportSurfaceRender: (callback: (request: VideoExportSurfaceRenderRequest) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: VideoExportSurfaceRenderRequest) => callback(request)
    ipcRenderer.on('video-studio:export-surface:render', listener)
    return () => ipcRenderer.removeListener('video-studio:export-surface:render', listener)
  },
  reportVideoExportSurfaceFrame: (ready: VideoExportSurfaceFrameReady): void =>
    ipcRenderer.send('video-studio:export-surface:frame-ready', ready),
  reportVideoExportSurfaceReady: (ready: VideoExportSurfaceReady): void =>
    ipcRenderer.send('video-studio:export-surface:ready', ready),
})
