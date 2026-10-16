import { useEffect, useMemo, useRef, useState } from 'react'
import { CharacterPortrait } from '../../ui/components/CharacterPortrait'
import { Icon, type IconName } from '../../ui/components/Icon'
import type { FaceCatalogItem, FaceCatalogItemSummary, FaceComponentAsset, FaceComponentAssetSummary, FaceComponentKind, FaceDetailKind, FaceElementKind, FaceSet, FaceSheetKind, FabricatorPose, FabricatorPoseSummary, FabricatorProject, FabricatorSlotSummary, HairStyle, HairStyleSummary, WardrobeCategory, WardrobeSet, WardrobeSetSummary } from '../../../../shared/fabricator'
import { resolvePoseCategory } from '../../../../shared/fabricator'
import type { CustomizerCharacter, CustomizerFaceAppearance, CustomizerWardrobeCategory, CustomizerWardrobeGroup, FaceComponentPartId, HairColorOverrides, HairColorRole, HairPartId } from '../../../../shared/customizer'
import { characterBodyDimensionLimits, characterProportionLimits, defaultCharacterBodyDimensions, defaultCharacterProportions, getCharacterBodyDimensions, getCharacterProportions, type CharacterBodyDimensions, type CharacterProportions } from '../../../../shared/customizer'
import type { StudioFaceTransforms } from '../../../../shared/studio'
import { usePreviewBackground } from '../fabricator/usePreviewBackground'
import { DesignBanner } from '../fabricator/DesignWorkspace'
import { mapWardrobeComponentToPose } from '../fabricator/wardrobe/poseTransform'
import { eyeInteriorMask } from '../fabricator/face/eyeInteriorMask'
import { applyCharacterBodyShape } from './bodyShape'
import { tintSkinPixels } from './skinTint'

type CatalogArtwork = Pick<FabricatorProject, 'width' | 'height' | 'parts' | 'layerOrder' | 'hiddenPartIds'> & Partial<Pick<FabricatorProject, 'joints'>>
function withCharacterHeadSize(artwork: CatalogArtwork, proportions: CharacterProportions): CatalogArtwork {
  const scaleX = proportions.head * proportions.headWidth / 10000
  const scaleY = proportions.head * proportions.headHeight / 10000
  if (scaleX === 1 && scaleY === 1) return artwork
  const head = artwork.parts.find((part) => /cabe[çc]a|head/i.test(part.name))
  if (!head) return artwork
  return {
    ...artwork,
    parts: artwork.parts.map((part) => part.id === head.id ? {
      ...part,
      x: part.x - (part.width * scaleX - part.width) / 2,
      y: part.y - (part.height * scaleY - part.height),
      width: part.width * scaleX,
      height: part.height * scaleY
    } : part)
  }
}

function characterShapeScale(proportions: CharacterProportions): { x: number; y: number } {
  return { x: proportions.scale * proportions.width / 10000, y: proportions.scale * proportions.height / 10000 }
}
const wardrobeImageCache = new Map<string, Promise<HTMLImageElement>>()
const skinTintImageCache = new Map<string, Promise<HTMLImageElement>>()
const hairTintImageCache = new Map<string, Promise<HTMLImageElement>>()
const hairPreviewImageCache = new Map<string, Promise<string>>()
const faceComponentAssetCache = new Map<string, Promise<FaceComponentAsset | null>>()
const hairColorControls: Array<{ id: HairColorRole; label: string; fallback: string }> = [
  { id: 'base', label: 'Cor base', fallback: '#9b563e' },
  { id: 'fade', label: 'Degradê', fallback: '#633b37' },
  { id: 'outline', label: 'Contorno', fallback: '#392b33' },
  { id: 'highlight', label: 'Luzes', fallback: '#e5ad83' },
  { id: 'accent', label: 'Acessório', fallback: '#cf6391' }
]
const hairPalettePresets: Array<{ name: string; colors: HairColorOverrides }> = [
  { name: 'Castanho', colors: { base: '#8e4b35', fade: '#613525', outline: '#33221f', highlight: '#c68156', accent: '#c0638e' } },
  { name: 'Loiro', colors: { base: '#d6b46e', fade: '#a8844b', outline: '#59422e', highlight: '#f4dea0', accent: '#db9c73' } },
  { name: 'Preto', colors: { base: '#343b49', fade: '#242733', outline: '#14151d', highlight: '#78889b', accent: '#a55a83' } },
  { name: 'Fantasia', colors: { base: '#8756b7', fade: '#593f88', outline: '#302548', highlight: '#c997df', accent: '#e480ae' } },
  { name: 'Chocolate', colors: { base: '#674433', fade: '#452e29', outline: '#261d1b', highlight: '#a27a55', accent: '#c28d5e' } },
  { name: 'Cobre', colors: { base: '#b55a36', fade: '#783526', outline: '#40221e', highlight: '#e99661', accent: '#e5b67e' } },
  { name: 'Ruivo', colors: { base: '#c65430', fade: '#86311f', outline: '#48251f', highlight: '#ed985b', accent: '#e7c382' } },
  { name: 'Mel', colors: { base: '#b78345', fade: '#7d5734', outline: '#473324', highlight: '#e5b96e', accent: '#f1d595' } },
  { name: 'Platinado', colors: { base: '#d5d0c9', fade: '#9f9ba4', outline: '#555467', highlight: '#f3eee5', accent: '#e9d3df' } },
  { name: 'Branco', colors: { base: '#e0e2eb', fade: '#a7acbf', outline: '#54586f', highlight: '#fafaff', accent: '#c5d9ee' } },
  { name: 'Cinza', colors: { base: '#8c919c', fade: '#5b6272', outline: '#303543', highlight: '#c2c7d3', accent: '#9eacc5' } },
  { name: 'Azul noite', colors: { base: '#3e5688', fade: '#29375e', outline: '#1b2340', highlight: '#7996c4', accent: '#a2c8ed' } },
  { name: 'Céu', colors: { base: '#63a9d5', fade: '#3d79a8', outline: '#294866', highlight: '#b8dff1', accent: '#d0edf5' } },
  { name: 'Menta', colors: { base: '#70bea9', fade: '#408c83', outline: '#275457', highlight: '#c2e9cf', accent: '#e1f3dd' } },
  { name: 'Rosa', colors: { base: '#d778ac', fade: '#a65080', outline: '#68344f', highlight: '#f3b5d3', accent: '#f5d9e5' } },
  { name: 'Vinho', colors: { base: '#8d3f62', fade: '#5e2b49', outline: '#341d32', highlight: '#c4799e', accent: '#e1a6b9' } },
  { name: 'Lilás', colors: { base: '#ad88cf', fade: '#7961a5', outline: '#493b70', highlight: '#dcc3ed', accent: '#f1d9ee' } },
  { name: 'Pêssego', colors: { base: '#e89c88', fade: '#bb6b67', outline: '#70404c', highlight: '#ffd2ad', accent: '#f4baca' } },
  { name: 'Verde musgo', colors: { base: '#6e8556', fade: '#4a633e', outline: '#2c4130', highlight: '#a9bc7b', accent: '#d6d0a3' } },
  { name: 'Turquesa', colors: { base: '#399f9e', fade: '#2a7079', outline: '#204753', highlight: '#8bd8cf', accent: '#c0eee1' } }
]
const faceElementOrder: FaceElementKind[] = ['brow-left', 'brow-right', 'eye-left', 'eye-right', 'nose', 'mouth']
type FaceLibraryPartId = FaceComponentPartId
const customizerFaceParts: Array<{ id: FaceLibraryPartId; label: string; category: FaceComponentKind; element?: 'eye-left' | 'eye-right' | 'brow-left' | 'brow-right'; side: 'left' | 'right' }> = [
  { id: 'eye-left', label: 'Olho esquerdo', category: 'eye', element: 'eye-left', side: 'left' },
  { id: 'eye-right', label: 'Olho direito', category: 'eye', element: 'eye-right', side: 'right' },
  { id: 'pupil-left', label: 'Pupila esquerda', category: 'pupil', side: 'left' },
  { id: 'pupil-right', label: 'Pupila direita', category: 'pupil', side: 'right' },
  { id: 'brow-left', label: 'Sobrancelha esquerda', category: 'eyebrow', element: 'brow-left', side: 'left' },
  { id: 'brow-right', label: 'Sobrancelha direita', category: 'eyebrow', element: 'brow-right', side: 'right' }
]
const facePartColorControls: Array<{ id: HairColorRole; label: string; fallback: string }> = [
  { id: 'base', label: 'Base', fallback: '#55404d' }, { id: 'fade', label: 'Degradê', fallback: '#8a687e' },
  { id: 'outline', label: 'Contorno', fallback: '#251e2c' }, { id: 'highlight', label: 'Luzes', fallback: '#d6b7c7' },
  { id: 'accent', label: 'Acento', fallback: '#bd7198' }
]
function facePartCatalogId(appearance: CustomizerFaceAppearance | undefined, part: typeof customizerFaceParts[number]): string | null | undefined {
  return appearance?.components?.[part.id]?.assetId
}
function facePartSourceId(part: typeof customizerFaceParts[number]): FaceLibraryPartId {
  return part.id
}
function hasSelectedFaceAsset(appearance: CustomizerFaceAppearance): boolean {
  return Boolean(appearance.setId
    || appearance.eyeCatalogId || appearance.eyeLeftCatalogId || appearance.eyeRightCatalogId
    || appearance.eyebrowCatalogId || appearance.eyebrowLeftCatalogId || appearance.eyebrowRightCatalogId
    || appearance.noseCatalogId || appearance.mouthClosedCatalogId || appearance.mouthOpenCatalogId
    || Object.values(appearance.components ?? {}).some((component) => component?.assetId)
    || Object.values(appearance.faceDetails ?? {}).some(Boolean))
}
function isRightFaceAsset(asset: FaceComponentAssetSummary): boolean {
  return asset.rightSidePositioned === true || / · (?:Olho|Olho aberto|Olho fechado|Pupila|Sobrancelha) direit[oa]$/i.test(asset.name)
}
function wrapSlotIndex(index: number, slotCount: number): number {
  return slotCount > 0 ? (index % slotCount + slotCount) % slotCount : 0
}
function sameFaceAssetPair(left: FaceComponentAssetSummary, right: FaceComponentAssetSummary, details: Record<string, FaceComponentAsset>): boolean {
  if (left.kind !== right.kind || !isRightFaceAsset(right)) return false
  if (left.pairId || right.pairId) return Boolean(left.pairId && left.pairId === right.pairId || right.pairId === left.id)
  const leftDetail = details[left.id]
  const rightDetail = details[right.id]
  const baseName = (name: string) => name.replace(/ · (?:Olho|Olho aberto|Olho fechado|Pupila|Sobrancelha) (?:esquerd[oa]|direit[oa])$/i, '')
  return Boolean(leftDetail && rightDetail && !isRightFaceAsset(left) && baseName(left.name) === baseName(right.name) && leftDetail.dataUrl === rightDetail.dataUrl)
}
const skinTonePresets = [
  { id: '#f5ddcb', name: 'Porcelana' },
  { id: '#edc5a5', name: 'Clara' },
  { id: '#dba47d', name: 'Pêssego' },
  { id: '#c88961', name: 'Dourada' },
  { id: '#a96d4c', name: 'Média' },
  { id: '#754a36', name: 'Escura' },
  { id: '#493027', name: 'Retinta' }
] as const
const customizerSkinTonePresets = [skinTonePresets[0], skinTonePresets[1], skinTonePresets[2], skinTonePresets[4], skinTonePresets[6]]
const proportionControls: Array<{ key: keyof CharacterProportions; label: string; description: string }> = [
  { key: 'scale', label: 'Escala geral', description: 'Aumenta ou diminui o personagem inteiro' },
  { key: 'head', label: 'Tamanho da cabeça', description: 'Altera apenas a cabeça, rosto e cabelo' },
  { key: 'headWidth', label: 'Largura da cabeça', description: 'Alarga ou estreita apenas a cabeça, rosto e cabelo' },
  { key: 'headHeight', label: 'Altura da cabeça', description: 'Alonga ou achata apenas a cabeça, rosto e cabelo' },
  { key: 'width', label: 'Largura', description: 'Estica ou comprime o personagem na horizontal' },
  { key: 'height', label: 'Altura', description: 'Estica ou comprime o personagem na vertical' }
]
function loadCachedImage(source: string): Promise<HTMLImageElement> {
  const cached = wardrobeImageCache.get(source)
  if (cached) return cached
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Não foi possível carregar a imagem da roupa.'))
    image.src = source
  })
  wardrobeImageCache.set(source, promise)
  void promise.catch(() => wardrobeImageCache.delete(source))
  return promise
}

function loadHairPreviewImage(source: string): Promise<string> {
  const cached = hairPreviewImageCache.get(source)
  if (cached) return cached
  const preview = loadCachedImage(source).then((image) => {
    const width = image.naturalWidth || image.width
    const height = image.naturalHeight || image.height
    if (!width || !height) return source
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return source
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, width, height).data
    let left = width
    let top = height
    let right = -1
    let bottom = -1
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (pixels[(y * width + x) * 4 + 3] === 0) continue
        left = Math.min(left, x)
        top = Math.min(top, y)
        right = Math.max(right, x)
        bottom = Math.max(bottom, y)
      }
    }
    if (right < left || bottom < top || (left === 0 && top === 0 && right === width - 1 && bottom === height - 1)) return source
    const contentWidth = right - left + 1
    const contentHeight = bottom - top + 1
    const padding = Math.max(2, Math.ceil(Math.max(contentWidth, contentHeight) * 0.045))
    const output = document.createElement('canvas')
    output.width = contentWidth + padding * 2
    output.height = contentHeight + padding * 2
    const outputContext = output.getContext('2d')
    if (!outputContext) return source
    outputContext.drawImage(image, left, top, contentWidth, contentHeight, padding, padding, contentWidth, contentHeight)
    return output.toDataURL('image/png')
  })
  hairPreviewImageCache.set(source, preview)
  if (hairPreviewImageCache.size > 40) hairPreviewImageCache.delete(hairPreviewImageCache.keys().next().value!)
  void preview.catch(() => hairPreviewImageCache.delete(source))
  return preview
}

function HairAssetPreview({ source, alt, colors }: { source: string; alt: string; colors?: HairColorOverrides }) {
  const [previewSource, setPreviewSource] = useState(source)
  const colorKey = JSON.stringify(colors)
  useEffect(() => {
    let cancelled = false
    setPreviewSource(source)
    void loadHairTintedImage(source, colors).then((image) => loadHairPreviewImage(image.src)).then((trimmed) => {
      if (!cancelled) setPreviewSource(trimmed)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [source, colorKey])
  return <img src={previewSource} alt={alt} />
}

function hairHue(red: number, green: number, blue: number): number {
  const maximum = Math.max(red, green, blue)
  const difference = maximum - Math.min(red, green, blue)
  if (!difference) return 0
  const section = maximum === red ? ((green - blue) / difference) % 6 : maximum === green ? (blue - red) / difference + 2 : (red - green) / difference + 4
  return (section * 60 + 360) % 360
}

function hairImageColorProfile(pixels: Uint8ClampedArray): { low: number; high: number; hue: number; hasAccent: boolean } {
  const luminanceBins = new Uint32Array(256)
  const hueBins = new Uint32Array(24)
  let count = 0
  let chromatic = 0
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] < 160) continue
    const red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2]
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
    luminanceBins[Math.round(luminance)] += 1
    count += 1
    const maximum = Math.max(red, green, blue)
    if (maximum > 40 && (maximum - Math.min(red, green, blue)) / maximum > 0.3 && luminance > 35) {
      hueBins[Math.floor(hairHue(red, green, blue) / 15) % 24] += 1
      chromatic += 1
    }
  }
  const percentile = (fraction: number) => {
    let seen = 0
    for (let value = 0; value < luminanceBins.length; value += 1) {
      seen += luminanceBins[value]
      if (seen >= count * fraction) return value
    }
    return 255
  }
  let hueIndex = 0
  for (let index = 1; index < hueBins.length; index += 1) if (hueBins[index] > hueBins[hueIndex]) hueIndex = index
  return { low: percentile(0.01), high: percentile(0.98), hue: hueIndex * 15 + 7.5, hasAccent: chromatic > count * 0.03 }
}

function hairPixelColorRole(red: number, green: number, blue: number, profile: ReturnType<typeof hairImageColorProfile>): HairColorRole {
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
  const maximum = Math.max(red, green, blue)
  const saturation = maximum === 0 ? 0 : (maximum - Math.min(red, green, blue)) / maximum
  const hueDistance = Math.abs(hairHue(red, green, blue) - profile.hue)
  if (profile.hasAccent && saturation > 0.3 && Math.min(hueDistance, 360 - hueDistance) > 48 && luminance > 35) return 'accent'
  const range = profile.high - profile.low
  if (range < 18) return 'base'
  const position = (luminance - profile.low) / range
  if (position < 0.16) return 'outline'
  if (position < 0.43) return 'fade'
  if (position < 0.82) return 'base'
  return 'highlight'
}

function loadHairTintedImage(source: string, overrides: HairColorOverrides | undefined): Promise<HTMLImageElement> {
  if (!overrides || !Object.values(overrides).some(Boolean)) return loadCachedImage(source)
  const key = `${source}:${JSON.stringify(overrides)}`
  const cached = hairTintImageCache.get(key)
  if (cached) return cached
  const tinted = loadCachedImage(source).then((sourceImage) => {
    const canvas = document.createElement('canvas')
    canvas.width = sourceImage.naturalWidth || sourceImage.width
    canvas.height = sourceImage.naturalHeight || sourceImage.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context || !canvas.width || !canvas.height) return sourceImage
    context.drawImage(sourceImage, 0, 0)
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
    const pixels = imageData.data
    const parsed = new Map<HairColorRole, [number, number, number]>()
    for (const [role, value] of Object.entries(overrides) as Array<[HairColorRole, string]>) {
      if (!/^#[\da-f]{6}$/i.test(value)) continue
      parsed.set(role, [Number.parseInt(value.slice(1, 3), 16), Number.parseInt(value.slice(3, 5), 16), Number.parseInt(value.slice(5, 7), 16)])
    }
    if (parsed.size === 0) return sourceImage
    const profile = hairImageColorProfile(pixels)
    const luminanceTotals: Record<HairColorRole, number> = { base: 0, fade: 0, outline: 0, highlight: 0, accent: 0 }
    const roleCounts: Record<HairColorRole, number> = { base: 0, fade: 0, outline: 0, highlight: 0, accent: 0 }
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] < 160) continue
      const role = hairPixelColorRole(pixels[offset], pixels[offset + 1], pixels[offset + 2], profile)
      luminanceTotals[role] += pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722
      roleCounts[role] += 1
    }
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] === 0) continue
      const role = hairPixelColorRole(pixels[offset], pixels[offset + 1], pixels[offset + 2], profile)
      const target = parsed.get(role)
      if (!target) continue
      const sourceLuminance = Math.max(1, pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722)
      const referenceLuminance = roleCounts[role] ? luminanceTotals[role] / roleCounts[role] : sourceLuminance
      const shade = Math.max(0.48, Math.min(1.52, sourceLuminance / Math.max(1, referenceLuminance)))
      pixels[offset] = Math.min(255, target[0] * shade)
      pixels[offset + 1] = Math.min(255, target[1] * shade)
      pixels[offset + 2] = Math.min(255, target[2] * shade)
    }
    context.putImageData(imageData, 0, 0)
    const output = new Image()
    output.src = canvas.toDataURL('image/png')
    if (output.decode) return output.decode().then(() => output)
    return new Promise<HTMLImageElement>((resolve, reject) => {
      output.onload = () => resolve(output)
      output.onerror = () => reject(new Error('Não foi possível recolorir o cabelo.'))
    })
  })
  hairTintImageCache.set(key, tinted)
  if (hairTintImageCache.size > 40) hairTintImageCache.delete(hairTintImageCache.keys().next().value!)
  void tinted.catch(() => hairTintImageCache.delete(key))
  return tinted
}

function loadSkinTintedImage(source: string, tone: string): Promise<HTMLImageElement> {
  const key = `${tone}:${source}`
  const cached = skinTintImageCache.get(key)
  if (cached) return cached
  const tinted = loadCachedImage(source).then((sourceImage) => {
    const canvas = document.createElement('canvas')
    canvas.width = sourceImage.naturalWidth || sourceImage.width
    canvas.height = sourceImage.naturalHeight || sourceImage.height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context || !canvas.width || !canvas.height) return sourceImage
    context.drawImage(sourceImage, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
    tintSkinPixels(pixels, tone)
    context.putImageData(pixels, 0, 0)
    const output = new Image()
    output.src = canvas.toDataURL('image/png')
    if (output.decode) return output.decode().then(() => output)
    return new Promise<HTMLImageElement>((resolve, reject) => {
      output.onload = () => resolve(output)
      output.onerror = () => reject(new Error('Não foi possível aplicar a cor de pele.'))
    })
  })
  skinTintImageCache.set(key, tinted)
  void tinted.catch(() => skinTintImageCache.delete(key))
  return tinted
}

type ClothingGroupCategory = CustomizerWardrobeCategory
type SelectedWardrobeComponent = { setId: string; category: ClothingGroupCategory; componentId: string }
type HairCatalogSide = 'front' | 'back'
type HairLayerSide = HairCatalogSide | 'fringe'
type HairLayerReference = { style: HairStyle; side: HairLayerSide; part: HairPartId }
const customizerHairParts: Array<{ id: HairPartId; label: string; side: HairLayerSide }> = [
  { id: 'backHair', label: 'Cabelo traseiro', side: 'back' },
  { id: 'rearHair', label: 'Cabelo posterior', side: 'front' },
  { id: 'ponytail', label: 'Rabo de cavalo', side: 'back' },
  { id: 'frontHair', label: 'Franja frontal', side: 'fringe' },
  { id: 'ahoge', label: 'Ahoge', side: 'fringe' }
]
const hairAppearanceStyleId = (appearance: NonNullable<CustomizerCharacter['customization']['hairAppearance']> | undefined, side: HairCatalogSide): string | null => {
  if (!appearance) return null
  const key = side === 'front' ? 'frontStyleId' : 'backStyleId'
  return key in appearance ? appearance[key] ?? null : appearance.styleId ?? null
}
function hairAppearanceStyleIds(appearance: NonNullable<CustomizerCharacter['customization']['hairAppearance']> | undefined, side: HairLayerSide): Array<{ id: string; part: HairPartId }> {
  return customizerHairParts.filter((part) => part.side === side).flatMap((part) => {
    const hasPartOverride = Boolean(appearance?.parts && Object.prototype.hasOwnProperty.call(appearance.parts, part.id))
    const legacyFrontPart = part.id === 'rearHair' && appearance?.parts && Object.prototype.hasOwnProperty.call(appearance.parts, 'frontHair')
      ? appearance.parts.frontHair
      : null
    const id = hasPartOverride ? appearance?.parts?.[part.id] ?? null : part.id === 'backHair' ? hairAppearanceStyleId(appearance, 'back') : part.id === 'rearHair' ? legacyFrontPart ?? hairAppearanceStyleId(appearance, 'front') : null
    return id ? [{ id, part: part.id }] : []
  })
}
function hairAppearancePartStyleId(appearance: NonNullable<CustomizerCharacter['customization']['hairAppearance']> | undefined, part: HairPartId): string | null {
  if (appearance?.parts && Object.prototype.hasOwnProperty.call(appearance.parts, part)) return appearance.parts[part] ?? null
  if (part === 'backHair') return hairAppearanceStyleId(appearance, 'back')
  if (part === 'rearHair') return appearance?.parts?.frontHair ?? hairAppearanceStyleId(appearance, 'front')
  return null
}
async function loadHairAppearanceLayers(appearance: NonNullable<CustomizerCharacter['customization']['hairAppearance']> | undefined, modelSlot: number, side: HairLayerSide, cached: Record<string, HairStyle> = {}): Promise<HairLayerReference[]> {
  if (!appearance || appearance.modelSlot !== modelSlot) return []
  const ids = hairAppearanceStyleIds(appearance, side)
  const styles = await Promise.all(ids.map(async ({ id }) => cached[`${modelSlot}:${id}`] ?? await window.desktop.loadHairStyle(modelSlot, id)))
  return styles.flatMap((style, index) => style ? [{ style, side, part: ids[index].part }] : [])
}
function resolvedHairColors(appearance: CustomizerCharacter['customization']['hairAppearance'], part: HairPartId): HairColorOverrides {
  return { ...appearance?.colors, ...appearance?.partColors?.[part] }
}
const clothingCategories: Record<'Superior' | 'Inferior', Array<{ id: ClothingGroupCategory; label: string; source: WardrobeCategory[] }>> = {
  Superior: [
    { id: 'camisa', label: 'Camisas', source: ['camisa'] },
    { id: 'jaqueta', label: 'Jaquetas', source: ['jaqueta'] },
    { id: 'manga-superior', label: 'Mangas superiores', source: ['manga-superior'] },
    { id: 'manga-inferior', label: 'Mangas inferiores', source: ['manga-inferior'] }
  ],
  Inferior: [
    { id: 'calca', label: 'Calças', source: ['calca-coxa', 'calca-canela'] },
    { id: 'shorts', label: 'Shorts', source: ['shorts'] }
  ]
}

