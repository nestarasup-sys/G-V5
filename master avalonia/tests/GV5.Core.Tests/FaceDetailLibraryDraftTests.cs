using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using Xunit;

namespace GV5.Core.Tests;

public sealed class FaceDetailLibraryDraftTests
{
    [Fact]
    public void LibrarySupportsTheFourIndependentDetailKindsAndSlotScopedRevisions()
    {
        var library = FaceDetailLibraryDraft.Create(ModelSlot.From(3));
        var details = new[]
        {
            FaceDetailAsset.Create(FaceDetailKind.EyeHighlightLeft, AssetId.New(), "Brilho esquerdo", 16, 12, Transform2D.Identity),
            FaceDetailAsset.Create(FaceDetailKind.EyeHighlightRight, AssetId.New(), "Brilho direito", 16, 12, Transform2D.Identity),
            FaceDetailAsset.Create(FaceDetailKind.Blush, AssetId.New(), "Blush", 40, 20, Transform2D.Identity),
            FaceDetailAsset.Create(FaceDetailKind.FacialShadow, AssetId.New(), "Sombra", 48, 32, Transform2D.Identity)
        };
        var updated = details.Aggregate(library, (current, detail) => current.WithAsset(detail));
        var moved = updated.WithAsset(details[2].WithTransform(
            new Transform2D(new Point2D(12, 28), new Point2D(.6, .5), .2, Point2D.Zero)));
        var removed = moved.WithoutAsset(details[0].Id);
        var otherSlot = FaceDetailLibraryDraft.Create(ModelSlot.From(4));

        Assert.Equal(Revision.From(1), library.Revision);
        Assert.Equal(Revision.From(5), updated.Revision);
        Assert.Equal(new Point2D(12, 28), Assert.Single(moved.Assets, item => item.Kind == FaceDetailKind.Blush).Transform.Translation);
        Assert.Equal(Revision.From(6), moved.Revision);
        Assert.Equal(3, removed.Assets.Length);
        Assert.Equal(Revision.From(7), removed.Revision);
        Assert.Empty(otherSlot.Assets);
        Assert.NotEqual(library.Id, otherSlot.Id);
    }

    [Fact]
    public void RestoredLibraryRejectsDuplicateIdsInvalidKindsAndOutOfRangeMetadata()
    {
        var detail = FaceDetailAsset.Create(FaceDetailKind.Blush, AssetId.New(), "Blush", 16, 12, Transform2D.Identity);
        Assert.Throws<ArgumentException>(() => FaceDetailLibraryDraft.Restore(Guid.NewGuid(), ModelSlot.From(1),
            Revision.Initial, [detail, detail]));
        Assert.Throws<ArgumentException>(() => FaceDetailAsset.Restore(FaceComponentId.New(), (FaceDetailKind)99,
            AssetId.New(), "Inválido", 1, 1, Transform2D.Identity));
        Assert.Throws<ArgumentOutOfRangeException>(() => FaceDetailAsset.Create(FaceDetailKind.Blush,
            AssetId.New(), "Blush", 0, 12, Transform2D.Identity));
        Assert.Throws<ArgumentOutOfRangeException>(() => FaceDetailAsset.Create(FaceDetailKind.Blush,
            AssetId.New(), "Blush", 16, 12,
            new Transform2D(Point2D.Zero, new Point2D(21, 1), 0, Point2D.Zero)));
    }
}
