using GV5.Core.Identity;
using GV5.Core.Models;

namespace GV5.Application.Contracts;

/// <summary>Persists one reusable facial-detail library per stable Fabricator model slot.</summary>
public interface IFaceDetailLibraryRepository
{
    Task<Result<FaceDetailLibraryDraft>> CreateAsync(FaceDetailLibraryDraft draft, CancellationToken cancellationToken = default);
    Task<Result<FaceDetailLibraryDraft>> GetAsync(ModelSlot modelSlot, CancellationToken cancellationToken = default);
    Task<Result<FaceDetailLibraryDraft>> SaveAsync(FaceDetailLibraryDraft draft, Revision expectedRevision,
        CancellationToken cancellationToken = default);
}
