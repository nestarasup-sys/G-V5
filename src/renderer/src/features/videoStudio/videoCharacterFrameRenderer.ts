import type { VideoCharacterState } from '../../../../shared/studio'
import type { VideoSceneFrame } from '../../../../shared/videoSceneIR'
import type { VideoExportCharacterSnapshot } from '../../../../shared/videoExportCharacters'
import { characterFromVideoExportSnapshot } from '../../../../shared/videoExportCharacters'
import type { VideoCharacterRenderAssetSnapshot } from '../../../../shared/videoCharacterRenderAssets'
import { createVideoCharacterRenderSnapshotProvider } from '../../../../shared/videoCharacterRenderAssets'
import { TransitionRenderer } from './transitionRenderer'

export class VideoCharacterFrameRenderer {
  private readonly transitionRenderer: TransitionRenderer
  private readonly cache = new Map<string, Promise<VideoCharacterState>>()

  constructor(
    private readonly characters: VideoExportCharacterSnapshot,
    characterAssets: VideoCharacterRenderAssetSnapshot,
  ) {
    this.transitionRenderer = new TransitionRenderer(createVideoCharacterRenderSnapshotProvider(characterAssets))
  }

  private transitionKey(frame: VideoSceneFrame, elementId: string, startFrame: number, boundaryFrame: number): string {
    return `${frame.variant}:${elementId}:${startFrame}:${boundaryFrame}:${frame.frame}`
  }

  private renderTransition(
    frame: VideoSceneFrame,
    character: VideoSceneFrame['characters'][number],
  ): Promise<VideoCharacterState> {
    const transition = character.transition
    if (!transition) throw new Error('Transição ausente no frame solicitado.')
    const key = this.transitionKey(frame, character.elementId, transition.startFrame, transition.boundaryFrame)
    let pending = this.cache.get(key)
    if (!pending) {
      const source = characterFromVideoExportSnapshot(this.characters, transition.from.element.characterId ?? '')
      pending = this.transitionRenderer.render({
        elementId: character.elementId,
        startFrame: transition.startFrame,
        boundaryFrame: transition.boundaryFrame,
        from: transition.from,
        to: transition.to,
      }, frame.frame, source)
      this.cache.set(key, pending)
      void pending.catch(() => this.cache.delete(key))
      while (this.cache.size > 240) this.cache.delete(this.cache.keys().next().value!)
    }
    return pending
  }

  /**
   * Resolve pixel-ready character states for one absolute frame. Static authored
   * states are reused directly; interpolated states use the exact preview renderer.
   * Automatic mouth/blink deliberately fail until their preview recipes are
   * extracted, preventing a subtly wrong export from being published.
   */
  async renderFrame(frame: VideoSceneFrame): Promise<ReadonlyMap<string, VideoCharacterState>> {
    const states = new Map<string, VideoCharacterState>()
    for (const character of frame.characters) {
      if (character.hidden) continue
      if (character.transition) {
        states.set(character.elementId, await this.renderTransition(frame, character))
        continue
      }
      if (character.automaticMouth) {
        throw new Error(`O frame ${frame.frame} exige animação automática de boca ainda não extraída para o export canônico.`)
      }
      if (character.automaticBlink) {
        throw new Error(`O frame ${frame.frame} exige piscada automática ainda não extraída para o export canônico.`)
      }
      if (character.authoredState) states.set(character.elementId, character.authoredState)
    }
    return states
  }

  clear(): void {
    this.cache.clear()
  }
}
