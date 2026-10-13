type Character = { hair: string; outfit: string; skin: string }

export function CharacterPreview({ character }: { character: Character }) {
  return (
    <svg className="character-illustration" viewBox="0 0 360 560" role="img" aria-label="Ilustração de preview da personagem">
      <defs>
        <linearGradient id="hair-shine" x1="85" y1="86" x2="255" y2="287" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff1ce" />
          <stop offset=".48" stopColor={character.hair} />
          <stop offset="1" stopColor="#99704d" />
        </linearGradient>
        <linearGradient id="jacket" x1="94" y1="274" x2="254" y2="445" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff0a6" />
          <stop offset="1" stopColor={character.outfit} />
        </linearGradient>
        <linearGradient id="pants" x1="120" y1="400" x2="242" y2="543" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" />
          <stop offset="1" stopColor="#e5e7ed" />
        </linearGradient>
      </defs>
      <ellipse cx="182" cy="538" rx="91" ry="13" fill="#332735" opacity=".12" />
      <path d="M104 114c-24 45-31 119-7 163 10 18 28 25 38 12 13-17 7-75 1-99 25 23 73 31 106 5 26-21 36-67 12-103-28-42-116-34-150 22Z" fill="url(#hair-shine)" stroke="#533f3d" strokeWidth="5" strokeLinejoin="round" />
      <path d="M131 82c20-29 59-44 91-21 31 22 40 62 26 99-8 20-17 29-27 39-26-16-45-49-58-91-12 31-37 52-72 55 0-32 12-59 40-81Z" fill="url(#hair-shine)" stroke="#533f3d" strokeWidth="5" strokeLinejoin="round" />
      <path d="M133 92c9-32 34-50 62-45 22 4 36 19 43 38-14-8-28-9-43-6-20-11-41-6-62 13Z" fill="#fff6d9" stroke="#533f3d" strokeWidth="4" strokeLinejoin="round" />
      <path d="M145 99c3-17 16-29 34-31 20-2 34 7 43 22-16-7-34-3-48 8-12-3-21-2-29 1Z" fill="#fff" stroke="#533f3d" strokeWidth="4" />
      <path d="M139 144c5-31 31-48 58-48 33 0 57 24 57 59v43c0 48-30 77-69 77-41 0-66-31-66-73v-26c0-14 8-24 20-32Z" fill={character.skin} stroke="#533f3d" strokeWidth="5" />
      <path d="M144 163c12-4 22 0 29 9m43-1c8-8 18-10 28-7" stroke="#5e4a4e" strokeWidth="6" strokeLinecap="round" />
      <path d="M151 175c3-11 13-15 22-8 8 7 5 21-4 24-10 3-21-5-18-16Zm61-1c4-10 15-14 22-6 7 8 3 21-7 23-10 1-19-8-15-17Z" fill="#fff" stroke="#47383a" strokeWidth="3" />
      <ellipse cx="164" cy="181" rx="6" ry="9" fill="#5e7eaa" /><ellipse cx="222" cy="180" rx="6" ry="9" fill="#5e7eaa" />
      <path d="M191 179c-2 9-5 19-3 22 2 3 6 3 10 1" stroke="#d49a8c" strokeWidth="3" strokeLinecap="round" />
      <path d="M178 218c8 6 19 6 27 0" stroke="#b96f78" strokeWidth="4" strokeLinecap="round" />
      <path d="M141 200c-9-16-21-21-31-14-10 7-7 22 8 27 10 3 18-1 23-13Zm116 0c10-16 22-21 32-14 10 7 7 22-8 27-10 3-18-1-24-13Z" fill="#d98c9b" stroke="#533f3d" strokeWidth="4" />
      <path d="M169 251v28c13 12 33 12 46 0v-29" fill={character.skin} stroke="#533f3d" strokeWidth="4" />
      <path d="m139 274 36 10 18 0 37-10 28 24-19 126H111l-12-125 40-25Z" fill="url(#jacket)" stroke="#382e35" strokeWidth="6" strokeLinejoin="round" />
      <path d="m175 283 18 0 15 26-23 28-25-28 15-26Z" fill="#fff" stroke="#382e35" strokeWidth="4" strokeLinejoin="round" />
      <path d="m139 274-23 15-11 86 35 5 11-78-12-28Zm91 0 25 14 14 88-34 7-13-81 8-28Z" fill="url(#jacket)" stroke="#382e35" strokeWidth="6" strokeLinejoin="round" />
      <path d="m111 373 29 6-4 37-31-3 6-40Zm131 4 30-5 7 41-31 4-6-40Z" fill="#e8cbb6" stroke="#382e35" strokeWidth="5" />
      <path d="M128 418h111l15 88c2 12-5 18-17 18h-30l-16-70-15 70h-31c-12 0-19-7-17-19l0-87Z" fill="url(#pants)" stroke="#45434e" strokeWidth="6" strokeLinejoin="round" />
      <path d="M184 430c-8 34-11 65-8 94m39-96c6 26 14 52 22 75" stroke="#bec2cd" strokeWidth="4" strokeLinecap="round" />
      <path d="M149 522h43l-1 18h-47c-7 0-11-4-10-9l15-9Zm57 0h36l17 11c4 4 1 8-5 8h-46l-2-19Z" fill="#f4e6d6" stroke="#48414a" strokeWidth="5" strokeLinejoin="round" />
      <path d="m186 311 6 8 6-8m-6 8v7" stroke="#e4a5ae" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
