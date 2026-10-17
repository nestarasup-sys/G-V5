export type HairErasePoint = { x: number; y: number }

/** Invert the preview rotation, mirroring, and zoom into original image pixels. */
export function hairErasePoint(client: HairErasePoint, center: HairErasePoint, rendered: { width: number; height: number }, image: { width: number; height: number }, rotation: number, flipX: boolean): HairErasePoint {
  const angle = rotation * Math.PI / 180
  const dx = client.x - center.x, dy = client.y - center.y
  return {
    x: image.width / 2 + (dx * Math.cos(angle) + dy * Math.sin(angle)) * (flipX ? -1 : 1) * image.width / rendered.width,
    y: image.height / 2 + (-dx * Math.sin(angle) + dy * Math.cos(angle)) * image.height / rendered.height
  }
}

export function eraseHairSegment(context: CanvasRenderingContext2D, from: HairErasePoint, to: HairErasePoint, radiusX: number, radiusY: number) {
  const distance = Math.hypot((to.x - from.x) / radiusX, (to.y - from.y) / radiusY)
  const steps = Math.max(1, Math.min(2048, Math.ceil(distance * 3)))
  context.save()
  context.globalCompositeOperation = 'destination-out'
  context.fillStyle = '#000'
  for (let index = 0; index <= steps; index++) {
    const t = index / steps
    context.beginPath()
    context.ellipse(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, radiusX, radiusY, 0, 0, Math.PI * 2)
    context.fill()
  }
  context.restore()
}
