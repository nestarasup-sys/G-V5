using GV5.Core.Identity;
using GV5.Core.Models;

namespace GV5.Application.Contracts;

/// <summary>Persistence boundary for the editable metadata of a Fabricator model.</summary>
public interface IModelDraftRepository
{
    Task<Result<ModelDraft>> CreateAsync(ModelDraft draft, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<ModelDraft>>> ListAsync(CancellationToken cancellationToken = default);
    Task<Result<ModelDraft>> GetAsync(ModelId id, CancellationToken cancellationToken = default);
    Task<Result<ModelDraft>> DuplicateAsync(ModelId sourceId, string name, long nowUtcMs, CancellationToken cancellationToken = default);
    Task<Result<ModelDraft>> UpdateAsync(ModelDraft draft, Revision expectedRevision, CancellationToken cancellationToken = default);
}
