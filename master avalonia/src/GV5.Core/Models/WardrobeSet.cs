using System.Collections.Immutable;
using GV5.Core.Identity;
using GV5.Geometry;

namespace GV5.Core.Models;

public enum WardrobeCategory
{
    Shirt = 1,
    Jacket = 2,
    UpperSleeve = 3,
    LowerSleeve = 4,
    Gloves = 5,
    Cape = 6,
    Belt = 7,
    Glasses = 8,
    HeadAccessory = 9,
    Skirt = 10,
    ThighPants = 11,
    CalfPants = 12,
    Shorts = 13,
    Socks = 14,
    Shoes = 15
}

/// <summary>A transparent garment asset placed on the immutable source model and bound to one stable bone.</summary>
public sealed record WardrobeComponent
{
    private WardrobeComponent(WardrobeComponentId id, string name, WardrobeCategory category,
        ModelPartId boneId, AssetId assetId, Rect2D placement, double rotationDegrees, WardrobeBinding binding)
    {
        Id = id;
        Name = name;
        Category = category;
        BoneId = boneId;
        AssetId = assetId;
        Placement = placement;
        RotationDegrees = rotationDegrees;
        Binding = binding;
    }

    public WardrobeComponentId Id { get; }
    public string Name { get; }
    public WardrobeCategory Category { get; }
    public ModelPartId BoneId { get; }
    public AssetId AssetId { get; }
    /// <summary>Garment bounds in source-model coordinates; image pixels remain in the AssetStore.</summary>
    public Rect2D Placement { get; }
    public double RotationDegrees { get; }
    public WardrobeBinding Binding { get; }

    public static WardrobeComponent Create(string name, WardrobeCategory category, ModelPartId boneId,
        AssetId assetId, Rect2D placement, double rotationDegrees, WardrobeBoneFrame sourceBone) =>
        Restore(WardrobeComponentId.New(), name, category, boneId, assetId, placement, rotationDegrees,
            WardrobeBinding.Bind(sourceBone, placement, rotationDegrees));

    public static WardrobeComponent Restore(WardrobeComponentId id, string name, WardrobeCategory category,
        ModelPartId boneId, AssetId assetId, Rect2D placement, double rotationDegrees, WardrobeBinding binding)
    {
        if (!id.IsValid || !boneId.IsValid || !assetId.IsValid)
            throw new ArgumentException("A wardrobe component requires valid component, bone and asset IDs.");
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var normalizedName = name.Trim();
        if (normalizedName.Length > 120) throw new ArgumentOutOfRangeException(nameof(name));
        if (!Enum.IsDefined(category)) throw new ArgumentOutOfRangeException(nameof(category));
        if (placement.Width <= 0 || placement.Height <= 0) throw new ArgumentOutOfRangeException(nameof(placement));
        if (!double.IsFinite(rotationDegrees)) throw new ArgumentOutOfRangeException(nameof(rotationDegrees));
        if (binding.Version != 1 || !string.Equals(binding.BoneId, boneId.ToString(), StringComparison.Ordinal))
            throw new ArgumentException("The wardrobe binding must target the component's stable bone ID.", nameof(binding));
        return new WardrobeComponent(id, normalizedName, category, boneId, assetId, placement, rotationDegrees, binding);
    }

    public WardrobeComponent WithPlacement(Rect2D placement, double rotationDegrees, WardrobeBoneFrame sourceBone) =>
        Restore(Id, Name, Category, BoneId, AssetId, placement, rotationDegrees,
            WardrobeBinding.Bind(sourceBone, placement, rotationDegrees));

    public WardrobeComponent WithBone(ModelPartId boneId, WardrobeBoneFrame sourceBone) =>
        Restore(Id, Name, Category, boneId, AssetId, Placement, RotationDegrees,
            WardrobeBinding.Bind(sourceBone, Placement, RotationDegrees));
}

/// <summary>Editable wardrobe data pinned to one exact published model; its revision is independent of model revisions.</summary>
public sealed record WardrobeSet
{
    public const int CurrentSchemaVersion = 1;
    public const int MaximumComponents = 100;

    private WardrobeSet(WardrobeId id, ModelRevisionReference model, Revision revision, string name,
        ImmutableArray<WardrobeComponent> components)
    {
        Id = id;
        Model = model;
        Revision = revision;
        Name = name;
        Components = components;
    }

    public WardrobeId Id { get; }
    public int SchemaVersion => CurrentSchemaVersion;
    public ModelRevisionReference Model { get; }
    public Revision Revision { get; }
    public string Name { get; }
    public ImmutableArray<WardrobeComponent> Components { get; }

    public static WardrobeSet Create(PublishedModelRevision model, string name)
    {
        ArgumentNullException.ThrowIfNull(model);
        return Restore(WardrobeId.New(), ModelRevisionReference.From(model), Revision.Initial, name, []);
    }

    public static WardrobeSet Restore(WardrobeId id, ModelRevisionReference model, Revision revision,
        string name, IEnumerable<WardrobeComponent> components)
    {
        if (!id.IsValid || !revision.IsValid) throw new ArgumentException("A wardrobe set requires valid identity and revision.");
        ArgumentNullException.ThrowIfNull(model);
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var normalizedName = name.Trim();
        if (normalizedName.Length > 120) throw new ArgumentOutOfRangeException(nameof(name));
        ArgumentNullException.ThrowIfNull(components);
        var items = components.ToImmutableArray();
        if (items.Length > MaximumComponents || items.Any(component => component is null)
            || items.Select(component => component.Id).Distinct().Count() != items.Length)
            throw new ArgumentException($"A wardrobe set requires unique components and allows at most {MaximumComponents}.", nameof(components));
        return new WardrobeSet(id, model, revision, normalizedName, items);
    }

    public WardrobeSet WithContent(string name, IEnumerable<WardrobeComponent> components) =>
        Restore(Id, Model, Revision.Next(), name, components);

    public WardrobeSet PrepareInitialSave(string name) =>
        Restore(Id, Model, Revision.Initial, name, Components);
}
