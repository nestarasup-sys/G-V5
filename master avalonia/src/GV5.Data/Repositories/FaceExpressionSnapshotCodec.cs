using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;

namespace GV5.Data.Repositories;

internal static class FaceExpressionSnapshotCodec
{
    private static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static (string Json, string Sha256) Encode(FaceExpressionPresetDraft preset)
    {
        ArgumentNullException.ThrowIfNull(preset);
        var document = new PresetDocument
        {
            SchemaVersion = 1,
            Id = preset.Id.ToString(),
            CollectionId = preset.CollectionId.ToString(),
            ModelId = preset.Model.ModelId.ToString(),
            ModelRevisionId = preset.Model.RevisionId.ToString(),
            ModelSequence = preset.Model.Sequence.Value,
            ModelSha256 = preset.Model.SnapshotSha256,
            FaceId = preset.FaceId.ToString(),
            FaceRevision = preset.FaceRevision.Value,
            Revision = preset.Revision.Value,
            ExpressionIndex = preset.ExpressionIndex,
            Name = preset.Name,
            Selections = preset.Selections.OrderBy(pair => pair.Key).Select(pair => new SelectionDocument
                { Slot = (int)pair.Key, ComponentId = pair.Value.ToString() }).ToList(),
            Transforms = EncodeTransforms(preset.Transforms),
            ReferenceTransforms = EncodeTransforms(preset.ReferenceTransforms),
            EyeMode = (int)preset.EyeMode,
            MouthMode = (int)preset.MouthMode,
            EyeSidesLinked = preset.EyeSidesLinked,
            EyebrowSidesLinked = preset.EyebrowSidesLinked,
            NoseOpacity = preset.NoseOpacity,
            Effects = EncodeEffects(preset.Effects)
        };
        var json = JsonSerializer.Serialize(document, Options);
        return (json, Hash(json));
    }

    public static FaceExpressionPresetDraft Decode(string json, string expectedHash)
    {
        if (!FixedHashMatches(json, expectedHash)) throw new InvalidDataException("The face expression checksum is invalid.");
        var document = JsonSerializer.Deserialize<PresetDocument>(json, Options)
            ?? throw new InvalidDataException("The face expression snapshot is empty.");
        if (document.SchemaVersion != 1 || document.Selections is null || document.Transforms is null
            || document.ReferenceTransforms is null || document.Effects is null || string.IsNullOrWhiteSpace(document.Name))
            throw new InvalidDataException("The face expression snapshot is incomplete.");
        var model = ModelRevisionReference.Restore(ModelId.Parse(document.ModelId),
            ModelRevisionId.Parse(document.ModelRevisionId), Revision.From(document.ModelSequence), document.ModelSha256);
        return FaceExpressionPresetDraft.Restore(FaceExpressionPresetId.Parse(document.Id),
            FaceExpressionCollectionId.Parse(document.CollectionId), model, FaceId.Parse(document.FaceId),
            Revision.From(document.FaceRevision), Revision.From(document.Revision), document.ExpressionIndex,
            document.Name,
            document.Selections.Select(selection => new KeyValuePair<FaceAssemblySlot, FaceComponentId>(
                (FaceAssemblySlot)selection.Slot, FaceComponentId.Parse(selection.ComponentId))),
            DecodeTransforms(document.Transforms), DecodeTransforms(document.ReferenceTransforms),
            (FaceEyeMode)document.EyeMode, (FaceMouthMode)document.MouthMode,
            document.EyeSidesLinked, document.EyebrowSidesLinked, document.NoseOpacity, DecodeEffects(document.Effects));
    }

    private static List<TransformDocument> EncodeTransforms(IReadOnlyDictionary<FaceAssemblySlot, Transform2D> transforms) =>
        transforms.OrderBy(pair => pair.Key).Select(pair => new TransformDocument
        {
            Slot = (int)pair.Key, X = pair.Value.Translation.X, Y = pair.Value.Translation.Y,
            ScaleX = pair.Value.Scale.X, ScaleY = pair.Value.Scale.Y, Rotation = pair.Value.RotationRadians,
            PivotX = pair.Value.Pivot.X, PivotY = pair.Value.Pivot.Y, FlipX = pair.Value.FlipX, FlipY = pair.Value.FlipY
        }).ToList();

