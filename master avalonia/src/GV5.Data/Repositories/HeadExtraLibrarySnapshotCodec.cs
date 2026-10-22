using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;

namespace GV5.Data.Repositories;

internal static class HeadExtraLibrarySnapshotCodec
{
    private static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static (string Json, string Sha256) Encode(HeadExtraLibraryDraft draft)
    {
        ArgumentNullException.ThrowIfNull(draft);
        var document = new Document
        {
            SchemaVersion = draft.SchemaVersion,
            LibraryId = draft.Id.ToString("D"),
            ModelSlot = draft.ModelSlot.Value,
            Revision = draft.Revision.Value,
            Assets = draft.Assets.Select(asset => new AssetDocument
            {
                Id = asset.Id.ToString(), AssetId = asset.AssetId.ToString(), Name = asset.Name,
                Width = asset.Width, Height = asset.Height,
                X = asset.DefaultTransform.Translation.X, Y = asset.DefaultTransform.Translation.Y,
                ScaleX = asset.DefaultTransform.Scale.X, ScaleY = asset.DefaultTransform.Scale.Y,
                Rotation = asset.DefaultTransform.RotationRadians,
                PivotX = asset.DefaultTransform.Pivot.X, PivotY = asset.DefaultTransform.Pivot.Y,
                FlipX = asset.DefaultTransform.FlipX, FlipY = asset.DefaultTransform.FlipY
            }).ToList()
        };
        var json = JsonSerializer.Serialize(document, Options);
        return (json, Hash(json));
    }

    public static HeadExtraLibraryDraft Decode(string json, string expectedSha256)
    {
        if (!FixedHashMatches(json, expectedSha256)) throw new InvalidDataException("The head-extra library checksum is invalid.");
        var document = JsonSerializer.Deserialize<Document>(json, Options)
            ?? throw new InvalidDataException("The head-extra library snapshot is empty.");
        if (document.SchemaVersion != HeadExtraLibraryDraft.CurrentSchemaVersion || document.Assets is null)
            throw new InvalidDataException("The head-extra library snapshot is incomplete.");
        var assets = document.Assets.Select(asset => HeadExtraAsset.Restore(FaceComponentId.Parse(asset.Id),
            AssetId.Parse(asset.AssetId), asset.Name, asset.Width, asset.Height,
            new Transform2D(new Point2D(asset.X, asset.Y), new Point2D(asset.ScaleX, asset.ScaleY),
                asset.Rotation, new Point2D(asset.PivotX, asset.PivotY), asset.FlipX, asset.FlipY)));
        return HeadExtraLibraryDraft.Restore(Guid.Parse(document.LibraryId), ModelSlot.From(document.ModelSlot),
            Revision.From(document.Revision), assets);
    }

    private static string Hash(string json) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json))).ToLowerInvariant();
    private static bool FixedHashMatches(string json, string expected) => !string.IsNullOrWhiteSpace(json)
        && expected is { Length: 64 } && expected.All(Uri.IsHexDigit)
        && CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Hash(json)), Encoding.ASCII.GetBytes(expected.ToLowerInvariant()));

    private sealed class Document
    {
        public int SchemaVersion { get; set; }
        public string LibraryId { get; set; } = string.Empty;
        public int ModelSlot { get; set; }
        public long Revision { get; set; }
        public List<AssetDocument> Assets { get; set; } = [];
    }

    private sealed class AssetDocument
    {
        public string Id { get; set; } = string.Empty;
        public string AssetId { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public int Width { get; set; }
        public int Height { get; set; }
        public double X { get; set; }
        public double Y { get; set; }
        public double ScaleX { get; set; }
        public double ScaleY { get; set; }
        public double Rotation { get; set; }
        public double PivotX { get; set; }
        public double PivotY { get; set; }
        public bool FlipX { get; set; }
        public bool FlipY { get; set; }
    }
}
