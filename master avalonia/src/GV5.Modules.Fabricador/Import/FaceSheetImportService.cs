using GV5.Application.Contracts;
using GV5.Assets.Decoding;
using GV5.Assets.Import;
using GV5.Assets.Processing;

namespace GV5.Modules.Fabricador.Import;

/// <summary>Prepares a facial sheet into staged, reviewable PNG components without publishing partial assets.</summary>
public sealed class FaceSheetImportService(AssetImportStager stager, AssetImageDecoder decoder,
    FaceSheetProcessor processor)
{
    public const int MaximumPreviewDimension = 512;

    private readonly AssetImportStager _stager = stager ?? throw new ArgumentNullException(nameof(stager));
    private readonly AssetImageDecoder _decoder = decoder ?? throw new ArgumentNullException(nameof(decoder));
    private readonly FaceSheetProcessor _processor = processor ?? throw new ArgumentNullException(nameof(processor));

    public async Task<Result<FaceSheetImportPreview>> PrepareAsync(Stream source, string mediaType,
        FaceSheetKind kind, FaceSheetOptions? options = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);
        if (!Enum.IsDefined(kind))
            return ValidationFailure<FaceSheetImportPreview>("O tipo de folha facial selecionado é inválido.");

        StagedAssetImport? original = null;
        var stagedPieces = new List<StagedAssetImport>();
        var previews = new List<DecodedAssetImage>();
        try
        {
            original = await _stager.StageAsync(source, mediaType, cancellationToken).ConfigureAwait(false);
            if ((long)original.Width * original.Height > FaceSheetOptions.MaximumPixels)
                return ValidationFailure<FaceSheetImportPreview>("A folha facial excede o limite de 32 milhões de pixels.");

            await using var input = await original.OpenReadAsync(cancellationToken).ConfigureAwait(false);
            var decoded = await _decoder.DecodeAsync(input, cancellationToken).ConfigureAwait(false);
            if (decoded.IsFailure)
                return ValidationFailure<FaceSheetImportPreview>(decoded.Error!.Message);

            using var sourceImage = decoded.Image!;
            using var processed = await _processor.ProcessAsync(sourceImage, kind, options, cancellationToken)
                .ConfigureAwait(false);

            var outputPieces = new List<FaceSheetImportPiecePreview>(processed.Pieces.Count);
            foreach (var piece in processed.Pieces)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var png = piece.EncodePng();
                await using var pngStream = new MemoryStream(png, writable: false);
                var stage = await _stager.StageAsync(pngStream, "image/png", cancellationToken).ConfigureAwait(false);
                stagedPieces.Add(stage);
                var preview = piece.Image.CreatePreviewCopy(MaximumPreviewDimension);
                previews.Add(preview);
                outputPieces.Add(new FaceSheetImportPiecePreview(piece.PartKind, piece.Index, piece.Side,
                    piece.SourceBounds, piece.Image.Width, piece.Image.Height, stage, preview));
            }

            var result = new FaceSheetImportPreview(original, kind, original.Width, original.Height,
                processed.SampledBackground, processed.RemovedPixelCount, processed.DespilledPixelCount, outputPieces);
            original = null;
            stagedPieces.Clear();
            previews.Clear();
            return Result<FaceSheetImportPreview>.Success(result);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (AssetImportException exception)
        {
            return ValidationFailure<FaceSheetImportPreview>(exception.Message);
        }
        catch (InvalidDataException exception)
        {
            return ValidationFailure<FaceSheetImportPreview>(exception.Message);
        }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or IOException or UnauthorizedAccessException)
        {
            return ValidationFailure<FaceSheetImportPreview>("Não foi possível preparar a folha facial.");
        }
        finally
        {
            foreach (var preview in previews) preview.Dispose();
            foreach (var stage in stagedPieces) await stage.DisposeAsync().ConfigureAwait(false);
            if (original is not null) await original.DisposeAsync().ConfigureAwait(false);
        }
    }

    private static Result<T> ValidationFailure<T>(string message) =>
        Result<T>.Failure(new ApplicationError(ApplicationErrorCode.Validation, message));
}

