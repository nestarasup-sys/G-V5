using System.Collections.Immutable;
using GV5.Core.Identity;

namespace GV5.Core.Models;

public enum FaceAssemblySlot
{
    EyeLeft = 1,
    EyeRight = 2,
    PupilLeft = 3,
    PupilRight = 4,
    ClosedEyeLeft = 5,
    ClosedEyeRight = 6,
    EyebrowLeft = 7,
    EyebrowRight = 8,
    Nose = 9,
    MouthClosed = 10,
    MouthOpen = 11,
    EyeHighlightLeft = 12,
    EyeHighlightRight = 13,
    Blush = 14,
    FacialShadow = 15,
    HeadExtra1 = 16,
    HeadExtra2 = 17,
    HeadExtra3 = 18,
    HeadExtra4 = 19,
    HeadExtra5 = 20,
    HeadExtra6 = 21,
    HeadExtra7 = 22,
    HeadExtra8 = 23
}

public enum FaceEyeMode
{
    Open = 1,
    Closed = 2
}

public enum FaceMouthMode
{
    Closed = 1,
    Open = 2
}

/// <summary>Immutable selection snapshot for composing one catalog into a face.</summary>
public sealed record FaceAssembly
{
    private FaceAssembly(FaceId catalogId, Revision catalogRevision,
        ImmutableDictionary<FaceAssemblySlot, FaceComponentId> selections,
        bool eyeSidesLinked, bool eyebrowSidesLinked, FaceEyeMode eyeMode, FaceMouthMode mouthMode)
    {
        CatalogId = catalogId;
        CatalogRevision = catalogRevision;
        Selections = selections;
        EyeSidesLinked = eyeSidesLinked;
        EyebrowSidesLinked = eyebrowSidesLinked;
        EyeMode = eyeMode;
        MouthMode = mouthMode;
    }

    public FaceId CatalogId { get; }
    public Revision CatalogRevision { get; }
    public IReadOnlyDictionary<FaceAssemblySlot, FaceComponentId> Selections { get; }
    public bool EyeSidesLinked { get; }
    public bool EyebrowSidesLinked { get; }
    public FaceEyeMode EyeMode { get; }
    public FaceMouthMode MouthMode { get; }

