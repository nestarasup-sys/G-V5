using System.Collections.Immutable;
using GV5.Core.Identity;
using GV5.Geometry;

namespace GV5.Core.Models;

/// <summary>Editable expression snapshot referencing one collection and exact face catalog revision.</summary>
public sealed record FaceExpressionPresetDraft
{
    public const int MaximumExpressionIndex = 999;
    private readonly ImmutableDictionary<FaceAssemblySlot, FaceComponentId> _selections;
    private readonly ImmutableDictionary<FaceAssemblySlot, Transform2D> _transforms;
    private readonly ImmutableDictionary<FaceAssemblySlot, Transform2D> _referenceTransforms;

    private FaceExpressionPresetDraft(FaceExpressionPresetId id, FaceExpressionCollectionId collectionId,
        ModelRevisionReference model, FaceId faceId, Revision faceRevision, Revision revision,
        int expressionIndex, string name,
        ImmutableDictionary<FaceAssemblySlot, FaceComponentId> selections,
        ImmutableDictionary<FaceAssemblySlot, Transform2D> transforms,
        ImmutableDictionary<FaceAssemblySlot, Transform2D> referenceTransforms,
        FaceEyeMode eyeMode, FaceMouthMode mouthMode, bool eyeSidesLinked, bool eyebrowSidesLinked,
        double noseOpacity, FaceExpressionEffects effects)
    {
        Id = id;
        CollectionId = collectionId;
        Model = model;
        FaceId = faceId;
        FaceRevision = faceRevision;
        Revision = revision;
        ExpressionIndex = expressionIndex;
        Name = name;
        _selections = selections;
        _transforms = transforms;
        _referenceTransforms = referenceTransforms;
        EyeMode = eyeMode;
        MouthMode = mouthMode;
        EyeSidesLinked = eyeSidesLinked;
        EyebrowSidesLinked = eyebrowSidesLinked;
        NoseOpacity = noseOpacity;
        Effects = effects;
    }

    public FaceExpressionPresetId Id { get; }
    public FaceExpressionCollectionId CollectionId { get; }
    public ModelRevisionReference Model { get; }
    public FaceId FaceId { get; }
    public Revision FaceRevision { get; }
    public Revision Revision { get; }
    public int ExpressionIndex { get; }
    public string Name { get; }
    public IReadOnlyDictionary<FaceAssemblySlot, FaceComponentId> Selections => _selections;
    public IReadOnlyDictionary<FaceAssemblySlot, Transform2D> Transforms => _transforms;
    public IReadOnlyDictionary<FaceAssemblySlot, Transform2D> ReferenceTransforms => _referenceTransforms;
    public FaceEyeMode EyeMode { get; }
    public FaceMouthMode MouthMode { get; }
    public bool EyeSidesLinked { get; }
    public bool EyebrowSidesLinked { get; }
    public double NoseOpacity { get; }
    public FaceExpressionEffects Effects { get; }

    public static FaceExpressionPresetDraft Create(FaceExpressionCollection collection, FaceCatalogDraft catalog,
        int expressionIndex, string name, FaceAssembly? assembly = null)
    {
        ArgumentNullException.ThrowIfNull(collection);
        ArgumentNullException.ThrowIfNull(catalog);
        if (collection.Model != catalog.Model) throw new ArgumentException("The expression collection and face catalog must use the same exact model revision.");
        var draft = Restore(FaceExpressionPresetId.New(), collection.Id, collection.Model, catalog.Id, catalog.Revision,
            Revision.Initial, expressionIndex, name, [], [], [], FaceEyeMode.Open, FaceMouthMode.Closed,
            false, false, 1, FaceExpressionEffects.LegacyDefaults);
        if (assembly is null) return draft;
        var composed = draft.WithAssembly(catalog, assembly);
        return Restore(draft.Id, draft.CollectionId, draft.Model, draft.FaceId, draft.FaceRevision,
            Revision.Initial, draft.ExpressionIndex, composed.Name, composed.Selections, composed.Transforms,
            composed.ReferenceTransforms, composed.EyeMode, composed.MouthMode, composed.EyeSidesLinked,
            composed.EyebrowSidesLinked, composed.NoseOpacity, composed.Effects);
    }

