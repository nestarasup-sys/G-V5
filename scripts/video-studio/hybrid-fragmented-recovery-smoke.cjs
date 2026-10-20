'use strict'

const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ffmpeg = process.env.GACHA_FFMPEG_PATH
const ffprobe = process.env.GACHA_FFPROBE_PATH

function run(executable, args, options = {}) {
  return execFileSync(executable, args, {
    encoding: 'utf8',
    timeout: options.timeout ?? 120000,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  })
}

async function waitForFile(file, minimumBytes, timeoutMs) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const info = await fs.promises.stat(file).catch(() => null)
    if (info?.isFile() && info.size >= minimumBytes) return info.size
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Arquivo fragmentado não atingiu ${minimumBytes} bytes dentro do timeout.`)
}

async function main() {
  if (!ffmpeg || !ffprobe || !path.isAbsolute(ffmpeg) || !path.isAbsolute(ffprobe)) {
    throw new Error('GACHA_FFMPEG_PATH e GACHA_FFPROBE_PATH absolutos são obrigatórios.')
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gv5-hybrid-recovery-'))
  const interrupted = path.join(root, 'interrupted.mp4')
  const recovered = path.join(root, 'recovered.mp4')
  let child
  try {
    child = spawn(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-re', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=60',
      '-an', '-c:v', 'h264_mf', '-b:v', '4M', '-pix_fmt', 'yuv420p',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
      '-movflags', '+hybrid_fragmented', '-f', 'mp4', interrupted,
    ], { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-12000) })
    const spawned = new Promise((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    await spawned
    const bytesBeforeKill = await waitForFile(interrupted, 256 * 1024, 30000)
    child.kill('SIGKILL')
    await new Promise((resolve) => child.once('exit', resolve))

    const interruptedProbe = JSON.parse(run(ffprobe, [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height,r_frame_rate',
      '-of', 'json', interrupted,
    ]))
    const interruptedStream = interruptedProbe.streams?.[0]
    if (!interruptedStream || interruptedStream.codec_name !== 'h264') {
      throw new Error(`MP4 interrompido não ficou legível após kill. stderr=${stderr}`)
    }

    run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', interrupted, '-map', '0:v:0', '-c:v', 'copy',
      '-movflags', '+faststart', '-f', 'mp4', recovered,
    ])
    const probe = JSON.parse(run(ffprobe, [
      '-v', 'error', '-count_frames', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height,r_frame_rate,nb_read_frames,duration',
      '-of', 'json', recovered,
    ]))
    const stream = probe.streams?.[0]
    const frames = Number(stream?.nb_read_frames)
    if (stream?.codec_name !== 'h264' || Number(stream.width) !== 640 || Number(stream.height) !== 360
      || stream.r_frame_rate !== '60/1' || !Number.isSafeInteger(frames) || frames < 10) {
      throw new Error(`MP4 recuperado inválido: ${JSON.stringify(stream)}`)
    }
    run(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-xerror', '-i', recovered,
      '-map', '0:v:0', '-f', 'null', '-',
    ])

    console.log(JSON.stringify({
      ok: true,
      bytesBeforeKill,
      interruptedReadable: true,
      recoveredBytes: fs.statSync(recovered).size,
      decodedFrames: frames,
      stream,
    }))
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGKILL') } catch {}
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
  }
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
