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

const assetModule = loadPureTs('../src/shared/videoCharacterRenderAssets.ts')
const {
  createVideoCharacterRenderAssetSnapshot, createRecordingVideoCharacterRenderAssetProvider,
  createVideoCharacterRenderSnapshotProvider, serializeVideoCharacterRenderAssetSnapshot,
  parseVideoCharacterRenderAssetSnapshot,
} = assetModule

function syntheticAssetProvider() {
  const source = {
    model: { slot: 1, parts: [{ id: 'torso', dataUrl: 'data:image/png;base64,MODEL-A' }] },
    pose: { sourceModelSlot: 1, slot: 2, parts: [{ id: 'arm', dataUrl: 'data:image/png;base64,POSE-A' }] },
    hair: { modelSlot: 1, id: 'hair-a', front: { dataUrl: 'data:image/png;base64,HAIR-A' } },
    wardrobe: { modelSlot: 1, id: 'wardrobe-a', components: [{ id: 'shirt', dataUrl: 'data:image/png;base64,SHIRT-A' }] },
    faceSet: { modelSlot: 1, id: 'face-set-a', pieces: [{ id: 'mouth', dataUrl: 'data:image/png;base64,MOUTH-A' }] },
    faceComponentSummary: { modelSlot: 1, id: 'eye-a', kind: 'eye' },
    faceComponent: { modelSlot: 1, id: 'eye-a', kind: 'eye', dataUrl: 'data:image/png;base64,EYE-A' },
    faceCatalogSummary: { modelSlot: 1, id: 'face-a', name: 'Synthetic face' },
    faceCatalog: { modelSlot: 1, id: 'face-a', transforms: { eyes: { x: 1, y: 2, scaleX: 3, scaleY: 4, rotation: 5 } } },
    presetSummary: { modelSlot: 1, id: 'preset-a', expressionIndex: 0 },
    preset: { modelSlot: 1, id: 'preset-a', effects: { blush: { enabled: false, opacity: 0 } } },
  }
  let calls = 0
  const sourceProvider = {
    loadFabricatorSlot: async () => { calls += 1; return source.model },
    loadFabricatorPose: async () => { calls += 1; return source.pose },
    loadHairStyle: async () => { calls += 1; return source.hair },
    loadWardrobeSet: async () => { calls += 1; return source.wardrobe },
    loadFaceSet: async () => { calls += 1; return source.faceSet },
    listFaceComponentAssets: async (_slot, kind) => { calls += 1; return !kind || kind === source.faceComponentSummary.kind ? [source.faceComponentSummary] : [] },
    loadFaceComponentAsset: async () => { calls += 1; return source.faceComponent },
    listFaceCatalog: async () => { calls += 1; return [source.faceCatalogSummary] },
    loadFaceCatalogItem: async () => { calls += 1; return source.faceCatalog },
    listFaceExpressionPresets: async () => { calls += 1; return [source.presetSummary] },
    loadFaceExpressionPreset: async () => { calls += 1; return source.preset },
  }
  return { source, sourceProvider, getCalls: () => calls }
}

