using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using Xunit;

namespace GV5.Core.Tests;

public sealed class WardrobePoseResolverTests
{
    [Fact]
    public void ResolveMapsGarmentToRotatedNonUniformPoseAndMirrorsItsLocalOffset()
    {
        var model = CreateModel();
        var part = model.Content.Parts[0];
        var sourceFrame = WardrobeBoneFrame.FromTransform(part.Id.ToString(),
            part.SourceTransform.Crop, part.SourceTransform.Transform);
        var component = WardrobeComponent.Create("Manga", WardrobeCategory.UpperSleeve, part.Id,
            AssetId.New(), new Rect2D(12, 9, 8, 10), 0, sourceFrame);
        var wardrobe = WardrobeSet.Create(model, "Uniforme").WithContent("Uniforme", [component]);
        var poseTransform = new Transform2D(new Point2D(100, 200), new Point2D(2, 3), Math.PI / 2,
            Point2D.Zero, flipX: true);
        var pose = PoseDraft.CreateFromModelRevision(model, "Espelhada").WithTransforms([
            PosePartTransform.Create(part.Id, poseTransform)
        ]);
        var projectedBone = WardrobeBoneFrame.FromTransform(part.Id.ToString(), part.SourceTransform.Crop, poseTransform);
        Assert.Equal(new Point2D(55, 180), projectedBone.Center);

        var resolved = Assert.Single(WardrobePoseResolver.Resolve(wardrobe, model, pose));

        Assert.Equal(component.Id, resolved.ComponentId);
        Assert.Equal(component.AssetId, resolved.AssetId);
        Assert.Equal(component.Category, resolved.Category);
        Assert.Equal(16, resolved.Placement.Bounds.Width, 9);
        Assert.Equal(30, resolved.Placement.Bounds.Height, 9);
        Assert.Equal(58, resolved.Placement.Bounds.X + resolved.Placement.Bounds.Width / 2, 8);
        Assert.Equal(168, resolved.Placement.Bounds.Y + resolved.Placement.Bounds.Height / 2, 8);
        Assert.Equal(270, resolved.Placement.RotationDegrees, 8);
        Assert.True(resolved.Placement.FlipX);
        Assert.Equal(new Rect2D(12, 9, 8, 10), Assert.Single(wardrobe.Components).Placement);
        Assert.Equal(Point2D.Zero, part.Transform.Translation);
    }

    [Fact]
    public void ResolveRejectsWardrobeOrPosePinnedToDifferentModelRevision()
    {
        var model = CreateModel();
        var part = model.Content.Parts[0];
        var frame = WardrobeBoneFrame.FromTransform(part.Id.ToString(), part.SourceTransform.Crop,
            part.SourceTransform.Transform);
        var component = WardrobeComponent.Create("Camisa", WardrobeCategory.Shirt, part.Id, AssetId.New(),
            new Rect2D(1, 2, 3, 4), 0, frame);
        var wardrobe = WardrobeSet.Create(model, "Conjunto").WithContent("Conjunto", [component]);

        var otherModel = CreateModel(modelId: model.ModelId, revisionId: ModelRevisionId.New(), sequence: Revision.From(2));
        var otherPose = PoseDraft.CreateFromModelRevision(otherModel, "Outra publicação");
        Assert.Throws<ArgumentException>(() => WardrobePoseResolver.Resolve(wardrobe, model, otherPose));
    }

    private static PublishedModelRevision CreateModel(ModelId? modelId = null, ModelRevisionId? revisionId = null,
        Revision? sequence = null)
    {
        var id = modelId ?? ModelId.New();
        var transform = new Transform2D(Point2D.Zero, new Point2D(1, 1), 0, Point2D.Zero);
        var crop = new Rect2D(0, 0, 20, 30);
        var part = new ModelPart(ModelPartId.New(), "Tronco", AssetId.New(), crop, transform,
            new ModelPartSourceTransform(crop, transform));
        var content = ModelDraftContent.Restore(ModelDraftContent.CurrentSchemaVersion, id, Revision.Initial,
            ModelSlot.From(1), AssetId.New(), 100, 100, [part], [part.Id]);
        return PublishedModelRevision.Restore(revisionId ?? ModelRevisionId.New(), id, sequence ?? Revision.Initial,
            Revision.Initial, "Modelo", 1, new string('a', 64), content);
    }
}
