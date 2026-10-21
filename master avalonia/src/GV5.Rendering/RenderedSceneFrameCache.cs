using GV5.Core.Identity;
using SkiaSharp;

namespace GV5.Rendering;

public sealed record RenderedSceneCacheMetrics(long HitCount, long MissCount, long EvictionCount, long ResidentBytes, int EntryCount);

/// <summary>Single-frame, byte-bounded cache used as the baseline for exact dirty-region rendering.</summary>
internal sealed class RenderedSceneFrameCache : IDisposable
{
    private readonly object _sync = new();
    private readonly long _maximumBytes;
    private CachedScene? _cached;
    private long _hitCount;
    private long _missCount;
    private long _evictionCount;
    private bool _disposed;

    public RenderedSceneFrameCache(long maximumBytes)
    {
        if (maximumBytes < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maximumBytes));
        }

        _maximumBytes = maximumBytes;
    }

    public RenderedSceneCacheMetrics Metrics
    {
        get
        {
            lock (_sync)
            {
                return new RenderedSceneCacheMetrics(_hitCount, _missCount, _evictionCount, _cached?.ByteLength ?? 0, _cached is null ? 0 : 1);
            }
        }
    }

    public CachedScene? Current
    {
        get
        {
            lock (_sync)
            {
                return _disposed ? null : _cached;
            }
        }
    }

    public void RecordHit()
    {
        lock (_sync)
        {
            _hitCount++;
        }
    }

    public void RecordMiss()
    {
        lock (_sync)
        {
            _missCount++;
        }
    }

    public void UpdateScene(RenderScene scene)
    {
        ArgumentNullException.ThrowIfNull(scene);
        lock (_sync)
        {
            if (_disposed || _cached is null)
            {
                throw new InvalidOperationException("Cannot update the scene metadata without a cached frame.");
            }

            _cached = _cached with { Scene = scene };
        }
    }

    public void Invalidate()
    {
        RenderedFrame? dispose;
        lock (_sync)
        {
            dispose = _cached?.Frame;
            _cached = null;
            if (dispose is not null)
            {
                _evictionCount++;
            }
        }

        dispose?.Dispose();
    }

    /// <summary>Accepts ownership of a full scene frame when it fits the byte budget.</summary>
    public void Replace(RenderScene scene, RenderedFrame frame)
    {
        ArgumentNullException.ThrowIfNull(scene);
        ArgumentNullException.ThrowIfNull(frame);
        var byteLength = checked((long)frame.Bitmap.RowBytes * frame.Bitmap.Height);
        RenderedFrame? previous = null;
        lock (_sync)
        {
            if (_disposed)
            {
                previous = frame;
            }
            else if (byteLength > _maximumBytes)
            {
                previous = frame;
                if (_cached is not null)
                {
                    _cached.Frame.Dispose();
                    _cached = null;
                    _evictionCount++;
                }
            }
            else
            {
                if (_cached is not null)
                {
                    _cached.Frame.Dispose();
                    _evictionCount++;
                }

                _cached = new CachedScene(scene, frame, byteLength);
            }
        }

        previous?.Dispose();
    }

    public void Dispose()
    {
        RenderedFrame? dispose;
        lock (_sync)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            dispose = _cached?.Frame;
            _cached = null;
        }

        dispose?.Dispose();
    }

    internal sealed record CachedScene(RenderScene Scene, RenderedFrame Frame, long ByteLength);
}

/// <summary>All scene dimensions and layer inputs that determine a rendered layer's output.</summary>
internal readonly record struct LayerRasterSignature(
    RenderLayerId LayerId,
    AssetId AssetId,
    long CropX,
    long CropY,
    long CropWidth,
    long CropHeight,
    long TranslationX,
    long TranslationY,
    long ScaleX,
    long ScaleY,
    long RotationRadians,
    long PivotX,
    long PivotY,
    bool FlipX,
    bool FlipY,
    long Alpha,
    RenderBlendMode BlendMode,
    int ZOrder)
{
    public static LayerRasterSignature Create(RenderLayer layer)
    {
        var transform = layer.Transform;
        return new LayerRasterSignature(
            layer.Id,
            layer.AssetId,
            Bits(layer.Crop.X),
            Bits(layer.Crop.Y),
            Bits(layer.Crop.Width),
            Bits(layer.Crop.Height),
            Bits(transform.Translation.X),
            Bits(transform.Translation.Y),
            Bits(transform.Scale.X),
            Bits(transform.Scale.Y),
            Bits(transform.RotationRadians),
            Bits(transform.Pivot.X),
            Bits(transform.Pivot.Y),
            transform.FlipX,
            transform.FlipY,
            Bits(layer.Alpha),
            layer.BlendMode,
            layer.ZOrder);
    }

    private static long Bits(double value) => BitConverter.DoubleToInt64Bits(value);
}

internal static class LayerDirtyRegionCalculator
{
    public static IReadOnlyList<SKRect> Calculate(RenderScene previous, RenderScene current, SkiaRenderer renderer)
    {
        if (previous.Width != current.Width || previous.Height != current.Height)
        {
            return [SKRect.Create(0, 0, current.Width, current.Height)];
        }

        var oldLayers = previous.Layers.Select((layer, index) => new LayerSnapshot(layer, index)).ToDictionary(item => item.Layer.Id);
        var newLayers = current.Layers.Select((layer, index) => new LayerSnapshot(layer, index)).ToDictionary(item => item.Layer.Id);
        var changed = new HashSet<RenderLayerId>();
        foreach (var (id, oldSnapshot) in oldLayers)
        {
            if (!newLayers.TryGetValue(id, out var newSnapshot)
                || oldSnapshot.Index != newSnapshot.Index
                || LayerRasterSignature.Create(oldSnapshot.Layer) != LayerRasterSignature.Create(newSnapshot.Layer))
            {
                changed.Add(id);
            }
        }

        foreach (var id in newLayers.Keys)
        {
            if (!oldLayers.ContainsKey(id))
            {
                changed.Add(id);
            }
        }

        var regions = new List<SKRect>();
        foreach (var id in changed)
        {
            if (oldLayers.TryGetValue(id, out var oldSnapshot))
            {
                AddRegion(renderer.GetLayerCullRect(oldSnapshot.Layer, current.Width, current.Height));
            }

            if (newLayers.TryGetValue(id, out var newSnapshot))
            {
                AddRegion(renderer.GetLayerCullRect(newSnapshot.Layer, current.Width, current.Height));
            }
        }

        return regions;

        void AddRegion(SKRect? candidate)
        {
            if (candidate is not { } region)
            {
                return;
            }

            for (var index = 0; index < regions.Count; index++)
            {
                if (!Touches(regions[index], region))
                {
                    continue;
                }

                region = Union(regions[index], region);
                regions.RemoveAt(index--);
            }

            regions.Add(region);
        }
    }

    private static bool Touches(SKRect left, SKRect right) =>
        left.Left <= right.Right && left.Right >= right.Left && left.Top <= right.Bottom && left.Bottom >= right.Top;

    private static SKRect Union(SKRect left, SKRect right) => SKRect.Create(
        Math.Min(left.Left, right.Left),
        Math.Min(left.Top, right.Top),
        Math.Max(left.Right, right.Right) - Math.Min(left.Left, right.Left),
        Math.Max(left.Bottom, right.Bottom) - Math.Min(left.Top, right.Top));

    private sealed record LayerSnapshot(RenderLayer Layer, int Index);
}
