using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;

namespace GV5.Data.Repositories;

internal static class WardrobeSnapshotCodec
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    public static (string Json, string Sha256) Encode(WardrobeSet draft) => EncodeDocument(DraftDocument.From(draft));
    public static (string Json, string Sha256) Encode(PublishedWardrobeRevision revision) => EncodeDocument(PublishedDocument.From(revision));

    public static WardrobeSet DecodeDraft(string json, string expectedSha256)
    {
        var document = DecodeDocument<DraftDocument>(json, expectedSha256);
        if (document.SchemaVersion != WardrobeSet.CurrentSchemaVersion || document.Model is null
            || document.Components is null || string.IsNullOrWhiteSpace(document.Name))
            throw new InvalidDataException("The wardrobe draft snapshot is incomplete.");
        return WardrobeSet.Restore(WardrobeId.Parse(document.WardrobeId), ReadModel(document.Model),
            Revision.From(document.Revision), document.Name, document.Components.Select(ReadComponent));
    }

    public static PublishedWardrobeRevision DecodePublished(string json, string expectedSha256)
    {
        var document = DecodeDocument<PublishedDocument>(json, expectedSha256);
        if (document.SchemaVersion != WardrobeSet.CurrentSchemaVersion || document.Model is null
            || document.Components is null || string.IsNullOrWhiteSpace(document.Name))
            throw new InvalidDataException("The published wardrobe snapshot is incomplete.");
        return PublishedWardrobeRevision.Restore(WardrobeRevisionId.Parse(document.WardrobeRevisionId),
            WardrobeId.Parse(document.WardrobeId), Revision.From(document.Revision), Revision.From(document.DraftRevision),
            ReadModel(document.Model), document.Name, document.PublishedUtcMs, expectedSha256,
            document.Components.Select(ReadComponent));
    }

    private static (string Json, string Sha256) EncodeDocument<T>(T document)
    {
        var json = JsonSerializer.Serialize(document, Options);
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json))).ToLowerInvariant();
        return (json, hash);
    }

    private static T DecodeDocument<T>(string json, string expectedSha256)
    {
        if (string.IsNullOrWhiteSpace(json) || expectedSha256 is null || expectedSha256.Length != 64
            || !expectedSha256.All(Uri.IsHexDigit)) throw new InvalidDataException("The wardrobe snapshot checksum or payload is invalid.");
        var actual = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json))).ToLowerInvariant();
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(actual), Encoding.ASCII.GetBytes(expectedSha256.ToLowerInvariant())))
            throw new InvalidDataException("The wardrobe snapshot checksum does not match its payload.");
        return JsonSerializer.Deserialize<T>(json, Options) ?? throw new InvalidDataException("The wardrobe snapshot is empty.");
    }

    private static ModelReferenceDocument ModelDocument(ModelRevisionReference model) => new()
    {
        ModelId = model.ModelId.ToString(), RevisionId = model.RevisionId.ToString(),
        Sequence = model.Sequence.Value, SnapshotSha256 = model.SnapshotSha256
    };

    private static ModelRevisionReference ReadModel(ModelReferenceDocument model) =>
        ModelRevisionReference.Restore(ModelId.Parse(model.ModelId), ModelRevisionId.Parse(model.RevisionId),
            Revision.From(model.Sequence), model.SnapshotSha256);

    private static ComponentDocument ComponentDocumentFrom(WardrobeComponent component) => new()
    {
        Id = component.Id.ToString(), Name = component.Name, Category = (int)component.Category,
        BoneId = component.BoneId.ToString(), AssetId = component.AssetId.ToString(),
        X = component.Placement.X, Y = component.Placement.Y, Width = component.Placement.Width,
        Height = component.Placement.Height, RotationDegrees = component.RotationDegrees,
        BindingVersion = component.Binding.Version, BindingBoneId = component.Binding.BoneId,
        BoneWidth = component.Binding.BoneWidth, BoneHeight = component.Binding.BoneHeight,
        BoneRotationDegrees = component.Binding.BoneRotationDegrees, LocalCenterX = component.Binding.LocalCenterX,
        LocalCenterY = component.Binding.LocalCenterY, WidthRatio = component.Binding.WidthRatio,
        HeightRatio = component.Binding.HeightRatio, RelativeRotationDegrees = component.Binding.RelativeRotationDegrees,
        RenderAboveHair = component.RenderAboveHair
    };

    private static WardrobeComponent ReadComponent(ComponentDocument component) => WardrobeComponent.Restore(
        WardrobeComponentId.Parse(component.Id), component.Name, (WardrobeCategory)component.Category,
        ModelPartId.Parse(component.BoneId), AssetId.Parse(component.AssetId),
        new Rect2D(component.X, component.Y, component.Width, component.Height), component.RotationDegrees,
        WardrobeBinding.Restore(component.BindingVersion, component.BindingBoneId, component.BoneWidth,
            component.BoneHeight, component.BoneRotationDegrees, component.LocalCenterX, component.LocalCenterY,
            component.WidthRatio, component.HeightRatio, component.RelativeRotationDegrees), component.RenderAboveHair);

    private sealed class DraftDocument
    {
        public int SchemaVersion { get; set; } = WardrobeSet.CurrentSchemaVersion;
        public string WardrobeId { get; set; } = string.Empty;
        public ModelReferenceDocument Model { get; set; } = new();
        public long Revision { get; set; }
        public string Name { get; set; } = string.Empty;
        public List<ComponentDocument> Components { get; set; } = [];
        public static DraftDocument From(WardrobeSet draft) => new()
        {
            WardrobeId = draft.Id.ToString(), Model = ModelDocument(draft.Model), Revision = draft.Revision.Value,
            Name = draft.Name, Components = draft.Components.Select(ComponentDocumentFrom).ToList()
        };
    }

    private sealed class PublishedDocument
    {
        public int SchemaVersion { get; set; } = WardrobeSet.CurrentSchemaVersion;
        public string WardrobeRevisionId { get; set; } = string.Empty;
        public string WardrobeId { get; set; } = string.Empty;
        public long Revision { get; set; }
        public long DraftRevision { get; set; }
        public ModelReferenceDocument Model { get; set; } = new();
        public string Name { get; set; } = string.Empty;
        public long PublishedUtcMs { get; set; }
        public List<ComponentDocument> Components { get; set; } = [];
        public static PublishedDocument From(PublishedWardrobeRevision revision) => new()
        {
            WardrobeRevisionId = revision.Id.ToString(), WardrobeId = revision.WardrobeId.ToString(),
            Revision = revision.Revision.Value, DraftRevision = revision.DraftRevision.Value,
            Model = ModelDocument(revision.Model), Name = revision.Name, PublishedUtcMs = revision.PublishedUtcMs,
            Components = revision.Components.Select(ComponentDocumentFrom).ToList()
        };
    }

    private sealed class ModelReferenceDocument
    {
        public string ModelId { get; set; } = string.Empty;
        public string RevisionId { get; set; } = string.Empty;
        public long Sequence { get; set; }
        public string SnapshotSha256 { get; set; } = string.Empty;
    }

    private sealed class ComponentDocument
    {
        public string Id { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public int Category { get; set; }
        public string BoneId { get; set; } = string.Empty;
        public string AssetId { get; set; } = string.Empty;
        public double X { get; set; }
        public double Y { get; set; }
        public double Width { get; set; }
        public double Height { get; set; }
        public double RotationDegrees { get; set; }
        public int BindingVersion { get; set; }
        public string BindingBoneId { get; set; } = string.Empty;
        public double BoneWidth { get; set; }
        public double BoneHeight { get; set; }
        public double BoneRotationDegrees { get; set; }
        public double LocalCenterX { get; set; }
        public double LocalCenterY { get; set; }
        public double WidthRatio { get; set; }
        public double HeightRatio { get; set; }
        public double RelativeRotationDegrees { get; set; }
        public bool RenderAboveHair { get; set; }
    }
}
