using GV5.Assets.Decoding;
using GV5.Assets.Processing;
using SkiaSharp;
using Xunit;

namespace GV5.Assets.Tests;

public sealed class FaceSheetProcessorTests
{
    [Fact]
    public async Task ProcessEyes_SplitsEyePupilAndClosedEyeIntoLeftRightAndPreservesSource()
    {
        using var source = await DecodeAsync(28, 34, bitmap =>
        {
            bitmap.Erase(new SKColor(0, 255, 0));
            for (var row = 0; row < 3; row++)
            {
                PaintCell(bitmap, 2, 2 + row * 11, new SKColor((byte)(40 + row * 50), 30, 160));
                PaintCell(bitmap, 20, 2 + row * 11, new SKColor((byte)(60 + row * 50), 40, 170));
            }
        });

        using var result = await new FaceSheetProcessor().ProcessAsync(source, FaceSheetKind.Eyes,
            cancellationToken: TestContext.Current.CancellationToken);

        Assert.Equal(6, result.Pieces.Count);
        Assert.Collection(result.Pieces,
            piece => AssertPiece(piece, FaceSheetPartKind.Eye, 0, FaceSheetSide.Left, new SKColor(40, 30, 160)),
            piece => AssertPiece(piece, FaceSheetPartKind.Eye, 0, FaceSheetSide.Right, new SKColor(60, 40, 170)),
            piece => AssertPiece(piece, FaceSheetPartKind.Pupil, 1, FaceSheetSide.Left, new SKColor(90, 30, 160)),
            piece => AssertPiece(piece, FaceSheetPartKind.Pupil, 1, FaceSheetSide.Right, new SKColor(110, 40, 170)),
            piece => AssertPiece(piece, FaceSheetPartKind.ClosedEye, 2, FaceSheetSide.Left, new SKColor(140, 30, 160)),
            piece => AssertPiece(piece, FaceSheetPartKind.ClosedEye, 2, FaceSheetSide.Right, new SKColor(160, 40, 170)));
        Assert.True(result.RemovedPixelCount > 0);
        Assert.Equal(new SKColor(0, 255, 0), source.Bitmap.GetPixel(0, 0));
        Assert.Equal(new SKColor(40, 30, 160), source.Bitmap.GetPixel(3, 3));
    }

    [Fact]
    public async Task ProcessMouthSheet_SplitsAllTwentyOneVariantsInRowMajorOrder()
    {
        using var source = await DecodeAsync(40, 16, bitmap =>
        {
            bitmap.Erase(new SKColor(0, 255, 0));
            for (var index = 0; index < 21; index++)
            {
                var row = index / 7;
                var column = index % 7;
                PaintCell(bitmap, column * 6 + 1, row * 6 + 1,
                    new SKColor((byte)(45 + index * 7), 20, 180));
            }
        });

        using var result = await new FaceSheetProcessor().ProcessAsync(source, FaceSheetKind.MouthOpen,
            cancellationToken: TestContext.Current.CancellationToken);

        Assert.Equal(21, result.Pieces.Count);
        for (var index = 0; index < 21; index++)
        {
            var piece = result.Pieces[index];
            Assert.Equal(FaceSheetPartKind.Mouth, piece.PartKind);
            Assert.Equal(index, piece.Index);
            Assert.Null(piece.Side);
            Assert.Equal(new SKColor((byte)(45 + index * 7), 20, 180), piece.Image.Bitmap.GetPixel(0, 0));
            Assert.Equal(3, piece.Image.Width);
            Assert.Equal(3, piece.Image.Height);
        }
    }

    [Fact]
    public async Task ProcessNoseSheet_AutoDetectsSixCellsAndFallsBackToSinglePiece()
    {
        using var six = await DecodeAsync(22, 14, bitmap =>
        {
            bitmap.Erase(new SKColor(0, 255, 0));
            for (var index = 0; index < 6; index++)
                PaintCell(bitmap, (index % 3) * 7 + 1, (index / 3) * 7 + 1,
                    new SKColor((byte)(40 + index * 20), 25, 140));
        });
        using var detected = await new FaceSheetProcessor().ProcessAsync(six, FaceSheetKind.Nose,
            cancellationToken: TestContext.Current.CancellationToken);
        Assert.Equal(6, detected.Pieces.Count);
        Assert.Equal(Enumerable.Range(0, 6), detected.Pieces.Select(piece => piece.Index));

        using var one = await DecodeAsync(12, 12, bitmap =>
        {
            bitmap.Erase(new SKColor(0, 255, 0));
            PaintCell(bitmap, 4, 4, new SKColor(100, 30, 150));
        });
        using var single = await new FaceSheetProcessor().ProcessAsync(one, FaceSheetKind.Nose,
            cancellationToken: TestContext.Current.CancellationToken);
        Assert.Single(single.Pieces);
        Assert.Equal(new SKColor(100, 30, 150), single.Pieces[0].Image.Bitmap.GetPixel(0, 0));
    }

    [Fact]
    public async Task ProcessAsync_RejectsEmptySheetAndHonorsCancellationAndOptions()
    {
        using var empty = await DecodeAsync(4, 4, bitmap => bitmap.Erase(SKColors.Transparent));
        await Assert.ThrowsAsync<InvalidDataException>(() => new FaceSheetProcessor().ProcessAsync(empty,
            FaceSheetKind.MouthClosed, cancellationToken: TestContext.Current.CancellationToken));

        using var canceled = new CancellationTokenSource();
        canceled.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => new FaceSheetProcessor().ProcessAsync(empty,
            FaceSheetKind.Eyes, cancellationToken: canceled.Token));
        Assert.Throws<ArgumentOutOfRangeException>(() => new FaceSheetOptions(Tolerance: 281).Validate());
        Assert.Throws<ArgumentOutOfRangeException>(() => new FaceSheetOptions(NoseMode: (FaceNoseSheetMode)99).Validate());
    }

    private static void AssertPiece(FaceSheetPieceResult piece, FaceSheetPartKind kind, int index,
        FaceSheetSide side, SKColor expectedColor)
    {
        Assert.Equal(kind, piece.PartKind);
        Assert.Equal(index, piece.Index);
        Assert.Equal(side, piece.Side);
        Assert.Equal(expectedColor, piece.Image.Bitmap.GetPixel(0, 0));
        Assert.Equal(3, piece.Image.Width);
        Assert.Equal(3, piece.Image.Height);
    }

    private static void PaintCell(SKBitmap bitmap, int x, int y, SKColor color)
    {
        for (var row = y; row < y + 3; row++)
        for (var column = x; column < x + 3; column++) bitmap.SetPixel(column, row, color);
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
