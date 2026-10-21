using GV5.Application.Contracts;
using GV5.Assets.Decoding;
using GV5.Assets.Import;
using GV5.Assets.Processing;
using GV5.Core.Identity;
using GV5.Geometry;
using SkiaSharp;

namespace GV5.Modules.Fabricador.Import;

/// <summary>Stages and decodes a model sheet for review; publishing only happens after explicit confirmation.</summary>
public sealed class ModelSourceImportService(AssetImportStager stager, AssetImageDecoder decoder, ModelSheetSegmentationProcessor segmentationProcessor)
{
    private readonly AssetImportStager _stager = stager ?? throw new ArgumentNullException(nameof(stager));
    private readonly AssetImageDecoder _decoder = decoder ?? throw new ArgumentNullException(nameof(decoder));
    private readonly ModelSheetSegmentationProcessor _segmentationProcessor = segmentationProcessor ?? throw new ArgumentNullException(nameof(segmentationProcessor));

    public async Task<Result<ModelSourceImportPreview>> PrepareAsync(
        Stream source,
        string mediaType,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);

        StagedAssetImport? staged = null;
        try
        {
            staged = await _stager.StageAsync(source, mediaType, cancellationToken).ConfigureAwait(false);
            await using var previewStream = await staged.OpenReadAsync(cancellationToken).ConfigureAwait(false);
            var decoded = await _decoder.DecodeAsync(previewStream, cancellationToken).ConfigureAwait(false);
            if (decoded.IsFailure)
            {
                await staged.DisposeAsync().ConfigureAwait(false);
                return Result<ModelSourceImportPreview>.Failure(new ApplicationError(
                    ApplicationErrorCode.Validation,
                    decoded.Error!.Message));
            }

            var image = decoded.Image!;
            var sourceWidth = image.Width;
            var sourceHeight = image.Height;
            DecodedAssetImage previewImage;
            try
            {
                previewImage = image.CreatePreviewCopy(ModelSourceImportPreview.MaximumPreviewDimension);
            }
            finally
            {
                image.Dispose();
            }

            var preview = new ModelSourceImportPreview(staged, previewImage, sourceWidth, sourceHeight);
            staged = null;
            return Result<ModelSourceImportPreview>.Success(preview);
        }
        catch (AssetImportException exception)
        {
            return Result<ModelSourceImportPreview>.Failure(new ApplicationError(ApplicationErrorCode.Validation, exception.Message));
        }
        finally
        {
            if (staged is not null)
            {
                await staged.DisposeAsync().ConfigureAwait(false);
            }
        }
    }

    public async Task<Result<AssetMetadata>> PublishAsync(
        ModelSourceImportPreview preview,
        IAssetStore assetStore,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(preview);
        ArgumentNullException.ThrowIfNull(assetStore);
        if (!preview.TryBeginPublish())
        {
            return Result<AssetMetadata>.Failure(new ApplicationError(
                preview.IsPublished ? ApplicationErrorCode.Conflict : ApplicationErrorCode.Conflict,
                preview.IsPublished ? "This model sheet has already been published." : "This model sheet is already being published."));
        }

        var completed = false;
        try
        {
            Result<AssetMetadata> result;
            await using (var content = await preview.OpenStagedReadAsync(cancellationToken).ConfigureAwait(false))
            {
                result = await assetStore.ImportAsync(content, preview.MediaType, cancellationToken).ConfigureAwait(false);
            }

            if (result.IsFailure)
            {
                return Result<AssetMetadata>.Failure(result.Error!);
            }

            var metadata = result.Value;
            if (!string.Equals(metadata.Sha256, preview.Sha256, StringComparison.Ordinal)
                || !string.Equals(metadata.MediaType, preview.MediaType, StringComparison.Ordinal)
                || metadata.ByteLength != preview.ByteLength)
            {
                return Result<AssetMetadata>.Failure(new ApplicationError(
                    ApplicationErrorCode.Persistence,
                    "The stored model sheet does not match the reviewed source image."));
            }

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
            return Result<AssetMetadata>.Failure(new ApplicationError(ApplicationErrorCode.Persistence, "The reviewed model sheet could not be published."));
        }
        finally
        {
            if (!completed)
            {
                preview.EndPublishAttempt();
            }
        }
    }

    /// <summary>Reprocesses the persisted source and publishes each legacy-compatible connected component as an asset.</summary>
    public async Task<Result<IReadOnlyList<ModelSourcePartAsset>>> ImportSeparatedPartsAsync(
        ModelSourceImportPreview preview,
        IAssetStore assetStore,
        CancellationToken cancellationToken = default,
        int tolerance = 74)
    {
        ArgumentNullException.ThrowIfNull(preview);
        ArgumentNullException.ThrowIfNull(assetStore);
        if (!preview.IsPublished || preview.PublishedAssetId is not { } sourceAssetId)
        {
            return Result<IReadOnlyList<ModelSourcePartAsset>>.Failure(new ApplicationError(
                ApplicationErrorCode.Validation,
                "Publique a imagem-fonte antes de separar as peças do modelo."));
        }

        var sourceStream = await assetStore.OpenReadAsync(sourceAssetId, cancellationToken).ConfigureAwait(false);
        if (sourceStream.IsFailure)
        {
            return Result<IReadOnlyList<ModelSourcePartAsset>>.Failure(sourceStream.Error!);
        }

        await using var stream = sourceStream.Value;
        var decoded = await _decoder.DecodeAsync(stream, cancellationToken).ConfigureAwait(false);
        if (decoded.IsFailure)
        {
            return Result<IReadOnlyList<ModelSourcePartAsset>>.Failure(new ApplicationError(ApplicationErrorCode.Validation, decoded.Error!.Message));
        }

        using var source = decoded.Image!;
        ModelSheetSegmentationResult segmentation;
        try
        {
            segmentation = await _segmentationProcessor.ProcessAsync(source, tolerance, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or OutOfMemoryException)
        {
            return Result<IReadOnlyList<ModelSourcePartAsset>>.Failure(new ApplicationError(
                ApplicationErrorCode.Validation,
                "Não foi possível separar as peças da imagem-fonte."));
        }

        if (segmentation.Parts.Count == 0)
        {
            return Result<IReadOnlyList<ModelSourcePartAsset>>.Failure(new ApplicationError(
                ApplicationErrorCode.Validation,
                "Nenhuma peça visível foi encontrada. Confira o fundo/chroma e tente outra imagem."));
        }

        var importedParts = new List<ModelSourcePartAsset>(segmentation.Parts.Count);
        foreach (var part in segmentation.Parts)
        {
            cancellationToken.ThrowIfCancellationRequested();
            await using var partStream = new MemoryStream(part.PngBytes, writable: false);
            var imported = await assetStore.ImportAsync(partStream, "image/png", cancellationToken).ConfigureAwait(false);
            if (imported.IsFailure)
            {
                return Result<IReadOnlyList<ModelSourcePartAsset>>.Failure(imported.Error!);
            }

            importedParts.Add(new ModelSourcePartAsset(part.Name, part.SourceBounds, imported.Value));
        }

        return Result<IReadOnlyList<ModelSourcePartAsset>>.Success(importedParts.AsReadOnly());
    }

    /// <summary>Creates a disposable chroma/crop preview from the staged source while preserving its original bytes.</summary>
    public async Task PrepareChromaPreviewAsync(
        ModelSourceImportPreview preview,
        int tolerance,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(preview);
        if (preview.IsPublished)
        {
            throw new InvalidOperationException("A chroma preview can only be adjusted before the source is published.");
        }

        await using var sourceStream = await preview.OpenStagedReadAsync(cancellationToken).ConfigureAwait(false);
        var decoded = await _decoder.DecodeAsync(sourceStream, cancellationToken).ConfigureAwait(false);
        if (decoded.IsFailure)
        {
            throw new InvalidOperationException(decoded.Error!.Message);
        }

        using var source = decoded.Image!;
        using var result = await _segmentationProcessor.PreviewChromaAsync(source, tolerance, cancellationToken).ConfigureAwait(false);
        cancellationToken.ThrowIfCancellationRequested();
        var displayImage = result.Image.CreatePreviewCopy(ModelSourceImportPreview.MaximumPreviewDimension);
        try
        {
            preview.SetChromaPreview(displayImage, tolerance, result.SampledBackground, result.RemovedPixelCount);
        }
        catch
        {
            displayImage.Dispose();
            throw;
        }
    }
}

