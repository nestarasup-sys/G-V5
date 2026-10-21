using GV5.Core.Identity;
using GV5.Geometry;
using GV5.Rendering;
using Xunit;

namespace GV5.Rendering.Tests;

public sealed class RenderSceneTests
{
    [Fact]
    public void SceneCopiesLayersAndSortsBackToFrontWithStableZOrderTies()
    {
        var first = Layer(zOrder: 2);
        var second = Layer(zOrder: -1);
        var third = Layer(zOrder: 2);
        var source = new List<RenderLayer> { first, second, third };
        var scene = new RenderScene(SceneId.New(), 1920, 1080, source);
        source.Clear();

        Assert.Equal([second.Id, first.Id, third.Id], scene.Layers.Select(layer => layer.Id));
        Assert.Equal(3, scene.Layers.Length);
    }

    [Fact]
    public void LayerRetainsAssetCropTransformAlphaBlendAndFlipAsImmutableValues()
    {
        var transform = new Transform2D(new Point2D(10, 20), new Point2D(2, 0.5), Math.PI / 4, new Point2D(4, 5), flipX: true);
        var layer = Layer(transform: transform, alpha: 0.35, blendMode: RenderBlendMode.Multiply);

        Assert.True(layer.AssetId.IsValid);
        Assert.Equal(new Rect2D(0, 0, 80, 120), layer.Crop);
        Assert.Equal(transform, layer.Transform);
        Assert.True(layer.Transform.FlipX);
        Assert.Equal(0.35, layer.Alpha);
        Assert.Equal(RenderBlendMode.Multiply, layer.BlendMode);
    }

    [Fact]
    public void SceneRejectsInvalidDimensionsAndDuplicateLayers()
    {
        var first = Layer();

        Assert.Throws<ArgumentOutOfRangeException>(() => new RenderScene(SceneId.New(), 0, 10, []));
        Assert.Throws<ArgumentOutOfRangeException>(() => new RenderScene(SceneId.New(), 10, -1, []));
        Assert.Throws<ArgumentException>(() => new RenderScene(SceneId.New(), 10, 10, [first, first]));
    }

    [Fact]
    public void LayerRejectsInvalidAssetCropAlphaAndBlendMode()
    {
        var id = RenderLayerId.New();
        var transform = Transform2D.Identity;
        var crop = new Rect2D(0, 0, 10, 10);

        Assert.Throws<ArgumentException>(() => new RenderLayer(id, default, crop, transform, 1, RenderBlendMode.Normal, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => Layer(crop: new Rect2D(0, 0, 0, 10)));
        Assert.Throws<ArgumentOutOfRangeException>(() => Layer(alpha: double.NaN));
        Assert.Throws<ArgumentOutOfRangeException>(() => Layer(alpha: 1.01));
        Assert.Throws<ArgumentOutOfRangeException>(() => Layer(blendMode: (RenderBlendMode)99));
    }

    [Fact]
    public void BodyBuilderUsesExplicitOrderSkipsUnknownAndDuplicateIdsThenAppendsMissingParts()
    {
        var head = Part("head");
        var torso = Part("torso");
        var arm = Part("arm");
        var scene = BodyRenderSceneBuilder.Build(
            SceneId.New(),
            400,
            600,
            [head, torso, arm],
            layerOrder: ["torso", "missing", "torso", "head"]);

        Assert.Equal([torso.LayerId, head.LayerId, arm.LayerId], scene.Layers.Select(layer => layer.Id));
        Assert.Equal([0, 1, 2], scene.Layers.Select(layer => layer.ZOrder));
    }

    [Fact]
    public void BodyBuilderExcludesHiddenPartsWithoutReorderingVisibleLayers()
    {
        var head = Part("head");
        var torso = Part("torso");
        var arm = Part("arm");
        var scene = BodyRenderSceneBuilder.Build(
            SceneId.New(),
            400,
            600,
            [head, torso, arm],
            layerOrder: ["arm", "torso", "head"],
            hiddenPartIds: new HashSet<string>(["torso"], StringComparer.Ordinal));

        Assert.Equal([arm.LayerId, head.LayerId], scene.Layers.Select(layer => layer.Id));
        Assert.Equal([0, 2], scene.Layers.Select(layer => layer.ZOrder));
    }

    [Fact]
    public void BodyBuilderRejectsDuplicatePartIds()
    {
        var first = Part("torso");
        var second = Part("torso");

        Assert.Throws<ArgumentException>(() => BodyRenderSceneBuilder.Build(SceneId.New(), 100, 100, [first, second]));
    }

    private static RenderLayer Layer(
        int zOrder = 0,
        Transform2D? transform = null,
        double alpha = 1,
        RenderBlendMode blendMode = RenderBlendMode.Normal,
        Rect2D? crop = null,
        RenderLayerId? id = null) => new(
            id ?? RenderLayerId.New(),
            AssetId.New(),
            crop ?? new Rect2D(0, 0, 80, 120),
            transform ?? Transform2D.Identity,
            alpha,
            blendMode,
            zOrder);

    private static BodyPartRenderSource Part(string partId) => new(
        partId,
        RenderLayerId.New(),
        AssetId.New(),
        new Rect2D(0, 0, 80, 120),
        Transform2D.Identity);
}
