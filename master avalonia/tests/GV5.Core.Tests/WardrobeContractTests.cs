using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using Xunit;

namespace GV5.Core.Tests;

public sealed class WardrobeContractTests
{
    [Fact]
    public void WardrobeComponentAndRevisionIdsRoundTrip()
    {
        var componentId = WardrobeComponentId.New();
        var revisionId = WardrobeRevisionId.New();

        Assert.Equal(componentId, WardrobeComponentId.Parse(componentId.ToString()));
        Assert.Equal(revisionId, WardrobeRevisionId.Parse(revisionId.ToString()));
        Assert.Throws<ArgumentException>(() => WardrobeComponentId.From(Guid.Empty));
        Assert.Throws<ArgumentException>(() => WardrobeRevisionId.From(Guid.Empty));
    }

    [Fact]
    public void WardrobeSetPinsModelPublicationAndStartsAtRevisionOne()
    {
        var model = CreateModel();
        var set = WardrobeSet.Create(model, "  Conjunto base  ");

        Assert.Equal(model.ModelId, set.Model.ModelId);
        Assert.Equal(model.Id, set.Model.RevisionId);
        Assert.Equal(Revision.Initial, set.Revision);
        Assert.Equal("Conjunto base", set.Name);
        Assert.Empty(set.Components);
    }

    [Fact]
    public void ComponentRequiresAssetBoneAndMatchingFrozenBinding()
    {
        var boneId = ModelPartId.New();
        var frame = new WardrobeBoneFrame(boneId.ToString(), new Rect2D(10, 20, 30, 40), 15);
        var component = WardrobeComponent.Create("Camisa", WardrobeCategory.Shirt, boneId, AssetId.New(),
            new Rect2D(12, 24, 24, 30), 5, frame);

        Assert.Equal(boneId, component.BoneId);
        Assert.Equal(1, component.Binding.Version);
        Assert.Equal(boneId.ToString(), component.Binding.BoneId);
        Assert.Equal(Revision.Initial, WardrobeSet.Create(CreateModel(), "Teste").Revision);
        Assert.Throws<ArgumentException>(() => WardrobeComponent.Restore(component.Id, "Camisa",
            WardrobeCategory.Shirt, ModelPartId.New(), component.AssetId, component.Placement,
            component.RotationDegrees, component.Binding));
        Assert.Throws<ArgumentException>(() => WardrobeComponent.Restore(component.Id, "Camisa",
            WardrobeCategory.Shirt, boneId, AssetId.From(Guid.Empty), component.Placement,
            component.RotationDegrees, component.Binding));
    }

    [Fact]
    public void SetEditsAdvanceIndependentRevisionAndRejectDuplicateComponents()
    {
        var model = CreateModel();
        var set = WardrobeSet.Create(model, "Conjunto");
        var bone = model.Content.Parts[0];
        var component = WardrobeComponent.Create("Camisa", WardrobeCategory.Shirt, bone.Id, AssetId.New(),
            new Rect2D(0, 0, 16, 24), 0, BoneFrame(bone));
        var edited = set.WithContent("Conjunto", [component]);

        Assert.Equal(Revision.Initial, set.Revision);
        Assert.Equal(Revision.From(2), edited.Revision);
        Assert.Empty(set.Components);
        Assert.Same(component, Assert.Single(edited.Components));
        Assert.Throws<ArgumentException>(() => WardrobeSet.Restore(set.Id, set.Model, Revision.Initial,
            "Conjunto", [component, component]));
        Assert.Throws<ArgumentException>(() => WardrobeSet.Restore(set.Id, set.Model, Revision.Initial,
            "Conjunto", Enumerable.Repeat(component, WardrobeSet.MaximumComponents + 1)));
    }

    [Fact]
    public void PublicationIsImmutableAndRejectsEmptyOrInvalidHash()
    {
        var model = CreateModel();
        var part = model.Content.Parts[0];
        var component = WardrobeComponent.Create("Camisa", WardrobeCategory.Shirt, part.Id, AssetId.New(),
            new Rect2D(0, 0, 16, 24), 0, BoneFrame(part));
        var draft = WardrobeSet.Create(model, "Conjunto").WithContent("Conjunto", [component]);
        var published = PublishedWardrobeRevision.Snapshot(draft, Revision.Initial, 123, new string('A', 64));
        var edited = draft.WithContent("Conjunto atualizado", []);

        Assert.Equal(draft.Id, published.WardrobeId);
        Assert.Equal(draft.Revision, published.DraftRevision);
        Assert.Equal(new string('a', 64), published.SnapshotSha256);
        Assert.Same(component, Assert.Single(published.Components));
        Assert.Empty(edited.Components);
        Assert.Throws<ArgumentException>(() => PublishedWardrobeRevision.Snapshot(edited,
            Revision.From(2), 124, new string('b', 64)));
        Assert.Throws<ArgumentException>(() => PublishedWardrobeRevision.Snapshot(draft,
            Revision.From(2), 124, "invalid"));
    }

    [Fact]
    public void RestoredBindingRejectsUnsupportedOrNonFiniteGeometry()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => WardrobeBinding.Restore(2, "bone", 10, 10,
            0, 0, 0, 1, 1, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => WardrobeBinding.Restore(1, "bone", 0, 10,
            0, 0, 0, 1, 1, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => WardrobeBinding.Restore(1, "bone", 10, 10,
            double.NaN, 0, 0, 1, 1, 0));
    }

    private static WardrobeBoneFrame BoneFrame(ModelPart part)
    {
        var transform = part.SourceTransform.Transform;
        return new WardrobeBoneFrame(part.Id.ToString(), new Rect2D(transform.Translation.X,
            transform.Translation.Y, 20, 30), transform.RotationRadians * 180 / Math.PI);
    }

    private static PublishedModelRevision CreateModel()
    {
        var modelId = ModelId.New();
        var transform = new Transform2D(Point2D.Zero, new Point2D(1, 1), 0, Point2D.Zero);
        var crop = new Rect2D(0, 0, 20, 30);
        var part = new ModelPart(ModelPartId.New(), "Tronco", AssetId.New(), crop, transform,
            new ModelPartSourceTransform(crop, transform));
        var content = ModelDraftContent.Restore(ModelDraftContent.CurrentSchemaVersion, modelId, Revision.Initial,
            ModelSlot.From(1), AssetId.New(), 100, 100, [part], [part.Id]);
        return PublishedModelRevision.Restore(ModelRevisionId.New(), modelId, Revision.Initial,
            Revision.Initial, "Modelo", 1, new string('a', 64), content);
    }
}
