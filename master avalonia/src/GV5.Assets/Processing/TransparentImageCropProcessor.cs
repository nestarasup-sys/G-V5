using System.Runtime.InteropServices;
using GV5.Assets.Decoding;
using SkiaSharp;

namespace GV5.Assets.Processing;

/// <summary>Owns a tightly cropped copy of visible source pixels; source alpha is preserved.</summary>
public sealed class TransparentImageCropResult : IDisposable
{
    private int _disposed;

    internal TransparentImageCropResult(DecodedAssetImage image, ImageCropBounds sourceBounds, bool isEmpty)
    {
        Image = image;
        SourceBounds = sourceBounds;
        IsEmpty = isEmpty;
    }

    public DecodedAssetImage Image { get; }
    public ImageCropBounds SourceBounds { get; }
    public bool IsEmpty { get; }

    public byte[] EncodePng()
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        using var encoded = Image.Bitmap.Encode(SKEncodedImageFormat.Png, 100)
            ?? throw new InvalidOperationException("The transparent clothing crop could not be encoded as PNG.");
        return encoded.ToArray();
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 0) Image.Dispose();
    }
}

/// <summary>Trims fully transparent borders without applying chroma or changing visible pixel colors.</summary>
public sealed class TransparentImageCropProcessor
{
    public const int MaximumMargin = 64;

    public Task<TransparentImageCropResult> ProcessAsync(DecodedAssetImage source, int margin = 2,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);
        if (margin is < 0 or > MaximumMargin) throw new ArgumentOutOfRangeException(nameof(margin));
        cancellationToken.ThrowIfCancellationRequested();
        return Task.Run(() => ProcessCore(source.Bitmap, margin, cancellationToken), CancellationToken.None);
    }

    private static TransparentImageCropResult ProcessCore(SKBitmap source, int margin, CancellationToken cancellationToken)
    {
        if (source.ColorType != SKColorType.Rgba8888 || source.AlphaType != SKAlphaType.Unpremul)
            throw new ArgumentException("Transparent clothing cropping requires an RGBA8888 unpremultiplied image.", nameof(source));

        var row = new byte[checked(source.Width * 4)];
        var left = source.Width;
        var top = source.Height;
        var right = -1;
        var bottom = -1;
        for (var y = 0; y < source.Height; y++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Marshal.Copy(IntPtr.Add(source.GetPixels(), checked(y * source.RowBytes)), row, 0, row.Length);
            for (var x = 0; x < source.Width; x++)
            {
                if (row[x * 4 + 3] == 0) continue;
                left = Math.Min(left, x);
                top = Math.Min(top, y);
                right = Math.Max(right, x);
                bottom = Math.Max(bottom, y);
            }
        }

        if (right < left || bottom < top)
        {
            var empty = new SKBitmap(new SKImageInfo(1, 1, SKColorType.Rgba8888, SKAlphaType.Unpremul));
            empty.Erase(SKColors.Transparent);
            return new TransparentImageCropResult(new DecodedAssetImage(empty), new ImageCropBounds(0, 0, 0, 0), true);
        }

        left = Math.Max(0, left - margin);
        top = Math.Max(0, top - margin);
        right = Math.Min(source.Width - 1, right + margin);
        bottom = Math.Min(source.Height - 1, bottom + margin);
        var bounds = new ImageCropBounds(left, top, right - left + 1, bottom - top + 1);
        var cropped = new SKBitmap(new SKImageInfo(bounds.Width, bounds.Height, SKColorType.Rgba8888,
            SKAlphaType.Unpremul, source.ColorSpace));
        if (cropped.GetPixels() == IntPtr.Zero)
        {
            cropped.Dispose();
            throw new InvalidOperationException("The clothing crop buffer could not be allocated.");
        }

        try
        {
            var sourceRow = new byte[checked(bounds.Width * 4)];
            for (var y = 0; y < bounds.Height; y++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var sourceAddress = IntPtr.Add(source.GetPixels(), checked((bounds.Y + y) * source.RowBytes + bounds.X * 4));
                var targetAddress = IntPtr.Add(cropped.GetPixels(), checked(y * cropped.RowBytes));
                Marshal.Copy(sourceAddress, sourceRow, 0, sourceRow.Length);
                Marshal.Copy(sourceRow, 0, targetAddress, sourceRow.Length);
            }
            return new TransparentImageCropResult(new DecodedAssetImage(cropped), bounds, false);
        }
        catch
        {
            cropped.Dispose();
            throw;
        }
    }
}