type UpperWardrobePanel = { id: string; label: string; category: ClothingGroupCategory; side: 'left' | 'right' | null }
const upperWardrobePanels: UpperWardrobePanel[] = [
  { id: 'shirt', label: 'Camisa', category: 'camisa', side: null },
  { id: 'jacket', label: 'Jaqueta', category: 'jaqueta', side: null },
  { id: 'upper-left', label: 'Manga superior esquerda', category: 'manga-superior', side: 'left' },
  { id: 'upper-right', label: 'Manga superior direita', category: 'manga-superior', side: 'right' },
  { id: 'lower-left', label: 'Manga inferior esquerda', category: 'manga-inferior', side: 'left' },
  { id: 'lower-right', label: 'Manga inferior direita', category: 'manga-inferior', side: 'right' }
]
function wardrobeComponentMatchesPanel(component: WardrobeSet['components'][number], panel: UpperWardrobePanel): boolean {
  if (component.category !== panel.category) return false
  if (!panel.side) return true
  const sideHint = `${component.name} ${component.attachedPartId}`.toLocaleLowerCase()
  const left = /esquerda|\bleft\b/.test(sideHint)
  const right = /direita|\bright\b/.test(sideHint)
  return panel.side === 'left' ? left && !right : right && !left
}

async function renderWardrobeThumbnail(set: WardrobeSet, categories: WardrobeCategory[]): Promise<string | null> {
  const pieces = set.components.filter((component) => categories.includes(component.category))
  if (!pieces.length) return null
  const left = Math.min(...pieces.map((piece) => piece.x))
  const top = Math.min(...pieces.map((piece) => piece.y))
  const right = Math.max(...pieces.map((piece) => piece.x + piece.width))
  const bottom = Math.max(...pieces.map((piece) => piece.y + piece.height))
  const scale = Math.min(112 / Math.max(1, right - left), 112 / Math.max(1, bottom - top))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil((right - left) * scale))
  canvas.height = Math.max(1, Math.ceil((bottom - top) * scale))
  const context = canvas.getContext('2d')
  if (!context) return null
  for (const piece of pieces) {
    try {
      const image = await loadCachedImage(piece.dataUrl)
      context.save()
      context.translate((piece.x - left + piece.width / 2) * scale, (piece.y - top + piece.height / 2) * scale)
      context.rotate(piece.rotation * Math.PI / 180)
      context.drawImage(image, -piece.width * scale / 2, -piece.height * scale / 2, piece.width * scale, piece.height * scale)
      context.restore()
    } catch { continue }
  }
  return canvas.toDataURL('image/png')
}

async function renderWardrobeOverlay(
  groups: CustomizerWardrobeGroup[],
  details: Record<string, WardrobeSet>,
  artwork: CatalogArtwork,
  modelSlot: number | null,
  source: FabricatorProject | null,
  selected: SelectedWardrobeComponent | null,
  skinTone?: string
): Promise<{ imageUrl: string | null; selectedUrl: string | null }> {
  if (!groups.length || modelSlot === null || !source) return { imageUrl: null, selectedUrl: null }
  const output = document.createElement('canvas')
  output.width = Math.max(1, artwork.width)
  output.height = Math.max(1, artwork.height)
  const outputContext = output.getContext('2d')
  if (!outputContext) return { imageUrl: null, selectedUrl: null }
  const selectionCanvas = document.createElement('canvas')
  selectionCanvas.width = output.width
  selectionCanvas.height = output.height
  const selectionContext = selectionCanvas.getContext('2d')
  const hidden = new Set(artwork.hiddenPartIds ?? [])
  const bodyOrder = (artwork.layerOrder ?? []).filter((id, index, order) => artwork.parts.some((part) => part.id === id) && order.indexOf(id) === index)
  for (const part of artwork.parts) if (!bodyOrder.includes(part.id)) bodyOrder.push(part.id)
  const garmentLayers = new Map<string, Array<{ group: CustomizerWardrobeGroup; component: WardrobeSet['components'][number]; transform: ReturnType<typeof mapWardrobeComponentToPose>; center: { x: number; y: number }; sequence: number }>>()
  let sequence = 0

  // Match the wardrobe pose test: each garment is inserted immediately above
  // the model layer it is attached to, before the next body layer is drawn.
  for (const group of groups) {
    const set = details[`${group.modelSlot}:${group.setId}`]
    if (!set || group.modelSlot !== modelSlot) continue
    const accepted = clothingCategories[group.category === 'calca' || group.category === 'shorts' ? 'Inferior' : 'Superior']
      .find((category) => category.id === group.category)?.source
    if (!accepted) continue
    const components = set.components.filter((component) => accepted.includes(component.category) && (!group.componentId || group.componentId === component.id))
    if (!components.length) continue
    const mapped: Array<{ component: WardrobeSet['components'][number]; transform: ReturnType<typeof mapWardrobeComponentToPose>; center: { x: number; y: number }; sequence: number }> = []
    for (const component of components) {
      const sourceBone = source.parts.find((part) => part.id === component.attachedPartId)
      const targetBone = artwork.parts.find((part) => part.id === component.attachedPartId)
      if (!sourceBone || !targetBone) continue
      const hasThighAndCalf = components.some((piece) => piece.category === 'calca-coxa') && components.some((piece) => piece.category === 'calca-canela')
      const kneeOverlap = hasThighAndCalf && (component.category === 'calca-coxa' || component.category === 'calca-canela') ? 18 : 0
      const sleeveEdgePadding = component.category === 'manga-superior' || component.category === 'manga-inferior'
        ? Math.max(8, Math.min(14, Math.round(Math.min(component.width, component.height) * .06)))
        : 0
      const transform = mapWardrobeComponentToPose(component, sourceBone, targetBone, kneeOverlap, sleeveEdgePadding)
      mapped.push({ component, transform, center: transform.origin, sequence: sequence++ })
    }
    if (!mapped.length) continue
    const center = mapped.reduce((sum, item) => ({ x: sum.x + item.center.x / mapped.length, y: sum.y + item.center.y / mapped.length }), { x: 0, y: 0 })
    for (const item of mapped) {
      const layer = garmentLayers.get(item.component.attachedPartId) ?? []
      layer.push({ group, ...item, center })
      garmentLayers.set(item.component.attachedPartId, layer)
    }
  }

  for (const partId of bodyOrder) {
    const part = artwork.parts.find((item) => item.id === partId)
    if (!part) continue
    if (!hidden.has(part.id)) {
      try {
        // The wardrobe composite redraws the body to interleave garments with
        // model layers. Keep that duplicate body in sync with the tinted base
        // preview, otherwise the original skin pixels cover the selected tone.
        const image = skinTone ? await loadSkinTintedImage(part.dataUrl, skinTone) : await loadCachedImage(part.dataUrl)
        outputContext.save()
        outputContext.translate(part.x + part.width / 2, part.y + part.height / 2)
        outputContext.rotate(part.rotation * Math.PI / 180)
        outputContext.drawImage(image, -part.width / 2, -part.height / 2, part.width, part.height)
        outputContext.restore()
      } catch { /* Keep rendering the remaining layers when one image is unavailable. */ }
    }
    const garments = (garmentLayers.get(part.id) ?? []).sort((a, b) => a.sequence - b.sequence)
    for (const garment of garments) {
      try {
        const image = garment.group.colors ? await loadHairTintedImage(garment.component.dataUrl, garment.group.colors) : await loadCachedImage(garment.component.dataUrl)
        const matrix = /^matrix\(([^)]+)\)$/.exec(garment.transform.matrix)?.[1].split(',').map(Number) ?? [1, 0, 0, 1, 0, 0]
        const drawGarment = (context: CanvasRenderingContext2D) => {
          context.save()
          context.translate(garment.center.x + garment.group.offsetX, garment.center.y + garment.group.offsetY)
          context.rotate(garment.group.rotation * Math.PI / 180)
          context.scale(garment.group.scaleX, garment.group.scaleY)
          context.translate(-garment.center.x, -garment.center.y)
          context.translate(garment.transform.origin.x, garment.transform.origin.y)
          context.transform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5])
          context.translate(garment.transform.localLeft + garment.transform.renderWidth / 2, garment.transform.localTop + garment.transform.renderHeight / 2)
          context.rotate(garment.transform.localRotation * Math.PI / 180)
          context.drawImage(image, -garment.transform.renderWidth / 2, -garment.transform.renderHeight / 2, garment.transform.renderWidth, garment.transform.renderHeight)
          context.restore()
        }
        drawGarment(outputContext)
        if (selectionContext && selected && garment.group.setId === selected.setId && garment.group.category === selected.category && garment.component.id === selected.componentId) drawGarment(selectionContext)
      } catch { /* Keep rendering the remaining layers when one image is unavailable. */ }
    }
  }
  return { imageUrl: output.toDataURL('image/png'), selectedUrl: selectionContext && selected ? selectionCanvas.toDataURL('image/png') : null }
}

export async function renderArtwork(artwork: CatalogArtwork, maxSize: number, skinTone?: string, trimTransparent = false): Promise<string | null> {
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
      const image = skinTone ? await loadSkinTintedImage(part.dataUrl, skinTone) : await loadCachedImage(part.dataUrl)
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

  if (!trimTransparent) return canvas.toDataURL('image/png')

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  let left = canvas.width
  let top = canvas.height
  let right = -1
  let bottom = -1
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (pixels[(y * canvas.width + x) * 4 + 3] === 0) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < left || bottom < top) return canvas.toDataURL('image/png')
  const margin = 0
  const trimmed = document.createElement('canvas')
  trimmed.width = right - left + 1 + margin * 2
  trimmed.height = bottom - top + 1 + margin * 2
  trimmed.getContext('2d')?.drawImage(canvas, left, top, right - left + 1, bottom - top + 1, margin, margin, right - left + 1, bottom - top + 1)
  return trimmed.toDataURL('image/png')
}

async function renderArtworkWithHair(artwork: CatalogArtwork, source: FabricatorProject, backStyles: HairStyle | HairLayerReference[] | null, maxSize: number, skinTone?: string, hairAppearance?: CustomizerCharacter['customization']['hairAppearance']): Promise<string | null> {
  const hairLayers: HairLayerReference[] = Array.isArray(backStyles) ? backStyles : backStyles ? [{ style: backStyles, side: 'back', part: 'backHair' }] : []
  const validHairLayers = hairLayers.filter((layer) => layer.side === 'back' && layer.style.modelSlot === source.slot && Boolean(layer.style.back))
  if (!validHairLayers.length) return renderArtwork(artwork, maxSize, skinTone)
  const sourceHead = source.parts.find((part) => /cabe[çc]a|head/i.test(part.name))
  const targetHead = artwork.parts.find((part) => /cabe[çc]a|head/i.test(part.name))
  if (!sourceHead || !targetHead || !sourceHead.width || !sourceHead.height) return renderArtwork(artwork, maxSize, skinTone)
  const scale = Math.min(maxSize / artwork.width, maxSize / artwork.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(artwork.width * scale)); canvas.height = Math.max(1, Math.round(artwork.height * scale))
  const context = canvas.getContext('2d')
  if (!context) return null
  const hidden = new Set(artwork.hiddenPartIds ?? [])
  const order = (artwork.layerOrder ?? []).filter((id, index, ids) => ids.indexOf(id) === index && artwork.parts.some((part) => part.id === id))
  for (const part of artwork.parts) if (!order.includes(part.id)) order.push(part.id)
  const drawBackHair = async (layer: HairLayerReference) => {
    const { style, side } = layer
    const asset = style[side]
    if (!asset) return
      const transform = style.transforms[side]
      if (!transform) return
    try {
      const localX = transform.x / sourceHead.width * targetHead.width
      const localY = transform.y / sourceHead.height * targetHead.height
      const radians = targetHead.rotation * Math.PI / 180
      const x = targetHead.x + targetHead.width / 2 + (localX - targetHead.width / 2) * Math.cos(radians) - (localY - targetHead.height / 2) * Math.sin(radians)
      const y = targetHead.y + targetHead.height / 2 + (localX - targetHead.width / 2) * Math.sin(radians) + (localY - targetHead.height / 2) * Math.cos(radians)
      const width = asset.width * transform.scaleX / sourceHead.width * targetHead.width
      const height = asset.height * transform.scaleY / sourceHead.height * targetHead.height
      const image = await loadHairTintedImage(asset.dataUrl, resolvedHairColors(hairAppearance, layer.part))
      context.save()
      context.translate(x * scale, y * scale)
      context.rotate((targetHead.rotation + transform.rotation) * Math.PI / 180)
      context.scale(transform.flipX ? -1 : 1, 1)
      context.drawImage(image, -width * scale / 2, -height * scale / 2, width * scale, height * scale)
      context.restore()
    } catch { /* One missing hair layer must not hide the model preview. */ }
  }
  for (const layer of validHairLayers) await drawBackHair(layer)
  for (const id of order) {
    const part = artwork.parts.find((item) => item.id === id)
    if (!part) continue
    if (!hidden.has(part.id)) {
      try {
        const image = skinTone ? await loadSkinTintedImage(part.dataUrl, skinTone) : await loadCachedImage(part.dataUrl)
        context.save()
        context.translate((part.x + part.width / 2) * scale, (part.y + part.height / 2) * scale)
        context.rotate(part.rotation * Math.PI / 180)
        context.drawImage(image, -part.width * scale / 2, -part.height * scale / 2, part.width * scale, part.height * scale)
        context.restore()
      } catch { /* Continue rendering the remaining model layers. */ }
    }
  }
  return canvas.toDataURL('image/png')
}

async function renderFrontHairOverlay(artwork: CatalogArtwork, source: FabricatorProject, frontStyles: HairStyle | HairLayerReference[] | null, maxSize: number, hairAppearance?: CustomizerCharacter['customization']['hairAppearance']): Promise<string | null> {
  const hairLayers: HairLayerReference[] = Array.isArray(frontStyles) ? frontStyles : frontStyles ? [{ style: frontStyles, side: 'front', part: 'rearHair' }] : []
  const validHairLayers = hairLayers.filter((layer) => (layer.side === 'front' || layer.side === 'fringe') && layer.style[layer.side] && layer.style.modelSlot === source.slot)
  if (!validHairLayers.length) return null
  const sourceHead = source.parts.find((part) => /cabe[çc]a|head/i.test(part.name))
  const targetHead = artwork.parts.find((part) => /cabe[çc]a|head/i.test(part.name))
  if (!sourceHead || !targetHead || sourceHead.width <= 0 || sourceHead.height <= 0) return null
  const scale = Math.min(maxSize / artwork.width, maxSize / artwork.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(artwork.width * scale))
  canvas.height = Math.max(1, Math.round(artwork.height * scale))
  const context = canvas.getContext('2d')
  if (!context) return null
  for (const layer of validHairLayers) {
    const asset = layer.style[layer.side]
    if (!asset) continue
    const transform = layer.style.transforms[layer.side]
    if (!transform) continue
    const localX = transform.x / sourceHead.width * targetHead.width
    const localY = transform.y / sourceHead.height * targetHead.height
    const radians = targetHead.rotation * Math.PI / 180
    const x = targetHead.x + targetHead.width / 2 + (localX - targetHead.width / 2) * Math.cos(radians) - (localY - targetHead.height / 2) * Math.sin(radians)
    const y = targetHead.y + targetHead.height / 2 + (localX - targetHead.width / 2) * Math.sin(radians) + (localY - targetHead.height / 2) * Math.cos(radians)
    const width = asset.width * transform.scaleX / sourceHead.width * targetHead.width
    const height = asset.height * transform.scaleY / sourceHead.height * targetHead.height
    try {
      const image = await loadHairTintedImage(asset.dataUrl, resolvedHairColors(hairAppearance, layer.part))
      context.save()
      context.translate(x * scale, y * scale)
      context.rotate((targetHead.rotation + transform.rotation) * Math.PI / 180)
      context.scale(transform.flipX ? -1 : 1, 1)
      context.drawImage(image, -width * scale / 2, -height * scale / 2, width * scale, height * scale)
      context.restore()
    } catch { /* Continue drawing the remaining front hair layers. */ }
  }
  return canvas.toDataURL('image/png')
}

async function renderFaceOverlay(artwork: CatalogArtwork, source: FabricatorProject | null, face: FaceSet | null, appearance: CustomizerFaceAppearance | undefined): Promise<string | null> {
  if (!source || !face || !appearance || appearance.setId !== face.id || appearance.modelSlot !== source.slot) return null
  const sourceHead = source.parts.find((part) => /cabe[çc]a|head/i.test(part.name))
  const targetHead = artwork.parts.find((part) => /cabe[çc]a|head/i.test(part.name))
  if (!sourceHead || !targetHead || sourceHead.width <= 0 || sourceHead.height <= 0) return null
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, artwork.width)
  canvas.height = Math.max(1, artwork.height)
  const context = canvas.getContext('2d')
  if (!context) return null
  for (const element of faceElementOrder) {
    if (element.startsWith('brow') && !appearance.eyebrows) continue
    const sheet = element.startsWith('eye') ? 'eyes' : element.startsWith('brow') ? 'eyebrows' : element === 'nose' ? 'nose' : appearance.mouthOpen ? 'mouth-open' : 'mouth-closed'
    const index = sheet === 'eyes' ? appearance.eyeState : sheet === 'nose' ? appearance.noseIndex : sheet.startsWith('mouth') ? appearance.expressionIndex : 0
    const side = element.endsWith('left') ? 'left' : element.endsWith('right') ? 'right' : undefined
    const piece = face.pieces.find((item) => item.sheet === sheet && item.index === index && item.side === side)
    if (!piece) continue
    const transform = face.transforms[element]
    try {
      const image = await loadCachedImage(piece.dataUrl)
      const localX = transform.x / sourceHead.width * targetHead.width
      const localY = transform.y / sourceHead.height * targetHead.height
      const x = targetHead.x + targetHead.width / 2 + (localX - targetHead.width / 2) * Math.cos(targetHead.rotation * Math.PI / 180) - (localY - targetHead.height / 2) * Math.sin(targetHead.rotation * Math.PI / 180)
      const y = targetHead.y + targetHead.height / 2 + (localX - targetHead.width / 2) * Math.sin(targetHead.rotation * Math.PI / 180) + (localY - targetHead.height / 2) * Math.cos(targetHead.rotation * Math.PI / 180)
      const width = piece.width * transform.scaleX / sourceHead.width * targetHead.width
      const height = piece.height * transform.scaleY / sourceHead.height * targetHead.height
      context.save()
      context.translate(x, y)
      context.rotate((targetHead.rotation + transform.rotation) * Math.PI / 180)
      context.drawImage(image, -width / 2, -height / 2, width, height)
      context.restore()
    } catch { /* Skip a missing facial asset without hiding the character preview. */ }
  }
  return canvas.toDataURL('image/png')
}

