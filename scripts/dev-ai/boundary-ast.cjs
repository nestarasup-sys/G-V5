#!/usr/bin/env node
'use strict'

// TS AST-based diagnostic. Does not follow symbolic links or modify source.
// It deliberately reports existing violations instead of failing normal CI.
const ts = require('typescript')
const { readFileSync } = require('node:fs')
const { resolve, relative, join, extname } = require('node:path')
const { walk, owner, resolveImport } = require('./boundary-scan.cjs')
const ROOT = resolve(__dirname, '../..')
const norm = path => path.replaceAll('\\', '/')

function staticImports(source, filename) {
  const extension = extname(filename)
  const kind = extension === '.tsx' || extension === '.jsx' ? ts.ScriptKind.TSX
    : extension === '.js' || extension === '.cjs' || extension === '.mjs' ? ts.ScriptKind.JS
      : ts.ScriptKind.TS
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, kind)
  const result = []
  function append(node, value, importKind, typeOnly) {
    if (!value || !value.startsWith('.')) return
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
    result.push({ spec: value, importKind, typeOnly, line })
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const clause = node.importClause
      const named = clause?.namedBindings
      const typeOnly = Boolean(clause?.isTypeOnly || (named && ts.isNamedImports(named)
        && !clause?.name && named.elements.length > 0 && named.elements.every(e => e.isTypeOnly)))
      append(node, node.moduleSpecifier.text, 'import', typeOnly)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      append(node, node.moduleSpecifier.text, 'export', Boolean(node.isTypeOnly))
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
      const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const cjs = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if (dynamic || cjs) append(node, node.arguments[0].text, dynamic ? 'dynamic-import' : 'require', false)
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
      append(node, node.argument.literal.text, 'import-type', true)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return result
}

function scanAst(root = ROOT) {
  const files = walk(join(root, 'src'))
  const edges = [], crossFeature = [], unresolved = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const item of staticImports(source, file)) {
      const answer = resolveImport(file, item.spec.split(/[?#]/, 1)[0], root)
      const from = norm(relative(root, file))
      if (!answer?.file) {
        unresolved.push({ from, line: item.line, spec: item.spec, reason: answer?.error ?? 'external',
          importKind: item.importKind })
        continue
      }
      const to = norm(relative(root, answer.file))
      const entry = { from, line: item.line, to, spec: item.spec, fromFeature: owner(from), toFeature: owner(to),
        importKind: item.importKind, typeOnly: item.typeOnly }
      edges.push(entry)
      if (entry.fromFeature && entry.toFeature && entry.fromFeature !== entry.toFeature) {
        crossFeature.push({ ...entry, classification: 'needs-owner-review' })
      }
    }
  }
  return {
    schemaVersion: 1, engine: 'typescript-ast', scannedFiles: files.length,
    imports: edges.length, crossFeatureCount: crossFeature.length,
    typeOnlyCrossFeature: crossFeature.filter(e => e.typeOnly).length,
    runtimeCrossFeature: crossFeature.filter(e => !e.typeOnly).length,
    unresolvedCount: unresolved.length, crossFeature, unresolved,
    limitations: ['TS syntax import/re-export/require/dynamic/import-type only',
      'nonliteral computed imports cannot be resolved statically',
      'not a transitive dependency/lifecycle/CSS/IPC proof',
      'every dependency edge needs an owner-approved classification']
  }
}

if (require.main === module) {
  const report = scanAst()
  console.log(JSON.stringify(report, null, 2))
  if (process.argv.includes('--strict') && (report.crossFeatureCount || report.unresolvedCount)) process.exitCode = 1
}

module.exports = { staticImports, scanAst }
