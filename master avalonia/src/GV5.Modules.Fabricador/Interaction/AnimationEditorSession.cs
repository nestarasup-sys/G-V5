using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;

namespace GV5.Modules.Fabricador.Interaction;

/// <summary>Edits frame keys over one exact immutable model publication.</summary>
public sealed class AnimationEditorSession
{
    private readonly PublishedModelRevision _modelRevision;

    public AnimationDraft Draft { get; private set; }
    public AnimationFrameId SelectedFrameId { get; private set; }
    public ModelPartId? SelectedPartId { get; private set; }
    public AnimationFrame SelectedFrame => Draft.Frames.Single(frame => frame.Id == SelectedFrameId);
    public ModelDraftContent PreviewContent => Draft.ApplyFrameToModelRevision(_modelRevision, SelectedFrameId);

    public AnimationEditorSession(PublishedModelRevision modelRevision, AnimationDraft draft)
    {
        _modelRevision = modelRevision ?? throw new ArgumentNullException(nameof(modelRevision));
        Draft = draft ?? throw new ArgumentNullException(nameof(draft));
        foreach (var frame in draft.Frames) _ = draft.ApplyFrameToModelRevision(modelRevision, frame.Id);
        SelectedFrameId = draft.Frames[0].Id;
        SelectedPartId = draft.LayerOrder.FirstOrDefault();
    }

    public bool SelectFrame(AnimationFrameId frameId)
    {
        if (!Draft.Frames.Any(frame => frame.Id == frameId)) return false;
        SelectedFrameId = frameId;
        return true;
    }

    public bool SelectPart(ModelPartId partId)
    {
        if (!SelectedFrame.Keys.Any(key => key.PartId == partId)) return false;
        SelectedPartId = partId;
        return true;
    }

    public void SetPartKey(ModelPartId partId, Transform2D transform, bool isVisible)
    {
        var keys = SelectedFrame.Keys.Select(key => key.PartId == partId
            ? AnimationPartKey.Create(partId, transform, isVisible)
            : key).ToArray();
        if (keys.All(key => key.PartId != partId)) throw new KeyNotFoundException("The selected part is not in this animation frame.");
        ReplaceSelectedFrame(AnimationFrame.Restore(SelectedFrame.Id, SelectedFrame.DurationMs, keys, SelectedFrame.RigJoints));
    }

    public void SetFrameDuration(int durationMs) =>
        ReplaceSelectedFrame(AnimationFrame.Restore(SelectedFrame.Id, durationMs, SelectedFrame.Keys, SelectedFrame.RigJoints));

    public void AddFrame()
    {
        var copy = AnimationFrame.Create(SelectedFrame.DurationMs,
            SelectedFrame.Keys.Select(key => AnimationPartKey.Create(key.PartId, key.Transform, key.IsVisible)),
            SelectedFrame.RigJoints);
        var frames = Draft.Frames.ToList();
        var index = frames.FindIndex(frame => frame.Id == SelectedFrameId);
        frames.Insert(index + 1, copy);
        UpdateDraft(frames);
        SelectedFrameId = copy.Id;
    }

    public bool DeleteSelectedFrame()
    {
        if (Draft.Frames.Length <= 1) return false;
        var frames = Draft.Frames.ToList();
        var index = frames.FindIndex(frame => frame.Id == SelectedFrameId);
        frames.RemoveAt(index);
        var next = frames[Math.Max(0, index - 1)];
        UpdateDraft(frames);
        SelectedFrameId = next.Id;
        return true;
    }

    public bool MoveSelectedFrame(int offset)
    {
        var frames = Draft.Frames.ToList();
        var index = frames.FindIndex(frame => frame.Id == SelectedFrameId);
        var target = index + offset;
        if (index < 0 || target < 0 || target >= frames.Count) return false;
        (frames[index], frames[target]) = (frames[target], frames[index]);
        UpdateDraft(frames);
        return true;
    }

    public void UpdateSettings(string name, AnimationEasing easing, AnimationLoopMode loopMode, double speed)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var normalized = name.Trim();
        if (string.Equals(Draft.Name, normalized, StringComparison.Ordinal)
            && Draft.Easing == easing && Draft.LoopMode == loopMode && Draft.PlaybackSpeed.Equals(speed)) return;
        Draft = Draft.WithContent(name, Draft.BasePoseId, Draft.Frames, easing, loopMode, speed, Draft.LayerOrder);
    }

    public AnimationDraft PrepareInitialSave(string name, AnimationEasing easing, AnimationLoopMode loopMode, double speed)
    {
        UpdateSettings(name, easing, loopMode, speed);
        Draft = Draft.PrepareInitialSave(name);
        return Draft;
    }

    public void RestoreDraft(AnimationDraft snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        if (snapshot.Id != Draft.Id || snapshot.Model != Draft.Model)
            throw new ArgumentException("The restored animation snapshot belongs to another animation or model.", nameof(snapshot));
        Draft = Draft.WithSnapshotContent(snapshot);
        if (!Draft.Frames.Any(frame => frame.Id == SelectedFrameId)) SelectedFrameId = Draft.Frames[0].Id;
        if (SelectedPartId is not { } partId || !Draft.Frames[0].Keys.Any(key => key.PartId == partId))
            SelectedPartId = Draft.LayerOrder.FirstOrDefault();
    }

    public ModelDraftContent Evaluate(double elapsedMilliseconds) => AnimationEvaluator.Evaluate(Draft, _modelRevision, elapsedMilliseconds);

    private void ReplaceSelectedFrame(AnimationFrame replacement)
    {
        var frames = Draft.Frames.Select(frame => frame.Id == replacement.Id ? replacement : frame).ToArray();
        UpdateDraft(frames);
    }

    private void UpdateDraft(IEnumerable<AnimationFrame> frames) =>
        Draft = Draft.WithContent(Draft.Name, Draft.BasePoseId, frames, Draft.Easing, Draft.LoopMode, Draft.PlaybackSpeed, Draft.LayerOrder);
}
