using GV5.Core.Identity;

namespace GV5.Core.Models;

/// <summary>An immutable expression preset pinned to an immutable face catalog revision.</summary>
public sealed record PublishedFaceExpressionRevision
{
    private PublishedFaceExpressionRevision(FaceExpressionRevisionId id, FaceExpressionPresetId presetId,
        FaceRevisionId faceRevisionId, Revision revision, Revision draftRevision, long publishedUtcMs,
        string snapshotSha256, FaceExpressionPresetDraft snapshot)
    {
        Id = id;
        PresetId = presetId;
        FaceRevisionId = faceRevisionId;
        Revision = revision;
        DraftRevision = draftRevision;
        PublishedUtcMs = publishedUtcMs;
        SnapshotSha256 = snapshotSha256;
        Snapshot = snapshot;
    }

    public FaceExpressionRevisionId Id { get; }
    public FaceExpressionPresetId PresetId { get; }
    public FaceRevisionId FaceRevisionId { get; }
    public Revision Revision { get; }
    public Revision DraftRevision { get; }
    public long PublishedUtcMs { get; }
    public string SnapshotSha256 { get; }
    public FaceExpressionPresetDraft Snapshot { get; }

    public static PublishedFaceExpressionRevision Restore(FaceExpressionRevisionId id,
        FaceExpressionPresetId presetId, FaceRevisionId faceRevisionId, Revision revision,
        Revision draftRevision, long publishedUtcMs, string snapshotSha256, FaceExpressionPresetDraft snapshot)
    {
        if (!id.IsValid || !presetId.IsValid || !faceRevisionId.IsValid || !revision.IsValid
            || !draftRevision.IsValid || publishedUtcMs < 0)
            throw new ArgumentException("An expression publication requires valid IDs, revisions and timestamp.");
        ArgumentNullException.ThrowIfNull(snapshot);
        if (snapshot.Id != presetId || snapshot.Revision != draftRevision)
            throw new ArgumentException("The published snapshot must match its expression draft and revision.", nameof(snapshot));
        if (snapshotSha256 is null || snapshotSha256.Length != 64 || snapshotSha256.Any(character => !Uri.IsHexDigit(character)))
            throw new ArgumentException("An expression publication requires a SHA-256 hash.", nameof(snapshotSha256));
        return new PublishedFaceExpressionRevision(id, presetId, faceRevisionId, revision, draftRevision,
            publishedUtcMs, snapshotSha256.ToLowerInvariant(), snapshot);
    }
}
