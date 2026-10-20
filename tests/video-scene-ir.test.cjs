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
    throw new Error(`Import não permitido na fixture: ${name}`)
  }, mod, mod.exports)
  return mod.exports
}

const frameHelpers = loadPureTs('../src/shared/videoFrame.ts')
const characterTimeline = loadPureTs('../src/shared/videoCharacterTimeline.ts')
const characterTransitions = loadPureTs('../src/shared/videoCharacterTransitions.ts')
const characterInterpolation = loadPureTs('../src/shared/videoCharacterInterpolation.ts')
const previewTransitions = loadPureTs('../src/renderer/src/features/videoStudio/characterTransitions.ts', {
  '../../../../shared/videoCharacterTransitions': characterTransitions,
  '../../../../shared/videoCharacterInterpolation': characterInterpolation,
})
const snapshotModule = loadPureTs('../src/shared/videoExportSnapshot.ts', { './videoFrame': frameHelpers })
const { compileVideoScene, evaluateVideoSceneFrame } = loadPureTs('../src/shared/videoSceneIR.ts', {
  './videoFrame': frameHelpers,
  './videoCharacterTimeline': characterTimeline,
  './videoCharacterTransitions': characterTransitions,
  './videoExportSnapshot': snapshotModule,
})

function characterState(poseSlot, imageDataUrl, x = 30) {
  return {
    imageDataUrl,
    element: {
      id: 'actor-a', kind: 'character', characterId: 'character-a', poseSlot,
      text: '', x, y: 40, width: 20, height: 30, rotation: 0, zIndex: 4,
    },
  }
}

function fixture() {
  const base = characterState(1, 'data:image/png;base64,BASE')
  const next = characterState(2, 'data:image/png;base64,NEXT')
  return {
    schemaVersion: 1, id: 'synthetic-studio', title: 'Sintético', color: '#333333',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    backgroundColor: '#ffffff', backgroundAssetId: null,
    backgroundX: 0, backgroundY: 0, backgroundWidth: 1920, backgroundHeight: 1080, backgroundRotation: 0,
    assets: [],
    elements: [
      base.element,
      { id: 'bubble-a', kind: 'speech', text: 'Oi', speakerCharacterId: 'actor-a', x: 10, y: 10, width: 20, height: 10, rotation: 0, zIndex: 1 },
      { id: 'bubble-t', kind: 'thought', text: 'hmm', speakerCharacterId: 'actor-a', x: 10, y: 20, width: 20, height: 10, rotation: 0, zIndex: 2 },
    ],
    videoTimeline: {
      schemaVersion: 1, frameRate: 60, durationFrames: 60, playheadFrame: 33, playing: true,
      animateCharacterTransitions: true,
      characterBases: { 'actor-a': base },
      characterPositions: { 'actor-a': { x: 80, y: 90 } },
      characterKeys: [{ id: 'key-a', elementId: 'actor-a', frame: 15, poseSlot: 2, expressionCollectionId: null, expressionPresetId: null, faceMode: 'idle', state: next }],
      characterGaps: [{ id: 'gap-a', elementId: 'actor-a', startFrame: 25, endFrame: 28 }],
      textClips: [
        { id: 'speech-a', elementId: 'bubble-a', kind: 'speech', startFrame: 4, endFrame: 20 },
        { id: 'thought-a', elementId: 'bubble-t', kind: 'thought', startFrame: 8, endFrame: 18 },
      ],
      videoClips: [{ id: 'video-a', assetId: 'media-a', startFrame: 10, endFrame: 20, sourceStartFrame: 30, sourceEndFrame: 40, transform: { x: 5, y: 6, width: 70, height: 80, rotation: 9 } }],
      saveMarkers: [],
    },
  }
}

function program(source, variant) {
  return compileVideoScene(snapshotModule.createVideoExportSnapshot(source), variant)
}

