import { performance } from 'node:perf_hooks'

/** No payloads, paths, IDs or names. Explicit opt-in: GV5_IPC_PERF=1. */
const enabled = process.env.GV5_IPC_PERF === '1'
type Metric = { calls: number; failures: number; totalMs: number; worstMs: number }
const metrics = new Map<string, Metric>()

export async function measureIpc<T>(label: string, action: () => Promise<T> | T): Promise<T> {
  if (!enabled) return action()
  const began = performance.now()
  let failed = false
  try { return await action() }
  catch (reason) { failed = true; throw reason }
  finally {
    const elapsed = performance.now() - began
    let metric = metrics.get(label)
    if (!metric) { metric = { calls: 0, failures: 0, totalMs: 0, worstMs: 0 }; metrics.set(label, metric) }
    metric.calls++
    if (failed) metric.failures++
    metric.totalMs += elapsed
    metric.worstMs = Math.max(metric.worstMs, elapsed)
  }
}

if (enabled) process.on('exit', () => {
  console.table([...metrics].map(([channel, m]) => ({
    channel, calls: m.calls, failures: m.failures,
    averageMs: +(m.totalMs / m.calls).toFixed(2), worstMs: +m.worstMs.toFixed(2)
  })))
})
