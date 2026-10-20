'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { analyzeSource, audit, budgets } = require('../scripts/architecture/performance-audit.cjs')

test('static audit detects effects, subscriptions, IPC and sync IO without running the app', () => {
  const src = [
    'useEffect(() => {})',
    'window.addEventListener("resize", listener)',
    'ipcMain.handle("x", callback)',
    'readFileSync("file")'
  ].join('\n')
  assert.deepEqual(analyzeSource(src), {
    lines: 4, reactEffects: 1, eventListeners: 1, ipcHandlers: 1, syncFsCalls: 1
  })
})

test('central modules stay within their current growth budgets', () => {
  const rows = audit()
  assert.equal(rows.length, Object.keys(budgets).length)
  assert.deepEqual(rows.filter(r => r.lines > r.maxLines).map(r => r.file), [])
})
