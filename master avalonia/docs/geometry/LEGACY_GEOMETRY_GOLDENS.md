# Geometry: golden cases from the Electron implementation

These synthetic cases make the static comparison against `src/renderer/src/features/fabricator/wardrobe/poseTransform.ts` reproducible. No app-data or user assets are involved. The Electron source remains unchanged.

## Wardrobe binding equations

Legacy `bindWardrobeComponent` (lines 17–36) stores garment-center displacement in the source bone's local frame, normalized independently by bone width and height:

```text
localX = rotate(garmentCenter - boneCenter, -sourceRotation).x / boneWidth
localY = rotate(garmentCenter - boneCenter, -sourceRotation).y / boneHeight
widthRatio = garmentWidth / boneWidth
heightRatio = garmentHeight / boneHeight
relativeRotation = garmentRotation - sourceRotation
```

Legacy `mapBoundWardrobeComponentToPose` (lines 149–171) scales the normalized offset and size to the posed bone and rotates the offset by the pose bone's angle. The Avalonia-independent `WardrobeBinding` and `WardrobeBindingMath` use these same equations and add explicit flip handling for synthetic mirrored cases.

## Fixtures

| Fixture | Source bone | Source garment | Target bone | Expected binding / placement |
| --- | --- | --- | --- | --- |
| Neutral | `torso`, `(100,50,200,100)`, `0°` | `(140,60,50,20)`, `5°` | Same as source | Bounds preserved; width ratio `0.25`, height ratio `0.2`, relative angle `5°` |
| Rotated + non-uniform | `arm`, `(100,50,200,100)`, `30°` | `80×25`, center at source center + rotate `(20,20)` by `30°`, angle `45°` | `arm`, `(20,30,300,120)`, `-20°` | Local center `(0.1,0.2)`, ratios `(0.4,0.25)`, relative angle `15°`; output size `120×30`, angle `-5°`, offset from target center is rotate `(30,24)` by `-20°` |
| Mirrored X | `leg`, `(100,50,200,100)`, `0°` | `(140,60,50,20)`, `30°` | Same bounds, `FlipX=true` | Center offset `(-35,-30)` becomes `(35,-30)`; output bounds `(210,60,50,20)`, angle `150°`, horizontal flip retained |

## Matrix precision checks

The `GV5.Geometry.Tests` suite tests inverse round-trips across fixed points, small/large non-uniform scales, translations and positive/negative rotations. Comparisons use explicit decimal precision because affine inversion is floating-point math. Repeated snapping and transform evaluation also use deterministic inputs and tie rules.

These goldens verify formulas and synthetic outputs only. They do not claim runtime or visual parity; UI-level comparison still requires real reference captures under `docs/ui-fidelity/`.
