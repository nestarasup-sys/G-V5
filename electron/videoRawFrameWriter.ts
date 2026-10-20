import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { stat } from 'node:fs/promises'

export type VideoStudioH264Encoder = 'h264_mf' | 'h264_nvenc' | 'h264_qsv' | 'h264_amf'
export const videoStudioH264EncoderPreference: ReadonlyArray<VideoStudioH264Encoder> = ['h264_mf', 'h264_nvenc', 'h264_qsv', 'h264_amf']

export type RawFrameWriterResult = { code: 0; stderr: string; bytesWritten: number; framesWritten: number; writeCallbackWaitMs: number; peakInFlight: number }
export type RawFrameWriterOptions = {
  executable: string
  args: string[]
  outputPath: string
  frameBytes: number
  frameCount: number
  maxInFlight?: number
}

/**
 * Bounded raw BGRA pipe adapted from the V4 export writer. FFmpeg remains a
 * separate process; at most two frame buffers are awaiting stdin acknowledgments.
 */
export class VideoRawFrameWriter {
  private readonly process: ChildProcessWithoutNullStreams
  private readonly maxInFlight: number
  private readonly frameBytes: number
  private readonly frameCount: number
  private readonly outputPath: string
  private stderr = ''
  private inFlight = 0
  private framesWritten = 0
  private bytesWritten = 0
  private writeCallbackWaitMs = 0
  private peakInFlight = 0
  private fatalError: Error | null = null
  private ended = false
  private readonly waiters: Array<() => void> = []
  private readonly readyPromise: Promise<void>
  private readyResolve!: () => void
  private readyReject!: (error: Error) => void
  private readonly exitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  private readonly processClosedPromise: Promise<void>
  private processClosedResolve!: () => void
  private exitResolve!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void
  private exitReject!: (error: Error) => void

  constructor(options: RawFrameWriterOptions) {
    if (!isAbsolute(options.executable) || !isAbsolute(options.outputPath)) throw new Error('O encoder e a saída devem usar caminhos absolutos.')
    if (!Number.isSafeInteger(options.frameBytes) || options.frameBytes < 4 || !Number.isSafeInteger(options.frameCount) || options.frameCount < 1) throw new Error('Dimensões do job de encode inválidas.')
    if (options.args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) throw new Error('Argumentos de encode inválidos.')
    this.frameBytes = options.frameBytes
    this.frameCount = options.frameCount
    this.outputPath = options.outputPath
    this.maxInFlight = Math.max(1, Math.min(2, Math.floor(options.maxInFlight ?? 2)))
    this.readyPromise = new Promise<void>((resolvePromise, rejectPromise) => { this.readyResolve = resolvePromise; this.readyReject = rejectPromise })
    this.exitPromise = new Promise((resolvePromise, rejectPromise) => { this.exitResolve = resolvePromise; this.exitReject = rejectPromise })
    this.processClosedPromise = new Promise<void>((resolvePromise) => { this.processClosedResolve = resolvePromise })
    void this.exitPromise.catch(() => undefined)
    this.process = spawn(options.executable, options.args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.process.stdout.resume()
    this.process.once('spawn', () => this.readyResolve())
    this.process.stderr.on('data', (chunk) => { this.stderr = `${this.stderr}${String(chunk)}`.slice(-16_000) })
    this.process.once('error', (error) => { this.processClosedResolve(); this.fail(error) })
    this.process.once('exit', (code, signal) => {
      this.processClosedResolve()
      if (code === 0) this.exitResolve({ code, signal })
      else {
        const error = new Error(`O encoder falhou (${code ?? signal ?? 'desconhecido'}). ${this.stderr}`)
        this.exitReject(error)
        if (!this.ended) this.fail(error)
      }
      if (code !== 0 && code !== null) this.readyReject(new Error(`O encoder encerrou antes de iniciar (${code}).`))
      if (!this.ended && code === 0) this.fail(new Error('O encoder encerrou antes de receber todos os frames.'))
    })
  }

  async ready(): Promise<void> { await this.readyPromise; if (this.fatalError) throw this.fatalError }

  async writeFrame(frame: Buffer, options: { copy?: boolean } = {}): Promise<void> {
    await this.ready()
    if (this.ended || this.fatalError) throw this.fatalError ?? new Error('O encoder já foi encerrado.')
    if (frame.byteLength !== this.frameBytes) throw new Error(`Frame inválido: ${frame.byteLength} bytes; esperava ${this.frameBytes}.`)
    if (this.framesWritten + this.inFlight >= this.frameCount) throw new Error('O job já recebeu todos os frames esperados.')
    while (this.inFlight >= this.maxInFlight) {
      await new Promise<void>((resolveWait) => this.waiters.push(resolveWait))
      if (this.fatalError) throw this.fatalError
    }
    this.inFlight += 1
    this.peakInFlight = Math.max(this.peakInFlight, this.inFlight)
    const writeStarted = performance.now()
    // Generic callers keep copy=true. The export pipeline may opt out only for
    // immutable frame leases that remain alive until this awaited write callback.
    const ownedFrame = options.copy === false ? frame : Buffer.from(frame)
    await new Promise<void>((resolveWrite, rejectWrite) => {
      this.process.stdin.write(ownedFrame, (error) => {
        this.writeCallbackWaitMs += performance.now() - writeStarted
        this.inFlight = Math.max(0, this.inFlight - 1)
        if (!error) { this.framesWritten += 1; this.bytesWritten += ownedFrame.byteLength; resolveWrite() }
        else { this.fail(error); rejectWrite(error) }
        this.waiters.shift()?.()
      })
    })
  }

  async finish(): Promise<RawFrameWriterResult> {
    await this.ready()
    while (this.inFlight > 0) await new Promise<void>((resolveWait) => this.waiters.push(resolveWait))
    if (this.framesWritten !== this.frameCount) {
      const error = new Error(`Encode incompleto: ${this.framesWritten}/${this.frameCount} frames foram enviados.`)
      await this.cancel()
      throw error
    }
    this.ended = true
    this.process.stdin.end()
    const exit = await this.exitPromise
    if (exit.code !== 0) throw new Error(`O encoder terminou com código ${exit.code ?? exit.signal}. ${this.stderr}`)
    const output = await stat(this.outputPath)
    if (!output.isFile() || output.size < 1) throw new Error('O encoder não produziu um arquivo de saída válido.')
    return { code: 0, stderr: this.stderr, bytesWritten: this.bytesWritten, framesWritten: this.framesWritten, writeCallbackWaitMs: this.writeCallbackWaitMs, peakInFlight: this.peakInFlight }
  }

  async cancel(): Promise<void> {
    if (this.ended && (this.process.exitCode !== null || this.process.signalCode !== null)) return
    this.ended = true
    try { this.process.stdin.destroy() } catch { /* process may already be closed */ }
    try { this.process.kill('SIGKILL') } catch { /* best effort */ }
    this.fail(new Error('Exportação cancelada.'))
    const timeout = new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('FFmpeg não encerrou em até 5 segundos após o cancelamento.')), 5000)
      timer.unref?.()
    })
    await Promise.race([this.processClosedPromise, timeout])
  }

  private fail(error: Error): void {
    if (!this.fatalError) this.fatalError = error
    this.readyReject(error)
    this.exitReject(error)
    while (this.waiters.length) this.waiters.shift()?.()
  }
}

