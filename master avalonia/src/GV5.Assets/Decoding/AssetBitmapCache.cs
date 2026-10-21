using SkiaSharp;

namespace GV5.Assets.Decoding;

public readonly record struct AssetImageCacheKey
{
    public string ContentHash { get; }
    public int DecoderVersion { get; }

    private AssetImageCacheKey(string contentHash, int decoderVersion)
    {
        ContentHash = contentHash;
        DecoderVersion = decoderVersion;
    }

    public static AssetImageCacheKey Create(string contentHash, int decoderVersion)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(contentHash);
        if (contentHash.Length != 64 || contentHash.Any(character => character is not (>= '0' and <= '9' or >= 'a' and <= 'f')))
        {
            throw new ArgumentException("An asset cache key requires a lowercase SHA-256 content hash.", nameof(contentHash));
        }

        if (decoderVersion < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(decoderVersion), "Decoder version must be positive.");
        }

        return new AssetImageCacheKey(contentHash, decoderVersion);
    }
}

public enum AssetImageCacheErrorCode
{
    DecoderFailure = 1,
    CacheDisposed = 2
}

public sealed record AssetImageCacheError(AssetImageCacheErrorCode Code, string Message, AssetImageDecodeError? DecodeError = null);

public sealed class AssetImageCacheResult
{
    private AssetImageCacheResult(AssetImageLease? lease, AssetImageCacheError? error)
    {
        Lease = lease;
        Error = error;
    }

    public bool IsSuccess => Lease is not null;
    public bool IsFailure => !IsSuccess;
    public AssetImageLease? Lease { get; }
    public AssetImageCacheError? Error { get; }

    internal static AssetImageCacheResult Success(AssetImageLease lease) => new(lease, null);
    internal static AssetImageCacheResult Failure(AssetImageCacheError error) => new(null, error);
}

public sealed record AssetImageCacheMetrics(
    long HitCount,
    long MissCount,
    long EvictionCount,
    long BypassCount,
    long ResidentBytes,
    int EntryCount,
    int ActiveLeaseCount);

/// <summary>A use lease that keeps a bitmap alive until its owner finishes drawing or processing it.</summary>
public sealed class AssetImageLease : IDisposable
{
    private readonly Action _release;
    private readonly DecodedAssetImage _image;
    private int _disposed;

    internal AssetImageLease(DecodedAssetImage image, Action release)
    {
        _image = image;
        _release = release;
    }

    public DecodedAssetImage Image
    {
        get
        {
            ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
            return _image;
        }
    }

    public SKBitmap Bitmap => Image.Bitmap;

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 0)
        {
            _release();
        }
    }
}

/// <summary>Byte-budgeted LRU for decoded images. Entries with active leases are never evicted or disposed.</summary>
public sealed class AssetBitmapCache : IDisposable
{
    public const long DefaultMaximumBytes = 512L * 1024 * 1024;

    private readonly object _sync = new();
    private readonly object _gateSync = new();
    private readonly Dictionary<AssetImageCacheKey, CacheEntry> _entries = [];
    private readonly HashSet<CacheEntry> _retiredEntries = [];
    private readonly LinkedList<CacheEntry> _lru = [];
    private readonly Dictionary<AssetImageCacheKey, KeyGate> _keyGates = [];
    private readonly long _maximumBytes;
    private long _residentBytes;
    private long _hitCount;
    private long _missCount;
    private long _evictionCount;
    private long _bypassCount;
    private bool _disposed;

    public AssetBitmapCache(long maximumBytes = DefaultMaximumBytes)
    {
        if (maximumBytes < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(maximumBytes), "The cache budget must be positive.");
        }

