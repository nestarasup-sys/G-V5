'use strict'

// Existing audits remain assertion owners; catalog makes their prerequisites
// and data-safety expectations explicit.
const audits = Object.freeze([
  { id: 'character-transitions', file: 'scripts/audit-character-transitions.mjs', mode: 'node', suite: 'fast', data: 'synthetic', requires: ['typescript'] },
  { id: 'expression-transforms', file: 'scripts/audit-expression-transforms.mjs', mode: 'node', suite: 'fast', data: 'synthetic', requires: ['typescript'] },
  { id: 'hair-eraser', file: 'scripts/audit-hair-eraser.mjs', mode: 'node', suite: 'fast', data: 'synthetic', requires: ['typescript'] },
  { id: 'hair-persistence', file: 'scripts/audit-hair-persistence.mjs', mode: 'node', suite: 'fast', data: 'synthetic', requires: ['typescript'] },
  { id: 'video-audio', file: 'scripts/audit-video-audio.mjs', mode: 'node', suite: 'fast', data: 'synthetic', requires: ['typescript'] },
  { id: 'video-media', file: 'scripts/audit-video-media.mjs', mode: 'node', suite: 'fast', data: 'synthetic', requires: ['typescript'] },
  { id: 'video-library', file: 'scripts/audit-video-library.mjs', mode: 'node', suite: 'fast', data: 'synthetic', requires: ['typescript'], writes: 'out/audit-video-library/<uuid>' },
  { id: 'wardrobe-flow', file: 'scripts/audit-wardrobe-flow.mjs', mode: 'node', suite: 'fast', data: 'synthetic', requires: ['typescript'], note: 'Fabricator source -> pose -> Customizer character-only placement contracts' },
  { id: 'wardrobe-v2-compatibility', file: 'scripts/audit-wardrobe-v2-compatibility.mjs', mode: 'node', suite: 'fast', data: 'synthetic', requires: ['typescript'], note: 'Reject all ten shuffled or invalid source sheet frames' },
  { id: 'studio-isolation', file: 'scripts/audit-studio-isolation.cjs', mode: 'electron', suite: 'isolation', data: 'synthetic', requires: ['build', 'electron'], output: 'out/dev-ai/runs/<run-id>/studio-isolation' },
  { id: 'studio-ipc-real', file: 'scripts/audit-studio-ipc.cjs', mode: 'electron-controller', suite: 'ipc', data: 'synthetic', requires: ['build', 'electron'], output: 'out/dev-ai/runs/<run-id>/studio-ipc-real' },
  { id: 'character-transitions-ui', file: 'scripts/audit-character-transitions-ui.cjs', mode: 'electron', suite: 'manual', data: 'synthetic', requires: ['build', 'electron'], note: 'UI fixture; legacy output under out/' },
  { id: 'video-library-ui', file: 'scripts/audit-video-library-ui.cjs', mode: 'electron', suite: 'manual', data: 'external-video', requires: ['build', 'electron', 'mp4-fixture'], note: 'never pass personal media in unattended runs' },
  { id: 'video-timeline', file: 'scripts/audit-video-timeline.cjs', mode: 'electron', suite: 'manual', data: 'external-video', requires: ['build', 'electron', 'mp4-fixture'] },
  { id: 'animator-rig', file: 'scripts/audit-animator-rig.mjs', mode: 'node', suite: 'manual', data: 'real-by-default', requires: ['explicit-synthetic-project-path'], note: 'EXCLUDED: without explicit path this audit reads APPDATA' }
])

function selected(suite) {
  if (suite === 'fast') return audits.filter(a => a.suite === 'fast')
  if (suite === 'isolation') return audits.filter(a => a.suite === 'isolation')
  if (suite === 'ipc') return audits.filter(a => a.suite === 'ipc')
  if (suite === 'all') return audits.filter(a => ['fast', 'isolation', 'ipc'].includes(a.suite))
  throw new Error(`Suite desconhecida: ${suite}`)
}

module.exports = { audits, selected }
