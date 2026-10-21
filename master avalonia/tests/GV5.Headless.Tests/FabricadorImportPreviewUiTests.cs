using System.Security.Cryptography;
using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Media.Imaging;
using Avalonia.VisualTree;
using GV5.Application.Contracts;
using GV5.Assets.Decoding;
using GV5.Assets.Import;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using GV5.Modules.Fabricador.Import;
using GV5.Modules.Fabricador.Interaction;
using GV5.Modules.Fabricador.ViewModels;
using GV5.Modules.Fabricador.Views;
using GV5.Rendering;
using SkiaSharp;
using Xunit;

namespace GV5.Headless.Tests;

public sealed class FabricadorImportPreviewUiTests
{
    [AvaloniaFact]
    public async Task FilePickerFlowShowsReviewedBitmapAndPublishesOnlyAfterConfirmation()
    {
        var root = Path.Combine(Path.GetTempPath(), $"gv5-fabricator-preview-{Guid.NewGuid():N}");
        var bytes = CreatePng(9, 6);
        var picker = new RecordingFilePicker(bytes);
        var store = new RecordingAssetStore();
        var contentRepository = new RecordingContentRepository(store, includePiece: true);
        using var renderAssetsCache = new AssetBitmapCache(4 * 1024 * 1024);
        var renderAssets = new TestRenderAssetProvider(store, new AssetImageDecoder(), renderAssetsCache);
        var sceneRenderer = new SkiaRenderer(renderAssets);
        var service = new ModelSourceImportService(
            new AssetImportStager(root, new AssetImportLimits(MaximumBytes: 1024 * 1024, MaximumDimension: 16_384, MaximumPixels: 32_000_000)),
            new AssetImageDecoder());
        var viewModel = new FabricadorViewModel(
            new EmptyDraftRepository(),
            new NoopInitializer(),
            filePicker: picker,
            modelSourceImportService: service,
            assetStore: store,
            contentRepository: contentRepository,
            sceneRenderer: sceneRenderer);
        viewModel.ModelName = "Modelo de teste";
        var view = new FabricadorView { DataContext = viewModel };
        var window = new Window { Width = 900, Height = 700, Content = view };
        window.Show();

        try
        {
            await viewModel.SelectModelSourceCommand.ExecuteAsync(null);

            var previewImage = Assert.IsType<Image>(window.GetVisualDescendants().Single(control => control.Name == "ModelSourcePreviewImage"));
            var previewBitmap = Assert.IsType<WriteableBitmap>(previewImage.Source);
            Assert.Equal(9, previewBitmap.PixelSize.Width);
            Assert.Equal(6, previewBitmap.PixelSize.Height);
            Assert.Equal("Fonte: 9 × 6 px · prévia 9 × 6 px", viewModel.ImportPreviewDimensions);
            Assert.Contains(window.GetVisualDescendants().OfType<TextBlock>(), text => text.Text == viewModel.ImportPreviewDimensions);
            Assert.Equal(0, store.ImportCount);
            Assert.Single(Directory.GetFiles(root));

            await viewModel.PublishModelSourceCommand.ExecuteAsync(null);

            Assert.Equal(1, store.ImportCount);
            Assert.True(viewModel.ImportPreview!.IsPublished);
            Assert.False(viewModel.CanPublishModelSource);
            Assert.Contains("Modelo carregado", viewModel.ImportStatus);
            Assert.NotNull(viewModel.RenderedModelFrame);
            Assert.Equal(9, viewModel.RenderedModelFrame!.Width);
            Assert.Equal(6, viewModel.RenderedModelFrame.Height);
            Assert.NotEqual(SKColors.Transparent, viewModel.RenderedModelFrame.Bitmap.GetPixel(2, 2));
            viewModel.SetToolCommand.Execute(FabricatorTool.Pan);
            Assert.True(viewModel.IsPanTool);
            viewModel.SetToolCommand.Execute(FabricatorTool.Select);
            Assert.True(viewModel.IsSelectTool);
            var canvas = Assert.Single(window.GetVisualDescendants().OfType<FabricatorCanvas>());
            Assert.IsType<WriteableBitmap>(canvas.Frame);
            var persisted = await contentRepository.GetAsync(contentRepository.LastSaved!.ModelId);
            Assert.True(persisted.IsSuccess);
            Assert.Equal(store.LastImported!.Id, persisted.Value.SourceAssetId);
            Assert.Equal(9, persisted.Value.SourceWidth);
            Assert.Equal(6, persisted.Value.SourceHeight);

            var part = Assert.Single(persisted.Value.Parts);
            var bounds = ModelDraftHitTester.GetPartBounds(persisted.Value, part.Id)!.Value;
            var afterTransform = new Transform2D(new Point2D(8, 9), new Point2D(2, 3), 0.35, new Point2D(1, 1));
            var transformCommand = new ModelPartTransformCommand(part.Id, part.Transform, afterTransform);
            var applied = transformCommand.Apply(persisted.Value);
            Assert.Equal(afterTransform, Assert.Single(applied.Parts).Transform);
            Assert.Equal(persisted.Value.Revision, applied.Revision);
            var reverted = transformCommand.Revert(applied);
            Assert.Equal(part.Transform, Assert.Single(reverted.Parts).Transform);

            var gestureStart = new Point2D(bounds.X + bounds.Width / 2, bounds.Y + bounds.Height / 2);
            viewModel.SelectModelPartAt(gestureStart);
            Assert.Equal(part.Id, viewModel.SelectedModelPartId);
            viewModel.BeginModelPartTransform(new TransformGestureStart(ModelPartTransformKind.Move, gestureStart));
            viewModel.UpdateModelPartTransform(new Point2D(gestureStart.X + 12, gestureStart.Y - 4));
            Assert.Equal(1, contentRepository.SaveCount);
            viewModel.UpdateModelPartTransform(new Point2D(gestureStart.X + 20, gestureStart.Y - 6));
            viewModel.CompleteModelPartTransform();
            Assert.Equal(1, contentRepository.SaveCount);
            Assert.Equal(1, viewModel.PendingTransformCommandCount);
            var movedBounds = viewModel.SelectedPartBounds!.Value;
            Assert.Equal(bounds.X + 20, movedBounds.X, precision: 6);
            Assert.Equal(bounds.Y - 6, movedBounds.Y, precision: 6);
            Assert.Equal(part.Transform, contentRepository.LastSaved!.Parts.Single().Transform);

            var beforeScale = viewModel.SelectedPartBounds!.Value;
            var scaleStart = new Point2D(beforeScale.Right, beforeScale.Top);
            viewModel.BeginModelPartTransform(new TransformGestureStart(ModelPartTransformKind.Scale, scaleStart));
            viewModel.UpdateModelPartTransform(new Point2D(scaleStart.X + beforeScale.Width, scaleStart.Y));
            viewModel.CompleteModelPartTransform();
            var afterScale = viewModel.SelectedPartBounds!.Value;
            Assert.True(afterScale.Width > beforeScale.Width * 1.5, $"Expected width to grow beyond {beforeScale.Width * 1.5}, got {afterScale.Width}.");

            var beforeRotate = viewModel.SelectedPartBounds!.Value;
            var pivot = viewModel.SelectedPartPivot!.Value;
            var startAngle = new Point2D(pivot.X + 20, pivot.Y);
            const double rotationDelta = 0.5;
            var endAngle = new Point2D(pivot.X + 20 * Math.Cos(rotationDelta), pivot.Y + 20 * Math.Sin(rotationDelta));
            viewModel.BeginModelPartTransform(new TransformGestureStart(ModelPartTransformKind.Rotate, startAngle));
            viewModel.UpdateModelPartTransform(endAngle);
            viewModel.CompleteModelPartTransform();
            var afterRotate = viewModel.SelectedPartBounds!.Value;
            Assert.True(afterRotate.Width > beforeRotate.Width, $"Expected rotation to expand the bounds beyond {beforeRotate.Width}, got {afterRotate.Width}.");
            Assert.Equal(3, viewModel.PendingTransformCommandCount);
            Assert.Equal(1, contentRepository.SaveCount);
            Assert.Empty(Directory.GetFiles(root));

            await viewModel.CancelModelSourceImportCommand.ExecuteAsync(null);
            Assert.Null(previewImage.Source);
            Assert.Null(viewModel.ImportPreview);
        }
        finally
        {
            window.Close();
            viewModel.Dispose();
            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }

    private static byte[] CreatePng(int width, int height)
    {
        using var bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        for (var y = 0; y < height; y++)
        for (var x = 0; x < width; x++)
        {
            bitmap.SetPixel(x, y, new SKColor((byte)(x * 19), (byte)(y * 27), 160, 255));
        }

        using var image = SKImage.FromBitmap(bitmap);
        using var encoded = image.Encode(SKEncodedImageFormat.Png, 100);
        return encoded.ToArray();
    }

    private sealed class RecordingFilePicker(byte[] bytes) : IFilePicker
    {
        public Task<PickedFile?> PickImageAsync(CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult<PickedFile?>(new PickedFile("folha.png", "image/png", new MemoryStream(bytes, writable: false)));
        }
    }

    private sealed class RecordingAssetStore : IAssetStore
    {
        public int ImportCount { get; private set; }
        public AssetMetadata? LastImported { get; private set; }
        private byte[]? _bytes;

        public async Task<Result<AssetMetadata>> ImportAsync(Stream content, string mediaType, CancellationToken cancellationToken = default)
        {
            ImportCount++;
            using var copy = new MemoryStream();
            await content.CopyToAsync(copy, cancellationToken);
            var data = copy.ToArray();
            _bytes = data;
            LastImported = new AssetMetadata(
                AssetId.New(),
                Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant(),
                mediaType,
                data.LongLength,
                AssetVerificationState.Available,
                123);
            return Result<AssetMetadata>.Success(LastImported);
        }

        public Task<Result<Stream>> OpenReadAsync(AssetId assetId, CancellationToken cancellationToken = default) =>
            Task.FromResult(LastImported?.Id == assetId && _bytes is not null
                ? Result<Stream>.Success(new MemoryStream(_bytes, writable: false))
                : Result<Stream>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Not found.")));

        public Task<Result<AssetMetadata>> GetMetadataAsync(AssetId assetId, CancellationToken cancellationToken = default) =>
            Task.FromResult(LastImported?.Id == assetId
                ? Result<AssetMetadata>.Success(LastImported)
                : Result<AssetMetadata>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Not found.")));

        public Task<Result<Unit>> AddReferenceAsync(AssetId assetId, AssetReferenceKey reference, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<Unit>.Success(Unit.Value));

        public Task<Result<Unit>> ReleaseReferenceAsync(AssetReferenceKey reference, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<Unit>.Success(Unit.Value));
    }

    private sealed class RecordingContentRepository(RecordingAssetStore store, bool includePiece) : IModelDraftContentRepository
    {
        public ModelDraftContent? LastSaved { get; private set; }
        public int SaveCount { get; private set; }

        public Task<Result<ModelDraftContent>> GetAsync(ModelId modelId, CancellationToken cancellationToken = default)
        {
            if (LastSaved is null && includePiece && store.LastImported is { } source)
            {
                var partId = ModelPartId.New();
                var crop = new Rect2D(0, 0, 2, 2);
                var part = new ModelPart(
                    partId,
                    "Peça sintética",
                    source.Id,
                    crop,
                    new Transform2D(new Point2D(2, 2), new Point2D(1, 1), 0, Point2D.Zero),
                    new ModelPartSourceTransform(crop, Transform2D.Identity));
                LastSaved = ModelDraftContent.Restore(
                    ModelDraftContent.CurrentSchemaVersion,
                    modelId,
                    Revision.Initial,
                    null,
                    source.Id,
                    9,
                    6,
                    [part],
                    [partId]);
                SaveCount = 1;
            }

            return Task.FromResult(LastSaved?.ModelId == modelId
                ? Result<ModelDraftContent>.Success(LastSaved)
                : Result<ModelDraftContent>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Not found.")));
        }

        public Task<Result<ModelDraftContent>> SaveAsync(ModelDraftContent content, Revision? expectedRevision, CancellationToken cancellationToken = default)
        {
            LastSaved = content;
            SaveCount++;
            return Task.FromResult(Result<ModelDraftContent>.Success(content));
        }
    }

    private sealed class TestRenderAssetProvider(
        RecordingAssetStore store,
        AssetImageDecoder decoder,
        AssetBitmapCache cache) : IRenderAssetProvider
    {
        public async Task<AssetImageLease> AcquireAsync(AssetId assetId, CancellationToken cancellationToken = default)
        {
            var metadataResult = await store.GetMetadataAsync(assetId, cancellationToken);
            if (metadataResult.IsFailure)
            {
                throw new InvalidOperationException("Test asset not found.");
            }

            var key = AssetImageCacheKey.Create(metadataResult.Value.Sha256, 1);
            var result = await cache.AcquireAsync(key, async token =>
            {
                var streamResult = await store.OpenReadAsync(assetId, token);
                if (streamResult.IsFailure)
                {
                    throw new InvalidOperationException("Test asset not found.");
                }

                await using var stream = streamResult.Value;
                return await decoder.DecodeAsync(stream, token);
            }, cancellationToken);
            return result.Lease ?? throw new InvalidOperationException("Test asset decode failed.");
        }
    }

    private sealed class EmptyDraftRepository : IModelDraftRepository
    {
        public Task<Result<ModelDraft>> CreateAsync(ModelDraft draft, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<ModelDraft>.Success(draft));
        public Task<Result<IReadOnlyList<ModelDraft>>> ListAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<IReadOnlyList<ModelDraft>>.Success([]));
        public Task<Result<ModelDraft>> GetAsync(ModelId id, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<ModelDraft>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Not found.")));
        public Task<Result<ModelDraft>> DuplicateAsync(ModelId sourceId, string name, long nowUtcMs, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<ModelDraft>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Not found.")));
        public Task<Result<ModelDraft>> UpdateAsync(ModelDraft draft, Revision expectedRevision, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<ModelDraft>.Success(draft));
    }

    private sealed class NoopInitializer : IDataPlatformInitializer
    {
        public Task InitializeAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
