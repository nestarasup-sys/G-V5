using System.Collections.Immutable;
using GV5.Core.Identity;
using GV5.Geometry;

namespace GV5.Core.Models;

/// <summary>Legacy hair categories that can occupy one of three mutually exclusive image slots.</summary>
public enum HairPartId
{
    BackHair = 1,
    RearHair = 2,
    Ponytail = 3,
    FrontHair = 4,
    Ahoge = 5
}

public enum HairSlotId
{
    Back = 1,
    Posterior = 2,
    Fringe = 3
}

public static class HairPartSlots
{
    public static HairSlotId GetSlot(HairPartId part) => part switch
    {
        HairPartId.BackHair or HairPartId.Ponytail => HairSlotId.Back,
        HairPartId.RearHair => HairSlotId.Posterior,
        HairPartId.FrontHair or HairPartId.Ahoge => HairSlotId.Fringe,
        _ => throw new ArgumentOutOfRangeException(nameof(part))
    };
}

/// <summary>A single selected hair image and its character-sheet placement; pixels remain in AssetStore.</summary>
public sealed record HairLayer
{
    private HairLayer(HairPartId part, AssetId assetId, Transform2D transform, bool isVisible)
    {
        Part = part;
        AssetId = assetId;
        Transform = transform;
        IsVisible = isVisible;
    }

    public HairPartId Part { get; }
    public HairSlotId Slot => HairPartSlots.GetSlot(Part);
    public AssetId AssetId { get; }
    public Transform2D Transform { get; }
    public bool IsVisible { get; }

    public static HairLayer Create(HairPartId part, AssetId assetId, Transform2D transform, bool isVisible = true)
    {
        if (!Enum.IsDefined(part)) throw new ArgumentOutOfRangeException(nameof(part));
        if (!assetId.IsValid) throw new ArgumentException("A hair layer requires a valid asset ID.", nameof(assetId));
        if (!Finite(transform.Translation) || !Finite(transform.Scale) || !Finite(transform.Pivot)
            || transform.Translation.X is < -100_000 or > 100_000 || transform.Translation.Y is < -100_000 or > 100_000
            || transform.Scale.X is <= 0 or > 20 || transform.Scale.Y is <= 0 or > 20
            || !double.IsFinite(transform.RotationRadians) || transform.FlipY)
            throw new ArgumentOutOfRangeException(nameof(transform), "Hair transforms must be finite and within the supported placement limits.");
        return new HairLayer(part, assetId, transform, isVisible);
    }

    public HairLayer WithTransform(Transform2D transform) => Create(Part, AssetId, transform, IsVisible);
    public HairLayer WithVisibility(bool isVisible) => new(Part, AssetId, Transform, isVisible);

    private static bool Finite(Point2D point) => double.IsFinite(point.X) && double.IsFinite(point.Y);
}

/// <summary>Immutable role overrides stored as packed 0xRRGGBB colors.</summary>
public sealed record HairPaletteOverrides
{
    public static HairPaletteOverrides Empty { get; } = new(ImmutableDictionary<HairColorRole, uint>.Empty);
    private readonly ImmutableDictionary<HairColorRole, uint> _colors;
    private HairPaletteOverrides(ImmutableDictionary<HairColorRole, uint> colors) => _colors = colors;
    public IReadOnlyDictionary<HairColorRole, uint> Colors => _colors;

    public static HairPaletteOverrides Restore(IEnumerable<KeyValuePair<HairColorRole, uint>> colors)
    {
        ArgumentNullException.ThrowIfNull(colors);
        var builder = ImmutableDictionary.CreateBuilder<HairColorRole, uint>();
        foreach (var (role, color) in colors)
        {
            if (!Enum.IsDefined(role)) throw new ArgumentOutOfRangeException(nameof(colors), "A hair palette contains an unknown color role.");
            if (color > 0xFFFFFF) throw new ArgumentOutOfRangeException(nameof(colors), "Hair palette colors use packed 0xRRGGBB values.");
            if (!builder.TryAdd(role, color)) throw new ArgumentException("Hair color roles must be unique.", nameof(colors));
        }
        return new HairPaletteOverrides(builder.ToImmutable());
    }

    public HairPaletteOverrides WithColor(HairColorRole role, uint color)
    {
        if (!Enum.IsDefined(role)) throw new ArgumentOutOfRangeException(nameof(role));
        if (color > 0xFFFFFF) throw new ArgumentOutOfRangeException(nameof(color));
        return new HairPaletteOverrides(_colors.SetItem(role, color));
    }

    public HairPaletteOverrides WithoutColor(HairColorRole role)
    {
        if (!Enum.IsDefined(role)) throw new ArgumentOutOfRangeException(nameof(role));
        return new HairPaletteOverrides(_colors.Remove(role));
    }
}

