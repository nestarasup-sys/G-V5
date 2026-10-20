'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')

function loadTs(file, deps = {}) {
  const source = fsSync.readFileSync(path.join(__dirname, file), 'utf8')
  const compiled = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((name) => name in deps ? deps[name] : require(name), mod, mod.exports)
  return mod.exports
}

const { buildVideoExportMediaManifest, verifyVideoExportMediaManifest } = loadTs('../electron/videoExportAssets.ts')
const casModule = loadTs('../electron/videoCasShadow.ts')
const { VideoLibraryStore } = loadTs('../electron/videoLibrary.ts', { './videoCasShadow': casModule })
const studioId = '360d7ac8-27c8-4aab-b8be-2397e1c46a76'
const assetId = 'f3c40c08-5be8-476f-8132-4dafca4f3d57'
const asset = { id: assetId, name: 'synthetic.mp4', mimeType: 'video/mp4', extension: 'mp4', size: 20, durationFrames: 60 }

function syntheticStudio(assets = [asset]) {
  return { id: studioId, videoTimeline: {
    videoAssets: assets,
    videoClips: [
      { id: 'clip-a', assetId, startFrame: 0, endFrame: 8, sourceStartFrame: 0, sourceEndFrame: 8 },
      { id: 'clip-b', assetId, startFrame: 10, endFrame: 18, sourceStartFrame: 8, sourceEndFrame: 16 },
    ],
  } }
}

test('media manifest hashes only referenced project assets and deduplicates repeated clips', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-assets-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const mediaPath = path.join(root, `${assetId}.mp4`)
  const bytes = Buffer.from('synthetic-video-data')
  assert.equal(bytes.length, asset.size)
  await fs.writeFile(mediaPath, bytes)
  const resolveAsset = async () => ({ path: mediaPath, trustedRoot: root })

  const manifest = await buildVideoExportMediaManifest(syntheticStudio(), resolveAsset)
  assert.equal(manifest.length, 1)
  assert.deepEqual(manifest[0], {
    assetId, extension: 'mp4', mimeType: 'video/mp4', sizeBytes: asset.size,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  })
  assert.equal(JSON.stringify(manifest).includes(root), false)
  await verifyVideoExportMediaManifest(manifest, studioId, resolveAsset)
})

test('manifest rejects missing refs, path escapes and media changed after snapshot', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-assets-'))
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-outside-'))
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }) })
  const mediaPath = path.join(root, `${assetId}.mp4`)
  await fs.writeFile(mediaPath, 'synthetic-video-data')
  const resolveAsset = async () => ({ path: mediaPath, trustedRoot: root })
  const manifest = await buildVideoExportMediaManifest(syntheticStudio(), resolveAsset)

  const missing = syntheticStudio()
  missing.videoTimeline.videoAssets = []
  await assert.rejects(buildVideoExportMediaManifest(missing, resolveAsset), /não está anexado/)

  const escapedPath = path.join(outside, 'outside.mp4')
  await fs.writeFile(escapedPath, 'synthetic-video-data')
  await assert.rejects(buildVideoExportMediaManifest(syntheticStudio(), async () => ({ path: escapedPath, trustedRoot: root })), /fora da pasta autorizada/)

  await fs.writeFile(mediaPath, 'changed-video-bytexx')
  await assert.rejects(verifyVideoExportMediaManifest(manifest, studioId, resolveAsset), /mudou desde o snapshot/)
})

test('library resolves the persisted copy owned by the requested project', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gacha-video-library-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const projectRoot = path.join(root, `studio-${studioId}`)
  const videosRoot = path.join(projectRoot, 'videos')
  await fs.mkdir(videosRoot, { recursive: true })
  await fs.writeFile(path.join(projectRoot, 'studio.json'), JSON.stringify({
    id: studioId,
    videoTimeline: { videoAssets: [asset] },
  }))
  await fs.writeFile(path.join(videosRoot, `${assetId}.mp4`), 'synthetic-video-data')
  const library = new VideoLibraryStore(() => root)

  const resolved = await library.resolveProjectMediaDependency(studioId, assetId, asset)
  assert.equal(resolved.path, path.join(videosRoot, `${assetId}.mp4`))
  assert.equal(resolved.trustedRoot, videosRoot)
  await assert.rejects(library.resolveProjectMediaDependency('006e1fc0-24ea-43ac-8edb-33a46d95fc06', assetId, asset), /não corresponde/)
})
