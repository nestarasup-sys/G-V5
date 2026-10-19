import type { FabricatorProject, ModelPart, WardrobeCategory } from '../../../../../shared/fabricator'

type Point = { x: number; y: number }
export type WardrobeBoneSelection = {
  bone: ModelPart | null
  confidence: 'estimated' | 'missing'
  reason: string
}

function referenceCenter(part: ModelPart): Point {
  const frame = part.sourceTransform
  const x = frame?.x ?? part.x
  const y = frame?.y ?? part.y
  const width = frame?.width ?? part.width
  const height = frame?.height ?? part.height
  return { x: x + width / 2, y: y + height / 2 }
}

/**
 * Initial placement is an ESTIMATE ONLY. Explicit manual bindings always win
 * after the wardrobe designer selects/corrects the target bone. Never silently
 * bind a missing side/head to the first (potentially unrelated) model part.
 */
export function suggestWardrobeBone(
  category: WardrobeCategory, componentCenterX: number, sheetWidth: number,
  model: Pick<FabricatorProject, 'width' | 'height' | 'parts'>
): WardrobeBoneSelection {
  if (!Number.isFinite(componentCenterX) || !Number.isFinite(sheetWidth)
    || sheetWidth <= 0 || model.width <= 0 || model.height <= 0) {
    return { bone: null, confidence: 'missing', reason: 'invalid-reference-size' }
  }
  const side = componentCenterX < sheetWidth / 2 ? 'left' : 'right'
  const centerCategory = ['camisa', 'jaqueta', 'capa', 'cinto', 'oculos', 'acessorio-cabeca', 'saia'].includes(category)
  const target = category === 'capa' ? { x: .5, y: .31 }
    : category === 'oculos' || category === 'acessorio-cabeca' ? { x: .5, y: .2 }
      : category === 'cinto' || category === 'saia' ? { x: .5, y: .49 }
        : category === 'camisa' || category === 'jaqueta' ? { x: .5, y: .36 }
          : category === 'shorts' ? { x: side === 'left' ? .42 : .58, y: .42 }
            : category === 'meia' ? { x: side === 'left' ? .43 : .57, y: .83 }
              : category === 'sapato' ? { x: side === 'left' ? .43 : .57, y: .94 }
                : category === 'manga-superior' ? { x: side === 'left' ? .27 : .73, y: .27 }
                  : category === 'manga-inferior' ? { x: side === 'left' ? .22 : .78, y: .45 }
                    : category === 'luvas' ? { x: side === 'left' ? .21 : .79, y: .49 }
                      : category === 'calca-coxa' ? { x: side === 'left' ? .42 : .58, y: .58 }
                        : { x: side === 'left' ? .38 : .62, y: .82 }
  const candidates = model.parts.filter((part) => {
    const label = `${part.name} ${part.id}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    if (category === 'sapato' && !/canela|shin|calf|lower[ _-]*leg|perna[ _-]*inferior|(?:^|\s)leg[-_](?:left|right)(?:$|\s)/.test(label)) return false
    if (category === 'luvas' && !/antebraco|forearm|braco[ _-]*inferior|lower[ _-]*arm/.test(label)) return false
    const center = referenceCenter(part)
    const x = center.x / model.width
    if (!Number.isFinite(x)) return false
    return centerCategory ? x > .3 && x < .7 : side === 'left' ? x < .5 : x >= .5
  })
  if (!candidates.length) return { bone: null, confidence: 'missing', reason: 'no-bone-in-requested-zone' }
  const scored = candidates.map((part) => {
    const center = referenceCenter(part)
    const dx = center.x / model.width - target.x
    const dy = center.y / model.height - target.y
    const name = part.name.toLowerCase()
    // Head and feet are semantically identifiable; head accessories should
    // never attach to a torso only because it happens to be nearby.
    const headCategory = category === 'oculos' || category === 'acessorio-cabeca'
    const isHead = /cabeça|cabeca|head/.test(name)
    const semanticPenalty = headCategory && !isHead ? 100 : 0
    return { part, score: dx * dx + dy * dy * 1.5 + semanticPenalty }
  }).sort((a, b) => a.score - b.score)
  if ((category === 'oculos' || category === 'acessorio-cabeca') && scored[0].score >= 100) {
    return { bone: null, confidence: 'missing', reason: 'head-bone-not-found' }
  }
  // A matching half of the sheet is not enough: the torso can otherwise
  // become a "right shoe" when the right leg is missing. Fail closed and ask
  // the author to choose a bone rather than silently corrupt the pre-fit.
  const maxNormalizedDistanceSquared = 0.20
  if (scored[0].score > maxNormalizedDistanceSquared) {
    return { bone: null, confidence: 'missing', reason: 'bone-too-far-from-garment-zone' }
  }
  return { bone: scored[0].part, confidence: 'estimated', reason: 'source-sheet-position' }
}
