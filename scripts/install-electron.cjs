const { spawnSync } = require('node:child_process')
const { createRequire } = require('node:module')
const { dirname, join } = require('node:path')

const localRequire = createRequire(__filename)
const electronDirectory = dirname(localRequire.resolve('electron'))
const installScript = join(electronDirectory, 'install.js')
const installResult = spawnSync(process.execPath, [installScript], { stdio: 'inherit' })

if (installResult.error) {
  console.error(`Falha ao preparar o Electron: ${installResult.error.message}`)
  process.exit(1)
}

if (installResult.status !== 0) {
  process.exit(installResult.status ?? 1)
}
