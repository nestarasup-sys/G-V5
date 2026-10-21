using GV5.Core.Identity;

namespace GV5.Core.Models;

/// <summary>A content-addressed pointer to one exact immutable model publication.</summary>
public sealed record ModelRevisionReference
{
    private ModelRevisionReference(ModelId modelId, ModelRevisionId revisionId, Revision sequence, string snapshotSha256)
    {
        ModelId = modelId;
        RevisionId = revisionId;
        Sequence = sequence;
        SnapshotSha256 = snapshotSha256;
    }

    public ModelId ModelId { get; }
    public ModelRevisionId RevisionId { get; }
    public Revision Sequence { get; }
    public string SnapshotSha256 { get; }

    public static ModelRevisionReference From(PublishedModelRevision revision)
    {
        ArgumentNullException.ThrowIfNull(revision);
        return Restore(revision.ModelId, revision.Id, revision.Revision, revision.SnapshotSha256);
    }

    public static ModelRevisionReference Restore(ModelId modelId, ModelRevisionId revisionId, Revision sequence, string snapshotSha256)
    {
        if (!modelId.IsValid || !revisionId.IsValid || !sequence.IsValid)
        {
            throw new ArgumentException("A model revision reference requires valid model and revision identities.");
        }
        if (snapshotSha256 is null || snapshotSha256.Length != 64 || snapshotSha256.Any(character => !Uri.IsHexDigit(character)))
        {
            throw new ArgumentException("A model revision reference requires a SHA-256 snapshot hash.", nameof(snapshotSha256));
        }

        return new ModelRevisionReference(modelId, revisionId, sequence, snapshotSha256.ToLowerInvariant());
    }
}
