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
    public SKBitmap Bitmap { get; }
    public int Width => Bitmap.Width;
    public int Height => Bitmap.Height;
    public bool HasAlpha => Bitmap.ColorType == SKColorType.Rgba8888;

    internal DecodedAssetImage(SKBitmap bitmap) => Bitmap = bitmap;

    public void Dispose() => Bitmap.Dispose();
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
