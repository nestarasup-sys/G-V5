using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;

namespace GV5.Modules.Fabricador.Interaction;

/// <summary>Reversible in-memory hair edits pinned to one immutable model publication.</summary>
public sealed class HairStyleEditorSession
{
    private const int HistoryLimit = 50;
    private readonly List<HairStyleDraft> _undo = [];
    private readonly List<HairStyleDraft> _redo = [];

    public HairStyleDraft Draft { get; private set; }
    public HairPartId? SelectedPart { get; private set; }
    public bool CanUndo => _undo.Count > 0;
    public bool CanRedo => _redo.Count > 0;
    public int UndoCount => _undo.Count;
    public int RedoCount => _redo.Count;

    public HairStyleEditorSession(PublishedModelRevision model, HairStyleDraft? draft = null)
    {
        ArgumentNullException.ThrowIfNull(model);
        Draft = draft ?? HairStyleDraft.Create(ModelRevisionReference.From(model), "Novo cabelo");
        if (Draft.Model != ModelRevisionReference.From(model))
            throw new ArgumentException("The hair draft must be pinned to the exact model publication supplied to the editor.", nameof(draft));
    }

    public void Select(HairPartId part)
    {
        if (!Enum.IsDefined(part)) throw new ArgumentOutOfRangeException(nameof(part));
        SelectedPart = part;
    }

    public bool AddOrReplace(HairLayer layer)
    {
        ArgumentNullException.ThrowIfNull(layer);
        if (Draft.Layers.FirstOrDefault(item => item.Slot == layer.Slot) == layer) return false;
        return Apply(Draft.WithLayer(layer));
    }

    public bool Remove(HairPartId part)
    {
        if (!Enum.IsDefined(part)) throw new ArgumentOutOfRangeException(nameof(part));
        return Apply(Draft.WithoutLayer(part));
    }

    public bool Move(HairPartId part, int offset) => Apply(Draft.MoveLayer(part, offset));

    public bool SetTransform(HairPartId part, Transform2D transform) =>
        Apply(Draft.WithLayerTransform(part, transform));

    public bool SetVisibility(HairPartId part, bool visible) =>
        Apply(Draft.WithLayerVisibility(part, visible));

    public bool SetColor(HairColorRole role, uint rgb) =>
        Apply(Draft.WithPalette(Draft.Palette.WithColor(role, rgb)));

    public bool ClearColor(HairColorRole role) =>
        Apply(Draft.WithPalette(Draft.Palette.WithoutColor(role)));

    /// <summary>Rewrites or removes temporary asset references in the current draft and history before staging is deleted.</summary>
    public bool ReconcileAssetReferences(IReadOnlyDictionary<AssetId, AssetId> replacements,
        IReadOnlySet<AssetId> invalidAssets)
    {
        ArgumentNullException.ThrowIfNull(replacements);
        ArgumentNullException.ThrowIfNull(invalidAssets);
        if (replacements.Keys.Any(id => !id.IsValid) || replacements.Values.Any(id => !id.IsValid)
            || invalidAssets.Any(id => !id.IsValid))
            throw new ArgumentException("Asset reference reconciliation requires valid asset IDs.");

        var changed = false;
        Draft = Rewrite(Draft, replacements, invalidAssets, ref changed);
        RewriteHistory(_undo, replacements, invalidAssets, ref changed);
        RewriteHistory(_redo, replacements, invalidAssets, ref changed);
        if (SelectedPart is { } selected && Draft.Layers.All(layer => layer.Part != selected)) SelectedPart = null;
        return changed;
    }

    public bool Undo()
    {
        if (!CanUndo) return false;
        var previous = _undo[^1];
        _undo.RemoveAt(_undo.Count - 1);
        _redo.Add(Draft);
        Trim(_redo);
        Draft = Draft.WithContent(previous.Name, previous.Layers, previous.Palette);
        return true;
    }

    public bool Redo()
    {
        if (!CanRedo) return false;
        var next = _redo[^1];
        _redo.RemoveAt(_redo.Count - 1);
        _undo.Add(Draft);
        Trim(_undo);
        Draft = Draft.WithContent(next.Name, next.Layers, next.Palette);
        return true;
    }

    private bool Apply(HairStyleDraft next)
    {
        if (ReferenceEquals(next, Draft) || next == Draft) return false;
        _undo.Add(Draft);
        Trim(_undo);
        _redo.Clear();
        Draft = next;
        return true;
    }

    private static void RewriteHistory(List<HairStyleDraft> history,
        IReadOnlyDictionary<AssetId, AssetId> replacements, IReadOnlySet<AssetId> invalidAssets, ref bool changed)
    {
        for (var index = 0; index < history.Count; index++)
            history[index] = Rewrite(history[index], replacements, invalidAssets, ref changed);
    }

    private static HairStyleDraft Rewrite(HairStyleDraft draft,
        IReadOnlyDictionary<AssetId, AssetId> replacements, IReadOnlySet<AssetId> invalidAssets, ref bool changed)
    {
        var layers = new List<HairLayer>(draft.Layers.Length);
        var localChanged = false;
        foreach (var layer in draft.Layers)
        {
            if (invalidAssets.Contains(layer.AssetId))
            {
                localChanged = true;
                continue;
            }
            if (replacements.TryGetValue(layer.AssetId, out var replacement) && replacement != layer.AssetId)
            {
                layers.Add(HairLayer.Create(layer.Part, replacement, layer.Transform, layer.IsVisible));
                localChanged = true;
            }
            else layers.Add(layer);
        }
        if (!localChanged) return draft;
        changed = true;
        return draft.WithContent(draft.Name, layers, draft.Palette);
    }

    private static void Trim(List<HairStyleDraft> history)
    {
        if (history.Count > HistoryLimit) history.RemoveRange(0, history.Count - HistoryLimit);
    }
}
