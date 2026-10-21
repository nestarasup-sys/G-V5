using GV5.Assets.Decoding;
using GV5.Assets.Processing;
using GV5.Core.Models;
using SkiaSharp;
using Xunit;

namespace GV5.Assets.Tests;

public sealed class HairRoleTintProcessorTests
{
    [Fact]
    public async Task ProcessAsync_RecolorsOnlyRequestedRoleAndPreservesAlphaAndSource()
    {
        using var source = await DecodeAsync(10, 10, bitmap =>
        {
            bitmap.Erase(SKColors.Transparent);
            for (var y = 0; y < 2; y++)
            for (var x = 0; x < bitmap.Width; x++) bitmap.SetPixel(x, y, new SKColor(20, 20, 20, 255));
            for (var y = 2; y < 4; y++)
            for (var x = 0; x < bitmap.Width; x++) bitmap.SetPixel(x, y, new SKColor(80, 80, 80, 255));
            for (var y = 4; y < 6; y++)
            for (var x = 0; x < bitmap.Width; x++) bitmap.SetPixel(x, y, new SKColor(150, 150, 150, 255));
            for (var y = 6; y < 8; y++)
            for (var x = 0; x < bitmap.Width; x++) bitmap.SetPixel(x, y, new SKColor(240, 240, 240, 255));
            bitmap.SetPixel(9, 5, new SKColor(150, 150, 150, 96));
        });
        var palette = new Dictionary<HairColorRole, SKColor>
        {
            [HairColorRole.Base] = new(10, 200, 80)
        };

        using var result = await new HairRoleTintProcessor().ProcessAsync(source, palette,
            cancellationToken: TestContext.Current.CancellationToken);

        Assert.Equal(new SKColor(10, 200, 80, 255), result.Image.Bitmap.GetPixel(5, 4));
        Assert.Equal((byte)96, result.Image.Bitmap.GetPixel(9, 5).Alpha);
        Assert.NotEqual(source.Bitmap.GetPixel(5, 4), result.Image.Bitmap.GetPixel(5, 4));
        Assert.Equal(new SKColor(150, 150, 150, 255), source.Bitmap.GetPixel(5, 4));
        Assert.Equal(19, result.RoleCounts[HairColorRole.Base]);
        Assert.True(result.RecoloredPixelCount > 0);
        Assert.Equal((byte)0, result.Image.Bitmap.GetPixel(0, 9).Alpha);
    }

    [Fact]
    public async Task ProcessAsync_PreservesNearWhiteUnlessTheRoleIsExplicitlyAllowed()
    {
        using var source = await DecodeAsync(8, 8, bitmap =>
        {
            for (var y = 0; y < 8; y++)
            for (var x = 0; x < 8; x++) bitmap.SetPixel(x, y, new SKColor((byte)(40 + y * 28), (byte)(40 + y * 28), (byte)(40 + y * 28), 255));
        });
        var overrideColor = new Dictionary<HairColorRole, SKColor> { [HairColorRole.Highlight] = new(120, 40, 200) };

        using var preserved = await new HairRoleTintProcessor().ProcessAsync(source, overrideColor,
            new HairRoleTintOptions(PreserveNearWhite: true), TestContext.Current.CancellationToken);
        using var allowed = await new HairRoleTintProcessor().ProcessAsync(source, overrideColor,
            new HairRoleTintOptions(PreserveNearWhite: true, AllowNearWhiteRoles: new HashSet<HairColorRole> { HairColorRole.Highlight }),
            TestContext.Current.CancellationToken);

        Assert.Equal(source.Bitmap.GetPixel(4, 7), preserved.Image.Bitmap.GetPixel(4, 7));
        Assert.NotEqual(source.Bitmap.GetPixel(4, 7), allowed.Image.Bitmap.GetPixel(4, 7));
    }

    [Fact]
    public async Task ProcessAsync_CopiesUntintedSourceAndRejectsUnknownRoles()
    {
        using var source = await DecodeAsync(3, 3, bitmap => bitmap.Erase(new SKColor(30, 120, 180, 128)));
        using var copy = await new HairRoleTintProcessor().ProcessAsync(source,
            cancellationToken: TestContext.Current.CancellationToken);
        Assert.Equal(source.Bitmap.GetPixel(1, 1), copy.Image.Bitmap.GetPixel(1, 1));
        Assert.Equal(0, copy.RecoloredPixelCount);
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => new HairRoleTintProcessor().ProcessAsync(source,
            new Dictionary<HairColorRole, SKColor> { [(HairColorRole)99] = SKColors.Red }));
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
