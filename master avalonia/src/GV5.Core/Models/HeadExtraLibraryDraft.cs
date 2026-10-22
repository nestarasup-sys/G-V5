using System.Collections.Immutable;
using GV5.Core.Identity;
using GV5.Geometry;

namespace GV5.Core.Models;

/// <summary>A reusable head accessory entry; image pixels stay in AssetStore.</summary>
public sealed record HeadExtraAsset
{
    private HeadExtraAsset(FaceComponentId id, AssetId assetId, string name, int width, int height,
        Transform2D defaultTransform)
    {
        Id = id;
        AssetId = assetId;
        Name = name;
        Width = width;
        Height = height;
        DefaultTransform = defaultTransform;
    }

    public FaceComponentId Id { get; }
    public AssetId AssetId { get; }
    public string Name { get; }
    public int Width { get; }
    public int Height { get; }
    public Transform2D DefaultTransform { get; }

    public static HeadExtraAsset Create(AssetId assetId, string name, int width, int height,
        Transform2D defaultTransform) =>
        Restore(FaceComponentId.New(), assetId, name, width, height, defaultTransform);

    public static HeadExtraAsset Restore(FaceComponentId id, AssetId assetId, string name, int width,
        int height, Transform2D defaultTransform)
    {
        if (!id.IsValid || !assetId.IsValid)
            throw new ArgumentException("A head extra requires valid component and asset IDs.");
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var normalizedName = name.Trim();
        if (normalizedName.Length > 120) throw new ArgumentOutOfRangeException(nameof(name));
        if (width is < 1 or > 16_384) throw new ArgumentOutOfRangeException(nameof(width));
        if (height is < 1 or > 16_384) throw new ArgumentOutOfRangeException(nameof(height));
        if (!Finite(defaultTransform.Translation) || !Finite(defaultTransform.Scale)
            || !Finite(defaultTransform.Pivot) || defaultTransform.Translation.X is < -100_000 or > 100_000
            || defaultTransform.Translation.Y is < -100_000 or > 100_000
            || defaultTransform.Scale.X is <= 0 or > 20 || defaultTransform.Scale.Y is <= 0 or > 20
            || !double.IsFinite(defaultTransform.RotationRadians))
            throw new ArgumentOutOfRangeException(nameof(defaultTransform));
        return new HeadExtraAsset(id, assetId, normalizedName, width, height, defaultTransform);
    }

    public HeadExtraAsset WithName(string name) => Restore(Id, AssetId, name, Width, Height, DefaultTransform);
    public HeadExtraAsset WithTransform(Transform2D transform) => Restore(Id, AssetId, Name, Width, Height, transform);

    private static bool Finite(Point2D point) => double.IsFinite(point.X) && double.IsFinite(point.Y);
}

/// <summary>Editable, slot-scoped head-extra library, independent from face catalog revisions.</summary>
public sealed record HeadExtraLibraryDraft
{
    public const int CurrentSchemaVersion = 1;
    public const int MaximumAssets = 256;

    private HeadExtraLibraryDraft(Guid id, ModelSlot modelSlot, Revision revision,
        ImmutableArray<HeadExtraAsset> assets)
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
    public ImmutableArray<HeadExtraAsset> Assets { get; }

    public static HeadExtraLibraryDraft Create(ModelSlot modelSlot) =>
        Restore(Guid.NewGuid(), modelSlot, Revision.Initial, []);

    public static HeadExtraLibraryDraft Restore(Guid id, ModelSlot modelSlot, Revision revision,
        IEnumerable<HeadExtraAsset> assets)
    {
        if (id == Guid.Empty || !modelSlot.IsValid || !revision.IsValid)
            throw new ArgumentException("A head-extra library requires a valid ID, model slot and revision.");
        ArgumentNullException.ThrowIfNull(assets);
        var items = assets.ToImmutableArray();
        if (items.Length > MaximumAssets || items.Any(asset => asset is null)
            || items.Select(asset => asset.Id).Distinct().Count() != items.Length)
            throw new ArgumentException($"A head-extra library requires unique entries and allows at most {MaximumAssets}.", nameof(assets));
        return new HeadExtraLibraryDraft(id, modelSlot, revision, items);
    }

    public HeadExtraLibraryDraft WithAsset(HeadExtraAsset asset)
    {
        ArgumentNullException.ThrowIfNull(asset);
        var index = FindIndex(asset.Id);
        if (index < 0 && Assets.Length == MaximumAssets)
            throw new InvalidOperationException($"A head-extra library allows at most {MaximumAssets} entries.");
        var updated = index < 0 ? Assets.Add(asset) : Assets.SetItem(index, asset);
        return Restore(Id, ModelSlot, Revision.Next(), updated);
    }

    public HeadExtraLibraryDraft WithoutAsset(FaceComponentId assetId)
    {
        if (!assetId.IsValid) throw new ArgumentException("A head-extra ID must be valid.", nameof(assetId));
        var index = FindIndex(assetId);
        return index < 0 ? this : Restore(Id, ModelSlot, Revision.Next(), Assets.RemoveAt(index));
    }

    public HeadExtraLibraryDraft WithAssetName(FaceComponentId assetId, string name) =>
        UpdateAsset(assetId, asset => asset.WithName(name));

    public HeadExtraLibraryDraft WithAssetTransform(FaceComponentId assetId, Transform2D transform) =>
        UpdateAsset(assetId, item => item.WithTransform(transform));

    private HeadExtraLibraryDraft UpdateAsset(FaceComponentId assetId, Func<HeadExtraAsset, HeadExtraAsset> update)
    {
        if (!assetId.IsValid) throw new ArgumentException("A head-extra ID must be valid.", nameof(assetId));
        ArgumentNullException.ThrowIfNull(update);
        var index = FindIndex(assetId);
        if (index < 0) throw new InvalidOperationException("The selected head extra is not present in this library.");
        var current = Assets[index];
        var updatedAsset = update(current);
        return updatedAsset == current ? this : Restore(Id, ModelSlot, Revision.Next(), Assets.SetItem(index, updatedAsset));
    }

    private int FindIndex(FaceComponentId id)
    {
        for (var index = 0; index < Assets.Length; index++)
            if (Assets[index].Id == id) return index;
        return -1;
    }
}
