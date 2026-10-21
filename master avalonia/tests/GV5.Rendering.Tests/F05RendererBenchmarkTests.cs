using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using GV5.Assets.Decoding;
using GV5.Core.Identity;
using GV5.Geometry;
using GV5.Rendering;
using SkiaSharp;
using Xunit;

namespace GV5.Rendering.Tests;

public sealed class F05RendererBenchmarkTests
{
    private const int Width = 256;
    private const int Height = 144;
    private const int LayerCount = 80;
    private const int WarmSamples = 8;

    [Fact]
    public async Task F05_10_Measures_Cold_Warm_Memory_And_Pixel_Equivalence()
    {
        var png = CreateFixturePng();
        var scene = CreateScene(changedLayerIndex: null);
        var changedScene = ChangeOneLayer(scene, LayerCount / 2);
        var cancellationToken = TestContext.Current.CancellationToken;
        await WarmUpJitAsync(png, scene, changedScene, cancellationToken);

        using var fullAssets = new BenchmarkAssetProvider(png);
        var fullRenderer = new SkiaRenderer(fullAssets);
        var fullFirstWatch = Stopwatch.StartNew();
        using var fullReference = await fullRenderer.RenderAsync(scene, cancellationToken);
        fullFirstWatch.Stop();
        var fullWarmSamples = await MeasureRenderSamplesAsync(WarmSamples, fullRenderer, scene, fullReference.Bitmap, cancellationToken);

        using var incrementalAssets = new BenchmarkAssetProvider(png);
        using var incrementalRenderer = new IncrementalSkiaRenderer(incrementalAssets);
        using var process = Process.GetCurrentProcess();
        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        var managedBytesBeforePreview = GC.GetTotalMemory(forceFullCollection: false);
        process.Refresh();
        var workingSetBeforePreview = process.WorkingSet64;

        var incrementalFirstWatch = Stopwatch.StartNew();
        using var incrementalReference = await incrementalRenderer.RenderAsync(scene, cancellationToken);
        incrementalFirstWatch.Stop();
        var comparisonPath = ArtifactPath("first-preview-comparison.png");
        var coldComparison = PngGoldenComparer.Compare(fullReference.Bitmap, incrementalReference.Bitmap, comparisonPath);
        Assert.True(coldComparison.DifferentPixels == 0, DescribeDifferences(fullReference.Bitmap, incrementalReference.Bitmap));
        Assert.Equal(0, coldComparison.MeanAbsoluteChannelError);
        var cacheAfterFirstPreview = incrementalRenderer.CacheMetrics;

        var incrementalWarmSamples = await MeasureRenderSamplesAsync(
            WarmSamples, incrementalRenderer, scene, fullReference.Bitmap, cancellationToken);
        var cacheAfterWarmPreview = incrementalRenderer.CacheMetrics;

        var fullChangedWatch = Stopwatch.StartNew();
        using var changedFullReference = await fullRenderer.RenderAsync(changedScene, cancellationToken);
        fullChangedWatch.Stop();
        var fullChangedWarmSamples = await MeasureRenderSamplesAsync(
            WarmSamples, fullRenderer, changedScene, changedFullReference.Bitmap, cancellationToken);
        var changedWatch = Stopwatch.StartNew();
        using var changedIncremental = await incrementalRenderer.RenderAsync(changedScene, cancellationToken);
        changedWatch.Stop();
        var changedComparison = PngGoldenComparer.Compare(
            changedFullReference.Bitmap,
            changedIncremental.Bitmap,
            ArtifactPath("changed-layer-comparison.png"));
        Assert.True(changedComparison.DifferentPixels == 0, DescribeDifferences(changedFullReference.Bitmap, changedIncremental.Bitmap));
        Assert.Equal(0, changedComparison.MeanAbsoluteChannelError);
        var cacheAfterSingleLayerChange = incrementalRenderer.CacheMetrics;
        var changedWarmSamples = await MeasureRenderSamplesAsync(
            WarmSamples, incrementalRenderer, changedScene, changedFullReference.Bitmap, cancellationToken);

        GC.Collect();
        GC.WaitForPendingFinalizers();
        GC.Collect();
        var managedBytesAfterPreview = GC.GetTotalMemory(forceFullCollection: false);
        process.Refresh();
        var workingSetAfterPreview = process.WorkingSet64;
        var report = new
        {
            capturedUtc = DateTimeOffset.UtcNow,
            runtime = RuntimeInformation.FrameworkDescription,
            os = RuntimeInformation.OSDescription,
            processorCount = Environment.ProcessorCount,
            scene = new { width = Width, height = Height, layerCount = LayerCount, assetFixture = "synthetic 2x2 four-color RGBA" },
            sampleCount = WarmSamples,
            warmup = "Both render paths were exercised with separate providers before timed runs; measured caches start empty.",
            fullRenderer = new
            {
                firstPreviewMs = Milliseconds(fullFirstWatch.Elapsed),
                warmSamplesMs = Milliseconds(fullWarmSamples),
                warmMedianMs = Median(fullWarmSamples),
                decodedAssetCache = fullAssets.Cache.Metrics
            },
            incrementalRenderer = new
            {
                firstPreviewMs = Milliseconds(incrementalFirstWatch.Elapsed),
                warmSamplesMs = Milliseconds(incrementalWarmSamples),
                warmMedianMs = Median(incrementalWarmSamples),
                changedLayerRenderMs = Milliseconds(changedWatch.Elapsed),
                changedSceneFullRenderMs = Milliseconds(fullChangedWatch.Elapsed),
                changedSceneFullWarmSamplesMs = Milliseconds(fullChangedWarmSamples),
                changedSceneFullWarmMedianMs = Median(fullChangedWarmSamples),
                changedSceneWarmSamplesMs = Milliseconds(changedWarmSamples),
                sceneFrameCacheCapacityBytes = incrementalRenderer.MaximumCachedFrameBytes,
                afterFirstPreview = cacheAfterFirstPreview,
                afterWarmPreview = cacheAfterWarmPreview,
                afterOneLayerChange = cacheAfterSingleLayerChange
            },
            retainedMemory = new
            {
                sceneFrameCacheBytes = cacheAfterSingleLayerChange.ResidentBytes,
                managedHeapBeforeBytes = managedBytesBeforePreview,
                managedHeapAfterBytes = managedBytesAfterPreview,
                processWorkingSetBeforeBytes = workingSetBeforePreview,
                processWorkingSetAfterBytes = workingSetAfterPreview
            },
            pixelEquivalence = new
            {
                firstPreviewDifferentPixels = coldComparison.DifferentPixels,
                firstPreviewMeanAbsoluteChannelError = coldComparison.MeanAbsoluteChannelError,
                changedSceneDifferentPixels = changedComparison.DifferentPixels,
                changedSceneMeanAbsoluteChannelError = changedComparison.MeanAbsoluteChannelError
            }
        };

        var reportPath = ArtifactPath("f05.10-render-benchmark.json");
        File.WriteAllText(reportPath, JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine($"F05.10 benchmark report: {reportPath}");
        Console.WriteLine(JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));

        Assert.Equal(0, fullAssets.Cache.Metrics.ActiveLeaseCount);
        Assert.Equal(0, incrementalAssets.Cache.Metrics.ActiveLeaseCount);
        Assert.True(cacheAfterSingleLayerChange.ResidentBytes <= incrementalRenderer.MaximumCachedFrameBytes);
    }

