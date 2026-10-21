using System.Runtime.InteropServices;
using GV5.Assets.Decoding;
using SkiaSharp;

namespace GV5.Assets.Processing;

public enum HairBackgroundMode
{
    Auto = 1,
    Green = 2,
    Checker = 3
}

public sealed record HairSheetOptions(int Tolerance = 70, HairBackgroundMode Mode = HairBackgroundMode.Auto)
{
    public const long MaximumPixels = 32_000_000;

    public void Validate()
    {
        if (Tolerance is < 0 or > 100) throw new ArgumentOutOfRangeException(nameof(Tolerance));
        if (!Enum.IsDefined(Mode)) throw new ArgumentOutOfRangeException(nameof(Mode));
    }
}

public sealed class HairSheetPieceResult : IDisposable
{
    private int _disposed;

    internal HairSheetPieceResult(DecodedAssetImage image, ImageCropBounds sourceBounds,
        int removedPixels, int despilledPixels, bool isEmpty)
    {
        Image = image;
        SourceBounds = sourceBounds;
        RemovedPixelCount = removedPixels;
        DespilledPixelCount = despilledPixels;
        IsEmpty = isEmpty;
    }

    public DecodedAssetImage Image { get; }
    /// <summary>Crop bounds in the coordinate system of the full source sheet.</summary>
    public ImageCropBounds SourceBounds { get; }
    public int RemovedPixelCount { get; }
    public int DespilledPixelCount { get; }
    public bool IsEmpty { get; }

    public byte[] EncodePng()
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        using var encoded = Image.Bitmap.Encode(SKEncodedImageFormat.Png, 100)
            ?? throw new InvalidOperationException("The processed hair piece could not be encoded as PNG.");
        return encoded.ToArray();
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 0) Image.Dispose();
    }
}

/// <summary>Owns independently cropped upper/posterior and lower/traseiro outputs.</summary>
public sealed class HairSheetProcessingResult : IDisposable
{
    private int _disposed;

    internal HairSheetProcessingResult(HairSheetPieceResult posterior, HairSheetPieceResult traseiro)
    {
        Posterior = posterior;
        Traseiro = traseiro;
    }

    /// <summary>The top half, assigned to the legacy rearHair/front asset slot.</summary>
    public HairSheetPieceResult Posterior { get; }
    /// <summary>The bottom half, assigned to the legacy backHair/back asset slot.</summary>
    public HairSheetPieceResult Traseiro { get; }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 0)
        {
            Posterior.Dispose();
            Traseiro.Dispose();
        }
    }
}

/// <summary>
/// Splits a hair sheet into two independent pieces, removes only background pixels connected to each half's border,
/// trims transparent margins, and despills green. Work runs off-thread and never mutates the caller's source image.
/// The caller must keep the source alive until the returned task completes.
/// </summary>
public sealed class HairSheetProcessor
{
    public const int MaximumDimension = 8_192;
    private const byte EdgeAlphaThreshold = 12;
    private const byte CropAlphaThreshold = 10;

