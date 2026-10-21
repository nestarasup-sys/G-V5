using System.Security.Cryptography;
using GV5.Assets.Decoding;
using GV5.Core.Identity;
using GV5.Geometry;
using GV5.Rendering;
using SkiaSharp;
using Xunit;

namespace GV5.Rendering.Tests;

/// <summary>Deterministic CPU goldens for synthetic wardrobe pieces attached to common body regions.</summary>
public sealed class WardrobeGoldenTests
{
    private const int CanvasSize = 64;

    [Theory]
    [InlineData("sleeve")]
    [InlineData("pants")]
    [InlineData("skirt")]
    [InlineData("head")]
    [InlineData("rotated-pose")]
    public async Task WardrobeComposition_MatchesGolden(string scenario)
    {
        var fixtureDirectory = Path.Combine(AppContext.BaseDirectory, "Fixtures", "rendering");
        var goldenPath = Path.Combine(fixtureDirectory, $"wardrobe-{scenario}.golden.png");
        using var assets = new WardrobeFixtureAssetProvider(CreateWardrobeAtlas());
        var scene = BuildScene(scenario);
        using var actual = await new SkiaRenderer(assets).RenderAsync(scene, TestContext.Current.CancellationToken);

        if (Environment.GetEnvironmentVariable("GV5_UPDATE_RENDERING_GOLDENS") == "1")
        {
            var sourceDirectory = FindSourceFixtureDirectory();
            using var image = SKImage.FromBitmap(actual.Bitmap);
            using var encoded = image.Encode(SKEncodedImageFormat.Png, 100)
                ?? throw new InvalidOperationException("Skia could not encode the wardrobe golden.");
            await File.WriteAllBytesAsync(Path.Combine(sourceDirectory, $"wardrobe-{scenario}.golden.png"),
                encoded.ToArray(), TestContext.Current.CancellationToken);
            return;
        }

        using var expected = SKBitmap.Decode(goldenPath)
            ?? throw new InvalidDataException($"Could not decode wardrobe golden: {goldenPath}");
        Assert.Equal(CanvasSize, expected.Width);
        Assert.Equal(CanvasSize, expected.Height);
        Assert.Equal(expected.Width, actual.Width);
        Assert.Equal(expected.Height, actual.Height);
        var comparisonPath = Path.Combine(AppContext.BaseDirectory, "TestResults", "Rendering",
            $"wardrobe-{scenario}-comparison.png");
        var comparison = PngGoldenComparer.Compare(expected, actual.Bitmap, comparisonPath);
        Assert.Equal(0, comparison.DifferentPixels);
        Assert.Equal(0, comparison.MeanAbsoluteChannelError);
        for (var y = 0; y < expected.Height; y++)
        for (var x = 0; x < expected.Width; x++)
        {
            Assert.True(expected.GetPixel(x, y) == actual.Bitmap.GetPixel(x, y),
                $"{scenario}: pixel mismatch at ({x},{y}); expected {expected.GetPixel(x, y)}, actual {actual.Bitmap.GetPixel(x, y)}.");
        }
        Assert.Equal(0, assets.Cache.Metrics.ActiveLeaseCount);
    }

    private static RenderScene BuildScene(string scenario)
    {
        var asset = FixtureAssetId;
        var layers = new List<RenderLayer>
        {
            Layer(asset, new Rect2D(0, 0, 24, 32), At(20, 16), z: 0)
        };

        var (crop, sourceBone, posedBone, garment, z) = scenario switch
        {
            "sleeve" => (new Rect2D(24, 0, 8, 12),
                new WardrobeBoneFrame("arm", new Rect2D(29, 30, 4, 12), 0),
                new WardrobeBoneFrame("arm", new Rect2D(29, 30, 4, 12), 0),
                new Rect2D(28, 30, 6, 10), 1),
            "pants" => (new Rect2D(32, 0, 8, 12),
                new WardrobeBoneFrame("leg", new Rect2D(26, 15, 12, 14), 0),
                new WardrobeBoneFrame("leg", new Rect2D(26, 15, 12, 14), 0),
                new Rect2D(25, 15, 14, 14), 1),
            "skirt" => (new Rect2D(24, 12, 12, 8),
                new WardrobeBoneFrame("torso", new Rect2D(27, 27, 10, 12), 0),
                new WardrobeBoneFrame("torso", new Rect2D(27, 27, 10, 12), 0),
                new Rect2D(24, 25, 16, 8), 1),
            "head" => (new Rect2D(40, 0, 8, 8),
                new WardrobeBoneFrame("head", new Rect2D(27, 43, 10, 11), 0),
                new WardrobeBoneFrame("head", new Rect2D(27, 43, 10, 11), 0),
                new Rect2D(28, 50, 8, 4), int.MaxValue),
            "rotated-pose" => (new Rect2D(24, 0, 8, 12),
                new WardrobeBoneFrame("arm", new Rect2D(29, 30, 4, 12), 0),
                new WardrobeBoneFrame("arm", new Rect2D(29, 30, 4, 12), 28),
                new Rect2D(29, 30, 4, 10), 1),
            _ => throw new ArgumentOutOfRangeException(nameof(scenario), scenario, "Unknown wardrobe golden scenario.")
        };

        var binding = WardrobeBinding.Bind(sourceBone, garment, garmentRotationDegrees: 0);
        var resolved = WardrobeBindingMath.Resolve(binding, posedBone);
        var centerPivot = new Point2D(crop.Width / 2, crop.Height / 2);
        var transform = new Transform2D(
            new Point2D(resolved.Bounds.X, resolved.Bounds.Y),
            new Point2D(resolved.Bounds.Width / crop.Width, resolved.Bounds.Height / crop.Height),
            resolved.RotationDegrees * Math.PI / 180,
            centerPivot,
            resolved.FlipX,
            resolved.FlipY);
        layers.Add(Layer(asset, crop, transform, z));
        if (scenario == "rotated-pose")
        {
            var arm = new Transform2D(new Point2D(29, 30), new Point2D(1, 1),
                28 * Math.PI / 180, new Point2D(2, 6));
            layers.Add(Layer(asset, new Rect2D(20, 0, 4, 12), arm, z: 1));
            layers[^2] = ReZ(layers[^2], 2);
        }
        return new RenderScene(SceneId.New(), CanvasSize, CanvasSize, layers);
    }

