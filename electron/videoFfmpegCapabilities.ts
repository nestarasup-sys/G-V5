import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { assertCompatibleFfmpegBuild, videoStudioH264EncoderPreference, type VideoStudioH264Encoder } from './videoRawFrameWriter'

export type VideoStudioFfmpegCapabilities = Readonly<{
  executable: string
  versionLine: string
  buildConfiguration: string
  encoderList: string
  videoEncoder: VideoStudioH264Encoder
  audioEncoder: 'aac'
  smokeEncoded: true
}>

type ProcessResult = Readonly<{ code: number; stdout: string; stderr: string }>

function appendBounded(current: string, chunk: unknown, max = 256_000): string {
  return `${current}${String(chunk)}`.slice(-max)
}

export async function runVideoStudioProcess(
  executable: string,
  args: ReadonlyArray<string>,
  options: { input?: Buffer; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<ProcessResult> {
  if (!isAbsolute(executable)) throw new Error('O executável de mídia precisa usar caminho absoluto.')
  if (!args.every((arg) => typeof arg === 'string' && !arg.includes('\0'))) throw new Error('Argumentos de processo inválidos.')
  const timeoutMs = Math.max(1_000, Math.min(30 * 60_000, Math.round(options.timeoutMs ?? 15_000)))
  return await new Promise<ProcessResult>((resolvePromise, rejectPromise) => {
    let stdout = '', stderr = '', settled = false
    let terminationError: Error | null = null
    let killFallback: ReturnType<typeof setTimeout> | null = null
    let killWatchdog: ReturnType<typeof setTimeout> | null = null
    const child = spawn(executable, [...args], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (killFallback) clearTimeout(killFallback)
      if (killWatchdog) clearTimeout(killWatchdog)
      options.signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const terminate = (error: Error) => {
      if (settled || terminationError) return
      terminationError = error
      try { child.stdin.destroy() } catch { /* best effort */ }
      const forceKill = () => {
        if (process.platform === 'win32' && child.pid) {
          try {
            const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
              shell: false, windowsHide: true, stdio: 'ignore',
            })
            killer.unref()
          } catch {
            try { child.kill('SIGKILL') } catch { /* watchdog below */ }
          }
        } else {
          try { child.kill('SIGKILL') } catch { /* watchdog below */ }
        }
      }
      // Kill the whole Windows process tree immediately. Waiting until the
      // wrapper exits can orphan its real FFmpeg descendant and lose the tree.
      forceKill()
      killFallback = setTimeout(() => {
        if (!settled) forceKill()
      }, 2_000)
      killWatchdog = setTimeout(() => {
        finish(() => rejectPromise(new Error(`${error.message} Não foi possível confirmar o encerramento do processo de mídia (pid=${child.pid ?? 'desconhecido'}) em 8 segundos.`)))
      }, 8_000)
    }
    const onAbort = () => {
      const reason = options.signal?.reason
      terminate(reason instanceof Error ? reason : new Error('Processo de mídia cancelado.'))
    }
    const timer = setTimeout(() => terminate(new Error(`Processo de mídia excedeu ${timeoutMs} ms. ${stderr}`)), timeoutMs)
    if (options.signal?.aborted) { onAbort(); return }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.on('data', (chunk) => { stdout = appendBounded(stdout, chunk) })
    child.stderr.on('data', (chunk) => { stderr = appendBounded(stderr, chunk) })
    child.once('error', (error) => finish(() => rejectPromise(terminationError ?? error)))
    child.once('exit', (code, signal) => finish(() => {
      if (terminationError) { rejectPromise(terminationError); return }
      if (code === null) rejectPromise(new Error(`Processo de mídia terminou por sinal ${signal ?? 'desconhecido'}. ${stderr}`))
      else resolvePromise({ code, stdout, stderr })
    }))
    if (options.input) child.stdin.end(options.input)
    else child.stdin.end()
  })
}

function firstVersionLine(output: string): string {
  const line = output.split(/\r?\n/).map((value) => value.trim()).find(Boolean)
  if (!line || !/^ffmpeg version\b/i.test(line)) throw new Error('O executável selecionado não se identificou como FFmpeg.')
  return line.slice(0, 500)
}

function parseBuildConfiguration(output: string): string {
  const configuration = output.split(/\r?\n/).find((line) => /configuration:/i.test(line))
  return configuration?.slice(configuration.toLowerCase().indexOf('configuration:') + 'configuration:'.length).trim() ?? ''
}

function encoderAdvertised(encoderList: string, encoder: VideoStudioH264Encoder): boolean {
  return new RegExp(`\\b${encoder}\\b`, 'i').test(encoderList)
}

async function smokeH264Encoder(
  executable: string,
  encoder: VideoStudioH264Encoder,
  output: string,
  timeoutMs: number,
): Promise<{ ok: true } | { ok: false; diagnostic: string }> {
  const width = 64, height = 64, frameBytes = width * height * 4
  const pixels = Buffer.alloc(frameBytes * 2)
  pixels.fill(0, 0, frameBytes)
  pixels.fill(255, frameBytes)
  for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = 255
  const smoke = await runVideoStudioProcess(executable, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-f', 'rawvideo', '-pixel_format', 'bgra', '-video_size', `${width}x${height}`, '-framerate', '60', '-i', 'pipe:0',
    '-an', '-c:v', encoder, '-b:v', '1M', '-pix_fmt', 'yuv420p', '-frames:v', '2',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
    '-movflags', '+faststart', '-f', 'mp4', output,
  ], { input: pixels, timeoutMs })
  if (smoke.code !== 0) return { ok: false, diagnostic: smoke.stderr.slice(-4000) }
  const encoded = await stat(output).catch(() => null)
  if (!encoded?.isFile() || encoded.size < 128) return { ok: false, diagnostic: 'arquivo MP4 ausente ou pequeno' }
  const header = await readFile(output)
  if (!header.subarray(0, Math.min(header.length, 128)).includes(Buffer.from('ftyp'))) {
    return { ok: false, diagnostic: 'arquivo sem cabeçalho MP4' }
  }
  return { ok: true }
}

