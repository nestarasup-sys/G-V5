import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { FRAMES, WIDTH, HEIGHT } from './dev-ai/asset-flow-raster-fixture.cjs'

const original = await readFile(new URL('../src/renderer/src/features/fabricator/wardrobe/wardrobeV2Reference.ts', import.meta.url), 'utf8')
// The inline Vite PNG is irrelevant to the pure compatibility decision.
const source = original.replace("import sourceUrl from './wardrobe-reference-v2.png?inline'",
  "const sourceUrl = 'synthetic-v2-reference'")
assert.notEqual(source, original, 'Vite asset import location changed; fixture shim must be audited')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText
const { supportsWardrobeV2 } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const model = (frames) => ({
  width: WIDTH, height: HEIGHT, parts: frames.map((f, index) => ({
    id:f.id, name:f.name, x:0,y:0,width:f.width,height:f.height,rotation:0,
    sourceTransform:{ x:f.x,y:f.y,width:f.width,height:f.height,rotation:0 }
  }))
})
const exact = model(FRAMES)
assert.equal(supportsWardrobeV2(exact), true, 'All ten v2 parts should match')
assert.equal(supportsWardrobeV2({ ...exact, width: WIDTH - 1 }), false)
assert.equal(supportsWardrobeV2({ ...exact, height: HEIGHT + 1 }), false)
assert.equal(supportsWardrobeV2({ ...exact, parts: exact.parts.slice(0,9) }), false)
for(let index=0;index<FRAMES.length;index++){
  const moved = structuredClone(exact)
  moved.parts[index].sourceTransform.x += 100
  assert.equal(supportsWardrobeV2(moved), false,
    `A troca do partId no índice ${index} da folha não pode passar silenciosamente`)
}
for(const pair of [[0,1],[3,4],[6,7],[8,9]]){
  const reordered=structuredClone(exact)
  const [a,b]=pair
  ;[reordered.parts[a],reordered.parts[b]]=[reordered.parts[b],reordered.parts[a]]
  assert.equal(supportsWardrobeV2(reordered),false,
    `A imagem de roupa deve ser rejeitada após reordenar ossos ${a} e ${b}`)
}
const jitter=structuredClone(exact)
jitter.parts[9].sourceTransform.x += 10
assert.equal(supportsWardrobeV2(jitter),true,'Small chroma margins remain compatible')
const absent=structuredClone(exact)
delete absent.parts[8].sourceTransform
assert.equal(supportsWardrobeV2(absent),false)
console.log('Wardrobe V2 compatibility passed: 10/10 origins, source dimensions, shuffled feet and missing references.')
