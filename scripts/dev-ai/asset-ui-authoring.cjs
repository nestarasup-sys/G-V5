'use strict'

// Drives the REAL Fabricador/Customizer React interfaces in Electron with
// production preload + IPC. Only the OS file chooser is supplied with a
// deterministic PNG in the runner sandbox. Never reads local/private media.
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { writeFile, mkdir } = require('node:fs/promises')
const { join } = require('node:path')
const { dialog, nativeImage } = require('electron')
const fixture = require('./asset-flow-raster-fixture.cjs')

const MODEL_NAME = 'dev-ai-ui-model.png'
const CLOTH_NAME = 'dev-ai-ui-clothes.png'
const CHARACTER_NAME = 'DEV AI UI Authored Character'
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const query = (win, js) => win.webContents.executeJavaScript(js)

function wardrobeSheet() {
  const w = fixture.WIDTH, h = fixture.HEIGHT
  const bitmap = fixture.pixelBuffer(w, h, [0, 0, 0, 0])
  const draw = (x, y, width, height, rgba) => {
    for (let row = y; row < y + height; row++)
      for (let col = x; col < x + width; col++) {
        const at = (row * w + col) * 4
        for (let c = 0; c < 4; c++) bitmap[at + c] = rgba[c]
      }
  }
  // The torso and shoe lie in their corresponding source-sheet positions.
  draw(506, 401, 126, 187, [20, 140, 240, 255])
  draw(374, 1294, 65, 45, [35, 235, 240, 255])
  return nativeImage.createFromBitmap(bitmap, { width: w, height: h }).toPNG()
}

function prepare(sandbox) {
  // Do not render/generate PNG before Electron main installs its isolated
  // userData root. Native image generation can yield until app.whenReady().
  const filename = join(sandbox, MODEL_NAME)
  // Intercept exactly the authorized import dialog; production IPC then reads
  // the actual sandbox PNG from disk and the UI launches its real image worker.
  const original = dialog.showOpenDialog.bind(dialog)
  dialog.showOpenDialog = async (...args) => {
    const options = args.find(item => item && typeof item === 'object' && 'title' in item)
    if (options?.title === 'Importar folha de modelo')
      return { canceled: false, filePaths: [filename], bookmarks: [] }
    throw new Error('DEV AI refuses unplanned native file dialog: ' + String(options?.title ?? 'unknown'))
  }
  return { filename, restore: () => { dialog.showOpenDialog = original } }
}

async function wait(win, condition, label, timeout = 25000) {
  const start = Date.now()
  let lastError = ''
  while (Date.now() - start < timeout) {
    try {
      const value = await query(win, condition)
      if (value) return value
    } catch (error) { lastError = String(error?.message ?? error) }
    await pause(140)
  }
  const state = await query(win, '({ route: location.hash, screen: document.body.innerText.slice(0,900), alert: document.querySelector("[role=alert]")?.innerText ?? "" })')
  throw new Error(label + ' timed out: ' + JSON.stringify({ state, lastError }))
}

async function click(win, selector, label) {
  const ok = await query(win, '(() => { const button = document.querySelector(' + JSON.stringify(selector) + '); if (!button || button.disabled) return false; button.click(); return true })()')
  assert.equal(ok, true, label + ' unavailable: ' + selector)
}
async function clickText(win, selector, text, label) {
  const ok = await query(win, '(() => { const button = [...document.querySelectorAll(' + JSON.stringify(selector) + ')].find(item => item.textContent.includes(' + JSON.stringify(text) + ') && !item.disabled); if (!button) return false; button.click(); return true })()')
  assert.equal(ok, true, label + ': ' + text)
}
async function setValue(win, selector, value) {
  const ok = await query(win, '(() => { const el = document.querySelector(' + JSON.stringify(selector) + '); if (!el) return false; const setter = Object.getOwnPropertyDescriptor(el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value").set; setter.call(el, ' + JSON.stringify(value) + '); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); return true })()')
  assert.equal(ok, true, 'Input missing: ' + selector)
}
async function route(win, hash, ready) {
  await query(win, 'location.hash=' + JSON.stringify(hash))
  await wait(win, 'Boolean(document.querySelector(' + JSON.stringify(ready) + '))', 'Route ' + hash)
}
async function shot(win, folder, title) {
  await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  await pause(250)
  const png = (await win.webContents.capturePage()).toPNG()
  assert.ok(png.length > 1000, 'Screenshot empty: ' + title)
  await writeFile(join(folder, title + '.png'), png)
  return hash(png)
}

