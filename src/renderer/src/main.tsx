import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router'
import { App } from './ui/App'
import { AppErrorBoundary } from './ui/components/AppErrorBoundary'
import './ui/styles.css'

const exportSurface = window.location.hash.startsWith('#/video-export-surface')
const root = ReactDOM.createRoot(document.getElementById('root')!)

if (exportSurface) {
  // Do not mount App or its migration/backup hooks in the restricted offscreen
  // renderer. Load the compositor chunk only in export windows.
  void import('./features/videoStudio/VideoExportSurfacePage').then(({ VideoExportSurfacePage }) => {
    root.render(<VideoExportSurfacePage />)
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
