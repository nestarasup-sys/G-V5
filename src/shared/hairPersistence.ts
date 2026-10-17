import type { HairTransform, HairWorkspaceSave } from './fabricator'

export const emptyHairTransform = (): HairTransform => ({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 })

/** Empty slots have no image dimensions and must not carry a fitted image scale. */
export function normalizeHairTransforms(value: Pick<HairWorkspaceSave, 'front' | 'back' | 'fringe' | 'transforms'>): Required<HairWorkspaceSave['transforms']> {
  const transformFor = (side: 'front' | 'back' | 'fringe'): HairTransform => {
    if (!value[side]) return emptyHairTransform()
    const transform = value.transforms[side]
    if (!transform) throw new Error('O encaixe da peça de cabelo está ausente. A edição foi mantida para recuperação.')
    return { ...transform }
  }
  return { front: transformFor('front'), back: transformFor('back'), fringe: transformFor('fringe') }
}
