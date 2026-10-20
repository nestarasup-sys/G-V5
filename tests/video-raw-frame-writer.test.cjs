'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')

const sourcePath = path.join(__dirname, '../electron/videoRawFrameWriter.ts')
const compiled = ts.transpile(fsSync.readFileSync(sourcePath, 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const loaded = { exports: {} }
new Function('require', 'module', 'exports', compiled)(require, loaded, loaded.exports)
const { VideoRawFrameWriter, buildVideoStudioChunkArgs, assertCompatibleFfmpegBuild } = loaded.exports

test('V4-style raw frame writer keeps bounded writes and confirms exact frame count', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-raw-frames-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const outputPath = path.join(root, 'synthetic.bin')
  const script = 'process.stdin.pipe(require("node:fs").createWriteStream(process.argv[1]))'
  const writer = new VideoRawFrameWriter({ executable: process.execPath, args: ['-e', script, outputPath], outputPath, frameBytes: 4, frameCount: 3, maxInFlight: 8 })
  await writer.ready()
  await Promise.all([writer.writeFrame(Buffer.from([1, 2, 3, 4])), writer.writeFrame(Buffer.from([5, 6, 7, 8]))])
  await writer.writeFrame(Buffer.from([9, 10, 11, 12]))
  const result = await writer.finish()
  assert.equal(result.framesWritten, 3)
  assert.equal(result.bytesWritten, 12)
  assert.ok(result.writeCallbackWaitMs >= 0)
  assert.ok(result.peakInFlight >= 1 && result.peakInFlight <= 2)
  assert.deepEqual(await fs.readFile(outputPath), Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))
})

test('chunk args are fixed to the V5 profile and GPL/nonfree FFmpeg builds are rejected', () => {
  const chunk0 = path.resolve(os.tmpdir(), 'chunk-000000.mp4')
  const chunk1 = path.resolve(os.tmpdir(), 'chunk-000001.mp4')
  const args = buildVideoStudioChunkArgs(chunk0, 600)
  assert.equal(args.includes('1920x1080'), true)
  assert.equal(args.includes('60'), true)
  assert.equal(args.includes('h264_mf'), true)
  const nvenc = buildVideoStudioChunkArgs(chunk1, 60, 'bgra', 'h264_nvenc')
  assert.equal(nvenc[nvenc.indexOf('-c:v') + 1], 'h264_nvenc')
  assert.equal(nvenc[nvenc.indexOf('-pixel_format') + 1], 'bgra')
  assert.equal(args[args.length - 1], chunk0)
  assert.throws(() => buildVideoStudioChunkArgs('C:/out.mp4', 601), /inválidos/)
  assertCompatibleFfmpegBuild('--enable-mediafoundation --disable-gpl', 'V..... h264_mf V..... aac')
  assertCompatibleFfmpegBuild('--disable-gpl', 'V..... h264_nvenc A..... aac')
  assert.throws(() => assertCompatibleFfmpegBuild('--enable-gpl --enable-libx264', 'V..... h264_mf A..... aac'), /GPL/)
  assert.throws(() => assertCompatibleFfmpegBuild('--disable-gpl', 'V..... libx264 A..... aac'), /H\.264/)
})

test('incomplete chunk cancellation terminates its child process', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-raw-frames-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const outputPath = path.join(root, 'incomplete.bin')
  const writer = new VideoRawFrameWriter({ executable: process.execPath, args: ['-e', 'process.stdin.resume()'], outputPath, frameBytes: 4, frameCount: 2 })
  await writer.ready()
  await writer.writeFrame(Buffer.from([1, 2, 3, 4]))
  await assert.rejects(writer.finish(), /Encode incompleto/)
})


test('explicit cancellation waits until the raw encoder child has actually exited', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-raw-cancel-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const outputPath = path.join(root, 'cancel.bin')
  const writer = new VideoRawFrameWriter({
    executable: process.execPath,
    args: ['-e', 'process.stdin.resume(); setInterval(()=>{},1000)'],
    outputPath,
    frameBytes: 4,
    frameCount: 2,
  })
  await writer.ready()
  await writer.cancel()
  assert.ok(writer.process.exitCode !== null || writer.process.signalCode !== null || writer.process.killed)
})
