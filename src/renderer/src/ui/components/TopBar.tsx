import { Icon } from './Icon'

export function TopBar({ saved, onSave }: { saved: boolean; onSave: () => void }) {
  return (
    <header className="top-bar">
      <div className="top-brand">
        <span className="top-brand-mark">n</span>
        <span className="top-brand-name">Gacha Nymi<span>estúdio criativo</span></span>
      </div>
      <span className="top-divider" />
      <span className="top-section-label">Visão geral</span>
      <div className="topbar-spacer" />
      <label className="global-search"><Icon name="search" /><input placeholder="Buscar no Nymi" aria-label="Buscar no Nymi" /><kbd>Ctrl K</kbd></label>
      <button className="save-status" onClick={onSave}><span className="save-dot" />{saved ? 'Todas as alterações salvas' : 'Salvar alterações'}</button>
      <button className="top-icon-button" aria-label="Notificações"><Icon name="bell" /><i /></button>
      <button className="account-button" aria-label="Minha conta">L</button>
    </header>
  )
}
