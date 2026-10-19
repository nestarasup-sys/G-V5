'use strict'

// Local-only real-character review. It refuses the active profile and only
// launches the hidden Electron app against a hash-verified private copy.
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { spawn } = require('node:child_process')
const { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } = require('node:fs')
const { join, relative, resolve, sep } = require('node:path')

const ROOT = resolve(__dirname, '../..')
const ALLOWED_ROOT = resolve(process.env.LOCALAPPDATA ?? '', 'GachaV5PrivateValidation')
const ELECTRON = require('electron')
const DRIVER = join(ROOT, 'scripts', 'dev-ai', 'studio-ipc-driver.cjs')
const CHARACTERS_RELATIVE = join('customizer', 'characters', 'characters.json')
const TARGETS = ['Ayla', 'Chloe']

function inside(root, target) {
  const relativePath = relative(root, target)
  return Boolean(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`)
}

function assertCanonicalPath(path) {
  assert.ok(existsSync(path), `Private path not found: ${path}`)
  assert.equal(lstatSync(path).isSymbolicLink(), false, `Symlink rejected: ${path}`)
  assert.equal(realpathSync(path).toLowerCase(), path.toLowerCase(), `Non-canonical private path: ${path}`)
}

function hashTree(root) {
  const result = Object.create(null)
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name)
      const relativePath = relative(root, path).replaceAll('\\', '/')
      const stat = lstatSync(path)
      assert.equal(stat.isSymbolicLink(), false, `Symlink rejected in private data: ${relativePath}`)
      if (entry.isDirectory()) walk(path)
      else {
        assert.equal(stat.isFile(), true, `Unsupported private data entry: ${relativePath}`)
        result[relativePath] = createHash('sha256').update(readFileSync(path)).digest('hex')
      }
    }
  }
  walk(root)
  return result
}

function hashAreas(root, areas) {
  const result = Object.create(null)
  for (const area of areas) {
    const areaRoot = join(root, area)
    for (const [path, hash] of Object.entries(hashTree(areaRoot))) result[`${area}/${path}`] = hash
  }
  return result
}

function normalizedHashes(map) {
  return Object.fromEntries(Object.entries(map).map(([path, hash]) => [path.replaceAll('\\', '/'), hash.toLowerCase()]))
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => {
    const item = value[key]
    if (key === 'updatedAt' && typeof item === 'string' && Number.isFinite(Date.parse(item))) {
      return [key, new Date(item).toISOString()]
    }
    return [key, stable(item)]
  }))
}

function neutralizeWardrobeTransforms(characters) {
  return characters.map(character => {
    const copy = structuredClone(character)
    if (!TARGETS.includes(copy.name)) return copy
    for (const group of copy.customization?.wardrobeGroups ?? []) {
      group.offsetX = 0
      group.offsetY = 0
      group.scaleX = 1
      group.scaleY = 1
      group.rotation = 0
    }
    return copy
  })
}

function loadPrivateRoot(privateRoot) {
  const root = resolve(privateRoot)
  assert.ok(inside(ALLOWED_ROOT, root), 'Profile root must be below local GachaV5PrivateValidation')
  assertCanonicalPath(ALLOWED_ROOT)
  assertCanonicalPath(root)
  const markerPath = join(root, 'private-copy-marker.json')
  assertCanonicalPath(markerPath)
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
  assert.equal(marker.schemaVersion, 1)
  assert.equal(marker.privateDataCopy, true)
  assert.equal(marker.verifiedSha256, true)
  assert.ok(['baseline', 'wardrobe-reset'].includes(marker.copyMode))
  const backup = resolve(marker.sourceBackup)
  assert.ok(inside(ALLOWED_ROOT, backup) && backup.toLowerCase() !== root.toLowerCase())
  assertCanonicalPath(backup)
  const backupManifestPath = join(backup, 'backup-manifest.json')
  assertCanonicalPath(backupManifestPath)
  const backupManifest = JSON.parse(readFileSync(backupManifestPath, 'utf8'))
  assert.equal(backupManifest.schemaVersion, 1)
  assert.equal(Object.keys(backupManifest.hashes ?? {}).length, backupManifest.fileCount,
    'Verified backup manifest inventory is inconsistent')
  const userData = join(root, 'userData')
  assertCanonicalPath(userData)
  assertCanonicalPath(join(userData, 'customizer'))
  assertCanonicalPath(join(userData, 'fabricator'))
  return { root, marker, backup, backupManifest, userData }
}

function verifyBaselineCopy(profile) {
  assert.equal(profile.marker.copyMode, 'baseline')
  const current = hashTree(profile.userData)
  const expected = normalizedHashes(profile.backupManifest.hashes)
  assert.deepEqual(Object.keys(current).sort(), Object.keys(expected).sort(), 'Baseline copy file inventory differs from verified backup')
  for (const [path, hash] of Object.entries(expected)) assert.equal(current[path], hash, `Baseline copy SHA-256 mismatch: ${path}`)
  return current
}

function verifyResetCopy(profile) {
  assert.equal(profile.marker.copyMode, 'wardrobe-reset')
  const baselineRoot = resolve(profile.marker.baselineCopy ?? '')
  assert.ok(inside(ALLOWED_ROOT, baselineRoot) && baselineRoot.toLowerCase() !== profile.root.toLowerCase())
  const baseline = loadPrivateRoot(baselineRoot)
  verifyBaselineCopy(baseline)
  const resetCopyReport = JSON.parse(readFileSync(join(profile.root, 'reset-report.json'), 'utf8'))
  assert.equal(resetCopyReport.originalProfileModified, false)
  assert.equal(resetCopyReport.fabricatorUnchanged, true)
  const beforeCharacters = JSON.parse(readFileSync(join(baseline.userData, CHARACTERS_RELATIVE), 'utf8'))
  const resetCharacters = JSON.parse(readFileSync(join(profile.userData, CHARACTERS_RELATIVE), 'utf8'))
  const expectedNeutral = neutralizeWardrobeTransforms(beforeCharacters)
  assert.deepEqual(stable(resetCharacters), stable(expectedNeutral),
    'The reset copy changed character data beyond per-character wardrobe transforms')
  const beforeTargetCount = beforeCharacters.filter(character => TARGETS.includes(character.name)).length
  assert.equal(beforeTargetCount, TARGETS.length)
  const normalizedGroups = beforeCharacters.filter(character => TARGETS.includes(character.name))
    .flatMap(character => character.customization.wardrobeGroups ?? [])
    .filter(group => group.offsetX !== 0 || group.offsetY !== 0 || group.scaleX !== 1 || group.scaleY !== 1 || group.rotation !== 0)
  assert.equal(resetCopyReport.resetGroupCount, normalizedGroups.length)
  assert.ok(normalizedGroups.length > 0, 'No real character adjustment existed to reset')
  const resetHashes = hashTree(profile.userData)
  const expectedFiles = normalizedHashes(profile.backupManifest.hashes)
  assert.deepEqual(Object.keys(resetHashes).sort(), Object.keys(expectedFiles).sort(), 'Reset copy file inventory changed')
  for (const [path, hash] of Object.entries(expectedFiles)) {
    if (path !== CHARACTERS_RELATIVE.replaceAll('\\', '/')) {
      assert.equal(resetHashes[path], hash, `Reset copy changed non-character data: ${path}`)
    }
  }
  return { baseline, resetHashes, resetGroupCount: normalizedGroups.length }
}

function makeRunDirectory(profile) {
  const runName = `evidence-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`
  mkdirSync(join(profile.root, 'evidence'), { recursive: true })
  const output = join(profile.root, 'evidence', runName)
  mkdirSync(output, { recursive: false })
  return output
}

function assertPrivateOutput(profile, output) {
  const evidenceRoot = join(profile.root, 'evidence')
  assert.ok(inside(profile.root, output), 'Evidence path escaped private copy')
  assert.equal(relative(profile.root, output).split(sep)[0], 'evidence', 'Evidence must stay under private evidence folder')
  for (const path of [evidenceRoot, output]) assertCanonicalPath(path)
}

function privateEnvironment(profile, output, compareProfile = null, compareOutput = null) {
  const osRoot = join(profile.root, 'isolated-os-profile')
  const appData = join(osRoot, 'AppData', 'Roaming')
  const localAppData = join(osRoot, 'AppData', 'Local')
  const temp = join(osRoot, 'Temp')
  for (const path of [appData, localAppData, temp, join(osRoot, 'Home'), join(osRoot, 'UserProfile')]) {
    mkdirSync(path, { recursive: true })
  }
  const inherited = Object.fromEntries(['PATH', 'SYSTEMROOT', 'WINDIR', 'ComSpec', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_LEVEL']
    .filter(key => process.env[key]).map(key => [key, process.env[key]]))
  return {
    ...inherited,
    CI: '1',
    HOME: join(osRoot, 'Home'),
    USERPROFILE: join(osRoot, 'UserProfile'),
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    TMP: temp,
    TEMP: temp,
    GACHA_DEV_AI_TEST: '1',
    GACHA_DEV_AI_PRIVATE_TEST: '1',
    GACHA_DEV_AI_PRIVATE_ROOT: profile.root,
    GACHA_DEV_AI_PRIVATE_ALLOWED_ROOT: ALLOWED_ROOT,
    GACHA_DEV_AI_SANDBOX: profile.userData,
    GACHA_DEV_AI_AUDIT_SANDBOX: profile.userData,
    GACHA_DEV_AI_AUDIT_OUTPUT: output,
    GACHA_AUDIT_OUTPUT_DIR: output,
    ...(compareProfile ? { GACHA_DEV_AI_PRIVATE_COMPARE_ROOT: compareProfile.root } : {}),
    ...(compareOutput ? { GACHA_DEV_AI_PRIVATE_COMPARE_OUTPUT: compareOutput } : {})
  }
}

function runElectron(mode, profile, output, compareProfile, compareOutput) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(ELECTRON, [DRIVER, mode], { cwd: ROOT,
      env: privateEnvironment(profile, output, compareProfile, compareOutput),
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    const timeout = setTimeout(() => {
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).unref()
      } else if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
      }
    }, 180_000)
    child.stdout.on('data', data => { stdout = (stdout + data.toString('utf8')).slice(-20_000) })
    child.stderr.on('data', data => { stderr = (stderr + data.toString('utf8')).slice(-20_000) })
    child.on('error', error => { clearTimeout(timeout); rejectRun(error) })
    child.on('close', (code, signal) => {
      clearTimeout(timeout)
      resolveRun({ mode, code, signal, stdout, stderr })
    })
  })
}

async function main() {
  const args = process.argv.slice(2)
  const baselineFlag = args.indexOf('--baseline')
  const resetFlag = args.indexOf('--reset')
  assert.ok(baselineFlag >= 0 && resetFlag >= 0, 'Usage: node scripts/dev-ai/private-character-review.cjs --baseline <copy-root> --reset <reset-copy-root>')
  const baseline = loadPrivateRoot(args[baselineFlag + 1])
  const reset = loadPrivateRoot(args[resetFlag + 1])
  assert.notEqual(baseline.root.toLowerCase(), reset.root.toLowerCase())
  const baselineHashes = verifyBaselineCopy(baseline)
  const resetState = verifyResetCopy(reset)
  const baselineOutput = makeRunDirectory(baseline)
  const resetOutput = makeRunDirectory(reset)
  assertPrivateOutput(baseline, baselineOutput)
  assertPrivateOutput(reset, resetOutput)

  const baselineRun = await runElectron('private-character-preview', baseline, baselineOutput)
  assert.equal(baselineRun.code, 0, `Baseline private Customizer render failed: ${baselineRun.stderr}`)
  const baselineEvidence = JSON.parse(readFileSync(join(baselineOutput, 'private-character-preview.json'), 'utf8'))
  assert.equal(baselineEvidence.status, 'passed')
  const afterBaseline = hashTree(baseline.userData)
  assert.deepEqual(afterBaseline, baselineHashes, 'Baseline preview wrote into copied character or Fabricador data')

  const resetRun = await runElectron('private-character-preview', reset, resetOutput)
  assert.equal(resetRun.code, 0, `Reset-copy private Customizer render failed: ${resetRun.stderr}`)
  const resetEvidence = JSON.parse(readFileSync(join(resetOutput, 'private-character-preview.json'), 'utf8'))
  assert.equal(resetEvidence.status, 'passed')
  const afterReset = hashTree(reset.userData)
  assert.deepEqual(afterReset, resetState.resetHashes, 'Reset-copy preview wrote into the copied profile')

  const compareRun = await runElectron('private-character-compare', baseline, baselineOutput, reset, resetOutput)
  assert.equal(compareRun.code, 0, `Private Customizer comparison failed: ${compareRun.stderr}`)
  assert.ok(existsSync(join(baselineOutput, 'private-character-comparison.json')),
    `Private comparison process exited without a report. stdout=${compareRun.stdout}; stderr=${compareRun.stderr}`)
  const comparison = JSON.parse(readFileSync(join(baselineOutput, 'private-character-comparison.json'), 'utf8'))
  assert.equal(comparison.status, 'passed')
  assert.deepEqual(hashTree(baseline.userData), baselineHashes,
    'Comparison run wrote into baseline character or Fabricador data')
  assert.deepEqual(hashTree(reset.userData), resetState.resetHashes,
    'Comparison run wrote into reset-copy character or Fabricador data')

  // Verify the real source data is byte-for-byte unchanged after all cloned runs.
  const originalRoot = resolve(baseline.backupManifest.sourceRoot)
  const original = hashAreas(originalRoot, ['customizer', 'fabricator'])
  const expectedOriginal = normalizedHashes(baseline.backupManifest.hashes)
  assert.deepEqual(Object.keys(original).sort(), Object.keys(expectedOriginal).sort())
  for (const [path, hash] of Object.entries(expectedOriginal)) {
    assert.equal(original[path], hash, `Original profile changed during isolated review: ${path}`)
  }
  const summary = { schemaVersion: 1, status: 'passed', localOnly: true,
    originalUserProfileModified: false, verifiedBackupFiles: baselineHashes && Object.keys(baselineHashes).length,
    restoreCopyVerified: true, independentBaselineAndResetCopies: true,
    resetGroupCount: resetState.resetGroupCount,
    baselineEvidence: 'private-character-preview.json', resetEvidence: 'private-character-preview.json',
    comparisonEvidence: 'private-character-comparison.json',
    actorSummary: comparison.actors.map(actor => ({ name: actor.name,
      adjustedGroupsBefore: actor.adjustedGroupsBefore, adjustedGroupsAfter: actor.adjustedGroupsAfter,
      changedPixelRatio: actor.changedPixelRatio })),
    externalServicesUsed: false, githubActionsDispatched: false }
  writeFileSync(join(baselineOutput, 'private-run-summary.json'), JSON.stringify(summary, null, 2))
  process.stdout.write(JSON.stringify({ ...summary, evidenceDirectory: baselineOutput }) + '\n')
}

main().catch(error => {
  process.stderr.write(`${error?.stack ?? error}\n`)
  process.exitCode = 1
})
