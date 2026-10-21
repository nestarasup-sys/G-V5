using System.Collections.Immutable;
using GV5.Core.Identity;
using GV5.Geometry;

namespace GV5.Core.Models;

/// <summary>An immutable published pose pinned to the exact model snapshot used to author it.</summary>
public sealed record PublishedPoseRevision
{
    private PublishedPoseRevision(PoseRevisionId id, PoseId poseId, Revision revision, Revision draftRevision,
        ModelRevisionReference model, string name, string? category, long publishedUtcMs, string snapshotSha256,
        ImmutableArray<PosePartTransform> partTransforms, ImmutableArray<RigJoint> rigJoints, ImmutableArray<ModelPartId> layerOrder)
    {
        Id = id;
        PoseId = poseId;
        Revision = revision;
        DraftRevision = draftRevision;
        Model = model;
        Name = name;
        Category = category;
        PublishedUtcMs = publishedUtcMs;
        SnapshotSha256 = snapshotSha256;
        PartTransforms = partTransforms;
        RigJoints = rigJoints;
        LayerOrder = layerOrder;
    }

    public PoseRevisionId Id { get; }
    public PoseId PoseId { get; }
    /// <summary>Publication sequence, independent from the editable draft revision.</summary>
    public Revision Revision { get; }
    public Revision DraftRevision { get; }
    public ModelRevisionReference Model { get; }
    public string Name { get; }
    public string? Category { get; }
    public long PublishedUtcMs { get; }
    public string SnapshotSha256 { get; }
    public ImmutableArray<PosePartTransform> PartTransforms { get; }
    public ImmutableArray<RigJoint> RigJoints { get; }
    public ImmutableArray<ModelPartId> LayerOrder { get; }

    public static PublishedPoseRevision Restore(PoseRevisionId id, PoseId poseId, Revision revision, Revision draftRevision,
        ModelRevisionReference model, string name, long publishedUtcMs, string snapshotSha256,
        IEnumerable<PosePartTransform> partTransforms, IEnumerable<RigJoint>? rigJoints = null,
        IEnumerable<ModelPartId>? layerOrder = null, string? category = null)
    {
        if (!id.IsValid || !poseId.IsValid || !revision.IsValid || !draftRevision.IsValid)
        {
            throw new ArgumentException("A published pose requires valid identities and revisions.");
        }
        ArgumentNullException.ThrowIfNull(model);
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var normalizedName = name.Trim();
        if (normalizedName.Length > 120) throw new ArgumentOutOfRangeException(nameof(name));
        var normalizedCategory = string.IsNullOrWhiteSpace(category) ? null : category.Trim();
        if (normalizedCategory?.Length > 64) throw new ArgumentOutOfRangeException(nameof(category));
        if (publishedUtcMs < 0) throw new ArgumentOutOfRangeException(nameof(publishedUtcMs));
        if (snapshotSha256 is null || snapshotSha256.Length != 64 || snapshotSha256.Any(character => !Uri.IsHexDigit(character)))
        {
            throw new ArgumentException("A published pose requires a SHA-256 snapshot hash.", nameof(snapshotSha256));
        }
        ArgumentNullException.ThrowIfNull(partTransforms);
        var transforms = partTransforms.ToImmutableArray();
        if (transforms.IsDefaultOrEmpty || transforms.Any(item => item is null)
            || transforms.Select(item => item.PartId).Distinct().Count() != transforms.Length)
        {
            throw new ArgumentException("A published pose must contain unique part transforms.", nameof(partTransforms));
        }
        var joints = (rigJoints ?? []).ToImmutableArray();
        var order = (layerOrder ?? transforms.Select(item => item.PartId)).ToImmutableArray();
        if (order.Any(partId => !partId.IsValid)
            || order.Distinct().Count() != order.Length
            || !order.ToHashSet().SetEquals(transforms.Select(item => item.PartId)))
        {
            throw new ArgumentException("A published pose requires valid joints and layer order for every part.");
        }
        _ = RigSkeleton.Create(transforms.Select(item => TransformNodeId.From(item.PartId.Value)), joints);

        return new PublishedPoseRevision(id, poseId, revision, draftRevision, model, normalizedName, normalizedCategory,
            publishedUtcMs, snapshotSha256.ToLowerInvariant(), transforms, joints, order);
    }

    public static PublishedPoseRevision Snapshot(PoseDraft draft, Revision publicationRevision, long publishedUtcMs, string snapshotSha256)
    {
        ArgumentNullException.ThrowIfNull(draft);
        return Restore(PoseRevisionId.New(), draft.Id, publicationRevision, draft.Revision, draft.Model,
            draft.Name, publishedUtcMs, snapshotSha256, draft.PartTransforms, draft.RigJoints, draft.LayerOrder, draft.Category);
    }
}