    private static async Task<double[]> MeasureRenderSamplesAsync(
        int sampleCount,
        IRenderSceneRenderer renderer,
        RenderScene scene,
        SKBitmap expected,
        CancellationToken cancellationToken)
    {
        var samples = new double[sampleCount];
        for (var index = 0; index < sampleCount; index++)
        {
            var watch = Stopwatch.StartNew();
            using var frame = await renderer.RenderAsync(scene, cancellationToken);
            watch.Stop();
            samples[index] = Milliseconds(watch.Elapsed);
            AssertPixelsEqual(expected, frame.Bitmap);
        }

        return samples;
    }

    private static async Task WarmUpJitAsync(
        byte[] png,
        RenderScene scene,
        RenderScene changedScene,
        CancellationToken cancellationToken)
    {
        using var fullAssets = new BenchmarkAssetProvider(png);
        var fullRenderer = new SkiaRenderer(fullAssets);
        using var fullWarmupFrame = await fullRenderer.RenderAsync(scene, cancellationToken);

        using var incrementalAssets = new BenchmarkAssetProvider(png);
        using var incrementalRenderer = new IncrementalSkiaRenderer(incrementalAssets);
        using var incrementalWarmupFrame = await incrementalRenderer.RenderAsync(scene, cancellationToken);
        using var changedWarmupFrame = await incrementalRenderer.RenderAsync(changedScene, cancellationToken);
    }

    private static double[] Milliseconds(IEnumerable<double> samples) => samples.Select(value => Math.Round(value, 3)).ToArray();

    private static double Milliseconds(TimeSpan duration) => Math.Round(duration.TotalMilliseconds, 3);

