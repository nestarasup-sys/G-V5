export function TopBar() {
  return (
    <header className="top-bar">
      <div className="brand" aria-label="Gacha Nymi">
        <span className="brand-mark" aria-hidden="true">N</span>
        <span className="brand-name">Gacha Nymi</span>
      </div>
      <div className="top-bar-spacer" />
      <span className="workspace-label">Área de trabalho</span>
    </header>
  )
}
