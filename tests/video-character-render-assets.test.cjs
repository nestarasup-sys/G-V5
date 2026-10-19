'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function loadPureTs(file) {
  const source = fs.readFileSync(path.resolve(__dirname, file), 'utf8')
  const compiled = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((name) => { throw new Error(`Import inesperado: ${name}`) }, mod, mod.exports)
  return mod.exports
}

const { createVideoCharacterTransitionCoreAssetSnapshot, createVideoCharacterTransitionCoreSnapshotProvider } = loadPureTs('../src/shared/videoCharacterRenderAssets.ts')

function snapshotInput() {
  return {
    models: [{ modelSlot: 1, value: { slot: 1, parts: [{ id: 'torso', dataUrl: 'data:image/png;base64,MODEL-A' }] } }],
    poses: [{ modelSlot: 1, poseSlot: 2, value: { sourceModelSlot: 1, slot: 2, parts: [{ id: 'arm', dataUrl: 'data:image/png;base64,POSE-A' }] } }],
    faceComponents: [{ modelSlot: 1, id: 'eye-a', value: { modelSlot: 1, id: 'eye-a', dataUrl: 'data:image/png;base64,EYE-A' } }],
    faceCatalogItems: [{ modelSlot: 1, id: 'face-a', value: { modelSlot: 1, id: 'face-a', sheet: { dataUrl: 'data:image/png;base64,FACE-A' } } }],
    standardExpressionEffects: [{ modelSlot: 1, value: { 0: { blush: { enabled: false, opacity: 0 } } } }],
  }
}

test('asset snapshot provider stays detached from later supplier edits', async () => {
  const source = snapshotInput()
  const snapshot = createVideoCharacterTransitionCoreAssetSnapshot(source)
  const provider = createVideoCharacterTransitionCoreSnapshotProvider(snapshot)

  source.models[0].value.parts[0].dataUrl = 'data:image/png;base64,MODEL-CHANGED'
  source.poses[0].value.parts[0].dataUrl = 'data:image/png;base64,POSE-CHANGED'
  source.faceComponents[0].value.dataUrl = 'data:image/png;base64,EYE-CHANGED'

  assert.equal((await provider.loadModel(1)).parts[0].dataUrl, 'data:image/png;base64,MODEL-A')
  assert.equal((await provider.loadPose(1, 2)).parts[0].dataUrl, 'data:image/png;base64,POSE-A')
  assert.equal((await provider.loadFaceComponent(1, 'eye-a')).dataUrl, 'data:image/png;base64,EYE-A')
  assert.equal((await provider.loadFaceCatalogItem(1, 'face-a')).id, 'face-a')
  assert.equal((await provider.loadStandardExpressionEffects(1))[0].blush.opacity, 0)
  assert.equal(await provider.loadModel(9), null)
  assert.equal(await provider.loadPose(1, 99), null)
})

test('asset snapshot is deeply frozen and rejects ambiguous or incompatible references', () => {
  const snapshot = createVideoCharacterTransitionCoreAssetSnapshot(snapshotInput())
  assert.equal(Object.isFrozen(snapshot), true)
  assert.equal(Object.isFrozen(snapshot.models[0].value.parts), true)
  assert.throws(() => { snapshot.models[0].value.parts[0].dataUrl = 'tampered' }, TypeError)

  const duplicate = snapshotInput()
  duplicate.models.push(duplicate.models[0])
  assert.throws(() => createVideoCharacterTransitionCoreAssetSnapshot(duplicate), /duplicada ou inválida/)

  const mismatched = snapshotInput()
  mismatched.poses[0].value.slot = 3
  assert.throws(() => createVideoCharacterTransitionCoreAssetSnapshot(mismatched), /pose com referência incompatível/)
})
