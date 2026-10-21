using GV5.Core.Identity;
using GV5.Core.Models;

namespace GV5.Application.Contracts;

public readonly record struct WardrobeCatalogCursor
{
    public long PublishedUtcMs { get; }
    public WardrobeRevisionId RevisionId { get; }
    public WardrobeComponentId ComponentId { get; }

    private WardrobeCatalogCursor(long publishedUtcMs, WardrobeRevisionId revisionId, WardrobeComponentId componentId)
    {
        PublishedUtcMs = publishedUtcMs;
        RevisionId = revisionId;
        ComponentId = componentId;
    }

    public static WardrobeCatalogCursor Create(long publishedUtcMs, WardrobeRevisionId revisionId, WardrobeComponentId componentId)
    {
        if (publishedUtcMs < 0 || !revisionId.IsValid || !componentId.IsValid)
            throw new ArgumentException("A wardrobe catalog cursor requires a valid date and revision/component IDs.");
        return new WardrobeCatalogCursor(publishedUtcMs, revisionId, componentId);
    }
}

public sealed record WardrobeCatalogRequest
{
    public ModelRevisionReference Model { get; }
    public WardrobeCategory? Category { get; }
    public int PageSize { get; }
    public WardrobeCatalogCursor? Cursor { get; }

    private WardrobeCatalogRequest(ModelRevisionReference model, WardrobeCategory? category, int pageSize, WardrobeCatalogCursor? cursor)
    {
        Model = model;
        Category = category;
        PageSize = pageSize;
        Cursor = cursor;
    }

    public static WardrobeCatalogRequest Create(ModelRevisionReference model, WardrobeCategory? category = null,
        int pageSize = 36, WardrobeCatalogCursor? cursor = null)
    {
        ArgumentNullException.ThrowIfNull(model);
        if (category is { } value && !Enum.IsDefined(value)) throw new ArgumentOutOfRangeException(nameof(category));
        if (pageSize is < 1 or > 100) throw new ArgumentOutOfRangeException(nameof(pageSize));
        if (cursor is { } position && (position.PublishedUtcMs < 0 || !position.RevisionId.IsValid || !position.ComponentId.IsValid))
            throw new ArgumentException("The wardrobe catalog cursor is invalid.", nameof(cursor));
        return new WardrobeCatalogRequest(model, category, pageSize, cursor);
    }
}

public sealed record WardrobeCatalogItem(
    PublishedWardrobeRevision Publication,
    WardrobeComponent Component,
    int ComponentOrder);

public sealed record WardrobeCatalogPage(
    IReadOnlyList<WardrobeCatalogItem> Items,
    WardrobeCatalogCursor? NextCursor,
    bool HasMore);

/// <summary>Queries published components for one exact model revision and returns stable, bounded pages.</summary>
public interface IWardrobeCatalog
{
    Task<Result<WardrobeCatalogPage>> GetPageAsync(WardrobeCatalogRequest request, CancellationToken cancellationToken = default);

    /// <summary>Opens thumbnails only for the requested visible page window; caller owns returned streams.</summary>
    Task<Result<IReadOnlyList<AssetThumbnailStream>>> GetVisibleThumbnailsAsync(
        WardrobeCatalogPage page,
        int firstVisibleIndex,
        int visibleCount,
        ThumbnailRecipe recipe,
        int maximumPrefetch = 4,
        CancellationToken cancellationToken = default);
}
