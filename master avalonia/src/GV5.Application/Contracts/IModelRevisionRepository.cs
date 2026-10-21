using GV5.Core.Identity;
using GV5.Core.Models;

namespace GV5.Application.Contracts;

/// <summary>Creates and reads immutable model publications; draft edits never mutate published snapshots.</summary>
public interface IModelRevisionRepository
{
    Task<Result<PublishedModelRevision>> PublishAsync(
        ModelDraft draft,
        ModelDraftContent content,
        long publishedUtcMs,
        CancellationToken cancellationToken = default);

    Task<Result<PublishedModelRevision>> GetAsync(
        ModelId modelId,
        Revision revision,
        CancellationToken cancellationToken = default);

    Task<Result<IReadOnlyList<PublishedModelRevision>>> ListAsync(
        ModelId modelId,
        CancellationToken cancellationToken = default);
}