test('recording provider deduplicates reads and produces a detached full-character snapshot', async () => {
  const synthetic = syntheticAssetProvider()
  const recorder = createRecordingVideoCharacterRenderAssetProvider(synthetic.sourceProvider)
  const provider = recorder.provider
  const modelReads = await Promise.all([provider.loadFabricatorSlot(1), provider.loadFabricatorSlot(1)])
  assert.strictEqual(modelReads[0], modelReads[1])
  await Promise.all([
    provider.loadFabricatorPose(1, 2), provider.loadHairStyle(1, 'hair-a'), provider.loadWardrobeSet(1, 'wardrobe-a'),
    provider.loadFaceSet(1, 'face-set-a'), provider.listFaceComponentAssets(1, undefined), provider.listFaceComponentAssets(1, 'eye'),
    provider.loadFaceComponentAsset(1, 'eye-a'), provider.listFaceCatalog(1), provider.loadFaceCatalogItem(1, 'face-a'),
    provider.listFaceExpressionPresets(1), provider.loadFaceExpressionPreset(1, 'preset-a'),
  ])
  assert.equal(synthetic.getCalls(), 12, 'the second identical model read is served from the recorder cache')

  const snapshot = recorder.snapshot()
  assert.equal(snapshot.entries.length, 12)
  assert.equal(Object.isFrozen(snapshot), true)
  const json = serializeVideoCharacterRenderAssetSnapshot(snapshot)
  assert.equal(serializeVideoCharacterRenderAssetSnapshot(parseVideoCharacterRenderAssetSnapshot(json)), json, 'canonical snapshot JSON is stable after reopen')
  const reopened = createVideoCharacterRenderSnapshotProvider(parseVideoCharacterRenderAssetSnapshot(json))

  synthetic.source.model.parts[0].dataUrl = 'data:image/png;base64,MODEL-CHANGED'
  synthetic.source.hair.front.dataUrl = 'data:image/png;base64,HAIR-CHANGED'
  synthetic.source.faceCatalog.transforms.eyes.x = 999
  assert.equal((await reopened.loadFabricatorSlot(1)).parts[0].dataUrl, 'data:image/png;base64,MODEL-A')
  assert.equal((await reopened.loadHairStyle(1, 'hair-a')).front.dataUrl, 'data:image/png;base64,HAIR-A')
  assert.equal((await reopened.loadFaceCatalogItem(1, 'face-a')).transforms.eyes.x, 1)
})

test('asset snapshots reject duplicate/incompatible entries and report uncaptured references', async () => {
  const recorder = createRecordingVideoCharacterRenderAssetProvider(syntheticAssetProvider().sourceProvider)
  await recorder.provider.loadFabricatorSlot(1)
  const snapshot = recorder.snapshot()
  assert.equal(Object.isFrozen(snapshot.entries[0].value.parts), true)
  assert.throws(() => { snapshot.entries[0].value.parts[0].dataUrl = 'tampered' }, TypeError)
  assert.throws(() => createVideoCharacterRenderAssetSnapshot([snapshot.entries[0], snapshot.entries[0]]), /leitura duplicada/)
  const wrongModel = { ...snapshot.entries[0], value: { slot: 9, parts: [] } }
  assert.throws(() => createVideoCharacterRenderAssetSnapshot([wrongModel]), /modelo incompatível/)
  assert.throws(() => createVideoCharacterRenderAssetSnapshot([{ method: 'loadFaceCatalogItem', args: [1, 'face-a'], value: { modelSlot: 1, transforms: {} } }]), /Referência incompatível/)
  const reopened = createVideoCharacterRenderSnapshotProvider(snapshot)
  await assert.rejects(reopened.loadFabricatorSlot(9), /não capturada no snapshot/)
})

