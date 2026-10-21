using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using GV5.Rendering;
using Xunit;

namespace GV5.Rendering.Tests;

public sealed class FaceRenderSceneBuilderTests
{
    [Fact]
    public void Build_ComposesLinkedEyesMirroredAndOnlySelectedMouthVariantInStableOrder()
    {
        var model = ModelRevisionReference.Restore(ModelId.New(), ModelRevisionId.New(), Revision.Initial, new string('d', 64));
        var eyeAsset = AssetId.New();
        var pupilAsset = AssetId.New();
        var noseAsset = AssetId.New();
        var mouthClosedAsset = AssetId.New();
        var mouthOpenAsset = AssetId.New();
        var leftEye = FaceComponent.Create(FaceComponentKind.Eye, "Olho", eyeAsset, FaceComponentSide.Left,
            Transform2D.Identity);
        var leftPupil = FaceComponent.Create(FaceComponentKind.Pupil, "Pupila", pupilAsset, FaceComponentSide.Left,
            new Transform2D(new Point2D(2, -1), new Point2D(1, 1), 0, new Point2D(3, 3)));
        var nose = FaceComponent.Create(FaceComponentKind.Nose, "Nariz", noseAsset, null, Transform2D.Identity);
        var mouthClosed = FaceComponent.Create(FaceComponentKind.Mouth, "Boca fechada", mouthClosedAsset, null,
            Transform2D.Identity);
        var mouthOpen = FaceComponent.Create(FaceComponentKind.Mouth, "Boca aberta", mouthOpenAsset, null,
            Transform2D.Identity, mouthVariant: FaceMouthVariant.Open);
        var catalog = FaceCatalogDraft.Create(model, "Rosto").WithComponent(leftEye).WithComponent(leftPupil)
            .WithComponent(nose).WithComponent(mouthClosed).WithComponent(mouthOpen);
        var assembly = FaceAssembly.Create(catalog).SetEyeSidesLinked(catalog, true)
            .Select(catalog, leftEye.Id).Select(catalog, leftPupil.Id).Select(catalog, nose.Id)
            .Select(catalog, mouthClosed.Id).Select(catalog, mouthOpen.Id)
            .SetEyeMode(catalog, FaceEyeMode.Open).SetMouthMode(catalog, FaceMouthMode.Open);
        var crops = new Dictionary<AssetId, Rect2D>
        {
            [eyeAsset] = new Rect2D(0, 0, 10, 8),
            [pupilAsset] = new Rect2D(0, 0, 4, 4),
            [noseAsset] = new Rect2D(0, 0, 3, 4),
            [mouthClosedAsset] = new Rect2D(0, 0, 6, 3),
            [mouthOpenAsset] = new Rect2D(0, 0, 6, 5)
        };

        var first = FaceRenderSceneBuilder.Build(catalog, assembly, crops, firstZOrder: 50);
        var second = FaceRenderSceneBuilder.Build(catalog, assembly, crops, firstZOrder: 50);

        Assert.Equal(new[] { eyeAsset, eyeAsset, pupilAsset, pupilAsset, noseAsset, mouthOpenAsset },
            first.Select(layer => layer.AssetId));
        Assert.Equal(6, first.Count);
        Assert.False(first[0].Transform.FlipX);
        Assert.True(first[1].Transform.FlipX);
        Assert.Equal(new Point2D(2, -1), first[3].Transform.Translation);
        Assert.Equal(new[] { 150, 150, 250, 250, 450, 550 }, first.Select(layer => layer.ZOrder));
        Assert.Equal(first.Select(layer => layer.Id), second.Select(layer => layer.Id));
        Assert.DoesNotContain(first, layer => layer.AssetId == mouthClosedAsset);
    }

    [Fact]
    public void Build_UsesClosedEyeModeAndRejectsStaleCatalogOrMissingAssetCrop()
    {
        var model = ModelRevisionReference.Restore(ModelId.New(), ModelRevisionId.New(), Revision.Initial, new string('e', 64));
        var closedAsset = AssetId.New();
        var closedEye = FaceComponent.Create(FaceComponentKind.ClosedEye, "Olho fechado", closedAsset,
            FaceComponentSide.Right, Transform2D.Identity);
        var catalog = FaceCatalogDraft.Create(model, "Rosto").WithComponent(closedEye);
        var assembly = FaceAssembly.Create(catalog).Select(catalog, closedEye.Id)
            .SetEyeMode(catalog, FaceEyeMode.Closed);
        var layers = FaceRenderSceneBuilder.Build(catalog, assembly,
            new Dictionary<AssetId, Rect2D> { [closedAsset] = new Rect2D(0, 0, 5, 4) });
        Assert.Single(layers);

        var changed = catalog.WithComponent(FaceComponent.Create(FaceComponentKind.Nose, "Nariz", AssetId.New(), null,
            Transform2D.Identity));
        Assert.Throws<ArgumentException>(() => FaceRenderSceneBuilder.Build(changed, assembly,
            new Dictionary<AssetId, Rect2D>()));
        Assert.Throws<ArgumentException>(() => FaceRenderSceneBuilder.Build(catalog, assembly,
            new Dictionary<AssetId, Rect2D>()));
    }

    [Fact]
    public void Build_ComposesDetailsInExplicitZOrderAndKeepsLayerIdsStable()
    {
        var model = ModelRevisionReference.Restore(ModelId.New(), ModelRevisionId.New(), Revision.Initial, new string('f', 64));
        var baseAsset = AssetId.New();
        var highlightAsset = AssetId.New();
        var blushAsset = AssetId.New();
        var extraAsset = AssetId.New();
        var baseEye = FaceComponent.Create(FaceComponentKind.Eye, "Olho", baseAsset, FaceComponentSide.Left, Transform2D.Identity, zOrder: 100);
        var highlight = FaceComponent.Create(FaceComponentKind.EyeHighlight, "Brilho", highlightAsset, FaceComponentSide.Left,
            Transform2D.Identity, zOrder: 900);
        var blush = FaceComponent.Create(FaceComponentKind.Blush, "Blush", blushAsset, null, Transform2D.Identity, zOrder: 300);
        var extra = FaceComponent.Create(FaceComponentKind.HeadExtra, "Presilha", extraAsset, null, Transform2D.Identity, zOrder: 700);
        var catalog = FaceCatalogDraft.Create(model, "Rosto");
        foreach (var component in new[] { baseEye, highlight, blush, extra }) catalog = catalog.WithComponent(component);
        var assembly = FaceAssembly.Create(catalog).Select(catalog, baseEye.Id).Select(catalog, highlight.Id)
            .Select(catalog, blush.Id).Select(catalog, extra.Id);
        var crops = new Dictionary<AssetId, Rect2D>
        {
            [baseAsset] = new Rect2D(0, 0, 8, 8), [highlightAsset] = new Rect2D(0, 0, 2, 2),
            [blushAsset] = new Rect2D(0, 0, 3, 2), [extraAsset] = new Rect2D(0, 0, 4, 4)
        };

        var layers = FaceRenderSceneBuilder.Build(catalog, assembly, crops, firstZOrder: 20);
        Assert.Equal(new[] { baseAsset, blushAsset, extraAsset, highlightAsset }, layers.Select(layer => layer.AssetId));
        Assert.Equal(new[] { 120, 320, 720, 920 }, layers.Select(layer => layer.ZOrder));
        Assert.Equal(layers.Select(layer => layer.Id), FaceRenderSceneBuilder.Build(catalog, assembly, crops, 20).Select(layer => layer.Id));
    }
}
