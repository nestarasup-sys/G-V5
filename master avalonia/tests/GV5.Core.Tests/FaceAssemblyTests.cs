using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using Xunit;

namespace GV5.Core.Tests;

public sealed class FaceAssemblyTests
{
    [Fact]
    public void LinkedEyeAndBrowSidesMirrorSelectedComponentAndMouthModesAreSeparate()
    {
        var catalog = CreateCatalog(out var ids);
        var assembly = FaceAssembly.Create(catalog)
            .SetEyeSidesLinked(catalog, true)
            .SetEyebrowSidesLinked(catalog, true)
            .Select(catalog, ids.LeftEye)
            .Select(catalog, ids.LeftBrow)
            .Select(catalog, ids.MouthOpen)
            .SetEyeMode(catalog, FaceEyeMode.Closed)
            .SetMouthMode(catalog, FaceMouthMode.Open);

        Assert.Equal(ids.LeftEye, assembly.Selections[FaceAssemblySlot.EyeLeft]);
        Assert.Equal(ids.LeftEye, assembly.Selections[FaceAssemblySlot.EyeRight]);
        Assert.Equal(ids.LeftBrow, assembly.Selections[FaceAssemblySlot.EyebrowLeft]);
        Assert.Equal(ids.LeftBrow, assembly.Selections[FaceAssemblySlot.EyebrowRight]);
        Assert.Equal(ids.MouthOpen, assembly.Selections[FaceAssemblySlot.MouthOpen]);
        Assert.Equal(FaceEyeMode.Closed, assembly.EyeMode);
        Assert.Equal(FaceMouthMode.Open, assembly.MouthMode);
    }

    [Fact]
    public void UnlinkedSidesCanRemainDifferentAndSelectionsAreBoundToCatalogRevision()
    {
        var catalog = CreateCatalog(out var ids);
        var assembly = FaceAssembly.Create(catalog)
            .Select(catalog, ids.LeftEye)
            .Select(catalog, ids.RightEye);
        Assert.Equal(ids.LeftEye, assembly.Selections[FaceAssemblySlot.EyeLeft]);
        Assert.Equal(ids.RightEye, assembly.Selections[FaceAssemblySlot.EyeRight]);
        Assert.False(assembly.Clear(catalog, FaceAssemblySlot.EyeLeft).Selections.ContainsKey(FaceAssemblySlot.EyeLeft));
        Assert.True(assembly.Clear(catalog, FaceAssemblySlot.EyeLeft).Selections.ContainsKey(FaceAssemblySlot.EyeRight));

        var changedCatalog = catalog.WithComponent(FaceComponent.Create(FaceComponentKind.Nose,
            "Nariz extra", AssetId.New(), null, Transform2D.Identity));
        Assert.Throws<InvalidOperationException>(() => assembly.Select(changedCatalog, ids.LeftEye));
        Assert.Throws<ArgumentException>(() => FaceAssembly.Restore(catalog,
            [new KeyValuePair<FaceAssemblySlot, FaceComponentId>(FaceAssemblySlot.EyeRight, ids.LeftEye)],
            false, false, FaceEyeMode.Open, FaceMouthMode.Closed));
    }

    [Fact]
    public void AssemblySelectsFacialDetailsAndUpToEightIndependentHeadExtras()
    {
        var model = ModelRevisionReference.Restore(ModelId.New(), ModelRevisionId.New(), Revision.Initial, new string('b', 64));
        var details = Enumerable.Range(0, 9).Select(index => FaceComponent.Create(FaceComponentKind.HeadExtra,
            $"Extra {index + 1}", AssetId.New(), null, Transform2D.Identity)).ToArray();
        var highlight = FaceComponent.Create(FaceComponentKind.EyeHighlight, "Brilho direito", AssetId.New(),
            FaceComponentSide.Right, Transform2D.Identity);
        var blush = FaceComponent.Create(FaceComponentKind.Blush, "Blush", AssetId.New(), null, Transform2D.Identity);
        var shadow = FaceComponent.Create(FaceComponentKind.FacialShadow, "Sombra", AssetId.New(), null, Transform2D.Identity);
        var catalog = FaceCatalogDraft.Create(model, "Detalhes");
        foreach (var component in details.Append(highlight).Append(blush).Append(shadow))
            catalog = catalog.WithComponent(component);

        var assembly = FaceAssembly.Create(catalog).Select(catalog, highlight.Id)
            .Select(catalog, blush.Id).Select(catalog, shadow.Id);
        foreach (var accessory in details.Take(8)) assembly = assembly.Select(catalog, accessory.Id);
        Assert.Equal(highlight.Id, assembly.Selections[FaceAssemblySlot.EyeHighlightRight]);
        Assert.Equal(blush.Id, assembly.Selections[FaceAssemblySlot.Blush]);
        Assert.Equal(shadow.Id, assembly.Selections[FaceAssemblySlot.FacialShadow]);
        Assert.Equal(details.Take(8).Select(item => item.Id), Enumerable.Range(16, 8)
            .Select(value => assembly.Selections[(FaceAssemblySlot)value]));
        Assert.Throws<InvalidOperationException>(() => assembly.Select(catalog, details[8].Id));
    }

    private static FaceCatalogDraft CreateCatalog(out (FaceComponentId LeftEye, FaceComponentId RightEye,
        FaceComponentId LeftBrow, FaceComponentId MouthOpen) ids)
    {
        var model = ModelRevisionReference.Restore(ModelId.New(), ModelRevisionId.New(), Revision.Initial, new string('c', 64));
        var leftEye = FaceComponent.Create(FaceComponentKind.Eye, "Olho esquerdo", AssetId.New(), FaceComponentSide.Left, Transform2D.Identity);
        var rightEye = FaceComponent.Create(FaceComponentKind.Eye, "Olho direito", AssetId.New(), FaceComponentSide.Right, Transform2D.Identity);
        var leftBrow = FaceComponent.Create(FaceComponentKind.Eyebrow, "Sobrancelha esquerda", AssetId.New(), FaceComponentSide.Left, Transform2D.Identity);
        var mouthOpen = FaceComponent.Create(FaceComponentKind.Mouth, "Boca aberta", AssetId.New(), null,
            Transform2D.Identity, mouthVariant: FaceMouthVariant.Open);
        ids = (leftEye.Id, rightEye.Id, leftBrow.Id, mouthOpen.Id);
        return FaceCatalogDraft.Create(model, "Face").WithComponent(leftEye).WithComponent(rightEye)
            .WithComponent(leftBrow).WithComponent(mouthOpen);
    }
}
