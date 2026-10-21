using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using Xunit;

namespace GV5.Core.Tests;

public sealed class ModelDraftContentTests
{
    [Fact]
    public void ModelSlot_UsesOneBasedLegacyRangeAndRejectsInvalidValues()
    {
        Assert.Equal(1, ModelSlot.From(ModelSlot.Minimum).Value);
        Assert.Equal(10, ModelSlot.From(ModelSlot.Maximum).Value);
        Assert.False(ModelSlot.TryFrom(0, out _));
        Assert.False(ModelSlot.TryFrom(11, out _));
        Assert.Throws<ArgumentOutOfRangeException>(() => ModelSlot.From(0));
        Assert.Throws<ArgumentOutOfRangeException>(() => ModelSlot.From(11));
        Assert.False(default(ModelSlot).IsValid);
    }

    [Fact]
    public void ModelPartId_IsTypedStableAndRejectsEmptyGuid()
    {
        var id = ModelPartId.New();

        Assert.True(id.IsValid);
        Assert.Equal(id, ModelPartId.Parse(id.ToString()));
        Assert.False(ModelPartId.TryParse(Guid.Empty.ToString(), out _));
        Assert.Throws<ArgumentException>(() => ModelPartId.From(Guid.Empty));
    }

    [Fact]
    public void DraftContent_RestoresVersionedSourcePartsAndExplicitBackToFrontOrder()
    {
        var modelId = ModelId.New();
        var first = CreatePart("Tronco", 0);
        var second = CreatePart("Cabeca", 32);
        var source = AssetId.New();
        var draft = ModelDraftContent.Restore(
            ModelDraftContent.CurrentSchemaVersion,
            modelId,
            Revision.From(4),
            ModelSlot.From(2),
            source,
            128,
            96,
            [first, second],
            [second.Id, first.Id]);

        Assert.Equal(ModelDraftContent.CurrentSchemaVersion, draft.SchemaVersion);
        Assert.Equal(modelId, draft.ModelId);
        Assert.Equal(Revision.From(4), draft.Revision);
        Assert.Equal(ModelSlot.From(2), draft.Slot);
        Assert.Equal(source, draft.SourceAssetId);
        Assert.Equal(new[] { second.Id, first.Id }, draft.LayerOrder);
        Assert.Same(first.SourceTransform, first.WithTransform(Transform2D.Identity).SourceTransform);
    }

    [Fact]
    public void DraftContent_AdvancesContentRevisionWithoutChangingStableIdentityOrSourceTransform()
    {
        var modelId = ModelId.New();
        var part = CreatePart("Tronco", 0);
        var draft = ModelDraftContent.CreateEmpty(modelId, Revision.Initial, ModelSlot.From(1));
        var imported = draft.WithSource(AssetId.New(), 128, 96).WithParts([part], [part.Id]);
        var moved = part.WithTransform(new Transform2D(new Point2D(8, 12), new Point2D(1, 1), 0.25, Point2D.Zero));
        var edited = imported.WithParts([moved], [moved.Id]);

        Assert.Equal(modelId, edited.ModelId);
        Assert.Equal(Revision.From(4), edited.Revision);
        Assert.Equal(imported.SourceAssetId, edited.SourceAssetId);
        Assert.Equal(part.SourceTransform, edited.Parts[0].SourceTransform);
        Assert.NotEqual(edited.Parts[0].Transform, edited.Parts[0].SourceTransform.Transform);
    }

