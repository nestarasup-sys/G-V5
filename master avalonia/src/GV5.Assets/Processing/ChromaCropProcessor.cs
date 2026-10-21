using System.Runtime.InteropServices;
using SkiaSharp;
using GV5.Assets.Decoding;

namespace GV5.Assets.Processing;

/// <summary>Controls chroma removal and the transparent crop applied to an imported model sheet.</summary>
public sealed record ChromaCropOptions(int Tolerance = 74, int Feather = 44, int CropMargin = 4)
{
    public void Validate()
    {
        if (Tolerance is < 0 or > 280)
        {
            throw new ArgumentOutOfRangeException(nameof(Tolerance), "Chroma tolerance must be between 0 and 280.");
        }
        if (Feather is < 0 or > 255)
        {
            throw new ArgumentOutOfRangeException(nameof(Feather), "Chroma feather must be between 0 and 255.");
        }
        if (CropMargin is < 0 or > 64)
        {
            throw new ArgumentOutOfRangeException(nameof(CropMargin), "Crop margin must be between 0 and 64 pixels.");
        }
    }
}

/// <summary>Integer crop rectangle in the coordinate space of the original model sheet.</summary>
public readonly record struct ImageCropBounds(int X, int Y, int Width, int Height)
{
    public bool IsEmpty => Width == 0 || Height == 0;
}

/// <summary>Owns the cropped output. Dispose the result when its image is no longer needed.</summary>
public sealed class ChromaCropResult : IDisposable
{
    private int _disposed;

    internal ChromaCropResult(
        DecodedAssetImage image,
        ImageCropBounds sourceBounds,
        SKColor sampledBackground,
        int removedPixelCount,
        int despilledPixelCount,
        bool isEmpty)
    {
        Image = image;
        SourceBounds = sourceBounds;
        SampledBackground = sampledBackground;
        RemovedPixelCount = removedPixelCount;
        DespilledPixelCount = despilledPixelCount;
        IsEmpty = isEmpty;
    }

    public DecodedAssetImage Image { get; }
    public ImageCropBounds SourceBounds { get; }
    public SKColor SampledBackground { get; }
    public int RemovedPixelCount { get; }
    public int DespilledPixelCount { get; }
    public bool IsEmpty { get; }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 0)
        {
            Image.Dispose();
        }
    }
}

/// <summary>
/// Removes a sampled background, softens its edge, despills green and trims transparent borders.
/// Work runs on a background thread and checks cancellation between pixel rows. The source image
/// remains caller-owned and must not be disposed or mutated until the returned task completes.
/// </summary>
public sealed class ChromaCropProcessor
{
    private const int MinimumVisibleAlpha = 24;
    private const int DespillRadius = 150;

    public Task<ChromaCropResult> ProcessAsync(
        DecodedAssetImage source,
        ChromaCropOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);
        var validatedOptions = options ?? new ChromaCropOptions();
        validatedOptions.Validate();
        cancellationToken.ThrowIfCancellationRequested();

