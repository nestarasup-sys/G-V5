using System.Security.Cryptography;
using System.Text;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;

namespace GV5.Rendering;

/// <summary>Resolves a catalog/selection into stable render layers without mutating catalog assets.</summary>
public static class FaceRenderSceneBuilder
{
    private static readonly FaceAssemblySlot[] StableSlotOrder =
    [
        FaceAssemblySlot.EyeLeft, FaceAssemblySlot.EyeRight,
        FaceAssemblySlot.ClosedEyeLeft, FaceAssemblySlot.ClosedEyeRight,
        FaceAssemblySlot.PupilLeft, FaceAssemblySlot.PupilRight,
        FaceAssemblySlot.EyeHighlightLeft, FaceAssemblySlot.EyeHighlightRight,
        FaceAssemblySlot.EyebrowLeft, FaceAssemblySlot.EyebrowRight,
        FaceAssemblySlot.Nose, FaceAssemblySlot.MouthClosed, FaceAssemblySlot.MouthOpen,
        FaceAssemblySlot.Blush, FaceAssemblySlot.FacialShadow,
        FaceAssemblySlot.HeadExtra1, FaceAssemblySlot.HeadExtra2, FaceAssemblySlot.HeadExtra3, FaceAssemblySlot.HeadExtra4,
        FaceAssemblySlot.HeadExtra5, FaceAssemblySlot.HeadExtra6, FaceAssemblySlot.HeadExtra7, FaceAssemblySlot.HeadExtra8
    ];

    public static IReadOnlyList<RenderLayer> Build(FaceCatalogDraft catalog, FaceAssembly assembly,
        IReadOnlyDictionary<AssetId, Rect2D> assetCrops, int firstZOrder = 0)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        ArgumentNullException.ThrowIfNull(assembly);
        ArgumentNullException.ThrowIfNull(assetCrops);
        if (assembly.CatalogId != catalog.Id || assembly.CatalogRevision != catalog.Revision)
            throw new ArgumentException("The face assembly must reference the exact catalog revision being rendered.", nameof(assembly));
        _ = FaceAssembly.Restore(catalog, assembly.Selections, assembly.EyeSidesLinked,
            assembly.EyebrowSidesLinked, assembly.EyeMode, assembly.MouthMode);

        var components = catalog.Components.ToDictionary(component => component.Id);
        var output = new List<RenderLayer>();
        var selectedLayers = new List<(FaceAssemblySlot Slot, FaceComponent Component, Rect2D Crop, Transform2D Transform)>();
        foreach (var slot in StableSlotOrder)
        {
            if (!IsActive(slot, assembly)) continue;
            if (!assembly.Selections.TryGetValue(slot, out var componentId)) continue;
            var component = components[componentId];
            if (!component.IsVisible) continue;
            if (!assetCrops.TryGetValue(component.AssetId, out var crop) || crop.Width <= 0 || crop.Height <= 0)
                throw new ArgumentException("Every selected face asset needs a positive verified crop.", nameof(assetCrops));

            var transform = component.Transform;
            var targetSide = GetTargetSide(slot);
            if (targetSide is { } side && component.Side != side)
                transform = new Transform2D(transform.Translation, transform.Scale, transform.RotationRadians,
                    transform.Pivot, !transform.FlipX, transform.FlipY);
            selectedLayers.Add((slot, component, crop, transform));
        }
        foreach (var layer in selectedLayers.OrderBy(item => item.Component.ZOrder).ThenBy(item => item.Slot))
            output.Add(new RenderLayer(CreateLayerId(catalog.Id, layer.Slot), layer.Component.AssetId,
                layer.Crop, layer.Transform, alpha: 1, RenderBlendMode.Normal,
                checked(firstZOrder + layer.Component.ZOrder)));
        return output.AsReadOnly();
    }

    private static bool IsActive(FaceAssemblySlot slot, FaceAssembly assembly)
    {
        if (slot is FaceAssemblySlot.EyeLeft or FaceAssemblySlot.EyeRight or FaceAssemblySlot.PupilLeft or FaceAssemblySlot.PupilRight)
            return assembly.EyeMode == FaceEyeMode.Open;
        if (slot is FaceAssemblySlot.ClosedEyeLeft or FaceAssemblySlot.ClosedEyeRight)
            return assembly.EyeMode == FaceEyeMode.Closed;
        if (slot == FaceAssemblySlot.MouthClosed) return assembly.MouthMode == FaceMouthMode.Closed;
        if (slot == FaceAssemblySlot.MouthOpen) return assembly.MouthMode == FaceMouthMode.Open;
        return true;
    }

    private static FaceComponentSide? GetTargetSide(FaceAssemblySlot slot) => slot switch
    {
        FaceAssemblySlot.EyeLeft or FaceAssemblySlot.PupilLeft or FaceAssemblySlot.ClosedEyeLeft
            or FaceAssemblySlot.EyebrowLeft or FaceAssemblySlot.EyeHighlightLeft => FaceComponentSide.Left,
        FaceAssemblySlot.EyeRight or FaceAssemblySlot.PupilRight or FaceAssemblySlot.ClosedEyeRight
            or FaceAssemblySlot.EyebrowRight or FaceAssemblySlot.EyeHighlightRight => FaceComponentSide.Right,
        _ => null
    };

    private static RenderLayerId CreateLayerId(FaceId catalogId, FaceAssemblySlot slot)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes($"gv5-face-layer:{catalogId}:{(int)slot}"));
        return RenderLayerId.From(new Guid(bytes.AsSpan(0, 16)));
    }
}