    private static double Median(IReadOnlyCollection<double> samples)
    {
        var ordered = samples.Order().ToArray();
        var middle = ordered.Length / 2;
        return Math.Round(ordered.Length % 2 == 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle], 3);
    }

    private static RenderScene CreateScene(int? changedLayerIndex)
    {
        var assetId = AssetId.New();
        var layers = new List<RenderLayer>(LayerCount);
        for (var index = 0; index < LayerCount; index++)
        {
            var column = index % 16;
            var row = index / 16;
            var layer = new RenderLayer(
                RenderLayerId.New(),
                assetId,
                new Rect2D(0, 0, 2, 2),
                new Transform2D(
                    new Point2D(4 + column * 14, 4 + row * 18),
                    new Point2D(1, 1),
                    (index % 4) * Math.PI / 16,
                    new Point2D(1, 1),
                    flipX: index % 2 == 0,
                    flipY: index % 3 == 0),
                index % 5 == 0 ? 0.45 : 0.8,
                (RenderBlendMode)(index % 4 + 1),
                index);

            if (changedLayerIndex == index)
            {
                layer = new RenderLayer(
                    layer.Id,
                    layer.AssetId,
                    layer.Crop,
                    new Transform2D(new Point2D(120, 72), layer.Transform.Scale, layer.Transform.RotationRadians, layer.Transform.Pivot, layer.Transform.FlipX, layer.Transform.FlipY),
                    0.35,
                    layer.BlendMode,
                    layer.ZOrder);
            }

            layers.Add(layer);
        }

        return new RenderScene(SceneId.New(), Width, Height, layers);
    }

    private static RenderScene ChangeOneLayer(RenderScene scene, int layerIndex)
    {
        var changed = scene.Layers.Select((layer, index) => index != layerIndex
            ? layer
            : new RenderLayer(
                layer.Id,
                layer.AssetId,
                layer.Crop,
                new Transform2D(new Point2D(120, 72), layer.Transform.Scale, layer.Transform.RotationRadians, layer.Transform.Pivot, layer.Transform.FlipX, layer.Transform.FlipY),
                0.35,
                layer.BlendMode,
                layer.ZOrder));
        return new RenderScene(SceneId.New(), scene.Width, scene.Height, changed);
    }

    private static void AssertPixelsEqual(SKBitmap expected, SKBitmap actual)
    {
        Assert.Equal(expected.Width, actual.Width);
        Assert.Equal(expected.Height, actual.Height);
        for (var y = 0; y < expected.Height; y++)
        for (var x = 0; x < expected.Width; x++)
        {
            Assert.True(expected.GetPixel(x, y) == actual.GetPixel(x, y),
                $"Measured render differs at ({x},{y}): expected {expected.GetPixel(x, y)}, actual {actual.GetPixel(x, y)}.");
        }
    }

    private static string DescribeDifferences(SKBitmap expected, SKBitmap actual)
    {
        var differences = new List<string>();
        for (var y = 0; y < expected.Height; y++)
        for (var x = 0; x < expected.Width; x++)
        {
            if (expected.GetPixel(x, y) != actual.GetPixel(x, y))
            {
                differences.Add($"({x},{y}) {expected.GetPixel(x, y)} != {actual.GetPixel(x, y)}");
                if (differences.Count == 12)
                {
                    return string.Join("; ", differences);
                }
            }
        }

        return string.Join("; ", differences);
    }

    private static byte[] CreateFixturePng()
    {
        using var bitmap = new SKBitmap(new SKImageInfo(2, 2, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        bitmap.SetPixel(0, 0, SKColors.Red);
        bitmap.SetPixel(1, 0, SKColors.Green);
        bitmap.SetPixel(0, 1, SKColors.Blue);
        bitmap.SetPixel(1, 1, SKColors.Yellow);
        using var image = SKImage.FromBitmap(bitmap);
        using var encoded = image.Encode(SKEncodedImageFormat.Png, 100)
            ?? throw new InvalidOperationException("Could not encode the F05.10 synthetic image.");
        return encoded.ToArray();
    }

    private static string ArtifactPath(string fileName)
    {
        var directory = Path.Combine(AppContext.BaseDirectory, "TestResults", "Rendering", "F05.10");
        Directory.CreateDirectory(directory);
        return Path.Combine(directory, fileName);
    }

    private sealed class BenchmarkAssetProvider : IRenderAssetProvider, IDisposable
    {
        private readonly byte[] _png;
        private readonly AssetImageCacheKey _key;

        public AssetBitmapCache Cache { get; } = new(16 * 1024 * 1024);

        public BenchmarkAssetProvider(byte[] png)
        {
            _png = png;
            _key = AssetImageCacheKey.Create(Convert.ToHexString(SHA256.HashData(png)).ToLowerInvariant(), decoderVersion: 1);
        }

        public async Task<AssetImageLease> AcquireAsync(AssetId assetId, CancellationToken cancellationToken = default)
        {
            var result = await Cache.AcquireAsync(_key, DecodeAsync, cancellationToken);
            if (!result.IsSuccess)
            {
                throw new InvalidDataException(result.Error?.Message ?? "Benchmark image decode failed.");
            }

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
