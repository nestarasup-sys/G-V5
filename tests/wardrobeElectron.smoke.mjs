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
const appData = join(xdgConfig, 'gacha-nymi-work-app', 'fabricator')
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

  for (const slot of [2, 1]) {
    await window.getByRole('button', { name: /Testar pose/i }).click()
    await window.locator('.pose-model-option').first().waitFor()
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
    assert.equal(state.bands, 4, 'Each fitted thigh/calf must extend at the knee')
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
    assert.equal(hashTree(appData), originalHash, 'Try-on must not change the userData files')
  }
  assert.ok(existsSync(join(output, 'pose-01.png')) && existsSync(join(output, 'pose-02.png')))
  console.log('Electron smoke passed: original sheet + neutral/rotated pose + 4 knee bands + read-only exit')
} finally {
  if (electronApp) await electronApp.close()
}
