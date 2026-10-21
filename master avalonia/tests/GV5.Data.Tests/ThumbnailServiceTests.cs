using System.Security.Cryptography;
using GV5.Application.Contracts;
using GV5.Assets.Decoding;
using GV5.Core.Identity;
using GV5.Data.Storage;
using GV5.Data.Thumbnails;
using SkiaSharp;
using Xunit;

namespace GV5.Data.Tests;

public sealed class ThumbnailServiceTests
{
    [Fact]
    public async Task GetOrCreateAsync_StoresVerifiedThumbnailAndReusesItAcrossRequests()
    {
        var root = NewTempRoot();
        var paths = new AppDataPaths(root);
        var store = new MemoryAssetStore(CreatePng());
        var service = new ThumbnailService(store, paths, new AssetImageDecoder());
        var recipe = ThumbnailRecipe.Create(8, 8, ThumbnailFitMode.Contain);

        try
        {
            var first = await service.GetOrCreateAsync(store.Id, recipe, TestContext.Current.CancellationToken);
            Assert.True(first.IsSuccess, first.Error?.Message);
            await using var firstStream = first.Value;
            var firstBytes = await ReadAllAsync(firstStream, TestContext.Current.CancellationToken);

            var second = await service.GetOrCreateAsync(store.Id, recipe, TestContext.Current.CancellationToken);
            Assert.True(second.IsSuccess, second.Error?.Message);
            await using var secondStream = second.Value;
            var secondBytes = await ReadAllAsync(secondStream, TestContext.Current.CancellationToken);

            Assert.Equal(firstBytes, secondBytes);
            Assert.Equal(1, store.OpenReadCount);
            using var decodedStream = new MemoryStream(secondBytes);
            var decoded = await new AssetImageDecoder().DecodeAsync(decodedStream, TestContext.Current.CancellationToken);
            Assert.True(decoded.IsSuccess, decoded.Error?.Message);
            using var image = decoded.Image!;
            Assert.Equal(8, image.Width);
            Assert.Equal(8, image.Height);
            Assert.True(image.HasAlpha);
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task GetOrCreateAsync_RecipeChangesCacheIdentityAndOutput()
    {
        var root = NewTempRoot();
        var paths = new AppDataPaths(root);
        var store = new MemoryAssetStore(CreatePng());
        var service = new ThumbnailService(store, paths, new AssetImageDecoder());

        try
        {
            var contained = await service.GetOrCreateAsync(store.Id, ThumbnailRecipe.Create(8, 8, ThumbnailFitMode.Contain), TestContext.Current.CancellationToken);
            var covered = await service.GetOrCreateAsync(store.Id, ThumbnailRecipe.Create(8, 8, ThumbnailFitMode.Cover), TestContext.Current.CancellationToken);
            Assert.True(contained.IsSuccess, contained.Error?.Message);
            Assert.True(covered.IsSuccess, covered.Error?.Message);
            await using var containedStream = contained.Value;
            await using var coveredStream = covered.Value;
            Assert.NotEqual(await ReadAllAsync(containedStream, TestContext.Current.CancellationToken), await ReadAllAsync(coveredStream, TestContext.Current.CancellationToken));
            Assert.Equal(2, store.OpenReadCount);
            Assert.Equal(4, Directory.GetFiles(paths.ThumbnailsDirectory, "*", SearchOption.AllDirectories).Length);
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task GetOrCreateAsync_CorruptDiskEntryIsRemovedAndRegenerated()
    {
        var root = NewTempRoot();
        var paths = new AppDataPaths(root);
        var store = new MemoryAssetStore(CreatePng());
        var service = new ThumbnailService(store, paths, new AssetImageDecoder());
        var recipe = ThumbnailRecipe.Create(8, 8);

        try
        {
            var first = await service.GetOrCreateAsync(store.Id, recipe, TestContext.Current.CancellationToken);
            Assert.True(first.IsSuccess, first.Error?.Message);
            await first.Value.DisposeAsync();
            var cachedFile = Assert.Single(Directory.GetFiles(paths.ThumbnailsDirectory, "*.png", SearchOption.AllDirectories));
            await File.WriteAllBytesAsync(cachedFile, [0x01, 0x02, 0x03], TestContext.Current.CancellationToken);

            var regenerated = await service.GetOrCreateAsync(store.Id, recipe, TestContext.Current.CancellationToken);
            Assert.True(regenerated.IsSuccess, regenerated.Error?.Message);
            await using var stream = regenerated.Value;
            var bytes = await ReadAllAsync(stream, TestContext.Current.CancellationToken);
            using var decodedStream = new MemoryStream(bytes);
            var decoded = await new AssetImageDecoder().DecodeAsync(decodedStream, TestContext.Current.CancellationToken);
            Assert.True(decoded.IsSuccess, decoded.Error?.Message);
            decoded.Image!.Dispose();
            Assert.Equal(2, store.OpenReadCount);
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task GetOrCreateAsync_ConcurrentRequestsShareOneGeneration()
    {
        var root = NewTempRoot();
        var paths = new AppDataPaths(root);
        var store = new MemoryAssetStore(CreatePng(), openDelay: TimeSpan.FromMilliseconds(25));
        var service = new ThumbnailService(store, paths, new AssetImageDecoder());
        var recipe = ThumbnailRecipe.Create(8, 8);

        try
        {
            var token = TestContext.Current.CancellationToken;
            var results = await Task.WhenAll(
                service.GetOrCreateAsync(store.Id, recipe, token),
                service.GetOrCreateAsync(store.Id, recipe, token));

            Assert.All(results, result => Assert.True(result.IsSuccess, result.Error?.Message));
            Assert.Equal(1, store.OpenReadCount);
            foreach (var result in results)
            {
                await result.Value.DisposeAsync();
            }
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task GetOrCreateAsync_PropagatesUnavailableSourceAndCancellation()
    {
        var root = NewTempRoot();
        var paths = new AppDataPaths(root);
        var missingStore = new MemoryAssetStore(CreatePng(), available: false);
        var service = new ThumbnailService(missingStore, paths, new AssetImageDecoder());
        var result = await service.GetOrCreateAsync(missingStore.Id, ThumbnailRecipe.Create(4, 4), TestContext.Current.CancellationToken);
        Assert.True(result.IsFailure);
        Assert.Equal(ApplicationErrorCode.Unavailable, result.Error!.Code);

        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.GetOrCreateAsync(missingStore.Id, ThumbnailRecipe.Create(4, 4), cancellation.Token));
        Assert.False(Directory.Exists(paths.ThumbnailsDirectory));
        DeleteTempRoot(root);
    }

    private static byte[] CreatePng()
    {
        using var bitmap = new SKBitmap(new SKImageInfo(16, 8, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        for (var y = 0; y < bitmap.Height; y++)
        for (var x = 0; x < bitmap.Width; x++)
        {
            bitmap.SetPixel(x, y, x < 8 ? new SKColor(250, 20, 30, 255) : new SKColor(20, 30, 240, 0));
        }

        using var data = bitmap.Encode(SKEncodedImageFormat.Png, 100);
        Assert.NotNull(data);
        return data!.ToArray();
    }

    private static async Task<byte[]> ReadAllAsync(Stream stream, CancellationToken cancellationToken)
    {
        using var copy = new MemoryStream();
        await stream.CopyToAsync(copy, cancellationToken);
        return copy.ToArray();
    }

    private static string NewTempRoot() => Path.Combine(Path.GetTempPath(), $"gv5-thumbnail-tests-{Guid.NewGuid():N}");

    private static void DeleteTempRoot(string root)
    {
        if (Directory.Exists(root))
        {
            Directory.Delete(root, recursive: true);
        }
    }

    private sealed class MemoryAssetStore(byte[] bytes, bool available = true, TimeSpan? openDelay = null) : IAssetStore
    {
        public AssetId Id { get; } = AssetId.New();
        public int OpenReadCount { get; private set; }
        private readonly string _hash = Convert.ToHexStringLower(SHA256.HashData(bytes));

        public Task<Result<AssetMetadata>> ImportAsync(Stream content, string mediaType, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<AssetMetadata>.Failure(new ApplicationError(ApplicationErrorCode.Unavailable, "The in-memory test store is read-only.")));

        public async Task<Result<Stream>> OpenReadAsync(AssetId assetId, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (assetId != Id || !available)
            {
                return Result<Stream>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "The test asset is not available."));
            }

            if (openDelay is { } delay)
            {
                await Task.Delay(delay, cancellationToken);
            }

            OpenReadCount++;
            return Result<Stream>.Success(new MemoryStream(bytes, writable: false));
        }

        public Task<Result<AssetMetadata>> GetMetadataAsync(AssetId assetId, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (assetId != Id)
            {
                return Task.FromResult(Result<AssetMetadata>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "The test asset does not exist.")));
            }

            var metadata = new AssetMetadata(Id, _hash, "image/png", bytes.LongLength,
                available ? AssetVerificationState.Available : AssetVerificationState.Missing, 0);
            return Task.FromResult(Result<AssetMetadata>.Success(metadata));
        }

        public Task<Result<Unit>> AddReferenceAsync(AssetId assetId, AssetReferenceKey reference, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<Unit>.Success(Unit.Value));

        public Task<Result<Unit>> ReleaseReferenceAsync(AssetReferenceKey reference, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<Unit>.Success(Unit.Value));
    }
}
