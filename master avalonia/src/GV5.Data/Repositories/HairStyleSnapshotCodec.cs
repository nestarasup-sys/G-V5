using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;

namespace GV5.Data.Repositories;

internal static class HairStyleSnapshotCodec
{
    private static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static (string Json, string Sha256) Encode(HairStyleDraft draft)
    {
        ArgumentNullException.ThrowIfNull(draft);
        var document = new Document
        {
            SchemaVersion = draft.SchemaVersion,
            HairId = draft.Id.ToString(),
            Model = new ModelDocument
            {
                ModelId = draft.Model.ModelId.ToString(), RevisionId = draft.Model.RevisionId.ToString(),
                Sequence = draft.Model.Sequence.Value, SnapshotSha256 = draft.Model.SnapshotSha256
            },
            Revision = draft.Revision.Value,
            Name = draft.Name,
            Layers = draft.Layers.Select(layer => new LayerDocument
            {
                Part = (int)layer.Part, AssetId = layer.AssetId.ToString(),
                X = layer.Transform.Translation.X, Y = layer.Transform.Translation.Y,
                ScaleX = layer.Transform.Scale.X, ScaleY = layer.Transform.Scale.Y,
                Rotation = layer.Transform.RotationRadians,
                PivotX = layer.Transform.Pivot.X, PivotY = layer.Transform.Pivot.Y,
                FlipX = layer.Transform.FlipX, IsVisible = layer.IsVisible
            }).ToList(),
            Palette = draft.Palette.Colors.ToDictionary(pair => (int)pair.Key, pair => pair.Value)
        };
        var json = JsonSerializer.Serialize(document, Options);
        return (json, Hash(json));
    }

    public static HairStyleDraft Decode(string json, string expectedSha256)
    {
        if (!FixedHashMatches(json, expectedSha256)) throw new InvalidDataException("The hair draft checksum is invalid.");
        var document = JsonSerializer.Deserialize<Document>(json, Options) ?? throw new InvalidDataException("The hair draft is empty.");
        if (document.SchemaVersion != HairStyleDraft.CurrentSchemaVersion || document.Model is null
            || document.Layers is null || document.Palette is null || string.IsNullOrWhiteSpace(document.Name))
            throw new InvalidDataException("The hair draft snapshot is incomplete.");
        var model = ModelRevisionReference.Restore(ModelId.Parse(document.Model.ModelId),
            ModelRevisionId.Parse(document.Model.RevisionId), Revision.From(document.Model.Sequence), document.Model.SnapshotSha256);
        var layers = document.Layers.Select(layer => HairLayer.Create((HairPartId)layer.Part,
            AssetId.Parse(layer.AssetId), new Transform2D(new Point2D(layer.X, layer.Y),
                new Point2D(layer.ScaleX, layer.ScaleY), layer.Rotation, new Point2D(layer.PivotX, layer.PivotY), layer.FlipX),
            layer.IsVisible));
        var palette = HairPaletteOverrides.Restore(document.Palette.Select(pair =>
            new KeyValuePair<HairColorRole, uint>((HairColorRole)pair.Key, pair.Value)));
        return HairStyleDraft.Restore(HairId.Parse(document.HairId), model, Revision.From(document.Revision),
            document.Name, layers, palette);
    }

    private static string Hash(string json) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json))).ToLowerInvariant();
    private static bool FixedHashMatches(string json, string expected) => !string.IsNullOrWhiteSpace(json)
        && expected is { Length: 64 } && expected.All(Uri.IsHexDigit)
        && CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Hash(json)), Encoding.ASCII.GetBytes(expected.ToLowerInvariant()));

    private sealed class Document
    {
        public int SchemaVersion { get; set; }
        public string HairId { get; set; } = string.Empty;
        public ModelDocument Model { get; set; } = new();
        public long Revision { get; set; }
        public string Name { get; set; } = string.Empty;
        public List<LayerDocument> Layers { get; set; } = [];
        public Dictionary<int, uint> Palette { get; set; } = [];
    }

    private sealed class ModelDocument
    {
        public string ModelId { get; set; } = string.Empty;
        public string RevisionId { get; set; } = string.Empty;
        public long Sequence { get; set; }
        public string SnapshotSha256 { get; set; } = string.Empty;
    }

    private sealed class LayerDocument
    {
        public int Part { get; set; }
        public string AssetId { get; set; } = string.Empty;
        public double X { get; set; }
        public double Y { get; set; }
        public double ScaleX { get; set; }
        public double ScaleY { get; set; }
        public double Rotation { get; set; }
        public double PivotX { get; set; }
        public double PivotY { get; set; }
        public bool FlipX { get; set; }
        public bool IsVisible { get; set; }
    }
}
