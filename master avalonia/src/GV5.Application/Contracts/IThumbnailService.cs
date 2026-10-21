using GV5.Core.Identity;

namespace GV5.Application.Contracts;

public enum ThumbnailFitMode
{
    Contain = 1,
    Cover = 2,
    Stretch = 3
}

/// <summary>Immutable transformation settings used to identify a derived thumbnail on disk.</summary>
public sealed record ThumbnailRecipe
{
    public int Width { get; }
    public int Height { get; }
    public ThumbnailFitMode FitMode { get; }

    private ThumbnailRecipe(int width, int height, ThumbnailFitMode fitMode)
    {
        Width = width;
        Height = height;
        FitMode = fitMode;
    }

    public static ThumbnailRecipe Create(int width, int height, ThumbnailFitMode fitMode = ThumbnailFitMode.Contain)
    {
        const int maximumDimension = 4096;
        const long maximumPixels = 16_777_216;
        if (width < 1 || height < 1 || width > maximumDimension || height > maximumDimension || (long)width * height > maximumPixels)
        {
            throw new ArgumentOutOfRangeException(nameof(width), "Thumbnail dimensions must be positive and stay within 4096 × 4096 pixels.");
        }

        if (!Enum.IsDefined(fitMode))
        {
            throw new ArgumentOutOfRangeException(nameof(fitMode));
        }

        return new ThumbnailRecipe(width, height, fitMode);
    }
}

/// <summary>Returns caller-owned streams for thumbnails derived from immutable asset content.</summary>
public interface IThumbnailService
{
    Task<Result<Stream>> GetOrCreateAsync(
        AssetId assetId,
        ThumbnailRecipe recipe,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Loads only the visible range plus a bounded number of adjacent thumbnails.
    /// The caller owns and must dispose every returned stream.
    /// </summary>
    Task<Result<IReadOnlyList<AssetThumbnailStream>>> GetVisibleWindowAsync(
        IReadOnlyList<AssetId> orderedAssetIds,
        int firstVisibleIndex,
        int visibleCount,
        ThumbnailRecipe recipe,
        int maximumPrefetch = 4,
        CancellationToken cancellationToken = default);
}

public sealed class AssetThumbnailStream : IAsyncDisposable
{
    public AssetId AssetId { get; }
    public Stream Content { get; }

    public AssetThumbnailStream(AssetId assetId, Stream content)
    {
        if (!assetId.IsValid)
        {
            throw new ArgumentException("A thumbnail result requires a valid asset ID.", nameof(assetId));
        }

        AssetId = assetId;
        Content = content ?? throw new ArgumentNullException(nameof(content));
    }

    public ValueTask DisposeAsync() => Content.DisposeAsync();
}

public static class AssetThumbnailWindowPlanner
{
    public const int MaximumPrefetch = 16;

    public static IReadOnlyList<int> SelectIndexes(int itemCount, int firstVisibleIndex, int visibleCount, int maximumPrefetch = 4)
    {
        if (itemCount < 0 || firstVisibleIndex < 0 || firstVisibleIndex > itemCount || visibleCount < 0 || maximumPrefetch is < 0 or > MaximumPrefetch)
        {
            throw new ArgumentOutOfRangeException(nameof(firstVisibleIndex), "The visible asset range or prefetch limit is invalid.");
        }

        if (visibleCount == 0 || firstVisibleIndex == itemCount)
        {
            return Array.Empty<int>();
        }

        var visibleEnd = (int)Math.Min(itemCount, (long)firstVisibleIndex + visibleCount);
        var before = Math.Min(firstVisibleIndex, maximumPrefetch / 2);
        var remaining = maximumPrefetch - before;
        var after = Math.Min(itemCount - visibleEnd, remaining);
        remaining -= after;
        before += Math.Min(firstVisibleIndex - before, remaining);

        var start = firstVisibleIndex - before;
        var end = visibleEnd + after;
        return Enumerable.Range(start, end - start).ToArray();
    }
}
