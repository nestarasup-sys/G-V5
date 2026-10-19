import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: { input: resolve(projectRoot, 'electron/main.ts') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          preload: resolve(projectRoot, 'electron/preload.ts'),
          'video-export-preload': resolve(projectRoot, 'electron/videoExportPreload.ts')
        },
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: resolve(projectRoot, 'src/renderer'),
    resolve: { alias: { '@': resolve(projectRoot, 'src/renderer/src') } },
    plugins: [react()],
    build: { outDir: 'out/renderer' }
  }
})
