using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;

namespace GV5.Rendering;

/// <summary>Combines ordered body layers with already-resolved wardrobe placements for the CPU renderer.</summary>
public static class WardrobeRenderSceneBuilder
{
    private const int ComponentOrderStride = WardrobeSet.MaximumComponents + 1;

    public static RenderScene Build(
        SceneId sceneId,
        int width,
        int height,
        IEnumerable<RenderLayer> bodyLayers,
        IReadOnlyDictionary<ModelPartId, int> bodyLayerIndices,
        IEnumerable<WardrobeComponentPosePlacement> wardrobePlacements,
        IReadOnlyDictionary<AssetId, Rect2D> wardrobeAssetCrops)
    {
        ArgumentNullException.ThrowIfNull(bodyLayers);
        ArgumentNullException.ThrowIfNull(bodyLayerIndices);
        ArgumentNullException.ThrowIfNull(wardrobePlacements);
        ArgumentNullException.ThrowIfNull(wardrobeAssetCrops);

        var orderedBody = bodyLayers.Select((layer, index) => (layer, index))
            .OrderBy(item => item.layer.ZOrder).ThenBy(item => item.index)
            .Select(item => item.layer).ToArray();
        var placements = wardrobePlacements.ToArray();
        if (placements.Length > WardrobeSet.MaximumComponents
            || placements.Select(item => item.ComponentId).Distinct().Count() != placements.Length
            || placements.Select(item => item.ComponentSequence).Distinct().Count() != placements.Length)
            throw new ArgumentException("Wardrobe placements require unique component identities and sequence values within the domain limit.", nameof(wardrobePlacements));

        var layers = new List<RenderLayer>(orderedBody.Length + placements.Length);
        for (var index = 0; index < orderedBody.Length; index++)
        {
            var body = orderedBody[index];
            layers.Add(new RenderLayer(body.Id, body.AssetId, body.Crop, body.Transform, body.Alpha,
                body.BlendMode, checked(index * ComponentOrderStride)));
        }

        foreach (var placement in placements.OrderBy(item => item.RenderPhase)
                     .ThenBy(item => item.BodyLayerIndex).ThenBy(item => item.ComponentSequence))
        {
            if (!Enum.IsDefined(placement.RenderPhase) || !Enum.IsDefined(placement.Category))
                throw new ArgumentException("Wardrobe placement contains an unsupported phase or category.", nameof(wardrobePlacements));
            if (placement.RenderPhase == WardrobeRenderPhase.AboveHair
                && placement.Category is not (WardrobeCategory.Glasses or WardrobeCategory.HeadAccessory))
                throw new ArgumentException("Only glasses and head accessories can be composed above hair.", nameof(wardrobePlacements));
            if (placement.ComponentSequence is < 0 or >= WardrobeSet.MaximumComponents)
                throw new ArgumentOutOfRangeException(nameof(wardrobePlacements), "Wardrobe component sequence is outside the supported range.");
            if (!wardrobeAssetCrops.TryGetValue(placement.AssetId, out var crop)
                || crop.Width <= 0 || crop.Height <= 0)
                throw new ArgumentException("Every wardrobe asset requires a verified positive crop from asset metadata.", nameof(wardrobeAssetCrops));

            int zOrder;
            if (placement.RenderPhase == WardrobeRenderPhase.AboveHair)
            {
                zOrder = checked(orderedBody.Length * ComponentOrderStride + placement.ComponentSequence);
            }
            else
            {
                if (!bodyLayerIndices.TryGetValue(placement.AttachedBoneId, out var bodyIndex)
                    || bodyIndex != placement.BodyLayerIndex
                    || bodyIndex < 0 || bodyIndex >= orderedBody.Length)
                    throw new ArgumentException("Wardrobe placement does not map to its attached body layer.", nameof(bodyLayerIndices));
                zOrder = checked(bodyIndex * ComponentOrderStride + 1 + placement.ComponentSequence);
            }

            var bounds = placement.Placement.Bounds;
            var transform = new Transform2D(
                new Point2D(bounds.X, bounds.Y),
                new Point2D(bounds.Width / crop.Width, bounds.Height / crop.Height),
                placement.Placement.RotationDegrees * Math.PI / 180,
                new Point2D(crop.Width / 2, crop.Height / 2),
                placement.Placement.FlipX,
                placement.Placement.FlipY);
            layers.Add(new RenderLayer(RenderLayerId.New(), placement.AssetId, crop, transform,
                alpha: 1, RenderBlendMode.Normal, zOrder));
        }

        return new RenderScene(sceneId, width, height, layers);
    }
}
