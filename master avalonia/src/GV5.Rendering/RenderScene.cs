using System.Collections.Immutable;
using GV5.Core.Identity;
using GV5.Geometry;

namespace GV5.Rendering;

public enum RenderBlendMode
{
    Normal = 1,
    Multiply = 2,
    Screen = 3,
    Add = 4
}

public readonly record struct RenderLayerId
{
    public Guid Value { get; }

    private RenderLayerId(Guid value) => Value = value;

    public static RenderLayerId New() => new(Guid.NewGuid());

    public static RenderLayerId From(Guid value) => value == Guid.Empty
        ? throw new ArgumentException("A render layer ID cannot be empty.", nameof(value))
        : new RenderLayerId(value);
}

/// <summary>An immutable reference to one asset and its local render/crop configuration.</summary>
public readonly record struct RenderLayer
{
    public RenderLayerId Id { get; }
    public AssetId AssetId { get; }
    public Rect2D Crop { get; }
    public Transform2D Transform { get; }
    public double Alpha { get; }
    public RenderBlendMode BlendMode { get; }
    public int ZOrder { get; }

    public RenderLayer(
        RenderLayerId id,
        AssetId assetId,
        Rect2D crop,
        Transform2D transform,
        double alpha,
        RenderBlendMode blendMode,
        int zOrder)
    {
        if (id.Value == Guid.Empty)
        {
            throw new ArgumentException("A render layer requires a valid ID.", nameof(id));
        }
        if (!assetId.IsValid)
        {
            throw new ArgumentException("A render layer requires a valid asset ID.", nameof(assetId));
        }
        if (crop.Width <= 0 || crop.Height <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(crop), "A render crop must have positive dimensions.");
        }
        if (!double.IsFinite(alpha) || alpha is < 0 or > 1)
        {
            throw new ArgumentOutOfRangeException(nameof(alpha), "Alpha must be finite and between zero and one.");
        }
        if (!Enum.IsDefined(blendMode))
        {
            throw new ArgumentOutOfRangeException(nameof(blendMode));
        }

        Id = id;
        AssetId = assetId;
        Crop = crop;
        Transform = transform;
        Alpha = alpha;
        BlendMode = blendMode;
        ZOrder = zOrder;
    }
}

/// <summary>An immutable render snapshot; Layers are ordered back-to-front by ZOrder.</summary>
public sealed class RenderScene
{
    public SceneId Id { get; }
    public int Width { get; }
    public int Height { get; }
    public ImmutableArray<RenderLayer> Layers { get; }

    public RenderScene(SceneId id, int width, int height, IEnumerable<RenderLayer> layers)
    {
        if (!id.IsValid)
        {
            throw new ArgumentException("A render scene requires a valid scene ID.", nameof(id));
        }
        if (width <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(width));
        }
        if (height <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(height));
        }
        ArgumentNullException.ThrowIfNull(layers);

        var ordered = layers.Select((layer, index) => (layer, index))
            .OrderBy(item => item.layer.ZOrder)
            .ThenBy(item => item.index)
            .Select(item => item.layer)
            .ToImmutableArray();
        if (ordered.Select(layer => layer.Id).Distinct().Count() != ordered.Length)
        {
            throw new ArgumentException("Render layer IDs must be unique within a scene.", nameof(layers));
        }

        Id = id;
        Width = width;
        Height = height;
        Layers = ordered;
    }
}
