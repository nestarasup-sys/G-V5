using System.Collections.Immutable;
using GV5.Core.Identity;
using GV5.Geometry;

namespace GV5.Core.Models;

/// <summary>Interpolation between animation keyframes.</summary>
public enum AnimationEasing
{
    Step = 1,
    Linear = 2,
    Smooth = 3
}

/// <summary>Playback behavior at the end of an animation.</summary>
public enum AnimationLoopMode
{
    Once = 1,
    Loop = 2,
    PingPong = 3
}

/// <summary>A keyed transform and visibility state for one model part.</summary>
public sealed record AnimationPartKey
{
    private AnimationPartKey(ModelPartId partId, Transform2D transform, bool isVisible)
    {
        PartId = partId;
        Transform = transform;
        IsVisible = isVisible;
    }

    public ModelPartId PartId { get; }
    public Transform2D Transform { get; }
    public bool IsVisible { get; }

    public static AnimationPartKey Create(ModelPartId partId, Transform2D transform, bool isVisible = true)
    {
        if (!partId.IsValid) throw new ArgumentException("An animation key requires a valid model part.", nameof(partId));
        if (!IsFinite(transform.Translation) || !IsFinite(transform.Scale) || !IsFinite(transform.Pivot)
            || transform.Scale.X <= 0 || transform.Scale.Y <= 0 || !double.IsFinite(transform.RotationRadians))
            throw new ArgumentException("Animation transforms must be finite and have positive scale.", nameof(transform));
        return new AnimationPartKey(partId, transform, isVisible);
    }

    private static bool IsFinite(Point2D point) => double.IsFinite(point.X) && double.IsFinite(point.Y);
}

/// <summary>A single timed keyframe containing part transforms and its rig anchors.</summary>
public sealed record AnimationFrame
{
    public const int MinimumDurationMs = 40;
    public const int MaximumDurationMs = 10_000;

    private AnimationFrame(AnimationFrameId id, int durationMs, ImmutableArray<AnimationPartKey> keys,
        ImmutableArray<RigJoint> rigJoints)
    {
        Id = id;
        DurationMs = durationMs;
        Keys = keys;
        RigJoints = rigJoints;
    }

    public AnimationFrameId Id { get; }
    public int DurationMs { get; }
    public ImmutableArray<AnimationPartKey> Keys { get; }
    public ImmutableArray<RigJoint> RigJoints { get; }

    public static AnimationFrame Create(int durationMs, IEnumerable<AnimationPartKey> keys,
        IEnumerable<RigJoint>? rigJoints = null) => Restore(AnimationFrameId.New(), durationMs, keys, rigJoints);

    public static AnimationFrame Restore(AnimationFrameId id, int durationMs, IEnumerable<AnimationPartKey> keys,
        IEnumerable<RigJoint>? rigJoints = null)
    {
        if (!id.IsValid) throw new ArgumentException("An animation frame requires a valid identity.", nameof(id));
        if (durationMs is < MinimumDurationMs or > MaximumDurationMs)
            throw new ArgumentOutOfRangeException(nameof(durationMs), $"Frame duration must be between {MinimumDurationMs} and {MaximumDurationMs} ms.");
        ArgumentNullException.ThrowIfNull(keys);
        var keyArray = keys.ToImmutableArray();
        if (keyArray.IsDefaultOrEmpty || keyArray.Any(key => key is null)
            || keyArray.Select(key => key.PartId).Distinct().Count() != keyArray.Length)
            throw new ArgumentException("An animation frame requires unique part keys.", nameof(keys));
        var jointArray = (rigJoints ?? []).ToImmutableArray();
        _ = RigSkeleton.Create(keyArray.Select(key => TransformNodeId.From(key.PartId.Value)), jointArray);
        return new AnimationFrame(id, durationMs, keyArray, jointArray);
    }
}

/// <summary>Editable animation pinned to one exact immutable model publication and optional base pose.</summary>
public sealed record AnimationDraft
{
    public const int CurrentSchemaVersion = 1;
    public const int MaximumFrames = 300;
    public const double MinimumPlaybackSpeed = 0.1;
    public const double MaximumPlaybackSpeed = 4.0;

    private AnimationDraft(AnimationId id, ModelRevisionReference model, Revision revision, string name,
        PoseId? basePoseId, ImmutableArray<AnimationFrame> frames, ImmutableArray<ModelPartId> layerOrder, AnimationEasing easing,
        AnimationLoopMode loopMode, double playbackSpeed)
    {
        Id = id;
        Model = model;
        Revision = revision;
        Name = name;
        BasePoseId = basePoseId;
        Frames = frames;
        LayerOrder = layerOrder;
        Easing = easing;
        LoopMode = loopMode;
        PlaybackSpeed = playbackSpeed;
    }

