using SkiaSharp;

namespace GV5.Rendering;

/// <summary>Reuses the previous composed frame and redraws only regions touched by changed layer signatures.</summary>
public sealed class IncrementalSkiaRenderer : IRenderSceneRenderer, IDisposable
{
    public const long DefaultSceneFrameCacheBytes = 128L * 1024 * 1024;
    private const double FullRenderAreaThreshold = 0.6;

    private readonly IRenderAssetProvider _assets;
    private readonly SkiaRenderer _fullRenderer;
    private readonly SkiaRendererLimits _limits;
    private readonly RenderedSceneFrameCache _cache;
    private readonly SemaphoreSlim _renderGate = new(1, 1);
    private readonly long _maximumCachedFrameBytes;
    private int _disposed;

    public IncrementalSkiaRenderer(
        IRenderAssetProvider assets,
        SkiaRendererLimits? limits = null,
        long maximumCachedFrameBytes = DefaultSceneFrameCacheBytes)
    {
        ArgumentNullException.ThrowIfNull(assets);
        _assets = assets;
        _limits = limits ?? new SkiaRendererLimits();
        if (maximumCachedFrameBytes < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maximumCachedFrameBytes));
        }

        _maximumCachedFrameBytes = maximumCachedFrameBytes;
        _fullRenderer = new SkiaRenderer(assets, _limits);
        _cache = new RenderedSceneFrameCache(maximumCachedFrameBytes);
    }

    public RenderedSceneCacheMetrics CacheMetrics => _cache.Metrics;
    public long MaximumCachedFrameBytes => _maximumCachedFrameBytes;

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
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        _renderGate.Wait();
        try
        {
            _cache.Dispose();
        }
        finally
        {
            _renderGate.Release();
        }
    }

    private async Task<RenderedFrame> RenderCoreAsync(RenderScene scene, CancellationToken cancellationToken)
    {
        await _renderGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
            cancellationToken.ThrowIfCancellationRequested();
            var cached = _cache.Current;
            if (cached is not null)
            {
                var dirtyRegions = LayerDirtyRegionCalculator.Calculate(cached.Scene, scene, _fullRenderer);
                if (dirtyRegions.Count == 0)
                {
                    _cache.RecordHit();
                    return CloneFrame(cached.Frame);
                }

                _cache.RecordMiss();
                var dirtyArea = dirtyRegions.Sum(region => (double)region.Width * region.Height);
                var totalArea = (double)scene.Width * scene.Height;
                if (dirtyArea <= totalArea * FullRenderAreaThreshold)
                {
                    try
                    {
                        await RenderDirtyRegionsAsync(scene, cached.Frame, dirtyRegions, cancellationToken).ConfigureAwait(false);
                        cancellationToken.ThrowIfCancellationRequested();
                        _cache.UpdateScene(scene);
                        return CloneFrame(cached.Frame);
                    }
                    catch
                    {
                        // A canceled/failed in-place redraw cannot be used as the baseline for another update.
                        _cache.Invalidate();
                        throw;
                    }
                }

                var fullFrame = await _fullRenderer.RenderAsync(scene, cancellationToken).ConfigureAwait(false);
                _cache.Replace(scene, CloneFrame(fullFrame));
                return fullFrame;
            }

            _cache.RecordMiss();
            var firstFrame = await _fullRenderer.RenderAsync(scene, cancellationToken).ConfigureAwait(false);
            _cache.Replace(scene, CloneFrame(firstFrame));
            return firstFrame;
        }
        finally
        {
            _renderGate.Release();
        }
    }

    private async Task RenderDirtyRegionsAsync(
        RenderScene scene,
        RenderedFrame previousFrame,
        IReadOnlyList<SKRect> dirtyRegions,
        CancellationToken cancellationToken)
    {
        using var canvas = new SKCanvas(previousFrame.Bitmap);

        foreach (var dirtyRegion in dirtyRegions)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var saveCount = canvas.Save();
            try
            {
                canvas.ClipRect(dirtyRegion, SKClipOperation.Intersect, antialias: false);
                canvas.Clear(SKColors.Transparent);
                foreach (var layer in scene.Layers)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    if (layer.Alpha == 0)
                    {
                        continue;
                    }

                    var bounds = _fullRenderer.GetLayerCullRect(layer, scene.Width, scene.Height);
                    if (bounds is null || !Intersects(bounds.Value, dirtyRegion))
                    {
                        continue;
                    }

                    using var lease = await _assets.AcquireAsync(layer.AssetId, cancellationToken).ConfigureAwait(false);
                    SkiaRenderer.DrawLayer(canvas, layer, lease.Bitmap, scene.Height);
                }
            }
            finally
            {
                canvas.RestoreToCount(saveCount);
            }
        }

        cancellationToken.ThrowIfCancellationRequested();
        canvas.Flush();
    }

    private void ValidateDimensions(int width, int height)
    {
        if (width > _limits.MaximumDimension || height > _limits.MaximumDimension || (long)width * height > _limits.MaximumPixels)
        {
            throw new ArgumentOutOfRangeException(nameof(width), "Render target exceeds the configured dimension or pixel budget.");
        }
    }

    private static RenderedFrame CloneFrame(RenderedFrame source)
    {
        var copy = source.Bitmap.Copy() ?? throw new InvalidOperationException("Skia could not clone the cached scene frame.");
        return new RenderedFrame(copy);
    }

    private static bool Intersects(SKRect left, SKRect right) =>
        left.Left < right.Right && left.Right > right.Left && left.Top < right.Bottom && left.Bottom > right.Top;
}
