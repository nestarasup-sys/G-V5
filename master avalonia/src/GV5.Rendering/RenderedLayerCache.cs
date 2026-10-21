using GV5.Core.Identity;

namespace GV5.Rendering;

public sealed record RenderedLayerCacheMetrics(long HitCount, long MissCount, long EvictionCount, long ResidentBytes, int EntryCount);

/// <summary>Byte-budgeted LRU cache for isolated, transparent raster layers.</summary>
internal sealed class RenderedLayerCache : IDisposable
{
    private readonly object _sync = new();
    private readonly Dictionary<LayerRasterSignature, Entry> _entries = [];
    private readonly LinkedList<Entry> _lru = [];
    private readonly long _maximumBytes;
    private long _residentBytes;
    private long _hitCount;
    private long _missCount;
    private long _evictionCount;
    private bool _disposed;

    public RenderedLayerCache(long maximumBytes)
    {
        if (maximumBytes < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maximumBytes));
        }

        _maximumBytes = maximumBytes;
    }

    public RenderedLayerCacheMetrics Metrics
    {
        get
        {
            lock (_sync)
            {
                return new RenderedLayerCacheMetrics(_hitCount, _missCount, _evictionCount, _residentBytes, _entries.Count);
            }
        }
    }

    public LayerFrameLease? TryAcquire(LayerRasterSignature signature)
    {
        lock (_sync)
        {
            if (_disposed || !_entries.TryGetValue(signature, out var entry))
            {
                _missCount++;
                return null;
            }

            _hitCount++;
            entry.LeaseCount++;
            _lru.Remove(entry.Node);
            entry.Node = _lru.AddFirst(entry);
            return new LayerFrameLease(this, entry);
        }
    }

    /// <summary>Accepts ownership of frame and returns a lease; oversized or uncacheable frames stay transient.</summary>
    public LayerFrameLease StoreOrLease(LayerRasterSignature signature, RenderedFrame frame)
    {
        ArgumentNullException.ThrowIfNull(frame);
        var byteLength = checked((long)frame.Bitmap.RowBytes * frame.Bitmap.Height);
        List<RenderedFrame>? evicted = null;
        lock (_sync)
        {
            if (_disposed || byteLength > _maximumBytes)
            {
                return LayerFrameLease.ForTransient(frame);
            }

            if (_entries.TryGetValue(signature, out var existing))
            {
                existing.LeaseCount++;
                _lru.Remove(existing.Node);
                existing.Node = _lru.AddFirst(existing);
                return DisposeDuplicateAndLease(frame, existing);
            }

            while (_residentBytes + byteLength > _maximumBytes)
            {
                var candidate = FindUnusedLeastRecent();
                if (candidate is null)
                {
                    return LayerFrameLease.ForTransient(frame);
                }

                _entries.Remove(candidate.Signature);
                _lru.Remove(candidate.Node);
                _residentBytes -= candidate.ByteLength;
                _evictionCount++;
                (evicted ??= []).Add(candidate.Frame);
            }

            var entry = new Entry(signature, frame, byteLength);
            entry.Node = _lru.AddFirst(entry);
            entry.LeaseCount = 1;
            _entries.Add(signature, entry);
            _residentBytes += byteLength;
            var result = new LayerFrameLease(this, entry);
            DisposeFrames(evicted);
            return result;
        }
    }

    public void Dispose()
    {
        List<RenderedFrame> dispose = [];
        lock (_sync)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            foreach (var entry in _entries.Values)
            {
                if (entry.LeaseCount == 0)
                {
                    dispose.Add(entry.Frame);
                }
                else
                {
                    entry.Retired = true;
                }
            }

            _entries.Clear();
            _lru.Clear();
            _residentBytes = 0;
        }

        DisposeFrames(dispose);
    }

    private Entry? FindUnusedLeastRecent()
    {
        for (var node = _lru.Last; node is not null; node = node.Previous)
        {
            if (node.Value.LeaseCount == 0)
            {
                return node.Value;
            }
        }

        return null;
    }

    private LayerFrameLease DisposeDuplicateAndLease(RenderedFrame duplicate, Entry existing)
    {
        duplicate.Dispose();
        return new LayerFrameLease(this, existing);
    }

    private void Release(Entry entry)
    {
        RenderedFrame? dispose = null;
        lock (_sync)
        {
            if (entry.LeaseCount <= 0)
            {
                throw new InvalidOperationException("A rendered layer cache lease was released more than once.");
            }

            entry.LeaseCount--;
            if (entry.LeaseCount == 0 && (_disposed || entry.Retired))
            {
                dispose = entry.Frame;
            }
        }

        dispose?.Dispose();
    }

    private static void DisposeFrames(IEnumerable<RenderedFrame>? frames)
    {
        if (frames is null)
        {
            return;
        }

        foreach (var frame in frames)
        {
            frame.Dispose();
        }
    }

    internal sealed class Entry(LayerRasterSignature signature, RenderedFrame frame, long byteLength)
    {
        public LayerRasterSignature Signature { get; } = signature;
        public RenderedFrame Frame { get; } = frame;
        public long ByteLength { get; } = byteLength;
        public LinkedListNode<Entry> Node { get; set; } = null!;
        public int LeaseCount { get; set; }
        public bool Retired { get; set; }
    }

    internal sealed class LayerFrameLease : IDisposable
    {
        private RenderedLayerCache? _owner;
        private Entry? _entry;
        private RenderedFrame? _transient;

        internal LayerFrameLease(RenderedLayerCache owner, Entry entry)
        {
            _owner = owner;
            _entry = entry;
        }

        private LayerFrameLease(RenderedFrame transient) => _transient = transient;

        public RenderedFrame Frame => _entry?.Frame ?? _transient ?? throw new ObjectDisposedException(nameof(LayerFrameLease));

        internal static LayerFrameLease ForTransient(RenderedFrame frame) => new(frame);

        public void Dispose()
        {
            var entry = Interlocked.Exchange(ref _entry, null);
            var owner = Interlocked.Exchange(ref _owner, null);
            if (entry is not null && owner is not null)
            {
                owner.Release(entry);
            }

            Interlocked.Exchange(ref _transient, null)?.Dispose();
        }
    }
}

/// <summary>Pixel-exact signature of the isolated raster; blend and z-order are applied later during composition.</summary>
internal readonly record struct LayerRasterSignature(
    int Width,
    int Height,
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
    long Alpha)
{
    public static LayerRasterSignature Create(RenderScene scene, RenderLayer layer)
    {
        var transform = layer.Transform;
        return new LayerRasterSignature(
            scene.Width,
            scene.Height,
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
            Bits(layer.Alpha));
    }

    private static long Bits(double value) => BitConverter.DoubleToInt64Bits(value);
}
