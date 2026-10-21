using System.Security.Cryptography;
using System.Text;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;

namespace GV5.Rendering;

/// <summary>Resolves visible hair layers with stable IDs and explicit back/posterior/fringe slots.</summary>
public static class HairStyleRenderSceneBuilder
{
    public static IReadOnlyList<RenderLayer> Build(HairStyleDraft hair,
        IReadOnlyDictionary<AssetId, Rect2D> assetCrops)
    {
        ArgumentNullException.ThrowIfNull(hair);
        ArgumentNullException.ThrowIfNull(assetCrops);
        var layers = new List<RenderLayer>(hair.Layers.Length);
        foreach (var layer in hair.Layers.OrderBy(item => item.Slot).ThenBy(item => item.Part))
        {
            if (!layer.IsVisible) continue;
            if (!assetCrops.TryGetValue(layer.AssetId, out var crop) || crop.Width <= 0 || crop.Height <= 0)
                throw new ArgumentException("Every visible hair part requires a verified positive crop.", nameof(assetCrops));
            layers.Add(new RenderLayer(CreateLayerId(hair.Id, layer.Part), layer.AssetId, crop,
                layer.Transform, 1, RenderBlendMode.Normal, (int)layer.Slot));
        }
        return layers.AsReadOnly();
    }

    private static RenderLayerId CreateLayerId(HairId hairId, HairPartId part)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes($"gv5-hair-layer:{hairId}:{(int)part}"));
        return RenderLayerId.From(new Guid(hash.AsSpan(0, 16)));
    }
}
