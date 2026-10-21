using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;

namespace GV5.Data.Repositories;

internal static class AnimationSnapshotCodec
{
    private static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static (string Json, string Sha256) Encode(AnimationDraft animation)
    {
        ArgumentNullException.ThrowIfNull(animation);
        var json = JsonSerializer.Serialize(Document.From(animation), Options);
        return (json, Hash(json));
    }

    public static AnimationDraft Decode(string json, string expectedSha256)
    {
        if (string.IsNullOrWhiteSpace(json) || expectedSha256 is null || expectedSha256.Length != 64 || !expectedSha256.All(Uri.IsHexDigit))
            throw new InvalidDataException("The animation snapshot checksum or payload is invalid.");
        if (!string.Equals(Hash(json), expectedSha256, StringComparison.Ordinal))
            throw new InvalidDataException("The animation snapshot checksum does not match its payload.");
        var document = JsonSerializer.Deserialize<Document>(json, Options)
            ?? throw new InvalidDataException("The animation snapshot is empty.");
        if (document.SchemaVersion != AnimationDraft.CurrentSchemaVersion || document.Model is null
            || string.IsNullOrWhiteSpace(document.Model.ModelId) || string.IsNullOrWhiteSpace(document.Model.RevisionId)
            || string.IsNullOrWhiteSpace(document.Model.SnapshotSha256)
            || document.Frames is null || document.LayerOrder is null || string.IsNullOrWhiteSpace(document.Name))
            throw new InvalidDataException("The animation snapshot is incomplete or uses an unsupported schema.");

        var frames = document.Frames.Select(frame =>
        {
            if (frame is null || frame.Keys is null || frame.Joints is null
                || frame.Keys.Any(key => key is null || key.Transform is null)
                || frame.Joints.Any(joint => joint is null))
                throw new InvalidDataException("An animation frame is incomplete.");
            return AnimationFrame.Restore(AnimationFrameId.Parse(frame.Id), frame.DurationMs,
                frame.Keys.Select(key => AnimationPartKey.Create(ModelPartId.Parse(key.PartId), ReadTransform(key.Transform), key.IsVisible)),
                frame.Joints.Select(ReadJoint));
        });
        return AnimationDraft.Restore(AnimationId.Parse(document.AnimationId), ReadModel(document.Model),
            Revision.From(document.Revision), document.Name,
            document.BasePoseId is null ? null : PoseId.Parse(document.BasePoseId), frames,
            (AnimationEasing)document.Easing, (AnimationLoopMode)document.LoopMode, document.PlaybackSpeed,
            document.LayerOrder.Select(ModelPartId.Parse));
    }

