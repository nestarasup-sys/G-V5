#!/usr/bin/env node
'use strict'

// Incremental architecture gate. Legacy debt is not "approved": this stops
// growth while giving refactoring teams a deterministic migration baseline.
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { scanAst } = require('./boundary-ast.cjs')
const policyFile = join(__dirname, 'feature-boundary-debt.json')

function key(edge) {
  return JSON.stringify([edge.from, edge.to, edge.importKind, edge.typeOnly])
}

function evaluateBoundaryDebt(report, policy) {
  if (policy.schemaVersion !== 1 || !Array.isArray(policy.edges)) throw new Error('Invalid boundary policy schema')
  const permitted = new Map()
  for (const edge of policy.edges) {
    if (!edge.from || !edge.to || !edge.importKind || typeof edge.typeOnly !== 'boolean'
      || !Number.isSafeInteger(edge.maxOccurrences) || edge.maxOccurrences < 1
      || !edge.classification || !edge.rationale) throw new Error('Invalid debt record')
    const edgeKey = key(edge)
    if (permitted.has(edgeKey)) throw new Error(`Duplicate baseline edge: ${edgeKey}`)
    permitted.set(edgeKey, edge)
  }
  const observed = new Map()
  for (const edge of report.crossFeature ?? []) {
    const edgeKey = key(edge)
    observed.set(edgeKey, (observed.get(edgeKey) ?? 0) + 1)
  }
  const regressions = []
  for (const [edgeKey, count] of observed) {
    const allowance = permitted.get(edgeKey)
    if (!allowance) {
      regressions.push({ type: 'new-cross-feature-edge', edge: JSON.parse(edgeKey), occurrences: count })
    } else if (count > allowance.maxOccurrences) {
      regressions.push({
        type: 'increased-debt', edge: JSON.parse(edgeKey), occurrences: count,
        maxAllowedOccurrences: allowance.maxOccurrences
      })
    }
  }
  const stale = [...permitted.entries()].filter(([edgeKey]) => !observed.has(edgeKey))
    .map(([edgeKey]) => ({ edge: JSON.parse(edgeKey), status: 'remove-when-confirmed' }))
  const totals = {
    edgesObserved: report.crossFeatureCount, uniqueObserved: observed.size,
    permittedLegacyEdges: permitted.size, staleBaselineEdges: stale.length
  }
  return {
    schemaVersion: 1, engine: report.engine, status: regressions.length ? 'failed' : 'passed',
    ...totals, regressions, staleBaseline: stale,
    interpretation: 'PASS means no NEW cross-feature debt, NOT that legacy coupling is safe.'
  }
}

if (require.main === module) {
  const report = scanAst()
  const policy = JSON.parse(readFileSync(policyFile, 'utf8'))
  const result = evaluateBoundaryDebt(report, policy)
  console.log(JSON.stringify(result, null, 2))
  if (result.status !== 'passed') process.exitCode = 1
}

module.exports = { key, evaluateBoundaryDebt }
