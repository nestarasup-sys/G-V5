using GV5.Assets.Decoding;
using SkiaSharp;
using Xunit;

namespace GV5.Assets.Tests;

public sealed class AssetImageDecoderTests
{
    [Fact]
    public async Task DecodeAsync_PngPreservesTransparentPixelsAndCallerOwnsStream()
    {
        var bytes = EncodeImage(SKEncodedImageFormat.Png, (bitmap) =>
        {
            bitmap.SetPixel(0, 0, new SKColor(240, 20, 40, 0));
            bitmap.SetPixel(1, 0, new SKColor(20, 40, 230, 255));
        });
        using var input = new MemoryStream(bytes);

        var result = await new AssetImageDecoder().DecodeAsync(input, TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess, result.Error?.Message);
        using var image = result.Image!;
        Assert.True(image.HasAlpha);
        Assert.Equal(2, image.Width);
        Assert.Equal(1, image.Height);
        Assert.Equal((byte)0, image.Bitmap.GetPixel(0, 0).Alpha);
        Assert.Equal((byte)255, image.Bitmap.GetPixel(1, 0).Alpha);
        Assert.True(input.CanRead);
    }

    [Theory]
    [InlineData(SKEncodedImageFormat.Jpeg)]
    [InlineData(SKEncodedImageFormat.Webp)]
    public async Task DecodeAsync_DecodesJpegAndWebp(SKEncodedImageFormat format)
    {
        var bytes = EncodeImage(format, bitmap => bitmap.SetPixel(0, 0, SKColors.CornflowerBlue));
        using var input = new MemoryStream(bytes);

        var result = await new AssetImageDecoder().DecodeAsync(input, TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess, result.Error?.Message);
        using var image = result.Image!;
        Assert.Equal(2, image.Width);
        Assert.Equal(1, image.Height);
        Assert.True(image.Bitmap.GetPixel(0, 0).Blue > image.Bitmap.GetPixel(0, 0).Red);
        Assert.Equal(format == SKEncodedImageFormat.Webp ? (byte)0 : (byte)255, image.Bitmap.GetPixel(1, 0).Alpha);
    }

    [Theory]
    [InlineData(1, false, "red", "green", "blue", "yellow")]
    [InlineData(2, false, "green", "red", "yellow", "blue")]
    [InlineData(3, false, "yellow", "blue", "green", "red")]
    [InlineData(4, false, "blue", "yellow", "red", "green")]
    [InlineData(5, true, "red", "blue", "green", "yellow")]
    [InlineData(6, true, "blue", "red", "yellow", "green")]
    [InlineData(7, true, "yellow", "green", "blue", "red")]
    [InlineData(8, true, "green", "yellow", "red", "blue")]
    public async Task DecodeAsync_AppliesAllExifOrientations(
        ushort orientation,
        bool swapsAxes,
        string topLeft,
        string topRight,
        string bottomLeft,
        string bottomRight)
    {
        var jpeg = EncodeImage(SKEncodedImageFormat.Jpeg, bitmap =>
        {
            for (var y = 0; y < bitmap.Height; y++)
            for (var x = 0; x < bitmap.Width; x++)
            {
                bitmap.SetPixel(x, y, (x < bitmap.Width / 2, y < bitmap.Height / 2) switch
                {
                    (true, true) => SKColors.Red,
                    (false, true) => SKColors.Lime,
                    (true, false) => SKColors.Blue,
                    _ => SKColors.Yellow
                });
            }
        }, width: 16, height: 12);
        var orientedJpeg = AddExifOrientation(jpeg, orientation);
        using var input = new MemoryStream(orientedJpeg);

        var result = await new AssetImageDecoder().DecodeAsync(input, TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess, result.Error?.Message);
        using var image = result.Image!;
        Assert.Equal(swapsAxes ? 12 : 16, image.Width);
        Assert.Equal(swapsAxes ? 16 : 12, image.Height);
        AssertColor(image.Bitmap.GetPixel(image.Width / 4, image.Height / 4), topLeft);
        AssertColor(image.Bitmap.GetPixel(image.Width * 3 / 4, image.Height / 4), topRight);
        AssertColor(image.Bitmap.GetPixel(image.Width / 4, image.Height * 3 / 4), bottomLeft);
        AssertColor(image.Bitmap.GetPixel(image.Width * 3 / 4, image.Height * 3 / 4), bottomRight);
    }

