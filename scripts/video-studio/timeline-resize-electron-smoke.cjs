const { app, BrowserWindow } = require('electron')
const { build } = require('esbuild')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '../..')
const output = path.join(root, 'app-data/temp/video-studio/timeline-resize-smoke')
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-background-timer-throttling')
const timeout = setTimeout(() => { console.error('Timeline smoke timed out'); app.exit(1) }, 120000)
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
app.whenReady().then(async () => {
  await fs.mkdir(output, { recursive: true })
  const bundled = await build({ entryPoints: [path.join(__dirname, 'timeline-resize-fixture.tsx')], bundle: true, write: false, jsx: 'automatic', platform: 'browser', define: { 'process.env.NODE_ENV': '"development"' } })
  const css = await fs.readFile(path.join(root, 'src/renderer/src/features/videoStudio/VideoStudioEditor.css'), 'utf8')
  await fs.writeFile(path.join(output, 'fixture.js'), bundled.outputFiles[0].contents)
  await fs.writeFile(path.join(output, 'index.html'), `<html><head><meta charset="utf-8"><style>${css}\n*{box-sizing:border-box}body{margin:0;padding:20px;background:#10131c;color:white;font-family:Arial}button{font-family:inherit}#root{display:flex;height:360px}.video-timeline{width:100%}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>`)
  const win = new BrowserWindow({ show: false, width: 1440, height: 600, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true } })
  win.webContents.setFrameRate(60)
  const errors = []
  win.webContents.on('console-message', (event) => { if (event.level === 'error' || event.level === 3) { errors.push(event.message); console.error(event.message) } })
  console.log('Loading fixture')
  await win.loadFile(path.join(output, 'index.html'))
  console.log('Fixture loaded')
  const js = async (code) => { try { return await win.webContents.executeJavaScript(code) } catch(error) { console.error('Failed expression:', code); throw error } }
  for (let i = 0; i < 50 && !await js('Boolean(window.fixture)'); i++) await pause(50)
  assert.ok(await js('Boolean(window.fixture)'), 'fixture mounted')
  console.log('Fixture mounted')
  win.webContents.debugger.attach('1.3')
  const mouse = (type, x, y, pressed) => win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: pressed ? 1 : 0, clickCount: 1 })
  const evidence = []
  async function drag(selector, dx) {
    const box = await js(`(() => {const el=document.querySelector(${JSON.stringify(selector)}); if(!el) throw new Error('Missing handle'); const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:el.parentElement.getBoundingClientRect().width}})()`)
    await mouse('mouseMoved', box.x, box.y, false)
    await mouse('mousePressed', box.x, box.y, true)
    for (let step = 1; step <= 12; step++) { await mouse('mouseMoved', box.x + dx * step / 12, box.y, true); await pause(20) }
    const preview = await js(`(() => {const el=document.querySelector(${JSON.stringify(selector)});return el?.parentElement.getBoundingClientRect().width})()`)
    assert.ok(preview && Math.abs(preview - box.width) > 10, 'block width follows edge before mouse release')
    await mouse('mouseReleased', box.x + dx, box.y, false)
    await pause(70)
    return js('window.fixture.timeline')
  }
  async function reset() { await js('window.fixture.reset()'); await pause(70) }
  const lanes = [
    { kind: 'character', selector: '.character-lane .video-character-span', end: '.video-character-resize-edge.end', start: '.video-character-resize-edge.start' },
    { kind: 'speech', selector: '.speech-lane .video-text-clip', end: '[data-clip-edge="end"]', start: '[data-clip-edge="start"]' },
    { kind: 'thought', selector: '.thought-lane .video-text-clip', end: '[data-clip-edge="end"]', start: '[data-clip-edge="start"]' },
    { kind: 'video', selector: '.video-master-lane .video-master-span', end: '[data-clip-edge="end"]', start: '[data-clip-edge="start"]' }
  ]
  for (const lane of lanes) {
    console.log('Checking', lane.kind)
    await reset()
    let result = await drag(`${lane.selector}:first-of-type ${lane.end}`, 111)
    if (lane.kind === 'character') {
      assert.deepEqual(result.characterKeys.filter((key) => key.elementId === 'actor').map((key) => [key.id, key.frame]), [['key0', 0], ['key2', 300], ['key3', 360]])
    } else {
      const clips = lane.kind === 'video' ? result.videoClips : result.textClips.filter((clip) => clip.kind === lane.kind)
      assert.deepEqual(clips.map((clip) => [clip.startFrame, clip.endFrame]), [[0, 300], [300, 360], [360, 600]])
    }
    evidence.push(`${lane.kind}: right edge consumed neighbours; live width followed pointer`)
    await reset()
    result = await drag(`${lane.selector}:nth-of-type(3) ${lane.start}`, -111)
    if (lane.kind === 'character') assert.equal(result.characterKeys.find((key) => key.id === 'key2').frame, 60)
    else {
      const clips = lane.kind === 'video' ? result.videoClips : result.textClips.filter((clip) => clip.kind === lane.kind)
      assert.deepEqual(clips.map((clip) => [clip.startFrame, clip.endFrame]), [[0, 60], [60, 360], [360, 600]])
    }
    evidence.push(`${lane.kind}: left edge consumed neighbours`)
    await reset()
    result = await drag(`${lane.selector}:nth-of-type(4) ${lane.end}`, 111)
    assert.equal(result.durationFrames, 780)
    evidence.push(`${lane.kind}: final edge grew project from 600 to 780 frames`)
  }
  await fs.writeFile(path.join(output, 'timeline-resize.png'), (await win.webContents.capturePage()).toPNG())
  assert.deepEqual(errors, [], 'no renderer errors')
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ evidence, errors }, null, 2))
  console.log(JSON.stringify({ passed: evidence.length, output, evidence }))
  clearTimeout(timeout)
  win.destroy()
  app.exit(0)
}).catch((error) => { console.error(error.stack || error); app.exit(1) })
