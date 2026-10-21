using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using Xunit;

namespace GV5.Core.Tests;

public sealed class FaceCatalogDraftTests
{
    [Fact]
    public void FaceComponentsHaveIndependentStableTransformsAndCatalogRevisions()
    {
        var model = ModelRevisionReference.Restore(ModelId.New(), ModelRevisionId.New(), Revision.Initial, new string('a', 64));
        var asset = AssetId.New();
        var leftEye = FaceComponent.Create(FaceComponentKind.Eye, "Olho", asset, FaceComponentSide.Left, Transform2D.Identity);
        var rightEye = FaceComponent.Create(FaceComponentKind.Eye, "Olho", asset, FaceComponentSide.Right, Transform2D.Identity);
        var catalog = FaceCatalogDraft.Create(model, "Rosto padrão").WithComponent(leftEye).WithComponent(rightEye);

        var translated = new Transform2D(new Point2D(14, -8), new Point2D(1.2, 0.9), 0.15,
            new Point2D(3, 4), flipX: true);
        var changed = catalog.WithTransform(leftEye.Id, translated);

        Assert.Equal(Revision.Initial.Value + 2, catalog.Revision.Value);
        Assert.Equal(Revision.Initial.Value + 3, changed.Revision.Value);
        Assert.Equal(translated, changed.Components.Single(component => component.Id == leftEye.Id).Transform);
        Assert.Equal(Transform2D.Identity, changed.Components.Single(component => component.Id == rightEye.Id).Transform);
        Assert.Equal(model, changed.Model);
        Assert.Equal(leftEye.Id, changed.Components[0].Id);
    }

    [Fact]
    public void FaceCatalogSupportsRemovalVisibilityAndRejectsInvalidComponentContracts()
    {
        var model = ModelRevisionReference.Restore(ModelId.New(), ModelRevisionId.New(), Revision.Initial, new string('b', 64));
        var eye = FaceComponent.Create(FaceComponentKind.Eye, "Olho", AssetId.New(), FaceComponentSide.Left, Transform2D.Identity);
        var catalog = FaceCatalogDraft.Create(model, "Rosto").WithComponent(eye);
        var hidden = catalog.WithVisibility(eye.Id, false);
        Assert.False(hidden.Components.Single().IsVisible);
        Assert.Empty(hidden.WithoutComponent(eye.Id).Components);

        Assert.Throws<ArgumentException>(() => FaceComponent.Create(FaceComponentKind.Eye, "Olho", AssetId.New(), null, Transform2D.Identity));
        Assert.Throws<ArgumentException>(() => FaceComponent.Create(FaceComponentKind.Nose, "Nariz", AssetId.New(), FaceComponentSide.Left, Transform2D.Identity));
        Assert.Throws<ArgumentOutOfRangeException>(() => FaceComponent.Create(FaceComponentKind.Mouth, "Boca", AssetId.New(), null,
            new Transform2D(new Point2D(0, 0), new Point2D(double.NaN, 1), 0, Point2D.Zero)));
        Assert.Throws<ArgumentException>(() => FaceCatalogDraft.Restore(FaceId.New(), model, Revision.Initial, "Rosto", [eye, eye]));
    }

    [Fact]
    public void FacialDetailsHaveStableDefaultLayersAndCanBeReorderedExplicitly()
    {
        var model = ModelRevisionReference.Restore(ModelId.New(), ModelRevisionId.New(), Revision.Initial, new string('a', 64));
        var highlight = FaceComponent.Create(FaceComponentKind.EyeHighlight, "Brilho", AssetId.New(),
            FaceComponentSide.Left, Transform2D.Identity);
        var accessory = FaceComponent.Create(FaceComponentKind.HeadExtra, "Presilha", AssetId.New(), null, Transform2D.Identity);
        var catalog = FaceCatalogDraft.Create(model, "Detalhes").WithComponent(highlight).WithComponent(accessory);

        Assert.Equal(600, highlight.ZOrder);
        Assert.Equal(800, accessory.ZOrder);
        var reordered = catalog.WithComponentZOrder(highlight.Id, 875);
        Assert.Equal(875, reordered.Components.Single(component => component.Id == highlight.Id).ZOrder);
        Assert.Equal(875, reordered.Components.Single(component => component.Id == highlight.Id).WithTransform(Transform2D.Identity).ZOrder);
        Assert.Throws<ArgumentOutOfRangeException>(() => highlight.WithZOrder(10_001));
    }
}
