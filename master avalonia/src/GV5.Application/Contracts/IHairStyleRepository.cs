using GV5.Core.Identity;
using GV5.Core.Models;

namespace GV5.Application.Contracts;

/// <summary>Persists hair drafts optimistically and append-only published snapshots.</summary>
public interface IHairStyleRepository
{
    Task<Result<HairStyleDraft>> CreateAsync(HairStyleDraft draft, CancellationToken cancellationToken = default);
    Task<Result<HairStyleDraft>> GetAsync(HairId hairId, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<HairStyleDraft>>> ListAsync(ModelRevisionId modelRevisionId, CancellationToken cancellationToken = default);
    Task<Result<HairStyleDraft>> SaveAsync(HairStyleDraft draft, Revision expectedRevision, CancellationToken cancellationToken = default);
    Task<Result<PublishedHairStyleRevision>> PublishAsync(HairId hairId, Revision expectedDraftRevision,
        long publishedUtcMs, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<PublishedHairStyleRevision>>> ListPublishedAsync(HairId hairId,
        CancellationToken cancellationToken = default);
}
