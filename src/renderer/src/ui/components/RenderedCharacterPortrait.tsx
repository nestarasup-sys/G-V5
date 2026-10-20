import { useEffect, useState } from 'react'
import type { CustomizerCharacter } from '../../../../shared/customizer'
import { CharacterPortrait } from './CharacterPortrait'

const portraitCache = new Map<string, Promise<string | null>>()

export function RenderedCharacterPortrait({ character, className = '' }: { character: CustomizerCharacter; className?: string }) {
  const [image, setImage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const key = `${character.id}:${character.updatedAt}`
    let rendered = portraitCache.get(key)
    if (!rendered) {
      rendered = import('../../features/customizer/CustomizerPage')
        .then(({ renderSavedCharacter }) => renderSavedCharacter(character))
        .then((result) => result.dataUrl)
        .catch(() => null)
      portraitCache.set(key, rendered)
      if (portraitCache.size > 32) portraitCache.delete(portraitCache.keys().next().value!)
    }
    void rendered.then((dataUrl) => { if (!cancelled) setImage(dataUrl) })
    return () => { cancelled = true }
  }, [character])

  return image
    ? <span className={`rendered-character-headshot ${className}`}><img src={image} alt={character.name} /></span>
    : <span className={`rendered-character-headshot rendered-character-headshot-fallback ${className}`} aria-label={`Carregando imagem de ${character.name}`}><CharacterPortrait character={character} /></span>
}
