type Character = { name: string; hair: string; outfit: string; skin: string }

export function CharacterPortrait({ character }: { character: Character }) {
  return (
    <span className="portrait-art" style={{ '--hair': character.hair, '--outfit': character.outfit, '--skin': character.skin } as React.CSSProperties}>
      <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <path d="M12 28c0-14 8-23 20-23s20 9 20 23v8H12v-8Z" fill="var(--hair)" />
        <path d="M17 27c0-9 6-15 15-15s15 6 15 15v10c0 10-7 16-15 16s-15-6-15-16V27Z" fill="var(--skin)" />
        <path d="M14 31c1-13 7-21 18-21 10 0 16 7 18 20l-7-8-6 5-5-7-8 8-5-3-5 6Z" fill="var(--hair)" />
        <path d="M24 35h.1M40 35h.1" stroke="#27232B" strokeWidth="3.2" strokeLinecap="round" />
        <path d="M28 43c2 2 6 2 8 0" stroke="#C77782" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M18 57c2-7 7-10 14-10s12 3 14 10" fill="var(--outfit)" />
      </svg>
      <span className="portrait-initial">{character.name.slice(0, 1)}</span>
    </span>
  )
}