/** Probe the exact FFmpeg binary used by Video Studio and choose the first
 * advertised H.264 backend that completes a real encode on this machine.
 * Listing an encoder is insufficient because hardware/driver availability can
 * make it unusable at runtime.
 */
export async function probeVideoStudioFfmpeg(
  executable: string,
  options: { tempRoot?: string; timeoutMs?: number } = {},
): Promise<VideoStudioFfmpegCapabilities> {
  if (!isAbsolute(executable) || basename(executable).includes('\0')) throw new Error('Caminho do FFmpeg inválido.')
  const info = await stat(executable).catch(() => null)
  if (!info?.isFile()) throw new Error('FFmpeg não foi encontrado no caminho configurado.')

  const timeoutMs = options.timeoutMs ?? 15_000
  const version = await runVideoStudioProcess(executable, ['-hide_banner', '-version'], { timeoutMs })
  if (version.code !== 0) throw new Error(`FFmpeg não iniciou corretamente. ${version.stderr}`)
  const versionLine = firstVersionLine(version.stdout || version.stderr)

  const build = await runVideoStudioProcess(executable, ['-hide_banner', '-buildconf'], { timeoutMs })
  if (build.code !== 0) throw new Error(`Não foi possível ler a configuração do FFmpeg. ${build.stderr}`)
  const buildConfiguration = parseBuildConfiguration(`${build.stdout}\n${build.stderr}`)

  const encoders = await runVideoStudioProcess(executable, ['-hide_banner', '-encoders'], { timeoutMs })
  if (encoders.code !== 0) throw new Error(`Não foi possível listar os encoders do FFmpeg. ${encoders.stderr}`)
  const encoderList = `${encoders.stdout}\n${encoders.stderr}`
  assertCompatibleFfmpegBuild(buildConfiguration, encoderList)

  const root = resolve(options.tempRoot ?? tmpdir())
  const folder = await mkdtemp(join(root, 'gacha-video-ffmpeg-probe-'))
  const failures: string[] = []
  try {
    for (const encoder of videoStudioH264EncoderPreference) {
      if (!encoderAdvertised(encoderList, encoder)) continue
      const output = join(folder, `probe-${encoder}.mp4`)
      const result = await smokeH264Encoder(executable, encoder, output, timeoutMs)
      await rm(output, { force: true }).catch(() => undefined)
      if (result.ok) {
        return {
          executable,
          versionLine,
          buildConfiguration,
          encoderList,
          videoEncoder: encoder,
          audioEncoder: 'aac',
          smokeEncoded: true,
        }
      }
      failures.push(`${encoder}: ${result.diagnostic}`)
    }
    throw new Error(`Nenhum encoder H.264 disponível passou pelo encode real. ${failures.join(' | ')}`)
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Helper kept separate so packaging can persist a verified binary without copying private media. */
export async function writeVideoStudioFfmpegProbeReport(path: string, capability: VideoStudioFfmpegCapabilities): Promise<void> {
  if (!isAbsolute(path)) throw new Error('Relatório do FFmpeg precisa usar caminho absoluto.')
  const report = {
    schemaVersion: 1,
    executableName: basename(capability.executable),
    versionLine: capability.versionLine,
    videoEncoder: capability.videoEncoder,
    audioEncoder: capability.audioEncoder,
    smokeEncoded: capability.smokeEncoded,
  }
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'w' })
}
