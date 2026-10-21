using GV5.Core.Identity;

namespace GV5.Core.Models;

/// <summary>An immutable, named and versioned snapshot that consumers may safely reference.</summary>
public sealed record PublishedModelRevision
{
    private PublishedModelRevision(
        ModelRevisionId id,
        ModelId modelId,
        Revision revision,
        Revision draftRevision,
        string name,
        long publishedUtcMs,
        string snapshotSha256,
        ModelDraftContent content)
    {
        Id = id;
        ModelId = modelId;
        Revision = revision;
        DraftRevision = draftRevision;
        Name = name;
        PublishedUtcMs = publishedUtcMs;
        SnapshotSha256 = snapshotSha256;
        Content = content;
    }

    public ModelRevisionId Id { get; }
    public ModelId ModelId { get; }
    /// <summary>Publication sequence, independent from editable draft/content revisions.</summary>
    public Revision Revision { get; }
    public Revision DraftRevision { get; }
    public string Name { get; }
    public long PublishedUtcMs { get; }
    public string SnapshotSha256 { get; }
    public ModelDraftContent Content { get; }

    public static PublishedModelRevision Restore(
        ModelRevisionId id,
        ModelId modelId,
        Revision revision,
        Revision draftRevision,
        string name,
        long publishedUtcMs,
        string snapshotSha256,
        ModelDraftContent content)
    {
        if (!id.IsValid || !modelId.IsValid || !revision.IsValid || !draftRevision.IsValid)
        {
            throw new ArgumentException("A published model revision requires valid identities and revisions.");
        }
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var normalizedName = name.Trim();
        if (normalizedName.Length > 120)
        {
            throw new ArgumentOutOfRangeException(nameof(name), "A model name cannot exceed 120 characters.");
        }
        if (publishedUtcMs < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(publishedUtcMs));
        }
        if (snapshotSha256 is null || snapshotSha256.Length != 64 || snapshotSha256.Any(character => !Uri.IsHexDigit(character)))
        {
            throw new ArgumentException("A published model revision requires a SHA-256 snapshot hash.", nameof(snapshotSha256));
        }
        ArgumentNullException.ThrowIfNull(content);
        if (content.ModelId != modelId)
        {
            throw new ArgumentException("Published content must belong to the same model.", nameof(content));
        }

        return new PublishedModelRevision(id, modelId, revision, draftRevision, normalizedName, publishedUtcMs, snapshotSha256.ToLowerInvariant(), content);
    }
}
