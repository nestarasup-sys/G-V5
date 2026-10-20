'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
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
const characterAssetsSource = fsSync.readFileSync(path.join(__dirname, '../src/shared/videoCharacterRenderAssets.ts'), 'utf8')
const characterAssetsCompiled = ts.transpile(characterAssetsSource, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const loadedCharacterAssets = { exports: {} }
new Function('require', 'module', 'exports', characterAssetsCompiled)(require, loadedCharacterAssets, loadedCharacterAssets.exports)
const characterSnapshotSource = fsSync.readFileSync(path.join(__dirname, '../src/shared/videoExportCharacters.ts'), 'utf8')
const characterSnapshotCompiled = ts.transpile(characterSnapshotSource, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const loadedCharacterSnapshot = { exports: {} }
new Function('require', 'module', 'exports', characterSnapshotCompiled)((name) => {
  if (name === './videoExportSnapshot') return loadedSnapshot.exports
  return require(name)
}, loadedCharacterSnapshot, loadedCharacterSnapshot.exports)
const assetsSource = fsSync.readFileSync(path.join(__dirname, '../electron/videoExportAssets.ts'), 'utf8')
const assetsCompiled = ts.transpile(assetsSource, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const loadedAssets = { exports: {} }
new Function('require', 'module', 'exports', assetsCompiled)(require, loadedAssets, loadedAssets.exports)
new Function('require', 'module', 'exports', compiled)((name) => {
  if (name === './videoExportAssets') return loadedAssets.exports
  if (name === './videoExportSnapshotAssets') return loadedSnapshotAssets.exports
  if (name === '../src/shared/videoCharacterRenderAssets') return loadedCharacterAssets.exports
  if (name === '../src/shared/videoExportCharacters') return loadedCharacterSnapshot.exports
  if (name === '../src/shared/videoExportSnapshot') return loadedSnapshot.exports
  return require(name)
}, loaded, loaded.exports)
const { VideoExportJobStore } = loaded.exports
const { createVideoExportSnapshot } = loadedSnapshot.exports
const { prepareVideoExportSnapshot } = loadedSnapshotAssets.exports
const { createVideoCharacterRenderAssetSnapshot, createVideoCharacterRenderSnapshotProvider } = loadedCharacterAssets.exports

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
  await fs.writeFile(path.join(root, jobId, 'chunk-000002.mp4'), 'synthetic-chunk-two')
  await store.recordChunk(jobId, 2)
  const reopened = await store.reopen(jobId, parameters)
  assert.equal(reopened.manifest.schemaVersion, 2)
  assert.equal(reopened.nextChunkIndex, 1)
  assert.deepEqual(reopened.missingChunkIndexes, [1])
  assert.deepEqual(reopened.manifest.chunks.map((chunk) => chunk.index), [0, 2])
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

test('job pins and restores character supplier images independently from the live libraries', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-job-character-assets-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = new VideoExportJobStore(root)
  const source = syntheticStudio()
  const snapshot = createVideoExportSnapshot(source)
  const characterAssets = createVideoCharacterRenderAssetSnapshot([{
    method: 'loadFabricatorSlot', args: [1], value: {
      slot: 1, parts: [{ id: 'torso', dataUrl: source.videoTimeline.characterKeys[0].state.imageDataUrl }],
    },
  }])
  const expected = {
    studioId, snapshotSha256: hashSnapshot(snapshot), mediaSha256: [], durationFrames: 30,
    renderVariant: 'animated',
  }
  const manifest = await store.create({ jobId, ...parameters, ...expected, snapshot, characterAssets, renderVariant: expected.renderVariant })
  assert.equal(manifest.characterAssetsFile, 'character-assets.json')
  assert.match(manifest.characterAssetsSha256, /^[a-f0-9]{64}$/)
  assert.equal(manifest.characterAssetImageDependencies.length, 1)
  const serialized = await fs.readFile(path.join(root, jobId, 'character-assets.json'), 'utf8')
  assert.equal(serialized.includes('data:image/'), false)
  assert.equal((await fs.readdir(path.join(root, jobId, 'assets', 'images'))).length, 1, 'identical scene/character PNG bytes share one physical job blob')

  const restored = await store.readCharacterAssets(jobId)
  assert.equal(restored.entries[0].value.parts[0].dataUrl, source.videoTimeline.characterKeys[0].state.imageDataUrl)
  const offlineProvider = createVideoCharacterRenderSnapshotProvider(restored)
  assert.equal((await offlineProvider.loadFabricatorSlot(1)).parts[0].dataUrl, source.videoTimeline.characterKeys[0].state.imageDataUrl)
  await assert.rejects(offlineProvider.loadFabricatorPose(1, 9), /não capturada no snapshot/)
  source.videoTimeline.characterKeys[0].state.imageDataUrl = 'data:image/png;base64,CHANGED-AFTER-JOB'
  assert.equal((await store.reopen(jobId, { ...expected, characterAssetsSha256: manifest.characterAssetsSha256 })).characterAssets.entries[0].value.parts[0].dataUrl,
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4uoAAAAASUVORK5CYII=')
  await assert.rejects(store.reopen(jobId, { ...expected, characterAssetsSha256: 'f'.repeat(64) }), /assets de personagem mudaram/)
  await fs.appendFile(path.join(root, jobId, 'character-assets.json'), 'tampered')
  await assert.rejects(store.readCharacterAssets(jobId), /hash do manifesto/)
})

test('job refuses to write pinned images through an assets-directory link', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-job-image-link-'))
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-outside-image-link-'))
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }) })
  const store = new VideoExportJobStore(root)
  await store.create({ jobId, ...parameters })
  const jobFolder = path.join(root, jobId)
  const assetsFolder = path.join(jobFolder, 'assets')
  await fs.symlink(outside, assetsFolder, process.platform === 'win32' ? 'junction' : 'dir')
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4uoAAAAASUVORK5CYII=', 'base64')
  const image = {
    sha256: require('node:crypto').createHash('sha256').update(bytes).digest('hex'),
    mimeType: 'image/png', extension: 'png', sizeBytes: bytes.length, bytes,
  }
  await assert.rejects(store.pinSnapshotImage(jobFolder, image), /Pasta de assets pinados do job inválida/)
  assert.deepEqual(await fs.readdir(outside), [], 'no file was written outside the job')
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
  const duplicateDependency = { ...dependency, assetId: 'a1a82b6d-7bf1-44fc-9ff5-173f59f17bf1' }
  const resolveMedia = async () => ({ path: mediaPath, trustedRoot: sourceRoot })
  const store = new VideoExportJobStore(root, resolveMedia)
  const expected = { ...parameters, mediaSha256: [dependency.sha256], mediaDependencies: [dependency, duplicateDependency] }
  const manifest = await store.create({ jobId, ...expected })
  const pinnedPath = path.join(root, jobId, 'assets', dependency.sha256)
  assert.deepEqual(manifest.mediaDependencies.map((item) => item.filename), [`assets/${dependency.sha256}`, `assets/${dependency.sha256}`])
  assert.deepEqual(await fs.readdir(path.join(root, jobId, 'assets')), [dependency.sha256])
  assert.deepEqual(await fs.readFile(pinnedPath), mediaBytes)

  await fs.writeFile(mediaPath, 'source-changed-after-job')
  await store.verifyPinnedMedia(jobId)
  assert.equal((await store.reopen(jobId, expected)).nextChunkIndex, 0)

  await fs.writeFile(pinnedPath, 'tampered-pinned-media')
  await assert.rejects(store.verifyPinnedMedia(jobId), /ausente ou corrompida/)
  await assert.rejects(store.reopen(jobId, expected), /ausente ou corrompida/)
})

