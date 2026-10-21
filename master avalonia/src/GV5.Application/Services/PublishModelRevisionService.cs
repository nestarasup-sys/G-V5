using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;

namespace GV5.Application.Services;

/// <summary>Loads the confirmed draft snapshot and publishes it through the immutable revision boundary.</summary>
public sealed class PublishModelRevisionService(
    IModelDraftRepository drafts,
    IModelDraftContentRepository content,
    IModelRevisionRepository revisions)
{
    private readonly IModelDraftRepository _drafts = drafts ?? throw new ArgumentNullException(nameof(drafts));
    private readonly IModelDraftContentRepository _content = content ?? throw new ArgumentNullException(nameof(content));
    private readonly IModelRevisionRepository _revisions = revisions ?? throw new ArgumentNullException(nameof(revisions));

    public async Task<Result<PublishedModelRevision>> PublishAsync(
        ModelId modelId,
        long publishedUtcMs,
        CancellationToken cancellationToken = default)
    {
        var draft = await _drafts.GetAsync(modelId, cancellationToken).ConfigureAwait(false);
        if (draft.IsFailure)
        {
            return Result<PublishedModelRevision>.Failure(draft.Error!);
        }

        var snapshot = await _content.GetAsync(modelId, cancellationToken).ConfigureAwait(false);
        if (snapshot.IsFailure)
        {
            return Result<PublishedModelRevision>.Failure(snapshot.Error!);
        }

        return await _revisions.PublishAsync(draft.Value, snapshot.Value, publishedUtcMs, cancellationToken).ConfigureAwait(false);
    }
}
