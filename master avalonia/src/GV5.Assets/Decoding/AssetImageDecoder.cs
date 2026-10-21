using SkiaSharp;

namespace GV5.Assets.Decoding;

public sealed record AssetImageDecodeLimits(
    int MaximumDimension = 16_384,
    long MaximumPixelCount = 100_000_000,
    long MaximumDecodedBytes = 512L * 1024 * 1024)
{
    public void Validate()
    {
        if (MaximumDimension < 1 || MaximumPixelCount < 1 || MaximumDecodedBytes < 4)
        {
            throw new ArgumentOutOfRangeException(nameof(AssetImageDecodeLimits), "Image decode limits must be positive.");
        }
    }
}

/// <summary>Decodes supported raster images on a worker thread, preserves alpha, and applies codec orientation.</summary>
public sealed class AssetImageDecoder
{
    private readonly AssetImageDecodeLimits _limits;

    public AssetImageDecoder(AssetImageDecodeLimits? limits = null)
    {
        _limits = limits ?? new AssetImageDecodeLimits();
        _limits.Validate();
    }

    /// <summary>
    /// Decodes the image starting at the stream's current position. The caller retains stream ownership.
    /// The stream must be readable and seekable; asset files returned by IAssetStore satisfy this contract.
    /// </summary>
    public Task<AssetImageDecodeResult> DecodeAsync(Stream input, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (!input.CanRead || !input.CanSeek)
        {
            return Task.FromResult(AssetImageDecodeResult.Failure(
                AssetImageDecodeErrorCode.InvalidInput,
                "Image decoding requires a readable, seekable stream."));
        }

        return Task.Run(() => DecodeCore(input, cancellationToken), CancellationToken.None);
    }

    private AssetImageDecodeResult DecodeCore(Stream input, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        try
        {
            using var codecInput = new NonClosingReadStream(input);
            using var codec = SKCodec.Create(codecInput, out var createResult);
            if (codec is null)
            {
                return AssetImageDecodeResult.Failure(
                    createResult == SKCodecResult.Unimplemented ? AssetImageDecodeErrorCode.UnsupportedFormat : AssetImageDecodeErrorCode.InvalidImage,
                    "The image format is unsupported or the encoded image is invalid.");
            }

            var sourceInfo = codec.Info;
            if (sourceInfo.Width < 1 || sourceInfo.Height < 1)
            {
                return AssetImageDecodeResult.Failure(AssetImageDecodeErrorCode.InvalidImage, "The image has invalid dimensions.");
            }

            var swapsAxes = codec.EncodedOrigin is SKEncodedOrigin.LeftTop or SKEncodedOrigin.RightTop or SKEncodedOrigin.RightBottom or SKEncodedOrigin.LeftBottom;
            var width = swapsAxes ? sourceInfo.Height : sourceInfo.Width;
            var height = swapsAxes ? sourceInfo.Width : sourceInfo.Height;
            var pixelCount = (long)width * height;
            var decodedBytes = pixelCount * 4;
            if (width > _limits.MaximumDimension || height > _limits.MaximumDimension ||
                pixelCount > _limits.MaximumPixelCount || decodedBytes > _limits.MaximumDecodedBytes)
            {
                return AssetImageDecodeResult.Failure(AssetImageDecodeErrorCode.ImageTooLarge, "The decoded image exceeds the configured memory or dimension limits.");
            }

            using var colorSpace = SKColorSpace.CreateSrgb();
            var decodeInfo = new SKImageInfo(sourceInfo.Width, sourceInfo.Height, SKColorType.Rgba8888, SKAlphaType.Unpremul, colorSpace);
            using var decoded = new SKBitmap(decodeInfo);
            if (decoded.GetPixels() == IntPtr.Zero)
            {
                return AssetImageDecodeResult.Failure(AssetImageDecodeErrorCode.DecodeFailed, "The decoder could not allocate the image buffer.");
            }

            var decodeResult = codec.GetPixels(decodeInfo, decoded.GetPixels());
            if (decodeResult != SKCodecResult.Success)
            {
                return AssetImageDecodeResult.Failure(
                    decodeResult == SKCodecResult.Unimplemented ? AssetImageDecodeErrorCode.UnsupportedFormat : AssetImageDecodeErrorCode.InvalidImage,
                    $"The encoded image could not be fully decoded ({decodeResult}).");
            }

            cancellationToken.ThrowIfCancellationRequested();
            var oriented = ApplyOrigin(decoded, codec.EncodedOrigin);
            return AssetImageDecodeResult.Success(new DecodedAssetImage(oriented));
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or IOException or NotSupportedException)
        {
            return AssetImageDecodeResult.Failure(AssetImageDecodeErrorCode.InvalidImage, "The encoded image could not be decoded.");
        }
    }

