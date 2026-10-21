using System.Collections.Immutable;
using GV5.Core.Identity;
using GV5.Geometry;

namespace GV5.Core.Models;

public enum FaceComponentKind
{
    Eye = 1,
    Pupil = 2,
    ClosedEye = 3,
    Eyebrow = 4,
    Nose = 5,
    Mouth = 6
}

public enum FaceComponentSide
{
    Left = 1,
    Right = 2
}

public enum FaceMouthVariant
{
    Closed = 1,
    Open = 2
}

/// <summary>An independently selectable facial asset with its own model-space transform.</summary>
public sealed record FaceComponent
{
    private FaceComponent(FaceComponentId id, FaceComponentKind kind, string name, AssetId assetId,
        FaceComponentSide? side, Transform2D transform, bool isVisible, FaceMouthVariant mouthVariant)
    {
        Id = id;
        Kind = kind;
        Name = name;
        AssetId = assetId;
        Side = side;
        Transform = transform;
        IsVisible = isVisible;
        MouthVariant = mouthVariant;
    }

    public FaceComponentId Id { get; }
    public FaceComponentKind Kind { get; }
    public string Name { get; }
    public AssetId AssetId { get; }
    public FaceComponentSide? Side { get; }
    public Transform2D Transform { get; }
    public bool IsVisible { get; }
    public FaceMouthVariant MouthVariant { get; }

    public static FaceComponent Create(FaceComponentKind kind, string name, AssetId assetId,
        FaceComponentSide? side, Transform2D transform, bool isVisible = true,
        FaceMouthVariant mouthVariant = FaceMouthVariant.Closed) =>
        Restore(FaceComponentId.New(), kind, name, assetId, side, transform, isVisible, mouthVariant);

    public static FaceComponent Restore(FaceComponentId id, FaceComponentKind kind, string name,
        AssetId assetId, FaceComponentSide? side, Transform2D transform, bool isVisible = true,
        FaceMouthVariant mouthVariant = FaceMouthVariant.Closed)
    {
        if (!id.IsValid || !assetId.IsValid) throw new ArgumentException("A facial component requires stable component and asset IDs.");
        if (!Enum.IsDefined(kind)) throw new ArgumentOutOfRangeException(nameof(kind));
        if (side is { } definedSide && !Enum.IsDefined(definedSide)) throw new ArgumentOutOfRangeException(nameof(side));
        var requiresSide = kind is FaceComponentKind.Eye or FaceComponentKind.Pupil
            or FaceComponentKind.ClosedEye or FaceComponentKind.Eyebrow;
        if (requiresSide != side.HasValue)
            throw new ArgumentException("Eye, pupil, closed-eye and eyebrow components require a left or right side; nose and mouth do not.", nameof(side));
        if (!Enum.IsDefined(mouthVariant) || (kind != FaceComponentKind.Mouth && mouthVariant != FaceMouthVariant.Closed))
            throw new ArgumentOutOfRangeException(nameof(mouthVariant), "Only mouth assets can use the open-mouth variant.");
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var normalizedName = name.Trim();
        if (normalizedName.Length > 120) throw new ArgumentOutOfRangeException(nameof(name));
        if (!Finite(transform.Translation) || !Finite(transform.Scale) || !Finite(transform.Pivot)
            || transform.Translation.X is < -100_000 or > 100_000 || transform.Translation.Y is < -100_000 or > 100_000
            || transform.Scale.X is <= 0 or > 20 || transform.Scale.Y is <= 0 or > 20
            || !double.IsFinite(transform.RotationRadians))
            throw new ArgumentOutOfRangeException(nameof(transform), "Facial transforms must be finite and within supported placement limits.");
        return new FaceComponent(id, kind, normalizedName, assetId, side, transform, isVisible, mouthVariant);
    }

    public FaceComponent WithTransform(Transform2D transform) =>
        Restore(Id, Kind, Name, AssetId, Side, transform, IsVisible, MouthVariant);

