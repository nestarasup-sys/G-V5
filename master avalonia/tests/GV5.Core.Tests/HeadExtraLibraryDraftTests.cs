using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using Xunit;

namespace GV5.Core.Tests;

public sealed class HeadExtraLibraryDraftTests
{
    [Fact]
    public void LibraryIsScopedToSlotAndSupportsIndependentNameTransformAndRemovalRevisions()
    {
        var first = HeadExtraLibraryDraft.Create(ModelSlot.From(1));
        var extra = HeadExtraAsset.Create(AssetId.New(), "Óculos", 64, 32, Transform2D.Identity);
        var added = first.WithAsset(extra);
        var renamed = added.WithAssetName(extra.Id, "Óculos redondos");
        var moved = renamed.WithAssetTransform(extra.Id,
            new Transform2D(new Point2D(10, 20), new Point2D(0.5, 0.75), 0.25, Point2D.Zero));
        var removed = moved.WithoutAsset(extra.Id);
        var otherSlot = HeadExtraLibraryDraft.Create(ModelSlot.From(2));

        Assert.Equal(Revision.From(1), first.Revision);
        Assert.Equal(Revision.From(2), added.Revision);
        Assert.Equal("Óculos redondos", renamed.Assets.Single().Name);
        Assert.Equal(Revision.From(3), renamed.Revision);
        Assert.Equal(new Point2D(10, 20), moved.Assets.Single().DefaultTransform.Translation);
        Assert.Equal(Revision.From(4), moved.Revision);
        Assert.Empty(removed.Assets);
        Assert.Equal(Revision.From(5), removed.Revision);
        Assert.Equal(ModelSlot.From(1), moved.ModelSlot);
        Assert.Empty(otherSlot.Assets);
        Assert.NotEqual(moved.Id, otherSlot.Id);
    }

    [Fact]
    public void ReplacingAnEntryKeepsItsIdentityAndSlotWhileEnforcingLibraryLimit()
    {
        var extra = HeadExtraAsset.Create(AssetId.New(), "Óculos", 64, 32, Transform2D.Identity);
        var library = HeadExtraLibraryDraft.Create(ModelSlot.From(3)).WithAsset(extra);
        var replacement = HeadExtraAsset.Restore(extra.Id, AssetId.New(), "Óculos novos", 80, 40, Transform2D.Identity);
        var replaced = library.WithAsset(replacement);

        Assert.Single(replaced.Assets);
        Assert.Equal(extra.Id, replaced.Assets[0].Id);
        Assert.Equal(replacement.AssetId, replaced.Assets[0].AssetId);
        Assert.Equal(Revision.From(3), replaced.Revision);
        Assert.Same(library, library.WithoutAsset(FaceComponentId.New()));

        var full = HeadExtraLibraryDraft.Restore(Guid.NewGuid(), ModelSlot.From(3), Revision.Initial,
            Enumerable.Range(0, HeadExtraLibraryDraft.MaximumAssets).Select(index =>
                HeadExtraAsset.Create(AssetId.New(), $"Extra {index}", 1, 1, Transform2D.Identity)));
        Assert.Throws<InvalidOperationException>(() => full.WithAsset(
            HeadExtraAsset.Create(AssetId.New(), "Extra excedente", 1, 1, Transform2D.Identity)));
    }

    [Fact]
    public void RestoredLibraryRejectsDuplicateIdsAndInvalidImageMetadata()
    {
        var asset = HeadExtraAsset.Create(AssetId.New(), "Óculos", 64, 32, Transform2D.Identity);
        Assert.Throws<ArgumentException>(() => HeadExtraLibraryDraft.Restore(Guid.NewGuid(), ModelSlot.From(1),
            Revision.Initial, [asset, asset]));
        Assert.Throws<ArgumentOutOfRangeException>(() => HeadExtraAsset.Create(AssetId.New(), "Óculos", 0, 32,
            Transform2D.Identity));
        Assert.Throws<ArgumentOutOfRangeException>(() => HeadExtraAsset.Create(AssetId.New(), "Óculos", 64, 32,
            new Transform2D(Point2D.Zero, new Point2D(double.NaN, 1), 0, Point2D.Zero)));
    }
}
