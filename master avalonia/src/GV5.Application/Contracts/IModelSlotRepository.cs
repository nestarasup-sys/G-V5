using GV5.Core.Identity;
using GV5.Core.Models;

namespace GV5.Application.Contracts;

/// <summary>Stores model-to-slot navigation independently from content revisions and image assets.</summary>
public interface IModelSlotRepository
{
    Task<Result<IReadOnlyList<ModelSlotEntry>>> ListAsync(CancellationToken cancellationToken = default);

    /// <summary>Assigns an existing draft to an empty slot without moving or replacing another assignment.</summary>
    Task<Result<bool>> AssignAsync(ModelSlot slot, ModelId modelId, long assignedUtcMs, CancellationToken cancellationToken = default);
}