test('export jobs continue to reopen legacy assetId-addressed media files', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-job-legacy-media-'))
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-source-'))
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); await fs.rm(sourceRoot, { recursive: true, force: true }) })
  const mediaBytes = Buffer.from('synthetic-legacy-pinned-video')
  const mediaPath = path.join(sourceRoot, 'source.mp4')
  await fs.writeFile(mediaPath, mediaBytes)
  const dependency = {
    assetId: 'a1a82b6d-7bf1-44fc-9ff5-173f59f17bf0', extension: 'mp4', mimeType: 'video/mp4',
    sizeBytes: mediaBytes.length, sha256: require('node:crypto').createHash('sha256').update(mediaBytes).digest('hex'),
  }
  const store = new VideoExportJobStore(root, async () => ({ path: mediaPath, trustedRoot: sourceRoot }))
  const expected = { ...parameters, mediaSha256: [dependency.sha256], mediaDependencies: [dependency] }
  const created = await store.create({ jobId: otherJobId, ...expected })
  const jobFolder = path.join(root, otherJobId)
  const contentPath = path.join(jobFolder, 'assets', dependency.sha256)
  const legacyPath = path.join(jobFolder, 'assets', `${dependency.assetId}.mp4`)
  await fs.rename(contentPath, legacyPath)
  const legacyManifest = { ...created, mediaDependencies: [{ ...created.mediaDependencies[0], filename: `assets/${dependency.assetId}.mp4` }] }
  await fs.writeFile(path.join(jobFolder, 'manifest.json'), JSON.stringify(legacyManifest))

  await store.verifyPinnedMedia(otherJobId)
  assert.equal((await store.reopen(otherJobId, expected)).nextChunkIndex, 0)
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


