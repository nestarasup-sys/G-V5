import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

async function loadPureTs(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove }
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}
const { bindWardrobeComponent, mapWardrobeComponentToPose, wardrobePosePadding, rebaseWardrobeSetToOriginalSheet } =
  await loadPureTs('../src/renderer/src/features/fabricator/wardrobe/poseTransform.ts')
const { suggestWardrobeBone } =
  await loadPureTs('../src/renderer/src/features/fabricator/wardrobe/boneSelection.ts')
const { validateWardrobeFlow, applyCharacterWardrobeAdjustment } =
  await loadPureTs('../src/shared/assetFlow.ts')
const { anchorWardrobeAdjustments, wardrobeAdjustmentMatrix, moveWardrobeAdjustment, editWardrobeAdjustment, validWardrobeAdjustmentReference } =
  await loadPureTs('../src/shared/wardrobeAdjustment.ts')

const bone = (id, name, x, y, width, height, overrides = {}) => ({
  id, name, x, y, width, height, rotation: 0, sourceTransform: { x, y, width, height, rotation: 0 }, ...overrides
})
const source = {
  slot: 1, width: 1000, height: 1000, updatedAt: '2026-01-01',
  parts: [bone('head', 'Cabeça', 400, 70, 180, 190), bone('torso', 'Corpo', 360, 330, 280, 240),
    bone('leg-left', 'Canela esquerda', 220, 720, 170, 220), bone('leg-right', 'Canela direita', 630, 720, 170, 220)]
}
const pose = {
  sourceModelSlot: 1, sourceModelUpdatedAt: source.updatedAt,
  parts: [
    bone('head', 'Cabeça', 410, 40, 180, 190),
    bone('torso', 'Corpo', 370, 320, 280, 240),
    bone('leg-left', 'Canela esquerda', 190, 700, 170, 220),
    bone('leg-right', 'Canela direita', 670, 700, 170, 220)
  ]
}
const comp = (id, category, attachedPartId, x, y, width, height) => ({
  id, category, attachedPartId, name: id, x, y, width, height, rotation: 0, dataUrl: 'synthetic-no-image'
})
const garment = comp('shoe-left', 'sapato', 'leg-left', 230, 830, 135, 80)
garment.binding = bindWardrobeComponent(garment, source.parts[2])
const other = comp('glasses', 'oculos', 'head', 420, 115, 135, 45)
other.binding = bindWardrobeComponent(other, source.parts[0])
const set = { id: 'wardrobe-fixture', modelSlot: 1, components: [garment, other] }
const equipped = [{ modelSlot: 1, setId: set.id, componentId: 'shoe-left', category: 'sapato',
  offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotation: 0 }]
const beforeSource = JSON.stringify(source), beforePose = JSON.stringify(pose), beforeSet = JSON.stringify(set)
const initial = mapWardrobeComponentToPose(garment, source.parts[2], source.parts[2])
assert.ok(Math.abs(initial.origin.x + initial.localLeft + initial.renderWidth / 2 - (garment.x + garment.width / 2)) < 1e-7,
  'Uma pose idêntica deve reproduzir exatamente o pré-ajuste do Fabricador')
assert.ok(Math.abs(initial.origin.y + initial.localTop + initial.renderHeight / 2 - (garment.y + garment.height / 2)) < 1e-7)
assert.ok(Math.abs(initial.renderWidth - garment.width) < 1e-7)
assert.ok(Math.abs(initial.renderHeight - garment.height) < 1e-7)
const posed = mapWardrobeComponentToPose(garment, source.parts[2], pose.parts[2])
assert.ok(Math.abs(posed.origin.x - (pose.parts[2].x + pose.parts[2].width / 2)) < 1e-7)
assert.equal(validateWardrobeFlow(set, source, pose, equipped).ok, true)
assert.equal(validateWardrobeFlow(set, source, pose, equipped).resolved, 1)
assert.equal(JSON.stringify(source), beforeSource)
assert.equal(JSON.stringify(pose), beforePose)
assert.equal(JSON.stringify(set), beforeSet)

