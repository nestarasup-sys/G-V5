import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const compile = async (path, replacements = {}) => {
  let code = ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  for (const [from, to] of Object.entries(replacements)) code = code.replaceAll(from, JSON.stringify(to))
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}
const history = await compile('../src/renderer/src/features/videoStudio/editHistory.ts')
const module = await import(await compile('../src/renderer/src/features/videoStudio/characterTransitions.ts', { "'./editHistory'": history }))
const { compileCharacterTransitions, transitionProgress, transitionSampleFrames, mixAngle, mixPoseArtwork, mixStudioTransforms, mixEffects, mixStageElement } = module
const neutral = { enabled: false, color: '#000000', opacity: 1, softness: .5, size: .2, offsetY: 0 }
const state = (id, pose, preset) => ({ element: { id, characterId: id, kind: 'character', poseSlot: pose, activeExpressionPresetId: preset, x: 0, y: 0, width: 20, height: 50, rotation: 0, zIndex: 0, text: id }, imageDataUrl: `image-${id}-${pose}-${preset}` })
for (const count of [1, 2, 10]) {
  const elements = [], bases = {}, keys = []
  for (let i = 0; i < count; i++) {
    const id = `actor-${i}`, base = state(id, 1, null), angry = state(id, 1, 'indignada'), posed = state(id, 3, 'indignada')
    elements.push(base.element); bases[id] = base
    keys.push({ id: `${id}-1`, elementId: id, frame: 180, state: angry }, { id: `${id}-2`, elementId: id, frame: 360, state: posed })
  }
  const studio = { elements, videoTimeline: { durationFrames: 36000, characterBases: bases, characterKeys: keys, characterGaps: [] } }
  const before = JSON.stringify(studio)
  const transitions = compileCharacterTransitions(studio)
  assert.equal(transitions.length, count * 2)
  for (const span of transitions) {
    assert.ok(Math.abs((span.boundaryFrame - span.startFrame) / 60 * 1000 - 250) < 1e-8, 'A quarter second must span exactly 15 frames')
    assert.equal(transitionProgress(span, span.startFrame - .001), 0)
    assert.equal(transitionProgress(span, span.startFrame), 0)
    assert.ok(Math.abs(transitionProgress(span, (span.startFrame + span.boundaryFrame) / 2) - .5) < 1e-9)
    assert.equal(transitionProgress(span, span.boundaryFrame), 1)
    assert.equal(transitionProgress(span, span.boundaryFrame + .001), 1)
    assert.deepEqual(transitionSampleFrames(span), Array.from({ length: 14 }, (_, index) => span.boundaryFrame - 14 + index))
  }
  studio.videoTimeline.characterGaps = [{ elementId: 'actor-0', startFrame: 120, endFrame: 180 }]
  assert.equal(compileCharacterTransitions(studio).length, count * 2 - 1, 'No animation across an excluded span')
  studio.videoTimeline.characterGaps = []
  assert.equal(JSON.stringify(studio), before, 'Evaluation must never change authoring documents')
}
const base = state('x', 1, null)
assert.equal(compileCharacterTransitions({ elements: [base.element], videoTimeline: { durationFrames: 600, characterBases: { x: base }, characterKeys: [{ elementId: 'x', frame: 60, state: structuredClone(base) }] } }).length, 0)
const short = compileCharacterTransitions({ elements: [base.element], videoTimeline: { durationFrames: 600, characterBases: { x: base }, characterKeys: [{ elementId: 'x', frame: 1, state: state('x', 2, null) }] } })[0]
assert.equal(short.startFrame, 0, 'A transition cannot start before its own span')
assert.equal(mixAngle(170, -170, .5), 180)
const transform = { x: 30, y: 40, scaleX: 1, scaleY: 1, rotation: 170 }
const intermediate = mixStudioTransforms({ eye: { x: 0, y: 0, width: 100, height: 100, rotation: 0, sourceTransformOverride: transform } }, { eye: { x: 10, y: -4, width: 150, height: 80, rotation: 20, sourceTransformOverride: { ...transform, x: 50, rotation: -170 } } }, .5).eye
assert.equal(intermediate.x, 5); assert.equal(intermediate.width, 125); assert.equal(intermediate.sourceTransformOverride.rotation, 180)
const effects = mixEffects({ shadow: neutral, blush: neutral, mouthBlush: neutral }, { shadow: { ...neutral, enabled: true, opacity: .8, color: '#ffffff' }, blush: neutral, mouthBlush: neutral }, .5)
assert.equal(effects.shadow.opacity, .4); assert.equal(effects.shadow.color, '#808080'); assert.equal(effects.shadow.enabled, true)
const part = (id, x, y, w, h, rotation) => ({ id, name: id, x, y, width: w, height: h, rotation, dataUrl: id })
const a = { width: 300, height: 500, parts: [part('torso', 125, 110, 50, 100, 0), part('arm', 175, 110, 20, 100, 0)], joints: [{ id: 'j', parentPartId: 'torso', childPartId: 'arm', parentAnchor: { x: 185, y: 120 }, childAnchor: { x: 185, y: 120 } }] }
const b = { ...a, parts: [a.parts[0], part('arm', 135, 70, 20, 100, 90)] }
const frozen = JSON.stringify({ a, b })
const pose = mixPoseArtwork(a, b, .5)
assert.equal(pose.parts[1].rotation, 45)
assert.deepEqual(pose.joints[0].parentAnchor, pose.joints[0].childAnchor, 'Connected limbs must stay attached')
assert.equal(JSON.stringify({ a, b }), frozen)
assert.equal(mixPoseArtwork(a, b, 0), a); assert.equal(mixPoseArtwork(a, b, 1), b)
assert.equal(mixStageElement({ ...base.element, characterScale: 50 }, { ...base.element, x: 20, characterScale: 150 }, .5).characterScale, 100)
console.log('Character transition audit passed: exact 250 ms, 1/2/10 actors, endpoints, gaps, base/preset, pose, effects, joint constraints and immutable sources.')
