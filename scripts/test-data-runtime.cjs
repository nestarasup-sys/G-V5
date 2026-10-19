const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')

const projectRoot = path.resolve(__dirname, '..')
const outputRoot = path.join(projectRoot, 'out', 'data-runtime-smoke')
const runRoot = path.join(outputRoot, `run-${randomUUID()}`)
const electronEntry = require('electron')
const platformEntry = path.join(projectRoot, 'electron', 'dataPlatform.cjs')

async function main() {
  await fs.mkdir(runRoot, { recursive: true })
  await fs.mkdir(path.join(runRoot, 'user-data'), { recursive: true })
  await fs.writeFile(path.join(runRoot, 'package.json'), JSON.stringify({ name: 'gacha-data-runtime-smoke', version: '1.0.0', main: 'main.cjs' }))
  const appSource = `
    const { app } = require('electron')
    const { DataPlatform, ContentAddressedStore, createDatabaseSnapshot, registerObjectMetadata } = require(${JSON.stringify(platformEntry)})
    const path = require('node:path')
    const fs = require('node:fs/promises')
    app.setPath('userData', path.join(__dirname, 'user-data'))
    app.setPath('sessionData', path.join(__dirname, 'session-data'))
    app.whenReady().then(async () => {
      const root = path.join(__dirname, 'app-data')
      const catalog = new DataPlatform(root).initialize()
      catalog.registerDomain({ id: 'extensions.runtime-smoke', schemaVersion: 1, manifest: { synthetic: true } })
      catalog.upsertAsset({ id: 'electron-runtime-asset', domainId: 'extensions.runtime-smoke', kind: 'fixture', displayName: 'Synthetic Electron asset' })
      const store = new ContentAddressedStore(root)
      const object = await store.putObject(Buffer.from('synthetic electron smoke'), { mimeType: 'text/plain', extension: '.txt' })
      await registerObjectMetadata(catalog, 'electron-runtime-asset', object)
      const thumbnail = await store.createPngThumbnail(await require('sharp')({ create: { width: 64, height: 64, channels: 4, background: { r: 40, g: 120, b: 200, alpha: 0.6 } } }).png().toBuffer(), { maxDimension: 32 })
      if (!thumbnail.sha256 || catalog.storageSummary().assets !== 1) throw new Error('Catalog/thumb check failed')
      const snapshot = await createDatabaseSnapshot(catalog, path.join(root, 'backups', 'runtime-smoke.sqlite'))
      if (!snapshot.sha256) throw new Error('SQLite snapshot check failed')
      catalog.close()
      console.log('DATA_RUNTIME_OK better-sqlite3 sharp FTS5 object-store thumbnail backup')
      app.quit()
    }).catch((error) => { console.error(error?.stack || error); process.exitCode = 1; app.quit() })
  `
  await fs.writeFile(path.join(runRoot, 'main.cjs'), appSource)

  let output = ''
  const child = spawn(electronEntry, ['--no-sandbox', '--disable-gpu', runRoot], { cwd: projectRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })
  const timeout = setTimeout(() => child.kill(), 30000)
  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal }))
  }).finally(() => clearTimeout(timeout))
  if (exit.code !== 0 || !output.includes('DATA_RUNTIME_OK')) {
    throw new Error(`Electron data runtime smoke failed (${JSON.stringify(exit)}):\n${output}`)
  }
  console.log(output.trim())
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
}).finally(async () => {
  const resolvedRoot = path.resolve(outputRoot)
  const resolvedRun = path.resolve(runRoot)
  const relative = path.relative(resolvedRoot, resolvedRun)
  if (relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    await fs.rm(resolvedRun, { recursive: true, force: true }).catch(() => undefined)
  }
})
