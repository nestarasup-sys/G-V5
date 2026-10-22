using GV5.Core.Identity;
using GV5.Core.Models;

namespace GV5.Application.Contracts;

/// <summary>Persistence boundary for the editable metadata of a Fabricator model.</summary>
public interface IModelDraftRepository
{
    Task<Result<ModelDraft>> CreateAsync(ModelDraft draft, CancellationToken cancellationToken = default);
    Task<Result<ModelDraft>> CreateInSlotAsync(ModelDraft draft, ModelSlot slot, CancellationToken cancellationToken = default) =>
        CreateAsync(draft, cancellationToken);
    Task<Result<IReadOnlyList<ModelDraft>>> ListAsync(CancellationToken cancellationToken = default);
    Task<Result<ModelDraft>> GetAsync(ModelId id, CancellationToken cancellationToken = default);
    Task<Result<ModelDraft>> DuplicateAsync(ModelId sourceId, string name, long nowUtcMs, CancellationToken cancellationToken = default);
    Task<Result<ModelDraft>> UpdateAsync(ModelDraft draft, Revision expectedRevision, CancellationToken cancellationToken = default);

    /// <summary>Deletes an unpublished draft only when its metadata revision still matches.</summary>
    Task<Result<bool>> DeleteAsync(ModelId id, Revision expectedRevision, CancellationToken cancellationToken = default) =>
        Task.FromResult(Result<bool>.Failure(new ApplicationError(
            ApplicationErrorCode.Validation,
            "This model repository does not support safe draft deletion.",
            id.ToString())));
}
