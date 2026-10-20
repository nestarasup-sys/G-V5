'use strict'
/** A source-only architecture inventory: metrics are static signals, not measured runtime performance. */
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const budgets = {
  'src/renderer/src/features/customizer/CustomizerPage.tsx': 4053,
  'electron/main.ts': 3618,
  'src/renderer/src/features/videoStudio/VideoStudioEditor.tsx': 2613,
  'src/renderer/src/features/studio/StudioPage.tsx': 1673,
  'src/renderer/src/features/fabricator/FabricatorPage.tsx': 1085,
  'src/renderer/src/ui/App.tsx': 862
}
function analyzeSource(content) {
  return {
    lines: content.split(/\r?\n/).length,
    reactEffects: (content.match(/\buseEffect\s*\(/g) || []).length,
    eventListeners: (content.match(/\baddEventListener\s*\(/g) || []).length,
    ipcHandlers: (content.match(/\bipcMain\.handle\s*\(/g) || []).length,
    syncFsCalls: (content.match(/\b(?:readFileSync|writeFileSync|readdirSync|statSync|existsSync|lstatSync|realpathSync)\s*\(/g) || []).length
  }
}
function audit(directory = root) {
  return Object.entries(budgets).map(([file, maxLines]) => {
    const content = fs.readFileSync(path.join(directory, file), 'utf8')
    return { file, maxLines, ...analyzeSource(content) }
  })
}
if (require.main === module) {
  const rows = audit()
  const overBudget = rows.filter(row => row.lines > row.maxLines)
  console.log(JSON.stringify({ kind: 'static-architecture-budget', rows, overBudget: overBudget.map(r => r.file) }, null, 2))
  if (process.argv.includes('--check') && overBudget.length) process.exitCode = 1
}
module.exports = { analyzeSource, audit, budgets }