test('animated and static variants are absolute, repeatable and preserve authored keys', () => {
  const source = fixture()
  const animated = program(source, 'animated')
  const staticCharacters = program(source, 'static-characters')
  const animatedMid = evaluateVideoSceneFrame(animated, 7)
  const staticMid = evaluateVideoSceneFrame(staticCharacters, 7)
  const animatedBoundary = evaluateVideoSceneFrame(animated, 15)
  evaluateVideoSceneFrame(animated, 15)
  const animatedAfterReverseSeek = evaluateVideoSceneFrame(animated, 7)

  assert.equal(animatedMid.characters[0].transition?.from.element.poseSlot, 1)
  assert.equal(animatedMid.characters[0].transition?.to.element.poseSlot, 2)
  assert.equal(animatedMid.characters[0].transition?.progress, 7 / 15)
  assert.equal(animatedMid.characters[0].automaticMouth, undefined, 'transition has precedence over automatic mouth')
  assert.equal(staticMid.characters[0].transition, undefined)
  assert.equal(staticMid.characters[0].automaticMouth, undefined)
  assert.equal(staticMid.characters[0].automaticBlink, false)
  assert.equal(staticMid.characters[0].authoredState?.element.poseSlot, 1)
  assert.equal(animatedBoundary.characters[0].authoredState?.element.poseSlot, 2)
  assert.equal(animatedBoundary.characters[0].authoredState?.element.x, 80, 'legacy script-wide position remains applied to every segment')
  assert.equal(animatedMid.characters[0].stageTransform?.x, 80, 'stage placement is preserved as a post-interpolation transform')
  assert.equal(animatedBoundary.characters[0].automaticMouth?.mode, 'talk', 'speech takes precedence over a thought balloon for the same speaker')
  assert.deepEqual(animatedMid, animatedAfterReverseSeek, 'A-B-A seeks return the same semantic frame')
  assert.equal(source.videoTimeline.playing, true)
  assert.equal(source.videoTimeline.playheadFrame, 33)
})

test('preview and scene IR use the same transition windows, including gaps', () => {
  const source = fixture()
  source.videoTimeline.characterKeys.push({
    id: 'key-after-gap', elementId: 'actor-a', frame: 40, poseSlot: 3,
    expressionCollectionId: null, expressionPresetId: null, faceMode: 'idle',
    state: characterState(3, 'data:image/png;base64,AFTER_GAP'),
  })
  const preview = previewTransitions.compileCharacterTransitions(source)
  const scene = program(source, 'animated')
  const compiled = scene.transitionsByCharacter.get('actor-a')
  assert.deepEqual(compiled, preview)
  assert.deepEqual(compiled.map(({ startFrame, boundaryFrame }) => [startFrame, boundaryFrame]), [[0, 15]])
})

test('scene resolves gaps, text, source ticks and current V5 layer ordering', () => {
  const scene = evaluateVideoSceneFrame(program(fixture(), 'static-characters'), 12)
  assert.deepEqual(scene.videos, [{ clipId: 'video-a', assetId: 'media-a', sourceTick: 32, sourceTimeNumerator: 32, sourceTimeDenominator: 60, transform: { x: 5, y: 6, width: 70, height: 80, rotation: 9 }, zOrder: 1 }])
  assert.ok(scene.layers.some((layer) => layer.clipId === 'speech-a'))
  assert.ok(scene.layers.some((layer) => layer.clipId === 'thought-a'))
  assert.ok(scene.layers.some((layer) => layer.type === 'video' && layer.clipId === 'video-a'))
  assert.equal(scene.layers.find((layer) => layer.clipId === 'speech-a')?.zOrder, 3)
  assert.equal(scene.layers.find((layer) => layer.kind === 'character')?.zOrder, 6)
  assert.deepEqual(scene.layers.map((layer) => layer.zOrder), [1, 3, 4, 6])
  assert.equal(scene.timestampNumerator / scene.timestampDenominator, 12 / 60)

  const gap = evaluateVideoSceneFrame(program(fixture(), 'animated'), 26)
  assert.equal(gap.characters[0].hidden, true)
  assert.equal(gap.characters[0].automaticBlink, false)
  assert.equal(gap.layers.some((layer) => layer.kind === 'character'), false)
})

test('compiled interval indexes match the existing selector across overlapping clips and gaps', () => {
  const source = fixture()
  source.videoTimeline.characterGaps.push({ id: 'gap-overlap', elementId: 'actor-a', startFrame: 12, endFrame: 16 })
  source.videoTimeline.textClips.push({ id: 'speech-overlap', elementId: 'bubble-a', kind: 'speech', startFrame: 6, endFrame: 9 })
  source.videoTimeline.videoClips.push({ id: 'video-overlap', assetId: 'media-b', startFrame: 12, endFrame: 19, sourceStartFrame: 100, sourceEndFrame: 107 })
  const sceneProgram = program(source, 'animated')
  const timeline = sceneProgram.snapshot.timeline
  for (let frame = 0; frame < timeline.durationFrames; frame += 1) {
    const expected = frameHelpers.resolveVideoFrameSelection(timeline, frame)
    const actual = evaluateVideoSceneFrame(sceneProgram, frame)
    assert.equal(actual.characters[0].hidden, expected.hiddenCharacterIds.has('actor-a'), `gap visibility frame ${frame}`)
    assert.deepEqual(actual.layers.filter((layer) => layer.type === 'element' && layer.clipId).map((layer) => layer.clipId),
      ['bubble-a', 'bubble-t'].map((id) => expected.textClipByElementId.get(id)?.id).filter(Boolean), `active text frame ${frame}`)
    assert.deepEqual(actual.videos.map((clip) => clip.clipId), expected.videoClips.map((clip) => clip.id), `active video frame ${frame}`)
  }
})