    private static IEnumerable<KeyValuePair<FaceAssemblySlot, Transform2D>> DecodeTransforms(IEnumerable<TransformDocument> transforms) =>
        transforms.Select(item => new KeyValuePair<FaceAssemblySlot, Transform2D>((FaceAssemblySlot)item.Slot,
            new Transform2D(new Point2D(item.X, item.Y), new Point2D(item.ScaleX, item.ScaleY), item.Rotation,
                new Point2D(item.PivotX, item.PivotY), item.FlipX, item.FlipY)));

    private static EffectsDocument EncodeEffects(FaceExpressionEffects effects) => new()
    {
        Shadow = EncodeEffect(effects.Shadow), Blush = EncodeEffect(effects.Blush), MouthBlush = EncodeEffect(effects.MouthBlush)
    };

    private static EffectDocument EncodeEffect(FaceExpressionEffectParameters effect) => new()
    {
        Enabled = effect.Enabled, Color = effect.Color, Opacity = effect.Opacity, Softness = effect.Softness,
        Size = effect.Size, OffsetX = effect.OffsetX, OffsetY = effect.OffsetY, AspectRatio = effect.AspectRatio,
        Width = effect.Width, Height = effect.Height, RotationDegrees = effect.RotationDegrees, Style = (int)effect.Style
    };

    private static FaceExpressionEffects DecodeEffects(EffectsDocument effects) => FaceExpressionEffects.Create(
        DecodeEffect(effects.Shadow), DecodeEffect(effects.Blush), DecodeEffect(effects.MouthBlush));

    private static FaceExpressionEffectParameters DecodeEffect(EffectDocument? effect) => effect is null
        ? throw new InvalidDataException("An expression effect is missing.")
        : FaceExpressionEffectParameters.Create(effect.Enabled, effect.Color, effect.Opacity, effect.Softness,
            effect.Size, effect.OffsetY, effect.OffsetX, effect.AspectRatio, effect.Width, effect.Height,
            effect.RotationDegrees, (FaceExpressionEffectStyle)effect.Style);

    private static string Hash(string json) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json))).ToLowerInvariant();
    private static bool FixedHashMatches(string json, string expected) => !string.IsNullOrWhiteSpace(json)
        && expected is { Length: 64 } && expected.All(Uri.IsHexDigit)
        && CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(Hash(json)), Encoding.ASCII.GetBytes(expected.ToLowerInvariant()));

    private sealed class PresetDocument
    {
        public int SchemaVersion { get; set; }
        public string Id { get; set; } = string.Empty;
        public string CollectionId { get; set; } = string.Empty;
        public string ModelId { get; set; } = string.Empty;
        public string ModelRevisionId { get; set; } = string.Empty;
        public long ModelSequence { get; set; }
        public string ModelSha256 { get; set; } = string.Empty;
        public string FaceId { get; set; } = string.Empty;
        public long FaceRevision { get; set; }
        public long Revision { get; set; }
        public int ExpressionIndex { get; set; }
        public string Name { get; set; } = string.Empty;
        public List<SelectionDocument> Selections { get; set; } = [];
        public List<TransformDocument> Transforms { get; set; } = [];
        public List<TransformDocument> ReferenceTransforms { get; set; } = [];
        public int EyeMode { get; set; }
        public int MouthMode { get; set; }
        public bool EyeSidesLinked { get; set; }
        public bool EyebrowSidesLinked { get; set; }
        public double NoseOpacity { get; set; }
        public EffectsDocument Effects { get; set; } = new();
    }

    private sealed class SelectionDocument { public int Slot { get; set; } public string ComponentId { get; set; } = string.Empty; }
    private sealed class TransformDocument
    {
        public int Slot { get; set; }
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
    private sealed class EffectsDocument { public EffectDocument? Shadow { get; set; } public EffectDocument? Blush { get; set; } public EffectDocument? MouthBlush { get; set; } }
    private sealed class EffectDocument
    {
        public bool Enabled { get; set; }
        public string Color { get; set; } = string.Empty;
        public double Opacity { get; set; }
        public double Softness { get; set; }
        public double Size { get; set; }
        public double OffsetX { get; set; }
        public double OffsetY { get; set; }
        public double AspectRatio { get; set; }
        public double Width { get; set; }
        public double Height { get; set; }
        public double RotationDegrees { get; set; }
        public int Style { get; set; }
    }
}
