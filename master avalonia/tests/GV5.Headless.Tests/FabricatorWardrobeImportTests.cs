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

public sealed class FabricatorWardrobeImportTests
{
    [Fact]
    public async Task PrepareCropsTransparentMarginsAndOnlyPublishesApprovedPng()
    {
        var root = Path.Combine(Path.GetTempPath(), $"gv5-wardrobe-import-{Guid.NewGuid():N}");
        var bytes = CreatePng(bitmap =>
        {
            bitmap.Erase(SKColors.Transparent);
            for (var y = 3; y <= 6; y++)
            for (var x = 5; x <= 9; x++) bitmap.SetPixel(x, y, new SKColor(210, 40, 80, 180));
        });
        var service = CreateService(root);
        var store = new RecordingAssetStore();

        try
        {
            var prepared = await service.PrepareAsync(new MemoryStream(bytes), "image/png", transparentMargin: 1,
                TestContext.Current.CancellationToken);

            Assert.True(prepared.IsSuccess, prepared.Error?.Message);
            await using var preview = prepared.Value;
            Assert.Equal(new ImageCropBounds(4, 2, 7, 6), preview.SourceBounds);
            Assert.Equal(7, preview.Width);
            Assert.Equal(6, preview.Height);
            Assert.Equal(SKColorType.Rgba8888, preview.Image.Bitmap.ColorType);
            Assert.Equal((byte)0, preview.Image.Bitmap.GetPixel(0, 0).Alpha);
            Assert.Equal((byte)180, preview.Image.Bitmap.GetPixel(1, 1).Alpha);
            Assert.Equal(0, store.ImportCount);

            var published = await service.PublishAsync(preview, store, TestContext.Current.CancellationToken);

            Assert.True(published.IsSuccess, published.Error?.Message);
            Assert.Equal(1, store.ImportCount);
            Assert.True(preview.IsPublished);
            Assert.Equal("image/png", published.Value.MediaType);
            Assert.Equal(preview.Sha256, published.Value.Sha256);
            Assert.Equal(preview.ByteLength, published.Value.ByteLength);
            var duplicate = await service.PublishAsync(preview, store, TestContext.Current.CancellationToken);
            Assert.True(duplicate.IsFailure);
            Assert.Equal(1, store.ImportCount);

            using var stored = await DecodeAsync(store.Bytes.Single());
            Assert.Equal(7, stored.Width);
            Assert.Equal(6, stored.Height);
            Assert.Equal((byte)0, stored.Bitmap.GetPixel(0, 0).Alpha);
            Assert.Equal((byte)180, stored.Bitmap.GetPixel(1, 1).Alpha);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task PrepareRejectsAnAllTransparentImageWithoutPublishingAnAsset()
    {
        var root = Path.Combine(Path.GetTempPath(), $"gv5-wardrobe-import-{Guid.NewGuid():N}");
        var bytes = CreatePng(bitmap => bitmap.Erase(SKColors.Transparent));
        var store = new RecordingAssetStore();

        try
        {
            var result = await CreateService(root).PrepareAsync(new MemoryStream(bytes), "image/png",
                cancellationToken: TestContext.Current.CancellationToken);
            Assert.True(result.IsFailure);
            Assert.Equal(ApplicationErrorCode.Validation, result.Error!.Code);
            Assert.Equal(0, store.ImportCount);
            Assert.Empty(Directory.GetFiles(root, "*.stage", SearchOption.AllDirectories));
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    private static WardrobeComponentImportService CreateService(string root) => new(
        new AssetImportStager(Path.Combine(root, "staging"), new AssetImportLimits(8 * 1024 * 1024, 8192, 32_000_000)),
        new AssetImageDecoder(new AssetImageDecodeLimits(8192, 32_000_000, 128L * 1024 * 1024)),
        new TransparentImageCropProcessor());

    private static byte[] CreatePng(Action<SKBitmap> paint)
    {
        using var bitmap = new SKBitmap(new SKImageInfo(20, 12, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        paint(bitmap);
        using var image = bitmap.Encode(SKEncodedImageFormat.Png, 100);
        return image!.ToArray();
    }

    private static async Task<DecodedAssetImage> DecodeAsync(byte[] bytes)
    {
        using var stream = new MemoryStream(bytes, writable: false);
        var result = await new AssetImageDecoder().DecodeAsync(stream, TestContext.Current.CancellationToken);
        Assert.True(result.IsSuccess, result.Error?.Message);
        return result.Image!;
    }

    private sealed class RecordingAssetStore : IAssetStore
    {
        private readonly Dictionary<AssetId, byte[]> _assets = [];
        public int ImportCount { get; private set; }
        public IReadOnlyCollection<byte[]> Bytes => _assets.Values;

        public async Task<Result<AssetMetadata>> ImportAsync(Stream content, string mediaType, CancellationToken cancellationToken = default)
        {
            ImportCount++;
            using var output = new MemoryStream();
            await content.CopyToAsync(output, cancellationToken);
            var bytes = output.ToArray();
            var id = AssetId.New();
            _assets.Add(id, bytes);
            return Result<AssetMetadata>.Success(new AssetMetadata(id,
                Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), mediaType, bytes.LongLength,
                AssetVerificationState.Available, 1));
        }

        public Task<Result<Stream>> OpenReadAsync(AssetId assetId, CancellationToken cancellationToken = default) =>
            Task.FromResult(_assets.TryGetValue(assetId, out var bytes)
                ? Result<Stream>.Success(new MemoryStream(bytes, writable: false))
                : Result<Stream>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Asset not found.")));
        public Task<Result<AssetMetadata>> GetMetadataAsync(AssetId assetId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<AssetMetadata>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Asset not found.")));
        public Task<Result<Unit>> AddReferenceAsync(AssetId assetId, AssetReferenceKey reference, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<Unit>.Success(Unit.Value));
        public Task<Result<Unit>> ReleaseReferenceAsync(AssetReferenceKey reference, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<Unit>.Success(Unit.Value));
    }
}
