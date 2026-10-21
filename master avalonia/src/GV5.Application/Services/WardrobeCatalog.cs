using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;

namespace GV5.Application.Services;

/// <summary>Catalogs immutable publication snapshots supplied by the application data boundary.</summary>
public sealed class WardrobeCatalog : IWardrobeCatalog
{
    private readonly IReadOnlyList<PublishedWardrobeRevision> _publications;
    private readonly IThumbnailService _thumbnails;

    public WardrobeCatalog(IEnumerable<PublishedWardrobeRevision> publications, IThumbnailService thumbnails)
    {
        ArgumentNullException.ThrowIfNull(publications);
        _publications = publications.ToArray();
        if (_publications.Any(publication => publication is null)
            || _publications.Select(publication => publication.Id).Distinct().Count() != _publications.Count)
            throw new ArgumentException("A wardrobe catalog requires unique, non-null publication snapshots.", nameof(publications));
        _thumbnails = thumbnails ?? throw new ArgumentNullException(nameof(thumbnails));
    }

    public Task<Result<WardrobeCatalogPage>> GetPageAsync(WardrobeCatalogRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        cancellationToken.ThrowIfCancellationRequested();

        var query = _publications
            .Where(publication => publication.Model == request.Model)
            .SelectMany(publication => publication.Components.Select((component, index) =>
                new WardrobeCatalogItem(publication, component, index)))
            .Where(item => request.Category is null || item.Component.Category == request.Category)
            .OrderByDescending(item => item.Publication.PublishedUtcMs)
            .ThenByDescending(item => item.Publication.Id.ToString(), StringComparer.Ordinal)
            .ThenByDescending(item => item.Component.Id.ToString(), StringComparer.Ordinal);

        if (request.Cursor is { } cursor)
        {
            query = query.Where(item => IsAfter(item, cursor))
                .OrderByDescending(item => item.Publication.PublishedUtcMs)
                .ThenByDescending(item => item.Publication.Id.ToString(), StringComparer.Ordinal)
                .ThenByDescending(item => item.Component.Id.ToString(), StringComparer.Ordinal);
        }

        var items = query.Take(request.PageSize + 1).ToList();
        var hasMore = items.Count > request.PageSize;
        if (hasMore) items.RemoveAt(items.Count - 1);
        WardrobeCatalogCursor? next = hasMore && items.Count > 0 ? CreateCursor(items[^1]) : null;
        return Task.FromResult(Result<WardrobeCatalogPage>.Success(new WardrobeCatalogPage(items.AsReadOnly(), next, hasMore)));
    }

    public Task<Result<IReadOnlyList<AssetThumbnailStream>>> GetVisibleThumbnailsAsync(
        WardrobeCatalogPage page, int firstVisibleIndex, int visibleCount, ThumbnailRecipe recipe,
        int maximumPrefetch = 4, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(page);
        ArgumentNullException.ThrowIfNull(recipe);
        var assetIds = page.Items.Select(item => item.Component.AssetId).ToArray();
        return _thumbnails.GetVisibleWindowAsync(assetIds, firstVisibleIndex, visibleCount, recipe,
            maximumPrefetch, cancellationToken);
    }

    private static bool IsAfter(WardrobeCatalogItem item, WardrobeCatalogCursor cursor)
    {
        if (item.Publication.PublishedUtcMs != cursor.PublishedUtcMs)
            return item.Publication.PublishedUtcMs < cursor.PublishedUtcMs;

        var revisionComparison = string.CompareOrdinal(item.Publication.Id.ToString(), cursor.RevisionId.ToString());
        if (revisionComparison != 0) return revisionComparison < 0;
        return string.CompareOrdinal(item.Component.Id.ToString(), cursor.ComponentId.ToString()) < 0;
    }

    private static WardrobeCatalogCursor CreateCursor(WardrobeCatalogItem item) =>
        WardrobeCatalogCursor.Create(item.Publication.PublishedUtcMs, item.Publication.Id, item.Component.Id);
}
