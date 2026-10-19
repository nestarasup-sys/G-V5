'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { staticImports, scanAst } = require('../scripts/dev-ai/boundary-ast.cjs')

test('TypeScript parser ignores import-like text in comments and strings', () => {
  const specs = staticImports(`
// import '../../other/broken'
const raw = "from '../wrong/module'"
import type { StudioType } from '../studio/types'
import { value } from '../studio/real'
export { value as shared } from '../studio/real'
const lazy = () => import('../studio/lazy')
const cjs = require('../studio/common')
type ImportType = import('../studio/types').StudioType
`, 'Video.tsx')
  assert.deepEqual(specs.map(x => x.importKind),
    ['import', 'import', 'export', 'dynamic-import', 'require', 'import-type'])
  assert.equal(specs.filter(x => x.typeOnly).length, 2)
  assert.ok(specs.every(x => !x.spec.includes('wrong') && !x.spec.includes('broken')))
})

test('AST edges classify cross-feature runtime vs type and resolve Vite asset queries', () => {
  const root = mkdtempSync(join(tmpdir(), 'gacha-ast-boundaries-'))
  try {
    const normal = join(root, 'src/renderer/src/features/studio')
    const video = join(root, 'src/renderer/src/features/videoStudio')
    mkdirSync(normal, { recursive: true })
    mkdirSync(video, { recursive: true })
    writeFileSync(join(normal, 'types.ts'), 'export type T = { id: string }')
    writeFileSync(join(normal, 'helper.ts'), 'export const value = 2')
    writeFileSync(join(video, 'style.css'), '.video { color: red }')
    writeFileSync(join(video, 'Video.tsx'), `
      import type { T } from '../studio/types'
      import { value } from '../studio/helper'
      import style from './style.css?inline'
      export type { T as External } from '../studio/types'
      export const lazy = () => import('../studio/helper')
    `)
    const report = scanAst(root)
    assert.equal(report.engine, 'typescript-ast')
    assert.equal(report.scannedFiles, 3)
    assert.equal(report.crossFeatureCount, 4)
    assert.equal(report.typeOnlyCrossFeature, 2)
    assert.equal(report.runtimeCrossFeature, 2)
    assert.equal(report.unresolvedCount, 0, JSON.stringify(report.unresolved))
    assert.equal(report.crossFeature.filter(e => e.classification === 'needs-owner-review').length, 4)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
