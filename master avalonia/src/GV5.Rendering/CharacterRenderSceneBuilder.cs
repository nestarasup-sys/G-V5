using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;

namespace GV5.Rendering;

/// <summary>
/// Composes the canonical CPU render scene from body, attached wardrobe, hair, face and head accessories.
/// All inputs must already be resolved against the exact same immutable model revision.
/// </summary>
public static class CharacterRenderSceneBuilder
{
    public static RenderScene Build(SceneId sceneId, int width, int height,
        ModelRevisionReference model, IEnumerable<RenderLayer> bodyLayers,
        IReadOnlyDictionary<ModelPartId, int> bodyLayerIndices,
        HairStyleDraft hair, IReadOnlyDictionary<AssetId, Rect2D> hairAssetCrops,
        FaceCatalogDraft face, FaceAssembly faceAssembly, IReadOnlyDictionary<AssetId, Rect2D> faceAssetCrops,
        IEnumerable<WardrobeComponentPosePlacement> wardrobePlacements,
        IReadOnlyDictionary<AssetId, Rect2D> wardrobeAssetCrops)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(bodyLayers);
        ArgumentNullException.ThrowIfNull(bodyLayerIndices);
        ArgumentNullException.ThrowIfNull(hair);
        ArgumentNullException.ThrowIfNull(hairAssetCrops);
        ArgumentNullException.ThrowIfNull(face);
        ArgumentNullException.ThrowIfNull(faceAssembly);
        ArgumentNullException.ThrowIfNull(faceAssetCrops);
        ArgumentNullException.ThrowIfNull(wardrobePlacements);
        ArgumentNullException.ThrowIfNull(wardrobeAssetCrops);
        if (hair.Model != model || face.Model != model)
            throw new ArgumentException("Body, hair and face must use the same exact model revision.", nameof(model));

        var body = bodyLayers.ToArray();
        var placements = wardrobePlacements.ToArray();
        if (placements.Length > WardrobeSet.MaximumComponents
            || placements.Select(item => item.ComponentId).Distinct().Count() != placements.Length
            || placements.Select(item => item.ComponentSequence).Distinct().Count() != placements.Length
            || placements.Any(item => !Enum.IsDefined(item.RenderPhase)))
            throw new ArgumentException("Character composition requires unique wardrobe component identities/sequences and known render phases.", nameof(wardrobePlacements));
        var hairLayers = HairStyleRenderSceneBuilder.Build(hair, hairAssetCrops);
        var faceLayers = FaceRenderSceneBuilder.Build(face, faceAssembly, faceAssetCrops);
        var attached = WardrobeRenderSceneBuilder.Build(sceneId, width, height, body, bodyLayerIndices,
            placements.Where(item => item.RenderPhase == WardrobeRenderPhase.AttachedToBodyLayer), wardrobeAssetCrops);
        var aboveHair = WardrobeRenderSceneBuilder.Build(sceneId, width, height, [], bodyLayerIndices,
            placements.Where(item => item.RenderPhase == WardrobeRenderPhase.AboveHair), wardrobeAssetCrops);

        var result = new List<RenderLayer>(hairLayers.Count + attached.Layers.Length + faceLayers.Count + aboveHair.Layers.Length);
        var zOrder = 0;
        Append(hairLayers.Where(layer => layer.ZOrder == (int)HairSlotId.Back), result, ref zOrder);
        Append(attached.Layers, result, ref zOrder);
        Append(hairLayers.Where(layer => layer.ZOrder == (int)HairSlotId.Posterior), result, ref zOrder);
        Append(faceLayers, result, ref zOrder);
        Append(hairLayers.Where(layer => layer.ZOrder == (int)HairSlotId.Fringe), result, ref zOrder);
        Append(aboveHair.Layers, result, ref zOrder);
        return new RenderScene(sceneId, width, height, result);
    }

    private static void Append(IEnumerable<RenderLayer> source, ICollection<RenderLayer> destination, ref int zOrder)
    {
        foreach (var layer in source)
            destination.Add(new RenderLayer(layer.Id, layer.AssetId, layer.Crop, layer.Transform,
                layer.Alpha, layer.BlendMode, zOrder++));
    }
}