public sealed record ModelSourcePartAsset(string Name, ImageCropBounds SourceBounds, AssetMetadata Asset);

/// <summary>Owns a validated stage file and decoded preview until publication or cancellation.</summary>
public sealed class ModelSourceImportPreview : IAsyncDisposable
{
    public const int MaximumPreviewDimension = 1280;

    private readonly StagedAssetImport _staged;
    private readonly DecodedAssetImage _image;
    private DecodedAssetImage? _chromaPreviewImage;
    private readonly int _width;
    private readonly int _height;
    private int _publishState;
    private int _disposed;

    internal ModelSourceImportPreview(StagedAssetImport staged, DecodedAssetImage image, int width, int height)
    {
        _staged = staged ?? throw new ArgumentNullException(nameof(staged));
        _image = image ?? throw new ArgumentNullException(nameof(image));
        if (width < 1 || height < 1 || width < image.Width || height < image.Height)
        {
            throw new ArgumentOutOfRangeException(nameof(width), "Source dimensions must be positive and contain the preview image.");
        }

        _width = width;
        _height = height;
    }

    public string MediaType => _staged.MediaType;
    public long ByteLength => _staged.ByteLength;
    public int Width => _width;
    public int Height => _height;
    public int PreviewWidth => Image.Width;
    public int PreviewHeight => Image.Height;
    public bool HasChromaPreview => _chromaPreviewImage is not null;
    public int? AppliedChromaTolerance { get; private set; }
    public SKColor? SampledChromaBackground { get; private set; }
    public int ChromaRemovedPixelCount { get; private set; }
    public string Sha256 => _staged.Sha256;
    public DecodedAssetImage Image
    {
        get
        {
            ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
            return _image;
        }
    }
    public DecodedAssetImage DisplayImage
    {
        get
        {
            ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
            return _chromaPreviewImage ?? _image;
        }
    }
    public bool IsPublished => Volatile.Read(ref _publishState) == 2;
    public AssetId? PublishedAssetId { get; private set; }

