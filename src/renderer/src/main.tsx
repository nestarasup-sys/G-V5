import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router'
import { App } from './ui/App'
import { AppErrorBoundary } from './ui/components/AppErrorBoundary'
import './ui/styles.css'

const tree = (
  <HashRouter>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </HashRouter>
)

const exportSurface = window.location.hash.startsWith('#/video-export-surface')
ReactDOM.createRoot(document.getElementById('root')!).render(
  exportSurface ? tree : <React.StrictMode>{tree}</React.StrictMode>
)
