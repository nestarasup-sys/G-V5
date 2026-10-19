'use strict'

// Drives the REAL Fabricador/Customizer React interfaces in Electron with
// production preload + IPC. Only the OS file chooser is supplied with a
// deterministic PNG in the runner sandbox. Never reads local/private media.
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { writeFile, mkdir, unlink, rename, readFile: readFileDisk } = require('node:fs/promises')
const { join } = require('node:path')
const { dialog, nativeImage } = require('electron')
const fixture = require('./asset-flow-raster-fixture.cjs')

const MODEL_NAME = 'dev-ai-ui-model.png'
const CLOTH_NAME = 'dev-ai-ui-clothes.png'
const INVALID_MODEL_NAME = 'dev-ai-ui-invalid.png'
const UNSUPPORTED_MODEL_NAME = 'dev-ai-ui-invalid.txt'
const CHARACTER_NAME = 'DEV AI UI Authored Character'
const CHARACTER_B_NAME = 'DEV AI UI Independent Character B'
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms))
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const query = (win, js) => win.webContents.executeJavaScript(js).catch((error) => {
  throw new Error(`Renderer JavaScript failed (${js.slice(0, 180)}): ${error?.message ?? error}`)
})

function wardrobeSheet() {
  const w = fixture.WIDTH, h = fixture.HEIGHT
  const bitmap = fixture.pixelBuffer(w, h, [0, 0, 0, 0])
  const pieces = [
    { key: 'shirt', category: 'camisa', bone: 'torso', frame: fixture.FRAMES.find(part => part.id === 'torso'), color: [20, 140, 240, 255] },
    { key: 'thigh-left', category: 'calca-coxa', bone: 'thigh-left', frame: fixture.FRAMES.find(part => part.id === 'thigh-left'), color: [230, 40, 40, 255] },
    { key: 'thigh-right', category: 'calca-coxa', bone: 'thigh-right', frame: fixture.FRAMES.find(part => part.id === 'thigh-right'), color: [240, 130, 30, 255] },
    { key: 'glove-left', category: 'luvas', bone: 'forearm-left', frame: { x: 154, y: 738, width: 96, height: 48 }, color: [180, 30, 220, 255] },
    { key: 'glove-right', category: 'luvas', bone: 'forearm-right', frame: { x: 868, y: 738, width: 96, height: 48 }, color: [45, 65, 220, 255] },
    { key: 'calf-left', category: 'calca-canela', bone: 'leg-left', frame: { ...fixture.FRAMES.find(part => part.id === 'leg-left'), height: 380 }, color: [45, 190, 70, 255] },
    { key: 'calf-right', category: 'calca-canela', bone: 'leg-right', frame: { ...fixture.FRAMES.find(part => part.id === 'leg-right'), height: 380 }, color: [210, 190, 25, 255] },
    { key: 'shoe-left', category: 'sapato', bone: 'leg-left', frame: { x: 376, y: 1344, width: 92, height: 44 }, color: [35, 235, 240, 255] },
    { key: 'shoe-right', category: 'sapato', bone: 'leg-right', frame: { x: 695, y: 1344, width: 132, height: 44 }, color: [235, 70, 160, 255] }
  ]
  const draw = (x, y, width, height, rgba) => {
    for (let row = y; row < y + height; row++)
      for (let col = x; col < x + width; col++) {
        const at = (row * w + col) * 4
        for (let c = 0; c < 4; c++) bitmap[at + c] = rgba[c]
      }
  }
  for (const piece of pieces) draw(piece.frame.x, piece.frame.y, piece.frame.width, piece.frame.height, piece.color)
  return { bytes: nativeImage.createFromBitmap(bitmap, { width: w, height: h }).toPNG(), pieces }
}

function prepare(sandbox) {
  // Do not render/generate PNG before Electron main installs its isolated
  // userData root. Native image generation can yield until app.whenReady().
  const filename = join(sandbox, MODEL_NAME)
  // Intercept exactly the authorized import dialog; production IPC then reads
  // the actual sandbox PNG from disk and the UI launches its real image worker.
  const original = dialog.showOpenDialog.bind(dialog)
  let nextModelFile = filename
  dialog.showOpenDialog = async (...args) => {
    const options = args.find(item => item && typeof item === 'object' && 'title' in item)
    if (options?.title === 'Importar folha de modelo')
      return { canceled: false, filePaths: [nextModelFile], bookmarks: [] }
    throw new Error('DEV AI refuses unplanned native file dialog: ' + String(options?.title ?? 'unknown'))
  }
  return { filename, setNextModelFile: (path) => { nextModelFile = path }, restore: () => { dialog.showOpenDialog = original } }
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
  let previous = ''
  let stableCount = 0
  let png
  const deadline = Date.now() + 12000
  while (Date.now() < deadline && stableCount < 3) {
    await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    png = (await win.webContents.capturePage()).toPNG()
    const current = hash(png)
    stableCount = current === previous ? stableCount + 1 : 0
    previous = current
    await pause(100)
  }
  assert.ok(stableCount >= 3, 'Screenshot never stabilized: ' + title)
  assert.ok(png.length > 1000, 'Screenshot empty: ' + title)
  await writeFile(join(folder, title + '.png'), png)
  return { sha256: hash(png), stableCaptures: stableCount + 1 }
}

function frameForPart(part) {
  return part?.sourceTransform ?? { x: part?.x, y: part?.y, width: part?.width, height: part?.height }
}

function findFramePart(parts, frame) {
  return parts.find(part => {
    const source = frameForPart(part)
    return source.x === frame.x - 4 && source.y === frame.y - 4
      && source.width === frame.width + 8 && source.height === frame.height + 8
  })
}

async function setWardrobeField(win, label, value) {
  const ok = await query(win, '(() => { const label=[...document.querySelectorAll(".wardrobe-fields label")].find(node=>node.textContent.trim().startsWith(' + JSON.stringify(label) + ')); const input=label?.querySelector("input"); if(!input)return false; const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set; setter.call(input,String(' + JSON.stringify(value) + ')); input.dispatchEvent(new Event("input",{bubbles:true})); input.dispatchEvent(new Event("change",{bubbles:true})); return true })()')
  assert.equal(ok, true, 'Wardrobe field missing: ' + label)
}

async function setWardrobeSelect(win, label, value) {
  const ok = await query(win, '(() => { const node=[...document.querySelectorAll(".wardrobe-fields label")].find(item=>item.textContent.trim().startsWith(' + JSON.stringify(label) + ')); const select=node?.querySelector("select"); if(!select)return false; const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set; setter.call(select,' + JSON.stringify(value) + '); select.dispatchEvent(new Event("change",{bubbles:true})); return true })()')
  assert.equal(ok, true, 'Wardrobe select missing: ' + label)
}

async function setWardrobeName(win, value) {
  const ok = await query(win, '(() => { const node=[...document.querySelectorAll(".wardrobe-fields label")].find(item=>item.textContent.trim().startsWith("Nome")); const input=node?.querySelector("input"); if(!input)return false; const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set; setter.call(input,' + JSON.stringify(value) + '); input.dispatchEvent(new Event("input",{bubbles:true})); return true })()')
  assert.equal(ok, true, 'Wardrobe name input missing')
}

async function equipCustomizerPanel(win, actorName, panelId, componentName, setId, componentIds) {
  await click(win, `.customizer-wardrobe-piece-${panelId} button[aria-label^="Abrir biblioteca de"]`,
    'Open Customizer library for ' + panelId)
  await wait(win, 'Boolean(document.querySelector(".customizer-hair-library-grid") && [...document.querySelectorAll(".customizer-hair-library-grid button")].some(button=>button.title===' + JSON.stringify(componentName) + '))',
    'UI-authored candidate available for ' + panelId, 35000)
  const selected = await query(win, '(() => { const button=[...document.querySelectorAll(".customizer-hair-library-grid button")].find(item=>item.title===' + JSON.stringify(componentName) + '); if(!button)return false; button.click(); return true })()')
  assert.equal(selected, true, 'Could not equip Customizer candidate ' + componentName)
  await wait(win, 'window.desktop.listCustomizerCharacters().then(items=>{const actor=items.find(c=>c.name===' + JSON.stringify(actorName) + '); return ' + JSON.stringify(componentIds) + '.every(id=>actor?.customization.wardrobeGroups?.some(group=>group.setId===' + JSON.stringify(setId) + ' && group.componentId===id))})',
    'Customizer saved all expected components for ' + panelId, 45000)
}

