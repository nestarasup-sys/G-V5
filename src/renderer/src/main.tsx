import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router'
import { App } from './ui/App'
import { AppErrorBoundary } from './ui/components/AppErrorBoundary'
import './ui/styles.css'

const exportSurface = window.location.hash.startsWith('#/video-export-surface')
const previewOracle = window.location.hash.startsWith('#/video-preview-oracle')
const root = ReactDOM.createRoot(document.getElementById('root')!)

if (exportSurface || previewOracle) {
  // Do not mount App or its migration/backup hooks in restricted test/export
  // renderers. Each route gets only the dedicated export preload.
  const load = previewOracle
    ? import('./features/videoStudio/VideoPreviewOraclePage').then(({ VideoPreviewOraclePage }) => <VideoPreviewOraclePage />)
    : import('./features/videoStudio/VideoExportSurfacePage').then(({ VideoExportSurfacePage }) => <VideoExportSurfacePage />)
  void load.then((page) => {
    root.render(page)
  }).catch((reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason)
    root.render(<pre role="alert">{message}</pre>)
  })
} else {
  root.render(
    <React.StrictMode>
      <HashRouter>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </HashRouter>
    </React.StrictMode>
  )
}