    public static FaceAssembly Create(FaceCatalogDraft catalog)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        return new FaceAssembly(catalog.Id, catalog.Revision,
            ImmutableDictionary<FaceAssemblySlot, FaceComponentId>.Empty,
            eyeSidesLinked: false, eyebrowSidesLinked: false, FaceEyeMode.Open, FaceMouthMode.Closed);
    }

    public static FaceAssembly Restore(FaceCatalogDraft catalog,
        IEnumerable<KeyValuePair<FaceAssemblySlot, FaceComponentId>> selections,
        bool eyeSidesLinked, bool eyebrowSidesLinked, FaceEyeMode eyeMode, FaceMouthMode mouthMode)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        ArgumentNullException.ThrowIfNull(selections);
        if (!Enum.IsDefined(eyeMode)) throw new ArgumentOutOfRangeException(nameof(eyeMode));
        if (!Enum.IsDefined(mouthMode)) throw new ArgumentOutOfRangeException(nameof(mouthMode));
        var builder = ImmutableDictionary.CreateBuilder<FaceAssemblySlot, FaceComponentId>();
        foreach (var (slot, id) in selections)
        {
            if (!Enum.IsDefined(slot) || !id.IsValid || !builder.TryAdd(slot, id))
                throw new ArgumentException("Face assembly selections must have unique valid slots and component IDs.", nameof(selections));
            var component = catalog.Components.FirstOrDefault(item => item.Id == id)
                ?? throw new ArgumentException("A selected facial component does not belong to the referenced catalog.", nameof(selections));
            if (!MatchesSlot(slot, component, eyeSidesLinked, eyebrowSidesLinked))
                throw new ArgumentException("The facial component kind/side does not match its assembly slot.", nameof(selections));
        }
        if (eyeSidesLinked)
        {
            foreach (var (left, right) in EyeSlotPairs)
            {
                if (builder.TryGetValue(left, out var leftId)) builder[right] = leftId;
                else if (builder.TryGetValue(right, out var rightId)) builder[left] = rightId;
            }
        }
        if (eyebrowSidesLinked)
        {
            if (builder.TryGetValue(FaceAssemblySlot.EyebrowLeft, out var leftId))
                builder[FaceAssemblySlot.EyebrowRight] = leftId;
            else if (builder.TryGetValue(FaceAssemblySlot.EyebrowRight, out var rightId))
                builder[FaceAssemblySlot.EyebrowLeft] = rightId;
        }
        return new FaceAssembly(catalog.Id, catalog.Revision, builder.ToImmutable(),
            eyeSidesLinked, eyebrowSidesLinked, eyeMode, mouthMode);
    }

    public FaceAssembly Select(FaceCatalogDraft catalog, FaceComponentId componentId)
    {
        EnsureCatalog(catalog);
        var component = catalog.Components.FirstOrDefault(item => item.Id == componentId)
            ?? throw new ArgumentException("The selected facial component is not in this catalog.", nameof(componentId));
        var slot = component.Kind == FaceComponentKind.HeadExtra
            ? FindHeadExtraSlot(componentId)
            : GetSlot(component);
        var updated = Selections.ToImmutableDictionary().SetItem(slot, componentId);
        if (EyeSidesLinked && IsEyePart(component.Kind))
            updated = updated.SetItem(GetOppositeSlot(slot), componentId);
        if (EyebrowSidesLinked && component.Kind == FaceComponentKind.Eyebrow)
            updated = updated.SetItem(GetOppositeSlot(slot), componentId);
        return Recreate(catalog, updated);
    }

    public FaceAssembly Clear(FaceCatalogDraft catalog, FaceAssemblySlot slot)
    {
        EnsureCatalog(catalog);
        if (!Enum.IsDefined(slot)) throw new ArgumentOutOfRangeException(nameof(slot));
        var updated = Selections.ToImmutableDictionary().Remove(slot);
        if (EyeSidesLinked && IsEyeSlot(slot)) updated = updated.Remove(GetOppositeSlot(slot));
        if (EyebrowSidesLinked && IsEyebrowSlot(slot)) updated = updated.Remove(GetOppositeSlot(slot));
        return Recreate(catalog, updated);
    }

    public FaceAssembly SetEyeSidesLinked(FaceCatalogDraft catalog, bool linked)
    {
        EnsureCatalog(catalog);
        var updated = Selections.ToImmutableDictionary();
        if (linked)
        {
            foreach (var (left, right) in EyeSlotPairs)
            {
                if (updated.TryGetValue(left, out var leftId)) updated = updated.SetItem(right, leftId);
                else if (updated.TryGetValue(right, out var rightId)) updated = updated.SetItem(left, rightId);
            }
        }
        return Recreate(catalog, updated, eyeSidesLinked: linked);
    }

    public FaceAssembly SetEyebrowSidesLinked(FaceCatalogDraft catalog, bool linked)
    {
        EnsureCatalog(catalog);
        var updated = Selections.ToImmutableDictionary();
        if (linked)
        {
            if (updated.TryGetValue(FaceAssemblySlot.EyebrowLeft, out var leftId))
                updated = updated.SetItem(FaceAssemblySlot.EyebrowRight, leftId);
            else if (updated.TryGetValue(FaceAssemblySlot.EyebrowRight, out var rightId))
                updated = updated.SetItem(FaceAssemblySlot.EyebrowLeft, rightId);
        }
        return Recreate(catalog, updated, eyebrowSidesLinked: linked);
    }

    public FaceAssembly SetEyeMode(FaceCatalogDraft catalog, FaceEyeMode mode)
    {
        EnsureCatalog(catalog);
        if (!Enum.IsDefined(mode)) throw new ArgumentOutOfRangeException(nameof(mode));
        return new FaceAssembly(CatalogId, catalog.Revision, Selections.ToImmutableDictionary(),
            EyeSidesLinked, EyebrowSidesLinked, mode, MouthMode);
    }

    public FaceAssembly SetMouthMode(FaceCatalogDraft catalog, FaceMouthMode mode)
    {
        EnsureCatalog(catalog);
        if (!Enum.IsDefined(mode)) throw new ArgumentOutOfRangeException(nameof(mode));
        return new FaceAssembly(CatalogId, catalog.Revision, Selections.ToImmutableDictionary(),
            EyeSidesLinked, EyebrowSidesLinked, EyeMode, mode);
    }

    private FaceAssembly Recreate(FaceCatalogDraft catalog,
        ImmutableDictionary<FaceAssemblySlot, FaceComponentId> selections,
        bool? eyeSidesLinked = null, bool? eyebrowSidesLinked = null) =>
        Restore(catalog, selections, eyeSidesLinked ?? EyeSidesLinked, eyebrowSidesLinked ?? EyebrowSidesLinked, EyeMode, MouthMode);

    private void EnsureCatalog(FaceCatalogDraft catalog)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        if (CatalogId != catalog.Id || CatalogRevision != catalog.Revision)
            throw new InvalidOperationException("The face assembly is pinned to a different catalog revision.");
    }

    private FaceAssemblySlot FindHeadExtraSlot(FaceComponentId componentId)
    {
        foreach (var slot in HeadExtraSlots)
            if (Selections.TryGetValue(slot, out var selected) && selected == componentId)
                return slot;
        foreach (var slot in HeadExtraSlots)
            if (!Selections.ContainsKey(slot)) return slot;
        throw new InvalidOperationException("A face assembly supports at most eight head extras.");
    }

    private static FaceAssemblySlot GetSlot(FaceComponent component) => component.Kind switch
    {
        FaceComponentKind.Eye => component.Side == FaceComponentSide.Left ? FaceAssemblySlot.EyeLeft : FaceAssemblySlot.EyeRight,
        FaceComponentKind.Pupil => component.Side == FaceComponentSide.Left ? FaceAssemblySlot.PupilLeft : FaceAssemblySlot.PupilRight,
        FaceComponentKind.ClosedEye => component.Side == FaceComponentSide.Left ? FaceAssemblySlot.ClosedEyeLeft : FaceAssemblySlot.ClosedEyeRight,
        FaceComponentKind.Eyebrow => component.Side == FaceComponentSide.Left ? FaceAssemblySlot.EyebrowLeft : FaceAssemblySlot.EyebrowRight,
        FaceComponentKind.Nose => FaceAssemblySlot.Nose,
        FaceComponentKind.Mouth => component.MouthVariant == FaceMouthVariant.Closed
            ? FaceAssemblySlot.MouthClosed : FaceAssemblySlot.MouthOpen,
        FaceComponentKind.EyeHighlight => component.Side == FaceComponentSide.Left ? FaceAssemblySlot.EyeHighlightLeft : FaceAssemblySlot.EyeHighlightRight,
        FaceComponentKind.Blush => FaceAssemblySlot.Blush,
        FaceComponentKind.FacialShadow => FaceAssemblySlot.FacialShadow,
        FaceComponentKind.HeadExtra => FaceAssemblySlot.HeadExtra1,
        _ => throw new ArgumentOutOfRangeException(nameof(component))
    };

    private static bool MatchesSlot(FaceAssemblySlot slot, FaceComponent component,
        bool eyeSidesLinked, bool eyebrowSidesLinked)
    {
        var sourceSlot = GetSlot(component);
        if (component.Kind == FaceComponentKind.HeadExtra) return IsHeadExtraSlot(slot);
        if (sourceSlot == slot) return true;
        if (eyeSidesLinked && IsEyePart(component.Kind)) return GetOppositeSlot(sourceSlot) == slot;
        return eyebrowSidesLinked && component.Kind == FaceComponentKind.Eyebrow
            && GetOppositeSlot(sourceSlot) == slot;
    }
    private static bool IsEyePart(FaceComponentKind kind) => kind is FaceComponentKind.Eye or FaceComponentKind.Pupil or FaceComponentKind.ClosedEye;
    private static bool IsEyeSlot(FaceAssemblySlot slot) => EyeSlotPairs.Any(pair => pair.Left == slot || pair.Right == slot);
    private static bool IsEyebrowSlot(FaceAssemblySlot slot) => slot is FaceAssemblySlot.EyebrowLeft or FaceAssemblySlot.EyebrowRight;
    public static bool IsHeadExtraSlot(FaceAssemblySlot slot) => slot is >= FaceAssemblySlot.HeadExtra1 and <= FaceAssemblySlot.HeadExtra8;
    private static readonly FaceAssemblySlot[] HeadExtraSlots =
    [FaceAssemblySlot.HeadExtra1, FaceAssemblySlot.HeadExtra2, FaceAssemblySlot.HeadExtra3, FaceAssemblySlot.HeadExtra4,
     FaceAssemblySlot.HeadExtra5, FaceAssemblySlot.HeadExtra6, FaceAssemblySlot.HeadExtra7, FaceAssemblySlot.HeadExtra8];

    private static FaceAssemblySlot GetOppositeSlot(FaceAssemblySlot slot) => slot switch
    {
        FaceAssemblySlot.EyeLeft => FaceAssemblySlot.EyeRight,
        FaceAssemblySlot.EyeRight => FaceAssemblySlot.EyeLeft,
        FaceAssemblySlot.PupilLeft => FaceAssemblySlot.PupilRight,
        FaceAssemblySlot.PupilRight => FaceAssemblySlot.PupilLeft,
        FaceAssemblySlot.ClosedEyeLeft => FaceAssemblySlot.ClosedEyeRight,
        FaceAssemblySlot.ClosedEyeRight => FaceAssemblySlot.ClosedEyeLeft,
        FaceAssemblySlot.EyebrowLeft => FaceAssemblySlot.EyebrowRight,
        FaceAssemblySlot.EyebrowRight => FaceAssemblySlot.EyebrowLeft,
        _ => throw new ArgumentOutOfRangeException(nameof(slot), "The slot has no opposite side.")
    };

    private static readonly (FaceAssemblySlot Left, FaceAssemblySlot Right)[] EyeSlotPairs =
    [
        (FaceAssemblySlot.EyeLeft, FaceAssemblySlot.EyeRight),
        (FaceAssemblySlot.PupilLeft, FaceAssemblySlot.PupilRight),
        (FaceAssemblySlot.ClosedEyeLeft, FaceAssemblySlot.ClosedEyeRight)
    ];
}
