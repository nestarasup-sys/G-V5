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

const verifier = loadTs('electron/videoOutputVerifier.ts', {
  './videoFfmpegCapabilities': { runVideoStudioProcess: async () => { throw new Error('not used in pure payload tests') } },
})

const expectedSilent = { width: 1920, height: 1080, frameRate: 60, durationFrames: 120, audio: false }
const expectedAudio = { ...expectedSilent, audio: true }

test('output probe validator accepts exact H264 1080p60 frame count without audio', () => {
  const result = verifier.verifyVideoStudioProbePayload({
    streams: [{
      codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080,
      r_frame_rate: '60/1', avg_frame_rate: '60/1', nb_read_frames: '120', duration: '2.000000',
    }],
    format: { duration: '2.000000', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
  }, expectedSilent)
  assert.deepEqual(result, {
    videoCodec: 'h264', audioCodec: null, width: 1920, height: 1080, frameRate: 60,
    decodedFrames: 120, durationSeconds: 2, audioSampleRate: null, audioChannels: null,
  })
})

test('output probe validator enforces AAC 48k and exact stream cardinality', () => {
  const result = verifier.verifyVideoStudioProbePayload({
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, r_frame_rate: '60/1', nb_read_frames: '120', duration: '2.000001' },
      { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2, duration: '2.000000' },
    ],
    format: { duration: '2.000001' },
  }, expectedAudio)
  assert.equal(result.audioCodec, 'aac')
  assert.equal(result.audioSampleRate, 48000)
  assert.equal(result.audioChannels, 2)

  assert.throws(() => verifier.verifyVideoStudioProbePayload({
    streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, r_frame_rate: '60/1', nb_read_frames: '120', duration: '2' }],
    format: { duration: '2' },
  }, expectedAudio), /stream de áudio/)

  assert.throws(() => verifier.verifyVideoStudioProbePayload({
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, r_frame_rate: '60/1', nb_read_frames: '120', duration: '2' },
      { codec_type: 'audio', codec_name: 'aac', sample_rate: '44100', channels: 2 },
    ],
    format: { duration: '2' },
  }, expectedAudio), /Sample rate/)
})

test('output probe validator rejects codec, frame-count, fps, resolution and duration mismatches', () => {
  const base = {
    codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080,
    r_frame_rate: '60/1', nb_read_frames: '120', duration: '2.000000',
  }
  const payload = (video) => ({ streams: [video], format: { duration: video.duration } })
  assert.throws(() => verifier.verifyVideoStudioProbePayload(payload({ ...base, codec_name: 'hevc' }), expectedSilent), /Codec/)
  assert.throws(() => verifier.verifyVideoStudioProbePayload(payload({ ...base, width: 1280 }), expectedSilent), /Resolução/)
  assert.throws(() => verifier.verifyVideoStudioProbePayload(payload({ ...base, r_frame_rate: '30000/1001' }), expectedSilent), /Frame rate/)
  assert.throws(() => verifier.verifyVideoStudioProbePayload(payload({ ...base, nb_read_frames: '119' }), expectedSilent), /Contagem/)
  assert.throws(() => verifier.verifyVideoStudioProbePayload(payload({ ...base, duration: '2.2' }), expectedSilent), /Duração/)
})
