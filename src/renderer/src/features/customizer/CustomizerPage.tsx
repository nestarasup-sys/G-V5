import { useEffect, useRef, useState } from 'react'
import type { CharacterGarmentAdjustment, CustomizerCharacter, CustomizerLibrary, FabricatorPose, FabricatorPoseSummary, FabricatorProject, FabricatorSlotSummary, WardrobeCategory, WardrobeSet } from '../../../../shared/fabricator'
import { Icon } from '../../ui/components/Icon'
import { normalizeLayerOrder, orderedParts } from '../fabricator/models/rig'
import { cssAffine, mapWardrobeComponentToPose } from '../fabricator/wardrobe/poseTransform'
import { adjustedGarment, emptyAdjustment, equippedGarments, garmentKey, garmentSlot } from './wardrobeSelection'

const emptyLibrary = (): CustomizerLibrary => ({ schemaVersion: 1, characters: [] })
const wardrobeGroups: Array<{ category: WardrobeCategory; label: string }> = [
  { category: 'camisa', label: 'Camisas' },
  { category: 'manga-superior', label: 'Mangas superiores' },
  { category: 'manga-inferior', label: 'Mangas inferiores' },
  { category: 'shorts', label: 'Shorts' }
]
const singleCategory = (category: WardrobeCategory): boolean => category === 'camisa'

