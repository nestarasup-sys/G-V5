import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

export type RoteiroExportCharacter = { id: string; name: string }
export type RoteiroExportStart = { id: string; title: string; characters: RoteiroExportCharacter[] }
export type RoteiroExportAsset = { characterId: string; pose: number; expression: string; role: 'base' | 'blink' | 'talk' | 'pt' | 'pt-blink' | 'pt-talk'; dataUrl: string }

type ExportJob = {
  id: string
  projectFolder: string
  stageFolder: string
  roteiro: RoteiroExportStart
  namesById: Map<string, { characterName: string; folderName: string }>
  files: Set<string>
  expressions: Map<string, Set<string>>
  poses: Map<string, Set<number>>
}

const V4_PROJECTS_ROOT = 'C:\\TRABALHO 2\\EDITOR V4\\EDITOR V4\\projects'

function safeSegment(value: string, fallback: string): string {
  const cleaned = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9 _-]/g, '-').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72) || fallback
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned) ? `${cleaned}-item` : cleaned
}

function safeDisplayName(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100 || /[\x00-\x1f]/.test(value)) throw new Error(`${label} inválido.`)
  return value.trim()
}

function samePath(left: string, right: string): boolean { return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right }

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
}

async function assertSafePath(root: string, target: string, includeLeaf = true): Promise<void> {
  const rel = relative(root, target)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || resolve(root, rel) !== target) throw new Error('Caminho fora da pasta do projeto.')
  const segments = rel.split(sep)
  const count = includeLeaf ? segments.length : segments.length - 1
  let current = root
  for (let index = 0; index < count; index += 1) {
    current = join(current, segments[index])
    if (!await exists(current)) continue
    const info = await lstat(current)
    if (info.isSymbolicLink() || index < count - 1 && !info.isDirectory()) throw new Error('A exportação encontrou um caminho não seguro dentro do projeto.')
  }
}

async function walkFiles(root: string, dir = root): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name)
    if (entry.isSymbolicLink()) throw new Error('A exportação encontrou um link simbólico e foi interrompida por segurança.')
    if (entry.isDirectory()) return walkFiles(root, path)
    return [path]
  }))
  return nested.flat()
}

export class RoteiroCharacterExportStore {
  private readonly jobs = new Map<string, ExportJob>()
  constructor(private readonly tempRoot: string, private readonly projectsRoot = V4_PROJECTS_ROOT) {}

