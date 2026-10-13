import { useState } from 'react'
import { Icon, type IconName } from '../../ui/components/Icon'

type FabricatorSection = {
  label: string
  icon: IconName
}

const sections: FabricatorSection[] = [
  { label: 'Modelos', icon: 'sparkles' },
  { label: 'Personagens', icon: 'user' },
  { label: 'Corpo', icon: 'body' },
  { label: 'Cabeça', icon: 'face' },
  { label: 'Rostos', icon: 'user' },
  { label: 'Cabelos', icon: 'flower' },
  { label: 'Roupas', icon: 'shirt' },
  { label: 'Acessórios', icon: 'bow' },
  { label: 'Mascotes', icon: 'paw' },
  { label: 'Objetos', icon: 'box' },
  { label: 'Cenários', icon: 'frame' },
  { label: 'Animações', icon: 'expand' },
  { label: 'Exportação', icon: 'download' }
]

export function FabricatorPage() {
  const [activeSection, setActiveSection] = useState('Modelos')

  return (
    <main className="fabricator-layout" aria-label="Fabricador Dev">
      <aside className="fabricator-sidebar">
        <div className="fabricator-sidebar-heading">
          <span className="fabricator-heading-icon"><Icon name="box" /></span>
          <span><strong>Fabricador Dev</strong><small>ÁREAS DE PRODUÇÃO</small></span>
        </div>
        <nav className="fabricator-section-list" aria-label="Seções do Fabricador Dev">
          {sections.map((section) => (
            <button
              aria-pressed={activeSection === section.label}
              className={`fabricator-section-button${activeSection === section.label ? ' active' : ''}`}
              key={section.label}
              onClick={() => setActiveSection(section.label)}
              type="button"
            >
              <Icon name={section.icon} />
              <span>{section.label}</span>
            </button>
          ))}
        </nav>
      </aside>
      <section className="fabricator-workspace" aria-label={`${activeSection} — área de trabalho`} />
    </main>
  )
}
