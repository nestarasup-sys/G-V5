import { TopBar } from './components/TopBar'

export function App() {
  return (
    <main className="app-shell">
      <TopBar />
      <section className="workspace" aria-label="Área de trabalho" />
    </main>
  )
}
