import { useCallback, useEffect, useRef, useState } from 'react'

/** Fullscreen belongs to the preview surface, never to the entire editor document. */
export function usePreviewFullscreen() {
  const surfaceRef = useRef<HTMLElement>(null)
  const ownedRef = useRef<HTMLElement | null>(null)
  const requestVersion = useRef(0)
  const [fullView, setFullView] = useState(false)

  const exitFullView = useCallback(() => {
    requestVersion.current += 1
    setFullView(false)
    if (ownedRef.current && document.fullscreenElement === ownedRef.current) void document.exitFullscreen().catch(() => undefined)
  }, [])

  const enterFullView = useCallback(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const version = ++requestVersion.current
    setFullView(true)
    // Retain the full-window preview when native fullscreen is unavailable.
    if (!document.fullscreenEnabled || document.fullscreenElement) return
    ownedRef.current = surface
    void surface.requestFullscreen().then(() => {
      if (version !== requestVersion.current && document.fullscreenElement === surface) void document.exitFullscreen().catch(() => undefined)
    }).catch(() => { if (version === requestVersion.current && ownedRef.current === surface) ownedRef.current = null })
  }, [])

  useEffect(() => {
    const changed = () => {
      if (ownedRef.current && document.fullscreenElement !== ownedRef.current) {
        ownedRef.current = null
        requestVersion.current += 1
        setFullView(false)
      }
    }
    document.addEventListener('fullscreenchange', changed)
    return () => {
      requestVersion.current += 1
      document.removeEventListener('fullscreenchange', changed)
      if (ownedRef.current && document.fullscreenElement === ownedRef.current) void document.exitFullscreen().catch(() => undefined)
      ownedRef.current = null
    }
  }, [])

  return { surfaceRef, fullView, enterFullView, exitFullView }
}