async function run(win, sandbox, output, prepared, treeHash) {
  const source = fixture.manifest(nativeImage).sourceBytes
  await writeFile(prepared.filename, source, { flag: 'wx' })
  prepared.sourceHash = hash(source)
  prepared.clothingPng = wardrobeSheet()
  const folder = join(output, 'asset-ui-authoring')
  await mkdir(folder, { recursive: true })
  const api = (code) => query(win, code)
  const proof = { schemaVersion: 1, adapter: 'production-electron-react-ui-real-ipc',
    scope: 'synthetic model/pose/wardrobe UI authoring + Customizer equipment',
    fixture: { kind: 'generated-png-only', width: fixture.WIDTH, height: fixture.HEIGHT,
      modelSha256: prepared.sourceHash }, phases: [], screenshots: {}, limitations: [] }
  const phase = (id, evidence) => proof.phases.push({ id, status: 'passed', ...evidence })
  await route(win, '/fabricador-dev', '.fabricator-model-editor')
  await wait(win, 'Boolean(document.querySelector(".model-primary-button"))', 'empty model slot 1')
  await click(win, '.model-primary-button', 'Import model through UI')
  await wait(win, 'document.querySelectorAll(".model-canvas-part").length >= 10', 'Model worker processed 10 source parts', 60000)
  await wait(win, 'window.desktop.listFabricatorSlots().then(slots=>slots[0]?.partCount>=10)', 'Model persisted by UI', 60000)
  await wait(win, 'Boolean(document.querySelector(".model-slot.filled.active")) && !document.querySelector(".model-processing") && !document.querySelector(".model-processing-overlay") && document.querySelector(".model-editor-content")?.getAttribute("aria-busy")==="false"', 'Model UI settled after processing', 45000)
  const model = await api('window.desktop.loadFabricatorSlot(1)')
  assert.equal(model.parts.length, 10, 'Model importer should split 10 real parts')
  assert.equal(model.sourceName, MODEL_NAME)
  assert.equal(model.parts.every(p => p.sourceTransform?.width > 0 && p.sourceTransform?.height > 0), true)
  phase('model-ui-worker-save', { slot: 1, partCount: model.parts.length,
    parts: model.parts.map(p => ({ id: p.id, name: p.name, sourceFrame: p.sourceTransform })) })
  proof.screenshots.model = await shot(win, folder, '01-model-ui')

  await clickText(win, '.fabricator-section-button', 'Poses Dev', 'Open Poses')
  await wait(win, 'Boolean(document.querySelector(".pose-workspace .pose-toolbar"))', 'Pose workspace mount')
  await wait(win, '[...document.querySelectorAll(".pose-toolbar button")].some(b=>b.textContent.includes("Nova pose")&&!b.disabled)', 'New pose action ready')
  await clickText(win, '.pose-toolbar button', 'Nova pose', 'Author pose 1')
  await wait(win, 'Boolean(document.querySelector(".pose-save-state.pending")) && document.querySelector(".pose-category-trigger")?.textContent.includes("Parado")', 'New pose 1 draft hydrated')
  await wait(win, 'document.querySelectorAll(".pose-artboard img").length >= 10', 'Pose authoring preview')
  await wait(win, '[...document.querySelectorAll(".pose-toolbar button")].some(b=>b.textContent.includes("Salvar pose")&&!b.disabled)', 'Pose 1 save enabled')
  await clickText(win, '.pose-toolbar button', 'Salvar pose', 'Persist pose 1')
  await wait(win, 'window.desktop.listFabricatorPoseSlots(1).then(slots=>slots.some(s=>s?.slot===1))', 'Pose 1 real IPC save', 60000)
  const pose1 = await api('window.desktop.loadFabricatorPose(1,1)')
  assert.equal(pose1.parts.length, 10)
  proof.screenshots.pose1 = await shot(win, folder, '02-pose1-ui')
  await wait(win, 'Boolean(document.querySelector(".pose-save-state:not(.pending)"))', 'Pose 1 saved state reflected in React')
  await clickText(win, '.pose-toolbar button', 'Nova pose', 'Author pose 2')
  // The previous pose remains on screen during asynchronous loadFabricatorSlot.
  // Do not rotate the old pose and re-save slot 1 by racing the new draft.
  await wait(win, 'Boolean(document.querySelector(".pose-save-state.pending")) && document.querySelector(".pose-category-trigger")?.textContent.includes("Sentado")', 'New pose 2 draft hydrated', 30000)
  await wait(win, 'document.querySelectorAll(".pose-piece-row").length>=10', 'Pose 2 editor')
  await click(win, '.pose-piece-row', 'Select part to rotate')
  await clickText(win, '.pose-rotation-actions button', '−15°', 'Rotate in UI')
  await wait(win, '[...document.querySelectorAll(".pose-toolbar button")].some(b=>b.textContent.includes("Salvar pose")&&!b.disabled)', 'Pose 2 save enabled')
  await clickText(win, '.pose-toolbar button', 'Salvar pose', 'Persist pose 2')
  await wait(win, 'window.desktop.listFabricatorPoseSlots(1).then(slots=>slots.some(s=>s?.slot===2))', 'Pose 2 real IPC save', 60000)
  const pose2 = await api('window.desktop.loadFabricatorPose(1,2)')
  assert.ok(pose2.parts.some(p => Math.abs(p.rotation) > .01), 'UI pose 2 must differ from source')
  assert.equal(pose2.parts.length, pose1.parts.length)
  phase('poses-ui-two-saves', { slots: [1,2], editedPoseRotations: pose2.parts.filter(p=>p.rotation!==0).length })
  proof.screenshots.pose2 = await shot(win, folder, '03-pose2-ui')

  await clickText(win, '.fabricator-section-button', 'Roupas Dev', 'Open unified wardrobe')
  await wait(win, 'Boolean(document.querySelector(".wardrobe-workspace .wardrobe-toolbar"))', 'Wardrobe mounts')
  await wait(win, 'Boolean(document.querySelector(".wardrobe-toolbar-actions input[type=file]")) && !document.querySelector(".wardrobe-toolbar-actions button").disabled', 'Wardrobe reference loaded', 35000)
  const clothesB64 = prepared.clothingPng.toString('base64')
  const fileInjected = await api('(() => { const input=document.querySelector(".wardrobe-toolbar-actions input[type=file]"); if(!input)return false; const raw=atob(' + JSON.stringify(clothesB64) + '); const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)); const file=new File([bytes],' + JSON.stringify(CLOTH_NAME) + ',{type:"image/png"}); const transfer=new DataTransfer(); transfer.items.add(file); input.files=transfer.files; input.dispatchEvent(new Event("change",{bubbles:true})); return true })()')
  assert.equal(fileInjected, true, 'Must import garment via real File input/change event')
  await wait(win, 'document.querySelectorAll(".wardrobe-component-row").length===2', 'Wardrobe worker processed two garment pieces', 45000)
  // Shirt is the upper part. Both pieces must have an explicit, valid bone ID;
  // the boot category is selected by the author rather than inferred by magic.
  const modelLeg = model.parts.filter(p => p.x < fixture.WIDTH/2 && p.y > 900).sort((a,b)=>b.y-a.y)[0]
  assert.ok(modelLeg, 'Missing left lower-leg in source rig')
  await click(win, '.wardrobe-component-row:nth-child(2)', 'Select shoe')
  await setValue(win, '.wardrobe-fields label:nth-child(3) select', 'sapato')
  await setValue(win, '.wardrobe-fields label:nth-child(4) select', modelLeg.id)
  await click(win, '.wardrobe-bind-button', 'Fix shoe to correct lower leg')
  await click(win, '.wardrobe-component-row:first-child', 'Select shirt')
  await wait(win, 'Boolean(document.querySelector(".wardrobe-bind-button:not(:disabled)"))', 'Shirt source binding exists')
  await click(win, '.wardrobe-bind-button', 'Fix shirt on torso')
  await clickText(win, '.wardrobe-toolbar-actions button', 'Salvar conjunto', 'Save wardrobe source')
  await wait(win, 'window.desktop.listWardrobeSets(1).then(sets=>sets.some(s=>s.name===' + JSON.stringify(CLOTH_NAME.replace('.png','')) + '))', 'Wardrobe real IPC save', 60000)
  const summaries = await api('window.desktop.listWardrobeSets(1)')
  const selected = summaries.find(x=>x.name===CLOTH_NAME.replace('.png',''))
  assert.ok(selected)
  const set = await api('window.desktop.loadWardrobeSet(1,' + JSON.stringify(selected.id) + ')')
  assert.equal(set.components.length, 2)
  assert.equal(set.components.every(c=>c.attachedPartId && c.binding?.boneId===c.attachedPartId), true)
  assert.ok(set.components.some(c=>c.category==='camisa'))
  assert.ok(set.components.some(c=>c.category==='sapato'&&c.attachedPartId===modelLeg.id))
  const sourceHash = treeHash(join(sandbox,'electron-user-data','fabricator'))
  phase('wardrobe-ui-file-worker-save', { modelSlot: 1, setId: selected.id,
    components: set.components.map(c=>({ category:c.category, boneId:c.binding.boneId,
      x:c.x, y:c.y, width:c.width, height:c.height })) })
  proof.screenshots.wardrobe = await shot(win, folder, '04-wardrobe-ui')

  await route(win, '/customizar', '.home-layout')
  await wait(win, 'Boolean(document.querySelector("[aria-label=\\"Adicionar personagem\\"]"))', 'Customizer character create action')
  await click(win, '[aria-label="Adicionar personagem"]', 'Create character UI')
  await wait(win, 'Boolean(document.querySelector("#character-name"))', 'Character form')
  await setValue(win, '#character-name', CHARACTER_NAME)
  await click(win, '.character-dialog button[type=submit]', 'Save character UI')
  await wait(win, '(document.querySelector(".customizer-preview-character-name")?.textContent||"").trim()===' + JSON.stringify(CHARACTER_NAME), 'New character selected')
  await clickText(win, '.home-customizer-top-tabs button', 'Modelos', 'Open model tab')
  await wait(win, 'Boolean(document.querySelector(".customizer-models-view"))', 'Customizer model layout')
  // The creation flow initializes modelSlot=1. Do not bypass the UI to set it.
  await wait(win, 'window.desktop.listCustomizerCharacters().then(items=>items.find(c=>c.name===' + JSON.stringify(CHARACTER_NAME) + ')?.customization.modelSlot===1)', 'Character inherited model 1', 30000)
  await wait(win, 'Boolean(document.querySelector(".customizer-selected-artwork")?.complete)', 'Character model preview', 35000)
  await clickText(win, '.customizer-top-tabs button', 'Roupas', 'Open clothes tab')
  await wait(win, 'Boolean(document.querySelector(".customizer-upper-wardrobe-piece"))', 'Clothes panel visible', 25000)
  await clickText(win, '.customizer-upper-wardrobe-piece button[aria-label^="Abrir biblioteca de"]', 'Camisa', 'Open shirt library')
  await wait(win, 'Boolean(document.querySelector(".customizer-hair-library-grid [title]"))', 'Shirt library loaded', 25000)
  await clickText(win, '.customizer-hair-library-grid button[title]', 'Camisa', 'Equip UI-authored shirt')
  await wait(win, 'window.desktop.listCustomizerCharacters().then(items=>items.find(c=>c.name===' + JSON.stringify(CHARACTER_NAME) + ')?.customization.wardrobeGroups?.some(g=>g.setId===' + JSON.stringify(set.id) + '))', 'Character equipment persisted', 45000)
  await wait(win, 'Boolean(document.querySelector(".customizer-wardrobe-overlay")?.complete)', 'Rendered clothing appears on character', 35000)
  const characters = await api('window.desktop.listCustomizerCharacters()')
  const actor = characters.find(c=>c.name===CHARACTER_NAME)
  assert.ok(actor?.customization.wardrobeGroups.some(g=>g.setId===set.id))
  assert.equal(treeHash(join(sandbox,'electron-user-data','fabricator')),sourceHash,
    'Character UI equipment unexpectedly changed Fabricador source')
  proof.screenshots.customizer = await shot(win, folder, '05-customizer-equipped-ui')
  phase('character-ui-create-and-equip', { actorId:actor.id, modelSlot:actor.customization.modelSlot,
    poseSlot:actor.customization.poseSlot, garmentSetId:set.id,
    sourceLibraryHashUnchanged:true })

  // Re-open both authoring screens in the running app. The persistence phase
  // in a fresh Electron process is exercised by the follow-up mode.
  await route(win, '/fabricador-dev', '.fabricator-model-editor')
  await wait(win, 'document.querySelectorAll(".model-canvas-part").length>=10', 'Model survives renderer remount')
  assert.equal(treeHash(join(sandbox,'electron-user-data','fabricator')),sourceHash)
  await writeFile(join(folder,'report.json'), JSON.stringify({ ...proof, status:'passed',
    caveats:'No cross-Studio pixel golden here (Delivery C). File-picker mock is native-dialog-only; workers/IPC/UI are production.' },null,2))
  return proof
}

