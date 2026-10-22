using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;

namespace GV5.Rendering;

/// <summary>Composes a published model and the default visible selections from its editable face catalog.</summary>
public static class FaceCatalogPreviewSceneBuilder
{
    public static RenderScene Build(PublishedModelRevision model, FaceCatalogDraft catalog,
        IReadOnlyDictionary<AssetId, Rect2D> faceAssetCrops, int maximumDimension = 512)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(catalog);
        ArgumentNullException.ThrowIfNull(faceAssetCrops);
        if (catalog.Model != ModelRevisionReference.From(model))
            throw new ArgumentException("The face catalog must target this exact published model revision.", nameof(catalog));

        var modelScene = ModelDraftRenderSceneBuilder.Build(model.Content, maximumDimension);
        var selections = GetDefaultSelections(catalog);
        var assembly = FaceAssembly.Restore(catalog,
            selections.Select(item => new KeyValuePair<FaceAssemblySlot, FaceComponentId>(item.Slot, item.Component.Id)),
            eyeSidesLinked: false, eyebrowSidesLinked: false, eyeMode: FaceEyeMode.Open, mouthMode: FaceMouthMode.Closed);
        var faceLayers = FaceRenderSceneBuilder.Build(catalog, assembly, faceAssetCrops, modelScene.Layers.Length);
        var scale = ModelDraftRenderSceneBuilder.GetPreviewSize(model.Content, maximumDimension).Scale;
        var scaledFaceLayers = faceLayers.Select(layer => ScaleLayer(layer, scale));
        return new RenderScene(modelScene.Id, modelScene.Width, modelScene.Height,
            modelScene.Layers.Concat(scaledFaceLayers));
    }

    public static IReadOnlyList<FaceCatalogPreviewSelection> GetDefaultSelections(FaceCatalogDraft catalog)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        var selections = new List<FaceCatalogPreviewSelection>();
        AddPair(FaceComponentKind.Eye, FaceAssemblySlot.EyeLeft, FaceAssemblySlot.EyeRight);
        AddPair(FaceComponentKind.Pupil, FaceAssemblySlot.PupilLeft, FaceAssemblySlot.PupilRight);
        AddPair(FaceComponentKind.Eyebrow, FaceAssemblySlot.EyebrowLeft, FaceAssemblySlot.EyebrowRight);
        AddPair(FaceComponentKind.EyeHighlight, FaceAssemblySlot.EyeHighlightLeft, FaceAssemblySlot.EyeHighlightRight);
        AddSingle(FaceComponentKind.Nose, FaceAssemblySlot.Nose);
        AddSingle(FaceComponentKind.Mouth, FaceAssemblySlot.MouthClosed, FaceMouthVariant.Closed);
        AddSingle(FaceComponentKind.Blush, FaceAssemblySlot.Blush);
        AddSingle(FaceComponentKind.FacialShadow, FaceAssemblySlot.FacialShadow);

        var extras = catalog.Components.Where(component => component.IsVisible && component.Kind == FaceComponentKind.HeadExtra)
            .OrderBy(component => component.ZOrder).ThenBy(component => component.Name, StringComparer.CurrentCultureIgnoreCase)
            .Take(8).ToArray();
        for (var index = 0; index < extras.Length; index++)
            selections.Add(new FaceCatalogPreviewSelection(
                (FaceAssemblySlot)((int)FaceAssemblySlot.HeadExtra1 + index), extras[index]));

        return selections.AsReadOnly();

        void AddPair(FaceComponentKind kind, FaceAssemblySlot leftSlot, FaceAssemblySlot rightSlot)
        {
            AddSide(kind, FaceComponentSide.Left, leftSlot);
            AddSide(kind, FaceComponentSide.Right, rightSlot);
        }

        void AddSide(FaceComponentKind kind, FaceComponentSide side, FaceAssemblySlot slot)
        {
            var selected = catalog.Components.Where(component => component.IsVisible && component.Kind == kind && component.Side == side)
                .OrderBy(component => component.ZOrder).ThenBy(component => component.Name, StringComparer.CurrentCultureIgnoreCase)
                .FirstOrDefault();
            if (selected is not null) selections.Add(new FaceCatalogPreviewSelection(slot, selected));
        }

        void AddSingle(FaceComponentKind kind, FaceAssemblySlot slot, FaceMouthVariant? mouthVariant = null)
        {
            var selected = catalog.Components.Where(component => component.IsVisible && component.Kind == kind
                    && (mouthVariant is null || component.MouthVariant == mouthVariant))
                .OrderBy(component => component.ZOrder).ThenBy(component => component.Name, StringComparer.CurrentCultureIgnoreCase)
                .FirstOrDefault();
            if (selected is not null) selections.Add(new FaceCatalogPreviewSelection(slot, selected));
        }
    }

    private static RenderLayer ScaleLayer(RenderLayer layer, double scale)
    {
        var transform = layer.Transform;
        var scaled = new Transform2D(
            new Point2D(transform.Translation.X * scale + (scale - 1) * transform.Pivot.X,
                transform.Translation.Y * scale + (scale - 1) * transform.Pivot.Y),
            new Point2D(transform.Scale.X * scale, transform.Scale.Y * scale),
            transform.RotationRadians, transform.Pivot, transform.FlipX, transform.FlipY);
        return new RenderLayer(layer.Id, layer.AssetId, layer.Crop, scaled, layer.Alpha, layer.BlendMode, layer.ZOrder);
    }
}

public sealed record FaceCatalogPreviewSelection(FaceAssemblySlot Slot, FaceComponent Component);