        return Task.Run(() => ProcessCore(source.Bitmap, validatedOptions, cancellationToken), CancellationToken.None);
    }

    private static ChromaCropResult ProcessCore(SKBitmap source, ChromaCropOptions options, CancellationToken cancellationToken)
    {
        if (source.ColorType != SKColorType.Rgba8888 || source.AlphaType != SKAlphaType.Unpremul)
        {
            throw new ArgumentException("Chroma processing requires an RGBA8888, unpremultiplied decoded image.", nameof(source));
        }

        cancellationToken.ThrowIfCancellationRequested();
        using var processed = source.Copy() ?? throw new InvalidOperationException("The model sheet could not be copied for chroma processing.");
        if (processed.GetPixels() == IntPtr.Zero)
        {
            throw new InvalidOperationException("The model sheet pixel buffer could not be allocated.");
        }

        var background = SampleBackground(source, cancellationToken);
        var removedPixels = ApplyChroma(processed, background, options, cancellationToken);
        var despilledPixels = DespillGreenFringes(processed, background, options.Tolerance, cancellationToken);
        var visibleBounds = FindVisibleBounds(processed, cancellationToken);
        if (visibleBounds.IsEmpty)
        {
            var empty = new SKBitmap(new SKImageInfo(1, 1, source.ColorType, source.AlphaType, source.ColorSpace));
            empty.Erase(SKColors.Transparent);
            return new ChromaCropResult(new DecodedAssetImage(empty), visibleBounds, background, removedPixels, despilledPixels, isEmpty: true);
        }

        var expandedBounds = ExpandAndClamp(visibleBounds, options.CropMargin, source.Width, source.Height);
        var cropped = Crop(processed, expandedBounds, cancellationToken);
        return new ChromaCropResult(new DecodedAssetImage(cropped), expandedBounds, background, removedPixels, despilledPixels, isEmpty: false);
    }

    private static SKColor SampleBackground(SKBitmap source, CancellationToken cancellationToken)
    {
        var step = Math.Max(1, Math.Min(source.Width, source.Height) / 120);
        var samples = new List<SKColor>((source.Width + source.Height) * 2 / step + 4);
        var row = new byte[checked(source.Width * 4)];
        for (var y = 0; y < source.Height; y += step)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Marshal.Copy(IntPtr.Add(source.GetPixels(), checked(y * source.RowBytes)), row, 0, row.Length);
            AddBorderSample(samples, row, 0);
            AddBorderSample(samples, row, (source.Width - 1) * 4);
        }

        Marshal.Copy(source.GetPixels(), row, 0, row.Length);
        var topRow = row.ToArray();
        Marshal.Copy(IntPtr.Add(source.GetPixels(), checked((source.Height - 1) * source.RowBytes)), row, 0, row.Length);
        var bottomRow = row.ToArray();
        for (var x = 0; x < source.Width; x += step)
        {
            var offset = x * 4;
            AddBorderSample(samples, topRow, offset);
            AddBorderSample(samples, bottomRow, offset);
        }

        var greenSamples = samples.Where(color => color.Green > color.Red * 1.2 && color.Green > color.Blue * 1.08).ToArray();
        var chosen = greenSamples.Length > 0 ? greenSamples : samples.ToArray();
        return new SKColor(Median(chosen.Select(color => color.Red)), Median(chosen.Select(color => color.Green)), Median(chosen.Select(color => color.Blue)));
    }

    private static void AddBorderSample(List<SKColor> samples, byte[] row, int offset) =>
        samples.Add(new SKColor(row[offset], row[offset + 1], row[offset + 2], row[offset + 3]));

    private static byte Median(IEnumerable<byte> values)
    {
        var sorted = values.Order().ToArray();
        return sorted[sorted.Length / 2];
    }

    private static int ApplyChroma(SKBitmap bitmap, SKColor background, ChromaCropOptions options, CancellationToken cancellationToken)
    {
        var row = new byte[checked(bitmap.Width * 4)];
        var removed = 0;
        for (var y = 0; y < bitmap.Height; y++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var rowAddress = IntPtr.Add(bitmap.GetPixels(), checked(y * bitmap.RowBytes));
            Marshal.Copy(rowAddress, row, 0, row.Length);
            for (var x = 0; x < bitmap.Width; x++)
            {
                var offset = x * 4;
                var alpha = row[offset + 3];
                if (alpha == 0)
                {
                    continue;
                }

                var distance = ColorDistance(row[offset], row[offset + 1], row[offset + 2], background);
                if (distance <= options.Tolerance)
                {
                    row[offset + 3] = 0;
                    removed++;
                    continue;
                }

                if (options.Feather == 0 || distance >= options.Tolerance + options.Feather)
                {
                    continue;
                }

                var matte = (distance - options.Tolerance) / options.Feather;
                if (matte < 0.12)
                {
                    row[offset + 3] = 0;
                    removed++;
                    continue;
                }

                var backgroundWeight = 1 - matte;
                row[offset] = ClampChannel((row[offset] - background.Red * backgroundWeight) / matte);
                row[offset + 1] = ClampChannel((row[offset + 1] - background.Green * backgroundWeight) / matte);
                row[offset + 2] = ClampChannel((row[offset + 2] - background.Blue * backgroundWeight) / matte);
                row[offset + 3] = (byte)Math.Clamp((int)Math.Round(alpha * matte), 0, 255);
            }

            Marshal.Copy(row, 0, rowAddress, row.Length);
        }

        return removed;
    }

    private static int DespillGreenFringes(SKBitmap bitmap, SKColor background, int tolerance, CancellationToken cancellationToken)
    {
        if (background.Green <= background.Red * 1.2 || background.Green <= background.Blue * 1.08)
        {
            return 0;
        }

        var row = new byte[checked(bitmap.Width * 4)];
        var changed = 0;
        for (var y = 0; y < bitmap.Height; y++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var rowAddress = IntPtr.Add(bitmap.GetPixels(), checked(y * bitmap.RowBytes));
            Marshal.Copy(rowAddress, row, 0, row.Length);
            for (var x = 0; x < bitmap.Width; x++)
            {
                var offset = x * 4;
                if (row[offset + 3] == 0)
                {
                    continue;
                }

                var distance = ColorDistance(row[offset], row[offset + 1], row[offset + 2], background);
                if (distance >= tolerance + DespillRadius)
                {
                    continue;
                }

                var nonGreen = Math.Max(row[offset], row[offset + 2]);
                var spill = row[offset + 1] - nonGreen;
                if (spill <= 0)
                {
                    continue;
                }

                var weight = Math.Clamp((tolerance + DespillRadius - distance) / DespillRadius, 0, 1);
                var cleaned = ClampChannel(row[offset + 1] - spill * weight);
                if (cleaned != row[offset + 1])
                {
                    row[offset + 1] = cleaned;
                    changed++;
                }
            }

            Marshal.Copy(row, 0, rowAddress, row.Length);
        }

        return changed;
    }

    private static ImageCropBounds FindVisibleBounds(SKBitmap bitmap, CancellationToken cancellationToken)
    {
        var minX = bitmap.Width;
        var minY = bitmap.Height;
        var maxX = -1;
        var maxY = -1;
        var row = new byte[checked(bitmap.Width * 4)];
        for (var y = 0; y < bitmap.Height; y++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Marshal.Copy(IntPtr.Add(bitmap.GetPixels(), checked(y * bitmap.RowBytes)), row, 0, row.Length);
            for (var x = 0; x < bitmap.Width; x++)
            {
                if (row[x * 4 + 3] <= MinimumVisibleAlpha)
                {
                    continue;
                }

                minX = Math.Min(minX, x);
                minY = Math.Min(minY, y);
                maxX = Math.Max(maxX, x);
                maxY = Math.Max(maxY, y);
            }
        }

        return maxX < minX || maxY < minY
            ? new ImageCropBounds(0, 0, 0, 0)
            : new ImageCropBounds(minX, minY, maxX - minX + 1, maxY - minY + 1);
    }

    private static ImageCropBounds ExpandAndClamp(ImageCropBounds bounds, int margin, int width, int height)
    {
        var left = Math.Max(0, bounds.X - margin);
        var top = Math.Max(0, bounds.Y - margin);
        var right = Math.Min(width - 1, bounds.X + bounds.Width - 1 + margin);
        var bottom = Math.Min(height - 1, bounds.Y + bounds.Height - 1 + margin);
        return new ImageCropBounds(left, top, right - left + 1, bottom - top + 1);
    }

    private static SKBitmap Crop(SKBitmap source, ImageCropBounds bounds, CancellationToken cancellationToken)
    {
        var target = new SKBitmap(new SKImageInfo(bounds.Width, bounds.Height, source.ColorType, source.AlphaType, source.ColorSpace));
        try
        {
            if (target.GetPixels() == IntPtr.Zero)
            {
                throw new InvalidOperationException("The cropped model piece buffer could not be allocated.");
            }

            var rowBytes = checked(bounds.Width * 4);
            var row = new byte[rowBytes];
            for (var y = 0; y < bounds.Height; y++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var sourceAddress = IntPtr.Add(source.GetPixels(), checked((bounds.Y + y) * source.RowBytes + bounds.X * 4));
                var targetAddress = IntPtr.Add(target.GetPixels(), checked(y * target.RowBytes));
                Marshal.Copy(sourceAddress, row, 0, row.Length);
                Marshal.Copy(row, 0, targetAddress, row.Length);
            }

            return target;
        }
        catch
        {
            target.Dispose();
            throw;
        }
    }

    private static double ColorDistance(byte red, byte green, byte blue, SKColor background)
    {
        var redDelta = red - background.Red;
        var greenDelta = green - background.Green;
        var blueDelta = blue - background.Blue;
        return Math.Sqrt(redDelta * redDelta + greenDelta * greenDelta + blueDelta * blueDelta);
    }

    private static byte ClampChannel(double value) => (byte)Math.Clamp((int)Math.Round(value), 0, 255);
}