/// <summary>Owns the original sheet and all transparent component stages until confirmation or cancellation.</summary>
public sealed class FaceSheetImportPreview : IAsyncDisposable
{
    private readonly StagedAssetImport _original;
    private readonly IReadOnlyList<FaceSheetImportPiecePreview> _pieces;
    private int _disposed;

    internal FaceSheetImportPreview(StagedAssetImport original, FaceSheetKind kind, int sourceWidth, int sourceHeight,
        SkiaSharp.SKColor sampledBackground, int removedPixelCount, int despilledPixelCount,
        IReadOnlyList<FaceSheetImportPiecePreview> pieces)
    {
        _original = original ?? throw new ArgumentNullException(nameof(original));
        _pieces = pieces ?? throw new ArgumentNullException(nameof(pieces));
        if (!Enum.IsDefined(kind) || sourceWidth < 1 || sourceHeight < 1 || removedPixelCount < 0
            || despilledPixelCount < 0 || pieces.Count == 0)
            throw new ArgumentOutOfRangeException(nameof(kind));
        Kind = kind;
        SourceWidth = sourceWidth;
        SourceHeight = sourceHeight;
        SampledBackground = sampledBackground;
        RemovedPixelCount = removedPixelCount;
        DespilledPixelCount = despilledPixelCount;
    }

    public FaceSheetKind Kind { get; }
    public string OriginalMediaType => _original.MediaType;
    public long OriginalByteLength => _original.ByteLength;
    public string OriginalSha256 => _original.Sha256;
    public int SourceWidth { get; }
    public int SourceHeight { get; }
    public SkiaSharp.SKColor SampledBackground { get; }
    public int RemovedPixelCount { get; }
    public int DespilledPixelCount { get; }
    public IReadOnlyList<FaceSheetImportPiecePreview> Pieces
    {
        get
        {
            ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
            return _pieces;
        }
    }

    public Task<Stream> OpenOriginalReadAsync(CancellationToken cancellationToken = default) =>
        GetOriginal().OpenReadAsync(cancellationToken);

    private StagedAssetImport GetOriginal()
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        return _original;
    }

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        foreach (var piece in _pieces) await piece.DisposeAsync().ConfigureAwait(false);
        await _original.DisposeAsync().ConfigureAwait(false);
    }
}

/// <summary>A staged transparent output and bounded preview for one independently selectable face component.</summary>
public sealed class FaceSheetImportPiecePreview : IAsyncDisposable
{
    private readonly StagedAssetImport _stage;
    private readonly DecodedAssetImage _preview;
    private int _disposed;

    internal FaceSheetImportPiecePreview(FaceSheetPartKind partKind, int index, FaceSheetSide? side,
        ImageCropBounds sourceBounds, int width, int height, StagedAssetImport stage, DecodedAssetImage preview)
    {
        if (!Enum.IsDefined(partKind) || index < 0 || side is { } definedSide && !Enum.IsDefined(definedSide)
            || sourceBounds.IsEmpty || width < 1 || height < 1)
            throw new ArgumentOutOfRangeException(nameof(partKind));
        PartKind = partKind;
        Index = index;
        Side = side;
        SourceBounds = sourceBounds;
        Width = width;
        Height = height;
        _stage = stage ?? throw new ArgumentNullException(nameof(stage));
        _preview = preview ?? throw new ArgumentNullException(nameof(preview));
    }

    public FaceSheetPartKind PartKind { get; }
    public int Index { get; }
    public FaceSheetSide? Side { get; }
    public ImageCropBounds SourceBounds { get; }
    public int Width { get; }
    public int Height { get; }
    public long PngByteLength => _stage.ByteLength;
    public string PngSha256 => _stage.Sha256;
    public GV5.Core.Identity.AssetId StagedAssetId => _stage.Id;
    public DecodedAssetImage Preview
    {
        get
        {
            ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
            return _preview;
        }
    }

    public Task<Stream> OpenPngReadAsync(CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
        return _stage.OpenReadAsync(cancellationToken);
    }

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        _preview.Dispose();
        await _stage.DisposeAsync().ConfigureAwait(false);
    }
}