async function drawFaceCatalogOverlay(context: CanvasRenderingContext2D, artwork: CatalogArtwork, source: FabricatorProject, items: Partial<Record<FaceSheetKind | FaceElementKind, FaceCatalogItem>>, appearance: CustomizerFaceAppearance, studioFaceTransforms?: StudioFaceTransforms): Promise<void> {
  const sourceHead = source.parts.find((part) => /cabe[çc]a|head/i.test(part.name))
  const targetHead = artwork.parts.find((part) => /cabe[çc]a|head/i.test(part.name))
  if (!sourceHead || !targetHead || sourceHead.width <= 0 || sourceHead.height <= 0) return
  const categoryIds: Partial<Record<FaceSheetKind, string | undefined>> = {
    eyes: appearance.eyeCatalogId,
    eyebrows: appearance.eyebrowCatalogId,
    nose: appearance.noseCatalogId,
    'mouth-closed': appearance.mouthOpen ? undefined : appearance.mouthClosedCatalogId,
    'mouth-open': appearance.mouthOpen ? appearance.mouthOpenCatalogId : undefined
  }
  for (const element of faceElementOrder) {
    if (element.startsWith('brow') && !appearance.eyebrows) continue
    const componentPart = element === 'eye-left' || element === 'eye-right' || element === 'brow-left' || element === 'brow-right' ? element : null
    if (componentPart) {
      const sourcePart = componentPart
      if (appearance.components?.[sourcePart]?.assetId) continue
    }
    const sheet: FaceSheetKind = element.startsWith('eye') ? 'eyes' : element.startsWith('brow') ? 'eyebrows' : element === 'nose' ? 'nose' : appearance.mouthOpen ? 'mouth-open' : 'mouth-closed'
    const side = element.endsWith('left') ? 'left' : element.endsWith('right') ? 'right' : undefined
    const sideKey = side ? `${sheet === 'eyes' ? 'eye' : 'brow'}-${side}` as FaceElementKind : null
    const sideField = element === 'eye-left' ? 'eyeLeftCatalogId' : element === 'eye-right' ? 'eyeRightCatalogId' : element === 'brow-left' ? 'eyebrowLeftCatalogId' : element === 'brow-right' ? 'eyebrowRightCatalogId' : null
    const hasSideSelection = sideField !== null && Object.hasOwn(appearance, sideField)
    const sideSelection = sideField ? appearance[sideField] : undefined
    const item = (sideKey ? items[sideKey] : undefined) ?? items[sheet]
    if (!item || item.id !== (hasSideSelection ? sideSelection : categoryIds[sheet])) continue
    const index = sheet === 'eyes' ? appearance.eyeState : sheet === 'nose' ? appearance.noseIndex : sheet.startsWith('mouth') ? appearance.expressionIndex : 0
    const piece = item.pieces.find((candidate) => candidate.sheet === sheet && candidate.index === index && candidate.side === side)
    const transform = item.transforms[element]
    const studioCategory = sheet === 'eyes' ? 'eyes' : sheet === 'eyebrows' ? 'eyebrows' : sheet === 'nose' ? 'nose' : 'mouth'
    const studioTransform = studioFaceTransforms?.[`${sheet}:${item.id}`] ?? studioFaceTransforms?.[studioCategory]
    if (!piece || !transform) continue
    try {
      const image = await loadHairTintedImage(piece.dataUrl, appearance.partColors?.[element as 'eye-left' | 'eye-right' | 'brow-left' | 'brow-right'])
      const localX = transform.x / sourceHead.width * targetHead.width + (studioTransform?.x ?? 0) / 100 * targetHead.width
      const localY = transform.y / sourceHead.height * targetHead.height + (studioTransform?.y ?? 0) / 100 * targetHead.height
      const radians = targetHead.rotation * Math.PI / 180
      const x = targetHead.x + targetHead.width / 2 + (localX - targetHead.width / 2) * Math.cos(radians) - (localY - targetHead.height / 2) * Math.sin(radians)
      const y = targetHead.y + targetHead.height / 2 + (localX - targetHead.width / 2) * Math.sin(radians) + (localY - targetHead.height / 2) * Math.cos(radians)
      const width = piece.width * transform.scaleX / sourceHead.width * targetHead.width * (studioTransform?.width ?? 100) / 100
      const height = piece.height * transform.scaleY / sourceHead.height * targetHead.height * (studioTransform?.height ?? 100) / 100
      context.save()
      context.translate(x, y)
      context.rotate((targetHead.rotation + transform.rotation + (studioTransform?.rotation ?? 0)) * Math.PI / 180)
      context.drawImage(image, -width / 2, -height / 2, width, height)
      context.restore()
    } catch { /* Keep the rest of the face visible if one catalog asset is missing. */ }
  }
  const componentIds: FaceComponentPartId[] = ['eye-left', 'eye-right', 'pupil-left', 'pupil-right', 'brow-left', 'brow-right']
  const loaded = new Map<FaceComponentPartId, FaceComponentAsset>()
  await Promise.all(componentIds.map(async (part) => {
    const id = appearance.components?.[part]?.assetId
    if (!id) return
    const key = `${appearance.modelSlot}:${id}`
    let pending = faceComponentAssetCache.get(key)
    if (!pending) { pending = window.desktop.loadFaceComponentAsset(appearance.modelSlot, id); faceComponentAssetCache.set(key, pending) }
    const asset = await pending
    if (asset) loaded.set(part, asset)
  }))
  const layerOrder: FaceComponentPartId[] = ['brow-left', 'brow-right', 'eye-left', 'eye-right', 'pupil-left', 'pupil-right']
  let pupilClipCanvas: HTMLCanvasElement | null = null
  for (const part of layerOrder) {
    const category = part.startsWith('eye') ? 'eye' : part.startsWith('pupil') ? 'pupil' : 'eyebrow'
    const isRight = part.endsWith('right')
    const asset = loaded.get(part)
    const selectedPart = appearance.components?.[part]
    if (!asset || !selectedPart) continue
    // Fabricator Dev owns placement and scale; the Customizer only chooses the asset.
    const transform = asset.defaultTransform
    const mirroredTransform = isRight && category !== 'pupil' && !asset.rightSidePositioned ? { ...transform, x: sourceHead.width - transform.x, rotation: -transform.rotation } : transform
    let localX = mirroredTransform.x
    let localY = mirroredTransform.y
    let drawRotation = mirroredTransform.rotation
    let scaleX = mirroredTransform.scaleX
    let scaleY = mirroredTransform.scaleY
    let sourceWidth = asset.width * scaleX
    let sourceHeight = asset.height * scaleY
    let pupilEyeClip: { asset: FaceComponentAsset; transform: FaceComponentAsset['defaultTransform']; flipX: boolean; colors?: HairColorOverrides } | undefined
    if (category === 'pupil') {
      const eyePart: FaceComponentPartId = isRight ? 'eye-right' : 'eye-left'
      const eyeAsset = loaded.get(eyePart)
      if (!eyeAsset) continue
      const eyeSelection = appearance.components?.[eyePart]
      const eyeTransformBase = eyeAsset?.defaultTransform
      if (eyeTransformBase) {
        const eyeTransform = isRight && !eyeAsset?.rightSidePositioned ? { ...eyeTransformBase, x: sourceHead.width - eyeTransformBase.x, rotation: -eyeTransformBase.rotation } : eyeTransformBase
        if (eyeAsset) pupilEyeClip = { asset: eyeAsset, transform: eyeTransform, flipX: Boolean(eyeTransformBase.flipX), colors: eyeSelection?.colors }
        const pupilOffsetX = isRight && !asset.rightSidePositioned ? -transform.x : transform.x
        const pupilAngle = eyeTransform.rotation * Math.PI / 180
        localX = eyeTransform.x + pupilOffsetX * Math.cos(pupilAngle) - transform.y * Math.sin(pupilAngle)
        localY = eyeTransform.y + pupilOffsetX * Math.sin(pupilAngle) + transform.y * Math.cos(pupilAngle)
        scaleX = eyeTransform.scaleX * scaleX
        scaleY = eyeTransform.scaleY * scaleY
        sourceWidth = (eyeAsset?.width ?? sourceHead.width * .19) * eyeTransform.scaleX * transform.scaleX
        sourceHeight = (eyeAsset?.height ?? sourceHead.height * .17) * eyeTransform.scaleY * transform.scaleY
        drawRotation = eyeTransform.rotation + transform.rotation * (isRight && !asset.rightSidePositioned ? -1 : 1)
      }
    }
    const localTargetX = localX / sourceHead.width * targetHead.width
    const localTargetY = localY / sourceHead.height * targetHead.height
    const radians = targetHead.rotation * Math.PI / 180
    const x = targetHead.x + targetHead.width / 2 + (localTargetX - targetHead.width / 2) * Math.cos(radians) - (localTargetY - targetHead.height / 2) * Math.sin(radians)
    const y = targetHead.y + targetHead.height / 2 + (localTargetX - targetHead.width / 2) * Math.sin(radians) + (localTargetY - targetHead.height / 2) * Math.cos(radians)
    const width = sourceWidth / sourceHead.width * targetHead.width
    const height = sourceHeight / sourceHead.height * targetHead.height
    try {
      const image = await loadHairTintedImage(asset.dataUrl, selectedPart.colors)
      if (category === 'pupil' && pupilEyeClip) {
        if (!pupilClipCanvas) { pupilClipCanvas = document.createElement('canvas'); pupilClipCanvas.width = context.canvas.width; pupilClipCanvas.height = context.canvas.height }
        const clipped = pupilClipCanvas.getContext('2d')
        if (clipped) {
          clipped.clearRect(0, 0, pupilClipCanvas.width, pupilClipCanvas.height)
          clipped.save(); clipped.translate(x, y); clipped.rotate((targetHead.rotation + drawRotation) * Math.PI / 180)
          if (transform.flipX) clipped.scale(-1, 1)
          clipped.drawImage(image, -width / 2, -height / 2, width, height); clipped.restore()

          const eyeMask = await loadCachedImage(await eyeInteriorMask(pupilEyeClip.asset.dataUrl))
          const eyeLocalX = pupilEyeClip.transform.x / sourceHead.width * targetHead.width
          const eyeLocalY = pupilEyeClip.transform.y / sourceHead.height * targetHead.height
          const eyeX = targetHead.x + targetHead.width / 2 + (eyeLocalX - targetHead.width / 2) * Math.cos(radians) - (eyeLocalY - targetHead.height / 2) * Math.sin(radians)
          const eyeY = targetHead.y + targetHead.height / 2 + (eyeLocalX - targetHead.width / 2) * Math.sin(radians) + (eyeLocalY - targetHead.height / 2) * Math.cos(radians)
          const eyeWidth = pupilEyeClip.asset.width * pupilEyeClip.transform.scaleX / sourceHead.width * targetHead.width
          const eyeHeight = pupilEyeClip.asset.height * pupilEyeClip.transform.scaleY / sourceHead.height * targetHead.height
          clipped.save(); clipped.globalCompositeOperation = 'destination-in'; clipped.translate(eyeX, eyeY)
          clipped.rotate((targetHead.rotation + pupilEyeClip.transform.rotation) * Math.PI / 180)
          if (pupilEyeClip.flipX) clipped.scale(-1, 1)
          clipped.drawImage(eyeMask, -eyeWidth / 2, -eyeHeight / 2, eyeWidth, eyeHeight); clipped.restore()
          context.drawImage(pupilClipCanvas, 0, 0)
        }
      } else {
        context.save(); context.translate(x, y); context.rotate((targetHead.rotation + drawRotation) * Math.PI / 180)
        if (transform.flipX) context.scale(-1, 1)
        context.drawImage(image, -width / 2, -height / 2, width, height); context.restore()
      }
    } catch { /* Keep the rest of the face visible if one component asset is unavailable. */ }
  }
  const detailOrder: FaceDetailKind[] = ['facial-shadow', 'blush', 'eye-highlight-left', 'eye-highlight-right']
  for (const kind of detailOrder) {
    const id = appearance.faceDetails?.[kind]
    if (!id) continue
    const key = `${appearance.modelSlot}:${id}`
    let pending = faceComponentAssetCache.get(key)
    if (!pending) { pending = window.desktop.loadFaceComponentAsset(appearance.modelSlot, id); faceComponentAssetCache.set(key, pending) }
    const asset = await pending
    if (!asset || asset.kind !== kind) continue
    const transform = asset.defaultTransform
    const localX = transform.x / sourceHead.width * targetHead.width
    const localY = transform.y / sourceHead.height * targetHead.height
    const radians = targetHead.rotation * Math.PI / 180
    const x = targetHead.x + targetHead.width / 2 + (localX - targetHead.width / 2) * Math.cos(radians) - (localY - targetHead.height / 2) * Math.sin(radians)
    const y = targetHead.y + targetHead.height / 2 + (localX - targetHead.width / 2) * Math.sin(radians) + (localY - targetHead.height / 2) * Math.cos(radians)
    const width = asset.width * transform.scaleX / sourceHead.width * targetHead.width
    const height = asset.height * transform.scaleY / sourceHead.height * targetHead.height
    try {
      const image = await loadCachedImage(asset.dataUrl)
      context.save(); context.translate(x, y); context.rotate((targetHead.rotation + transform.rotation) * Math.PI / 180)
      if (transform.flipX) context.scale(-1, 1)
      context.drawImage(image, -width / 2, -height / 2, width, height); context.restore()
    } catch { /* Keep the rest of the face visible if one detail asset is unavailable. */ }
  }
}

async function renderFaceCatalogOverlay(artwork: CatalogArtwork, source: FabricatorProject, items: Partial<Record<FaceSheetKind | FaceElementKind, FaceCatalogItem>>, appearance: CustomizerFaceAppearance, studioFaceTransforms?: StudioFaceTransforms): Promise<string | null> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, artwork.width)
  canvas.height = Math.max(1, artwork.height)
  const context = canvas.getContext('2d')
  if (!context) return null
  await drawFaceCatalogOverlay(context, artwork, source, items, appearance, studioFaceTransforms)
  return canvas.toDataURL('image/png')
}

/** Render the selected Customizer character as one self-contained Studio actor image. */
export async function prepareSavedCharacterRenderer(character: CustomizerCharacter): Promise<{ width: number; height: number; render: (appearance?: CustomizerFaceAppearance, studioFaceTransforms?: StudioFaceTransforms) => Promise<{ dataUrl: string; width: number; height: number }> }> {
  const modelSlot = character.customization.modelSlot ?? 1
  const source = await window.desktop.loadFabricatorSlot(modelSlot)
  if (!source) throw new Error(`O modelo de ${character.name} não está disponível.`)
  const pose = character.customization.poseSlot === null ? null : await window.desktop.loadFabricatorPose(modelSlot, character.customization.poseSlot)
  const proportions = getCharacterProportions(character.customization)
  const artwork = applyCharacterBodyShape(withCharacterHeadSize(pose ?? source, proportions), getCharacterBodyDimensions(character.customization))
  const hairAppearance = character.customization.hairAppearance
  const [backStyles, posteriorStyles, fringeStyles] = await Promise.all([
    loadHairAppearanceLayers(hairAppearance, modelSlot, 'back'),
    loadHairAppearanceLayers(hairAppearance, modelSlot, 'front'),
    loadHairAppearanceLayers(hairAppearance, modelSlot, 'fringe')
  ])
  const frontStyles = [...posteriorStyles, ...fringeStyles]
  const baseUrl = await renderArtworkWithHair(artwork, source, backStyles, 960, character.customization.modelSkinTone, hairAppearance)
  if (!baseUrl) throw new Error(`Não foi possível montar a prévia de ${character.name}.`)

  const groups = (character.customization.wardrobeGroups ?? []).filter((group) => group.modelSlot === modelSlot)
  const details: Record<string, WardrobeSet> = {}
  await Promise.all(groups.map(async (group) => {
    const key = `${group.modelSlot}:${group.setId}`
    if (details[key]) return
    const set = await window.desktop.loadWardrobeSet(group.modelSlot, group.setId)
    if (set) details[key] = set
  }))
  const wardrobe = await renderWardrobeOverlay(groups, details, artwork, modelSlot, source, null, character.customization.modelSkinTone)

  const appearance = character.customization.faceAppearance
  let faceItems: Partial<Record<FaceSheetKind | FaceElementKind, FaceCatalogItem>> = {}
  const faceItemPromises = new Map<string, Promise<FaceCatalogItem | null>>()
  let legacyFaceUrl: string | null = null
  if (appearance?.modelSlot === modelSlot) {
    if (appearance.eyeCatalogId || appearance.eyeLeftCatalogId || appearance.eyeRightCatalogId || appearance.eyebrowCatalogId || appearance.eyebrowLeftCatalogId || appearance.eyebrowRightCatalogId || appearance.noseCatalogId || appearance.mouthClosedCatalogId || appearance.mouthOpenCatalogId || Object.values(appearance.components ?? {}).some((component) => component?.assetId)) {
      const selections: Array<[FaceSheetKind | FaceElementKind, string | undefined]> = [
        ['eyes', appearance.eyeCatalogId], ['eyebrows', appearance.eyebrowCatalogId], ['nose', appearance.noseCatalogId],
        ['eye-left', appearance.eyeLeftCatalogId ?? undefined], ['eye-right', appearance.eyeRightCatalogId ?? undefined], ['brow-left', appearance.eyebrowLeftCatalogId ?? undefined], ['brow-right', appearance.eyebrowRightCatalogId ?? undefined],
        ['mouth-closed', appearance.mouthClosedCatalogId], ['mouth-open', appearance.mouthOpenCatalogId]
      ]
      const entries = await Promise.all(selections.filter((entry): entry is [FaceSheetKind | FaceElementKind, string] => Boolean(entry[1])).map(async ([category, id]) => [category, await window.desktop.loadFaceCatalogItem(modelSlot, id)] as const))
      for (const [category, item] of entries) if (item) faceItems[category] = item
    } else if (appearance.setId) {
      const face = await window.desktop.loadFaceSet(modelSlot, appearance.setId)
      if (face) legacyFaceUrl = await renderFaceOverlay(artwork, source, face, appearance)
    }
  }
  const frontHairUrl = frontStyles.length ? await renderFrontHairOverlay(artwork, source, frontStyles, 960, hairAppearance) : null
  const baseImage = await loadCachedImage(baseUrl)
  const wardrobeImage = wardrobe.imageUrl ? await loadCachedImage(wardrobe.imageUrl) : null
  const legacyFaceImage = legacyFaceUrl ? await loadCachedImage(legacyFaceUrl) : null
  const frontHairImage = frontHairUrl ? await loadCachedImage(frontHairUrl) : null
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, artwork.width)
  canvas.height = Math.max(1, artwork.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Não foi possível preparar a imagem do personagem.')
  const shapeScale = characterShapeScale(proportions)
  const outputWidth = Math.max(canvas.width, Math.ceil(canvas.width * shapeScale.x))
  const outputHeight = Math.max(canvas.height, Math.ceil(canvas.height * shapeScale.y))
  const render = async (currentAppearance: CustomizerFaceAppearance | undefined = appearance, studioFaceTransforms?: StudioFaceTransforms) => {
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(baseImage, 0, 0, canvas.width, canvas.height)
    if (wardrobeImage) context.drawImage(wardrobeImage, 0, 0, canvas.width, canvas.height)
    if (currentAppearance?.modelSlot === modelSlot) {
      const selections: Array<[FaceSheetKind | FaceElementKind, string | undefined]> = [
        ['eyes', currentAppearance.eyeCatalogId], ['eyebrows', currentAppearance.eyebrowCatalogId], ['nose', currentAppearance.noseCatalogId],
        ['eye-left', currentAppearance.eyeLeftCatalogId ?? undefined], ['eye-right', currentAppearance.eyeRightCatalogId ?? undefined], ['brow-left', currentAppearance.eyebrowLeftCatalogId ?? undefined], ['brow-right', currentAppearance.eyebrowRightCatalogId ?? undefined],
        ['mouth-closed', currentAppearance.mouthClosedCatalogId], ['mouth-open', currentAppearance.mouthOpenCatalogId]
      ]
      const hasCatalogSelection = selections.some(([, id]) => Boolean(id)) || Object.values(currentAppearance.components ?? {}).some((component) => component?.assetId)
      const activeItems: Partial<Record<FaceSheetKind | FaceElementKind, FaceCatalogItem>> = {}
      await Promise.all(selections.filter((entry): entry is [FaceSheetKind | FaceElementKind, string] => Boolean(entry[1])).map(async ([category, id]) => {
        let item = faceItems[category]?.id === id ? faceItems[category] : null
        if (!item) {
          const key = `${category}:${id}`
          let pending = faceItemPromises.get(key)
          if (!pending) {
            pending = window.desktop.loadFaceCatalogItem(modelSlot, id)
            faceItemPromises.set(key, pending)
          }
          item = await pending ?? null
          if (item) faceItems[category] = item
        }
        if (item) activeItems[category] = item
      }))
      if (hasCatalogSelection) await drawFaceCatalogOverlay(context, artwork, source, activeItems, currentAppearance, studioFaceTransforms)
      else if (legacyFaceImage && currentAppearance.setId === appearance?.setId) context.drawImage(legacyFaceImage, 0, 0, canvas.width, canvas.height)
    } else if (legacyFaceImage) context.drawImage(legacyFaceImage, 0, 0, canvas.width, canvas.height)
    if (frontHairImage) context.drawImage(frontHairImage, 0, 0, canvas.width, canvas.height)
    if (shapeScale.x === 1 && shapeScale.y === 1) return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
    const output = document.createElement('canvas')
    output.width = outputWidth
    output.height = outputHeight
    const outputContext = output.getContext('2d')
    if (!outputContext) throw new Error('Não foi possível aplicar as proporções do personagem.')
    outputContext.translate(outputWidth / 2, outputHeight / 2)
    outputContext.scale(shapeScale.x, shapeScale.y)
    outputContext.drawImage(canvas, -canvas.width / 2, -canvas.height / 2)
    return { dataUrl: output.toDataURL('image/png'), width: outputWidth, height: outputHeight }
  }
  return { width: outputWidth, height: outputHeight, render }
}

export async function renderSavedCharacter(character: CustomizerCharacter, studioFaceTransforms?: StudioFaceTransforms): Promise<{ dataUrl: string; width: number; height: number }> {
  const renderer = await prepareSavedCharacterRenderer(character)
  return renderer.render(character.customization.faceAppearance, studioFaceTransforms)
}

const modules: { name: string; icon: IconName; detail: string }[] = [
  { name: 'Modelos', icon: 'sparkles', detail: 'Looks prontos para começar' },
  { name: 'Poses', icon: 'body', detail: 'Pose, proporções e detalhes' },
  { name: 'Cabeça', icon: 'face', detail: 'Rosto, cabelo e expressões' },
  { name: 'Cabelos', icon: 'bow', detail: 'Biblioteca de cabelos do personagem' },
  { name: 'Roupas', icon: 'shirt', detail: 'Monte um visual único' },
  { name: 'Acessórios', icon: 'flower', detail: 'Peças e objetos de cena' },
  { name: 'Objetos', icon: 'box', detail: 'Itens para compor a cena' },
  { name: 'Perfil', icon: 'user', detail: 'Informações do personagem' }
]

const customizerTopTabs: { id: string; label: string }[] = [
  { id: 'modelos', label: 'Modelos' },
  { id: 'corpo', label: 'Corpo' },
  { id: 'cabeca', label: 'Cabeça' },
  { id: 'roupas', label: 'Roupas' },
  { id: 'outros', label: 'Outros' },
  { id: 'perfil', label: 'Perfil' }
]

const customizerHeadTabs = [
  { id: 'hair', label: 'Cabelo', icon: 'bow' },
  { id: 'eyes', label: 'Olhos', icon: 'face' },
  { id: 'face', label: 'Rosto', icon: 'face' },
  { id: 'extra', label: 'Extras', icon: 'sparkles' },
  { id: 'adjust', label: 'Ajustar', icon: 'sliders' }
] as const

const customizerClothesTabs = [
  { id: 'hats', label: 'Chapéus', icon: 'sparkles' },
  { id: 'accessories', label: 'Acess.', icon: 'bow' },
  { id: 'upper', label: 'Superior', icon: 'shirt' },
  { id: 'lower', label: 'Inferior', icon: 'body' },
  { id: 'other', label: 'Outros', icon: 'flower' },
  { id: 'extra', label: 'Extra', icon: 'sparkles' },
  { id: 'adjust', label: 'Ajustar', icon: 'sliders' }
] as const

const customizerOtherTabs = [
  { id: 'extra', label: 'Extra', icon: 'brush' },
  { id: 'extra2', label: 'Extra 2', icon: 'flower' },
  { id: 'hide', label: 'Ocultar', icon: 'eyeOff' },
  { id: 'text', label: 'Texto', icon: 'message' },
  { id: 'pets', label: 'Pets', icon: 'paw' },
  { id: 'objects', label: 'Objetos', icon: 'box' }
] as const

