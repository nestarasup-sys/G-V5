import type { CSSProperties, PointerEventHandler } from 'react'
import type { StudioElement } from '../../../../shared/studio'
import { videoCharacterElementSize, videoStageCssTransform } from '../../../../shared/videoStageGeometry'
import { matchingVideoVisualPlugin } from './videoVisualPluginRegistry'

export type VideoStudioDomElementProps = Readonly<{
  element: StudioElement
  imageDataUrl?: string
  assetName?: string
  speakerName?: string
  speakerColor?: string
  selected?: boolean
  interactive?: boolean
  onPointerDown?: PointerEventHandler<HTMLDivElement>
  onPointerMove?: PointerEventHandler<HTMLDivElement>
  onPointerUp?: PointerEventHandler<HTMLDivElement>
  onPointerCancel?: PointerEventHandler<HTMLDivElement>
}>

/** Exact DOM/CSS visual primitive used by the production preview and the parity oracle. */
export function VideoStudioDomElement({
  element,
  imageDataUrl,
  assetName,
  speakerName,
  speakerColor,
  selected = false,
  interactive = false,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: VideoStudioDomElementProps) {
  const plugin = matchingVideoVisualPlugin({ element, imageDataUrl })
  const extension = plugin?.renderDom?.({ element, imageDataUrl })
  if (extension) return <>{extension}</>

  const size = videoCharacterElementSize(element)
  const style: CSSProperties = {
    ...videoStageCssTransform(
      element.x,
      element.y,
      size.width,
      size.height,
      element.rotation,
      element.kind === 'character' && element.flipX === true,
    ),
    zIndex: Math.max(0, element.zIndex) + 2,
    ...(speakerName && speakerColor ? { '--speaker-color': speakerColor } as CSSProperties : {}),
  }
  return (
    <div
      className={`video-studio-canvas-element video-studio-element-${element.kind}${selected ? ' selected' : ''}`}
      style={style}
      onPointerDown={interactive ? onPointerDown : undefined}
      onPointerMove={interactive ? onPointerMove : undefined}
      onPointerUp={interactive ? onPointerUp : undefined}
      onPointerCancel={interactive ? onPointerCancel : undefined}
    >
      {(element.kind === 'image' || element.kind === 'character') && imageDataUrl
        ? <img src={imageDataUrl} alt={assetName ?? element.text} draggable={false} />
        : element.kind === 'speech' || element.kind === 'thought'
          ? <span>{speakerName && <strong className="video-studio-balloon-speaker">{speakerName}</strong>}<span className="video-studio-balloon-text">{element.text}</span></span>
          : <span>{element.text}</span>}
    </div>
  )
}
