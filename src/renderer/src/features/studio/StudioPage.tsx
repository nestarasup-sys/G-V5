import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Icon } from '../../ui/components/Icon'
import { CharacterPortrait } from '../../ui/components/CharacterPortrait'
import type { StudioAsset, StudioDocument, StudioElement } from '../../../../shared/studio'
import type { CustomizerCharacter } from '../../../../shared/customizer'

type StudioCard = StudioDocument
type StudioSnapshot = Pick<StudioDocument, 'backgroundColor' | 'backgroundAssetId' | 'backgroundX' | 'backgroundY' | 'backgroundWidth' | 'backgroundHeight' | 'backgroundRotation' | 'assets' | 'elements'>
type Tool = 'background' | 'objects' | null
type DragState = { id: string; pointerId: number; startX: number; startY: number; originalX: number; originalY: number; width: number; height: number }

const STORAGE_KEY = 'gacha-nymi-studio-catalog-v1'
const studioColor = (number: number) => `hsl(${(number * 137.508) % 360} 45% 78%)`
const studioTools = [
  { id: 'background', label: 'Fundo', icon: 'frame' },
  { id: 'objects', label: 'Objetos', icon: 'sparkles' }
] as const
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

function loadLegacyStudios(): Array<{ id: string; title: string; color: string }> {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(saved)) return []
    return saved.filter((item): item is { id: string; title: string; color: string } => Boolean(item && typeof item === 'object'
      && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.color === 'string'))
  } catch { return [] }
}

function snapshot(studio: StudioDocument): StudioSnapshot {
  return {
    backgroundColor: studio.backgroundColor,
    backgroundAssetId: studio.backgroundAssetId,
    backgroundX: studio.backgroundX,
    backgroundY: studio.backgroundY,
    backgroundWidth: studio.backgroundWidth,
    backgroundHeight: studio.backgroundHeight,
    backgroundRotation: studio.backgroundRotation,
    assets: studio.assets,
    elements: studio.elements
  }
}

function withSnapshot(studio: StudioDocument, next: StudioSnapshot): StudioDocument {
  return { ...studio, ...next, updatedAt: new Date().toISOString() }
}

function makeElement(kind: StudioElement['kind'], zIndex: number): StudioElement {
  return {
    id: crypto.randomUUID(), kind, text: kind === 'narrator' ? 'Texto do narrador' : 'Digite aqui',
    x: 0, y: 0, width: kind === 'narrator' ? 32 : 28, height: kind === 'narrator' ? 12 : 16,
    rotation: 0, zIndex
  }
}

function makeCanvasPrint(studio: StudioDocument): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1920
    canvas.height = 1080
    const context = canvas.getContext('2d')
    if (!context) return reject(new Error('Não foi possível preparar a imagem do print.'))
    context.fillStyle = studio.backgroundColor
    context.fillRect(0, 0, canvas.width, canvas.height)
    const load = (src: string) => new Promise<HTMLImageElement>((ok, fail) => {
      const image = new Image()
      image.onload = () => ok(image)
      image.onerror = () => fail(new Error('Uma imagem da cena não pôde ser carregada para o print.'))
      image.src = src
    })
    const drawImage = async (src: string, x: number, y: number, width: number, height: number, rotation: number) => {
      const image = await load(src)
      context.save()
      context.translate((50 + x) * 19.2, (50 + y) * 10.8)
      context.rotate(rotation * Math.PI / 180)
      context.drawImage(image, -width * 9.6, -height * 5.4, width * 19.2, height * 10.8)
      context.restore()
    }
    const drawText = (element: StudioElement) => {
      const cx = (50 + element.x) * 19.2
      const cy = (50 + element.y) * 10.8
      const width = element.width * 19.2
      const height = element.height * 10.8
      context.save()
      context.translate(cx, cy)
      context.rotate(element.rotation * Math.PI / 180)
      context.fillStyle = element.kind === 'narrator' ? 'rgba(255,255,255,.90)' : 'rgba(255,250,253,.96)'
      context.strokeStyle = '#604b59'
      context.lineWidth = 4
      context.beginPath()
      context.roundRect(-width / 2, -height / 2, width, height, element.kind === 'narrator' ? 20 : height / 2)
      context.fill()
      context.stroke()
      context.fillStyle = '#352d35'
      context.font = `600 ${Math.max(22, Math.round(height * .3))}px sans-serif`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      const words = element.text.split(/\s+/)
      const lines: string[] = []
      let line = ''
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word
        if (context.measureText(candidate).width > width - 36 && line) { lines.push(line); line = word } else line = candidate
      }
      if (line) lines.push(line)
      lines.slice(0, 5).forEach((value, index, values) => context.fillText(value, 0, (index - (values.length - 1) / 2) * Math.max(28, height * .32), width - 30))
      context.restore()
    }
    void (async () => {
      try {
        const bg = studio.assets.find((asset) => asset.id === studio.backgroundAssetId)
        if (bg) await drawImage(bg.dataUrl, studio.backgroundX, studio.backgroundY, studio.backgroundWidth, studio.backgroundHeight, studio.backgroundRotation)
        for (const element of [...studio.elements].sort((a, b) => a.zIndex - b.zIndex)) {
          if (element.kind === 'image' || element.kind === 'character') {
            const asset = studio.assets.find((item) => item.id === element.assetId)
            if (asset) await drawImage(asset.dataUrl, element.x, element.y, element.width, element.height, element.rotation)
          } else drawText(element)
        }
        resolve(canvas.toDataURL('image/png'))
      } catch (reason) { reject(reason) }
    })()
  })
}