    private static SKBitmap ApplyOrigin(SKBitmap source, SKEncodedOrigin origin)
    {
        if (origin == SKEncodedOrigin.TopLeft)
        {
            return source.Copy();
        }

        var swapsAxes = origin is SKEncodedOrigin.LeftTop or SKEncodedOrigin.RightTop or SKEncodedOrigin.RightBottom or SKEncodedOrigin.LeftBottom;
        var outputWidth = swapsAxes ? source.Height : source.Width;
        var outputHeight = swapsAxes ? source.Width : source.Height;
        var output = new SKBitmap(new SKImageInfo(outputWidth, outputHeight, source.ColorType, source.AlphaType, source.ColorSpace));
        if (output.GetPixels() == IntPtr.Zero)
        {
            output.Dispose();
            throw new InvalidOperationException("The oriented image buffer could not be allocated.");
        }

        using var canvas = new SKCanvas(output);
        var matrix = SKMatrix.CreateIdentity();
        switch (origin)
        {
            case SKEncodedOrigin.TopRight:
                matrix.ScaleX = -1;
                matrix.TransX = source.Width;
                break;
            case SKEncodedOrigin.BottomRight:
                matrix.ScaleX = -1;
                matrix.TransX = source.Width;
                matrix.ScaleY = -1;
                matrix.TransY = source.Height;
                break;
            case SKEncodedOrigin.BottomLeft:
                matrix.ScaleY = -1;
                matrix.TransY = source.Height;
                break;
            case SKEncodedOrigin.RightTop:
                matrix.ScaleX = 0;
                matrix.SkewX = -1;
                matrix.TransX = source.Height;
                matrix.SkewY = 1;
                matrix.ScaleY = 0;
                break;
            case SKEncodedOrigin.LeftBottom:
                matrix.ScaleX = 0;
                matrix.SkewX = 1;
                matrix.SkewY = -1;
                matrix.ScaleY = 0;
                matrix.TransY = source.Width;
                break;
            case SKEncodedOrigin.LeftTop:
                matrix.ScaleX = 0;
                matrix.SkewX = 1;
                matrix.SkewY = 1;
                matrix.ScaleY = 0;
                break;
            case SKEncodedOrigin.RightBottom:
                matrix.ScaleX = 0;
                matrix.SkewX = -1;
                matrix.TransX = source.Height;
                matrix.SkewY = -1;
                matrix.ScaleY = 0;
                matrix.TransY = source.Width;
                break;
            default:
                output.Dispose();
                throw new InvalidOperationException("The image codec returned an unknown orientation.");
        }

        canvas.SetMatrix(matrix);
        canvas.DrawBitmap(source, 0, 0);
        canvas.Flush();
        return output;
    }

    private sealed class NonClosingReadStream(Stream inner) : Stream
    {
        public override bool CanRead => inner.CanRead;
        public override bool CanSeek => inner.CanSeek;
        public override bool CanWrite => false;
        public override long Length => inner.Length;
        public override long Position { get => inner.Position; set => inner.Position = value; }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => inner.Read(buffer, offset, count);
        public override int Read(Span<byte> buffer) => inner.Read(buffer);
        public override long Seek(long offset, SeekOrigin origin) => inner.Seek(offset, origin);
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        protected override void Dispose(bool disposing) { }
    }
}
