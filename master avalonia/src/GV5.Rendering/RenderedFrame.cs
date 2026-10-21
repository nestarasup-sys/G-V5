using SkiaSharp;

namespace GV5.Rendering;

/// <summary>A CPU-rasterized frame whose bitmap remains valid until this owner is disposed.</summary>
public sealed class RenderedFrame : IDisposable
{
    private readonly SKBitmap _bitmap;
    private int _disposed;

    internal RenderedFrame(SKBitmap bitmap) => _bitmap = bitmap;

    public SKBitmap Bitmap
    {
        get
        {
            ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
            return _bitmap;
        }
    }

    public int Width => Bitmap.Width;
    public int Height => Bitmap.Height;

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 0)
        {
            _bitmap.Dispose();
        }
    }
}
