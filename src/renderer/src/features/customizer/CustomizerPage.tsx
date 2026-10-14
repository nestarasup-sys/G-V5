import { useEffect, useRef, useState } from 'react'
import { CharacterPortrait } from '../../ui/components/CharacterPortrait'
import { Icon, type IconName } from '../../ui/components/Icon'
import type { FabricatorPose, FabricatorPoseSummary, FabricatorProject, FabricatorSlotSummary } from '../../../../shared/fabricator'
import { usePreviewBackground } from '../fabricator/usePreviewBackground'

type CatalogArtwork = Pick<FabricatorProject, 'width' | 'height' | 'parts' | 'layerOrder' | 'hiddenPartIds'>

async function renderArtwork(artwork: CatalogArtwork, maxSize: number): Promise<string | null> {
  if (artwork.width <= 0 || artwork.height <= 0) return null
  const scale = Math.min(maxSize / artwork.width, maxSize / artwork.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(artwork.width * scale))
  canvas.height = Math.max(1, Math.round(artwork.height * scale))
  const context = canvas.getContext('2d')
  if (!context) return null

  const hidden = new Set(artwork.hiddenPartIds ?? [])
  const layerIndex = new Map((artwork.layerOrder ?? []).map((id, index) => [id, index]))
  const parts = artwork.parts
    .filter((part) => !hidden.has(part.id))
    .map((part, index) => ({ part, index }))
    .sort((a, b) => (layerIndex.get(a.part.id) ?? a.index) - (layerIndex.get(b.part.id) ?? b.index))

  for (const { part } of parts) {
    try {
      const image = new Image()
      image.src = part.dataUrl
      if (image.decode) await image.decode()
      else await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('Não foi possível carregar uma parte da prévia.'))
      })
      context.save()
      try {
        context.translate((part.x + part.width / 2) * scale, (part.y + part.height / 2) * scale)
        context.rotate(part.rotation * Math.PI / 180)
        context.drawImage(image, -part.width * scale / 2, -part.height * scale / 2, part.width * scale, part.height * scale)
      } finally {
        context.restore()
      }
    } catch {
      continue
    }
  }

  return canvas.toDataURL('image/png')
}

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
  { name: 'Modelos', icon: 'sparkles', detail: 'Looks prontos para começar' },
  { name: 'Poses', icon: 'body', detail: 'Pose, proporções e detalhes' },
  { name: 'Cabeça', icon: 'face', detail: 'Rosto, cabelo e expressões' },
  { name: 'Roupas', icon: 'shirt', detail: 'Monte um visual único' },
  { name: 'Acessórios', icon: 'flower', detail: 'Peças e objetos de cena' },
  { name: 'Diálogos', icon: 'message', detail: 'Balões e falas' },
  { name: 'Mascotes', icon: 'paw', detail: 'Seus companheiros' },
  { name: 'Objetos', icon: 'box', detail: 'Itens para compor a cena' },
  { name: 'Perfil', icon: 'user', detail: 'Identidade do personagem' }
]