test('recoverable job listing exposes only fully resumable verified checkpoints', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-job-recovery-list-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = new VideoExportJobStore(root)
  const snapshot = createVideoExportSnapshot(syntheticStudio())
  const characterAssets = createVideoCharacterRenderAssetSnapshot([])
  const characters = { schemaVersion: 1, characters: [] }
  const expected = {
    studioId,
    snapshotSha256: hashSnapshot(snapshot),
    mediaSha256: [],
    durationFrames: 30,
    renderVariant: 'static-characters',
  }
  await store.create({ jobId, ...expected, snapshot, characterAssets, characters, renderVariant: expected.renderVariant })

  let records = await store.listRecoverable()
  assert.equal(records.length, 1)
  assert.deepEqual({
    jobId: records[0].jobId,
    studioTitle: records[0].studioTitle,
    completedFrames: records[0].completedFrames,
    completedChunks: records[0].completedChunks,
    totalChunks: records[0].totalChunks,
  }, {
    jobId,
    studioTitle: 'synthetic export',
    completedFrames: 0,
    completedChunks: 0,
    totalChunks: 1,
  })

  await fs.writeFile(store.chunkOutputPath(jobId, 0), 'verified-recovery-chunk')
  await store.recordChunk(jobId, 0)
  records = await store.listRecoverable()
  assert.equal(records[0].completedFrames, 30)
  assert.equal(records[0].completedChunks, 1)

  await fs.appendFile(path.join(root, jobId, 'characters.json'), 'corrupt')
  assert.deepEqual(await store.listRecoverable(), [], 'corrupt snapshot jobs are never advertised as resumable')
})


test('v2 manifest serializes concurrent out-of-order chunk checkpoints without losing either worker result', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-job-parallel-checkpoint-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = new VideoExportJobStore(root)
  await store.create({ jobId, ...parameters })
  await fs.writeFile(store.chunkOutputPath(jobId, 1), 'worker-one')
  await fs.writeFile(store.chunkOutputPath(jobId, 2), 'worker-two')
  await Promise.all([store.recordChunk(jobId, 2), store.recordChunk(jobId, 1)])
  const reopened = await store.reopen(jobId, parameters)
  assert.deepEqual(reopened.manifest.chunks.map((chunk) => chunk.index), [1, 2])
  assert.deepEqual(reopened.missingChunkIndexes, [0])
  assert.equal(reopened.nextChunkIndex, 0)
})


test('recovery torture drops only corrupted chunks and preserves verified non-contiguous checkpoints', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-job-torture-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = new VideoExportJobStore(root)
  const snapshot = createVideoExportSnapshot({ ...syntheticStudio(), videoTimeline: { ...syntheticStudio().videoTimeline, durationFrames: 1201 } })
  const characterAssets = createVideoCharacterRenderAssetSnapshot([])
  const characters = { schemaVersion: 1, characters: [] }
  const expected = {
    studioId, snapshotSha256: hashSnapshot(snapshot), mediaSha256: [], durationFrames: 1201,
    renderVariant: 'static-characters',
  }
  await store.create({ jobId, ...expected, snapshot, characterAssets, characters, renderVariant: expected.renderVariant })
  for (const index of [0, 2]) {
    await fs.writeFile(store.chunkOutputPath(jobId, index), `verified-${index}`)
    await store.recordChunk(jobId, index)
  }
  await fs.appendFile(store.chunkOutputPath(jobId, 2), '-truncated-after-checkpoint')
  await fs.writeFile(store.finalOutputPath(jobId), 'partial-final-from-crash')

  const reopened = await store.reopen(jobId)
  assert.deepEqual(reopened.manifest.chunks.map((chunk) => chunk.index), [0], 'only damaged checkpoint is discarded')
  assert.deepEqual(reopened.missingChunkIndexes, [1, 2])
  assert.equal(reopened.nextChunkIndex, 1)
  assert.equal(await fs.readFile(store.finalOutputPath(jobId), 'utf8'), 'partial-final-from-crash', 'reopen never promotes or trusts a partial final')
  const recoverable = await store.listRecoverable()
  assert.equal(recoverable.length, 1)
  assert.equal(recoverable[0].completedChunks, 1)
  assert.equal(recoverable[0].completedFrames, 600)
})

