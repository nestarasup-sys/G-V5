using GV5.Core.Identity;
using GV5.Core.Models;

namespace GV5.Application.Contracts;

/// <summary>Stores editable Fabricator animations pinned to immutable model publications.</summary>
public interface IAnimationRepository
{
    Task<Result<AnimationDraft>> CreateAsync(AnimationDraft animation, CancellationToken cancellationToken = default);
    Task<Result<AnimationDraft>> GetAsync(AnimationId animationId, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<AnimationDraft>>> ListAsync(ModelRevisionId modelRevisionId, CancellationToken cancellationToken = default);
    Task<Result<AnimationDraft>> SaveAsync(AnimationDraft animation, Revision expectedRevision, CancellationToken cancellationToken = default);
    Task<Result<bool>> DeleteAsync(AnimationId animationId, Revision expectedRevision, CancellationToken cancellationToken = default);
}
