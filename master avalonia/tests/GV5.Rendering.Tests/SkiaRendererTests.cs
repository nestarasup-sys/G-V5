using System.Security.Cryptography;
using GV5.Assets.Decoding;
using GV5.Core.Identity;
using GV5.Geometry;
using GV5.Rendering;
using SkiaSharp;
using Xunit;

namespace GV5.Rendering.Tests;

public sealed class SkiaRendererTests
{
    [Fact]
    public async Task RenderAsyncProducesTransparentCpuBitmapAndReleasesAssetLease()
    {
        using var assets = new TestRenderAssetProvider(CreateFourColorPng());
        var renderer = new SkiaRenderer(assets);
        var scene = Scene([Layer(new Rect2D(0, 0, 2, 2))]);

        var frame = await renderer.RenderAsync(scene, TestContext.Current.CancellationToken);

        Assert.Equal(8, frame.Width);
        Assert.Equal(8, frame.Height);
        Assert.Equal(0, frame.Bitmap.GetPixel(0, 0).Alpha);
        Assert.Equal(SKColors.Red, frame.Bitmap.GetPixel(0, 6));
        Assert.Equal(SKColors.Green, frame.Bitmap.GetPixel(1, 6));
        Assert.Equal(SKColors.Blue, frame.Bitmap.GetPixel(0, 7));
        Assert.Equal(SKColors.Yellow, frame.Bitmap.GetPixel(1, 7));
        Assert.Equal(0, assets.Cache.Metrics.ActiveLeaseCount);

        frame.Dispose();
        Assert.Throws<ObjectDisposedException>(() => _ = frame.Bitmap);
    }

    [Fact]
    public async Task RenderAsyncHandlesEmptySceneAndAppliesSourceCrop()
    {
        using var assets = new TestRenderAssetProvider(CreateFourColorPng());
        var renderer = new SkiaRenderer(assets);
        using var blank = await renderer.RenderAsync(Scene([]), TestContext.Current.CancellationToken);
        Assert.Equal(0, blank.Bitmap.GetPixel(4, 4).Alpha);

        using var cropped = await renderer.RenderAsync(
            Scene([Layer(new Rect2D(1, 1, 1, 1))]),
            TestContext.Current.CancellationToken);
        Assert.Equal(0, cropped.Bitmap.GetPixel(0, 6).Alpha);
        Assert.Equal(SKColors.Yellow, cropped.Bitmap.GetPixel(0, 7));
    }

    [Fact]
    public async Task RenderAsyncRejectsTargetsBeyondTheConfiguredBudgetAndHonorsCancellation()
    {
        using var assets = new TestRenderAssetProvider(CreateFourColorPng());
        var renderer = new SkiaRenderer(assets, new SkiaRendererLimits(maximumDimension: 8, maximumPixels: 64));

        Assert.Throws<ArgumentOutOfRangeException>(() => { _ = renderer.RenderAsync(Scene([], width: 9), TestContext.Current.CancellationToken); });
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => renderer.RenderAsync(Scene([]), cancellation.Token));
    }

    private static RenderScene Scene(IEnumerable<RenderLayer> layers, int width = 8) => new(SceneId.New(), width, 8, layers);

    private static RenderLayer Layer(Rect2D crop) => new(
        RenderLayerId.New(),
        AssetId.New(),
        crop,
        Transform2D.Identity,
        1,
        RenderBlendMode.Normal,
        0);

    private static byte[] CreateFourColorPng()
    {
        using var bitmap = new SKBitmap(new SKImageInfo(2, 2, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        bitmap.SetPixel(0, 0, SKColors.Red);
        bitmap.SetPixel(1, 0, SKColors.Green);
        bitmap.SetPixel(0, 1, SKColors.Blue);
        bitmap.SetPixel(1, 1, SKColors.Yellow);
        using var image = SKImage.FromBitmap(bitmap);
        using var encoded = image.Encode(SKEncodedImageFormat.Png, 100);
        Assert.NotNull(encoded);
        return encoded!.ToArray();
    }

    private sealed class TestRenderAssetProvider : IRenderAssetProvider, IDisposable
    {
        private readonly byte[] _png;
        private readonly AssetImageCacheKey _key;

        public AssetBitmapCache Cache { get; } = new(1024 * 1024);

        public TestRenderAssetProvider(byte[] png)
        {
            _png = png;
            _key = AssetImageCacheKey.Create(Convert.ToHexString(SHA256.HashData(png)).ToLowerInvariant(), decoderVersion: 1);
        }

        public async Task<AssetImageLease> AcquireAsync(AssetId assetId, CancellationToken cancellationToken = default)
        {
            Assert.True(assetId.IsValid);
            var result = await Cache.AcquireAsync(_key, DecodeAsync, cancellationToken);
            Assert.True(result.IsSuccess, result.Error?.Message);
            return result.Lease!;
        }

        public void Dispose() => Cache.Dispose();

        private async Task<AssetImageDecodeResult> DecodeAsync(CancellationToken cancellationToken)
        {
            await using var stream = new MemoryStream(_png, writable: false);
            return await new AssetImageDecoder().DecodeAsync(stream, cancellationToken);
        }
    }
}
