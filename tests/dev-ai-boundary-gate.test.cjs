'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { evaluateBoundaryDebt } = require('../scripts/dev-ai/feature-boundary-gate.cjs')

const original = {
  schemaVersion: 1, edges: [{
    from: 'src/renderer/src/features/studio/Editor.ts',
    to: 'src/renderer/src/features/customizer/Render.ts',
    importKind: 'dynamic-import', typeOnly: false,
    maxOccurrences: 2, classification: 'legacy-extract', rationale: 'Move to shared capability'
  }]
}
const existing = { engine: 'typescript-ast', crossFeatureCount: 2,
  crossFeature: Array.from({ length: 2 }, () => ({
    ...original.edges[0], line: 5, classification: 'needs-owner-review'
  })) }

test('legacy imports stay visible without automatically approving their design', () => {
  const result = evaluateBoundaryDebt(existing, original)
  assert.equal(result.status, 'passed')
  assert.equal(result.edgesObserved, 2)
  assert.match(result.interpretation, /NOT/)
})

test('new edge and increased occurrence fail without changing policy', () => {
  const expanded = { ...existing, crossFeatureCount: 4, crossFeature: [
    ...existing.crossFeature, { ...original.edges[0], line: 22 },
    { ...original.edges[0], from: 'src/renderer/src/features/videoStudio/Other.ts', line: 1 }
  ] }
  const result = evaluateBoundaryDebt(expanded, original)
  assert.equal(result.status, 'failed')
  assert.deepEqual(result.regressions.map(x => x.type).sort(), ['increased-debt', 'new-cross-feature-edge'])
})

test('reduced debt is allowed and stale records are reported', () => {
  const report = evaluateBoundaryDebt({ engine: 'typescript-ast', crossFeatureCount: 0, crossFeature: [] }, original)
  assert.equal(report.status, 'passed')
  assert.equal(report.staleBaselineEdges, 1)
})

test('malformed or duplicate policy entries are never silently ignored', () => {
  assert.throws(() => evaluateBoundaryDebt(existing,
    { schemaVersion: 1, edges: [original.edges[0], original.edges[0]] }), /Duplicate/)
  assert.throws(() => evaluateBoundaryDebt(existing, { schemaVersion: 1,
    edges: [{ ...original.edges[0], maxOccurrences: 0 }] }), /Invalid debt/)
})
