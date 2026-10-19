import { useSyncExternalStore } from 'react'

export type DesignBannerSlide = {
  id: string
  title: string
  subtitle: string
  imageDataUrl: string | null
}

export type DesignSettings = { bannerSlides: DesignBannerSlide[] }

const STORAGE_KEY = 'nymi.design.settings.v1'
const CHANGE_EVENT = 'nymi-design-settings-changed'
const MAX_SLIDES = 8
const MAX_IMAGE_BYTES = 1_500_000

export const DESIGN_BANNER_WIDTH_PX = 320
export const DESIGN_BANNER_HEIGHT_PX = 142
export const DESIGN_BANNER_IMAGE_WIDTH_PX = 316
export const DESIGN_BANNER_IMAGE_HEIGHT_PX = 108

export const defaultDesignSettings: DesignSettings = {
  bannerSlides: [
    { id: 'welcome', title: 'Seu universo, do seu jeito.', subtitle: 'Crie. Imagine. Compartilhe.', imageDataUrl: null },
    { id: 'create', title: 'Dê vida às suas ideias.', subtitle: 'Seu próximo personagem começa aqui.', imageDataUrl: null }
  ]
}

let cachedSettingsSnapshot = defaultDesignSettings
let settingsRevision = 0
let initialization: Promise<void> | null = null
let saveQueue: Promise<void> = Promise.resolve()

function normalizeSettings(value: unknown): DesignSettings {
  if (!value || typeof value !== 'object' || !Array.isArray((value as DesignSettings).bannerSlides)) return defaultDesignSettings
  const bannerSlides = (value as DesignSettings).bannerSlides
    .filter((slide): slide is DesignBannerSlide => Boolean(slide && typeof slide.id === 'string'))
    .slice(0, MAX_SLIDES)
    .map((slide) => ({
      id: slide.id,
      title: typeof slide.title === 'string' ? slide.title.slice(0, 80) : '',
      subtitle: typeof slide.subtitle === 'string' ? slide.subtitle.slice(0, 120) : '',
      imageDataUrl: typeof slide.imageDataUrl === 'string' && /^data:image\/(png|jpeg|webp);base64,/i.test(slide.imageDataUrl) ? slide.imageDataUrl : null
    }))
  return { bannerSlides: bannerSlides.length ? bannerSlides : defaultDesignSettings.bannerSlides }
}

export function getDesignSettings(): DesignSettings {
  void initializeSettings()
  return cachedSettingsSnapshot
}

function initializeSettings(): Promise<void> {
  if (initialization) return initialization
  initialization = (async () => {
    let legacy: DesignSettings | null = null
    try {
      const text = window.localStorage.getItem(STORAGE_KEY)
      if (text) legacy = normalizeSettings(JSON.parse(text) as unknown)
    } catch { /* The app-data copy remains the source of truth. */ }
    const stored = await window.desktop.loadFabricatorDesignSettings()
    if (settingsRevision === 0) cachedSettingsSnapshot = stored ? normalizeSettings(stored) : legacy ?? defaultDesignSettings
    if (!stored) await window.desktop.saveFabricatorDesignSettings(cachedSettingsSnapshot)
    if (settingsRevision === 0) {
      try { window.localStorage.removeItem(STORAGE_KEY) } catch { /* Keep the legacy copy if the profile is unavailable. */ }
    }
    window.dispatchEvent(new Event(CHANGE_EVENT))
  })().catch((reason) => {
    initialization = null
    console.error('Não foi possível carregar as configurações do Design Dev.', reason)
  })
  return initialization
}

export function saveDesignSettings(settings: DesignSettings): void {
  const normalized = normalizeSettings(settings)
  const revision = ++settingsRevision
  cachedSettingsSnapshot = normalized
  window.dispatchEvent(new Event(CHANGE_EVENT))
  saveQueue = saveQueue.catch(() => undefined).then(async () => {
    await initializeSettings()
    await window.desktop.saveFabricatorDesignSettings(normalized)
    if (settingsRevision === revision) {
      try { window.localStorage.removeItem(STORAGE_KEY) } catch { /* app-data remains authoritative */ }
    }
  }).catch((reason) => console.error('Não foi possível salvar as configurações do Design Dev.', reason))
}

function subscribe(callback: () => void): () => void {
  window.addEventListener('storage', callback)
  window.addEventListener(CHANGE_EVENT, callback)
  return () => {
    window.removeEventListener('storage', callback)
    window.removeEventListener(CHANGE_EVENT, callback)
  }
}

export function useDesignSettings(): DesignSettings {
  return useSyncExternalStore(subscribe, getDesignSettings, () => defaultDesignSettings)
}

export const designLimits = { maxSlides: MAX_SLIDES, maxImageBytes: MAX_IMAGE_BYTES }
