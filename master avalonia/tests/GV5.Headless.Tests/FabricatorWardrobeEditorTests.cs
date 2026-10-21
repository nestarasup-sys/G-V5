using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using GV5.Modules.Fabricador.Interaction;
using Xunit;

namespace GV5.Headless.Tests;

public sealed class FabricatorWardrobeEditorTests
{
    [Fact]
    public void MoveScaleRotateAndRebindCreateNewDraftRevisionsWithoutMutatingSource()
    {
        var model = CreateModel();
        var bone = model.Content.Parts[0];
        var component = WardrobeComponent.Create("Camisa", WardrobeCategory.Shirt, bone.Id, AssetId.New(),
            new Rect2D(12, 15, 40, 50), 0, CreateBoneFrame(bone));
        var originalSet = WardrobeSet.Create(model, "Roupa").WithContent("Roupa", [component]);
        var editor = new WardrobeComponentEditorSession(originalSet, model);
        editor.Select(component.Id);

        editor.MoveBy(component.Id, new Point2D(10, -5));
        var moved = editor.Draft.Components.Single();
        Assert.Equal(Revision.From(3), editor.Draft.Revision);
        Assert.Equal(new Rect2D(22, 10, 40, 50), moved.Placement);
        Assert.NotEqual(component.Binding.LocalCenterX, moved.Binding.LocalCenterX);

        editor.ScaleBy(component.Id, 2, .5);
        var scaled = editor.Draft.Components.Single();
        Assert.Equal(Revision.From(4), editor.Draft.Revision);
        Assert.Equal(new Rect2D(2, 22.5, 80, 25), scaled.Placement);
        Assert.Equal(2, scaled.Binding.WidthRatio / moved.Binding.WidthRatio, precision: 8);
        Assert.Equal(.5, scaled.Binding.HeightRatio / moved.Binding.HeightRatio, precision: 8);

        editor.RotateTo(component.Id, 37.5);
        var rotated = editor.Draft.Components.Single();
        Assert.Equal(Revision.From(5), editor.Draft.Revision);
        Assert.Equal(37.5, rotated.RotationDegrees);
        Assert.Equal(37.5, rotated.Binding.RelativeRotationDegrees);
        Assert.Equal(Revision.From(2), originalSet.Revision);
        Assert.Same(component, Assert.Single(originalSet.Components));
    }

    [Fact]
    public void AttachToBonePreservesPlacementAndCapturesTargetBoneFrame()
    {
        var model = CreateModel();
        var sourceBone = model.Content.Parts[0];
        var targetBone = model.Content.Parts[1];
        var component = WardrobeComponent.Create("Luva", WardrobeCategory.Gloves, sourceBone.Id, AssetId.New(),
            new Rect2D(3, 4, 15, 12), 8, CreateBoneFrame(sourceBone));
        var set = WardrobeSet.Create(model, "Acessórios").WithContent("Acessórios", [component]);
        var editor = new WardrobeComponentEditorSession(set, model);

        editor.AttachToBone(component.Id, targetBone.Id);

        var attached = editor.Draft.Components.Single();
        Assert.Equal(targetBone.Id, attached.BoneId);
        Assert.Equal(targetBone.Id.ToString(), attached.Binding.BoneId);
        Assert.Equal(component.Placement, attached.Placement);
        Assert.Equal(component.RotationDegrees, attached.RotationDegrees);
        Assert.NotEqual(component.Binding.BoneWidth, attached.Binding.BoneWidth);
        Assert.Equal(Revision.From(3), editor.Draft.Revision);
    }

    [Fact]
    public void EditorRejectsDifferentModelPublicationUnknownBoneAndInvalidScale()
    {
        var model = CreateModel();
        var bone = model.Content.Parts[0];
        var component = WardrobeComponent.Create("Camisa", WardrobeCategory.Shirt, bone.Id, AssetId.New(),
            new Rect2D(0, 0, 10, 10), 0, CreateBoneFrame(bone));
        var set = WardrobeSet.Create(model, "Roupa").WithContent("Roupa", [component]);

        Assert.Throws<ArgumentException>(() => new WardrobeComponentEditorSession(set, CreateModel()));
        var editor = new WardrobeComponentEditorSession(set, model);
        Assert.Throws<KeyNotFoundException>(() => editor.AttachToBone(component.Id, ModelPartId.New()));
        Assert.Throws<ArgumentOutOfRangeException>(() => editor.ScaleBy(component.Id, 0, 1));
        Assert.Throws<ArgumentOutOfRangeException>(() => editor.RotateTo(component.Id, double.NaN));
        Assert.Equal(set.Revision, editor.Draft.Revision);
    }

    private static WardrobeBoneFrame CreateBoneFrame(ModelPart part)
    {
        var source = part.SourceTransform;
        var transform = source.Transform;
        var center = transform.Apply(new Point2D(source.Crop.X + source.Crop.Width / 2,
            source.Crop.Y + source.Crop.Height / 2));
        var width = source.Crop.Width * transform.Scale.X;
        var height = source.Crop.Height * transform.Scale.Y;
        return new WardrobeBoneFrame(part.Id.ToString(),
            new Rect2D(center.X - width / 2, center.Y - height / 2, width, height),
            transform.RotationRadians * 180 / Math.PI, transform.FlipX, transform.FlipY);
    }

    private static PublishedModelRevision CreateModel()
    {
        var modelId = ModelId.New();
        var torso = CreatePart("Tronco", new Transform2D(new Point2D(10, 20), new Point2D(1, 1), 0, Point2D.Zero));
        var arm = CreatePart("Braço", new Transform2D(new Point2D(70, 20), new Point2D(1.5, .8), .25, Point2D.Zero));
        var content = ModelDraftContent.Restore(ModelDraftContent.CurrentSchemaVersion, modelId, Revision.Initial,
            ModelSlot.From(1), AssetId.New(), 120, 100, [torso, arm], [torso.Id, arm.Id]);
        return PublishedModelRevision.Restore(ModelRevisionId.New(), modelId, Revision.Initial, Revision.Initial,
            "Modelo", 10, new string('c', 64), content);
    }

    private static ModelPart CreatePart(string name, Transform2D transform)
    {
        var crop = new Rect2D(0, 0, 20, 30);
        return new ModelPart(ModelPartId.New(), name, AssetId.New(), crop, transform,
            new ModelPartSourceTransform(crop, transform));
    }
}
