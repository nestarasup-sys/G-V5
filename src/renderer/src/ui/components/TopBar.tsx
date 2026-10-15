import { NavLink } from 'react-router'
import { Icon } from './Icon'

const sections = [
  { label: 'Studio', path: '/estudio', icon: 'camera' },
  { label: 'Customizar', path: '/customizar', icon: 'bow' },
  { label: 'Opções', path: '/opcoes', icon: 'settings' },
  { label: 'Fabricador Dev', path: '/fabricador-dev', icon: 'box' }
] as const

export function TopBar({ saved, onSave }: { saved: boolean; onSave: () => void }) {
  return (
    <header className="top-bar">
      <div className="top-brand">
        <img className="top-brand-mark" src="/gacha-nymi.ico" alt="Logo Gacha Nymi" />
        <span className="top-brand-name">Gacha Nymi<span>estúdio criativo</span></span>
      </div>
      <span className="top-divider" />
      <nav className="top-navigation" aria-label="Áreas do aplicativo">
        {sections.map((section) => (
          <NavLink
            className={({ isActive }) => `top-nav-link${isActive ? ' active' : ''}`}
            key={section.path}
            to={section.path}
          >
            <Icon name={section.icon} />
            <span>{section.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="topbar-spacer" />
      <button className="save-status" onClick={onSave}><span className="save-dot" />{saved ? 'Todas as alterações salvas' : 'Salvar alterações'}</button>
      <button className="top-icon-button" aria-label="Notificações"><Icon name="bell" /><i /></button>
      <button className="account-button" aria-label="Minha conta">L</button>
    </header>
  )
}
