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

    private static ModelRevisionReference ModelReference(string hashPrefix) => ModelRevisionReference.Restore(
        ModelId.New(), ModelRevisionId.New(), Revision.Initial, hashPrefix.PadRight(64, '0'));

    private static Transform2D Transform(double x) =>
        new(new Point2D(x, 0), new Point2D(1, 1), 0, Point2D.Zero);
}