    public AnimationId Id { get; }
    public int SchemaVersion => CurrentSchemaVersion;
    public ModelRevisionReference Model { get; }
    public Revision Revision { get; }
    public string Name { get; }
    public PoseId? BasePoseId { get; }
    public ImmutableArray<AnimationFrame> Frames { get; }
    public ImmutableArray<ModelPartId> LayerOrder { get; }
    public AnimationEasing Easing { get; }
    public AnimationLoopMode LoopMode { get; }
    public double PlaybackSpeed { get; }
    public int DurationMs => Frames.Sum(frame => frame.DurationMs);

    public static AnimationDraft CreateFromPose(PoseDraft pose, string name, int firstFrameDurationMs = 250)
    {
        ArgumentNullException.ThrowIfNull(pose);
        var frame = AnimationFrame.Create(firstFrameDurationMs,
            pose.PartTransforms.Select(key => AnimationPartKey.Create(key.PartId, key.Transform, key.IsVisible)), pose.RigJoints);
        return Restore(AnimationId.New(), pose.Model, Revision.Initial, name, pose.Id, [frame],
            AnimationEasing.Smooth, AnimationLoopMode.Once, 1.0, pose.LayerOrder);
    }

    public static AnimationDraft CreateFromModelRevision(PublishedModelRevision modelRevision, string name, int firstFrameDurationMs = 250)
    {
        ArgumentNullException.ThrowIfNull(modelRevision);
        var pose = PoseDraft.CreateFromModelRevision(modelRevision, "Base da animação");
        var created = CreateFromPose(pose, name, firstFrameDurationMs);
        return Restore(created.Id, created.Model, created.Revision, created.Name, null, created.Frames,
            created.Easing, created.LoopMode, created.PlaybackSpeed, created.LayerOrder);
    }

    public static AnimationDraft Restore(AnimationId id, ModelRevisionReference model, Revision revision,
        string name, PoseId? basePoseId, IEnumerable<AnimationFrame> frames, AnimationEasing easing,
        AnimationLoopMode loopMode, double playbackSpeed, IEnumerable<ModelPartId>? layerOrder = null)
    {
        if (!id.IsValid || !revision.IsValid) throw new ArgumentException("An animation requires valid identity and revision.");
        ArgumentNullException.ThrowIfNull(model);
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var normalizedName = name.Trim();
        if (normalizedName.Length > 120) throw new ArgumentOutOfRangeException(nameof(name));
        if (basePoseId is { IsValid: false }) throw new ArgumentException("The base pose identity is invalid.", nameof(basePoseId));
        ArgumentNullException.ThrowIfNull(frames);
        var frameArray = frames.ToImmutableArray();
        if (frameArray.IsDefaultOrEmpty || frameArray.Length > MaximumFrames || frameArray.Any(frame => frame is null))
            throw new ArgumentException($"An animation requires 1 to {MaximumFrames} frames.", nameof(frames));
        if (frameArray.Select(frame => frame.Id).Distinct().Count() != frameArray.Length)
            throw new ArgumentException("Animation frame identities must be unique.", nameof(frames));
        if (!Enum.IsDefined(easing)) throw new ArgumentOutOfRangeException(nameof(easing));
        if (!Enum.IsDefined(loopMode)) throw new ArgumentOutOfRangeException(nameof(loopMode));
        if (!double.IsFinite(playbackSpeed) || playbackSpeed is < MinimumPlaybackSpeed or > MaximumPlaybackSpeed)
            throw new ArgumentOutOfRangeException(nameof(playbackSpeed));

        var firstKeys = frameArray[0].Keys.Select(key => key.PartId).ToHashSet();
        var order = (layerOrder ?? frameArray[0].Keys.Select(key => key.PartId)).ToImmutableArray();
        if (order.Any(partId => !partId.IsValid) || order.Distinct().Count() != order.Length
            || !order.ToHashSet().SetEquals(firstKeys))
            throw new ArgumentException("Animation layer order must contain every keyed model part exactly once.", nameof(layerOrder));
        var firstJoints = frameArray[0].RigJoints.ToDictionary(joint => joint.Id);
        foreach (var frame in frameArray)
        {
            if (!frame.Keys.Select(key => key.PartId).ToHashSet().SetEquals(firstKeys))
                throw new ArgumentException("Every frame must key the same model parts.", nameof(frames));
            if (!frame.RigJoints.Select(joint => joint.Id).ToHashSet().SetEquals(firstJoints.Keys))
                throw new ArgumentException("Every frame must preserve the rig topology; keyframe anchors and modes may change.", nameof(frames));
            if (frame.RigJoints.Any(joint => firstJoints[joint.Id].ParentPartId != joint.ParentPartId
                || firstJoints[joint.Id].ChildPartId != joint.ChildPartId))
                throw new ArgumentException("Rig parent/child links cannot change within an animation.", nameof(frames));
            _ = RigSkeleton.Create(firstKeys.Select(partId => TransformNodeId.From(partId.Value)), frame.RigJoints);
        }

        return new AnimationDraft(id, model, revision, normalizedName, basePoseId, frameArray, order, easing, loopMode, playbackSpeed);
    }

