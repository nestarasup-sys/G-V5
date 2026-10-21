using System.Collections.Immutable;
using GV5.Core.Identity;
using GV5.Geometry;

namespace GV5.Core.Models;

/// <summary>Editable pose data pinned to one exact immutable model revision.</summary>
public sealed record PoseDraft
{
    public const int CurrentSchemaVersion = 1;

    private PoseDraft(PoseId id, ModelRevisionReference model, Revision revision, string name, string? category,
        ImmutableArray<PosePartTransform> partTransforms, ImmutableArray<RigJoint> rigJoints, ImmutableArray<ModelPartId> layerOrder)
    {
        Id = id;
        Model = model;
        Revision = revision;
        Name = name;
        Category = category;
        PartTransforms = partTransforms;
        RigJoints = rigJoints;
        LayerOrder = layerOrder;
    }

    public PoseId Id { get; }
    public ModelRevisionReference Model { get; }
    /// <summary>Optimistic-concurrency revision of this editable pose, independent from the model revision.</summary>
    public Revision Revision { get; }
    public string Name { get; }
    public string? Category { get; }
    public ImmutableArray<PosePartTransform> PartTransforms { get; }
    public ImmutableArray<RigJoint> RigJoints { get; }
    /// <summary>Back-to-front order for this pose; it can differ from the referenced model revision.</summary>
    public ImmutableArray<ModelPartId> LayerOrder { get; }

    public static PoseDraft Create(ModelRevisionReference model, string name, IEnumerable<PosePartTransform> partTransforms,
        IEnumerable<RigJoint>? rigJoints = null, IEnumerable<ModelPartId>? layerOrder = null, string? category = null) =>
        Restore(PoseId.New(), model, Revision.Initial, name, partTransforms, rigJoints, layerOrder, category);

    public static PoseDraft CreateFromModelRevision(PublishedModelRevision modelRevision, string name)
    {
        ArgumentNullException.ThrowIfNull(modelRevision);
        return Create(ModelRevisionReference.From(modelRevision), name,
            modelRevision.Content.Parts.Select(part => PosePartTransform.Create(part.Id, part.Transform, part.IsVisible)),
            modelRevision.Content.RigJoints,
            modelRevision.Content.LayerOrder);
    }

    public static PoseDraft Restore(PoseId id, ModelRevisionReference model, Revision revision, string name,
        IEnumerable<PosePartTransform> partTransforms, IEnumerable<RigJoint>? rigJoints = null,
        IEnumerable<ModelPartId>? layerOrder = null, string? category = null)
    {
        if (!id.IsValid || !revision.IsValid)
        {
            throw new ArgumentException("A pose draft requires valid identities and a valid revision.");
        }
        ArgumentNullException.ThrowIfNull(model);
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var normalizedName = name.Trim();
        if (normalizedName.Length > 120)
        {
            throw new ArgumentOutOfRangeException(nameof(name), "A pose name cannot exceed 120 characters.");
        }
        var normalizedCategory = string.IsNullOrWhiteSpace(category) ? null : category.Trim();
        if (normalizedCategory?.Length > 64)
        {
            throw new ArgumentOutOfRangeException(nameof(category), "A pose category cannot exceed 64 characters.");
        }
        ArgumentNullException.ThrowIfNull(partTransforms);
        var transforms = partTransforms.ToImmutableArray();
        if (transforms.IsDefaultOrEmpty)
        {
            throw new ArgumentException("A pose draft must contain at least one part transform.", nameof(partTransforms));
        }
        if (transforms.Any(item => item is null) || transforms.Select(item => item.PartId).Distinct().Count() != transforms.Length)
        {
            throw new ArgumentException("A pose draft cannot contain null or duplicate part transforms.", nameof(partTransforms));
        }
        var joints = (rigJoints ?? []).ToImmutableArray();
        var order = (layerOrder ?? transforms.Select(item => item.PartId)).ToImmutableArray();
        if (order.Any(id => !id.IsValid) || order.Distinct().Count() != order.Length
            || !order.ToHashSet().SetEquals(transforms.Select(item => item.PartId)))
        {
            throw new ArgumentException("Pose layer order must contain every pose part exactly once.", nameof(layerOrder));
        }
        var partNodes = transforms.Select(item => TransformNodeId.From(item.PartId.Value));
        _ = RigSkeleton.Create(partNodes, joints);

        return new PoseDraft(id, model, revision, normalizedName, normalizedCategory, transforms, joints, order);
    }

    public PoseDraft WithTransforms(IEnumerable<PosePartTransform> partTransforms) =>
        WithContent(partTransforms, RigJoints, LayerOrder, Category);

    public PoseDraft WithContent(IEnumerable<PosePartTransform> partTransforms, IEnumerable<RigJoint> rigJoints,
        IEnumerable<ModelPartId> layerOrder, string? category) =>
        Restore(Id, Model, Revision.Next(), Name, partTransforms, rigJoints, layerOrder, category);

    /// <summary>Builds a preview snapshot after verifying that it is applying to the exact pinned model publication.</summary>
    public ModelDraftContent ApplyToModelRevision(PublishedModelRevision modelRevision)
    {
        ArgumentNullException.ThrowIfNull(modelRevision);
        if (Model != ModelRevisionReference.From(modelRevision))
        {
            throw new ArgumentException("The pose is pinned to a different model publication.", nameof(modelRevision));
        }

        var transforms = PartTransforms.ToDictionary(item => item.PartId);
        if (transforms.Count != modelRevision.Content.Parts.Length
            || modelRevision.Content.Parts.Any(part => !transforms.ContainsKey(part.Id)))
        {
            throw new ArgumentException("A pose must provide exactly one transform for every part in its model revision.", nameof(modelRevision));
        }

        var content = modelRevision.Content;
        return ModelDraftContent.Restore(
            content.SchemaVersion,
            content.ModelId,
            content.Revision,
            content.Slot,
            content.SourceAssetId,
            content.SourceWidth,
            content.SourceHeight,
            content.Parts.Select(part => part.WithTransform(transforms[part.Id].Transform).WithVisibility(transforms[part.Id].IsVisible)),
            LayerOrder,
            RigJoints);
    }
}
