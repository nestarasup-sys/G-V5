using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;

namespace GV5.Data.Repositories;

internal static class PoseSnapshotCodec
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    public static (string Json, string Sha256) Encode(PoseDraft pose)
    {
        ArgumentNullException.ThrowIfNull(pose);
        return EncodeDocument(DraftDocument.From(pose));
    }

    public static PoseDraft DecodeDraft(string json, string expectedSha256)
    {
        var document = DecodeDocument<DraftDocument>(json, expectedSha256);
        if (document.SchemaVersion != PoseDraft.CurrentSchemaVersion
            || document.Model is null
            || document.PartTransforms is null
            || document.PartTransforms.Any(item => item?.Transform is null)
            || document.LayerOrder is null
            || string.IsNullOrWhiteSpace(document.Name))
            throw new InvalidDataException("The pose draft snapshot is incomplete.");

        return PoseDraft.Restore(
            PoseId.Parse(document.PoseId),
            ReadModel(document.Model),
            Revision.From(document.Revision),
            document.Name,
            document.PartTransforms.Select(ReadTransform),
            (document.RigJoints ?? []).Select(ReadJoint),
            document.LayerOrder.Select(ModelPartId.Parse),
            document.Category);
    }

    public static (string Json, string Sha256) Encode(PublishedPoseRevision pose)
    {
        ArgumentNullException.ThrowIfNull(pose);
        return EncodeDocument(PublishedDocument.From(pose));
    }

    public static PublishedPoseRevision DecodePublished(string json, string expectedSha256)
    {
        var document = DecodeDocument<PublishedDocument>(json, expectedSha256);
        if (document.SchemaVersion != PoseDraft.CurrentSchemaVersion
            || document.Model is null
            || document.PartTransforms is null
            || document.PartTransforms.Any(item => item?.Transform is null)
            || document.LayerOrder is null
            || string.IsNullOrWhiteSpace(document.Name))
            throw new InvalidDataException("The published pose snapshot is incomplete.");

        return PublishedPoseRevision.Restore(
            PoseRevisionId.Parse(document.PoseRevisionId),
            PoseId.Parse(document.PoseId),
            Revision.From(document.Revision),
            Revision.From(document.DraftRevision),
            ReadModel(document.Model),
            document.Name,
            document.PublishedUtcMs,
            expectedSha256,
            document.PartTransforms.Select(ReadTransform),
            (document.RigJoints ?? []).Select(ReadJoint),
            document.LayerOrder.Select(ModelPartId.Parse),
            document.Category);
    }

    private static (string Json, string Sha256) EncodeDocument<T>(T document)
    {
        var json = JsonSerializer.Serialize(document, Options);
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json))).ToLowerInvariant();
        return (json, hash);
    }

    private static T DecodeDocument<T>(string json, string expectedSha256)
    {
        if (string.IsNullOrWhiteSpace(json)
            || expectedSha256 is null
            || expectedSha256.Length != 64
            || !expectedSha256.All(Uri.IsHexDigit))
            throw new InvalidDataException("The pose snapshot checksum or payload is invalid.");

        var actual = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json))).ToLowerInvariant();
        if (!string.Equals(actual, expectedSha256, StringComparison.Ordinal))
            throw new InvalidDataException("The pose snapshot checksum does not match its payload.");

        return JsonSerializer.Deserialize<T>(json, Options)
            ?? throw new InvalidDataException("The pose snapshot is empty.");
    }

    private static ModelRevisionReference ReadModel(ModelReferenceDocument document) =>
        ModelRevisionReference.Restore(
            ModelId.Parse(document.ModelId),
            ModelRevisionId.Parse(document.RevisionId),
            Revision.From(document.Sequence),
            document.SnapshotSha256);

    private static PosePartTransform ReadTransform(PartTransformDocument document) => PosePartTransform.Create(
        ModelPartId.Parse(document.PartId),
        document.Transform.ToDomain(),
        document.IsVisible);

    private static RigJoint ReadJoint(JointDocument document) => new(
        RigJointId.From(Guid.Parse(document.Id)),
        TransformNodeId.From(ModelPartId.Parse(document.ParentPartId).Value),
        TransformNodeId.From(ModelPartId.Parse(document.ChildPartId).Value),
        document.ParentAnchor.ToDomain(),
        document.ChildAnchor.ToDomain(),
        (RigJointMode)document.Mode,
        document.IsSuggested);

    private sealed class DraftDocument
    {
        public int SchemaVersion { get; set; } = PoseDraft.CurrentSchemaVersion;
        public string PoseId { get; set; } = string.Empty;
        public ModelReferenceDocument Model { get; set; } = new();
        public long Revision { get; set; }
        public string Name { get; set; } = string.Empty;
        public string? Category { get; set; }
        public List<PartTransformDocument> PartTransforms { get; set; } = [];
        public List<JointDocument> RigJoints { get; set; } = [];
        public List<string> LayerOrder { get; set; } = [];

        public static DraftDocument From(PoseDraft pose) => new()
        {
            PoseId = pose.Id.ToString(),
            Model = ModelReferenceDocument.From(pose.Model),
            Revision = pose.Revision.Value,
            Name = pose.Name,
            Category = pose.Category,
            PartTransforms = pose.PartTransforms.Select(PartTransformDocument.From).ToList(),
            RigJoints = pose.RigJoints.Select(JointDocument.From).ToList(),
            LayerOrder = pose.LayerOrder.Select(id => id.ToString()).ToList()
        };
    }

    private sealed class PublishedDocument
    {
        public int SchemaVersion { get; set; } = PoseDraft.CurrentSchemaVersion;
        public string PoseRevisionId { get; set; } = string.Empty;
        public string PoseId { get; set; } = string.Empty;
        public long Revision { get; set; }
        public long DraftRevision { get; set; }
        public ModelReferenceDocument Model { get; set; } = new();
        public string Name { get; set; } = string.Empty;
        public string? Category { get; set; }
        public long PublishedUtcMs { get; set; }
        public List<PartTransformDocument> PartTransforms { get; set; } = [];
        public List<JointDocument> RigJoints { get; set; } = [];
        public List<string> LayerOrder { get; set; } = [];

        public static PublishedDocument From(PublishedPoseRevision pose) => new()
        {
            PoseRevisionId = pose.Id.ToString(),
            PoseId = pose.PoseId.ToString(),
            Revision = pose.Revision.Value,
            DraftRevision = pose.DraftRevision.Value,
            Model = ModelReferenceDocument.From(pose.Model),
            Name = pose.Name,
            Category = pose.Category,
            PublishedUtcMs = pose.PublishedUtcMs,
            PartTransforms = pose.PartTransforms.Select(PartTransformDocument.From).ToList(),
            RigJoints = pose.RigJoints.Select(JointDocument.From).ToList(),
            LayerOrder = pose.LayerOrder.Select(id => id.ToString()).ToList()
        };
    }

    private sealed class ModelReferenceDocument
    {
        public string ModelId { get; set; } = string.Empty;
        public string RevisionId { get; set; } = string.Empty;
        public long Sequence { get; set; }
        public string SnapshotSha256 { get; set; } = string.Empty;

        public static ModelReferenceDocument From(ModelRevisionReference reference) => new()
        {
            ModelId = reference.ModelId.ToString(),
            RevisionId = reference.RevisionId.ToString(),
            Sequence = reference.Sequence.Value,
            SnapshotSha256 = reference.SnapshotSha256
        };
    }

    private sealed class PartTransformDocument
    {
        public string PartId { get; set; } = string.Empty;
        public TransformDocument Transform { get; set; } = new();
        public bool IsVisible { get; set; }

        public static PartTransformDocument From(PosePartTransform item) => new()
        {
            PartId = item.PartId.ToString(),
            Transform = TransformDocument.From(item.Transform),
            IsVisible = item.IsVisible
        };
    }

    private sealed class TransformDocument
    {
        public double TranslationX { get; set; }
        public double TranslationY { get; set; }
        public double ScaleX { get; set; }
        public double ScaleY { get; set; }
        public double RotationRadians { get; set; }
        public double PivotX { get; set; }
        public double PivotY { get; set; }
        public bool FlipX { get; set; }
        public bool FlipY { get; set; }

        public static TransformDocument From(Transform2D value) => new()
        {
            TranslationX = value.Translation.X,
            TranslationY = value.Translation.Y,
            ScaleX = value.Scale.X,
            ScaleY = value.Scale.Y,
            RotationRadians = value.RotationRadians,
            PivotX = value.Pivot.X,
            PivotY = value.Pivot.Y,
            FlipX = value.FlipX,
            FlipY = value.FlipY
        };

        public Transform2D ToDomain() => new(
            new Point2D(TranslationX, TranslationY),
            new Point2D(ScaleX, ScaleY),
            RotationRadians,
            new Point2D(PivotX, PivotY),
            FlipX,
            FlipY);
    }

    private sealed class JointDocument
    {
        public string Id { get; set; } = string.Empty;
        public string ParentPartId { get; set; } = string.Empty;
        public string ChildPartId { get; set; } = string.Empty;
        public PointDocument ParentAnchor { get; set; } = new();
        public PointDocument ChildAnchor { get; set; } = new();
        public int Mode { get; set; }
        public bool IsSuggested { get; set; }

        public static JointDocument From(RigJoint joint) => new()
        {
            Id = joint.Id.Value.ToString("D"),
            ParentPartId = joint.ParentPartId.Value.ToString("D"),
            ChildPartId = joint.ChildPartId.Value.ToString("D"),
            ParentAnchor = PointDocument.From(joint.ParentAnchor),
            ChildAnchor = PointDocument.From(joint.ChildAnchor),
            Mode = (int)joint.Mode,
            IsSuggested = joint.IsSuggested
        };
    }

    private sealed class PointDocument
    {
        public double X { get; set; }
        public double Y { get; set; }
        public static PointDocument From(Point2D point) => new() { X = point.X, Y = point.Y };
        public Point2D ToDomain() => new(X, Y);
    }
}