    public Task<HairSheetProcessingResult> ProcessAsync(DecodedAssetImage source,
        HairSheetOptions? options = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);
        var validated = options ?? new HairSheetOptions();
        validated.Validate();
        if (source.Width < 1 || source.Height < 2 || (long)source.Width * source.Height > HairSheetOptions.MaximumPixels)
            throw new ArgumentOutOfRangeException(nameof(source), "A hair sheet must contain 2–32,000,000 pixels.");
        if (source.Bitmap.ColorType != SKColorType.Rgba8888 || source.Bitmap.AlphaType != SKAlphaType.Unpremul)
            throw new ArgumentException("Hair processing requires RGBA8888 unpremultiplied pixels.", nameof(source));
        cancellationToken.ThrowIfCancellationRequested();
        return Task.Run(() => ProcessCore(source.Bitmap, validated, cancellationToken), CancellationToken.None);
    }

    private static HairSheetProcessingResult ProcessCore(SKBitmap source, HairSheetOptions options,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        using var processed = source.Copy()
            ?? throw new InvalidOperationException("The original hair sheet could not be copied for processing.");
        if (processed.GetPixels() == IntPtr.Zero)
            throw new InvalidOperationException("The hair processing buffer could not be allocated.");

        var upperHeight = source.Height / 2;
        var lowerHeight = source.Height - upperHeight;
        var posterior = ProcessHalf(processed, 0, upperHeight, options, cancellationToken);
        try
        {
            var traseiro = ProcessHalf(processed, upperHeight, lowerHeight, options, cancellationToken);
            return new HairSheetProcessingResult(posterior, traseiro);
        }
        catch
        {
            posterior.Dispose();
            throw;
        }
    }

    private static HairSheetPieceResult ProcessHalf(SKBitmap bitmap, int top, int height,
        HairSheetOptions options, CancellationToken cancellationToken)
    {
        var background = SampleGreenBackground(bitmap, top, height, options, cancellationToken);
        var area = checked(bitmap.Width * height);
        var candidate = new byte[area];
        var visited = new byte[area];
        var queue = new int[area];
        BuildCandidateMask(bitmap, top, height, background, options, candidate, cancellationToken);
        var removed = FloodBorderBackground(bitmap, top, height, candidate, visited, queue, cancellationToken);
        var despilled = DespillGreenFringes(bitmap, top, height, background, options.Tolerance, cancellationToken);
        var bounds = FindVisibleBounds(bitmap, top, height, cancellationToken);
        if (bounds.IsEmpty)
        {
            var empty = new SKBitmap(new SKImageInfo(1, 1, SKColorType.Rgba8888, SKAlphaType.Unpremul));
            empty.Erase(SKColors.Transparent);
            return new HairSheetPieceResult(new DecodedAssetImage(empty),
                new ImageCropBounds(0, top, 0, 0), removed, despilled, isEmpty: true);
        }

        var cropped = CopyCrop(bitmap, top + bounds.Y, bounds.X, bounds.Width, bounds.Height, cancellationToken);
        return new HairSheetPieceResult(new DecodedAssetImage(cropped),
            new ImageCropBounds(bounds.X, top + bounds.Y, bounds.Width, bounds.Height), removed, despilled, isEmpty: false);
    }

    private static SKColor[] SampleBorder(SKBitmap bitmap, int top, int height, CancellationToken cancellationToken)
    {
        var step = Math.Max(1, Math.Min(bitmap.Width, height) / 180);
        var samples = new List<SKColor>(checked((bitmap.Width + height) * 2 / step + 4));
        var row = new byte[checked(bitmap.Width * 4)];
        for (var y = 0; y < height; y += step)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Marshal.Copy(IntPtr.Add(bitmap.GetPixels(), checked((top + y) * bitmap.RowBytes)), row, 0, row.Length);
            AddSample(samples, row, 0);
            AddSample(samples, row, (bitmap.Width - 1) * 4);
        }

        Marshal.Copy(IntPtr.Add(bitmap.GetPixels(), checked(top * bitmap.RowBytes)), row, 0, row.Length);
        var topRow = row.ToArray();
        Marshal.Copy(IntPtr.Add(bitmap.GetPixels(), checked((top + height - 1) * bitmap.RowBytes)), row, 0, row.Length);
        var bottomRow = row.ToArray();
        for (var x = 0; x < bitmap.Width; x += step)
        {
            AddSample(samples, topRow, x * 4);
            AddSample(samples, bottomRow, x * 4);
        }
        return samples.ToArray();
    }

    private static SKColor SampleGreenBackground(SKBitmap bitmap, int top, int height,
        HairSheetOptions options, CancellationToken cancellationToken)
    {
        if (options.Mode == HairBackgroundMode.Checker) return SKColors.Transparent;
        var samples = SampleBorder(bitmap, top, height, cancellationToken);
        var greenSamples = samples.Where(color => color.Alpha >= EdgeAlphaThreshold
            && color.Green > color.Red * 1.12 && color.Green > color.Blue * 1.06
            && color.Green - Math.Max(color.Red, color.Blue) > 12).ToArray();
        if (greenSamples.Length < 4) return SKColors.Transparent;
        return new SKColor(Median(greenSamples.Select(color => color.Red)), Median(greenSamples.Select(color => color.Green)),
            Median(greenSamples.Select(color => color.Blue)));
    }

    private static void BuildCandidateMask(SKBitmap bitmap, int top, int height, SKColor background,
        HairSheetOptions options, byte[] candidate, CancellationToken cancellationToken)
    {
        var borderSamples = SampleBorder(bitmap, top, height, cancellationToken);
        var greenSamples = borderSamples.Where(color => color.Alpha >= EdgeAlphaThreshold
            && color.Green > color.Red * 1.12 && color.Green > color.Blue * 1.06
            && color.Green - Math.Max(color.Red, color.Blue) > 12).ToArray();
        SKColor? green = options.Mode != HairBackgroundMode.Checker && greenSamples.Length >= 4
            ? new SKColor(Median(greenSamples.Select(color => color.Red)), Median(greenSamples.Select(color => color.Green)),
                Median(greenSamples.Select(color => color.Blue)))
            : null;

        var neutral = borderSamples.Where(color => color.Alpha >= EdgeAlphaThreshold
            && Math.Max(color.Red, Math.Max(color.Green, color.Blue)) - Math.Min(color.Red, Math.Min(color.Green, color.Blue)) < 28).ToArray();
        var checker = Array.Empty<SKColor>();
        if (green is null && options.Mode != HairBackgroundMode.Green && neutral.Length >= 6)
        {
            var luminance = neutral.Select(Luminance).ToArray();
            var clusters = FindCheckerClusters(luminance);
            if (clusters is { } cluster && cluster.High - cluster.Low >= 24)
            {
                var (low, high) = cluster;
                var threshold = (low + high) / 2;
                checker =
                [
                    MedianColor(neutral.Where(color => Luminance(color) <= threshold)),
                    MedianColor(neutral.Where(color => Luminance(color) > threshold))
                ];
            }
        }

        var row = new byte[checked(bitmap.Width * 4)];
        for (var y = 0; y < height; y++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Marshal.Copy(IntPtr.Add(bitmap.GetPixels(), checked((top + y) * bitmap.RowBytes)), row, 0, row.Length);
            for (var x = 0; x < bitmap.Width; x++)
            {
                var offset = x * 4;
                var local = y * bitmap.Width + x;
                if (row[offset + 3] < EdgeAlphaThreshold)
                {
                    candidate[local] = 1;
                    continue;
                }

                var red = row[offset];
                var g = row[offset + 1];
                var blue = row[offset + 2];
                var greenDistance = green is { } key ? Distance(red, g, blue, key) : double.PositiveInfinity;
                var greenKey = options.Tolerance > 0 && green is not null
                    && g > red * 1.08 && g > blue * 1.04 && g - Math.Max(red, blue) > 8
                    && greenDistance < 12 + options.Tolerance * 1.65;
                var gray = Math.Max(red, Math.Max(g, blue)) - Math.Min(red, Math.Min(g, blue)) < 32;
                var checkerKey = options.Tolerance > 0 && checker.Length == 2 && gray
                    && checker.Any(key => Distance(red, g, blue, key) <= 5 + options.Tolerance * 0.48);
                candidate[local] = greenKey || checkerKey ? (byte)1 : (byte)0;
            }
        }
    }

    private static (double Low, double High)? FindCheckerClusters(double[] values)
    {
        var sorted = values.Order().ToArray();
        var largestGap = 0d;
        var splitIndex = -1;
        for (var index = 1; index < sorted.Length; index++)
        {
            var gap = sorted[index] - sorted[index - 1];
            if (gap > largestGap)
            {
                largestGap = gap;
                splitIndex = index;
            }
        }

        if (splitIndex < 1 || splitIndex >= sorted.Length) return null;
        return (Median(sorted[..splitIndex]), Median(sorted[splitIndex..]));
    }

    private static int FloodBorderBackground(SKBitmap bitmap, int top, int height,
        byte[] candidate, byte[] visited, int[] queue, CancellationToken cancellationToken)
    {
        var read = 0;
        var write = 0;
        void Enqueue(int index)
        {
            if (candidate[index] == 0 || visited[index] != 0) return;
            visited[index] = 1;
            queue[write++] = index;
        }

        for (var x = 0; x < bitmap.Width; x++)
        {
            Enqueue(x);
            Enqueue((height - 1) * bitmap.Width + x);
        }
        for (var y = 0; y < height; y++)
        {
            Enqueue(y * bitmap.Width);
            Enqueue(y * bitmap.Width + bitmap.Width - 1);
        }

        while (read < write)
        {
            if ((read & 0x3fff) == 0) cancellationToken.ThrowIfCancellationRequested();
            var index = queue[read++];
            var x = index % bitmap.Width;
            var y = index / bitmap.Width;
            if (x > 0) Enqueue(index - 1);
            if (x + 1 < bitmap.Width) Enqueue(index + 1);
            if (y > 0) Enqueue(index - bitmap.Width);
            if (y + 1 < height) Enqueue(index + bitmap.Width);
        }

        var removed = 0;
        var row = new byte[checked(bitmap.Width * 4)];
        for (var y = 0; y < height; y++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var address = IntPtr.Add(bitmap.GetPixels(), checked((top + y) * bitmap.RowBytes));
            Marshal.Copy(address, row, 0, row.Length);
            for (var x = 0; x < bitmap.Width; x++)
            {
                var index = y * bitmap.Width + x;
                var alphaIndex = x * 4 + 3;
                if (visited[index] == 0 || row[alphaIndex] < EdgeAlphaThreshold) continue;
                row[alphaIndex] = 0;
                removed++;
            }
            Marshal.Copy(row, 0, address, row.Length);
        }
        return removed;
    }

    private static int DespillGreenFringes(SKBitmap bitmap, int top, int height, SKColor background,
        int tolerance, CancellationToken cancellationToken)
    {
        if (tolerance == 0 || background.Green <= background.Red * 1.12 || background.Green <= background.Blue * 1.06)
            return 0;
        var row = new byte[checked(bitmap.Width * 4)];
        var changed = 0;
        for (var y = 0; y < height; y++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var address = IntPtr.Add(bitmap.GetPixels(), checked((top + y) * bitmap.RowBytes));
            Marshal.Copy(address, row, 0, row.Length);
            for (var x = 0; x < bitmap.Width; x++)
            {
                var offset = x * 4;
                if (row[offset + 3] == 0) continue;
                var red = row[offset];
                var green = row[offset + 1];
                var blue = row[offset + 2];
                if (green <= red * 1.08 || green <= blue * 1.04 || green - Math.Max(red, blue) <= 5) continue;
                var spill = Math.Min(1, (green - Math.Max(red, blue)) / 80d);
                row[offset + 1] = Math.Max((byte)Math.Max(red, blue), (byte)Math.Round(green * (1 - spill)));
                changed++;
            }
            Marshal.Copy(row, 0, address, row.Length);
        }
        return changed;
    }

    private static ImageCropBounds FindVisibleBounds(SKBitmap bitmap, int top, int height,
        CancellationToken cancellationToken)
    {
        var left = bitmap.Width;
        var right = -1;
        var firstRow = height;
        var lastRow = -1;
        var row = new byte[checked(bitmap.Width * 4)];
        for (var y = 0; y < height; y++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Marshal.Copy(IntPtr.Add(bitmap.GetPixels(), checked((top + y) * bitmap.RowBytes)), row, 0, row.Length);
            for (var x = 0; x < bitmap.Width; x++)
            {
                if (row[x * 4 + 3] <= CropAlphaThreshold) continue;
                left = Math.Min(left, x);
                right = Math.Max(right, x);
                firstRow = Math.Min(firstRow, y);
                lastRow = Math.Max(lastRow, y);
            }
        }
        return right < left || lastRow < firstRow
            ? new ImageCropBounds(0, 0, 0, 0)
            : new ImageCropBounds(left, firstRow, right - left + 1, lastRow - firstRow + 1);
    }

    private static SKBitmap CopyCrop(SKBitmap source, int top, int left, int width, int height,
        CancellationToken cancellationToken)
    {
        var cropped = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Unpremul, source.ColorSpace));
        if (cropped.GetPixels() == IntPtr.Zero)
        {
            cropped.Dispose();
            throw new InvalidOperationException("The cropped hair bitmap could not be allocated.");
        }
        try
        {
            var row = new byte[checked(width * 4)];
            for (var y = 0; y < height; y++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var sourceAddress = IntPtr.Add(source.GetPixels(), checked((top + y) * source.RowBytes + left * 4));
                var destinationAddress = IntPtr.Add(cropped.GetPixels(), checked(y * cropped.RowBytes));
                Marshal.Copy(sourceAddress, row, 0, row.Length);
                Marshal.Copy(row, 0, destinationAddress, row.Length);
            }
            return cropped;
        }
        catch
        {
            cropped.Dispose();
            throw;
        }
    }

    private static void AddSample(List<SKColor> samples, byte[] row, int offset) =>
        samples.Add(new SKColor(row[offset], row[offset + 1], row[offset + 2], row[offset + 3]));

    private static byte Median(IEnumerable<byte> values)
    {
        var sorted = values.Order().ToArray();
        return sorted.Length == 0 ? (byte)0 : sorted[sorted.Length / 2];
    }

    private static double Median(IEnumerable<double> values)
    {
        var sorted = values.Order().ToArray();
        return sorted.Length == 0 ? 0 : sorted[sorted.Length / 2];
    }

    private static SKColor MedianColor(IEnumerable<SKColor> colors)
    {
        var values = colors.ToArray();
        return values.Length == 0 ? SKColors.Transparent : new SKColor(Median(values.Select(color => color.Red)),
            Median(values.Select(color => color.Green)), Median(values.Select(color => color.Blue)));
    }

    private static double Luminance(SKColor color) => (color.Red + color.Green + color.Blue) / 3d;

    private static double Distance(byte red, byte green, byte blue, SKColor color)
    {
        var dr = red - color.Red;
        var dg = green - color.Green;
        var db = blue - color.Blue;
        return Math.Sqrt(dr * dr + dg * dg + db * db);
    }
}
