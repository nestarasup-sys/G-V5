using GV5.Core.Identity;
using GV5.Geometry;

namespace GV5.Core.Models;

/// <summary>The immutable import-time crop and transform used to restore a model piece.</summary>
public sealed record ModelPartSourceTransform
{
    public Rect2D Crop { get; }
    public Transform2D Transform { get; }

    public ModelPartSourceTransform(Rect2D crop, Transform2D transform)
    {
        if (crop.Width <= 0 || crop.Height <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(crop), "A source crop must have positive dimensions.");
        }

        Crop = crop;
        Transform = transform;
    }
}

/// <summary>A piece references pixels by AssetId; its editable transform never mutates sourceTransform.</summary>
public sealed record ModelPart
{
    public ModelPartId Id { get; }
    public string Name { get; }
    public AssetId AssetId { get; }
    public Rect2D SourceCrop { get; }
    public Transform2D Transform { get; }
    public ModelPartSourceTransform SourceTransform { get; }
    public bool IsVisible { get; }

    public ModelPart(
        ModelPartId id,
        string name,
        AssetId assetId,
        Rect2D sourceCrop,
        Transform2D transform,
        ModelPartSourceTransform sourceTransform,
        bool isVisible = true)
    {
        if (!id.IsValid)
        {
            throw new ArgumentException("A model part requires a stable ID.", nameof(id));
        }
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var normalizedName = name.Trim();
        if (normalizedName.Length > 120)
        {
            throw new ArgumentOutOfRangeException(nameof(name), "A model part name cannot exceed 120 characters.");
        }
        if (!assetId.IsValid)
        {
            throw new ArgumentException("A model part requires a valid asset reference.", nameof(assetId));
        }
        if (sourceCrop.Width <= 0 || sourceCrop.Height <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(sourceCrop), "A part crop must have positive dimensions.");
        }

        Id = id;
        Name = normalizedName;
        AssetId = assetId;
        SourceCrop = sourceCrop;
        Transform = transform;
        SourceTransform = sourceTransform ?? throw new ArgumentNullException(nameof(sourceTransform));
        IsVisible = isVisible;
    }

    public ModelPart WithTransform(Transform2D transform) =>
        new(Id, Name, AssetId, SourceCrop, transform, SourceTransform, IsVisible);

    public ModelPart WithVisibility(bool isVisible) =>
        new(Id, Name, AssetId, SourceCrop, Transform, SourceTransform, isVisible);
}
