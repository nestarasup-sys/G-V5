using System.Security.Cryptography;
using GV5.Assets.Decoding;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using GV5.Rendering;
using SkiaSharp;
using Xunit;

namespace GV5.Rendering.Tests;

public sealed class CharacterRenderSceneBuilderTests
{
    private const int CanvasWidth = 96;
    private const int CanvasHeight = 48;

    [Fact]
    public async Task Build_ComposesBodyWardrobeHairAndFaceInCanonicalLegacyOrderAndMatchesGolden()
    {
        var model = ModelRevisionReference.Restore(ModelId.New(), ModelRevisionId.New(), Revision.Initial, new string('a', 64));
        var assets = Enumerable.Range(0, 8).Select(_ => AssetId.New()).ToArray();
        var crops = assets.Select((asset, index) => (asset, crop: new Rect2D(index * 12, 0, 12, 12)))
            .ToDictionary(item => item.asset, item => item.crop);
        var bodyPart = ModelPartId.New();
        var headPart = ModelPartId.New();
        var body = new[]
        {
            Layer(assets[1], crops[assets[1]], At(12, 24), 0),
            Layer(assets[3], crops[assets[3]], At(36, 24), 1)
        };
        var hair = HairStyleDraft.Create(model, "Composição dourada")
            .WithLayer(HairLayer.Create(HairPartId.BackHair, assets[0], At(0, 24)))
            .WithLayer(HairLayer.Create(HairPartId.RearHair, assets[4], At(48, 24)))
            .WithLayer(HairLayer.Create(HairPartId.FrontHair, assets[6], At(72, 24)));
        var nose = FaceComponent.Create(FaceComponentKind.Nose, "Nariz", assets[5], null, At(60, 24));
        var face = FaceCatalogDraft.Create(model, "Face").WithComponent(nose);
        var faceAssembly = FaceAssembly.Create(face).Select(face, nose.Id);
        var attachedGarment = new WardrobeComponentPosePlacement(WardrobeComponentId.New(), assets[2],
            WardrobeCategory.Shirt, bodyPart, WardrobeRenderPhase.AttachedToBodyLayer, 0, 0,
            new WardrobePlacement(new Rect2D(24, 24, 12, 12), 0, false, false, 1, 1));
        var headAccessory = new WardrobeComponentPosePlacement(WardrobeComponentId.New(), assets[7],
            WardrobeCategory.HeadAccessory, headPart, WardrobeRenderPhase.AboveHair, int.MaxValue, 1,
            new WardrobePlacement(new Rect2D(0, 24, 12, 12), 0, false, false, 1, 1));

        var scene = CharacterRenderSceneBuilder.Build(SceneId.New(), CanvasWidth, CanvasHeight, model,
            body, new Dictionary<ModelPartId, int> { [bodyPart] = 0, [headPart] = 1 },
            hair, crops, face, faceAssembly, crops, [headAccessory, attachedGarment], crops);

        Assert.Equal(Enumerable.Range(0, 8), scene.Layers.Select(layer => layer.ZOrder));
        Assert.Equal(assets, scene.Layers.Select(layer => layer.AssetId));
        Assert.Throws<ArgumentException>(() => CharacterRenderSceneBuilder.Build(SceneId.New(), CanvasWidth, CanvasHeight,
            model, body, new Dictionary<ModelPartId, int> { [bodyPart] = 0, [headPart] = 1 }, hair, crops,
            face, faceAssembly, crops, [attachedGarment with { RenderPhase = (WardrobeRenderPhase)99 }], crops));
        using var provider = new CompositeFixtureAssetProvider(CreateAtlas());
        using var actual = await new SkiaRenderer(provider).RenderAsync(scene, TestContext.Current.CancellationToken);
        var goldenPath = Path.Combine(AppContext.BaseDirectory, "Fixtures", "rendering", "character-composite.golden.png");
        if (Environment.GetEnvironmentVariable("GV5_UPDATE_RENDERING_GOLDENS") == "1")
        {
            using var image = SKImage.FromBitmap(actual.Bitmap);
            using var encoded = image.Encode(SKEncodedImageFormat.Png, 100)
                ?? throw new InvalidOperationException("Skia could not encode the character composition golden.");
            await File.WriteAllBytesAsync(Path.Combine(FindSourceFixtureDirectory(), "character-composite.golden.png"),
                encoded.ToArray(), TestContext.Current.CancellationToken);
            return;
        }

        using var expected = SKBitmap.Decode(goldenPath)
            ?? throw new InvalidDataException($"Could not decode character composition golden: {goldenPath}");
        Assert.Equal(CanvasWidth, expected.Width);
        Assert.Equal(CanvasHeight, expected.Height);
        var comparison = PngGoldenComparer.Compare(expected, actual.Bitmap,
            Path.Combine(AppContext.BaseDirectory, "TestResults", "Rendering", "character-composite-comparison.png"));
        Assert.Equal(0, comparison.DifferentPixels);
        Assert.Equal(0, comparison.MeanAbsoluteChannelError);
        Assert.Equal(0, provider.Cache.Metrics.ActiveLeaseCount);
    }