    private static RenderLayer Layer(AssetId asset, Rect2D crop, Transform2D transform, int z) =>
        new(RenderLayerId.New(), asset, crop, transform, 1, RenderBlendMode.Normal, z);

    private static Transform2D At(double x, double y) =>
        new(new Point2D(x, y), new Point2D(1, 1), 0, Point2D.Zero);

    private static RenderLayer ReZ(RenderLayer layer, int z) =>
        new(layer.Id, layer.AssetId, layer.Crop, layer.Transform, layer.Alpha, layer.BlendMode, z);

    private static AssetId FixtureAssetId => AssetId.From(Guid.Parse("a2c26730-4955-45b8-a211-86b6fd581140"));

    private static byte[] CreateWardrobeAtlas()
    {
        using var bitmap = new SKBitmap(new SKImageInfo(48, 32, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        bitmap.Erase(SKColors.Transparent);
        using var canvas = new SKCanvas(bitmap);
        using var paint = new SKPaint { IsAntialias = false };

        paint.Color = new SKColor(238, 192, 158);
        canvas.DrawOval(new SKRect(8, 0, 17, 10), paint);
        canvas.DrawRect(8, 10, 8, 12, paint);
        canvas.DrawRect(4, 11, 4, 11, paint);
        canvas.DrawRect(16, 11, 4, 11, paint);
        canvas.DrawRect(8, 22, 4, 10, paint);
        canvas.DrawRect(12, 22, 4, 10, paint);
        paint.Color = new SKColor(61, 43, 62);
        canvas.DrawArc(new SKRect(7, -2, 18, 8), 180, 180, false, paint);
        paint.Color = new SKColor(64, 48, 56);
        canvas.DrawRect(10, 5, 1, 1, paint);
        canvas.DrawRect(14, 5, 1, 1, paint);
        paint.Color = new SKColor(52, 39, 48);
        canvas.DrawRect(24, 0, 8, 12, paint);
        paint.Color = new SKColor(45, 147, 211);
        canvas.DrawRect(25, 1, 6, 10, paint);

        paint.Color = new SKColor(40, 48, 92);
        canvas.DrawRect(32, 0, 8, 12, paint);
        paint.Color = new SKColor(77, 123, 210);
        canvas.DrawRect(33, 1, 6, 10, paint);

        paint.Color = new SKColor(112, 36, 77);
        canvas.DrawRect(24, 12, 12, 8, paint);
        paint.Color = new SKColor(230, 73, 125);
        canvas.DrawRect(25, 13, 10, 6, paint);
        paint.Color = new SKColor(255, 221, 102);
        canvas.DrawRect(40, 0, 8, 8, paint);
        paint.Color = new SKColor(175, 92, 40);
        canvas.DrawRect(41, 1, 6, 3, paint);
        canvas.Flush();
        using var image = SKImage.FromBitmap(bitmap);
        using var encoded = image.Encode(SKEncodedImageFormat.Png, 100)
            ?? throw new InvalidOperationException("Skia could not encode the synthetic wardrobe atlas.");
        return encoded.ToArray();
    }

    private static string FindSourceFixtureDirectory()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !Directory.Exists(Path.Combine(directory.FullName, "tests", "Fixtures", "rendering")))
            directory = directory.Parent;
        return directory is null
            ? throw new DirectoryNotFoundException("Could not locate the source rendering fixtures.")
            : Path.Combine(directory.FullName, "tests", "Fixtures", "rendering");
    }

    private sealed class WardrobeFixtureAssetProvider : IRenderAssetProvider, IDisposable
    {
        private readonly byte[] _png;
        private readonly AssetImageCacheKey _key;
        public AssetBitmapCache Cache { get; } = new(1024 * 1024);

        public WardrobeFixtureAssetProvider(byte[] png)
        {
            _png = png;
            _key = AssetImageCacheKey.Create(Convert.ToHexString(SHA256.HashData(png)).ToLowerInvariant(), 1);
        }

        public async Task<AssetImageLease> AcquireAsync(AssetId assetId, CancellationToken cancellationToken = default)
        {
            Assert.Equal(FixtureAssetId, assetId);
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
