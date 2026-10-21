using Avalonia;
using Avalonia.Media.Imaging;
using Avalonia.Platform;
using Avalonia.Threading;
using GV5.Rendering;
using SkiaSharp;
using System.Runtime.InteropServices;

namespace GV5.App.Presentation;

/// <summary>Copies an already-rasterized engine frame into an Avalonia bitmap for binding to an Image control.</summary>
public sealed class AvaloniaRenderedFrameAdapter
{
    /// <summary>Copies pixels on the UI dispatcher. The caller owns and must dispose the returned bitmap; the frame remains caller-owned.</summary>
    public WriteableBitmap CreateBitmap(RenderedFrame frame)
    {
        ArgumentNullException.ThrowIfNull(frame);
        if (!Dispatcher.UIThread.CheckAccess())
        {
            throw new InvalidOperationException("Avalonia frame bitmaps must be created on the UI dispatcher.");
        }

        var source = frame.Bitmap;
        if (source.AlphaType != SKAlphaType.Premul)
        {
            throw new ArgumentException($"Rendered frames must use premultiplied pixels; received {source.ColorType}/{source.AlphaType}.", nameof(frame));
        }

        var targetFormat = source.ColorType switch
        {
            SKColorType.Rgba8888 => PixelFormats.Rgba8888,
            SKColorType.Bgra8888 => PixelFormats.Bgra8888,
            _ => throw new ArgumentException($"Rendered frame color type {source.ColorType} cannot be presented without a conversion pass.", nameof(frame))
        };

        var bitmap = new WriteableBitmap(
            new PixelSize(source.Width, source.Height),
            new Vector(96, 96),
            targetFormat,
            AlphaFormat.Premul);
        try
        {
            using var framebuffer = bitmap.Lock();
            var sourceStride = source.RowBytes;
            var targetStride = framebuffer.RowBytes;
            var bytesPerRow = checked(source.Width * 4);
            if (sourceStride < bytesPerRow || targetStride < bytesPerRow)
            {
                throw new InvalidOperationException("A raster row is shorter than its declared RGBA width.");
            }

            var sourcePixels = source.GetPixels();
            if (sourcePixels == IntPtr.Zero || framebuffer.Address == IntPtr.Zero)
            {
                throw new InvalidOperationException("A source or target pixel buffer could not be allocated.");
            }

            var row = new byte[bytesPerRow];
            for (var y = 0; y < source.Height; y++)
            {
                var sourceRow = IntPtr.Add(sourcePixels, checked(y * sourceStride));
                var targetRow = IntPtr.Add(framebuffer.Address, checked(y * targetStride));
                Marshal.Copy(sourceRow, row, 0, row.Length);
                Marshal.Copy(row, 0, targetRow, row.Length);
            }

            return bitmap;
        }
        catch
        {
            bitmap.Dispose();
            throw;
        }
    }
}