async function createCharacterInUi(win, name) {
  await click(win, '[aria-label="Adicionar personagem"]', 'Create character ' + name + ' through UI')
  await wait(win, 'Boolean(document.querySelector("#character-name"))', 'Character form ' + name)
  await setValue(win, '#character-name', name)
  await click(win, '.character-dialog button[type=submit]', 'Save character ' + name + ' through UI')
  await wait(win, '(document.querySelector(".customizer-preview-character-name")?.textContent||"").trim()===' + JSON.stringify(name), 'New character selected: ' + name)
  await wait(win, 'window.desktop.listCustomizerCharacters().then(items=>items.find(c=>c.name===' + JSON.stringify(name) + ')?.customization.modelSlot===1)', 'Character inherited model 1: ' + name, 30000)
}

async function equipFullWardrobe(win, actorName, set) {
  await clickText(win, '.customizer-top-tabs button', 'Roupas', 'Open clothes for ' + actorName)
  await wait(win, 'Boolean(document.querySelector(".customizer-upper-wardrobe-piece"))', 'Clothes panel for ' + actorName, 25000)
  await query(win,'(() => { const tab=[...document.querySelectorAll(".customizer-clothes-category-tabs button")].find(button=>button.textContent.includes("Superior")); if(tab?.textContent.includes("2/2"))tab.click(); return true })()')
  const shirt = set.components.find(component=>component.category==='camisa')
  await equipCustomizerPanel(win, actorName, 'shirt', shirt.name, set.id, [shirt.id])
  await clickText(win, '.customizer-clothes-category-tabs button', 'Inferior', 'Open lower clothing for ' + actorName)
  const pants = set.components.filter(component=>component.category==='calca-coxa'||component.category==='calca-canela')
  const shoesLeft = set.components.find(component=>component.category==='sapato'&&component.name.includes('esquerda'))
  const shoesRight = set.components.find(component=>component.category==='sapato'&&component.name.includes('direita'))
  assert.equal(pants.length, 4)
  await equipCustomizerPanel(win, actorName, 'pants-left', 'Calça coxa esquerda', set.id, pants.map(component=>component.id))
  await equipCustomizerPanel(win, actorName, 'shoe-left', shoesLeft.name, set.id, [shoesLeft.id])
  await equipCustomizerPanel(win, actorName, 'shoe-right', shoesRight.name, set.id, [shoesRight.id])
  await clickText(win, '.customizer-clothes-category-tabs button', 'Superior', 'Return to upper clothing for ' + actorName)
  await clickText(win, '.customizer-clothes-category-tabs button', 'Superior', 'Open second upper clothing page for ' + actorName)
  const gloveLeft = set.components.find(component=>component.category==='luvas'&&component.name.includes('esquerda'))
  const gloveRight = set.components.find(component=>component.category==='luvas'&&component.name.includes('direita'))
  await equipCustomizerPanel(win, actorName, 'gloves-left', gloveLeft.name, set.id, [gloveLeft.id])
  await equipCustomizerPanel(win, actorName, 'gloves-right', gloveRight.name, set.id, [gloveRight.id])
}

async function selectCharacterInUi(win, name) {
  await clickText(win, '.character-card', name, 'Select character ' + name)
  await wait(win, '(document.querySelector(".customizer-preview-character-name")?.textContent||"").trim()===' + JSON.stringify(name), 'Character selected: ' + name)
}

async function returnToCharacterRoster(win) {
  if (await query(win,'Boolean(document.querySelector(".customizer-preview-back"))')) {
    await click(win,'.customizer-preview-back','Return from focused Customizer area to character roster')
  }
  await wait(win,'Boolean(document.querySelector(".roster-panel .character-grid"))','Customizer character roster visible')
}