test('character asset capture walks every transition sample and freezes the supplier reads', async () => {
  const synthetic = syntheticAssetProvider()
  const progress = []
  let renderCalls = 0
  const transition = {
    elementId: 'actor', startFrame: 4, boundaryFrame: 7,
    from: { element: { characterId: 'character-a' } }, to: { element: { characterId: 'character-a' } },
  }
  const capture = loadPureTs('../src/renderer/src/features/videoStudio/videoCharacterAssetCapture.ts', {
    '../../../../shared/videoCharacterRenderAssets': assetModule,
    './characterTransitions': { compileCharacterTransitions: () => [transition], transitionSampleFrames: () => [5, 6] },
    './transitionRenderer': { TransitionRenderer: class {
      constructor(provider) { this.provider = provider }
      async render() {
        renderCalls += 1
        await Promise.all([
          this.provider.loadFabricatorSlot(1), this.provider.loadFabricatorPose(1, 2), this.provider.loadHairStyle(1, 'hair-a'),
          this.provider.loadWardrobeSet(1, 'wardrobe-a'), this.provider.loadFaceSet(1, 'face-set-a'),
          this.provider.listFaceComponentAssets(1, undefined), this.provider.listFaceComponentAssets(1, 'eye'),
          this.provider.loadFaceComponentAsset(1, 'eye-a'), this.provider.listFaceCatalog(1),
          this.provider.loadFaceCatalogItem(1, 'face-a'), this.provider.listFaceExpressionPresets(1),
          this.provider.loadFaceExpressionPreset(1, 'preset-a'),
        ])
      }
    } },
  })
  const snapshot = await capture.captureVideoCharacterRenderAssets({}, [{ id: 'character-a' }], synthetic.sourceProvider, {
    onProgress: (completed, total) => progress.push([completed, total]),
  })
  assert.equal(renderCalls, 2)
  assert.deepEqual(progress, [[1, 2], [2, 2]])
  assert.equal(snapshot.entries.length, 12)
  assert.equal(synthetic.getCalls(), 12, 'the capture memoizes repeated reads across transition frames')
  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(capture.captureVideoCharacterRenderAssets({}, [{ id: 'character-a' }], synthetic.sourceProvider, { signal: aborted.signal }), { name: 'AbortError' })
  assert.equal(renderCalls, 2, 'an aborted capture does not render another transition sample')
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


test('character asset capture plans every authored face state and records automatic blink/talk dependencies', async () => {
  const synthetic = syntheticAssetProvider()
  const calls = []
  const capture = loadPureTs('../src/renderer/src/features/videoStudio/videoCharacterAssetCapture.ts', {
    '../../../../shared/videoCharacterRenderAssets': assetModule,
    './characterTransitions': { compileCharacterTransitions: () => [], transitionSampleFrames: () => [] },
    './transitionRenderer': { TransitionRenderer: class {
      constructor(provider) { this.provider = provider }
      async render(transition) {
        const mode = transition.from.element.activeFaceMode
        calls.push(mode)
        await this.provider.loadFabricatorSlot(1)
        await this.provider.loadFabricatorPose(1, 2)
        if (mode === 'blink') {
          await this.provider.listFaceComponentAssets(1, 'eye-closed')
          await this.provider.loadFaceComponentAsset(1, 'eye-a')
        }
        if (mode === 'talk') {
          await this.provider.listFaceCatalog(1)
          await this.provider.loadFaceCatalogItem(1, 'face-a')
        }
      }
    } },
  })
  const stateA = {
    imageDataUrl: 'data:image/png;base64,A',
    element: { id: 'actor', kind: 'character', characterId: 'character-a', poseSlot: 2, faceAppearance: { modelSlot: 1 } },
  }
  const stateB = {
    imageDataUrl: 'data:image/png;base64,B',
    element: { id: 'actor', kind: 'character', characterId: 'character-a', poseSlot: 2, faceAppearance: { modelSlot: 1 } },
  }
  const studio = {
    elements: [{ id: 'actor', kind: 'character', characterId: 'character-a' }],
    videoTimeline: {
      characterBases: { actor: stateA },
      characterKeys: [
        { id: 'same-object', elementId: 'actor', frame: 10, state: stateA },
        { id: 'new-state', elementId: 'actor', frame: 20, state: stateB },
      ],
    },
  }
  const planned = capture.collectAutomaticFaceCaptureStates(studio)
  assert.deepEqual(planned.map((item) => item.state.imageDataUrl), ['data:image/png;base64,A', 'data:image/png;base64,B'])

  const progress = []
  const snapshot = await capture.captureVideoCharacterRenderAssets(
    studio,
    [{ id: 'character-a', customization: { modelSlot: 1 } }],
    synthetic.sourceProvider,
    { onProgress: (completed, total) => progress.push([completed, total]) },
  )
  assert.deepEqual(calls, ['blink', 'talk', 'blink', 'talk'])
  assert.deepEqual(progress.at(-1), [5, 5], 'one catalog preload plus two automatic recipes per authored state')
  const methods = snapshot.entries.map((entry) => entry.method)
  assert.ok(methods.includes('listFaceCatalog'))
  assert.ok(methods.includes('listFaceComponentAssets'))
  assert.ok(methods.includes('loadFaceCatalogItem'))
  assert.ok(methods.includes('loadFaceComponentAsset'))
})
