import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router'
import { App } from './ui/App'
import { AppErrorBoundary } from './ui/components/AppErrorBoundary'
import { VideoExportSurfacePage } from './features/videoStudio/VideoExportSurfacePage'
import './ui/styles.css'

const exportSurface = window.location.hash.startsWith('#/video-export-surface')
const root = ReactDOM.createRoot(document.getElementById('root')!)

if (exportSurface) {
  // Do not mount App or its migration/backup hooks in the restricted offscreen
  // renderer. Its dedicated preload intentionally exposes only export-surface IPC.
  root.render(<VideoExportSurfacePage />)
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
