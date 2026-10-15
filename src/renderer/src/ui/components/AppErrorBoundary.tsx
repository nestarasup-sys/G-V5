import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Falha ao renderizar o aplicativo:', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children

    return (
      <main className="app-recovery" role="alert">
        <section className="app-recovery-card">
          <h1>Não foi possível mostrar esta tela</h1>
          <p>O aplicativo encontrou um erro. Seus dados salvos continuam no disco.</p>
          <button type="button" onClick={() => window.location.reload()}>Reabrir aplicativo</button>
          <details>
            <summary>Detalhes do erro</summary>
            <pre>{this.state.error.message}</pre>
          </details>
        </section>
      </main>
    )
  }
}
