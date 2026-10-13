import { useState } from 'react'
import { CharacterPreview } from './components/CharacterPreview'
import { CharacterPortrait } from './components/CharacterPortrait'
import { Icon, type IconName } from './components/Icon'
import { TopBar } from './components/TopBar'

const characters = [
  { name: 'Chloe', hair: '#cfaa78', outfit: '#f2d771', skin: '#f5d7c7' },
  { name: 'Miri', hair: '#7c7aa4', outfit: '#a8b7e8', skin: '#f2d6c5' },
  { name: 'Drystan', hair: '#c18b50', outfit: '#7194ad', skin: '#f1d4c3' },
  { name: 'Drogo', hair: '#c8cbd5', outfit: '#adb6c9', skin: '#f2d9cc' },
  { name: 'Loki', hair: '#282933', outfit: '#b898dd', skin: '#e8c5b5' },
  { name: 'Henry', hair: '#4b3335', outfit: '#d89593', skin: '#c58e78' },
  { name: 'Lauren', hair: '#d1c3a1', outfit: '#a8c5ba', skin: '#f0d3c0' },
  { name: 'Luka', hair: '#263f57', outfit: '#88adcc', skin: '#eccdbb' },
  { name: 'Marinette', hair: '#24527e', outfit: '#bc8bce', skin: '#f2d9c9' },
  { name: 'Ayla', hair: '#47354b', outfit: '#df9ab6', skin: '#d69d85' }
]

const modules: { name: string; icon: IconName; detail: string }[] = [
  { name: 'Presets', icon: 'sparkles', detail: 'Looks prontos para começar' },
  { name: 'Corpo', icon: 'body', detail: 'Pose, proporções e detalhes' },
  { name: 'Cabeça', icon: 'face', detail: 'Rosto, cabelo e expressões' },
  { name: 'Roupas', icon: 'shirt', detail: 'Monte um visual único' },
  { name: 'Acessórios', icon: 'flower', detail: 'Peças e objetos de cena' },
  { name: 'Diálogos', icon: 'message', detail: 'Balões e falas' },
  { name: 'Mascotes', icon: 'paw', detail: 'Seus companheiros' },
  { name: 'Objetos', icon: 'box', detail: 'Itens para compor a cena' },
  { name: 'Perfil', icon: 'user', detail: 'Identidade do personagem' }
]

const shortcuts: { name: string; icon: IconName }[] = [
  { name: 'Customizar', icon: 'bow' },
  { name: 'Estúdio', icon: 'camera' },
  { name: 'Mini jogos', icon: 'gamepad' },
  { name: 'Opções', icon: 'settings' }
]

