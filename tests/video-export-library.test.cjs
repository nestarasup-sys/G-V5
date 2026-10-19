'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')

const sourcePath = path.join(__dirname, '../electron/videoExports.ts')
const compiled = ts.transpile(fsSync.readFileSync(sourcePath, 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const loaded = { exports: {} }
new Function('require', 'module', 'exports', compiled)(require, loaded, loaded.exports)
const { VideoExportLibrary } = loaded.exports

const projectId = '360d7ac8-27c8-4aab-b8be-2397e1c46a76'
const jobId = 'f3c40c08-5be8-476f-8132-4dafca4f3d57'
const exportId = '006e1fc0-24ea-43ac-8edb-33a46d95fc06'

test('export library publishes only job-owned output and retains it independently of project storage', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-export-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const library = new VideoExportLibrary(root)
  const job = path.join(library.jobRoot, jobId)
  await fs.mkdir(job, { recursive: true })
  const projectFolder = path.join(root, 'projects', 'video-studio', `studio-${projectId}`)
  await fs.mkdir(projectFolder, { recursive: true })
  await fs.writeFile(path.join(projectFolder, 'project.json'), '{}')
  await fs.writeFile(path.join(job, 'final.mp4'), Buffer.from('synthetic-validated-video-output'))
  const record = await library.finalize(jobId, {
    id: exportId, studioId: projectId, studioTitle: 'Fixture Synthetic', width: 1920, height: 1080,
    frameRate: 60, durationFrames: 120, videoCodec: 'h264', audioCodec: null
  })
  assert.equal(record.filename.includes('Fixture-Synthetic'), true)
  assert.equal(record.sizeBytes, Buffer.byteLength('synthetic-validated-video-output'))
  assert.match(record.sha256, /^[a-f0-9]{64}$/)
  await fs.rm(projectFolder, { recursive: true })
  const listed = await library.list()
  assert.equal(listed.length, 1)
  assert.equal(listed[0].available, true)
  assert.equal(listed[0].studioTitle, 'Fixture Synthetic')
  await library.delete(exportId)
  assert.deepEqual(await library.list(), [])
})

test('export library refuses path-like IDs and preserves a file whose recorded hash changed', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-export-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const library = new VideoExportLibrary(root)
  await assert.rejects(library.folder('../outside'), /inválido/)
  const job = path.join(library.jobRoot, jobId)
  await fs.mkdir(job, { recursive: true })
  await fs.writeFile(path.join(job, 'final.mp4'), Buffer.from('synthetic-output'))
  await library.finalize(jobId, {
    id: exportId, studioId: projectId, studioTitle: 'Fixture', width: 1920, height: 1080,
    frameRate: 60, durationFrames: 60, videoCodec: 'h264', audioCodec: null
  })
  const listed = await library.list()
  const output = path.join(library.exportRoot, projectId, listed[0].filename)
  await fs.appendFile(output, 'changed')
  await assert.rejects(library.delete(exportId), /alterado/)
  assert.equal((await fs.stat(output)).size > 0, true)
})
