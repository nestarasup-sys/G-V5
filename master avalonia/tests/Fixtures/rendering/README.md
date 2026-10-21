# Synthetic rendering fixture

`synthetic-garment.png` is a 12×16 RGBA pixel-art test asset containing a small garment-shaped silhouette, three solid fill colors and one outline color. Its design is synthetic and exists only to exercise transparent raster decoding and render placement; it is not a Gacha 5 asset or a visual-parity reference.

`synthetic-garment.golden.png` is a 32×32 transparent expected render with the source composited without scaling at scene translation `(10, 8)` in the renderer's canonical Y-up coordinates. The rendering test compares every output pixel against this checked-in golden. Any intentional golden update must include the reason and independently review source alpha, silhouette bounds, placement and unchanged transparent pixels.

`multi-layer.golden.png` is a separate 32×32 oracle for two overlapping 2×2 layers (normal source-over, horizontal flip and 50% opacity) plus a cropped left column transformed by vertical flip and a 90° rotation at 75% opacity. It was composed from explicit expected pixel coordinates and RGBA values, not by calling `SkiaRenderer`. The test also writes `TestResults/Rendering/multi-layer-comparison.png` beside the test assembly: expected, actual and amplified pixel differences from left to right.
