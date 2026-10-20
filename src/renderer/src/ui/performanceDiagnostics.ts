/** Opt-in aggregate diagnostics: no user/project names, asset paths or content. */
type RouteStats = { commits:number; commitMs:number; worstCommitMs:number; longTasks:number; longTaskMs:number }
const routes = new Set(['/', '/customizar', '/estudio', '/video-studio', '/roteiros', '/base-videos', '/opcoes', '/fabricador-dev'])
const stats = new Map<string, RouteStats>()
const enabled = (() => { try { return typeof window !== 'undefined' && sessionStorage.getItem('gv5:perf') === '1' } catch { return false } })()
function entryFor(route: string): RouteStats {
  const key = routes.has(route) ? route : '(outra rota)'
  const existing = stats.get(key)
  if (existing) return existing
  const created = { commits:0, commitMs:0, worstCommitMs:0, longTasks:0, longTaskMs:0 }
  stats.set(key, created)
  return created
}
export function snapshotUiPerformance() {
  return [...stats].map(([route,s]) => ({
    route, commits:s.commits,
    meanCommitMs:s.commits ? +(s.commitMs / s.commits).toFixed(2) : 0,
    worstCommitMs:+s.worstCommitMs.toFixed(2),
    longTasks:s.longTasks, longTaskMs:+s.longTaskMs.toFixed(2)
  }))
}
export function recordUiCommit(route:string, _phase:string, duration:number):void {
  if (!enabled || !Number.isFinite(duration) || duration < 0) return
  const s = entryFor(route)
  s.commits++
  s.commitMs += duration
  s.worstCommitMs = Math.max(s.worstCommitMs, duration)
}
/** React Profiler measures commit/render work; Chromium longtasks approximate main-thread blocking. */
export function installUiPerformanceDiagnostics(): () => void {
  if (!enabled || typeof window === 'undefined') return () => undefined
  let observer: PerformanceObserver | undefined
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    observer = new PerformanceObserver(list => {
      for (const task of list.getEntries()) {
        const s = entryFor(window.location.pathname)
        s.longTasks++
        s.longTaskMs += task.duration
      }
    })
    observer.observe({ entryTypes: ['longtask'] })
  }
  const diagnosticWindow = window as Window & { __gv5PerformanceReport?: () => ReturnType<typeof snapshotUiPerformance> }
  diagnosticWindow.__gv5PerformanceReport = snapshotUiPerformance
  const print = () => console.table(snapshotUiPerformance())
  window.addEventListener('pagehide', print)
  return () => {
    observer?.disconnect()
    window.removeEventListener('pagehide', print)
    delete diagnosticWindow.__gv5PerformanceReport
  }
}
