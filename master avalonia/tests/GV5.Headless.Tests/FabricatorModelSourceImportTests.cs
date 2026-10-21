using System.Security.Cryptography;
using GV5.Application.Contracts;
using GV5.Assets.Decoding;
using GV5.Assets.Import;
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
        var service = new ModelSourceImportService(CreateStager(root), new AssetImageDecoder());
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
        var service = new ModelSourceImportService(CreateStager(root), new AssetImageDecoder());
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
        var service = new ModelSourceImportService(CreateStager(root), new AssetImageDecoder());
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
        var service = new ModelSourceImportService(sizeStager, new AssetImageDecoder());
        var bytes = CreatePng(8, 8);

        try
        {
            var sizeFailure = await service.PrepareAsync(new MemoryStream(bytes), "image/png", TestContext.Current.CancellationToken);
            Assert.True(sizeFailure.IsFailure);
            Assert.Empty(Directory.GetFiles(root));

            var pixelLimitedService = new ModelSourceImportService(
                new AssetImportStager(root, new AssetImportLimits(MaximumBytes: 50 * 1024 * 1024, MaximumDimension: 128, MaximumPixels: 32)),
                new AssetImageDecoder());
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
        var service = new ModelSourceImportService(CreateStager(root), new AssetImageDecoder());
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

    private static AssetImportStager CreateStager(string root) => new(
        root,
        new AssetImportLimits(MaximumBytes: 50L * 1024 * 1024, MaximumDimension: 16_384, MaximumPixels: 32_000_000));

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
            return Result<AssetMetadata>.Success(new AssetMetadata(
                AssetId.New(),
                Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
                mediaType,
                bytes.LongLength,
                AssetVerificationState.Available,
                123));
        }

        public Task<Result<Stream>> OpenReadAsync(AssetId assetId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<Stream>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Not found.")));

        public Task<Result<AssetMetadata>> GetMetadataAsync(AssetId assetId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<AssetMetadata>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Not found.")));

        public Task<Result<Unit>> AddReferenceAsync(AssetId assetId, AssetReferenceKey reference, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<Unit>.Success(Unit.Value));

        public Task<Result<Unit>> ReleaseReferenceAsync(AssetReferenceKey reference, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<Unit>.Success(Unit.Value));
    }
}
