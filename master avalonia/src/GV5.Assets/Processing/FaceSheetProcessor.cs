using System.Buffers;
using System.Runtime.InteropServices;
using GV5.Assets.Decoding;
using SkiaSharp;

namespace GV5.Assets.Processing;

public enum FaceSheetKind
{
    Eyes = 1,
    Eyebrows = 2,
    Nose = 3,
    MouthClosed = 4,
    MouthOpen = 5
}

public enum FaceNoseSheetMode
{
    Auto = 1,
    One = 2,
    Six = 3
}

public enum FaceSheetPartKind
{
    Eye = 1,
    Pupil = 2,
    ClosedEye = 3,
    Eyebrow = 4,
    Nose = 5,
    Mouth = 6
}

public enum FaceSheetSide
{
    Left = 1,
    Right = 2
}

public sealed record FaceSheetOptions(int Tolerance = 42, FaceNoseSheetMode NoseMode = FaceNoseSheetMode.Auto)
{
    public const long MaximumPixels = 32_000_000;

    public void Validate()
    {
        if (Tolerance is < 0 or > 280) throw new ArgumentOutOfRangeException(nameof(Tolerance));
        if (!Enum.IsDefined(NoseMode)) throw new ArgumentOutOfRangeException(nameof(NoseMode));
    }
}

public sealed class FaceSheetPieceResult : IDisposable
{
    private int _disposed;

    internal FaceSheetPieceResult(FaceSheetPartKind partKind, int index, FaceSheetSide? side,
        DecodedAssetImage image, ImageCropBounds sourceBounds)
    {
        PartKind = partKind;
        Index = index;
        Side = side;
        Image = image;
        SourceBounds = sourceBounds;
    }

    public FaceSheetPartKind PartKind { get; }
    /// <summary>Zero-based variant index. Eyes use 0=eye, 1=pupil, 2=closed eye.</summary>
    public int Index { get; }
    public FaceSheetSide? Side { get; }
    public DecodedAssetImage Image { get; }
    /// <summary>Visible crop in the coordinate space of the original sheet.</summary>
    public ImageCropBounds SourceBounds { get; }

    public byte[] EncodePng()
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        using var encoded = Image.Bitmap.Encode(SKEncodedImageFormat.Png, 100)
            ?? throw new InvalidOperationException("The facial component could not be encoded as PNG.");
        return encoded.ToArray();
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 0) Image.Dispose();
    }
}

public sealed class FaceSheetProcessingResult : IDisposable
{
    private int _disposed;

    internal FaceSheetProcessingResult(int sourceWidth, int sourceHeight, SKColor sampledBackground,
        int removedPixelCount, int despilledPixelCount, IReadOnlyList<FaceSheetPieceResult> pieces)
    {
        SourceWidth = sourceWidth;
        SourceHeight = sourceHeight;
        SampledBackground = sampledBackground;
        RemovedPixelCount = removedPixelCount;
        DespilledPixelCount = despilledPixelCount;
        Pieces = pieces;
    }

    public int SourceWidth { get; }
    public int SourceHeight { get; }
    public SKColor SampledBackground { get; }
    public int RemovedPixelCount { get; }
    public int DespilledPixelCount { get; }
    public IReadOnlyList<FaceSheetPieceResult> Pieces { get; }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        foreach (var piece in Pieces) piece.Dispose();
    }
}

/// <summary>
/// Removes only sampled background connected to the sheet edge, then crops facial sheet cells.
/// Input pixels are never modified. Heavy pixel work runs on a worker thread.
/// </summary>
public sealed class FaceSheetProcessor
{
    private const byte EdgeAlphaThreshold = 12;
    private const byte CropAlphaThreshold = 20;

