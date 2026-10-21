using GV5.Application.Contracts;
using GV5.Assets.Decoding;
using GV5.Assets.Import;
using GV5.Assets.Processing;

namespace GV5.Modules.Fabricador.Import;

/// <summary>Prepares an alpha-preserving garment crop for review and publishes only after confirmation.</summary>
public sealed class WardrobeComponentImportService(AssetImportStager stager, AssetImageDecoder decoder,
    TransparentImageCropProcessor cropProcessor)
{
    public const int MaximumSourceDimension = 8_192;
    public const long MaximumSourcePixels = 32_000_000;

    private readonly AssetImportStager _stager = stager ?? throw new ArgumentNullException(nameof(stager));
    private readonly AssetImageDecoder _decoder = decoder ?? throw new ArgumentNullException(nameof(decoder));
    private readonly TransparentImageCropProcessor _cropProcessor = cropProcessor ?? throw new ArgumentNullException(nameof(cropProcessor));

    public async Task<Result<WardrobeComponentImportPreview>> PrepareAsync(Stream source, string mediaType,
        int transparentMargin = 2, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);
        StagedAssetImport? sourceStage = null;
        StagedAssetImport? croppedStage = null;
        DecodedAssetImage? previewImage = null;
        try
        {
            sourceStage = await _stager.StageAsync(source, mediaType, cancellationToken).ConfigureAwait(false);
            if (sourceStage.Width > MaximumSourceDimension || sourceStage.Height > MaximumSourceDimension
                || (long)sourceStage.Width * sourceStage.Height > MaximumSourcePixels)
                return ValidationFailure<WardrobeComponentImportPreview>("A imagem de roupa excede o limite de dimensões.");

            await using var input = await sourceStage.OpenReadAsync(cancellationToken).ConfigureAwait(false);
            var decoded = await _decoder.DecodeAsync(input, cancellationToken).ConfigureAwait(false);
            if (decoded.IsFailure) return ValidationFailure<WardrobeComponentImportPreview>(decoded.Error!.Message);

            using var image = decoded.Image!;
            using var crop = await _cropProcessor.ProcessAsync(image, transparentMargin, cancellationToken).ConfigureAwait(false);
            if (crop.IsEmpty) return ValidationFailure<WardrobeComponentImportPreview>("A imagem não contém pixels visíveis fora da transparência.");

            var pngBytes = crop.EncodePng();
            await using var pngStream = new MemoryStream(pngBytes, writable: false);
            croppedStage = await _stager.StageAsync(pngStream, "image/png", cancellationToken).ConfigureAwait(false);
            await using var croppedRead = await croppedStage.OpenReadAsync(cancellationToken).ConfigureAwait(false);
            var croppedDecoded = await _decoder.DecodeAsync(croppedRead, cancellationToken).ConfigureAwait(false);
            if (croppedDecoded.IsFailure)
                return ValidationFailure<WardrobeComponentImportPreview>("Não foi possível gerar a prévia do recorte transparente.");
            using (var fullImage = croppedDecoded.Image!)
                previewImage = fullImage.CreatePreviewCopy(WardrobeComponentImportPreview.MaximumPreviewDimension);

            var result = new WardrobeComponentImportPreview(croppedStage, previewImage, crop.SourceBounds,
                crop.Image.Width, crop.Image.Height);
            croppedStage = null;
            previewImage = null;
            return Result<WardrobeComponentImportPreview>.Success(result);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (AssetImportException exception)
        {
            return ValidationFailure<WardrobeComponentImportPreview>(exception.Message);
        }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or IOException or UnauthorizedAccessException)
        {
            return ValidationFailure<WardrobeComponentImportPreview>("Não foi possível preparar o recorte da roupa.");
        }
        finally
        {
            previewImage?.Dispose();
            if (croppedStage is not null) await croppedStage.DisposeAsync().ConfigureAwait(false);
            if (sourceStage is not null) await sourceStage.DisposeAsync().ConfigureAwait(false);
        }
    }

    public async Task<Result<AssetMetadata>> PublishAsync(WardrobeComponentImportPreview preview,
        IAssetStore assetStore, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(preview);
        ArgumentNullException.ThrowIfNull(assetStore);
        if (!preview.TryBeginPublish())
            return Result<AssetMetadata>.Failure(new ApplicationError(ApplicationErrorCode.Conflict,
                preview.IsPublished ? "Este recorte já foi publicado." : "Este recorte já está sendo publicado."));

        var completed = false;
        try
        {
            Result<AssetMetadata> imported;
            await using (var content = await preview.OpenStagedReadAsync(cancellationToken).ConfigureAwait(false))
                imported = await assetStore.ImportAsync(content, "image/png", cancellationToken).ConfigureAwait(false);
            if (imported.IsFailure) return Result<AssetMetadata>.Failure(imported.Error!);

            var metadata = imported.Value;
            if (!string.Equals(metadata.Sha256, preview.Sha256, StringComparison.Ordinal)
                || !string.Equals(metadata.MediaType, "image/png", StringComparison.Ordinal)
                || metadata.ByteLength != preview.ByteLength)
                return Result<AssetMetadata>.Failure(new ApplicationError(ApplicationErrorCode.Persistence,
                    "O AssetStore retornou conteúdo diferente do recorte aprovado."));

            preview.MarkPublished(metadata.Id);
            completed = true;
            await preview.DisposeStagedAsync().ConfigureAwait(false);
            return Result<AssetMetadata>.Success(metadata);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or ObjectDisposedException)
        {
            return Result<AssetMetadata>.Failure(new ApplicationError(ApplicationErrorCode.Persistence,
                "Não foi possível publicar o recorte no AssetStore."));
        }
        finally
        {
            if (!completed) preview.EndPublishAttempt();
        }
    }

    private static Result<T> ValidationFailure<T>(string message) =>
        Result<T>.Failure(new ApplicationError(ApplicationErrorCode.Validation, message));
}

