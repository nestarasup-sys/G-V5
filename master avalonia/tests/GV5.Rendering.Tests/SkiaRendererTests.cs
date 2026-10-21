using System.Security.Cryptography;
using GV5.Assets.Decoding;
using GV5.Core.Identity;
using GV5.Core.Models;
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
    public async Task ModelDraftPreviewPngMatchesLegacySourceCanvasForUnseparatedModel()
    {
        var sourceAssetId = AssetId.New();
        using var assets = new TestRenderAssetProvider(CreateFourColorPng());
        var content = ModelDraftContent.CreateEmpty(ModelId.New(), Revision.Initial)
            .WithSource(sourceAssetId, 2, 2);
        var scene = ModelDraftRenderSceneBuilder.Build(content);
        using var actual = await new SkiaRenderer(assets).RenderAsync(scene, TestContext.Current.CancellationToken);

        // Legacy canvas displays the original source at its native dimensions and origin before separation.
        Assert.Equal(2, actual.Width);
        Assert.Equal(2, actual.Height);
        Assert.Equal(SKColors.Red, actual.Bitmap.GetPixel(0, 0));
        Assert.Equal(SKColors.Green, actual.Bitmap.GetPixel(1, 0));
        Assert.Equal(SKColors.Blue, actual.Bitmap.GetPixel(0, 1));
        Assert.Equal(SKColors.Yellow, actual.Bitmap.GetPixel(1, 1));
        Assert.Equal(0, assets.Cache.Metrics.ActiveLeaseCount);
    }

    [Fact]
    public async Task BodySceneBuilderAndSkiaRenderer_RenderFirstSyntheticCharacter()
    {
        using var assets = new TestRenderAssetProvider(CreateCharacterPalettePng());
        var assetId = AssetId.New();
        BodyPartRenderSource Part(string id, double x, double y, double width, double height, Rect2D crop) => new(
            id,
            RenderLayerId.New(),
            assetId,
            crop,
            new Transform2D(new Point2D(x, y), new Point2D(width, height), 0, Point2D.Zero));

        var characterParts = new[]
        {
            Part("torso", 28, 21, 8, 16, new Rect2D(5, 1, 2, 2)),
            Part("head", 26, 38, 12, 12, new Rect2D(1, 1, 2, 2)),
            Part("arm-left", 20, 22, 4, 16, new Rect2D(1, 5, 2, 2)),
            Part("arm-right", 40, 22, 4, 16, new Rect2D(1, 5, 2, 2)),
            Part("leg-left", 28, 7, 4, 14, new Rect2D(5, 5, 2, 2)),
            Part("leg-right", 32, 7, 4, 14, new Rect2D(5, 5, 2, 2))
        };
        var layerOrder = new[] { "leg-left", "leg-right", "arm-left", "arm-right", "torso", "head" };
        var scene = BodyRenderSceneBuilder.Build(SceneId.New(), 64, 64, characterParts, layerOrder);

        Assert.Equal(layerOrder, scene.Layers.Select(layer => characterParts.Single(part => part.LayerId == layer.Id).PartId));
        using var frame = await new SkiaRenderer(assets).RenderAsync(scene, TestContext.Current.CancellationToken);

        var coloredPixelCount = 0;
        var seenRed = false;
        var seenGreen = false;
        var seenBlue = false;
        var seenYellow = false;
        for (var y = 0; y < frame.Height; y++)
        for (var x = 0; x < frame.Width; x++)
        {
            var pixel = frame.Bitmap.GetPixel(x, y);
            if (pixel.Alpha == 0)
            {
                continue;
            }

            coloredPixelCount++;
            seenRed |= pixel.Red > 240 && pixel.Green < 15 && pixel.Blue < 15;
            seenGreen |= pixel.Red < 15 && pixel.Green > 100 && pixel.Blue < 15;
            seenBlue |= pixel.Red < 15 && pixel.Green < 15 && pixel.Blue > 240;
            seenYellow |= pixel.Red > 240 && pixel.Green > 240 && pixel.Blue < 15;
        }

        Assert.True(coloredPixelCount > 400, $"Expected a visible six-part synthetic character, but only {coloredPixelCount} pixels were opaque.");
        Assert.True(seenRed && seenGreen && seenBlue && seenYellow, "Expected head, torso, arms, and legs to contribute their synthetic source colors.");
        Assert.Equal(0, assets.Cache.Metrics.ActiveLeaseCount);
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
    public async Task IncrementalRenderer_Matches_Full_Render_And_Invalidates_Only_Changed_Layer_Signature()
    {
        using var assets = new TestRenderAssetProvider(CreateFourColorPng());
        using var incremental = new IncrementalSkiaRenderer(assets, maximumCachedFrameBytes: 1024 * 1024);
        var fullRenderer = new SkiaRenderer(assets);
        var center = new Point2D(1, 1);
        var first = Layer(
            new Rect2D(0, 0, 2, 2),
            new Transform2D(new Point2D(4, 4), new Point2D(1, 1), 0, Point2D.Zero),
            alpha: 1,
            zOrder: 0);
        var second = Layer(
            new Rect2D(0, 0, 2, 2),
            new Transform2D(new Point2D(4, 4), new Point2D(1, 1), 0, center, flipX: true),
            alpha: 0.5,
            zOrder: 1,
            blendMode: RenderBlendMode.Multiply);
        var third = Layer(
            new Rect2D(0, 0, 1, 2),
            new Transform2D(new Point2D(9.5, 4.5), new Point2D(1, 1), Math.PI / 2, new Point2D(0.5, 1), flipY: true),
            alpha: 0.75,
            zOrder: 2,
            blendMode: RenderBlendMode.Screen);
        var fourth = Layer(
            new Rect2D(0, 0, 2, 2),
            new Transform2D(new Point2D(6, 4), new Point2D(1, 1), 0, Point2D.Zero),
            alpha: 0.25,
            zOrder: 3,
            blendMode: RenderBlendMode.Add);
        var firstScene = Scene([first, second, third, fourth], width: 32, height: 32);

        using var expectedFirst = await fullRenderer.RenderAsync(firstScene, TestContext.Current.CancellationToken);
        using var actualFirst = await incremental.RenderAsync(firstScene, TestContext.Current.CancellationToken);
        AssertPixelsEqual(expectedFirst.Bitmap, actualFirst.Bitmap);
        var firstMetrics = incremental.CacheMetrics;
        Assert.Equal(0, firstMetrics.HitCount);
        Assert.Equal(1, firstMetrics.MissCount);
        Assert.Equal(1, firstMetrics.EntryCount);
        Assert.Equal(32 * 32 * 4, firstMetrics.ResidentBytes);

        using var expectedRepeated = await fullRenderer.RenderAsync(firstScene, TestContext.Current.CancellationToken);
        using var actualRepeated = await incremental.RenderAsync(firstScene, TestContext.Current.CancellationToken);
        AssertPixelsEqual(expectedRepeated.Bitmap, actualRepeated.Bitmap);
        var repeatedMetrics = incremental.CacheMetrics;
        Assert.Equal(1, repeatedMetrics.HitCount);
        Assert.Equal(1, repeatedMetrics.MissCount);
        Assert.Equal(firstMetrics.ResidentBytes, repeatedMetrics.ResidentBytes);
        Assert.Equal(1, repeatedMetrics.EntryCount);

        var changedSecond = new RenderLayer(
            second.Id,
            second.AssetId,
            second.Crop,
            new Transform2D(new Point2D(5, 4), second.Transform.Scale, second.Transform.RotationRadians, second.Transform.Pivot, second.Transform.FlipX, second.Transform.FlipY),
            0.35,
            second.BlendMode,
            second.ZOrder);
        var changedScene = Scene([first, changedSecond, third], width: 32, height: 32);
        using var expectedChanged = await fullRenderer.RenderAsync(changedScene, TestContext.Current.CancellationToken);
        using var actualChanged = await incremental.RenderAsync(changedScene, TestContext.Current.CancellationToken);
        AssertPixelsEqual(expectedChanged.Bitmap, actualChanged.Bitmap);
        var changedMetrics = incremental.CacheMetrics;
        Assert.Equal(1, changedMetrics.HitCount);
        Assert.Equal(2, changedMetrics.MissCount);
        Assert.Equal(0, changedMetrics.EvictionCount);
        Assert.Equal(1, changedMetrics.EntryCount);
        Assert.Equal(repeatedMetrics.ResidentBytes, changedMetrics.ResidentBytes);
        Assert.Equal(0, assets.Cache.Metrics.ActiveLeaseCount);
    }

    [Fact]
    public async Task IncrementalRenderer_Respects_Byte_Budget_And_Evicts_Previous_Frame()
    {
        using var assets = new TestRenderAssetProvider(CreateFourColorPng());
        const int cacheBudgetBytes = 32 * 32 * 4;
        using var incremental = new IncrementalSkiaRenderer(assets, maximumCachedFrameBytes: cacheBudgetBytes);
        var fillFrame = new Transform2D(Point2D.Zero, new Point2D(16, 16), 0, Point2D.Zero);
        var first = Layer(new Rect2D(0, 0, 2, 2), fillFrame, zOrder: 0);
        var second = Layer(new Rect2D(0, 0, 2, 2), fillFrame, zOrder: 1);
        var third = Layer(new Rect2D(0, 0, 2, 2), fillFrame, zOrder: 2);
        var fullScene = Scene([first, second, third], width: 32, height: 32);

        using var expectedFull = await new SkiaRenderer(assets).RenderAsync(fullScene, TestContext.Current.CancellationToken);
        using var actualFull = await incremental.RenderAsync(fullScene, TestContext.Current.CancellationToken);
        AssertPixelsEqual(expectedFull.Bitmap, actualFull.Bitmap);
        Assert.Equal(cacheBudgetBytes, incremental.CacheMetrics.ResidentBytes);
        Assert.Equal(1, incremental.CacheMetrics.EntryCount);
        Assert.Equal(0, incremental.CacheMetrics.EvictionCount);
        Assert.True(incremental.CacheMetrics.ResidentBytes <= incremental.MaximumCachedFrameBytes);

        var changedScene = Scene([second, third], width: 32, height: 32);
        using var expectedChanged = await new SkiaRenderer(assets).RenderAsync(changedScene, TestContext.Current.CancellationToken);
        using var actualChanged = await incremental.RenderAsync(changedScene, TestContext.Current.CancellationToken);
        AssertPixelsEqual(expectedChanged.Bitmap, actualChanged.Bitmap);
        Assert.Equal(new RenderedSceneCacheMetrics(0, 2, 1, cacheBudgetBytes, 1), incremental.CacheMetrics);

        using var noCache = new IncrementalSkiaRenderer(assets, maximumCachedFrameBytes: cacheBudgetBytes - 1);
        using var uncachedFirst = await noCache.RenderAsync(fullScene, TestContext.Current.CancellationToken);
        using var uncachedRepeated = await noCache.RenderAsync(fullScene, TestContext.Current.CancellationToken);
        AssertPixelsEqual(expectedFull.Bitmap, uncachedRepeated.Bitmap);
        Assert.Equal(new RenderedSceneCacheMetrics(0, 2, 0, 0, 0), noCache.CacheMetrics);
    }

    [Fact]
    public async Task IncrementalRenderer_Invalidates_Partially_Drawn_Cache_When_Asset_Acquisition_Fails()
    {
        using var assets = new TestRenderAssetProvider(CreateFourColorPng());
        using var incremental = new IncrementalSkiaRenderer(assets, maximumCachedFrameBytes: 1024 * 1024);
        var first = Layer(new Rect2D(0, 0, 2, 2), new Transform2D(new Point2D(3, 3), new Point2D(1, 1), 0, Point2D.Zero));
        var initialScene = Scene([first], width: 32, height: 32);
        using var initial = await incremental.RenderAsync(initialScene, TestContext.Current.CancellationToken);

        var moved = new RenderLayer(
            first.Id,
            first.AssetId,
            first.Crop,
            new Transform2D(new Point2D(10, 10), first.Transform.Scale, first.Transform.RotationRadians, first.Transform.Pivot),
            first.Alpha,
            first.BlendMode,
            first.ZOrder);
        var changedScene = Scene([moved], width: 32, height: 32);
        assets.FailNextAcquire = true;

        await Assert.ThrowsAsync<IOException>(() => incremental.RenderAsync(changedScene, TestContext.Current.CancellationToken));
        Assert.Equal(0, incremental.CacheMetrics.EntryCount);

        using var expected = await new SkiaRenderer(assets).RenderAsync(changedScene, TestContext.Current.CancellationToken);
        using var recovered = await incremental.RenderAsync(changedScene, TestContext.Current.CancellationToken);
        AssertPixelsEqual(expected.Bitmap, recovered.Bitmap);
        Assert.Equal(1, incremental.CacheMetrics.EntryCount);
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

    private static RenderLayer Layer(Rect2D crop, Transform2D? transform = null, double alpha = 1, int zOrder = 0, RenderBlendMode blendMode = RenderBlendMode.Normal) => new(
        RenderLayerId.New(),
        AssetId.New(),
        crop,
        transform ?? Transform2D.Identity,
        alpha,
        blendMode,
        zOrder);

    private static void AssertPixelsEqual(SKBitmap expected, SKBitmap actual)
    {
        Assert.Equal(expected.Width, actual.Width);
        Assert.Equal(expected.Height, actual.Height);
        for (var y = 0; y < expected.Height; y++)
        for (var x = 0; x < expected.Width; x++)
        {
            Assert.True(expected.GetPixel(x, y) == actual.GetPixel(x, y),
                $"Incremental render differs at ({x},{y}): expected {expected.GetPixel(x, y)}, actual {actual.GetPixel(x, y)}.");
        }
    }

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

    private static byte[] CreateCharacterPalettePng()
    {
        using var bitmap = new SKBitmap(new SKImageInfo(8, 8, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        for (var y = 0; y < 8; y++)
        for (var x = 0; x < 8; x++)
        {
            var color = (x < 4, y < 4) switch
            {
                (true, true) => SKColors.Red,
                (false, true) => SKColors.Green,
                (true, false) => SKColors.Blue,
                (false, false) => SKColors.Yellow
            };
            bitmap.SetPixel(x, y, color);
        }

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
        public bool FailNextAcquire { get; set; }

        public TestRenderAssetProvider(byte[] png)
        {
            _png = png;
            _key = AssetImageCacheKey.Create(Convert.ToHexString(SHA256.HashData(png)).ToLowerInvariant(), decoderVersion: 1);
        }

        public async Task<AssetImageLease> AcquireAsync(AssetId assetId, CancellationToken cancellationToken = default)
        {
            Assert.True(assetId.IsValid);
            if (FailNextAcquire)
            {
                FailNextAcquire = false;
                throw new IOException("Synthetic failure while acquiring a layer asset.");
            }

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