// Customizer deltas belong to characters; changing one cannot change Fabricator
// sources or another character. No runtime/stored model mutation is possible.
const baseCustomization = { modelSlot: 1, poseSlot: 1, partOverrides: {}, layerOrder: [], wardrobeGroups: equipped }
const sibling = structuredClone(baseCustomization)
const character = applyCharacterWardrobeAdjustment(baseCustomization,
  { modelSlot: 1, setId: set.id, componentId: garment.id },
  { offsetX: 12, offsetY: -5, rotation: 9, scaleX: 1.2 })
assert.equal(character.wardrobeGroups[0].offsetX, 12)
assert.equal(baseCustomization.wardrobeGroups[0].offsetX, 0)
assert.deepEqual(sibling, baseCustomization)
assert.equal(JSON.stringify(set), beforeSet, 'Nenhum ajuste do Customizador altera a biblioteca original')
assert.throws(() => applyCharacterWardrobeAdjustment(baseCustomization,
  { modelSlot: 1, setId: set.id, componentId: garment.id }, { scaleX: 0 }), /inválido/)
assert.throws(() => applyCharacterWardrobeAdjustment(baseCustomization,
  { modelSlot: 1, setId: set.id, componentId: 'wrong' }, { offsetX: 1 }), /não está equipada/)

// Reject silent disappearance on missing IDs. Legacy unbound garments are
// reported as warnings, rather than mutated or silently accepted as calibrated.
const badPose = { ...pose, parts: pose.parts.filter(part => part.id !== 'leg-left') }
assert.ok(validateWardrobeFlow(set, source, badPose, equipped).issues.some(x => x.code === 'missing-pose-bone'))
const mismatch = structuredClone(set)
mismatch.components[0].binding.boneId = 'torso'
assert.ok(validateWardrobeFlow(mismatch, source, pose, equipped).issues.some(x => x.code === 'binding-bone-mismatch'))
const unbound = structuredClone(set)
delete unbound.components[0].binding
assert.ok(validateWardrobeFlow(unbound, source, pose, equipped).issues.some(x => x.code === 'missing-binding'))
const nonexistent = [{ ...equipped[0], componentId: 'missing' }]
assert.ok(validateWardrobeFlow(set, source, pose, nonexistent).issues.some(x => x.code === 'missing-component'))
assert.ok(validateWardrobeFlow(set, source, { ...pose, sourceModelSlot: 2 }, equipped).issues.some(x => x.code === 'model-slot-mismatch'))
assert.ok(validateWardrobeFlow(set, source, { ...pose, sourceModelUpdatedAt: 'changed' }, equipped).issues.some(x => x.code === 'model-revision-mismatch'))

const leftShoe = suggestWardrobeBone('sapato', 250, 1000, source)
const rightShoe = suggestWardrobeBone('sapato', 750, 1000, source)
assert.equal(leftShoe.bone?.id, 'leg-left')
assert.equal(rightShoe.bone?.id, 'leg-right')
assert.equal(suggestWardrobeBone('oculos', 500, 1000, source).bone?.id, 'head')
assert.equal(suggestWardrobeBone('acessorio-cabeca', 500, 1000,
  { ...source, parts: source.parts.filter(x => x.id !== 'head') }).bone, null)
assert.equal(suggestWardrobeBone('sapato', 750, 1000,
  { ...source, parts: source.parts.filter(x => x.id !== 'leg-right') }).bone, null,
  'Não prender automaticamente um sapato direito à perna esquerda')
assert.equal(suggestWardrobeBone('sapato', NaN, 1000, source).bone, null)

// The reference source sheet is authoritative even after the model is posed,
// resized, or moved. Using the assembled part.width was the root of an
// erroneous center/side estimate in the old guessing implementation.
const resized = { ...source, parts: [
  bone('source-left', 'Canela esquerda', 0, 0, 900, 200,
    { sourceTransform: { x: 100, y: 700, width: 100, height: 100, rotation: 0 } }),
  bone('source-right', 'Canela direita', 500, 0, 10, 100,
    { sourceTransform: { x: 600, y: 700, width: 100, height: 100, rotation: 0 } })
] }
assert.equal(suggestWardrobeBone('sapato', 750, 1000, resized).bone?.id, 'source-right',
  'Seleção precisa usar sourceTransform.width, não part.width montada')
