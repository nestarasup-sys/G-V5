using System.Security.Cryptography;
using GV5.Application.Contracts;
using GV5.Assets.Decoding;
using GV5.Assets.Import;
using GV5.Assets.Processing;
using GV5.Core.Identity;
using GV5.Modules.Fabricador.Import;
using SkiaSharp;
using Xunit;

namespace GV5.Headless.Tests;

public sealed class FabricatorModelSourceImportTests
{
    [Fact]
    public async Task PrepareCreatesDecodedPreviewWithoutPublishingUntilConfirmed()
    {
        var root = NewTempRoot();
        var bytes = CreatePng(7, 5);
        var service = CreateService(CreateStager(root));
        var store = new RecordingAssetStore();

        try
        {
            var prepared = await service.PrepareAsync(new MemoryStream(bytes), "image/png", TestContext.Current.CancellationToken);

            Assert.True(prepared.IsSuccess);
            await using var preview = prepared.Value;
            Assert.Equal(7, preview.Width);
            Assert.Equal(5, preview.Height);
            Assert.Equal("image/png", preview.MediaType);
            Assert.Equal(bytes.LongLength, preview.ByteLength);
            Assert.Equal(Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), preview.Sha256);
            Assert.Equal(SKColorType.Rgba8888, preview.Image.Bitmap.ColorType);
            Assert.Equal(0, store.ImportCount);
            Assert.Single(Directory.GetFiles(root));

            var published = await service.PublishAsync(preview, store, TestContext.Current.CancellationToken);

            Assert.True(published.IsSuccess, published.Error?.Message);
            Assert.Equal(1, store.ImportCount);
            Assert.Equal(preview.Sha256, published.Value.Sha256);
            Assert.Equal("image/png", published.Value.MediaType);
            Assert.Equal(bytes.LongLength, published.Value.ByteLength);
            Assert.True(preview.IsPublished);
            Assert.Equal(published.Value.Id, preview.PublishedAssetId);
            Assert.Empty(Directory.GetFiles(root));

            var repeatedPublish = await service.PublishAsync(preview, store, TestContext.Current.CancellationToken);
            Assert.True(repeatedPublish.IsFailure);
            Assert.Equal(ApplicationErrorCode.Conflict, repeatedPublish.Error!.Code);
            Assert.Equal(1, store.ImportCount);
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task InvalidImageFailsBeforePublicationAndRemovesItsStageFile()
    {
        var root = NewTempRoot();
        var service = CreateService(CreateStager(root));
        var store = new RecordingAssetStore();

        try
        {
            var result = await service.PrepareAsync(new MemoryStream([1, 2, 3, 4]), "image/png", TestContext.Current.CancellationToken);

            Assert.True(result.IsFailure);
            Assert.Equal(ApplicationErrorCode.Validation, result.Error!.Code);
            Assert.Equal(0, store.ImportCount);
            Assert.Empty(Directory.GetFiles(root));
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task PublishFailureKeepsPreviewAvailableForRetryAndCancellationDoesNotPublish()
    {
        var root = NewTempRoot();
        var service = CreateService(CreateStager(root));
        var bytes = CreatePng(4, 4);

        try
        {
            var prepared = await service.PrepareAsync(new MemoryStream(bytes), "image/png", TestContext.Current.CancellationToken);
            Assert.True(prepared.IsSuccess);
            await using var preview = prepared.Value;
            var failingStore = new RecordingAssetStore { FailImport = true };
            var failed = await service.PublishAsync(preview, failingStore, TestContext.Current.CancellationToken);
            Assert.True(failed.IsFailure);
            Assert.False(preview.IsPublished);
            Assert.Equal(4, preview.Image.Width);
            Assert.Single(Directory.GetFiles(root));

            using var cancellation = new CancellationTokenSource();
            cancellation.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.PublishAsync(preview, new RecordingAssetStore(), cancellation.Token));
            Assert.False(preview.IsPublished);
            Assert.Single(Directory.GetFiles(root));
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task PrepareEnforcesFabricatorFileAndPixelLimitsBeforePreview()
    {
        var root = NewTempRoot();
        var sizeStager = new AssetImportStager(root, new AssetImportLimits(MaximumBytes: 64, MaximumDimension: 128, MaximumPixels: 32_000_000));
        var service = CreateService(sizeStager);
        var bytes = CreatePng(8, 8);

        try
        {
            var sizeFailure = await service.PrepareAsync(new MemoryStream(bytes), "image/png", TestContext.Current.CancellationToken);
            Assert.True(sizeFailure.IsFailure);
            Assert.Empty(Directory.GetFiles(root));

            var pixelLimitedService = CreateService(
                new AssetImportStager(root, new AssetImportLimits(MaximumBytes: 50 * 1024 * 1024, MaximumDimension: 128, MaximumPixels: 32)));
            var pixelFailure = await pixelLimitedService.PrepareAsync(new MemoryStream(bytes), "image/png", TestContext.Current.CancellationToken);
            Assert.True(pixelFailure.IsFailure);
            Assert.Empty(Directory.GetFiles(root));
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task PrepareBoundsPreviewSizeWhileRetainingOriginalForPublishing()
    {
        var root = NewTempRoot();
        var bytes = CreatePng(2000, 1000);
        var service = CreateService(CreateStager(root));
        var store = new RecordingAssetStore();

        try
        {
            var prepared = await service.PrepareAsync(new MemoryStream(bytes), "image/png", TestContext.Current.CancellationToken);
            Assert.True(prepared.IsSuccess);
            await using var preview = prepared.Value;

            Assert.Equal(2000, preview.Width);
            Assert.Equal(1000, preview.Height);
            Assert.Equal(1280, preview.PreviewWidth);
            Assert.Equal(640, preview.PreviewHeight);

            var published = await service.PublishAsync(preview, store, TestContext.Current.CancellationToken);
            Assert.True(published.IsSuccess, published.Error?.Message);
            Assert.Equal(bytes.LongLength, published.Value.ByteLength);
            Assert.Equal(Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), published.Value.Sha256);
            Assert.Equal(1, store.ImportCount);
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task ConfirmedSourceIsSplitIntoSortedLegacyCompatiblePngAssets()
    {
        var root = NewTempRoot();
        var service = CreateService(CreateStager(root));
        var store = new RecordingAssetStore();
        var bytes = CreateModelSheetPng();

        try
        {
            var prepared = await service.PrepareAsync(new MemoryStream(bytes), "image/png", TestContext.Current.CancellationToken);
            Assert.True(prepared.IsSuccess, prepared.Error?.Message);
            await using var preview = prepared.Value;
            var source = await service.PublishAsync(preview, store, TestContext.Current.CancellationToken);
            Assert.True(source.IsSuccess, source.Error?.Message);

            var parts = await service.ImportSeparatedPartsAsync(preview, store, TestContext.Current.CancellationToken);

            Assert.True(parts.IsSuccess, parts.Error?.Message);
            Assert.Equal(2, parts.Value.Count);
            Assert.Equal(["Cabeça", "Coxa direita"], parts.Value.Select(part => part.Name));
            Assert.Equal(new ImageCropBounds(6, 4, 18, 18), parts.Value[0].SourceBounds);
            Assert.Equal(new ImageCropBounds(34, 21, 18, 18), parts.Value[1].SourceBounds);
            Assert.All(parts.Value, part => Assert.Equal("image/png", part.Asset.MediaType));
            await AssertPngPixelsAsync(store, parts.Value[0].Asset.Id, new SKColor(240, 30, 30), TestContext.Current.CancellationToken);
            await AssertPngPixelsAsync(store, parts.Value[1].Asset.Id, new SKColor(30, 30, 240), TestContext.Current.CancellationToken);
            Assert.Equal(3, store.ImportCount);
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task SegmentedPngRetainsFeatheredChromaEdgeColorAndAlpha()
    {
        var root = NewTempRoot();
        var service = CreateService(CreateStager(root));
        var store = new RecordingAssetStore();

        try
        {
            var prepared = await service.PrepareAsync(new MemoryStream(CreateFeatheredModelSheetPng()), "image/png", TestContext.Current.CancellationToken);
            Assert.True(prepared.IsSuccess, prepared.Error?.Message);
            await using var preview = prepared.Value;
            var source = await service.PublishAsync(preview, store, TestContext.Current.CancellationToken);
            Assert.True(source.IsSuccess, source.Error?.Message);

            var separated = await service.ImportSeparatedPartsAsync(preview, store, TestContext.Current.CancellationToken);
            Assert.True(separated.IsSuccess, separated.Error?.Message);
            var part = Assert.Single(separated.Value);
            Assert.Equal(new ImageCropBounds(5, 4, 19, 18), part.SourceBounds);

            var asset = await store.OpenReadAsync(part.Asset.Id, TestContext.Current.CancellationToken);
            Assert.True(asset.IsSuccess, asset.Error?.Message);
            await using var stream = asset.Value;
            using var bitmap = SKBitmap.Decode(stream);
            Assert.NotNull(bitmap);
            Assert.Equal(19, bitmap.Width);
            Assert.Equal(18, bitmap.Height);
            Assert.Equal(new SKColor(157, 98, 20, 117), bitmap.GetPixel(4, 4));
            Assert.Equal(new SKColor(240, 30, 30, 255), bitmap.GetPixel(5, 4));
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    private static AssetImportStager CreateStager(string root) => new(
        root,
        new AssetImportLimits(MaximumBytes: 50L * 1024 * 1024, MaximumDimension: 16_384, MaximumPixels: 32_000_000));

    private static ModelSourceImportService CreateService(AssetImportStager stager) =>
        new(stager, new AssetImageDecoder(), new ModelSheetSegmentationProcessor(new ChromaCropProcessor()));

    private static byte[] CreatePng(int width, int height)
    {
        using var bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        for (var y = 0; y < height; y++)
        for (var x = 0; x < width; x++)
        {
            bitmap.SetPixel(x, y, new SKColor((byte)(x * 21), (byte)(y * 31), 90, (byte)255));
        }

        using var image = SKImage.FromBitmap(bitmap);
        using var encoded = image.Encode(SKEncodedImageFormat.Png, 100);
        return encoded.ToArray();
    }

    private static byte[] CreateModelSheetPng()
    {
        using var bitmap = new SKBitmap(new SKImageInfo(64, 48, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        bitmap.Erase(new SKColor(0, 230, 0, 255));
        for (var y = 8; y < 18; y++)
        for (var x = 10; x < 20; x++) bitmap.SetPixel(x, y, new SKColor(240, 30, 30, 255));
        for (var y = 25; y < 35; y++)
        for (var x = 38; x < 48; x++) bitmap.SetPixel(x, y, new SKColor(30, 30, 240, 255));
        using var image = SKImage.FromBitmap(bitmap);
        using var encoded = image.Encode(SKEncodedImageFormat.Png, 100);
        return encoded!.ToArray();
    }

    private static byte[] CreateFeatheredModelSheetPng()
    {
        using var bitmap = new SKBitmap(new SKImageInfo(64, 48, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        bitmap.Erase(new SKColor(0, 230, 0, 255));
        for (var y = 8; y < 18; y++)
        for (var x = 10; x < 20; x++) bitmap.SetPixel(x, y, new SKColor(240, 30, 30, 255));
        bitmap.SetPixel(9, 8, new SKColor(72, 170, 9, 255));
        using var image = SKImage.FromBitmap(bitmap);
        using var encoded = image.Encode(SKEncodedImageFormat.Png, 100);
        return encoded!.ToArray();
    }

    private static async Task AssertPngPixelsAsync(RecordingAssetStore store, AssetId assetId, SKColor foreground, CancellationToken cancellationToken)
    {
        var asset = await store.OpenReadAsync(assetId, cancellationToken);
        Assert.True(asset.IsSuccess, asset.Error?.Message);
        await using var stream = asset.Value;
        using var bitmap = SKBitmap.Decode(stream);
        Assert.NotNull(bitmap);
        Assert.Equal(18, bitmap.Width);
        Assert.Equal(18, bitmap.Height);

        for (var y = 0; y < bitmap.Height; y++)
        for (var x = 0; x < bitmap.Width; x++)
        {
            var actual = bitmap.GetPixel(x, y);
            if (x is >= 4 and < 14 && y is >= 4 and < 14)
            {
                Assert.Equal(foreground, actual);
            }
            else
            {
                Assert.Equal((byte)0, actual.Alpha);
            }
        }
    }

    private static string NewTempRoot() => Path.Combine(Path.GetTempPath(), $"gv5-fabricator-import-{Guid.NewGuid():N}");

    private static void DeleteTempRoot(string root)
    {
        if (Directory.Exists(root))
        {
            Directory.Delete(root, recursive: true);
        }
    }

    private sealed class RecordingAssetStore : IAssetStore
    {
        private readonly Dictionary<AssetId, byte[]> _assets = [];
        public int ImportCount { get; private set; }
        public bool FailImport { get; init; }

        public async Task<Result<AssetMetadata>> ImportAsync(Stream content, string mediaType, CancellationToken cancellationToken = default)
        {
            ImportCount++;
            if (FailImport)
            {
                return Result<AssetMetadata>.Failure(new ApplicationError(ApplicationErrorCode.Persistence, "Synthetic store failure."));
            }

            using var memory = new MemoryStream();
            await content.CopyToAsync(memory, cancellationToken);
            var bytes = memory.ToArray();
            var assetId = AssetId.New();
            _assets.Add(assetId, bytes);
            return Result<AssetMetadata>.Success(new AssetMetadata(
                assetId,
                Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
                mediaType,
                bytes.LongLength,
                AssetVerificationState.Available,
                123));
        }

        public Task<Result<Stream>> OpenReadAsync(AssetId assetId, CancellationToken cancellationToken = default) =>
            Task.FromResult(_assets.TryGetValue(assetId, out var bytes)
                ? Result<Stream>.Success(new MemoryStream(bytes, writable: false))
                : Result<Stream>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Not found.")));

        public Task<Result<AssetMetadata>> GetMetadataAsync(AssetId assetId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<AssetMetadata>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Not found.")));

        public Task<Result<Unit>> AddReferenceAsync(AssetId assetId, AssetReferenceKey reference, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<Unit>.Success(Unit.Value));

        public Task<Result<Unit>> ReleaseReferenceAsync(AssetReferenceKey reference, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<Unit>.Success(Unit.Value));
    }
}
