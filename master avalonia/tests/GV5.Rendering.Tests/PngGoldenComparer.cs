using SkiaSharp;

namespace GV5.Rendering.Tests;

internal sealed record PngComparisonResult(
    int Width,
    int Height,
    int DifferentPixels,
    double MeanAbsoluteChannelError,
    string ComparisonPngPath);

/// <summary>Creates a side-by-side expected/actual/difference PNG for deterministic renderer tests.</summary>
internal static class PngGoldenComparer
{
    public static PngComparisonResult Compare(SKBitmap expected, SKBitmap actual, string comparisonPngPath, byte channelTolerance = 0)
    {
        ArgumentNullException.ThrowIfNull(expected);
        ArgumentNullException.ThrowIfNull(actual);
        ArgumentException.ThrowIfNullOrWhiteSpace(comparisonPngPath);
        if (expected.Width != actual.Width || expected.Height != actual.Height)
        {
            throw new ArgumentException("Expected and actual PNG dimensions must match.", nameof(actual));
        }

        using var comparison = new SKBitmap(new SKImageInfo(expected.Width * 3, expected.Height, SKColorType.Rgba8888, SKAlphaType.Premul));
        long totalChannelError = 0;
        var differentPixels = 0;

        for (var y = 0; y < expected.Height; y++)
        {
            for (var x = 0; x < expected.Width; x++)
            {
                var expectedPixel = expected.GetPixel(x, y);
                var actualPixel = actual.GetPixel(x, y);
                comparison.SetPixel(x, y, expectedPixel);
                comparison.SetPixel(x + expected.Width, y, actualPixel);

                var redError = Math.Abs(expectedPixel.Red - actualPixel.Red);
                var greenError = Math.Abs(expectedPixel.Green - actualPixel.Green);
                var blueError = Math.Abs(expectedPixel.Blue - actualPixel.Blue);
                var alphaError = Math.Abs(expectedPixel.Alpha - actualPixel.Alpha);
                var maximumError = Math.Max(Math.Max(redError, greenError), Math.Max(blueError, alphaError));
                totalChannelError += redError + greenError + blueError + alphaError;
                if (maximumError > channelTolerance)
                {
                    differentPixels++;
                    var intensity = (byte)Math.Min(255, maximumError * 4);
                    comparison.SetPixel(x + expected.Width * 2, y, new SKColor(intensity, 0, 0, 255));
                }
                else
                {
                    comparison.SetPixel(x + expected.Width * 2, y, SKColors.Black);
                }
            }
        }

        var directory = Path.GetDirectoryName(comparisonPngPath);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        using var image = SKImage.FromBitmap(comparison);
        using var encoded = image.Encode(SKEncodedImageFormat.Png, 100)
            ?? throw new InvalidOperationException("Skia could not encode the PNG comparison artifact.");
        File.WriteAllBytes(comparisonPngPath, encoded.ToArray());

        var meanError = totalChannelError / (double)(expected.Width * expected.Height * 4);
        return new PngComparisonResult(expected.Width, expected.Height, differentPixels, meanError, comparisonPngPath);
    }
}
