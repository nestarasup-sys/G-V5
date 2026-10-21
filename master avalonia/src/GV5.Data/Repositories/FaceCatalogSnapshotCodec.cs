using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;

namespace GV5.Data.Repositories;

internal static class FaceCatalogSnapshotCodec
{
    private static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static (string Json, string Sha256) Encode(FaceCatalogDraft draft)
    {
        ArgumentNullException.ThrowIfNull(draft);
        var document = new Document
        {
            SchemaVersion = draft.SchemaVersion,
            FaceId = draft.Id.ToString(),
            Model = new ModelDocument
            {
                ModelId = draft.Model.ModelId.ToString(),
                RevisionId = draft.Model.RevisionId.ToString(),
                Sequence = draft.Model.Sequence.Value,
                SnapshotSha256 = draft.Model.SnapshotSha256
            },
            Revision = draft.Revision.Value,
            Name = draft.Name,
            Components = draft.Components.Select(component => new ComponentDocument
            {
                Id = component.Id.ToString(),
                Kind = (int)component.Kind,
                Name = component.Name,
                AssetId = component.AssetId.ToString(),
                Side = component.Side is { } side ? (int)side : null,
                X = component.Transform.Translation.X,
                Y = component.Transform.Translation.Y,
                ScaleX = component.Transform.Scale.X,
                ScaleY = component.Transform.Scale.Y,
                Rotation = component.Transform.RotationRadians,
                PivotX = component.Transform.Pivot.X,
                PivotY = component.Transform.Pivot.Y,
                FlipX = component.Transform.FlipX,
                FlipY = component.Transform.FlipY,
                IsVisible = component.IsVisible,
                MouthVariant = (int)component.MouthVariant,
                ZOrder = component.ZOrder
            }).ToList()
        };
        var json = JsonSerializer.Serialize(document, Options);
        return (json, Hash(json));
    }

    public static FaceCatalogDraft Decode(string json, string expectedSha256)
    {
        if (!FixedHashMatches(json, expectedSha256)) throw new InvalidDataException("The face catalog checksum is invalid.");
        var document = JsonSerializer.Deserialize<Document>(json, Options) ?? throw new InvalidDataException("The face catalog is empty.");
        if (document.SchemaVersion is < 1 or > FaceCatalogDraft.CurrentSchemaVersion || document.Model is null
            || document.Components is null || string.IsNullOrWhiteSpace(document.Name))
            throw new InvalidDataException("The face catalog snapshot is incomplete.");
        var model = ModelRevisionReference.Restore(ModelId.Parse(document.Model.ModelId),
            ModelRevisionId.Parse(document.Model.RevisionId), Revision.From(document.Model.Sequence), document.Model.SnapshotSha256);
        var components = document.Components.Select(component => FaceComponent.Restore(
            FaceComponentId.Parse(component.Id), (FaceComponentKind)component.Kind, component.Name,
            AssetId.Parse(component.AssetId), component.Side is { } side ? (FaceComponentSide)side : null,
            new Transform2D(new Point2D(component.X, component.Y), new Point2D(component.ScaleX, component.ScaleY),
                component.Rotation, new Point2D(component.PivotX, component.PivotY), component.FlipX, component.FlipY),
            component.IsVisible, component.MouthVariant is { } mouthVariant
                ? (FaceMouthVariant)mouthVariant : FaceMouthVariant.Closed, component.ZOrder));
        return FaceCatalogDraft.Restore(FaceId.Parse(document.FaceId), model, Revision.From(document.Revision),
            document.Name, components);
    }

    private static string Hash(string json) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json))).ToLowerInvariant();
    private static bool FixedHashMatches(string json, string expected) => !string.IsNullOrWhiteSpace(json)
        && expected is { Length: 64 } && expected.All(Uri.IsHexDigit)
        && CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Hash(json)), Encoding.ASCII.GetBytes(expected.ToLowerInvariant()));

    private sealed class Document
    {
        public int SchemaVersion { get; set; }
        public string FaceId { get; set; } = string.Empty;
        public ModelDocument Model { get; set; } = new();
        public long Revision { get; set; }
        public string Name { get; set; } = string.Empty;
        public List<ComponentDocument> Components { get; set; } = [];
    }

    private sealed class ModelDocument
    {
        public string ModelId { get; set; } = string.Empty;
        public string RevisionId { get; set; } = string.Empty;
        public long Sequence { get; set; }
        public string SnapshotSha256 { get; set; } = string.Empty;
    }

    private sealed class ComponentDocument
    {
        public string Id { get; set; } = string.Empty;
        public int Kind { get; set; }
        public string Name { get; set; } = string.Empty;
        public string AssetId { get; set; } = string.Empty;
        public int? Side { get; set; }
        public double X { get; set; }
        public double Y { get; set; }
        public double ScaleX { get; set; }
        public double ScaleY { get; set; }
        public double Rotation { get; set; }
        public double PivotX { get; set; }
        public double PivotY { get; set; }
        public bool FlipX { get; set; }
        public bool FlipY { get; set; }
        public bool IsVisible { get; set; }
        public int? MouthVariant { get; set; }
        public int? ZOrder { get; set; }
    }
}
