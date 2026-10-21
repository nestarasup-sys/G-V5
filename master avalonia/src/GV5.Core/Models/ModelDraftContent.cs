using System.Collections.Immutable;
using GV5.Core.Identity;
using GV5.Geometry;

namespace GV5.Core.Models;

/// <summary>
/// Versioned, immutable content snapshot for a Fabricator draft. Metadata and concurrency revision remain in ModelDraft;
/// persistence of this snapshot is implemented by the following Fabricator tasks.
/// </summary>
public sealed record ModelDraftContent
{
    public const int CurrentSchemaVersion = 1;

    public int SchemaVersion { get; }
    public ModelId ModelId { get; }
    public Revision Revision { get; }
    public ModelSlot? Slot { get; }
    public AssetId? SourceAssetId { get; }
    public int? SourceWidth { get; }
    public int? SourceHeight { get; }
    public ImmutableArray<ModelPart> Parts { get; }
    /// <summary>Back-to-front order. Every part appears exactly once.</summary>
    public ImmutableArray<ModelPartId> LayerOrder { get; }

    private ModelDraftContent(
        int schemaVersion,
        ModelId modelId,
        Revision revision,
        ModelSlot? slot,
        AssetId? sourceAssetId,
        int? sourceWidth,
        int? sourceHeight,
        ImmutableArray<ModelPart> parts,
        ImmutableArray<ModelPartId> layerOrder)
    {
        SchemaVersion = schemaVersion;
        ModelId = modelId;
        Revision = revision;
        Slot = slot;
        SourceAssetId = sourceAssetId;
        SourceWidth = sourceWidth;
        SourceHeight = sourceHeight;
        Parts = parts;
        LayerOrder = layerOrder;
    }

    public static ModelDraftContent CreateEmpty(ModelId modelId, Revision revision, ModelSlot? slot = null) =>
        Create(CurrentSchemaVersion, modelId, revision, slot, null, null, null, [], []);

    public static ModelDraftContent Restore(
        int schemaVersion,
        ModelId modelId,
        Revision revision,
        ModelSlot? slot,
        AssetId? sourceAssetId,
        int? sourceWidth,
        int? sourceHeight,
        IEnumerable<ModelPart> parts,
        IEnumerable<ModelPartId> layerOrder) =>
        Create(schemaVersion, modelId, revision, slot, sourceAssetId, sourceWidth, sourceHeight, parts, layerOrder);

    public ModelDraftContent WithParts(IEnumerable<ModelPart> parts, IEnumerable<ModelPartId> layerOrder) =>
        Create(SchemaVersion, ModelId, Revision.Next(), Slot, SourceAssetId, SourceWidth, SourceHeight, parts, layerOrder);

    public ModelDraftContent WithSource(AssetId sourceAssetId, int width, int height) =>
        Create(SchemaVersion, ModelId, Revision.Next(), Slot, sourceAssetId, width, height, Parts, LayerOrder);

    private static ModelDraftContent Create(
        int schemaVersion,
        ModelId modelId,
        Revision revision,
        ModelSlot? slot,
        AssetId? sourceAssetId,
        int? sourceWidth,
        int? sourceHeight,
        IEnumerable<ModelPart> parts,
        IEnumerable<ModelPartId> layerOrder)
    {
        if (schemaVersion != CurrentSchemaVersion)
        {
            throw new ArgumentOutOfRangeException(nameof(schemaVersion), schemaVersion, "Unsupported model draft content schema version.");
        }
        if (!modelId.IsValid)
        {
            throw new ArgumentException("Model draft content requires a valid model ID.", nameof(modelId));
        }
        if (!revision.IsValid)
        {
            throw new ArgumentException("Model draft content requires a positive revision.", nameof(revision));
        }
        if (slot is { IsValid: false })
        {
            throw new ArgumentException("A model slot must be between 1 and 10 when assigned.", nameof(slot));
        }
        if (sourceAssetId is { IsValid: false })
        {
            throw new ArgumentException("A source asset reference must be valid when present.", nameof(sourceAssetId));
        }
        if ((sourceWidth is null) != (sourceHeight is null) || (sourceWidth is null) != (sourceAssetId is null))
        {
            throw new ArgumentException("Source asset ID, width and height must either all be present or all be absent.");
        }
        if (sourceWidth is <= 0 || sourceHeight is <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(sourceWidth), "Source image dimensions must be positive.");
        }
        ArgumentNullException.ThrowIfNull(parts);
        ArgumentNullException.ThrowIfNull(layerOrder);

        var partArray = parts.ToImmutableArray();
        var orderArray = layerOrder.ToImmutableArray();
        if (partArray.Any(static part => part is null))
        {
            throw new ArgumentException("A draft cannot contain a null model part.", nameof(parts));
        }
        if (partArray.Select(static part => part.Id).Distinct().Count() != partArray.Length)
        {
            throw new ArgumentException("Model part IDs must be unique within a draft.", nameof(parts));
        }
        if (orderArray.Any(static id => !id.IsValid)
            || orderArray.Distinct().Count() != orderArray.Length
            || !orderArray.ToHashSet().SetEquals(partArray.Select(static part => part.Id)))
        {
            throw new ArgumentException("Layer order must contain each part ID exactly once.", nameof(layerOrder));
        }
        if (partArray.Length > 0 && sourceAssetId is null)
        {
            throw new ArgumentException("A model with pieces must retain its imported source asset.", nameof(sourceAssetId));
        }
        if (sourceWidth is { } width && sourceHeight is { } height
            && partArray.Any(part =>
                part.SourceCrop.X < 0 || part.SourceCrop.Y < 0
                || part.SourceCrop.Right > width || part.SourceCrop.Bottom > height
                || part.SourceTransform.Crop.X < 0 || part.SourceTransform.Crop.Y < 0
                || part.SourceTransform.Crop.Right > width || part.SourceTransform.Crop.Bottom > height))
        {
            throw new ArgumentException("Part crops and source transforms must fit within the imported source image.", nameof(parts));
        }

        return new ModelDraftContent(schemaVersion, modelId, revision, slot, sourceAssetId, sourceWidth, sourceHeight, partArray, orderArray);
    }
}