export function CustomizerPage() {
  const [library, setLibrary] = useState<CustomizerLibrary>(emptyLibrary)
  const [loaded, setLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [rosterQuery, setRosterQuery] = useState('')
  const [models, setModels] = useState<FabricatorSlotSummary[]>([])
  const [model, setModel] = useState<FabricatorProject | null>(null)
  const [poses, setPoses] = useState<Array<NonNullable<FabricatorPoseSummary>>>([])
  const [loadedModelSlot, setLoadedModelSlot] = useState<number | null>(null)
  const [pose, setPose] = useState<FabricatorPose | null>(null)
  const [sets, setSets] = useState<WardrobeSet[]>([])
  const [editingGarment, setEditingGarment] = useState<string | null>(null)
  const [activeModule, setActiveModule] = useState('Roupas')
  const [error, setError] = useState('')
  const [saveStatus, setSaveStatus] = useState('Carregando…')
  const [stageSize, setStageSize] = useState({ width: 600, height: 550 })
  const [zoom, setZoom] = useState(1)
  const stageRef = useRef<HTMLDivElement>(null)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const saveRevision = useRef(0)
  const latestLibrary = useRef(library)
  latestLibrary.current = library
  const selected = library.characters.find((character) => character.id === selectedId) ?? null
  const modelSlot = selected?.modelSlot ?? null
  const poseSlot = selected?.poseSlot ?? 1

  useEffect(() => {
    let active = true
    void Promise.all([window.desktop.loadCustomizerLibrary(), window.desktop.listFabricatorSlots()])
      .then(([saved, modelSlots]) => {
        if (!active) return
        setLibrary(saved)
        setSelectedId(saved.characters[0]?.id ?? null)
        setModels(modelSlots)
        setLoaded(true)
        setSaveStatus('Salvo')
      }).catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível abrir a biblioteca.')
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!loaded) return
    setSaveStatus('Alterações pendentes')
    const revision = ++saveRevision.current
    const timer = setTimeout(() => {
      const snapshot = library
      const next = saveQueue.current.catch(() => undefined).then(() => window.desktop.saveCustomizerLibrary(snapshot))
      saveQueue.current = next
      void next.then(() => { if (revision === saveRevision.current) setSaveStatus('Salvo') }, (reason: unknown) => {
        if (revision === saveRevision.current) setSaveStatus('Erro ao salvar')
        setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o personagem.')
      })
    }, 350)
    return () => clearTimeout(timer)
  }, [library, loaded])

  useEffect(() => {
    if (!loaded) return
    return () => {
      // Flush the last keystroke or slider change even when leaving Customizar
      // before the debounce interval has finished.
      saveQueue.current = saveQueue.current.catch(() => undefined)
        .then(() => window.desktop.saveCustomizerLibrary(latestLibrary.current))
    }
  }, [loaded])

  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    const resize = new ResizeObserver(([entry]) => setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    resize.observe(element)
    return () => resize.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    setModel(null)
    setLoadedModelSlot(null)
    setSets([])
    setPoses([])
    setPose(null)
    setEditingGarment(null)
    if (modelSlot === null) return () => { cancelled = true }
    void Promise.all([
      window.desktop.loadFabricatorSlot(modelSlot),
      window.desktop.listFabricatorPoseSlots(modelSlot),
      window.desktop.listWardrobeSets(modelSlot)
    ]).then(async ([loadedModel, poseSummaries, summaries]) => {
      const allSets = (await Promise.all(summaries.filter((item): item is NonNullable<typeof item> => Boolean(item)).map((item) => window.desktop.loadWardrobeSet(modelSlot, item.id)))).filter((set): set is WardrobeSet => set !== null)
      if (cancelled) return
      setModel(loadedModel)
      setPoses(poseSummaries.filter((item): item is NonNullable<typeof item> => item !== null))
      setSets(allSets)
      setLoadedModelSlot(modelSlot)
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Erro ao carregar modelo, poses ou roupas.')
    })
    return () => { cancelled = true }
  }, [modelSlot])

  useEffect(() => {
    let cancelled = false
    setPose(null)
    if (modelSlot === null || modelSlot !== loadedModelSlot || !poses.some((item) => item?.slot === poseSlot)) return () => { cancelled = true }
    void window.desktop.loadFabricatorPose(modelSlot, poseSlot)
      .then((loadedPose) => { if (!cancelled) setPose(loadedPose) })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Erro ao carregar pose.') })
    return () => { cancelled = true }
  }, [modelSlot, poseSlot, loadedModelSlot, poses])

  const updateCharacter = (modify: (character: CustomizerCharacter) => CustomizerCharacter) => {
    if (!selected) return
    setLibrary((current) => ({ ...current, characters: current.characters.map((person) => person.id === selected.id ? modify(person) : person) }))
  }
  const newCharacter = () => {
    const character: CustomizerCharacter = {
      id: crypto.randomUUID(),
      name: 'Personagem ' + String(library.characters.length + 1).padStart(2, '0'),
      modelSlot: models.find((item) => Boolean(item))?.slot ?? null,
      poseSlot: 1,
      equipped: {},
      adjustments: {}
    }
    setLibrary((current) => ({ ...current, characters: [...current.characters, character] }))
    setSelectedId(character.id)
    setActiveModule('Roupas')
  }
  const equip = (slot: string, target: string) => {
    updateCharacter((person) => {
      const equipped = { ...person.equipped }
      if (equipped[slot] === target) delete equipped[slot]
      else equipped[slot] = target
      return { ...person, equipped }
    })
  }
  const setAdjustment = (key: string, field: keyof CharacterGarmentAdjustment, number: number) => {
    updateCharacter((person) => ({
      ...person,
      adjustments: {
        ...person.adjustments,
        [key]: { ...(person.adjustments[key] ?? emptyAdjustment()), [field]: number }
      }
    }))
  }
  const view = pose ?? model
  const layerOrder = view ? normalizeLayerOrder(view.parts, view.layerOrder) : []
  const bodyParts = view ? orderedParts(view.parts, layerOrder).filter((part) => !(view.hiddenPartIds ?? []).includes(part.id)) : []
  const equipped = selected ? equippedGarments(sets, selected.equipped) : []
  const edited = equipped.find((piece) => piece.key === editingGarment) ?? null
  const adjustment = selected && editingGarment ? selected.adjustments[editingGarment] ?? emptyAdjustment() : emptyAdjustment()
  const scale = view ? Math.max(0.05, Math.min((stageSize.width - 42) / view.width, (stageSize.height - 110) / view.height)) * zoom : 1
  const visibleCharacters = library.characters.filter((character) => character.name.toLowerCase().includes(rosterQuery.toLowerCase().trim()))

  return (
    <div className="home-layout customizer-live">
      <aside className="roster-panel panel" aria-label="Personagens">
        <div className="panel-heading roster-heading">
          <div><p className="eyebrow">SUA COLEÇÃO</p><h2>Personagens <span>{library.characters.length.toString().padStart(2, '0')}</span></h2></div>
          <button className="icon-button add-button" aria-label="Adicionar personagem" onClick={newCharacter}><Icon name="plus" /></button>
        </div>
        <label className="roster-search"><Icon name="search" /><input aria-label="Buscar personagem" placeholder="Buscar personagem" value={rosterQuery} onChange={(event) => setRosterQuery(event.target.value)} /><kbd>/</kbd></label>
        <div className="character-grid">
          {visibleCharacters.map((character) => <button key={character.id} className={'character-card' + (selectedId === character.id ? ' selected' : '')} onClick={() => { setSelectedId(character.id); setEditingGarment(null) }} aria-pressed={selectedId === character.id}>
            <span className="customizer-character-icon"><Icon name="user" /></span><span>{character.name}</span>
          </button>)}
          {!library.characters.length && <div className="customizer-empty-roster"><p>Crie seu primeiro personagem usando os modelos do Fabricador Dev.</p><button className="pose-button primary" onClick={newCharacter}>Criar personagem</button></div>}
        </div>
        <div className="roster-footer"><span className="online-dot" /> Biblioteca salva neste dispositivo</div>
      </aside>

      <section className="preview-column" aria-label="Preview do personagem">
        <div className="preview-heading"><div className="preview-title">
          <p className="eyebrow">CUSTOMIZAR / PERSONAGEM</p>
          {selected ? <input className="customizer-name-input" aria-label="Nome do personagem" maxLength={80} value={selected.name} onChange={(event) => updateCharacter((person) => ({ ...person, name: event.target.value }))} /> : <h1>Escolha um personagem</h1>}
        </div><div className="preview-actions"><span className="customizer-save-label"><Icon name="check" /> {saveStatus}</span>{selected && <button className="icon-button" aria-label="Excluir personagem" title="Excluir este personagem" onClick={() => {
          if (!window.confirm('Excluir este personagem? Os modelos, poses e roupas originais continuarão salvos.')) return
          setLibrary((current) => ({ ...current, characters: current.characters.filter((character) => character.id !== selected.id) }))
          setSelectedId(library.characters.find((character) => character.id !== selected.id)?.id ?? null)
        }}><Icon name="trash" /></button>}</div></div>
        {error && <div className="wardrobe-error" role="alert">{error}<button onClick={() => setError('')}>Fechar</button></div>}
        <div className="stage-wrap"><div className="stage-scene" ref={stageRef}>
          <div className="stage-glow" /><div className="stage-label"><span className="online-dot" /> PRÉVIA DO PERSONAGEM</div>
          <div className="stage-tools" aria-label="Controles do preview">
            <button aria-label="Aproximar" onClick={() => setZoom((z) => Math.min(2.5, z + .1))}><Icon name="zoomIn" /></button>
            <button aria-label="Afastar" onClick={() => setZoom((z) => Math.max(.4, z - .1))}><Icon name="zoomOut" /></button>
            <button aria-label="Centralizar" onClick={() => setZoom(1)}><Icon name="frame" /></button>
          </div>
          {view ? <div className="customizer-artboard" style={{ width: view.width * scale, height: view.height * scale }}>
            {bodyParts.map((part, index) => {
              const garments = equipped.filter((piece) => piece.component.attachedPartId === part.id)
              return <div key={part.id} className="customizer-layer" style={{ zIndex: index + 1 }}>
                <img className="customizer-render-body" src={part.dataUrl} alt={part.name} draggable={false} style={{ left: part.x * scale, top: part.y * scale, width: part.width * scale, height: part.height * scale, transform: 'rotate(' + part.rotation + 'deg)' }} />
                {garments.map(({ set, component, key }, garmentIndex) => {
                  const source = model?.parts.find((bone) => bone.id === part.id)
                  if (!source) return null
                  const sourceBone = set.sourceOverrides?.[part.id] ? { ...source, sourceTransform: set.sourceOverrides[part.id] } : source
                  const transformed = adjustedGarment(component, selected?.adjustments[key])
                  const matrix = mapWardrobeComponentToPose(transformed, sourceBone, part)
                  return <img key={key} className={'customizer-render-garment' + (editingGarment === key ? ' editing' : '')} src={component.dataUrl} draggable={false} alt={component.name} title={component.name + ' · clique para ajustar'} onClick={() => { setEditingGarment(key); setActiveModule('Roupas') }} style={{ left: 0, top: 0, zIndex: garmentIndex + 2, width: transformed.width * scale, height: transformed.height * scale, transform: cssAffine(matrix, scale) }} />
                })}
              </div>
            })}
          </div> : <div className="customizer-empty-stage">{selected ? 'Selecione um modelo salvo na coluna direita.' : 'Crie ou selecione um personagem.'}</div>}
          <div className="stage-floor" /><div className="stage-caption"><span>{String(poseSlot).padStart(2, '0')}</span><i />{selected?.name ?? 'Nenhum personagem'}<small>PERSONAGEM ATIVO</small></div>
        </div><div className="stage-underbar"><div className="background-picker"><span className="background-swatch" />Prévia com as peças originais<Icon name="chevronDown" /></div><button className="text-action" onClick={() => { setActiveModule('Roupas'); setEditingGarment(null) }}><Icon name="sliders" /> Editar roupa</button></div></div>
      </section>

      <aside className="modules-panel panel customizer-library-panel" aria-label="Biblioteca de personalização">
        <div className="modules-topline"><div className="app-wordmark"><span className="wordmark-icon">n</span><span>NYMI<small>ESTÚDIO CRIATIVO</small></span></div></div>
        <div className="customizer-library">
          <div className="customizer-section"><strong>Modelo</strong><label>Escolha o modelo
            <select aria-label="Modelo do personagem" disabled={!selected} value={modelSlot ?? ''} onChange={(event) => updateCharacter((person) => ({ ...person, modelSlot: event.target.value ? Number(event.target.value) : null, poseSlot: 1, equipped: {}, adjustments: {} }))}>
              <option value="">Selecionar modelo</option>
              {models.map((slot) => slot && <option key={slot.slot} value={slot.slot}>{String(slot.slot).padStart(2, '0')} · {slot.name}</option>)}
            </select></label>
            <label>Pose deste modelo<select aria-label="Pose do personagem" disabled={!selected || !modelSlot} value={poseSlot} onChange={(event) => updateCharacter((person) => ({ ...person, poseSlot: Number(event.target.value) }))}>
              {poses.length === 0 && <option value={1}>01 · Montagem original</option>}
              {poses.map((item) => <option key={item.slot} value={item.slot}>{String(item.slot).padStart(2, '0')} · {item.name}</option>)}
            </select></label>
          </div>
          <div className="customizer-tabs">
            <button className={activeModule === 'Corpo' ? 'active' : ''} onClick={() => setActiveModule('Corpo')}>Modelo e poses</button>
            <button className={activeModule === 'Roupas' ? 'active' : ''} onClick={() => setActiveModule('Roupas')}>Roupas</button>
          </div>
          {activeModule === 'Roupas' && <>
            <p className="customizer-helper">Escolha peças individualmente. Cada calça inclui as duas coxas e as duas canelas. Os ajustes aqui pertencem apenas a este personagem.</p>
            {wardrobeGroups.map(({ category, label }) => {
              const options = sets.flatMap((set) => set.components.filter((piece) => piece.category === category).map((component) => ({ set, component })))
              return <div className="customizer-section customizer-garment-group" key={category}>
                <strong>{label}</strong>
                {options.map(({ set, component }) => {
                  const slot = garmentSlot(component)
                  const target = garmentKey(set, component)
                  const isEquipped = selected?.equipped[slot] === target
                  return <div className="customizer-garment-choice" key={target}>
                    <button disabled={!selected} className={isEquipped ? 'equipped' : ''} aria-pressed={isEquipped} onClick={() => {
                      // Shirts, like other garments, replace only the same body-part slot.
                      if (singleCategory(category)) setEditingGarment(target)
                      equip(slot, target)
                    }}><img src={component.dataUrl} alt="" /><span>{component.name}<small>{set.name}</small></span><Icon name={isEquipped ? 'check' : 'plus'} /></button>
                    {isEquipped && <button className="customizer-edit-button" onClick={() => setEditingGarment(target)} title={'Ajustar ' + component.name}>Ajustar</button>}
                  </div>
                })}
                {options.length === 0 && <small>Nenhuma peça cadastrada.</small>}
              </div>
            })}
            <div className="customizer-section customizer-garment-group"><strong>Calças completas</strong>
              {sets.filter((set) => set.components.some((piece) => piece.category === 'calca-coxa') && set.components.some((piece) => piece.category === 'calca-canela')).map((set) => <button key={set.id} className={'customizer-trousers-option' + (selected?.equipped.calca === set.id ? ' equipped' : '')} aria-pressed={selected?.equipped.calca === set.id} onClick={() => { equip('calca', set.id); setEditingGarment(null) }}>{set.name}<small>{set.components.filter((piece) => piece.category.startsWith('calca-')).length} peças · coxas + canelas</small><Icon name={selected?.equipped.calca === set.id ? 'check' : 'plus'} /></button>)}
              {!sets.some((set) => set.components.some((piece) => piece.category === 'calca-coxa')) && <small>Nenhuma calça cadastrada.</small>}
            </div>
            {edited && <div className="customizer-section customizer-garment-adjustments">
              <div className="customizer-adjust-heading"><strong>Ajustar {edited.component.name}</strong><button onClick={() => setEditingGarment(null)}>×</button></div>
              {([
                ['dx', 'Horizontal', -250, 250, 1],
                ['dy', 'Vertical', -250, 250, 1],
                ['scaleX', 'Largura', .25, 3, .01],
                ['scaleY', 'Altura', .25, 3, .01],
                ['rotation', 'Rotação', -180, 180, 1]
              ] as const).map(([field, label, min, max, step]) => <label key={field}>{label}<input aria-label={'Ajustar ' + label} type="range" min={min} max={max} step={step} value={adjustment[field]} onChange={(event) => setAdjustment(edited.key, field, Number(event.target.value))} /><output>{field.startsWith('scale') ? Math.round(adjustment[field] * 100) + '%' : adjustment[field]}</output></label>)}
              <button className="pose-button secondary" onClick={() => updateCharacter((person) => {
                const adjustments = { ...person.adjustments }
                delete adjustments[edited.key]
                return { ...person, adjustments }
              })}>Restaurar ajuste deste personagem</button>
            </div>}
          </>}
          {activeModule === 'Corpo' && <div className="customizer-section"><p>O modelo e a pose acima vêm diretamente do Fabricador Dev. Alterar a pose não modifica o original nem os ajustes de roupa deste personagem.</p></div>}
        </div>
      </aside>
    </div>
  )
}