async function verifyAfterRestart(win, sandbox, output, treeHash) {
  const p = join(output,'asset-ui-authoring')
  const written = JSON.parse(require('node:fs').readFileSync(join(p,'report.json'),'utf8'))
  const list = await query(win,'window.desktop.listCustomizerCharacters()')
  const actor = list.find(c=>c.name===CHARACTER_NAME)
  assert.ok(actor,'UI-authored character missing after Electron restart')
  const setId = written.phases.find(x=>x.id==='wardrobe-ui-file-worker-save').setId
  assert.ok(actor.customization.wardrobeGroups.some(g=>g.setId===setId),'UI clothing not persisted through restart')
  const pose2 = await query(win,'window.desktop.loadFabricatorPose(1,2)')
  assert.ok(pose2?.parts.some(x=>x.rotation!==0),'UI-edited pose not persisted through restart')
  const wardrobe = await query(win,'window.desktop.loadWardrobeSet(1,'+JSON.stringify(setId)+')')
  assert.equal(wardrobe?.components.length,2)
  await query(win,'location.hash="/customizar"')
  await wait(win,'Boolean(document.querySelector(".home-layout"))','Restarted Customizer mounts')
  await writeFile(join(p,'restart.json'),JSON.stringify({schemaVersion:1,status:'passed',
    characterRetained:true,wardrobeRetained:true,editedPoseRetained:true,
    sourceFabricatorPresent:!!treeHash(join(sandbox,'electron-user-data','fabricator'))},null,2))
}

module.exports = { prepare, run, verifyAfterRestart }
