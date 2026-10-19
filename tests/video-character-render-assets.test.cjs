'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function loadPureTs(file, deps = {}) {
  const source = fs.readFileSync(path.resolve(__dirname, file), 'utf8')
  const compiled = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((name) => {
    if (name in deps) return deps[name]
    throw new Error(`Import inesperado: ${name}`)
  }, mod, mod.exports)
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

test('transition renderer forwards one injected provider through model, pose, face, effects and Customizer rendering', async () => {
  const calls = []
  const provider = {
    loadFabricatorSlot: async (slot) => { calls.push(['model', slot]); return { slot, width: 100, height: 100, parts: [], joints: [] } },
    loadFabricatorPose: async (modelSlot, poseSlot) => { calls.push(['pose', modelSlot, poseSlot]); return { sourceModelSlot: modelSlot, slot: poseSlot, width: 100, height: 100, parts: [], joints: [] } },
    loadHairStyle: async (...args) => { calls.push(['hair', ...args]); return null },
    loadWardrobeSet: async (...args) => { calls.push(['wardrobe', ...args]); return null },
    loadFaceSet: async (...args) => { calls.push(['face-set', ...args]); return null },
    listFaceComponentAssets: async (...args) => { calls.push(['face-components', ...args]); return [] },
    loadFaceComponentAsset: async (...args) => { calls.push(['face-component', ...args]); return null },
    listFaceCatalog: async (...args) => { calls.push(['face-catalog', ...args]); return [] },
    loadFaceCatalogItem: async (modelSlot, id) => { calls.push(['face-item', modelSlot, id]); return { transforms: { eyes: { x: 1, y: 2, scaleX: 3, scaleY: 4, rotation: 5 } } } },
    listFaceExpressionPresets: async (...args) => { calls.push(['presets', ...args]); return [] },
    loadFaceExpressionPreset: async (...args) => { calls.push(['preset', ...args]); return null },
  }
  let forwardedProvider
  const customizer = {
    loadStandardExpressionEffects: async (slot, assetProvider) => { calls.push(['effects', slot]); forwardedProvider = assetProvider; return {} },
    prepareSavedCharacterRenderer: async (_character, renderSource) => {
      assert.equal(renderSource.assetProvider, provider)
      return { render: async () => ({ dataUrl: 'data:image/png;base64,TRANSITION', width: 100, height: 100 }) }
    },
  }
  const geometry = {
    trimTransparentImage: async (dataUrl) => ({ dataUrl, width: 100, height: 100 }),
    faceRenderGeometry: () => ({ x: 0, y: 0, width: 100, height: 100 }),
  }
  const sharedInterpolation = loadPureTs('../src/shared/videoCharacterInterpolation.ts')
  const { TransitionRenderer } = loadPureTs('../src/renderer/src/features/videoStudio/transitionRenderer.ts', {
    './characterGeometry': geometry,
    '../../../../shared/videoCharacterInterpolation': sharedInterpolation,
    '../customizer/CustomizerPage': customizer,
  })
  const appearance = { modelSlot: 1, eyeCatalogId: 'eye-a', expressionIndex: 0 }
  const state = (poseSlot) => ({
    imageDataUrl: 'data:image/png;base64,AUTHORED',
    element: {
      id: 'actor', kind: 'character', characterId: 'character-a', poseSlot, x: 0, y: 0,
      width: 100, height: 100, rotation: 0, zIndex: 0,
      faceAppearance: appearance,
      faceTransforms: { 'face:eyes:eye-a': { x: 0, y: 0, width: 100, height: 100, rotation: 0, ...(poseSlot === 1 ? { sourceTransformOverride: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } } : {}) } },
    },
  })
  const character = { id: 'character-a', name: 'Synthetic', customization: { modelSlot: 1, poseSlot: 1 } }
  const renderer = new TransitionRenderer(provider)
  const rendered = await renderer.render({ elementId: 'actor', startFrame: 0, boundaryFrame: 10, from: state(1), to: state(2) }, 5, character)
  assert.equal(rendered.imageDataUrl, 'data:image/png;base64,TRANSITION')
  assert.equal(forwardedProvider, provider, 'effects and the Customizer compositor share the exact same asset source')
  assert.ok(calls.some(([kind]) => kind === 'model'))
  assert.ok(calls.some(([kind, _model, pose]) => kind === 'pose' && pose === 1))
  assert.ok(calls.some(([kind, _model, pose]) => kind === 'pose' && pose === 2))
  assert.ok(calls.some(([kind, _model, id]) => kind === 'face-item' && id === 'eye-a'))
  assert.ok(calls.some(([kind]) => kind === 'effects'))
})