/// <summary>Owns a staged, cropped PNG and a light decoded preview until publish or cancel.</summary>
public sealed class WardrobeComponentImportPreview : IAsyncDisposable
{
    public const int MaximumPreviewDimension = 768;
    private readonly StagedAssetImport _staged;
    private readonly DecodedAssetImage _image;
    private int _publishState;
    private int _disposed;

    internal WardrobeComponentImportPreview(StagedAssetImport staged, DecodedAssetImage image,
        ImageCropBounds sourceBounds, int width, int height)
    {
        _staged = staged ?? throw new ArgumentNullException(nameof(staged));
        _image = image ?? throw new ArgumentNullException(nameof(image));
        if (sourceBounds.IsEmpty || width < 1 || height < 1 || width < image.Width || height < image.Height)
            throw new ArgumentOutOfRangeException(nameof(width));
        SourceBounds = sourceBounds;
        Width = width;
        Height = height;
    }

    public ImageCropBounds SourceBounds { get; }
    public int Width { get; }
    public int Height { get; }
    public int PreviewWidth => Image.Width;
    public int PreviewHeight => Image.Height;
    public long ByteLength => _staged.ByteLength;
    public string Sha256 => _staged.Sha256;
    public DecodedAssetImage Image
    {
        get
        {
            ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
            return _image;
        }
    }
    public bool IsPublished => Volatile.Read(ref _publishState) == 2;
    public GV5.Core.Identity.AssetId? PublishedAssetId { get; private set; }

    internal bool TryBeginPublish() => Interlocked.CompareExchange(ref _publishState, 1, 0) == 0;
    internal void EndPublishAttempt() => Interlocked.CompareExchange(ref _publishState, 0, 1);
    internal Task<Stream> OpenStagedReadAsync(CancellationToken cancellationToken) => _staged.OpenReadAsync(cancellationToken);
    internal ValueTask DisposeStagedAsync() => _staged.DisposeAsync();

    internal void MarkPublished(GV5.Core.Identity.AssetId assetId)
    {
        if (!assetId.IsValid || Interlocked.CompareExchange(ref _publishState, 2, 1) != 1)
            throw new InvalidOperationException("The wardrobe crop is not in a publishable state.");
        PublishedAssetId = assetId;
    }

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 0)
        {
            _image.Dispose();
            await _staged.DisposeAsync().ConfigureAwait(false);
        }
    }
}