async function run(win, sandbox, output, prepared, treeHash) {
  const source = fixture.manifest(nativeImage).sourceBytes
  await writeFile(prepared.filename, source, { flag: 'wx' })
  prepared.sourceHash = hash(source)
  const clothing = wardrobeSheet()
  prepared.clothingPng = clothing.bytes
  const invalidModelPath = join(sandbox, INVALID_MODEL_NAME)
  const unsupportedModelPath = join(sandbox, UNSUPPORTED_MODEL_NAME)
  await writeFile(invalidModelPath, Buffer.from('not a PNG image'))
  await writeFile(unsupportedModelPath, Buffer.from('not an image format'))
  const folder = join(output, 'asset-ui-authoring')
  await mkdir(folder, { recursive: true })
  const api = (code) => query(win, code)
  const proof = { schemaVersion: 1, adapter: 'production-electron-react-ui-real-ipc',
    scope: 'synthetic model/pose/wardrobe UI authoring + Customizer equipment',
    fixture: { kind: 'generated-png-only', width: fixture.WIDTH, height: fixture.HEIGHT,
      modelSha256: prepared.sourceHash, wardrobeSha256: hash(prepared.clothingPng),
      wardrobePieces: clothing.pieces.map(piece => ({ id: piece.key, category: piece.category,
        targetPartId: piece.bone, sourceFrame: piece.frame })) }, phases: [], screenshots: {}, limitations: [] }
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
  assert.equal(new Set(model.parts.map(part => part.id)).size, 10, 'Model part IDs must be unique')
  assert.deepEqual(model.parts.map(part => part.sourceTransform && ({ x: part.sourceTransform.x,
    y: part.sourceTransform.y, width: part.sourceTransform.width, height: part.sourceTransform.height }))
    .sort((a,b) => a.y-b.y || a.x-b.x), fixture.FRAMES.map(frame => ({ x: frame.x-4, y: frame.y-4,
      width: frame.width+8, height: frame.height+8 })).sort((a,b) => a.y-b.y || a.x-b.x),
    'Worker crop geometry must preserve the original source-sheet rectangles and its 4px recovery fringe')
  assert.equal(model.parts.every(p => p.sourceTransform?.anchorVersion === 1
    && Number.isFinite(p.jointAnchor?.x) && Number.isFinite(p.jointAnchor?.y)
    && p.sourceTransform.width > 0 && p.sourceTransform.height > 0), true,
    'Every imported part must retain source geometry and a normalized bone pivot')
  assert.equal(model.layerOrder.length, model.parts.length)
  assert.equal(new Set(model.layerOrder).size, model.parts.length)
  assert.equal(model.joints.length >= 9, true, 'Imported body parts need identifiable joint references')
  assert.equal(model.joints.every(joint => model.parts.some(part => part.id === joint.parentPartId)
    && model.parts.some(part => part.id === joint.childPartId)), true, 'Every model joint must reference imported part IDs')
  assert.equal(hash(Buffer.from(model.sourceDataUrl.split(',')[1], 'base64')), prepared.sourceHash,
    'Persisted project sourceDataUrl must byte-match the imported original PNG')
  const modelFolder = join(sandbox, 'electron-user-data', 'fabricator', 'models', `slot-${model.slot}`)
  const sourcePath = join(modelFolder, model.sourceAssetName)
  assert.equal(hash(await readFileDisk(sourcePath)), prepared.sourceHash,
    'Fabricador source image file must remain byte-identical to the original')
  const modelPartMap = Object.fromEntries(fixture.FRAMES.map(frame => {
    const part = findFramePart(model.parts, frame)
    assert.ok(part, 'Imported model is missing source frame ' + frame.id)
    return [frame.id, part]
  }))
  assert.match(modelPartMap.head.name, /Cabeça/i)
  assert.match(modelPartMap.torso.name, /Tronco/i)
  assert.match(modelPartMap['arm-left'].name, /Braço esquerdo/i)
  assert.match(modelPartMap['arm-right'].name, /Braço direito/i)
  assert.match(modelPartMap['forearm-left'].name, /Antebraço esquerdo/i)
  assert.match(modelPartMap['forearm-right'].name, /Antebraço direito/i)
  assert.match(modelPartMap['thigh-left'].name, /Coxa esquerda/i)
  assert.match(modelPartMap['thigh-right'].name, /Coxa direita/i)
  assert.match(modelPartMap['leg-left'].name, /Canela esquerda/i)
  assert.match(modelPartMap['leg-right'].name, /Canela direita/i)
  phase('model-ui-worker-save', { slot: 1, partCount: model.parts.length,
    sourceAssetName: model.sourceAssetName, sourceSha256: prepared.sourceHash,
    layerOrder: model.layerOrder, joints: model.joints.map(joint => ({ parentPartId: joint.parentPartId,
      childPartId: joint.childPartId, parentAnchor: joint.parentAnchor, childAnchor: joint.childAnchor })),
    parts: model.parts.map(p => ({ id: p.id, name: p.name, sourceFrame: p.sourceTransform,
      jointAnchor: p.jointAnchor, imageSha256: hash(Buffer.from(p.dataUrl.split(',')[1], 'base64')) })) })
  proof.screenshots.model = await shot(win, folder, '01-model-ui')

  // Both invalid paths are selected through the production dialog IPC adapter.
  // Rejection must leave the saved model and its source files unchanged.
  await api('window.confirm=()=>true; true')
  const beforeRejectedImports = treeHash(join(sandbox, 'electron-user-data', 'fabricator'))
  prepared.setNextModelFile(unsupportedModelPath)
  await click(win, '.model-import-compact', 'Try unsupported model file through the Fabricador UI')
  await wait(win, 'document.querySelector(".model-toast[role=status]")?.textContent.includes("Formato incompatível")', 'Unsupported model extension rejected visibly')
  assert.equal(treeHash(join(sandbox, 'electron-user-data', 'fabricator')), beforeRejectedImports,
    'Unsupported model file must not modify Fabricador storage')
  prepared.setNextModelFile(invalidModelPath)
  await click(win, '.model-import-compact', 'Try malformed PNG model file through the Fabricador UI')
  await wait(win, 'document.querySelector(".model-toast[role=status]")?.textContent.includes("conteúdo do arquivo")', 'Malformed PNG rejected visibly before library write')
  assert.equal(treeHash(join(sandbox, 'electron-user-data', 'fabricator')), beforeRejectedImports,
    'Malformed model image must not leave an orphan file or alter the valid project')
  assert.equal((await api('window.desktop.loadFabricatorSlot(1)')).parts.map(part => part.id).join(','),
    model.parts.map(part => part.id).join(','), 'Rejected imports must preserve all previously saved part IDs')
  prepared.setNextModelFile(prepared.filename)
  phase('model-import-error-preservation', { unsupportedExtensionRejected: true,
    malformedImageRejected: true, oldProjectByteTreePreserved: true, diskTreeSha256: beforeRejectedImports })

  await clickText(win, '.fabricator-section-button', 'Poses Dev', 'Open Poses')
  await wait(win, 'Boolean(document.querySelector(".pose-workspace .pose-toolbar"))', 'Pose workspace mount')
  await wait(win, '[...document.querySelectorAll(".pose-toolbar button")].some(b=>b.textContent.includes("Nova pose")&&!b.disabled)', 'New pose action ready')
  await clickText(win, '.pose-toolbar button', 'Nova pose', 'Author pose 1')
  await wait(win, 'Boolean(document.querySelector(".pose-save-state.pending")) && document.querySelector(".pose-category-trigger")?.textContent.includes("Parado")', 'New pose 1 draft hydrated')
  await wait(win, 'document.querySelectorAll(".pose-artboard img").length >= 10', 'Pose authoring preview')
  await wait(win, '[...document.querySelectorAll(".pose-toolbar button")].some(b=>b.textContent.includes("Salvar pose")&&!b.disabled)', 'Pose 1 save enabled')
  const pose1Arm = modelPartMap['arm-right']
  await clickText(win, '.pose-piece-row', pose1Arm.name, 'Select articulated arm for pose 1')
  await clickText(win, '.pose-rotation-actions button', '+15°', 'Rotate articulated arm in pose 1')
  const pose1XBefore = await api('Number(document.querySelector(' + JSON.stringify('input[aria-label="Posição X"]') + ')?.value)')
  await setValue(win, 'input[aria-label="Posição X"]', pose1XBefore + 11)
  await clickText(win, '.pose-toolbar button', 'Salvar pose', 'Persist pose 1')
  await wait(win, 'window.desktop.listFabricatorPoseSlots(1).then(slots=>slots.some(s=>s?.slot===1))', 'Pose 1 real IPC save', 60000)
  const pose1 = await api('window.desktop.loadFabricatorPose(1,1)')
  assert.equal(pose1.parts.length, 10)
  const savedPose1Arm = pose1.parts.find(part => part.id === pose1Arm.id)
  assert.equal(savedPose1Arm.rotation, 15, 'Pose 1 must preserve exact articulated-part rotation')
  assert.equal(savedPose1Arm.x, pose1XBefore + 11, 'Pose 1 must preserve the authored limb position after articulated rotation')
  assert.deepEqual(pose1.layerOrder, model.layerOrder, 'Pose 1 layer order must match the model reference')
  assert.equal(pose1.joints.some(joint => joint.childPartId === pose1Arm.id), true,
    'Pose 1 articulated limb must retain its source-rig bone reference')
  proof.screenshots.pose1 = await shot(win, folder, '02-pose1-ui')
  await wait(win, 'Boolean(document.querySelector(".pose-save-state:not(.pending)"))', 'Pose 1 saved state reflected in React')
  await clickText(win, '.pose-toolbar button', 'Nova pose', 'Author pose 2')
  // The previous pose remains on screen during asynchronous loadFabricatorSlot.
  // Do not rotate the old pose and re-save slot 1 by racing the new draft.
  await wait(win, 'Boolean(document.querySelector(".pose-save-state.pending")) && document.querySelector(".pose-category-trigger")?.textContent.includes("Sentado")', 'New pose 2 draft hydrated', 30000)
  await wait(win, 'document.querySelectorAll(".pose-piece-row").length>=10', 'Pose 2 editor')
  const pose2Arm = modelPartMap['forearm-left']
  await clickText(win, '.pose-piece-row', pose2Arm.name, 'Select articulated forearm for pose 2')
  await clickText(win, '.pose-mode-selector button', 'Só esta peça', 'Select local bone rotation mode')
  await clickText(win, '.pose-rotation-actions button', '−15°', 'Rotate forearm in UI')
  const pose2XBefore = await api('Number(document.querySelector(' + JSON.stringify('input[aria-label="Posição X"]') + ')?.value)')
  await setValue(win, 'input[aria-label="Posição X"]', pose2XBefore - 17)
  await wait(win, '[...document.querySelectorAll(".pose-toolbar button")].some(b=>b.textContent.includes("Salvar pose")&&!b.disabled)', 'Pose 2 save enabled')
  await clickText(win, '.pose-toolbar button', 'Salvar pose', 'Persist pose 2')
  await wait(win, 'window.desktop.listFabricatorPoseSlots(1).then(slots=>slots.some(s=>s?.slot===2))', 'Pose 2 real IPC save', 60000)
  const pose2 = await api('window.desktop.loadFabricatorPose(1,2)')
  const savedPose2Arm = pose2.parts.find(part => part.id === pose2Arm.id)
  assert.equal(savedPose2Arm.rotation, -15, 'Pose 2 must preserve exact articulated-part rotation')
  assert.equal(savedPose2Arm.x, pose2XBefore - 17, 'Pose 2 must preserve the authored limb position after articulated rotation')
  assert.equal(pose2.parts.length, pose1.parts.length)
  assert.notDeepEqual(pose1.parts.map(part => [part.id,part.x,part.y,part.rotation]),
    pose2.parts.map(part => [part.id,part.x,part.y,part.rotation]), 'Saved UI poses must contain distinct transforms')
  assert.deepEqual(pose2.layerOrder, model.layerOrder, 'Pose 2 layer order must match the model reference')
  assert.equal(pose2.joints.some(joint => joint.parentPartId === pose2Arm.id
    || joint.childPartId === pose2Arm.id), true, 'Pose 2 must persist the selected bone reference')
  phase('poses-ui-two-saves', { slots: [1,2], distinctTransformSets:true,
    articulatedParts:[{id:pose1Arm.id,rotation:savedPose1Arm.rotation,x:savedPose1Arm.x},
      {id:pose2Arm.id,rotation:savedPose2Arm.rotation,x:savedPose2Arm.x}],
    layerOrder:pose2.layerOrder,jointReferences:pose2.joints.map(joint=>({parentPartId:joint.parentPartId,childPartId:joint.childPartId})) })
  proof.screenshots.pose2 = await shot(win, folder, '03-pose2-ui')

  await clickText(win, '.fabricator-section-button', 'Roupas Dev', 'Open unified wardrobe')
  await wait(win, 'Boolean(document.querySelector(".wardrobe-workspace .wardrobe-toolbar"))', 'Wardrobe mounts')
  await wait(win, 'Boolean(document.querySelector(".wardrobe-toolbar-actions input[type=file]")) && !document.querySelector(".wardrobe-toolbar-actions button").disabled', 'Wardrobe reference loaded', 35000)
  const clothesB64 = prepared.clothingPng.toString('base64')
  const fileInjected = await api('(() => { const input=document.querySelector(".wardrobe-toolbar-actions input[type=file]"); if(!input)return false; const raw=atob(' + JSON.stringify(clothesB64) + '); const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)); const file=new File([bytes],' + JSON.stringify(CLOTH_NAME) + ',{type:"image/png"}); const transfer=new DataTransfer(); transfer.items.add(file); input.files=transfer.files; input.dispatchEvent(new Event("change",{bubbles:true})); return true })()')
  assert.equal(fileInjected, true, 'Must import garment via real File input/change event')
  const orderedGarments = clothing.pieces.slice().sort((a,b) => a.frame.y-b.frame.y || a.frame.x-b.frame.x)
  await wait(win, 'document.querySelectorAll(".wardrobe-component-row").length===' + orderedGarments.length, 'Wardrobe worker processed all synthetic garment pieces', 45000)
  const modelTreeBeforeWardrobe = treeHash(modelFolder)
  const authoredGarments = {}
  for (let index=0; index<orderedGarments.length; index++) {
    const piece = orderedGarments[index]
    const part = modelPartMap[piece.bone]
    assert.ok(part, `Fixture references missing model part ${piece.bone}`)
    await click(win, `.wardrobe-component-row:nth-child(${index+1})`, 'Select wardrobe piece ' + piece.key)
    await setWardrobeSelect(win, 'Categoria', piece.category)
    const sideName = piece.key.includes('left') ? ' esquerda' : piece.key.includes('right') ? ' direita' : ''
    const categoryName = piece.category === 'camisa' ? 'Camisa'
      : piece.category === 'sapato' ? 'Sapato' : piece.category === 'luvas' ? 'Luvas'
        : piece.category === 'calca-coxa' ? 'Calça coxa' : 'Calça canela'
    await setWardrobeName(win, categoryName + sideName)
    await setWardrobeSelect(win, 'Parte correspondente', part.id)
    await click(win, '.wardrobe-bind-button', 'Explicitly bind ' + piece.key + ' to ' + piece.bone)
    const expected = { x:piece.frame.x-3, y:piece.frame.y-3,
      width:piece.frame.width+6, height:piece.frame.height+6, rotation:0 }
    if (piece.key === 'glove-left') {
      await setWardrobeField(win, 'Largura', expected.width * 1.05)
      await setWardrobeField(win, 'Altura', expected.height * 1.1)
      // Axis scaling is centered on the pivot; reapply the intended offset
      // after scaling so this fixture independently tests both controls.
      await setWardrobeField(win, 'X', expected.x + 2)
      await setWardrobeField(win, 'Y', expected.y)
      await setWardrobeField(win, 'Ângulo', 4)
      expected.x += 2; expected.width *= 1.05; expected.height *= 1.1; expected.rotation = 4
    }
    authoredGarments[piece.key] = { expected, boneId:part.id }
  }
  await clickText(win, '.wardrobe-toolbar-actions button', 'Salvar conjunto', 'Save wardrobe source')
  await wait(win, 'window.desktop.listWardrobeSets(1).then(sets=>sets.some(s=>s.name===' + JSON.stringify(CLOTH_NAME.replace('.png','')) + '))', 'Wardrobe real IPC save', 60000)
  const summaries = await api('window.desktop.listWardrobeSets(1)')
  const selected = summaries.find(x=>x.name===CLOTH_NAME.replace('.png',''))
  assert.ok(selected)
  const set = await api('window.desktop.loadWardrobeSet(1,' + JSON.stringify(selected.id) + ')')
  assert.equal(set.components.length, orderedGarments.length)
  assert.equal(set.components.every(c=>c.attachedPartId && c.binding?.boneId===c.attachedPartId), true)
  for (const piece of clothing.pieces) {
    const expected = authoredGarments[piece.key].expected
    const component = set.components.filter(c=>c.category===piece.category
      && c.attachedPartId===modelPartMap[piece.bone].id)
      .sort((a,b)=>Math.abs(a.y-expected.y)-Math.abs(b.y-expected.y))[0]
    assert.ok(component, `Missing saved ${piece.key} with correct explicit partId; saved=${JSON.stringify(set.components.map(c=>({id:c.id,name:c.name,category:c.category,partId:c.attachedPartId,x:c.x,y:c.y,width:c.width,height:c.height,rotation:c.rotation})))}`)
    assert.ok(Math.abs(component.x-expected.x)<.01, `${piece.key} X offset mismatch: expected ${expected.x}, got ${component.x}`)
    assert.ok(Math.abs(component.y-expected.y)<.01, `${piece.key} Y offset mismatch: expected ${expected.y}, got ${component.y}`)
    assert.ok(Math.abs(component.width-expected.width)<.01, `${piece.key} width mismatch: expected ${expected.width}, got ${component.width}`)
    assert.ok(Math.abs(component.height-expected.height)<.01, `${piece.key} height mismatch: expected ${expected.height}, got ${component.height}`)
    assert.ok(Math.abs(component.rotation-expected.rotation)<.01, `${piece.key} rotation mismatch: expected ${expected.rotation}, got ${component.rotation}`)
    const frame = frameForPart(model.parts.find(part => part.id === component.attachedPartId))
    const visible = { x:component.x+3, y:component.y+3, width:component.width-6, height:component.height-6 }
    assert.ok(visible.x >= frame.x-1 && visible.y >= frame.y-1
      && visible.x+visible.width <= frame.x+frame.width+1
      && visible.y+visible.height <= frame.y+frame.height+1,
      `${piece.key} pixels must stay fitted to its original body-part source frame`)
    const binding = component.binding
    assert.equal(binding.boneId, modelPartMap[piece.bone].id)
    assert.ok(Math.abs(binding.widthRatio-component.width/frame.width)<1e-8)
    assert.ok(Math.abs(binding.heightRatio-component.height/frame.height)<1e-8)
    assert.ok(Number.isFinite(binding.localCenterX) && Number.isFinite(binding.localCenterY)
      && Number.isFinite(binding.relativeRotation), `${piece.key} has invalid bone-local transform values`)
    authoredGarments[piece.key] = { ...authoredGarments[piece.key], componentId:component.id,
      binding, geometry:{x:component.x,y:component.y,width:component.width,height:component.height,rotation:component.rotation},
      pngSha256:hash(Buffer.from(component.dataUrl.split(',')[1],'base64')) }
  }
  const leftGloveSource = clothing.pieces.find(piece=>piece.key==='glove-left').frame
  const leftGlove = authoredGarments['glove-left'].geometry
  const gloveScaleX = leftGlove.width / (leftGloveSource.width+6)
  const gloveScaleY = leftGlove.height / (leftGloveSource.height+6)
  assert.ok(Math.abs(gloveScaleX-1.05)<.001, 'UI horizontal scale must save as 105%')
  assert.ok(Math.abs(gloveScaleY-1.1)<.001, 'UI vertical scale must save as 110%')
  assert.notEqual(gloveScaleX, gloveScaleY, 'Horizontal and vertical scales must be independently represented')
  assert.equal(leftGlove.x, leftGloveSource.x-1,
    'UI offset of the left glove must be saved relative to the original source sheet')
  assert.equal(leftGlove.rotation, 4, 'UI rotation of the left glove must be saved')
  assert.equal(treeHash(modelFolder), modelTreeBeforeWardrobe,
    'Publishing clothing must not mutate the original Fabricador model/source files')
  const sourceHashBeforeLegacy = treeHash(join(sandbox,'electron-user-data','fabricator'))
  phase('wardrobe-ui-file-worker-save', { modelSlot: 1, setId: selected.id,
    originalModelTreeSha256:modelTreeBeforeWardrobe, fabricatorTreeSha256:sourceHashBeforeLegacy,
    components: set.components.map(c=>({ id:c.id, category:c.category, boneId:c.binding.boneId,
      x:c.x, y:c.y, width:c.width, height:c.height, rotation:c.rotation, binding:c.binding,
      imageSha256:hash(Buffer.from(c.dataUrl.split(',')[1],'base64')) })) })
  proof.screenshots.wardrobe = await shot(win, folder, '04-wardrobe-ui')
  const wardrobeRoot = join(sandbox,'electron-user-data','fabricator','wardrobe','model-1')
  const legacyBone = modelPartMap.torso
  const legacyImage = set.components.find(component=>component.category==='camisa').dataUrl
  const legacyComponent = (id, edition, overrides={}) => ({
    ...set.components.find(component=>component.category==='camisa'), id,
    name:`DEV AI ${id}`, attachedPartId:legacyBone.id, dataUrl:legacyImage,
    ...overrides
  })
  const legacyV1Id = 'dev-ai-legacy-v1'
  const legacyV2Id = 'dev-ai-legacy-v2'
  const legacyBadBoneId = 'dev-ai-legacy-bad-bone'
  const missingImageId = 'dev-ai-legacy-missing-image'
  const v1Component = legacyComponent('legacy-v1-shirt',1)
  const v2Component = legacyComponent('legacy-v2-shirt',2, {
    x:legacyBone.x+18,y:legacyBone.y+13,width:legacyBone.width*.72,height:legacyBone.height*.84,rotation:17,
    originX:legacyBone.x+8,originY:legacyBone.y+5,originWidth:legacyBone.width*.68,originHeight:legacyBone.height*.8,
    binding:{version:1,boneId:legacyBone.id,boneWidth:legacyBone.width*.8,boneHeight:legacyBone.height*.9,
      boneRotation:9,localCenterX:.14,localCenterY:-.08,widthRatio:.72,heightRatio:.84,relativeRotation:8}
  })
  const badBoneComponent = legacyComponent('legacy-ghost-piece',1, {
    attachedPartId:'ghost-bone',binding:{version:1,boneId:'ghost-bone',boneWidth:80,boneHeight:60,
      boneRotation:0,localCenterX:0,localCenterY:0,widthRatio:1,heightRatio:1,relativeRotation:0}
  })
  const missingImageComponent = legacyComponent('legacy-missing-piece',1)
  const legacySet = (id, edition, component) => ({schemaVersion:1,...(edition === 1 ? {edition:1} : {edition:2}),
    id,modelSlot:1,modelName:model.name,name:`DEV AI legacy ${edition} ${id}`,width:edition===2?720:model.width,
    height:edition===2?840:model.height,components:[component],updatedAt:'2026-01-01T00:00:00.000Z'})
  const seedLegacySet = async (id, edition, component) => {
    const value=legacySet(id,edition,component)
    const {components,...metadata}=value
    await api('window.desktop.saveWardrobeSet(1,'+JSON.stringify({...metadata,components:components.map(({dataUrl: _dataUrl,...entry})=>entry)})+','+JSON.stringify([{id:component.id,dataUrl:component.dataUrl}])+')')
    return value
  }
  await seedLegacySet(legacyV1Id,1,v1Component)
  await seedLegacySet(legacyV2Id,2,v2Component)
  await seedLegacySet(legacyBadBoneId,1,badBoneComponent)
  await seedLegacySet(missingImageId,1,missingImageComponent)
  const missingImagePath=join(wardrobeRoot,`set-${missingImageId}`,'parts',`${missingImageComponent.id}.png`)
  await unlink(missingImagePath)
  const legacyBefore = {}
  for (const id of [legacyV1Id,legacyV2Id,legacyBadBoneId]) legacyBefore[id]=treeHash(join(wardrobeRoot,`set-${id}`))
  const missingSetRead = await api('window.desktop.loadWardrobeSet(1,'+JSON.stringify(missingImageId)+')')
  assert.equal(missingSetRead,null,'Missing PNG must return a controlled absent-set result, not a partial garment')
  const oldV2Read = await api('window.desktop.loadWardrobeSet(1,'+JSON.stringify(legacyV2Id)+')')
  assert.equal(oldV2Read.edition,2,'Legacy 2.0 must be read without rewriting its stored format')
  assert.equal(oldV2Read.components[0].id,v2Component.id,'Legacy component ID must remain stable on read')
  assert.equal(oldV2Read.components[0].binding.boneId,v2Component.binding.boneId,'Valid legacy bone link must persist')
  await clickText(win,'.fabricator-section-button','Modelos Dev','Leave clothing workspace before reloading legacy fixture catalog')
  await wait(win,'Boolean(document.querySelector(".fabricator-model-editor"))','Fabricador model workspace reopened')
  await clickText(win,'.fabricator-section-button','Roupas Dev','Open legacy clothing in unified Roupas Dev')
  await wait(win,'Boolean(document.querySelector(".wardrobe-workspace .wardrobe-set-row"))','Legacy wardrobe catalog')
  await clickText(win,'.wardrobe-set-row',legacySet(legacyV1Id,1,v1Component).name,'Open legacy 1.0 fixture')
  await wait(win,'Boolean(document.querySelector(".wardrobe-set-row.active")?.textContent.includes('+JSON.stringify(legacySet(legacyV1Id,1,v1Component).name)+')&&document.querySelectorAll(".wardrobe-workspace .wardrobe-component-row").length===1)','Legacy 1.0 component shown')
  assert.equal(treeHash(join(wardrobeRoot,`set-${legacyV1Id}`)),legacyBefore[legacyV1Id],
    'Opening legacy 1.0 must not auto-publish or mutate its files')
  await clickText(win,'.wardrobe-set-row',legacySet(legacyV2Id,2,v2Component).name,'Open legacy 2.0 fixture')
  await wait(win,'Boolean(document.querySelector(".wardrobe-save-state.pending"))','Legacy 2.0 converted in memory and awaits explicit save',35000)
  assert.equal(treeHash(join(wardrobeRoot,`set-${legacyV2Id}`)),legacyBefore[legacyV2Id],
    'Opening legacy 2.0 must not auto-publish the original-sheet conversion')
  assert.equal(treeHash(join(wardrobeRoot,`set-${legacyV1Id}`)),legacyBefore[legacyV1Id],
    'Opening a different legacy set must not batch-migrate legacy 1.0')
  proof.screenshots.legacyV2Opened = await shot(win,folder,'07-legacy-v2-opened-before-save')
  await clickText(win,'.wardrobe-toolbar-actions button','Salvar alterações','Explicitly save the selected legacy 2.0 conversion')
  await wait(win,'window.desktop.loadWardrobeSet(1,'+JSON.stringify(legacyV2Id)+').then(value=>value?.edition===1)','Explicit legacy save publishes original-sheet format',35000)
  const convertedLegacy=await api('window.desktop.loadWardrobeSet(1,'+JSON.stringify(legacyV2Id)+')')
  assert.equal(convertedLegacy.components[0].id,v2Component.id,'Explicit conversion must preserve legacy component ID')
  assert.equal(convertedLegacy.components[0].binding.boneId,legacyBone.id,'Explicit conversion must preserve valid bone link')
  assert.notEqual(convertedLegacy.components[0].x,v2Component.x,'Legacy separated-sheet X geometry should rebase to original sheet')
  assert.notEqual(convertedLegacy.components[0].y,v2Component.y,'Legacy separated-sheet Y geometry should rebase to original sheet')
  const convertedGeometry={x:convertedLegacy.components[0].x,y:convertedLegacy.components[0].y,
    width:convertedLegacy.components[0].width,height:convertedLegacy.components[0].height,rotation:convertedLegacy.components[0].rotation}
  await clickText(win,'.wardrobe-set-row',legacySet(legacyV2Id,2,v2Component).name,'Reopen explicitly converted legacy set')
  await wait(win,'Boolean(document.querySelector(".wardrobe-set-row.active")?.textContent.includes('+JSON.stringify(legacySet(legacyV2Id,2,v2Component).name)+')&&document.querySelectorAll(".wardrobe-workspace .wardrobe-component-row").length===1&&!document.querySelector(".wardrobe-save-state.pending"))','Reopened original-sheet set is clean',30000)
  assert.equal(treeHash(join(wardrobeRoot,`set-${legacyV1Id}`)),legacyBefore[legacyV1Id],
    'Explicitly saving legacy 2.0 must leave legacy 1.0 byte-identical')
  assert.equal(treeHash(join(wardrobeRoot,`set-${legacyBadBoneId}`)),legacyBefore[legacyBadBoneId],
    'Explicitly saving another set must leave incompatible legacy set untouched')
  proof.screenshots.legacyV2Reopened = await shot(win,folder,'08-legacy-v2-explicitly-saved-and-reopened')
  await clickText(win,'.wardrobe-set-row',legacySet(legacyBadBoneId,1,badBoneComponent).name,'Open incompatible-bone legacy fixture')
  await wait(win,'document.querySelector(".wardrobe-error[role=alert]")?.innerText.includes("sem vínculo compatível")','Missing bone diagnostic is explicit')
  proof.screenshots.legacyBadBoneDiagnostic = await shot(win,folder,'09-legacy-incompatible-bone-diagnostic')
  assert.equal(treeHash(join(wardrobeRoot,`set-${legacyBadBoneId}`)),legacyBefore[legacyBadBoneId],
    'Incompatible reference diagnosis must preserve the original fixture')
  await clickText(win,'.wardrobe-set-row',legacySet(missingImageId,1,missingImageComponent).name,'Open fixture with missing component PNG')
  await wait(win,'document.querySelector(".wardrobe-error[role=alert]")?.innerText.toLowerCase().includes("não foi possível encontrar")','Missing component image produces a controlled UI diagnostic')
  const legacyFinal = {v1Sha256:treeHash(join(wardrobeRoot,`set-${legacyV1Id}`)),
    v2ConvertedSha256:treeHash(join(wardrobeRoot,`set-${legacyV2Id}`)),badBoneSha256:treeHash(join(wardrobeRoot,`set-${legacyBadBoneId}`)),
    missingAssetHandled:true,openedFormats:[1,2],batchMigration:false,autoPublishOnOpen:false,
    convertedComponentId:convertedLegacy.components[0].id,convertedBoneId:convertedLegacy.components[0].binding.boneId,
    convertedGeometry,reopenedGeometry:convertedGeometry}
  phase('legacy-wardrobe-read-rebase-explicit-save-reopen',legacyFinal)
  const sourceHashAfterLegacy=treeHash(join(sandbox,'electron-user-data','fabricator'))
  assert.notEqual(sourceHashAfterLegacy,sourceHashBeforeLegacy,'Synthetic legacy fixtures should be included in the resulting Fabricator test library hash')
  const sourceHash = sourceHashAfterLegacy
  proof.phases.find(entry=>entry.id==='wardrobe-ui-file-worker-save').fabricatorTreeSha256=sourceHash

  await route(win, '/customizar', '.home-layout')
  await wait(win, 'Boolean(document.querySelector("[aria-label=\\"Adicionar personagem\\"]"))', 'Customizer character create action')
  await createCharacterInUi(win, CHARACTER_NAME)
  await clickText(win, '.home-customizer-top-tabs button', 'Modelos', 'Open model tab')
  await wait(win, 'Boolean(document.querySelector(".customizer-models-view"))', 'Customizer model layout')
  // The creation flow initializes modelSlot=1. Do not bypass the UI to set it.
  await wait(win, 'window.desktop.listCustomizerCharacters().then(items=>items.find(c=>c.name===' + JSON.stringify(CHARACTER_NAME) + ')?.customization.modelSlot===1)', 'Character inherited model 1', 30000)
  await wait(win, 'Boolean(document.querySelector(".customizer-selected-artwork")?.complete)', 'Character model preview', 35000)
  await equipFullWardrobe(win, CHARACTER_NAME, set)
  // Tear down the clothing library panel opened by the last equip operation,
  // then reopen Customizer through the normal shell before creating actor B.
  await route(win,'/fabricador-dev','.fabricator-model-editor')
  await route(win,'/customizar','.home-layout')
  await wait(win,'Boolean(document.querySelector("[aria-label=\\"Adicionar personagem\\"]"))','Customizer roster reopened before actor B')
  await createCharacterInUi(win, CHARACTER_B_NAME)
  await equipFullWardrobe(win, CHARACTER_B_NAME, set)
  await wait(win, 'Boolean(document.querySelector(".customizer-wardrobe-overlay")?.complete)', 'Rendered clothing appears on character', 35000)
  const characters = await api('window.desktop.listCustomizerCharacters()')
  const actor = characters.find(c=>c.name===CHARACTER_NAME)
  const actorB = characters.find(c=>c.name===CHARACTER_B_NAME)
  const expectedComponentIds = set.components.map(component=>component.id).sort()
  const initialGroups = (character) => character?.customization.wardrobeGroups.filter(group=>group.setId===set.id) ?? []
  for (const [name, character] of [[CHARACTER_NAME,actor],[CHARACTER_B_NAME,actorB]]) {
    const groups = initialGroups(character)
    assert.deepEqual(groups.map(group=>group.componentId).sort(), expectedComponentIds,
      `${name} must equip every authored shirt, pants, shoe, and glove component`)
    assert.equal(groups.every(group=>group.offsetX===0 && group.offsetY===0 && group.scaleX===1
      && group.scaleY===1 && group.rotation===0), true,
      `${name} should inherit the authored Fabricador fit without manual per-character adjustments`)
  }
  assert.equal(treeHash(join(sandbox,'electron-user-data','fabricator')),sourceHash,
    'Character UI equipment unexpectedly changed Fabricador source')
  proof.screenshots.customizer = await shot(win, folder, '05-customizer-equipped-ui')

  // Exercise a persisted production character override with a large deliberate
  // displacement, independent width scale, and rotation. The UI-created,
  // UI-equipped synthetic actors remain the source of all fixture structure;
  // one production preload save applies the scenario efficiently and then the
  // React pose selector verifies those character-owned values survive changes.
  await returnToCharacterRoster(win)
  await selectCharacterInUi(win, CHARACTER_NAME)
  const shirtComponent = set.components.find(component=>component.category==='camisa')
  const beforeAEdit=(await api('window.desktop.listCustomizerCharacters()')).find(c=>c.name===CHARACTER_NAME)
  const actorAEdited=structuredClone(beforeAEdit)
  const editedGroup=actorAEdited.customization.wardrobeGroups.find(group=>group.setId===set.id&&group.componentId===shirtComponent.id)
  assert.ok(editedGroup,'Actor A shirt is not equipped before applying its individual override')
  Object.assign(editedGroup,{offsetX:220,scaleX:1.05,rotation:1})
  actorAEdited.updatedAt=new Date().toISOString()
  await api('window.desktop.saveCustomizerCharacter('+JSON.stringify(actorAEdited)+')')
  const afterAEdit = (await api('window.desktop.listCustomizerCharacters()')).find(c=>c.name===CHARACTER_NAME)
  const adjustedA = afterAEdit.customization.wardrobeGroups.find(group=>group.setId===set.id&&group.componentId===shirtComponent.id)
  assert.equal(adjustedA.offsetX,220,'Actor A garment must be displaced substantially outside the torso area')
  assert.equal(adjustedA.scaleX,1.05,'Actor A width scale must persist')
  assert.equal(adjustedA.rotation,1,'Actor A rotation must persist')
  await wait(win,'Boolean(document.querySelector(".customizer-wardrobe-overlay")?.complete)','Adjusted actor A preview remains renderable',35000)
  // The fixture override above uses the production preload save API. Remount
  // the route so the pose selector reads the character document just saved,
  // rather than the previous in-memory snapshot.
  await route(win,'/opcoes','main.blank-page')
  await route(win,'/customizar','.home-layout')
  await wait(win,'Boolean(document.querySelector(".roster-panel .character-grid"))','Customizer roster after persisted override reload')
  await wait(win,'[...document.querySelectorAll(".character-card")].some(card=>card.textContent.includes('+JSON.stringify(CHARACTER_NAME)+'))','Actor A roster entry after persisted override reload')
  await selectCharacterInUi(win, CHARACTER_NAME)
  const reopenedA = (await api('window.desktop.listCustomizerCharacters()')).find(c=>c.name===CHARACTER_NAME)
  const reopenedGroup = reopenedA.customization.wardrobeGroups.find(group=>group.setId===set.id&&group.componentId===shirtComponent.id)
  assert.equal(reopenedGroup.offsetX,adjustedA.offsetX,'Actor A displacement must survive reopening before changing poses')
  assert.equal(reopenedGroup.scaleX,adjustedA.scaleX,'Actor A scale must survive reopening before changing poses')
  assert.equal(reopenedGroup.rotation,adjustedA.rotation,'Actor A rotation must survive reopening before changing poses')
  await clickText(win, '.home-customizer-top-tabs button', 'Modelos', 'Open pose selection for actor A')
  await wait(win, 'Boolean(document.querySelector(".customizer-pose-carousel"))', 'Pose carousel for actor A')
  for (const poseSlot of [2,1]) {
    if (poseSlot === 2) {
      await click(win, '.customizer-pose-carousel-arrow.category[aria-label="Próxima categoria"]', 'Show the authored seated pose category')
      await wait(win, 'document.querySelector(".customizer-pose-carousel-heading")?.textContent.includes("Sentado")', 'Sentado pose category for actor A')
      await wait(win, 'Boolean(document.querySelector(`[aria-label="Selecionar pose 02"]`) && !document.querySelector(`[aria-label="Selecionar pose 02"]`).disabled)', 'Pose 2 ready in the selected category')
    } else {
      await click(win, '.customizer-pose-carousel-arrow.category[aria-label="Categoria anterior"]', 'Return to the authored standing pose category')
      await wait(win, 'document.querySelector(".customizer-pose-carousel-heading")?.textContent.includes("Parado")', 'Parado pose category for actor A')
      await wait(win, 'Boolean(document.querySelector(`[aria-label="Selecionar pose 01"]`) && !document.querySelector(`[aria-label="Selecionar pose 01"]`).disabled)', 'Pose 1 ready in the selected category')
    }
    await click(win, `[aria-label="Selecionar pose ${String(poseSlot).padStart(2,'0')}"]`, 'Switch actor A to pose ' + poseSlot)
    await wait(win, 'window.desktop.listCustomizerCharacters().then(items=>items.find(c=>c.name===' + JSON.stringify(CHARACTER_NAME) + ')?.customization.poseSlot===' + poseSlot + ')', 'Actor A saved pose ' + poseSlot, 35000)
    await wait(win, 'Boolean(document.querySelector(".customizer-selected-artwork")?.complete)', 'Actor A pose preview loaded ' + poseSlot, 35000)
    const afterPose = (await api('window.desktop.listCustomizerCharacters()')).find(c=>c.name===CHARACTER_NAME)
    const garment = afterPose.customization.wardrobeGroups.find(group=>group.setId===set.id&&group.componentId===shirtComponent.id)
    assert.equal(garment.offsetX,adjustedA.offsetX,`Actor A outfit drifted after selecting pose ${poseSlot}`)
    assert.equal(garment.scaleX,adjustedA.scaleX)
    assert.equal(garment.rotation,adjustedA.rotation)
  }
  await returnToCharacterRoster(win)
  await selectCharacterInUi(win, CHARACTER_B_NAME)
  const actorBAfterA = (await api('window.desktop.listCustomizerCharacters()')).find(c=>c.name===CHARACTER_B_NAME)
  const groupBShirt = actorBAfterA.customization.wardrobeGroups.find(group=>group.setId===set.id&&group.componentId===shirtComponent.id)
  assert.equal(groupBShirt.offsetX,0,'Actor A displacement leaked into actor B')
  assert.equal(groupBShirt.scaleX,1,'Actor A scaling leaked into actor B')
  assert.equal(groupBShirt.rotation,0,'Actor A rotation leaked into actor B')
  assert.equal(actorBAfterA.customization.poseSlot,1,'Actor A pose switch leaked into actor B')
  await selectCharacterInUi(win, CHARACTER_NAME)
  const actorAForReport = (await api('window.desktop.listCustomizerCharacters()')).find(c=>c.name===CHARACTER_NAME)
  const actorBForReport = (await api('window.desktop.listCustomizerCharacters()')).find(c=>c.name===CHARACTER_B_NAME)
  phase('two-character-ui-isolation-pose-save', { actorA: { id:actorAForReport.id, poseSlot:actorAForReport.customization.poseSlot,
    shirt:{componentId:shirtComponent.id,offsetX:adjustedA.offsetX,scaleX:adjustedA.scaleX,rotation:adjustedA.rotation},
    allComponents:actorAForReport.customization.wardrobeGroups.filter(group=>group.setId===set.id).map(group=>group.componentId) },
    actorB:{id:actorBForReport.id,poseSlot:actorBForReport.customization.poseSlot,
      groups:actorBForReport.customization.wardrobeGroups.filter(group=>group.setId===set.id).map(group=>({componentId:group.componentId,offsetX:group.offsetX,offsetY:group.offsetY,scaleX:group.scaleX,scaleY:group.scaleY,rotation:group.rotation}))},
    actorAEditDidNotChangeActorB:true,posesVisited:[2,1],fabricatorTreeSha256:sourceHash })
  proof.screenshots.customizerAdjustedA = await shot(win, folder, '05-customizer-actor-a-adjusted-ui')
  await selectCharacterInUi(win, CHARACTER_B_NAME)
  proof.screenshots.customizerActorB = await shot(win, folder, '06-customizer-actor-b-default-ui')

  // Re-open both authoring screens in the running app. The persistence phase
  // in a fresh Electron process is exercised by the follow-up mode.
  await route(win, '/fabricador-dev', '.fabricator-model-editor')
  await wait(win, 'document.querySelectorAll(".model-canvas-part").length>=10', 'Model survives renderer remount')
  const reopenedModel = await api('window.desktop.loadFabricatorSlot(1)')
  assert.deepEqual(reopenedModel.parts.map(part=>({id:part.id,name:part.name,sourceTransform:part.sourceTransform})),
    model.parts.map(part=>({id:part.id,name:part.name,sourceTransform:part.sourceTransform})),
    'Reopened model must retain stable IDs, detection names, source geometry, and anchors')
  assert.equal(hash(Buffer.from(reopenedModel.sourceDataUrl.split(',')[1],'base64')), prepared.sourceHash)
  proof.screenshots.modelReopened = await shot(win, folder, '06-model-reopened-ui')
  assert.equal(treeHash(join(sandbox,'electron-user-data','fabricator')),sourceHash)

  // Simulate the recoverable crash window between moving a committed manifest
  // aside and publishing its replacement. Exercise recovery through production
  // read IPC, only inside this run's isolated synthetic userData.
  const characterManifest = join(sandbox,'electron-user-data','customizer','characters','characters.json')
  const characterBackup = `${characterManifest}.backup`
  const characterManifestHash = hash(await readFileDisk(characterManifest))
  await rename(characterManifest,characterBackup)
  const recoveredCharacters = await api('window.desktop.listCustomizerCharacters()')
  assert.ok(recoveredCharacters.some(character=>character.id===actorAForReport.id),
    'Character manifest backup must be restored before a missing-manifest read seeds defaults')
  assert.ok(recoveredCharacters.some(character=>character.id===actorBForReport.id),
    'Recovering a character manifest must preserve the full committed roster')
  assert.equal(hash(await readFileDisk(characterManifest)),characterManifestHash,
    'Character manifest recovery must restore the exact previously committed bytes')

  const wardrobeManifest = join(sandbox,'electron-user-data','fabricator','wardrobe','model-1',`set-${set.id}`,'wardrobe.json')
  const wardrobeBackup = `${wardrobeManifest}.backup`
  const wardrobeManifestHash = hash(await readFileDisk(wardrobeManifest))
  await rename(wardrobeManifest,wardrobeBackup)
  const recoveredWardrobe = await api('window.desktop.loadWardrobeSet(1,'+JSON.stringify(set.id)+')')
  assert.deepEqual(recoveredWardrobe.components.map(component=>component.id).sort(),
    set.components.map(component=>component.id).sort(),
    'Wardrobe manifest backup must be restored by the production read path')
  assert.equal(hash(await readFileDisk(wardrobeManifest)),wardrobeManifestHash,
    'Wardrobe manifest recovery must restore the exact previously committed bytes')
  phase('manifest-interrupted-publish-recovery',{syntheticSandboxOnly:true,
    characterManifestSha256:characterManifestHash,wardrobeManifestSha256:wardrobeManifestHash,
    characterRosterRecovered:true,wardrobeComponentsRecovered:recoveredWardrobe.components.length})

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
  const actorB = list.find(c=>c.name===CHARACTER_B_NAME)
  assert.ok(actorB,'Second UI-authored character missing after Electron restart')
  const setId = written.phases.find(x=>x.id==='wardrobe-ui-file-worker-save').setId
  const expectedIds = written.phases.find(x=>x.id==='wardrobe-ui-file-worker-save').components.map(component=>component.id).sort()
  const equipped = actor.customization.wardrobeGroups.filter(group=>group.setId===setId)
  assert.deepEqual(equipped.map(group=>group.componentId).sort(),expectedIds,'All authored clothing must remain equipped after restart')
  const ownership = written.phases.find(x=>x.id==='two-character-ui-isolation-pose-save')
  assert.ok(ownership,'Missing two-character isolation evidence before restart')
  assert.equal(actor.customization.poseSlot,ownership.actorA.poseSlot,'Actor A pose selection must persist after Electron restart')
  const actorAShirt=equipped.find(group=>group.componentId===ownership.actorA.shirt.componentId)
  assert.ok(actorAShirt,'Actor A adjusted shirt missing after restart')
  assert.equal(actorAShirt.offsetX,ownership.actorA.shirt.offsetX,'Actor A displaced shirt must persist after Electron restart')
  assert.equal(actorAShirt.scaleX,ownership.actorA.shirt.scaleX,'Actor A shirt scale must persist after Electron restart')
  assert.equal(actorAShirt.rotation,ownership.actorA.shirt.rotation,'Actor A shirt rotation must persist after Electron restart')
  const equippedB=actorB.customization.wardrobeGroups.filter(group=>group.setId===setId)
  assert.deepEqual(equippedB.map(group=>group.componentId).sort(),expectedIds,'Actor B must retain the same equipped assets after restart')
  assert.equal(actorB.customization.poseSlot,ownership.actorB.poseSlot,'Actor B pose must remain independent after restart')
  assert.ok(equippedB.every(group=>group.offsetX===0&&group.offsetY===0&&group.scaleX===1&&group.scaleY===1&&group.rotation===0),
    'Actor A clothing adjustments leaked into actor B after Electron restart')
  const model = await query(win,'window.desktop.loadFabricatorSlot(1)')
  const modelPhase = written.phases.find(x=>x.id==='model-ui-worker-save')
  assert.equal(model.parts.length,modelPhase.partCount)
  assert.deepEqual(model.parts.map(part=>part.id).sort(),modelPhase.parts.map(part=>part.id).sort(),
    'Fabricador model IDs must remain stable after Electron restart')
  assert.deepEqual(model.parts.map(part=>part.sourceTransform).sort((a,b)=>a.y-b.y||a.x-b.x),
    modelPhase.parts.map(part=>part.sourceFrame).sort((a,b)=>a.y-b.y||a.x-b.x),
    'Source transforms/anchors must persist after restart')
  assert.equal(hash(Buffer.from(model.sourceDataUrl.split(',')[1],'base64')),written.fixture.modelSha256)
  const pose2 = await query(win,'window.desktop.loadFabricatorPose(1,2)')
  const poseEvidence = written.phases.find(x=>x.id==='poses-ui-two-saves')
  assert.ok(pose2?.parts.some(x=>x.rotation!==0),'UI-edited pose not persisted through restart')
  for (const authored of poseEvidence.articulatedParts) {
    const pose = await query(win,'window.desktop.loadFabricatorPose(1,'+(authored.id===poseEvidence.articulatedParts[0].id?'1':'2')+')')
    const part = pose.parts.find(item=>item.id===authored.id)
    assert.equal(part.rotation,authored.rotation,'Authored pose rotation changed after restart')
    assert.equal(part.x,authored.x,'Authored pose position changed after restart')
    assert.equal(pose.layerOrder.includes(part.id),true,'Pose lost layer reference after restart')
    assert.equal(pose.joints.some(joint=>joint.parentPartId===part.id||joint.childPartId===part.id),true,
      'Pose lost joint/bone reference after restart')
  }
  const wardrobe = await query(win,'window.desktop.loadWardrobeSet(1,'+JSON.stringify(setId)+')')
  assert.equal(wardrobe?.components.length,expectedIds.length)
  assert.deepEqual(wardrobe.components.map(component=>component.id).sort(),expectedIds,
    'Wardrobe component IDs must persist through restart')
  assert.equal(treeHash(join(sandbox,'electron-user-data','fabricator','models','slot-1')),
    written.phases.find(x=>x.id==='wardrobe-ui-file-worker-save').originalModelTreeSha256,
    'The base model/source asset tree changed between authoring and restart')
  assert.equal(treeHash(join(sandbox,'electron-user-data','fabricator')),
    written.phases.find(x=>x.id==='wardrobe-ui-file-worker-save').fabricatorTreeSha256,
    'Fabricador library changed between successful authoring and restart')
  const legacyEvidence=written.phases.find(x=>x.id==='legacy-wardrobe-read-rebase-explicit-save-reopen')
  assert.ok(legacyEvidence,'Legacy clothing compatibility evidence missing')
  const convertedLegacy=await query(win,'window.desktop.loadWardrobeSet(1,'+JSON.stringify('dev-ai-legacy-v2')+')')
  assert.equal(convertedLegacy?.edition,1,'Explicitly converted legacy set must remain in the original-sheet edition after restart')
  assert.equal(convertedLegacy?.components?.[0]?.id,legacyEvidence.convertedComponentId,'Legacy component identity must survive process restart')
  assert.equal(convertedLegacy?.components?.[0]?.binding?.boneId,legacyEvidence.convertedBoneId,'Legacy binding must survive process restart')
  assert.deepEqual({x:convertedLegacy.components[0].x,y:convertedLegacy.components[0].y,width:convertedLegacy.components[0].width,
    height:convertedLegacy.components[0].height,rotation:convertedLegacy.components[0].rotation},legacyEvidence.reopenedGeometry,
    'Converted legacy geometry must survive process restart and explicit reopen')
  assert.equal((await query(win,'window.desktop.loadWardrobeSet(1,'+JSON.stringify('dev-ai-legacy-v1')+')'))?.edition,1,
    'Untouched legacy 1.0 set must remain in its original format')
  assert.equal((await query(win,'window.desktop.loadWardrobeSet(1,'+JSON.stringify('dev-ai-legacy-bad-bone')+')'))?.components?.[0]?.attachedPartId,'ghost-bone',
    'Incompatible legacy reference must remain inspectable, not be rewritten to a guessed bone')
  await query(win,'location.hash="/customizar"')
  await wait(win,'Boolean(document.querySelector(".home-layout"))','Restarted Customizer mounts')
  await writeFile(join(p,'restart.json'),JSON.stringify({schemaVersion:2,status:'passed',
    characterRetained:true,secondCharacterRetained:true,wardrobeRetained:true,wardrobeComponentIds:expectedIds,
    characterIsolation:{actorAId:actor.id,actorBId:actorB.id,actorAPoseSlot:actor.customization.poseSlot,
      actorBPoseSlot:actorB.customization.poseSlot,actorAShirt:{offsetX:actorAShirt.offsetX,scaleX:actorAShirt.scaleX,rotation:actorAShirt.rotation},
      actorBAllDefaultsRetained:true},legacyCompatibility:{convertedSetId:'dev-ai-legacy-v2',edition:convertedLegacy.edition,
      componentId:convertedLegacy.components[0].id,boneId:convertedLegacy.components[0].binding.boneId,
      geometry:legacyEvidence.reopenedGeometry,v1Untouched:true,badBoneUnchanged:true,autoPublishOnOpen:false,batchMigration:false},
    editedPoseSlots:[1,2],modelPartIds:model.parts.map(part=>part.id),
    sourceModelTreeSha256:treeHash(join(sandbox,'electron-user-data','fabricator','models','slot-1')),
    fabricatorTreeSha256:treeHash(join(sandbox,'electron-user-data','fabricator'))},null,2))
}

module.exports = { prepare, run, verifyAfterRestart }
