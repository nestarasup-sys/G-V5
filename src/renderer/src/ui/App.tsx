import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { TopBar } from './components/TopBar'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { Icon } from './components/Icon'

const LazyCustomizerPage = lazy(async () => ({ default: (await import('../features/customizer/CustomizerPage')).CustomizerPage }))
const LazyStudioPage = lazy(async () => ({ default: (await import('../features/studio/StudioPage')).StudioPage }))
const LazyVideoStudioPage = lazy(async () => ({ default: (await import('../features/videoStudio/VideoStudioPage')).VideoStudioPage }))
const LazyOptionsPage = lazy(async () => ({ default: (await import('../features/options/OptionsPage')).OptionsPage }))
const LazyFabricatorPage = lazy(async () => ({ default: (await import('../features/fabricator/FabricatorPage')).FabricatorPage }))

const roteiroAreas = [
  { id: 'roteiros', label: 'Roteiros', icon: 'message' },
  { id: 'fichas', label: 'Ficha dos personagens', icon: 'user' },
  { id: 'configuracoes', label: 'Configurações', icon: 'settings' }
] as const

function EmptyRoteirosPage() {
  const [activeArea, setActiveArea] = useState<(typeof roteiroAreas)[number]['id']>('roteiros')
  const active = roteiroAreas.find((area) => area.id === activeArea) ?? roteiroAreas[0]
  return <div className="roteiros-layout">
    <aside className="roteiros-sidebar-empty" aria-label="Navegação de roteiros">
      <nav className="roteiros-subnav" aria-label="Subáreas de Roteiros">
        {roteiroAreas.map((area) => <button key={area.id} className={`roteiros-subnav-button${activeArea === area.id ? ' active' : ''}`} onClick={() => setActiveArea(area.id)} aria-current={activeArea === area.id ? 'page' : undefined} type="button"><Icon name={area.icon} /><span>{area.label}</span></button>)}
      </nav>
    </aside>
    <section className="roteiros-main-empty" aria-label={`Área ${active.label}`}><header className="roteiros-area-titlebar"><h1>{active.label}</h1></header></section>
  </div>
}

export function App() {
  const location = useLocation()
  const [videoEditorActive, setVideoEditorActive] = useState(false)

  useEffect(() => {
    if (location.pathname !== '/video-studio') setVideoEditorActive(false)
  }, [location.pathname])

  return (
    <main className="app-shell">
      {!videoEditorActive && <TopBar />}
      <div className="route-content">
        <AppErrorBoundary key={location.pathname}>
          <Suspense fallback={<div className="blank-page" aria-busy="true">Carregando área…</div>}>
            <Routes>
              <Route path="/" element={<Navigate to="/customizar" replace />} />
              <Route path="/customizar" element={<LazyCustomizerPage />} />
              <Route path="/estudio" element={<LazyStudioPage />} />
              <Route path="/video-studio" element={<LazyVideoStudioPage onEditorActiveChange={setVideoEditorActive} />} />
              <Route path="/roteiros" element={<EmptyRoteirosPage />} />
              <Route path="/opcoes" element={<LazyOptionsPage />} />
              <Route path="/fabricador-dev" element={<LazyFabricatorPage />} />
              <Route path="*" element={<Navigate to="/customizar" replace />} />
            </Routes>
          </Suspense>
        </AppErrorBoundary>
      </div>
    </main>
  )
}
