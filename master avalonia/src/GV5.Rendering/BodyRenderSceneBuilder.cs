using GV5.Core.Identity;
using GV5.Geometry;

namespace GV5.Rendering;

/// <summary>Render-ready immutable source for one body part; PartId is the legacy/model-facing identity.</summary>
public readonly record struct BodyPartRenderSource
{
    public string PartId { get; }
    public RenderLayerId LayerId { get; }
    public AssetId AssetId { get; }
    public Rect2D Crop { get; }
    public Transform2D Transform { get; }
    public double Alpha { get; }
    public RenderBlendMode BlendMode { get; }

    public BodyPartRenderSource(
        string partId,
        RenderLayerId layerId,
        AssetId assetId,
        Rect2D crop,
        Transform2D transform,
        double alpha = 1,
        RenderBlendMode blendMode = RenderBlendMode.Normal)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(partId);
        // Reuse the layer constructor as the single validation authority for render data.
        _ = new RenderLayer(layerId, assetId, crop, transform, alpha, blendMode, zOrder: 0);
        PartId = partId;
        LayerId = layerId;
        AssetId = assetId;
        Crop = crop;
        Transform = transform;
        Alpha = alpha;
        BlendMode = blendMode;
    }
}

/// <summary>Builds body layers in the model's declared back-to-front layer order.</summary>
public static class BodyRenderSceneBuilder
{
    public static RenderScene Build(
        SceneId sceneId,
        int width,
        int height,
        IEnumerable<BodyPartRenderSource> bodyParts,
        IEnumerable<string>? layerOrder = null,
        IReadOnlySet<string>? hiddenPartIds = null)
    {
        ArgumentNullException.ThrowIfNull(bodyParts);
        var parts = bodyParts.ToArray();
        var byId = new Dictionary<string, BodyPartRenderSource>(StringComparer.Ordinal);
        foreach (var part in parts)
        {
            if (!byId.TryAdd(part.PartId, part))
            {
                throw new ArgumentException($"Body part ID '{part.PartId}' occurs more than once.", nameof(bodyParts));
            }
        }

        var normalizedOrder = new List<string>(parts.Length);
        var included = new HashSet<string>(StringComparer.Ordinal);
        if (layerOrder is not null)
        {
            foreach (var id in layerOrder)
            {
                if (byId.ContainsKey(id) && included.Add(id))
                {
                    normalizedOrder.Add(id);
                }
            }
        }
        foreach (var part in parts)
        {
            if (included.Add(part.PartId))
            {
                normalizedOrder.Add(part.PartId);
            }
        }

        var layers = new List<RenderLayer>(normalizedOrder.Count);
        for (var orderIndex = 0; orderIndex < normalizedOrder.Count; orderIndex++)
        {
            var partId = normalizedOrder[orderIndex];
            if (hiddenPartIds?.Contains(partId) == true)
            {
                continue;
            }

            var part = byId[partId];
            layers.Add(new RenderLayer(
                part.LayerId,
                part.AssetId,
                part.Crop,
                part.Transform,
                part.Alpha,
                part.BlendMode,
                orderIndex));
        }

        return new RenderScene(sceneId, width, height, layers);
    }
}
