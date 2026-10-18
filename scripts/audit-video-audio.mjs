import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const asModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const audioUrl = asModule(compile(await readFile(new URL('../src/shared/videoAudio.ts', import.meta.url), 'utf8')))
const { videoAudioOutput, isValidVideoAudioSettings } = await import(audioUrl)
const playbackCode = compile(await readFile(new URL('../src/renderer/src/features/videoStudio/videoMediaPlayback.ts', import.meta.url), 'utf8')).replace("'../../../../shared/videoAudio'", JSON.stringify(audioUrl))
const { VideoMediaPlayback } = await import(asModule(playbackCode))
assert.deepEqual(videoAudioOutput(undefined, undefined, true), { volume: 1, muted: false })
assert.deepEqual(videoAudioOutput(undefined, undefined, false), { volume: 1, muted: true })
assert.deepEqual(videoAudioOutput({ volume: 0.5, muted: false }, { volume: 0.4, muted: false }, true), { volume: 0.2, muted: false })
assert.equal(videoAudioOutput({ volume: 0.5, muted: true }, undefined, true).muted, true)
assert.equal(videoAudioOutput(undefined, { volume: 0, muted: false }, true).muted, true)
assert.equal(videoAudioOutput(undefined, { volume: 1, muted: true }, true).muted, true)
for (const invalid of [null, {}, { volume: NaN, muted: false }, { volume: 1.1, muted: false }, { volume: -0.1, muted: false }, { volume: 1, muted: 'false' }]) assert.equal(isValidVideoAudioSettings(invalid), false)
assert.equal(isValidVideoAudioSettings(undefined), true)
assert.equal(isValidVideoAudioSettings({ volume: 0.25, muted: false }), true)

const clip = { id: 'clip', assetId: 'asset', startFrame: 120, endFrame: 720, sourceStartFrame: 60, sourceEndFrame: 660, audio: { volume: 0.4, muted: false } }
const state = { clip, frame: 300, playing: true, masterAudio: { volume: 0.5, muted: false } }
class Media {
  readyState = 4; duration = 20; currentTime = 0; paused = true; muted = true; volume = 1; calls = 0
  play = () => { this.calls += 1; this.paused = false; return Promise.resolve() }
  pause = () => { this.paused = true }
}
const errors = []
const media = new Media()
const playback = new VideoMediaPlayback(media, (message) => errors.push(message))
playback.update(state)
await Promise.resolve()
assert.equal(media.currentTime, 4, 'Audio and image start at the same trimmed source time')
assert.equal(media.volume, 0.2)
assert.equal(media.muted, false)
assert.equal(media.paused, false)
for (let index = 0; index < 60; index += 1) playback.update(state)
assert.equal(media.calls, 1, 'RAF updates must not create repeated playback requests')
playback.update({ ...state, playing: false, frame: 600 })
assert.equal(media.currentTime, 9)
assert.equal(media.paused, true)
assert.equal(media.muted, true)
playback.update({ ...state, clip: { ...clip, audio: { volume: 0.4, muted: true } } })
await Promise.resolve()
assert.equal(media.paused, false, 'Muting must keep the image playing')
assert.equal(media.muted, true)
playback.dispose()
assert.equal(media.paused, true)
assert.equal(media.muted, true)
assert.equal(errors.length, 0)

const endedMedia = new Media()
endedMedia.currentTime = 20
endedMedia.ended = true
const ended = new VideoMediaPlayback(endedMedia, assert.fail)
ended.update({ frame: 1199, playing: true, clip: { ...clip, startFrame: 0, endFrame: 1200, sourceStartFrame: 0, sourceEndFrame: 1200 } })
assert.equal(endedMedia.calls, 0, 'The end of a source must not replay its first sound')
assert.equal(endedMedia.muted, true)

let resolvePending
const delayedMedia = new Media()
delayedMedia.play = () => { delayedMedia.paused = false; return new Promise((resolve) => { resolvePending = resolve }) }
const delayed = new VideoMediaPlayback(delayedMedia, assert.fail)
delayed.update(state)
delayed.update({ ...state, playing: false })
resolvePending()
await Promise.resolve()
assert.equal(delayedMedia.paused, true, 'A pending play request must not leak sound after Pause')
assert.equal(delayedMedia.muted, true)

const rejectedMedia = new Media()
rejectedMedia.play = () => { rejectedMedia.calls += 1; return Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) }
const rejected = new VideoMediaPlayback(rejectedMedia, (message) => errors.push(message))
rejected.update(state)
await new Promise((resolve) => setTimeout(resolve, 0))
for (let index = 0; index < 60; index += 1) rejected.update(state)
assert.equal(rejectedMedia.calls, 1, 'Blocked playback must not retry on every frame')
assert.equal(errors.length, 1)
rejected.update({ ...state, playing: false })
rejected.update(state)
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(rejectedMedia.calls, 2, 'A new Play action can retry after a browser rejection')
console.log('Video audio audit passed: legacy defaults, gain/mute, validation, source sync, pause/dispose, pending playback, and blocked playback retries.')
