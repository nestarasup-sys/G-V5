using GV5.Assets.Decoding;
using GV5.Assets.Processing;
using SkiaSharp;
using Xunit;

namespace GV5.Assets.Tests;

public sealed class ChromaCropProcessorTests
{
    [Fact]
    public async Task ProcessAsync_RemovesGreenAndCropsVisiblePixelsWithRecoverableMargin()
    {
        using var source = await DecodeAsync(20, 12, (bitmap) =>
        {
            bitmap.Erase(new SKColor(0, 255, 0, 255));
            for (var y = 5; y <= 8; y++)
            for (var x = 7; x <= 10; x++)
            {
                bitmap.SetPixel(x, y, new SKColor(220, 30, 40, 255));
            }
        });

        using var result = await new ChromaCropProcessor().ProcessAsync(source, new ChromaCropOptions(Tolerance: 30, Feather: 0), TestContext.Current.CancellationToken);

        Assert.False(result.IsEmpty);
        Assert.Equal(new ImageCropBounds(3, 1, 12, 11), result.SourceBounds);
        Assert.Equal(new SKColor(0, 255, 0), result.SampledBackground);
        Assert.Equal(224, result.RemovedPixelCount);
        Assert.Equal(12, result.Image.Width);
        Assert.Equal(11, result.Image.Height);
        Assert.Equal((byte)0, result.Image.Bitmap.GetPixel(0, 0).Alpha);
        Assert.Equal(new SKColor(220, 30, 40, 255), result.Image.Bitmap.GetPixel(4, 4));
        Assert.Equal(20, source.Width);
        Assert.Equal(new SKColor(0, 255, 0, 255), source.Bitmap.GetPixel(0, 0));
    }

    [Fact]
    public async Task ProcessAsync_ClampsCropAtImageEdgesAndKeepsSoftMatteAlpha()
    {
        using var source = await DecodeAsync(10, 10, bitmap =>
        {
            bitmap.Erase(new SKColor(0, 255, 0, 255));
            bitmap.SetPixel(0, 0, new SKColor(220, 30, 40, 255));
            bitmap.SetPixel(1, 0, new SKColor(25, 255, 0, 255));
        });

        using var result = await new ChromaCropProcessor().ProcessAsync(source, new ChromaCropOptions(Tolerance: 10, Feather: 44), TestContext.Current.CancellationToken);

        Assert.Equal(new ImageCropBounds(0, 0, 6, 5), result.SourceBounds);
        Assert.Equal(6, result.Image.Width);
        Assert.Equal(5, result.Image.Height);
        Assert.InRange(result.Image.Bitmap.GetPixel(1, 0).Alpha, (byte)70, (byte)160);
        Assert.Equal((byte)255, result.Image.Bitmap.GetPixel(0, 0).Alpha);
        Assert.True(result.DespilledPixelCount >= 1);
    }

    [Fact]
    public async Task ProcessAsync_ReturnsTypedEmptyImageWhenEntireSheetMatchesBackground()
    {
        using var source = await DecodeAsync(8, 6, bitmap => bitmap.Erase(new SKColor(0, 255, 0, 255)));

        using var result = await new ChromaCropProcessor().ProcessAsync(source, new ChromaCropOptions(Tolerance: 0, Feather: 0), TestContext.Current.CancellationToken);

        Assert.True(result.IsEmpty);
        Assert.True(result.SourceBounds.IsEmpty);
        Assert.Equal(1, result.Image.Width);
        Assert.Equal(1, result.Image.Height);
        Assert.Equal((byte)0, result.Image.Bitmap.GetPixel(0, 0).Alpha);
    }

    [Fact]
    public async Task ProcessAsync_HonorsCancellationAndRejectsInvalidOptions()
    {
        using var source = await DecodeAsync(4, 4, bitmap => bitmap.Erase(SKColors.White));
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            new ChromaCropProcessor().ProcessAsync(source, cancellationToken: cancellation.Token));
        Assert.Throws<ArgumentOutOfRangeException>(() => new ChromaCropOptions(Tolerance: 281).Validate());
        Assert.Throws<ArgumentOutOfRangeException>(() => new ChromaCropOptions(CropMargin: 65).Validate());
    }

    private static async Task<DecodedAssetImage> DecodeAsync(int width, int height, Action<SKBitmap> paint)
    {
        using var source = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        paint(source);
        using var encoded = source.Encode(SKEncodedImageFormat.Png, 100);
        using var stream = new MemoryStream(encoded.ToArray());
        var decoded = await new AssetImageDecoder().DecodeAsync(stream, TestContext.Current.CancellationToken);
        Assert.True(decoded.IsSuccess, decoded.Error?.Message);
        return decoded.Image!;
    }
}
