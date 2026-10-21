using SkiaSharp;
using GV5.Core.Identity;

namespace GV5.Rendering;

/// <summary>Reuses unchanged isolated layer rasters, then composes a complete frame in the canonical layer order.</summary>
public sealed class IncrementalSkiaRenderer : IRenderSceneRenderer, IDisposable
{
    public const long DefaultLayerCacheBytes = 128L * 1024 * 1024;

    private readonly SkiaRenderer _layerRenderer;
    private readonly SkiaRendererLimits _limits;
    private readonly RenderedLayerCache _cache;
    private readonly long _maximumCachedLayerBytes;
    private int _disposed;

    public IncrementalSkiaRenderer(
        IRenderAssetProvider assets,
        SkiaRendererLimits? limits = null,
        long maximumCachedLayerBytes = DefaultLayerCacheBytes)
    {
        ArgumentNullException.ThrowIfNull(assets);
        _limits = limits ?? new SkiaRendererLimits();
        if (maximumCachedLayerBytes < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maximumCachedLayerBytes));
        }

        _maximumCachedLayerBytes = maximumCachedLayerBytes;
        _layerRenderer = new SkiaRenderer(assets, _limits);
        _cache = new RenderedLayerCache(maximumCachedLayerBytes);
    }

    public RenderedLayerCacheMetrics CacheMetrics => _cache.Metrics;
    public long MaximumCachedLayerBytes => _maximumCachedLayerBytes;

    public Task<RenderedFrame> RenderAsync(RenderScene scene, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(scene);
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        ValidateDimensions(scene.Width, scene.Height);
        cancellationToken.ThrowIfCancellationRequested();
        return Task.Run(() => RenderCoreAsync(scene, cancellationToken), cancellationToken);
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 0)
        {
            _cache.Dispose();
        }
    }

    private async Task<RenderedFrame> RenderCoreAsync(RenderScene scene, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var info = new SKImageInfo(scene.Width, scene.Height, SKColorType.Rgba8888, SKAlphaType.Premul);
        using var surface = SKSurface.Create(info) ?? throw new InvalidOperationException("Skia could not create an incremental raster surface.");
        var canvas = surface.Canvas;
        canvas.Clear(SKColors.Transparent);

        foreach (var layer in scene.Layers)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var signature = LayerRasterSignature.Create(scene, layer);
            var cached = _cache.TryAcquire(signature);
            if (cached is null)
            {
                var rasterLayer = new RenderLayer(
                    layer.Id,
                    layer.AssetId,
                    layer.Crop,
                    layer.Transform,
                    layer.Alpha,
                    RenderBlendMode.Normal,
                    zOrder: 0);
                var isolatedScene = new RenderScene(SceneId.New(), scene.Width, scene.Height, [rasterLayer]);
                var isolatedFrame = await _layerRenderer.RenderAsync(isolatedScene, cancellationToken).ConfigureAwait(false);
                cached = _cache.StoreOrLease(signature, isolatedFrame);
            }

            using (cached)
            using (var paint = new SKPaint
            {
                Color = SKColors.White,
                BlendMode = SkiaRenderer.ToSkiaBlendMode(layer.BlendMode),
                IsAntialias = false
            })
            {
                canvas.DrawBitmap(cached.Frame.Bitmap, 0, 0, paint);
            }
        }

        cancellationToken.ThrowIfCancellationRequested();
        using var snapshot = surface.Snapshot();
        var bitmap = SKBitmap.FromImage(snapshot) ?? throw new InvalidOperationException("Skia could not copy the incremental raster surface.");
        try
        {
            return new RenderedFrame(bitmap);
        }
        catch
        {
            bitmap.Dispose();
            throw;
        }
    }

    private void ValidateDimensions(int width, int height)
    {
        if (width > _limits.MaximumDimension || height > _limits.MaximumDimension || (long)width * height > _limits.MaximumPixels)
        {
            throw new ArgumentOutOfRangeException(nameof(width), "Render target exceeds the configured dimension or pixel budget.");
        }
    }
}
