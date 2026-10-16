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

function normalizeSettings(value: unknown): DesignSettings {
  if (!value || typeof value !== 'object' || !Array.isArray((value as DesignSettings).bannerSlides)) return defaultDesignSettings
  const bannerSlides = (value as DesignSettings).bannerSlides
    .filter((slide): slide is DesignBannerSlide => Boolean(slide && typeof slide.id === 'string'))
    .slice(0, MAX_SLIDES)
    .map((slide) => ({
      id: slide.id,
      title: typeof slide.title === 'string' ? slide.title.slice(0, 80) : '',
      subtitle: typeof slide.subtitle === 'string' ? slide.subtitle.slice(0, 120) : '',
      imageDataUrl: typeof slide.imageDataUrl === 'string' && slide.imageDataUrl.startsWith('data:image/') ? slide.imageDataUrl : null
    }))
  return { bannerSlides: bannerSlides.length ? bannerSlides : defaultDesignSettings.bannerSlides }
}

export function getDesignSettings(): DesignSettings {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored ? normalizeSettings(JSON.parse(stored) as unknown) : defaultDesignSettings
  } catch {
    return defaultDesignSettings
  }
}

export function saveDesignSettings(settings: DesignSettings): void {
  const normalized = normalizeSettings(settings)
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized)) } catch { /* The current screen can still use the updated settings. */ }
  window.dispatchEvent(new Event(CHANGE_EVENT))
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
