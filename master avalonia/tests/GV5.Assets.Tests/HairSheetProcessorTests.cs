using GV5.Assets.Decoding;
using GV5.Assets.Processing;
using SkiaSharp;
using Xunit;

namespace GV5.Assets.Tests;

public sealed class HairSheetProcessorTests
{
    [Fact]
    public async Task ProcessAsync_SplitsOddSheetRemovesConnectedGreenCropsAndPreservesSource()
    {
        using var source = await DecodeAsync(10, 9, bitmap =>
        {
            bitmap.Erase(new SKColor(0, 255, 0, 255));
            bitmap.SetPixel(3, 1, new SKColor(40, 20, 180, 255));
            bitmap.SetPixel(4, 2, new SKColor(40, 20, 180, 255));
            bitmap.SetPixel(3, 6, new SKColor(180, 100, 20, 255));
            bitmap.SetPixel(4, 7, new SKColor(180, 100, 20, 255));
        });

        using var result = await new HairSheetProcessor().ProcessAsync(source,
            cancellationToken: TestContext.Current.CancellationToken);

        Assert.Equal(new ImageCropBounds(3, 1, 2, 2), result.Posterior.SourceBounds);
        Assert.Equal(new ImageCropBounds(3, 6, 2, 2), result.Traseiro.SourceBounds);
        Assert.Equal(new SKColor(40, 20, 180, 255), result.Posterior.Image.Bitmap.GetPixel(0, 0));
        Assert.Equal(new SKColor(180, 100, 20, 255), result.Traseiro.Image.Bitmap.GetPixel(0, 0));
        Assert.True(result.Posterior.RemovedPixelCount > 0);
        Assert.Equal(0, result.Posterior.DespilledPixelCount);
        Assert.Equal(new SKColor(0, 255, 0, 255), source.Bitmap.GetPixel(0, 0));
        Assert.Equal(new SKColor(40, 20, 180, 255), source.Bitmap.GetPixel(3, 1));
    }

    [Fact]
    public async Task ProcessAsync_PreservesGreenPixelsEnclosedByHairSilhouette()
    {
        using var source = await DecodeAsync(9, 12, bitmap =>
        {
            bitmap.Erase(new SKColor(0, 255, 0, 255));
            for (var y = 1; y <= 4; y++)
            for (var x = 2; x <= 6; x++) bitmap.SetPixel(x, y, new SKColor(30, 30, 30, 255));
            bitmap.SetPixel(4, 2, new SKColor(0, 255, 0, 255));
        });

        using var result = await new HairSheetProcessor().ProcessAsync(source,
            new HairSheetOptions(Tolerance: 70, Mode: HairBackgroundMode.Green),
            TestContext.Current.CancellationToken);

        Assert.Equal((byte)255, result.Posterior.Image.Bitmap.GetPixel(2, 1).Alpha);
        Assert.Equal((byte)255, result.Posterior.Image.Bitmap.GetPixel(2, 1).Alpha);
    }

    [Fact]
    public async Task ProcessAsync_RemovesCheckerConnectedToBorderAndKeepsSubject()
    {
        using var source = await DecodeAsync(12, 10, bitmap =>
        {
            for (var y = 0; y < bitmap.Height; y++)
            for (var x = 0; x < bitmap.Width; x++)
            {
                var checker = ((x / 2) + (y / 2)) % 2 == 0 ? (byte)220 : (byte)180;
                bitmap.SetPixel(x, y, new SKColor(checker, checker, checker, 255));
            }
            for (var y = 1; y <= 3; y++)
            for (var x = 4; x <= 7; x++) bitmap.SetPixel(x, y, new SKColor(30, 40, 160, 255));
        });

        using var result = await new HairSheetProcessor().ProcessAsync(source,
            new HairSheetOptions(Mode: HairBackgroundMode.Checker), TestContext.Current.CancellationToken);

        Assert.False(result.Posterior.IsEmpty);
        Assert.Equal(new SKColor(30, 40, 160, 255), result.Posterior.Image.Bitmap.GetPixel(0, 0));
        Assert.True(result.Posterior.RemovedPixelCount > 0);
        Assert.Equal((byte)255, source.Bitmap.GetPixel(0, 0).Alpha);
    }

    [Fact]
    public async Task ProcessAsync_ProducesTypedEmptyHalfAndHonorsCancellationAndLimits()
    {
        using var empty = await DecodeAsync(5, 4, bitmap => bitmap.Erase(new SKColor(0, 255, 0, 255)));
        using var result = await new HairSheetProcessor().ProcessAsync(empty,
            cancellationToken: TestContext.Current.CancellationToken);
        Assert.True(result.Posterior.IsEmpty);
        Assert.True(result.Traseiro.IsEmpty);
        Assert.Equal(1, result.Posterior.Image.Width);

        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            new HairSheetProcessor().ProcessAsync(empty, cancellationToken: cancellation.Token));
        Assert.Throws<ArgumentOutOfRangeException>(() => new HairSheetOptions(Tolerance: 101).Validate());
        Assert.Throws<ArgumentOutOfRangeException>(() => new HairSheetOptions(Mode: (HairBackgroundMode)99).Validate());
    }

    private static async Task<DecodedAssetImage> DecodeAsync(int width, int height, Action<SKBitmap> paint)
    {
        using var bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        paint(bitmap);
        using var encoded = bitmap.Encode(SKEncodedImageFormat.Png, 100);
        using var stream = new MemoryStream(encoded!.ToArray());
        var decoded = await new AssetImageDecoder().DecodeAsync(stream, TestContext.Current.CancellationToken);
        Assert.True(decoded.IsSuccess, decoded.Error?.Message);
        return decoded.Image!;
    }
}
