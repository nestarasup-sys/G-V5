using GV5.Application.Contracts;
using GV5.Assets.Decoding;
using GV5.Core.Models;
using SkiaSharp;

namespace GV5.Modules.Fabricador.Import;

/// <summary>Creates two lossless alpha PNG assets from the vertical midpoint of a model part.</summary>
public sealed class ModelPartSplitService(IAssetStore assetStore, AssetImageDecoder decoder)
{
    private readonly IAssetStore _assetStore = assetStore ?? throw new ArgumentNullException(nameof(assetStore));
    private readonly AssetImageDecoder _decoder = decoder ?? throw new ArgumentNullException(nameof(decoder));

    public async Task<Result<ModelPartSplitAssets>> SplitVerticallyAsync(
        ModelPart part,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(part);
        var opened = await _assetStore.OpenReadAsync(part.AssetId, cancellationToken).ConfigureAwait(false);
        if (opened.IsFailure)
            return Result<ModelPartSplitAssets>.Failure(opened.Error!);

        await using var input = opened.Value;
        var decoded = await _decoder.DecodeAsync(input, cancellationToken).ConfigureAwait(false);
        if (decoded.IsFailure)
            return Result<ModelPartSplitAssets>.Failure(new ApplicationError(
                ApplicationErrorCode.Validation,
                "A imagem da peça não pode ser decodificada para divisão."));

        using var image = decoded.Image!;
        var crop = part.SourceCrop;
        var left = (int)Math.Round(crop.X, MidpointRounding.AwayFromZero);
        var top = (int)Math.Round(crop.Y, MidpointRounding.AwayFromZero);
        var width = (int)Math.Round(crop.Width, MidpointRounding.AwayFromZero);
        var height = (int)Math.Round(crop.Height, MidpointRounding.AwayFromZero);
        if (Math.Abs(crop.X - left) > 0.0001 || Math.Abs(crop.Y - top) > 0.0001
            || Math.Abs(crop.Width - width) > 0.0001 || Math.Abs(crop.Height - height) > 0.0001
            || left < 0 || top < 0 || width < 2 || height < 1
            || left + width > image.Width || top + height > image.Height)
        {
            return Result<ModelPartSplitAssets>.Failure(new ApplicationError(
                ApplicationErrorCode.Validation,
                "A peça precisa ter um recorte inteiro válido com pelo menos dois pixels de largura."));
        }

        byte[][] pngs;
        try
        {
            pngs = await Task.Run(() => EncodeHalves(image.Bitmap, left, top, width, height, cancellationToken), cancellationToken)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or IOException or OutOfMemoryException)
        {
            return Result<ModelPartSplitAssets>.Failure(new ApplicationError(
                ApplicationErrorCode.Persistence,
                "Não foi possível preparar as duas imagens da peça."));
        }

        var first = await ImportPngAsync(pngs[0], cancellationToken).ConfigureAwait(false);
        if (first.IsFailure)
            return Result<ModelPartSplitAssets>.Failure(first.Error!);

        var second = await ImportPngAsync(pngs[1], cancellationToken).ConfigureAwait(false);
        if (second.IsFailure)
            return Result<ModelPartSplitAssets>.Failure(second.Error!);

        return Result<ModelPartSplitAssets>.Success(new ModelPartSplitAssets(first.Value, second.Value, width / 2, width - width / 2, height));
    }

    private async Task<Result<AssetMetadata>> ImportPngAsync(byte[] bytes, CancellationToken cancellationToken)
    {
        await using var stream = new MemoryStream(bytes, writable: false);
        return await _assetStore.ImportAsync(stream, "image/png", cancellationToken).ConfigureAwait(false);
    }

    private static byte[][] EncodeHalves(SKBitmap source, int cropX, int cropY, int width, int height, CancellationToken cancellationToken)
    {
        var firstWidth = width / 2;
        var secondWidth = width - firstWidth;
        var result = new byte[2][];
        for (var half = 0; half < 2; half++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var halfWidth = half == 0 ? firstWidth : secondWidth;
            using var bitmap = new SKBitmap(new SKImageInfo(halfWidth, height, SKColorType.Rgba8888, SKAlphaType.Unpremul, source.ColorSpace));
            if (bitmap.GetPixels() == IntPtr.Zero
                || !source.ExtractSubset(bitmap, new SKRectI(cropX + (half == 0 ? 0 : firstWidth), cropY, cropX + (half == 0 ? firstWidth : width), cropY + height)))
            {
                throw new InvalidOperationException("A split image buffer could not be allocated or copied.");
            }

            using var image = SKImage.FromBitmap(bitmap);
            using var encoded = image.Encode(SKEncodedImageFormat.Png, 100)
                ?? throw new InvalidOperationException("A split image could not be encoded as PNG.");
            result[half] = encoded.ToArray();
        }

        return result;
    }
}

public sealed record ModelPartSplitAssets(AssetMetadata Left, AssetMetadata Right, int LeftWidth, int RightWidth, int Height);
