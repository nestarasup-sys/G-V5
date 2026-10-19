'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function loadTs(relativePath, deps = {}) {
  const source = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')
  const compiled = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((name) => name in deps ? deps[name] : require(name), mod, mod.exports)
  return mod.exports
}

const mediaProbe = loadTs('electron/videoMediaProbe.ts', {
  './videoFfmpegCapabilities': { runVideoStudioProcess: async () => { throw new Error('not used') } },
})

test('media probe parser keeps source timebase and flags VFR without converting ticks to frame indexes', () => {
  const result = mediaProbe.parseVideoMediaProbe(path.resolve('source.mp4'), {
    streams: [
      {
        codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080,
        time_base: '1/90000', avg_frame_rate: '30000/1001', r_frame_rate: '60/1',
        start_time: '-0.033367', duration: '10.010000',
      },
      {
        codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2,
        start_time: '0.000000', duration: '10.010000',
      },
    ],
    format: { duration: '10.010000' },
  })
  assert.equal(result.video.timeBase, '1/90000')
  assert.equal(result.video.averageFrameRate, '30000/1001')
  assert.equal(result.video.realFrameRate, '60/1')
  assert.equal(result.video.variableFrameRate, true)
  assert.equal(result.video.startTimeSeconds, -0.033367)
  assert.equal(result.audio.codec, 'aac')
  assert.equal(result.audio.sampleRate, 48000)
})

test('media probe parser accepts CFR and source without audio', () => {
  const result = mediaProbe.parseVideoMediaProbe(path.resolve('source.webm'), {
    streams: [{
      codec_type: 'video', codec_name: 'vp9', width: 1280, height: 720,
      time_base: '1/1000', avg_frame_rate: '25/1', r_frame_rate: '25/1', duration: '4.000000',
    }],
    format: { duration: '4.000000' },
  })
  assert.equal(result.video.variableFrameRate, false)
  assert.equal(result.audio, null)
  assert.equal(result.durationSeconds, 4)
})

test('media probe parser rejects ambiguous or incomplete streams', () => {
  const absolute = path.resolve('bad.mov')
  assert.throws(() => mediaProbe.parseVideoMediaProbe(absolute, { streams: [], format: { duration: '1' } }), /exatamente um stream de vídeo/)
  assert.throws(() => mediaProbe.parseVideoMediaProbe(absolute, {
    streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, time_base: '0/0', avg_frame_rate: '60/1', r_frame_rate: '60/1' }],
    format: { duration: '1' },
  }), /incompletos/)
  assert.throws(() => mediaProbe.parseVideoMediaProbe(absolute, {
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, time_base: '1/90000', avg_frame_rate: '60/1', r_frame_rate: '60/1' },
      { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 },
      { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 },
    ],
    format: { duration: '1' },
  }), /múltiplos streams de áudio/)
})
