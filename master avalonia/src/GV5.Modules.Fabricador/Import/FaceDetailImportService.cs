using GV5.Assets.Decoding;
using GV5.Assets.Import;
using SkiaSharp;

namespace GV5.Modules.Fabricador.Import;

/// <summary>Stages and validates a single facial-detail image, preserving alpha in normalized PNG output.</summary>
public sealed class FaceDetailImportService(AssetImportStager stager, AssetImageDecoder decoder)
{
    private readonly AssetImportStager _stager = stager ?? throw new ArgumentNullException(nameof(stager));
    private readonly AssetImageDecoder _decoder = decoder ?? throw new ArgumentNullException(nameof(decoder));

    public async Task<PreparedFaceDetail> PrepareAsync(Stream source, string mediaType,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);
        await using var staged = await _stager.StageAsync(source, mediaType, cancellationToken).ConfigureAwait(false);
        await using var input = await staged.OpenReadAsync(cancellationToken).ConfigureAwait(false);
        var decoded = await _decoder.DecodeAsync(input, cancellationToken).ConfigureAwait(false);
        if (decoded.IsFailure) throw new InvalidDataException(decoded.Error!.Message);

        using var image = decoded.Image!;
        using var encodedImage = SKImage.FromBitmap(image.Bitmap);
        using var encoded = encodedImage.Encode(SKEncodedImageFormat.Png, 100)
            ?? throw new InvalidOperationException("Não foi possível normalizar o detalhe facial para PNG.");
        cancellationToken.ThrowIfCancellationRequested();
        return new PreparedFaceDetail(image.Bitmap.Width, image.Bitmap.Height, encoded.ToArray());
    }
}

public sealed record PreparedFaceDetail(int Width, int Height, byte[] PngBytes);
