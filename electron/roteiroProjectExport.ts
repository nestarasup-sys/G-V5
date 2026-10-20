import { randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type { RoteiroDocument, RoteiroSectionContent, RoteiroVideoReference } from '../src/shared/roteiros'

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const rootDefault = 'C:\\TRABALHO 2\\EDITOR V4\\EDITOR V4\\projects'
type Manifest = { app: 'GACHA_V5_ROTEIRO_EXPORT'; scriptId: string; files: string[] }
const safeSegment = (value: string) => {
  const cleaned = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9 _-]/g, '-').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72) || 'roteiro'
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned) ? `${cleaned}-item` : cleaned
}
const sectionEntries = (roteiro: RoteiroDocument): Array<{ label: string; section: RoteiroSectionContent }> => [
  { label: 'Abertura', section: roteiro.opening ?? { video: null, blocks: [] } },
  ...roteiro.tiktoks.map((tiktok) => ({ label: tiktok.title, section: { video: tiktok.video ?? null, blocks: tiktok.blocks ?? [], description: tiktok.description, timeline: tiktok.timeline, sceneEndSeconds: tiktok.sceneEndSeconds, firstGroupReactionSeconds: tiktok.firstGroupReactionSeconds, secondGroupReactionSeconds: tiktok.secondGroupReactionSeconds } }))
]

