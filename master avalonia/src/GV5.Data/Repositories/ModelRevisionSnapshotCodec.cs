using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;

namespace GV5.Data.Repositories;

internal static class ModelRevisionSnapshotCodec
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    public static (string Json, string Sha256) Encode(ModelDraft draft, ModelDraftContent content)
    {
        var document = new SnapshotDocument
        {
            Name = draft.Name,
            DraftRevision = draft.Revision.Value,
            SchemaVersion = content.SchemaVersion,
            ModelId = content.ModelId.ToString(),
            ContentRevision = content.Revision.Value,
            Slot = content.Slot?.Value,
            SourceAssetId = content.SourceAssetId?.ToString(),
            SourceWidth = content.SourceWidth,
            SourceHeight = content.SourceHeight,
            Parts = content.Parts.Select(part => new PartDocument
            {
                Id = part.Id.ToString(),
                Name = part.Name,
                AssetId = part.AssetId.ToString(),
                Crop = RectDocument.From(part.SourceCrop),
                Transform = TransformDocument.From(part.Transform),
                OriginalCrop = RectDocument.From(part.SourceTransform.Crop),
                OriginalTransform = TransformDocument.From(part.SourceTransform.Transform),
                IsVisible = part.IsVisible
            }).ToList(),
            LayerOrder = content.LayerOrder.Select(id => id.ToString()).ToList(),
            RigJoints = content.RigJoints.Select(joint => new JointDocument
            {
                Id = joint.Id.Value.ToString("D"),
                ParentPartId = joint.ParentPartId.Value.ToString("D"),
                ChildPartId = joint.ChildPartId.Value.ToString("D"),
                ParentAnchor = PointDocument.From(joint.ParentAnchor),
                ChildAnchor = PointDocument.From(joint.ChildAnchor),
                Mode = (int)joint.Mode,
                IsSuggested = joint.IsSuggested
            }).ToList()
        };
        var json = JsonSerializer.Serialize(document, JsonOptions);
        return (json, Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json))).ToLowerInvariant());
    }

    public static DecodedSnapshot Decode(string json)
    {
        var document = JsonSerializer.Deserialize<SnapshotDocument>(json, JsonOptions)
            ?? throw new InvalidDataException("The published model snapshot is empty.");
        if (document.Parts is null || document.LayerOrder is null || string.IsNullOrWhiteSpace(document.Name))
        {
            throw new InvalidDataException("The published model snapshot is incomplete.");
        }

        var parts = document.Parts.Select(part => new ModelPart(
            ModelPartId.Parse(part.Id),
            part.Name,
            AssetId.Parse(part.AssetId),
            part.Crop.ToDomain(),
            part.Transform.ToDomain(),
            new ModelPartSourceTransform(part.OriginalCrop.ToDomain(), part.OriginalTransform.ToDomain()),
            part.IsVisible)).ToArray();
        var content = ModelDraftContent.Restore(
            document.SchemaVersion,
            ModelId.Parse(document.ModelId),
            Revision.From(document.ContentRevision),
            document.Slot is { } slot ? ModelSlot.From(slot) : null,
            document.SourceAssetId is { } sourceId ? AssetId.Parse(sourceId) : null,
            document.SourceWidth,
            document.SourceHeight,
            parts,
            document.LayerOrder.Select(ModelPartId.Parse),
            (document.RigJoints ?? []).Select(joint => new RigJoint(
                RigJointId.From(Guid.Parse(joint.Id)),
                TransformNodeId.From(ModelPartId.Parse(joint.ParentPartId).Value),
                TransformNodeId.From(ModelPartId.Parse(joint.ChildPartId).Value),
                joint.ParentAnchor.ToDomain(),
                joint.ChildAnchor.ToDomain(),
                (RigJointMode)joint.Mode,
                joint.IsSuggested)));
        return new DecodedSnapshot(
            document.Name,
            Revision.From(document.DraftRevision),
            content);
    }

    internal sealed record DecodedSnapshot(string Name, Revision DraftRevision, ModelDraftContent Content);

    private sealed class SnapshotDocument
    {
        public string Name { get; set; } = string.Empty;
        public long DraftRevision { get; set; }
        public int SchemaVersion { get; set; }
        public string ModelId { get; set; } = string.Empty;
        public long ContentRevision { get; set; }
        public int? Slot { get; set; }
        public string? SourceAssetId { get; set; }
        public int? SourceWidth { get; set; }
        public int? SourceHeight { get; set; }
        public List<PartDocument> Parts { get; set; } = [];
        public List<string> LayerOrder { get; set; } = [];
        public List<JointDocument>? RigJoints { get; set; }
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
    }

    private sealed class PointDocument
    {
        public double X { get; set; }
        public double Y { get; set; }
        public static PointDocument From(Point2D value) => new() { X = value.X, Y = value.Y };
        public Point2D ToDomain() => new(X, Y);
    }

    private sealed class PartDocument
    {
        public string Id { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string AssetId { get; set; } = string.Empty;
        public RectDocument Crop { get; set; } = new();
        public TransformDocument Transform { get; set; } = new();
        public RectDocument OriginalCrop { get; set; } = new();
        public TransformDocument OriginalTransform { get; set; } = new();
        public bool IsVisible { get; set; }
    }

    private sealed class RectDocument
    {
        public double X { get; set; }
        public double Y { get; set; }
        public double Width { get; set; }
        public double Height { get; set; }

        public static RectDocument From(Rect2D value) => new() { X = value.X, Y = value.Y, Width = value.Width, Height = value.Height };
        public Rect2D ToDomain() => new(X, Y, Width, Height);
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
}
