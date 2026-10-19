'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')

const sourcePath = path.join(__dirname, '../electron/videoExportJobs.ts')
const compiled = ts.transpile(fsSync.readFileSync(sourcePath, 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const loaded = { exports: {} }
new Function('require', 'module', 'exports', compiled)(require, loaded, loaded.exports)
const { VideoExportJobStore } = loaded.exports

const studioId = '360d7ac8-27c8-4aab-b8be-2397e1c46a76'
const jobId = 'f3c40c08-5be8-476f-8132-4dafca4f3d57'
const otherJobId = '006e1fc0-24ea-43ac-8edb-33a46d95fc06'
const snapshotSha256 = 'a'.repeat(64)
const mediaSha256 = ['b'.repeat(64), 'c'.repeat(64)]
const parameters = { studioId, snapshotSha256, mediaSha256, durationFrames: 1201 }

test('export job store checkpoints 600-frame chunks and resumes only matching snapshot and media', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-job-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = new VideoExportJobStore(root)
  const manifest = await store.create({ jobId, ...parameters })
  assert.equal(manifest.chunkFrames, 600)
  await fs.writeFile(path.join(root, jobId, 'chunk-000000.mp4'), 'synthetic-chunk-zero')
  const checkpoint = await store.recordChunk(jobId, 0)
  assert.deepEqual([checkpoint.chunks[0].startFrame, checkpoint.chunks[0].endFrame], [0, 600])
  await assert.rejects(store.recordChunk(jobId, 2), /em ordem/)
  const reopened = await store.reopen(jobId, parameters)
  assert.equal(reopened.nextChunkIndex, 1)
  assert.deepEqual([reopened.manifest.chunks[0].startFrame, reopened.manifest.chunks[0].endFrame], [0, 600])
  await assert.rejects(store.reopen(jobId, { ...parameters, snapshotSha256: 'd'.repeat(64) }), /mudou/)
  await assert.rejects(store.reopen(jobId, { ...parameters, mediaSha256: ['e'.repeat(64)] }), /mudou/)
})

test('resume drops a damaged checkpoint and cancellation removes only its own job', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-job-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = new VideoExportJobStore(root)
  await store.create({ jobId, ...parameters })
  await store.create({ jobId: otherJobId, ...parameters })
  const chunk = path.join(root, jobId, 'chunk-000000.mp4')
  await fs.writeFile(chunk, 'synthetic-chunk')
  await store.recordChunk(jobId, 0)
  await fs.appendFile(chunk, '-changed')
  const reopened = await store.reopen(jobId, parameters)
  assert.equal(reopened.nextChunkIndex, 0)
  assert.equal(reopened.manifest.chunks.length, 0)
  await store.cancel(jobId)
  await assert.rejects(fs.stat(path.join(root, jobId)))
  assert.equal((await fs.stat(path.join(root, otherJobId))).isDirectory(), true)
})
