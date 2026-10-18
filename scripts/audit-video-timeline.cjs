// After build: electron scripts/audit-video-timeline.cjs <20-second MP4 fixture>
const { app, BrowserWindow, protocol } = require('electron')
const assert = require('node:assert/strict')
const { mkdirSync } = require('node:fs')
const { readFile, writeFile } = require('node:fs/promises')
const { join, resolve } = require('node:path')

protocol.registerSchemesAsPrivileged([{ scheme: 'gacha-video', privileges: { standard: true, secure: true, stream: true } }])
const output = resolve(__dirname, '../out/audit-video-timeline')
mkdirSync(join(output, 'user-data'), { recursive: true })
app.setPath('userData', join(output, 'user-data'))
app.setPath('sessionData', join(output, 'user-data'))
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(window, expression) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const value = await window.webContents.executeJavaScript(expression)
    if (value) return value
    await pause(50)
  }
  throw new Error(`Timed out: ${expression}`)
}

async function bounds(window, selector, fraction = 0.5) {
  return window.webContents.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width * ${fraction}), y: Math.round(r.top + r.height / 2) } })()`)
}

async function drag(window, selector, delta, fraction = 0.5) {
  const start = await bounds(window, selector, fraction)
  window.webContents.sendInputEvent({ type: 'mouseMove', ...start })
  window.webContents.sendInputEvent({ type: 'mouseDown', ...start, button: 'left', clickCount: 1 })
  for (let step = 1; step <= 4; step += 1) {
    window.webContents.sendInputEvent({ type: 'mouseMove', x: start.x + Math.round(delta * step / 4), y: start.y, modifiers: ['leftButtonDown'] })
    await pause(25)
  }
  window.webContents.sendInputEvent({ type: 'mouseUp', x: start.x + delta, y: start.y, button: 'left', clickCount: 1 })
  await pause(50)
}

async function auditAudio(window) {
  await drag(window, '.video-play-button', 0)
  await until(window, "(() => { const v = document.querySelector('video'); return v && !v.paused && !v.muted })()")
  let audible = false
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (window.webContents.isCurrentlyAudible()) { audible = true; break }
    await pause(50)
  }
  assert.equal(audible, true, 'The MP4 soundtrack must reach Chromium audio output')
  window.webContents.setAudioMuted(true) // Output detection succeeded; keep the remaining fixture checks quiet.
  await drag(window, '.video-play-button', 0)
  await until(window, "document.querySelector('video').paused && document.querySelector('video').muted")
  await drag(window, '.video-master-span', 0)
  await window.webContents.executeJavaScript("document.querySelector('button[aria-label=\"Áudio dos vídeos\"]').click()")
  const setRange = async (label, value) => window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('input[aria-label=' + ${JSON.stringify(JSON.stringify(label))} + ']')
    input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${value})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  })()`)
  await setRange('Volume Projeto', 50)
  await until(window, 'window.desktop.auditDocument().then(d => d.videoTimeline.videoAudio?.volume === 0.5)')
  await setRange('Volume Clipe selecionado', 40)
  await until(window, 'window.desktop.auditDocument().then(d => d.videoTimeline.videoClips[0].audio?.volume === 0.4)')
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await pause(150)
  await writeFile(join(output, 'audio-controls.png'), (await window.webContents.capturePage()).toPNG())
  await drag(window, '.video-play-button', 0)
  await until(window, "(() => { const v = document.querySelector('video'); return !v.paused && !v.muted && Math.abs(v.volume - 0.2) < 0.001 })()")
  await window.webContents.executeJavaScript("document.querySelector('button[aria-label=\"Áudio dos vídeos\"]').click()")
  await window.webContents.executeJavaScript("document.querySelector('[aria-label=\"Silenciar Clipe selecionado\"]').click()")
  await until(window, "!document.querySelector('video').paused && document.querySelector('video').muted")
  await window.webContents.executeJavaScript("document.querySelector('[aria-label=\"Ativar Clipe selecionado\"]').click()")
  await until(window, "!document.querySelector('video').paused && !document.querySelector('video').muted")
  await drag(window, '.video-play-button', 0)
  await until(window, "document.querySelector('video').paused && document.querySelector('video').muted")
  return { audible, masterVolume: 0.5, clipVolume: 0.4, effectiveVolume: 0.2, pauseSilent: true }
}

