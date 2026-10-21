using GV5.Application.Contracts;
using GV5.Assets.Decoding;
using GV5.Assets.Import;
using GV5.Assets.Processing;
using GV5.Core.Identity;
using GV5.Core.Models;
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
            Assert.True(workspace.CanUndoLayer);
            workspace.UndoLayerCommand.Execute(null);
            Assert.Single(workspace.Layers);
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

    private static byte[] CreatePng(Action<SKBitmap> paint, int width = 20, int height = 12)
    {
        using var bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        paint(bitmap);
        using var image = bitmap.Encode(SKEncodedImageFormat.Png, 100);
        return image!.ToArray();
    }
}