    internal bool TryBeginPublish() => Interlocked.CompareExchange(ref _publishState, 1, 0) == 0;
    internal void EndPublishAttempt() => Interlocked.CompareExchange(ref _publishState, 0, 1);

    internal void MarkPublished(AssetId assetId)
    {
        if (!assetId.IsValid || Interlocked.CompareExchange(ref _publishState, 2, 1) != 1)
        {
            throw new InvalidOperationException("The import preview is not in a publishable state.");
        }

        PublishedAssetId = assetId;
    }

    internal Task<Stream> OpenStagedReadAsync(CancellationToken cancellationToken) =>
        _staged.OpenReadAsync(cancellationToken);

    internal void SetChromaPreview(DecodedAssetImage previewImage, int tolerance, SKColor sampledBackground, int removedPixels)
    {
        ArgumentNullException.ThrowIfNull(previewImage);
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        if (IsPublished)
        {
            throw new InvalidOperationException("A published source cannot be adjusted.");
        }

        Interlocked.Exchange(ref _chromaPreviewImage, previewImage)?.Dispose();
        AppliedChromaTolerance = tolerance;
        SampledChromaBackground = sampledBackground;
        ChromaRemovedPixelCount = removedPixels;
    }

    internal ValueTask DisposeStagedAsync() => _staged.DisposeAsync();

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 0)
        {
            _image.Dispose();
            Interlocked.Exchange(ref _chromaPreviewImage, null)?.Dispose();
            await _staged.DisposeAsync().ConfigureAwait(false);
        }
    }
}
