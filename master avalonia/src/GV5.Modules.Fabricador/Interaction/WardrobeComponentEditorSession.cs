using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;

namespace GV5.Modules.Fabricador.Interaction;

/// <summary>Applies source-sheet garment transforms to an editable draft and refreshes its frozen bone binding.</summary>
public sealed class WardrobeComponentEditorSession
{
    private const int HistoryLimit = 50;
    private readonly IReadOnlyDictionary<ModelPartId, WardrobeBoneFrame> _sourceBones;
    private readonly List<WardrobeComponentEdit> _undo = [];
    private readonly List<WardrobeComponentEdit> _redo = [];

    public WardrobeComponentEditorSession(WardrobeSet draft, PublishedModelRevision model)
    {
        ArgumentNullException.ThrowIfNull(draft);
        ArgumentNullException.ThrowIfNull(model);
        if (draft.Model != ModelRevisionReference.From(model))
            throw new ArgumentException("The wardrobe draft must use the exact model publication supplied to the editor.", nameof(draft));
        _sourceBones = model.Content.Parts.ToDictionary(part => part.Id, CreateSourceFrame);
        ValidateComponents(draft);
        Draft = draft;
    }

    public WardrobeSet Draft { get; private set; }
    public bool CanUndo => _undo.Count > 0;
    public bool CanRedo => _redo.Count > 0;
    public int UndoCount => _undo.Count;
    public int RedoCount => _redo.Count;
    public WardrobeComponent? SelectedComponent => SelectedComponentId is { } id
        ? Draft.Components.FirstOrDefault(component => component.Id == id)
        : null;
    public WardrobeComponentId? SelectedComponentId { get; private set; }

    public void Select(WardrobeComponentId componentId)
    {
        if (!Draft.Components.Any(component => component.Id == componentId))
            throw new KeyNotFoundException("The wardrobe component does not exist in this draft.");
        SelectedComponentId = componentId;
    }

    public WardrobeComponentEditorSession MoveBy(WardrobeComponentId componentId, Point2D delta)
    {
        var component = GetComponent(componentId);
        var moved = new Rect2D(component.Placement.X + delta.X, component.Placement.Y + delta.Y,
            component.Placement.Width, component.Placement.Height);
        return Replace(component.WithPlacement(moved, component.RotationDegrees, GetBone(component.BoneId)));
    }

    public WardrobeComponentEditorSession ScaleBy(WardrobeComponentId componentId, double scaleX, double scaleY)
    {
        if (!double.IsFinite(scaleX) || !double.IsFinite(scaleY) || scaleX <= 0 || scaleY <= 0)
            throw new ArgumentOutOfRangeException(nameof(scaleX), "Wardrobe scales must be finite and positive.");
        var component = GetComponent(componentId);
        var width = component.Placement.Width * scaleX;
        var height = component.Placement.Height * scaleY;
        var placement = new Rect2D(component.Placement.X + (component.Placement.Width - width) / 2,
            component.Placement.Y + (component.Placement.Height - height) / 2, width, height);
        return Replace(component.WithPlacement(placement, component.RotationDegrees, GetBone(component.BoneId)));
    }

    public WardrobeComponentEditorSession RotateTo(WardrobeComponentId componentId, double rotationDegrees)
    {
        if (!double.IsFinite(rotationDegrees)) throw new ArgumentOutOfRangeException(nameof(rotationDegrees));
        var component = GetComponent(componentId);
        return Replace(component.WithPlacement(component.Placement, rotationDegrees, GetBone(component.BoneId)));
    }

    /// <summary>Reassigns the component while preserving its current sheet-space placement and rebinding locally.</summary>
    public WardrobeComponentEditorSession AttachToBone(WardrobeComponentId componentId, ModelPartId boneId)
    {
        var component = GetComponent(componentId);
        return Replace(component.WithBone(boneId, GetBone(boneId)));
    }

    private WardrobeComponentEditorSession Replace(WardrobeComponent updated)
    {
        var before = GetComponent(updated.Id);
        if (before == updated) return this;
        _undo.Add(new WardrobeComponentEdit(updated.Id, before, updated));
        Trim(_undo);
        _redo.Clear();
        ApplyComponent(updated.Id, updated);
        return this;
    }

    /// <summary>Restores the prior immutable component snapshot while keeping the draft revision monotonic.</summary>
    public bool Undo()
    {
        if (!CanUndo) return false;
        var edit = _undo[^1];
        _undo.RemoveAt(_undo.Count - 1);
        ApplyComponent(edit.ComponentId, edit.Before);
        _redo.Add(edit);
        Trim(_redo);
        return true;
    }

    /// <summary>Reapplies one component edit without replacing any other component.</summary>
    public bool Redo()
    {
        if (!CanRedo) return false;
        var edit = _redo[^1];
        _redo.RemoveAt(_redo.Count - 1);
        ApplyComponent(edit.ComponentId, edit.After);
        _undo.Add(edit);
        Trim(_undo);
        return true;
    }

    private void ApplyComponent(WardrobeComponentId componentId, WardrobeComponent component)
    {
        if (component.Id != componentId || !Draft.Components.Any(current => current.Id == componentId))
            throw new InvalidOperationException("A wardrobe history command must target an existing matching component.");
        Draft = Draft.WithContent(Draft.Name,
            Draft.Components.Select(current => current.Id == componentId ? component : current));
    }

    private static void Trim(List<WardrobeComponentEdit> history)
    {
        if (history.Count > HistoryLimit) history.RemoveRange(0, history.Count - HistoryLimit);
    }

    private sealed record WardrobeComponentEdit(
        WardrobeComponentId ComponentId,
        WardrobeComponent Before,
        WardrobeComponent After);

    private WardrobeComponent GetComponent(WardrobeComponentId id) =>
        Draft.Components.FirstOrDefault(component => component.Id == id)
        ?? throw new KeyNotFoundException("The wardrobe component does not exist in this draft.");

    private WardrobeBoneFrame GetBone(ModelPartId id) => _sourceBones.TryGetValue(id, out var bone)
        ? bone
        : throw new KeyNotFoundException("The target bone does not exist in the pinned model publication.");

    private void ValidateComponents(WardrobeSet draft)
    {
        foreach (var component in draft.Components)
        {
            var bone = GetBone(component.BoneId);
            if (!string.Equals(component.Binding.BoneId, bone.BoneId, StringComparison.Ordinal))
                throw new ArgumentException("A wardrobe component binding does not match its attached model bone.", nameof(draft));
        }
    }

    private static WardrobeBoneFrame CreateSourceFrame(ModelPart part)
    {
        var transform = part.SourceTransform.Transform;
        var crop = part.SourceTransform.Crop;
        return WardrobeBoneFrame.FromTransform(part.Id.ToString(), crop, transform);
    }
}
