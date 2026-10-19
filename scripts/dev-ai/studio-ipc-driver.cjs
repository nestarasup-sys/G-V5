'use strict'

const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { createServer, get } = require('node:http')
const { existsSync, lstatSync, readdirSync, readFileSync } = require('node:fs')
const { mkdir, rm, writeFile } = require('node:fs/promises')
const { performance } = require('node:perf_hooks')
const os = require('node:os')
const { basename, dirname, join, relative, resolve, sep } = require('node:path')
const { pathToFileURL } = require('node:url')
const { app, BrowserWindow, nativeImage } = require('electron')
const { compareBitmaps, evaluateVisualComparison } = require('./visual-regression.cjs')
const rasterFixture = require('./asset-flow-raster-fixture.cjs')

const ROOT = resolve(__dirname, '../..')
const mode = process.argv[2]
const output = resolve(process.env.GACHA_DEV_AI_AUDIT_OUTPUT ?? process.env.GACHA_AUDIT_OUTPUT_DIR ?? '')
const sandbox = resolve(process.env.GACHA_DEV_AI_AUDIT_SANDBOX ?? process.env.GACHA_DEV_AI_SANDBOX ?? '')
let exitCode = 1
let allowNaturalQuit = false

function assertOutputSandbox() {
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
    { id: 'shoe-left', dataUrl: fixture.shoe.dataUrl },
    { id: 'glasses', dataUrl: fixture.glasses.dataUrl }
  ]
  await api(`window.desktop.saveWardrobeSet(9,${JSON.stringify(fixture.set)},${JSON.stringify(setAssets)})`)
  const restoredSet = await api(`window.desktop.loadWardrobeSet(9,${JSON.stringify(rasterFixture.SET_ID)})`)
  assert.equal(restoredSet?.components.length, 2)
  assert.equal(restoredSet.components[0].binding.boneId, 'leg-left')
  assert.equal(restoredSet.components[0].binding.version, 1)
  assert.equal(restoredSet.components[1].renderAboveHair, true)
  assert.ok(restoredSet.components.every(c=>c.dataUrl?.startsWith('data:image/png;base64,')))
  await api(`window.desktop.saveHairStyle(9,${JSON.stringify(fixture.hairStyle)},
    ${JSON.stringify([{ id:'front',dataUrl:fixture.frontHair.dataUrl }])})`)
  const loadedHair=await api(`window.desktop.loadHairStyle(9,${JSON.stringify(rasterFixture.HAIR_ID)})`)
  assert.equal(loadedHair?.id,rasterFixture.HAIR_ID)
  assert.ok(loadedHair.front?.dataUrl?.startsWith('data:image/png;base64,'))
  assert.equal(loadedHair.transforms.front.x,fixture.hairStyle.transforms.front.x)
  assert.equal(loadedHair.transforms.front.scaleX,fixture.hairStyle.transforms.front.scaleX)
  await api(`window.desktop.saveFaceComponentAsset(9,${JSON.stringify(fixture.extraAsset)},
    ${JSON.stringify(fixture.headExtra.dataUrl)})`)
  const loadedExtra=await api(`window.desktop.loadFaceComponentAsset(9,${JSON.stringify(rasterFixture.EXTRA_ID)})`)
  assert.equal(loadedExtra?.kind,'head-extra')
  assert.ok(loadedExtra.dataUrl?.startsWith('data:image/png;base64,'))
  assert.deepEqual(loadedExtra.defaultTransform,fixture.extraAsset.defaultTransform)
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
    modelParts:10,poseSlots:[1,2],wardrobeComponents:2,
    sourceSheetSha256:sourceBefore,assembledModelTreeSha256:afterModel,
    poseTreeSha256:afterPoses,wardrobeTreeSha256:afterWardrobe,
    hairTreeSha256:afterHair,faceExtrasTreeSha256:afterFace,
    savedHeadLocalTransforms:{hair:fixture.hairStyle.transforms.front,extra:fixture.extraAsset.defaultTransform},
    garmentBindings:{shoeLeft:'leg-left',glasses:'head'},hairStyles:1,headExtraAssets:1,
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
  const actorWithFittedGarment = {
    ...actorA, customization: {
      ...actorA.customization, modelSlot:9,poseSlot:1,
      wardrobeGroups: [{
        modelSlot: 9, setId: syntheticGarmentId, category: 'sapato',
        componentId: 'shoe-left', offsetX: 12, offsetY: -5,
        scaleX: 1.2, scaleY: 1, rotation: 8
      }, {
        modelSlot: 9, setId: syntheticGarmentId, category: 'oculos',
        componentId: 'glasses', offsetX: 0, offsetY: 0,
        scaleX: 1, scaleY: 1, rotation: 0
      }]
    }
  }
  const siblingSameModel = {
    ...actorB, customization: { ...actorB.customization, modelSlot:9,poseSlot:1 }
  }
  await api(`window.desktop.saveCustomizerCharacter(${JSON.stringify(siblingSameModel)})`)
  await api(`window.desktop.saveCustomizerCharacter(${JSON.stringify(actorWithFittedGarment)})`)
  const persistedActors = await api('window.desktop.listCustomizerCharacters()')
  assert.equal(persistedActors.length, charactersBefore.length + 2)
  const storedA = persistedActors.find(character => character.id === actorA.id)
  const storedB = persistedActors.find(character => character.id === actorB.id)
  assert.equal(storedA.customization.wardrobeGroups[0].offsetX, 12)
  assert.equal(storedA.customization.wardrobeGroups[0].rotation, 8)
  assert.equal(storedA.customization.wardrobeGroups[1].componentId,'glasses')
  assert.equal(storedA.customization.wardrobeGroups[1].offsetX,0)
  assert.equal(storedA.customization.wardrobeGroups[1].rotation,0)
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
      fabricatorLibraryHashUnchanged: true, testedReference: 'persisted raster wardrobe v2, full renderer golden pending',
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
  assert.equal(normal.length, 1)
  assert.equal(video.length, 1)
  assert.equal(normal[0].id, video[0].id)
  assert.ok(normal[0].title.startsWith('IPC normal edit '))
  assert.ok(video[0].title.startsWith('IPC video edit '))
  assert.ok(normal[0].videoTimeline === undefined)
  assert.ok(video[0].videoTimeline)
  const actors = await window.webContents.executeJavaScript('window.desktop.listCustomizerCharacters()')
  assert.ok(actors.length >= 2, 'Character catalog disappeared after restart')
  const fitted = actors.find(character => character.name === 'DEV AI Actor A')
  const unchanged = actors.find(character => character.name === 'DEV AI Actor B')
  assert.equal(fitted?.customization.wardrobeGroups?.[0]?.offsetX, 12)
  assert.equal(fitted?.customization.wardrobeGroups?.[0]?.modelSlot,9)
  assert.equal(fitted?.customization.wardrobeGroups?.[0]?.setId,rasterFixture.SET_ID)
  assert.equal((await window.webContents.executeJavaScript('window.desktop.loadFabricatorPose(9,1)'))?.parts.length,10)
  assert.equal(fitted?.customization.wardrobeGroups?.[0]?.rotation, 8)
  assert.equal(fitted?.customization.wardrobeGroups?.[1]?.componentId,'glasses')
  assert.equal(unchanged?.customization.modelSlot, 9)
  assert.deepEqual(unchanged?.customization.wardrobeGroups ?? [], [],
    'Após restart, personagem B herdou alterações do personagem A')
  const result = { mode, status: 'passed', adapter: 'production-preload-real-ipc', realIpcCovered: true,
    restartedProcess: true, normalDocuments: normal.length, videoStudioDocuments: video.length,
    sameIdStillIsolated: true, customizerCharacterDeltasPersisted: true,
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

async function verifyCustomizerRasterPreview(window) {
  // A real production Customizer page consumes the saved Fabricator model,
  // real pose and V2 wardrobe PNGs. We assert that the equipped raster has
  // been decoded and composited; do not call this a cross-Studio golden test.
  const waitForCharacter = async (name, expectOutfit) =>
    window.webContents.executeJavaScript(`(async()=>{
      const name=${JSON.stringify(name)}
      const expected=${expectOutfit}
      const deadline=Date.now()+30000
      let last=null
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
        const renderedPixels=(img)=>{
          if(!img || !img.complete || !img.naturalWidth || !img.naturalHeight) return 0
          const canvas=document.createElement('canvas')
          canvas.width=img.naturalWidth;canvas.height=img.naturalHeight
          const context=canvas.getContext('2d',{willReadFrequently:true})
          if(!context) return 0
          context.drawImage(img,0,0)
          const rgba=context.getImageData(0,0,canvas.width,canvas.height).data
          let pixels=0
          for(let i=3;i<rgba.length;i+=4)if(rgba[i]>=32)pixels++
          return pixels
        }
        const alerts=[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent.trim()).filter(Boolean)
        const shoePixels=expected?renderedPixels(wardrobe):0
        const glassesPixels=expected?renderedPixels(aboveHair):0
        last={selected,modelReady:!!model && model.complete && model.naturalWidth>0,
          wardrobeReady:!!wardrobe && wardrobe.complete && wardrobe.naturalWidth>0,
          glassesReady:!!aboveHair && aboveHair.complete && aboveHair.naturalWidth>0,
          shoeOpaquePixels:shoePixels,glassesOpaquePixels:glassesPixels,
          outfitPresent:!!wardrobe,glassesPresent:!!aboveHair,
          alerts,modelNaturalSize:model?[model.naturalWidth,model.naturalHeight]:null,
          outfitNaturalSize:wardrobe?[wardrobe.naturalWidth,wardrobe.naturalHeight]:null}
        if(selected===name && last.modelReady
          && (expected?(last.wardrobeReady && last.glassesReady && shoePixels>100 && glassesPixels>100)
            :(!last.outfitPresent&&!last.glassesPresent))
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
  const screenshotA=(await window.webContents.capturePage()).toPNG()
  await writeFile(join(artifactsFolder,'customizer-actor-a-outfit.png'),screenshotA)
  const sibling = await waitForCharacter('DEV AI Actor B',false)
  await writeFile(join(artifactsFolder,'customizer-actor-b-default.png'),
    (await window.webContents.capturePage()).toPNG())
  const report={schemaVersion:1,adapter:'production-customizer-real-dom',
    status:outfit.status==='passed'&&sibling.status==='passed'?'passed':'failed',
    configuredFixture:'raster model-9, pose-1, wardrobe-v2 with shoe-left',
    characterA:outfit,characterB:sibling,sourceLibraryWrites:0,
    limitations:'Real DOM and PNG decode: not a quantitative Fabricador/Studio golden image'}
  await writeFile(join(artifactsFolder,'customizer-render-result.json'),JSON.stringify(report,null,2))
  assert.equal(report.status,'passed',`Customizer não representou os assets sintéticos corretamente: ${JSON.stringify(report)}`)
  return report
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
  const customizerRasterRender = await verifyCustomizerRasterPreview(window)
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
  await writeFile(join(output, 'real-ipc-navigation-progress.json'), JSON.stringify({
    completedRoundTrips: roundTrips, totalRoundTrips: roundTrips,
    routeTransitions: navigationDurations.length, status: 'passed'
  }, null, 2))
  const result = { mode, status: 'passed', adapter: 'production-preload-real-ipc', realIpcCovered: true,
    smokeAreas: [customizer, fabricator, modelWorkspace, options],
    customizerRasterRender,
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
  if (!['seed', 'verify-restart', 'area-smoke', 'close-pending', 'verify-close-pending', 'delete'].includes(mode)) throw new Error('Modo inválido.')
  await import(pathToFileURL(join(ROOT, 'out', 'main', 'main.js')).href)
  await app.whenReady()
  const window = await waitForWindow()
  if (mode === 'seed') await seed(window)
  else if (mode === 'verify-restart') await verifyRestart(window)
  else if (mode === 'area-smoke') await areaSmoke(window)
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
