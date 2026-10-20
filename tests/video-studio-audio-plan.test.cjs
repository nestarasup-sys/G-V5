'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const sourcePath = path.join(__dirname, '../src/shared/videoStudioAudioPlan.ts')
const audioSourcePath = path.join(__dirname, '../src/shared/videoAudio.ts')
const audioCompiled = ts.transpile(fs.readFileSync(audioSourcePath, 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const audioModule = { exports: {} }
new Function('require', 'module', 'exports', audioCompiled)(require, audioModule, audioModule.exports)
const compiled = ts.transpile(fs.readFileSync(sourcePath, 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const loaded = { exports: {} }
new Function('require', 'module', 'exports', compiled)((name) => name === './videoAudio' ? audioModule.exports : require(name), loaded, loaded.exports)
const { buildVideoStudioAudioPlan } = loaded.exports

function timeline(overrides = {}) {
  return {
    schemaVersion: 1, frameRate: 60, durationFrames: 1200, playheadFrame: 0, playing: false,
    characterKeys: [], textClips: [], saveMarkers: [],
    videoClips: [
      { id: 'clip-a', assetId: 'asset-a', startFrame: 60, endFrame: 660, sourceStartFrame: 120, sourceEndFrame: 720, audio: { volume: 0.5, muted: false } },
      { id: 'clip-b', assetId: 'asset-b', startFrame: 600, endFrame: 900, sourceStartFrame: 0, sourceEndFrame: 300, audio: { volume: 1, muted: false } }
    ],
    videoAudio: { volume: 0.8, muted: false },
    ...overrides
  }
}

test('V5 audio plan trims, delays, applies per-clip and master gain, and mixes AAC once', () => {
  const plan = buildVideoStudioAudioPlan(timeline(), new Map([
    ['asset-a', { path: 'C:/synthetic media/one.mp4', hasAudio: true }],
    ['asset-b', { path: 'C:/synthetic media/two.webm', hasAudio: true }]
  ]))
  assert.equal(plan.enabled, true)
  assert.equal(plan.sourceCount, 2)
  assert.deepEqual(plan.inputArgs.slice(0, 6), ['-ss', '2.000000', '-t', '10.000000', '-i', 'C:/synthetic media/one.mp4'])
  assert.match(plan.filterComplex, /volume=0\.400000,adelay=delays=1000:all=1/)
  assert.match(plan.filterComplex, /volume=0\.800000,adelay=delays=10000:all=1/)
  assert.match(plan.filterComplex, /amix=inputs=2/)
  assert.deepEqual(plan.outputArgs, ['-map', '[aout]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'])
  assert.equal(plan.filterComplex.includes('synthetic media'), false)
})

test('V5 audio plan respects muted state and treats silent video files as no audio input', () => {
  const allSilent = buildVideoStudioAudioPlan(timeline(), new Map([
    ['asset-a', { path: 'a.mp4', hasAudio: false }], ['asset-b', { path: 'b.mp4', hasAudio: false }]
  ]))
  assert.equal(allSilent.enabled, false)
  assert.deepEqual(allSilent.outputArgs, ['-an'])
  const muted = buildVideoStudioAudioPlan(timeline({ videoAudio: { volume: 1, muted: true } }), new Map())
  assert.equal(muted.sourceCount, 0)
  assert.deepEqual(muted.outputArgs, ['-an'])
  const clipMuted = buildVideoStudioAudioPlan(timeline({ videoClips: [{ ...timeline().videoClips[0], audio: { volume: 0, muted: true } }] }), new Map())
  assert.deepEqual(clipMuted.outputArgs, ['-an'])
})

test('V5 audio plan fails explicitly when an audible clip points to missing media', () => {
  assert.throws(() => buildVideoStudioAudioPlan(timeline(), new Map()), /não está disponível/)
})
