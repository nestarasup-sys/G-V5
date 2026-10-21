using GV5.Application.Contracts;
using GV5.Application.Services;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using Xunit;

namespace GV5.Headless.Tests;

public sealed class FabricatorWardrobeCatalogTests
{
    [Fact]
    public async Task CatalogFiltersExactModelAndCategoryAndPagesWithoutRepeatsAtTimestampTies()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var model = CreateModel();
        var otherModel = CreateModel();
        var publications = new[]
        {
            Publish(model, 500, ("Camisa 1", WardrobeCategory.Shirt), ("Jaqueta 1", WardrobeCategory.Jacket)),
            Publish(model, 500, ("Camisa 2", WardrobeCategory.Shirt), ("Luvas", WardrobeCategory.Gloves)),
            Publish(otherModel, 500, ("Camisa externa", WardrobeCategory.Shirt))
        };
        var catalog = new WardrobeCatalog(publications, new TrackingThumbnails());

        var first = await catalog.GetPageAsync(WardrobeCatalogRequest.Create(
            ModelRevisionReference.From(model), WardrobeCategory.Shirt, pageSize: 1), cancellationToken);
        Assert.True(first.IsSuccess, first.Error?.Message);
        Assert.Single(first.Value.Items);
        Assert.True(first.Value.HasMore);
        Assert.NotNull(first.Value.NextCursor);

        var second = await catalog.GetPageAsync(WardrobeCatalogRequest.Create(
            ModelRevisionReference.From(model), WardrobeCategory.Shirt, pageSize: 1, first.Value.NextCursor), cancellationToken);
        Assert.True(second.IsSuccess, second.Error?.Message);
        Assert.Single(second.Value.Items);
        Assert.False(second.Value.HasMore);
        Assert.Null(second.Value.NextCursor);
        Assert.NotEqual(first.Value.Items[0].Component.Id, second.Value.Items[0].Component.Id);
        Assert.All(first.Value.Items.Concat(second.Value.Items), item =>
        {
            Assert.Equal(WardrobeCategory.Shirt, item.Component.Category);
            Assert.Equal(ModelRevisionReference.From(model), item.Publication.Model);
        });

