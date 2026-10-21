using GV5.Assets.Decoding;
using SkiaSharp;
using Xunit;

namespace GV5.Assets.Tests;

public sealed class AssetBitmapCacheTests
{
    [Fact]
    public async Task AcquireAsync_ReusesImageAndKeepsItAliveUntilEveryLeaseIsReleased()
    {
        using var cache = new AssetBitmapCache(maximumBytes: 1024);
        var key = Key(1);
        var first = await cache.AcquireAsync(key, DecodeAsync, TestContext.Current.CancellationToken);
        var second = await cache.AcquireAsync(key, DecodeAsync, TestContext.Current.CancellationToken);

        Assert.True(first.IsSuccess, first.Error?.Message);
        Assert.True(second.IsSuccess, second.Error?.Message);
        Assert.Same(first.Lease!.Bitmap, second.Lease!.Bitmap);
        Assert.Equal(1, cache.Metrics.MissCount);
        Assert.Equal(1, cache.Metrics.HitCount);
        Assert.Equal(1, cache.Metrics.EntryCount);

        first.Lease.Dispose();
        Assert.Equal(SKColors.CornflowerBlue, second.Lease.Bitmap.GetPixel(1, 1));
        Assert.Equal(1, cache.Metrics.ActiveLeaseCount);
        second.Lease.Dispose();
    }

    [Fact]
    public async Task AcquireAsync_EvictsLeastRecentlyUsedUnleasedEntry()
    {
        using var cache = new AssetBitmapCache(maximumBytes: 128);
        var a = await cache.AcquireAsync(Key(1), DecodeAsync, TestContext.Current.CancellationToken);
        a.Lease!.Dispose();
        var b = await cache.AcquireAsync(Key(2), DecodeAsync, TestContext.Current.CancellationToken);
        b.Lease!.Dispose();

        var refreshA = await cache.AcquireAsync(Key(1), DecodeAsync, TestContext.Current.CancellationToken);
        refreshA.Lease!.Dispose();
        var c = await cache.AcquireAsync(Key(3), DecodeAsync, TestContext.Current.CancellationToken);
        c.Lease!.Dispose();

        Assert.Equal(1, cache.Metrics.EvictionCount);
        Assert.Equal(2, cache.Metrics.EntryCount);
        Assert.Equal(128L, cache.Metrics.ResidentBytes);
        var decodeCount = 0;
        var bAgain = await cache.AcquireAsync(Key(2), token =>
        {
            Interlocked.Increment(ref decodeCount);
            return DecodeAsync(token);
        }, TestContext.Current.CancellationToken);

        Assert.True(bAgain.IsSuccess);
        Assert.Equal(1, decodeCount);
        Assert.Equal(2, cache.Metrics.EvictionCount);
        bAgain.Lease!.Dispose();
    }

    [Fact]
    public async Task AcquireAsync_BypassesWhenActiveLeasesPreventEvictionAndDefersDispose()
    {
        var cache = new AssetBitmapCache(maximumBytes: 64);
        var pinned = await cache.AcquireAsync(Key(1), DecodeAsync, TestContext.Current.CancellationToken);
        var bypassed = await cache.AcquireAsync(Key(2), DecodeAsync, TestContext.Current.CancellationToken);

        Assert.True(pinned.IsSuccess);
        Assert.True(bypassed.IsSuccess);
        Assert.Equal(1, cache.Metrics.BypassCount);
        Assert.Equal(1, cache.Metrics.EntryCount);
        Assert.Equal(64L, cache.Metrics.ResidentBytes);
        Assert.Equal(SKColors.CornflowerBlue, pinned.Lease!.Bitmap.GetPixel(0, 0));
        Assert.Equal(SKColors.CornflowerBlue, bypassed.Lease!.Bitmap.GetPixel(0, 0));

        cache.Dispose();
        Assert.Equal(SKColors.CornflowerBlue, pinned.Lease.Bitmap.GetPixel(0, 0));
        Assert.Equal(64L, cache.Metrics.ResidentBytes);
        pinned.Lease.Dispose();
        bypassed.Lease.Dispose();
        Assert.Equal(0L, cache.Metrics.ResidentBytes);
        Assert.Equal(0, cache.Metrics.ActiveLeaseCount);
    }

