import { useEffect, useMemo, useRef, useState } from 'react'
import type { CustomizerCharacter } from '../../../../shared/customizer'
import type { StudioDocument, VideoCharacterState } from '../../../../shared/studio'
import { compileCharacterTransitions, transitionSampleFrames, type CharacterTransition } from './characterTransitions'
import { TransitionRenderer } from './transitionRenderer'

type CachedFrame = { state: VideoCharacterState; bytes: number }

/** Bounded, cancellable pre-render queue: playback never waits on an asset renderer. */
class TransitionSession {
  private renderer = new TransitionRenderer()
  private cache = new Map<string, CachedFrame>()
  private identities = new WeakMap<object, number>()
  private nextIdentity = 0
  private bytes = 0
  private queue: Promise<void> = Promise.resolve()
  private pending = new Map<string, Promise<void>>()
  private disposed = false
  constructor(readonly studioId: string) {}

  private identity(state: object) {
    if (!this.identities.has(state)) this.identities.set(state, ++this.nextIdentity)
    return this.identities.get(state)!
  }
  private key(span: CharacterTransition, frame: number, character: CustomizerCharacter) {
    return `${span.elementId}:${span.boundaryFrame}:${this.identity(span.from)}:${this.identity(span.to)}:${character.updatedAt}:${frame}`
  }
  get(span: CharacterTransition, frame: number, character: CustomizerCharacter) {
    const key = this.key(span, frame, character), cached = this.cache.get(key)
    if (cached) { this.cache.delete(key); this.cache.set(key, cached) }
    return cached?.state
  }
  private prepare(span: CharacterTransition, frame: number, character: CustomizerCharacter) {
    const key = this.key(span, frame, character)
    if (this.cache.has(key)) return Promise.resolve()
    if (this.pending.has(key)) return this.pending.get(key)!
    const job = this.queue.catch(() => undefined).then(async () => {
      if (this.disposed) return
      const state = await this.renderer.render(span, frame, character)
      if (this.disposed) return
      const image = new Image()
      image.src = state.imageDataUrl
      await image.decode()
      if (this.disposed) { image.src = ''; return }
      // Keep full-resolution PNGs, not hundreds of pinned decoded bitmaps.
      // Chromium owns the decoded frames used by the actual preview.
      image.src = ''
      const bytes = state.imageDataUrl.length * 2
      this.cache.set(key, { state, bytes }); this.bytes += bytes
      while ((this.bytes > 128 * 1024 ** 2 || this.cache.size > 240) && this.cache.size > 1) {
        const oldest = this.cache.keys().next().value!
        const entry = this.cache.get(oldest)!
        this.bytes -= entry.bytes; this.cache.delete(oldest)
      }
    }).finally(() => { this.pending.delete(key) })
    this.pending.set(key, job); this.queue = job
    return job
  }

  async prepareAhead(spans: CharacterTransition[], frame: number, characters: CustomizerCharacter[]) {
    const upcoming = spans.filter((span) => span.boundaryFrame > frame)
    const nextBoundary = upcoming[0]?.boundaryFrame ?? frame
    const horizon = nextBoundary
    for (const span of upcoming.filter((item) => item.boundaryFrame <= horizon)) {
      if (this.disposed) return
      const character = characters.find((item) => item.id === span.from.element.characterId)
      if (!character) throw new Error('Um personagem da animação não foi encontrado na biblioteca.')
      for (const sample of transitionSampleFrames(span)) await this.prepare(span, sample, character)
    }
  }

  activate() { this.disposed = false }

  dispose() {
    this.disposed = true
    this.cache.clear(); this.bytes = 0
  }
}

export function useCharacterTransitions(studio: StudioDocument | null, characters: CustomizerCharacter[], frame: number, playing: boolean, onError: (message: string) => void, enabled = true) {
  const timeline = studio?.videoTimeline
  const spans = useMemo(() => studio ? compileCharacterTransitions(studio) : [], [studio?.id, timeline?.characterKeys, timeline?.characterBases, timeline?.characterGaps, timeline?.durationFrames])
  const session = useMemo(() => new TransitionSession(studio?.id ?? ''), [studio?.id])
  const [revision, setRevision] = useState(0)
  const activeSession = useRef(session)
  activeSession.current = session
  const activePlan = useRef({ spans, characters })
  activePlan.current = { spans, characters }
  const bucket = Math.floor(frame / 60)
  const nextBoundary = spans.find((span) => span.boundaryFrame > frame)?.boundaryFrame
  useEffect(() => { session.activate(); return () => session.dispose() }, [session])
  useEffect(() => {
    if (!studio || !enabled) return
    let cancelled = false
    void session.prepareAhead(spans, frame, characters).then(() => { if (!cancelled) setRevision((value) => value + 1) }).catch((reason: unknown) => {
      if (!cancelled) onError(reason instanceof Error ? reason.message : 'Não foi possível preparar uma animação de personagem.')
    })
    return () => { cancelled = true }
  }, [session, spans, bucket, nextBoundary, characters, onError, enabled])

  const samplesByFrame = useMemo(() => {
    const result = new Map<number, CharacterTransition[]>()
    for (const span of spans) for (const sample of transitionSampleFrames(span)) result.set(sample, [...(result.get(sample) ?? []), span])
    return result
  }, [spans])
  const samples = useMemo(() => {
    const result = new Map<string, VideoCharacterState>()
    // A paused seek is still an absolute timeline frame; show its authored transition sample too.
    if (enabled) for (const span of samplesByFrame.get(frame) ?? []) {
      if (!(frame > span.startFrame && frame < span.boundaryFrame)) continue
      const character = characters.find((item) => item.id === span.from.element.characterId)
      const state = character && session.get(span, frame, character)
      if (state) result.set(span.elementId, state)
    }
    return result
  }, [samplesByFrame, frame, session, characters, revision, enabled])

  const preparePlayback = async (startFrame = frame) => {
    if (!enabled) return true
    await session.prepareAhead(spans, startFrame, characters)
    return activeSession.current === session && activePlan.current.spans === spans && activePlan.current.characters === characters
  }
  const missing = enabled && playing && (samplesByFrame.get(frame) ?? []).some((span) => !samples.has(span.elementId))
  return { samples, missing, preparePlayback }
}
