using GV5.Application.Contracts;
using GV5.Assets.Decoding;
using GV5.Assets.Import;
using GV5.Assets.Processing;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using GV5.Modules.Fabricador.Import;
using GV5.Modules.Fabricador.ViewModels;
using SkiaSharp;
using Xunit;

namespace GV5.Headless.Tests;

public sealed class FaceWorkspaceViewModelTests
{
    [Fact]
    public async Task ConfirmImport_PersistsBothSidesAndReimportReplacesRatherThanDuplicatesThem()
    {
        var root = Path.Combine(Path.GetTempPath(), $"gv5-face-vm-{Guid.NewGuid():N}");
        var bytes = CreateSeparatedBrows();
        var assets = new MemoryAssetStore();
        var catalogRepository = new MemoryFaceCatalogRepository();
        var viewModel = new FaceWorkspaceViewModel(new RecordingFilePicker(bytes), CreateImportService(root),
            catalogRepository, assets);
        var model = CreatePublishedModel("Modelo de teste");

        try
        {
            await viewModel.OpenModelRevisionAsync(model);
            await viewModel.LoadCatalogAsync(TestContext.Current.CancellationToken);
            Assert.True(viewModel.CanSelectSheet);
            Assert.False(viewModel.CanConfirmImport);

            await viewModel.SelectEyebrowSheetCommand.ExecuteAsync(null);
            Assert.True(viewModel.HasPreview);
            Assert.True(viewModel.CanConfirmImport);
            await viewModel.ConfirmImportCommand.ExecuteAsync(null);

            var firstSaved = Assert.Single(catalogRepository.Catalogs.Values);
            Assert.Equal(Revision.Initial, firstSaved.Revision);
            Assert.Equal(new[] { FaceComponentSide.Left, FaceComponentSide.Right },
                firstSaved.Components.Select(component => component.Side!.Value).OrderBy(side => side));
            Assert.All(firstSaved.Components, component => Assert.Contains(component.AssetId, assets.Assets.Keys));
            var leftSaved = Assert.Single(firstSaved.Components, component => component.Side == FaceComponentSide.Left);
            var rightSaved = Assert.Single(firstSaved.Components, component => component.Side == FaceComponentSide.Right);
            Assert.Equal(32.8, leftSaved.Transform.Translation.X, 6);
            Assert.Equal(54, leftSaved.Transform.Translation.Y, 6);
            Assert.Equal(47.2, rightSaved.Transform.Translation.X, 6);
            Assert.Equal(54, rightSaved.Transform.Translation.Y, 6);
            Assert.Equal(3.2, leftSaved.Transform.Scale.X, 6);
            Assert.Equal(2, leftSaved.Transform.Scale.Y, 6);
            Assert.False(leftSaved.Transform.FlipX);
            Assert.True(rightSaved.Transform.FlipX);
            Assert.False(viewModel.HasPreview);
            Assert.Contains("2 componentes", viewModel.CatalogStatus, StringComparison.OrdinalIgnoreCase);

            await viewModel.SelectEyebrowSheetCommand.ExecuteAsync(null);
            await viewModel.ConfirmImportCommand.ExecuteAsync(null);

            var replaced = Assert.Single(catalogRepository.Catalogs.Values);
            Assert.Equal(Revision.From(2), replaced.Revision);
            Assert.Equal(2, replaced.Components.Length);
            Assert.Equal(new[] { FaceComponentSide.Left, FaceComponentSide.Right },
                replaced.Components.Select(component => component.Side!.Value).OrderBy(side => side));
            Assert.DoesNotContain(firstSaved.Components.Select(component => component.Id),
                id => replaced.Components.Any(component => component.Id == id));
            Assert.Contains("salvas", viewModel.Status, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            await viewModel.DisposeAsync();
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task OpenDifferentModelRevisionDisposesPreviousUnconfirmedSheet()
    {
        var root = Path.Combine(Path.GetTempPath(), $"gv5-face-vm-{Guid.NewGuid():N}");
        var viewModel = new FaceWorkspaceViewModel(new RecordingFilePicker(CreateSeparatedBrows()), CreateImportService(root),
            new MemoryFaceCatalogRepository(), new MemoryAssetStore());
        var first = CreatePublishedModel("Modelo 1");
        var second = CreatePublishedModel("Modelo 2");
        try
        {
            await viewModel.OpenModelRevisionAsync(first);
            await viewModel.SelectEyebrowSheetCommand.ExecuteAsync(null);
            Assert.True(viewModel.HasPreview);

            await viewModel.OpenModelRevisionAsync(second);

            Assert.False(viewModel.HasPreview);
            Assert.Contains("Modelo 2", viewModel.ModelRevisionLabel);
            Assert.Contains("descart", viewModel.Status, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            await viewModel.DisposeAsync();
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task ConfirmImport_RequiresAndWritesOnlyToTheCatalogSelectedByTheUser()
    {
        var root = Path.Combine(Path.GetTempPath(), $"gv5-face-vm-{Guid.NewGuid():N}");
        var model = CreatePublishedModel("Modelo com vários catálogos");
        var repository = new MemoryFaceCatalogRepository();
        var selected = FaceCatalogDraft.Create(ModelRevisionReference.From(model), "Rosto principal");
        var untouched = FaceCatalogDraft.Create(ModelRevisionReference.From(model), "Rosto alternativo");
        repository.Catalogs.Add(selected.Id, selected);
        repository.Catalogs.Add(untouched.Id, untouched);
        var viewModel = new FaceWorkspaceViewModel(new RecordingFilePicker(CreateSeparatedBrows()),
            CreateImportService(root), repository, new MemoryAssetStore());

        try
        {
            await viewModel.OpenModelRevisionAsync(model);
            await viewModel.LoadCatalogAsync(TestContext.Current.CancellationToken);

            Assert.True(viewModel.HasMultipleCatalogs);
            Assert.Null(viewModel.SelectedCatalog);
            await viewModel.SelectEyebrowSheetCommand.ExecuteAsync(null);
            Assert.False(viewModel.CanConfirmImport);

            viewModel.SelectedCatalog = Assert.Single(viewModel.CatalogChoices,
                choice => choice.Id == selected.Id);
            Assert.True(viewModel.CanConfirmImport);
            await viewModel.ConfirmImportCommand.ExecuteAsync(null);

            Assert.Equal(Revision.From(2), repository.Catalogs[selected.Id].Revision);
            Assert.Equal(2, repository.Catalogs[selected.Id].Components.Length);
            Assert.Equal(Revision.Initial, repository.Catalogs[untouched.Id].Revision);
            Assert.Empty(repository.Catalogs[untouched.Id].Components);
            Assert.Equal(selected.Id, viewModel.SelectedCatalog!.Id);
        }
        finally
        {
            await viewModel.DisposeAsync();
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    private static PublishedModelRevision CreatePublishedModel(string name)
    {
        var modelId = ModelId.New();
        var assetId = AssetId.New();
        var partId = ModelPartId.New();
        var crop = new Rect2D(0, 0, 60, 50);
        var head = new ModelPart(partId, "Cabeça", assetId, crop,
            new Transform2D(new Point2D(10, 20), new Point2D(1, 1), 0, Point2D.Zero),
            new ModelPartSourceTransform(crop, Transform2D.Identity));
        var content = ModelDraftContent.Restore(ModelDraftContent.CurrentSchemaVersion, modelId, Revision.Initial,
            ModelSlot.From(1), AssetId.New(), 100, 100, [head], [partId]);
        return PublishedModelRevision.Restore(ModelRevisionId.New(), modelId, Revision.Initial, Revision.Initial,
            name, 10, new string('b', 64), content);
    }

    private static FaceSheetImportService CreateImportService(string root) => new(
        new AssetImportStager(Path.Combine(root, "staging"), new AssetImportLimits(8 * 1024 * 1024, 8192, 32_000_000)),
        new AssetImageDecoder(new AssetImageDecodeLimits(8192, 32_000_000, 128L * 1024 * 1024)),
        new FaceSheetProcessor());

    private static byte[] CreateSeparatedBrows()
    {
        using var bitmap = new SKBitmap(new SKImageInfo(18, 10, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        bitmap.Erase(new SKColor(0, 255, 0, 255));
        Paint(bitmap, 2, 3, new SKColor(30, 25, 20, 255));
        Paint(bitmap, 12, 3, new SKColor(50, 35, 25, 255));
        using var encoded = bitmap.Encode(SKEncodedImageFormat.Png, 100);
        return encoded!.ToArray();
    }

    private static void Paint(SKBitmap bitmap, int x, int y, SKColor color)
    {
        for (var row = y; row < y + 3; row++)
        for (var column = x; column < x + 3; column++) bitmap.SetPixel(column, row, color);
    }

    private sealed class RecordingFilePicker(byte[] bytes) : IFilePicker
    {
        public Task<PickedFile?> PickImageAsync(CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult<PickedFile?>(new PickedFile("sobrancelhas.png", "image/png",
                new MemoryStream(bytes, writable: false)));
        }
    }

    private sealed class MemoryAssetStore : IAssetStore
    {
        public Dictionary<AssetId, (AssetMetadata Metadata, byte[] Bytes)> Assets { get; } = [];

        public async Task<Result<AssetMetadata>> ImportAsync(Stream content, string mediaType, CancellationToken cancellationToken = default)
        {
            using var buffer = new MemoryStream();
            await content.CopyToAsync(buffer, cancellationToken);
            var bytes = buffer.ToArray();
            var metadata = new AssetMetadata(AssetId.New(), Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)).ToLowerInvariant(),
                mediaType, bytes.LongLength, AssetVerificationState.Available, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            Assets.Add(metadata.Id, (metadata, bytes));
            return Result<AssetMetadata>.Success(metadata);
        }

        public Task<Result<Stream>> OpenReadAsync(AssetId assetId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Assets.TryGetValue(assetId, out var asset)
                ? Result<Stream>.Success(new MemoryStream(asset.Bytes, writable: false))
                : Result<Stream>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Asset inexistente.")));

        public Task<Result<AssetMetadata>> GetMetadataAsync(AssetId assetId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Assets.TryGetValue(assetId, out var asset)
                ? Result<AssetMetadata>.Success(asset.Metadata)
                : Result<AssetMetadata>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Asset inexistente.")));

        public Task<Result<Unit>> AddReferenceAsync(AssetId assetId, AssetReferenceKey reference, CancellationToken cancellationToken = default) =>
            Task.FromResult(Assets.ContainsKey(assetId) ? Result<Unit>.Success(Unit.Value)
                : Result<Unit>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Asset inexistente.")));

        public Task<Result<Unit>> ReleaseReferenceAsync(AssetReferenceKey reference, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<Unit>.Success(Unit.Value));
    }

    private sealed class MemoryFaceCatalogRepository : IFaceCatalogRepository
    {
        public Dictionary<FaceId, FaceCatalogDraft> Catalogs { get; } = [];

        public Task<Result<FaceCatalogDraft>> CreateAsync(FaceCatalogDraft draft, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(draft.Revision == Revision.Initial && Catalogs.TryAdd(draft.Id, draft)
                ? Result<FaceCatalogDraft>.Success(draft)
                : Result<FaceCatalogDraft>.Failure(new ApplicationError(ApplicationErrorCode.Conflict, "Catálogo duplicado.")));
        }

        public Task<Result<FaceCatalogDraft>> GetAsync(FaceId faceId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Catalogs.TryGetValue(faceId, out var draft) ? Result<FaceCatalogDraft>.Success(draft)
                : Result<FaceCatalogDraft>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Catálogo inexistente.")));

        public Task<Result<IReadOnlyList<FaceCatalogDraft>>> ListAsync(ModelRevisionId modelRevisionId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<IReadOnlyList<FaceCatalogDraft>>.Success(Catalogs.Values
                .Where(draft => draft.Model.RevisionId == modelRevisionId).ToArray()));

        public Task<Result<FaceCatalogDraft>> SaveAsync(FaceCatalogDraft draft, Revision expectedRevision, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!Catalogs.TryGetValue(draft.Id, out var current) || current.Revision != expectedRevision)
                return Task.FromResult(Result<FaceCatalogDraft>.Failure(new ApplicationError(ApplicationErrorCode.Conflict, "Conflito.")));
            Catalogs[draft.Id] = draft;
            return Task.FromResult(Result<FaceCatalogDraft>.Success(draft));
        }

        public Task<Result<PublishedFaceCatalogRevision>> PublishAsync(FaceId faceId, Revision expectedDraftRevision, long publishedUtcMs, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<PublishedFaceCatalogRevision>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Não usado no teste.")));

        public Task<Result<PublishedFaceCatalogRevision>> GetPublishedAsync(FaceId faceId, Revision revision, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<PublishedFaceCatalogRevision>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Não usado no teste.")));

        public Task<Result<IReadOnlyList<PublishedFaceCatalogRevision>>> ListPublishedAsync(FaceId faceId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<IReadOnlyList<PublishedFaceCatalogRevision>>.Success([]));
    }
}
