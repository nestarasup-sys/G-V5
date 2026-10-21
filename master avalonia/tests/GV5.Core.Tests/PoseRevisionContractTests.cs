using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using Xunit;

namespace GV5.Core.Tests;

public sealed class PoseRevisionContractTests
{
    [Fact]
    public void DraftAndPublishedPoseRemainPinnedToExactModelPublication()
    {
        var modelReference = ModelReference("a");
        var firstPart = PosePartTransform.Create(ModelPartId.New(), Transform(2));
        var secondPart = PosePartTransform.Create(ModelPartId.New(), Transform(4));
        var draft = PoseDraft.Create(modelReference, "  Sentada  ", [firstPart, secondPart]);
        var published = PublishedPoseRevision.Snapshot(draft, Revision.Initial, 1234, new string('b', 64));

        Assert.Equal("Sentada", draft.Name);
        Assert.Equal(Revision.Initial, draft.Revision);
        Assert.Equal(modelReference, draft.Model);
        Assert.Equal(modelReference, published.Model);
        Assert.Equal(draft.Id, published.PoseId);
        Assert.Equal(draft.Revision, published.DraftRevision);
        Assert.Equal(draft.PartTransforms, published.PartTransforms);
        Assert.Equal(new string('b', 64), published.SnapshotSha256);

        var laterModelRevision = ModelReference("c");
        var edited = draft.WithTransforms([firstPart]);
        Assert.Equal(Revision.From(2), edited.Revision);
        Assert.Equal(modelReference, edited.Model);
        Assert.NotEqual(laterModelRevision, edited.Model);
        Assert.Equal(2, draft.PartTransforms.Length);
    }

    [Fact]
    public void DraftRejectsDuplicatePartTransformsAndInvalidModelReferences()
    {
        var part = PosePartTransform.Create(ModelPartId.New(), Transform(0));
        var model = ModelReference("d");

        Assert.Throws<ArgumentException>(() => PoseDraft.Create(model, "Duplicada", [part, part]));
        Assert.Throws<ArgumentException>(() => ModelRevisionReference.Restore(
            ModelId.New(), ModelRevisionId.New(), Revision.Initial, "not-a-hash"));
        Assert.Throws<ArgumentException>(() => PosePartTransform.Create(default, Transform(0)));
    }

    [Fact]
    public void PublishedPoseRejectsInvalidSnapshotHashAndEmptyTransformSet()
    {
        var draft = PoseDraft.Create(ModelReference("e"), "Em pé", [PosePartTransform.Create(ModelPartId.New(), Transform(0))]);

        Assert.Throws<ArgumentException>(() => PublishedPoseRevision.Snapshot(draft, Revision.Initial, 10, "bad"));
        Assert.Throws<ArgumentException>(() => PublishedPoseRevision.Restore(
            PoseRevisionId.New(), draft.Id, Revision.Initial, draft.Revision, draft.Model,
            draft.Name, 10, new string('f', 64), []));
    }

    [Fact]
    public void PoseCreatedFromPublishedModelBuildsNonDestructivePreviewAndRejectsAnotherRevision()
    {
        var model = PublishedModel();
        var draft = PoseDraft.CreateFromModelRevision(model, "Pose inicial");
        var originalPart = model.Content.Parts[0];
        var changedTransform = Transform(12);
        var edited = draft.WithTransforms(draft.PartTransforms.Select(item => item.PartId == originalPart.Id
            ? PosePartTransform.Create(item.PartId, changedTransform)
            : item));

        var preview = edited.ApplyToModelRevision(model);
        Assert.Equal(changedTransform, preview.Parts.Single(part => part.Id == originalPart.Id).Transform);
        Assert.Equal(originalPart.SourceTransform, preview.Parts.Single(part => part.Id == originalPart.Id).SourceTransform);
        Assert.Equal(originalPart.Transform, model.Content.Parts.Single(part => part.Id == originalPart.Id).Transform);

        var differentPublication = PublishedModel(model.ModelId, Revision.From(2), new string('9', 64));
        Assert.Throws<ArgumentException>(() => edited.ApplyToModelRevision(differentPublication));
    }

    private static ModelRevisionReference ModelReference(string hashPrefix) => ModelRevisionReference.Restore(
        ModelId.New(), ModelRevisionId.New(), Revision.Initial, hashPrefix.PadRight(64, '0'));

    private static Transform2D Transform(double x) =>
        new(new Point2D(x, 0), new Point2D(1, 1), 0, Point2D.Zero);

    private static PublishedModelRevision PublishedModel(ModelId? id = null, Revision? revision = null, string? hash = null)
    {
        var modelId = id ?? ModelId.New();
        var parts = new[]
        {
            CreatePart("Tronco", Transform(0)),
            CreatePart("Braço", Transform(20))
        };
        var content = ModelDraftContent.Restore(
            ModelDraftContent.CurrentSchemaVersion,
            modelId,
            Revision.Initial,
            ModelSlot.From(1),
            AssetId.New(),
            100,
            100,
            parts,
            parts.Select(part => part.Id));
        return PublishedModelRevision.Restore(
            ModelRevisionId.New(),
            modelId,
            revision ?? Revision.Initial,
            Revision.Initial,
            "Modelo teste",
            100,
            hash ?? new string('a', 64),
            content);
    }

    private static ModelPart CreatePart(string name, Transform2D transform)
    {
        var crop = new Rect2D(0, 0, 10, 10);
        return new ModelPart(ModelPartId.New(), name, AssetId.New(), crop, transform,
            new ModelPartSourceTransform(crop, transform));
    }
}
