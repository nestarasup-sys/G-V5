using GV5.Core.Identity;

namespace GV5.Core.Models;

/// <summary>An immutable facial catalog snapshot tied to one exact model publication.</summary>
public sealed record PublishedFaceCatalogRevision
{
    private PublishedFaceCatalogRevision(FaceRevisionId id, FaceId faceId, Revision revision,
        Revision draftRevision, long publishedUtcMs, string snapshotSha256, FaceCatalogDraft snapshot)
    {
        Id = id;
        FaceId = faceId;
        Revision = revision;
        DraftRevision = draftRevision;
        PublishedUtcMs = publishedUtcMs;
        SnapshotSha256 = snapshotSha256;
        Snapshot = snapshot;
    }

    public FaceRevisionId Id { get; }
    public FaceId FaceId { get; }
    public Revision Revision { get; }
    public Revision DraftRevision { get; }
    public long PublishedUtcMs { get; }
    public string SnapshotSha256 { get; }
    public FaceCatalogDraft Snapshot { get; }

    public static PublishedFaceCatalogRevision Restore(FaceRevisionId id, FaceId faceId,
        Revision revision, Revision draftRevision, long publishedUtcMs, string snapshotSha256,
        FaceCatalogDraft snapshot)
    {
        if (!id.IsValid || !faceId.IsValid || !revision.IsValid || !draftRevision.IsValid || publishedUtcMs < 0)
            throw new ArgumentException("A face publication requires valid IDs, revisions and timestamp.");
        ArgumentNullException.ThrowIfNull(snapshot);
        if (snapshot.Id != faceId || snapshot.Revision != draftRevision)
            throw new ArgumentException("The published snapshot must match its face draft and revision.", nameof(snapshot));
        if (snapshotSha256 is null || snapshotSha256.Length != 64 || snapshotSha256.Any(character => !Uri.IsHexDigit(character)))
            throw new ArgumentException("A face publication requires a SHA-256 hash.", nameof(snapshotSha256));
        return new PublishedFaceCatalogRevision(id, faceId, revision, draftRevision, publishedUtcMs,
            snapshotSha256.ToLowerInvariant(), snapshot);
    }
}