        var all = await catalog.GetPageAsync(WardrobeCatalogRequest.Create(ModelRevisionReference.From(model), pageSize: 10), cancellationToken);
        Assert.True(all.IsSuccess, all.Error?.Message);
        Assert.Equal(4, all.Value.Items.Count);
        Assert.DoesNotContain(all.Value.Items, item => item.Publication.Model == ModelRevisionReference.From(otherModel));
    }

    [Fact]
    public async Task CatalogLoadsOnlyVisibleThumbnailWindowAndRejectsInvalidQueries()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var model = CreateModel();
        var thumbnails = new TrackingThumbnails();
        var catalog = new WardrobeCatalog(
            [Publish(model, 800,
                ("Camisa", WardrobeCategory.Shirt),
                ("Jaqueta", WardrobeCategory.Jacket),
                ("Luvas", WardrobeCategory.Gloves),
                ("Sapatos", WardrobeCategory.Shoes),
                ("Cinto", WardrobeCategory.Belt))], thumbnails);
        var page = await catalog.GetPageAsync(WardrobeCatalogRequest.Create(ModelRevisionReference.From(model), pageSize: 10), cancellationToken);
        Assert.True(page.IsSuccess, page.Error?.Message);

        var visible = await catalog.GetVisibleThumbnailsAsync(page.Value, firstVisibleIndex: 2, visibleCount: 1,
            ThumbnailRecipe.Create(64, 64), maximumPrefetch: 2, cancellationToken);
        Assert.True(visible.IsSuccess, visible.Error?.Message);
        Assert.Equal(3, visible.Value.Count);
        Assert.Equal(3, thumbnails.RequestedIds.Count);
        var expectedIndexes = AssetThumbnailWindowPlanner.SelectIndexes(page.Value.Items.Count, 2, 1, 2);
        Assert.Equal(expectedIndexes.Select(index => page.Value.Items[index].Component.AssetId), thumbnails.RequestedIds);
        foreach (var stream in visible.Value) await stream.DisposeAsync();

        Assert.Throws<ArgumentOutOfRangeException>(() => WardrobeCatalogRequest.Create(
            ModelRevisionReference.From(model), (WardrobeCategory)999));
        Assert.Throws<ArgumentOutOfRangeException>(() => WardrobeCatalogRequest.Create(
            ModelRevisionReference.From(model), pageSize: 101));
    }

    private static PublishedWardrobeRevision Publish(PublishedModelRevision model, long publishedAt,
        params (string Name, WardrobeCategory Category)[] components)
    {
        var part = model.Content.Parts[0];
        var source = part.SourceTransform;
        var transform = source.Transform;
        var center = transform.Apply(new Point2D(source.Crop.X + source.Crop.Width / 2,
            source.Crop.Y + source.Crop.Height / 2));
        var width = source.Crop.Width * transform.Scale.X;
        var height = source.Crop.Height * transform.Scale.Y;
        var frame = new WardrobeBoneFrame(part.Id.ToString(),
            new Rect2D(center.X - width / 2, center.Y - height / 2, width, height),
            transform.RotationRadians * 180 / Math.PI, transform.FlipX, transform.FlipY);
        var garments = components.Select((component, index) => WardrobeComponent.Create(component.Name,
            component.Category, part.Id, AssetId.New(), new Rect2D(index * 3, index * 2, 12, 16), 0, frame)).ToArray();
        var draft = WardrobeSet.Create(model, "Catálogo").WithContent("Catálogo", garments);
        return PublishedWardrobeRevision.Snapshot(draft, Revision.Initial, publishedAt, new string('a', 64));
    }

    private static PublishedModelRevision CreateModel()
    {
        var modelId = ModelId.New();
        var crop = new Rect2D(0, 0, 20, 30);
        var transform = new Transform2D(new Point2D(10, 20), new Point2D(1, 1), 0, Point2D.Zero);
        var part = new ModelPart(ModelPartId.New(), "Tronco", AssetId.New(), crop, transform,
            new ModelPartSourceTransform(crop, transform));
        var content = ModelDraftContent.Restore(ModelDraftContent.CurrentSchemaVersion, modelId, Revision.Initial,
            ModelSlot.From(1), AssetId.New(), 120, 100, [part], [part.Id]);
        return PublishedModelRevision.Restore(ModelRevisionId.New(), modelId, Revision.Initial, Revision.Initial,
            "Modelo", 10, new string('b', 64), content);
    }

    private sealed class TrackingThumbnails : IThumbnailService
    {
        public List<AssetId> RequestedIds { get; } = [];

        public Task<Result<Stream>> GetOrCreateAsync(AssetId assetId, ThumbnailRecipe recipe,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<Stream>.Success(new MemoryStream()));

        public Task<Result<IReadOnlyList<AssetThumbnailStream>>> GetVisibleWindowAsync(
            IReadOnlyList<AssetId> orderedAssetIds, int firstVisibleIndex, int visibleCount,
            ThumbnailRecipe recipe, int maximumPrefetch = 4, CancellationToken cancellationToken = default)
        {
            var indexes = AssetThumbnailWindowPlanner.SelectIndexes(orderedAssetIds.Count, firstVisibleIndex,
                visibleCount, maximumPrefetch);
            RequestedIds.AddRange(indexes.Select(index => orderedAssetIds[index]));
            IReadOnlyList<AssetThumbnailStream> streams = indexes
                .Select(index => new AssetThumbnailStream(orderedAssetIds[index], new MemoryStream())).ToArray();
            return Task.FromResult(Result<IReadOnlyList<AssetThumbnailStream>>.Success(streams));
        }
    }
}
