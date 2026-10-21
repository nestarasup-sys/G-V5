using GV5.Application.Contracts;
using GV5.Assets.Decoding;
using GV5.Assets.Import;
using GV5.Assets.Processing;

namespace GV5.Modules.Fabricador.Import;

/// <summary>Stages an untouched hair sheet, creates two worker-processed PNGs and returns lightweight review previews.</summary>
public sealed class HairSheetImportService(AssetImportStager stager, AssetImageDecoder decoder,
    HairSheetProcessor processor)
{
    private readonly AssetImportStager _stager = stager ?? throw new ArgumentNullException(nameof(stager));
    private readonly AssetImageDecoder _decoder = decoder ?? throw new ArgumentNullException(nameof(decoder));
    private readonly HairSheetProcessor _processor = processor ?? throw new ArgumentNullException(nameof(processor));

    public async Task<Result<HairSheetImportPreview>> PrepareAsync(Stream source, string mediaType,
        HairSheetOptions? options = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);
        StagedAssetImport? original = null;
        StagedAssetImport? posterior = null;
        StagedAssetImport? traseiro = null;
        DecodedAssetImage? posteriorPreview = null;
        DecodedAssetImage? traseiroPreview = null;
        try
        {
            original = await _stager.StageAsync(source, mediaType, cancellationToken).ConfigureAwait(false);
            if (original.Width > HairSheetProcessor.MaximumDimension
                || original.Height > HairSheetProcessor.MaximumDimension
                || (long)original.Width * original.Height > HairSheetOptions.MaximumPixels)
                return ValidationFailure<HairSheetImportPreview>("A folha de cabelo excede o limite de dimensões.");

            await using var input = await original.OpenReadAsync(cancellationToken).ConfigureAwait(false);
            var decoded = await _decoder.DecodeAsync(input, cancellationToken).ConfigureAwait(false);
            if (decoded.IsFailure)
                return ValidationFailure<HairSheetImportPreview>(decoded.Error!.Message);

            using var sourceImage = decoded.Image!;
            using var processed = await _processor.ProcessAsync(sourceImage, options, cancellationToken).ConfigureAwait(false);
            if (processed.Posterior.IsEmpty || processed.Traseiro.IsEmpty)
                return ValidationFailure<HairSheetImportPreview>(
                    "Não encontrei cabelo nas duas metades. Confira se Posterior está em cima e Traseiro embaixo.");

            var posteriorPng = processed.Posterior.EncodePng();
            await using (var posteriorStream = new MemoryStream(posteriorPng, writable: false))
                posterior = await _stager.StageAsync(posteriorStream, "image/png", cancellationToken).ConfigureAwait(false);

            var traseiroPng = processed.Traseiro.EncodePng();
            await using (var traseiroStream = new MemoryStream(traseiroPng, writable: false))
                traseiro = await _stager.StageAsync(traseiroStream, "image/png", cancellationToken).ConfigureAwait(false);

            posteriorPreview = processed.Posterior.Image.CreatePreviewCopy(HairSheetImportPreview.MaximumPreviewDimension);
            traseiroPreview = processed.Traseiro.Image.CreatePreviewCopy(HairSheetImportPreview.MaximumPreviewDimension);
            var result = new HairSheetImportPreview(original, posterior, traseiro, posteriorPreview, traseiroPreview,
                processed.Posterior.SourceBounds, processed.Traseiro.SourceBounds,
                processed.Posterior.Image.Width, processed.Posterior.Image.Height,
                processed.Traseiro.Image.Width, processed.Traseiro.Image.Height,
                processed.Posterior.RemovedPixelCount + processed.Traseiro.RemovedPixelCount,
                processed.Posterior.DespilledPixelCount + processed.Traseiro.DespilledPixelCount);
            original = null;
            posterior = null;
            traseiro = null;
            posteriorPreview = null;
            traseiroPreview = null;
            return Result<HairSheetImportPreview>.Success(result);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (AssetImportException exception)
        {
            return ValidationFailure<HairSheetImportPreview>(exception.Message);
        }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or IOException or UnauthorizedAccessException)
        {
            return ValidationFailure<HairSheetImportPreview>("Não foi possível preparar a folha de cabelo.");
        }
        finally
        {
            posteriorPreview?.Dispose();
            traseiroPreview?.Dispose();
            if (traseiro is not null) await traseiro.DisposeAsync().ConfigureAwait(false);
            if (posterior is not null) await posterior.DisposeAsync().ConfigureAwait(false);
            if (original is not null) await original.DisposeAsync().ConfigureAwait(false);
        }
    }

    private static Result<T> ValidationFailure<T>(string message) =>
        Result<T>.Failure(new ApplicationError(ApplicationErrorCode.Validation, message));
}