    [Fact]
    public void Build_RejectsHairOrFaceFromAnotherExactModelPublication()
    {
        var model = ModelRevisionReference.Restore(ModelId.New(), ModelRevisionId.New(), Revision.Initial, new string('b', 64));
        var otherModel = ModelRevisionReference.Restore(model.ModelId, ModelRevisionId.New(), Revision.From(2), new string('c', 64));
        var face = FaceCatalogDraft.Create(model, "Face");
        var hair = HairStyleDraft.Create(otherModel, "Cabelo");
        Assert.Throws<ArgumentException>(() => CharacterRenderSceneBuilder.Build(SceneId.New(), 16, 16, model,
            [], new Dictionary<ModelPartId, int>(), hair, new Dictionary<AssetId, Rect2D>(),
            face, FaceAssembly.Create(face), new Dictionary<AssetId, Rect2D>(), [], new Dictionary<AssetId, Rect2D>()));
    }

    [Fact]
    public void HairBuilder_UsesStablePartIdsSkipsHiddenLayersAndRequiresVerifiedCrops()
    {
        var model = ModelRevisionReference.Restore(ModelId.New(), ModelRevisionId.New(), Revision.Initial, new string('d', 64));
        var backAsset = AssetId.New();
        var rearAsset = AssetId.New();
        var hair = HairStyleDraft.Create(model, "Camadas")
            .WithLayer(HairLayer.Create(HairPartId.BackHair, backAsset, Transform2D.Identity))
            .WithLayer(HairLayer.Create(HairPartId.RearHair, rearAsset, Transform2D.Identity))
            .WithLayerVisibility(HairPartId.RearHair, false);
        var crops = new Dictionary<AssetId, Rect2D> { [backAsset] = new Rect2D(0, 0, 3, 4) };
        var first = Assert.Single(HairStyleRenderSceneBuilder.Build(hair, crops));
        var second = Assert.Single(HairStyleRenderSceneBuilder.Build(hair, crops));
        Assert.Equal(backAsset, first.AssetId);
        Assert.Equal(first.Id, second.Id);
        Assert.Throws<ArgumentException>(() => HairStyleRenderSceneBuilder.Build(
            hair.WithLayerVisibility(HairPartId.RearHair, true), crops));
    }

    private static RenderLayer Layer(AssetId assetId, Rect2D crop, Transform2D transform, int zOrder) =>
        new(RenderLayerId.New(), assetId, crop, transform, 1, RenderBlendMode.Normal, zOrder);

    private static Transform2D At(double x, double y) => new(new Point2D(x, y), new Point2D(1, 1), 0, Point2D.Zero);

    private static byte[] CreateAtlas()
    {
        using var bitmap = new SKBitmap(new SKImageInfo(96, 12, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        var colors = new[] { SKColors.Red, SKColors.Green, SKColors.Blue, SKColors.Yellow,
            SKColors.Magenta, SKColors.Cyan, SKColors.Orange, SKColors.White };
        for (var index = 0; index < colors.Length; index++)
        for (var y = 0; y < 12; y++)
        for (var x = 0; x < 12; x++) bitmap.SetPixel(index * 12 + x, y, colors[index]);
        using var image = SKImage.FromBitmap(bitmap);
        using var encoded = image.Encode(SKEncodedImageFormat.Png, 100)
            ?? throw new InvalidOperationException("Could not encode the synthetic character atlas.");
        return encoded.ToArray();
    }

    private static string FindSourceFixtureDirectory()
    {
        for (var current = new DirectoryInfo(AppContext.BaseDirectory); current is not null; current = current.Parent)
        {
            var candidate = Path.Combine(current.FullName, "tests", "Fixtures", "rendering");
            if (Directory.Exists(candidate)) return candidate;
        }
        throw new DirectoryNotFoundException("Could not find the source rendering fixture directory.");
    }

    private sealed class CompositeFixtureAssetProvider : IRenderAssetProvider, IDisposable
    {
        private readonly byte[] _png;
        private readonly AssetImageCacheKey _key;
        public AssetBitmapCache Cache { get; } = new(1024 * 1024);

        public CompositeFixtureAssetProvider(byte[] png)
        {
            _png = png;
            _key = AssetImageCacheKey.Create(Convert.ToHexString(SHA256.HashData(png)).ToLowerInvariant(), 1);
        }

        public async Task<AssetImageLease> AcquireAsync(AssetId assetId, CancellationToken cancellationToken = default)
        {
            Assert.True(assetId.IsValid);
            var result = await Cache.AcquireAsync(_key, DecodeAsync, cancellationToken);
            Assert.True(result.IsSuccess, result.Error?.Message);
            return result.Lease!;
        }

        private async Task<AssetImageDecodeResult> DecodeAsync(CancellationToken cancellationToken)
        {
            await using var stream = new MemoryStream(_png, writable: false);
            return await new AssetImageDecoder().DecodeAsync(stream, cancellationToken);
        }

        public void Dispose() => Cache.Dispose();
    }
}
