using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;

namespace GV5.Application.Services;

/// <summary>Catalogs immutable publication snapshots supplied by the application data boundary.</summary>
public sealed class WardrobeCatalog : IWardrobeCatalog
{
    private readonly Func<ModelRevisionReference, CancellationToken, Task<Result<IReadOnlyList<PublishedWardrobeRevision>>>> _loadPublications;
    private readonly IThumbnailService _thumbnails;

    public WardrobeCatalog(IEnumerable<PublishedWardrobeRevision> publications, IThumbnailService thumbnails)
    {
        ArgumentNullException.ThrowIfNull(publications);
        var snapshot = publications.ToArray();
        if (snapshot.Any(publication => publication is null)
            || snapshot.Select(publication => publication.Id).Distinct().Count() != snapshot.Length)
            throw new ArgumentException("A wardrobe catalog requires unique, non-null publication snapshots.", nameof(publications));
        _loadPublications = (model, token) => Task.FromResult(Result<IReadOnlyList<PublishedWardrobeRevision>>.Success(
            snapshot.Where(publication => publication.Model.ModelId == model.ModelId
                && publication.Model.RevisionId == model.RevisionId).ToArray()));
        _thumbnails = thumbnails ?? throw new ArgumentNullException(nameof(thumbnails));
    }

    public WardrobeCatalog(IWardrobeRepository repository, IThumbnailService thumbnails)
    {
        ArgumentNullException.ThrowIfNull(repository);
        _loadPublications = async (model, token) =>
        {
            var result = await repository.ListPublishedForModelAsync(model.RevisionId, token).ConfigureAwait(false);
            return result.IsFailure
                ? Result<IReadOnlyList<PublishedWardrobeRevision>>.Failure(result.Error!)
                : Result<IReadOnlyList<PublishedWardrobeRevision>>.Success(
                    result.Value.Where(publication => publication.Model == model).ToArray());
        };
        _thumbnails = thumbnails ?? throw new ArgumentNullException(nameof(thumbnails));
    }

    public async Task<Result<WardrobeCatalogPage>> GetPageAsync(WardrobeCatalogRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        cancellationToken.ThrowIfCancellationRequested();
        var publicationResult = await _loadPublications(request.Model, cancellationToken).ConfigureAwait(false);
        if (publicationResult.IsFailure) return Result<WardrobeCatalogPage>.Failure(publicationResult.Error!);

        var query = publicationResult.Value
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
        return Result<WardrobeCatalogPage>.Success(new WardrobeCatalogPage(items.AsReadOnly(), next, hasMore));
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
