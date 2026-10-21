using GV5.Core.Identity;

namespace GV5.Application.Contracts;

public readonly record struct AssetPageCursor
{
    public long CreatedUtcMs { get; }
    public AssetId AssetId { get; }

    private AssetPageCursor(long createdUtcMs, AssetId assetId)
    {
        CreatedUtcMs = createdUtcMs;
        AssetId = assetId;
    }

    public static AssetPageCursor Create(long createdUtcMs, AssetId assetId)
    {
        if (createdUtcMs < 0 || !assetId.IsValid)
        {
            throw new ArgumentOutOfRangeException(nameof(createdUtcMs), "An asset page cursor requires a non-negative timestamp and valid asset ID.");
        }

        return new AssetPageCursor(createdUtcMs, assetId);
    }
}

public sealed record AssetPageRequest
{
    public int PageSize { get; }
    public AssetPageCursor? Cursor { get; }

    private AssetPageRequest(int pageSize, AssetPageCursor? cursor)
    {
        PageSize = pageSize;
        Cursor = cursor;
    }

    public static AssetPageRequest Create(int pageSize = 50, AssetPageCursor? cursor = null)
    {
        if (pageSize is < 1 or > 100)
        {
            throw new ArgumentOutOfRangeException(nameof(pageSize), "Asset page size must be between 1 and 100.");
        }

        if (cursor is { } value && (!value.AssetId.IsValid || value.CreatedUtcMs < 0))
        {
            throw new ArgumentException("The asset page cursor is invalid.", nameof(cursor));
        }

        return new AssetPageRequest(pageSize, cursor);
    }
}

public sealed record AssetPage(
    IReadOnlyList<AssetMetadata> Items,
    AssetPageCursor? NextCursor,
    bool HasMore);

/// <summary>Reads asset metadata in stable, bounded pages without opening the associated files.</summary>
public interface IAssetCatalog
{
    Task<Result<AssetPage>> GetPageAsync(AssetPageRequest request, CancellationToken cancellationToken = default);
}
