using System.Collections.Immutable;
using GV5.Core.Identity;
using GV5.Geometry;

namespace GV5.Core.Models;

public enum FaceDetailKind
{
    EyeHighlightLeft,
    EyeHighlightRight,
    Blush,
    FacialShadow
}

/// <summary>A reusable facial detail for one model slot; image pixels remain in AssetStore.</summary>
public sealed record FaceDetailAsset
{
    private FaceDetailAsset(FaceComponentId id, FaceDetailKind kind, AssetId assetId, string name,
        int width, int height, Transform2D transform)
    {
        Id = id;
        Kind = kind;
        AssetId = assetId;
        Name = name;
        Width = width;
        Height = height;
        Transform = transform;
    }

    public FaceComponentId Id { get; }
    public FaceDetailKind Kind { get; }
    public AssetId AssetId { get; }
    public string Name { get; }
    public int Width { get; }
    public int Height { get; }
    public Transform2D Transform { get; }

    public static FaceDetailAsset Create(FaceDetailKind kind, AssetId assetId, string name,
        int width, int height, Transform2D transform) =>
        Restore(FaceComponentId.New(), kind, assetId, name, width, height, transform);

    public static FaceDetailAsset Restore(FaceComponentId id, FaceDetailKind kind, AssetId assetId,
        string name, int width, int height, Transform2D transform)
    {
        if (!id.IsValid || !assetId.IsValid || !Enum.IsDefined(kind))
            throw new ArgumentException("A facial detail requires valid component, kind and asset IDs.");
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var normalizedName = name.Trim();
        if (normalizedName.Length > 120) throw new ArgumentOutOfRangeException(nameof(name));
        if (width is < 1 or > 16_384) throw new ArgumentOutOfRangeException(nameof(width));
        if (height is < 1 or > 16_384) throw new ArgumentOutOfRangeException(nameof(height));
        if (!Finite(transform.Translation) || !Finite(transform.Scale) || !Finite(transform.Pivot)
            || transform.Translation.X is < -100_000 or > 100_000
            || transform.Translation.Y is < -100_000 or > 100_000
            || transform.Scale.X is <= 0 or > 20 || transform.Scale.Y is <= 0 or > 20
            || !double.IsFinite(transform.RotationRadians))
            throw new ArgumentOutOfRangeException(nameof(transform));
        return new FaceDetailAsset(id, kind, assetId, normalizedName, width, height, transform);
    }

    public FaceDetailAsset WithName(string name) => Restore(Id, Kind, AssetId, name, Width, Height, Transform);
    public FaceDetailAsset WithTransform(Transform2D transform) => Restore(Id, Kind, AssetId, Name, Width, Height, transform);

    private static bool Finite(Point2D point) => double.IsFinite(point.X) && double.IsFinite(point.Y);
}

/// <summary>Independently revised, slot-scoped library of highlights, blush and facial shadow.</summary>
public sealed record FaceDetailLibraryDraft
{
    public const int CurrentSchemaVersion = 1;
    public const int MaximumAssets = 256;

    private FaceDetailLibraryDraft(Guid id, ModelSlot modelSlot, Revision revision,
        ImmutableArray<FaceDetailAsset> assets)
    {
        Id = id;
        ModelSlot = modelSlot;
        Revision = revision;
        Assets = assets;
    }

    public Guid Id { get; }
    public int SchemaVersion => CurrentSchemaVersion;
    public ModelSlot ModelSlot { get; }
    public Revision Revision { get; }
    public ImmutableArray<FaceDetailAsset> Assets { get; }

    public static FaceDetailLibraryDraft Create(ModelSlot modelSlot) =>
        Restore(Guid.NewGuid(), modelSlot, Revision.Initial, []);

    public static FaceDetailLibraryDraft Restore(Guid id, ModelSlot modelSlot, Revision revision,
        IEnumerable<FaceDetailAsset> assets)
    {
        if (id == Guid.Empty || !modelSlot.IsValid || !revision.IsValid)
            throw new ArgumentException("A facial-detail library requires a valid ID, model slot and revision.");
        ArgumentNullException.ThrowIfNull(assets);
        var items = assets.ToImmutableArray();
        if (items.Length > MaximumAssets || items.Any(asset => asset is null)
            || items.Select(asset => asset.Id).Distinct().Count() != items.Length)
            throw new ArgumentException($"A facial-detail library requires unique entries and allows at most {MaximumAssets}.", nameof(assets));
        return new FaceDetailLibraryDraft(id, modelSlot, revision, items);
    }

    public FaceDetailLibraryDraft WithAsset(FaceDetailAsset asset)
    {
        ArgumentNullException.ThrowIfNull(asset);
        var index = FindIndex(asset.Id);
        if (index < 0 && Assets.Length == MaximumAssets)
            throw new InvalidOperationException($"A facial-detail library allows at most {MaximumAssets} entries.");
        var updated = index < 0 ? Assets.Add(asset) : Assets.SetItem(index, asset);
        return Restore(Id, ModelSlot, Revision.Next(), updated);
    }

    public FaceDetailLibraryDraft WithoutAsset(FaceComponentId assetId)
    {
        if (!assetId.IsValid) throw new ArgumentException("A facial-detail ID must be valid.", nameof(assetId));
        var index = FindIndex(assetId);
        return index < 0 ? this : Restore(Id, ModelSlot, Revision.Next(), Assets.RemoveAt(index));
    }

    private int FindIndex(FaceComponentId id)
    {
        for (var index = 0; index < Assets.Length; index++)
            if (Assets[index].Id == id) return index;
        return -1;
    }
}
