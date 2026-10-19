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
const frameSource = fsSync.readFileSync(path.join(__dirname, '../src/shared/videoFrame.ts'), 'utf8')
const frameCompiled = ts.transpile(frameSource, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const loadedFrame = { exports: {} }
new Function('require', 'module', 'exports', frameCompiled)(require, loadedFrame, loadedFrame.exports)
const snapshotSource = fsSync.readFileSync(path.join(__dirname, '../src/shared/videoExportSnapshot.ts'), 'utf8')
const snapshotCompiled = ts.transpile(snapshotSource, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const loadedSnapshot = { exports: {} }
new Function('require', 'module', 'exports', snapshotCompiled)((name) => {
  if (name === './videoFrame') return loadedFrame.exports
  return require(name)
}, loadedSnapshot, loadedSnapshot.exports)
const snapshotAssetsSource = fsSync.readFileSync(path.join(__dirname, '../electron/videoExportSnapshotAssets.ts'), 'utf8')
const snapshotAssetsCompiled = ts.transpile(snapshotAssetsSource, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const loadedSnapshotAssets = { exports: {} }
new Function('require', 'module', 'exports', snapshotAssetsCompiled)((name) => {
  if (name === '../src/shared/videoExportSnapshot') return loadedSnapshot.exports
  return require(name)
}, loadedSnapshotAssets, loadedSnapshotAssets.exports)
const assetsSource = fsSync.readFileSync(path.join(__dirname, '../electron/videoExportAssets.ts'), 'utf8')
const assetsCompiled = ts.transpile(assetsSource, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const loadedAssets = { exports: {} }
new Function('require', 'module', 'exports', assetsCompiled)(require, loadedAssets, loadedAssets.exports)
new Function('require', 'module', 'exports', compiled)((name) => {
  if (name === './videoExportAssets') return loadedAssets.exports
  if (name === './videoExportSnapshotAssets') return loadedSnapshotAssets.exports
  if (name === '../src/shared/videoExportSnapshot') return loadedSnapshot.exports
  return require(name)
}, loaded, loaded.exports)
const { VideoExportJobStore } = loaded.exports
const { createVideoExportSnapshot } = loadedSnapshot.exports
const { prepareVideoExportSnapshot } = loadedSnapshotAssets.exports

const studioId = '360d7ac8-27c8-4aab-b8be-2397e1c46a76'
const jobId = 'f3c40c08-5be8-476f-8132-4dafca4f3d57'
const otherJobId = '006e1fc0-24ea-43ac-8edb-33a46d95fc06'
const snapshotSha256 = 'a'.repeat(64)
const mediaSha256 = ['b'.repeat(64), 'c'.repeat(64)]
const parameters = { studioId, snapshotSha256, mediaSha256, durationFrames: 1201 }

function syntheticStudio() {
  const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4uoAAAAASUVORK5CYII='
  const element = { id: 'synthetic-actor', kind: 'character', text: '', x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 1 }
  return {
    schemaVersion: 1, id: studioId, title: 'synthetic export', color: '#333333',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    backgroundColor: '#ffffff', backgroundAssetId: null, backgroundX: 0, backgroundY: 0,
    backgroundWidth: 1920, backgroundHeight: 1080, backgroundRotation: 0,
    thumbnailDataUrl: pngDataUrl,
    assets: [{ id: 'synthetic-image', category: 'background', name: 'synthetic', mimeType: 'image/png', dataUrl: pngDataUrl }],
    elements: [element],
    videoTimeline: {
      schemaVersion: 1, frameRate: 60, durationFrames: 30, playheadFrame: 12, playing: true,
      characterBases: { 'synthetic-actor': { element, imageDataUrl: pngDataUrl } }, coverDataUrl: pngDataUrl,
      characterKeys: [{ id: 'synthetic-key', elementId: 'synthetic-actor', frame: 0, poseSlot: null, expressionCollectionId: null, expressionPresetId: null, faceMode: 'idle', state: { element, imageDataUrl: pngDataUrl } }],
      textClips: [], characterGaps: [], videoClips: [], saveMarkers: [],
    },
  }
}

function hashSnapshot(snapshot) {
  return require('node:crypto').createHash('sha256').update(prepareVideoExportSnapshot(snapshot).serialized).digest('hex')
}

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
  await assert.rejects(store.reopen(jobId), /identidade externa/)
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

test('job persists and restores the immutable scene snapshot and render variant', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-job-snapshot-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = new VideoExportJobStore(root)
  const source = syntheticStudio()
  const snapshot = createVideoExportSnapshot(source)
  const serialized = prepareVideoExportSnapshot(snapshot).serialized
  const expected = {
    studioId, snapshotSha256: hashSnapshot(snapshot), mediaSha256: [], durationFrames: 30,
    renderVariant: 'static-characters',
  }
  const manifest = await store.create({ jobId, ...expected, snapshot, renderVariant: expected.renderVariant })
  assert.equal(manifest.snapshotFile, 'snapshot.json')
  assert.equal(manifest.renderVariant, 'static-characters')
  assert.equal(manifest.snapshotImageDependencies.length, 1)
  assert.equal(await fs.readdir(path.join(root, jobId, 'assets', 'images')).then((files) => files.length), 1)
  assert.equal((await fs.readFile(path.join(root, jobId, 'snapshot.json'), 'utf8')).includes('data:image/'), false)
  await assert.rejects(store.create({ jobId: otherJobId, ...expected, snapshot, snapshotSha256: 'f'.repeat(64), renderVariant: expected.renderVariant }), /não corresponde ao hash/)
  await assert.rejects(fs.stat(path.join(root, otherJobId)))
  source.title = 'edited after export was queued'

  const restored = await store.readSnapshot(jobId)
  assert.equal(prepareVideoExportSnapshot(restored).serialized, serialized)
  assert.equal(restored.studio.title, 'synthetic export')
  assert.equal(restored.studio.thumbnailDataUrl, undefined)
  assert.equal(restored.timeline.coverDataUrl, undefined)
  assert.equal(restored.studio.assets[0].dataUrl, source.videoTimeline.characterKeys[0].state.imageDataUrl)
  const reopened = await store.reopen(jobId, expected)
  assert.equal(reopened.nextChunkIndex, 0)
  assert.equal(prepareVideoExportSnapshot(reopened.snapshot).serialized, serialized)
  const recoveredAfterRestart = await store.reopen(jobId)
  assert.equal(recoveredAfterRestart.manifest.renderVariant, 'static-characters')
  assert.equal(prepareVideoExportSnapshot(recoveredAfterRestart.snapshot).serialized, serialized)
  await assert.rejects(store.reopen(jobId, { ...expected, renderVariant: 'animated' }), /modo ou o formato/)

  const imageFile = path.join(root, jobId, manifest.snapshotImageDependencies[0].filename)
  await fs.appendFile(imageFile, 'corrupt')
  await assert.rejects(store.readSnapshot(jobId), /inválida|corrompida/)
  await fs.writeFile(imageFile, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4uoAAAAASUVORK5CYII=', 'base64'))
  await fs.appendFile(path.join(root, jobId, 'snapshot.json'), 'tampered')
  await assert.rejects(store.readSnapshot(jobId), /hash do manifesto/)
  await assert.rejects(store.reopen(jobId, expected), /hash do manifesto/)
})

test('export jobs copy referenced media into their folder and resume from pinned bytes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-job-pin-'))
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-source-'))
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); await fs.rm(sourceRoot, { recursive: true, force: true }) })
  const mediaBytes = Buffer.from('synthetic-pinned-video')
  const mediaPath = path.join(sourceRoot, 'source.mp4')
  await fs.writeFile(mediaPath, mediaBytes)
  const dependency = {
    assetId: 'a1a82b6d-7bf1-44fc-9ff5-173f59f17bf0', extension: 'mp4', mimeType: 'video/mp4',
    sizeBytes: mediaBytes.length, sha256: require('node:crypto').createHash('sha256').update(mediaBytes).digest('hex'),
  }
  const resolveMedia = async () => ({ path: mediaPath, trustedRoot: sourceRoot })
  const store = new VideoExportJobStore(root, resolveMedia)
  const expected = { ...parameters, mediaSha256: [dependency.sha256], mediaDependencies: [dependency] }
  const manifest = await store.create({ jobId, ...expected })
  const pinnedPath = path.join(root, jobId, 'assets', `${dependency.assetId}.mp4`)
  assert.equal(manifest.mediaDependencies[0].filename, `assets/${dependency.assetId}.mp4`)
  assert.deepEqual(await fs.readFile(pinnedPath), mediaBytes)

  await fs.writeFile(mediaPath, 'source-changed-after-job')
  await store.verifyPinnedMedia(jobId)
  assert.equal((await store.reopen(jobId, expected)).nextChunkIndex, 0)

  await fs.writeFile(pinnedPath, 'tampered-pinned-media')
  await assert.rejects(store.verifyPinnedMedia(jobId), /ausente ou corrompida/)
  await assert.rejects(store.reopen(jobId, expected), /ausente ou corrompida/)
})

test('job creation rolls back its own folder when source media no longer matches the manifest', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-job-rollback-'))
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-source-'))
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); await fs.rm(sourceRoot, { recursive: true, force: true }) })
  const mediaPath = path.join(sourceRoot, 'source.mp4')
  await fs.writeFile(mediaPath, 'synthetic-source-bytes')
  const dependency = {
    assetId: 'a1a82b6d-7bf1-44fc-9ff5-173f59f17bf0', extension: 'mp4', mimeType: 'video/mp4',
    sizeBytes: Buffer.byteLength('synthetic-source-bytes'), sha256: 'd'.repeat(64),
  }
  const store = new VideoExportJobStore(root, async () => ({ path: mediaPath, trustedRoot: sourceRoot }))
  await assert.rejects(store.create({ jobId, ...parameters, mediaSha256: [dependency.sha256], mediaDependencies: [dependency] }), /mudou desde o snapshot/)
  await assert.rejects(fs.stat(path.join(root, jobId)), { code: 'ENOENT' })
})