export function CustomizerPage() {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [activeModule, setActiveModule] = useState<string | null>(null)
  const [previewBackground, setPreviewBackground] = usePreviewBackground()
  const [rosterQuery, setRosterQuery] = useState('')
  const [catalogModels, setCatalogModels] = useState<FabricatorSlotSummary[]>([])
  const [catalogPoses, setCatalogPoses] = useState<FabricatorPoseSummary[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [selectedCatalogModelSlot, setSelectedCatalogModelSlot] = useState<number | null>(null)
  const [selectedCatalogPoseSlot, setSelectedCatalogPoseSlot] = useState<number | null>(null)
  const [modelThumbnails, setModelThumbnails] = useState<Record<number, string>>({})
  const [poseThumbnails, setPoseThumbnails] = useState<Record<string, string>>({})
  const [selectedArtworkUrl, setSelectedArtworkUrl] = useState<string | null>(null)
  const [selectedArtworkLabel, setSelectedArtworkLabel] = useState('')
  const [previewLoading, setPreviewLoading] = useState(true)
  const thumbnailCache = useRef(new Set<string>())
  const previewLoadRequest = useRef(0)
  const selectedCharacter = characters[selectedIndex]
  const visibleCharacters = characters
    .map((character, index) => ({ character, index }))
    .filter(({ character }) => character.name.toLowerCase().includes(rosterQuery.trim().toLowerCase()))

  useEffect(() => {
    let cancelled = false
    void Promise.all([window.desktop.listFabricatorSlots(), window.desktop.listFabricatorPoseSlots()])
      .then(async ([models, poses]) => {
        if (cancelled) return
        setCatalogModels(models)
        setCatalogPoses(poses)
        const preferredModel = models.find((model) => model?.slot === 1) ?? models.find((model) => model !== null)
        if (!preferredModel) {
          setSelectedCatalogModelSlot(null)
          setPreviewLoading(false)
          return
        }

        setSelectedCatalogModelSlot(preferredModel.slot)
        setSelectedArtworkLabel(preferredModel.name)
        const requestId = ++previewLoadRequest.current
        try {
          const firstPose = poses.find((pose) => pose?.sourceModelSlot === preferredModel.slot && pose.slot === 1)
          let artwork: CatalogArtwork | null = firstPose ? await window.desktop.loadFabricatorPose(preferredModel.slot, 1) : null
          if (!artwork) artwork = await window.desktop.loadFabricatorSlot(preferredModel.slot)
          if (!artwork) throw new Error('Não foi possível abrir o Modelo 01.')
          const artworkUrl = await renderArtwork(artwork, 720)
          if (!cancelled && previewLoadRequest.current === requestId) setSelectedArtworkUrl(artworkUrl)
        } catch (reason) {
          if (!cancelled && previewLoadRequest.current === requestId) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível abrir o Modelo 01.')
        } finally {
          if (!cancelled && previewLoadRequest.current === requestId) setPreviewLoading(false)
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível carregar o catálogo.')
          setPreviewLoading(false)
        }
      })
      .finally(() => { if (!cancelled) setCatalogLoading(false) })
    return () => {
      cancelled = true
      previewLoadRequest.current += 1
    }
  }, [])

  useEffect(() => {
    if (activeModule !== 'Modelos' || catalogLoading) return
    let cancelled = false
    void (async () => {
      for (const model of catalogModels) {
        if (!model || thumbnailCache.current.has(`model:${model.slot}`)) continue
        let artwork: CatalogArtwork | null = null
        const firstPose = catalogPoses.find((pose) => pose?.sourceModelSlot === model.slot && pose.slot === 1)
        try {
          if (firstPose) artwork = await window.desktop.loadFabricatorPose(model.slot, 1)
          if (!artwork) artwork = await window.desktop.loadFabricatorSlot(model.slot)
          if (!artwork) continue
          const thumbnail = await renderArtwork(artwork, 144)
          if (cancelled) return
          if (thumbnail) {
            thumbnailCache.current.add(`model:${model.slot}`)
            setModelThumbnails((current) => ({ ...current, [model.slot]: thumbnail }))
          }
        } catch (reason) {
          if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível gerar uma miniatura do modelo.')
        }
      }
    })()
    return () => { cancelled = true }
  }, [activeModule, catalogLoading, catalogModels, catalogPoses])

  useEffect(() => {
    if (activeModule !== 'Poses' || selectedCatalogModelSlot === null || catalogLoading) return
    let cancelled = false
    const modelPoses = catalogPoses.filter((pose): pose is NonNullable<typeof pose> => pose?.sourceModelSlot === selectedCatalogModelSlot)
    void (async () => {
      for (const pose of modelPoses) {
        const key = `${pose.sourceModelSlot}:${pose.slot}`
        if (thumbnailCache.current.has(`pose:${key}`)) continue
        try {
          const artwork: FabricatorPose | null = await window.desktop.loadFabricatorPose(pose.sourceModelSlot, pose.slot)
          if (!artwork) continue
          const thumbnail = await renderArtwork(artwork, 144)
          if (cancelled) return
          if (thumbnail) {
            thumbnailCache.current.add(`pose:${key}`)
            setPoseThumbnails((current) => ({ ...current, [key]: thumbnail }))
          }
        } catch (reason) {
          if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível gerar uma miniatura da pose.')
        }
      }
    })()
    return () => { cancelled = true }
  }, [activeModule, catalogLoading, catalogPoses, selectedCatalogModelSlot])

  function selectCharacter(index: number) {
    setSelectedIndex((index + characters.length) % characters.length)
    setActiveModule(null)
  }

  async function selectCatalogModel(model: NonNullable<FabricatorSlotSummary>) {
    const requestId = ++previewLoadRequest.current
    setSelectedCatalogModelSlot(model.slot)
    setSelectedCatalogPoseSlot(null)
    setSelectedArtworkLabel(model.name)
    setSelectedArtworkUrl(null)
    setPreviewLoading(true)
    setCatalogError('')
    try {
      const firstPose = catalogPoses.find((pose) => pose?.sourceModelSlot === model.slot && pose.slot === 1)
      let artwork: CatalogArtwork | null = firstPose ? await window.desktop.loadFabricatorPose(model.slot, 1) : null
      if (!artwork) artwork = await window.desktop.loadFabricatorSlot(model.slot)
      if (!artwork) throw new Error('Não foi possível abrir este modelo.')
      const artworkUrl = await renderArtwork(artwork, 720)
      if (previewLoadRequest.current === requestId) setSelectedArtworkUrl(artworkUrl)
    } catch (reason) {
      if (previewLoadRequest.current === requestId) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível abrir este modelo.')
    } finally {
      if (previewLoadRequest.current === requestId) setPreviewLoading(false)
    }
  }

  async function selectCatalogPose(pose: NonNullable<FabricatorPoseSummary>) {
    const requestId = ++previewLoadRequest.current
    setSelectedCatalogPoseSlot(pose.slot)
    setSelectedArtworkLabel(pose.name)
    setSelectedArtworkUrl(null)
    setPreviewLoading(true)
    setCatalogError('')
    try {
      const artwork = await window.desktop.loadFabricatorPose(pose.sourceModelSlot, pose.slot)
      if (!artwork) throw new Error('Não foi possível abrir esta pose.')
      const artworkUrl = await renderArtwork(artwork, 720)
      if (previewLoadRequest.current === requestId) setSelectedArtworkUrl(artworkUrl)
    } catch (reason) {
      if (previewLoadRequest.current === requestId) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível abrir esta pose.')
    } finally {
      if (previewLoadRequest.current === requestId) setPreviewLoading(false)
    }
  }

  const availableModels = catalogModels.filter((model): model is NonNullable<typeof model> => model !== null)
  const availablePoses = catalogPoses.filter((pose): pose is NonNullable<typeof pose> => pose?.sourceModelSlot === selectedCatalogModelSlot)
  const selectedModelName = availableModels.find((model) => model.slot === selectedCatalogModelSlot)?.name

  if (activeModule !== null && modules.some((module) => module.name === activeModule)) {
    return (
      <div className="customizer-models-view">
        <div className="customizer-models-columns">
          <section className="customizer-model-preview" aria-label="Prévia do personagem">
            <div className="stage-wrap">
              <div className="stage-scene" style={{ '--preview-background': previewBackground } as import('react').CSSProperties}>
                <div className="stage-label"><span className="online-dot" /> PREVIEW DO PERSONAGEM</div>
                <button className="customizer-back-button customizer-preview-back" onClick={() => setActiveModule(null)} type="button"><span aria-hidden="true">←</span> Customizar</button>
                <label className="scene-chip preview-scene-color" title="Mudar a cor do fundo de todas as prévias">
                  <span className="preview-color-swatch" style={{ backgroundColor: previewBackground }} />
                  <span className="preview-color-label">Fundo da prévia</span>
                  <input type="color" aria-label="Cor de fundo das prévias" value={previewBackground} onChange={(event) => setPreviewBackground(event.target.value)} />
                </label>
                <div className="stage-tools" aria-label="Controles do preview">
                  <button aria-label="Ajustar enquadramento" type="button"><Icon name="frame" /></button>
                  <button aria-label="Aproximar" type="button"><Icon name="zoomIn" /></button>
                  <button aria-label="Afastar" type="button"><Icon name="zoomOut" /></button>
                </div>
                {selectedArtworkUrl ? <img className="customizer-selected-artwork" src={selectedArtworkUrl} alt={selectedArtworkLabel} /> : !previewLoading && <div className="customizer-no-artwork"><Icon name="body" /><span>Nenhum modelo salvo para mostrar.</span></div>}
                {previewLoading && <div className="customizer-preview-loading">Carregando prévia…</div>}
                <div className="stage-caption"><span>{String(selectedCatalogModelSlot ?? 1).padStart(2, '0')}</span><i />{selectedArtworkLabel || selectedCharacter.name}<small>{selectedArtworkUrl ? 'DO CATÁLOGO' : 'PERSONAGEM ATIVO'}</small></div>
              </div>
            </div>
          </section>
          <section className="customizer-models-sidebar" aria-label="Opções e catálogo de personalização">
            <div className="customizer-models-options-grid">
              {modules.map((module, index) => (
                <button
                  className={`customizer-model-option${activeModule === module.name ? ' selected' : ''}`}
                  key={module.name}
                  onClick={() => {
                    setActiveModule(module.name)
                    if (module.name === 'Modelos' && selectedCatalogModelSlot !== null) {
                      const selectedModel = availableModels.find((model) => model.slot === selectedCatalogModelSlot)
                      if (selectedModel) void selectCatalogModel(selectedModel)
                    }
                  }}
                  aria-pressed={activeModule === module.name}
                  title={module.detail}
                  type="button"
                >
                  <span className="customizer-model-option-icon"><Icon name={module.icon} /></span>
                  <span className="customizer-model-option-name">{module.name}</span>
                  {index === 0 && <span className="customizer-model-option-new">NOVO</span>}
                </button>
              ))}
            </div>
            <section className="customizer-catalog-panel" aria-label={'Catálogo de ' + activeModule}>
              <header className="customizer-catalog-heading">
                <div><p className="eyebrow">CATÁLOGO</p><h2>{activeModule === 'Poses' ? selectedModelName ?? 'Escolha um modelo' : activeModule}</h2></div>
                {activeModule === 'Modelos' && <small>{availableModels.length} modelos</small>}
                {activeModule === 'Poses' && selectedCatalogModelSlot !== null && <small>{availablePoses.length} poses</small>}
              </header>
              {catalogError && <p className="customizer-catalog-error" role="alert">{catalogError}</p>}
              {activeModule === 'Modelos' && (
                catalogLoading ? <div className="customizer-catalog-empty">Carregando modelos…</div>
                  : availableModels.length === 0 ? <div className="customizer-catalog-empty">Nenhum modelo salvo ainda.</div>
                    : <div className="customizer-catalog-grid customizer-model-catalog">
                      {availableModels.map((model) => (
                        <button className={'customizer-catalog-card model-catalog-card' + (selectedCatalogModelSlot === model.slot ? ' selected' : '')} key={model.slot} onClick={() => void selectCatalogModel(model)} aria-label={'Selecionar ' + model.name} aria-pressed={selectedCatalogModelSlot === model.slot} title={model.name} type="button">
                          {modelThumbnails[model.slot] ? <img src={modelThumbnails[model.slot]} alt="" /> : <span className="customizer-catalog-placeholder"><Icon name="body" /></span>}
                        </button>
                      ))}
                    </div>
              )}
              {activeModule === 'Poses' && (
                selectedCatalogModelSlot === null ? <div className="customizer-catalog-empty"><span>Selecione um modelo para ver as poses dele.</span><button onClick={() => setActiveModule('Modelos')} type="button">Ver modelos</button></div>
                  : catalogLoading ? <div className="customizer-catalog-empty">Carregando poses…</div>
                    : availablePoses.length === 0 ? <div className="customizer-catalog-empty">Este modelo ainda não tem poses salvas.</div>
                      : <div className="customizer-catalog-grid customizer-pose-catalog">
                        {availablePoses.map((pose) => {
                          const key = pose.sourceModelSlot + ':' + pose.slot
                          return <button className={'customizer-catalog-card pose-catalog-card' + (selectedCatalogPoseSlot === pose.slot ? ' selected' : '')} key={key} onClick={() => void selectCatalogPose(pose)} aria-pressed={selectedCatalogPoseSlot === pose.slot} title={pose.name} type="button">
                            {poseThumbnails[key] ? <img src={poseThumbnails[key]} alt="" /> : <span className="customizer-catalog-placeholder"><Icon name="body" /></span>}
                            <span className="customizer-pose-caption"><b>Pose {String(pose.slot).padStart(2, '0')}</b><small>{pose.name}</small></span>
                          </button>
                        })}
                      </div>
              )}
              {activeModule !== 'Modelos' && activeModule !== 'Poses' && <div className="customizer-catalog-empty">O catálogo de {activeModule} aparecerá aqui.</div>}
            </section>
          </section>
        </div>
      </div>
    )
  }

  return (
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
              <p className="eyebrow">CUSTOMIZAR <span>/</span> PERSONAGEM</p>
              <h1>{selectedArtworkLabel || (previewLoading ? 'Carregando modelo…' : 'Nenhum modelo')}<button className="rename-button" aria-label="Editar nome"><Icon name="edit" /></button></h1>
            </div>
            <div className="preview-actions">
              <button className="quiet-button" ><Icon name="check" /> Salvo</button>
              <button className="icon-button" aria-label="Tela cheia"><Icon name="expand" /></button>
            </div>
          </div>

          <div className="stage-wrap">
            <div className="stage-scene" style={{ '--preview-background': previewBackground } as import('react').CSSProperties}>
              <div className="stage-label"><span className="online-dot" /> PREVIEW DO PERSONAGEM</div>
              <label className="scene-chip preview-scene-color" title="Mudar a cor do fundo de todas as prévias">
                <span className="preview-color-swatch" style={{ backgroundColor: previewBackground }} />
                <span className="preview-color-label">Fundo da prévia</span>
                <input type="color" aria-label="Cor de fundo das prévias" value={previewBackground} onChange={(event) => setPreviewBackground(event.target.value)} />
              </label>
              <div className="stage-tools" aria-label="Controles do preview">
                <button aria-label="Ajustar enquadramento"><Icon name="frame" /></button>
                <button aria-label="Aproximar"><Icon name="zoomIn" /></button>
                <button aria-label="Afastar"><Icon name="zoomOut" /></button>
              </div>
              {selectedArtworkUrl ? <img className="customizer-selected-artwork" src={selectedArtworkUrl} alt={selectedArtworkLabel} /> : !previewLoading && <div className="customizer-no-artwork"><Icon name="body" /><span>Importe um modelo no Fabricador Dev para começar.</span></div>}
              {previewLoading && <div className="customizer-preview-loading">Carregando prévia…</div>}
              <div className="stage-caption"><span>{String(selectedCatalogModelSlot ?? 1).padStart(2, '0')}</span><i />{selectedArtworkLabel || selectedCharacter.name}<small>{selectedArtworkUrl ? 'MODELO ATIVO' : 'SEM MODELO'}</small></div>
            </div>
            <div className="stage-underbar">
              <div className="background-picker"><span className="background-swatch" /><span>Fundo do preview</span><Icon name="chevronDown" /></div>
              <button className="text-action" onClick={() => setActiveModule('Personalização')}><Icon name="sliders" /> Personalizar</button>
            </div>
          </div>

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
                className="module-card"
                key={module.name}
                onClick={() => setActiveModule(module.name)}
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
  )
}