async function run() {
  if (!process.argv[2]) throw new Error('Pass a 20-second MP4 fixture path.')
  const bytes = await readFile(resolve(process.argv[2]))
  const preload = join(output, 'preload.cjs')
  await writeFile(preload, `
    const { contextBridge } = require('electron')
    const image = (color) => 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="' + color + '"/></svg>')
    let video = { schemaVersion: 1, id: '22222222-2222-4222-8222-222222222222', title: 'Vídeo de teste', color: '#b090c0', createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:00Z', backgroundColor: '#c090b0', backgroundAssetId: 'background', backgroundX: 0, backgroundY: 0, backgroundWidth: 100, backgroundHeight: 100, backgroundRotation: 0,
      assets: [{ id: 'background', category: 'background', name: 'Fundo', mimeType: 'image/png', dataUrl: image('#c090b0') }, { id: 'character', category: 'character', name: 'Personagem', mimeType: 'image/png', dataUrl: image('#ffdd00') }],
      elements: [{ id: 'actor', kind: 'character', characterId: 'fixture', assetId: 'character', text: 'Personagem', x: 0, y: 0, width: 10, height: 40, rotation: 0, zIndex: 0 }],
      videoTimeline: { schemaVersion: 1, frameRate: 60, durationFrames: 36000, playheadFrame: 0, playing: false, characterKeys: [], textClips: [], saveMarkers: [], videoAssets: [{ id: 'media', name: 'Clipe de teste', mimeType: 'video/mp4', extension: 'mp4', size: ${bytes.length}, durationFrames: 1200 }], videoClips: [{ id: 'clip', assetId: 'media', startFrame: 0, endFrame: 1200, sourceStartFrame: 0, sourceEndFrame: 1200 }] }
    }
    contextBridge.exposeInMainWorld('desktop', {
      listVideoStudios: async () => [video], saveVideoStudio: async (value) => { video = value }, getVideoStudioFolder: async () => 'fixture',
      auditDocument: async () => video,
      listCustomizerCharacters: async () => [], listFaceCatalog: async () => [], listFaceExpressionCollections: async () => [], listFaceExpressionPresets: async () => [], listFabricatorPoseSlots: async () => [],
      importVideoStudioImage: async () => null, importVideoStudioVideo: async () => null
    })
  `)
  await app.whenReady()
  protocol.handle('gacha-video', () => new Response(bytes, { headers: { 'content-type': 'video/mp4', 'content-length': String(bytes.length) } }))
  const window = new BrowserWindow({ show: false, width: 1440, height: 900, useContentSize: true, webPreferences: { preload, sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  await window.loadFile(resolve(__dirname, '../out/renderer/index.html'), { hash: '/video-studio' })
  await until(window, "Boolean(document.querySelector('.video-studio-card-open'))")
  await window.webContents.executeJavaScript("document.querySelector('.video-studio-card-open').click()")
  await until(window, "document.querySelector('.video-studio-video-clip-preview')?.readyState > 1")
  const layers = await window.webContents.executeJavaScript(`(() => {
    const canvas = document.querySelector('.video-studio-scene-canvas'), video = document.querySelector('video'), actor = document.querySelector('.video-studio-element-character'), background = document.querySelector('.video-studio-canvas-background')
    const c = canvas.getBoundingClientRect(), v = video.getBoundingClientRect()
    return { widthRatio: v.width / c.width, heightRatio: v.height / c.height, centerX: (v.left + v.width / 2 - c.left) / c.width, centerY: (v.top + v.height / 2 - c.top) / c.height, objectFit: getComputedStyle(video).objectFit, videoZ: Number(getComputedStyle(video).zIndex), actorZ: Number(getComputedStyle(actor).zIndex), backgroundZ: Number(getComputedStyle(background).zIndex), decodedWidth: video.videoWidth }
  })()`)
  assert.ok(Math.abs(layers.widthRatio - 0.5) < 0.01 && Math.abs(layers.heightRatio - 0.5) < 0.01)
  assert.ok(Math.abs(layers.centerX - 0.5) < 0.01 && Math.abs(layers.centerY - 0.5) < 0.01)
  assert.ok(layers.backgroundZ < layers.videoZ && layers.videoZ < layers.actorZ)
  assert.equal(layers.objectFit, 'contain')
  assert.ok(layers.decodedWidth > 0)
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await pause(200)
  await writeFile(join(output, 'layers.png'), (await window.webContents.capturePage()).toPNG())

  const audio = process.argv.includes('--audio') ? await auditAudio(window) : undefined

  await drag(window, '.video-master-span', 74)
  await until(window, 'window.desktop.auditDocument().then(d => d.videoTimeline.videoClips[0].startFrame === 120)')
  await drag(window, '.video-master-span .video-clip-edge-start', 37)
  await until(window, 'window.desktop.auditDocument().then(d => d.videoTimeline.videoClips[0].sourceStartFrame === 60)')
  await drag(window, '.video-master-span .video-clip-edge-end', -37)
  const trimmed = await until(window, 'window.desktop.auditDocument().then(d => d.videoTimeline.videoClips[0].sourceEndFrame === 1140 && d.videoTimeline.videoClips[0])')
  assert.equal(trimmed.startFrame, 180)
  assert.equal(trimmed.endFrame, 1260)
  await drag(window, '.video-master-span', 0)
  await window.webContents.executeJavaScript("document.querySelector('.video-split-button').click()")
  const parts = await until(window, 'window.desktop.auditDocument().then(d => d.videoTimeline.videoClips.length === 2 && d.videoTimeline.videoClips)')
  assert.equal(parts[0].sourceEndFrame, parts[1].sourceStartFrame)
  if (audio) assert.deepEqual(parts.map((clip) => clip.audio), [{ volume: 0.4, muted: false }, { volume: 0.4, muted: false }], 'Split clips inherit their audio settings')
  await window.webContents.executeJavaScript("document.querySelector('[title=\"Duplicar vídeo selecionado\"]').click()")
  await until(window, 'window.desktop.auditDocument().then(d => d.videoTimeline.videoClips.length === 3)')
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' })
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' })
  await until(window, 'window.desktop.auditDocument().then(d => d.videoTimeline.videoClips.length === 2)')
  await window.webContents.executeJavaScript("document.querySelector('.video-studio-history-actions button').click()")
  await until(window, 'window.desktop.auditDocument().then(d => d.videoTimeline.videoClips.length === 3)')
  await window.webContents.executeJavaScript("Array.from(document.querySelectorAll('.video-timeline-actions button')).find(b => b.textContent === 'Faixas').click()")
  await window.webContents.executeJavaScript("document.querySelector('[aria-label=\"Bloquear faixa Vídeo\"]').click()")
  await until(window, 'window.desktop.auditDocument().then(d => d.videoTimeline.trackSettings?.video?.locked)')
  const beforeLock = await window.webContents.executeJavaScript('window.desktop.auditDocument().then(d => JSON.stringify(d.videoTimeline.videoClips))')
  await drag(window, '.video-master-span', 74)
  await pause(750)
  assert.equal(await window.webContents.executeJavaScript('window.desktop.auditDocument().then(d => JSON.stringify(d.videoTimeline.videoClips))'), beforeLock)
  if (audio) {
    await window.webContents.executeJavaScript("window.auditMedia = document.querySelector('video'); document.querySelector('.video-studio-exit-action').click()")
    await until(window, "!document.querySelector('video') && window.auditMedia.paused && window.auditMedia.muted")
    await until(window, "Boolean(document.querySelector('.video-studio-card-open'))")
    await window.webContents.executeJavaScript("document.querySelector('.video-studio-card-open').click()")
    await until(window, "Boolean(document.querySelector('.video-timeline'))")
    await until(window, 'window.desktop.auditDocument().then(d => d.videoTimeline.videoAudio?.volume === 0.5 && d.videoTimeline.videoClips.every(c => c.audio?.volume === 0.4))')
  }
  await writeFile(join(output, 'result.json'), JSON.stringify({ layers, audio, trimmed, parts, gestures: ['move', 'trim-start', 'trim-end', 'split', 'duplicate', 'Backspace', 'undo', 'lock'] }, null, 2))
  if (audio) console.log('Video audio renderer audit passed: audible soundtrack, pause/mute, per-project and per-clip gain, split inheritance, exit cleanup, and reopening.')
  console.log('Video timeline audit passed: actual video decoding, size/layers, native pointer gestures, split, duplication, selected deletion, undo, and locking.')
  window.destroy()
  app.exit(0)
}
run().catch((error) => { console.error(error); app.exit(1) })
