using GV5.Assets.Decoding;
using GV5.Assets.Processing;
using SkiaSharp;
using Xunit;

namespace GV5.Assets.Tests;

public sealed class TransparentImageCropProcessorTests
{
    [Fact]
    public async Task ProcessAsyncTrimsOnlyTransparentMarginsAndPreservesVisibleRgba()
    {
        using var source = await DecodeAsync(12, 10, bitmap =>
        {
            bitmap.Erase(SKColors.Transparent);
            bitmap.SetPixel(3, 4, new SKColor(210, 40, 80, 128));
            bitmap.SetPixel(5, 6, new SKColor(10, 120, 240, 255));
        });

        using var crop = await new TransparentImageCropProcessor().ProcessAsync(source, margin: 1,
            TestContext.Current.CancellationToken);

        Assert.False(crop.IsEmpty);
        Assert.Equal(new ImageCropBounds(2, 3, 5, 5), crop.SourceBounds);
        Assert.Equal(5, crop.Image.Width);
        Assert.Equal(5, crop.Image.Height);
        Assert.Equal(new SKColor(210, 40, 80, 128), crop.Image.Bitmap.GetPixel(1, 1));
        Assert.Equal(new SKColor(10, 120, 240, 255), crop.Image.Bitmap.GetPixel(3, 3));
        Assert.Equal((byte)0, crop.Image.Bitmap.GetPixel(0, 0).Alpha);
        Assert.Equal(new SKColor(210, 40, 80, 128), source.Bitmap.GetPixel(3, 4));
    }

    [Fact]
    public async Task ProcessAsyncReportsEmptyTransparencyAndEncodesPng()
    {
        using var source = await DecodeAsync(5, 4, bitmap => bitmap.Erase(SKColors.Transparent));
        using var empty = await new TransparentImageCropProcessor().ProcessAsync(source,
            cancellationToken: TestContext.Current.CancellationToken);

        Assert.True(empty.IsEmpty);
        Assert.True(empty.SourceBounds.IsEmpty);
        Assert.Equal((byte)0, empty.Image.Bitmap.GetPixel(0, 0).Alpha);
        var encoded = empty.EncodePng();
        Assert.True(encoded.Length > 0);
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => new TransparentImageCropProcessor().ProcessAsync(
            source, margin: 65, cancellationToken: TestContext.Current.CancellationToken));
    }

    private static async Task<DecodedAssetImage> DecodeAsync(int width, int height, Action<SKBitmap> paint)
    {
        using var bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        paint(bitmap);
        using var encoded = bitmap.Encode(SKEncodedImageFormat.Png, 100);
        using var stream = new MemoryStream(encoded!.ToArray());
        var result = await new AssetImageDecoder().DecodeAsync(stream, TestContext.Current.CancellationToken);
        Assert.True(result.IsSuccess, result.Error?.Message);
        return result.Image!;
    }
}
