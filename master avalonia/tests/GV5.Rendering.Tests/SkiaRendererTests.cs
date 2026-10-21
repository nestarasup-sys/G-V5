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
    public async Task RenderAsyncMatchesTransparentSyntheticGarmentGoldenPixelForPixel()
    {
        var fixtureDirectory = Path.Combine(AppContext.BaseDirectory, "Fixtures", "rendering");
        var sourcePath = Path.Combine(fixtureDirectory, "synthetic-garment.png");
        var goldenPath = Path.Combine(fixtureDirectory, "synthetic-garment.golden.png");
        var sourceBytes = await File.ReadAllBytesAsync(sourcePath, TestContext.Current.CancellationToken);
        using var assets = new TestRenderAssetProvider(sourceBytes);
        using var golden = SKBitmap.Decode(goldenPath)
            ?? throw new InvalidDataException($"Could not decode renderer golden: {goldenPath}");

        var transform = new Transform2D(new Point2D(10, 8), new Point2D(1, 1), 0, Point2D.Zero);
        var scene = Scene([Layer(new Rect2D(0, 0, 12, 16), transform)], width: 32, height: 32);
        using var actual = await new SkiaRenderer(assets).RenderAsync(scene, TestContext.Current.CancellationToken);

        Assert.Equal(32, golden.Width);
        Assert.Equal(32, golden.Height);
        Assert.Equal(golden.Width, actual.Width);
        Assert.Equal(golden.Height, actual.Height);
        for (var y = 0; y < golden.Height; y++)
        {
            for (var x = 0; x < golden.Width; x++)
            {
                Assert.True(
                    golden.GetPixel(x, y) == actual.Bitmap.GetPixel(x, y),
                    $"Pixel mismatch at ({x},{y}): expected {golden.GetPixel(x, y)}, actual {actual.Bitmap.GetPixel(x, y)}.");
            }
        }

        Assert.Equal(0, assets.Cache.Metrics.ActiveLeaseCount);
    }

    [Fact]
    public async Task RenderAsyncComposesCroppedRotatedFlippedAndTranslucentLayersAndWritesPngComparison()
    {
        using var assets = new TestRenderAssetProvider(CreateFourColorPng());
        var twoByTwo = new Rect2D(0, 0, 2, 2);
        var center = new Point2D(1, 1);
        var baseline = new Transform2D(new Point2D(3, 3), new Point2D(1, 1), 0, Point2D.Zero);
        var flip = new Transform2D(new Point2D(3, 3), new Point2D(1, 1), 0, center, flipX: true);
        var croppedRotateFlip = new Transform2D(
            new Point2D(10.5, 3.5),
            new Point2D(1, 1),
            Math.PI / 2,
            new Point2D(0.5, 1),
            flipY: true);
        var scene = Scene(
        [
            Layer(twoByTwo, baseline, alpha: 1, zOrder: 0),
            Layer(twoByTwo, flip, alpha: 0.5, zOrder: 1),
            Layer(new Rect2D(0, 0, 1, 2), croppedRotateFlip, alpha: 0.75, zOrder: 2)
        ], width: 32, height: 32);
        using var expected = SKBitmap.Decode(Path.Combine(AppContext.BaseDirectory, "Fixtures", "rendering", "multi-layer.golden.png"))
            ?? throw new InvalidDataException("Could not decode multi-layer renderer golden.");
        using var actual = await new SkiaRenderer(assets).RenderAsync(scene, TestContext.Current.CancellationToken);
        var comparisonPath = Path.Combine(AppContext.BaseDirectory, "TestResults", "Rendering", "multi-layer-comparison.png");
        var comparison = PngGoldenComparer.Compare(expected, actual.Bitmap, comparisonPath);

        Assert.Equal(0, comparison.DifferentPixels);
        Assert.Equal(0, comparison.MeanAbsoluteChannelError);
        Assert.True(File.Exists(comparison.ComparisonPngPath));
        Assert.True(new FileInfo(comparison.ComparisonPngPath).Length > 0);
        using var comparisonArtifact = SKBitmap.Decode(comparison.ComparisonPngPath)
            ?? throw new InvalidDataException("Could not decode generated PNG comparison artifact.");
        Assert.Equal(96, comparisonArtifact.Width);
        Assert.Equal(32, comparisonArtifact.Height);
        Assert.Equal(0, assets.Cache.Metrics.ActiveLeaseCount);
    }

    [Fact]
    public void PngGoldenComparerReportsAndHighlightsAnActualPixelDifference()
    {
        using var expected = new SKBitmap(new SKImageInfo(2, 2, SKColorType.Rgba8888, SKAlphaType.Premul));
        using var actual = new SKBitmap(new SKImageInfo(2, 2, SKColorType.Rgba8888, SKAlphaType.Premul));
        expected.Erase(SKColors.Transparent);
        actual.Erase(SKColors.Transparent);
        actual.SetPixel(0, 0, SKColors.Red);
        var output = Path.Combine(AppContext.BaseDirectory, "TestResults", "Rendering", "known-difference.png");

        var comparison = PngGoldenComparer.Compare(expected, actual, output);

        Assert.Equal(1, comparison.DifferentPixels);
        Assert.True(comparison.MeanAbsoluteChannelError > 0);
        using var artifact = SKBitmap.Decode(output)
            ?? throw new InvalidDataException("Could not decode generated difference artifact.");
        Assert.Equal(6, artifact.Width);
        Assert.Equal(2, artifact.Height);
        Assert.Equal(new SKColor(255, 0, 0, 255), artifact.GetPixel(4, 0));
        Assert.Equal(SKColors.Black, artifact.GetPixel(5, 1));
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

    private static RenderScene Scene(IEnumerable<RenderLayer> layers, int width = 8, int height = 8) => new(SceneId.New(), width, height, layers);

    private static RenderLayer Layer(Rect2D crop, Transform2D? transform = null, double alpha = 1, int zOrder = 0) => new(
        RenderLayerId.New(),
        AssetId.New(),
        crop,
        transform ?? Transform2D.Identity,
        alpha,
        RenderBlendMode.Normal,
        zOrder);

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