/** V4-style rawvideo input, adapted to a fixed V5 export profile and encoder. */
export function buildVideoStudioChunkArgs(outputPath: string, frameCount: number, pixelFormat: 'bgra' | 'rgba' = 'bgra', videoEncoder: VideoStudioH264Encoder = 'h264_mf'): string[] {
  if (!isAbsolute(outputPath) || !Number.isSafeInteger(frameCount) || frameCount < 1 || frameCount > 600 || !videoStudioH264EncoderPreference.includes(videoEncoder)) throw new Error('Parâmetros do chunk inválidos.')
  return [
    '-hide_banner', '-loglevel', 'warning', '-nostdin', '-y',
    '-f', 'rawvideo', '-pixel_format', pixelFormat, '-video_size', '1920x1080', '-framerate', '60', '-i', 'pipe:0',
    '-an', '-c:v', videoEncoder, '-b:v', '12M', '-pix_fmt', 'yuv420p', '-fps_mode', 'cfr', '-frames:v', String(frameCount),
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
    '-movflags', '+faststart', '-f', 'mp4', outputPath
  ]
}

/** Reject incompatible GPL/nonfree V4 binaries before they can be packaged/used. */
export function assertCompatibleFfmpegBuild(buildConfiguration: string, encoderList: string): void {
  const configuration = buildConfiguration.toLowerCase()
  if (configuration.includes('--enable-gpl') || configuration.includes('--enable-nonfree')) throw new Error('Este build FFmpeg usa componentes GPL ou nonfree e não pode ser distribuído com esta configuração do aplicativo.')
  if (!/\baac\b/i.test(encoderList)) throw new Error('O build FFmpeg precisa oferecer AAC para o perfil do Video Studio.')
  if (!videoStudioH264EncoderPreference.some((encoder) => new RegExp(`\\b${encoder}\\b`, 'i').test(encoderList))) {
    throw new Error('O build FFmpeg precisa oferecer ao menos um encoder H.264 compatível com o Video Studio.')
  }
}
