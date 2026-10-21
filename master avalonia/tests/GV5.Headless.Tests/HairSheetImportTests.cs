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

public sealed class HairSheetImportTests
{
    [Fact]
    public async Task HairWorkspaceBindsStagedPartsToReversibleLayersAndClearsThemBeforeStageDeletion()
    {
        var root = Path.Combine(Path.GetTempPath(), $"gv5-hair-workspace-{Guid.NewGuid():N}");
        var bytes = CreatePng(bitmap =>
        {
            bitmap.Erase(new SKColor(0, 255, 0, 255));
            for (var y = 1; y <= 3; y++)
            for (var x = 3; x <= 6; x++) bitmap.SetPixel(x, y, new SKColor(20, 40, 160, 255));
            for (var y = 7; y <= 9; y++)
            for (var x = 4; x <= 7; x++) bitmap.SetPixel(x, y, new SKColor(160, 40, 20, 255));
        }, 12, 12);
        var modelId = ModelId.New();
        var content = ModelDraftContent.CreateEmpty(modelId, Revision.Initial);
        var model = PublishedModelRevision.Restore(ModelRevisionId.New(), modelId, Revision.Initial,
            Revision.Initial, "Modelo", 1, new string('c', 64), content);
        var workspace = new HairWorkspaceViewModel(new RecordingFilePicker(bytes), CreateService(root), new HairRoleTintProcessor());

        try
        {
            workspace.OpenModelRevision(model);
            await workspace.SelectSheetCommand.ExecuteAsync(null);
            Assert.True(workspace.CanAddPosteriorLayer);
            Assert.True(workspace.CanAddTraseiroLayer);

            workspace.AddPosteriorLayerCommand.Execute(null);
            workspace.AddTraseiroLayerCommand.Execute(null);
            Assert.Equal(new[] { HairPartId.RearHair, HairPartId.BackHair }, workspace.Layers.Select(layer => layer.Part));
            workspace.SelectLayerCommand.Execute(workspace.Layers[0]);
            workspace.LayerX = 13.5.ToString(System.Globalization.CultureInfo.CurrentCulture);
            workspace.LayerScaleX = "1,25";
            workspace.LayerRotation = "30";
            workspace.LayerFlipX = true;
            workspace.ApplyLayerTransformCommand.Execute(null);
            Assert.Equal(13.5, workspace.Layers[0].Transform.Translation.X);
            Assert.Equal(1.25, workspace.Layers[0].Transform.Scale.X);
            Assert.Equal(30, workspace.Layers[0].Transform.RotationRadians * 180 / Math.PI, 6);
            Assert.True(workspace.Layers[0].Transform.FlipX);
            workspace.UndoLayerCommand.Execute(null);
            Assert.Equal(0, workspace.Layers[0].Transform.Translation.X);
            workspace.RedoLayerCommand.Execute(null);
            Assert.Equal(13.5, workspace.Layers[0].Transform.Translation.X);
            Assert.True(workspace.CanUndoLayer);
            workspace.UndoLayerCommand.Execute(null);
            workspace.UndoLayerCommand.Execute(null);
            Assert.Single(workspace.Layers);
            workspace.RedoLayerCommand.Execute(null);
            workspace.RedoLayerCommand.Execute(null);
            Assert.Equal(2, workspace.Layers.Count);

            await workspace.CancelCommand.ExecuteAsync(null);
            Assert.Empty(workspace.Layers);
            Assert.False(workspace.HasPreview);
            if (workspace.CanUndoLayer)
            {
                workspace.UndoLayerCommand.Execute(null);
                Assert.Empty(workspace.Layers);
            }
        }
        finally
        {
            await workspace.DisposeAsync();
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task HairWorkspacePersistsPermanentPngAssetsPublishesAndReopensSavedDraft()
    {
        var root = Path.Combine(Path.GetTempPath(), $"gv5-hair-persist-{Guid.NewGuid():N}");
        var bytes = CreatePng(bitmap =>
        {
            bitmap.Erase(new SKColor(0, 255, 0, 255));
            for (var y = 1; y <= 3; y++)
            for (var x = 3; x <= 6; x++) bitmap.SetPixel(x, y, new SKColor(20, 40, 160, 255));
            for (var y = 7; y <= 9; y++)
            for (var x = 4; x <= 7; x++) bitmap.SetPixel(x, y, new SKColor(160, 40, 20, 255));
        }, 12, 12);
        var modelId = ModelId.New();
        var content = ModelDraftContent.CreateEmpty(modelId, Revision.Initial);
        var model = PublishedModelRevision.Restore(ModelRevisionId.New(), modelId, Revision.Initial,
            Revision.Initial, "Modelo", 1, new string('c', 64), content);
        var assets = new MemoryHairAssetStore();
        var repository = new MemoryHairStyleRepository();
        var workspace = new HairWorkspaceViewModel(new RecordingFilePicker(bytes), CreateService(root),
            new HairRoleTintProcessor(), repository, assets);

        try
        {
            workspace.OpenModelRevision(model);
            await workspace.SelectSheetCommand.ExecuteAsync(null);
            var stagedPosterior = workspace.Preview!.StagedPosteriorAssetId;
            var stagedBack = workspace.Preview.StagedTraseiroAssetId;
            workspace.AddPosteriorLayerCommand.Execute(null);
            workspace.AddTraseiroLayerCommand.Execute(null);
            workspace.DraftName = "Cabelo de teste";

            await workspace.SaveDraftCommand.ExecuteAsync(null);
            Assert.False(workspace.IsDraftDirty);
            var saved = Assert.Single(repository.Drafts.Values);
            Assert.Equal("Cabelo de teste", saved.Name);
            Assert.Equal(2, saved.Layers.Length);
            Assert.DoesNotContain(saved.Layers, layer => layer.AssetId == stagedPosterior || layer.AssetId == stagedBack);
            Assert.All(saved.Layers, layer => Assert.Contains(layer.AssetId, assets.Assets.Keys));

            await workspace.PublishDraftCommand.ExecuteAsync(null);
            Assert.Single(repository.Publications);
            Assert.Equal(2, repository.Publications[0].Snapshot.Layers.Length);
            Assert.False(workspace.IsDraftDirty);

            await using var reopened = new HairWorkspaceViewModel(null, null, null, repository, assets);
            reopened.OpenModelRevision(model);
            await reopened.LoadSavedDraftsAsync(TestContext.Current.CancellationToken);
            Assert.Single(reopened.SavedDrafts);
            Assert.Equal(2, reopened.Layers.Count);
            Assert.Equal("Cabelo de teste", reopened.DraftName);
            Assert.False(reopened.IsDraftDirty);
        }
        finally
        {
            await workspace.DisposeAsync();
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task PrepareKeepsExactOriginalAndStagesTwoTransparentOutputsUntilDisposed()
    {
        var root = Path.Combine(Path.GetTempPath(), $"gv5-hair-import-{Guid.NewGuid():N}");
        var bytes = CreatePng(bitmap =>
        {
            bitmap.Erase(new SKColor(0, 255, 0, 255));
            for (var y = 1; y <= 3; y++)
            for (var x = 3; x <= 6; x++) bitmap.SetPixel(x, y, new SKColor(20, 40, 160, 255));
            for (var y = 7; y <= 9; y++)
            for (var x = 4; x <= 7; x++) bitmap.SetPixel(x, y, new SKColor(160, 40, 20, 255));
        }, 12, 12);

        try
        {
            var result = await CreateService(root).PrepareAsync(new MemoryStream(bytes), "image/png",
                cancellationToken: TestContext.Current.CancellationToken);
            Assert.True(result.IsSuccess, result.Error?.Message);
            var preview = result.Value;
            Assert.Equal(bytes.LongLength, preview.OriginalByteLength);
            Assert.Equal(12, preview.SourceWidth);
            Assert.Equal(12, preview.SourceHeight);
            Assert.Equal(new ImageCropBounds(3, 1, 4, 3), preview.PosteriorSourceBounds);
            Assert.Equal(new ImageCropBounds(4, 7, 4, 3), preview.TraseiroSourceBounds);
            Assert.Equal((byte)255, preview.PosteriorPreview.Bitmap.GetPixel(0, 0).Alpha);
            Assert.True(preview.RemovedPixelCount > 0);
            Assert.Equal(3, Directory.GetFiles(Path.Combine(root, "staging"), "*.stage").Length);

            await using (var original = await preview.OpenOriginalReadAsync(TestContext.Current.CancellationToken))
            using (var copy = new MemoryStream())
            {
                await original.CopyToAsync(copy, TestContext.Current.CancellationToken);
                Assert.Equal(bytes, copy.ToArray());
            }

            await using (var posteriorStream = await preview.OpenPosteriorPngReadAsync(TestContext.Current.CancellationToken))
            {
                var decoded = await new AssetImageDecoder().DecodeAsync(posteriorStream, TestContext.Current.CancellationToken);
                Assert.True(decoded.IsSuccess, decoded.Error?.Message);
                using var image = decoded.Image!;
                Assert.Equal(4, image.Width);
                Assert.Equal(3, image.Height);
                Assert.Equal(new SKColor(20, 40, 160, 255), image.Bitmap.GetPixel(0, 0));
            }

            await preview.DisposeAsync();
            Assert.Empty(Directory.GetFiles(Path.Combine(root, "staging"), "*.stage"));
            Assert.Throws<ObjectDisposedException>(() => _ = preview.PosteriorPreview);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task PrepareRejectsMissingHalfAndCancellationCleansAllStagingFiles()
    {
        var root = Path.Combine(Path.GetTempPath(), $"gv5-hair-import-{Guid.NewGuid():N}");
        try
        {
            var onlyPosterior = CreatePng(bitmap =>
            {
                bitmap.Erase(new SKColor(0, 255, 0, 255));
                for (var y = 1; y <= 3; y++)
                for (var x = 3; x <= 6; x++) bitmap.SetPixel(x, y, new SKColor(20, 40, 160, 255));
            }, 12, 12);
            var service = CreateService(root);
            var rejected = await service.PrepareAsync(new MemoryStream(onlyPosterior), "image/png",
                cancellationToken: TestContext.Current.CancellationToken);
            Assert.True(rejected.IsFailure);
            Assert.Equal(ApplicationErrorCode.Validation, rejected.Error!.Code);
            Assert.Empty(Directory.GetFiles(Path.Combine(root, "staging"), "*.stage"));

            using var cancellation = new CancellationTokenSource();
            cancellation.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
                service.PrepareAsync(new MemoryStream(onlyPosterior), "image/png", cancellationToken: cancellation.Token));
            Assert.Empty(Directory.GetFiles(Path.Combine(root, "staging"), "*.stage"));
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    private static HairSheetImportService CreateService(string root) => new(
        new AssetImportStager(Path.Combine(root, "staging"), new AssetImportLimits(8 * 1024 * 1024, 8192, 32_000_000)),
        new AssetImageDecoder(new AssetImageDecodeLimits(8192, 32_000_000, 128L * 1024 * 1024)),
        new HairSheetProcessor());

    private sealed class RecordingFilePicker(byte[] bytes) : IFilePicker
    {
        public Task<PickedFile?> PickImageAsync(CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult<PickedFile?>(new PickedFile("folha.png", "image/png", new MemoryStream(bytes, writable: false)));
        }
    }

    private sealed class MemoryHairAssetStore : IAssetStore
    {
        public Dictionary<AssetId, (AssetMetadata Metadata, byte[] Bytes)> Assets { get; } = [];

        public async Task<Result<AssetMetadata>> ImportAsync(Stream content, string mediaType, CancellationToken cancellationToken = default)
        {
            using var buffer = new MemoryStream();
            await content.CopyToAsync(buffer, cancellationToken);
            var bytes = buffer.ToArray();
            var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)).ToLowerInvariant();
            var id = AssetId.New();
            var metadata = new AssetMetadata(id, hash, mediaType, bytes.LongLength, AssetVerificationState.Available,
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            Assets.Add(id, (metadata, bytes));
            return Result<AssetMetadata>.Success(metadata);
        }

        public Task<Result<Stream>> OpenReadAsync(AssetId assetId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Assets.TryGetValue(assetId, out var item)
                ? Result<Stream>.Success(new MemoryStream(item.Bytes, writable: false))
                : Result<Stream>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Asset não encontrado.")));

        public Task<Result<AssetMetadata>> GetMetadataAsync(AssetId assetId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Assets.TryGetValue(assetId, out var item)
                ? Result<AssetMetadata>.Success(item.Metadata)
                : Result<AssetMetadata>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Asset não encontrado.")));

        public Task<Result<Unit>> AddReferenceAsync(AssetId assetId, AssetReferenceKey reference,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(Assets.ContainsKey(assetId)
                ? Result<Unit>.Success(Unit.Value)
                : Result<Unit>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Asset não encontrado.")));

        public Task<Result<Unit>> ReleaseReferenceAsync(AssetReferenceKey reference, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<Unit>.Success(Unit.Value));
    }

    private sealed class MemoryHairStyleRepository : IHairStyleRepository
    {
        public Dictionary<HairId, HairStyleDraft> Drafts { get; } = [];
        public List<PublishedHairStyleRevision> Publications { get; } = [];

        public Task<Result<HairStyleDraft>> CreateAsync(HairStyleDraft draft, CancellationToken cancellationToken = default)
        {
            if (draft.Revision != Revision.Initial || !Drafts.TryAdd(draft.Id, draft))
                return Task.FromResult(Result<HairStyleDraft>.Failure(new ApplicationError(ApplicationErrorCode.Conflict, "Conflito ao criar cabelo.")));
            return Task.FromResult(Result<HairStyleDraft>.Success(draft));
        }

        public Task<Result<HairStyleDraft>> GetAsync(HairId hairId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Drafts.TryGetValue(hairId, out var draft)
                ? Result<HairStyleDraft>.Success(draft)
                : Result<HairStyleDraft>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Rascunho não encontrado.")));

        public Task<Result<IReadOnlyList<HairStyleDraft>>> ListAsync(ModelRevisionId modelRevisionId,
            CancellationToken cancellationToken = default) => Task.FromResult(Result<IReadOnlyList<HairStyleDraft>>.Success(
                Drafts.Values.Where(draft => draft.Model.RevisionId == modelRevisionId).ToArray()));

        public Task<Result<HairStyleDraft>> SaveAsync(HairStyleDraft draft, Revision expectedRevision,
            CancellationToken cancellationToken = default)
        {
            if (!Drafts.TryGetValue(draft.Id, out var current) || current.Revision != expectedRevision
                || draft.Revision.Value <= expectedRevision.Value)
                return Task.FromResult(Result<HairStyleDraft>.Failure(new ApplicationError(ApplicationErrorCode.Conflict, "Conflito ao salvar cabelo.")));
            Drafts[draft.Id] = draft;
            return Task.FromResult(Result<HairStyleDraft>.Success(draft));
        }

        public Task<Result<PublishedHairStyleRevision>> PublishAsync(HairId hairId, Revision expectedDraftRevision,
            long publishedUtcMs, CancellationToken cancellationToken = default)
        {
            if (!Drafts.TryGetValue(hairId, out var draft) || draft.Revision != expectedDraftRevision)
                return Task.FromResult(Result<PublishedHairStyleRevision>.Failure(new ApplicationError(ApplicationErrorCode.Conflict, "Conflito ao publicar cabelo.")));
            var existing = Publications.FirstOrDefault(item => item.HairId == hairId && item.DraftRevision == expectedDraftRevision);
            if (existing is not null) return Task.FromResult(Result<PublishedHairStyleRevision>.Success(existing));
            var publication = PublishedHairStyleRevision.Restore(HairRevisionId.New(), hairId,
                Revision.From(Publications.Count + 1), draft.Revision, publishedUtcMs, new string('a', 64), draft);
            Publications.Add(publication);
            return Task.FromResult(Result<PublishedHairStyleRevision>.Success(publication));
        }

        public Task<Result<IReadOnlyList<PublishedHairStyleRevision>>> ListPublishedAsync(HairId hairId,
            CancellationToken cancellationToken = default) => Task.FromResult(Result<IReadOnlyList<PublishedHairStyleRevision>>.Success(
                Publications.Where(item => item.HairId == hairId).ToArray()));
    }

    private static byte[] CreatePng(Action<SKBitmap> paint, int width = 20, int height = 12)
    {
        using var bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        paint(bitmap);
        using var image = bitmap.Encode(SKEncodedImageFormat.Png, 100);
        return image!.ToArray();
    }
}