/// <summary>Owns the untouched source, staged transparent PNGs and reduced previews until confirm or cancel.</summary>
public sealed class HairSheetImportPreview : IAsyncDisposable
{
    public const int MaximumPreviewDimension = 768;
    private readonly StagedAssetImport _original;
    private readonly StagedAssetImport _posterior;
    private readonly StagedAssetImport _traseiro;
    private readonly DecodedAssetImage _posteriorImage;
    private readonly DecodedAssetImage _traseiroImage;
    private int _disposed;

    internal HairSheetImportPreview(StagedAssetImport original, StagedAssetImport posterior,
        StagedAssetImport traseiro, DecodedAssetImage posteriorImage, DecodedAssetImage traseiroImage,
        ImageCropBounds posteriorBounds, ImageCropBounds traseiroBounds, int posteriorWidth, int posteriorHeight,
        int traseiroWidth, int traseiroHeight, int removedPixels, int despilledPixels)
    {
        _original = original ?? throw new ArgumentNullException(nameof(original));
        _posterior = posterior ?? throw new ArgumentNullException(nameof(posterior));
        _traseiro = traseiro ?? throw new ArgumentNullException(nameof(traseiro));
        _posteriorImage = posteriorImage ?? throw new ArgumentNullException(nameof(posteriorImage));
        _traseiroImage = traseiroImage ?? throw new ArgumentNullException(nameof(traseiroImage));
        if (posteriorBounds.IsEmpty || traseiroBounds.IsEmpty || posteriorWidth < 1 || posteriorHeight < 1
            || traseiroWidth < 1 || traseiroHeight < 1 || removedPixels < 0 || despilledPixels < 0)
            throw new ArgumentOutOfRangeException(nameof(posteriorBounds));
        PosteriorSourceBounds = posteriorBounds;
        TraseiroSourceBounds = traseiroBounds;
        PosteriorWidth = posteriorWidth;
        PosteriorHeight = posteriorHeight;
        TraseiroWidth = traseiroWidth;
        TraseiroHeight = traseiroHeight;
        RemovedPixelCount = removedPixels;
        DespilledPixelCount = despilledPixels;
    }

    public string OriginalMediaType => _original.MediaType;
    public long OriginalByteLength => _original.ByteLength;
    public string OriginalSha256 => _original.Sha256;
    public int SourceWidth => _original.Width;
    public int SourceHeight => _original.Height;
    /// <summary>Ephemeral staging handle; never persist it as a library asset reference.</summary>
    public GV5.Core.Identity.AssetId StagedPosteriorAssetId => _posterior.Id;
    /// <summary>Ephemeral staging handle; never persist it as a library asset reference.</summary>
    public GV5.Core.Identity.AssetId StagedTraseiroAssetId => _traseiro.Id;
    public ImageCropBounds PosteriorSourceBounds { get; }
    public ImageCropBounds TraseiroSourceBounds { get; }
    public int PosteriorWidth { get; }
    public int PosteriorHeight { get; }
    public int TraseiroWidth { get; }
    public int TraseiroHeight { get; }
    public int RemovedPixelCount { get; }
    public int DespilledPixelCount { get; }
    public DecodedAssetImage PosteriorPreview => GetImage(_posteriorImage);
    public DecodedAssetImage TraseiroPreview => GetImage(_traseiroImage);
    public long PosteriorPngByteLength => _posterior.ByteLength;
    public string PosteriorPngSha256 => _posterior.Sha256;
    public long TraseiroPngByteLength => _traseiro.ByteLength;
    public string TraseiroPngSha256 => _traseiro.Sha256;

    public Task<Stream> OpenOriginalReadAsync(CancellationToken cancellationToken = default) =>
        GetStage(_original).OpenReadAsync(cancellationToken);

    public Task<Stream> OpenPosteriorPngReadAsync(CancellationToken cancellationToken = default) =>
        GetStage(_posterior).OpenReadAsync(cancellationToken);

    public Task<Stream> OpenTraseiroPngReadAsync(CancellationToken cancellationToken = default) =>
        GetStage(_traseiro).OpenReadAsync(cancellationToken);

    private DecodedAssetImage GetImage(DecodedAssetImage image)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        return image;
    }

    private StagedAssetImport GetStage(StagedAssetImport stage)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        return stage;
    }

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        _posteriorImage.Dispose();
        _traseiroImage.Dispose();
        await _traseiro.DisposeAsync().ConfigureAwait(false);
        await _posterior.DisposeAsync().ConfigureAwait(false);
        await _original.DisposeAsync().ConfigureAwait(false);
    }
}