  async start(input: unknown): Promise<{ jobId: string; folderName: string; assetCountLimit: number }> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Dados do roteiro inválidos para exportação.')
    const value = input as Partial<RoteiroExportStart>
    if (typeof value.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)) throw new Error('ID do roteiro inválido.')
    const title = safeDisplayName(value.title, 'Nome do roteiro')
    if (!Array.isArray(value.characters) || !value.characters.length || value.characters.length > 100) throw new Error('Selecione ao menos um personagem para exportar.')
    const characters = value.characters.map((item) => {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(item.id)) throw new Error('Um personagem do elenco tem ID inválido.')
      return { id: item.id, name: safeDisplayName(item.name, 'Nome de personagem') }
    })
    if (new Set(characters.map((character) => character.id)).size !== characters.length) throw new Error('O elenco contém personagens duplicados.')
    if (new Set(characters.map((character) => character.name.toLocaleLowerCase('pt-BR'))).size !== characters.length) throw new Error('Os nomes dos personagens precisam ser diferentes para o Editor V4.')
    const root = resolve(this.projectsRoot)
    const rootInfo = await lstat(root).catch(() => null)
    if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink() || !samePath(await realpath(root), root)) throw new Error(`A pasta de projetos do Editor V4 não está disponível em ${root}.`)
    const folderName = safeSegment(title, `roteiro-${value.id.slice(0, 8)}`)
    const targetFolder = resolve(root, folderName)
    if (dirname(targetFolder) !== root) throw new Error('Nome de pasta do roteiro inválido.')
    if (await exists(targetFolder)) {
      const targetInfo = await lstat(targetFolder)
      if (!targetInfo.isDirectory() || targetInfo.isSymbolicLink() || !samePath(await realpath(targetFolder), targetFolder)) throw new Error('A pasta existente do roteiro não é um diretório seguro.')
    }
    const jobId = randomUUID()
    const stageFolder = resolve(this.tempRoot, jobId)
    await mkdir(this.tempRoot, { recursive: true })
    await mkdir(stageFolder, { recursive: false })
    const usedFolders = new Set<string>()
    const namesById = new Map<string, { characterName: string; folderName: string }>()
    for (const character of characters) {
      const base = safeSegment(character.name, 'personagem')
      let folder = base
      if (usedFolders.has(folder.toLowerCase())) folder = `${base}-${character.id.slice(0, 8)}`
      usedFolders.add(folder.toLowerCase())
      namesById.set(character.id, { characterName: character.name, folderName: folder })
    }
    this.jobs.set(jobId, { id: value.id, projectFolder: targetFolder, stageFolder, roteiro: { id: value.id, title, characters }, namesById, files: new Set(), expressions: new Map(), poses: new Map() })
    return { jobId, folderName, assetCountLimit: 20000 }
  }

  async writeAsset(jobId: string, input: unknown): Promise<void> {
    const job = this.jobs.get(jobId)
    if (!job) throw new Error('Exportação de personagens expirada ou inexistente.')
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Asset de personagem inválido.')
    const value = input as Partial<RoteiroExportAsset>
    const character = typeof value.characterId === 'string' ? job.namesById.get(value.characterId) : undefined
    if (!character || !Number.isInteger(value.pose) || value.pose! < 1 || value.pose! > 100 || !['base', 'blink', 'talk', 'pt', 'pt-blink', 'pt-talk'].includes(value.role ?? '')) throw new Error('Referência de asset inválida.')
    const expression = safeSegment(safeDisplayName(value.expression, 'Expressão'), 'expressao').toLowerCase()
    if (typeof value.dataUrl !== 'string' || value.dataUrl.length > 36 * 1024 * 1024) throw new Error('Imagem de personagem excede o limite de exportação.')
    const match = /^data:image\/png;base64,([a-z0-9+/=]+)$/i.exec(value.dataUrl)
    if (!match) throw new Error('A exportação aceita somente imagens PNG renderizadas pelo aplicativo.')
    const bytes = Buffer.from(match[1], 'base64')
    if (bytes.length < 24 || bytes.length > 24 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('O PNG exportado está vazio, inválido ou acima do limite.')
    const isPupilsLeft = value.role === 'pt' || value.role === 'pt-blink' || value.role === 'pt-talk'
    const visualRole = value.role === 'pt' ? 'base' : value.role === 'pt-blink' ? 'blink' : value.role === 'pt-talk' ? 'talk' : value.role!
    const roleSuffix = visualRole === 'base' ? '' : `_${visualRole}`
    const filenameExpression = isPupilsLeft ? `pt-${expression}` : expression
    const relativeFile = join('assets', 'characters', character.folderName, `POSE ${value.pose}`, `${filenameExpression}${roleSuffix}.png`)
    if (job.files.has(relativeFile)) throw new Error(`A expressão ${expression} foi gerada mais de uma vez para ${character.characterName}, POSE ${value.pose}.`)
    const target = resolve(job.stageFolder, relativeFile)
    if (!target.startsWith(`${job.stageFolder}${sep}`)) throw new Error('Destino de imagem fora da pasta temporária da exportação.')
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, bytes, { flag: 'wx' })
    job.files.add(relativeFile)
    const expressionSet = job.expressions.get(character.characterName) ?? new Set<string>()
    expressionSet.add(expression)
    job.expressions.set(character.characterName, expressionSet)
    const poseSet = job.poses.get(character.characterName) ?? new Set<number>()
    poseSet.add(value.pose!)
    job.poses.set(character.characterName, poseSet)
  }

  async finish(jobId: string): Promise<{ folderName: string; path: string; characters: number; files: number }> {
    const job = this.jobs.get(jobId)
    if (!job) throw new Error('Exportação de personagens expirada ou inexistente.')
    if (!job.files.size || job.roteiro.characters.some((character) => !job.expressions.get(character.name)?.size || !job.poses.get(character.name)?.size)) throw new Error('A exportação ficou incompleta; não publiquei a pasta do projeto.')
    const characters: Record<string, unknown> = {}
    const initialState: Record<string, unknown> = {}
    for (const character of job.roteiro.characters) {
      const mapping = job.namesById.get(character.id)!
      const poses = [...(job.poses.get(character.name) ?? [])].sort((a, b) => a - b)
      const expressions = [...(job.expressions.get(character.name) ?? [])].sort((a, b) => a.localeCompare(b))
      const poseNameByIndex = new Map(poses.map((_, index) => [poses[index], `POSE ${index + 1}`]))
      const poseNames = poses.map((pose) => poseNameByIndex.get(pose)!)
      const defaultExpression = expressions.includes('normal') ? 'normal' : expressions[0]
      characters[character.name] = {
        asset_dir: `assets/characters/${mapping.folderName}`,
        default_pose: poseNames[0],
        default_expression: defaultExpression,
        default_variant: 'v1',
        poses: Object.fromEntries(poseNames.map((name) => [name, {}]))
      }
      initialState[character.name] = { pose: poseNames[0], expression: defaultExpression, variant: 'v1', visible: true,
        transform: { x: 960, y: 540, scale: 1, rotation: 0, layer: 10, flipX: false, anchorX: .5, anchorY: .5, opacity: 1 } }
      // Preserve source pose slot numbers in the folder names written above.
      for (const pose of poses) {
        const actualName = `POSE ${pose}`
        const actualFolder = join(job.stageFolder, 'assets', 'characters', mapping.folderName, actualName)
        const canonicalName = poseNameByIndex.get(pose)!
        if (actualName !== canonicalName && await exists(actualFolder)) await rename(actualFolder, join(dirname(actualFolder), canonicalName))
      }
    }
    const projectFile = `${safeSegment(job.roteiro.title, 'roteiro')}.gacha.json`
    const projectPath = join(job.stageFolder, projectFile)
    const projectDocument = { schema_version: 3, project: { title: job.roteiro.title, resolution: [1920, 1080], fps: 30, background: '' }, characters, initial_state: initialState, timeline: [], timeline_tracks: [], timeline_tracks_version: 1 }
    const manifest = { app: 'NYMI_ROTEIRO_EXPORT_V1', scriptId: job.id, scriptTitle: job.roteiro.title, kind: 'text', editorTarget: 'v4', updatedAt: new Date().toISOString() }
    await writeFile(projectPath, `${JSON.stringify(projectDocument, null, 2)}\n`, { flag: 'wx' })
    await writeFile(join(job.stageFolder, '.nymi-script.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
    await mkdir(dirname(job.projectFolder), { recursive: true })

    if (!await exists(job.projectFolder)) {
      await rename(job.stageFolder, job.projectFolder)
    } else {
      await assertSafePath(dirname(job.projectFolder), job.projectFolder)
      const created: string[] = []
      const backups: Array<{ original: string; backup: string }> = []
      const replaced: string[] = []
      try {
        const currentProjectPath = join(job.projectFolder, projectFile)
        await assertSafePath(job.projectFolder, currentProjectPath)
        let mergedProject = projectDocument
        if (await exists(currentProjectPath)) {
          const existing = JSON.parse(await readFile(currentProjectPath, 'utf8')) as Record<string, any>
          if (!existing || typeof existing !== 'object' || !existing.characters || typeof existing.characters !== 'object' || Array.isArray(existing.characters)) throw new Error('O arquivo de projeto existente não tem uma estrutura compatível; preservei a pasta sem alteração.')
          mergedProject = { ...existing, characters: { ...existing.characters, ...characters }, initial_state: { ...(existing.initial_state ?? {}), ...initialState } } as typeof projectDocument
        }
        const files = await walkFiles(job.stageFolder)
        const stagedRelativePaths = new Set(files.map((file) => file.slice(job.stageFolder.length + 1)))
        const exportedCharacterRoots = [...job.namesById.values()].map(({ folderName }) => join('assets', 'characters', folderName))
        // Remove stale expressions and poses for characters in this export, while leaving
        // every other character and project asset untouched.
        for (const relativeRoot of exportedCharacterRoots) {
          const rootPath = resolve(job.projectFolder, relativeRoot)
          await assertSafePath(job.projectFolder, rootPath)
          if (!await exists(rootPath)) continue
          for (const oldFile of await walkFiles(rootPath)) {
            const rel = oldFile.slice(job.projectFolder.length + 1)
            if (stagedRelativePaths.has(rel)) continue
            const backup = `${oldFile}.${job.id}.bak`
            await rename(oldFile, backup)
            backups.push({ original: oldFile, backup })
          }
        }
        for (const stagedFile of files) {
          const rel = stagedFile.slice(job.stageFolder.length + 1)
          const destination = resolve(job.projectFolder, rel)
          if (!destination.startsWith(`${job.projectFolder}${sep}`)) throw new Error('Arquivo de exportação fora do projeto.')
          await assertSafePath(job.projectFolder, destination)
          if (rel === projectFile) continue
          if (await exists(destination)) {
            const backup = `${destination}.${job.id}.bak`
            await rename(destination, backup)
            backups.push({ original: destination, backup })
          }
          await mkdir(dirname(destination), { recursive: true })
          const temp = `${destination}.${job.id}.tmp`
          await writeFile(temp, await readFile(stagedFile), { flag: 'wx' })
          await rename(temp, destination)
          replaced.push(destination)
          if (!backups.some(({ original }) => original === destination)) created.push(destination)
        }
        if (!await exists(join(job.projectFolder, '.nymi-script.json'))) {
          const stagedManifest = await readFile(join(job.stageFolder, '.nymi-script.json'))
          const destManifest = join(job.projectFolder, '.nymi-script.json')
          await assertSafePath(job.projectFolder, destManifest)
          await writeFile(destManifest, stagedManifest, { flag: 'wx' }); created.push(destManifest)
        }
        const serialized = `${JSON.stringify(mergedProject, null, 2)}\n`
        const projectTemp = `${currentProjectPath}.${job.id}.tmp`
        await writeFile(projectTemp, serialized, { flag: 'wx' })
        if (await exists(currentProjectPath)) {
          const backup = `${currentProjectPath}.${job.id}.bak`
          await rename(currentProjectPath, backup)
          backups.push({ original: currentProjectPath, backup })
          await rename(projectTemp, currentProjectPath)
        } else {
          await rename(projectTemp, currentProjectPath); created.push(currentProjectPath)
        }
        // The new project is now complete; discard rollback copies only after every
        // replacement has succeeded.
        await Promise.allSettled(backups.map(({ backup }) => rm(backup, { force: true })))
      } catch (error) {
        for (const path of [...created, ...replaced].reverse()) await rm(path, { force: true }).catch(() => undefined)
        for (const { original, backup } of backups.reverse()) if (await exists(backup)) await rename(backup, original).catch(() => undefined)
        throw error
      }
      await rm(job.stageFolder, { recursive: true, force: true })
    }
    this.jobs.delete(jobId)
    return { folderName: basename(job.projectFolder), path: job.projectFolder, characters: job.roteiro.characters.length, files: job.files.size }
  }

  async cancel(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId)
    if (!job) return
    this.jobs.delete(jobId)
    await rm(job.stageFolder, { recursive: true, force: true })
  }
}
