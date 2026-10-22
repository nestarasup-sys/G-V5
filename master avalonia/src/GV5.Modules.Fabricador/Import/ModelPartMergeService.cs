using GV5.Application.Contracts;
using GV5.Assets.Decoding;
using GV5.Core.Models;
using SkiaSharp;

namespace GV5.Modules.Fabricador.Import;

/// <summary>Losslessly joins two horizontally adjacent, untransformed asset crops into one RGBA asset.</summary>
public sealed class ModelPartMergeService(IAssetStore assetStore, AssetImageDecoder decoder)
{
    private readonly IAssetStore _assetStore = assetStore ?? throw new ArgumentNullException(nameof(assetStore));
    private readonly AssetImageDecoder _decoder = decoder ?? throw new ArgumentNullException(nameof(decoder));

    public async Task<Result<ModelPartMergeAssets>> MergeHorizontallyAsync(
        ModelPart left,
        ModelPart right,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(left);
        ArgumentNullException.ThrowIfNull(right);
        var dimensions = GetDimensions(left, right);
        if (dimensions is null)
            return Result<ModelPartMergeAssets>.Failure(new ApplicationError(ApplicationErrorCode.Validation,
                "As peças precisam ser recortes inteiros, lado a lado, com a mesma altura."));

        var leftOpen = await _assetStore.OpenReadAsync(left.AssetId, cancellationToken).ConfigureAwait(false);
        if (leftOpen.IsFailure) return Result<ModelPartMergeAssets>.Failure(leftOpen.Error!);
        var rightOpen = await _assetStore.OpenReadAsync(right.AssetId, cancellationToken).ConfigureAwait(false);
        if (rightOpen.IsFailure)
        {
            await leftOpen.Value.DisposeAsync().ConfigureAwait(false);
            return Result<ModelPartMergeAssets>.Failure(rightOpen.Error!);
        }

        await using var leftStream = leftOpen.Value;
        await using var rightStream = rightOpen.Value;
        var decodedLeft = await _decoder.DecodeAsync(leftStream, cancellationToken).ConfigureAwait(false);
        if (decodedLeft.IsFailure)
            return Result<ModelPartMergeAssets>.Failure(new ApplicationError(ApplicationErrorCode.Validation,
                "A imagem da peça esquerda não pode ser decodificada."));
        var decodedRight = await _decoder.DecodeAsync(rightStream, cancellationToken).ConfigureAwait(false);
        if (decodedRight.IsFailure)
        {
            decodedLeft.Image!.Dispose();
            return Result<ModelPartMergeAssets>.Failure(new ApplicationError(ApplicationErrorCode.Validation,
                "A imagem da peça direita não pode ser decodificada."));
        }

        using var leftImage = decodedLeft.Image!;
        using var rightImage = decodedRight.Image!;
        var (leftWidth, rightWidth, height) = dimensions.Value;
        if (leftImage.Width != leftWidth || leftImage.Height != height
            || rightImage.Width != rightWidth || rightImage.Height != height)
        {
            return Result<ModelPartMergeAssets>.Failure(new ApplicationError(ApplicationErrorCode.Validation,
                "Os assets não correspondem aos recortes das peças."));
        }

        byte[] png;
        try
        {
            png = await Task.Run(() => Encode(leftImage.Bitmap, rightImage.Bitmap, cancellationToken), cancellationToken)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or IOException or OutOfMemoryException)
        {
            return Result<ModelPartMergeAssets>.Failure(new ApplicationError(ApplicationErrorCode.Persistence,
                "Não foi possível compor os pixels das peças."));
        }

        await using var stream = new MemoryStream(png, writable: false);
        var imported = await _assetStore.ImportAsync(stream, "image/png", cancellationToken).ConfigureAwait(false);
        if (imported.IsFailure) return Result<ModelPartMergeAssets>.Failure(imported.Error!);
        return Result<ModelPartMergeAssets>.Success(new ModelPartMergeAssets(imported.Value.Id, leftWidth + rightWidth, height));
    }

    public static (int LeftWidth, int RightWidth, int Height)? GetDimensions(ModelPart left, ModelPart right)
    {
        var leftSource = left.SourceTransform.Crop;
        var rightSource = right.SourceTransform.Crop;
        var lw = leftSource.Width;
        var rw = rightSource.Width;
        var h = leftSource.Height;
        if (!IsWhole(leftSource.X) || !IsWhole(leftSource.Y) || !IsWhole(lw) || !IsWhole(h)
            || !IsWhole(rightSource.X) || !IsWhole(rightSource.Y) || !IsWhole(rw)
            || lw < 1 || rw < 1 || h < 1
            || Math.Abs(leftSource.Y - rightSource.Y) > 0.0001
            || Math.Abs(leftSource.Height - rightSource.Height) > 0.0001
            || Math.Abs(rightSource.X - (leftSource.X + lw)) > 0.0001
            || !IsLocalCrop(left.SourceCrop, (int)lw, (int)h)
            || !IsLocalCrop(right.SourceCrop, (int)rw, (int)h))
            return null;
        return ((int)lw, (int)rw, (int)h);
    }

    private static bool IsLocalCrop(GV5.Geometry.Rect2D crop, int width, int height) =>
        Math.Abs(crop.X) < 0.0001 && Math.Abs(crop.Y) < 0.0001
        && Math.Abs(crop.Width - width) < 0.0001 && Math.Abs(crop.Height - height) < 0.0001;

    private static bool IsWhole(double value) => Math.Abs(value - Math.Round(value, MidpointRounding.AwayFromZero)) < 0.0001;

    private static byte[] Encode(SKBitmap left, SKBitmap right, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        using var merged = new SKBitmap(new SKImageInfo(left.Width + right.Width, left.Height,
            SKColorType.Rgba8888, SKAlphaType.Unpremul, left.ColorSpace));
        if (merged.GetPixels() == IntPtr.Zero) throw new InvalidOperationException("Could not allocate merged pixels.");
        using (var canvas = new SKCanvas(merged))
        {
            canvas.Clear(SKColors.Transparent);
            canvas.DrawBitmap(left, 0, 0);
            canvas.DrawBitmap(right, left.Width, 0);
            canvas.Flush();
        }
        using var image = SKImage.FromBitmap(merged);
        using var encoded = image.Encode(SKEncodedImageFormat.Png, 100)
            ?? throw new InvalidOperationException("Could not encode merged image.");
        return encoded.ToArray();
    }
}

public sealed record ModelPartMergeAssets(GV5.Core.Identity.AssetId AssetId, int Width, int Height);
