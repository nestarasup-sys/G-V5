using GV5.Core.Identity;
using GV5.Core.Models;

namespace GV5.Application.Contracts;

/// <summary>Persists one reusable head-extra library per stable Fabricator model slot.</summary>
public interface IHeadExtraLibraryRepository
{
    Task<Result<HeadExtraLibraryDraft>> CreateAsync(HeadExtraLibraryDraft draft, CancellationToken cancellationToken = default);
    Task<Result<HeadExtraLibraryDraft>> GetAsync(ModelSlot modelSlot, CancellationToken cancellationToken = default);
    Task<Result<HeadExtraLibraryDraft>> SaveAsync(HeadExtraLibraryDraft draft, Revision expectedRevision,
        CancellationToken cancellationToken = default);
}