export class RoteiroProjectExportStore {
  constructor(private readonly resolveBackground: (id: string) => Promise<string>, private readonly resolveVideo: (video: RoteiroVideoReference) => Promise<string>, private readonly projectsRoot = rootDefault) {}
  private async projectFolder(roteiro: RoteiroDocument) {
    const root = resolve(this.projectsRoot)
    const info = await lstat(root).catch(() => null)
    if (!info?.isDirectory() || info.isSymbolicLink() || resolve(root) !== root) throw new Error(`A pasta de projetos do Editor V4 não está disponível: ${root}`)
    const folder = resolve(root, safeSegment(roteiro.title))
    if (dirname(folder) !== root) throw new Error('Nome de pasta de roteiro inválido.')
    const existing = await lstat(folder).catch(() => null)
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('A pasta existente do projeto não é segura.')
    await mkdir(folder, { recursive: true })
    return folder
  }
  private async writeOwned(folder: string, scriptId: string, outputs: Array<{ path: string; bytes?: Buffer; sourcePath?: string; expectedSize?: number }>, scope: string) {
    const manifestPath = join(folder, '.gacha-v5-roteiro-exports.json')
    let manifest: Manifest = { app: 'GACHA_V5_ROTEIRO_EXPORT', scriptId, files: [] }
    try {
      const manifestInfo = await lstat(manifestPath)
      if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink()) throw new Error('O manifesto de exportação é um caminho não seguro.')
      const stored = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest
      if (stored.app !== manifest.app || stored.scriptId !== scriptId || !Array.isArray(stored.files) || !stored.files.every((item) => typeof item === 'string')) throw new Error('A pasta de exportação pertence a outro roteiro; nenhum arquivo foi alterado.')
      manifest = stored
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const prior = new Set(manifest.files)
    const nextFiles = new Set([...prior].filter((path) => !path.startsWith(scope)))
    const staged: Array<{ temporary: string; target: string }> = []
    const backups: Array<{ backup: string; target: string }> = []
    const installed: string[] = []
    try {
      for (const output of outputs) {
        const target = resolve(folder, output.path)
        const rel = relative(folder, target)
        if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || rel.includes(`..${sep}`)) throw new Error('Destino de exportação fora da pasta do roteiro.')
        let parent = folder
        for (const segment of dirname(rel).split(sep).filter(Boolean)) {
          parent = join(parent, segment)
          const parentInfo = await lstat(parent).catch(() => null)
          if (parentInfo && (!parentInfo.isDirectory() || parentInfo.isSymbolicLink())) throw new Error('O destino de exportação contém uma pasta não segura.')
        }
        const existing = await lstat(target).catch(() => null)
        if (existing && (!prior.has(output.path) || !existing.isFile() || existing.isSymbolicLink())) throw new Error(`O arquivo ${basename(target)} já existe e não pertence a uma exportação controlada do Gacha V5; foi preservado.`)
        await mkdir(dirname(target), { recursive: true })
        const temporary = `${target}.${randomUUID()}.tmp`
        if (output.sourcePath) await copyFile(output.sourcePath, temporary)
        else if (output.bytes) await writeFile(temporary, output.bytes, { flag: 'wx' })
        else throw new Error('Conteúdo vazio para exportação.')
        if (output.expectedSize !== undefined && (await stat(temporary)).size !== output.expectedSize) throw new Error(`O arquivo ${basename(target)} mudou durante a exportação.`)
        staged.push({ temporary, target }); nextFiles.add(output.path)
      }
      for (const item of staged) {
        if (await lstat(item.target).catch(() => null)) {
          const backup = `${item.target}.${randomUUID()}.bak`
          await rename(item.target, backup); backups.push({ backup, target: item.target })
        }
        await rename(item.temporary, item.target); installed.push(item.target)
      }
      const manifestTemp = `${manifestPath}.${randomUUID()}.tmp`
      await writeFile(manifestTemp, `${JSON.stringify({ app: manifest.app, scriptId, files: [...nextFiles].sort() }, null, 2)}\n`, { flag: 'wx' })
      await rename(manifestTemp, manifestPath)
      await Promise.allSettled(backups.map(({ backup }) => rm(backup, { force: true })))
    } catch (error) {
      await Promise.allSettled(installed.map((target) => rm(target, { force: true })))
      for (const { backup, target } of backups.reverse()) await rename(backup, target).catch(() => undefined)
      await Promise.allSettled(staged.map(({ temporary }) => rm(temporary, { force: true })))
      throw error
    }
    for (const stale of prior) if (!nextFiles.has(stale)) {
      const target = resolve(folder, stale)
      const rel = relative(folder, target)
      if (rel && rel !== '..' && !rel.startsWith(`..${sep}`)) await rm(target, { force: true }).catch(() => undefined)
    }
    return { folder, files: outputs.length }
  }
  async export(roteiro: RoteiroDocument, kind: 'background' | 'videos' | 'script') {
    if (!idPattern.test(roteiro.id)) throw new Error('ID do roteiro inválido.')
    const folder = await this.projectFolder(roteiro)
    const outputs: Array<{ path: string; bytes?: Buffer; sourcePath?: string; expectedSize?: number }> = []
    if (kind === 'background') {
      if (!roteiro.backgroundAssetId || !idPattern.test(roteiro.backgroundAssetId)) throw new Error('Selecione um fundo para este roteiro antes de exportar.')
      const source = await this.resolveBackground(roteiro.backgroundAssetId)
      const info = await stat(source)
      if (!info.size || info.size > 100 * 1024 ** 2) throw new Error('O arquivo do fundo está vazio ou excede 100 MB.')
      const extension = source.match(/\.(png|jpg|jpeg|webp)$/i)?.[1]?.toLowerCase() ?? 'png'
      outputs.push({ path: `assets/backgrounds/01.${extension}`, sourcePath: source, expectedSize: info.size })
    } else if (kind === 'videos') {
      const sections = sectionEntries(roteiro).filter(({ section }) => section.video)
      if (!sections.length) throw new Error('Este roteiro não tem vídeos para exportar.')
      for (const [index, { section }] of sections.entries()) {
        const reference = section.video!
        if (!idPattern.test(reference.id)) throw new Error('Uma referência de vídeo do roteiro é inválida.')
        const source = await this.resolveVideo(reference)
        const info = await stat(source)
        if (info.size !== reference.size || info.size > 5 * 1024 ** 3) throw new Error(`O arquivo “${reference.name}” não corresponde ao tamanho salvo no roteiro.`)
        outputs.push({ path: `assets/tiktoks/${String(index + 1).padStart(2, '0')}.${reference.extension}`, sourcePath: source, expectedSize: reference.size })
      }
    } else {
      const lines = [`ROTEIRO: ${roteiro.title}`, `VÍDEO: ${roteiro.videoTitle}`, `ELENCO: ${roteiro.characterIds.length} personagem(ns)`, '']
      for (const [index, { label, section }] of sectionEntries(roteiro).entries()) {
        lines.push(`${index === 0 ? 'ABERTURA' : `TIKTOK ${index}`}: ${label}`)
        lines.push(`Descrição: ${section.description?.trim() || '—'}`, `Linha do tempo: ${section.timeline ?? 'unspecified'}`)
        if (section.sceneEndSeconds !== undefined) lines.push(`Fim da cena da descrição: ${section.sceneEndSeconds}s`)
        if (section.firstGroupReactionSeconds !== undefined) lines.push(`Primeira reação em grupo: ${section.firstGroupReactionSeconds}s`)
        if (section.secondGroupReactionSeconds !== undefined) lines.push(`Segunda reação em grupo: ${section.secondGroupReactionSeconds}s`)
        for (const [blockIndex, block] of section.blocks.entries()) lines.push(`  ${blockIndex + 1}. ${block.kind.toUpperCase()} · ${block.characterId || 'sem personagem'}${block.expression ? ` · ${block.expression}` : ''}\n     PT: ${block.textPortuguese || '—'}\n     EN: ${block.textEnglish || '—'}`)
        if (section.video) lines.push(`Vídeo: ${section.video.name} (${section.video.id})`)
        lines.push('')
      }
      outputs.push({ path: 'roteiro.txt', bytes: Buffer.from(`${lines.join('\n').trim()}\n`, 'utf8') })
    }
    const result = await this.writeOwned(folder, roteiro.id, outputs, kind === 'background' ? 'assets/backgrounds/' : kind === 'videos' ? 'assets/tiktoks/' : 'roteiro.txt')
    return { path: result.folder, files: result.files }
  }
}
