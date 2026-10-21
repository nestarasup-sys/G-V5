using GV5.Core.Identity;
using GV5.Core.Models;

namespace GV5.Application.Contracts;

/// <summary>Persists wardrobe drafts with optimistic concurrency and append-only published snapshots.</summary>
public interface IWardrobeRepository
{
    Task<Result<WardrobeSet>> CreateAsync(WardrobeSet draft, CancellationToken cancellationToken = default);
    Task<Result<WardrobeSet>> GetAsync(WardrobeId wardrobeId, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<WardrobeSet>>> ListAsync(ModelRevisionId modelRevisionId, CancellationToken cancellationToken = default);
    Task<Result<WardrobeSet>> SaveAsync(WardrobeSet draft, Revision expectedRevision, CancellationToken cancellationToken = default);
    Task<Result<PublishedWardrobeRevision>> PublishAsync(WardrobeId wardrobeId, Revision expectedDraftRevision,
        long publishedUtcMs, CancellationToken cancellationToken = default);
    Task<Result<PublishedWardrobeRevision>> GetPublishedAsync(WardrobeId wardrobeId, Revision revision,
        CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<PublishedWardrobeRevision>>> ListPublishedAsync(WardrobeId wardrobeId,
        CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<PublishedWardrobeRevision>>> ListPublishedForModelAsync(ModelRevisionId modelRevisionId,
        CancellationToken cancellationToken = default);
}
