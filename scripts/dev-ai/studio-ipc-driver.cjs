'use strict'

const assert = require('node:assert/strict')
const { createHash, randomUUID } = require('node:crypto')
const { createServer, get } = require('node:http')
const { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } = require('node:fs')
const { mkdir, rm, writeFile } = require('node:fs/promises')
const { performance } = require('node:perf_hooks')
const os = require('node:os')
const { basename, dirname, join, relative, resolve, sep } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, nativeImage } = require('electron')
const { compareBitmaps, evaluateVisualComparison } = require('./visual-regression.cjs')
const { boundComponentBounds, compareBounds, expectedPoseDifference, headLocalBounds } = require('./raster-geometry.cjs')
const rasterFixture = require('./asset-flow-raster-fixture.cjs')
const assetUiAuthoring = require('./asset-ui-authoring.cjs')
const AF13_STUDIO_ID = 'af130001-7da4-4e28-9566-63dbf9401301'
const AF13_VIDEO_ID = 'af130001-7da4-4e28-9566-63dbf9401302'

const ROOT = resolve(__dirname, '../..')
const mode = process.argv[2]
const output = resolve(process.env.GACHA_DEV_AI_AUDIT_OUTPUT ?? process.env.GACHA_AUDIT_OUTPUT_DIR ?? '')
const sandbox = resolve(process.env.GACHA_DEV_AI_AUDIT_SANDBOX ?? process.env.GACHA_DEV_AI_SANDBOX ?? '')
let exitCode = 1
let allowNaturalQuit = false

