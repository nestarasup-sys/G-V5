using GV5.Application.Contracts;
using GV5.Assets.Decoding;
using GV5.Assets.Import;
using GV5.Assets.Processing;
using GV5.Modules.Fabricador.Import;
using SkiaSharp;
using Xunit;

namespace GV5.Headless.Tests;

public sealed class FaceSheetImportTests
{
    [Fact]
    public async Task EyebrowSheet_PreparesTwoReviewableTransparentSidesAndCleansStagesAfterDispose()
    {
        var root = Path.Combine(Path.GetTempPath(), $"gv5-face-import-{Guid.NewGuid():N}");
        var bytes = CreatePng(bitmap =>
        {
            bitmap.Erase(new SKColor(0, 255, 0, 255));
            Paint(bitmap, 2, 3, new SKColor(30, 25, 20, 255));
            Paint(bitmap, 12, 3, new SKColor(50, 35, 25, 255));
        }, 18, 10);

        try
        {
            var result = await CreateService(root).PrepareAsync(new MemoryStream(bytes), "image/png",
                FaceSheetKind.Eyebrows, cancellationToken: TestContext.Current.CancellationToken);
            Assert.True(result.IsSuccess, result.Error?.Message);
            var preview = result.Value;
            Assert.Equal(FaceSheetKind.Eyebrows, preview.Kind);
            Assert.Equal((18, 10), (preview.SourceWidth, preview.SourceHeight));
            Assert.Equal(bytes.LongLength, preview.OriginalByteLength);
            Assert.True(preview.RemovedPixelCount > 0);
            Assert.Collection(preview.Pieces,
                piece => AssertEyebrow(piece, FaceSheetSide.Left, new SKColor(30, 25, 20, 255)),
                piece => AssertEyebrow(piece, FaceSheetSide.Right, new SKColor(50, 35, 25, 255)));
            Assert.Equal(3, Directory.GetFiles(Path.Combine(root, "staging"), "*.stage").Length);

            await using (var original = await preview.OpenOriginalReadAsync(TestContext.Current.CancellationToken))
            using (var copy = new MemoryStream())
            {
                await original.CopyToAsync(copy, TestContext.Current.CancellationToken);
                Assert.Equal(bytes, copy.ToArray());
            }

            await using (var png = await preview.Pieces[0].OpenPngReadAsync(TestContext.Current.CancellationToken))
            {
                var decoded = await new AssetImageDecoder().DecodeAsync(png, TestContext.Current.CancellationToken);
                Assert.True(decoded.IsSuccess, decoded.Error?.Message);
                using var image = decoded.Image!;
                Assert.Equal(new SKColor(30, 25, 20, 255), image.Bitmap.GetPixel(0, 0));
                Assert.Equal(255, image.Bitmap.GetPixel(0, 0).Alpha);
            }

            await preview.DisposeAsync();
            Assert.Empty(Directory.GetFiles(Path.Combine(root, "staging"), "*.stage"));
            Assert.Throws<ObjectDisposedException>(() => _ = preview.Pieces);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task EyebrowSheet_MissingSideAndCancellationLeaveNoStagedFiles()
    {
        var root = Path.Combine(Path.GetTempPath(), $"gv5-face-import-{Guid.NewGuid():N}");
        var onlyLeft = CreatePng(bitmap =>
        {
            bitmap.Erase(new SKColor(0, 255, 0, 255));
            Paint(bitmap, 3, 3, new SKColor(40, 30, 20, 255));
        }, 12, 10);

        try
        {
            var service = CreateService(root);
            var rejected = await service.PrepareAsync(new MemoryStream(onlyLeft), "image/png", FaceSheetKind.Eyebrows,
                cancellationToken: TestContext.Current.CancellationToken);
            Assert.True(rejected.IsFailure);
            Assert.Equal(ApplicationErrorCode.Validation, rejected.Error!.Code);
            Assert.Empty(Directory.GetFiles(Path.Combine(root, "staging"), "*.stage"));

            using var cancellation = new CancellationTokenSource();
            cancellation.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.PrepareAsync(
                new MemoryStream(onlyLeft), "image/png", FaceSheetKind.Eyebrows, cancellationToken: cancellation.Token));
            Assert.Empty(Directory.GetFiles(Path.Combine(root, "staging"), "*.stage"));
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    private static void AssertEyebrow(FaceSheetImportPiecePreview piece, FaceSheetSide expectedSide, SKColor expectedColor)
    {
        Assert.Equal(FaceSheetPartKind.Eyebrow, piece.PartKind);
        Assert.Equal(expectedSide, piece.Side);
        Assert.Equal(0, piece.Index);
        Assert.Equal((3, 3), (piece.Width, piece.Height));
        Assert.Equal(expectedColor, piece.Preview.Bitmap.GetPixel(0, 0));
        Assert.Equal(3, piece.Preview.Width);
        Assert.True(piece.PngByteLength > 0);
        Assert.Equal(64, piece.PngSha256.Length);
    }

    private static FaceSheetImportService CreateService(string root) => new(
        new AssetImportStager(Path.Combine(root, "staging"), new AssetImportLimits(8 * 1024 * 1024, 8192, 32_000_000)),
        new AssetImageDecoder(new AssetImageDecodeLimits(8192, 32_000_000, 128L * 1024 * 1024)),
        new FaceSheetProcessor());

    private static byte[] CreatePng(Action<SKBitmap> paint, int width, int height)
    {
        using var bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        paint(bitmap);
        using var encoded = bitmap.Encode(SKEncodedImageFormat.Png, 100);
        return encoded!.ToArray();
    }

    private static void Paint(SKBitmap bitmap, int x, int y, SKColor color)
    {
        for (var row = y; row < y + 3; row++)
        for (var column = x; column < x + 3; column++) bitmap.SetPixel(column, row, color);
    }
}