    [Fact]
    public void DraftContent_RejectsUnsupportedVersionsInvalidSourceAndInconsistentOrder()
    {
        var modelId = ModelId.New();
        var part = CreatePart("Tronco", 0);

        Assert.Throws<ArgumentOutOfRangeException>(() => ModelDraftContent.Restore(2, modelId, Revision.Initial, null, null, null, null, [], []));
        Assert.Throws<ArgumentException>(() => ModelDraftContent.Restore(1, default, Revision.Initial, null, null, null, null, [], []));
        Assert.Throws<ArgumentException>(() => ModelDraftContent.Restore(1, modelId, default, null, null, null, null, [], []));
        Assert.Throws<ArgumentException>(() => ModelDraftContent.Restore(1, modelId, Revision.Initial, (ModelSlot?)default(ModelSlot), null, null, null, [], []));
        Assert.Throws<ArgumentException>(() => ModelDraftContent.Restore(1, modelId, Revision.Initial, null, AssetId.New(), 128, null, [], []));
        Assert.Throws<ArgumentOutOfRangeException>(() => ModelDraftContent.Restore(1, modelId, Revision.Initial, null, AssetId.New(), 0, 96, [], []));
        Assert.Throws<ArgumentException>(() => ModelDraftContent.Restore(1, modelId, Revision.Initial, null, null, null, null, [part], []));
        Assert.Throws<ArgumentException>(() => ModelDraftContent.Restore(1, modelId, Revision.Initial, null, null, null, null, [part], [part.Id]));
        Assert.Throws<ArgumentException>(() => ModelDraftContent.Restore(1, modelId, Revision.Initial, null, null, null, null, [part], [part.Id, part.Id]));
        Assert.Throws<ArgumentException>(() => ModelDraftContent.Restore(1, modelId, Revision.Initial, null, null, null, null, [part, part], [part.Id]));
        Assert.Throws<ArgumentException>(() => ModelDraftContent.Restore(1, modelId, Revision.Initial, null, AssetId.New(), 8, 8, [part], [part.Id]));
    }

    [Fact]
    public void ModelPart_RejectsInvalidAssetIdAndSourceCrop()
    {
        var id = ModelPartId.New();
        var sourceTransform = new ModelPartSourceTransform(new Rect2D(0, 0, 2, 2), Transform2D.Identity);

        Assert.Throws<ArgumentException>(() => new ModelPart(id, "Piece", default, new Rect2D(0, 0, 2, 2), Transform2D.Identity, sourceTransform));
        Assert.Throws<ArgumentOutOfRangeException>(() => new ModelPart(id, "Piece", AssetId.New(), new Rect2D(0, 0, 0, 2), Transform2D.Identity, sourceTransform));
        Assert.Throws<ArgumentOutOfRangeException>(() => new ModelPartSourceTransform(new Rect2D(0, 0, 1, 0), Transform2D.Identity));
    }

    [Fact]
    public void DraftContent_RejectsCropsOutsideImportedSourceIncludingNegativeOrigin()
    {
        var modelId = ModelId.New();
        var part = CreatePart("Tronco", 0);
        var negativeCrop = new ModelPart(
            ModelPartId.New(),
            "Fora da origem",
            AssetId.New(),
            new Rect2D(-1, 0, 2, 2),
            Transform2D.Identity,
            new ModelPartSourceTransform(new Rect2D(0, 0, 2, 2), Transform2D.Identity));
        var overflowCrop = new ModelPart(
            ModelPartId.New(),
            "Além da origem",
            AssetId.New(),
            new Rect2D(0, 0, 2, 2),
            Transform2D.Identity,
            new ModelPartSourceTransform(new Rect2D(0, 0, 129, 2), Transform2D.Identity));

        Assert.Throws<ArgumentException>(() => ModelDraftContent.Restore(1, modelId, Revision.Initial, null, AssetId.New(), 128, 96, [negativeCrop], [negativeCrop.Id]));
        Assert.Throws<ArgumentException>(() => ModelDraftContent.Restore(1, modelId, Revision.Initial, null, AssetId.New(), 128, 96, [overflowCrop], [overflowCrop.Id]));
        Assert.Single(ModelDraftContent.Restore(1, modelId, Revision.Initial, null, AssetId.New(), 128, 96, [part], [part.Id]).Parts);
    }

    private static ModelPart CreatePart(string name, int x)
    {
        var crop = new Rect2D(x, 0, 32, 48);
        var transform = new Transform2D(new Point2D(x, 0), new Point2D(1, 1), 0, Point2D.Zero);
        return new ModelPart(ModelPartId.New(), name, AssetId.New(), crop, transform, new ModelPartSourceTransform(crop, transform));
    }
}
