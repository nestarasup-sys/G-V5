using GV5.Core.Identity;
using GV5.Core.Models;

namespace GV5.Application.Contracts;

/// <summary>Persists editable facial asset catalogs with optimistic revisions and model pinning.</summary>
public interface IFaceCatalogRepository
{
    Task<Result<FaceCatalogDraft>> CreateAsync(FaceCatalogDraft draft, CancellationToken cancellationToken = default);
    Task<Result<FaceCatalogDraft>> GetAsync(FaceId faceId, CancellationToken cancellationToken = default);
    Task<Result<IReadOnlyList<FaceCatalogDraft>>> ListAsync(ModelRevisionId modelRevisionId, CancellationToken cancellationToken = default);
    Task<Result<FaceCatalogDraft>> SaveAsync(FaceCatalogDraft draft, Revision expectedRevision, CancellationToken cancellationToken = default);
}