    public Task<FaceSheetProcessingResult> ProcessAsync(DecodedAssetImage source, FaceSheetKind kind,
        FaceSheetOptions? options = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);
        if (!Enum.IsDefined(kind)) throw new ArgumentOutOfRangeException(nameof(kind));
        var validated = options ?? new FaceSheetOptions();
        validated.Validate();
        if (source.Width < 1 || source.Height < 1 || (long)source.Width * source.Height > FaceSheetOptions.MaximumPixels)
            throw new ArgumentOutOfRangeException(nameof(source), "A face sheet must contain 1–32,000,000 pixels.");
        if (source.Bitmap.ColorType != SKColorType.Rgba8888 || source.Bitmap.AlphaType != SKAlphaType.Unpremul)
            throw new ArgumentException("Face processing requires RGBA8888 unpremultiplied pixels.", nameof(source));
        cancellationToken.ThrowIfCancellationRequested();
        return Task.Run(() => ProcessCore(source.Bitmap, kind, validated, cancellationToken), CancellationToken.None);
    }

    private static FaceSheetProcessingResult ProcessCore(SKBitmap source, FaceSheetKind kind,
        FaceSheetOptions options, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        using var working = source.Copy() ?? throw new InvalidOperationException("The face sheet could not be copied for processing.");
        if (working.GetPixels() == IntPtr.Zero) throw new InvalidOperationException("The face processing buffer could not be allocated.");

        var background = SampleBackground(working, cancellationToken);
        var removed = RemoveConnectedBackground(working, background, options.Tolerance, cancellationToken);
        var despilled = DespillGreen(working, background, options.Tolerance, cancellationToken);
        var visible = FindVisibleBounds(working, 0, 0, working.Width, working.Height, cancellationToken);
        if (visible.IsEmpty) throw new InvalidDataException("No visible facial pieces remain after background removal.");

        var regions = BuildRegions(working, visible, kind, options.NoseMode, cancellationToken);
        var pieces = new List<FaceSheetPieceResult>(regions.Count);
        try
        {
            foreach (var region in regions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var crop = FindVisibleBounds(working, region.X, region.Y, region.Width, region.Height, cancellationToken);
                if (crop.IsEmpty) throw new InvalidDataException($"Facial sheet region {region.Index} is empty.");
                var bitmap = CopyCrop(working, crop, cancellationToken);
                pieces.Add(new FaceSheetPieceResult(region.PartKind, region.Index, region.Side,
                    new DecodedAssetImage(bitmap), crop));
            }

            return new FaceSheetProcessingResult(source.Width, source.Height, background, removed, despilled,
                pieces.AsReadOnly());
        }
        catch
        {
            foreach (var piece in pieces) piece.Dispose();
            throw;
        }
    }

    private static List<Region> BuildRegions(SKBitmap bitmap, ImageCropBounds visible, FaceSheetKind kind,
        FaceNoseSheetMode noseMode, CancellationToken cancellationToken)
    {
        var result = new List<Region>();
        if (kind is FaceSheetKind.Eyes or FaceSheetKind.Eyebrows)
        {
            var rowCount = kind == FaceSheetKind.Eyes ? 3 : 1;
            var faceRows = SplitByBands(bitmap, visible, rowCount, vertical: true, cancellationToken);
            for (var row = 0; row < faceRows.Count; row++)
            {
                var rowBounds = FindVisibleBounds(bitmap, faceRows[row].X, faceRows[row].Y, faceRows[row].Width,
                    faceRows[row].Height, cancellationToken);
                if (rowBounds.IsEmpty) throw new InvalidDataException($"Facial sheet row {row} is empty.");
                var faceColumns = SplitByBands(bitmap, rowBounds, 2, vertical: false, cancellationToken);
                var type = kind == FaceSheetKind.Eyebrows ? FaceSheetPartKind.Eyebrow : row switch
                {
                    0 => FaceSheetPartKind.Eye,
                    1 => FaceSheetPartKind.Pupil,
                    _ => FaceSheetPartKind.ClosedEye
                };
                result.Add(new Region(type, row, FaceSheetSide.Left, faceColumns[0]));
                result.Add(new Region(type, row, FaceSheetSide.Right, faceColumns[1]));
            }
            return result;
        }

        if (kind == FaceSheetKind.Nose && noseMode == FaceNoseSheetMode.One)
        {
            result.Add(new Region(FaceSheetPartKind.Nose, 0, null, visible));
            return result;
        }

        var count = kind switch
        {
            FaceSheetKind.Nose when noseMode == FaceNoseSheetMode.Six => 6,
            FaceSheetKind.Nose => CanSplitNoseSix(bitmap, visible, cancellationToken) ? 6 : 1,
            FaceSheetKind.MouthClosed or FaceSheetKind.MouthOpen => 21,
            _ => throw new ArgumentOutOfRangeException(nameof(kind))
        };
        if (count == 1)
        {
            result.Add(new Region(FaceSheetPartKind.Nose, 0, null, visible));
            return result;
        }

        var rows = count == 6 ? 2 : 3;
        var columns = count / rows;
        var rowRegions = SplitByBands(bitmap, visible, rows, vertical: true, cancellationToken);
        for (var row = 0; row < rowRegions.Count; row++)
        {
            var rowBounds = FindVisibleBounds(bitmap, rowRegions[row].X, rowRegions[row].Y,
                rowRegions[row].Width, rowRegions[row].Height, cancellationToken);
            if (rowBounds.IsEmpty) throw new InvalidDataException($"Facial sheet row {row} is empty.");
            var cells = SplitByBands(bitmap, rowBounds, columns, vertical: false, cancellationToken);
            for (var column = 0; column < cells.Count; column++)
                result.Add(new Region(kind == FaceSheetKind.Nose ? FaceSheetPartKind.Nose : FaceSheetPartKind.Mouth,
                    row * columns + column, null, cells[column]));
        }
        return result;
    }

    private static bool CanSplitNoseSix(SKBitmap bitmap, ImageCropBounds visible, CancellationToken cancellationToken)
    {
        if (!HasSeparators(bitmap, visible, count: 2, vertical: true, cancellationToken)) return false;
        var rows = SplitByBands(bitmap, visible, 2, vertical: true, cancellationToken);
        foreach (var row in rows)
        {
            var rowBounds = FindVisibleBounds(bitmap, row.X, row.Y, row.Width, row.Height, cancellationToken);
            if (rowBounds.IsEmpty) return false;
            if (!HasSeparators(bitmap, rowBounds, count: 3, vertical: false, cancellationToken)) return false;
            foreach (var cell in SplitByBands(bitmap, rowBounds, 3, vertical: false, cancellationToken))
                if (FindVisibleBounds(bitmap, cell.X, cell.Y, cell.Width, cell.Height, cancellationToken).IsEmpty)
                    return false;
        }
        return true;
    }

    private static bool HasSeparators(SKBitmap bitmap, ImageCropBounds bounds, int count, bool vertical,
        CancellationToken cancellationToken)
    {
        var start = vertical ? bounds.Y : bounds.X;
        var length = vertical ? bounds.Height : bounds.Width;
        var separators = 0;
        for (var index = 0; index < length;)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var occupied = vertical
                ? HasVisible(bitmap, bounds.X, start + index, bounds.Width, 1)
                : HasVisible(bitmap, start + index, bounds.Y, 1, bounds.Height);
            if (occupied) { index++; continue; }
            var first = index;
            while (index < length)
            {
                var lineOccupied = vertical
                    ? HasVisible(bitmap, bounds.X, start + index, bounds.Width, 1)
                    : HasVisible(bitmap, start + index, bounds.Y, 1, bounds.Height);
                if (lineOccupied) break;
                index++;
            }
            if (first > 0 && index < length) separators++;
        }
        return separators >= count - 1;
    }

    private static List<ImageCropBounds> SplitByBands(SKBitmap bitmap, ImageCropBounds bounds, int count,
        bool vertical, CancellationToken cancellationToken)
    {
        var start = vertical ? bounds.Y : bounds.X;
        var length = vertical ? bounds.Height : bounds.Width;
        var occupied = new bool[length];
        for (var index = 0; index < length; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            occupied[index] = vertical
                ? HasVisible(bitmap, bounds.X, start + index, bounds.Width, 1)
                : HasVisible(bitmap, start + index, bounds.Y, 1, bounds.Height);
        }

        var gaps = new List<(int Midpoint, int Length)>();
        for (var index = 0; index < length;)
        {
            if (occupied[index]) { index++; continue; }
            var first = index;
            while (index < length && !occupied[index]) index++;
            if (first > 0 && index < length) gaps.Add((start + (first + index) / 2, index - first));
        }
        var separators = gaps.OrderByDescending(gap => gap.Length).Take(count - 1)
            .Select(gap => gap.Midpoint).Order().ToArray();
        if (separators.Length != count - 1)
        {
            return Enumerable.Range(0, count).Select(index => vertical
                ? new ImageCropBounds(bounds.X, bounds.Y + index * bounds.Height / count, bounds.Width,
                    (index + 1) * bounds.Height / count - index * bounds.Height / count)
                : new ImageCropBounds(bounds.X + index * bounds.Width / count, bounds.Y,
                    (index + 1) * bounds.Width / count - index * bounds.Width / count, bounds.Height)).ToList();
        }

        var edges = new int[count + 1];
        edges[0] = start;
        Array.Copy(separators, 0, edges, 1, separators.Length);
        edges[^1] = start + length;
        var output = new List<ImageCropBounds>(count);
        for (var index = 0; index < count; index++)
            output.Add(vertical
                ? new ImageCropBounds(bounds.X, edges[index], bounds.Width, edges[index + 1] - edges[index])
                : new ImageCropBounds(edges[index], bounds.Y, edges[index + 1] - edges[index], bounds.Height));
        return output;
    }

    private static bool HasVisible(SKBitmap bitmap, int x, int y, int width, int height)
    {
        var row = new byte[checked(width * 4)];
        for (var rowIndex = y; rowIndex < y + height; rowIndex++)
        {
            Marshal.Copy(IntPtr.Add(bitmap.GetPixels(), checked(rowIndex * bitmap.RowBytes + x * 4)), row, 0, row.Length);
            for (var column = 0; column < width; column++)
                if (row[column * 4 + 3] >= CropAlphaThreshold) return true;
        }
        return false;
    }

    private static SKColor SampleBackground(SKBitmap bitmap, CancellationToken cancellationToken)
    {
        var step = Math.Max(1, Math.Min(bitmap.Width, bitmap.Height) / 120);
        var samples = new List<SKColor>();
        var row = new byte[checked(bitmap.Width * 4)];
        for (var y = 0; y < bitmap.Height; y += step)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Marshal.Copy(IntPtr.Add(bitmap.GetPixels(), checked(y * bitmap.RowBytes)), row, 0, row.Length);
            AddSample(samples, row, 0);
            AddSample(samples, row, (bitmap.Width - 1) * 4);
        }
        var topRow = new byte[row.Length];
        Marshal.Copy(bitmap.GetPixels(), topRow, 0, row.Length);
        var bottomRow = new byte[row.Length];
        Marshal.Copy(IntPtr.Add(bitmap.GetPixels(), checked((bitmap.Height - 1) * bitmap.RowBytes)), bottomRow, 0, row.Length);
        for (var x = 0; x < bitmap.Width; x += step)
        {
            AddSample(samples, topRow, x * 4);
            AddSample(samples, bottomRow, x * 4);
        }
        var opaque = samples.Where(color => color.Alpha >= EdgeAlphaThreshold).ToArray();
        if (opaque.Length == 0) return SKColors.Transparent;
        var green = opaque.Where(color => color.Green > color.Red * 1.2 && color.Green > color.Blue * 1.08).ToArray();
        var selected = green.Length > 0 ? green : opaque;
        return new SKColor(Median(selected.Select(color => color.Red)), Median(selected.Select(color => color.Green)),
            Median(selected.Select(color => color.Blue)));
    }

    private static int RemoveConnectedBackground(SKBitmap bitmap, SKColor background, int tolerance,
        CancellationToken cancellationToken)
    {
        var area = checked(bitmap.Width * bitmap.Height);
        var eligible = ArrayPool<byte>.Shared.Rent(area);
        var visited = ArrayPool<byte>.Shared.Rent(area);
        var queue = ArrayPool<int>.Shared.Rent(area);
        try
        {
            Array.Clear(eligible, 0, area);
            Array.Clear(visited, 0, area);
            var row = new byte[checked(bitmap.Width * 4)];
            for (var y = 0; y < bitmap.Height; y++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                Marshal.Copy(IntPtr.Add(bitmap.GetPixels(), checked(y * bitmap.RowBytes)), row, 0, row.Length);
                for (var x = 0; x < bitmap.Width; x++)
                {
                    var offset = x * 4;
                    eligible[y * bitmap.Width + x] = row[offset + 3] < EdgeAlphaThreshold
                        || Distance(row[offset], row[offset + 1], row[offset + 2], background) <= tolerance ? (byte)1 : (byte)0;
                }
            }

            var head = 0;
            var tail = 0;
            void Enqueue(int index)
            {
                if (eligible[index] == 0 || visited[index] != 0) return;
                visited[index] = 1;
                queue[tail++] = index;
            }
            for (var x = 0; x < bitmap.Width; x++) { Enqueue(x); Enqueue((bitmap.Height - 1) * bitmap.Width + x); }
            for (var y = 0; y < bitmap.Height; y++) { Enqueue(y * bitmap.Width); Enqueue(y * bitmap.Width + bitmap.Width - 1); }
            while (head < tail)
            {
                if ((head & 0x3fff) == 0) cancellationToken.ThrowIfCancellationRequested();
                var index = queue[head++];
                var x = index % bitmap.Width;
                var y = index / bitmap.Width;
                if (x > 0) Enqueue(index - 1);
                if (x + 1 < bitmap.Width) Enqueue(index + 1);
                if (y > 0) Enqueue(index - bitmap.Width);
                if (y + 1 < bitmap.Height) Enqueue(index + bitmap.Width);
            }

            var removed = 0;
            for (var y = 0; y < bitmap.Height; y++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                Marshal.Copy(IntPtr.Add(bitmap.GetPixels(), checked(y * bitmap.RowBytes)), row, 0, row.Length);
                for (var x = 0; x < bitmap.Width; x++)
                {
                    if (visited[y * bitmap.Width + x] == 0 || row[x * 4 + 3] < EdgeAlphaThreshold) continue;
                    row[x * 4 + 3] = 0;
                    removed++;
                }
                Marshal.Copy(row, 0, IntPtr.Add(bitmap.GetPixels(), checked(y * bitmap.RowBytes)), row.Length);
            }
            return removed;
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(eligible, clearArray: true);
            ArrayPool<byte>.Shared.Return(visited, clearArray: true);
            ArrayPool<int>.Shared.Return(queue, clearArray: false);
        }
    }

    private static int DespillGreen(SKBitmap bitmap, SKColor background, int tolerance, CancellationToken cancellationToken)
    {
        if (tolerance == 0 || background.Green <= background.Red * 1.2 || background.Green <= background.Blue * 1.08)
            return 0;
        var row = new byte[checked(bitmap.Width * 4)];
        var changed = 0;
        for (var y = 0; y < bitmap.Height; y++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Marshal.Copy(IntPtr.Add(bitmap.GetPixels(), checked(y * bitmap.RowBytes)), row, 0, row.Length);
            for (var x = 0; x < bitmap.Width; x++)
            {
                var offset = x * 4;
                if (row[offset + 3] == 0 || row[offset + 1] <= row[offset] * 1.2 || row[offset + 1] <= row[offset + 2] * 1.08) continue;
                var distance = Distance(row[offset], row[offset + 1], row[offset + 2], background);
                if (distance >= tolerance + 150) continue;
                var spill = Math.Max(row[offset + 1] - Math.Max(row[offset], row[offset + 2]), 0);
                var weight = Math.Clamp((tolerance + 150 - distance) / 150d, 0, 1);
                var cleaned = (byte)Math.Clamp((int)Math.Round(row[offset + 1] - spill * weight), Math.Max(row[offset], row[offset + 2]), 255);
                if (cleaned == row[offset + 1]) continue;
                row[offset + 1] = cleaned;
                changed++;
            }
            Marshal.Copy(row, 0, IntPtr.Add(bitmap.GetPixels(), checked(y * bitmap.RowBytes)), row.Length);
        }
        return changed;
    }

    private static ImageCropBounds FindVisibleBounds(SKBitmap bitmap, int x, int y, int width, int height,
        CancellationToken cancellationToken)
    {
        var left = x + width;
        var top = y + height;
        var right = x - 1;
        var bottom = y - 1;
        var row = new byte[checked(width * 4)];
        for (var rowIndex = y; rowIndex < y + height; rowIndex++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Marshal.Copy(IntPtr.Add(bitmap.GetPixels(), checked(rowIndex * bitmap.RowBytes + x * 4)), row, 0, row.Length);
            for (var column = 0; column < width; column++)
            {
                if (row[column * 4 + 3] < CropAlphaThreshold) continue;
                left = Math.Min(left, x + column);
                right = Math.Max(right, x + column);
                top = Math.Min(top, rowIndex);
                bottom = Math.Max(bottom, rowIndex);
            }
        }
        return right < left || bottom < top ? new ImageCropBounds(0, 0, 0, 0)
            : new ImageCropBounds(left, top, right - left + 1, bottom - top + 1);
    }

    private static SKBitmap CopyCrop(SKBitmap source, ImageCropBounds bounds, CancellationToken cancellationToken)
    {
        var cropped = new SKBitmap(new SKImageInfo(bounds.Width, bounds.Height, SKColorType.Rgba8888,
            SKAlphaType.Unpremul, source.ColorSpace));
        if (cropped.GetPixels() == IntPtr.Zero)
        {
            cropped.Dispose();
            throw new InvalidOperationException("The facial component crop buffer could not be allocated.");
        }
        try
        {
            var row = new byte[checked(bounds.Width * 4)];
            for (var y = 0; y < bounds.Height; y++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                Marshal.Copy(IntPtr.Add(source.GetPixels(), checked((bounds.Y + y) * source.RowBytes + bounds.X * 4)), row, 0, row.Length);
                Marshal.Copy(row, 0, IntPtr.Add(cropped.GetPixels(), checked(y * cropped.RowBytes)), row.Length);
            }
            return cropped;
        }
        catch
        {
            cropped.Dispose();
            throw;
        }
    }

    private static void AddSample(List<SKColor> samples, byte[] row, int offset)
    {
        samples.Add(new SKColor(row[offset], row[offset + 1], row[offset + 2], row[offset + 3]));
    }

    private static byte Median(IEnumerable<byte> values)
    {
        var sorted = values.Order().ToArray();
        return sorted.Length == 0 ? (byte)0 : sorted[sorted.Length / 2];
    }

    private static double Distance(byte red, byte green, byte blue, SKColor background)
    {
        var dr = red - background.Red;
        var dg = green - background.Green;
        var db = blue - background.Blue;
        return Math.Sqrt(dr * dr + dg * dg + db * db);
    }

    private sealed record Region(FaceSheetPartKind PartKind, int Index, FaceSheetSide? Side, ImageCropBounds Bounds)
    {
        public int X => Bounds.X;
        public int Y => Bounds.Y;
        public int Width => Bounds.Width;
        public int Height => Bounds.Height;
    }
}
