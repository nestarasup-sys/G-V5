import { Icon } from '../../ui/components/Icon'

export function ExpressionPresetWorkspace() {
  return (
    <section className="fabricator-workspace expression-preset-workspace" aria-label="Preset Expressão Dev">
      <header className="expression-preset-toolbar">
        <span className="model-slot-logo"><Icon name="face" /></span>
        <strong>Preset Expressão Dev</strong>
      </header>
      <div className="expression-preset-content" />
    </section>
  )
}
