using System.Collections.Immutable;
using GV5.Core.Identity;

namespace GV5.Core.Models;

/// <summary>An immutable wardrobe snapshot pinned to one exact model publication.</summary>
public sealed record PublishedWardrobeRevision
{
    private PublishedWardrobeRevision(WardrobeRevisionId id, WardrobeId wardrobeId, Revision revision,
        Revision draftRevision, ModelRevisionReference model, string name, long publishedUtcMs,
        string snapshotSha256, ImmutableArray<WardrobeComponent> components)
    {
        Id = id;
        WardrobeId = wardrobeId;
        Revision = revision;
        DraftRevision = draftRevision;
        Model = model;
        Name = name;
        PublishedUtcMs = publishedUtcMs;
        SnapshotSha256 = snapshotSha256;
        Components = components;
    }

    public WardrobeRevisionId Id { get; }
    public WardrobeId WardrobeId { get; }
    public Revision Revision { get; }
    public Revision DraftRevision { get; }
    public ModelRevisionReference Model { get; }
    public string Name { get; }
    public long PublishedUtcMs { get; }
    public string SnapshotSha256 { get; }
    public ImmutableArray<WardrobeComponent> Components { get; }

    public static PublishedWardrobeRevision Snapshot(WardrobeSet draft, Revision publicationRevision,
        long publishedUtcMs, string snapshotSha256)
    {
        ArgumentNullException.ThrowIfNull(draft);
        if (!publicationRevision.IsValid || publishedUtcMs < 0)
            throw new ArgumentOutOfRangeException(nameof(publicationRevision));
        if (draft.Components.IsDefaultOrEmpty)
            throw new ArgumentException("An empty wardrobe cannot be published.", nameof(draft));
        if (snapshotSha256 is null || snapshotSha256.Length != 64 || snapshotSha256.Any(character => !Uri.IsHexDigit(character)))
            throw new ArgumentException("A published wardrobe requires a SHA-256 snapshot hash.", nameof(snapshotSha256));
        return new PublishedWardrobeRevision(WardrobeRevisionId.New(), draft.Id, publicationRevision,
            draft.Revision, draft.Model, draft.Name, publishedUtcMs, snapshotSha256.ToLowerInvariant(),
            draft.Components.ToImmutableArray());
    }
}
