import type { CharacterGarmentAdjustment, WardrobeComponent, WardrobeSet } from '../../../../shared/fabricator'

export const garmentKey = (set: WardrobeSet, component: WardrobeComponent): string => set.id + ':' + component.id

export const garmentSlot = (component: WardrobeComponent): string =>
  component.category === 'calca-coxa' || component.category === 'calca-canela'
    ? 'calca'
    : component.category + ':' + component.attachedPartId

export function equippedGarments(sets: WardrobeSet[], equipped: Record<string, string>): Array<{ set: WardrobeSet; component: WardrobeComponent; key: string }> {
  const result: Array<{ set: WardrobeSet; component: WardrobeComponent; key: string }> = []
  for (const set of sets) for (const component of set.components) {
    const slot = garmentSlot(component)
    const selected = equipped[slot]
    if (selected === (slot === 'calca' ? set.id : garmentKey(set, component))) {
      result.push({ set, component, key: garmentKey(set, component) })
    }
  }
  return result
}

export const emptyAdjustment = (): CharacterGarmentAdjustment => ({ dx: 0, dy: 0, scaleX: 1, scaleY: 1, rotation: 0 })

/** All modifications are per-character; the original WardrobeSet never changes. */
export function adjustedGarment(component: WardrobeComponent, adjustment: CharacterGarmentAdjustment | undefined): WardrobeComponent {
  if (!adjustment) return component
  const width = component.width * adjustment.scaleX
  const height = component.height * adjustment.scaleY
  return {
    ...component,
    x: component.x + adjustment.dx + (component.width - width) / 2,
    y: component.y + adjustment.dy + (component.height - height) / 2,
    width,
    height,
    rotation: component.rotation + adjustment.rotation
  }
}