function CustomizerCategoryIcon({ category }: { category: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return <svg viewBox="0 0 48 48" aria-hidden="true" {...common}>
    {category === 'modelos' && <>
      <rect x="13" y="8" width="27" height="32" rx="5" opacity=".65" />
      <rect x="7" y="12" width="27" height="32" rx="5" />
      <circle cx="20.5" cy="23" r="5" />
      <path d="M12.5 37c1.3-4.2 4.1-6.4 8-6.4s6.7 2.2 8 6.4" />
    </>}
    {category === 'corpo' && <>
      <circle cx="24" cy="9.5" r="5.5" />
      <path d="M17 18h14l4 10-5 3-2-4v15H20V27l-2 4-5-3 4-10Z" />
      <path d="m20 31-4 11m12-11 4 11M20 21l4 5 4-5" />
    </>}
    {category === 'cabeca' && <>
      <path d="M12 22c0-10 5-16 13-16 8.5 0 13 6.3 13 16v5c0 2.1-1.7 3.8-3.8 3.8-.7 4.7-4.8 8.2-9.2 8.2s-8.5-3.5-9.2-8.2A3.8 3.8 0 0 1 12 27v-5Z" />
      <path d="M12 22c.8-6 4.2-9 8-10 .4 3 2.4 4.8 5.5 5.4 2.7.5 5.3 2.1 7.2 4.6M19.5 27h.1m9-.1h.1M21 33c1.8 1.3 4.2 1.3 6 0" />
    </>}
    {category === 'roupas' && <>
      <path d="m17 9 7 3 7-3 10 7-5 9-5-2v18H17V23l-5 2-5-9 10-7Z" />
      <path d="m17 9 7 8 7-8M24 17v24" />
    </>}
    {category === 'outros' && <>
      <path d="m24 5 3.1 10.2L37 18.5l-9.9 3.2L24 32l-3.1-10.3-9.9-3.2 9.9-3.3L24 5Z" />
      <path d="m37 29 1.8 5.2L44 36l-5.2 1.8L37 43l-1.8-5.2L30 36l5.2-1.8L37 29ZM10 6l1.5 4.5L16 12l-4.5 1.5L10 18l-1.5-4.5L4 12l4.5-1.5L10 6Z" />
    </>}
    {category === 'perfil' && <>
      <rect x="7" y="6" width="34" height="36" rx="4" />
      <circle cx="18" cy="19" r="5" />
      <path d="M10.5 33c1.2-4 3.7-6 7.5-6s6.3 2 7.5 6M29 17h7m-7 6h7m-7 7h7m-18 8h18" />
    </>}
  </svg>
}

export function CustomizerPage() {
  const [characters, setCharacters] = useState<CustomizerCharacter[]>([])
  const charactersRef = useRef<CustomizerCharacter[]>([])
  const characterSaveQueue = useRef(new Map<string, Promise<void>>())
  const [selectedCharacterId, setSelectedCharacterId] = useState('')
  const [charactersLoading, setCharactersLoading] = useState(true)
  const [charactersError, setCharactersError] = useState('')
  const [characterSaveState, setCharacterSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [dialogMode, setDialogMode] = useState<'create' | 'rename' | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [savingCharacter, setSavingCharacter] = useState(false)
  const [activeModule, setActiveModule] = useState<string | null>(null)
  const [selectedCustomizerTopTab, setSelectedCustomizerTopTab] = useState('corpo')
  const [previewBackground, setPreviewBackground] = usePreviewBackground()
  const [rosterQuery, setRosterQuery] = useState('')
  const [catalogModels, setCatalogModels] = useState<FabricatorSlotSummary[]>([])
  const [catalogPoses, setCatalogPoses] = useState<FabricatorPoseSummary[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [selectedCatalogModelSlot, setSelectedCatalogModelSlot] = useState<number | null>(null)
  const [selectedCatalogPoseSlot, setSelectedCatalogPoseSlot] = useState<number | null>(null)
  const [selectedPoseCategory, setSelectedPoseCategory] = useState('Parado')
  const [selectedPosePage, setSelectedPosePage] = useState(0)
  const [modelThumbnails, setModelThumbnails] = useState<Record<number, string>>({})
  const [poseThumbnails, setPoseThumbnails] = useState<Record<string, string>>({})
  const [clothingSection, setClothingSection] = useState<'Customizar' | 'Superior' | 'Inferior'>('Superior')
  const [clothesPanelTab, setClothesPanelTab] = useState<(typeof customizerClothesTabs)[number]['id']>('upper')
  const [upperWardrobePage, setUpperWardrobePage] = useState<1 | 2>(1)
  const [otherPanelTab, setOtherPanelTab] = useState<(typeof customizerOtherTabs)[number]['id']>('extra')
  const [wardrobeSets, setWardrobeSets] = useState<WardrobeSetSummary[]>([])
  const [wardrobeLoading, setWardrobeLoading] = useState(false)
  const [wardrobeDetails, setWardrobeDetails] = useState<Record<string, WardrobeSet>>({})
  const [wardrobeThumbnails, setWardrobeThumbnails] = useState<Record<string, string>>({})
  const [wardrobeLibraryPanel, setWardrobeLibraryPanel] = useState<UpperWardrobePanel | null>(null)
  const [wardrobeLibraryPage, setWardrobeLibraryPage] = useState(0)
  const [faceCatalogItems, setFaceCatalogItems] = useState<FaceCatalogItemSummary[]>([])
  const [faceCatalogDetails, setFaceCatalogDetails] = useState<Record<string, FaceCatalogItem>>({})
  const [faceComponentAssets, setFaceComponentAssets] = useState<FaceComponentAssetSummary[]>([])
  const [faceComponentDetails, setFaceComponentDetails] = useState<Record<string, FaceComponentAsset>>({})
  const [faceDetails, setFaceDetails] = useState<Record<string, FaceSet>>({})
  const [faceLoading, setFaceLoading] = useState(false)
  const [faceComponentLoading, setFaceComponentLoading] = useState(false)
  const [hairStyles, setHairStyles] = useState<HairStyleSummary[]>([])
  const [hairDetails, setHairDetails] = useState<Record<string, HairStyle>>({})
  const [hairCatalogSide, setHairCatalogSide] = useState<HairCatalogSide>('front')
  const [hairLoading, setHairLoading] = useState(false)
  const [hairLibraryPart, setHairLibraryPart] = useState<HairPartId | null>(null)
  const [hairLibraryPage, setHairLibraryPage] = useState(0)
  const [faceLibraryPart, setFaceLibraryPart] = useState<FaceLibraryPartId | null>(null)
  const [faceLibraryPage, setFaceLibraryPage] = useState(0)
  const [faceCatalogLibraryPart, setFaceCatalogLibraryPart] = useState<'nose' | 'eye-highlight-left' | 'mouth' | 'eye-highlight-right' | 'blush' | 'facial-shadow' | null>(null)
  const [faceCatalogLibraryPage, setFaceCatalogLibraryPage] = useState(0)
  const [headPanelTab, setHeadPanelTab] = useState<'hair' | 'eyes' | 'face' | 'extra' | 'adjust'>('hair')
  const [activeHairColorRole, setActiveHairColorRole] = useState<HairColorRole>('base')
  const [selectedClothing, setSelectedClothing] = useState<SelectedWardrobeComponent | null>(null)
  const [wardrobeTransformDraft, setWardrobeTransformDraft] = useState<Pick<CustomizerWardrobeGroup, 'offsetX' | 'offsetY' | 'scaleX' | 'scaleY' | 'rotation'> | null>(null)
  const [selectedWardrobeUrl, setSelectedWardrobeUrl] = useState<string | null>(null)
  const [selectedWardrobeHighlightUrl, setSelectedWardrobeHighlightUrl] = useState<string | null>(null)
  const [wardrobeHighlightVisible, setWardrobeHighlightVisible] = useState(false)
  const [selectedArtworkProject, setSelectedArtworkProject] = useState<CatalogArtwork | null>(null)
  const [proportionEdit, setProportionEdit] = useState<{ characterId: string; values: CharacterProportions } | null>(null)
  const [bodyDimensionEdit, setBodyDimensionEdit] = useState<{ characterId: string; values: CharacterBodyDimensions } | null>(null)
  const [selectedSourceModelProject, setSelectedSourceModelProject] = useState<FabricatorProject | null>(null)
  const [selectedArtworkUrl, setSelectedArtworkUrl] = useState<string | null>(null)
  const [selectedFaceUrl, setSelectedFaceUrl] = useState<string | null>(null)
  const [selectedFrontHairUrl, setSelectedFrontHairUrl] = useState<string | null>(null)
  const [selectedArtworkLabel, setSelectedArtworkLabel] = useState('')
  const [previewLoading, setPreviewLoading] = useState(true)
  const thumbnailCache = useRef(new Set<string>())
  const hairPaletteStripRef = useRef<HTMLDivElement>(null)
  const wardrobePaletteStripRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const previewLoadRequest = useRef(0)
  const clothingDragRef = useRef<{ pointerId: number; clientX: number; clientY: number; scaleX: number; scaleY: number; startX: number; startY: number; groupKey: string; characterId: string; beforeGroups: CustomizerWardrobeGroup[]; latest: CustomizerCharacter | null } | null>(null)
  const wardrobeTransformDirty = useRef(false)
  const selectedCharacter = characters.find((character) => character.id === selectedCharacterId) ?? characters[0] ?? null
  const activeProportions = proportionEdit && selectedCharacter && proportionEdit.characterId === selectedCharacter.id
    ? proportionEdit.values
    : getCharacterProportions(selectedCharacter?.customization)
  const activeBodyDimensions = useMemo(() => bodyDimensionEdit && selectedCharacter && bodyDimensionEdit.characterId === selectedCharacter.id
    ? bodyDimensionEdit.values
    : getCharacterBodyDimensions(selectedCharacter?.customization), [bodyDimensionEdit, selectedCharacter?.id, selectedCharacter?.customization.bodyDimensions])
  const activeShapeScale = characterShapeScale(activeProportions)
  const displayArtworkProject = useMemo(() => selectedArtworkProject ? applyCharacterBodyShape(withCharacterHeadSize(selectedArtworkProject, activeProportions), activeBodyDimensions) : null, [selectedArtworkProject, activeProportions.head, activeProportions.headWidth, activeProportions.headHeight, activeBodyDimensions])
  const previewStyle = { '--preview-background': previewBackground, '--character-scale-x': activeShapeScale.x, '--character-scale-y': activeShapeScale.y } as import('react').CSSProperties
  const characterWardrobeGroups = selectedCharacter?.customization.wardrobeGroups ?? []
  const characterFaceAppearance = selectedCharacter?.customization.faceAppearance
  const characterHairAppearance = selectedCharacter?.customization.hairAppearance
  const characterWardrobeHydrationKey = characterWardrobeGroups.map((group) => `${group.modelSlot}:${group.setId}:${group.category}:${group.componentId ?? ''}`).sort().join('|')
  const visibleCharacters = characters
    .filter((character) => character.name.toLowerCase().includes(rosterQuery.trim().toLowerCase()))

  useEffect(() => {
    let cancelled = false
    void window.desktop.listCustomizerCharacters().then((loaded) => {
      if (cancelled) return
      charactersRef.current = loaded
      setCharacters(loaded)
      let remembered = ''
      try { remembered = localStorage.getItem('nymi.customizer.activeCharacter') ?? '' } catch { /* Storage preferences are optional. */ }
      setSelectedCharacterId(loaded.some((character) => character.id === remembered) ? remembered : loaded[0]?.id ?? '')
    }).catch((reason: unknown) => {
      if (!cancelled) setCharactersError(reason instanceof Error ? reason.message : 'Não foi possível carregar os personagens.')
    }).finally(() => { if (!cancelled) setCharactersLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    try {
      if (selectedCharacterId) localStorage.setItem('nymi.customizer.activeCharacter', selectedCharacterId)
      else localStorage.removeItem('nymi.customizer.activeCharacter')
    } catch { /* Selection persistence is best-effort; character data is stored by Electron. */ }
  }, [selectedCharacterId])

  useEffect(() => {
    let cancelled = false
    void Promise.all([window.desktop.listFabricatorSlots(), window.desktop.listFabricatorPoseSlots()])
      .then(async ([models, poses]) => {
        if (cancelled) return
        setCatalogModels(models)
        setCatalogPoses(poses)
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
    if (catalogLoading) return
    if (!selectedCharacter) {
      setSelectedCatalogModelSlot(null)
      setSelectedCatalogPoseSlot(null)
      setSelectedPoseCategory('Parado')
      setSelectedPosePage(0)
      setSelectedArtworkUrl(null)
      setSelectedArtworkLabel('')
      setSelectedArtworkProject(null)
      setSelectedSourceModelProject(null)
      setSelectedWardrobeUrl(null)
      setPreviewLoading(false)
      return
    }
    const model = catalogModels.find((item) => item?.slot === selectedCharacter.customization.modelSlot)
      ?? catalogModels.find((item) => item?.slot === 1)
      ?? catalogModels.find((item) => item !== null)
    if (!model) {
      setSelectedCatalogModelSlot(null)
      setSelectedCatalogPoseSlot(null)
      setSelectedPoseCategory('Parado')
      setSelectedPosePage(0)
      setSelectedArtworkUrl(null)
      setSelectedArtworkLabel('')
      setSelectedArtworkProject(null)
      setSelectedSourceModelProject(null)
      setSelectedWardrobeUrl(null)
      setPreviewLoading(false)
      return
    }
    const requestedPose = selectedCharacter.customization.poseSlot
    const pose = requestedPose === null ? null : catalogPoses.find((item) => item?.sourceModelSlot === model.slot && item.slot === requestedPose)
    const requestId = ++previewLoadRequest.current
    let cancelled = false
    setSelectedCatalogModelSlot(model.slot)
    setSelectedPosePage(0)
    setSelectedCatalogPoseSlot(pose?.slot ?? null)
    setSelectedPoseCategory(pose ? resolvePoseCategory(pose) : 'Parado')
    setSelectedArtworkLabel(pose?.name ?? model.name)
    setSelectedArtworkUrl(null)
    setPreviewLoading(true)
    void (async () => {
      try {
        const sourceProject = await window.desktop.loadFabricatorSlot(model.slot)
        if (!sourceProject) throw new Error('O modelo de referência não está disponível no Fabricador Dev.')
        const artwork = pose ? await window.desktop.loadFabricatorPose(model.slot, pose.slot) : sourceProject
        if (!artwork) throw new Error('Não foi possível carregar a prévia deste personagem.')
        if (!cancelled && previewLoadRequest.current === requestId) { setSelectedArtworkProject(artwork); setSelectedSourceModelProject(sourceProject) }
        const artworkUrl = await renderArtwork(applyCharacterBodyShape(withCharacterHeadSize(artwork, activeProportions), activeBodyDimensions), 720, selectedCharacter.customization.modelSkinTone)
        if (!cancelled && previewLoadRequest.current === requestId) setSelectedArtworkUrl(artworkUrl)
      } catch (reason) {
        if (!cancelled && previewLoadRequest.current === requestId) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível carregar a prévia.')
      } finally {
        if (!cancelled && previewLoadRequest.current === requestId) setPreviewLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [catalogLoading, catalogModels, catalogPoses, selectedCharacter?.id, selectedCharacter?.customization.modelSkinTone])

  useEffect(() => {
    if (!displayArtworkProject) return
    let cancelled = false
    void renderArtwork(displayArtworkProject, 720, selectedCharacter?.customization.modelSkinTone).then((url) => {
      if (!cancelled) setSelectedArtworkUrl(url)
    }).catch((reason: unknown) => {
      if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível atualizar a forma do corpo.')
    })
    return () => { cancelled = true }
  }, [displayArtworkProject, selectedCharacter?.customization.modelSkinTone])

  useEffect(() => {
    setSelectedClothing(null)
    setWardrobeHighlightVisible(false)
  }, [selectedCharacter?.id])

  useEffect(() => {
    if (!selectedCharacter || selectedClothing) return
    const firstGroup = selectedCharacter?.customization.wardrobeGroups?.[0]
    const firstSet = firstGroup ? wardrobeDetails[`${firstGroup.modelSlot}:${firstGroup.setId}`] : undefined
    const firstDefinition = firstGroup ? Object.values(clothingCategories).flat().find((item) => item.id === firstGroup.category) : undefined
    const firstComponent = firstGroup && firstSet
      ? firstGroup.componentId
        ? firstSet.components.find((component) => component.id === firstGroup.componentId)
        : firstSet.components.find((component) => firstDefinition?.source.includes(component.category))
      : undefined
    setSelectedClothing(firstGroup && firstComponent ? { setId: firstGroup.setId, category: firstGroup.category, componentId: firstComponent.id } : null)
    setWardrobeHighlightVisible(Boolean(firstComponent))
  }, [selectedCharacter?.id, selectedCharacter?.customization.wardrobeGroups, selectedClothing, wardrobeDetails])

  useEffect(() => {
    const group = selectedClothing
      ? selectedCharacter?.customization.wardrobeGroups?.find((item) => item.setId === selectedClothing.setId && item.category === selectedClothing.category && (item.componentId === selectedClothing.componentId || !item.componentId))
      : undefined
    wardrobeTransformDirty.current = false
    setWardrobeTransformDraft(group ? { offsetX: group.offsetX, offsetY: group.offsetY, scaleX: group.scaleX, scaleY: group.scaleY, rotation: group.rotation } : null)
  }, [selectedCharacter?.id, selectedCharacter?.customization.wardrobeGroups, selectedClothing?.setId, selectedClothing?.category, selectedClothing?.componentId])

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
    if ((activeModule !== 'Poses' && selectedCustomizerTopTab !== 'modelos') || selectedCatalogModelSlot === null || catalogLoading) return
    let cancelled = false
    const modelPoses = catalogPoses.filter((pose): pose is NonNullable<typeof pose> => pose?.sourceModelSlot === selectedCatalogModelSlot)
    void (async () => {
      for (const pose of modelPoses) {
        const key = `${pose.sourceModelSlot}:${pose.slot}`
        const cacheKey = `pose-tight-v2:${key}:${pose.updatedAt}`
        if (thumbnailCache.current.has(cacheKey)) continue
        try {
          const artwork: FabricatorPose | null = await window.desktop.loadFabricatorPose(pose.sourceModelSlot, pose.slot)
          if (!artwork) continue
          const thumbnail = await renderArtwork(artwork, 420, undefined, true)
          if (cancelled) return
          if (thumbnail) {
            thumbnailCache.current.add(cacheKey)
            setPoseThumbnails((current) => ({ ...current, [key]: thumbnail }))
          }
        } catch (reason) {
          if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível gerar uma miniatura da pose.')
        }
      }
    })()
    return () => { cancelled = true }
  }, [activeModule, catalogLoading, catalogPoses, selectedCatalogModelSlot, selectedCustomizerTopTab])

  useEffect(() => {
    if (activeModule !== 'Roupas' || selectedCatalogModelSlot === null) return
    let cancelled = false
    setWardrobeLoading(true)
    void window.desktop.listWardrobeSets(selectedCatalogModelSlot).then((sets) => {
      if (!cancelled) setWardrobeSets(sets)
    }).catch((reason: unknown) => {
      if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível carregar o catálogo de roupas.')
    }).finally(() => { if (!cancelled) setWardrobeLoading(false) })
    return () => { cancelled = true }
  }, [activeModule, selectedCatalogModelSlot])

  useEffect(() => {
    if (selectedCatalogModelSlot === null) { setFaceCatalogItems([]); return }
    let cancelled = false
    setFaceLoading(true)
    void window.desktop.listFaceCatalog(selectedCatalogModelSlot).then(async (summaries) => {
      if (cancelled) return
      setFaceCatalogItems(summaries)
      const loaded = await Promise.all(summaries.map(async (summary) => ({ key: `${summary.modelSlot}:${summary.id}`, item: await window.desktop.loadFaceCatalogItem(summary.modelSlot, summary.id) })))
      if (cancelled) return
      setFaceCatalogDetails((current) => {
        const next = { ...current }
        for (const entry of loaded) if (entry.item) next[entry.key] = entry.item
        return next
      })
    }).catch((reason: unknown) => {
      if (!cancelled && activeModule === 'Cabeça') setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível carregar os rostos salvos.')
    }).finally(() => { if (!cancelled) setFaceLoading(false) })
    return () => { cancelled = true }
  }, [selectedCatalogModelSlot, activeModule])

  useEffect(() => {
    if (selectedCatalogModelSlot === null) { setFaceComponentAssets([]); setFaceComponentDetails({}); setFaceComponentLoading(false); return }
    let cancelled = false
    setFaceComponentLoading(true)
    void window.desktop.listFaceComponentAssets(selectedCatalogModelSlot).then(async (summaries) => {
      const details = await Promise.all(summaries.map((summary) => window.desktop.loadFaceComponentAsset(selectedCatalogModelSlot, summary.id)))
      if (cancelled) return
      for (const item of details) if (item) faceComponentAssetCache.set(`${selectedCatalogModelSlot}:${item.id}`, Promise.resolve(item))
      setFaceComponentAssets(summaries)
      setFaceComponentDetails(Object.fromEntries(details.filter((item): item is FaceComponentAsset => Boolean(item)).map((item) => [item.id, item])))
    }).catch((reason: unknown) => { if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível carregar os assets faciais.') }).finally(() => { if (!cancelled) setFaceComponentLoading(false) })
    return () => { cancelled = true }
  }, [selectedCatalogModelSlot])

  useEffect(() => {
    const appearance = characterFaceAppearance
    if (!appearance?.setId || appearance.modelSlot !== selectedCatalogModelSlot) return
    let cancelled = false
    const key = `${appearance.modelSlot}:${appearance.setId}`
    if (faceDetails[key]) return
    void window.desktop.loadFaceSet(appearance.modelSlot, appearance.setId).then((face) => {
      if (!cancelled && face) setFaceDetails((current) => ({ ...current, [key]: face }))
    }).catch((reason: unknown) => {
      if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível carregar o rosto legado.')
    })
    return () => { cancelled = true }
  }, [characterFaceAppearance, faceDetails, selectedCatalogModelSlot])

  useEffect(() => {
    if (selectedCatalogModelSlot === null || !(activeModule === 'Cabelos' || activeModule === 'Cabeça' && headPanelTab === 'hair')) { setHairStyles([]); return }
    let cancelled = false
    setHairLoading(true)
    void window.desktop.listHairStyles(selectedCatalogModelSlot).then(async (summaries) => {
      const styles = await Promise.all(summaries.map((summary) => window.desktop.loadHairStyle(selectedCatalogModelSlot, summary.id)))
      if (cancelled) return
      setHairStyles(summaries)
      setHairDetails((current) => {
        const next = { ...current }
        for (const style of styles) if (style) next[`${selectedCatalogModelSlot}:${style.id}`] = style
        return next
      })
    }).catch((reason: unknown) => {
      if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível carregar o catálogo de cabelos.')
    }).finally(() => { if (!cancelled) setHairLoading(false) })
    return () => { cancelled = true }
  }, [activeModule, headPanelTab, selectedCatalogModelSlot])

  useEffect(() => {
    let cancelled = false
    const appearance = characterFaceAppearance
    const hasCatalogSelection = Boolean(appearance?.eyeCatalogId || appearance?.eyeLeftCatalogId || appearance?.eyeRightCatalogId || appearance?.eyebrowCatalogId || appearance?.eyebrowLeftCatalogId || appearance?.eyebrowRightCatalogId || appearance?.noseCatalogId || appearance?.mouthClosedCatalogId || appearance?.mouthOpenCatalogId || Object.values(appearance?.components ?? {}).some((component) => component?.assetId) || Object.values(appearance?.faceDetails ?? {}).some(Boolean))
    const face = appearance?.setId ? faceDetails[`${appearance.modelSlot}:${appearance.setId}`] : null
    const catalogItems: Partial<Record<FaceSheetKind | FaceElementKind, FaceCatalogItem>> = {}
    if (appearance && hasCatalogSelection) {
      const ids: Partial<Record<FaceSheetKind | FaceElementKind, string | undefined>> = { eyes: appearance.eyeCatalogId, 'eye-left': appearance.eyeLeftCatalogId ?? undefined, 'eye-right': appearance.eyeRightCatalogId ?? undefined, eyebrows: appearance.eyebrowCatalogId, 'brow-left': appearance.eyebrowLeftCatalogId ?? undefined, 'brow-right': appearance.eyebrowRightCatalogId ?? undefined, nose: appearance.noseCatalogId, 'mouth-closed': appearance.mouthClosedCatalogId, 'mouth-open': appearance.mouthOpenCatalogId }
      for (const [category, id] of Object.entries(ids) as Array<[FaceSheetKind | FaceElementKind, string | undefined]>) {
        if (!id) continue
        const item = faceCatalogDetails[`${appearance.modelSlot}:${id}`]
        if (item) catalogItems[category] = item
      }
    }
    if (!displayArtworkProject || !selectedSourceModelProject || !appearance || (!hasCatalogSelection && !face)) { setSelectedFaceUrl(null); return }
    const render = hasCatalogSelection
      ? renderFaceCatalogOverlay(displayArtworkProject, selectedSourceModelProject, catalogItems, appearance)
      : renderFaceOverlay(displayArtworkProject, selectedSourceModelProject, face, appearance)
    void render.then((url) => {
      if (!cancelled) setSelectedFaceUrl(url)
    }).catch((reason: unknown) => {
      if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível montar o rosto do personagem.')
    })
    return () => { cancelled = true }
  }, [characterFaceAppearance, faceCatalogDetails, faceDetails, displayArtworkProject, selectedSourceModelProject])

  useEffect(() => {
    let cancelled = false
    const artwork = displayArtworkProject
    const source = selectedSourceModelProject
    const appearance = selectedCharacter?.customization.hairAppearance
    if (!artwork || !source) return
    void (async () => {
      const [backStyles, posteriorStyles, fringeStyles] = await Promise.all([
        loadHairAppearanceLayers(appearance, source.slot, 'back', hairDetails),
        loadHairAppearanceLayers(appearance, source.slot, 'front', hairDetails),
        loadHairAppearanceLayers(appearance, source.slot, 'fringe', hairDetails)
      ])
      const frontStyles = [...posteriorStyles, ...fringeStyles]
      if (cancelled) return
      const newlyLoaded: Record<string, HairStyle> = {}
      for (const layer of [...backStyles, ...frontStyles]) if (!hairDetails[`${source.slot}:${layer.style.id}`]) newlyLoaded[`${source.slot}:${layer.style.id}`] = layer.style
      if (Object.keys(newlyLoaded).length) setHairDetails((current) => ({ ...current, ...newlyLoaded }))
      const [url, frontUrl] = await Promise.all([
        renderArtworkWithHair(artwork, source, backStyles, 720, selectedCharacter?.customization.modelSkinTone, appearance?.modelSlot === source.slot ? appearance : undefined),
        renderFrontHairOverlay(artwork, source, frontStyles, 720, appearance?.modelSlot === source.slot ? appearance : undefined)
      ])
      if (!cancelled) { setSelectedArtworkUrl(url); setSelectedFrontHairUrl(frontUrl) }
    })().catch((reason: unknown) => {
      if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível montar o cabelo do personagem.')
    })
    return () => { cancelled = true }
  }, [displayArtworkProject, selectedSourceModelProject, selectedCharacter?.id, selectedCharacter?.customization.hairAppearance, selectedCharacter?.customization.modelSkinTone, hairDetails])

  useEffect(() => {
    if (activeModule !== 'Roupas' || !wardrobeSets.length) return
    let cancelled = false
    void (async () => {
      for (const summary of wardrobeSets) {
        let set: WardrobeSet | null = null
        try {
          set = await window.desktop.loadWardrobeSet(summary.modelSlot, summary.id)
          if (!set || cancelled) continue
          setWardrobeDetails((current) => ({ ...current, [`${summary.modelSlot}:${summary.id}`]: set! }))
          for (const group of Object.values(clothingCategories).flat()) {
            if (!set.components.some((component) => group.source.includes(component.category))) continue
            const key = `${summary.modelSlot}:${summary.id}:${group.id}`
            if (wardrobeThumbnails[key]) continue
            const thumbnail = await renderWardrobeThumbnail(set, group.source)
            if (cancelled) return
            if (thumbnail) setWardrobeThumbnails((current) => ({ ...current, [key]: thumbnail }))
          }
        } catch (reason) {
          if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível montar a miniatura da roupa.')
        }
      }
    })()
    return () => { cancelled = true }
  }, [activeModule, wardrobeSets])

  useEffect(() => {
    if (!selectedCharacter || !characterWardrobeGroups.length) return
    let cancelled = false
    const groupsToRestore = [...characterWardrobeGroups]
    void (async () => {
      const restored = await Promise.all(groupsToRestore.map(async (group) => {
        const key = `${group.modelSlot}:${group.setId}`
        const set = await window.desktop.loadWardrobeSet(group.modelSlot, group.setId)
        return { group, key, set }
      }))
      if (cancelled) return
      setWardrobeDetails((current) => {
        const next = { ...current }
        for (const { key, set } of restored) if (set) next[key] = set
        return next
      })
      const migratedGroups = restored.flatMap(({ group, set }) => {
        if (group.componentId || !set) return [group]
        const definition = Object.values(clothingCategories).flat().find((item) => item.id === group.category)
        const components = set.components.filter((component) => definition?.source.includes(component.category))
        return components.length ? components.map((component) => ({ ...group, componentId: component.id })) : [group]
      })
      if (migratedGroups.some((group, index) => group.componentId !== groupsToRestore[index]?.componentId) || migratedGroups.length !== groupsToRestore.length) {
        const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
        await saveCharacter({ ...current, customization: { ...current.customization, wardrobeGroups: migratedGroups }, updatedAt: new Date().toISOString() })
      }
      for (const { group, set } of restored) {
        if (!set) continue
        const category = Object.values(clothingCategories).flat().find((definition) => definition.id === group.category)
        if (!category) continue
        const thumbnailKey = `${group.modelSlot}:${group.setId}:${group.category}`
        if (wardrobeThumbnails[thumbnailKey]) continue
        const thumbnail = await renderWardrobeThumbnail(set, category.source)
        if (cancelled) return
        if (thumbnail) setWardrobeThumbnails((current) => ({ ...current, [thumbnailKey]: thumbnail }))
      }
    })().catch((reason: unknown) => {
      if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível restaurar as roupas deste personagem.')
    })
    return () => { cancelled = true }
  }, [selectedCharacter?.id, characterWardrobeHydrationKey])

  useEffect(() => {
    let cancelled = false
    const groups = selectedCharacter?.customization.wardrobeGroups ?? []
    if (!displayArtworkProject || !groups.length) {
      setSelectedWardrobeUrl(null)
      return
    }
    const previewGroups = wardrobeTransformDraft && selectedClothing
      ? groups.map((group) => group.setId === selectedClothing.setId && group.category === selectedClothing.category && (group.componentId === selectedClothing.componentId || !group.componentId) ? { ...group, componentId: selectedClothing.componentId, ...wardrobeTransformDraft } : group)
      : groups
    void renderWardrobeOverlay(previewGroups, wardrobeDetails, displayArtworkProject, selectedCatalogModelSlot, selectedSourceModelProject, wardrobeHighlightVisible ? selectedClothing : null, selectedCharacter?.customization.modelSkinTone).then((result) => {
      if (!cancelled) { setSelectedWardrobeUrl(result.imageUrl); setSelectedWardrobeHighlightUrl(result.selectedUrl) }
    }).catch((reason: unknown) => {
      if (!cancelled) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível compor as roupas do personagem.')
    })
    return () => { cancelled = true }
  }, [selectedCharacter?.id, selectedCharacter?.customization.modelSkinTone, selectedCharacter?.customization.wardrobeGroups, wardrobeDetails, displayArtworkProject, selectedCatalogModelSlot, selectedSourceModelProject, selectedClothing?.setId, selectedClothing?.category, selectedClothing?.componentId, wardrobeTransformDraft, wardrobeHighlightVisible])

  function selectCharacter(id: string) {
    setSelectedCharacterId(id)
    setActiveModule(null)
  }

  async function saveCharacter(next: CustomizerCharacter) {
    setCharactersError('')
    setCharacterSaveState('saving')
    charactersRef.current = charactersRef.current.map((character) => character.id === next.id ? next : character)
    setCharacters(charactersRef.current)
    const previousWrite = characterSaveQueue.current.get(next.id)
    const write = (previousWrite ? previousWrite.catch(() => undefined) : Promise.resolve())
      .then(() => window.desktop.saveCustomizerCharacter(next))
    characterSaveQueue.current.set(next.id, write)
    try {
      await write
      setCharacterSaveState('saved')
    } catch (reason) {
      setCharacterSaveState('error')
      setCharactersError(reason instanceof Error ? reason.message : 'Não foi possível salvar o personagem.')
      if (characterSaveQueue.current.get(next.id) === write) {
        const latest = await window.desktop.listCustomizerCharacters().catch(() => null)
        if (latest) {
          charactersRef.current = latest
          setCharacters(latest)
        }
      }
    } finally {
      if (characterSaveQueue.current.get(next.id) === write) characterSaveQueue.current.delete(next.id)
    }
  }

  async function saveCharacterCustomization(patch: Partial<CustomizerCharacter['customization']> | ((current: CustomizerCharacter['customization']) => Partial<CustomizerCharacter['customization']>)) {
    if (!selectedCharacter) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const changes = typeof patch === 'function' ? patch(current.customization) : patch
    await saveCharacter({ ...current, customization: { ...current.customization, ...changes }, updatedAt: new Date().toISOString() })
  }

  function changeProportion(key: keyof CharacterProportions, value: number) {
    if (!selectedCharacter) return
    const { min, max } = characterProportionLimits[key]
    setProportionEdit({ characterId: selectedCharacter.id, values: { ...activeProportions, [key]: Math.min(max, Math.max(min, Math.round(value))) } })
  }

  function commitProportions(values: CharacterProportions) {
    if (!selectedCharacter) return
    setProportionEdit({ characterId: selectedCharacter.id, values })
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const saved = getCharacterProportions(current.customization)
    if ((Object.keys(values) as Array<keyof CharacterProportions>).every((key) => saved[key] === values[key])) return
    void saveCharacterCustomization({ proportions: values })
  }

  function commitProportion(key: keyof CharacterProportions, value: number) {
    const { min, max } = characterProportionLimits[key]
    commitProportions({ ...activeProportions, [key]: Math.min(max, Math.max(min, Math.round(value))) })
  }

  function commitBodyDimensions(values: CharacterBodyDimensions) {
    if (!selectedCharacter) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const saved = getCharacterBodyDimensions(current.customization)
    if ((Object.keys(values) as Array<keyof CharacterBodyDimensions>).every((key) => saved[key] === values[key])) return
    void saveCharacterCustomization({ bodyDimensions: values })
  }

  function commitBodyDimension(key: keyof CharacterBodyDimensions, value: number) {
    const { min, max } = characterBodyDimensionLimits[key]
    const values = { ...activeBodyDimensions, [key]: Math.min(max, Math.max(min, Math.round(value))) }
    setBodyDimensionEdit(selectedCharacter ? { characterId: selectedCharacter.id, values } : null)
    commitBodyDimensions(values)
  }

  function changeBodyDimension(key: keyof CharacterBodyDimensions, value: number) {
    if (!selectedCharacter) return
    const { min, max } = characterBodyDimensionLimits[key]
    setBodyDimensionEdit({ characterId: selectedCharacter.id, values: { ...activeBodyDimensions, [key]: Math.min(max, Math.max(min, Math.round(value))) } })
  }

  async function chooseFaceCatalogItem(summary: FaceCatalogItemSummary, variantIndex?: number) {
    const item = faceCatalogDetails[`${summary.modelSlot}:${summary.id}`] ?? await window.desktop.loadFaceCatalogItem(summary.modelSlot, summary.id)
    if (!item || !selectedCharacter) return
    setFaceCatalogDetails((current) => ({ ...current, [`${summary.modelSlot}:${summary.id}`]: item }))
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const previous = current.customization.faceAppearance
    const field: Record<FaceSheetKind, keyof CustomizerFaceAppearance> = {
      eyes: 'eyeCatalogId', eyebrows: 'eyebrowCatalogId', nose: 'noseCatalogId',
      'mouth-closed': 'mouthClosedCatalogId', 'mouth-open': 'mouthOpenCatalogId'
    }
    const sameModel = previous?.modelSlot === item.modelSlot
    const migrated: Partial<Pick<CustomizerFaceAppearance, 'eyeCatalogId' | 'eyebrowCatalogId' | 'noseCatalogId' | 'mouthClosedCatalogId' | 'mouthOpenCatalogId'>> = {}
    if (sameModel && previous?.setId) {
      const legacySet = await window.desktop.loadFaceSet(previous.modelSlot, previous.setId)
      for (const kind of Object.keys(field) as FaceSheetKind[]) {
        if (!legacySet?.sheets[kind]) continue
        const legacyItemId = `legacy_${legacySet.id}_${kind}`
        if (!faceCatalogItems.some((entry) => entry.id === legacyItemId)) continue
        if (kind === 'eyes') migrated.eyeCatalogId = legacyItemId
        else if (kind === 'eyebrows') migrated.eyebrowCatalogId = legacyItemId
        else if (kind === 'nose') migrated.noseCatalogId = legacyItemId
        else if (kind === 'mouth-closed') migrated.mouthClosedCatalogId = legacyItemId
        else migrated.mouthOpenCatalogId = legacyItemId
      }
    }
    const appearance: CustomizerFaceAppearance = {
      ...(sameModel ? previous : undefined),
      ...migrated,
      modelSlot: item.modelSlot,
      setId: undefined,
      [field[item.category]]: item.id,
      eyeState: sameModel ? previous.eyeState : 0,
      eyebrows: sameModel ? previous.eyebrows : true,
      noseIndex: item.category === 'nose' ? variantIndex ?? item.selectedNose : sameModel ? previous.noseIndex : item.selectedNose,
      expressionIndex: item.category.startsWith('mouth') ? variantIndex ?? item.selectedExpression : sameModel ? previous.expressionIndex : item.selectedExpression,
      mouthOpen: item.category === 'mouth-open' ? true : item.category === 'mouth-closed' ? false : sameModel ? previous.mouthOpen : false
    }
    if (item.category === 'eyes' || item.category === 'eyebrows') {
      setHeadPanelTab('eyes')
    } else {
      setHeadPanelTab('face')
    }
    await saveCharacterCustomization({ faceAppearance: appearance })
  }

  async function chooseFacePartCatalogItem(partId: FaceLibraryPartId, summary: FaceComponentAssetSummary) {
    const part = customizerFaceParts.find((entry) => entry.id === partId)
    if (!part || !selectedCharacter) return
    const categoryParts = customizerFaceParts.filter((candidate) => candidate.category === part.category)
    const leftPart = categoryParts.find((candidate) => candidate.side === 'left')
    const rightPart = categoryParts.find((candidate) => candidate.side === 'right')
    const leftSummary = isRightFaceAsset(summary)
      ? faceComponentAssets.find((candidate) => !isRightFaceAsset(candidate) && sameFaceAssetPair(candidate, summary, faceComponentDetails)) ?? summary
      : summary
    const rightSummary = isRightFaceAsset(leftSummary)
      ? leftSummary
      : faceComponentAssets.find((candidate) => sameFaceAssetPair(leftSummary, candidate, faceComponentDetails)) ?? leftSummary
    const selectedAssets = new Map<string, FaceComponentAsset>()
    for (const candidate of new Set([leftSummary, rightSummary])) {
      const asset = faceComponentDetails[candidate.id] ?? await window.desktop.loadFaceComponentAsset(candidate.modelSlot, candidate.id)
      if (asset) selectedAssets.set(candidate.id, asset)
    }
    const item = selectedAssets.get((part.side === 'right' ? rightSummary : leftSummary).id)
    if (!item || !leftPart || !rightPart) return
    setFaceComponentDetails((current) => ({ ...current, ...Object.fromEntries(selectedAssets) }))
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const previous = current.customization.faceAppearance
    const sameModel = previous?.modelSlot === item.modelSlot
    const linkedSides = { ...(sameModel ? previous?.linkedSides : undefined), [part.category]: false }
    const previousComponents = sameModel ? previous?.components : undefined
    const appearance: CustomizerFaceAppearance = {
      ...(sameModel ? previous : undefined), modelSlot: item.modelSlot, setId: undefined, linkedSides,
      components: {
        ...(previousComponents ?? {}),
        [leftPart.id]: { ...previousComponents?.[leftPart.id], assetId: leftSummary.id, transform: undefined },
        [rightPart.id]: { ...previousComponents?.[rightPart.id], assetId: rightSummary.id, transform: undefined }
      },
      eyeState: sameModel ? previous.eyeState : 0,
      eyebrows: sameModel ? previous.eyebrows : true,
      noseIndex: sameModel ? previous.noseIndex : 0,
      expressionIndex: sameModel ? previous.expressionIndex : 0,
      mouthOpen: sameModel ? previous.mouthOpen : false
    }
    await saveCharacterCustomization({ faceAppearance: appearance })
  }

  async function setFacePartColor(part: FaceLibraryPartId, role: HairColorRole, value: string) {
    if (!selectedCharacter || selectedCatalogModelSlot === null) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const previous = current.customization.faceAppearance
    const appearanceBefore = previous?.modelSlot === selectedCatalogModelSlot ? previous : undefined
    const partDefinition = customizerFaceParts.find((entry) => entry.id === part)!
    const targetPart = facePartSourceId(partDefinition)
    const components = { ...(appearanceBefore?.components ?? {}) }
    components[targetPart] = { ...(components[targetPart] ?? { assetId: null }), colors: { ...components[targetPart]?.colors, [role]: value } }
    const appearance: CustomizerFaceAppearance = previous?.modelSlot === selectedCatalogModelSlot ? { ...previous, components } : {
      modelSlot: selectedCatalogModelSlot, eyeState: 0, eyebrows: true, noseIndex: 0, expressionIndex: 0, mouthOpen: false, components
    }
    await saveCharacterCustomization({ faceAppearance: appearance })
  }

  async function resetFacePartColors(part: FaceLibraryPartId) {
    if (!selectedCharacter || selectedCatalogModelSlot === null) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const previous = current.customization.faceAppearance
    if (!previous || previous.modelSlot !== selectedCatalogModelSlot) return
    const partDefinition = customizerFaceParts.find((entry) => entry.id === part)!
    const targetPart = facePartSourceId(partDefinition)
    const components = { ...previous.components }
    if (components[targetPart]) components[targetPart] = { ...components[targetPart]!, colors: undefined }
    await saveCharacterCustomization({ faceAppearance: { ...previous, components } })
  }

  async function clearFacePartSelection(partId: FaceLibraryPartId) {
    const part = customizerFaceParts.find((entry) => entry.id === partId)
    if (!part || !selectedCharacter || selectedCatalogModelSlot === null) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const previous = current.customization.faceAppearance
    if (!previous || previous.modelSlot !== selectedCatalogModelSlot) return
    const pair = customizerFaceParts.filter((candidate) => candidate.category === part.category)
    const components = { ...previous.components }
    for (const targetPart of pair) {
      components[targetPart.id] = { ...(previous.components?.[targetPart.id] ?? { assetId: null }), assetId: null }
    }
    const appearance = { ...previous, components }
    await saveCharacterCustomization({ faceAppearance: hasSelectedFaceAsset(appearance) ? appearance : undefined })
  }

  async function chooseHairStyle(summary: HairStyleSummary | null, side: HairCatalogSide) {
    if (!selectedCharacter) return
    const modelSlot = summary?.modelSlot ?? selectedCatalogModelSlot
    if (modelSlot === null || modelSlot === undefined) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const previous = current.customization.hairAppearance
    const sameModel = previous?.modelSlot === modelSlot
    const frontStyleId = side === 'front' ? summary?.id ?? null : sameModel ? hairAppearanceStyleId(previous, 'front') : null
    const backStyleId = side === 'back' ? summary?.id ?? null : sameModel ? hairAppearanceStyleId(previous, 'back') : null
    await saveCharacterCustomization({ hairAppearance: { ...(sameModel ? previous : undefined), modelSlot, frontStyleId, backStyleId } })
  }

  async function chooseHairPartStyle(part: HairPartId, summary: HairStyleSummary | null) {
    if (!selectedCharacter || selectedCatalogModelSlot === null) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const previous = current.customization.hairAppearance
    const sameModel = previous?.modelSlot === selectedCatalogModelSlot
    const previousParts = sameModel ? previous?.parts : undefined
    const parts = { ...(previousParts ?? {}), ...(part === 'frontHair' && previousParts?.frontHair && !previousParts.rearHair ? { rearHair: previousParts.frontHair } : {}), [part]: summary?.id ?? null }
    await saveCharacterCustomization({ hairAppearance: { ...(sameModel ? previous : undefined), modelSlot: selectedCatalogModelSlot, parts } })
  }

  async function setHairColor(role: HairColorRole, value: string) {
    if (!selectedCharacter || selectedCatalogModelSlot === null) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const previous = current.customization.hairAppearance
    const sameModel = previous?.modelSlot === selectedCatalogModelSlot
    const partColors = { ...(sameModel ? previous?.partColors : undefined) }
    for (const part of customizerHairParts) {
      if (!partColors[part.id]?.[role]) continue
      const next = { ...partColors[part.id] }
      delete next[role]
      if (Object.keys(next).length) partColors[part.id] = next
      else delete partColors[part.id]
    }
    await saveCharacterCustomization({ hairAppearance: {
      ...(sameModel ? previous : undefined),
      modelSlot: selectedCatalogModelSlot,
      colors: { ...(sameModel ? previous?.colors : undefined), [role]: value },
      partColors
    } })
  }

  async function setHairPartColor(part: HairPartId, role: HairColorRole, value: string) {
    if (!selectedCharacter || selectedCatalogModelSlot === null) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const previous = current.customization.hairAppearance
    const sameModel = previous?.modelSlot === selectedCatalogModelSlot
    const partColors = { ...(sameModel ? previous?.partColors : undefined) }
    partColors[part] = { ...partColors[part], [role]: value }
    await saveCharacterCustomization({ hairAppearance: { ...(sameModel ? previous : undefined), modelSlot: selectedCatalogModelSlot, partColors } })
  }

  async function resetHairPartColors(part: HairPartId) {
    if (!selectedCharacter || selectedCatalogModelSlot === null) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const previous = current.customization.hairAppearance
    if (!previous || previous.modelSlot !== selectedCatalogModelSlot) return
    const partColors = { ...previous.partColors }
    delete partColors[part]
    await saveCharacterCustomization({ hairAppearance: { ...previous, partColors } })
  }

  async function applyHairPalette(colors: HairColorOverrides) {
    if (!selectedCharacter || selectedCatalogModelSlot === null) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const previous = current.customization.hairAppearance
    const sameModel = previous?.modelSlot === selectedCatalogModelSlot
    await saveCharacterCustomization({ hairAppearance: { ...(sameModel ? previous : undefined), modelSlot: selectedCatalogModelSlot, colors, partColors: {} } })
  }

  async function restoreHairColors() {
    if (!selectedCharacter || selectedCatalogModelSlot === null) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const previous = current.customization.hairAppearance
    if (!previous || previous.modelSlot !== selectedCatalogModelSlot) return
    await saveCharacterCustomization({ hairAppearance: { ...previous, colors: undefined, partColors: undefined } })
  }

  async function setFaceCatalogVariant(patch: Partial<CustomizerFaceAppearance>) {
    if (!selectedCharacter || selectedCatalogModelSlot === null) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const old = current.customization.faceAppearance
    const sameModel = old?.modelSlot === selectedCatalogModelSlot
    const appearance: CustomizerFaceAppearance = {
      ...(sameModel ? old : undefined), modelSlot: selectedCatalogModelSlot,
      eyeState: sameModel ? old.eyeState : 0, eyebrows: sameModel ? old.eyebrows : true,
      noseIndex: sameModel ? old.noseIndex : 0, expressionIndex: sameModel ? old.expressionIndex : 0,
      mouthOpen: sameModel ? old.mouthOpen : false, ...patch
    }
    await saveCharacterCustomization({ faceAppearance: hasSelectedFaceAsset(appearance) ? appearance : undefined })
  }

  async function chooseFaceDetailCatalogItem(kind: FaceDetailKind, summary: FaceComponentAssetSummary) {
    if (!selectedCharacter || selectedCatalogModelSlot === null || summary.modelSlot !== selectedCatalogModelSlot) return
    const details = { ...(activeFaceAppearance?.faceDetails ?? {}), [kind]: summary.id }
    await setFaceCatalogVariant({ faceDetails: details })
  }

  async function clearFaceCatalogPart(part: 'nose' | 'mouth' | FaceDetailKind) {
    if (!selectedCharacter || selectedCatalogModelSlot === null) return
    if (part !== 'nose' && part !== 'mouth') {
      const details = { ...(activeFaceAppearance?.faceDetails ?? {}), [part]: null }
      await setFaceCatalogVariant({ faceDetails: details })
      return
    }
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const previous = current.customization.faceAppearance
    const sameModel = previous?.modelSlot === selectedCatalogModelSlot
    const base: CustomizerFaceAppearance = sameModel ? { ...previous } : {
      modelSlot: selectedCatalogModelSlot, eyeState: 0, eyebrows: true, noseIndex: 0, expressionIndex: 0, mouthOpen: false
    }
    const faceAppearance = part === 'nose'
      ? { ...base, noseCatalogId: undefined, noseIndex: 0 }
      : { ...base, mouthClosedCatalogId: undefined, mouthOpenCatalogId: undefined, expressionIndex: 0 }
    await saveCharacterCustomization({ faceAppearance: hasSelectedFaceAsset(faceAppearance) ? faceAppearance : undefined })
  }

  function wardrobeGroupKey(group: Pick<CustomizerWardrobeGroup, 'modelSlot' | 'setId' | 'category' | 'componentId'>) {
    return `${group.modelSlot}:${group.setId}:${group.category}:${group.componentId ?? ''}`
  }

  async function applyUpperWardrobePanel(panel: UpperWardrobePanel, candidate: { summary: WardrobeSetSummary; component: WardrobeSet['components'][number] } | null) {
    if (!selectedCharacter || selectedCatalogModelSlot === null) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const before = current.customization.wardrobeGroups ?? []
    const existingCandidate = candidate && before.find((group) => group.modelSlot === candidate.summary.modelSlot && group.setId === candidate.summary.id && group.category === panel.category && group.componentId === candidate.component.id)
    if (existingCandidate) {
      setSelectedClothing({ setId: candidate.summary.id, category: panel.category, componentId: candidate.component.id })
      setWardrobeHighlightVisible(true)
      return
    }
    const panelComponents = wardrobeSets.flatMap((summary) => {
      const set = wardrobeDetails[`${summary.modelSlot}:${summary.id}`]
      return set ? set.components.filter((component) => wardrobeComponentMatchesPanel(component, panel)).map((component) => `${summary.modelSlot}:${summary.id}:${component.id}`) : []
    })
    const panelComponentKeys = new Set(panelComponents)
    const matchingGroups = before.filter((group) => group.modelSlot === selectedCatalogModelSlot && group.category === panel.category && (!group.componentId || panelComponentKeys.has(`${group.modelSlot}:${group.setId}:${group.componentId}`)))
    if (!candidate && !matchingGroups.length) return
    const after = before.filter((group) => {
      if (group.modelSlot !== selectedCatalogModelSlot || group.category !== panel.category) return true
      if (!group.componentId) return false
      return !panelComponentKeys.has(`${group.modelSlot}:${group.setId}:${group.componentId}`)
    })
    if (candidate) {
      after.push({ modelSlot: candidate.summary.modelSlot, setId: candidate.summary.id, category: panel.category, componentId: candidate.component.id, offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotation: 0 })
      setSelectedClothing({ setId: candidate.summary.id, category: panel.category, componentId: candidate.component.id })
      setWardrobeHighlightVisible(true)
    } else {
      if (selectedClothing?.category === panel.category && panelComponentKeys.has(`${selectedCatalogModelSlot}:${selectedClothing.setId}:${selectedClothing.componentId}`)) setSelectedClothing(null)
      setWardrobeHighlightVisible(false)
    }
    await saveCharacterCustomization({ wardrobeGroups: after })
  }

  async function applyWardrobePiecePalette(setId: string, category: ClothingGroupCategory, componentId: string, colors: HairColorOverrides) {
    if (!selectedCharacter) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const before = current.customization.wardrobeGroups ?? []
    const after = before.map((group) => group.setId === setId && group.modelSlot === selectedCatalogModelSlot && group.category === category && group.componentId === componentId
      ? { ...group, colors }
      : group)
    await saveCharacterCustomization({ wardrobeGroups: after })
  }

  async function setWardrobePieceColor(setId: string, category: ClothingGroupCategory, componentId: string, role: HairColorRole, value: string) {
    if (!selectedCharacter) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const groups = current.customization.wardrobeGroups ?? []
    const wardrobeGroups = groups.map((group) => group.modelSlot === selectedCatalogModelSlot && group.setId === setId && group.category === category && group.componentId === componentId
      ? { ...group, colors: { ...group.colors, [role]: value } }
      : group)
    await saveCharacterCustomization({ wardrobeGroups })
  }

  async function resetWardrobePieceColors(setId: string, category: ClothingGroupCategory, componentId: string) {
    if (!selectedCharacter) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const before = current.customization.wardrobeGroups ?? []
    const after = before.map((group) => {
      if (group.setId !== setId || group.modelSlot !== selectedCatalogModelSlot || group.category !== category || group.componentId !== componentId) return group
      const { colors: _colors, ...rest } = group
      return rest
    })
    await saveCharacterCustomization({ wardrobeGroups: after })
  }

  function beginWardrobeDrag(event: import('react').PointerEvent<HTMLImageElement>) {
    if (activeModule !== 'Roupas' || clothingSection !== 'Customizar' || !selectedCharacter || !selectedClothing || !selectedArtworkProject) return
    const current = charactersRef.current.find((character) => character.id === selectedCharacter.id) ?? selectedCharacter
    const beforeGroups = (current.customization.wardrobeGroups ?? []).map((item) => ({ ...item }))
    const group = beforeGroups.find((item) => item.setId === selectedClothing.setId && item.category === selectedClothing.category && (item.componentId === selectedClothing.componentId || !item.componentId))
    setWardrobeHighlightVisible(false)
    if (!group) return
    const scene = event.currentTarget.closest('.stage-scene')
    const rect = scene?.getBoundingClientRect()
    if (!rect) return
    const previewScale = Math.min((rect.width - 136) / selectedArtworkProject.width, (rect.height - 130) / selectedArtworkProject.height)
    clothingDragRef.current = {
      pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      scaleX: Math.max(.01, previewScale * activeShapeScale.x), scaleY: Math.max(.01, previewScale * activeShapeScale.y),
      startX: group.offsetX, startY: group.offsetY, groupKey: wardrobeGroupKey(group), characterId: selectedCharacter.id, beforeGroups, latest: null
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function moveWardrobeDrag(event: import('react').PointerEvent<HTMLImageElement>) {
    const drag = clothingDragRef.current
    if (activeModule !== 'Roupas' || clothingSection !== 'Customizar' || !drag || drag.pointerId !== event.pointerId || !selectedCharacter || selectedCharacter.id !== drag.characterId) return
    const groups = selectedCharacter.customization.wardrobeGroups ?? []
    const nextGroups = groups.map((group) => wardrobeGroupKey(group) === drag.groupKey ? {
      ...group,
      offsetX: drag.startX + (event.clientX - drag.clientX) / drag.scaleX,
      offsetY: drag.startY + (event.clientY - drag.clientY) / drag.scaleY
    } : group)
    const nextCharacter = { ...selectedCharacter, customization: { ...selectedCharacter.customization, wardrobeGroups: nextGroups }, updatedAt: new Date().toISOString() }
    drag.latest = nextCharacter
    charactersRef.current = charactersRef.current.map((character) => character.id === nextCharacter.id ? nextCharacter : character)
    setCharacters((current) => current.map((character) => character.id === nextCharacter.id ? nextCharacter : character))
  }

  function finishWardrobeDrag(event: import('react').PointerEvent<HTMLImageElement>) {
    const drag = clothingDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    clothingDragRef.current = null
    if (drag.latest) {
      void saveCharacter(drag.latest)
    }
  }

  async function submitCharacterDialog(event: import('react').FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = nameDraft.trim()
    if (!name || savingCharacter) return
    setSavingCharacter(true)
    setCharactersError('')
    try {
      if (dialogMode === 'create') {
        const character = await window.desktop.createCustomizerCharacter(name)
        charactersRef.current = [...charactersRef.current, character]
        setCharacters((current) => [...current, character])
        setSelectedCharacterId(character.id)
        setActiveModule(null)
      } else if (dialogMode === 'rename' && selectedCharacter) {
        await saveCharacter({ ...selectedCharacter, name, updatedAt: new Date().toISOString() })
      }
      setDialogMode(null)
    } catch (reason) {
      setCharactersError(reason instanceof Error ? reason.message : 'Não foi possível salvar o personagem.')
    } finally {
      setSavingCharacter(false)
    }
  }

  async function deleteSelectedCharacter() {
    if (!selectedCharacter || !window.confirm(`Excluir ${selectedCharacter.name}? Esta ação não remove modelos nem poses do Fabricador Dev.`)) return
    try {
      await window.desktop.deleteCustomizerCharacter(selectedCharacter.id)
      const remaining = characters.filter((character) => character.id !== selectedCharacter.id)
      charactersRef.current = remaining
      setCharacters(remaining)
      setSelectedCharacterId(remaining[0]?.id ?? '')
      setActiveModule(null)
      setCharactersError('')
    } catch (reason) {
      setCharactersError(reason instanceof Error ? reason.message : 'Não foi possível excluir o personagem.')
    }
  }

  async function selectCatalogModel(model: NonNullable<FabricatorSlotSummary>) {
    const requestId = ++previewLoadRequest.current
    setSelectedCatalogModelSlot(model.slot)
    setSelectedPosePage(0)
    setSelectedArtworkLabel(model.name)
    setSelectedArtworkUrl(null)
    setPreviewLoading(true)
    setCatalogError('')
    try {
      const firstPose = catalogPoses.find((pose) => pose?.sourceModelSlot === model.slot && pose.slot === 1)
      setSelectedCatalogPoseSlot(firstPose?.slot ?? null)
      setSelectedPoseCategory(firstPose ? resolvePoseCategory(firstPose) : 'Parado')
      await saveCharacterCustomization({ modelSlot: model.slot, poseSlot: firstPose?.slot ?? null })
      const sourceProject = await window.desktop.loadFabricatorSlot(model.slot)
      if (!sourceProject) throw new Error('O modelo de referência não está disponível no Fabricador Dev.')
      let artwork: CatalogArtwork | null = firstPose ? await window.desktop.loadFabricatorPose(model.slot, 1) : null
      if (!artwork) artwork = sourceProject
      if (!artwork) throw new Error('Não foi possível abrir este modelo.')
      const artworkUrl = await renderArtwork(applyCharacterBodyShape(withCharacterHeadSize(artwork, activeProportions), activeBodyDimensions), 720, selectedCharacter?.customization.modelSkinTone)
      if (previewLoadRequest.current === requestId) { setSelectedArtworkProject(artwork); setSelectedSourceModelProject(sourceProject); setSelectedArtworkUrl(artworkUrl) }
    } catch (reason) {
      if (previewLoadRequest.current === requestId) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível abrir este modelo.')
    } finally {
      if (previewLoadRequest.current === requestId) setPreviewLoading(false)
    }
  }

  async function selectCatalogPose(pose: NonNullable<FabricatorPoseSummary>) {
    const requestId = ++previewLoadRequest.current
    const nextCategory = resolvePoseCategory(pose)
    if (nextCategory !== selectedPoseCategory) setSelectedPosePage(0)
    setSelectedCatalogPoseSlot(pose.slot)
    setSelectedPoseCategory(nextCategory)
    setSelectedArtworkLabel(pose.name)
    setSelectedArtworkUrl(null)
    setPreviewLoading(true)
    setCatalogError('')
    try {
      await saveCharacterCustomization({ modelSlot: pose.sourceModelSlot, poseSlot: pose.slot })
      const sourceProject = selectedSourceModelProject?.slot === pose.sourceModelSlot ? selectedSourceModelProject : await window.desktop.loadFabricatorSlot(pose.sourceModelSlot)
      if (!sourceProject) throw new Error('O modelo de referência desta pose não está disponível.')
      const artwork = await window.desktop.loadFabricatorPose(pose.sourceModelSlot, pose.slot)
      if (!artwork) throw new Error('Não foi possível abrir esta pose.')
      const artworkUrl = await renderArtwork(applyCharacterBodyShape(withCharacterHeadSize(artwork, activeProportions), activeBodyDimensions), 720, selectedCharacter?.customization.modelSkinTone)
      if (previewLoadRequest.current === requestId) { setSelectedArtworkProject(artwork); setSelectedSourceModelProject(sourceProject); setSelectedArtworkUrl(artworkUrl) }
    } catch (reason) {
      if (previewLoadRequest.current === requestId) setCatalogError(reason instanceof Error ? reason.message : 'Não foi possível abrir esta pose.')
    } finally {
      if (previewLoadRequest.current === requestId) setPreviewLoading(false)
    }
  }

  const availableModels = catalogModels.filter((model): model is NonNullable<typeof model> => model !== null)
  const availablePoses = catalogPoses.filter((pose): pose is NonNullable<typeof pose> => pose?.sourceModelSlot === selectedCatalogModelSlot).sort((a, b) => a.slot - b.slot)
  const poseCategories = ['Parado', 'Sentado', ...new Set(availablePoses.map(resolvePoseCategory).filter((category) => category !== 'Parado' && category !== 'Sentado'))]
  const categoryPoses = availablePoses.filter((pose) => resolvePoseCategory(pose) === selectedPoseCategory)
  const posePageCount = Math.max(1, Math.ceil(categoryPoses.length / 5))
  const activePosePage = Math.min(selectedPosePage, posePageCount - 1)
  const visibleCategoryPoses = categoryPoses.slice(activePosePage * 5, activePosePage * 5 + 5)
  const showAdjacentPoseCategory = (direction: -1 | 1) => {
    const categoryIndex = poseCategories.indexOf(selectedPoseCategory)
    const nextCategory = poseCategories[(categoryIndex + direction + poseCategories.length) % poseCategories.length]
    setSelectedPoseCategory(nextCategory)
    setSelectedPosePage(0)
  }
  const showAdjacentPosePage = (direction: -1 | 1) => {
    setSelectedPosePage((current) => Math.max(0, Math.min(posePageCount - 1, current + direction)))
  }
  const selectedModelName = availableModels.find((model) => model.slot === selectedCatalogModelSlot)?.name
  const activeFaceAppearance = characterFaceAppearance?.modelSlot === selectedCatalogModelSlot ? characterFaceAppearance : undefined
  const wardrobePreviewDraggable = false

  const renderHairCatalog = () => (
    <div className="customizer-hair-catalog">
      {selectedCatalogModelSlot === null ? <div className="customizer-catalog-empty">Escolha um modelo para ver os cabelos salvos.</div>
        : hairLoading ? <div className="customizer-catalog-empty">Carregando cabelos…</div>
          : hairStyles.length === 0 ? <div className="customizer-catalog-empty">Este modelo ainda não tem cabelos no catálogo. Importe e salve um cabelo em Cabelos Dev.</div>
            : <>
              <div className="customizer-hair-heading"><span><strong>Cabelos do Modelo {String(selectedCatalogModelSlot).padStart(2, '0')}</strong><small>Aplicação salva somente em {selectedCharacter?.name ?? 'este personagem'}.</small></span>
                {characterHairAppearance?.modelSlot === selectedCatalogModelSlot && hairAppearanceStyleId(characterHairAppearance, hairCatalogSide) && <button onClick={() => void chooseHairStyle(null, hairCatalogSide)} type="button"><Icon name="eyeOff" /> Remover {hairCatalogSide === 'front' ? 'posterior' : 'traseiro'}</button>}
              </div>
              <nav className="customizer-hair-tabs" aria-label="Categoria de cabelo">
                {([{ id: 'front', label: 'Posterior' }, { id: 'back', label: 'Traseiro' }] as const).map((category) => <button key={category.id} className={hairCatalogSide === category.id ? 'active' : ''} onClick={() => setHairCatalogSide(category.id)} aria-pressed={hairCatalogSide === category.id} type="button">{category.label}</button>)}
              </nav>
              <div className="customizer-hair-grid">{hairStyles.filter((summary) => summary[hairCatalogSide] !== null).map((summary) => {
                const detail = hairDetails[String(summary.modelSlot) + ':' + summary.id]
                const selected = characterHairAppearance?.modelSlot === summary.modelSlot && hairAppearanceStyleId(characterHairAppearance, hairCatalogSide) === summary.id
                const asset = detail?.[hairCatalogSide]
                return <button className={'customizer-hair-card' + (selected ? ' selected' : '')} key={summary.id} onClick={() => void chooseHairStyle(summary, hairCatalogSide)} aria-pressed={selected} title={'Aplicar cabelo ' + (hairCatalogSide === 'front' ? 'posterior' : 'traseiro') + ' em ' + (selectedCharacter?.name ?? 'personagem')} type="button">
                  <span className="customizer-hair-art">{asset && <img src={asset.dataUrl} alt="" />}{!asset && <span><Icon name="bow" /></span>}</span>
                  <b>{summary.name}</b><small>{selected ? 'Aplicado' : `Usar ${hairCatalogSide === 'front' ? 'posterior' : 'traseiro'}`}</small>
                </button>
              })}{hairStyles.every((summary) => summary[hairCatalogSide] === null) && <p className="customizer-face-empty">Nenhum cabelo {hairCatalogSide === 'front' ? 'posterior' : 'traseiro'} salvo para este modelo.</p>}</div>
            </>}
    </div>
  )

  const renderHairCustomizer = () => {
    const appearance = characterHairAppearance?.modelSlot === selectedCatalogModelSlot ? characterHairAppearance : undefined
    const colorOverrides = appearance?.colors ?? {}
    const renderPieceSelector = (part: typeof customizerHairParts[number]) => {
      const { side } = part
      const options = hairStyles.filter((summary) => summary[side] != null)
      const selectedId = hairAppearancePartStyleId(appearance, part.id)
      const selectedIndex = options.findIndex((summary) => summary.id === selectedId)
      const selected = selectedIndex >= 0 ? options[selectedIndex] : null
      const selectedSlot = selectedIndex >= 0 ? selectedIndex + 1 : 0
      const slotCount = options.length + 1
      const asset = selected ? hairDetails[`${selected.modelSlot}:${selected.id}`]?.[side] : null
      const pieceColors = resolvedHairColors(appearance, part.id)
      const hasLocalColors = Object.keys(appearance?.partColors?.[part.id] ?? {}).length > 0
      const chooseAt = (index: number) => {
        if (!selectedCharacter) return
        const slot = wrapSlotIndex(index, slotCount)
        void chooseHairPartStyle(part.id, slot === 0 ? null : options[slot - 1])
      }
      return <article className="customizer-hair-piece" key={part.id}>
        <header><strong>{part.label} {selectedSlot + 1}/{slotCount}</strong>{hasLocalColors && <button className="customizer-hair-reset" onClick={() => void resetHairPartColors(part.id)} title={`Voltar ${part.label} à paleta geral`} type="button">Usar paleta geral</button>}</header>
        <div className="customizer-hair-piece-selector">
          <button aria-label={`Peça anterior: ${part.label}`} onClick={() => chooseAt(selectedSlot - 1)} disabled={!options.length || !selectedCharacter} type="button"><Icon name="chevronRight" /></button>
          <button className="customizer-hair-piece-preview" aria-label={`Abrir biblioteca de ${part.label}`} title={`Abrir biblioteca de ${part.label}`} onClick={() => { setHairLibraryPage(0); setHairLibraryPart(part.id) }} type="button">
            {asset ? <HairAssetPreview source={asset.dataUrl} colors={pieceColors} alt={selected?.name ?? ''} /> : null}
          </button>
          <button aria-label={`Próxima peça: ${part.label}`} onClick={() => chooseAt(selectedSlot + 1)} disabled={!options.length || !selectedCharacter} type="button"><Icon name="chevronRight" /></button>
          <div className="customizer-hair-piece-colors" aria-label={`Cores de ${part.label}`}>
            {hairColorControls.map((color) => <label key={color.id} className={appearance?.partColors?.[part.id]?.[color.id] ? 'local' : ''} style={{ '--hair-color-swatch': pieceColors[color.id] ?? color.fallback } as React.CSSProperties} title={`${color.label} de ${part.label} · ${appearance?.partColors?.[part.id]?.[color.id] ? 'ajuste individual' : 'paleta geral'}`}>
              <input type="color" aria-label={`${color.label} de ${part.label}`} value={pieceColors[color.id] ?? color.fallback} disabled={!selectedCharacter || !asset} onFocus={() => setActiveHairColorRole(color.id)} onChange={(event) => void setHairPartColor(part.id, color.id, event.target.value)} />
              <span aria-hidden="true">{color.id === 'highlight' ? 'L' : color.id === 'accent' ? 'A' : color.id === 'outline' ? 'C' : color.id === 'fade' ? 'D' : 'B'}</span>
            </label>)}
          </div>
        </div>
      </article>
    }
    return <section className="customizer-hair-workspace" aria-label="Personalização do cabelo">
      {selectedCatalogModelSlot === null ? <div className="customizer-catalog-empty">Escolha um modelo para carregar os cabelos do Fabricador Dev.</div>
        : hairLoading ? <div className="customizer-catalog-empty">Carregando cabelos do Fabricador Dev…</div>
          : <>
            <div className="customizer-hair-layout">
            <div className="customizer-hair-color-controls" aria-label="Paleta geral dos cabelos">
              <div className="customizer-hair-palette-editor">
                <div className="customizer-hair-palette-title"><strong>Paleta geral</strong><span>Uma cor para os cinco cabelos</span><button type="button" onClick={() => void restoreHairColors()} disabled={!appearance || !Object.keys(colorOverrides).length && !Object.values(appearance.partColors ?? {}).some((colors) => Object.keys(colors ?? {}).length)} title="Restaurar as cores originais dos cinco cabelos">Restaurar</button></div>
                <div className="customizer-hair-palette-swatches">{hairColorControls.map((color) => <label className="customizer-hair-color-control" data-role={color.id} key={color.id} title={`${color.label} · aplica a todos os cabelos`}>
                  <span>{color.label}</span><input className={activeHairColorRole === color.id ? 'active' : ''} type="color" aria-label={`${color.label} geral`} value={colorOverrides[color.id] ?? color.fallback} disabled={!selectedCharacter} onFocus={() => setActiveHairColorRole(color.id)} onChange={(event) => void setHairColor(color.id, event.target.value)} />
                </label>)}</div>
              </div>
              <aside className="customizer-hair-palette-presets" aria-label="Paletas prontas">
                <button className="customizer-hair-palette-scroll previous" aria-label="Ver paletas anteriores" onClick={() => hairPaletteStripRef.current?.scrollBy({ left: -180, behavior: 'smooth' })} type="button"><Icon name="chevronRight" /></button>
                <div className="customizer-hair-palette-preset-list" ref={hairPaletteStripRef}>{hairPalettePresets.map((preset) => <button key={preset.name} type="button" disabled={!selectedCharacter} aria-pressed={hairColorControls.every((color) => colorOverrides[color.id] === preset.colors[color.id])} onClick={() => void applyHairPalette(preset.colors)} title={`Aplicar a paleta ${preset.name} aos cinco cabelos`}><span style={{ background: `linear-gradient(115deg, ${preset.colors.highlight} 0 23%, ${preset.colors.base} 23% 65%, ${preset.colors.fade} 65% 84%, ${preset.colors.outline} 84%)` }} />{preset.name}</button>)}</div>
                <button className="customizer-hair-palette-scroll" aria-label="Ver próximas paletas" onClick={() => hairPaletteStripRef.current?.scrollBy({ left: 180, behavior: 'smooth' })} type="button"><Icon name="chevronRight" /></button>
              </aside>
            </div>
            {customizerHairParts.map(renderPieceSelector)}
            </div>
          </>}
    </section>
  }

  const renderHairLibrary = () => {
    if (!hairLibraryPart) return null
    const part = customizerHairParts.find((item) => item.id === hairLibraryPart)
    if (!part) return null
    const options = hairStyles.filter((summary) => summary[part.side] !== null)
    const pageSize = 20
    const slots: Array<HairStyleSummary | null> = [null, ...options]
    const pageCount = Math.max(1, Math.ceil(slots.length / pageSize))
    const page = Math.min(hairLibraryPage, pageCount - 1)
    const visible = slots.slice(page * pageSize, (page + 1) * pageSize)
    const appearance = characterHairAppearance?.modelSlot === selectedCatalogModelSlot ? characterHairAppearance : undefined
    const selectedId = hairAppearancePartStyleId(appearance, part.id)
    const choose = (summary: HairStyleSummary | null) => {
      void chooseHairPartStyle(part.id, summary)
    }
    return <section className="customizer-hair-library" aria-labelledby="customizer-hair-library-title">
        <header className="customizer-hair-library-heading">
          <button className="customizer-hair-library-remove" type="button" onClick={() => void chooseHairPartStyle(part.id, null)} disabled={!selectedId} aria-label={`Remover ${part.label} do personagem`} title={`Remover ${part.label} do personagem`}><Icon name="trash" /></button>
          <h2 id="customizer-hair-library-title">{part.label}</h2>
          <button className="customizer-hair-library-close" type="button" onClick={() => setHairLibraryPart(null)} aria-label="Fechar biblioteca">×</button>
        </header>
        <div className="customizer-hair-library-grid" aria-label={`Peças disponíveis para ${part.label}`}>
          {visible.map((summary) => {
            if (!summary) return <button className={`customizer-hair-library-item${!selectedId ? ' selected' : ''}`} key="empty-slot" title="Slot vazio" aria-label={`Slot vazio · remover ${part.label} do personagem`} aria-pressed={!selectedId} type="button" onClick={() => choose(null)} />
            const asset = hairDetails[`${summary.modelSlot}:${summary.id}`]?.[part.side]
            const isSelected = summary.id === selectedId
            return <button className={`customizer-hair-library-item${isSelected ? ' selected' : ''}`} key={summary.id} title={summary.name} aria-label={`Selecionar ${summary.name}`} aria-pressed={isSelected} type="button" onClick={() => choose(summary)}>
              {asset ? <HairAssetPreview source={asset.dataUrl} colors={resolvedHairColors(appearance, part.id)} alt="" /> : <span className="customizer-hair-library-placeholder"><Icon name="bow" /></span>}
            </button>
          })}
          {!options.length && <p className="customizer-hair-library-empty">Nenhuma peça salva nesta categoria.</p>}
        </div>
        <footer className="customizer-hair-library-pagination">
          <button className="customizer-hair-library-page-arrow" type="button" aria-label="Página anterior" disabled={page === 0} onClick={() => setHairLibraryPage((current) => Math.max(0, current - 1))}><Icon name="chevronRight" /></button>
          <span>Página <strong>{page + 1}/{pageCount}</strong></span>
          <button className="customizer-hair-library-page-arrow next" type="button" aria-label="Próxima página" disabled={page >= pageCount - 1} onClick={() => setHairLibraryPage((current) => Math.min(pageCount - 1, current + 1))}><Icon name="chevronRight" /></button>
        </footer>
      </section>
  }

  const faceOptionsForCategory = (category: FaceComponentKind) => {
    const candidates = faceComponentAssets.filter((asset) => asset.kind === category)
    return candidates.filter((asset) => !isRightFaceAsset(asset) || !candidates.some((candidate) =>
      !isRightFaceAsset(candidate) && sameFaceAssetPair(candidate, asset, faceComponentDetails)
    ))
  }

  const faceCatalogLayoutParts = [
    { id: 'nose', label: 'Nariz', help: 'Nenhuma peça salva' },
    { id: 'eye-highlight-left', label: 'Destaque do olho esquerdo', help: 'Nenhuma peça salva' },
    { id: 'mouth', label: 'Boca', help: 'Fechada ou aberta' },
    { id: 'eye-highlight-right', label: 'Destaque do olho direito', help: 'Nenhuma peça salva' },
    { id: 'blush', label: 'Blush', help: 'Nenhuma peça salva' },
    { id: 'facial-shadow', label: 'Sombra facial', help: 'Nenhuma peça salva' }
  ] as const
  type FaceCatalogLayoutPart = typeof faceCatalogLayoutParts[number]['id']
  type FaceCatalogChoice =
    | { type: 'catalog'; summary: FaceCatalogItemSummary; piece: FaceCatalogItem['pieces'][number] }
    | { type: 'detail'; summary: FaceComponentAssetSummary; asset: FaceComponentAsset }
  const faceCatalogChoicesFor = (category: FaceSheetKind) => faceCatalogItems
    .filter((summary) => summary.category === category)
    .flatMap((summary) => faceCatalogDetails[`${summary.modelSlot}:${summary.id}`]?.pieces
      .filter((piece) => piece.sheet === category)
      .map((piece) => ({ type: 'catalog' as const, summary, piece })) ?? [])
  const faceCatalogChoicesForPart = (part: FaceCatalogLayoutPart) => part === 'nose'
    ? faceCatalogChoicesFor('nose')
    : part === 'mouth'
      ? faceCatalogChoicesFor(activeFaceAppearance?.mouthOpen ? 'mouth-open' : 'mouth-closed')
      : faceComponentAssets.filter((summary) => summary.kind === part).flatMap((summary): FaceCatalogChoice[] => {
        const asset = faceComponentDetails[summary.id]
        return asset && asset.kind === part ? [{ type: 'detail', summary, asset }] : []
      })
  const faceCatalogSelectedId = (part: FaceCatalogLayoutPart) => part === 'nose'
    ? activeFaceAppearance?.noseCatalogId
    : part === 'mouth'
      ? activeFaceAppearance?.mouthOpen ? activeFaceAppearance.mouthOpenCatalogId : activeFaceAppearance?.mouthClosedCatalogId
      : activeFaceAppearance?.faceDetails?.[part]
  const faceCatalogSelectedVariant = (part: FaceCatalogLayoutPart) => part === 'nose'
    ? activeFaceAppearance?.noseIndex ?? 0
    : part === 'mouth' ? activeFaceAppearance?.expressionIndex ?? 0 : 0
  const faceCatalogChoiceSelected = (part: FaceCatalogLayoutPart, choice: FaceCatalogChoice) => {
    if (choice.type === 'detail') return choice.summary.id === faceCatalogSelectedId(part)
    return choice.summary.id === faceCatalogSelectedId(part) && choice.piece.index === faceCatalogSelectedVariant(part)
  }
  const chooseFaceCatalogChoice = (part: FaceCatalogLayoutPart, choice: FaceCatalogChoice) => {
    if (choice.type === 'detail') void chooseFaceDetailCatalogItem(part as FaceDetailKind, choice.summary)
    else void chooseFaceCatalogItem(choice.summary, choice.piece.index)
  }

  const renderFaceCatalogCard = (part: typeof faceCatalogLayoutParts[number]) => {
    const choices = faceCatalogChoicesForPart(part.id)
    const selectedId = faceCatalogSelectedId(part.id)
    const selectedIndex = choices.findIndex((choice) => faceCatalogChoiceSelected(part.id, choice))
    const selected = selectedIndex >= 0 ? choices[selectedIndex] : null
    const selectedSlot = selectedIndex >= 0 ? selectedIndex + 1 : 0
    const slotCount = choices.length + 1
    const chooseAt = (index: number) => {
      if (!selectedCharacter) return
      const slot = wrapSlotIndex(index, slotCount)
      if (slot === 0) void clearFaceCatalogPart(part.id)
      else chooseFaceCatalogChoice(part.id, choices[slot - 1])
    }
    const isMouth = part.id === 'mouth'
    const clearPart = part.id
    return <article className={`customizer-hair-piece customizer-face-piece customizer-face-layout-piece${isMouth ? ' customizer-face-layout-mouth' : ''}`} key={part.id}>
      <header><strong>{part.label} {selectedSlot + 1}/{slotCount}</strong><button className="customizer-hair-reset" type="button" disabled={!selectedId} onClick={() => void clearFaceCatalogPart(clearPart)}>Remover</button></header>
      {isMouth && <nav className="customizer-face-layout-mode" aria-label="Tipo de boca">
        <button className={!activeFaceAppearance?.mouthOpen ? 'active' : ''} type="button" aria-pressed={!activeFaceAppearance?.mouthOpen} onClick={() => void setFaceCatalogVariant({ mouthOpen: false })}>Fechada</button>
        <button className={activeFaceAppearance?.mouthOpen ? 'active' : ''} type="button" aria-pressed={Boolean(activeFaceAppearance?.mouthOpen)} onClick={() => void setFaceCatalogVariant({ mouthOpen: true })}>Aberta</button>
      </nav>}
      <div className="customizer-hair-piece-selector customizer-face-layout-selector">
        <button aria-label={`Peça anterior: ${part.label}`} onClick={() => chooseAt(selectedSlot - 1)} disabled={!choices.length || !selectedCharacter} type="button"><Icon name="chevronRight" /></button>
        <button className="customizer-hair-piece-preview" aria-label={`Abrir biblioteca de ${part.label}`} title={`Abrir biblioteca de ${part.label}`} type="button" onClick={() => { setFaceCatalogLibraryPage(0); setFaceCatalogLibraryPart(part.id) }}>
          {selected ? <img src={selected.type === 'catalog' ? selected.piece.dataUrl : selected.asset.dataUrl} alt={selected.summary.name} /> : null}
        </button>
        <button aria-label={`Próxima peça: ${part.label}`} onClick={() => chooseAt(selectedSlot + 1)} disabled={!choices.length || !selectedCharacter} type="button"><Icon name="chevronRight" /></button>
      </div>
    </article>
  }

  const renderFaceCatalogLibrary = () => {
    if (!faceCatalogLibraryPart) return null
    const part = faceCatalogLayoutParts.find((entry) => entry.id === faceCatalogLibraryPart)!
    const choices = faceCatalogChoicesForPart(part.id)
    const pageSize = 20
    const slots: Array<FaceCatalogChoice | null> = [null, ...choices]
    const pageCount = Math.max(1, Math.ceil(slots.length / pageSize))
    const page = Math.min(faceCatalogLibraryPage, pageCount - 1)
    const visible = slots.slice(page * pageSize, (page + 1) * pageSize)
    const selectedId = faceCatalogSelectedId(part.id)
    const selectedIndex = choices.findIndex((choice) => faceCatalogChoiceSelected(part.id, choice))
    return <section className={`customizer-hair-library customizer-face-layout-library${part.id === 'mouth' ? ' customizer-face-layout-library-mouth' : ''}`} aria-labelledby="customizer-face-layout-library-title">
      <header className="customizer-hair-library-heading">
        <button className="customizer-hair-library-remove" type="button" onClick={() => void clearFaceCatalogPart(part.id)} disabled={!selectedId} aria-label={`Remover ${part.label}`} title={`Remover ${part.label}`}><Icon name="trash" /></button>
        <h2 id="customizer-face-layout-library-title">{part.label}</h2>
        <button className="customizer-hair-library-close" type="button" onClick={() => setFaceCatalogLibraryPart(null)} aria-label="Voltar às peças do rosto">×</button>
      </header>
      {part.id === 'mouth' && <nav className="customizer-face-layout-mode customizer-face-layout-library-mode" aria-label="Tipo de boca">
        <button className={!activeFaceAppearance?.mouthOpen ? 'active' : ''} type="button" aria-pressed={!activeFaceAppearance?.mouthOpen} onClick={() => { setFaceCatalogLibraryPage(0); void setFaceCatalogVariant({ mouthOpen: false }) }}>Fechada</button>
        <button className={activeFaceAppearance?.mouthOpen ? 'active' : ''} type="button" aria-pressed={Boolean(activeFaceAppearance?.mouthOpen)} onClick={() => { setFaceCatalogLibraryPage(0); void setFaceCatalogVariant({ mouthOpen: true }) }}>Aberta</button>
      </nav>}
      <div className="customizer-hair-library-grid" aria-label={`Biblioteca de ${part.label}`}>
        {visible.map((choice) => {
          if (!choice) return <button className={`customizer-hair-library-item${selectedIndex < 0 ? ' selected' : ''}`} key="empty-slot" title="Slot vazio" aria-label={`Slot vazio · remover ${part.label} do personagem`} aria-pressed={selectedIndex < 0} type="button" onClick={() => { void clearFaceCatalogPart(part.id); setFaceCatalogLibraryPart(null) }} />
          const selected = faceCatalogChoiceSelected(part.id, choice)
          const itemId = choice.type === 'catalog' ? `${choice.summary.id}:${choice.piece.id}` : choice.summary.id
          const imageUrl = choice.type === 'catalog' ? choice.piece.dataUrl : choice.asset.dataUrl
          const itemIndex = choice.type === 'catalog' ? ` · ${choice.piece.index + 1}` : ''
          return <button className={`customizer-hair-library-item${selected ? ' selected' : ''}`} key={itemId} title={`${choice.summary.name}${itemIndex}`} aria-label={`Selecionar ${part.label}${itemIndex}`} aria-pressed={selected} type="button" onClick={() => { chooseFaceCatalogChoice(part.id, choice); setFaceCatalogLibraryPart(null) }}><img src={imageUrl} alt="" /></button>
        })}
        {!choices.length && <p className="customizer-hair-library-empty">Nenhuma outra peça de {part.label.toLowerCase()} salva no Fabricador Dev.</p>}
      </div>
      <footer className="customizer-hair-library-pagination">
        <button className="customizer-hair-library-page-arrow" type="button" aria-label="Página anterior" disabled={page === 0} onClick={() => setFaceCatalogLibraryPage((current) => Math.max(0, current - 1))}><Icon name="chevronRight" /></button>
        <span>Página <strong>{page + 1}/{pageCount}</strong></span>
        <button className="customizer-hair-library-page-arrow next" type="button" aria-label="Próxima página" disabled={page >= pageCount - 1} onClick={() => setFaceCatalogLibraryPage((current) => Math.min(pageCount - 1, current + 1))}><Icon name="chevronRight" /></button>
      </footer>
    </section>
  }

  const renderFaceCatalogCustomizer = () => <section className="customizer-hair-workspace customizer-face-catalog-workspace" aria-label="Personalização do rosto">
    {selectedCatalogModelSlot === null ? <div className="customizer-catalog-empty">Escolha um modelo para ver as peças faciais.</div>
      : faceLoading || faceComponentLoading ? <div className="customizer-catalog-empty">Carregando catálogo facial…</div>
        : faceCatalogLibraryPart ? renderFaceCatalogLibrary()
          : <div className="customizer-hair-layout customizer-face-layout customizer-face-layout-catalog">{faceCatalogLayoutParts.map(renderFaceCatalogCard)}</div>}
  </section>

  const renderFaceCustomizer = () => {
    const appearance = characterFaceAppearance?.modelSlot === selectedCatalogModelSlot ? characterFaceAppearance : undefined
    const renderPart = (part: typeof customizerFaceParts[number]) => {
      const options = faceOptionsForCategory(part.category)
      const selectedId = facePartCatalogId(appearance, part)
      const selectedAsset = selectedId ? faceComponentAssets.find((summary) => summary.id === selectedId) : undefined
      const selectedOption = selectedAsset && isRightFaceAsset(selectedAsset)
        ? options.find((summary) => sameFaceAssetPair(summary, selectedAsset, faceComponentDetails))
        : selectedAsset
      const selectedIndex = options.findIndex((summary) => summary.id === selectedOption?.id)
      const selected = selectedIndex >= 0 ? options[selectedIndex] : null
      const piece = selectedId ? faceComponentDetails[selectedId] : null
      const selectedSlot = selectedIndex >= 0 ? selectedIndex + 1 : 0
      const slotCount = options.length + 1
      const colorPartId = facePartSourceId(part)
      const colors = appearance?.components?.[colorPartId]?.colors ?? {}
      const hasLocalColors = Object.keys(colors).length > 0
      const chooseAt = (index: number) => {
        if (!selectedCharacter) return
        const slot = wrapSlotIndex(index, slotCount)
        if (slot === 0) void clearFacePartSelection(part.id)
        else void chooseFacePartCatalogItem(part.id, options[slot - 1])
      }
      return <article className="customizer-hair-piece customizer-face-piece" key={part.id}>
        <header><strong>{part.label} {selectedSlot + 1}/{slotCount}</strong>{hasLocalColors && <button className="customizer-hair-reset" onClick={() => void resetFacePartColors(colorPartId)} title={'Restaurar cores de ' + part.label} type="button">Restaurar</button>}</header>
        <div className="customizer-hair-piece-selector">
          <button aria-label={'Peça anterior: ' + part.label} onClick={() => chooseAt(selectedSlot - 1)} disabled={!options.length || !selectedCharacter} type="button"><Icon name="chevronRight" /></button>
          <button className="customizer-hair-piece-preview" aria-label={'Abrir biblioteca de ' + part.label} title={'Abrir biblioteca de ' + part.label} onClick={() => { setFaceLibraryPage(0); setFaceLibraryPart(part.id) }} type="button">
            {piece ? <HairAssetPreview source={piece.dataUrl} colors={colors} alt={selected?.name ?? ''} /> : null}
          </button>
          <button aria-label={'Próxima peça: ' + part.label} onClick={() => chooseAt(selectedSlot + 1)} disabled={!options.length || !selectedCharacter} type="button"><Icon name="chevronRight" /></button>
          <div className="customizer-hair-piece-colors" aria-label={'Cores de ' + part.label}>
            {facePartColorControls.map((color) => <label key={color.id} className={colors[color.id] ? 'local' : ''} style={{ '--hair-color-swatch': colors[color.id] ?? color.fallback } as React.CSSProperties} title={color.label + ' de ' + part.label}>
              <input type="color" aria-label={color.label + ' de ' + part.label} value={colors[color.id] ?? color.fallback} disabled={!selectedCharacter || !piece} onChange={(event) => void setFacePartColor(part.id, color.id, event.target.value)} />
              <span aria-hidden="true">{color.id === 'highlight' ? 'L' : color.id === 'accent' ? 'A' : color.id === 'outline' ? 'C' : color.id === 'fade' ? 'D' : 'B'}</span>
            </label>)}
          </div>
        </div>
      </article>
    }
    return <section className="customizer-hair-workspace customizer-face-workspace" aria-label="Personalização dos olhos e sobrancelhas">
      {selectedCatalogModelSlot === null ? <div className="customizer-catalog-empty">Escolha um modelo para carregar olhos e sobrancelhas do Fabricador Dev.</div>
        : faceLoading ? <div className="customizer-catalog-empty">Carregando catálogo facial…</div>
          : <div className="customizer-hair-layout customizer-face-layout">{customizerFaceParts.map(renderPart)}</div>}
    </section>
  }

  const renderFaceLibrary = () => {
    if (!faceLibraryPart) return null
    const part = customizerFaceParts.find((entry) => entry.id === faceLibraryPart)
    if (!part) return null
    const options = faceOptionsForCategory(part.category)
    const pageSize = 20
    const slots: Array<FaceComponentAssetSummary | null> = [null, ...options]
    const pageCount = Math.max(1, Math.ceil(slots.length / pageSize))
    const page = Math.min(faceLibraryPage, pageCount - 1)
    const visible = slots.slice(page * pageSize, (page + 1) * pageSize)
    const appearance = characterFaceAppearance?.modelSlot === selectedCatalogModelSlot ? characterFaceAppearance : undefined
    const selectedId = facePartCatalogId(appearance, part)
    const selectedAsset = selectedId ? faceComponentAssets.find((summary) => summary.id === selectedId) : undefined
    const selectedOption = selectedAsset && isRightFaceAsset(selectedAsset)
      ? options.find((summary) => sameFaceAssetPair(summary, selectedAsset, faceComponentDetails))
      : selectedAsset
    const selectedIndex = options.findIndex((summary) => summary.id === selectedOption?.id)
    const selectedColors = appearance?.components?.[facePartSourceId(part)]?.colors
    return <section className="customizer-hair-library" aria-labelledby="customizer-face-library-title">
      <header className="customizer-hair-library-heading">
        <button className="customizer-hair-library-remove" type="button" onClick={() => void clearFacePartSelection(part.id)} disabled={!selectedId} aria-label={'Remover ' + part.label + ' do personagem'} title={'Remover ' + part.label + ' do personagem'}><Icon name="trash" /></button>
        <h2 id="customizer-face-library-title">{part.label}</h2>
        <button className="customizer-hair-library-close" type="button" onClick={() => setFaceLibraryPart(null)} aria-label="Voltar aos controles dos olhos">×</button>
      </header>
      <div className="customizer-hair-library-grid" aria-label={'Biblioteca de ' + part.label}>
        {visible.map((summary) => {
          if (!summary) return <button className={`customizer-hair-library-item${selectedIndex < 0 ? ' selected' : ''}`} key="empty-slot" title="Slot vazio" aria-label={`Slot vazio · remover ${part.label} do personagem`} aria-pressed={selectedIndex < 0} type="button" onClick={() => void clearFacePartSelection(part.id)} />
          const piece = faceComponentDetails[summary.id]
          const selected = summary.id === selectedOption?.id
          return <button className={`customizer-hair-library-item${selected ? ' selected' : ''}`} key={summary.id} title={summary.name} aria-label={'Selecionar ' + summary.name} aria-pressed={selected} type="button" onClick={() => void chooseFacePartCatalogItem(part.id, summary)}>
            {piece ? <HairAssetPreview source={piece.dataUrl} colors={selectedColors} alt="" /> : <span className="customizer-hair-library-placeholder"><Icon name="face" /></span>}
          </button>
        })}
        {!options.length && <p className="customizer-hair-library-empty">Nenhum asset salvo para {part.label}. Importe esta peça no Rosto Dev.</p>}
      </div>
      <footer className="customizer-hair-library-pagination">
        <button className="customizer-hair-library-page-arrow" type="button" aria-label="Página anterior" disabled={page === 0} onClick={() => setFaceLibraryPage((current) => Math.max(0, current - 1))}><Icon name="chevronRight" /></button>
        <span>Página <strong>{page + 1}/{pageCount}</strong></span>
        <button className="customizer-hair-library-page-arrow next" type="button" aria-label="Próxima página" disabled={page >= pageCount - 1} onClick={() => setFaceLibraryPage((current) => Math.min(pageCount - 1, current + 1))}><Icon name="chevronRight" /></button>
      </footer>
    </section>
  }

  const upperWardrobeCandidates = (panel: UpperWardrobePanel) => wardrobeSets
    .filter((summary) => summary.modelSlot === selectedCatalogModelSlot)
    .flatMap((summary) => {
      const set = wardrobeDetails[`${summary.modelSlot}:${summary.id}`]
      return set ? set.components.filter((component) => wardrobeComponentMatchesPanel(component, panel)).map((component) => ({ summary, component })) : []
    })

  const renderUpperWardrobeLibrary = () => {
    if (!wardrobeLibraryPanel) return null
    const panel = wardrobeLibraryPanel
    const candidates = upperWardrobeCandidates(panel)
    const slots: Array<(typeof candidates)[number] | null> = [null, ...candidates]
    const pageSize = 20
    const pageCount = Math.max(1, Math.ceil(slots.length / pageSize))
    const page = Math.min(wardrobeLibraryPage, pageCount - 1)
    const visible = slots.slice(page * pageSize, (page + 1) * pageSize)
    const appliedGroups = selectedCharacter?.customization.wardrobeGroups ?? []
    const selectedIndex = candidates.findIndex(({ summary, component }) => appliedGroups.some((group) =>
      group.modelSlot === summary.modelSlot && group.setId === summary.id && group.category === panel.category && group.componentId === component.id
    ))
    const clearPanel = () => void applyUpperWardrobePanel(panel, null)
    return <section className="customizer-hair-library" aria-labelledby="customizer-upper-wardrobe-library-title">
      <header className="customizer-hair-library-heading">
        <button className="customizer-hair-library-remove" type="button" onClick={clearPanel} disabled={selectedIndex < 0} aria-label={`Remover ${panel.label} do personagem`} title={`Remover ${panel.label} do personagem`}><Icon name="trash" /></button>
        <h2 id="customizer-upper-wardrobe-library-title">{panel.label}</h2>
        <button className="customizer-hair-library-close" type="button" onClick={() => setWardrobeLibraryPanel(null)} aria-label="Fechar biblioteca">×</button>
      </header>
      <div className="customizer-hair-library-grid" aria-label={`Biblioteca de ${panel.label}`}>
        {visible.map((entry) => {
          if (!entry) return <button className={`customizer-hair-library-item${selectedIndex < 0 ? ' selected' : ''}`} key="empty-slot" title="Slot vazio" aria-label={`Slot vazio · remover ${panel.label} do personagem`} aria-pressed={selectedIndex < 0} type="button" onClick={clearPanel} />
          const selected = entry.summary.id === candidates[selectedIndex]?.summary.id && entry.component.id === candidates[selectedIndex]?.component.id
          return <button className={`customizer-hair-library-item${selected ? ' selected' : ''}`} key={`${entry.summary.modelSlot}:${entry.summary.id}:${entry.component.id}`} title={entry.component.name} aria-label={`Selecionar ${entry.component.name}`} aria-pressed={selected} type="button" onClick={() => { void applyUpperWardrobePanel(panel, entry); setWardrobeLibraryPanel(null) }}>
            <img src={entry.component.dataUrl} alt={entry.component.name} />
          </button>
        })}
        {!candidates.length && <p className="customizer-hair-library-empty">Nenhuma peça salva para {panel.label}. Importe e classifique uma peça no Fabricador Dev.</p>}
      </div>
      <footer className="customizer-hair-library-pagination">
        <button className="customizer-hair-library-page-arrow" type="button" aria-label="Página anterior" disabled={page === 0} onClick={() => setWardrobeLibraryPage((current) => Math.max(0, current - 1))}><Icon name="chevronRight" /></button>
        <span>Página <strong>{page + 1}/{pageCount}</strong></span>
        <button className="customizer-hair-library-page-arrow next" type="button" aria-label="Próxima página" disabled={page >= pageCount - 1} onClick={() => setWardrobeLibraryPage((current) => Math.min(pageCount - 1, current + 1))}><Icon name="chevronRight" /></button>
      </footer>
    </section>
  }

  const toggleUpperWardrobePage = () => {
    setUpperWardrobePage((page) => page === 1 ? 2 : 1)
    setWardrobeLibraryPanel(null)
  }
  const renderUpperWardrobePageButton = () => <button className={`customizer-upper-page-button${upperWardrobePage === 2 ? ' is-page-two' : ''}`} type="button" onClick={toggleUpperWardrobePage} aria-label={`Ir para página ${upperWardrobePage === 1 ? 2 : 1} de Superior`}>
    Página {upperWardrobePage === 1 ? 2 : 1}<span aria-hidden="true"><Icon name="chevronRight" /></span>
  </button>

  const renderUpperWardrobePanels = () => <div className="customizer-hair-layout customizer-upper-wardrobe-layout" aria-label="Peças de roupa superior">
    {upperWardrobePanels.map((panel) => {
      const candidates = upperWardrobeCandidates(panel)
      const appliedGroups = selectedCharacter?.customization.wardrobeGroups ?? []
      const selectedIndex = candidates.findIndex(({ summary, component }) => appliedGroups.some((group) =>
        group.modelSlot === summary.modelSlot && group.setId === summary.id && group.category === panel.category && group.componentId === component.id
      ))
      const currentCandidate = selectedIndex >= 0 ? candidates[selectedIndex] : null
      const currentGroup = currentCandidate ? appliedGroups.find((group) => group.modelSlot === currentCandidate.summary.modelSlot && group.setId === currentCandidate.summary.id && group.category === panel.category && group.componentId === currentCandidate.component.id) : undefined
      const colors = currentGroup?.colors ?? {}
      const hasLocalColors = Object.keys(colors).length > 0
      const selectedSlot = selectedIndex >= 0 ? selectedIndex + 1 : 0
      const slotCount = candidates.length + 1
      const move = (direction: -1 | 1) => {
        const nextSlot = (selectedSlot + direction + slotCount) % slotCount
        void applyUpperWardrobePanel(panel, nextSlot === 0 ? null : candidates[nextSlot - 1])
      }
      return <article className="customizer-hair-piece customizer-upper-wardrobe-piece" key={panel.id} aria-label={panel.label}>
        <header><strong>{panel.label} {selectedSlot + 1}/{candidates.length + 1}</strong><div className="customizer-upper-piece-header-actions">{hasLocalColors && currentCandidate && <button className="customizer-hair-reset" type="button" onClick={() => void resetWardrobePieceColors(currentCandidate.summary.id, panel.category, currentCandidate.component.id)}>Restaurar</button>}{panel.id === 'jacket' && renderUpperWardrobePageButton()}</div></header>
        <div className="customizer-hair-piece-selector customizer-upper-wardrobe-selector">
          <button aria-label={`Peça anterior: ${panel.label}`} onClick={() => move(-1)} disabled={!candidates.length || !selectedCharacter || selectedCatalogModelSlot === null} type="button"><Icon name="chevronRight" /></button>
          <button className="customizer-hair-piece-preview" aria-label={`Abrir biblioteca de ${panel.label}`} title={`Abrir biblioteca de ${panel.label}`} onClick={() => { setWardrobeLibraryPage(0); setWardrobeLibraryPanel(panel) }} type="button">
            {currentCandidate ? <HairAssetPreview source={currentCandidate.component.dataUrl} colors={colors} alt={currentCandidate.component.name} /> : <span>Escolha uma peça</span>}
          </button>
          <button aria-label={`Próxima peça: ${panel.label}`} onClick={() => move(1)} disabled={!candidates.length || !selectedCharacter || selectedCatalogModelSlot === null} type="button"><Icon name="chevronRight" /></button>
          <div className="customizer-hair-piece-colors" aria-label={`Cores de ${panel.label}`}>
            {hairColorControls.map((color) => <label key={color.id} className={colors[color.id] ? 'local' : ''} style={{ '--hair-color-swatch': colors[color.id] ?? color.fallback } as React.CSSProperties} title={`${color.label} de ${panel.label}`}>
              <input type="color" aria-label={`${color.label} de ${panel.label}`} value={colors[color.id] ?? color.fallback} disabled={!selectedCharacter || !currentCandidate} onChange={(event) => void setWardrobePieceColor(currentCandidate!.summary.id, panel.category, currentCandidate!.component.id, color.id, event.target.value)} />
              <span aria-hidden="true">{color.id === 'highlight' ? 'L' : color.id === 'accent' ? 'A' : color.id === 'outline' ? 'C' : color.id === 'fade' ? 'D' : 'B'}</span>
            </label>)}
          </div>
        </div>
        <div className="customizer-upper-piece-colors" aria-label={`Paletas de ${panel.label}`}>
          <div className="customizer-upper-piece-colors-heading"><strong>{currentCandidate?.component.name ?? 'Paleta da peça'}</strong></div>
          <div className="customizer-hair-palette-presets customizer-upper-piece-palette-presets">
            <button className="customizer-hair-palette-scroll previous" aria-label={`Ver paletas anteriores de ${panel.label}`} onClick={() => wardrobePaletteStripRefs.current[panel.id]?.scrollBy({ left: -180, behavior: 'smooth' })} type="button"><Icon name="chevronRight" /></button>
            <div className="customizer-hair-palette-preset-list" ref={(node) => { wardrobePaletteStripRefs.current[panel.id] = node }}>
              {hairPalettePresets.map((preset) => <button key={preset.name} type="button" disabled={!selectedCharacter || !currentCandidate} aria-pressed={hairColorControls.every((color) => colors[color.id] === preset.colors[color.id])} onClick={() => currentCandidate && void applyWardrobePiecePalette(currentCandidate.summary.id, panel.category, currentCandidate.component.id, preset.colors)} title={`Aplicar paleta ${preset.name} somente a ${panel.label}`}><span style={{ background: `linear-gradient(115deg, ${preset.colors.highlight} 0 23%, ${preset.colors.base} 23% 65%, ${preset.colors.fade} 65% 84%, ${preset.colors.outline} 84%)` }} />{preset.name}</button>)}
            </div>
            <button className="customizer-hair-palette-scroll" aria-label={`Ver próximas paletas de ${panel.label}`} onClick={() => wardrobePaletteStripRefs.current[panel.id]?.scrollBy({ left: 180, behavior: 'smooth' })} type="button"><Icon name="chevronRight" /></button>
          </div>
        </div>
      </article>
    })}
  </div>

  const renderWardrobeCatalog = () => (
    <div className="customizer-wardrobe-catalog">
      {wardrobeLoading ? <div className="customizer-catalog-empty">Carregando roupas…</div> : <>
        {catalogError && <p className="customizer-catalog-error" role="alert">{catalogError}</p>}
        {upperWardrobePage === 2
          ? <section className="customizer-upper-wardrobe-page-placeholder" aria-label="Página 2 de roupas superiores"><header><strong>Jaqueta</strong>{renderUpperWardrobePageButton()}</header><div><strong>Página 2 de Superior</strong><span>Espaço reservado para as próximas peças.</span></div></section>
          : wardrobeLibraryPanel ? renderUpperWardrobeLibrary() : renderUpperWardrobePanels()}
      </>}
    </div>
  )

  if (activeModule !== null && modules.some((module) => module.name === activeModule)) {
    return (
      <div className="customizer-models-view">
        <div className="customizer-models-columns">
          <section className="customizer-model-preview" aria-label="Prévia do personagem">
            <div className="stage-wrap">
              <div className="stage-scene" style={previewStyle}>
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
              {selectedWardrobeUrl && selectedArtworkUrl && <img className={'customizer-wardrobe-overlay' + (wardrobePreviewDraggable ? ' draggable' : '')} src={selectedWardrobeUrl} alt="Roupas do personagem" draggable={false} onPointerDown={wardrobePreviewDraggable ? beginWardrobeDrag : undefined} onPointerMove={wardrobePreviewDraggable ? moveWardrobeDrag : undefined} onPointerUp={wardrobePreviewDraggable ? finishWardrobeDrag : undefined} onPointerCancel={wardrobePreviewDraggable ? finishWardrobeDrag : undefined} />}
              {selectedFaceUrl && selectedArtworkUrl && <img className="customizer-face-overlay" src={selectedFaceUrl} alt="Rosto do personagem" draggable={false} />}
              {activeModule === 'Roupas' && clothingSection === 'Customizar' && wardrobeHighlightVisible && selectedWardrobeHighlightUrl && <img className="customizer-wardrobe-selection-halo" src={selectedWardrobeHighlightUrl} alt="Peça de roupa selecionada" draggable={false} />}
              {selectedFrontHairUrl && selectedArtworkUrl && <img className="customizer-front-hair-overlay" src={selectedFrontHairUrl} alt="Cabelo posterior e franja frontal" draggable={false} />}
                {previewLoading && <div className="customizer-preview-loading">Carregando prévia…</div>}
                <div className="stage-caption"><span>{String(selectedCatalogModelSlot ?? 1).padStart(2, '0')}</span><i />{selectedArtworkLabel || selectedCharacter?.name || 'Personagem'}<small>{selectedArtworkUrl ? 'DO CATÁLOGO' : 'PERSONAGEM ATIVO'}</small></div>
              </div>
            </div>
          </section>
          <section className={`customizer-models-sidebar${selectedCustomizerTopTab === 'roupas' && clothesPanelTab === 'upper' ? ' customizer-models-sidebar-clothes-upper' : ''}`} aria-label="Categorias de personalização">
            <nav className="customizer-top-tabs" aria-label="Áreas do Customizar" role="tablist">
              {customizerTopTabs.map((tab) => <button
                key={tab.id}
                className={selectedCustomizerTopTab === tab.id ? 'active' : ''}
                onClick={() => {
                  setSelectedCustomizerTopTab(tab.id)
                  const moduleByTab: Record<string, string> = { modelos: 'Modelos', corpo: 'Modelos', cabeca: 'Cabeça', roupas: 'Roupas', outros: 'Acessórios', perfil: 'Perfil' }
                  setActiveModule(moduleByTab[tab.id])
                }}
                aria-selected={selectedCustomizerTopTab === tab.id}
                role="tab"
                type="button"
              ><CustomizerCategoryIcon category={tab.id} /><span>{tab.label}</span></button>)}
            </nav>
            {selectedCustomizerTopTab === 'cabeca' && <nav className="customizer-head-category-tabs" aria-label="Categorias de cabeça" role="tablist">
              {customizerHeadTabs.map((tab) => <button key={tab.id} className={headPanelTab === tab.id ? 'active' : ''} onClick={() => {
                setHeadPanelTab(tab.id)
              }} aria-selected={headPanelTab === tab.id} role="tab" type="button"><Icon name={tab.icon} /><span>{tab.label}</span></button>)}
            </nav>}
            {selectedCustomizerTopTab === 'roupas' && <nav className="customizer-clothes-category-tabs" aria-label="Categorias de roupas" role="tablist">
              {customizerClothesTabs.map((tab) => <button key={tab.id} className={clothesPanelTab === tab.id ? 'active' : ''} onClick={() => {
                setClothesPanelTab(tab.id)
                if (tab.id === 'upper') setClothingSection('Superior')
                else if (tab.id === 'lower') setClothingSection('Inferior')
                else if (tab.id === 'adjust') setClothingSection('Superior')
              }} aria-selected={clothesPanelTab === tab.id} role="tab" type="button"><Icon name={tab.icon} />{tab.id === 'upper' ? <span className="customizer-upper-tab-label"><span>{tab.label}</span><small>{upperWardrobePage}/2</small></span> : <span>{tab.label}</span>}</button>)}
            </nav>}
            {selectedCustomizerTopTab === 'outros' && <nav className="customizer-other-category-tabs" aria-label="Categorias de outros itens" role="tablist">
              {customizerOtherTabs.map((tab) => <button key={tab.id} className={otherPanelTab === tab.id ? 'active' : ''} onClick={() => setOtherPanelTab(tab.id)} aria-selected={otherPanelTab === tab.id} role="tab" type="button"><Icon name={tab.icon} /><span>{tab.label}</span></button>)}
            </nav>}
            <div className={`customizer-sidebar-scroll-content${selectedCustomizerTopTab === 'cabeca' && (headPanelTab === 'hair' || headPanelTab === 'eyes' || headPanelTab === 'face') ? ' customizer-sidebar-scroll-content-hair' : ''}${selectedCustomizerTopTab === 'roupas' && clothesPanelTab === 'upper' ? ' customizer-sidebar-scroll-content-clothes-upper' : ''}`} aria-label={`Conteúdo de ${customizerTopTabs.find((tab) => tab.id === selectedCustomizerTopTab)?.label ?? 'personalização'}`}>
            {selectedCustomizerTopTab === 'cabeca' && headPanelTab === 'hair' && (hairLibraryPart ? renderHairLibrary() : renderHairCustomizer())}
            {selectedCustomizerTopTab === 'cabeca' && headPanelTab === 'eyes' && (faceLibraryPart ? renderFaceLibrary() : renderFaceCustomizer())}
            {selectedCustomizerTopTab === 'cabeca' && headPanelTab === 'face' && renderFaceCatalogCustomizer()}
            {selectedCustomizerTopTab === 'roupas' && clothesPanelTab === 'upper' && renderWardrobeCatalog()}
            {selectedCustomizerTopTab === 'roupas' && clothesPanelTab === 'adjust' && <div className="customizer-catalog-empty">Os ajustes de roupas ainda não estão disponíveis.</div>}
            {selectedCustomizerTopTab === 'modelos' && <section className="customizer-model-skin-tones" aria-label="Cor de pele do modelo">
              <strong>Cor de pele</strong>
              <div className="customizer-model-skin-tone-row" role="group" aria-label="Escolher cor de pele">
                {customizerSkinTonePresets.map((preset) => {
                  const selected = (selectedCharacter?.customization.modelSkinTone ?? skinTonePresets[0].id) === preset.id
                  return <button key={preset.id} className={'customizer-model-skin-tone' + (selected ? ' selected' : '')} style={{ '--skin-tone': preset.id } as React.CSSProperties} onClick={() => void saveCharacterCustomization({ modelSkinTone: preset.id })} aria-label={`Tom de pele ${preset.name}`} aria-pressed={selected} title={preset.name} type="button" disabled={!selectedCharacter}><span />{selected && <Icon name="check" />}</button>
                })}
                <label className={'customizer-model-skin-picker' + (selectedCharacter && !customizerSkinTonePresets.some((preset) => preset.id === (selectedCharacter.customization.modelSkinTone ?? skinTonePresets[0].id)) ? ' selected' : '')} title="Escolher uma cor personalizada">
                  <input type="color" aria-label="Escolher cor de pele personalizada" value={selectedCharacter?.customization.modelSkinTone ?? skinTonePresets[0].id} onChange={(event) => void saveCharacterCustomization({ modelSkinTone: event.target.value })} disabled={!selectedCharacter} />
                  <span className="customizer-model-skin-picker-swatch" style={{ '--skin-tone': selectedCharacter?.customization.modelSkinTone ?? skinTonePresets[0].id } as React.CSSProperties}><Icon name="brush" /></span>
                </label>
              </div>
            </section>}
            {selectedCustomizerTopTab === 'modelos' && <section className="customizer-pose-carousel" aria-label="Pose do modelo">
              <header className="customizer-pose-carousel-heading" aria-live="polite">
                <strong>{selectedPoseCategory} · Página {activePosePage + 1}{posePageCount > 1 ? ` de ${posePageCount}` : ''}</strong>
              </header>
              <div className="customizer-pose-carousel-body">
                <div className="customizer-pose-carousel-nav" role="group" aria-label="Navegação à esquerda">
                  <button className="customizer-pose-carousel-arrow category" aria-label="Categoria anterior" title="Categoria anterior" onClick={() => showAdjacentPoseCategory(-1)} type="button"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M13 2 0 16l13 14v-8h19V10H13z" /></svg></button>
                  <button className="customizer-pose-carousel-arrow page" aria-label="Página anterior de poses" title="Página anterior" onClick={() => showAdjacentPosePage(-1)} disabled={activePosePage === 0} type="button"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M13 2 0 16l13 14v-8h19V10H13z" /></svg></button>
                </div>
                <div className="customizer-pose-carousel-poses">
                  {visibleCategoryPoses.map((pose) => <button className={`customizer-pose-carousel-image${selectedCatalogPoseSlot === pose.slot ? ' selected' : ''}`} key={`${pose.sourceModelSlot}:${pose.slot}`} onClick={() => void selectCatalogPose(pose)} disabled={!selectedCharacter || previewLoading} title={`Pose ${String(pose.slot).padStart(2, '0')}: ${pose.name}`} aria-label={`Selecionar pose ${String(pose.slot).padStart(2, '0')}`} aria-pressed={selectedCatalogPoseSlot === pose.slot} type="button">{poseThumbnails[`${pose.sourceModelSlot}:${pose.slot}`] ? <img src={poseThumbnails[`${pose.sourceModelSlot}:${pose.slot}`]} alt="" /> : <span>Pose {String(pose.slot).padStart(2, '0')}</span>}</button>)}
                  {Array.from({ length: Math.max(0, 5 - visibleCategoryPoses.length) }, (_, index) => <span className="customizer-pose-carousel-empty" key={`empty-${index}`} />)}
                </div>
                <div className="customizer-pose-carousel-nav" role="group" aria-label="Navegação à direita">
                  <button className="customizer-pose-carousel-arrow category" aria-label="Próxima categoria" title="Próxima categoria" onClick={() => showAdjacentPoseCategory(1)} type="button"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M19 2 32 16 19 30v-8H0V10h19z" /></svg></button>
                  <button className="customizer-pose-carousel-arrow page" aria-label="Próxima página de poses" title="Próxima página" onClick={() => showAdjacentPosePage(1)} disabled={activePosePage >= posePageCount - 1} type="button"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M19 2 32 16 19 30v-8H0V10h19z" /></svg></button>
                </div>
              </div>
            </section>}
            {selectedCustomizerTopTab === 'modelos' && <section className="customizer-proportions" aria-label="Proporções do personagem">
              <header><strong>Proporções</strong><button onClick={() => commitProportions({ ...defaultCharacterProportions })} disabled={!selectedCharacter} type="button">Restaurar</button></header>
              <div className="customizer-proportions-grid">{proportionControls.map(({ key, label, description }) => {
                const limits = characterProportionLimits[key]
                return <div className="customizer-proportion-control" key={key} title={description}>
                  <div className="customizer-proportion-heading"><label htmlFor={`character-proportion-${key}`}>{label}</label><output>{activeProportions[key]}%</output></div>
                  <div className="customizer-proportion-inputs">
                    <button aria-label={`Diminuir ${label.toLowerCase()}`} disabled={!selectedCharacter || activeProportions[key] <= limits.min} onClick={() => commitProportion(key, activeProportions[key] - 1)} type="button">−</button>
                    <input id={`character-proportion-${key}`} type="range" min={limits.min} max={limits.max} step="1" value={activeProportions[key]} disabled={!selectedCharacter} onChange={(event) => changeProportion(key, Number(event.target.value))} onPointerUp={(event) => commitProportion(key, Number(event.currentTarget.value))} onPointerCancel={(event) => commitProportion(key, Number(event.currentTarget.value))} onKeyUp={(event) => commitProportion(key, Number(event.currentTarget.value))} onBlur={(event) => commitProportion(key, Number(event.currentTarget.value))} />
                    <button aria-label={`Aumentar ${label.toLowerCase()}`} disabled={!selectedCharacter || activeProportions[key] >= limits.max} onClick={() => commitProportion(key, activeProportions[key] + 1)} type="button">+</button>
                  </div>
                </div>
              })}</div>
            </section>}
            {selectedCustomizerTopTab === 'modelos' && <section className="customizer-body-shape" aria-label="Ajuste de largura e altura das partes do corpo">
              <header><span><strong>Corpo · tronco e membros</strong><small>As peças acompanham as juntas, com ajustes separados para coxas e pernas inferiores.</small></span><button onClick={() => { setBodyDimensionEdit(selectedCharacter ? { characterId: selectedCharacter.id, values: { ...defaultCharacterBodyDimensions } } : null); commitBodyDimensions({ ...defaultCharacterBodyDimensions }) }} disabled={!selectedCharacter} type="button">Restaurar</button></header>
              <div className="customizer-body-shape-grid">{([
                { name: 'Tronco', width: 'torsoWidth', height: 'torsoHeight' },
                { name: 'Braços', width: 'armsWidth', height: 'armsHeight' },
                { name: 'Coxas', width: 'thighsWidth', height: 'thighsHeight' },
                { name: 'Pernas inferiores', width: 'lowerLegsWidth', height: 'lowerLegsHeight' }
              ] as const).map(({ name, width, height }) => <fieldset className="customizer-body-part" key={name}>
                <legend>{name}</legend>
                {([['width', width, 'Largura'], ['height', height, 'Altura']] as const).map(([axis, key, label]) => {
                  const limits = characterBodyDimensionLimits[key]
                  const finish = (value: number) => commitBodyDimension(key, value)
                  return <label className="customizer-body-axis" key={axis}><span>{label}<output>{activeBodyDimensions[key]}%</output></span><div className="customizer-proportion-inputs"><button aria-label={`Diminuir ${label.toLowerCase()} de ${name}`} disabled={!selectedCharacter || activeBodyDimensions[key] <= limits.min} onClick={() => finish(activeBodyDimensions[key] - 1)} type="button">−</button><input aria-label={`${label} de ${name}`} type="range" min={limits.min} max={limits.max} step="1" value={activeBodyDimensions[key]} disabled={!selectedCharacter} onChange={(event) => changeBodyDimension(key, Number(event.target.value))} onPointerUp={(event) => finish(Number(event.currentTarget.value))} onPointerCancel={(event) => finish(Number(event.currentTarget.value))} onKeyUp={(event) => finish(Number(event.currentTarget.value))} onBlur={(event) => finish(Number(event.currentTarget.value))} /><button aria-label={`Aumentar ${label.toLowerCase()} de ${name}`} disabled={!selectedCharacter || activeBodyDimensions[key] >= limits.max} onClick={() => finish(activeBodyDimensions[key] + 1)} type="button">+</button></div></label>
                })}
              </fieldset>)}</div>
              <label className="customizer-body-balance"><span><b>Harmonia corporal</b><output>{activeBodyDimensions.balance}%</output></span><small>Coxas maiores aumentam um pouco o tronco; tronco maior aumenta um pouco braços e pernas. Em 0%, só o controle escolhido muda de tamanho.</small><input aria-label="Harmonia corporal" type="range" min="0" max="100" step="1" value={activeBodyDimensions.balance} disabled={!selectedCharacter} onChange={(event) => changeBodyDimension('balance', Number(event.target.value))} onPointerUp={(event) => commitBodyDimension('balance', Number(event.currentTarget.value))} onPointerCancel={(event) => commitBodyDimension('balance', Number(event.currentTarget.value))} onKeyUp={(event) => commitBodyDimension('balance', Number(event.currentTarget.value))} onBlur={(event) => commitBodyDimension('balance', Number(event.currentTarget.value))} /></label>
            </section>}
            </div>
            <div className="customizer-models-content" hidden>
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
              {activeModule === 'Modelos' && selectedCharacter && selectedCatalogModelSlot !== null && <section className="customizer-skin-tones" aria-label="Cor de pele do personagem">
                <header><strong>Cor da pele</strong><small>Salva somente em {selectedCharacter.name}</small></header>
                <div className="customizer-skin-tone-options" role="group" aria-label="Escolher tom de pele">
                  {skinTonePresets.map((preset) => {
                    const selected = selectedCharacter.customization.modelSkinTone === preset.id
                    return <button key={preset.id} className={'customizer-skin-tone' + (selected ? ' selected' : '')} style={{ '--skin-tone': preset.id } as React.CSSProperties} onClick={() => void saveCharacterCustomization({ modelSkinTone: preset.id })} aria-label={`Tom de pele ${preset.name}`} aria-pressed={selected} title={preset.name} type="button"><span />{selected && <Icon name="check" />}</button>
                  })}
                </div>
              </section>}
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
              {activeModule === 'Cabeça' && <div className="customizer-head-workspace">
                <nav className="customizer-head-tabs" aria-label="Categorias da cabeça" role="tablist">
                  {customizerHeadTabs.map((tab) => <button key={tab.id} className={headPanelTab === tab.id ? 'active' : ''} onClick={() => {
                    setHeadPanelTab(tab.id)
                  }} aria-selected={headPanelTab === tab.id} role="tab" type="button"><Icon name={tab.icon} /><span>{tab.label}</span></button>)}
                </nav>
                {headPanelTab === 'hair' && renderHairCatalog()}
                {headPanelTab === 'extra' && <div className="customizer-head-placeholder"><Icon name="sparkles" /><strong>Extras da cabeça</strong><span>Esta área ficará pronta quando o catálogo de extras estiver integrado.</span></div>}
                {headPanelTab === 'adjust' && <div className="customizer-head-placeholder"><Icon name="sliders" /><strong>Ajustes da cabeça</strong><span>Os controles de ajuste por peça serão organizados aqui.</span></div>}
              </div>}
              {activeModule === 'Cabelos' && renderHairCatalog()}
              {/* O catálogo de roupas é renderizado no painel lateral visível. */}
              {activeModule !== 'Modelos' && activeModule !== 'Poses' && activeModule !== 'Roupas' && <div className="customizer-catalog-empty">O catálogo de {activeModule} aparecerá aqui.</div>}
            </section>
            </div>
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
            {selectedCharacter && <button className="icon-button roster-delete-button" aria-label={'Excluir ' + selectedCharacter.name} title="Excluir personagem" onClick={() => void deleteSelectedCharacter()} type="button"><Icon name="trash" /></button>}
            <button className="icon-button add-button" aria-label="Adicionar personagem" onClick={() => { setNameDraft(''); setDialogMode('create') }} type="button">
              <Icon name="plus" />
            </button>
          </div>
          <label className="roster-search">
            <Icon name="search" />
            <input aria-label="Buscar personagem" placeholder="Buscar personagem" value={rosterQuery} onChange={(event) => setRosterQuery(event.target.value)} />
            <kbd>/</kbd>
          </label>
          <div className="character-grid">
            {visibleCharacters.map((character) => (
              <button
                className={`character-card ${selectedCharacter?.id === character.id ? 'selected' : ''}`}
                key={character.id}
                onClick={() => selectCharacter(character.id)}
                aria-pressed={selectedCharacter?.id === character.id}
              >
                <CharacterPortrait character={character} />
                <span>{character.name}</span>
              </button>
            ))}
            {charactersLoading && <p className="empty-roster">Carregando personagens…</p>}
            {!charactersLoading && characters.length === 0 && <p className="empty-roster">Sua coleção está vazia. Use + para criar o primeiro personagem.</p>}
            {!charactersLoading && characters.length > 0 && visibleCharacters.length === 0 && <p className="empty-roster">Nenhum personagem encontrado.</p>}
          </div>
          <div className="roster-footer"><span className={'online-dot' + (charactersError || characterSaveState === 'error' ? ' roster-error-dot' : '')} /> {charactersError || (characterSaveState === 'saving' ? `Salvando ${selectedCharacter?.name ?? 'personagem'}…` : characterSaveState === 'error' ? 'Falha ao salvar personagem' : selectedCharacter ? `Alterações de ${selectedCharacter.name} salvas` : 'Personagens salvos neste dispositivo')}</div>
        </aside>

        <section className="preview-column" aria-label="Preview do personagem">
          <div className="preview-heading">
            <div className="preview-title">
              <p className="eyebrow">CUSTOMIZAR <span>/</span> PERSONAGEM</p>
              <h1>{selectedCharacter?.name ?? (charactersLoading ? 'Carregando personagens…' : 'Crie um personagem')}<button className="rename-button" aria-label="Editar nome do personagem" disabled={!selectedCharacter} onClick={() => { setNameDraft(selectedCharacter?.name ?? ''); setDialogMode('rename') }} type="button"><Icon name="edit" /></button></h1>
            </div>
            <div className="preview-actions">
              <button className="quiet-button" aria-live="polite"><Icon name={characterSaveState === 'error' ? 'warning' : characterSaveState === 'saving' ? 'reset' : 'check'} /> {characterSaveState === 'saving' ? 'Salvando' : characterSaveState === 'error' ? 'Falha ao salvar' : 'Salvo'}</button>
              <button className="icon-button" aria-label="Tela cheia"><Icon name="expand" /></button>
            </div>
          </div>

          <div className="stage-wrap">
            <div className="stage-scene" style={previewStyle}>
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
              {selectedArtworkUrl ? <img className="customizer-selected-artwork" src={selectedArtworkUrl} alt={selectedArtworkLabel} /> : !previewLoading && <div className="customizer-no-artwork"><Icon name="body" /><span>{selectedCharacter ? 'Importe um modelo no Fabricador Dev para começar.' : 'Crie um personagem para começar a personalizar.'}</span></div>}
                {selectedWardrobeUrl && selectedArtworkUrl && <img className={'customizer-wardrobe-overlay' + (wardrobePreviewDraggable ? ' draggable' : '')} src={selectedWardrobeUrl} alt="Roupas do personagem" draggable={false} onPointerDown={wardrobePreviewDraggable ? beginWardrobeDrag : undefined} onPointerMove={wardrobePreviewDraggable ? moveWardrobeDrag : undefined} onPointerUp={wardrobePreviewDraggable ? finishWardrobeDrag : undefined} onPointerCancel={wardrobePreviewDraggable ? finishWardrobeDrag : undefined} />}
                {selectedFaceUrl && selectedArtworkUrl && <img className="customizer-face-overlay" src={selectedFaceUrl} alt="Rosto do personagem" draggable={false} />}
                {activeModule === 'Roupas' && clothingSection === 'Customizar' && wardrobeHighlightVisible && selectedWardrobeHighlightUrl && <img className="customizer-wardrobe-selection-halo" src={selectedWardrobeHighlightUrl} alt="Peça de roupa selecionada" draggable={false} />}
                {selectedFrontHairUrl && selectedArtworkUrl && <img className="customizer-front-hair-overlay" src={selectedFrontHairUrl} alt="Cabelo posterior e franja frontal" draggable={false} />}
              {previewLoading && <div className="customizer-preview-loading">Carregando prévia…</div>}
              <div className="stage-caption"><span>{String(selectedCatalogModelSlot ?? 1).padStart(2, '0')}</span><i />{selectedArtworkLabel || selectedCharacter?.name || 'Personagem'}<small>{selectedArtworkUrl ? 'MODELO DE REFERÊNCIA' : 'SEM MODELO'}</small></div>
            </div>
            <div className="stage-underbar">
              <div className="background-picker"><span className="background-swatch" /><span>Fundo do preview</span><Icon name="chevronDown" /></div>
              <button className="text-action" onClick={() => setActiveModule('Personalização')}><Icon name="sliders" /> Personalizar</button>
            </div>
          </div>

        </section>

        <aside className="modules-panel panel" aria-label="Áreas do Customizar">
          <DesignBanner />
          <nav className="customizer-top-tabs home-customizer-top-tabs" aria-label="Áreas do Customizar">
            {customizerTopTabs.map((tab) => <button
              key={tab.id}
              onClick={() => {
                setSelectedCustomizerTopTab(tab.id)
                const moduleByTab: Record<string, string> = {
                  modelos: 'Modelos',
                  corpo: 'Modelos',
                  cabeca: 'Cabeça',
                  roupas: 'Roupas',
                  outros: 'Acessórios',
                  perfil: 'Perfil'
                }
                setActiveModule(moduleByTab[tab.id])
              }}
              type="button"
            ><CustomizerCategoryIcon category={tab.id} /><span>{tab.label}</span></button>)}
          </nav>
        </aside>
      {dialogMode && <div className="character-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogMode(null) }}>
        <form className="character-dialog" onSubmit={(event) => void submitCharacterDialog(event)} aria-labelledby="character-dialog-title">
          <p className="eyebrow">SUA COLEÇÃO</p>
          <h2 id="character-dialog-title">{dialogMode === 'create' ? 'Novo personagem' : 'Renomear personagem'}</h2>
          <label htmlFor="character-name">Nome</label>
          <input id="character-name" autoFocus maxLength={80} value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} placeholder="Ex.: Chloe" />
          {charactersError && <p className="character-dialog-error" role="alert">{charactersError}</p>}
          <div className="character-dialog-actions"><button className="quiet-button" type="button" onClick={() => setDialogMode(null)}>Cancelar</button><button className="primary-button" type="submit" disabled={!nameDraft.trim() || savingCharacter}>{savingCharacter ? 'Salvando…' : 'Salvar'}</button></div>
        </form>
      </div>}
    </div>
  )
}
