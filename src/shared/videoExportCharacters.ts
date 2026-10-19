import type { CustomizerCharacter } from './customizer'
import type { StudioDocument } from './studio'
import { canonicalVideoExportJson } from './videoExportSnapshot'

export type VideoExportCharacterSnapshot = Readonly<{
  schemaVersion: 1
  characters: ReadonlyArray<CustomizerCharacter>
}>

function cloneCharacter(character: CustomizerCharacter): CustomizerCharacter {
  return structuredClone(character)
}

function validCharacter(character: CustomizerCharacter): boolean {
  return Boolean(character && typeof character === 'object'
    && typeof character.id === 'string' && character.id.length > 0
    && typeof character.name === 'string'
    && typeof character.updatedAt === 'string' && Number.isFinite(Date.parse(character.updatedAt))
    && character.customization && typeof character.customization === 'object')
}

/** Freeze the complete Customizer definitions required by character transition rendering. */
export function createVideoExportCharacterSnapshot(
  studio: Pick<StudioDocument, 'elements'>,
  availableCharacters: ReadonlyArray<CustomizerCharacter>,
): VideoExportCharacterSnapshot {
  const referencedIds = [...new Set(studio.elements
    .filter((element) => element.kind === 'character')
    .map((element) => element.characterId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0))].sort()
  const byId = new Map(availableCharacters.map((character) => [character.id, character]))
  if (byId.size !== availableCharacters.length) throw new Error('Biblioteca de personagens contém IDs duplicados.')
  const characters = referencedIds.map((id) => {
    const character = byId.get(id)
    if (!character || !validCharacter(character)) throw new Error(`Personagem ${id} do Video Studio não está disponível para o snapshot.`)
    return cloneCharacter(character)
  })
  return Object.freeze({ schemaVersion: 1 as const, characters: Object.freeze(characters) })
}

export function serializeVideoExportCharacterSnapshot(snapshot: VideoExportCharacterSnapshot): string {
  if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.characters)
    || snapshot.characters.some((character) => !validCharacter(character))
    || new Set(snapshot.characters.map((character) => character.id)).size !== snapshot.characters.length) {
    throw new Error('Snapshot de personagens inválido.')
  }
  return canonicalVideoExportJson({ schemaVersion: 1, characters: snapshot.characters })
}

export function parseVideoExportCharacterSnapshot(serialized: string): VideoExportCharacterSnapshot {
  let value: unknown
  try { value = JSON.parse(serialized) } catch { throw new Error('Snapshot de personagens está corrompido.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || (value as { schemaVersion?: unknown }).schemaVersion !== 1
    || !Array.isArray((value as { characters?: unknown }).characters)) {
    throw new Error('Versão incompatível do snapshot de personagens.')
  }
  const characters = (value as { characters: CustomizerCharacter[] }).characters
  if (characters.some((character) => !validCharacter(character))
    || new Set(characters.map((character) => character.id)).size !== characters.length) throw new Error('Snapshot de personagens inválido.')
  return Object.freeze({ schemaVersion: 1 as const, characters: Object.freeze(characters.map(cloneCharacter)) })
}

export function characterFromVideoExportSnapshot(snapshot: VideoExportCharacterSnapshot, characterId: string): CustomizerCharacter {
  const character = snapshot.characters.find((item) => item.id === characterId)
  if (!character) throw new Error(`Personagem ${characterId} não foi capturado no job de exportação.`)
  return cloneCharacter(character)
}