export function App() {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [activeModule, setActiveModule] = useState<string | null>(null)
  const [activeShortcut, setActiveShortcut] = useState('Customizar')
  const [rosterQuery, setRosterQuery] = useState('')
  const [saved, setSaved] = useState(true)
  const selectedCharacter = characters[selectedIndex]
  const visibleCharacters = characters
    .map((character, index) => ({ character, index }))
    .filter(({ character }) => character.name.toLowerCase().includes(rosterQuery.trim().toLowerCase()))

  function selectCharacter(index: number) {
    setSelectedIndex((index + characters.length) % characters.length)
    setActiveModule(null)
  }

  return (
    <main className="app-shell">
      <TopBar saved={saved} onSave={() => setSaved(true)} />

      <div className="home-layout">
        <aside className="roster-panel panel" aria-label="Personagens">
          <div className="panel-heading roster-heading">
            <div>
              <p className="eyebrow">SUA COLEÇÃO</p>
              <h2>Personagens <span>{characters.length.toString().padStart(2, '0')}</span></h2>
            </div>
            <button className="icon-button add-button" aria-label="Adicionar personagem" onClick={() => setActiveModule('Novo personagem')}>
              <Icon name="plus" />
            </button>
          </div>
          <label className="roster-search">
            <Icon name="search" />
            <input aria-label="Buscar personagem" placeholder="Buscar personagem" value={rosterQuery} onChange={(event) => setRosterQuery(event.target.value)} />
            <kbd>/</kbd>
          </label>
          <div className="character-grid">
            {visibleCharacters.map(({ character, index }) => (
              <button
                className={`character-card ${selectedIndex === index ? 'selected' : ''}`}
                key={character.name}
                onClick={() => selectCharacter(index)}
                aria-pressed={selectedIndex === index}
              >
                <CharacterPortrait character={character} />
                <span>{character.name}</span>
              </button>
            ))}
            {visibleCharacters.length === 0 && <p className="empty-roster">Nenhum personagem encontrado.</p>}
          </div>
          <div className="roster-footer"><span className="online-dot" /> Tudo salvo neste dispositivo</div>
        </aside>

        <section className="preview-column" aria-label="Preview do personagem">
          <div className="preview-heading">
            <div className="preview-title">
              <p className="eyebrow">ESTÚDIO <span>/</span> VISÃO GERAL</p>
              <h1>{selectedCharacter.name}<button className="rename-button" aria-label="Editar nome"><Icon name="edit" /></button></h1>
            </div>
            <div className="preview-actions">
              <button className="quiet-button" onClick={() => setSaved(true)}><Icon name="check" /> Salvo</button>
              <button className="icon-button" aria-label="Tela cheia"><Icon name="expand" /></button>
            </div>
          </div>

          <div className="stage-wrap">
            <div className="stage-scene">
              <div className="stage-glow" />
              <div className="stage-label"><span className="online-dot" /> PREVIEW DO PERSONAGEM</div>
              <div className="scene-chip"><span /> {activeModule ? `Explorando ${activeModule}` : 'Estúdio • Luz suave'}</div>
              <div className="stage-tools" aria-label="Controles do preview">
                <button aria-label="Ajustar enquadramento"><Icon name="frame" /></button>
                <button aria-label="Aproximar"><Icon name="zoomIn" /></button>
                <button aria-label="Afastar"><Icon name="zoomOut" /></button>
              </div>
              <CharacterPreview character={selectedCharacter} />
              <div className="stage-floor" />
              <div className="stage-caption"><span>01</span><i />{selectedCharacter.name}<small>PERSONAGEM ATIVO</small></div>
            </div>
            <div className="stage-underbar">
              <div className="background-picker"><span className="background-swatch" /><span>Fundo do preview</span><Icon name="chevronDown" /></div>
              <button className="text-action" onClick={() => setActiveModule('Personalização')}><Icon name="sliders" /> Personalizar</button>
            </div>
          </div>

          <nav className="quick-nav" aria-label="Atalhos">
            <button className="character-step" aria-label="Personagem anterior" onClick={() => selectCharacter(selectedIndex - 1)}><Icon name="chevronLeft" /></button>
            {shortcuts.map((shortcut) => (
              <button
                className={`quick-nav-item ${activeShortcut === shortcut.name ? 'active' : ''}`}
                key={shortcut.name}
                onClick={() => setActiveShortcut(shortcut.name)}
                aria-pressed={activeShortcut === shortcut.name}
              >
                <Icon name={shortcut.icon} />
                <span>{shortcut.name}</span>
              </button>
            ))}
            <button className="character-step" aria-label="Próximo personagem" onClick={() => selectCharacter(selectedIndex + 1)}><Icon name="chevronRight" /></button>
          </nav>
        </section>

        <aside className="modules-panel panel" aria-label="Áreas do aplicativo">
          <div className="modules-topline">
            <div className="app-wordmark"><span className="wordmark-icon">n</span><span>NYMI<small>ESTÚDIO CRIATIVO</small></span></div>
            <button className="icon-button favorite-button" aria-label="Favoritos"><Icon name="star" /></button>
          </div>
          <div className="feature-banner">
            <div className="banner-copy"><span>SEU UNIVERSO,</span><strong>DO SEU JEITO.</strong><small>Crie. Imagine. Compartilhe.</small></div>
            <div className="banner-art" aria-hidden="true"><span className="banner-orbit orbit-one" /><span className="banner-orbit orbit-two" /><span className="banner-star">✦</span><span className="banner-sparkle">✧</span></div>
          </div>
          <div className="module-intro">
            <div><p className="eyebrow">COMECE POR AQUI</p><h2>Seu espaço criativo</h2></div>
            <span className="module-count">09</span>
          </div>
          <div className="module-grid">
            {modules.map((module, index) => (
              <button
                className={`module-card ${activeModule === module.name ? 'chosen' : ''}`}
                key={module.name}
                onClick={() => setActiveModule(activeModule === module.name ? null : module.name)}
                aria-pressed={activeModule === module.name}
                title={module.detail}
              >
                <span className="module-icon"><Icon name={module.icon} /></span>
                <span className="module-name">{module.name}</span>
                {index === 0 && <span className="module-new">NOVO</span>}
              </button>
            ))}
          </div>
          <button className="help-link" onClick={() => setActiveModule('Central de ajuda')}><span className="help-icon">?</span><span><strong>Precisa de uma ideia?</strong><small>Explore o guia rápido do Nymi</small></span><Icon name="chevronRight" /></button>
        </aside>
      </div>
    </main>
  )
}