/// <summary>Editable hair workspace pinned to one immutable model revision; publication/repository are separate services.</summary>
public sealed record HairStyleDraft
{
    public const int CurrentSchemaVersion = 1;
    public const int MaximumLayers = 3;

    private HairStyleDraft(HairId id, ModelRevisionReference model, Revision revision, string name,
        ImmutableArray<HairLayer> layers, HairPaletteOverrides palette)
    {
        Id = id;
        Model = model;
        Revision = revision;
        Name = name;
        Layers = layers;
        Palette = palette;
    }

    public HairId Id { get; }
    public int SchemaVersion => CurrentSchemaVersion;
    public ModelRevisionReference Model { get; }
    public Revision Revision { get; }
    public string Name { get; }
    /// <summary>Bottom-to-top visual order; each legacy image slot can occur once.</summary>
    public ImmutableArray<HairLayer> Layers { get; }
    public HairPaletteOverrides Palette { get; }

    public static HairStyleDraft Create(ModelRevisionReference model, string name) =>
        Restore(HairId.New(), model, Revision.Initial, name, [], HairPaletteOverrides.Empty);

    public static HairStyleDraft Restore(HairId id, ModelRevisionReference model, Revision revision, string name,
        IEnumerable<HairLayer> layers, HairPaletteOverrides? palette = null)
    {
        if (!id.IsValid || !revision.IsValid) throw new ArgumentException("A hair draft requires valid identity and revision.");
        ArgumentNullException.ThrowIfNull(model);
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var normalizedName = name.Trim();
        if (normalizedName.Length > 120) throw new ArgumentOutOfRangeException(nameof(name));
        ArgumentNullException.ThrowIfNull(layers);
        var layerArray = layers.ToImmutableArray();
        if (layerArray.Length > MaximumLayers || layerArray.Any(layer => layer is null)
            || layerArray.Select(layer => layer.Slot).Distinct().Count() != layerArray.Length)
            throw new ArgumentException("A hair draft can contain one layer per legacy image slot (back, posterior, fringe).", nameof(layers));
        return new HairStyleDraft(id, model, revision, normalizedName, layerArray, palette ?? HairPaletteOverrides.Empty);
    }

    public HairStyleDraft WithName(string name) =>
        Restore(Id, Model, Revision.Next(), name, Layers, Palette);

    /// <summary>Replaces the current part in its legacy slot without changing that layer's order.</summary>
    public HairStyleDraft WithLayer(HairLayer layer)
    {
        ArgumentNullException.ThrowIfNull(layer);
        var index = FindLayerIndex(item => item.Slot == layer.Slot);
        var updated = index < 0 ? Layers.Add(layer) : Layers.SetItem(index, layer);
        return Restore(Id, Model, Revision.Next(), Name, updated, Palette);
    }

    public HairStyleDraft WithoutLayer(HairPartId part)
    {
        if (!Enum.IsDefined(part)) throw new ArgumentOutOfRangeException(nameof(part));
        var index = FindLayerIndex(item => item.Part == part);
        return index < 0 ? this : Restore(Id, Model, Revision.Next(), Name, Layers.RemoveAt(index), Palette);
    }

    public HairStyleDraft WithLayerTransform(HairPartId part, Transform2D transform)
    {
        var index = FindLayerIndex(item => item.Part == part);
        if (index < 0) throw new InvalidOperationException("The selected hair layer is not present in this draft.");
        return Restore(Id, Model, Revision.Next(), Name, Layers.SetItem(index, Layers[index].WithTransform(transform)), Palette);
    }

    public HairStyleDraft WithLayerVisibility(HairPartId part, bool isVisible)
    {
        var index = FindLayerIndex(item => item.Part == part);
        if (index < 0) throw new InvalidOperationException("The selected hair layer is not present in this draft.");
        return Restore(Id, Model, Revision.Next(), Name, Layers.SetItem(index, Layers[index].WithVisibility(isVisible)), Palette);
    }

    public HairStyleDraft MoveLayer(HairPartId part, int offset)
    {
        if (offset is not (-1 or 1)) throw new ArgumentOutOfRangeException(nameof(offset));
        var index = FindLayerIndex(item => item.Part == part);
        var destination = index + offset;
        if (index < 0 || destination < 0 || destination >= Layers.Length) return this;
        var builder = Layers.ToBuilder();
        (builder[index], builder[destination]) = (builder[destination], builder[index]);
        return Restore(Id, Model, Revision.Next(), Name, builder.ToImmutable(), Palette);
    }

    public HairStyleDraft WithPalette(HairPaletteOverrides palette) =>
        Restore(Id, Model, Revision.Next(), Name, Layers, palette ?? throw new ArgumentNullException(nameof(palette)));

    private int FindLayerIndex(Func<HairLayer, bool> predicate)
    {
        for (var index = 0; index < Layers.Length; index++)
            if (predicate(Layers[index])) return index;
        return -1;
    }
}
