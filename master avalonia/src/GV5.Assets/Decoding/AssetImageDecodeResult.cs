using SkiaSharp;

namespace GV5.Assets.Decoding;

public enum AssetImageDecodeErrorCode
{
    InvalidInput = 1,
    UnsupportedFormat = 2,
    InvalidImage = 3,
    ImageTooLarge = 4,
    DecodeFailed = 5
}

public sealed record AssetImageDecodeError(AssetImageDecodeErrorCode Code, string Message);

/// <summary>An owned decoded bitmap. Dispose it when no consumer or cache lease uses it anymore.</summary>
public sealed class DecodedAssetImage : IDisposable
{
    private readonly SKBitmap _bitmap;
    private int _disposed;

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
    public bool HasAlpha => Bitmap.ColorType == SKColorType.Rgba8888;

    internal DecodedAssetImage(SKBitmap bitmap) => _bitmap = bitmap;

    /// <summary>Creates an independently owned, aspect-preserving copy capped for responsive UI previews.</summary>
    public DecodedAssetImage CreatePreviewCopy(int maximumDimension)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        if (maximumDimension < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(maximumDimension));
        }

        var scale = Math.Min(1d, (double)maximumDimension / Math.Max(Width, Height));
        var width = Math.Max(1, (int)Math.Round(Width * scale));
        var height = Math.Max(1, (int)Math.Round(Height * scale));
        var info = new SKImageInfo(width, height, Bitmap.ColorType, Bitmap.AlphaType, Bitmap.ColorSpace);
        var copy = width == Width && height == Height
            ? Bitmap.Copy()
            : Bitmap.Resize(info, new SKSamplingOptions(SKFilterMode.Linear));

        if (copy is null || copy.GetPixels() == IntPtr.Zero)
        {
            copy?.Dispose();
            throw new InvalidOperationException("The preview image buffer could not be allocated.");
        }

        return new DecodedAssetImage(copy);
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 0)
        {
            _bitmap.Dispose();
        }
    }
}

public sealed class AssetImageDecodeResult
{
    private AssetImageDecodeResult(DecodedAssetImage? image, AssetImageDecodeError? error)
    {
        Image = image;
        Error = error;
    }

    public bool IsSuccess => Image is not null;
    public bool IsFailure => !IsSuccess;
    public DecodedAssetImage? Image { get; }
    public AssetImageDecodeError? Error { get; }

    internal static AssetImageDecodeResult Success(DecodedAssetImage image) => new(image, null);
    internal static AssetImageDecodeResult Failure(AssetImageDecodeErrorCode code, string message) => new(null, new AssetImageDecodeError(code, message));
}
