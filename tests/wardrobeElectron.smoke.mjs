/**
 * Real Electron smoke test. Runs under xvfb in CI with the exact uploaded user
 * fixture copied to a disposable userData directory, never to the user's disk.
 * Writes screenshots as CI artifacts for manual visual inspection.
 */
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const require = createRequire(import.meta.url)
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const fixture = join(root, 'app-data', 'fabricator')
const output = join(root, 'wardrobe-screenshots')
const temp = mkdtempSync(join(tmpdir(), 'g-v5-wardrobe-e2e-'))
const xdgConfig = join(temp, 'config')
// In a non-packaged Linux Electron run, app.getName() is 'Electron'.
const appData = join(xdgConfig, 'Electron', 'fabricator')
mkdirSync(output, { recursive: true })
mkdirSync(resolve(appData, '..'), { recursive: true })
cpSync(fixture, appData, { recursive: true })

function hashTree(folder) {
  const walk = (path) => readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map((item) => {
    const full = join(path, item.name)
    return item.isDirectory() ? [item.name, walk(full)] : [item.name, createHash('sha256').update(readFileSync(full)).digest('hex')]
  })
  return JSON.stringify(walk(folder))
}
const originalHash = hashTree(appData)
let migratedHash = null
let electronApp
try {
  electronApp = await electron.launch({
    executablePath: require('electron'),
    cwd: root,
    args: [join(root, 'out', 'main', 'main.js'), '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, XDG_CONFIG_HOME: xdgConfig }
  })
  const actualUserData = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  assert.equal(actualUserData, resolve(appData, '..'), `Wrong userData path: ${actualUserData}`)
  const window = await electronApp.firstWindow()
  window.on('pageerror', (error) => console.error('Renderer error:', error.message))
  await window.evaluate(() => { location.hash = '#/fabricador-dev' })
  await window.getByRole('button', { name: 'Roupas', exact: true }).click()
  await window.locator('.wardrobe-set-row').first().waitFor({ timeout: 30000 })
  await window.locator('.wardrobe-set-row').first().click()
  await window.locator('.wardrobe-preview-part').first().waitFor()
  await window.screenshot({ path: join(output, 'reference.png') })

  for (const slot of [2, 3, 1]) {
    await window.getByRole('button', { name: /Testar pose/i }).click()
    await window.locator('.pose-model-option').first().waitFor()
    if (migratedHash === null) {
      migratedHash = hashTree(appData)
      assert.notEqual(migratedHash, originalHash, 'First visit should back up occupied slot 01 and create canonical assembly pose')
      const moved = JSON.parse(readFileSync(join(appData, 'poses', 'model-1', 'slot-3', 'pose.json'), 'utf8'))
      const initial = JSON.parse(readFileSync(join(appData, 'poses', 'model-1', 'slot-1', 'pose.json'), 'utf8'))
      assert.equal(moved.name, 'Pose de Design sem nome (54)')
      assert.equal(moved.slot, 3)
      assert.equal(initial.isInitialModelPose, true)
      assert.equal(initial.slot, 1)
    }
    const id = String(slot).padStart(2, '0')
    const choice = window.locator('.pose-model-option').filter({ has: window.locator('.pose-model-number', { hasText: id }) })
    await choice.click()
    await window.locator('.wardrobe-pose-garment .wardrobe-preview-part').first().waitFor()
    const state = await window.evaluate(() => {
      const garments = [...document.querySelectorAll('.wardrobe-pose-garment .wardrobe-preview-part')]
      const bands = document.querySelectorAll('.wardrobe-knee-band')
      const styles = garments.map((node) => ({ matrix: getComputedStyle(node).transform, loaded: node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0 }))
      return { total: garments.length, bands: bands.length, styles }
    })
    assert.equal(state.total, 7, 'All seven fitted garments must render')
    assert.equal(state.bands, 0, 'No automatic overlays may distort the manually fitted clothes')
    assert.ok(state.styles.every((g) => g.loaded && g.matrix.startsWith('matrix(')))
    await window.screenshot({ path: join(output, `pose-${id}.png`) })
    // A temporary drag may change preview offsets, but MUST NOT make the wardrobe dirty.
    const first = window.locator('.wardrobe-pose-garment .wardrobe-preview-part').first()
    const rect = await first.boundingBox()
    assert.ok(rect)
    await window.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
    await window.mouse.down()
    await window.mouse.move(rect.x + rect.width / 2 + 22, rect.y + rect.height / 2 + 10, { steps: 4 })
    await window.mouse.up()
    assert.equal(await window.locator('.wardrobe-save-state.pending').count(), 0)
    await window.getByRole('button', { name: /Sair do teste/i }).click()
    assert.equal(await window.locator('.wardrobe-pose-garment').count(), 0)
    assert.equal(hashTree(appData), migratedHash, 'Try-on must not modify poses, model, or garments after canonical pose initialization')
  }

  // Real Customizer is now backed by the Fabricador library instead of mock avatars.
  await window.evaluate(() => { location.hash = '#/customizar' })
  await window.getByRole('button', { name: 'Criar personagem', exact: true }).click()
  await window.locator('.customizer-render-body').first().waitFor({ timeout: 30000 })
  assert.equal(await window.locator('.customizer-render-body').count(), 10)
  assert.equal(await window.locator('.customizer-render-garment').count(), 0, 'New characters must start without equipped clothing')
  await window.locator('.customizer-trousers-option').first().click()
  await window.locator('.customizer-render-garment').first().waitFor()
  assert.equal(await window.locator('.customizer-render-garment').count(), 4, 'A trouser selection must equip all four parts')
  await window.locator('.customizer-garment-choice').first().locator('button').first().click()
  assert.equal(await window.locator('.customizer-render-garment').count(), 5, 'Other categories can be equipped independently')
  await window.getByLabel('Pose do personagem').selectOption('3')
  await window.locator('.customizer-render-garment').first().waitFor()
  await window.screenshot({ path: join(output, 'customizer-rotated.png') })
  const active = window.locator('.customizer-render-garment').first()
  await active.click()
  await window.getByLabel('Ajustar Horizontal').focus()
  await window.getByLabel('Ajustar Horizontal').press('ArrowRight')
  await window.getByRole('button', { name: 'Adicionar personagem' }).click()
  assert.equal(await window.locator('.customizer-render-garment').count(), 0, 'An independent character must not inherit clothes')
  await window.locator('.character-card').first().click()
  assert.equal(await window.locator('.customizer-render-garment').count(), 5, 'Original character keeps choices')
  await window.getByText('Salvo', { exact: true }).first().waitFor({ timeout: 20000 })
  const characterLibrary = JSON.parse(readFileSync(join(xdgConfig, 'Electron', 'customizer', 'characters.json'), 'utf8'))
  assert.equal(characterLibrary.characters.length, 2)
  assert.equal(characterLibrary.characters[0].equipped.calca !== undefined, true)
  assert.equal(Object.keys(characterLibrary.characters[1].equipped).length, 0)
  assert.equal(hashTree(appData), migratedHash, 'Customizer must not edit Fabricador model, pose, or garment files')

  assert.ok(existsSync(join(output, 'pose-01.png')) && existsSync(join(output, 'pose-02.png')) && existsSync(join(output, 'pose-03.png')))
  console.log('Electron smoke passed: original sheet + saved poses + per-character customizer + original asset isolation')
} finally {
  if (electronApp) await electronApp.close()
}
