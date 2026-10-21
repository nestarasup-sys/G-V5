using System.Runtime.InteropServices;
using GV5.Assets.Decoding;
using SkiaSharp;

namespace GV5.Assets.Processing;

/// <summary>Builds the legacy eye-interior alpha mask while keeping the source image untouched.</summary>
public sealed class EyeInteriorMaskProcessor
{
    public Task<DecodedAssetImage> ProcessAsync(DecodedAssetImage source, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);
        if (source.Width < 1 || source.Height < 1 || (long)source.Width * source.Height > FaceSheetOptions.MaximumPixels)
            throw new ArgumentOutOfRangeException(nameof(source), "An eye image must contain 1–32,000,000 pixels.");
        if (source.Bitmap.ColorType != SKColorType.Rgba8888 || source.Bitmap.AlphaType != SKAlphaType.Unpremul)
            throw new ArgumentException("Eye mask processing requires RGBA8888 unpremultiplied pixels.", nameof(source));
        cancellationToken.ThrowIfCancellationRequested();
        return Task.Run(() => ProcessCore(source.Bitmap, cancellationToken), CancellationToken.None);
    }

    private static DecodedAssetImage ProcessCore(SKBitmap source, CancellationToken cancellationToken)
    {
        var mask = new SKBitmap(new SKImageInfo(source.Width, source.Height, SKColorType.Rgba8888,
            SKAlphaType.Unpremul, source.ColorSpace));
        if (mask.GetPixels() == IntPtr.Zero)
        {
            mask.Dispose();
            throw new InvalidOperationException("The eye mask buffer could not be allocated.");
        }

        try
        {
            var row = new byte[checked(source.Width * 4)];
            for (var y = 0; y < source.Height; y++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                Marshal.Copy(IntPtr.Add(source.GetPixels(), checked(y * source.RowBytes)), row, 0, row.Length);
                for (var x = 0; x < source.Width; x++)
                {
                    var offset = x * 4;
                    var luminance = row[offset] * 0.2126 + row[offset + 1] * 0.7152 + row[offset + 2] * 0.0722;
                    var coverage = Math.Clamp((luminance - 145d) / 55d, 0d, 1d);
                    var alpha = (byte)Math.Round(row[offset + 3] * coverage);
                    row[offset] = byte.MaxValue;
                    row[offset + 1] = byte.MaxValue;
                    row[offset + 2] = byte.MaxValue;
                    row[offset + 3] = alpha;
                }
                Marshal.Copy(row, 0, IntPtr.Add(mask.GetPixels(), checked(y * mask.RowBytes)), row.Length);
            }
            return new DecodedAssetImage(mask);
        }
        catch
        {
            mask.Dispose();
            throw;
        }
    }
}
