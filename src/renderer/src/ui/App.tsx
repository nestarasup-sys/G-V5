import { lazy, Suspense, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { TopBar } from './components/TopBar'

const LazyCustomizerPage = lazy(async () => ({ default: (await import('../features/customizer/CustomizerPage')).CustomizerPage }))
const LazyStudioPage = lazy(async () => ({ default: (await import('../features/studio/StudioPage')).StudioPage }))
const LazyOptionsPage = lazy(async () => ({ default: (await import('../features/options/OptionsPage')).OptionsPage }))
const LazyFabricatorPage = lazy(async () => ({ default: (await import('../features/fabricator/FabricatorPage')).FabricatorPage }))

export function App() {
  const [saved, setSaved] = useState(true)

  return (
    <main className="app-shell">
      <TopBar saved={saved} onSave={() => setSaved(true)} />
      <div className="route-content">
        <Suspense fallback={<div className="blank-page" aria-busy="true" />}>
          <Routes>
            <Route path="/" element={<Navigate to="/customizar" replace />} />
            <Route path="/customizar" element={<LazyCustomizerPage />} />
            <Route path="/estudio" element={<LazyStudioPage />} />
            <Route path="/opcoes" element={<LazyOptionsPage />} />
            <Route path="/fabricador-dev" element={<LazyFabricatorPage />} />
            <Route path="*" element={<Navigate to="/customizar" replace />} />
          </Routes>
        </Suspense>
      </div>
    </main>
  )
}