    [Fact]
    public async Task DecodeAsync_ReturnsTypedErrorsForMalformedAndOversizedImages()
    {
        using var malformed = new MemoryStream([0x01, 0x02, 0x03, 0x04]);
        var malformedResult = await new AssetImageDecoder().DecodeAsync(malformed, TestContext.Current.CancellationToken);
        Assert.True(malformedResult.IsFailure);
        Assert.Contains(malformedResult.Error!.Code, new[] { AssetImageDecodeErrorCode.InvalidImage, AssetImageDecodeErrorCode.UnsupportedFormat });

        var bytes = EncodeImage(SKEncodedImageFormat.Png, _ => { });
        using var input = new MemoryStream(bytes);
        var oversized = await new AssetImageDecoder(new AssetImageDecodeLimits(MaximumDimension: 1)).DecodeAsync(input, TestContext.Current.CancellationToken);
        Assert.True(oversized.IsFailure);
        Assert.Equal(AssetImageDecodeErrorCode.ImageTooLarge, oversized.Error!.Code);
    }

    [Fact]
    public async Task DecodeAsync_RejectsNonSeekableStreamWithInputError()
    {
        using var stream = new NonSeekableStream(EncodeImage(SKEncodedImageFormat.Png, _ => { }));

        var result = await new AssetImageDecoder().DecodeAsync(stream, TestContext.Current.CancellationToken);

        Assert.True(result.IsFailure);
        Assert.Equal(AssetImageDecodeErrorCode.InvalidInput, result.Error!.Code);
    }

    [Fact]
    public async Task DecodeAsync_HonorsCancellationBeforeDecodeStarts()
    {
        using var input = new MemoryStream(EncodeImage(SKEncodedImageFormat.Png, _ => { }));
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => new AssetImageDecoder().DecodeAsync(input, cancellation.Token));
    }

    private static byte[] EncodeImage(SKEncodedImageFormat format, Action<SKBitmap> paint, int width = 2, int height = 1)
    {
        using var bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        bitmap.Erase(SKColors.Transparent);
        paint(bitmap);
        using var encoded = bitmap.Encode(format, 100);
        Assert.NotNull(encoded);
        return encoded!.ToArray();
    }

    private static byte[] AddExifOrientation(byte[] jpeg, ushort orientation)
    {
        Assert.Equal(new byte[] { 0xFF, 0xD8 }, jpeg[..2]);
        Assert.Equal(new byte[] { 0xFF, 0xE0 }, jpeg[2..4]);
        var firstSegmentLength = (jpeg[4] << 8) | jpeg[5];
        var app0End = 4 + firstSegmentLength;
        using var segment = new MemoryStream();
        segment.Write([0xFF, 0xE1, 0x00, 0x22]);
        segment.Write("Exif\0\0"u8);
        segment.Write([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00]);
        segment.Write([0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00]);
        segment.Write([(byte)orientation, (byte)(orientation >> 8), 0x00, 0x00]);
        segment.Write([0x00, 0x00, 0x00, 0x00]);
        using var oriented = new MemoryStream();
        oriented.Write(jpeg, 0, app0End);
        oriented.Write(segment.ToArray());
        oriented.Write(jpeg, app0End, jpeg.Length - app0End);
        return oriented.ToArray();
    }

    private static void AssertColor(SKColor actual, string expected)
    {
        var matches = expected switch
        {
            "red" => actual.Red > 150 && actual.Red > actual.Green * 1.5 && actual.Red > actual.Blue * 1.5,
            "green" => actual.Green > 150 && actual.Green > actual.Red * 1.5 && actual.Green > actual.Blue * 1.5,
            "blue" => actual.Blue > 150 && actual.Blue > actual.Red * 1.5 && actual.Blue > actual.Green * 1.5,
            "yellow" => actual.Red > 150 && actual.Green > 150 && actual.Blue < 120,
            _ => false
        };
        Assert.True(matches, $"Expected {expected} pixel, received {actual}.");
    }

    private sealed class NonSeekableStream(byte[] bytes) : MemoryStream(bytes)
    {
        public override bool CanSeek => false;
    }
}
