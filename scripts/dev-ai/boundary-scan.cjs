#!/usr/bin/env node
'use strict'
const { readdirSync, readFileSync, existsSync, lstatSync } = require('node:fs')
const { resolve, relative, dirname, join, extname, sep, isAbsolute } = require('node:path')
const ROOT = resolve(__dirname, '../..')
const EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.json']
const SOURCE_EXT = new Set(['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs'])
const norm = p => p.replaceAll('\\', '/')
const inRoot = (p, root) => {
  const r = relative(root, p)
  return r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r)
}

function walk(dir, output = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isSymbolicLink()) continue
    if (e.isDirectory()) walk(p, output)
    else if (e.isFile() && SOURCE_EXT.has(extname(p))) output.push(p)
  }
  return output
}

function owner(path) {
  const match = norm(path).match(/(?:^|\/)src\/renderer\/src\/features\/([^/]+)\//)
  return match?.[1] ?? null
}

function resolveImport(from, spec, root = ROOT) {
  if (!spec.startsWith('.')) return null
  const candidate = resolve(dirname(from), spec)
  if (!inRoot(candidate, root)) return { error: 'escapes-repo' }
  for (const path of [candidate, ...EXTENSIONS.map(ext => candidate + ext), ...EXTENSIONS.map(ext => join(candidate, 'index' + ext))]) {
    if (existsSync(path) && lstatSync(path).isFile()) return { file: path }
  }
  return { error: 'unresolved' }
}

function imports(code) {
  // Static audit only: regex misses some computed imports. An AST-based rule
  // and behavioral tests are required before treating this as a hard gate.
  const specs = []
  const regex = /(?:\bfrom\s*|\bimport\s*\(|\bimport\s*|\brequire\s*\()\s*['"]([^'"\n]+)['"]/g
  for (const m of code.matchAll(regex)) specs.push(m[1])
  return [...new Set(specs)]
}

function scan(root = ROOT) {
  const list = walk(join(root, 'src'))
  const edges = [], unresolved = [], crossFeature = []
  for (const file of list) {
    const source = readFileSync(file, 'utf8')
    for (const spec of imports(source)) {
      const answer = resolveImport(file, spec, root)
      if (!answer) continue
      if (!answer.file) {
        unresolved.push({ source: norm(relative(root, file)), spec, reason: answer.error })
        continue
      }
      const from = norm(relative(root, file)), to = norm(relative(root, answer.file))
      const edge = { from, to, fromFeature: owner(from), toFeature: owner(to) }
      edges.push(edge)
      if (edge.fromFeature && edge.toFeature && edge.fromFeature !== edge.toFeature) crossFeature.push(edge)
    }
  }
  return {
    schemaVersion: 1, scannedFiles: list.length, edges, crossFeature, unresolved,
    limitations: ['static regex detection, not TS AST', 'no transitive/conditional runtime proof', 'no lifecycle/CSS enforcement']
  }
}

if (require.main === module) {
  const report = scan()
  const compact = {
    schemaVersion: 1, scannedFiles: report.scannedFiles, imports: report.edges.length,
    crossFeatureCount: report.crossFeature.length, unresolvedCount: report.unresolved.length,
    crossFeature: report.crossFeature, unresolved: report.unresolved, limitations: report.limitations
  }
  console.log(JSON.stringify(compact, null, 2))
  if (process.argv.includes('--strict') && (report.crossFeature.length || report.unresolved.length)) process.exitCode = 1
}
module.exports = { walk, owner, resolveImport, imports, scan }