function assertOutputSandbox() {
  if (process.env.GACHA_DEV_AI_PRIVATE_TEST === '1') {
    const privateRoot = resolve(process.env.GACHA_DEV_AI_PRIVATE_ROOT ?? '')
    const allowedRoot = resolve(process.env.GACHA_DEV_AI_PRIVATE_ALLOWED_ROOT ?? '')
    const markerPath = join(privateRoot, 'private-copy-marker.json')
    const relativePrivate = relative(allowedRoot, privateRoot)
    const relativeOutput = relative(privateRoot, output)
    const privateMarker = existsSync(markerPath) ? JSON.parse(readFileSync(markerPath, 'utf8')) : null
    const validChild = (root, path) => {
      const fromRoot = relative(root, path)
      return !!fromRoot && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`)
    }
    assert.ok(relativePrivate && validChild(allowedRoot, privateRoot), 'Cópia privada fora da pasta local autorizada')
    assert.equal(sandbox.toLowerCase(), join(privateRoot, 'userData').toLowerCase())
    assert.ok(relativeOutput.startsWith(`evidence${sep}`), 'Relatórios privados devem ficar na pasta evidence da cópia')
    assert.equal(privateMarker?.schemaVersion, 1)
    assert.equal(privateMarker?.privateDataCopy, true)
    assert.equal(privateMarker?.verifiedSha256, true)
    assert.ok(['baseline', 'wardrobe-reset'].includes(privateMarker?.copyMode))
    assert.equal(typeof privateMarker?.sourceBackup, 'string')
    for (const path of [allowedRoot, privateRoot, markerPath, sandbox, output,
      resolve(privateMarker.sourceBackup), join(resolve(privateMarker.sourceBackup), 'backup-manifest.json')]) {
      assert.ok(existsSync(path) && !lstatSync(path).isSymbolicLink(), `Path privado ausente ou ligado: ${path}`)
      assert.equal(realpathSync(path).toLowerCase(), path.toLowerCase(), `Path privado não canônico: ${path}`)
    }
    return
  }
  const runsRoot = resolve(ROOT, 'out', 'dev-ai', 'runs')
  const runRoot = dirname(sandbox)
  const relativeRun = relative(runsRoot, runRoot)
  const markerPath = join(runRoot, '.dev-ai-sandbox.json')
  assert.ok(relativeRun && relativeRun !== '..' && !relativeRun.startsWith(`..${sep}`) && !relativeRun.includes(sep))
  assert.equal(basename(sandbox), 'sandbox')
  assert.ok(existsSync(markerPath) && !lstatSync(markerPath).isSymbolicLink())
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
  assert.equal(marker.syntheticOnly, true)
  assert.equal(marker.runId, basename(runRoot))
  const relativeOutput = relative(runRoot, output)
  assert.ok(['sandbox', 'studio-ipc-real', 'studio-ipc-real-artifacts'].includes(relativeOutput),
    'Diretório da fase deve ser uma das pastas de execução autorizadas')
  assert.ok(!existsSync(output) || !lstatSync(output).isSymbolicLink())
}

function treeHash(folder) {
  const digest = createHash('sha256')
  if (!existsSync(folder)) return digest.update('<missing>').digest('hex')
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name)
      const relativePath = relative(folder, path).replaceAll('\\', '/')
      const stat = lstatSync(path)
      assert.equal(stat.isSymbolicLink(), false, `Symlink inesperado no sandbox: ${relativePath}`)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) digest.update(relativePath).update('\0').update(readFileSync(path)).update('\0')
      else assert.fail(`Tipo de arquivo inesperado: ${relativePath}`)
    }
  }
  visit(folder)
  return digest.digest('hex')
}

function stableData(value) {
  if (Array.isArray(value)) return value.map(stableData)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableData(value[key])]))
}

function screenshotPixels(buffer) {
  const image = nativeImage.createFromBuffer(buffer)
  const size = image.getSize()
  const bitmap = image.toBitmap()
  assert.equal(bitmap.length, size.width * size.height * 4, 'Bitmap inválido da captura')
  return { width: size.width, height: size.height, bitmap }
}

function screenshotComparison(beforePng, afterPng, policy = {}) {
  const before = screenshotPixels(beforePng)
  const after = screenshotPixels(afterPng)
  if (before.width !== after.width || before.height !== after.height) {
    return { metrics: { passed: false, reason: 'dimensions-changed',
      before: { width: before.width, height: before.height },
      after: { width: after.width, height: after.height } }, diffPng: null }
  }
  const compared = compareBitmaps(before.bitmap, after.bitmap, before.width, before.height, policy)
  const metrics = evaluateVisualComparison(compared, policy)
  const diffPng = nativeImage.createFromBitmap(compared.diffBitmap,
    { width: before.width, height: before.height }).toPNG()
  return { metrics: { ...metrics, width: before.width, height: before.height,
    channelTolerance: compared.channelTolerance }, diffPng }
}

async function captureSettled(window, label) {
  // DOM readiness is not compositor readiness. Fonts, two paint frames and
  // two visually stable captures are required; no fixed sleep alone is proof.
  let previous = null
  let lastComparison = null
  const maxAttempts = 12
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await window.webContents.executeJavaScript(`(async () => {
      await document.fonts.ready
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })()`)
    await new Promise(resolve => setTimeout(resolve, 120))
    const screenshot = (await window.webContents.capturePage()).toPNG()
    if (previous) {
      const probe = screenshotComparison(previous, screenshot,
        { channelTolerance: 2, maxChangedPixelRatio: 0.0002 })
      lastComparison = probe.metrics
      if (probe.metrics.passed) {
        return { png: screenshot, attempts: attempt, settled: true, temporalComparison: probe.metrics }
      }
    }
    previous = screenshot
  }
  // Preserve evidence. Caller decides failure; never promote unstable paint
  // to a passing visual assertion.
  return { png: previous, attempts: maxAttempts, settled: false,
    temporalComparison: lastComparison, label }
}

function summarizeSamples(values) {
  assert.ok(values.length > 0, 'Medição precisa conter amostras')
  const sorted = [...values].sort((a, b) => a - b)
  const at = fraction => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
  return { sampleCount: sorted.length, unit: 'ms', p50: at(0.5), p95: at(0.95), min: sorted[0], max: sorted.at(-1) }
}

function runtimeEnvironment() {
  return {
    platform: process.platform, arch: process.arch, osRelease: os.release(),
    cpu: os.cpus()[0]?.model ?? 'unknown', logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(), electron: process.versions.electron,
    chromium: process.versions.chrome, node: process.versions.node,
    gpu: 'not measured; hidden BrowserWindow software/GPU mode not controlled'
  }
}

function syntheticStudio(title, video = false) {
  const now = '2026-10-18T00:00:00.000Z'
  return {
    schemaVersion: 1,
    id: '1f50a2e4-7da4-4e28-9566-63dbf9403001',
    title,
    color: '#7768c8',
    createdAt: now,
    updatedAt: now,
    backgroundColor: '#d7b5cd',
    backgroundAssetId: null,
    backgroundX: 0,
    backgroundY: 0,
    backgroundWidth: 100,
    backgroundHeight: 100,
    backgroundRotation: 0,
    assets: [],
    elements: [],
    ...(video ? { videoTimeline: {
      schemaVersion: 1, frameRate: 60, durationFrames: 600, playheadFrame: 0,
      playing: false, characterKeys: [], textClips: [], saveMarkers: []
    } } : {})
  }
}

async function waitForWindow() {
  const started = Date.now()
  while (Date.now() - started < 30_000) {
    const window = BrowserWindow.getAllWindows()[0]
    if (window && !window.isDestroyed()) {
      try {
        const ready = await window.webContents.executeJavaScript("Boolean(window.desktop && typeof window.desktop.listStudios === 'function' && typeof window.desktop.listVideoStudios === 'function')")
        if (ready) return window
      } catch { /* wait for real preload and document */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('A janela real do G-V5/preload não ficou pronta.')
}

async function rejectPromise(expression, label) {
  const rejected = await expression
  assert.equal(rejected, true, `IPC deveria rejeitar: ${label}`)
}

async function rejectedError(expression) {
  return expression.then(() => null, (error) => String(error?.message ?? error))
}

async function verifyRasterAssetFlow(window) {
  const fixture = rasterFixture.manifest(nativeImage)
  const api = expression => window.webContents.executeJavaScript(expression)
  const userData = app.getPath('userData')
  assert.equal(relative(sandbox, userData).startsWith('..'), false,
    'A fixture raster só pode ser criada dentro da sandbox DEV AI')
  const modelPath = join(userData, 'fabricator', 'models', 'slot-9')
  assert.equal(existsSync(modelPath), false, 'A fixture não pode sobrescrever um modelo no slot 9')
  await mkdir(modelPath, { recursive: true })
  await writeFile(join(modelPath, rasterFixture.SOURCE_NAME), fixture.sourceBytes)
  const sourceBefore = createHash('sha256').update(readFileSync(join(modelPath, rasterFixture.SOURCE_NAME))).digest('hex')
  assert.equal(sourceBefore, fixture.sourceHash)
  const modelAssets = Object.entries(fixture.assets).map(([id, image]) => ({ id, dataUrl: image.dataUrl }))
  await api(`window.desktop.saveFabricatorProject(${JSON.stringify(fixture.model)},${JSON.stringify(modelAssets)})`)
  const restoredModel = await api('window.desktop.loadFabricatorSlot(9)')
  assert.equal(restoredModel?.parts.length, 10)
  assert.equal(restoredModel.parts[0].sourceTransform.x, rasterFixture.FRAMES[0].x)
  assert.equal(restoredModel.parts[0].sourceTransform.width, rasterFixture.FRAMES[0].width)
  assert.equal(restoredModel.parts[9].id, 'leg-right')
  assert.ok(restoredModel.parts.every(p => p.dataUrl?.startsWith('data:image/png;base64,')))
  assert.equal(createHash('sha256').update(readFileSync(join(modelPath, rasterFixture.SOURCE_NAME))).digest('hex'),
    sourceBefore, 'Saving the assembled model changed the source sheet')
  for (const slot of [1,2]) {
    const pose = slot === 1 ? fixture.pose1 : fixture.pose2
    await api(`window.desktop.saveFabricatorPose(9,${slot},${JSON.stringify(pose)},${JSON.stringify(modelAssets)})`)
    const restored = await api(`window.desktop.loadFabricatorPose(9,${slot})`)
    assert.equal(restored?.parts.length,10)
    assert.equal(restored.sourceModelSlot,9)
    assert.ok(restored.parts.every(p=>p.dataUrl?.startsWith('data:image/png;base64,')))
    assert.equal(restored.parts[0].sourceTransform.x,fixture.pose1.parts[0].sourceTransform.x)
    if(slot===2)assert.notEqual(restored.parts[0].x,fixture.pose1.parts[0].x)
  }
  const setAssets = [
    { id: 'shirt', dataUrl: fixture.shirt.dataUrl },
    { id: 'shoe-left', dataUrl: fixture.shoe.dataUrl },
    { id: 'glasses', dataUrl: fixture.glasses.dataUrl }
  ]
  await api(`window.desktop.saveWardrobeSet(9,${JSON.stringify(fixture.set)},${JSON.stringify(setAssets)})`)
  const restoredSet = await api(`window.desktop.loadWardrobeSet(9,${JSON.stringify(rasterFixture.SET_ID)})`)
  assert.equal(restoredSet?.components.length, 3)
  assert.equal(restoredSet.components.find(c=>c.id==='shoe-left').binding.boneId, 'leg-left')
  assert.equal(restoredSet.components.find(c=>c.id==='shoe-left').binding.version, 1)
  assert.equal(restoredSet.components.find(c=>c.id==='glasses').renderAboveHair, true)
  assert.ok(restoredSet.components.every(c=>c.dataUrl?.startsWith('data:image/png;base64,')))
  await api(`window.desktop.saveHairStyle(9,${JSON.stringify(fixture.hairStyle)},
    ${JSON.stringify([{ id:'front',dataUrl:fixture.frontHair.dataUrl },{ id:'back',dataUrl:fixture.backHair.dataUrl }])})`)
  const loadedHair=await api(`window.desktop.loadHairStyle(9,${JSON.stringify(rasterFixture.HAIR_ID)})`)
  assert.equal(loadedHair?.id,rasterFixture.HAIR_ID)
  assert.ok(loadedHair.front?.dataUrl?.startsWith('data:image/png;base64,'))
  assert.ok(loadedHair.back?.dataUrl?.startsWith('data:image/png;base64,'))
  assert.equal(loadedHair.transforms.front.x,fixture.hairStyle.transforms.front.x)
  assert.equal(loadedHair.transforms.front.scaleX,fixture.hairStyle.transforms.front.scaleX)
  await api(`window.desktop.saveFaceComponentAsset(9,${JSON.stringify(fixture.extraAsset)},
    ${JSON.stringify(fixture.headExtra.dataUrl)})`)
  const loadedExtra=await api(`window.desktop.loadFaceComponentAsset(9,${JSON.stringify(rasterFixture.EXTRA_ID)})`)
  assert.equal(loadedExtra?.kind,'head-extra')
  assert.ok(loadedExtra.dataUrl?.startsWith('data:image/png;base64,'))
  assert.deepEqual(loadedExtra.defaultTransform,fixture.extraAsset.defaultTransform)
  for (const face of fixture.faceItems) {
    await api(`window.desktop.saveFaceCatalogItem(9,${JSON.stringify(face.item)},${JSON.stringify(face.assets)})`)
    const restored=await api(`window.desktop.loadFaceCatalogItem(9,${JSON.stringify(face.item.id)})`)
    assert.equal(restored?.category,face.item.category)
    assert.equal(restored?.pieces.length,face.item.pieces.length)
  }
  const afterHair=treeHash(join(userData,'fabricator','hair','model-9'))
  const afterFace=treeHash(join(userData,'fabricator','face-components','model-9'))
  const afterModel = treeHash(join(userData,'fabricator','models','slot-9'))
  const afterPoses = treeHash(join(userData,'fabricator','poses','model-9'))
  const afterWardrobe = treeHash(join(userData,'fabricator','wardrobe','model-9'))
  const modelBeforeNegative = treeHash(join(userData,'fabricator','models','slot-9'))
  await rejectPromise(api(`window.desktop.saveWardrobeSet(9,${JSON.stringify({...fixture.set,id:'../../escape'})},${JSON.stringify(setAssets)}).then(()=>false,()=>true)`),
    'Wardrobe set path traversal')
  assert.equal(treeHash(join(userData,'fabricator','models','slot-9')),modelBeforeNegative)
  assert.equal(treeHash(join(userData,'fabricator','wardrobe','model-9')),afterWardrobe)
  const fixtureDir = join(output,'raster-asset-flow')
  await mkdir(fixtureDir,{recursive:true})
  await writeFile(join(fixtureDir,'source-sheet.png'),fixture.sourceBytes)
  await writeFile(join(fixtureDir,'shoe-left.png'),fixture.shoe.bytes)
  await writeFile(join(fixtureDir,'glasses.png'),fixture.glasses.bytes)
  await writeFile(join(fixtureDir,'hair-front.png'),fixture.frontHair.bytes)
  await writeFile(join(fixtureDir,'head-extra.png'),fixture.headExtra.bytes)
  const evidence={schemaVersion:1,adapter:'production-preload-real-ipc',status:'passed',
    syntheticOnly:true,modelSlot:9,sourceReference:'wardrobe-v2-1122x1402',
    modelParts:10,poseSlots:[1,2],wardrobeComponents:3,
    sourceSheetSha256:sourceBefore,assembledModelTreeSha256:afterModel,
    poseTreeSha256:afterPoses,wardrobeTreeSha256:afterWardrobe,
    hairTreeSha256:afterHair,faceExtrasTreeSha256:afterFace,
    savedHeadLocalTransforms:{hair:fixture.hairStyle.transforms.front,extra:fixture.extraAsset.defaultTransform},
    garmentBindings:{shirt:'torso',shoeLeft:'leg-left',glasses:'head'},hairStyles:1,headExtraAssets:1,
    faceCatalogCategories:fixture.faceItems.map(face=>face.item.category),
    sourceUnchangedAfterSaving:true,posePartIdsStable:true,legacyDataTouched:false,
    renderingCoverage:'fixture PNG raster persisted and decoded by Electron IPC; NOT full Customizer/Studio golden image'}
  await writeFile(join(fixtureDir,'report.json'),JSON.stringify(evidence,null,2))
  return evidence
}

async function seed(window) {
  const api = (expression) => window.webContents.executeJavaScript(expression)
  const normalFolder = await api('window.desktop.getStudioFolder()')
  const videoFolder = await api('window.desktop.getVideoStudioFolder()')
  const userData = app.getPath('userData')
  const withinData = (path) => {
    const rel = relative(userData, resolve(path))
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !require('node:path').isAbsolute(rel)
  }
  assert.ok(normalFolder.startsWith(join(userData, 'studios')))
  assert.ok(videoFolder.startsWith(join(userData, 'studios')))
  assert.notEqual(normalFolder, videoFolder)
  assert.ok(normalFolder.startsWith(sandbox) && videoFolder.startsWith(sandbox))
  assert.equal(withinData(normalFolder), true)
  assert.equal(withinData(videoFolder), true)
  await api('window.desktop.listStudios()')
  await api('window.desktop.listVideoStudios()')

  const normalPath = join(normalFolder, 'studio-1f50a2e4-7da4-4e28-9566-63dbf9403001')
  const videoPath = join(videoFolder, 'studio-1f50a2e4-7da4-4e28-9566-63dbf9403001')
  const outsideSentinel = join(sandbox, 'outside-studio-sentinel.txt')
  await writeFile(outsideSentinel, 'must remain byte-identical')
  const outsideBefore = readFileSync(outsideSentinel)
  let normalMutations = 0
  let videoMutations = 0
  for (let index = 0; index < 10; index += 1) {
    const videoBefore = treeHash(videoFolder)
    const document = syntheticStudio(`IPC normal ${index + 1}`)
    await api(`window.desktop.saveStudio(${JSON.stringify(document)})`)
    normalMutations += 1
    assert.equal(treeHash(videoFolder), videoBefore, `Salvamento normal ${index + 1} alterou Video Studio`)
    const stored = JSON.parse(readFileSync(join(normalPath, 'studio.json'), 'utf8'))
    assert.equal(stored.title, document.title)
    assert.equal((await api('window.desktop.listStudios()')).length, 1)

    const normalBefore = treeHash(normalFolder)
    const videoDocument = syntheticStudio(`IPC vídeo ${index + 1}`, true)
    await api(`window.desktop.saveVideoStudio(${JSON.stringify(videoDocument)})`)
    videoMutations += 1
    assert.equal(treeHash(normalFolder), normalBefore, `Salvamento de vídeo ${index + 1} alterou Studio normal`)
    const videoStored = JSON.parse(readFileSync(join(videoPath, 'studio.json'), 'utf8'))
    assert.equal(videoStored.title, videoDocument.title)
    assert.equal((await api('window.desktop.listVideoStudios()')).length, 1)
  }

  const measuredSaveCount = 20
  const saveLatency = { studio: [], videoStudio: [] }
  for (let index = 0; index < measuredSaveCount; index += 1) {
    const videoBeforeNormalSave = treeHash(videoFolder)
    const normalDocument = syntheticStudio(`Measured normal save ${index + 1}`)
    let started = performance.now()
    await api(`window.desktop.saveStudio(${JSON.stringify(normalDocument)})`)
    saveLatency.studio.push(performance.now() - started)
    normalMutations += 1
    assert.equal(treeHash(videoFolder), videoBeforeNormalSave, 'Medição de save Studio alterou Video Studio')
    assert.equal(JSON.parse(readFileSync(join(normalPath, 'studio.json'), 'utf8')).title, normalDocument.title)

    const normalBeforeVideoSave = treeHash(normalFolder)
    const videoDocument = syntheticStudio(`Measured video save ${index + 1}`, true)
    started = performance.now()
    await api(`window.desktop.saveVideoStudio(${JSON.stringify(videoDocument)})`)
    saveLatency.videoStudio.push(performance.now() - started)
    videoMutations += 1
    assert.equal(treeHash(normalFolder), normalBeforeVideoSave, 'Medição de save Video Studio alterou Studio normal')
    assert.equal(JSON.parse(readFileSync(join(videoPath, 'studio.json'), 'utf8')).title, videoDocument.title)
  }

  // Concurrent renderer calls exercise the per-namespace save queues while
  // keeping the same document ID intentionally colliding across namespaces.
  const concurrentNormal = Array.from({ length: 10 }, (_, index) => syntheticStudio(`IPC concorrente ${index + 1}`))
  const concurrentVideo = Array.from({ length: 10 }, (_, index) => syntheticStudio(`IPC vídeo concorrente ${index + 1}`, true))
  await Promise.all([
    ...concurrentNormal.map((document) => api(`window.desktop.saveStudio(${JSON.stringify(document)})`)),
    ...concurrentVideo.map((document) => api(`window.desktop.saveVideoStudio(${JSON.stringify(document)})`))
  ])
  const normalConcurrentDoc = JSON.parse(readFileSync(join(normalPath, 'studio.json'), 'utf8'))
  const videoConcurrentDoc = JSON.parse(readFileSync(join(videoPath, 'studio.json'), 'utf8'))
  assert.ok(concurrentNormal.some((document) => document.title === normalConcurrentDoc.title), 'Último documento normal concorrente não persistido')
  assert.ok(concurrentVideo.some((document) => document.title === videoConcurrentDoc.title), 'Último roteiro concorrente não persistido')

  // Verify each namespace remains byte-for-byte stable when only the other
  // namespace is concurrently writing.
  const normalBeforeVideoOnly = treeHash(normalFolder)
  await Promise.all(Array.from({ length: 10 }, (_, index) => api(`window.desktop.saveVideoStudio(${JSON.stringify(syntheticStudio(`IPC video edit ${index + 1}`, true))})`)))
  assert.equal(treeHash(normalFolder), normalBeforeVideoOnly, 'Gravações concorrentes de vídeo alteraram namespace normal')
  const videoAfterVideoOnly = treeHash(videoFolder)
  await Promise.all(Array.from({ length: 10 }, (_, index) => api(`window.desktop.saveStudio(${JSON.stringify(syntheticStudio(`IPC normal edit ${index + 1}`))})`)))
  assert.equal(treeHash(videoFolder), videoAfterVideoOnly, 'Gravações concorrentes do Studio alteraram namespace de vídeo')
  const normalFinalDoc = JSON.parse(readFileSync(join(normalPath, 'studio.json'), 'utf8'))
  assert.ok(normalFinalDoc.title.startsWith('IPC normal edit '), 'Edições concorrentes do Studio não persistidas')
  const videoFinalDoc = JSON.parse(readFileSync(join(videoPath, 'studio.json'), 'utf8'))
  assert.ok(videoFinalDoc.title.startsWith('IPC video edit '), 'Edições concorrentes de vídeo não persistidas')
  // Invalid payloads must reject before making even partial namespace writes.
  const invalidPathBefore = readFileSync(outsideSentinel)
  const invalidPathError = await rejectedError(api(`window.desktop.saveStudio(${JSON.stringify({ ...syntheticStudio('invalid path'), id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/../../outside' })})`))
  assert.ok(invalidPathError, 'ID perigoso deveria ser rejeitado')
  assert.deepEqual(readFileSync(outsideSentinel), invalidPathBefore, 'Payload inválido alterou arquivo sentinel fora dos namespaces')

  const normalBeforeNegative = treeHash(normalFolder)
  const videoBeforeNegative = treeHash(videoFolder)
  await rejectPromise(api(`window.desktop.saveStudio(${JSON.stringify({ ...syntheticStudio('bad'), id: '../outside' })}).then(() => false, () => true)`), 'ID traversal em studio:save')
  await rejectPromise(api(`window.desktop.saveVideoStudio(${JSON.stringify({ ...syntheticStudio('bad', true), title: '' })}).then(() => false, () => true)`), 'documento inválido em video-studio:save')
  await rejectPromise(api("window.desktop.deleteStudio('../outside').then(() => false, () => true)"), 'ID traversal em studio:delete')
  await rejectPromise(api("window.desktop.deleteVideoStudio('not-a-uuid').then(() => false, () => true)"), 'ID inválido em video-studio:delete')
  assert.equal(treeHash(normalFolder), normalBeforeNegative)
  assert.equal(treeHash(videoFolder), videoBeforeNegative)

  // Force filesystem failures only inside uniquely named synthetic documents.
  const ioFailureIds = {
    write: '2f50a2e4-7da4-4e28-9566-63dbf9403002',
    read: '3f50a2e4-7da4-4e28-9566-63dbf9403003'
  }
  const failedWriteFolder = join(normalFolder, `studio-${ioFailureIds.write}`)
  const failedReadFolder = join(normalFolder, `studio-${ioFailureIds.read}`)
  assert.equal(existsSync(failedWriteFolder), false)
  assert.equal(existsSync(failedReadFolder), false)
  const videoBeforeIoFailure = treeHash(videoFolder)
  await mkdir(failedWriteFolder, { recursive: true })
  await writeFile(join(failedWriteFolder, 'assets'), 'blocks synthetic asset directory creation')
  const writeFailure = await rejectedError(api(`window.desktop.saveStudio(${JSON.stringify({ ...syntheticStudio('simulated write failure'), id: ioFailureIds.write })})`))
  assert.ok(writeFailure, 'A falha de gravação simulada deveria rejeitar o IPC')
  assert.equal(existsSync(join(failedWriteFolder, 'studio.json')), false, 'Falha de escrita deixou documento parcial publicado')
  await mkdir(join(failedReadFolder, 'studio.json'), { recursive: true })
  const readFailure = await rejectedError(api('window.desktop.listStudios()'))
  assert.ok(readFailure, 'A falha de leitura simulada deveria rejeitar o IPC')
  assert.equal(treeHash(videoFolder), videoBeforeIoFailure, 'Falhas de I/O no Studio normal alteraram namespace de vídeo')
  const canonicalNormalRoot = resolve(normalFolder)
  for (const path of [failedWriteFolder, failedReadFolder]) {
    assert.equal(lstatSync(path).isSymbolicLink(), false)
    assert.equal(resolve(path), join(canonicalNormalRoot, basename(path)))
  }
  await rm(failedWriteFolder, { recursive: true, force: true })
  await rm(failedReadFolder, { recursive: true, force: true })
  // A rejected save should block shutdown until a subsequent successful
  // save confirms recovery. Restore both queue tails after negative probes.
  await api(`window.desktop.saveStudio(${JSON.stringify(syntheticStudio(normalFinalDoc.title))})`)
  await api(`window.desktop.saveVideoStudio(${JSON.stringify(syntheticStudio(videoFinalDoc.title, true))})`)
  assert.equal(JSON.parse(readFileSync(join(normalPath, 'studio.json'), 'utf8')).title, normalFinalDoc.title)
  assert.equal(JSON.parse(readFileSync(join(videoPath, 'studio.json'), 'utf8')).title, videoFinalDoc.title)

  // Test the real delete handlers with colliding IDs; only the selected
  // workspace directory may be removed. Then reopen verifies absence/presence.
  const rasterEvidence = await verifyRasterAssetFlow(window)
  // Asset-flow ownership IPC invariant: a new Customizer actor starts with
  // model/pose preference, and outfit adjustments belong exclusively to its
  // character document. No Fabricator authoring API is invoked by this test.
  const fabricatorRoot = join(userData, 'fabricator')
  const fabricatorBeforeCharacterSave = treeHash(fabricatorRoot)
  // The app seeds ten built-in characters on a pristine profile. Preserve
  // their count and compare only the two newly created synthetic actors.
  const charactersBefore = await api('window.desktop.listCustomizerCharacters()')
  const [actorA, actorB] = await Promise.all([
    api("window.desktop.createCustomizerCharacter('DEV AI Actor A')"),
    api("window.desktop.createCustomizerCharacter('DEV AI Actor B')")
  ])
  assert.notEqual(actorA.id, actorB.id)
  assert.equal(actorA.customization.modelSlot, 1)
  assert.equal(actorA.customization.poseSlot, 1)
  assert.equal(actorB.customization.modelSlot, 1)
  assert.equal(actorB.customization.poseSlot, 1)
  const syntheticGarmentId = rasterFixture.SET_ID
  const neutralGroups = [{
    modelSlot: 9, setId: syntheticGarmentId, category: 'camisa', componentId: 'shirt',
    offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotation: 0
  }, {
    modelSlot: 9, setId: syntheticGarmentId, category: 'sapato', componentId: 'shoe-left',
    offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotation: 0
  }, {
    modelSlot: 9, setId: syntheticGarmentId, category: 'oculos', componentId: 'glasses',
    offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotation: 0
  }]
  const fixtureAdjustmentReference = (componentId) => {
    const boneId = { shirt: 'torso', 'shoe-left': 'leg-left', glasses: 'head' }[componentId]
    const bone = rasterFixture.FRAMES.find(part => part.id === boneId)
    return { version: 1, boneId, width: bone.width, height: bone.height, rotation: 0 }
  }
  for (const group of neutralGroups) group.adjustmentReference = fixtureAdjustmentReference(group.componentId)
  const neutralCustomization = {
    ...actorA.customization, modelSlot: 9, poseSlot: 1,
    hairAppearance: { modelSlot: 9, frontStyleId: rasterFixture.HAIR_ID, backStyleId: rasterFixture.HAIR_ID },
    faceAppearance: { modelSlot: 9, eyeState: 0, eyebrows: true, noseIndex: 0, expressionIndex: 0,
      eyeCatalogId: rasterFixture.FACE_IDS.eyes, eyebrowCatalogId: rasterFixture.FACE_IDS.eyebrows,
      noseCatalogId: rasterFixture.FACE_IDS.nose, mouthClosedCatalogId: rasterFixture.FACE_IDS.mouth,
      mouthOpen: false, headExtras: { 'head-accessory': rasterFixture.EXTRA_ID } },
    wardrobeGroups: neutralGroups, partOverrides: {}
  }
  const siblingSameModel = { ...actorB, customization: neutralCustomization }
  const actorWithFittedGarment = {
    ...actorA, customization: {
      ...neutralCustomization,
      wardrobeGroups: [
        { ...neutralGroups[0], offsetX: 2, offsetY: -1, scaleX: 1.05, rotation: 2 },
        { ...neutralGroups[1], offsetX: 12, offsetY: -5, scaleX: 1.2, rotation: 8 },
        { ...neutralGroups[2], offsetX: 5, offsetY: -2, scaleX: 1.1, rotation: 4 }
      ],
      partOverrides: {
        'head:rearHair': { x: 5, y: -3, scaleX: 1.1, scaleY: 1, rotation: 4 },
        'head:acessorio-cabeca': { x: 3, y: 2, scaleX: 1, scaleY: 1, rotation: 5 }
      }
    }
  }
  await api(`window.desktop.saveCustomizerCharacter(${JSON.stringify(siblingSameModel)})`)
  await api(`window.desktop.saveCustomizerCharacter(${JSON.stringify(actorWithFittedGarment)})`)
  const persistedActors = await api('window.desktop.listCustomizerCharacters()')
  assert.equal(persistedActors.length, charactersBefore.length + 2)
  const storedA = persistedActors.find(character => character.id === actorA.id)
  const storedB = persistedActors.find(character => character.id === actorB.id)
  assert.equal(storedA.customization.wardrobeGroups[0].offsetX, 2)
  assert.equal(storedA.customization.wardrobeGroups[0].rotation, 2)
  assert.equal(storedA.customization.wardrobeGroups[0].scaleX, 1.05)
  assert.equal(storedA.customization.wardrobeGroups[0].componentId,'shirt')
  assert.equal(storedA.customization.wardrobeGroups[1].componentId,'shoe-left')
  assert.equal(storedA.customization.wardrobeGroups[1].offsetX,12)
  assert.equal(storedA.customization.wardrobeGroups[1].rotation,8)
  assert.equal(storedA.customization.wardrobeGroups[2].componentId,'glasses')
  assert.equal(storedA.customization.wardrobeGroups[2].offsetX,5)
  assert.equal(storedA.customization.wardrobeGroups[2].rotation,4)
  assert.equal(storedA.customization.partOverrides['head:rearHair'].x,5)
  assert.equal(storedA.customization.hairAppearance.frontStyleId,rasterFixture.HAIR_ID)
  assert.equal(storedA.customization.faceAppearance.headExtras['head-accessory'],rasterFixture.EXTRA_ID)
  // Electron IPC structured clone may materialize optional undefined fields.
  // Compare persistent JSON values, not JS object property-presence quirks.
  assert.deepEqual(JSON.parse(JSON.stringify(storedB.customization)),
    JSON.parse(JSON.stringify(siblingSameModel.customization)),
    'Alteração de ajuste no personagem A contaminou personagem B')
  assert.equal(treeHash(fabricatorRoot), fabricatorBeforeCharacterSave,
    'Salvar personagem no Customizador modificou a biblioteca Fabricador Dev')
  const result = { schemaVersion: 1, adapter: 'production-preload-real-ipc', realIpcCovered: true,
    sameDocumentIdBothNamespaces: true, validMutations: { studio: normalMutations, videoStudio: videoMutations },
    concurrentOperations: { simultaneousCrossNamespace: concurrentNormal.length + concurrentVideo.length,
      isolatedStudioWrites: 10, isolatedVideoStudioWrites: 10 },
    malformedCallsRejected: 5, ioFailuresSimulated: { read: 1, write: 1 },
    saveLatencyMs: { studio: summarizeSamples(saveLatency.studio), videoStudio: summarizeSamples(saveLatency.videoStudio),
      fixture: 'documento sintético sem assets, 1 elemento de dados; IPC real + escrita local confirmada' },
    customizerCharacterOwnership: {
      charactersCreated: 2, updatedCharacters: 2, siblingCustomizationUnchanged: true,
      bothCharactersUseSameSyntheticAssets: true, characterADeltasPersistedSeparately: true,
      characterBRemainsAtPublishedDefaults: true, fabricatorLibraryHashUnchanged: true,
      testedReference: 'persisted raster wardrobe v2, geometric Customizer oracle enabled; cross-Studio canonical golden remains pending',
      rasterSourceSheetSha256: rasterEvidence.sourceSheetSha256
    },
    deleteOperations: 0, outsideSandboxWritesObserved: 0,
    sandboxRoot: 'out/dev-ai/runs/<run-id>/sandbox',
    relativeNamespaces: ['electron-user-data/studios/Studio Principal', 'electron-user-data/studios/Video Studio'] }
  await writeFile(join(output, 'seed-result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ mode, status: 'passed', ...result }))
}

async function deleteDocuments(window) {
  const api = (expression) => window.webContents.executeJavaScript(expression)
  const normalFolder = await api('window.desktop.getStudioFolder()')
  const videoFolder = await api('window.desktop.getVideoStudioFolder()')
  const normalPath = join(normalFolder, 'studio-1f50a2e4-7da4-4e28-9566-63dbf9403001')
  const videoPath = join(videoFolder, 'studio-1f50a2e4-7da4-4e28-9566-63dbf9403001')
  assert.equal((await api('window.desktop.listStudios()')).length, 1)
  assert.equal((await api('window.desktop.listVideoStudios()')).length, 1)
  const outsideSentinel = join(sandbox, 'outside-studio-sentinel.txt')
  await writeFile(outsideSentinel, 'must remain byte-identical')
  const outsideBefore = readFileSync(outsideSentinel)
  await api("window.desktop.deleteStudio('1f50a2e4-7da4-4e28-9566-63dbf9403001')")
  assert.equal(existsSync(normalPath), false, 'Excluir Studio normal não removeu sua pasta')
  assert.equal(existsSync(join(videoPath, 'studio.json')), true, 'Excluir Studio normal removeu roteiro de vídeo com ID igual')
  assert.equal((await api('window.desktop.listStudios()')).length, 0)
  assert.equal((await api('window.desktop.listVideoStudios()')).length, 1)
  await api("window.desktop.deleteVideoStudio('1f50a2e4-7da4-4e28-9566-63dbf9403001')")
  assert.equal(existsSync(videoPath), false, 'Excluir roteiro de vídeo não removeu sua pasta')
  assert.equal((await api('window.desktop.listVideoStudios()')).length, 0)
  assert.equal(readFileSync(outsideSentinel, 'utf8'), 'must remain byte-identical')
  assert.deepEqual(readFileSync(outsideSentinel), outsideBefore, 'As operações IPC alteraram o sentinel fora dos namespaces')

  await writeFile(join(output, 'delete-result.json'), JSON.stringify({ mode, status: 'passed', adapter: 'production-preload-real-ipc', realIpcCovered: true, deleteOperations: 2, outsideSandboxWritesObserved: 0 }, null, 2))
  console.log(JSON.stringify({ mode, status: 'passed', deleteOperations: 2, outsideSandboxWritesObserved: 0 }))
}

async function verifyRestart(window) {
  const [normal, video] = await Promise.all([
    window.webContents.executeJavaScript('window.desktop.listStudios()'),
    window.webContents.executeJavaScript('window.desktop.listVideoStudios()')
  ])
  assert.equal(normal.length, 2)
  assert.equal(video.length, 2)
  const seededNormal=normal.find(document=>document.id==='1f50a2e4-7da4-4e28-9566-63dbf9403001')
  const seededVideo=video.find(document=>document.id==='1f50a2e4-7da4-4e28-9566-63dbf9403001')
  assert.ok(seededNormal?.title.startsWith('IPC normal edit '))
  assert.ok(seededVideo?.title.startsWith('IPC video edit '))
  assert.ok(seededNormal?.videoTimeline === undefined)
  assert.ok(seededVideo?.videoTimeline)
  const actors = await window.webContents.executeJavaScript('window.desktop.listCustomizerCharacters()')
  assert.ok(actors.length >= 2, 'Character catalog disappeared after restart')
  const fitted = actors.find(character => character.name === 'DEV AI Actor A')
  const unchanged = actors.find(character => character.name === 'DEV AI Actor B')
  const af13Report=JSON.parse(readFileSync(join(output,'af13','report.json'),'utf8'))
  const af13Normal=normal.find(document=>document.id===AF13_STUDIO_ID)
  const af13Video=video.find(document=>document.id===AF13_VIDEO_ID)
  const storedImage=(document)=>{
    const characterElements=document?.elements?.filter(element=>element.kind==='character')??[]
    assert.equal(characterElements.length,1,'AF13 workspace must persist one character after process restart')
    assert.equal(characterElements[0].characterId,fitted?.id)
    const asset=document.assets.find(item=>item.id===characterElements[0].assetId)
    assert.ok(asset?.dataUrl?.startsWith('data:image/png;base64,'),'AF13 character PNG missing after restart')
    return createHash('sha256').update(Buffer.from(asset.dataUrl.slice('data:image/png;base64,'.length),'base64')).digest('hex')
  }
  assert.equal(storedImage(af13Normal),af13Report.editorAssets.studio.sha256)
  assert.equal(storedImage(af13Video),af13Report.editorAssets.videoStudio.sha256)
  assert.equal(fitted?.customization.wardrobeGroups?.[1]?.offsetX, 12)
  assert.equal(fitted?.customization.wardrobeGroups?.[1]?.offsetY, -5)
  assert.equal(fitted?.customization.wardrobeGroups?.[1]?.scaleX, 1.2)
  assert.equal(fitted?.customization.wardrobeGroups?.[1]?.modelSlot,9)
  assert.equal(fitted?.customization.wardrobeGroups?.[1]?.setId,rasterFixture.SET_ID)
  assert.equal((await window.webContents.executeJavaScript('window.desktop.loadFabricatorPose(9,1)'))?.parts.length,10)
  assert.equal(fitted?.customization.wardrobeGroups?.[1]?.rotation, 8)
  assert.equal(fitted?.customization.wardrobeGroups?.[2]?.componentId,'glasses')
  assert.equal(fitted?.customization.wardrobeGroups?.[2]?.offsetX, 5)
  assert.equal(fitted?.customization.partOverrides?.['head:rearHair']?.x, 5)
  assert.equal(fitted?.customization.hairAppearance?.frontStyleId,rasterFixture.HAIR_ID)
  assert.equal(fitted?.customization.faceAppearance?.headExtras?.['head-accessory'],rasterFixture.EXTRA_ID)
  assert.equal(unchanged?.customization.modelSlot, 9)
  assert.equal(unchanged?.customization.wardrobeGroups?.length, 3)
  assert.ok(unchanged?.customization.wardrobeGroups?.every(group => group.offsetX === 0 && group.offsetY === 0
    && group.scaleX === 1 && group.scaleY === 1 && group.rotation === 0),
    'Após restart, personagem B herdou alterações do personagem A')
  assert.deepEqual(unchanged?.customization.partOverrides ?? {}, {},
    'Overrides de cabelo/cabeça do personagem A vazaram para B após restart')
  assert.equal(unchanged?.customization.hairAppearance?.frontStyleId, rasterFixture.HAIR_ID)
  assert.equal(unchanged?.customization.faceAppearance?.headExtras?.['head-accessory'], rasterFixture.EXTRA_ID)
  await window.webContents.executeJavaScript(`Promise.all([window.desktop.deleteStudio(${JSON.stringify(AF13_STUDIO_ID)}),window.desktop.deleteVideoStudio(${JSON.stringify(AF13_VIDEO_ID)})])`)
  const result = { mode, status: 'passed', adapter: 'production-preload-real-ipc', realIpcCovered: true,
    restartedProcess: true, af13ImageHashesPersisted: true, normalDocuments: 1, videoStudioDocuments: 1,
    sameIdStillIsolated: true, customizerCharacterDeltasPersisted: true,
    siblingSameEquipmentAtNeutralDefaults: true,
    dataRoot: 'out/dev-ai/runs/<run-id>/sandbox' }
  await writeFile(join(output, 'restart-result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
}

async function closeWithPendingSaves(window) {
  const saveCount = 100
  const documents = Array.from({ length: saveCount }, (_, index) => syntheticStudio(`Pending close save ${index + 1}`))
  const launched = await window.webContents.executeJavaScript(`(() => {
    window.__devAiPendingSaves = ${JSON.stringify(documents)}.map(document => {
      const tracked = { settled: false, error: null }
      tracked.promise = window.desktop.saveStudio(document).then(
        () => { tracked.settled = true },
        error => { tracked.error = String(error?.message ?? error); tracked.settled = true }
      )
      return tracked
    })
    return true
  })()`)
  assert.equal(launched, true)
  await window.webContents.executeJavaScript('Promise.all(window.__devAiPendingSaves.slice(0, 5).map(entry => entry.promise))')
  const pendingBeforeClose = await window.webContents.executeJavaScript('window.__devAiPendingSaves.filter(entry => !entry.settled).length')
  assert.ok(pendingBeforeClose > 0, 'O teste precisa fechar o editor com IPCs de salvamento ainda pendentes')
  await writeFile(join(output, 'close-pending-result.json'), JSON.stringify({ mode, status: 'passed',
    adapter: 'production-preload-real-ipc', realIpcCovered: true, savesDispatched: saveCount,
    pendingAtWindowClose: pendingBeforeClose, closedWindowBeforeAllAcks: true }, null, 2))
  exitCode = 0
  allowNaturalQuit = true
  window.close()
}

async function verifyClosePending(window) {
  const normal = await window.webContents.executeJavaScript('window.desktop.listStudios()')
  const video = await window.webContents.executeJavaScript('window.desktop.listVideoStudios()')
  assert.equal(normal.length, 1)
  assert.equal(video.length, 1)
  assert.equal(normal[0].title, 'Pending close save 100', 'A última gravação não terminou antes do fechamento do processo')
  assert.equal(video[0].title, 'IPC video edit 10', 'Fechamento do editor alterou o namespace de vídeo')
  await writeFile(join(output, 'verify-close-pending-result.json'), JSON.stringify({ mode, status: 'passed',
    adapter: 'production-preload-real-ipc', realIpcCovered: true, restartedProcess: true,
    normalTitlePersisted: normal[0].title, videoTitleUnchanged: video[0].title }, null, 2))
}

async function verifyRendererNetworkBlock(window) {
  // Bind a synthetic-only loopback server and validate it is reachable from
  // Node before asserting Electron's renderer cannot contact it.
  let hits = 0
  const server = createServer((_request, response) => {
    hits++
    response.writeHead(200, { 'Content-Type': 'text/plain' })
    response.end('synthetic')
  })
  await new Promise((resolveStarted, rejectStarted) => {
    server.once('error', rejectStarted)
    server.listen(0, '127.0.0.1', resolveStarted)
  })
  try {
    const url = `http://127.0.0.1:${server.address().port}/synthetic`
    await new Promise((resolveGet, rejectGet) => {
      get(url, response => {
        response.resume()
        response.once('end', resolveGet)
      }).once('error', rejectGet)
    })
    assert.equal(hits, 1, 'Servidor loopback de controle não foi atingido por Node')
    const blocked = await window.webContents.executeJavaScript(
      `fetch(${JSON.stringify(url)}, { mode: 'no-cors' }).then(() => false, () => true)`
    )
    assert.equal(blocked, true, 'Renderer DEV AI conseguiu solicitar a rede')
    await new Promise(resolveDelay => setTimeout(resolveDelay, 150))
    assert.equal(hits, 1, 'Uma requisição do renderer alcançou o servidor, apesar da barreira')
    return { status: 'passed', barrier: 'Electron defaultSession.webRequest', probe: 'loopback-synthetic',
      serverControlRequests: 1, rendererRequestsObserved: 0, osFirewallEnforced: false }
  } finally {
    await new Promise(resolveClosed => server.close(resolveClosed))
  }
}

async function verifyCustomizerRasterPreview(window,poseLabel='pose1') {
  // Sample distinct synthetic colors in production Customizer layer rasters;
  // alpha totals alone cannot prove that a part is attached to the right bone.
  const waitForCharacter = async (name, expectOutfit) =>
    window.webContents.executeJavaScript(`(async()=>{
      const name=${JSON.stringify(name)}
      const expected=${expectOutfit}
      const deadline=Date.now()+30000
      let last=null
      let previousSignature='',stableFrames=0
      const expectedPoseSlot=${JSON.stringify(poseLabel==='pose2'?2:1)}
      while(Date.now()<deadline){
        const cards=[...document.querySelectorAll('.character-card')]
        const card=cards.find(el=>el.textContent.includes(name))
        if(card){card.click();break}
        await new Promise(resolve=>setTimeout(resolve,150))
      }
      while(Date.now()<deadline){
        const selected=(document.querySelector('.customizer-preview-character-name')?.textContent||'').trim()
        const model=document.querySelector('.customizer-selected-artwork')
        const wardrobe=document.querySelector('.customizer-wardrobe-overlay')
        const aboveHair=document.querySelector('.customizer-wardrobe-above-hair-overlay')
        const frontHair=document.querySelector('.customizer-front-hair-overlay')
        const face=document.querySelector('.customizer-face-overlay')
        const raster=(img)=>{
          if(!img || !img.complete || !img.naturalWidth || !img.naturalHeight) return null
          const canvas=document.createElement('canvas')
          canvas.width=img.naturalWidth;canvas.height=img.naturalHeight
          const context=canvas.getContext('2d',{willReadFrequently:true})
          if(!context) return null
          context.drawImage(img,0,0)
          return {width:canvas.width,height:canvas.height,data:context.getImageData(0,0,canvas.width,canvas.height).data}
        }
        const alphaBounds=(image)=>{
          if(!image) return null
          const {width,height,data}=image
          let pixels=0,minX=width,minY=height,maxX=-1,maxY=-1
          for(let i=0;i<data.length;i+=4){
            if(data[i+3]<32) continue
            pixels++
            const pixel=i/4,x=pixel%width,y=Math.floor(pixel/width)
            minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)
          }
          return {pixels,bounds:pixels?{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1}:null,
            raster:{width,height}}
        }
        const colorBounds=(image,target,tolerance=96)=>{
          if(!image)return null
          const {width,height,data}=image
          let pixels=0,minX=width,minY=height,maxX=-1,maxY=-1,maxChannelDelta=0
          for(let i=0;i<data.length;i+=4){
            if(data[i+3]<128)continue
            const delta=Math.max(Math.abs(data[i]-target[0]),Math.abs(data[i+1]-target[1]),Math.abs(data[i+2]-target[2]))
            maxChannelDelta=Math.max(maxChannelDelta,delta)
            if(delta>tolerance)continue
            pixels++
            const pixel=i/4,x=pixel%width,y=Math.floor(pixel/width)
            minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)
          }
          return {pixels,bounds:pixels?{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1}:null,
            raster:{width,height},targetRgb:target,colorTolerance:tolerance,maxChannelDelta}
        }
        const alerts=[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent.trim()).filter(Boolean)
        const storedCharacters=await window.desktop.listCustomizerCharacters()
        const storedCharacter=storedCharacters.find(character=>character.name===name)
        // The fixture shoe is the only asset with this synthetic RGB marker.
        // Body resampling differs slightly between the model IMG and wardrobe
        // canvas at rotated poses, so compare the tagged garment pixels only.
        const shoe=expected?colorBounds(raster(wardrobe),[0,255,20]):null
        const glasses=expected?alphaBounds(raster(aboveHair)):null
        const frontHairBounds=expected?alphaBounds(raster(frontHair)):null
        // Face catalog pieces share this production composited raster. Locate
        // the distinct accessory marker by color instead of treating all face
        // pixels as if they belonged to the head-extra asset.
        const headExtra=expected?colorBounds(raster(face),[12,180,235],24):null
        last={selected,modelReady:!!model && model.complete && model.naturalWidth>0,
          wardrobeReady:!!wardrobe && wardrobe.complete && wardrobe.naturalWidth>0,
          glassesReady:!!aboveHair && aboveHair.complete && aboveHair.naturalWidth>0,
          frontHairReady:!!frontHair && frontHair.complete && frontHair.naturalWidth>0,
          headExtraReady:!!face && face.complete && face.naturalWidth>0,
          rasterGeometry:{shoe,glasses,frontHair:frontHairBounds,headExtra},
          outfitPresent:!!wardrobe,glassesPresent:!!aboveHair,
          hairPresent:!!frontHair,headExtraPresent:!!face,
          alerts,modelNaturalSize:model?[model.naturalWidth,model.naturalHeight]:null,
          outfitNaturalSize:wardrobe?[wardrobe.naturalWidth,wardrobe.naturalHeight]:null,
          persistedPoseSlot:storedCharacter?.customization.poseSlot??null,
          previewBusy:!!document.querySelector('.customizer-preview-loading')}
        const signature=[model?.src,wardrobe?.src,aboveHair?.src,frontHair?.src,face?.src,last.persistedPoseSlot].join('|')
        if(signature===previousSignature)stableFrames++;else{previousSignature=signature;stableFrames=0}
        const allAssetsMeasured=[shoe,glasses,frontHairBounds,headExtra].every(item=>item?.pixels>100 && item.bounds)
        if(selected===name && storedCharacter?.customization.modelSlot===9
          && last.persistedPoseSlot===expectedPoseSlot && !last.previewBusy && stableFrames>=2 && last.modelReady
          && (expected?(last.wardrobeReady && last.glassesReady && last.frontHairReady && last.headExtraReady
             && allAssetsMeasured)
            :(!last.outfitPresent&&!last.glassesPresent&&!last.hairPresent&&!last.headExtraPresent))
          && alerts.length===0){
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
          return {...last,status:'passed'}
        }
        await new Promise(resolve=>setTimeout(resolve,180))
      }
      return {...last,status:'failed',expectedOutfit:expected}
    })()`)
  const outfit = await waitForCharacter('DEV AI Actor A',true)
  const artifactsFolder=join(output,'raster-asset-flow')
  await mkdir(artifactsFolder,{recursive:true})
  const captureCanonicalCharacter=async(name,fileName)=>{
    const dataUrl=await window.webContents.executeJavaScript(`(async()=>{
      const name=${JSON.stringify(name)}
      const deadline=Date.now()+10000
      while(Date.now()<deadline){
        const selected=(document.querySelector('.customizer-preview-character-name')?.textContent||'').trim()
        if(selected===name)break
        await new Promise(resolve=>setTimeout(resolve,50))
      }
      const selectors=['.customizer-selected-artwork','.customizer-wardrobe-overlay',
        '.customizer-face-overlay','.customizer-front-hair-overlay','.customizer-wardrobe-above-hair-overlay']
      const layers=selectors.map(selector=>document.querySelector(selector)).filter(Boolean)
      if(!layers.length||layers.some(image=>!image.complete||!image.naturalWidth))return null
      const canvas=document.createElement('canvas')
      canvas.width=layers[0].naturalWidth;canvas.height=layers[0].naturalHeight
      const context=canvas.getContext('2d')
      for(const layer of layers)context.drawImage(layer,0,0,canvas.width,canvas.height)
      return canvas.toDataURL('image/png')
    })()`)
    assert.ok(dataUrl?.startsWith('data:image/png;base64,'),`Captura canônica ausente para ${name}`)
    await writeFile(join(artifactsFolder,fileName),Buffer.from(dataUrl.slice('data:image/png;base64,'.length),'base64'))
  }
  await captureCanonicalCharacter('DEV AI Actor A','customizer-actor-a-canonical-'+poseLabel+'.png')
  const sibling = await waitForCharacter('DEV AI Actor B',true)
  await captureCanonicalCharacter('DEV AI Actor B','customizer-actor-b-canonical-'+poseLabel+'.png')
  const fixture=rasterFixture.manifest(nativeImage)
  const pose=poseLabel==='pose2'?fixture.pose2:fixture.pose1
  const sourceHead=rasterFixture.FRAMES.find(part=>part.id==='head')
  const targetHead=pose.parts.find(part=>part.id==='head')
  const actorAOverrides={
    shoe:{offsetX:12,offsetY:-5,scaleX:1.2,scaleY:1,rotation:8},
    glasses:{offsetX:5,offsetY:-2,scaleX:1.1,scaleY:1,rotation:4},
    hair:{x:5,y:-3,scaleX:1.1,scaleY:1,rotation:4},
    headExtra:{x:3,y:2,scaleX:1,scaleY:1,rotation:5}
  }
  const expectedFor=(actor)=>{
    const override=actor==='A'
    const groups=override?actorAOverrides:{shoe:{},glasses:{}}
    const merged=(base,delta)=>({...base,x:base.x+(delta.x??0),y:base.y+(delta.y??0),
      scaleX:base.scaleX*(delta.scaleX??1),scaleY:base.scaleY*(delta.scaleY??1),rotation:base.rotation+(delta.rotation??0)})
    const referenceFor = (boneId) => {
      const bone = rasterFixture.FRAMES.find(part => part.id === boneId)
      return { version: 1, boneId, width: bone.width, height: bone.height, rotation: 0 }
    }
    return {
      shoe:boundComponentBounds(fixture.set.components.find(component=>component.id==='shoe-left'),
        pose.parts.find(part=>part.id==='leg-left'),{...groups.shoe,adjustmentReference:referenceFor('leg-left')}),
      glasses:boundComponentBounds(fixture.set.components.find(component=>component.id==='glasses'),
        targetHead,{...groups.glasses,adjustmentReference:referenceFor('head')}),
      frontHair:headLocalBounds(fixture.hairStyle.front,{...merged(fixture.hairStyle.transforms.front,override?actorAOverrides.hair:{}),relativeToHead:true},sourceHead,targetHead),
      headExtra:headLocalBounds(fixture.extraAsset,merged(fixture.extraAsset.defaultTransform,override?actorAOverrides.headExtra:{}),sourceHead,targetHead)
    }
  }
  const validateGeometry=(actual,actor)=>Object.fromEntries(Object.entries(expectedFor(actor)).map(([key,expected])=>[
    key,compareBounds(actual.rasterGeometry?.[key]?.bounds,expected,3)
  ]))
  const outfitGeometry=validateGeometry(outfit,'A')
  const siblingGeometry=validateGeometry(sibling,'B')
  const geometryWithinTolerance=[...Object.values(outfitGeometry),...Object.values(siblingGeometry)].every(result=>result.passed)
  const report={schemaVersion:1,adapter:'production-customizer-real-dom',
    status:outfit.status==='passed'&&sibling.status==='passed'&&geometryWithinTolerance?'passed':'failed',
    configuredFixture:`synthetic-only: DEV AI Actor A/B; raster model-9, ${poseLabel}, wardrobe-v2, head-local hair and head-extra`,
    capture:'synthetic-only canonical character composite on neutral background; excludes navigation and seeded starter characters',
    characterA:{...outfit,geometry:outfitGeometry},characterB:{...sibling,geometry:siblingGeometry},
    geometryWithinTolerance,tolerancePixels:3,sourceLibraryWrites:0,
    limitations:'Geometric Customizer oracle over production DOM layer rasters; synthetic fixtures only; not a cross-Studio canonical golden image'}
  await writeFile(join(artifactsFolder,'customizer-render-result-'+poseLabel+'.json'),JSON.stringify(report,null,2))
  assert.equal(report.status,'passed',`Customizer não respeitou os bindings/defaultTransforms sintéticos: ${JSON.stringify(report)}`)
  return report
}

const AUTHORED_ACTOR_A = 'DEV AI UI Authored Character'
const AUTHORED_ACTOR_B = 'DEV AI UI Independent Character B'
const AUTHORED_WARDROBE_NAME = 'dev-ai-ui-clothes'

function alphaCrop(png) {
  const image=nativeImage.createFromBuffer(png),size=image.getSize(),bitmap=image.toBitmap()
  let minX=size.width,minY=size.height,maxX=-1,maxY=-1
  for(let y=0;y<size.height;y++)for(let x=0;x<size.width;x++)if(bitmap[(y*size.width+x)*4+3]>16){
    minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)}
  assert.ok(maxX>=minX&&maxY>=minY,'AF13 authored character raster has no visible alpha')
  const width=maxX-minX+1,height=maxY-minY+1,cropped=Buffer.alloc(width*height*4)
  for(let y=0;y<height;y++)bitmap.copy(cropped,y*width*4,((minY+y)*size.width+minX)*4,((minY+y)*size.width+minX+width)*4)
  return {png:nativeImage.createFromBitmap(cropped,{width,height}).toPNG(),bounds:{x:minX,y:minY,width,height},size}
}

function dominantRgba(png) {
  const image=nativeImage.createFromBuffer(png),{width,height}=image.getSize(),bitmap=image.toBitmap(),histogram=new Map()
  for(let y=Math.floor(height*.08);y<Math.ceil(height*.92);y++)for(let x=Math.floor(width*.08);x<Math.ceil(width*.92);x++){
    const at=(y*width+x)*4
    if(bitmap[at+3]<220)continue
    const rgb=[bitmap[at+2],bitmap[at+1],bitmap[at],bitmap[at+3]],key=rgb.slice(0,3).join(',')
    histogram.set(key,{rgb,count:(histogram.get(key)?.count??0)+1})
  }
  const dominant=[...histogram.values()].sort((a,b)=>b.count-a.count)[0]
  assert.ok(dominant&&dominant.count>20,'Authored garment fixture has no stable opaque marker color')
  return dominant.rgb
}

function coloredBounds(png,target,tolerance=28) {
  const image=nativeImage.createFromBuffer(png),{width,height}=image.getSize(),bitmap=image.toBitmap()
  let count=0,minX=width,minY=height,maxX=-1,maxY=-1
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const at=(y*width+x)*4
    if(bitmap[at+3]<128)continue
    const delta=Math.max(Math.abs(bitmap[at+2]-target[0]),Math.abs(bitmap[at+1]-target[1]),Math.abs(bitmap[at]-target[2]))
    if(delta>tolerance)continue
    count++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)
  }
  return {count,bounds:count?{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1}:null}
}

async function authoredCustomizerCapture(window,characterName,poseSlot,poseCategory,folder,label) {
  const evaluate=code=>window.webContents.executeJavaScript(code)
  await evaluate('location.hash="/customizar"')
  await waitForDom(window,'Boolean(document.querySelector(".home-layout"))','Authored AF13 Customizer route')
  await waitForDom(window,'[...document.querySelectorAll(".character-card")].some(card=>card.textContent.includes('+JSON.stringify(characterName)+'))','Authored AF13 character card')
  await evaluate(`(()=>{const card=[...document.querySelectorAll('.character-card')].find(item=>item.textContent.includes(${JSON.stringify(characterName)}));card.click();return true})()`)
  await waitForDom(window,'(document.querySelector(".customizer-preview-character-name")?.textContent||"").trim()==='+JSON.stringify(characterName),'Authored AF13 selected character')
  await evaluate(`(()=>{const button=[...document.querySelectorAll('.home-customizer-top-tabs button')].find(item=>item.textContent.includes('Modelos'));if(button)button.click();return !!button})()`)
  await waitForDom(window,'Boolean(document.querySelector(".customizer-pose-carousel"))','Authored AF13 pose carousel')
  const categoryArrow=poseCategory==='Sentado'?'Próxima categoria':'Categoria anterior'
  const categoryState=await evaluate('document.querySelector(".customizer-pose-carousel-heading")?.textContent||""')
  if(!categoryState.includes(poseCategory)){
    await evaluate(`(()=>{const button=document.querySelector(${JSON.stringify('.customizer-pose-carousel-arrow.category[aria-label="'+categoryArrow+'"]')});if(!button||button.disabled)return false;button.click();return true})()`)
  }
  await waitForDom(window,'document.querySelector(".customizer-pose-carousel-heading")?.textContent.includes('+JSON.stringify(poseCategory)+')','Authored AF13 '+poseCategory+' category')
  const poseSelector=`[aria-label="Selecionar pose ${String(poseSlot).padStart(2,'0')}"]`
  await waitForDom(window,'Boolean(document.querySelector('+JSON.stringify(poseSelector)+')&&!document.querySelector('+JSON.stringify(poseSelector)+').disabled)','Authored AF13 pose '+poseSlot+' button')
  await evaluate(`document.querySelector(${JSON.stringify(poseSelector)}).click()`)
  await waitForDom(window,'window.desktop.listCustomizerCharacters().then(items=>items.find(item=>item.name==='+JSON.stringify(characterName)+')?.customization.poseSlot==='+poseSlot+')','Authored AF13 pose persisted')
  await waitForDom(window,'Boolean(document.querySelector(".customizer-selected-artwork")?.complete&&document.querySelector(".customizer-selected-artwork")?.naturalWidth>0&&!document.querySelector(".customizer-preview-loading"))','Authored AF13 base image ready',60000)
  const composite=await evaluate(`(async()=>{
    await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))
    const selectors=['.customizer-selected-artwork','.customizer-wardrobe-overlay','.customizer-face-overlay','.customizer-front-hair-overlay','.customizer-wardrobe-above-hair-overlay']
    const layers=selectors.map(selector=>document.querySelector(selector)).filter(Boolean)
    if(!layers.length||layers.some(image=>!image.complete||!image.naturalWidth))return null
    const canvas=document.createElement('canvas');canvas.width=layers[0].naturalWidth;canvas.height=layers[0].naturalHeight
    const context=canvas.getContext('2d');for(const layer of layers){if(layer.naturalWidth!==canvas.width||layer.naturalHeight!==canvas.height)throw Error('Customizador layer dimensions differ: '+layer.className);context.drawImage(layer,0,0)}
    return {dataUrl:canvas.toDataURL('image/png'),layers:layers.map(image=>({className:image.className,width:image.naturalWidth,height:image.naturalHeight})),poseSlot:${poseSlot}}
  })()`)
  assert.ok(composite?.dataUrl?.startsWith('data:image/png;base64,'),'Authored AF13 Customizer composite missing')
  const raw=Buffer.from(composite.dataUrl.slice('data:image/png;base64,'.length),'base64')
  const cropped=alphaCrop(raw),filename=`${label}-customizer-character.png`
  await writeFile(join(folder,filename),cropped.png)
  const fullCapture=await captureSettled(window,`${label}-customizer-stage`)
  assert.equal(fullCapture.settled,true,`Authored AF13 Customizer preview did not settle for ${label}`)
  await writeFile(join(folder,`${label}-customizer-stage.png`),fullCapture.png)
  const character=(await evaluate('window.desktop.listCustomizerCharacters()')).find(item=>item.name===characterName)
  return {png:cropped.png,sha256:createHash('sha256').update(cropped.png).digest('hex'),size:cropped.size,alphaBounds:cropped.bounds,
    layers:composite.layers,poseSlot:character.customization.poseSlot,fullScreenshotSha256:createHash('sha256').update(fullCapture.png).digest('hex')}
}

async function waitForDom(window,condition,label,timeout=30000) {
  const end=Date.now()+timeout
  while(Date.now()<end){if(await window.webContents.executeJavaScript(condition))return;await new Promise(resolve=>setTimeout(resolve,120))}
  throw new Error(`${label} timeout; route=${await window.webContents.executeJavaScript('location.hash')}; text=${(await window.webContents.executeJavaScript('(document.body?.innerText||"").slice(0,600)')).replace(/\\s+/g,' ')}`)
}

async function authoredStageCapture(window,characterName,video,title,folder,label) {
  const document={...syntheticStudio(title,video),id:randomUUID()}
  if(video)await window.webContents.executeJavaScript(`window.desktop.saveVideoStudio(${JSON.stringify(document)})`)
  else await window.webContents.executeJavaScript(`window.desktop.saveStudio(${JSON.stringify(document)})`)
  const hash=video?'/video-studio':'/estudio',cardSelector=video?'.video-studio-card-open':'.studio-card-open'
  const editorSelector=video?'.video-studio-editor':'.studio-editor'
  const addSelector=video?'.video-studio-cast-tool-button':'.studio-cast-add-button'
  const modalSelector=video?'.video-studio-cast-modal':'.studio-cast-modal'
  const optionSelector=video?'.video-studio-cast-modal-option':'.studio-cast-modal-option'
  const imageSelector=video?'.video-studio-element-character img':'.studio-element-character img'
  await window.webContents.executeJavaScript('location.hash="/opcoes"')
  await waitForDom(window,'Boolean(document.querySelector("main.blank-page"))','Authored AF13 editor route remount')
  await window.webContents.executeJavaScript(`location.hash=${JSON.stringify(hash)}`)
  await waitForDom(window,'[...document.querySelectorAll('+JSON.stringify(cardSelector)+')].some(card=>card.textContent.includes('+JSON.stringify(title)+'))','Authored AF13 scene card')
  await window.webContents.executeJavaScript(`[...document.querySelectorAll(${JSON.stringify(cardSelector)})].find(card=>card.textContent.includes(${JSON.stringify(title)})).click()`)
  await waitForDom(window,'Boolean(document.querySelector('+JSON.stringify(editorSelector)+'))','Authored AF13 real editor')
  await window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(addSelector)}).click()`)
  await waitForDom(window,'Boolean(document.querySelector('+JSON.stringify(modalSelector)+'))&&[...document.querySelectorAll('+JSON.stringify(optionSelector)+')].some(option=>option.textContent.includes('+JSON.stringify(characterName)+'))','Authored AF13 cast option')
  await window.webContents.executeJavaScript(`(()=>{const option=[...document.querySelectorAll(${JSON.stringify(optionSelector)})].find(item=>item.textContent.includes(${JSON.stringify(characterName)}));if(!option.classList.contains('selected'))option.click();return true})()`)
  await waitForDom(window,'[...document.querySelectorAll('+JSON.stringify(optionSelector)+')].some(option=>option.textContent.includes('+JSON.stringify(characterName)+')&&option.classList.contains("selected"))','Authored AF13 selection applied by React')
  await window.webContents.executeJavaScript(`(()=>{const dialog=document.querySelector(${JSON.stringify(modalSelector)});const save=[...dialog.querySelectorAll('button')].find(button=>button.textContent.includes('Salvar elenco'));if(!save||save.disabled)throw Error('Salvar elenco button unavailable');save.click();return true})()`)
  await waitForDom(window,'Boolean(document.querySelector('+JSON.stringify(imageSelector)+')?.complete&&document.querySelector('+JSON.stringify(imageSelector)+')?.naturalWidth>0&&!document.querySelector('+JSON.stringify(modalSelector)+'))','Authored AF13 rendered character',60000)
  const capture=await window.webContents.executeJavaScript(`(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const img=document.querySelector(${JSON.stringify(imageSelector)});const element=img.closest('.studio-canvas-element,.video-studio-canvas-element');const rect=element?.getBoundingClientRect(),stage=element?.parentElement;return {dataUrl:img.src,naturalSize:[img.naturalWidth,img.naturalHeight],elementRect:rect?[rect.x,rect.y,rect.width,rect.height]:null,stageSize:stage?[stage.clientWidth,stage.clientHeight]:null}})()`)
  assert.ok(capture.dataUrl.startsWith('data:image/png;base64,'),`${title}: rendered snapshot missing`)
  const png=Buffer.from(capture.dataUrl.slice('data:image/png;base64,'.length),'base64'),cropped=alphaCrop(png)
  const filename=`${label}-${video?'video-studio':'studio'}-character.png`
  await writeFile(join(folder,filename),cropped.png)
  const stageScreenshot=await captureSettled(window,`${label}-${video?'video-studio':'studio'}-stage`)
  assert.equal(stageScreenshot.settled,true,`${title}: editor stage did not settle`)
  await writeFile(join(folder,`${label}-${video?'video-studio':'studio'}-stage.png`),stageScreenshot.png)
  const list=video?await window.webContents.executeJavaScript('window.desktop.listVideoStudios()'):await window.webContents.executeJavaScript('window.desktop.listStudios()')
  const saved=list.find(item=>item.id===document.id)
  assert.ok(saved,`${title}: scene was not persisted`)
  const element=saved.elements.find(item=>item.kind==='character'&&item.text===characterName)
  assert.ok(element,`${title}: saved scene does not reference the selected character`)
  const asset=saved.assets.find(item=>item.id===element.assetId)
  assert.ok(asset?.dataUrl?.startsWith('data:image/png;base64,'),`${title}: persisted character snapshot is missing`)
  assert.equal(createHash('sha256').update(Buffer.from(asset.dataUrl.slice('data:image/png;base64,'.length),'base64')).digest('hex'),
    createHash('sha256').update(png).digest('hex'),`${title}: displayed image differs from persisted scene snapshot`)
  const rect=capture.elementRect,stage=capture.stageSize
  return {sceneId:document.id,title,characterId:element.characterId,assetId:asset.id,imageName:filename,
    sha256:createHash('sha256').update(cropped.png).digest('hex'),sourceSnapshotSha256:createHash('sha256').update(png).digest('hex'),
    naturalSize:capture.naturalSize,alphaBounds:cropped.bounds,elementRect:rect,stageSize:stage,
    relativeRect:rect&&stage?{x:rect[0]/stage[0],y:rect[1]/stage[1],width:rect[2]/stage[0],height:rect[3]/stage[1]}:null,
    aspectRatioPreserved:!!rect&&Math.abs(rect[2]/rect[3]-capture.naturalSize[0]/capture.naturalSize[1])<.02,
    stageScreenshotSha256:createHash('sha256').update(stageScreenshot.png).digest('hex')}
}

async function authoredAf13(window,output,verifyRestart=false) {
  const folder=join(output,'af13-authored');await mkdir(folder,{recursive:true})
  const manifestPath=join(app.getPath('userData'),'customizer','characters','characters.json')
  const fabricatorPath=join(app.getPath('userData'),'fabricator')
  const manifestHash=()=>createHash('sha256').update(readFileSync(manifestPath)).digest('hex')
  if(verifyRestart){
    const first=JSON.parse(readFileSync(join(folder,'report.json'),'utf8'))
    assert.equal(first.status,'passed','First authored AF13 process did not finish all comparisons')
    assert.equal(manifestHash(),first.ownership.characterManifestSha256,'Character manifest changed after first AF13 process')
    assert.equal(treeHash(fabricatorPath),first.ownership.fabricatorTreeSha256,'Fabricador changed after first AF13 process')
    const studios=await window.webContents.executeJavaScript('window.desktop.listStudios()')
    const videos=await window.webContents.executeJavaScript('window.desktop.listVideoStudios()')
    const restartComparisons=[]
    // Earlier scenarios intentionally reuse A while changing its pose/outfit.
    // Their stored snapshots are hash-verified above; opening those old scenes
    // would correctly refresh them to A's later state. Reopen the final saved
    // state for each actor to prove that both consumers retain the current look.
    const finalScenarioByCharacter=new Map()
    for(const scenario of first.scenarios)finalScenarioByCharacter.set(scenario.characterId,scenario)
    const restartScenarios=[...finalScenarioByCharacter.values()]
    for(const scenario of restartScenarios){
      for(const [type,collection] of [['studio',studios],['videoStudio',videos]]){
        const expected=scenario[type],saved=collection.find(item=>item.id===expected.sceneId)
        assert.ok(saved,`${scenario.id} ${type} scene disappeared after restart`)
        const element=saved.elements.find(item=>item.kind==='character'&&item.characterId===scenario.characterId)
        assert.ok(element,`${scenario.id} ${type} character binding disappeared after restart`)
        const asset=saved.assets.find(item=>item.id===element.assetId)
        const png=Buffer.from(asset.dataUrl.slice('data:image/png;base64,'.length),'base64')
        assert.equal(createHash('sha256').update(png).digest('hex'),expected.sourceSnapshotSha256,
          `${scenario.id} ${type} persisted image changed after restart`)
        const hash=type==='studio'?'/estudio':'/video-studio',cardSelector=type==='studio'?'.studio-card-open':'.video-studio-card-open'
        const editorSelector=type==='studio'?'.studio-editor':'.video-studio-editor'
        const imageSelector=type==='studio'?'.studio-element-character img':'.video-studio-element-character img'
        await window.webContents.executeJavaScript('location.hash="/opcoes"')
        await waitForDom(window,'Boolean(document.querySelector("main.blank-page"))',`${scenario.id} restart editor remount`)
        await window.webContents.executeJavaScript(`location.hash=${JSON.stringify(hash)}`)
        await waitForDom(window,'[...document.querySelectorAll('+JSON.stringify(cardSelector)+')].some(card=>card.textContent.includes('+JSON.stringify(expected.title)+'))',`${scenario.id} persisted editor scene card`)
        await window.webContents.executeJavaScript(`[...document.querySelectorAll(${JSON.stringify(cardSelector)})].find(card=>card.textContent.includes(${JSON.stringify(expected.title)})).click()`)
        await waitForDom(window,'Boolean(document.querySelector('+JSON.stringify(editorSelector)+'))&&Boolean(document.querySelector('+JSON.stringify(imageSelector)+')?.complete&&document.querySelector('+JSON.stringify(imageSelector)+')?.naturalWidth>0)',`${scenario.id} editor render after restart`,60000)
        const displayed=await window.webContents.executeJavaScript(`(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return document.querySelector(${JSON.stringify(imageSelector)}).src})()`)
        const displayedPng=Buffer.from(displayed.slice('data:image/png;base64,'.length),'base64')
        const renderedComparison=screenshotComparison(png,displayedPng,{channelTolerance:0,maxChangedPixelRatio:0})
        assert.equal(renderedComparison.metrics.passed,true,
          `${scenario.id} ${type} rendered appearance changed in the real editor after restart: ${JSON.stringify(renderedComparison.metrics)}`)
        restartComparisons.push({scenarioId:scenario.id,consumer:type,storedSnapshotSha256:expected.sourceSnapshotSha256,
          renderedPngSha256:createHash('sha256').update(displayedPng).digest('hex'),pixelComparison:renderedComparison.metrics})
        const settled=await captureSettled(window,`${scenario.id}-restart-${type}-stage`)
        assert.equal(settled.settled,true,`${scenario.id} ${type} stage did not settle after restart`)
        await writeFile(join(folder,`${scenario.id}-restart-${type}-stage.png`),settled.png)
      }
    }
    assert.equal(manifestHash(),first.ownership.characterManifestSha256,'Reopening authored AF13 scenes after restart modified characters')
    assert.equal(treeHash(fabricatorPath),first.ownership.fabricatorTreeSha256,'Reopening authored AF13 scenes after restart modified Fabricador')
    await writeFile(join(folder,'restart.json'),JSON.stringify({schemaVersion:1,status:'passed',freshElectronProcess:true,
      scenarioCount:first.scenarios.length,reopenedFinalActorStates:restartScenarios.length,
      studioSnapshotsRetained:true,videoStudioSnapshotsRetained:true,
      characterManifestUnchanged:true,fabricatorTreeUnchanged:true,characterManifestSha256:first.ownership.characterManifestSha256,
      fabricatorTreeSha256:first.ownership.fabricatorTreeSha256,restartComparisons},null,2))
    return
  }

  const api=code=>window.webContents.executeJavaScript(code)
  const model=await api('window.desktop.loadFabricatorSlot(1)')
  assert.ok(model&&model.parts.length>=10,'Authored AF13 must use the model created by the Entrega B UI test')
  const poses=await api('window.desktop.listFabricatorPoseSlots(1)')
  const poseMetadata=poses.filter(pose=>pose&&[1,2].includes(pose.slot))
  assert.equal(poseMetadata.length,2,'Authored AF13 requires the two UI-authored poses from Entrega B')
  const wardrobeSummary=(await api('window.desktop.listWardrobeSets(1)')).find(set=>set.name===AUTHORED_WARDROBE_NAME)
  assert.ok(wardrobeSummary,'Authored AF13 wardrobe must come from the real Roupas Dev UI save')
  const wardrobe=await api('window.desktop.loadWardrobeSet(1,'+JSON.stringify(wardrobeSummary.id)+')')
  assert.equal(wardrobe.components.length,9,'Authored AF13 requires camisa, coxas, canelas, sapatos e luvas created by UI')
  const partByName=name=>model.parts.find(part=>part.name.toLowerCase()===name.toLowerCase())
  const requiredTargets=['Tronco','Coxa esquerda','Coxa direita','Canela esquerda','Canela direita','Antebraço esquerdo','Antebraço direito']
  const bindings=wardrobe.components.map(component=>({id:component.id,category:component.category,partId:component.attachedPartId,
    partName:model.parts.find(part=>part.id===component.attachedPartId)?.name??null}))
  for(const target of requiredTargets)assert.ok(bindings.some(binding=>binding.partName===target),`Authored wardrobe is missing a valid binding to ${target}`)
  assert.equal(bindings.filter(binding=>binding.category==='sapato').length,2,'Both authored shoes must be present')
  assert.equal(bindings.filter(binding=>binding.category==='calca-coxa').length,2,'Both authored thigh pieces must be present')
  assert.equal(bindings.filter(binding=>binding.category==='calca-canela').length,2,'Both authored calf pieces must be present')
  let characters=await api('window.desktop.listCustomizerCharacters()')
  let actorA=characters.find(character=>character.name===AUTHORED_ACTOR_A)
  let actorB=characters.find(character=>character.name===AUTHORED_ACTOR_B)
  assert.ok(actorA&&actorB,'Authored AF13 requires the two real characters created through Customizer UI')
  const wardrobeIds=new Set(wardrobe.components.map(component=>component.id))
  for(const actor of [actorA,actorB]){
    assert.equal(actor.customization.modelSlot,1,`${actor.name} must inherit authored model 1`)
    assert.deepEqual(new Set(actor.customization.wardrobeGroups.filter(group=>group.setId===wardrobe.id).map(group=>group.componentId)),wardrobeIds,
      `${actor.name} must use every UI-authored wardrobe component`)
  }
  const withDefaults=character=>({...character,customization:{...character.customization,wardrobeGroups:character.customization.wardrobeGroups.map(group=>group.setId===wardrobe.id
    ?{...group,offsetX:0,offsetY:0,scaleX:1,scaleY:1,rotation:0}:group)}})
  actorA=withDefaults(actorA)
  await api('window.desktop.saveCustomizerCharacter('+JSON.stringify(actorA)+')')
  actorB=withDefaults(actorB)
  const leftThigh=wardrobe.components.find(component=>component.category==='calca-coxa'&&/esquerda/i.test(component.name))
  assert.ok(leftThigh,'Authored wardrobe lacks a named left thigh component for actor B override')
  const bThigh=actorB.customization.wardrobeGroups.find(group=>group.setId===wardrobe.id&&group.componentId===leftThigh.id)
  assert.ok(bThigh,'Actor B must have its own left thigh group')
  // Keep B visibly distinct while retaining knee coverage; the stronger displacement
  // belongs to actor A's dedicated off-body scenario below.
  Object.assign(bThigh,{offsetX:8,offsetY:0,scaleX:.98,rotation:1})
  await api('window.desktop.saveCustomizerCharacter('+JSON.stringify(actorB)+')')
  await window.webContents.executeJavaScript('location.hash="/opcoes"')
  await waitForDom(window,'Boolean(document.querySelector("main.blank-page"))','Authored AF13 remount after synthetic actor overrides')
  characters=await api('window.desktop.listCustomizerCharacters()')
  actorA=characters.find(character=>character.name===AUTHORED_ACTOR_A)
  actorB=characters.find(character=>character.name===AUTHORED_ACTOR_B)
  assert.equal(actorA.customization.wardrobeGroups.find(group=>group.setId===wardrobe.id&&group.category==='camisa').offsetX,0)
  assert.equal(actorB.customization.wardrobeGroups.find(group=>group.setId===wardrobe.id&&group.componentId===leftThigh.id).offsetX,8)
  const fabricatorBefore=treeHash(fabricatorPath)
  const scenarios=[]
  for(const scenario of [
    {id:'actor-a-factory-pose1',name:AUTHORED_ACTOR_A,poseSlot:1,category:'Parado',kind:'factory'},
    {id:'actor-a-factory-pose2',name:AUTHORED_ACTOR_A,poseSlot:2,category:'Sentado',kind:'factory'},
    {id:'actor-a-displaced-pose1',name:AUTHORED_ACTOR_A,poseSlot:1,category:'Parado',kind:'displaced'},
    {id:'actor-a-displaced-pose2',name:AUTHORED_ACTOR_A,poseSlot:2,category:'Sentado',kind:'displaced'},
    {id:'actor-b-own-override-pose1',name:AUTHORED_ACTOR_B,poseSlot:1,category:'Parado',kind:'actor-b'},
    {id:'actor-b-own-override-pose2',name:AUTHORED_ACTOR_B,poseSlot:2,category:'Sentado',kind:'actor-b'}
  ]){
    if(scenario.kind==='displaced'){
      actorA=(await api('window.desktop.listCustomizerCharacters()')).find(character=>character.name===AUTHORED_ACTOR_A)
      const shirt=wardrobe.components.find(component=>component.category==='camisa')
      const group=actorA.customization.wardrobeGroups.find(item=>item.setId===wardrobe.id&&item.componentId===shirt.id)
      Object.assign(group,{offsetX:220,scaleX:1.05,rotation:1})
      await api('window.desktop.saveCustomizerCharacter('+JSON.stringify(actorA)+')')
    }
    const customized=await authoredCustomizerCapture(window,scenario.name,scenario.poseSlot,scenario.category,folder,scenario.id)
    const currentCharacters=await api('window.desktop.listCustomizerCharacters()')
    const current=currentCharacters.find(character=>character.name===scenario.name)
    assert.equal(current.customization.poseSlot,scenario.poseSlot,`${scenario.id}: saved character pose differs`)
    const groups=current.customization.wardrobeGroups.filter(group=>group.setId===wardrobe.id)
    const scenarioCharHash=manifestHash()
    const scenarioFabricatorHash=treeHash(fabricatorPath)
    const studio=await authoredStageCapture(window,scenario.name,false,`AF13 ${scenario.id}`,folder,scenario.id)
    const videoStudio=await authoredStageCapture(window,scenario.name,true,`AF13 ${scenario.id}`,folder,scenario.id)
    assert.equal(manifestHash(),scenarioCharHash,`${scenario.id}: Studio/Video Studio modified Customizer character data`)
    assert.equal(treeHash(fabricatorPath),scenarioFabricatorHash,`${scenario.id}: Studio/Video Studio modified Fabricador libraries`)
    assert.equal(studio.characterId,current.id,`${scenario.id}: Studio points to another character`)
    assert.equal(videoStudio.characterId,current.id,`${scenario.id}: Video Studio points to another character`)
    const studioPng=readFileSync(join(folder,studio.imageName)),videoPng=readFileSync(join(folder,videoStudio.imageName))
    const compareStudio=screenshotComparison(customized.png,studioPng,{channelTolerance:3,maxChangedPixelRatio:.001})
    const compareVideo=screenshotComparison(customized.png,videoPng,{channelTolerance:3,maxChangedPixelRatio:.001})
    const compareStudios=screenshotComparison(studioPng,videoPng,{channelTolerance:3,maxChangedPixelRatio:.001})
    for(const [type,result] of [['customizer-vs-studio',compareStudio],['customizer-vs-video-studio',compareVideo],['studio-vs-video-studio',compareStudios]]){
      if(result.diffPng)await writeFile(join(folder,`${scenario.id}-${type}-diff.png`),result.diffPng)
      assert.equal(result.metrics.passed,true,`${scenario.id} ${type} differs: ${JSON.stringify(result.metrics)}`)
    }
    const markers=Object.fromEntries(wardrobe.components.map(component=>[component.id,dominantRgba(Buffer.from(component.dataUrl.split(',')[1],'base64'))]))
    const markerGeometry=Object.fromEntries(Object.entries(markers).map(([id,color])=>[id,{
      customizer:coloredBounds(customized.png,color),studio:coloredBounds(studioPng,color),videoStudio:coloredBounds(videoPng,color)}]))
    for(const [id,measured] of Object.entries(markerGeometry)){
      for(const consumer of ['customizer','studio','videoStudio'])assert.ok(measured[consumer].count>12&&measured[consumer].bounds,`${scenario.id}: garment component ${id} missing in ${consumer}`)
      assert.deepEqual(measured.studio.bounds,measured.customizer.bounds,`${scenario.id}: ${id} geometry shifted in Studio`)
      assert.deepEqual(measured.videoStudio.bounds,measured.customizer.bounds,`${scenario.id}: ${id} geometry shifted in Video Studio`)
    }
    if(scenario.kind==='actor-b'){
      const actorABaseline=scenarios.find(item=>item.id===`actor-a-factory-pose${scenario.poseSlot}`)
      assert.ok(actorABaseline,`${scenario.id}: actor A baseline for the same pose is missing`)
      assert.notDeepEqual(markerGeometry[leftThigh.id].customizer.bounds,
        actorABaseline.markerGeometry[leftThigh.id].customizer.bounds,
        `${scenario.id}: actor B override did not change its own left thigh geometry`)
    }
    const pieceByBone=bone=>wardrobe.components.find(component=>component.attachedPartId===model.parts.find(part=>part.name===bone)?.id)
    const kneeCoverage={}
    for(const side of ['esquerda','direita']){
      const thigh=pieceByBone(`Coxa ${side}`),calf=pieceByBone(`Canela ${side}`)
      const thighBounds=markerGeometry[thigh.id].customizer.bounds,calfBounds=markerGeometry[calf.id].customizer.bounds
      const overlapY=Math.min(thighBounds.y+thighBounds.height,calfBounds.y+calfBounds.height)-Math.max(thighBounds.y,calfBounds.y)
      const overlapX=Math.min(thighBounds.x+thighBounds.width,calfBounds.x+calfBounds.width)-Math.max(thighBounds.x,calfBounds.x)
      kneeCoverage[side]={thighId:thigh.id,calfId:calf.id,projectedOverlapX:overlapX,projectedOverlapY:overlapY,
        projectedBoundsIntersect:overlapX>0&&overlapY>0}
      assert.equal(kneeCoverage[side].projectedBoundsIntersect,true,`${scenario.id}: no projected garment overlap at ${side} knee`)
    }
    scenarios.push({id:scenario.id,characterName:scenario.name,characterId:current.id,poseSlot:scenario.poseSlot,
      outfitState:scenario.kind==='factory'?'fabricator-default-fit':scenario.kind==='displaced'?'character-shirt-displaced':'character-left-thigh-overridden',
      characterCustomizationSha256:createHash('sha256').update(JSON.stringify(current.customization)).digest('hex'),
      customizer:{sha256:customized.sha256,size:customized.size,alphaBounds:customized.alphaBounds,layers:customized.layers,
        stageScreenshotSha256:customized.fullScreenshotSha256},
      studio,videoStudio,comparisons:{customizerVsStudio:compareStudio.metrics,customizerVsVideoStudio:compareVideo.metrics,
        studioVsVideoStudio:compareStudios.metrics},markerGeometry,kneeCoverage,
      immutableSources:{characterManifestSha256:scenarioCharHash,fabricatorTreeSha256:scenarioFabricatorHash}})
  }
  const characterManifestSha256=manifestHash(),fabricatorTreeSha256=treeHash(fabricatorPath)
  assert.equal(fabricatorTreeSha256,fabricatorBefore,'AF13 consumer scenarios altered the authored Fabricador libraries')
  const report={schemaVersion:1,status:'passed',adapter:'production-React+preload+Electron-IPC',fixtureSource:'model/poses/wardrobe/characters actually authored by asset-ui-authoring.cjs through the UI',
    scenarioCount:scenarios.length,scenarios,sourceAssets:{modelSlot:model.slot,modelPartIds:model.parts.map(part=>part.id),poseSlots:poseMetadata.map(pose=>pose.slot),
      wardrobeSetId:wardrobe.id,componentBindings:bindings,componentCount:wardrobe.components.length,
      includesHairOrHeadAccessories:false,reason:'Entrega B UI fixture authors clothing/model/poses; it does not publish hair or head-accessory assets'},
    ownership:{studioAndVideoDidNotModifyCharacters:true,studioAndVideoDidNotModifyFabricador:true,
      actorAAndActorBIndependent:true,characterManifestSha256,fabricatorTreeSha256},
    comparisonPolicy:{channelTolerance:3,maxChangedPixelRatio:.001,characterImagesComparedAtNativeResolution:true,alphaTrimOnly:true},
    caveats:['Studio and Video Studio preserve character images as scene snapshots; these tests prove source capture and snapshot persistence, not automatic live refresh of an already captured scene after later Customizer edits.',
      'The synthetic model has rectangular separated parts; knee overlap reports are projected bounds, not a pixel-level skin-visibility oracle for arbitrary real body art.']}
  await writeFile(join(folder,'report.json'),JSON.stringify(report,null,2))
  return report
}

async function privateCharacterPreview(window) {
  const characters = await window.webContents.executeJavaScript('window.desktop.listCustomizerCharacters()')
  const selected = ['Ayla', 'Chloe'].map(name => {
    const matches = characters.filter(character => character.name === name)
    assert.equal(matches.length, 1, `A cópia privada deve conter exatamente um personagem ${name}`)
    return matches[0]
  })
  const customizerManifestPath = join(sandbox, 'customizer', 'characters', 'characters.json')
  const characterManifestHashBefore = createHash('sha256').update(readFileSync(customizerManifestPath)).digest('hex')
  const fabricatorHashBefore = treeHash(join(sandbox, 'fabricator'))
  const networkBarrier = await verifyRendererNetworkBlock(window)
  await window.webContents.executeJavaScript('location.hash = "/customizar"')
  const routeDeadline = Date.now() + 30_000
  while (Date.now() < routeDeadline) {
    if (await window.webContents.executeJavaScript('Boolean(document.querySelector(".home-layout"))')) break
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
  }
  assert.equal(await window.webContents.executeJavaScript('Boolean(document.querySelector(".home-layout"))'), true,
    'A rota Customizador não carregou na cópia privada')

  const actorResults = []
  for (const character of selected) {
    const expectedAboveHair = (await Promise.all((character.customization.wardrobeGroups ?? []).map(group =>
      window.webContents.executeJavaScript(`(async()=>{const s=await window.desktop.loadWardrobeSet(${Number(group.modelSlot)},${JSON.stringify(group.setId)});return Boolean(s?.components?.some(c=>c.id===${JSON.stringify(group.componentId)}&&c.renderAboveHair===true))})()`)))).some(Boolean)
    const expectedLayers = {
      wardrobe: (character.customization.wardrobeGroups ?? []).length > 0,
      face: Boolean(character.customization.faceAppearance && (
        Object.values(character.customization.faceAppearance.components ?? {}).some(component => Boolean(component?.assetId))
        || Object.values(character.customization.faceAppearance.headExtras ?? {}).some(Boolean)
        || character.customization.faceAppearance.eyeCatalogId || character.customization.faceAppearance.eyebrowCatalogId
        || character.customization.faceAppearance.noseCatalogId || character.customization.faceAppearance.mouthClosedCatalogId
        || character.customization.faceAppearance.mouthOpenCatalogId)),
      frontHair: Object.values(character.customization.hairAppearance?.parts ?? {}).some(id => typeof id === 'string'),
      aboveHair: expectedAboveHair
    }
    const capture = await window.webContents.executeJavaScript(`(async()=>{
      const name=${JSON.stringify(character.name)}
      const expectedLayers=${JSON.stringify(expectedLayers)}
      const deadline=Date.now()+45000
      let card=null
      while(Date.now()<deadline){
        card=[...document.querySelectorAll('.character-card')].find(item=>item.textContent.includes(name))
        if(card)break
        await new Promise(resolve=>setTimeout(resolve,100))
      }
      if(!card)return {status:'missing-character-card',name}
      card.click()
      while(Date.now()<deadline){
        const selected=(document.querySelector('.customizer-preview-character-name')?.textContent||'').trim()
        const model=document.querySelector('.customizer-selected-artwork')
        const ready=(selector)=>{const image=document.querySelector(selector);return Boolean(image?.complete&&image.naturalWidth)}
        const layersReady=(!expectedLayers.wardrobe||ready('.customizer-wardrobe-overlay'))
          &&(!expectedLayers.face||ready('.customizer-face-overlay'))
          &&(!expectedLayers.frontHair||ready('.customizer-front-hair-overlay'))
          &&(!expectedLayers.aboveHair||ready('.customizer-wardrobe-above-hair-overlay'))
        if(selected===name&&model?.complete&&model.naturalWidth&&layersReady)break
        await new Promise(resolve=>setTimeout(resolve,120))
      }
      const selectedName=(document.querySelector('.customizer-preview-character-name')?.textContent||'').trim()
      const selectors=[
        ['model','.customizer-selected-artwork'],
        ['wardrobe','.customizer-wardrobe-overlay'],
        ['face','.customizer-face-overlay'],
        ['frontHair','.customizer-front-hair-overlay'],
        ['aboveHair','.customizer-wardrobe-above-hair-overlay']
      ]
      const entries=selectors.map(([key,selector])=>[key,document.querySelector(selector)])
      const model=entries.find(([key])=>key==='model')?.[1]
      if(selectedName!==name||!model?.complete||!model.naturalWidth)return {status:'preview-not-ready',name,selectedName}
      await Promise.all(entries.map(async([,image])=>{if(image?.decode){try{await image.decode()}catch{}}}))
      const layers=entries.filter(([,image])=>image?.complete&&image.naturalWidth)
      const canvas=document.createElement('canvas')
      canvas.width=model.naturalWidth;canvas.height=model.naturalHeight
      const context=canvas.getContext('2d')
      context.fillStyle='#f6f5f8';context.fillRect(0,0,canvas.width,canvas.height)
      for(const [,image] of layers)context.drawImage(image,0,0,canvas.width,canvas.height)
      const layerStatus=Object.fromEntries(selectors.map(([key])=>{
        const image=entries.find(([entryKey])=>entryKey===key)?.[1]
        return [key,Boolean(image?.complete&&image.naturalWidth)]
      }))
      const missingExpectedLayers=Object.entries(expectedLayers).filter(([key,expected])=>expected&&!layerStatus[key]).map(([key])=>key)
      return {
        status:missingExpectedLayers.length?'missing-expected-layer':'captured',name,selectedName,
        dimensions:{width:canvas.width,height:canvas.height},
        layers:layerStatus,missingExpectedLayers,
        alerts:[...document.querySelectorAll('[role=alert]')].map(item=>item.textContent.trim()).filter(Boolean),
        dataUrl:canvas.toDataURL('image/png')
      }
    })()`)
    if (capture.dataUrl?.startsWith('data:image/png;base64,')) {
      const imageName = `${character.name.toLowerCase()}-customizer-canonical.png`
      await writeFile(join(output, imageName), Buffer.from(capture.dataUrl.slice('data:image/png;base64,'.length), 'base64'))
    }
    if (capture.status !== 'captured') {
      actorResults.push({ name: character.name, id: character.id, status: capture.status,
        modelSlot: character.customization.modelSlot, poseSlot: character.customization.poseSlot,
        missingExpectedLayers: capture.missingExpectedLayers ?? [] })
      continue
    }
    const imageName = `${character.name.toLowerCase()}-customizer-canonical.png`
    const groups = character.customization.wardrobeGroups ?? []
    const adjustedGroups = groups.filter(group => group.offsetX !== 0 || group.offsetY !== 0
      || group.scaleX !== 1 || group.scaleY !== 1 || group.rotation !== 0)
    actorResults.push({
      name: character.name, id: character.id, status: 'captured',
      modelSlot: character.customization.modelSlot, poseSlot: character.customization.poseSlot,
      wardrobeGroupCount: groups.length, adjustedWardrobeGroupCount: adjustedGroups.length,
      adjustedWardrobeGroups: adjustedGroups.map(group => ({ category: group.category,
        componentId: group.componentId, setId: group.setId,
        offsetX: group.offsetX, offsetY: group.offsetY, scaleX: group.scaleX, scaleY: group.scaleY, rotation: group.rotation })),
      partOverrideCount: Object.keys(character.customization.partOverrides ?? {}).length,
      hairPartIds: Object.entries(character.customization.hairAppearance?.parts ?? {})
        .filter(([, id]) => typeof id === 'string').map(([partId]) => partId),
      faceComponentCount: Object.values(character.customization.faceAppearance?.components ?? {})
        .filter(component => Boolean(component?.assetId)).length,
      layers: capture.layers, dimensions: capture.dimensions,
      alerts: capture.alerts, screenshot: imageName
    })
  }
  const characterManifestHashAfter = createHash('sha256').update(readFileSync(customizerManifestPath)).digest('hex')
  const fabricatorHashAfter = treeHash(join(sandbox, 'fabricator'))
  const noPersistentWrites = characterManifestHashBefore === characterManifestHashAfter
    && fabricatorHashBefore === fabricatorHashAfter
  const report = { schemaVersion: 1, adapter: 'local-private-copy-production-customizer',
    status: actorResults.length === 2 && actorResults.every(actor => actor.status === 'captured')
      && noPersistentWrites && networkBarrier.status === 'passed' ? 'passed' : 'failed',
    privacy: { userProfileWritten: false, testCopyOnly: true, outputOutsideRepository: true,
      networkBarrier, noPersistentWrites },
    hashes: { characterManifestBefore: characterManifestHashBefore, characterManifestAfter: characterManifestHashAfter,
      fabricatorBefore: fabricatorHashBefore, fabricatorAfter: fabricatorHashAfter },
    actors: actorResults,
    limitations: ['A inspeção usa somente a cópia privada validada.',
      'A captura inclui apenas as camadas canônicas do personagem, não a janela ou a lista de personagens.'] }
  await writeFile(join(output, 'private-character-preview.json'), JSON.stringify(report, null, 2))
  assert.equal(noPersistentWrites, true, 'Preview privado alterou o personagem ou biblioteca Fabricador da cópia')
  assert.equal(report.status, 'passed', `Preview dos personagens privados falhou: ${JSON.stringify(report)}`)
  console.log(JSON.stringify({ mode, status: report.status, actors: actorResults.map(actor => ({
    name: actor.name, modelSlot: actor.modelSlot, poseSlot: actor.poseSlot,
    wardrobeGroupCount: actor.wardrobeGroupCount, adjustedWardrobeGroupCount: actor.adjustedWardrobeGroupCount,
    layerStatus: actor.layers, screenshot: actor.screenshot
  })), noPersistentWrites }))
}

async function privateCharacterEdit(window) {
  const name = process.env.GACHA_DEV_AI_PRIVATE_TARGET
  assert.ok(['Ayla', 'Chloe'].includes(name), 'Personagem alvo privado inválido')
  const beforeList = await window.webContents.executeJavaScript('window.desktop.listCustomizerCharacters()')
  const targetMatches = beforeList.filter(character => character.name === name)
  assert.equal(targetMatches.length, 1, `A cópia privada deve conter exatamente um personagem ${name}`)
  const targetBefore = targetMatches[0]
  const otherBefore = beforeList.find(character => character.name !== name)
  assert.ok(otherBefore && ['Ayla', 'Chloe'].includes(otherBefore.name))
  const groupIndex = (targetBefore.customization.wardrobeGroups ?? []).findIndex(group =>
    group.componentId && !group.hidden && group.modelSlot === targetBefore.customization.modelSlot)
  assert.ok(groupIndex >= 0, `${name} não tem um grupo equipado para testar o ajuste individual`)
  const manifestPath = join(sandbox, 'customizer', 'characters', 'characters.json')
  const manifestHashBefore = createHash('sha256').update(readFileSync(manifestPath)).digest('hex')
  const fabricatorHashBefore = treeHash(join(sandbox, 'fabricator'))
  const expected = structuredClone(targetBefore)
  const group = expected.customization.wardrobeGroups[groupIndex]
  const offsetXBefore = group.offsetX ?? 0
  group.offsetX = offsetXBefore + 5
  expected.updatedAt = new Date().toISOString()
  const saved = await window.webContents.executeJavaScript(`window.desktop.saveCustomizerCharacter(${JSON.stringify(expected)})`)
  assert.notEqual(saved, false, 'IPC rejeitou o salvamento do personagem de teste')
  const afterList = await window.webContents.executeJavaScript('window.desktop.listCustomizerCharacters()')
  const targetAfter = afterList.find(character => character.name === name)
  const otherAfter = afterList.find(character => character.name === otherBefore.name)
  assert.ok(targetAfter && otherAfter)
  assert.equal(targetAfter.customization.wardrobeGroups[groupIndex].offsetX, offsetXBefore + 5)
  const expectedAfter = structuredClone(expected)
  expectedAfter.updatedAt = targetAfter.updatedAt
  assert.deepEqual(stableData(targetAfter), stableData(expectedAfter),
    `${name}: save IPC alterou dados além do transform individual solicitado`)
  assert.deepEqual(stableData(otherAfter), stableData(otherBefore),
    `${name}: salvar este personagem também alterou o outro personagem`)
  const manifestHashAfter = createHash('sha256').update(readFileSync(manifestPath)).digest('hex')
  const fabricatorHashAfter = treeHash(join(sandbox, 'fabricator'))
  assert.notEqual(manifestHashAfter, manifestHashBefore, 'O salvamento IPC não alterou o manifest privado do personagem')
  assert.equal(fabricatorHashAfter, fabricatorHashBefore, 'O ajuste individual alterou a biblioteca Fabricador')
  const report = { schemaVersion: 1, status: 'passed', operation: 'production-preload customizer save IPC',
    actor: name, otherActor: otherBefore.name, groupIndex, category: group.category,
    componentId: group.componentId, offsetXBefore, offsetXAfter: offsetXBefore + 5,
    otherActorUnchanged: true, fabricatorUnchanged: true,
    characterManifestHashBefore: manifestHashBefore, characterManifestHashAfter: manifestHashAfter }
  await writeFile(join(output, 'private-character-edit.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
}

async function privateCharacterVerifyEdits(window) {
  const expected = JSON.parse(process.env.GACHA_DEV_AI_PRIVATE_EXPECTED_EDITS ?? '{}')
  assert.deepEqual(Object.keys(expected).sort(), ['Ayla', 'Chloe'])
  const characters = await window.webContents.executeJavaScript('window.desktop.listCustomizerCharacters()')
  const actual = {}
  for (const name of ['Ayla', 'Chloe']) {
    const matches = characters.filter(character => character.name === name)
    assert.equal(matches.length, 1, `A cópia privada deve conter exatamente um personagem ${name}`)
    const character = matches[0]
    const group = character.customization.wardrobeGroups?.find(item => item.setId === expected[name].setId
      && item.componentId === expected[name].componentId && item.category === expected[name].category)
    assert.ok(group, `${name}: grupo ajustado não persistiu após reiniciar o processo Electron`)
    assert.equal(group.offsetX, expected[name].offsetX,
      `${name}: offset individual não persistiu após reiniciar o processo Electron`)
    actual[name] = { groupIndex: character.customization.wardrobeGroups.indexOf(group),
      category: group.category, setId: group.setId, componentId: group.componentId,
      offsetX: group.offsetX, updatedAt: character.updatedAt }
  }
  const fabricatorHash = treeHash(join(sandbox, 'fabricator'))
  assert.equal(fabricatorHash, process.env.GACHA_DEV_AI_PRIVATE_EXPECTED_FABRICATOR_HASH,
    'Fabricador mudou entre salvamento e reabertura do teste privado')
  const report = { schemaVersion: 1, status: 'passed', restartedElectronProcess: true,
    actorOverridesPersisted: actual, fabricatorUnchanged: true, fabricatorHash }
  await writeFile(join(output, 'private-character-edit-restart.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ mode, status: report.status, restartedElectronProcess: true,
    actors: Object.fromEntries(Object.entries(actual).map(([name, item]) => [name, { category: item.category, offsetX: item.offsetX }])),
    fabricatorUnchanged: true }))
}

async function areaSmoke(window) {
  const diagnostics = []
  const rendererNetworkBarrier = await verifyRendererNetworkBlock(window)
  window.webContents.on('render-process-gone', (_event, details) => diagnostics.push({ type: 'gone', reason: details.reason, exitCode: details.exitCode }))
  window.webContents.on('console-message', (_event, ...args) => {
    const details = args[0]
    const level = details && typeof details === 'object' ? details.level : details
    const message = details && typeof details === 'object' ? details.message : args[1]
    if (Number(level) >= 2) diagnostics.push({ type: 'console', message: String(message ?? '').slice(0, 500) })
  })
  const route = async (hash, selector, label) => {
    await window.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`)
    const started = Date.now()
    while (Date.now() - started < 20_000) {
      const ready = await window.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)
      if (ready) {
        await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        const state = await window.webContents.executeJavaScript(`({ready: Boolean(document.querySelector(${JSON.stringify(selector)})), bodyLength: document.body?.innerText?.length ?? 0, error: document.querySelector('[role="alert"]')?.innerText ?? null})`)
        assert.equal(state.ready, true)
        assert.equal(state.error, null, `${label} exibiu erro: ${state.error}`)
        return { label, route: hash, durationMs: Date.now() - started, ready: true, bodyLength: state.bodyLength }
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    const state = await window.webContents.executeJavaScript(`({route: location.hash, body: (document.body?.innerText ?? '').slice(0,1000), error: document.querySelector('[role="alert"]')?.innerText ?? null})`)
    throw new Error(`${label} não montou: ${JSON.stringify(state)}; diagnostics=${JSON.stringify(diagnostics.slice(-8))}`)
  }
  const navigationSaveId = '4f50a2e4-7da4-4e28-9566-63dbf9403004'
  const navigationDocuments = Array.from({ length: 40 }, (_, index) => ({
    ...syntheticStudio(`Navigation save ${index + 1}`), id: navigationSaveId
  }))
  const videoFolder = await window.webContents.executeJavaScript('window.desktop.getVideoStudioFolder()')
  const videoBeforeNavigationSaves = treeHash(videoFolder)
  const launchedNavigationSaves = await window.webContents.executeJavaScript(`(() => {
    window.__devAiNavigationSaves = ${JSON.stringify(navigationDocuments)}.map(document => {
      const tracked = { settled: false, error: null }
      tracked.promise = window.desktop.saveStudio(document).then(
        () => { tracked.settled = true },
        error => { tracked.error = String(error?.message ?? error); tracked.settled = true }
      )
      return tracked
    })
    return true
  })()`)
  assert.equal(launchedNavigationSaves, true)
  await window.webContents.executeJavaScript('Promise.all(window.__devAiNavigationSaves.slice(0, 3).map(entry => entry.promise))')
  const navigationPendingAtRouteChange = await window.webContents.executeJavaScript('window.__devAiNavigationSaves.filter(entry => !entry.settled).length')
  assert.ok(navigationPendingAtRouteChange > 0, 'O teste de navegação precisa iniciar com salvamentos pendentes')
  const customizer = await route('/customizar', '.home-layout', 'Customizer')
  const customizerRasterPose1 = await verifyCustomizerRasterPreview(window,'pose1')
  // Actual renderer+IPC test: switch both actors to pose 2 while preserving
  // equipment and actor-specific transforms, so geometry remains comparable.
  // Navigate away/back to force fresh document hydration (not a cached mock).
  const fabricatorBeforePoseChange=treeHash(join(app.getPath('userData'),'fabricator'))
  const actorsToPose = (await window.webContents.executeJavaScript('window.desktop.listCustomizerCharacters()'))
    .filter(actor => ['DEV AI Actor A','DEV AI Actor B'].includes(actor.name))
  assert.equal(actorsToPose.length,2,'Os dois personagens sintéticos precisam existir antes da pose 2')
  await Promise.all(actorsToPose.map(actor=>window.webContents.executeJavaScript(`window.desktop.saveCustomizerCharacter(${JSON.stringify({
    ...actor,customization:{...actor.customization,poseSlot:2}
  })})`)))
  assert.equal(treeHash(join(app.getPath('userData'),'fabricator')),fabricatorBeforePoseChange,
    'Changing the Customizer character pose altered Fabricador assets')
  await route('/opcoes','main.blank-page','Opções / renderer reset')
  await route('/customizar','.home-layout','Customizer pose 2')
  const customizerRasterPose2 = await verifyCustomizerRasterPreview(window,'pose2')
  const rasterScreenshots=join(output,'raster-asset-flow')
  const aPixels=readFileSync(join(rasterScreenshots,'customizer-actor-a-canonical-pose1.png'))
  const bPixels=readFileSync(join(rasterScreenshots,'customizer-actor-a-canonical-pose2.png'))
  const difference=screenshotComparison(aPixels,bPixels,{channelTolerance:3,maxChangedPixelRatio:0})
  await writeFile(join(rasterScreenshots,'pose-1-vs-2-diff.png'),difference.diffPng)
  const poseOutcome=expectedPoseDifference(difference.metrics.changedPixelRatio,0.005)
  const geometryWithinTolerance=customizerRasterPose1.geometryWithinTolerance&&customizerRasterPose2.geometryWithinTolerance
  const poseReport={schemaVersion:2,comparison:'expected-pose-change',...poseOutcome,geometryWithinTolerance,
    visualDifference:{changedPixels:difference.metrics.changedPixels,
      changedPixelRatio:difference.metrics.changedPixelRatio,changeBounds:difference.metrics.changeBounds,
      channelTolerance:difference.metrics.channelTolerance}}
  await writeFile(join(rasterScreenshots,'pose-comparison.json'),JSON.stringify(poseReport,null,2))
  assert.equal(poseOutcome.passed,true,
    'Pose 2 deve alterar visualmente o modelo, preservando o pré-ajuste de roupas/cabelo')
  assert.equal(geometryWithinTolerance,true,'Bindings, transformações de cabelo ou acessório saíram da tolerância')
  assert.equal(treeHash(join(app.getPath('userData'),'fabricator')),fabricatorBeforePoseChange)
  const customizerRasterRender={pose1:customizerRasterPose1,pose2:customizerRasterPose2,
    poseChangedWithoutSourceWrites:true,poseComparison:poseReport,geometryWithinTolerance}
  await window.webContents.executeJavaScript('Promise.all(window.__devAiNavigationSaves.map(entry => entry.promise))')
  const navigationSaveErrors = await window.webContents.executeJavaScript('window.__devAiNavigationSaves.filter(entry => entry.error).map(entry => entry.error)')
  assert.deepEqual(navigationSaveErrors, [])
  const normalAfterNavigationSaves = await window.webContents.executeJavaScript('window.desktop.listStudios()')
  assert.equal(normalAfterNavigationSaves.length, 2)
  assert.equal(normalAfterNavigationSaves.find(document => document.id === '4f50a2e4-7da4-4e28-9566-63dbf9403004')?.title,
    'Navigation save 40', 'A navegação cancelou ou perdeu salvamentos pendentes do Studio')
  await window.webContents.executeJavaScript("window.desktop.deleteStudio('4f50a2e4-7da4-4e28-9566-63dbf9403004')")
  assert.equal(treeHash(videoFolder), videoBeforeNavigationSaves, 'Navegar/salvar no Studio contaminou o Video Studio')
  const characters = await window.webContents.executeJavaScript('window.desktop.listCustomizerCharacters()')
  assert.ok(Array.isArray(characters))
  const fabricator = await route('/fabricador-dev', '.fabricator-layout', 'Fabricador Dev')
  const slots = await window.webContents.executeJavaScript('window.desktop.listFabricatorSlots()')
  assert.ok(Array.isArray(slots) && slots.length === 10)
  const modelWorkspace = await route('/fabricador-dev', '.fabricator-model-editor', 'Fabricador modelos')
  // Options is intentionally a placeholder today. Verify its route mounts
  // without a renderer error, but don't call this an editing/persistence test.
  const options = await route('/opcoes', '[aria-label="Opções"]', 'Opções')
  const optionsPlaceholder = await window.webContents.executeJavaScript(
    'Boolean(document.querySelector("main.blank-page[aria-label=\\\"Opções\\\"]"))'
  )
  assert.equal(optionsPlaceholder, true, 'A área Opções deixou de montar o placeholder esperado')
  const openEditor = async (normal) => {
    const hash = normal ? '/estudio' : '/video-studio'
    const cardSelector = normal ? '.studio-card-open' : '.video-studio-card-open'
    const editorSelector = normal ? '.studio-editor' : '.video-studio-editor'
    const started = performance.now()
    try {
      const snapshot = await window.webContents.executeJavaScript(`(async () => {
        const navigationStartedAt = performance.now()
        const waitFor = selector => new Promise((resolve, reject) => {
          let settled = false
          const observer = new MutationObserver(check)
          const timer = setTimeout(() => finish(new Error('Timed out esperando ' + selector)), 20000)
          function finish(error, element) {
            if (settled) return
            settled = true
            clearTimeout(timer)
            observer.disconnect()
            if (error) reject(error)
            else resolve(element)
          }
          function check() {
            const element = document.querySelector(selector)
            if (element) finish(null, element)
          }
          observer.observe(document.documentElement, { childList: true, subtree: true })
          check()
        })
        const waitForWorkspaceState = (normal, editorSelector) => new Promise((resolve, reject) => {
          let settled = false
          const timer = setTimeout(() => finish(new Error('Timed out esperando o estado final do workspace')), 20000)
          const observer = new MutationObserver(check)
          function finish(error) {
            if (settled) return
            settled = true
            clearTimeout(timer)
            observer.disconnect()
            if (error) reject(error)
            else resolve(true)
          }
          function check() {
            const editorReady = Boolean(document.querySelector(editorSelector))
            const topBarReady = Boolean(document.querySelector('.top-bar')) === normal
            const timelineReady = Boolean(document.querySelector('.video-timeline')) === !normal
            if (editorReady && topBarReady && timelineReady) finish(null)
          }
          observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true })
          check()
        })
        location.hash = ${JSON.stringify(hash)}
        const card = await waitFor(${JSON.stringify(cardSelector)})
        const libraryReadyAt = performance.now()
        card.click()
        const editor = await waitFor(${JSON.stringify(editorSelector)})
        await waitForWorkspaceState(${normal}, ${JSON.stringify(editorSelector)})
        const editorReadyAt = performance.now()
        const prefix = ${JSON.stringify(normal ? 'studio' : 'video-studio')}
        const canvas = document.querySelector('.' + prefix + '-scene-canvas')
        const style = getComputedStyle(editor)
        const rect = canvas?.getBoundingClientRect()
        return { missingEditor: !editor, missingCanvas: !canvas, hash: location.hash,
          rendererTimingsMs: { routeToLibrary: libraryReadyAt - navigationStartedAt,
            libraryToEditor: editorReadyAt - libraryReadyAt,
            routeToEditorReady: editorReadyAt - navigationStartedAt },
          columns: style.gridTemplateColumns, rows: style.gridTemplateRows,
          canvas: rect ? [Math.round(rect.width * 100) / 100, Math.round(rect.height * 100) / 100] : null,
          topBar: Boolean(document.querySelector('.top-bar')),
          timeline: Boolean(document.querySelector('.video-timeline')),
          toolbarButtonCount: document.querySelectorAll('.' + prefix + '-tool-button').length }
      })()`)
      assert.equal(snapshot.missingEditor, false, `${hash}: editor ausente no snapshot`)
      assert.equal(snapshot.missingCanvas, false, `${hash}: canvas ausente no snapshot`)
      assert.equal(snapshot.hash, `#${hash}`)
      assert.equal(snapshot.topBar, normal, `Topbar incorreta em ${hash}`)
      assert.equal(snapshot.timeline, !normal, `Timeline incorreta em ${hash}`)
      const { rendererTimingsMs, ...stableSnapshot } = snapshot
      return { durationMs: performance.now() - started, snapshot: stableSnapshot, rendererTimingsMs }
    } catch (error) {
      throw new Error(`Editor ${hash} falhou ao navegar/abrir/inspecionar: ${error?.stack ?? error}`)
    }
  }
  const studioBefore = await openEditor(true)
  const memoryBeforeNavigation = app.getAppMetrics().map(metric => ({
    processType: metric.type, workingSetSizeKb: metric.memory?.workingSetSize ?? null
  }))
  const navigationDurations = []
  const navigationPhaseDurations = { routeToLibrary: [], libraryToEditor: [], routeToEditorReady: [] }
  // One alternation is one route change. 50 Studio↔Video pairs = 100
  // direction changes, matching ISO-01's 100 alternations requirement.
  const roundTrips = 50
  let videoBefore = null
  const stableBefore = await captureSettled(window, 'studio-before')
  await writeFile(join(output, 'real-ipc-studio-before-roundtrips.png'), stableBefore.png)
  assert.equal(stableBefore.settled, true,
    `A captura inicial não estabilizou: ${JSON.stringify(stableBefore.temporalComparison)}`)
  for (let cycle = 0; cycle < roundTrips; cycle += 1) {
    const videoOpen = await openEditor(false)
    navigationDurations.push(videoOpen.durationMs)
    for (const [phase, duration] of Object.entries(videoOpen.rendererTimingsMs)) navigationPhaseDurations[phase].push(duration)
    if (videoBefore === null) videoBefore = videoOpen.snapshot
    else assert.deepEqual(videoOpen.snapshot, videoBefore, `Video Studio mudou na rodada ${cycle + 1}`)
    const studioOpen = await openEditor(true)
    navigationDurations.push(studioOpen.durationMs)
    for (const [phase, duration] of Object.entries(studioOpen.rendererTimingsMs)) navigationPhaseDurations[phase].push(duration)
    assert.deepEqual(studioOpen.snapshot, studioBefore.snapshot, `Studio normal mudou após a rodada ${cycle + 1}`)
    if ((cycle + 1) % 5 === 0) {
      await writeFile(join(output, 'real-ipc-navigation-progress.json'), JSON.stringify({
        completedRoundTrips: cycle + 1, totalRoundTrips: roundTrips, status: 'running'
      }, null, 2))
    }
  }
  const memoryAfterNavigation = app.getAppMetrics().map(metric => ({
    processType: metric.type, workingSetSizeKb: metric.memory?.workingSetSize ?? null
  }))
  const stableAfter = await captureSettled(window, 'studio-after')
  const beforePng = stableBefore.png
  const afterPng = stableAfter.png
  await writeFile(join(output, 'real-ipc-studio-after-roundtrips.png'), afterPng)
  const beforeScreenshotSha256 = createHash('sha256').update(beforePng).digest('hex')
  const afterScreenshotSha256 = createHash('sha256').update(afterPng).digest('hex')
  const visual = screenshotComparison(beforePng, afterPng,
    { channelTolerance: 3, maxChangedPixelRatio: 0.001 })
  const visualReport = {
    schemaVersion: 1, baseline: 'real Electron IPC synthetic fixtures',
    policy: { channelTolerance: 3, maxChangedPixelRatio: 0.001 },
    stableBefore: { settled: stableBefore.settled, attempts: stableBefore.attempts,
      temporalComparison: stableBefore.temporalComparison },
    stableAfter: { settled: stableAfter.settled, attempts: stableAfter.attempts,
      temporalComparison: stableAfter.temporalComparison },
    screenshotSha256: { before: beforeScreenshotSha256, after: afterScreenshotSha256,
      exactMatch: beforeScreenshotSha256 === afterScreenshotSha256 },
    comparison: visual.metrics
  }
  if (visual.diffPng) await writeFile(join(output, 'real-ipc-studio-visual-diff.png'), visual.diffPng)
  // Diagnostics precede assertions, so failing Actions runs remain debuggable.
  await writeFile(join(output, 'real-ipc-visual-comparison.json'), JSON.stringify(visualReport, null, 2))
  assert.equal(stableAfter.settled, true,
    `Captura final não estabilizou: ${JSON.stringify(stableAfter.temporalComparison)}`)
  assert.equal(visual.metrics.passed, true,
    `Regressão visual após 100 transições: ${JSON.stringify(visual.metrics)}`)

  // AF-13: same persisted synthetic actor, reopened in each real editor. The
  // final image source comes from each editor's production cast pipeline.
  const af13Dir=join(output,'af13')
  await mkdir(af13Dir,{recursive:true})
  const af13Normal={...syntheticStudio('DEV AI AF13 Studio'),id:AF13_STUDIO_ID}
  const af13Video={...syntheticStudio('DEV AI AF13 Video',true),id:AF13_VIDEO_ID}
  await window.webContents.executeJavaScript(`window.desktop.saveStudio(${JSON.stringify(af13Normal)})`)
  await window.webContents.executeJavaScript(`window.desktop.saveVideoStudio(${JSON.stringify(af13Video)})`)
  const openAf13=async(normal)=>{
    const title=normal?'DEV AI AF13 Studio':'DEV AI AF13 Video'
    const hash=normal?'/estudio':'/video-studio'
    const cardSelector=normal?'.studio-card-open':'.video-studio-card-open'
    const editorSelector=normal?'.studio-editor':'.video-studio-editor'
    await route('/opcoes','main.blank-page','AF13 remount')
    await window.webContents.executeJavaScript(`location.hash=${JSON.stringify(hash)}`)
    await window.webContents.executeJavaScript(`(async()=>{const end=Date.now()+20000;while(Date.now()<end){
      const card=[...document.querySelectorAll(${JSON.stringify(cardSelector)})].find(e=>e.textContent.includes(${JSON.stringify(title)}));
      if(card){card.click();break} await new Promise(r=>setTimeout(r,100))} })()`)
    await window.webContents.executeJavaScript(`(async()=>{const end=Date.now()+20000;while(Date.now()<end){
      if(document.querySelector(${JSON.stringify(editorSelector)}))return true;await new Promise(r=>setTimeout(r,100))}
      throw Error('AF13 editor timeout: '+${JSON.stringify(title)})})()`)
    await window.webContents.executeJavaScript(`(async()=>{const end=Date.now()+20000;while(Date.now()<end){
      const button=document.querySelector(${JSON.stringify(normal?'.studio-cast-add-button':'.video-studio-cast-tool-button')});
      if(button){button.click();return true}await new Promise(r=>setTimeout(r,100))}throw Error('AF13 cast button timeout')})()`)
    const modal=normal?'.studio-cast-modal':'.video-studio-cast-modal'
    const option=normal?'.studio-cast-modal-option':'.video-studio-cast-modal-option'
    await window.webContents.executeJavaScript(`(async()=>{const end=Date.now()+20000;while(Date.now()<end){
      const dialog=document.querySelector(${JSON.stringify(modal)});const choices=[...document.querySelectorAll(${JSON.stringify(option)})];
      const target=choices.find(e=>e.textContent.includes('DEV AI Actor A'));
      if(dialog&&target){if(!target.classList.contains('selected'))target.click();return true}
      await new Promise(r=>setTimeout(r,100))}throw Error('AF13 character option timeout')})()`)
    await window.webContents.executeJavaScript(`(async()=>{const end=Date.now()+10000;while(Date.now()<end){
      const dialog=document.querySelector(${JSON.stringify(modal)});
      const target=[...document.querySelectorAll(${JSON.stringify(option)})].find(e=>e.textContent.includes('DEV AI Actor A'));
      if(target?.classList.contains('selected')){const save=[...dialog.querySelectorAll('button')].find(e=>e.textContent.includes('Salvar elenco'));save.click();return true}
      await new Promise(r=>setTimeout(r,50))}throw Error('AF13 character selection was not committed')})()`)
    const imageSelector=normal?'.studio-element-character img':'.video-studio-element-character img'
    const rendered=await window.webContents.executeJavaScript(`(async()=>{const end=Date.now()+60000;while(Date.now()<end){
      const img=document.querySelector(${JSON.stringify(imageSelector)});
      const modal=document.querySelector(${JSON.stringify(modal)});
      if(img?.complete&&img.naturalWidth>0&&!modal){await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const element=img.closest('.studio-canvas-element,.video-studio-canvas-element');
        const rect=element?.getBoundingClientRect();return {dataUrl:img.src,naturalSize:[img.naturalWidth,img.naturalHeight],
          elementRect:rect?[rect.x,rect.y,rect.width,rect.height]:null,stageSize:[element?.parentElement?.clientWidth,element?.parentElement?.clientHeight]}}
      await new Promise(r=>setTimeout(r,100))}throw Error('AF13 rendered character timeout')})()`)
    assert.ok(rendered.dataUrl.startsWith('data:image/png;base64,'),`${title}: rendered asset missing`)
    const imageName=normal?'studio-character.png':'video-studio-character.png'
    const png=Buffer.from(rendered.dataUrl.slice('data:image/png;base64,'.length),'base64')
    await writeFile(join(af13Dir,imageName),png)
    const screenshot=(await window.webContents.capturePage()).toPNG()
    await writeFile(join(af13Dir,normal?'studio-stage.png':'video-studio-stage.png'),screenshot)
    return {imageName,sha256:createHash('sha256').update(png).digest('hex'),...rendered}
  }
  const studioAf13=await openAf13(true)
  const videoAf13=await openAf13(false)
  const customizerPath=join(output,'raster-asset-flow','customizer-actor-a-canonical-pose2.png')
  const customizerPng=readFileSync(customizerPath)
  await writeFile(join(af13Dir,'customizer-character.png'),customizerPng)
  const cropAlpha=(png)=>{
    const image=nativeImage.createFromBuffer(png),size=image.getSize(),bitmap=image.toBitmap()
    let minX=size.width,minY=size.height,maxX=-1,maxY=-1
    for(let y=0;y<size.height;y++)for(let x=0;x<size.width;x++)if(bitmap[(y*size.width+x)*4+3]>16){
      minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y)}
    assert.ok(maxX>=minX&&maxY>=minY,'AF13 character raster has no visible alpha')
    const w=maxX-minX+1,h=maxY-minY+1,cropped=Buffer.alloc(w*h*4)
    for(let y=0;y<h;y++)bitmap.copy(cropped,y*w*4,((minY+y)*size.width+minX)*4,((minY+y)*size.width+minX+w)*4)
    return {png:nativeImage.createFromBitmap(cropped,{width:w,height:h}).toPNG(),bounds:{x:minX,y:minY,width:w,height:h}}
  }
  const normalized=[['customizer',customizerPng],['studio',readFileSync(join(af13Dir,studioAf13.imageName))],
    ['videoStudio',readFileSync(join(af13Dir,videoAf13.imageName))]].map(([name,png])=>({name,...cropAlpha(png)}))
  for(const item of normalized)await writeFile(join(af13Dir,`${item.name}-character-alpha-crop.png`),item.png)
  const comparisonStudio=screenshotComparison(normalized[0].png,normalized[1].png,{channelTolerance:3,maxChangedPixelRatio:0.001})
  const comparisonVideo=screenshotComparison(normalized[0].png,normalized[2].png,{channelTolerance:3,maxChangedPixelRatio:0.001})
  const comparisonStudios=screenshotComparison(normalized[1].png,normalized[2].png,{channelTolerance:3,maxChangedPixelRatio:0.001})
  for(const [name,result] of [['customizer-vs-studio',comparisonStudio],['customizer-vs-video-studio',comparisonVideo],['studio-vs-video-studio',comparisonStudios]])
    if(result.diffPng)await writeFile(join(af13Dir,`${name}-diff.png`),result.diffPng)
  const af13={schemaVersion:1,status:'visual-comparison-captured',fixture:'synthetic DEV AI Actor A, model 9, pose 2, shirt/shoe/glasses, front/back hair, eyes/brows/nose/mouth, head accessory',
    editorAssets:{studio:{sha256:studioAf13.sha256,size:studioAf13.naturalSize},videoStudio:{sha256:videoAf13.sha256,size:videoAf13.naturalSize}},
    stageGeometry:{studio:{elementRect:studioAf13.elementRect,stageSize:studioAf13.stageSize},videoStudio:{elementRect:videoAf13.elementRect,stageSize:videoAf13.stageSize}},
    normalizedAlphaBounds:Object.fromEntries(normalized.map(item=>[item.name,item.bounds])),
    comparisons:{customizerVsStudio:comparisonStudio.metrics,customizerVsVideoStudio:comparisonVideo.metrics,studioVsVideoStudio:comparisonStudios.metrics},
    screenshots:['customizer-character.png','studio-stage.png','video-studio-stage.png'],imageArtifacts:normalized.map(item=>`${item.name}-character-alpha-crop.png`),
    fixturePersistedByRealIPC:true,privacy:'synthetic fixture in local DEV AI sandbox only'}
  await writeFile(join(af13Dir,'report.json'),JSON.stringify(af13,null,2))
  assert.equal(comparisonStudio.metrics.passed,true,`AF13 Customizer/Studio visual mismatch: ${JSON.stringify(comparisonStudio.metrics)}`)
  assert.equal(comparisonVideo.metrics.passed,true,`AF13 Customizer/Video Studio visual mismatch: ${JSON.stringify(comparisonVideo.metrics)}`)
  assert.equal(comparisonStudios.metrics.passed,true,`AF13 Studio equivalence mismatch: ${JSON.stringify(comparisonStudios.metrics)}`)
  await writeFile(join(output, 'real-ipc-navigation-progress.json'), JSON.stringify({
    completedRoundTrips: roundTrips, totalRoundTrips: roundTrips,
    routeTransitions: navigationDurations.length, status: 'passed'
  }, null, 2))
  const result = { mode, status: 'passed', adapter: 'production-preload-real-ipc', realIpcCovered: true,
    smokeAreas: [customizer, fabricator, modelWorkspace, options],
    customizerRasterRender,
    af13,
    optionsPlaceholderOnly: true, customizerSyntheticCharacters: characters.length,
    fabricatorSlots: slots.length, navigationWhileSaving: { savesDispatched: navigationDocuments.length,
      pendingAtRouteChange: navigationPendingAtRouteChange, finalTitlePersisted: 'Navigation save 40',
      oppositeNamespaceHashUnchanged: true },
    realWorkspaceNavigation: { roundTrips, routeTransitions: navigationDurations.length,
      openLatencyMs: summarizeSamples(navigationDurations),
      latencyDefinition: 'process-side wall time of executeJavaScript route change, editor activation, DOM readiness and serialization; no RAF/paint claim',
      rendererPhaseLatencyMs: Object.fromEntries(Object.entries(navigationPhaseDurations)
        .map(([phase, samples]) => [phase, summarizeSamples(samples)])),
      studioSnapshotStable: true, videoSnapshotStable: true,
      screenshots: ['real-ipc-studio-before-roundtrips.png', 'real-ipc-studio-after-roundtrips.png'],
      screenshotSha256: { before: beforeScreenshotSha256, after: afterScreenshotSha256,
        exactMatch: beforeScreenshotSha256 === afterScreenshotSha256 },
      visualComparison: visual.metrics,
      visualComparisonArtifact: 'real-ipc-visual-comparison.json',
      screenshotBackend: 'BrowserWindow show:false + webContents.capturePage; not Electron offscreen:true' },
    memorySamples: { unit: 'KB', source: 'Electron app.getAppMetrics().memory.workingSetSize',
      beforeNavigation: memoryBeforeNavigation, afterNavigation: memoryAfterNavigation,
      samples: 2, leakConclusion: 'not determined; two samples cannot establish a leak' },
    rendererNetworkBarrier, environment: runtimeEnvironment(), rendererErrors: diagnostics }
  await writeFile(join(output, 'area-smoke-result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
}

async function comparePrivateCharacterCaptures(window) {
  const comparisonKind = process.env.GACHA_DEV_AI_PRIVATE_COMPARE_KIND ?? 'fit-reset'
  const baselineRoot = resolve(process.env.GACHA_DEV_AI_PRIVATE_ROOT ?? '')
  const resetRoot = resolve(process.env.GACHA_DEV_AI_PRIVATE_COMPARE_ROOT ?? '')
  const allowedRoot = resolve(process.env.GACHA_DEV_AI_PRIVATE_ALLOWED_ROOT ?? '')
  const resetOutput = resolve(process.env.GACHA_DEV_AI_PRIVATE_COMPARE_OUTPUT ?? '')
  assert.ok(allowedRoot && baselineRoot && resetRoot && resetOutput, 'Raízes privadas de comparação ausentes')
  const baselineMarkerPath = join(baselineRoot, 'private-copy-marker.json')
  const baselineMarker = existsSync(baselineMarkerPath) ? JSON.parse(readFileSync(baselineMarkerPath, 'utf8')) : null
  const markerPath = join(resetRoot, 'private-copy-marker.json')
  const marker = existsSync(markerPath) ? JSON.parse(readFileSync(markerPath, 'utf8')) : null
  const insideAllowed = path => {
    const relativePath = relative(allowedRoot, path)
    return !!relativePath && relativePath !== '..' && !relativePath.startsWith(`..${sep}`)
  }
  assert.ok(insideAllowed(baselineRoot) && insideAllowed(resetRoot) && insideAllowed(resetOutput))
  assert.equal(baselineMarker?.schemaVersion, 1)
  assert.equal(baselineMarker?.privateDataCopy, true)
  assert.equal(baselineMarker?.verifiedSha256, true)
  assert.equal(baselineMarker?.copyMode, 'baseline')
  assert.ok(insideAllowed(resetRoot) && insideAllowed(resetOutput))
  assert.equal(marker?.schemaVersion, 1)
  assert.equal(marker?.privateDataCopy, true)
  assert.equal(marker?.verifiedSha256, true)
  assert.equal(marker?.copyMode, comparisonKind === 'actor-edit' ? 'baseline' : 'wardrobe-reset')
  assert.equal(realpathSync(resetRoot).toLowerCase(), resetRoot.toLowerCase())
  assert.equal(realpathSync(resetOutput).toLowerCase(), resetOutput.toLowerCase())
  const baselineReportPath = join(output, 'private-character-preview.json')
  const resetReportPath = join(resetOutput, 'private-character-preview.json')
  const baselineReport = JSON.parse(readFileSync(baselineReportPath, 'utf8'))
  const resetReport = JSON.parse(readFileSync(resetReportPath, 'utf8'))
  assert.equal(baselineReport.status, 'passed')
  assert.equal(resetReport.status, 'passed')
  assert.equal(baselineReport.hashes.fabricatorAfter, resetReport.hashes.fabricatorAfter,
    'Biblioteca Fabricador não corresponde entre cópias privadas')
  const results = []
  for (const name of ['Ayla', 'Chloe']) {
    const before = baselineReport.actors.find(actor => actor.name === name)
    const after = resetReport.actors.find(actor => actor.name === name)
    assert.ok(before && after)
    assert.ok(before.adjustedWardrobeGroupCount > 0 || comparisonKind === 'actor-edit', `${name} não possui ajuste privado a comparar`)
    if (comparisonKind === 'fit-reset') {
      assert.equal(after.adjustedWardrobeGroupCount, 0, `${name} ainda tem delta de roupa após reset da cópia`)
    } else {
      assert.ok(after.adjustedWardrobeGroupCount > 0, `${name}: edição IPC não deixou um ajuste visual salvo`)
    }
    const beforePng = readFileSync(join(output, before.screenshot))
    const afterPng = readFileSync(join(resetOutput, after.screenshot))
    const difference = await window.webContents.executeJavaScript(`(async()=>{
      const beforeUrl=${JSON.stringify(`data:image/png;base64,${beforePng.toString('base64')}`)}
      const afterUrl=${JSON.stringify(`data:image/png;base64,${afterPng.toString('base64')}`)}
      const load=async src=>{const image=new Image();image.src=src;await image.decode();return image}
      const [before,after]=await Promise.all([load(beforeUrl),load(afterUrl)])
      if(before.naturalWidth!==after.naturalWidth||before.naturalHeight!==after.naturalHeight)
        return {status:'dimensions-changed',before:{width:before.naturalWidth,height:before.naturalHeight},after:{width:after.naturalWidth,height:after.naturalHeight}}
      const canvas=document.createElement('canvas');canvas.width=before.naturalWidth;canvas.height=before.naturalHeight
      const context=canvas.getContext('2d',{willReadFrequently:true})
      context.drawImage(before,0,0);const a=context.getImageData(0,0,canvas.width,canvas.height).data
      context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(after,0,0)
      const b=context.getImageData(0,0,canvas.width,canvas.height).data
      const diff=context.createImageData(canvas.width,canvas.height);let changedPixels=0,minX=canvas.width,minY=canvas.height,maxX=-1,maxY=-1
      for(let i=0;i<a.length;i+=4){let changed=false;for(let c=0;c<4;c++)if(Math.abs(a[i+c]-b[i+c])>3)changed=true
        if(changed){changedPixels++;const pixel=i/4,x=pixel%canvas.width,y=Math.floor(pixel/canvas.width);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);diff.data[i]=255;diff.data[i+1]=0;diff.data[i+2]=255;diff.data[i+3]=255}}
      context.putImageData(diff,0,0)
      return {status:'compared',width:canvas.width,height:canvas.height,pixels:canvas.width*canvas.height,changedPixels,
        changedPixelRatio:changedPixels/(canvas.width*canvas.height),changeBounds:changedPixels?{x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1}:null,
        diffDataUrl:canvas.toDataURL('image/png')}
    })()`)
    assert.equal(difference.status, 'compared', `${name}: dimensões diferentes no render privado`)
    const changed = difference.changedPixels > 0
    assert.equal(changed, true, `${name}: zerar os deltas de roupa não alterou o render do Customizador`)
    const diffName = `${name.toLowerCase()}-before-vs-factory-fit-diff.png`
    await writeFile(join(output, diffName), Buffer.from(difference.diffDataUrl.slice('data:image/png;base64,'.length), 'base64'))
    results.push({ name, adjustedGroupsBefore: before.adjustedWardrobeGroupCount,
      adjustedGroupsAfter: after.adjustedWardrobeGroupCount, changedPixels: difference.changedPixels,
      changedPixelRatio: difference.changedPixelRatio, changeBounds: difference.changeBounds,
      screenshotBefore: before.screenshot, screenshotAfter: after.screenshot, diff: diffName })
    await writeFile(join(output, 'private-character-comparison-progress.json'), JSON.stringify({
      schemaVersion: 1, status: 'in-progress', actors: results
    }, null, 2))
  }
  const report = { schemaVersion: 1, status: 'passed', comparison: comparisonKind === 'actor-edit'
      ? 'same production Customizer; private character-only IPC edits persisted across process restart'
      : 'same production Customizer; private baseline vs copied wardrobe-fit resets',
    userProfileModified: false, fabricatorLibrariesEqual: true, actors: results,
    privacy: { baselineCopy: true, resetCopy: comparisonKind === 'fit-reset',
      samePrivateCopy: comparisonKind === 'actor-edit', artifactsOutsideRepository: true } }
  await writeFile(join(output, 'private-character-comparison.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ mode, status: report.status,
    actors: results.map(actor => ({ name: actor.name, adjustedGroupsBefore: actor.adjustedGroupsBefore,
      adjustedGroupsAfter: actor.adjustedGroupsAfter, changedPixelRatio: actor.changedPixelRatio })) }))
}

async function main() {
  assertOutputSandbox()
  if (mode === 'invalid-root') {
    try {
      await import(pathToFileURL(join(ROOT, 'out', 'main', 'main.js')).href)
      throw new Error('Main aceitou um root DEV AI fora do sandbox autorizado.')
    } catch (error) {
      if (String(error?.message ?? error).includes('Main aceitou')) throw error
      assert.match(String(error?.message ?? error), /Root sintético DEV AI fora do diretório autorizado\./,
        'A rejeição do root inválido deve vir do guard de segurança esperado')
      console.log(JSON.stringify({ mode, status: 'passed', invalidRootRejected: true }))
      exitCode = 0
      return
    }
  }
  if (!['asset-ui-authoring', 'asset-ui-verify-restart', 'af13-authored', 'af13-authored-restart', 'seed', 'verify-restart', 'area-smoke', 'close-pending', 'verify-close-pending', 'delete', 'private-character-preview', 'private-character-edit', 'private-character-verify-edits', 'private-character-compare'].includes(mode)) throw new Error('Modo inválido.')
  const uiPrepared = mode === 'asset-ui-authoring' ? await assetUiAuthoring.prepare(sandbox) : null
  await import(pathToFileURL(join(ROOT, 'out', 'main', 'main.js')).href)
  await app.whenReady()
  const window = await waitForWindow()
  if (mode === 'asset-ui-authoring') await assetUiAuthoring.run(window,sandbox,output,uiPrepared,treeHash)
  else if (mode === 'asset-ui-verify-restart') await assetUiAuthoring.verifyAfterRestart(window,sandbox,output,treeHash)
  else if (mode === 'af13-authored') await authoredAf13(window,output,false)
  else if (mode === 'af13-authored-restart') await authoredAf13(window,output,true)
  else if (mode === 'seed') await seed(window)
  else if (mode === 'verify-restart') await verifyRestart(window)
  else if (mode === 'area-smoke') await areaSmoke(window)
  else if (mode === 'private-character-preview') await privateCharacterPreview(window)
  else if (mode === 'private-character-edit') await privateCharacterEdit(window)
  else if (mode === 'private-character-verify-edits') await privateCharacterVerifyEdits(window)
  else if (mode === 'private-character-compare') await comparePrivateCharacterCaptures(window)
  else if (mode === 'close-pending') await closeWithPendingSaves(window)
  else if (mode === 'verify-close-pending') await verifyClosePending(window)
  else await deleteDocuments(window)
  exitCode = 0
}

main().catch((error) => {
  console.error(`DEV AI IPC ${mode}: ${error?.stack ?? error}`)
  exitCode = 1
}).finally(() => {
  if (!(mode === 'close-pending' && allowNaturalQuit)) {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.destroy()
  }
  app.once('will-quit', () => { process.exitCode = exitCode })
  if (!(mode === 'close-pending' && allowNaturalQuit)) app.quit()
})