test('authored transition preference is respected; static mode disables only character automatics', () => {
  const source = fixture()
  source.videoTimeline.animateCharacterTransitions = false
  const animated = evaluateVideoSceneFrame(program(source, 'animated'), 7)
  const staticCharacters = evaluateVideoSceneFrame(program(source, 'static-characters'), 7)
  assert.equal(animated.characters[0].transition, undefined)
  assert.equal(animated.characters[0].automaticMouth, undefined)
  assert.equal(staticCharacters.characters[0].transition, undefined)
  assert.equal(staticCharacters.characters[0].automaticMouth, undefined)
  assert.equal(staticCharacters.characters[0].automaticBlink, false)
  assert.equal(evaluateVideoSceneFrame(program(source, 'static-characters'), 15).characters[0].authoredState?.imageDataUrl, 'data:image/png;base64,NEXT')
})

test('animated blink is deterministic by absolute frame and disabled in static-character mode', () => {
  const source = fixture()
  source.videoTimeline.durationFrames = 1200
  const frame = Array.from({ length: 1200 }, (_, index) => index).find((index) => frameHelpers.automaticBlinkFrameFor(index, 'actor-a', 60))
  assert.notEqual(frame, undefined)
  const animated = evaluateVideoSceneFrame(program(source, 'animated'), frame)
  const staticCharacters = evaluateVideoSceneFrame(program(source, 'static-characters'), frame)
  assert.equal(animated.characters[0].automaticBlink, true)
  assert.equal(staticCharacters.characters[0].automaticBlink, false)
})


test('unknown export render variants are rejected instead of silently enabling animations', () => {
  const snapshot = snapshotModule.createVideoExportSnapshot(fixture())
  assert.throws(() => compileVideoScene(snapshot, 'unrecognized-mode'), /Variante de renderização de vídeo inválida/)
  assert.throws(() => compileVideoScene(snapshot, null), /Variante de renderização de vídeo inválida/)
  assert.doesNotThrow(() => compileVideoScene(snapshot, 'animated'))
  assert.doesNotThrow(() => compileVideoScene(snapshot, 'static-characters'))
})


test('semantic reuse key stays equal only while canonical pixels are guaranteed equal', () => {
  const source = fixture()
  const staticProgram = program(source, 'static-characters')
  assert.equal(
    evaluateVideoSceneFrame(staticProgram, 1).reuseKey,
    evaluateVideoSceneFrame(staticProgram, 2).reuseKey,
    'consecutive static frames may reuse one raster',
  )
  assert.notEqual(
    evaluateVideoSceneFrame(staticProgram, 14).reuseKey,
    evaluateVideoSceneFrame(staticProgram, 15).reuseKey,
    'authored key boundary invalidates reuse even without interpolation',
  )
  assert.notEqual(
    evaluateVideoSceneFrame(staticProgram, 12).reuseKey,
    evaluateVideoSceneFrame(staticProgram, 13).reuseKey,
    'video source tick invalidates reuse conservatively',
  )

  const animatedSource = fixture()
  animatedSource.videoTimeline.videoClips = []
  const animated = program(animatedSource, 'animated')
  assert.equal(
    evaluateVideoSceneFrame(animated, 16).reuseKey,
    evaluateVideoSceneFrame(animated, 17).reuseKey,
    'same automatic mouth hold-frame recipe can reuse raster',
  )
  assert.notEqual(
    evaluateVideoSceneFrame(animated, 15).reuseKey,
    evaluateVideoSceneFrame(animated, 16).reuseKey,
    'mouth phase changes invalidate reuse',
  )
  assert.notEqual(
    evaluateVideoSceneFrame(animated, 7).reuseKey,
    evaluateVideoSceneFrame(animated, 8).reuseKey,
    'interpolated transition frames never collapse together',
  )
})
