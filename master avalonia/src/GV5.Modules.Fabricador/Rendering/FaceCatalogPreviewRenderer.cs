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
    private readonly IAssetStore _assetStore = assetStore ?? throw new ArgumentNullException(nameof(assetStore));
    private readonly AssetImageDecoder _decoder = decoder ?? throw new ArgumentNullException(nameof(decoder));
    private readonly IRenderSceneRenderer _renderer = renderer ?? throw new ArgumentNullException(nameof(renderer));
    private readonly Dictionary<AssetId, Rect2D> _componentCrops = [];
    private readonly SemaphoreSlim _cropGate = new(1, 1);

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
        foreach (var assetId in selections.Select(selection => selection.Component.AssetId).Distinct())
        {
            cancellationToken.ThrowIfCancellationRequested();
            crops.Add(assetId, await GetComponentCropAsync(assetId, cancellationToken).ConfigureAwait(false));
        }
        return FaceCatalogPreviewSceneBuilder.HitTest(model, catalog, crops, previewPoint, maximumDimension);
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