    public FaceComponent WithVisibility(bool isVisible) =>
        new(Id, Kind, Name, AssetId, Side, Transform, isVisible, MouthVariant);

    private static bool Finite(Point2D point) => double.IsFinite(point.X) && double.IsFinite(point.Y);
}

/// <summary>Editable facial asset catalog pinned to one exact immutable model publication.</summary>
public sealed record FaceCatalogDraft
{
    public const int CurrentSchemaVersion = 1;
    public const int MaximumComponents = 256;

    private FaceCatalogDraft(FaceId id, ModelRevisionReference model, Revision revision, string name,
        ImmutableArray<FaceComponent> components)
    {
        Id = id;
        Model = model;
        Revision = revision;
        Name = name;
        Components = components;
    }

    public FaceId Id { get; }
    public int SchemaVersion => CurrentSchemaVersion;
    public ModelRevisionReference Model { get; }
    public Revision Revision { get; }
    public string Name { get; }
    public ImmutableArray<FaceComponent> Components { get; }

    public static FaceCatalogDraft Create(ModelRevisionReference model, string name) =>
        Restore(FaceId.New(), model, Revision.Initial, name, []);

    public static FaceCatalogDraft Restore(FaceId id, ModelRevisionReference model, Revision revision,
        string name, IEnumerable<FaceComponent> components)
    {
        if (!id.IsValid || !revision.IsValid) throw new ArgumentException("A face catalog requires valid identity and revision.");
        ArgumentNullException.ThrowIfNull(model);
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var normalizedName = name.Trim();
        if (normalizedName.Length > 120) throw new ArgumentOutOfRangeException(nameof(name));
        ArgumentNullException.ThrowIfNull(components);
        var items = components.ToImmutableArray();
        if (items.Length > MaximumComponents || items.Any(component => component is null)
            || items.Select(component => component.Id).Distinct().Count() != items.Length)
            throw new ArgumentException($"A face catalog requires unique components and allows at most {MaximumComponents}.", nameof(components));
        return new FaceCatalogDraft(id, model, revision, normalizedName, items);
    }

    public FaceCatalogDraft WithComponent(FaceComponent component)
    {
        ArgumentNullException.ThrowIfNull(component);
        var index = FindComponentIndex(component.Id);
        var updated = index < 0 ? Components.Add(component) : Components.SetItem(index, component);
        return Restore(Id, Model, Revision.Next(), Name, updated);
    }

    public FaceCatalogDraft WithoutComponent(FaceComponentId componentId)
    {
        if (!componentId.IsValid) throw new ArgumentException("A facial component ID must be valid.", nameof(componentId));
        var index = FindComponentIndex(componentId);
        return index < 0 ? this : Restore(Id, Model, Revision.Next(), Name, Components.RemoveAt(index));
    }

    public FaceCatalogDraft WithTransform(FaceComponentId componentId, Transform2D transform)
    {
        if (!componentId.IsValid) throw new ArgumentException("A facial component ID must be valid.", nameof(componentId));
        var index = FindComponentIndex(componentId);
        if (index < 0) throw new InvalidOperationException("The selected facial component is not present in this catalog.");
        return Restore(Id, Model, Revision.Next(), Name, Components.SetItem(index, Components[index].WithTransform(transform)));
    }

    public FaceCatalogDraft WithVisibility(FaceComponentId componentId, bool isVisible)
    {
        if (!componentId.IsValid) throw new ArgumentException("A facial component ID must be valid.", nameof(componentId));
        var index = FindComponentIndex(componentId);
        if (index < 0) throw new InvalidOperationException("The selected facial component is not present in this catalog.");
        return Restore(Id, Model, Revision.Next(), Name, Components.SetItem(index, Components[index].WithVisibility(isVisible)));
    }

    private int FindComponentIndex(FaceComponentId id)
    {
        for (var index = 0; index < Components.Length; index++)
            if (Components[index].Id == id) return index;
        return -1;
    }
}
