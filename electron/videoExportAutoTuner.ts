import type { VideoStudioH264Encoder } from './videoRawFrameWriter'

export type VideoExportAutoTuneInput = Readonly<{
  pendingChunks: number
  durationFrames: number
  logicalCpuCount: number
  totalMemoryBytes: number
  freeMemoryBytes: number
  videoEncoder: VideoStudioH264Encoder
  /** Conservative count of visible elements, video clips and transition groups. */
  sceneComplexityUnits?: number
  overrideWorkers?: 1 | 2
}>

export type VideoExportAutoTuneDecision = Readonly<{
  workerCount: 1 | 2
  reason: string
}>

const GIB = 1024 ** 3

/** Conservative first-generation tuner. Correctness always has a serial path;
 * two workers are only promoted when the machine has enough parallel headroom.
 */
export function chooseVideoExportWorkerCount(input: VideoExportAutoTuneInput): VideoExportAutoTuneDecision {
  if (input.overrideWorkers) return { workerCount: input.overrideWorkers, reason: 'diagnostic override' }
  if (input.pendingChunks < 2) return { workerCount: 1, reason: 'single pending chunk' }
  if (input.durationFrames < 1200) return { workerCount: 1, reason: 'short project' }
  if ((input.sceneComplexityUnits ?? 0) >= 12) return { workerCount: 1, reason: 'complex scene memory guard' }
  if (input.logicalCpuCount < 6) return { workerCount: 1, reason: 'limited logical CPU headroom' }
  if (input.totalMemoryBytes < 8 * GIB || input.freeMemoryBytes < 2.5 * GIB) {
    return { workerCount: 1, reason: 'limited memory headroom' }
  }
  // Hardware encoders still consume CPU/GPU readback and two Chromium surfaces.
  // The real encode probe has already proven this backend works at least once.
  return { workerCount: 2, reason: `parallel headroom available with ${input.videoEncoder}` }
}

export function videoExportWorkerOverride(value: string | undefined): 1 | 2 | undefined {
  if (value === '1') return 1
  if (value === '2') return 2
  return undefined
}
