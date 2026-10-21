using GV5.Core.Models;

namespace GV5.Application.Contracts;

/// <summary>Durable write-ahead checkpoints for recoverable Fabricator draft edits.</summary>
public interface IModelDraftCheckpointStore
{
    Task WriteAsync(ModelDraftCheckpoint checkpoint, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<ModelDraftCheckpoint>> GetPendingAsync(CancellationToken cancellationToken = default);
    Task CompleteAsync(Guid checkpointId, CancellationToken cancellationToken = default);
}