    public AnimationDraft WithContent(string name, PoseId? basePoseId, IEnumerable<AnimationFrame> frames,
        AnimationEasing easing, AnimationLoopMode loopMode, double playbackSpeed, IEnumerable<ModelPartId>? layerOrder = null) =>
        Restore(Id, Model, Revision.Next(), name, basePoseId, frames, easing, loopMode, playbackSpeed, layerOrder ?? LayerOrder);

    public AnimationDraft PrepareInitialSave(string name) =>
        Restore(Id, Model, Revision.Initial, name, BasePoseId, Frames, Easing, LoopMode, PlaybackSpeed, LayerOrder);

    /// <summary>Restores prior content while keeping identity and advancing the optimistic revision.</summary>
    public AnimationDraft WithSnapshotContent(AnimationDraft snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        if (Id != snapshot.Id || Model != snapshot.Model)
            throw new ArgumentException("An animation history snapshot must belong to the same animation and model publication.", nameof(snapshot));
        return WithContent(snapshot.Name, snapshot.BasePoseId, snapshot.Frames, snapshot.Easing,
            snapshot.LoopMode, snapshot.PlaybackSpeed, snapshot.LayerOrder);
    }

    /// <summary>Builds a non-destructive preview snapshot after checking the exact model publication and rig.</summary>
    public ModelDraftContent ApplyFrameToModelRevision(PublishedModelRevision modelRevision, AnimationFrameId frameId)
    {
        ArgumentNullException.ThrowIfNull(modelRevision);
        if (Model != ModelRevisionReference.From(modelRevision))
            throw new ArgumentException("The animation is pinned to a different model publication.", nameof(modelRevision));
        var frame = Frames.FirstOrDefault(candidate => candidate.Id == frameId)
            ?? throw new KeyNotFoundException("The animation frame does not exist.");
        return ApplySnapshotToModelRevision(modelRevision, frame.Keys, frame.RigJoints);
    }

    internal ModelDraftContent ApplySnapshotToModelRevision(PublishedModelRevision modelRevision,
        IEnumerable<AnimationPartKey> partKeys, IEnumerable<RigJoint> rigJoints)
    {
        ArgumentNullException.ThrowIfNull(modelRevision);
        if (Model != ModelRevisionReference.From(modelRevision))
            throw new ArgumentException("The animation is pinned to a different model publication.", nameof(modelRevision));
        ArgumentNullException.ThrowIfNull(partKeys);
        ArgumentNullException.ThrowIfNull(rigJoints);
        var keysSnapshot = partKeys.ToArray();
        var jointsSnapshot = rigJoints.ToArray();
        var source = modelRevision.Content;
        var sourcePartIds = source.Parts.Select(part => part.Id).ToHashSet();
        if (!keysSnapshot.Select(key => key.PartId).ToHashSet().SetEquals(sourcePartIds)
            || !LayerOrder.ToHashSet().SetEquals(sourcePartIds))
            throw new ArgumentException("Animation keys and layer order must match the pinned model publication.", nameof(modelRevision));

        var sourceJoints = source.RigJoints.ToDictionary(joint => joint.Id);
        if (!jointsSnapshot.Select(joint => joint.Id).ToHashSet().SetEquals(sourceJoints.Keys)
            || jointsSnapshot.Any(joint => sourceJoints[joint.Id].ParentPartId != joint.ParentPartId
                || sourceJoints[joint.Id].ChildPartId != joint.ChildPartId))
            throw new ArgumentException("The animation rig must match the pinned model topology.", nameof(modelRevision));

        var keys = keysSnapshot.ToDictionary(key => key.PartId);
        var parts = source.Parts.Select(part => part.WithTransform(keys[part.Id].Transform).WithVisibility(keys[part.Id].IsVisible));
        return ModelDraftContent.Restore(source.SchemaVersion, source.ModelId, source.Revision, source.Slot,
            source.SourceAssetId, source.SourceWidth, source.SourceHeight, parts, LayerOrder, jointsSnapshot);
    }
}