        _maximumBytes = maximumBytes;
    }

    public AssetImageCacheMetrics Metrics
    {
        get
        {
            lock (_sync)
            {
                return new AssetImageCacheMetrics(
                    _hitCount,
                    _missCount,
                    _evictionCount,
                    _bypassCount,
                    _residentBytes,
                    _entries.Count,
                    _entries.Values.Sum(entry => entry.LeaseCount) + _retiredEntries.Sum(entry => entry.LeaseCount));
            }
        }
    }

    public async Task<AssetImageCacheResult> AcquireAsync(
        AssetImageCacheKey key,
        Func<CancellationToken, Task<AssetImageDecodeResult>> decode,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(decode);
        using var keyGate = await EnterKeyGateAsync(key, cancellationToken).ConfigureAwait(false);

        lock (_sync)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_entries.TryGetValue(key, out var existing))
            {
                existing.LeaseCount++;
                MoveToFront(existing);
                _hitCount++;
                return AssetImageCacheResult.Success(new AssetImageLease(existing.Image, () => ReleaseLease(existing)));
            }

            _missCount++;
        }

        var decoded = await decode(cancellationToken).ConfigureAwait(false);
        if (cancellationToken.IsCancellationRequested)
        {
            decoded.Image?.Dispose();
            cancellationToken.ThrowIfCancellationRequested();
        }
        if (decoded.IsFailure)
        {
            return AssetImageCacheResult.Failure(new AssetImageCacheError(
                AssetImageCacheErrorCode.DecoderFailure,
                "The image could not be added to the decoded bitmap cache.",
                decoded.Error));
        }

        var image = decoded.Image!;
        var bytes = (long)image.Bitmap.RowBytes * image.Height;
        lock (_sync)
        {
            if (_disposed)
            {
                image.Dispose();
                return AssetImageCacheResult.Failure(new AssetImageCacheError(
                    AssetImageCacheErrorCode.CacheDisposed,
                    "The image cache has been disposed."));
            }

            if (bytes > _maximumBytes || !EvictUntilFits(bytes))
            {
                _bypassCount++;
                return AssetImageCacheResult.Success(new AssetImageLease(image, image.Dispose));
            }

            var entry = new CacheEntry(key, image, bytes) { LeaseCount = 1 };
            entry.Node = _lru.AddFirst(entry);
            _entries.Add(key, entry);
            _residentBytes += bytes;
            return AssetImageCacheResult.Success(new AssetImageLease(image, () => ReleaseLease(entry)));
        }
    }

    public void Dispose()
    {
        lock (_sync)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            _lru.Clear();
            foreach (var entry in _entries.Values.ToArray())
            {
                entry.Node = null;
                entry.Retired = true;
                if (entry.LeaseCount == 0)
                {
                    entry.Image.Dispose();
                    _residentBytes -= entry.ByteLength;
                }
                else
                {
                    _retiredEntries.Add(entry);
                }
            }

            _entries.Clear();
        }
    }

    private bool EvictUntilFits(long incomingBytes)
    {
        var reclaimableBytes = _entries.Values
            .Where(entry => entry.LeaseCount == 0)
            .Sum(entry => entry.ByteLength);
        if (_residentBytes - reclaimableBytes + incomingBytes > _maximumBytes)
        {
            return false;
        }

        while (_residentBytes + incomingBytes > _maximumBytes)
        {
            var node = _lru.Last;
            while (node is not null && node.Value.LeaseCount > 0)
            {
                node = node.Previous;
            }

            if (node is null)
            {
                return false;
            }

            var entry = node.Value;
            _lru.Remove(node);
            entry.Node = null;
            _entries.Remove(entry.Key);
            entry.Retired = true;
            entry.Image.Dispose();
            _residentBytes -= entry.ByteLength;
            _evictionCount++;
        }

        return true;
    }

    private void ReleaseLease(CacheEntry entry)
    {
        lock (_sync)
        {
            if (entry.LeaseCount <= 0)
            {
                return;
            }

            entry.LeaseCount--;
            if (entry.Retired && entry.LeaseCount == 0)
            {
                entry.Image.Dispose();
                _residentBytes -= entry.ByteLength;
                _retiredEntries.Remove(entry);
            }
        }
    }

    private void MoveToFront(CacheEntry entry)
    {
        if (entry.Node is null || ReferenceEquals(entry.Node, _lru.First))
        {
            return;
        }

        _lru.Remove(entry.Node);
        entry.Node = _lru.AddFirst(entry);
    }

    private async Task<KeyGateLease> EnterKeyGateAsync(AssetImageCacheKey key, CancellationToken cancellationToken)
    {
        KeyGate gate;
        lock (_gateSync)
        {
            if (!_keyGates.TryGetValue(key, out gate!))
            {
                gate = new KeyGate();
                _keyGates.Add(key, gate);
            }

            gate.ReferenceCount++;
        }

        try
        {
            await gate.Semaphore.WaitAsync(cancellationToken).ConfigureAwait(false);
            return new KeyGateLease(this, key, gate);
        }
        catch
        {
            ReleaseKeyGateReference(key, gate);
            throw;
        }
    }

    private void ExitKeyGate(AssetImageCacheKey key, KeyGate gate)
    {
        gate.Semaphore.Release();
        ReleaseKeyGateReference(key, gate);
    }

    private void ReleaseKeyGateReference(AssetImageCacheKey key, KeyGate gate)
    {
        lock (_gateSync)
        {
            gate.ReferenceCount--;
            if (gate.ReferenceCount == 0 && _keyGates.TryGetValue(key, out var current) && ReferenceEquals(current, gate))
            {
                _keyGates.Remove(key);
                gate.Semaphore.Dispose();
            }
        }
    }

    private sealed class CacheEntry(AssetImageCacheKey key, DecodedAssetImage image, long byteLength)
    {
        public AssetImageCacheKey Key { get; } = key;
        public DecodedAssetImage Image { get; } = image;
        public long ByteLength { get; } = byteLength;
        public int LeaseCount { get; set; }
        public bool Retired { get; set; }
        public LinkedListNode<CacheEntry>? Node { get; set; }
    }

    private sealed class KeyGate
    {
        public SemaphoreSlim Semaphore { get; } = new(1, 1);
        public int ReferenceCount { get; set; }
    }

    private sealed class KeyGateLease(AssetBitmapCache owner, AssetImageCacheKey key, KeyGate gate) : IDisposable
    {
        private int _disposed;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
            {
                owner.ExitKeyGate(key, gate);
            }
        }
    }
}
