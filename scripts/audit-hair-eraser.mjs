import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/renderer/src/features/fabricator/hairEraser.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const { hairErasePoint, eraseHairSegment } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
let cases = 0
for (const rotation of [0, 35, -90, 180]) for (const flip of [false, true]) for (const zoom of [.5, 1, 3]) {
  const image = { width: 818, height: 729 }, rendered = { width: 303 * zoom, height: 284 * zoom }, center = { x: 450, y: 310 }
  const expected = { x: 603, y: 217 }
  const dx = (expected.x - image.width / 2) * rendered.width / image.width * (flip ? -1 : 1)
  const dy = (expected.y - image.height / 2) * rendered.height / image.height
  const angle = rotation * Math.PI / 180
  const screen = { x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle) }
  const actual = hairErasePoint(screen, center, rendered, image, rotation, flip)
  assert.ok(Math.abs(actual.x - expected.x) < 1e-8 && Math.abs(actual.y - expected.y) < 1e-8)
  cases++
}
const stamps = []
const context = { globalCompositeOperation: 'source-over', fillStyle: '#fff', save() { this.before = this.globalCompositeOperation }, restore() { this.globalCompositeOperation = this.before }, beginPath() {}, ellipse(x, y, rx, ry) { assert.equal(this.globalCompositeOperation, 'destination-out'); stamps.push({ x, y, rx, ry }) }, fill() {} }
eraseHairSegment(context, { x: 10, y: 20 }, { x: 200, y: 300 }, 8, 12)
assert.deepEqual(stamps[0], { x: 10, y: 20, rx: 8, ry: 12 })
assert.deepEqual(stamps.at(-1), { x: 200, y: 300, rx: 8, ry: 12 })
assert.equal(context.globalCompositeOperation, 'source-over')
for (let i = 1; i < stamps.length; i++) assert.ok(Math.hypot((stamps[i].x - stamps[i - 1].x) / 8, (stamps[i].y - stamps[i - 1].y) / 12) <= 1 / 3 + 1e-8)
console.log(`Hair eraser checks passed: ${cases} geometry combinations, continuous strokes, and isolated alpha erasure.`)
