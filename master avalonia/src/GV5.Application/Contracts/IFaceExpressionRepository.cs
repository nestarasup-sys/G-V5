using GV5.Core.Identity;
using GV5.Core.Models;

namespace GV5.Application.Contracts;

/// <summary>Persists face-expression collections and editable preset drafts with optimistic revisions.</summary>
public interface IFaceExpressionRepository
{
    Task<Result<FaceExpressionCollection>> CreateCollectionAsync(FaceExpressionCollection collection, CancellationToken cancellationToken = default);
    Task<Result<FaceExpressionCollection>> GetCollectionAsync(FaceExpressionCollectionId id, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<FaceExpressionCollection>>> ListCollectionsAsync(ModelRevisionId modelRevisionId, CancellationToken cancellationToken = default);
    Task<Result<FaceExpressionCollection>> SaveCollectionAsync(FaceExpressionCollection collection, Revision expectedRevision, CancellationToken cancellationToken = default);
    Task<Result<bool>> DeleteCollectionAsync(FaceExpressionCollectionId id, Revision expectedRevision, CancellationToken cancellationToken = default);
    Task<Result<FaceExpressionPresetDraft>> CreatePresetAsync(FaceExpressionPresetDraft preset, CancellationToken cancellationToken = default);
    Task<Result<FaceExpressionPresetDraft>> GetPresetAsync(FaceExpressionPresetId id, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<FaceExpressionPresetDraft>>> ListPresetsAsync(FaceExpressionCollectionId collectionId, CancellationToken cancellationToken = default);
    Task<Result<FaceExpressionPresetDraft>> SavePresetAsync(FaceExpressionPresetDraft preset, Revision expectedRevision, CancellationToken cancellationToken = default);
    Task<Result<bool>> DeletePresetAsync(FaceExpressionPresetId id, Revision expectedRevision, CancellationToken cancellationToken = default);
    Task<Result<PublishedFaceExpressionRevision>> PublishPresetAsync(FaceExpressionPresetId id,
        Revision expectedDraftRevision, long publishedUtcMs, CancellationToken cancellationToken = default);
    Task<Result<PublishedFaceExpressionRevision>> GetPublishedPresetAsync(FaceExpressionPresetId id,
        Revision revision, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<PublishedFaceExpressionRevision>>> ListPublishedPresetsAsync(FaceExpressionPresetId id,
        CancellationToken cancellationToken = default);
}
