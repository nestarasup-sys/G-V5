using GV5.Application.Contracts;
using GV5.Assets.Decoding;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using GV5.Rendering;

namespace GV5.Modules.Fabricador.Rendering;

/// <summary>Builds the facial workspace preview from durable assets and the shared renderer.</summary>
public sealed class FaceCatalogPreviewRenderer(
    IAssetStore assetStore,
    AssetImageDecoder decoder,
    IRenderSceneRenderer renderer)
{
    private const int MaximumCachedComponentCrops = 64;
    private const int MaximumCachedAlphaMaskBytes = 8 * 1024 * 1024;
    private readonly IAssetStore _assetStore = assetStore ?? throw new ArgumentNullException(nameof(assetStore));
    private readonly AssetImageDecoder _decoder = decoder ?? throw new ArgumentNullException(nameof(decoder));
    private readonly IRenderSceneRenderer _renderer = renderer ?? throw new ArgumentNullException(nameof(renderer));
    private readonly Dictionary<AssetId, Rect2D> _componentCrops = [];
    private readonly Dictionary<AssetId, FaceAlphaMask> _alphaMasks = [];
    private readonly Dictionary<AssetId, LinkedListNode<AssetId>> _alphaMaskNodes = [];
    private readonly LinkedList<AssetId> _alphaMaskLru = [];
    private readonly SemaphoreSlim _cropGate = new(1, 1);
    private int _alphaMaskBytes;

    public async Task<RenderedFrame> RenderAsync(PublishedModelRevision model, FaceCatalogDraft? catalog,
        int maximumDimension = 512, CancellationToken cancellationToken = default)
    {
        var scene = await BuildSceneAsync(model, catalog, maximumDimension, cancellationToken);
        return await _renderer.RenderAsync(scene, cancellationToken);
    }

    public async Task<RenderScene> BuildSceneAsync(PublishedModelRevision model, FaceCatalogDraft? catalog,
        int maximumDimension = 512, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(model);
        catalog ??= FaceCatalogDraft.Create(ModelRevisionReference.From(model), "Prévia facial");
        if (catalog.Model != ModelRevisionReference.From(model))
            throw new ArgumentException("The facial catalog targets a different model revision.", nameof(catalog));

        var selections = FaceCatalogPreviewSceneBuilder.GetDefaultSelections(catalog);
        var crops = new Dictionary<AssetId, Rect2D>();
        foreach (var assetId in selections.Select(selection => selection.Component.AssetId).Distinct())
        {
            cancellationToken.ThrowIfCancellationRequested();
            crops.Add(assetId, await GetComponentCropAsync(assetId, cancellationToken));
        }

        var scene = FaceCatalogPreviewSceneBuilder.Build(model, catalog, crops, maximumDimension);
        return scene;
    }

    public async Task<FaceComponentId?> HitTestAsync(PublishedModelRevision model, FaceCatalogDraft catalog,
        Point2D previewPoint, int maximumDimension = 512, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(catalog);
        var selections = FaceCatalogPreviewSceneBuilder.GetDefaultSelections(catalog);
        var crops = new Dictionary<AssetId, Rect2D>();
        var alphaMasks = new Dictionary<AssetId, FaceAlphaMask>();
        foreach (var assetId in selections.Select(selection => selection.Component.AssetId).Distinct())
        {
            cancellationToken.ThrowIfCancellationRequested();
            var mask = await GetComponentAlphaMaskAsync(assetId, cancellationToken).ConfigureAwait(false);
            alphaMasks.Add(assetId, mask);
            crops.Add(assetId, new Rect2D(0, 0, mask.Width, mask.Height));
        }
        return FaceCatalogPreviewSceneBuilder.HitTest(model, catalog, crops, previewPoint, maximumDimension, alphaMasks);
    }

    private async Task<FaceAlphaMask> GetComponentAlphaMaskAsync(AssetId assetId, CancellationToken cancellationToken)
    {
        await _cropGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_alphaMasks.TryGetValue(assetId, out var cached))
            {
                _alphaMaskLru.Remove(_alphaMaskNodes[assetId]);
                _alphaMaskLru.AddFirst(_alphaMaskNodes[assetId]);
                _componentCrops[assetId] = new Rect2D(0, 0, cached.Width, cached.Height);
                return cached;
            }

            var metadata = await _assetStore.GetMetadataAsync(assetId, cancellationToken).ConfigureAwait(false);
            if (metadata.IsFailure || metadata.Value.VerificationState != AssetVerificationState.Available)
                throw new InvalidOperationException("Um componente facial selecionado referencia uma imagem indisponível.");
            var opened = await _assetStore.OpenReadAsync(assetId, cancellationToken).ConfigureAwait(false);
            if (opened.IsFailure)
                throw new InvalidOperationException("Não foi possível abrir a imagem de um componente facial selecionado.");

            await using var stream = opened.Value;
            var decoded = await _decoder.DecodeAsync(stream, cancellationToken).ConfigureAwait(false);
            if (decoded.IsFailure)
                throw new InvalidDataException("A imagem de um componente facial selecionado não pôde ser decodificada.");
            using var image = decoded.Image!;
            var pixelCount = checked(image.Width * image.Height);
            var alphaPixels = new byte[pixelCount];
            for (var y = 0; y < image.Height; y++)
            for (var x = 0; x < image.Width; x++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                alphaPixels[y * image.Width + x] = image.Bitmap.GetPixel(x, y).Alpha;
            }

            var mask = new FaceAlphaMask(image.Width, image.Height, alphaPixels);
            _componentCrops[assetId] = new Rect2D(0, 0, image.Width, image.Height);
            if (mask.StorageBytes <= MaximumCachedAlphaMaskBytes)
            {
                while (_alphaMaskBytes + mask.StorageBytes > MaximumCachedAlphaMaskBytes
                    && _alphaMaskLru.Last is { } leastRecent)
                {
                    var evictedId = leastRecent.Value;
                    _alphaMaskLru.RemoveLast();
                    _alphaMaskNodes.Remove(evictedId);
                    _alphaMaskBytes -= _alphaMasks[evictedId].StorageBytes;
                    _alphaMasks.Remove(evictedId);
                }

                var node = _alphaMaskLru.AddFirst(assetId);
                _alphaMaskNodes.Add(assetId, node);
                _alphaMasks.Add(assetId, mask);
                _alphaMaskBytes += mask.StorageBytes;
            }
            return mask;
        }
        finally
        {
            _cropGate.Release();
        }
    }

    private async Task<Rect2D> GetComponentCropAsync(AssetId assetId, CancellationToken cancellationToken)
    {
        await _cropGate.WaitAsync(cancellationToken);
        try
        {
            Rect2D cached;
            if (_componentCrops.TryGetValue(assetId, out cached)) return cached;
            var metadata = await _assetStore.GetMetadataAsync(assetId, cancellationToken);
            if (metadata.IsFailure || metadata.Value.VerificationState != AssetVerificationState.Available)
                throw new InvalidOperationException("Um componente facial selecionado referencia uma imagem indisponível.");
            var opened = await _assetStore.OpenReadAsync(assetId, cancellationToken);
            if (opened.IsFailure)
                throw new InvalidOperationException("Não foi possível abrir a imagem de um componente facial selecionado.");

            await using var stream = opened.Value;
            var decoded = await _decoder.DecodeAsync(stream, cancellationToken);
            if (decoded.IsFailure)
                throw new InvalidDataException("A imagem de um componente facial selecionado não pôde ser decodificada.");
            using var image = decoded.Image!;
            cached = new Rect2D(0, 0, image.Width, image.Height);
            if (_componentCrops.Count >= MaximumCachedComponentCrops) _componentCrops.Clear();
            _componentCrops.Add(assetId, cached);
            return cached;
        }
        finally
        {
            _cropGate.Release();
        }
    }
}
