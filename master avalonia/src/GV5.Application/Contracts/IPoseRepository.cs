using GV5.Core.Identity;
using GV5.Core.Models;

namespace GV5.Application.Contracts;

/// <summary>Stores editable poses and their append-only published revisions.</summary>
public interface IPoseRepository
{
    Task<Result<PoseDraft>> CreateAsync(PoseDraft pose, CancellationToken cancellationToken = default);
    Task<Result<PoseDraft>> GetAsync(PoseId poseId, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<PoseDraft>>> ListAsync(ModelRevisionId modelRevisionId, CancellationToken cancellationToken = default);
    Task<Result<PoseDraft>> SaveAsync(PoseDraft pose, Revision expectedRevision, CancellationToken cancellationToken = default);
    Task<Result<PublishedPoseRevision>> PublishAsync(PoseId poseId, Revision expectedDraftRevision, long publishedUtcMs, CancellationToken cancellationToken = default);
    Task<Result<PublishedPoseRevision>> GetPublishedAsync(PoseId poseId, Revision revision, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<PublishedPoseRevision>>> ListPublishedAsync(PoseId poseId, CancellationToken cancellationToken = default);
}
