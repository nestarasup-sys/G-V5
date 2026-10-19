'use strict'

// Developer-only capability smoke. Production must use an explicitly validated,
// redistributable FFmpeg path; this helper never resolves an executable from PATH.

const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')

function loadPureTs(relativePath) {
  const source = fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8')
  const compiled = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(require, mod, mod.exports)
  return mod.exports
}

function parseArguments(args) {
  const values = {}
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index]
    if (name !== '--ffmpeg' && name !== '--ffprobe') throw new Error(`Opção não reconhecida: ${name}`)
    const value = args[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Informe um caminho absoluto após ${name}.`)
    values[name.slice(2)] = value
    index += 1
  }
  if (!values.ffmpeg || !values.ffprobe || !path.isAbsolute(values.ffmpeg) || !path.isAbsolute(values.ffprobe)) {
    throw new Error('Uso: node scripts/video-studio/ffmpeg-local-smoke.cjs --ffmpeg <caminho-absoluto> --ffprobe <caminho-absoluto>')
  }
  return values
}

function run(executable, args, encoding = 'utf8') {
  return execFileSync(executable, args, { encoding, timeout: 120_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
}

async function main() {
  const { ffmpeg, ffprobe } = parseArguments(process.argv.slice(2))
  const rawWriter = loadPureTs('electron/videoRawFrameWriter.ts')
  const syntheticRaster = loadPureTs('electron/videoSyntheticRaster.ts')
  const version = run(ffmpeg, ['-version']).split(/\r?\n/, 1)[0]
  const buildConfiguration = run(ffmpeg, ['-buildconf'])
  const encoderList = run(ffmpeg, ['-hide_banner', '-encoders'])
  if (!/\bh264_mf\b/.test(encoderList)) throw new Error('Este FFmpeg não anuncia o encoder h264_mf usado pelo perfil sintético atual.')

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gacha-v5-ffmpeg-smoke-'))
  const outputPath = path.join(temporaryRoot, 'synthetic.mp4')
  try {
    const frameCount = 60
    const width = 1920
    const height = 1080
    const writer = new rawWriter.VideoRawFrameWriter({
      executable: ffmpeg,
      args: rawWriter.buildVideoStudioChunkArgs(outputPath, frameCount),
      outputPath,
      frameBytes: width * height * 4,
      frameCount,
    })
    await writer.ready()
    const generated = await syntheticRaster.feedSyntheticFrames({ startFrame: 0, endFrameExclusive: frameCount, width, height }, writer)
    const encoded = await writer.finish()
    const probe = JSON.parse(run(ffprobe, [
      '-v', 'error', '-count_frames', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height,r_frame_rate,nb_read_frames,duration', '-of', 'json', outputPath,
    ]))
    const stream = probe.streams?.[0]
    if (!stream || stream.codec_name !== 'h264' || stream.width !== width || stream.height !== height
      || stream.r_frame_rate !== '60/1' || Number(stream.nb_read_frames) !== frameCount) {
      throw new Error(`A saída não passou pela verificação H.264/1080p60/60 frames: ${JSON.stringify(probe)}`)
    }
    run(ffmpeg, ['-v', 'error', '-i', outputPath, '-f', 'null', '-'])
    const digest = createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex')
    console.log(JSON.stringify({
      mode: 'local synthetic smoke; not an app runtime or character-render parity test',
      ffmpegVersion: version,
      gplBuild: false,
      redistributionValidated: 'basic profile gate passed; final package/BOM review still required',
      encoder: 'h264_mf',
      width,
      height,
      frameRate: '60/1',
      frames: encoded.framesWritten,
      rawBytes: generated.bytes,
      mp4Bytes: fs.statSync(outputPath).size,
      sha256: digest,
      ffprobe: stream,
      fullDecode: 'passed',
    }, null, 2))
  } finally {
    try { fs.unlinkSync(outputPath) } catch { /* no output or already removed */ }
    try { fs.rmdirSync(temporaryRoot) } catch { /* preserve unexpected extra files for inspection */ }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
