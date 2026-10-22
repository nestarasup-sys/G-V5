using GV5.Application.Contracts;
using System.Globalization;
using GV5.Assets.Decoding;
using GV5.Assets.Import;
using GV5.Assets.Processing;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using GV5.Modules.Fabricador.Import;
using GV5.Modules.Fabricador.Rendering;
using GV5.Modules.Fabricador.ViewModels;
using GV5.Rendering;
using SkiaSharp;
using Xunit;

namespace GV5.Headless.Tests;

public sealed class FaceWorkspaceViewModelTests
{
    [Fact]
    public async Task ComposedPreviewScene_UsesDecodedComponentBoundsAndOnlyDefaultVisibleSelections()
    {
        var assets = new MemoryAssetStore();
        await using var stream = new MemoryStream(CreateSeparatedBrows(), writable: false);
        var imported = await assets.ImportAsync(stream, "image/png", TestContext.Current.CancellationToken);
        Assert.True(imported.IsSuccess);

        var model = CreatePublishedModel("Modelo da prévia composta");
        var transform = new Transform2D(new Point2D(24, 30), new Point2D(1, 1), 0, new Point2D(9, 5));
        var catalog = FaceCatalogDraft.Create(ModelRevisionReference.From(model), "Rosto")
            .WithComponent(FaceComponent.Create(FaceComponentKind.Eyebrow, "Sobrancelha esquerda",
                imported.Value.Id, FaceComponentSide.Left, transform))
            .WithComponent(FaceComponent.Create(FaceComponentKind.Eyebrow, "Sobrancelha direita",
                imported.Value.Id, FaceComponentSide.Right, transform));
        var previewRenderer = new FaceCatalogPreviewRenderer(assets, new AssetImageDecoder(), new UnusedSceneRenderer());

        var scene = await previewRenderer.BuildSceneAsync(model, catalog, maximumDimension: 50,
            TestContext.Current.CancellationToken);

        Assert.Equal(50, scene.Width);
        Assert.Equal(50, scene.Height);
        Assert.Equal(3, scene.Layers.Length);
        var faceLayers = scene.Layers.Where(layer => layer.AssetId == imported.Value.Id).ToArray();
        Assert.Equal(2, faceLayers.Length);
        Assert.All(faceLayers, layer => Assert.Equal(new Rect2D(0, 0, 18, 10), layer.Crop));
    }