export function StudioPage() {
  const [studios, setStudios] = useState<StudioCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [availableCharacters, setAvailableCharacters] = useState<CustomizerCharacter[]>([])
  const [castPickerOpen, setCastPickerOpen] = useState(false)
  const [castSelection, setCastSelection] = useState<string[]>([])
  const [savingCast, setSavingCast] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<'editor' | 'custom'>('editor')
  const [studioFolder, setStudioFolder] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeStudioId, setActiveStudioId] = useState<string | null>(null)
  const [activeTool, setActiveTool] = useState<Tool>(null)
  const [fullView, setFullView] = useState(false)
  const [saved, setSaved] = useState(true)
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [historyVersion, setHistoryVersion] = useState(0)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const sceneRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const undoRef = useRef<StudioSnapshot[]>([])
  const redoRef = useRef<StudioSnapshot[]>([])
  const saveGenerationRef = useRef(0)
  const nextStudioNumber = useRef(1)
  const selectedStudio = studios.find((studio) => studio.id === selectedId) ?? null
  const activeStudio = studios.find((studio) => studio.id === activeStudioId) ?? null
  const selectedElement = activeStudio?.elements.find((element) => element.id === selectedElementId) ?? null
  const selectedBackgroundAsset = activeStudio?.assets.find((asset) => asset.id === activeStudio.backgroundAssetId) ?? null
  const stageCharacters = activeStudio?.elements.filter((element) => element.kind === 'character') ?? []

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const existing = await window.desktop.listStudios()
        const knownIds = new Set(existing.map((studio) => studio.id))
        const legacy = loadLegacyStudios()
        const now = new Date().toISOString()
        for (const old of legacy) {
          if (knownIds.has(old.id) || !isUuid(old.id)) continue
          await window.desktop.saveStudio({
            schemaVersion: 1, ...old, createdAt: now, updatedAt: now, backgroundColor: '#d7b5cd',
            backgroundAssetId: null, backgroundX: 0, backgroundY: 0, backgroundWidth: 100, backgroundHeight: 100,
            backgroundRotation: 0, assets: [], elements: []
          })
        }
        const loaded = await window.desktop.listStudios()
        const folder = await window.desktop.getStudioFolder()
        if (cancelled) return
        setStudios(loaded)
        setStudioFolder(folder)
        if (legacy.length) window.localStorage.removeItem(STORAGE_KEY)
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os Studios.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.desktop.listCustomizerCharacters().then((characters) => {
      if (!cancelled) setAvailableCharacters(characters)
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o elenco de personagens.')
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!activeStudioId) return
    undoRef.current = []
    redoRef.current = []
    setCanUndo(false)
    setCanRedo(false)
    setHistoryVersion((value) => value + 1)
    setSelectedElementId(null)
  }, [activeStudioId])

  const allocateNumber = () => {
    const highest = studios.reduce((max, studio) => Math.max(max, Number(studio.title.match(/^Studio\s+(\d+)/i)?.[1] ?? 0)), 0)
    const number = Math.max(nextStudioNumber.current, highest + 1)
    nextStudioNumber.current = number + 1
    return number
  }

  const createStudio = async () => {
    const number = allocateNumber()
    const now = new Date().toISOString()
    const studio: StudioCard = {
      schemaVersion: 1, id: crypto.randomUUID(), title: `Studio ${String(number).padStart(2, '0')}`,
      color: studioColor(number), createdAt: now, updatedAt: now, backgroundColor: '#d7b5cd',
      backgroundAssetId: null, backgroundX: 0, backgroundY: 0, backgroundWidth: 100, backgroundHeight: 100,
      backgroundRotation: 0, assets: [], elements: []
    }
    try {
      setError(null)
      await window.desktop.saveStudio(studio)
      setStudios((current) => [...current, studio])
      setSelectedId(studio.id)
      setSaved(true)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível criar o Studio.') }
  }

  const duplicateStudio = async (source: StudioCard | null = selectedStudio) => {
    if (!source) return
    const number = allocateNumber()
    const now = new Date().toISOString()
    const duplicate: StudioCard = {
      ...source, id: crypto.randomUUID(), title: `Studio ${String(number).padStart(2, '0')}`,
      color: studioColor(number), createdAt: now, updatedAt: now,
      assets: source.assets.map((asset) => ({ ...asset, id: crypto.randomUUID() })),
      elements: source.elements.map((element) => ({
        ...element, id: crypto.randomUUID(), assetId: element.assetId
          ? source.assets.find((asset) => asset.id === element.assetId)?.id
          : undefined
      }))
    }
    const oldToNew = new Map(source.assets.map((asset, index) => [asset.id, duplicate.assets[index]?.id ?? '']))
    duplicate.elements = source.elements.map((element, index) => ({
      ...duplicate.elements[index], assetId: element.assetId ? oldToNew.get(element.assetId) : undefined
    }))
    duplicate.backgroundAssetId = source.backgroundAssetId ? oldToNew.get(source.backgroundAssetId) ?? null : null
    try {
      setError(null)
      await window.desktop.saveStudio(duplicate)
      setStudios((current) => [...current, duplicate])
      setSelectedId(duplicate.id)
      setSaved(true)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível duplicar o Studio.') }
  }

  const saveStudio = useCallback(async (document = activeStudio) => {
    if (!document) return true
    const generation = ++saveGenerationRef.current
    try {
      await window.desktop.saveStudio({ ...document, updatedAt: new Date().toISOString() })
      if (generation === saveGenerationRef.current) {
        setSaved(true)
        setError(null)
      }
      return true
    } catch (reason) {
      if (generation === saveGenerationRef.current) setError(reason instanceof Error ? reason.message : 'Não foi possível salvar o Studio neste dispositivo.')
      return false
    }
  }, [activeStudio])

  useEffect(() => {
    if (!activeStudio) return
    setSaved(false)
    const timer = window.setTimeout(() => { void saveStudio(activeStudio) }, 650)
    return () => window.clearTimeout(timer)
  }, [activeStudio, saveStudio])

  const patchStudio = (transform: (studio: StudioDocument) => StudioDocument) => {
    if (!activeStudioId) return
    setStudios((current) => current.map((studio) => studio.id === activeStudioId ? transform(studio) : studio))
    setSaved(false)
  }

  const recordHistory = () => {
    if (!activeStudio) return
    undoRef.current = [...undoRef.current.slice(-29), snapshot(activeStudio)]
    redoRef.current = []
    setCanUndo(undoRef.current.length > 0)
    setCanRedo(false)
    setHistoryVersion((value) => value + 1)
  }

  const changeScene = (transform: (studio: StudioDocument) => StudioDocument) => {
    if (!activeStudio) return
    recordHistory()
    patchStudio((studio) => transform(studio))
  }

  const undo = () => {
    if (!activeStudio || !undoRef.current.length) return
    const previous = undoRef.current[undoRef.current.length - 1]
    undoRef.current = undoRef.current.slice(0, -1)
    redoRef.current = [...redoRef.current.slice(-29), snapshot(activeStudio)]
    patchStudio((studio) => withSnapshot(studio, previous))
    setCanUndo(undoRef.current.length > 0)
    setCanRedo(true)
    setHistoryVersion((value) => value + 1)
  }

  const redo = () => {
    if (!activeStudio || !redoRef.current.length) return
    const next = redoRef.current[redoRef.current.length - 1]
    redoRef.current = redoRef.current.slice(0, -1)
    undoRef.current = [...undoRef.current.slice(-29), snapshot(activeStudio)]
    patchStudio((studio) => withSnapshot(studio, next))
    setCanUndo(true)
    setCanRedo(redoRef.current.length > 0)
    setHistoryVersion((value) => value + 1)
  }

  const importImage = async (category: StudioAsset['category']) => {
    if (!activeStudio) return
    try {
      const asset = await window.desktop.importStudioImage(category)
      if (!asset) return
      const nextAssets = [...activeStudio.assets, asset]
      recordHistory()
      if (category === 'background') {
        patchStudio((studio) => ({ ...studio, assets: nextAssets, backgroundAssetId: asset.id, backgroundX: 0, backgroundY: 0, backgroundWidth: 100, backgroundHeight: 100, backgroundRotation: 0, updatedAt: new Date().toISOString() }))
        setSelectedElementId('background')
      } else {
        const element: StudioElement = { id: crypto.randomUUID(), kind: 'image', assetId: asset.id, text: '', x: 0, y: 0, width: 25, height: 25, rotation: 0, zIndex: Math.max(0, ...activeStudio.elements.map((item) => item.zIndex)) + 1 }
        patchStudio((studio) => ({ ...studio, assets: nextAssets, elements: [...studio.elements, element], updatedAt: new Date().toISOString() }))
        setSelectedElementId(element.id)
      }
      setActiveTool(category === 'background' ? 'background' : 'objects')
      setError(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível importar a imagem.') }
  }

  const selectBackground = (asset: StudioAsset) => {
    changeScene((studio) => ({ ...studio, backgroundAssetId: asset.id, backgroundX: 0, backgroundY: 0, backgroundWidth: 100, backgroundHeight: 100, backgroundRotation: 0, updatedAt: new Date().toISOString() }))
    setSelectedElementId('background')
  }

  const addTextElement = (kind: 'narrator' | 'speech' | 'thought') => {
    if (!activeStudio) return
    const element = makeElement(kind, Math.max(0, ...activeStudio.elements.map((item) => item.zIndex)) + 1)
    changeScene((studio) => ({ ...studio, elements: [...studio.elements, element], updatedAt: new Date().toISOString() }))
    setSelectedElementId(element.id)
  }

  const openCastPicker = () => {
    setCastSelection(stageCharacters.map((element) => element.characterId).filter((id): id is string => Boolean(id)))
    setCastPickerOpen(true)
  }

  const saveCastSelection = async () => {
    if (!activeStudio || savingCast) return
    setSavingCast(true)
    try {
      const selectedIds = new Set(castSelection)
      const retained = activeStudio.elements.filter((element) => element.kind !== 'character' || !element.characterId || selectedIds.has(element.characterId))
      const removedCharacterAssetIds = new Set(activeStudio.elements.filter((element) => element.kind === 'character' && element.characterId && !selectedIds.has(element.characterId)).map((element) => element.assetId).filter((id): id is string => Boolean(id)))
      const retainedCharacters = new Set(retained.filter((element) => element.kind === 'character').map((element) => element.characterId))
      const additions = availableCharacters.filter((character) => selectedIds.has(character.id) && !retainedCharacters.has(character.id))
      const { renderSavedCharacter } = await import('../customizer/CustomizerPage')
      const assets: StudioAsset[] = []
      const elements: StudioElement[] = []
      const stageWidth = sceneRef.current?.clientWidth ?? 1000
      const stageHeight = sceneRef.current?.clientHeight ?? 562
      let zIndex = Math.max(0, ...retained.map((item) => item.zIndex))
      for (const character of additions) {
        const rendered = await renderSavedCharacter(character)
        const asset: StudioAsset = { id: crypto.randomUUID(), category: 'character', name: character.name, mimeType: 'image/png', dataUrl: rendered.dataUrl }
        const width = 20
        const height = Math.min(82, width * stageWidth / stageHeight * rendered.height / rendered.width)
        assets.push(asset)
        elements.push({ id: crypto.randomUUID(), kind: 'character', assetId: asset.id, characterId: character.id, text: character.name, x: 0, y: 0, width, height, rotation: 0, zIndex: ++zIndex })
      }
      const nextElements = [...retained, ...elements]
      const retainedAssetIds = new Set(retained.map((element) => element.assetId).filter((id): id is string => Boolean(id)))
      changeScene((studio) => ({
        ...studio,
        elements: nextElements,
        assets: [...studio.assets.filter((asset) => !removedCharacterAssetIds.has(asset.id) || retainedAssetIds.has(asset.id)), ...assets],
        updatedAt: new Date().toISOString()
      }))
      setCastPickerOpen(false)
      setActiveTool(null)
      setInspectorTab('editor')
      setSelectedElementId(elements.at(-1)?.id ?? null)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o elenco do Studio.')
    } finally { setSavingCast(false) }
  }

  const removeStageCharacter = (element: StudioElement) => {
    changeScene((studio) => {
      const elements = studio.elements.filter((item) => item.id !== element.id)
      const stillUsed = new Set(elements.map((item) => item.assetId).filter(Boolean))
      return {
        ...studio, elements,
        assets: studio.assets.filter((asset) => asset.id !== element.assetId || stillUsed.has(asset.id)),
        updatedAt: new Date().toISOString()
      }
    })
    if (selectedElementId === element.id) setSelectedElementId(null)
  }

  const updateElement = (id: string, values: Partial<StudioElement>, record = true) => {
    const update = (studio: StudioDocument) => ({ ...studio, elements: studio.elements.map((element) => element.id === id ? { ...element, ...values } : element), updatedAt: new Date().toISOString() })
    if (record) changeScene(update)
    else patchStudio(update)
  }

  const updateBackground = (values: Partial<Pick<StudioDocument, 'backgroundColor' | 'backgroundX' | 'backgroundY' | 'backgroundWidth' | 'backgroundHeight' | 'backgroundRotation'>>) => {
    changeScene((studio) => ({ ...studio, ...values, updatedAt: new Date().toISOString() }))
  }

  const startDrag = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (!activeStudio || !sceneRef.current) return
    event.preventDefault()
    event.stopPropagation()
    if (id === 'background') {
      const rect = sceneRef.current.getBoundingClientRect()
      recordHistory()
      setSelectedElementId('background')
      setActiveTool('background')
      dragRef.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originalX: activeStudio.backgroundX, originalY: activeStudio.backgroundY, width: rect.width, height: rect.height }
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    const element = activeStudio.elements.find((item) => item.id === id)
    if (!element) return
    const rect = sceneRef.current.getBoundingClientRect()
    recordHistory()
    setSelectedElementId(id)
    setActiveTool(null)
    dragRef.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originalX: element.x, originalY: element.y, width: rect.width, height: rect.height }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const x = drag.originalX + (event.clientX - drag.startX) / drag.width * 100
    const y = drag.originalY + (event.clientY - drag.startY) / drag.height * 100
    if (drag.id === 'background') patchStudio((studio) => ({ ...studio, backgroundX: x, backgroundY: y, updatedAt: new Date().toISOString() }))
    else updateElement(drag.id, { x, y }, false)
  }

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
  }

  const deleteSelected = () => {
    if (!activeStudio) return
    if (selectedElementId === 'background') {
      changeScene((studio) => ({ ...studio, backgroundAssetId: null, updatedAt: new Date().toISOString() }))
      setSelectedElementId(null)
    } else if (selectedElementId) {
      const current = activeStudio.elements.find((element) => element.id === selectedElementId)
      if (current?.kind === 'character') removeStageCharacter(current)
      else changeScene((studio) => ({ ...studio, elements: studio.elements.filter((element) => element.id !== selectedElementId), updatedAt: new Date().toISOString() }))
      setSelectedElementId(null)
    }
  }

  const deleteStudio = async (target: StudioCard | null = selectedStudio) => {
    if (!target || !window.confirm(`Excluir ${target.title}?`)) return
    try {
      await window.desktop.deleteStudio(target.id)
      setStudios((current) => current.filter((studio) => studio.id !== target.id))
      setSelectedId((current) => current === target.id ? null : current)
      setSaved(true)
      setError(null)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível excluir o Studio.') }
  }

  const leaveStudio = async () => {
    if (!await saveStudio(activeStudio)) return
    setActiveStudioId(null)
    setActiveTool(null)
    setSelectedElementId(null)
    setFullView(false)
  }

  const exportPrint = async () => {
    if (!activeStudio) return
    try {
      if (!await saveStudio(activeStudio)) return
      const image = await makeCanvasPrint(activeStudio)
      const path = await window.desktop.saveStudioPrint(activeStudio.id, image)
      if (path) { setError(null); setNotice(`Print salvo em ${path}`) }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível gerar o print.') }
  }

  const openPrints = async () => {
    if (!activeStudio) return
    try { await window.desktop.openStudioPrints(activeStudio.id) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível abrir a pasta de prints.') }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && castPickerOpen && !savingCast) setCastPickerOpen(false)
      else if (event.key === 'Escape' && fullView) setFullView(false)
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [castPickerOpen, savingCast, fullView, activeStudio, historyVersion])

  const imageStyle = (x: number, y: number, width: number, height: number, rotation: number) => ({
    left: `calc(50% + ${x}%)`, top: `calc(50% + ${y}%)`, width: `${width}%`, height: `${height}%`,
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`
  })

  const control = (label: string, value: number, onChange: (value: number) => void, min: number, max: number, suffix = '%') => (
    <label className="studio-control" key={label}><span>{label}</span><input type="number" value={Number(value.toFixed(1))} min={min} max={max} step="1" onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value) || 0)))} /><small>{suffix}</small></label>
  )

  const propertyPanel = (): ReactNode => {
    if (!activeStudio) return null
    if (activeTool === 'background') return <div className="studio-side-content">
      <h2>Fundos</h2><p>Escolha um fundo salvo ou adicione uma imagem.</p>
      <label className="studio-color-control">Cor sólida<input type="color" value={activeStudio.backgroundColor} onChange={(event) => updateBackground({ backgroundColor: event.target.value })} /></label>
      <button className="studio-side-primary" type="button" onClick={() => void importImage('background')}><Icon name="plus" />Adicionar imagem</button>
      <div className="studio-asset-grid">{activeStudio.assets.filter((asset) => asset.category === 'background').map((asset) => <button key={asset.id} className={`studio-asset-card${activeStudio.backgroundAssetId === asset.id ? ' active' : ''}`} type="button" onClick={() => selectBackground(asset)}><img src={asset.dataUrl} alt="" /><span>{asset.name}</span></button>)}</div>
      {selectedBackgroundAsset && selectedElementId === 'background' && <div className="studio-controls-grid">{control('X', activeStudio.backgroundX, (value) => updateBackground({ backgroundX: value }), -100, 100)}{control('Y', activeStudio.backgroundY, (value) => updateBackground({ backgroundY: value }), -100, 100)}{control('Largura', activeStudio.backgroundWidth, (value) => updateBackground({ backgroundWidth: value }), 1, 300)}{control('Altura', activeStudio.backgroundHeight, (value) => updateBackground({ backgroundHeight: value }), 1, 300)}{control('Rotação', activeStudio.backgroundRotation, (value) => updateBackground({ backgroundRotation: value }), -180, 180, '°')}</div>}
    </div>
    if (activeTool === 'objects') return <div className="studio-side-content">
      <h2>Objetos</h2><p>Imagens importadas ficam disponíveis neste Studio.</p>
      <button className="studio-side-primary" type="button" onClick={() => void importImage('object')}><Icon name="plus" />Importar imagem</button>
      <div className="studio-asset-grid">{activeStudio.assets.filter((asset) => asset.category === 'object').map((asset) => <button key={asset.id} className="studio-asset-card" type="button" onClick={() => {
        const element: StudioElement = { id: crypto.randomUUID(), kind: 'image', assetId: asset.id, text: '', x: 0, y: 0, width: 25, height: 25, rotation: 0, zIndex: Math.max(0, ...activeStudio.elements.map((item) => item.zIndex)) + 1 }
        changeScene((studio) => ({ ...studio, elements: [...studio.elements, element], updatedAt: new Date().toISOString() }))
        setSelectedElementId(element.id)
      }}><img src={asset.dataUrl} alt="" /><span>{asset.name}</span></button>)}</div>
      {selectedElementId && selectedElement && <ElementControls element={selectedElement} update={(values) => updateElement(selectedElement.id, values)} remove={deleteSelected} control={control} />}
    </div>
    if (selectedElement && activeStudio) return <div className="studio-side-content">
      <h2>{selectedElement.kind === 'character' ? selectedElement.text : selectedElement.kind === 'image' ? 'Objeto selecionado' : selectedElement.kind === 'narrator' ? 'Narrador' : selectedElement.kind === 'speech' ? 'Balão de fala' : 'Balão de pensamento'}</h2>
      {selectedElement.kind !== 'image' && selectedElement.kind !== 'character' && <label className="studio-text-control">Texto<textarea value={selectedElement.text} onChange={(event) => updateElement(selectedElement.id, { text: event.target.value })} rows={3} /></label>}
      <ElementControls element={selectedElement} update={(values) => updateElement(selectedElement.id, values)} remove={deleteSelected} control={control} />
    </div>
    if (selectedElementId === 'background' && selectedBackgroundAsset) return <div className="studio-side-content">
      <h2>Imagem de fundo</h2><p>{selectedBackgroundAsset.name}</p>
      <div className="studio-controls-grid">{control('X', activeStudio.backgroundX, (value) => updateBackground({ backgroundX: value }), -100, 100)}{control('Y', activeStudio.backgroundY, (value) => updateBackground({ backgroundY: value }), -100, 100)}{control('Largura', activeStudio.backgroundWidth, (value) => updateBackground({ backgroundWidth: value }), 1, 300)}{control('Altura', activeStudio.backgroundHeight, (value) => updateBackground({ backgroundHeight: value }), 1, 300)}{control('Rotação', activeStudio.backgroundRotation, (value) => updateBackground({ backgroundRotation: value }), -180, 180, '°')}</div>
      <button className="studio-side-danger" type="button" onClick={deleteSelected}><Icon name="trash" />Remover fundo</button>
    </div>
    return <div className="studio-side-content"><h2>Cena</h2><p>Escolha uma ferramenta à esquerda ou selecione um elemento na cena.</p><small>{activeStudio.elements.length} elemento(s)</small></div>
  }

  const castPanel = () => <div className="studio-cast-content">
    <header><span><h2>Elenco</h2><small>{stageCharacters.length} na cena</small></span><button className="studio-cast-add-button" onClick={openCastPicker} type="button"><Icon name="plus" />Adicionar</button></header>
    <section className="studio-cast-section" aria-label="Personagens na cena">
      <h3>Na cena</h3>
      {stageCharacters.length ? stageCharacters.map((element) => {
        const character = availableCharacters.find((item) => item.id === element.characterId)
        return <article className={`studio-cast-item${selectedElementId === element.id ? ' selected' : ''}`} key={element.id}>
          <button className="studio-cast-select" onClick={() => { setSelectedElementId(element.id); setActiveTool(null); setInspectorTab('editor') }} type="button">
            {character ? <CharacterPortrait character={character} /> : <span className="studio-cast-fallback">{element.text.slice(0, 1)}</span>}
            <span>{element.text}</span>
          </button>
          <button className="studio-cast-remove" onClick={() => removeStageCharacter(element)} aria-label={`Remover ${element.text} do elenco`} title="Remover da cena" type="button">×</button>
        </article>
      }) : <p className="studio-cast-empty">Adicione personagens para montar a cena.</p>}
    </section>
  </div>

  if (activeStudio) {
    const backgroundAsset = activeStudio.assets.find((asset) => asset.id === activeStudio.backgroundAssetId)
    const inspectorWidth = sceneRef.current ? Math.min(38, 276 / sceneRef.current.clientWidth * 100) : 28
    const selectedBounds = selectedElement
      ? { left: 50 + selectedElement.x - selectedElement.width / 2, right: 50 + selectedElement.x + selectedElement.width / 2 }
      : selectedElementId === 'background'
        ? { left: 50 + activeStudio.backgroundX - activeStudio.backgroundWidth / 2, right: 50 + activeStudio.backgroundX + activeStudio.backgroundWidth / 2 }
        : null
    const inspectorSide = selectedBounds?.right !== undefined && selectedBounds.right > 100 - inspectorWidth
      ? 'left'
      : selectedBounds?.left !== undefined && selectedBounds.left < inspectorWidth ? 'right' : 'right'
    return (
      <main className={`studio-editor${fullView ? ' full-view' : ''}`} aria-label={`Editor do ${activeStudio.title}`}>
        {!fullView && <aside className="studio-editor-rail studio-editor-left" aria-label="Ferramentas do Studio">
          <div className="studio-editor-quick-actions">
            <button className="studio-round-action" onClick={() => void leaveStudio()} title="Salvar automaticamente e voltar" aria-label="Voltar para Seus Studios" type="button"><span>←</span></button>
            <button className="studio-round-action" onClick={() => void saveStudio(activeStudio)} title="Salvar agora no computador" aria-label="Salvar Studio" type="button"><Icon name="save" /></button>
          </div>
          <div className="studio-editor-quick-actions studio-history-actions">
            <button className="studio-round-action" disabled={!canUndo} onClick={undo} title="Desfazer (Ctrl+Z)" aria-label="Desfazer" type="button"><Icon name="undo" /></button>
            <button className="studio-round-action" disabled={!canRedo} onClick={redo} title="Refazer (Ctrl+Y)" aria-label="Refazer" type="button"><Icon name="redo" /></button>
          </div>
          <nav className="studio-tool-list" aria-label="Ferramentas da cena">
            {studioTools.map((tool) => <button className={`studio-tool-button${activeTool === tool.id ? ' active' : ''}`} key={tool.id} onClick={() => setActiveTool(tool.id)} type="button"><Icon name={tool.icon} /><span>{tool.label}</span><i aria-hidden="true">✦</i></button>)}
            <button className="studio-tool-button" onClick={() => addTextElement('narrator')} type="button"><Icon name="message" /><span>Narrador</span><i aria-hidden="true">✦</i></button>
            <button className="studio-tool-button" onClick={() => addTextElement('speech')} type="button"><Icon name="message" /><span>Fala</span><i aria-hidden="true">✦</i></button>
            <button className="studio-tool-button" onClick={() => addTextElement('thought')} type="button"><Icon name="face" /><span>Pensamento</span><i aria-hidden="true">✦</i></button>
            <span className="studio-tool-separator" />
            <button className="studio-tool-button" onClick={() => void exportPrint()} type="button"><Icon name="download" /><span>Print</span><i aria-hidden="true">✦</i></button>
            <button className="studio-tool-button" onClick={() => void openPrints()} type="button"><Icon name="folder" /><span>Pasta</span><i aria-hidden="true">✦</i></button>
            <button className="studio-tool-button studio-view-button" onClick={() => setFullView(true)} type="button"><Icon name="expand" /><span>View</span></button>
          </nav>
          <small className={`studio-save-indicator${saved ? '' : ' unsaved'}`}><i />{saved ? 'Salvo automaticamente' : 'Salvando alterações…'}</small>
          {error && <small className="studio-error-message" role="alert">{error}</small>}
          {notice && <small className="studio-save-notice" role="status">{notice}</small>}
        </aside>}
        <section className="studio-scene-area" aria-label="Prévia da cena">
          <div className="studio-scene-canvas" ref={sceneRef} style={{ backgroundColor: activeStudio.backgroundColor }} onPointerDown={() => setSelectedElementId(null)}>
            {backgroundAsset && <img className={`studio-canvas-background${selectedElementId === 'background' && !fullView ? ' selected' : ''}`} src={backgroundAsset.dataUrl} alt="" style={imageStyle(activeStudio.backgroundX, activeStudio.backgroundY, activeStudio.backgroundWidth, activeStudio.backgroundHeight, activeStudio.backgroundRotation)} onPointerDown={(event) => startDrag(event, 'background')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />}
            {[...activeStudio.elements].sort((a, b) => a.zIndex - b.zIndex).map((element) => {
              const asset = element.assetId ? activeStudio.assets.find((item) => item.id === element.assetId) : undefined
              return <div key={element.id} className={`studio-canvas-element studio-element-${element.kind}${selectedElementId === element.id && !fullView ? ' selected' : ''}`} style={{ ...imageStyle(element.x, element.y, element.width, element.height, element.rotation), zIndex: element.zIndex + 1 }} onPointerDown={(event) => startDrag(event, element.id)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
                {(element.kind === 'image' || element.kind === 'character') && asset ? <img src={asset.dataUrl} alt={asset.name} draggable={false} /> : <span>{element.text}</span>}
              </div>
            })}
            {fullView && <button className="studio-exit-view" onClick={() => setFullView(false)} type="button">Sair da visualização <kbd>Esc</kbd></button>}
            {!fullView && <span className="studio-scene-title">{activeStudio.title}</span>}
            {!fullView && <aside className={`studio-inspector studio-inspector-${inspectorSide}`} aria-label="Inspector da cena">
              <header className="studio-inspector-tabs"><button className={inspectorTab === 'editor' ? 'active' : ''} onClick={() => setInspectorTab('editor')} type="button">Editor</button><button className={inspectorTab === 'custom' ? 'active' : ''} onClick={() => setInspectorTab('custom')} type="button">Custom</button></header>
              {inspectorTab === 'editor' ? <div className="studio-inspector-content">{propertyPanel()}</div> : <div className="studio-inspector-empty" />}
            </aside>}
          </div>
        </section>
        {!fullView && <aside className="studio-editor-rail studio-editor-right" aria-label="Elenco do Studio">{castPanel()}</aside>}
        {castPickerOpen && <div className="studio-cast-modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !savingCast) setCastPickerOpen(false) }}>
          <section className="studio-cast-modal" role="dialog" aria-modal="true" aria-labelledby="studio-cast-modal-title">
            <header><span><small>EDITAR ELENCO</small><h2 id="studio-cast-modal-title">Personagens do Studio</h2></span><button className="studio-cast-modal-close" onClick={() => setCastPickerOpen(false)} aria-label="Fechar" disabled={savingCast} type="button">×</button></header>
            <div className="studio-cast-modal-summary"><strong>Escolha os personagens</strong><span>{castSelection.length} selecionado{castSelection.length === 1 ? '' : 's'}</span></div>
            <div className="studio-cast-modal-list">
              {availableCharacters.length ? availableCharacters.map((character) => {
                const selected = castSelection.includes(character.id)
                return <button className={`studio-cast-modal-option${selected ? ' selected' : ''}`} key={character.id} onClick={() => setCastSelection((current) => selected ? current.filter((id) => id !== character.id) : [...current, character.id])} disabled={savingCast} type="button">
                  <CharacterPortrait character={character} /><strong>{character.name}</strong><i>{selected ? '✓' : '+'}</i>
                </button>
              }) : <p className="studio-cast-modal-empty">Crie personagens em Customizar para adicioná-los ao elenco.</p>}
            </div>
            <footer><button className="studio-cast-modal-cancel" onClick={() => setCastPickerOpen(false)} disabled={savingCast} type="button">Cancelar</button><button className="studio-cast-modal-save" onClick={() => void saveCastSelection()} disabled={savingCast} type="button">{savingCast ? 'Salvando…' : 'Salvar elenco'}</button></footer>
          </section>
        </div>}
      </main>
    )
  }

  return (
    <main className="studio-page" aria-label="Studio">
      <header className="studio-page-header"><h1>Seus Studios</h1>{studioFolder && <small>Dados locais: {studioFolder}</small>}</header>
      <div className="studio-toolbar" aria-label="Ações dos Studios">
        <button className="studio-action studio-action-primary" onClick={() => void createStudio()} disabled={loading} type="button"><Icon name="plus" />Criar</button>
      </div>
      {error && <p className="studio-error-message" role="alert">{error}</p>}
      {loading ? <section className="studio-empty-state"><strong>Carregando Studios…</strong></section> : studios.length ? (
        <section className="studio-grid" aria-label="Studios criados">
          {studios.map((studio) => <article className={`studio-card${selectedId === studio.id ? ' selected' : ''}`} key={studio.id}>
            <header className="studio-card-heading"><button className="studio-card-open" onClick={() => { setSelectedId(studio.id); setActiveStudioId(studio.id) }} aria-label={`Abrir ${studio.title}`} type="button">{studio.title}</button><div className="studio-card-actions"><button className="studio-card-action" onClick={() => void duplicateStudio(studio)} aria-label={`Duplicar ${studio.title}`} title={`Duplicar ${studio.title}`} type="button"><span className="studio-duplicate-icon" aria-hidden="true">▢</span></button><button className="studio-card-action danger" onClick={() => void deleteStudio(studio)} aria-label={`Excluir ${studio.title}`} title={`Excluir ${studio.title}`} type="button"><Icon name="trash" /></button></div></header>
            <button className="studio-cover" style={{ backgroundColor: studio.color }} onClick={() => { setSelectedId(studio.id); setActiveStudioId(studio.id) }} aria-label={`Abrir ${studio.title}`} type="button" />
          </article>)}
        </section>
      ) : <section className="studio-empty-state"><span><Icon name="camera" /></span><strong>Nenhum Studio criado</strong><small>Crie um Studio para começar sua coleção.</small></section>}
    </main>
  )
}

function ElementControls({ element, update, remove, control }: {
  element: StudioElement
  update: (values: Partial<StudioElement>) => void
  remove: () => void
  control: (label: string, value: number, onChange: (value: number) => void, min: number, max: number, suffix?: string) => ReactNode
}) {
  return <>
    <div className="studio-controls-grid">
      {control('X', element.x, (value) => update({ x: value }), -100, 100)}
      {control('Y', element.y, (value) => update({ y: value }), -100, 100)}
      {control('Largura', element.width, (value) => update({ width: value }), 1, 200)}
      {control('Altura', element.height, (value) => update({ height: value }), 1, 200)}
      {control('Rotação', element.rotation, (value) => update({ rotation: value }), -180, 180, '°')}
    </div>
    {(element.kind === 'image' || element.kind === 'character') && <div className="studio-layer-actions"><button type="button" onClick={() => update({ zIndex: element.zIndex + 1 })}>Trazer para frente</button><button type="button" onClick={() => update({ zIndex: Math.max(0, element.zIndex - 1) })}>Enviar para trás</button></div>}
    <button className="studio-side-danger" type="button" onClick={remove}><Icon name="trash" />Excluir da cena</button>
  </>
}
