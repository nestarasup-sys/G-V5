using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;

namespace GV5.Application.Services;

/// <summary>Creates a new editable pose with the same data and exact pinned model publication as its source.</summary>
public sealed class DuplicatePoseService(IPoseRepository poses)
{
    private readonly IPoseRepository _poses = poses ?? throw new ArgumentNullException(nameof(poses));

    public async Task<Result<PoseDraft>> DuplicateAsync(PoseId sourceId, string name, CancellationToken cancellationToken = default)
    {
        if (!sourceId.IsValid)
            return Result<PoseDraft>.Failure(new ApplicationError(ApplicationErrorCode.Validation, "A valid source pose ID is required."));

        var source = await _poses.GetAsync(sourceId, cancellationToken).ConfigureAwait(false);
        if (source.IsFailure) return Result<PoseDraft>.Failure(source.Error!);

        PoseDraft duplicate;
        try
        {
            duplicate = PoseDraft.Restore(
                PoseId.New(),
                source.Value.Model,
                Revision.Initial,
                name,
                source.Value.PartTransforms,
                source.Value.RigJoints,
                source.Value.LayerOrder,
                source.Value.Category);
        }
        catch (ArgumentException exception)
        {
            return Result<PoseDraft>.Failure(new ApplicationError(ApplicationErrorCode.Validation, exception.Message));
        }

        return await _poses.CreateAsync(duplicate, cancellationToken).ConfigureAwait(false);
    }

    public async Task<Result<PoseDraft>> DuplicateAsync(PoseDraft source, string name, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);
        PoseDraft duplicate;
        try
        {
            duplicate = PoseDraft.Restore(PoseId.New(), source.Model, Revision.Initial, name,
                source.PartTransforms, source.RigJoints, source.LayerOrder, source.Category);
        }
        catch (ArgumentException exception)
        {
            return Result<PoseDraft>.Failure(new ApplicationError(ApplicationErrorCode.Validation, exception.Message));
        }

        return await _poses.CreateAsync(duplicate, cancellationToken).ConfigureAwait(false);
    }
}
