export type PreviewSeekTask = Readonly<{ targetSeconds: number; requestId: number }>

/**
 * Coalesces rapid preview seeks. Only the newest requested target is applied;
 * obsolete targets never reach the decoder once a newer request arrives.
 */
export class VideoPreviewSeekScheduler {
  private latest: PreviewSeekTask | null = null
  private scheduled = false
  private requestId = 0
  private disposed = false

  constructor(private readonly schedule: (callback: () => void) => void = (callback) => requestAnimationFrame(() => callback())) {}

  request(targetSeconds: number, apply: (task: PreviewSeekTask) => void): number {
    if (this.disposed || !Number.isFinite(targetSeconds) || targetSeconds < 0) return this.requestId
    const id = ++this.requestId
    this.latest = { targetSeconds, requestId: id }
    if (!this.scheduled) {
      this.scheduled = true
      this.schedule(() => {
        this.scheduled = false
        if (this.disposed) return
        const task = this.latest
        this.latest = null
        if (task) apply(task)
      })
    }
    return id
  }

  isCurrent(requestId: number): boolean {
    return !this.disposed && requestId === this.requestId
  }

  cancel(): void {
    this.requestId += 1
    this.latest = null
  }

  dispose(): void {
    this.disposed = true
    this.cancel()
  }
}
