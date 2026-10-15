import { useEffect, useMemo, useState } from 'react'
import type { FabricatorProject, FabricatorSlotSummary, ModelPart } from '../../../../shared/fabricator'
import { Icon } from '../../ui/components/Icon'
import { usePreviewBackground } from './usePreviewBackground'

function headPart(project: FabricatorProject | null): ModelPart | null {
  return project?.parts.find((part) => /cabe[çc]a|head/i.test(part.name)) ?? null
}

export function HairWorkspace() {
  const [background] = usePreviewBackground()
  const [models, setModels] = useState<FabricatorSlotSummary[]>([])
  const [modelSlot, setModelSlot] = useState(1)
  const [project, setProject] = useState<FabricatorProject | null>(null)
  const [loadingModels, setLoadingModels] = useState(true)
  const [loadingProject, setLoadingProject] = useState(false)
  const [error, setError] = useState('')
  const head = useMemo(() => headPart(project), [project])

  useEffect(() => {
    let cancelled = false
    void window.desktop.listFabricatorSlots().then((slots) => {
      if (cancelled) return
      setModels(slots)
      const firstAvailable = slots.find((slot): slot is NonNullable<typeof slot> => slot !== null)
      if (!slots[modelSlot - 1] && firstAvailable) setModelSlot(firstAvailable.slot)
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os modelos.')
    }).finally(() => { if (!cancelled) setLoadingModels(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    setProject(null)
    setError('')
    setLoadingProject(true)
    void window.desktop.loadFabricatorSlot(modelSlot).then((loaded) => {
      if (cancelled) return
      setProject(loaded)
      if (!loaded) setError('Este slot ainda não tem um modelo salvo.')
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o modelo selecionado.')
    }).finally(() => { if (!cancelled) setLoadingProject(false) })
    return () => { cancelled = true }
  }, [modelSlot])

  return <section className="fabricator-workspace hair-dev-workspace" aria-label="Cabelos Dev">
    <header className="hair-dev-toolbar">
      <span className="model-slot-logo"><Icon name="bow" /></span>
      <span><strong>Cabelos Dev</strong><small>Prévia da cabeça do modelo selecionado</small></span>
      <label>Modelo de referência<select value={modelSlot} onChange={(event) => setModelSlot(Number(event.target.value))} disabled={loadingModels}>{models.map((model, index) => model && <option key={model.slot} value={model.slot}>Modelo {String(index + 1).padStart(2, '0')} · {model.name}</option>)}</select></label>
    </header>
    <div className="hair-dev-body">
      <section className="hair-dev-preview" aria-label="Prévia da cabeça">
        <div className="hair-dev-preview-heading"><strong>PRÉVIA DA CABEÇA</strong><span>{head ? `${Math.round(head.width)} × ${Math.round(head.height)}` : ''}</span></div>
        <div className="hair-dev-preview-stage" style={{ backgroundColor: background }}>
          {head && <img src={head.dataUrl} alt="Cabeça do modelo de referência" draggable={false} />}
          {(loadingModels || loadingProject) && <span className="hair-dev-message">Carregando modelo…</span>}
          {!loadingModels && !loadingProject && !head && <span className="hair-dev-message">{error || 'O modelo não tem uma peça chamada Cabeça.'}</span>}
        </div>
      </section>
      <div className="hair-dev-editor-space" aria-label="Área de edição de cabelos" />
    </div>
  </section>
}