// Picker slots split one outfit into individual thigh/calf selections. Their
// seam coverage must equal the Fabricator pose preview of the complete set.
const thighBone = bone('thigh-left', 'Coxa esquerda', 100, 100, 100, 200)
const thigh = comp('pants-thigh', 'calca-coxa', 'thigh-left', 100, 100, 100, 200)
const calf = comp('pants-calf', 'calca-canela', 'leg-left', 100, 300, 100, 200)
thigh.binding = bindWardrobeComponent(thigh, thighBone)
const pants = [thigh, calf]
const pantsBefore = JSON.stringify(pants)
const individuallyEquipped = [[thigh], [calf]].flat()
for (const piece of pants) {
  assert.deepEqual(wardrobePosePadding(piece, individuallyEquipped), wardrobePosePadding(piece, pants),
    'A seleção individual do Customizador deve preservar a cobertura do conjunto no Fabricador')
  assert.equal(wardrobePosePadding(piece, individuallyEquipped).kneeOverlap, 18)
}
const padding = wardrobePosePadding(thigh, individuallyEquipped)
const covered = mapWardrobeComponentToPose(thigh, thighBone, thighBone, padding.kneeOverlap, padding.edgePadding)
assert.equal(covered.renderHeight, 218)
assert.equal(covered.origin.y + covered.localTop, 91)
assert.equal(covered.origin.y + covered.localTop + covered.renderHeight, 309,
  'A coxa equipada individualmente precisa manter a extensão de cobertura na junta')
assert.equal(covered.origin.y + covered.localTop + covered.renderHeight / 2, 200,
  'A cobertura não deve deslocar o centro do pré-ajuste')
assert.equal(wardrobePosePadding(thigh, [thigh]).kneeOverlap, 0,
  'Uma canela removida/oculta não deve ativar a cobertura de calça completa')
assert.equal(wardrobePosePadding(garment, pants).kneeOverlap, 0,
  'A regra de joelho não pode aumentar sapatos ou outros acessórios')
assert.equal(JSON.stringify(pants), pantsBefore, 'A cobertura de render não altera os assets salvos')

// Compare independent normalized-bone transport against the production affine
// adjustment, including oblique authoring poses and nonuniform axis scales.
const authorBone = bone('thigh-left', 'Coxa esquerda', 100, 140, 120, 240, { rotation: 35 })
const legacyFit = { ...equipped[0], componentId: thigh.id, offsetX: 13, offsetY: -9, scaleX: 1.4, scaleY: .7, rotation: 19 }
const legacyBefore = JSON.stringify(legacyFit)
const [fit] = anchorWardrobeAdjustments([legacyFit], 1, [authorBone], () => [thigh])
assert.ok(validWardrobeAdjustmentReference(fit.adjustmentReference))
assert.deepEqual(wardrobeAdjustmentMatrix(fit, authorBone, { x:160,y:260 }), wardrobeAdjustmentMatrix(legacyFit, authorBone, { x:160,y:260 }),
  'A migração precisa preservar o encaixe visível na pose de autoria')
