using GV5.Core.Identity;
using GV5.Core.Models;

namespace GV5.Application.Contracts;

/// <summary>Stores editable Fabricator animations pinned to immutable model publications.</summary>
public interface IAnimationRepository
{
    Task<Result<AnimationDraft>> CreateAsync(AnimationDraft animation, CancellationToken cancellationToken = default);
    Task<Result<AnimationDraft>> GetAsync(AnimationId animationId, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<AnimationDraft>>> ListAsync(ModelRevisionId modelRevisionId, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<AnimationDraft>>> ListByModelAsync(ModelId modelId, CancellationToken cancellationToken = default);
    Task<Result<AnimationDraft>> SaveAsync(AnimationDraft animation, Revision expectedRevision, CancellationToken cancellationToken = default);
    Task<Result<bool>> DeleteAsync(AnimationId animationId, Revision expectedRevision, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<AnimationSlotAssignment>>> ListSlotsAsync(ModelId modelId, CancellationToken cancellationToken = default);
    Task<Result<AnimationSlotAssignment>> AssignToSlotAsync(ModelId modelId, AnimationId animationId, int slotNumber, CancellationToken cancellationToken = default);
    Task<Result<bool>> ClearSlotAsync(ModelId modelId, int slotNumber, CancellationToken cancellationToken = default);
}

/// <summary>A stable numbered slot associated with an animation draft for one exact model revision.</summary>
public sealed record AnimationSlotAssignment(int SlotNumber, AnimationId AnimationId);
