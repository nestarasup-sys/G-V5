using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using GV5.Rendering;
using Xunit;

namespace GV5.Rendering.Tests;

public sealed class ModelDraftRenderSceneBuilderTests
{
    [Fact]
    public void BuildUsesBoundedSourceSceneWhenDraftHasNoSeparatedParts()
    {
        var modelId = ModelId.New();
        var assetId = AssetId.New();
        var content = ModelDraftContent.Restore(
            ModelDraftContent.CurrentSchemaVersion,
            modelId,
            Revision.Initial,
            null,
            assetId,
            4096,
            2048,
            [],
            []);

        var scene = ModelDraftRenderSceneBuilder.Build(content);

        Assert.Equal(2048, scene.Width);
        Assert.Equal(1024, scene.Height);
        var layer = Assert.Single(scene.Layers);
        Assert.Equal(assetId, layer.AssetId);
        Assert.Equal(new Rect2D(0, 0, 4096, 2048), layer.Crop);
        Assert.Equal(new Point2D(0.5, 0.5), layer.Transform.Scale);
    }

    [Fact]
    public void BuildUsesPersistedLayerOrderTransformsAndVisibilityForSeparatedParts()
    {
        var sourceId = AssetId.New();
        var visibleAsset = AssetId.New();
        var hiddenAsset = AssetId.New();
        var visibleId = ModelPartId.New();
        var hiddenId = ModelPartId.New();
        var visibleTransform = new Transform2D(new Point2D(120, 80), new Point2D(1.5, 2), 0.25, new Point2D(10, 20), flipX: true);
        var visible = new ModelPart(
            visibleId,
            "Braço",
            visibleAsset,
            new Rect2D(120, 80, 64, 96),
            visibleTransform,
            new ModelPartSourceTransform(new Rect2D(120, 80, 64, 96), Transform2D.Identity));
        var hidden = new ModelPart(
            hiddenId,
            "Perna",
            hiddenAsset,
            new Rect2D(0, 0, 80, 120),
            Transform2D.Identity,
            new ModelPartSourceTransform(new Rect2D(0, 0, 80, 120), Transform2D.Identity),
            isVisible: false);
        var content = ModelDraftContent.Restore(
            ModelDraftContent.CurrentSchemaVersion,
            ModelId.New(),
            Revision.Initial,
            null,
            sourceId,
            4096,
            2048,
            [hidden, visible],
            [hiddenId, visibleId]);

        var scene = ModelDraftRenderSceneBuilder.Build(content);

        var layer = Assert.Single(scene.Layers);
        Assert.Equal(visibleAsset, layer.AssetId);
        Assert.Equal(1, layer.ZOrder);
        Assert.Equal(new Rect2D(0, 0, 64, 96), layer.Crop);
        Assert.Equal(new Point2D(55, 30), layer.Transform.Translation);
        Assert.Equal(new Point2D(0.75, 1), layer.Transform.Scale);
        Assert.Equal(new Point2D(10, 20), layer.Transform.Pivot);
        Assert.True(layer.Transform.FlipX);
        Assert.Equal(0.25, layer.Transform.RotationRadians);

        var originalPoint = visibleTransform.Apply(new Point2D(14, 28));
        var expectedPreviewPoint = new Point2D(originalPoint.X * 0.5, originalPoint.Y * 0.5);
        var actualPreviewPoint = layer.Transform.Apply(new Point2D(14, 28));
        Assert.Equal(expectedPreviewPoint.X, actualPreviewPoint.X, precision: 6);
        Assert.Equal(expectedPreviewPoint.Y, actualPreviewPoint.Y, precision: 6);
    }

    [Fact]
    public void BuildRejectsDraftWithoutPublishedSourceImage()
    {
        var content = ModelDraftContent.CreateEmpty(ModelId.New(), Revision.Initial);

        Assert.Throws<ArgumentException>(() => ModelDraftRenderSceneBuilder.Build(content));
    }
}
