'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const ts = require('typescript')

function loadTypeScript(file) {
  const text = fs.readFileSync(path.resolve(__dirname, file), 'utf8')
  const transpiled = ts.transpile(text, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', transpiled)(require, mod, mod.exports)
  return mod.exports
}

const { renderSyntheticBgraFrame, feedSyntheticFrames } = loadTypeScript('../electron/videoSyntheticRaster.ts')
const { VideoRawFrameWriter } = loadTypeScript('../electron/videoRawFrameWriter.ts')
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')

test('synthetic absolute frame is reproducible in full-HD BGRA with opaque alpha', () => {
  const a = renderSyntheticBgraFrame(137, 1920, 1080)
  const b = renderSyntheticBgraFrame(137, 1920, 1080)
  const c = renderSyntheticBgraFrame(138, 1920, 1080)
  assert.equal(a.length, 1920 * 1080 * 4)
  assert.equal(a.length, 8_294_400)
  assert.equal(sha(a), sha(b))
  assert.notEqual(sha(a), sha(c))
  for (const pixel of [0, 19, 2000, 2_073_599]) assert.equal(a[pixel * 4 + 3], 255)
})

test('frame feeder uses half-open absolute ranges, writes in order, and reports exact bytes', async () => {
  const received = []
  const progress = []
  const source = { startFrame: 7, endFrameExclusive: 11, width: 16, height: 9 }
  const result = await feedSyntheticFrames(source, { async writeFrame(frame) { received.push(Buffer.from(frame)) } }, {
    onFrameWritten: (done, total) => progress.push([done, total])
  })
  assert.deepEqual(progress, [[1, 4], [2, 4], [3, 4], [4, 4]])
  assert.equal(result.frames, 4)
  assert.equal(result.bytes, 4 * 16 * 9 * 4)
  assert.deepEqual(received.map(sha), [7, 8, 9, 10].map((f) => sha(renderSyntheticBgraFrame(f, 16, 9))))
})

test('cancellation stops before the next frame and rejects invalid dimensions', async () => {
  let completed = 0
  await assert.rejects(
    feedSyntheticFrames({ startFrame: 0, endFrameExclusive: 6, width: 4, height: 4 }, {
      async writeFrame() { completed += 1 }
    }, { cancelled: () => completed === 2 }),
    /cancelada/
  )
  assert.equal(completed, 2)
  assert.throws(() => renderSyntheticBgraFrame(-1, 4, 4), RangeError)
  assert.throws(() => renderSyntheticBgraFrame(1, 0, 4), RangeError)
  await assert.rejects(feedSyntheticFrames({ startFrame: 5, endFrameExclusive: 5, width: 4, height: 4 }, { async writeFrame() {} }), RangeError)
})

test('single-worker synthetic BGRA frames reach the existing writer without reorder', async (t) => {
  const folder = await fsp.mkdtemp(path.join(os.tmpdir(), 'gacha-synthetic-bgra-'))
  t.after(() => fsp.rm(folder, { recursive: true, force: true }))
  const outputPath = path.join(folder, 'frame-bytes.bin')
  const script = 'process.stdin.pipe(require("node:fs").createWriteStream(process.argv[1]))'
  const source = { startFrame: 3, endFrameExclusive: 6, width: 8, height: 8 }
  const writer = new VideoRawFrameWriter({
    executable: process.execPath, args: ['-e', script, outputPath],
    outputPath, frameBytes: 8 * 8 * 4, frameCount: 3
  })
  const sent = await feedSyntheticFrames(source, writer)
  const closed = await writer.finish()
  const expected = Buffer.concat([3, 4, 5].map((frame) => renderSyntheticBgraFrame(frame, 8, 8)))
  assert.equal(sent.frames, 3)
  assert.equal(closed.framesWritten, 3)
  assert.equal(closed.bytesWritten, expected.length)
  assert.deepEqual(await fsp.readFile(outputPath), expected)
})
