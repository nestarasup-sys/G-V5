import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'gacha-nymi:preview-background'
const DEFAULT_COLOR = '#fdfcfd'
const CHANGE_EVENT = 'gacha-nymi:preview-background-change'

function readColor(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored && /^#[0-9a-f]{6}$/i.test(stored) ? stored : DEFAULT_COLOR
  } catch {
    return DEFAULT_COLOR
  }
}

export function usePreviewBackground(): [string, (color: string) => void] {
  const [color, setColor] = useState(readColor)

  useEffect(() => {
    const sync = () => setColor(readColor())
    window.addEventListener('storage', sync)
    window.addEventListener(CHANGE_EVENT, sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener(CHANGE_EVENT, sync)
    }
  }, [])

  const updateColor = useCallback((nextColor: string) => {
    if (!/^#[0-9a-f]{6}$/i.test(nextColor)) return
    try { window.localStorage.setItem(STORAGE_KEY, nextColor) } catch { /* Keep the choice for the current screen. */ }
    setColor(nextColor)
    window.dispatchEvent(new Event(CHANGE_EVENT))
  }, [])

  return [color, updateColor]
}