    [Fact]
    public async Task AcquireAsync_BypassesBitmapLargerThanTinyBudgetAndLeaseOwnsItsLifetime()
    {
        using var cache = new AssetBitmapCache(maximumBytes: 32);
        var result = await cache.AcquireAsync(Key(7), DecodeAsync, TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess, result.Error?.Message);
        Assert.Equal(SKColors.CornflowerBlue, result.Lease!.Bitmap.GetPixel(2, 2));
        Assert.Equal(1, cache.Metrics.MissCount);
        Assert.Equal(1, cache.Metrics.BypassCount);
        Assert.Equal(0, cache.Metrics.EntryCount);
        Assert.Equal(0L, cache.Metrics.ResidentBytes);

        result.Lease.Dispose();
        Assert.Throws<ObjectDisposedException>(() => _ = result.Lease.Bitmap);
        Assert.Equal(0L, cache.Metrics.ResidentBytes);
    }

    [Fact]
    public async Task AcquireAsync_ConcurrentSameKeyDecodesOnlyOnce()
    {
        using var cache = new AssetBitmapCache(maximumBytes: 1024);
        var decodeCount = 0;
        async Task<AssetImageDecodeResult> SlowDecode(CancellationToken token)
        {
            Interlocked.Increment(ref decodeCount);
            await Task.Delay(40, token);
            return await DecodeAsync(token);
        }

        var key = Key(4);
        var one = cache.AcquireAsync(key, SlowDecode, TestContext.Current.CancellationToken);
        var two = cache.AcquireAsync(key, SlowDecode, TestContext.Current.CancellationToken);
        var results = await Task.WhenAll(one, two);

        Assert.All(results, result => Assert.True(result.IsSuccess, result.Error?.Message));
        Assert.Same(results[0].Lease!.Bitmap, results[1].Lease!.Bitmap);
        Assert.Equal(1, decodeCount);
        Assert.Equal(1, cache.Metrics.MissCount);
        Assert.Equal(1, cache.Metrics.HitCount);
        foreach (var result in results)
        {
            result.Lease!.Dispose();
        }
    }

    [Fact]
    public async Task AcquireAsync_DecoderVersionInvalidatesThePreviousBitmap()
    {
        using var cache = new AssetBitmapCache(maximumBytes: 1024);
        var first = await cache.AcquireAsync(Key(6, version: 1), DecodeAsync, TestContext.Current.CancellationToken);
        var second = await cache.AcquireAsync(Key(6, version: 2), DecodeAsync, TestContext.Current.CancellationToken);

        Assert.True(first.IsSuccess, first.Error?.Message);
        Assert.True(second.IsSuccess, second.Error?.Message);
        Assert.NotSame(first.Lease!.Bitmap, second.Lease!.Bitmap);
        Assert.Equal(2, cache.Metrics.MissCount);
        Assert.Equal(2, cache.Metrics.EntryCount);
        first.Lease.Dispose();
        second.Lease!.Dispose();
    }

    [Fact]
    public void CacheKey_RejectsInvalidHashAndDecoderVersion()
    {
        Assert.Throws<ArgumentException>(() => AssetImageCacheKey.Create("not-a-hash", 1));
        Assert.Throws<ArgumentOutOfRangeException>(() => Key(1, version: 0));
    }

    [Fact]
    public async Task AcquireAsync_PropagatesTypedDecodeFailureWithoutCaching()
    {
        using var cache = new AssetBitmapCache(maximumBytes: 1024);
        var result = await cache.AcquireAsync(
            Key(5),
            DecodeMalformedAsync,
            TestContext.Current.CancellationToken);

        Assert.True(result.IsFailure);
        Assert.Equal(AssetImageCacheErrorCode.DecoderFailure, result.Error!.Code);
        Assert.Equal(AssetImageDecodeErrorCode.UnsupportedFormat, result.Error.DecodeError!.Code);
        Assert.Equal(0, cache.Metrics.EntryCount);
    }

    private static AssetImageCacheKey Key(int suffix, int version = 1) => AssetImageCacheKey.Create(suffix.ToString("x").PadLeft(64, '0'), version);

    private static async Task<AssetImageDecodeResult> DecodeAsync(CancellationToken cancellationToken)
    {
        using var input = new MemoryStream(EncodePng());
        return await new AssetImageDecoder().DecodeAsync(input, cancellationToken);
    }

    private static async Task<AssetImageDecodeResult> DecodeMalformedAsync(CancellationToken cancellationToken)
    {
        using var input = new MemoryStream([0x01, 0x02, 0x03, 0x04]);
        return await new AssetImageDecoder().DecodeAsync(input, cancellationToken);
    }

    private static byte[] EncodePng()
    {
        using var bitmap = new SKBitmap(new SKImageInfo(4, 4, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        bitmap.Erase(SKColors.CornflowerBlue);
        using var encoded = bitmap.Encode(SKEncodedImageFormat.Png, 100);
        Assert.NotNull(encoded);
        return encoded!.ToArray();
    }
}