    private static string Hash(string json) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json))).ToLowerInvariant();
    private static ModelRevisionReference ReadModel(ModelReference document) => ModelRevisionReference.Restore(
        ModelId.Parse(document.ModelId), ModelRevisionId.Parse(document.RevisionId), Revision.From(document.Sequence), document.SnapshotSha256);
    private static Transform2D ReadTransform(TransformValue value) => new(
        new Point2D(value.X, value.Y), new Point2D(value.ScaleX, value.ScaleY), value.RotationRadians,
        new Point2D(value.PivotX, value.PivotY), value.FlipX, value.FlipY);
    private static RigJoint ReadJoint(JointValue value) => new(
        RigJointId.From(Guid.Parse(value.Id)), TransformNodeId.From(ModelPartId.Parse(value.ParentPartId).Value),
        TransformNodeId.From(ModelPartId.Parse(value.ChildPartId).Value), new Point2D(value.ParentX, value.ParentY),
        new Point2D(value.ChildX, value.ChildY), (RigJointMode)value.Mode, value.IsSuggested);

    private sealed class Document
    {
        public int SchemaVersion { get; set; } = AnimationDraft.CurrentSchemaVersion;
        public string AnimationId { get; set; } = string.Empty;
        public ModelReference? Model { get; set; } = new();
        public long Revision { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? BasePoseId { get; set; }
        public List<FrameValue>? Frames { get; set; } = [];
        public List<string>? LayerOrder { get; set; } = [];
        public int Easing { get; set; }
        public int LoopMode { get; set; }
        public double PlaybackSpeed { get; set; }

        public static Document From(AnimationDraft animation) => new()
        {
            AnimationId = animation.Id.ToString(),
            Model = ModelReference.From(animation.Model),
            Revision = animation.Revision.Value,
            Name = animation.Name,
            BasePoseId = animation.BasePoseId?.ToString(),
            Frames = animation.Frames.Select(frame => new FrameValue
            {
                Id = frame.Id.ToString(), DurationMs = frame.DurationMs,
                Keys = frame.Keys.Select(key => new KeyValue { PartId = key.PartId.ToString(), Transform = TransformValue.From(key.Transform), IsVisible = key.IsVisible }).ToList(),
                Joints = frame.RigJoints.Select(JointValue.From).ToList()
            }).ToList(),
            LayerOrder = animation.LayerOrder.Select(id => id.ToString()).ToList(),
            Easing = (int)animation.Easing,
            LoopMode = (int)animation.LoopMode,
            PlaybackSpeed = animation.PlaybackSpeed
        };
    }

    private sealed class ModelReference
    {
        public string ModelId { get; set; } = string.Empty;
        public string RevisionId { get; set; } = string.Empty;
        public long Sequence { get; set; }
        public string SnapshotSha256 { get; set; } = string.Empty;
        public static ModelReference From(ModelRevisionReference model) => new()
        { ModelId = model.ModelId.ToString(), RevisionId = model.RevisionId.ToString(), Sequence = model.Sequence.Value, SnapshotSha256 = model.SnapshotSha256 };
    }

    private sealed class FrameValue
    {
        public string Id { get; set; } = string.Empty;
        public int DurationMs { get; set; }
        public List<KeyValue>? Keys { get; set; } = [];
        public List<JointValue>? Joints { get; set; } = [];
    }

    private sealed class KeyValue
    {
        public string PartId { get; set; } = string.Empty;
        public TransformValue Transform { get; set; } = new();
        public bool IsVisible { get; set; }
    }

    private sealed class TransformValue
    {
        public double X { get; set; }
        public double Y { get; set; }
        public double ScaleX { get; set; }
        public double ScaleY { get; set; }
        public double RotationRadians { get; set; }
        public double PivotX { get; set; }
        public double PivotY { get; set; }
        public bool FlipX { get; set; }
        public bool FlipY { get; set; }
        public static TransformValue From(Transform2D value) => new()
        {
            X = value.Translation.X, Y = value.Translation.Y, ScaleX = value.Scale.X, ScaleY = value.Scale.Y,
            RotationRadians = value.RotationRadians, PivotX = value.Pivot.X, PivotY = value.Pivot.Y,
            FlipX = value.FlipX, FlipY = value.FlipY
        };
    }

    private sealed class JointValue
    {
        public string Id { get; set; } = string.Empty;
        public string ParentPartId { get; set; } = string.Empty;
        public string ChildPartId { get; set; } = string.Empty;
        public double ParentX { get; set; }
        public double ParentY { get; set; }
        public double ChildX { get; set; }
        public double ChildY { get; set; }
        public int Mode { get; set; }
        public bool IsSuggested { get; set; }
        public static JointValue From(RigJoint joint) => new()
        {
            Id = joint.Id.Value.ToString("D"), ParentPartId = ModelPartId.From(joint.ParentPartId.Value).ToString(),
            ChildPartId = ModelPartId.From(joint.ChildPartId.Value).ToString(), ParentX = joint.ParentAnchor.X,
            ParentY = joint.ParentAnchor.Y, ChildX = joint.ChildAnchor.X, ChildY = joint.ChildAnchor.Y,
            Mode = (int)joint.Mode, IsSuggested = joint.IsSuggested
        };
    }
}