const centerOf = b => ({ x:b.x+b.width/2, y:b.y+b.height/2 })
const applyMatrix = (m,p) => ({ x:m[0]*p.x+m[2]*p.y+m[4], y:m[1]*p.x+m[3]*p.y+m[5] })
const closePoint = (a,b,label) => { assert.ok(Math.abs(a.x-b.x)<1e-8 && Math.abs(a.y-b.y)<1e-8, `${label}: ${JSON.stringify({a,b})}`) }
function independentlyTransport(p,from,to) {
  const a=from.rotation*Math.PI/180,b=to.rotation*Math.PI/180,origin=centerOf(from),target=centerOf(to)
  const dx=p.x-origin.x,dy=p.y-origin.y
  const x=(dx*Math.cos(a)+dy*Math.sin(a))*to.width/from.width
  const y=(-dx*Math.sin(a)+dy*Math.cos(a))*to.height/from.height
  return {x:target.x+x*Math.cos(b)-y*Math.sin(b),y:target.y+x*Math.sin(b)+y*Math.cos(b)}
}
let poseAdjustmentCases=0
for (const rotation of [-120,-35,0,35,90,180]) for (const [width,height] of [[120,240],[180,120],[60,360]]) {
  const target={...authorBone,x:430,y:90,width,height,rotation}
  const authored=wardrobeAdjustmentMatrix(fit,authorBone,centerOf(authorBone))
  const posed=wardrobeAdjustmentMatrix(fit,target,centerOf(target))
  for(const sample of [{x:100,y:140},{x:220,y:380},{x:160,y:260},{x:135,y:311}]) {
    closePoint(applyMatrix(posed,independentlyTransport(sample,authorBone,target)),
      independentlyTransport(applyMatrix(authored,sample),authorBone,target), 'Ajuste deve acompanhar o osso em qualquer pose')
    poseAdjustmentCases++
  }
  const moved=moveWardrobeAdjustment(fit,target,{x:5,y:-3})
  const before=applyMatrix(posed,centerOf(target)),after=applyMatrix(wardrobeAdjustmentMatrix(moved,target,centerOf(target)),centerOf(target))
  closePoint({x:after.x-before.x,y:after.y-before.y},{x:5,y:-3},'Arraste/setas devem continuar na direção da tela')
  const edited=editWardrobeAdjustment(fit,target,{offsetX:fit.offsetX+5,offsetY:fit.offsetY-3,scaleX:undefined})
  assert.equal(edited.scaleX,fit.scaleX)
  closePoint({x:edited.offsetX,y:edited.offsetY},{x:moved.offsetX,y:moved.offsetY},'Controle de ajuste deve usar a mesma conversão do arraste')
}
assert.equal(JSON.stringify(legacyFit),legacyBefore,'Conversão não pode alterar os dados antigos em memória')
const roundTrip=JSON.parse(JSON.stringify(fit))
assert.deepEqual(wardrobeAdjustmentMatrix(roundTrip,authorBone,centerOf(authorBone)),wardrobeAdjustmentMatrix(fit,authorBone,centerOf(authorBone)),
  'Referência de ajuste precisa sobreviver ao salvamento JSON')
assert.equal(validWardrobeAdjustmentReference({...fit.adjustmentReference,width:0}),false)
assert.equal(validWardrobeAdjustmentReference({...fit.adjustmentReference,rotation:NaN}),false)

// Legacy whole-category pivot must be rebased when splitting into components.
const otherBone={...authorBone,id:'leg-left',x:310,y:420,width:95,height:180,rotation:-20}
const grouped={...legacyFit,componentId:undefined}
const split=anchorWardrobeAdjustments([grouped],1,[authorBone,otherBone],()=>[thigh,calf])
assert.equal(split.length,2)
const commonCenter={x:(centerOf(authorBone).x+centerOf(otherBone).x)/2,y:(centerOf(authorBone).y+centerOf(otherBone).y)/2}
const commonMatrix=wardrobeAdjustmentMatrix(grouped,undefined,commonCenter)
for(const item of split){
  const b=item.componentId===thigh.id?authorBone:otherBone
  for(const sample of [centerOf(b),{x:b.x,y:b.y}])closePoint(applyMatrix(wardrobeAdjustmentMatrix(item,b,centerOf(b)),sample),
    applyMatrix(commonMatrix,sample),'Separar grupo antigo não pode mudar o pivô visual')
}
assert.deepEqual(anchorWardrobeAdjustments([grouped],1,[authorBone],()=>[thigh,calf]),[grouped],
  'Assets ainda indisponíveis não podem causar perda de componentes na conversão')

// Old separated-sheet sets open on the original sheet using frozen bone
// ratios, rather than requiring the model to retain ten hardcoded rectangles.
const separatedBone=bone('leg-left','Canela esquerda',346,960,156,431)
const separatedShoe={...comp('old-shoe','sapato','leg-left',380,1300,58,34),rotation:12,
  originX:378,originY:1298,originWidth:55,originHeight:32}
