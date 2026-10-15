#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const defaultPath = resolve(process.env.APPDATA ?? '', 'gacha-nymi-work-app/fabricator/models/slot-1/project.json')
const suppliedPath = process.argv[2]
if (process.argv.includes('--help')) {
  console.log('Uso: node scripts/audit-animator-rig.mjs [caminho/para/project.json]')
  console.log('Lê o projeto sem gravar alterações; sem caminho, audita o slot 1 do Fabricador Dev.')
  process.exit(0)
}

const path = suppliedPath ? resolve(suppliedPath) : defaultPath
const project = JSON.parse(await readFile(path, 'utf8'))
const clean = (value) => value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
const center = (part) => ({ x: part.x + part.width / 2, y: part.y + part.height / 2 })
const torso = project.parts.find((part) => /tronco|corpo|torso/.test(clean(part.name)))
if (!torso) throw new Error('Não encontrei o tronco/corpo no projeto.')

const depth = new Map([[torso.id, 0]])
const queue = [torso.id]
while (queue.length) {
  const parentId = queue.shift()
  for (const joint of project.joints ?? []) {
    if (joint.parentPartId === parentId && !depth.has(joint.childPartId)) {
      depth.set(joint.childPartId, (depth.get(parentId) ?? 0) + 1)
      queue.push(joint.childPartId)
    }
  }
}

const roles = [
  ['Coxa / perna superior', (name, d) => /coxa|thigh|upper.?leg|perna.?superior/.test(name) || (/perna|leg/.test(name) && d === 1)],
  ['Canela / perna inferior', (name, d) => /canela|panturrilha|calf|lower.?leg|perna.?inferior/.test(name) || (/perna|leg/.test(name) && d >= 2)],
  ['Braço superior', (name, d) => /braco|arm|manga/.test(name) && !/antebraco|forearm|lower.?arm/.test(name) && (/(superior|upper)/.test(name) || d === 1)],
  ['Antebraço', (name, d) => /antebraco|forearm|lower.?arm/.test(name) || (/braco|arm|manga/.test(name) && d >= 2)]
]
const torsoCenter = center(torso)
console.log(`Projeto: ${project.name ?? path} (${project.parts.length} peças, ${project.joints?.length ?? 0} juntas)`)
console.log(`Tronco: ${torso.name} · ${torso.id}`)

for (const [label, matches] of roles) {
  const found = { esquerda: null, direita: null }
  for (const part of project.parts) {
    if (part.id === torso.id) continue
    const name = clean(part.name)
    const d = depth.get(part.id) ?? -1
    if (!matches(name, d)) continue
    const point = center(part)
    const side = point.x < torsoCenter.x ? 'esquerda' : 'direita'
    if (!found[side] || d > found[side].depth) found[side] = { part, depth: d }
  }
  console.log(`\n${label}`)
  for (const side of ['esquerda', 'direita']) {
    const item = found[side]
    if (!item) { console.log(`  ${side}: AUSENTE`); continue }
    const { part } = item
    const incoming = project.joints.find((joint) => joint.childPartId === part.id)
    const outgoing = project.joints.filter((joint) => joint.parentPartId === part.id)
    const anchor = part.jointAnchor ?? (incoming ? incoming.childAnchor : null)
    const pivot = incoming?.pivot ?? (incoming ? { x: (incoming.parentAnchor.x + incoming.childAnchor.x) / 2, y: (incoming.parentAnchor.y + incoming.childAnchor.y) / 2 } : null)
    const delta = anchor && pivot ? Math.hypot(anchor.x - pivot.x, anchor.y - pivot.y) : null
    console.log(`  ${side}: ${part.name} · profundidade ${item.depth} · ${part.id}`)
    console.log(`    junta pai: ${incoming ? project.parts.find((entry) => entry.id === incoming.parentPartId)?.name ?? incoming.parentPartId : 'sem junta de entrada'} · filhos: ${outgoing.length}`)
    console.log(`    âncora da peça: ${anchor ? `${anchor.x.toFixed(1)}, ${anchor.y.toFixed(1)}` : 'ausente'} · diferença do pivô antigo: ${delta === null ? 'n/a' : `${delta.toFixed(1)} px`}`)
  }
}
