import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { VideoAudioSettings, VideoMediaClip } from '../../../../shared/studio'
import { videoAudioSettings } from '../../../../shared/videoAudio'

function Speaker({ muted }: { muted: boolean }) {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M11 4 6 8H3v8h3l5 4V4Z" />{muted ? <path d="m16 9 6 6m0-6-6 6" /> : <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />}</svg>
}

function AudioLevel({ label, value, disabled, onChange, onBeginEdit }: {
  label: string; value?: VideoAudioSettings; disabled?: boolean
  onChange: (settings: VideoAudioSettings, record?: boolean) => void
  onBeginEdit: () => void
}) {
  const settings = videoAudioSettings(value)
  return <div className="video-audio-level">
    <strong>{label}</strong>
    <div><button type="button" disabled={disabled} onClick={() => onChange({ ...settings, muted: !settings.muted })} aria-label={`${settings.muted ? 'Ativar' : 'Silenciar'} ${label}`} aria-pressed={settings.muted}><Speaker muted={settings.muted} /><span>{settings.muted ? 'Sem som' : 'Com som'}</span></button><output>{Math.round(settings.volume * 100)}%</output></div>
    <input type="range" aria-label={`Volume ${label}`} min={0} max={100} step={1} value={Math.round(settings.volume * 100)} disabled={disabled}
      onPointerDown={onBeginEdit} onKeyDown={(event) => { if (!event.repeat && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) onBeginEdit() }}
      onChange={(event) => onChange({ ...settings, volume: Number(event.currentTarget.value) / 100 }, false)} />
  </div>
}

/** Floating controls do not consume extra timeline height. */
export function VideoAudioControls({ master, selectedClip, clipName, locked, onChangeMaster, onChangeClip, onBeginEdit }: {
  master?: VideoAudioSettings
  selectedClip?: VideoMediaClip
  clipName?: string
  locked: boolean
  onChangeMaster: (settings: VideoAudioSettings, record?: boolean) => void
  onChangeClip: (clip: VideoMediaClip, record?: boolean) => void
  onBeginEdit: () => void
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const project = videoAudioSettings(master)
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect()
      const panel = panelRef.current?.getBoundingClientRect()
      if (!trigger || !panel) return
      const above = trigger.top - panel.height - 8
      setPosition({ top: Math.max(8, above >= 8 ? above : Math.min(window.innerHeight - panel.height - 8, trigger.bottom + 8)), left: Math.max(8, Math.min(window.innerWidth - panel.width - 8, trigger.right - panel.width)) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open, selectedClip?.id])
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus() } }
    window.addEventListener('pointerdown', dismiss)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', escape) }
  }, [open])
  return <>
    <button ref={triggerRef} className={open ? 'active' : ''} type="button" aria-label="Áudio dos vídeos" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((value) => !value)}><Speaker muted={project.muted || project.volume === 0} />Áudio</button>
    {open && createPortal(<div ref={panelRef} className="video-audio-popover" role="dialog" aria-label="Áudio dos vídeos" style={position}>
      <header><strong>Áudio dos vídeos</strong><button type="button" aria-label="Fechar áudio" onClick={() => { setOpen(false); triggerRef.current?.focus() }}>×</button></header>
      <AudioLevel label="Projeto" value={master} onChange={onChangeMaster} onBeginEdit={onBeginEdit} />
      {selectedClip ? <section><small title={clipName}>{clipName ?? 'Vídeo selecionado'}</small><AudioLevel label="Clipe selecionado" value={selectedClip.audio} disabled={locked} onBeginEdit={onBeginEdit} onChange={(audio, record) => onChangeClip({ ...selectedClip, audio }, record)} /></section> : <p>Selecione um clipe de vídeo para ajustar o áudio dele.</p>}
    </div>, document.body)}
  </>
}