separatedShoe.binding=bindWardrobeComponent(separatedShoe,separatedBone)
const oldOutfit={schemaVersion:1,edition:2,id:'old-outfit',modelSlot:1,modelName:'Fixture',name:'Old outfit',
  width:1122,height:1402,components:[separatedShoe],updatedAt:'2026-01-01'}
const oldOutfitBefore=JSON.stringify(oldOutfit),modelBeforeRebase=JSON.stringify(source)
const originalOutfit=rebaseWardrobeSetToOriginalSheet(oldOutfit,source)
assert.equal(originalOutfit.edition,1)
assert.equal(originalOutfit.id,oldOutfit.id)
assert.equal(originalOutfit.components[0].id,separatedShoe.id)
assert.equal(originalOutfit.components[0].dataUrl,separatedShoe.dataUrl)
assert.equal(originalOutfit.width,source.width)
assert.notEqual(originalOutfit.components[0].y,separatedShoe.y)
for(const rotation of [0,35,90,-80]) {
  const posedBone={...source.parts[2],x:470,y:220,width:185,height:265,rotation}
  const before=mapWardrobeComponentToPose(separatedShoe,separatedBone,posedBone)
  const after=mapWardrobeComponentToPose(originalOutfit.components[0],source.parts[2],posedBone)
  for(const key of ['localLeft','localTop','renderWidth','renderHeight','localRotation'])
    assert.ok(Math.abs(before[key]-after[key])<1e-8,`Converter folha não pode mudar ${key} na pose ${rotation}`)
  assert.deepEqual(before.origin,after.origin)
  assert.equal(before.matrix,after.matrix)
  const restoreOrigin=(piece,body)=>{
    const restored={...piece,x:piece.originX,y:piece.originY,width:piece.originWidth,height:piece.originHeight,rotation:0}
    restored.binding=bindWardrobeComponent(restored,body)
    return mapWardrobeComponentToPose(restored,body,posedBone)
  }
  const originalReset=restoreOrigin(separatedShoe,separatedBone),convertedReset=restoreOrigin(originalOutfit.components[0],source.parts[2])
  for(const key of ['localLeft','localTop','renderWidth','renderHeight','localRotation'])
    assert.ok(Math.abs(originalReset[key]-convertedReset[key])<1e-8,`Restaurar origem deve preservar ${key} após conversão`)
}
assert.equal(JSON.stringify(oldOutfit),oldOutfitBefore,'Abertura/conversão não modifica o conjunto original em memória')
assert.equal(JSON.stringify(source),modelBeforeRebase,'Conversão de roupa não pode alterar o corpo')
assert.equal(rebaseWardrobeSetToOriginalSheet(originalOutfit,source),originalOutfit,'Conversão deve ser idempotente')
const missingBinding={...separatedShoe,binding:undefined}
assert.equal(rebaseWardrobeSetToOriginalSheet({...oldOutfit,components:[missingBinding]},source).components[0],missingBinding,
  'Não adivinhar encaixes antigos quando não existe vínculo salvo')

const withFeet={...source,parts:[...source.parts,bone('foot-left','Pé esquerdo',250,910,60,50)]}
assert.equal(suggestWardrobeBone('sapato',250,1000,withFeet).bone?.id,'leg-left',
  'Sapato acompanha canela mesmo quando existe um pé separado mais próximo')
const withHands={...source,parts:[...source.parts,bone('forearm-left','Antebraço esquerdo',170,400,80,300),
  bone('hand-left','Mão esquerda',180,460,60,60)]}
assert.equal(suggestWardrobeBone('luvas',220,1000,withHands).bone?.id,'forearm-left',
  'Luvas acompanham antebraço, incluindo a mão, não uma peça de mão separada')
assert.equal(suggestWardrobeBone('luvas',220,1000,{...withHands,parts:withHands.parts.filter(p=>p.id!=='forearm-left')}).bone,null,
  'Sem antebraço correspondente, pedir seleção manual em vez de usar outro osso')
console.log(`Asset flow checks passed: binding, immutable overrides, split-slot knee coverage, ${poseAdjustmentCases} cross-pose adjustment cases, original-sheet conversion and combined shoe/glove bones.`)
