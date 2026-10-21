using GV5.Core.Identity;

namespace GV5.Core.Models;

/// <summary>An immutable published snapshot of one hair style draft.</summary>
public sealed record PublishedHairStyleRevision
{
    private PublishedHairStyleRevision(HairRevisionId id, HairId hairId, Revision revision,
        Revision draftRevision, long publishedUtcMs, string snapshotSha256, HairStyleDraft snapshot)
    {
        Id = id;
        HairId = hairId;
        Revision = revision;
        DraftRevision = draftRevision;
        PublishedUtcMs = publishedUtcMs;
        SnapshotSha256 = snapshotSha256;
        Snapshot = snapshot;
    }

    public HairRevisionId Id { get; }
    public HairId HairId { get; }
    public Revision Revision { get; }
    public Revision DraftRevision { get; }
    public long PublishedUtcMs { get; }
    public string SnapshotSha256 { get; }
    public HairStyleDraft Snapshot { get; }

    public static PublishedHairStyleRevision Restore(HairRevisionId id, HairId hairId, Revision revision,
        Revision draftRevision, long publishedUtcMs, string snapshotSha256, HairStyleDraft snapshot)
    {
        if (!id.IsValid || !hairId.IsValid || !revision.IsValid || !draftRevision.IsValid || publishedUtcMs < 0)
            throw new ArgumentException("A hair publication requires valid identity, revisions, and timestamp.");
        ArgumentNullException.ThrowIfNull(snapshot);
        if (snapshot.Id != hairId || snapshot.Revision != draftRevision)
            throw new ArgumentException("The published snapshot must match its hair and draft revision.", nameof(snapshot));
        if (snapshotSha256 is null || snapshotSha256.Length != 64 || snapshotSha256.Any(character => !Uri.IsHexDigit(character)))
            throw new ArgumentException("A hair publication requires a SHA-256 hash.", nameof(snapshotSha256));
        return new PublishedHairStyleRevision(id, hairId, revision, draftRevision, publishedUtcMs,
            snapshotSha256.ToLowerInvariant(), snapshot);
    }
}