    [Fact]
    public async Task ComposedPreviewScene_RejectsAnUnavailableSelectedFaceAsset()
    {
        var model = CreatePublishedModel("Modelo com asset facial ausente");
        var missingAsset = AssetId.New();
        var transform = new Transform2D(new Point2D(24, 30), new Point2D(1, 1), 0, new Point2D(9, 5));
        var catalog = FaceCatalogDraft.Create(ModelRevisionReference.From(model), "Rosto")
            .WithComponent(FaceComponent.Create(FaceComponentKind.Eyebrow, "Sobrancelha esquerda",
                missingAsset, FaceComponentSide.Left, transform));
        var previewRenderer = new FaceCatalogPreviewRenderer(new MemoryAssetStore(), new AssetImageDecoder(),
            new UnusedSceneRenderer());

        await Assert.ThrowsAsync<InvalidOperationException>(() => previewRenderer.BuildSceneAsync(model, catalog,
            cancellationToken: TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task ComponentTransform_RequiresValidValuesAndPersistsAsOneCatalogRevision()
    {
        var previousCulture = CultureInfo.CurrentCulture;
        CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("pt-BR");
        var root = Path.Combine(Path.GetTempPath(), $"gv5-face-transform-{Guid.NewGuid():N}");
        var repository = new MemoryFaceCatalogRepository();
        var viewModel = new FaceWorkspaceViewModel(new RecordingFilePicker(CreateSeparatedBrows()), CreateImportService(root),
            repository, new MemoryAssetStore());
        try
        {
            await viewModel.OpenModelRevisionAsync(CreatePublishedModel("Modelo de transform"));
            await viewModel.LoadCatalogAsync(TestContext.Current.CancellationToken);
            await viewModel.SelectFaceSheetCommand.ExecuteAsync(null);
            await viewModel.ConfirmImportCommand.ExecuteAsync(null);

            Assert.Equal(2, viewModel.ComponentChoices.Count);
            Assert.NotNull(viewModel.SelectedComponent);
            Assert.True(viewModel.CanApplyComponentTransform);
            var selectedId = viewModel.SelectedComponent!.Id;
            viewModel.ComponentX = "41,5";
            viewModel.ComponentY = "63";
            viewModel.ComponentScaleX = "2,25";
            viewModel.ComponentScaleY = "1,75";
            viewModel.ComponentRotation = "30";
            await viewModel.ApplyComponentTransformCommand.ExecuteAsync(null);

            var catalog = Assert.Single(repository.Catalogs.Values);
            Assert.Equal(Revision.From(2), catalog.Revision);
            var updated = Assert.Single(catalog.Components, component => component.Id == selectedId);
            Assert.Equal(41.5, updated.Transform.Translation.X, 6);
            Assert.Equal(63, updated.Transform.Translation.Y, 6);
            Assert.Equal(2.25, updated.Transform.Scale.X, 6);
            Assert.Equal(1.75, updated.Transform.Scale.Y, 6);
            Assert.Equal(Math.PI / 6, updated.Transform.RotationRadians, 6);
            Assert.Equal(catalog.Revision, viewModel.SelectedCatalog!.Revision);

            viewModel.ComponentScaleX = "21";
            Assert.False(viewModel.CanApplyComponentTransform);
            Assert.False(viewModel.ApplyComponentTransformCommand.CanExecute(null));
            Assert.Equal(Revision.From(2), repository.Catalogs[catalog.Id].Revision);
        }
        finally
        {
            CultureInfo.CurrentCulture = previousCulture;
            await viewModel.DisposeAsync();
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task ComponentTransform_ConflictReloadsLatestCatalogAndPreservesPendingValuesForRetry()
    {
        var root = Path.Combine(Path.GetTempPath(), $"gv5-face-transform-conflict-{Guid.NewGuid():N}");
        var repository = new MemoryFaceCatalogRepository();
        var viewModel = new FaceWorkspaceViewModel(new RecordingFilePicker(CreateSeparatedBrows()), CreateImportService(root),
            repository, new MemoryAssetStore());
        try
        {
            await viewModel.OpenModelRevisionAsync(CreatePublishedModel("Modelo facial concorrente"));
            await viewModel.LoadCatalogAsync(TestContext.Current.CancellationToken);
            await viewModel.SelectFaceSheetCommand.ExecuteAsync(null);
            await viewModel.ConfirmImportCommand.ExecuteAsync(null);

            var initial = Assert.Single(repository.Catalogs.Values);
            var selectedId = viewModel.SelectedComponent!.Id;
            var otherId = Assert.Single(initial.Components, item => item.Id != selectedId).Id;
            var concurrent = initial.WithTransform(otherId,
                new Transform2D(new Point2D(9, 12), new Point2D(1.2, 1.1), .25, Point2D.Zero));
            Assert.True((await repository.SaveAsync(concurrent, initial.Revision, TestContext.Current.CancellationToken)).IsSuccess);

            viewModel.ComponentX = "41,5";
            viewModel.ComponentY = "63";
            viewModel.ComponentScaleX = "2,25";
            viewModel.ComponentScaleY = "1,75";
            viewModel.ComponentRotation = "30";
            await viewModel.ApplyComponentTransformCommand.ExecuteAsync(null);

            Assert.Equal(Revision.From(2), viewModel.SelectedCatalog!.Revision);
            Assert.Equal(selectedId, viewModel.SelectedComponent!.Id);
            Assert.Equal("41,5", viewModel.ComponentX);
            Assert.Contains("mudou em outra operação", viewModel.Error, StringComparison.OrdinalIgnoreCase);
            Assert.True(viewModel.CanApplyComponentTransform);

            await viewModel.ApplyComponentTransformCommand.ExecuteAsync(null);
            var saved = repository.Catalogs[initial.Id];
            Assert.Equal(Revision.From(3), saved.Revision);
            Assert.Equal(new Point2D(9, 12), Assert.Single(saved.Components, item => item.Id == otherId).Transform.Translation);
            Assert.Equal(41.5, Assert.Single(saved.Components, item => item.Id == selectedId).Transform.Translation.X, 6);
        }
        finally
        {
            await viewModel.DisposeAsync();
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

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

            await viewModel.SelectFaceSheetCommand.ExecuteAsync(null);
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

            await viewModel.SelectFaceSheetCommand.ExecuteAsync(null);
            await viewModel.ConfirmImportCommand.ExecuteAsync(null);

            var replaced = Assert.Single(catalogRepository.Catalogs.Values);
            Assert.Equal(Revision.From(2), replaced.Revision);
            Assert.Equal(2, replaced.Components.Length);
            Assert.Equal(new[] { FaceComponentSide.Left, FaceComponentSide.Right },
                replaced.Components.Select(component => component.Side!.Value).OrderBy(side => side));
            Assert.DoesNotContain(firstSaved.Components.Select(component => component.Id),
                id => replaced.Components.Any(component => component.Id == id));
            Assert.Contains("foram salvos", viewModel.Status, StringComparison.OrdinalIgnoreCase);

            Assert.True(viewModel.CanPublishCatalog);
            await viewModel.PublishCatalogCommand.ExecuteAsync(null);
            var publication = Assert.Single(catalogRepository.Publications[replaced.Id]);
            Assert.Equal(replaced.Revision, publication.DraftRevision);
            Assert.Equal(Revision.Initial, publication.Revision);
            Assert.False(viewModel.CanPublishCatalog);
            Assert.Contains("publicado", viewModel.PublicationStatus, StringComparison.OrdinalIgnoreCase);

            await viewModel.SelectFaceSheetCommand.ExecuteAsync(null);
            await viewModel.ConfirmImportCommand.ExecuteAsync(null);
            Assert.True(viewModel.CanPublishCatalog);
            Assert.Contains("mudanças", viewModel.PublicationStatus, StringComparison.OrdinalIgnoreCase);
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
            await viewModel.SelectFaceSheetCommand.ExecuteAsync(null);
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
            await viewModel.SelectFaceSheetCommand.ExecuteAsync(null);
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

    [Fact]
    public async Task ConfirmImport_PersistsEyeRowsAndKeepsOpenAndClosedMouthSheetsSeparate()
    {
        var root = Path.Combine(Path.GetTempPath(), $"gv5-face-kinds-{Guid.NewGuid():N}");
        var repository = new MemoryFaceCatalogRepository();
        var viewModel = new FaceWorkspaceViewModel(new SequenceFilePicker(CreateEyesSheet(), CreateMouthSheet(),
                CreateNoseSixSheet(), CreateNoseSixSheet(), CreateMouthSheet()),
            CreateImportService(root), repository, new MemoryAssetStore());

        try
        {
            await viewModel.OpenModelRevisionAsync(CreatePublishedModel("Modelo facial completo"));
            await viewModel.LoadCatalogAsync(TestContext.Current.CancellationToken);

            viewModel.SelectedSheetKind = viewModel.SheetKinds.Single(choice => choice.Kind == FaceSheetKind.Eyes);
            await viewModel.SelectFaceSheetCommand.ExecuteAsync(null);
            Assert.Equal(6, viewModel.Preview!.Pieces.Count);
            Assert.False(viewModel.CanChangeSheetKind);
            await viewModel.ConfirmImportCommand.ExecuteAsync(null);
            Assert.True(viewModel.CanChangeSheetKind);
            var catalog = Assert.Single(repository.Catalogs.Values);
            Assert.Equal(2, catalog.Components.Count(component => component.Kind == FaceComponentKind.Eye));
            Assert.Equal(2, catalog.Components.Count(component => component.Kind == FaceComponentKind.Pupil));
            Assert.Equal(2, catalog.Components.Count(component => component.Kind == FaceComponentKind.ClosedEye));

            viewModel.SelectedSheetKind = viewModel.SheetKinds.Single(choice => choice.Kind == FaceSheetKind.MouthOpen);
            await viewModel.SelectFaceSheetCommand.ExecuteAsync(null);
            Assert.Equal(21, viewModel.Preview!.Pieces.Count);
            await viewModel.ConfirmImportCommand.ExecuteAsync(null);
            catalog = repository.Catalogs[catalog.Id];
            Assert.Equal(21, catalog.Components.Count(component => component.Kind == FaceComponentKind.Mouth
                && component.MouthVariant == FaceMouthVariant.Open));

            viewModel.SelectedSheetKind = viewModel.SheetKinds.Single(choice => choice.Kind == FaceSheetKind.Nose);
            Assert.True(viewModel.IsNoseSheetSelected);
            Assert.True(viewModel.CanChangeNoseMode);
            Assert.Equal(FaceNoseSheetMode.One, viewModel.SelectedNoseSheetMode.Mode);
            await viewModel.SelectFaceSheetCommand.ExecuteAsync(null);
            Assert.Single(viewModel.Preview!.Pieces);
            Assert.False(viewModel.CanChangeNoseMode);
            await viewModel.ConfirmImportCommand.ExecuteAsync(null);
            Assert.True(viewModel.CanChangeNoseMode);
            catalog = repository.Catalogs[catalog.Id];
            Assert.Single(catalog.Components, component => component.Kind == FaceComponentKind.Nose);
            Assert.Equal(Revision.From(3), catalog.Revision);

            viewModel.SelectedNoseSheetMode = viewModel.NoseSheetModes.Single(choice => choice.Mode == FaceNoseSheetMode.Six);
            await viewModel.SelectFaceSheetCommand.ExecuteAsync(null);
            Assert.Equal(6, viewModel.Preview!.Pieces.Count);
            await viewModel.ConfirmImportCommand.ExecuteAsync(null);
            catalog = repository.Catalogs[catalog.Id];
            Assert.Equal(6, catalog.Components.Count(component => component.Kind == FaceComponentKind.Nose));
            Assert.Equal(Revision.From(4), catalog.Revision);

            viewModel.SelectedSheetKind = viewModel.SheetKinds.Single(choice => choice.Kind == FaceSheetKind.MouthClosed);
            await viewModel.SelectFaceSheetCommand.ExecuteAsync(null);
            Assert.Equal(21, viewModel.Preview!.Pieces.Count);
            await viewModel.ConfirmImportCommand.ExecuteAsync(null);
            catalog = repository.Catalogs[catalog.Id];
            Assert.Equal(21, catalog.Components.Count(component => component.Kind == FaceComponentKind.Mouth
                && component.MouthVariant == FaceMouthVariant.Closed));
            Assert.Equal(21, catalog.Components.Count(component => component.Kind == FaceComponentKind.Mouth
                && component.MouthVariant == FaceMouthVariant.Open));
            Assert.Equal(Revision.From(5), catalog.Revision);
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

    private static byte[] CreateEyesSheet()
    {
        using var bitmap = new SKBitmap(new SKImageInfo(18, 30, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        bitmap.Erase(new SKColor(0, 255, 0, 255));
        for (var row = 0; row < 3; row++)
        {
            Paint(bitmap, 2, row * 10 + 3, new SKColor((byte)(30 + row * 40), 25, 20, 255));
            Paint(bitmap, 12, row * 10 + 3, new SKColor((byte)(50 + row * 40), 35, 25, 255));
        }
        using var encoded = bitmap.Encode(SKEncodedImageFormat.Png, 100);
        return encoded!.ToArray();
    }

    private static byte[] CreateMouthSheet()
    {
        using var bitmap = new SKBitmap(new SKImageInfo(70, 30, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        bitmap.Erase(new SKColor(0, 255, 0, 255));
        for (var index = 0; index < 21; index++)
            Paint(bitmap, (index % 7) * 10 + 3, (index / 7) * 10 + 3,
                new SKColor((byte)(40 + index * 7), 20, 80, 255));
        using var encoded = bitmap.Encode(SKEncodedImageFormat.Png, 100);
        return encoded!.ToArray();
    }

    private static byte[] CreateNoseSixSheet()
    {
        using var bitmap = new SKBitmap(new SKImageInfo(22, 14, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        bitmap.Erase(new SKColor(0, 255, 0, 255));
        for (var index = 0; index < 6; index++)
            Paint(bitmap, (index % 3) * 7 + 1, (index / 3) * 7 + 1,
                new SKColor((byte)(40 + index * 20), 50, 45, 255));
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

    private sealed class SequenceFilePicker(params byte[][] sheets) : IFilePicker
    {
        private readonly Queue<byte[]> _sheets = new(sheets);

        public Task<PickedFile?> PickImageAsync(CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!_sheets.TryDequeue(out var bytes)) throw new InvalidOperationException("A fixture facial acabou.");
            return Task.FromResult<PickedFile?>(new PickedFile("folha-facial.png", "image/png",
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

    private sealed class UnusedSceneRenderer : IRenderSceneRenderer
    {
        public Task<RenderedFrame> RenderAsync(RenderScene scene, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("The scene-only preview test must not rasterize pixels.");
    }

    private sealed class MemoryFaceCatalogRepository : IFaceCatalogRepository
    {
        public Dictionary<FaceId, FaceCatalogDraft> Catalogs { get; } = [];
        public Dictionary<FaceId, List<PublishedFaceCatalogRevision>> Publications { get; } = [];

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

        public Task<Result<PublishedFaceCatalogRevision>> PublishAsync(FaceId faceId, Revision expectedDraftRevision, long publishedUtcMs, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!Catalogs.TryGetValue(faceId, out var draft))
                return Task.FromResult(Result<PublishedFaceCatalogRevision>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Catálogo inexistente.")));
            if (draft.Revision != expectedDraftRevision)
                return Task.FromResult(Result<PublishedFaceCatalogRevision>.Failure(new ApplicationError(ApplicationErrorCode.Conflict, "Conflito.")));
            var publications = Publications.GetValueOrDefault(faceId) ?? [];
            var publication = PublishedFaceCatalogRevision.Restore(FaceRevisionId.New(), faceId,
                Revision.From(publications.Count + 1), draft.Revision, publishedUtcMs, new string('c', 64), draft);
            publications.Add(publication);
            Publications[faceId] = publications;
            return Task.FromResult(Result<PublishedFaceCatalogRevision>.Success(publication));
        }

        public Task<Result<PublishedFaceCatalogRevision>> GetPublishedAsync(FaceId faceId, Revision revision, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var publication = Publications.GetValueOrDefault(faceId)?.SingleOrDefault(item => item.Revision == revision);
            return Task.FromResult(publication is null
                ? Result<PublishedFaceCatalogRevision>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Publicação inexistente."))
                : Result<PublishedFaceCatalogRevision>.Success(publication));
        }

        public Task<Result<IReadOnlyList<PublishedFaceCatalogRevision>>> ListPublishedAsync(FaceId faceId, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            IReadOnlyList<PublishedFaceCatalogRevision> publications = Publications.GetValueOrDefault(faceId) ?? [];
            return Task.FromResult(Result<IReadOnlyList<PublishedFaceCatalogRevision>>.Success(publications));
        }
    }
}