test('recovery torture ignores orphan temp files and cleanup/discard is idempotent', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-job-orphan-temp-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = new VideoExportJobStore(root)
  const snapshot = createVideoExportSnapshot(syntheticStudio())
  const expected = { studioId, snapshotSha256: hashSnapshot(snapshot), mediaSha256: [], durationFrames: 30, renderVariant: 'static-characters' }
  await store.create({ jobId, ...expected, snapshot, characterAssets: createVideoCharacterRenderAssetSnapshot([]), characters: { schemaVersion: 1, characters: [] }, renderVariant: expected.renderVariant })
  await fs.writeFile(path.join(root, jobId, '.manifest-crash.tmp'), '{bad')
  await fs.writeFile(path.join(root, jobId, '.chunk-crash.tmp'), 'partial')
  assert.equal((await store.reopen(jobId)).nextChunkIndex, 0)
  assert.equal((await store.listRecoverable()).length, 1)
  await store.cleanup(jobId)
  await store.cleanup(jobId)
  await assert.rejects(fs.stat(path.join(root, jobId)), { code: 'ENOENT' })
})

test('recovery torture never advertises a corrupted manifest and leaves neighboring jobs intact', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-job-corrupt-manifest-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = new VideoExportJobStore(root)
  const snapshot = createVideoExportSnapshot(syntheticStudio())
  const expected = { studioId, snapshotSha256: hashSnapshot(snapshot), mediaSha256: [], durationFrames: 30, renderVariant: 'static-characters' }
  for (const id of [jobId, otherJobId]) await store.create({ jobId: id, ...expected, snapshot, characterAssets: createVideoCharacterRenderAssetSnapshot([]), characters: { schemaVersion: 1, characters: [] }, renderVariant: expected.renderVariant })
  await fs.writeFile(path.join(root, jobId, 'manifest.json'), '{ definitely-corrupt')
  const records = await store.listRecoverable()
  assert.deepEqual(records.map((record) => record.jobId), [otherJobId])
  await assert.rejects(store.reopen(jobId))
  assert.equal((await fs.stat(path.join(root, otherJobId))).isDirectory(), true)
})


test('corrupt manifests are omitted from recovery but can be discarded without escaping the jobs root', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-job-corrupt-manifest-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = new VideoExportJobStore(root)
  await store.create({ jobId, ...parameters })
  const folder = path.join(root, jobId)
  await fs.writeFile(path.join(folder, '.manifest-orphan.tmp'), '{"partial":')
  await fs.writeFile(path.join(folder, 'manifest.json'), '{"schemaVersion":2,"jobId":')

  assert.deepEqual(await store.listRecoverable(), [])
  await store.cancel(jobId)
  await assert.rejects(fs.stat(folder))
  assert.equal((await fs.stat(root)).isDirectory(), true)
})

test('cleanup still fails closed when a readable manifest claims a different job owner', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-job-owner-mismatch-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = new VideoExportJobStore(root)
  await store.create({ jobId, ...parameters })
  const folder = path.join(root, jobId)
  const manifestPath = path.join(folder, 'manifest.json')
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  manifest.jobId = otherJobId
  await fs.writeFile(manifestPath, JSON.stringify(manifest))

  await assert.rejects(store.cancel(jobId), /não é proprietário/)
  assert.equal((await fs.stat(folder)).isDirectory(), true)
})


test('recoverable listing keeps the newest 100 jobs when stale history exceeds the UI cap', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-job-recovery-cap-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = new VideoExportJobStore(root)
  const snapshot = createVideoExportSnapshot(syntheticStudio())
  const characterAssets = createVideoCharacterRenderAssetSnapshot([])
  const characters = { schemaVersion: 1, characters: [] }
  const expected = {
    studioId,
    snapshotSha256: hashSnapshot(snapshot),
    mediaSha256: [],
    durationFrames: 30,
    renderVariant: 'static-characters',
  }
  const ids = []
  for (let index = 0; index < 102; index += 1) {
    const id = randomUUID()
    ids.push(id)
    await store.create({ jobId: id, ...expected, snapshot, characterAssets, characters, renderVariant: expected.renderVariant })
    const when = new Date(Date.now() - (102 - index) * 1000)
    await fs.utimes(path.join(root, id), when, when)
  }
  const records = await store.listRecoverable()
  assert.equal(records.length, 100)
  assert.equal(records.some((record) => record.jobId === ids[0]), false)
  assert.equal(records.some((record) => record.jobId === ids[1]), false)
  assert.equal(records.some((record) => record.jobId === ids.at(-1)), true)
})
