using System.Collections.Immutable;
using GV5.Core.Identity;

namespace GV5.Core.Models;

/// <summary>Editable pose data pinned to one exact immutable model revision.</summary>
public sealed record PoseDraft
{
    public const int CurrentSchemaVersion = 1;

    private PoseDraft(PoseId id, ModelRevisionReference model, Revision revision, string name, ImmutableArray<PosePartTransform> partTransforms)
    {
        Id = id;
        Model = model;
        Revision = revision;
        Name = name;
        PartTransforms = partTransforms;
    }

    public PoseId Id { get; }
    public ModelRevisionReference Model { get; }
    /// <summary>Optimistic-concurrency revision of this editable pose, independent from the model revision.</summary>
    public Revision Revision { get; }
    public string Name { get; }
    public ImmutableArray<PosePartTransform> PartTransforms { get; }

    public static PoseDraft Create(ModelRevisionReference model, string name, IEnumerable<PosePartTransform> partTransforms) =>
        Restore(PoseId.New(), model, Revision.Initial, name, partTransforms);

    public static PoseDraft CreateFromModelRevision(PublishedModelRevision modelRevision, string name)
    {
        ArgumentNullException.ThrowIfNull(modelRevision);
        return Create(ModelRevisionReference.From(modelRevision), name,
            modelRevision.Content.Parts.Select(part => PosePartTransform.Create(part.Id, part.Transform)));
    }

    public static PoseDraft Restore(PoseId id, ModelRevisionReference model, Revision revision, string name, IEnumerable<PosePartTransform> partTransforms)
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

        return new PoseDraft(id, model, revision, normalizedName, transforms);
    }

    public PoseDraft WithTransforms(IEnumerable<PosePartTransform> partTransforms) =>
        Restore(Id, Model, Revision.Next(), Name, partTransforms);

    /// <summary>Builds a preview snapshot after verifying that it is applying to the exact pinned model publication.</summary>
    public ModelDraftContent ApplyToModelRevision(PublishedModelRevision modelRevision)
    {
        ArgumentNullException.ThrowIfNull(modelRevision);
        if (Model != ModelRevisionReference.From(modelRevision))
        {
            throw new ArgumentException("The pose is pinned to a different model publication.", nameof(modelRevision));
        }

        var transforms = PartTransforms.ToDictionary(item => item.PartId, item => item.Transform);
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
            content.Parts.Select(part => part.WithTransform(transforms[part.Id])),
            content.LayerOrder,
            content.RigJoints);
    }
}
