using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using Xunit;

namespace GV5.Core.Tests;

public sealed class FaceExpressionPresetDraftTests
{
    [Fact]
    public void CollectionAndPresetAreTypedModelScopedAndPreservePrivateEffectColor()
    {
        var model = ModelRevisionReference.Restore(ModelId.New(), ModelRevisionId.New(), Revision.Initial, new string('1', 64));
        var collection = FaceExpressionCollection.Create(model, "Expressões", 100);
        var eye = FaceComponent.Create(FaceComponentKind.Eye, "Olho", AssetId.New(), FaceComponentSide.Left, Transform2D.Identity);
        var mouth = FaceComponent.Create(FaceComponentKind.Mouth, "Boca", AssetId.New(), null, Transform2D.Identity);
        var catalog = FaceCatalogDraft.Create(model, "Face").WithComponent(eye).WithComponent(mouth);
        var assembly = FaceAssembly.Create(catalog).Select(catalog, eye.Id).Select(catalog, mouth.Id);
        var preset = FaceExpressionPresetDraft.Create(collection, catalog, 12, "Irritada", assembly);

        Assert.Equal(Revision.Initial, preset.Revision);
        Assert.Equal(collection.Id, preset.CollectionId);
        Assert.Equal(catalog.Id, preset.FaceId);
        Assert.Equal(12, preset.ExpressionIndex);
        Assert.Equal(Transform2D.Identity, preset.ReferenceTransforms[FaceAssemblySlot.EyeLeft]);
        Assert.Equal(FaceExpressionEffects.LegacyDefaults.Blush.Color, preset.Effects.Blush.Color);
        var changedEffects = FaceExpressionEffects.Create(preset.Effects.Shadow,
            FaceExpressionEffectParameters.Create(true, "#ff0080", 0.6, 0.5, 0.7, 0.1,
                style: FaceExpressionEffectStyle.Cheeks), preset.Effects.MouthBlush);
        Assert.Equal("#ff0080", preset.WithEffects(changedEffects).Effects.Blush.Color);
        Assert.Equal(Revision.Initial.Value + 1, collection.WithName("  Expressões Dev  ", 120).Revision.Value);
        Assert.Throws<ArgumentOutOfRangeException>(() => FaceExpressionPresetDraft.Create(collection, catalog, 1000, "Índice inválido"));
    }

    [Fact]
    public void RebaseKeepsAuthoredTransformDeltaAndRejectsIncompleteReferenceMaps()
    {
        var model = ModelRevisionReference.Restore(ModelId.New(), ModelRevisionId.New(), Revision.Initial, new string('2', 64));
        var collection = FaceExpressionCollection.Create(model, "Expressões", 100);
        var source = FaceComponent.Create(FaceComponentKind.Eye, "Olho", AssetId.New(), FaceComponentSide.Left, Transform2D.Identity);
        var catalog = FaceCatalogDraft.Create(model, "Face").WithComponent(source);
        var assembly = FaceAssembly.Create(catalog).Select(catalog, source.Id);
        var authored = new Transform2D(new Point2D(5, 2), new Point2D(1.2, 0.8), 0.5, Point2D.Zero, flipX: true);
        var preset = FaceExpressionPresetDraft.Create(collection, catalog, 0, "Normal", assembly)
            .WithTransform(FaceAssemblySlot.EyeLeft, authored);
        var rebasedReference = new Transform2D(new Point2D(10, 20), new Point2D(2, 3), 1, new Point2D(4, 4));
        var updatedCatalog = catalog.WithTransform(source.Id, rebasedReference);
        var rebased = preset.RebaseReferenceTransforms(updatedCatalog);
        Assert.Equal(new Point2D(15, 22), rebased.Transforms[FaceAssemblySlot.EyeLeft].Translation);
        Assert.Equal(2.4, rebased.Transforms[FaceAssemblySlot.EyeLeft].Scale.X, 10);
        Assert.Equal(2.4, rebased.Transforms[FaceAssemblySlot.EyeLeft].Scale.Y, 10);
        Assert.Equal(1.5, rebased.Transforms[FaceAssemblySlot.EyeLeft].RotationRadians, 10);
        Assert.Equal(new Point2D(4, 4), rebased.Transforms[FaceAssemblySlot.EyeLeft].Pivot);
        Assert.True(rebased.Transforms[FaceAssemblySlot.EyeLeft].FlipX);
        Assert.Equal(updatedCatalog.Revision, rebased.FaceRevision);
        var removedCatalog = updatedCatalog.WithoutComponent(source.Id);
        Assert.Throws<ArgumentException>(() => preset.RebaseReferenceTransforms(removedCatalog));
    }
}
