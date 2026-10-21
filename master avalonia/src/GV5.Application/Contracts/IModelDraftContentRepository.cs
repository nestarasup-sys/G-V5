using GV5.Core.Identity;
using GV5.Core.Models;

namespace GV5.Application.Contracts;

/// <summary>Persists versioned Fabricator metadata while image bytes remain in the AssetStore.</summary>
public interface IModelDraftContentRepository
{
    Task<Result<ModelDraftContent>> GetAsync(ModelId modelId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Saves revision 1 when expectedRevision is null; later saves must advance exactly one revision.
    /// Content metadata and the model's asset references are committed atomically.
    /// </summary>
    Task<Result<ModelDraftContent>> SaveAsync(
        ModelDraftContent content,
        Revision? expectedRevision,
        CancellationToken cancellationToken = default);
}