    public static FaceExpressionPresetDraft Restore(FaceExpressionPresetId id,
        FaceExpressionCollectionId collectionId, ModelRevisionReference model, FaceId faceId,
        Revision faceRevision, Revision revision, int expressionIndex, string name,
        IEnumerable<KeyValuePair<FaceAssemblySlot, FaceComponentId>> selections,
        IEnumerable<KeyValuePair<FaceAssemblySlot, Transform2D>> transforms,
        IEnumerable<KeyValuePair<FaceAssemblySlot, Transform2D>> referenceTransforms,
        FaceEyeMode eyeMode, FaceMouthMode mouthMode, bool eyeSidesLinked, bool eyebrowSidesLinked,
        double noseOpacity, FaceExpressionEffects? effects = null)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(selections);
        ArgumentNullException.ThrowIfNull(transforms);
        ArgumentNullException.ThrowIfNull(referenceTransforms);
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var normalizedName = name.Trim();
        if (!id.IsValid || !collectionId.IsValid || !faceId.IsValid || !faceRevision.IsValid || !revision.IsValid)
            throw new ArgumentException("An expression preset requires valid stable IDs and revisions.");
        if (expressionIndex is < 0 or > MaximumExpressionIndex) throw new ArgumentOutOfRangeException(nameof(expressionIndex));
        if (normalizedName.Length > 80) throw new ArgumentOutOfRangeException(nameof(name));
        if (!Enum.IsDefined(eyeMode)) throw new ArgumentOutOfRangeException(nameof(eyeMode));
        if (!Enum.IsDefined(mouthMode)) throw new ArgumentOutOfRangeException(nameof(mouthMode));
        if (!double.IsFinite(noseOpacity) || noseOpacity is < 0 or > 1) throw new ArgumentOutOfRangeException(nameof(noseOpacity));
        var selectionMap = BuildMap(selections, static value => value.IsValid, "Selection slots and component IDs must be unique and valid.");
        var transformMap = BuildMap(transforms, static _ => true, "Expression transforms must use unique valid slots.");
        var referenceMap = BuildMap(referenceTransforms, static _ => true, "Reference transforms must use unique valid slots.");
        if (!selectionMap.Keys.ToHashSet().SetEquals(transformMap.Keys)
            || !selectionMap.Keys.ToHashSet().SetEquals(referenceMap.Keys))
            throw new ArgumentException("Each selected component must have both an authored transform and its calibration reference.");
        if (transformMap.Values.Any(transform => !IsValidTransform(transform))
            || referenceMap.Values.Any(transform => !IsValidTransform(transform)))
            throw new ArgumentOutOfRangeException(nameof(transforms), "Expression transforms must be finite and within supported bounds.");
        if (eyeSidesLinked && !IsPairConsistent(selectionMap, FaceAssemblySlot.EyeLeft, FaceAssemblySlot.EyeRight))
            throw new ArgumentException("Linked eye slots must reference the same component.", nameof(selections));
        if (eyebrowSidesLinked && !IsPairConsistent(selectionMap, FaceAssemblySlot.EyebrowLeft, FaceAssemblySlot.EyebrowRight))
            throw new ArgumentException("Linked eyebrow slots must reference the same component.", nameof(selections));
        return new FaceExpressionPresetDraft(id, collectionId, model, faceId, faceRevision, revision,
            expressionIndex, normalizedName, selectionMap, transformMap, referenceMap,
            eyeMode, mouthMode, eyeSidesLinked, eyebrowSidesLinked, noseOpacity,
            effects ?? FaceExpressionEffects.LegacyDefaults);
    }

    public FaceExpressionPresetDraft WithName(string name) => Copy(name: name);
    public FaceExpressionPresetDraft WithEffects(FaceExpressionEffects effects) => Copy(effects: effects);
    public FaceExpressionPresetDraft WithNoseOpacity(double opacity) => Copy(noseOpacity: opacity);

    public FaceExpressionPresetDraft WithAssembly(FaceCatalogDraft catalog, FaceAssembly assembly)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        ArgumentNullException.ThrowIfNull(assembly);
        if (catalog.Id != FaceId || catalog.Revision != FaceRevision || catalog.Model != Model
            || assembly.CatalogId != catalog.Id || assembly.CatalogRevision != catalog.Revision)
            throw new ArgumentException("The expression, assembly and face catalog must reference the same pinned revisions.");
        _ = FaceAssembly.Restore(catalog, assembly.Selections, assembly.EyeSidesLinked,
            assembly.EyebrowSidesLinked, assembly.EyeMode, assembly.MouthMode);
        var selections = assembly.Selections.ToImmutableDictionary();
        var sameComposition = _selections.Count == selections.Count
            && _selections.All(pair => selections.TryGetValue(pair.Key, out var selected) && selected == pair.Value);
        var references = ImmutableDictionary.CreateBuilder<FaceAssemblySlot, Transform2D>();
        foreach (var (slot, componentId) in selections)
        {
            var component = catalog.Components.Single(item => item.Id == componentId);
            references.Add(slot, GetCalibratedTransform(slot, component));
        }
        var transforms = sameComposition
            ? _transforms.Where(pair => selections.ContainsKey(pair.Key)).ToImmutableDictionary()
            : references.ToImmutable();
        return Restore(Id, CollectionId, Model, FaceId, FaceRevision, Revision.Next(), ExpressionIndex, Name,
            selections, transforms, references, assembly.EyeMode, assembly.MouthMode,
            assembly.EyeSidesLinked, assembly.EyebrowSidesLinked, NoseOpacity, Effects);
    }

    public FaceExpressionPresetDraft WithTransform(FaceAssemblySlot slot, Transform2D transform)
    {
        if (!_transforms.ContainsKey(slot)) throw new InvalidOperationException("The expression has no selected component in this slot.");
        var updated = _transforms.SetItem(slot, transform);
        return Restore(Id, CollectionId, Model, FaceId, FaceRevision, Revision.Next(), ExpressionIndex, Name,
            _selections, updated, _referenceTransforms, EyeMode, MouthMode, EyeSidesLinked, EyebrowSidesLinked,
            NoseOpacity, Effects);
    }

    /// <summary>Rebases authored offsets on fresh component calibration while keeping each expression's private edits.</summary>
    public FaceExpressionPresetDraft RebaseReferenceTransforms(FaceCatalogDraft updatedCatalog)
    {
        ArgumentNullException.ThrowIfNull(updatedCatalog);
        if (updatedCatalog.Id != FaceId || updatedCatalog.Model != Model)
            throw new ArgumentException("A preset can only rebase onto a newer revision of its same face catalog and model.", nameof(updatedCatalog));
        var transformed = ImmutableDictionary.CreateBuilder<FaceAssemblySlot, Transform2D>();
        var referenceMap = ImmutableDictionary.CreateBuilder<FaceAssemblySlot, Transform2D>();
        foreach (var slot in _selections.Keys)
        {
            var component = updatedCatalog.Components.FirstOrDefault(item => item.Id == _selections[slot])
                ?? throw new ArgumentException("The updated face catalog removed a component required by this expression.", nameof(updatedCatalog));
            var calibration = GetCalibratedTransform(slot, component);
            referenceMap.Add(slot, calibration);
            transformed.Add(slot, Rebase(_transforms[slot], _referenceTransforms[slot], calibration));
        }
        return Restore(Id, CollectionId, Model, FaceId, updatedCatalog.Revision, Revision.Next(), ExpressionIndex, Name,
            _selections, transformed, referenceMap, EyeMode, MouthMode, EyeSidesLinked, EyebrowSidesLinked,
            NoseOpacity, Effects);
    }

    private FaceExpressionPresetDraft Copy(string? name = null, double? noseOpacity = null, FaceExpressionEffects? effects = null) =>
        Restore(Id, CollectionId, Model, FaceId, FaceRevision, Revision.Next(), ExpressionIndex, name ?? Name,
            _selections, _transforms, _referenceTransforms, EyeMode, MouthMode, EyeSidesLinked, EyebrowSidesLinked,
            noseOpacity ?? NoseOpacity, effects ?? Effects);

    private static ImmutableDictionary<TKey, TValue> BuildMap<TKey, TValue>(
        IEnumerable<KeyValuePair<TKey, TValue>> pairs, Func<TValue, bool> isValid, string error)
        where TKey : struct, Enum
    {
        var builder = ImmutableDictionary.CreateBuilder<TKey, TValue>();
        foreach (var (key, value) in pairs)
            if (!Enum.IsDefined(key) || !isValid(value) || !builder.TryAdd(key, value))
                throw new ArgumentException(error, nameof(pairs));
        return builder.ToImmutable();
    }

    private static bool IsValidTransform(Transform2D value) =>
        double.IsFinite(value.Translation.X) && double.IsFinite(value.Translation.Y)
        && double.IsFinite(value.Scale.X) && double.IsFinite(value.Scale.Y)
        && double.IsFinite(value.RotationRadians) && double.IsFinite(value.Pivot.X) && double.IsFinite(value.Pivot.Y)
        && value.Translation.X is >= -100_000 and <= 100_000 && value.Translation.Y is >= -100_000 and <= 100_000
        && value.Scale.X is > 0 and <= 20 && value.Scale.Y is > 0 and <= 20;

    private static bool IsPairConsistent(ImmutableDictionary<FaceAssemblySlot, FaceComponentId> selections,
        FaceAssemblySlot left, FaceAssemblySlot right) =>
        !selections.ContainsKey(left) && !selections.ContainsKey(right)
        || selections.TryGetValue(left, out var leftId) && selections.TryGetValue(right, out var rightId) && leftId == rightId;

    private static FaceComponentSide? GetTargetSide(FaceAssemblySlot slot) => slot switch
    {
        FaceAssemblySlot.EyeLeft or FaceAssemblySlot.PupilLeft or FaceAssemblySlot.ClosedEyeLeft
            or FaceAssemblySlot.EyebrowLeft or FaceAssemblySlot.EyeHighlightLeft => FaceComponentSide.Left,
        FaceAssemblySlot.EyeRight or FaceAssemblySlot.PupilRight or FaceAssemblySlot.ClosedEyeRight
            or FaceAssemblySlot.EyebrowRight or FaceAssemblySlot.EyeHighlightRight => FaceComponentSide.Right,
        _ => null
    };

    private static Transform2D GetCalibratedTransform(FaceAssemblySlot slot, FaceComponent component)
    {
        var transform = component.Transform;
        var targetSide = GetTargetSide(slot);
        return targetSide is { } side && component.Side != side
            ? new Transform2D(transform.Translation, transform.Scale, transform.RotationRadians,
                transform.Pivot, !transform.FlipX, transform.FlipY)
            : transform;
    }

    private static Transform2D Rebase(Transform2D authored, Transform2D oldReference, Transform2D newReference)
    {
        static double ScaleDelta(double authoredValue, double oldValue, double newValue) =>
            authoredValue / oldValue * newValue;
        var rotationDelta = (authored.RotationRadians - oldReference.RotationRadians + Math.PI * 3) % (Math.PI * 2) - Math.PI;
        return new Transform2D(
            new Point2D(newReference.Translation.X + authored.Translation.X - oldReference.Translation.X,
                newReference.Translation.Y + authored.Translation.Y - oldReference.Translation.Y),
            new Point2D(ScaleDelta(authored.Scale.X, oldReference.Scale.X, newReference.Scale.X),
                ScaleDelta(authored.Scale.Y, oldReference.Scale.Y, newReference.Scale.Y)),
            newReference.RotationRadians + rotationDelta,
            newReference.Pivot,
            authored.FlipX, authored.FlipY);
    }
}
