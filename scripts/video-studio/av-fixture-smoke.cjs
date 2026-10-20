'use strict'

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')

const ffmpeg = process.env.GACHA_FFMPEG_PATH
const ffprobe = process.env.GACHA_FFPROBE_PATH

function requireTool(value, label) {
  if (!value || !path.isAbsolute(value) || !fs.existsSync(value)) throw new Error(`${label} absoluto é obrigatório.`)
  return value
}

function run(executable, args, encoding = 'utf8') {
  return execFileSync(executable, args, { encoding, timeout: 240_000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
}

function loadTs(relativePath, deps = {}) {
  const source = fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8')
  const compiled = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
  const mod = { exports: {} }
  new Function('require','module','exports',compiled)((name) => name in deps ? deps[name] : require(name),mod,mod.exports)
  return mod.exports
}

function makeCfr(output, seconds, rate, tone = 440) {
  run(ffmpeg, [
    '-hide_banner','-loglevel','error','-y',
    '-f','lavfi','-i',`testsrc2=size=320x180:rate=${rate}:duration=${seconds}`,
    '-f','lavfi','-i',`sine=frequency=${tone}:sample_rate=48000:duration=${seconds}`,
    '-shortest','-c:v','mpeg4','-q:v','4','-pix_fmt','yuv420p',
    '-c:a','aac','-b:a','128k','-ar','48000','-ac','2',
    '-movflags','+faststart',output,
  ])
}

function makeVfr(output, seconds) {
  run(ffmpeg, [
    '-hide_banner','-loglevel','error','-y',
    '-f','lavfi','-i',`testsrc2=size=320x180:rate=60:duration=${seconds}`,
    '-f','lavfi','-i',`sine=frequency=880:sample_rate=48000:duration=${seconds}`,
    '-vf',`select='if(lt(t,${seconds / 2}),1,not(mod(n,2)))'`,
    '-fps_mode','vfr','-shortest',
    '-c:v','mpeg4','-q:v','4','-pix_fmt','yuv420p',
    '-c:a','aac','-b:a','128k','-ar','48000','-ac','2',
    '-movflags','+faststart',output,
  ])
}

async function main() {
  requireTool(ffmpeg,'GACHA_FFMPEG_PATH')
  requireTool(ffprobe,'GACHA_FFPROBE_PATH')
  const runner = loadTs('electron/videoFfmpegCapabilities.ts', {
    './videoRawFrameWriter': { assertCompatibleFfmpegBuild: () => undefined },
  })
  const mediaProbe = loadTs('electron/videoMediaProbe.ts', {
    './videoFfmpegCapabilities': runner,
  })

  const root = fs.mkdtempSync(path.join(os.tmpdir(),'gacha-v5-av-fixtures-'))
  const files = {
    five: path.join(root,'fixture-5s-60.mp4'),
    thirty: path.join(root,'fixture-30s-60.mp4'),
    fps24: path.join(root,'source-24.mp4'),
    fps2997: path.join(root,'source-2997.mp4'),
    fps60: path.join(root,'source-60.mp4'),
    vfr: path.join(root,'source-vfr.mp4'),
  }
  try {
    makeCfr(files.five,5,60,440)
    makeCfr(files.thirty,30,60,550)
    makeCfr(files.fps24,5,24,660)
    makeCfr(files.fps2997,5,'30000/1001',770)
    makeCfr(files.fps60,5,60,880)
    makeVfr(files.vfr,5)

    const results = {}
    for (const [name,file] of Object.entries(files)) results[name] = await mediaProbe.probeVideoMedia(ffprobe,file,{timeoutMs:60000})

    const near = (value, target, epsilon) => Math.abs(value-target) <= epsilon
    const rate = (r) => { const [n,d='1']=r.split('/').map(Number); return n/d }
    if (!near(results.five.durationSeconds,5,0.08) || results.five.audio?.sampleRate !== 48000 || results.five.video.variableFrameRate) {
      throw new Error(`Fixture 5s inválida: ${JSON.stringify(results.five)}`)
    }
    if (!near(results.thirty.durationSeconds,30,0.08) || results.thirty.audio?.sampleRate !== 48000 || results.thirty.video.variableFrameRate) {
      throw new Error(`Fixture 30s inválida: ${JSON.stringify(results.thirty)}`)
    }
    if (!near(rate(results.fps24.video.averageFrameRate),24,0.001)) throw new Error('Fonte 24 fps não foi preservada.')
    if (!near(rate(results.fps2997.video.averageFrameRate),30000/1001,0.001)) throw new Error('Fonte 29.97 fps não foi preservada.')
    if (!near(rate(results.fps60.video.averageFrameRate),60,0.001)) throw new Error('Fonte 60 fps não foi preservada.')
    if (!results.vfr.video.variableFrameRate) throw new Error(`Fonte VFR não foi detectada: ${JSON.stringify(results.vfr.video)}`)
    if (Object.values(results).some((result) => result.audio?.sampleRate !== 48000 || result.audio.channels !== 2)) {
      throw new Error('Uma fixture perdeu o contrato AAC/48k/stereo.')
    }

    console.log(JSON.stringify({
      ok:true,
      fixtures:Object.fromEntries(Object.entries(results).map(([name,result])=>[name,{
        durationSeconds:result.durationSeconds,
        averageFrameRate:result.video.averageFrameRate,
        realFrameRate:result.video.realFrameRate,
        variableFrameRate:result.video.variableFrameRate,
        timeBase:result.video.timeBase,
        audioSampleRate:result.audio?.sampleRate,
        audioChannels:result.audio?.channels,
      }]))
    },null,2))
  } finally {
    fs.rmSync(root,{recursive:true,force:true})
  }
}

main().catch((error)=>{
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode=1
})
