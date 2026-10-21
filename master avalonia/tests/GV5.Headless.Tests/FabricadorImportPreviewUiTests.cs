using System.Diagnostics;
using System.Security.Cryptography;
using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.Media.Imaging;
using Avalonia.VisualTree;
using GV5.Application.Contracts;
using GV5.Application.Services;
using GV5.Assets.Decoding;
using GV5.Assets.Import;
using GV5.Assets.Processing;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Assets;
using GV5.Data.Diagnostics;
using GV5.Data.Migrations;
using GV5.Data.Repositories;
using GV5.Data.Storage;
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
    public async Task RealSqliteImportEditUndoSaveReopenAndPublishKeepsModelAssetsAndRevision()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = Path.Combine(Path.GetTempPath(), $"gv5-fabricator-real-flow-{Guid.NewGuid():N}");
        var paths = new AppDataPaths(root);
        var decoder = new AssetImageDecoder();
        var sourceBytes = CreateModelSheetPng();
        ModelId modelId;
        ModelDraftContent savedContent;

        try
        {
            using (var database = new SqliteDatabase(paths))
            {
                var initializer = CreateDataInitializer(database);
                await initializer.InitializeAsync(cancellationToken);
                var correlation = new OperationCorrelationContext();
                var assetPipeline = new SqliteAssetImportPipeline(paths, database, initializer, new StructuredFileLogger(paths, correlation), correlation);
                var assetStore = new SqliteAssetStore(assetPipeline, database, initializer);
                var draftRepository = new SqliteModelDraftRepository(database);
                var contentRepository = new SqliteModelDraftContentRepository(database);
                var revisionRepository = new SqliteModelRevisionRepository(database);
                using var renderAssetsCache = new AssetBitmapCache(16 * 1024 * 1024);
                var sceneRenderer = new SkiaRenderer(new TestRenderAssetProvider(assetStore, decoder, renderAssetsCache));
                var importService = new ModelSourceImportService(
                    new AssetImportStager(Path.Combine(paths.TempDirectory, "fabricator-test-staging"), new AssetImportLimits(2 * 1024 * 1024, 16_384, 32_000_000)),
                    decoder,
                    new ModelSheetSegmentationProcessor(new ChromaCropProcessor()));
                var publishService = new PublishModelRevisionService(draftRepository, contentRepository, revisionRepository);
                var viewModel = new FabricadorViewModel(
                    draftRepository,
                    initializer,
                    filePicker: new RecordingFilePicker(sourceBytes),
                    modelSourceImportService: importService,
                    assetStore: assetStore,
                    contentRepository: contentRepository,
                    sceneRenderer: sceneRenderer,
                    autosaveDelay: TimeSpan.FromHours(1),
                    publishModelRevisionService: publishService);
                viewModel.ModelName = "Modelo SQLite real";
                var window = new Window { Width = 900, Height = 700, Content = new FabricadorView { DataContext = viewModel } };
                window.Show();

                try
                {
                    await viewModel.SelectModelSourceCommand.ExecuteAsync(null);
                    await viewModel.PublishModelSourceCommand.ExecuteAsync(null);
                    Assert.True(viewModel.HasModelParts);
                    Assert.Equal(2, viewModel.PartLayers.Count);

                    viewModel.ConnectRigPartsCommand.Execute(null);
                    var createdJoint = Assert.Single(viewModel.RigJointItems).Joint;
                    var rigGuides = window.GetVisualDescendants().OfType<Canvas>().Single(canvas => canvas.Name == "RigGuideLayer");
                    Assert.Equal(3, rigGuides.Children.Count); // connection line plus both draggable anchors
                    viewModel.SelectedRigJoint = viewModel.RigJointItems.Single();
                    viewModel.RigParentAnchorX = "31.5";
                    viewModel.RigParentAnchorY = "18";
                    viewModel.RigChildAnchorX = "7";
                    viewModel.RigChildAnchorY = "12.25";
                    viewModel.ApplyRigJointAnchorsCommand.Execute(null);
                    viewModel.ToggleSelectedRigJointModeCommand.Execute(null);
                    Assert.Equal(RigJointMode.Fixed, Assert.Single(viewModel.RigJointItems).Joint.Mode);
                    viewModel.UndoCommand.Execute(null);
                    Assert.Equal(RigJointMode.Loose, Assert.Single(viewModel.RigJointItems).Joint.Mode);
                    viewModel.RedoCommand.Execute(null);
                    Assert.Equal(createdJoint.Id, Assert.Single(viewModel.RigJointItems).Joint.Id);

                    var originalOrder = viewModel.PartLayers.Select(item => item.Id).ToArray();
                    var editedId = viewModel.PartLayers[0].Id;
                    viewModel.TogglePartVisibilityCommand.Execute(editedId);
                    viewModel.UndoCommand.Execute(null);
                    Assert.True(viewModel.PartLayers.Single(item => item.Id == editedId).IsVisible);
                    Assert.Equal(originalOrder, viewModel.PartLayers.Select(item => item.Id));

                    var loadedContent = await contentRepository.GetAsync(Assert.Single((await draftRepository.ListAsync(cancellationToken)).Value).Id, cancellationToken);
                    Assert.True(loadedContent.IsSuccess, loadedContent.Error?.Message);
                    var sceneBounds = ModelDraftHitTester.GetPartBounds(loadedContent.Value, editedId)!.Value;
                    viewModel.SelectPartLayerCommand.Execute(editedId);
                    var start = new Point2D(sceneBounds.X + sceneBounds.Width / 2, sceneBounds.Y + sceneBounds.Height / 2);
                    viewModel.BeginModelPartTransform(new TransformGestureStart(ModelPartTransformKind.Move, start));
                    viewModel.UpdateModelPartTransform(new Point2D(start.X + 3, start.Y + 2));
                    viewModel.CompleteModelPartTransform();

                    var jointBeforeAnchorDrag = Assert.Single(viewModel.RigJointItems).Joint;
                    viewModel.BeginRigAnchorDrag(jointBeforeAnchorDrag.Id, isParentAnchor: false);
                    var snapTarget = jointBeforeAnchorDrag.ParentAnchor;
                    var snap = viewModel.UpdateRigAnchorDrag(snapTarget + new Point2D(1, 1), snapThreshold: 2);
                    Assert.Equal(snapTarget, Assert.Single(viewModel.RigJointItems).Joint.ChildAnchor);
                    Assert.NotNull(snap.XMatch);
                    Assert.NotNull(snap.YMatch);
                    viewModel.CompleteRigAnchorDrag();
                    viewModel.UndoCommand.Execute(null);
                    Assert.Equal(jointBeforeAnchorDrag.ChildAnchor, Assert.Single(viewModel.RigJointItems).Joint.ChildAnchor);
                    viewModel.RedoCommand.Execute(null);
                    Assert.Equal(snapTarget, Assert.Single(viewModel.RigJointItems).Joint.ChildAnchor);

                    Assert.True(await viewModel.FlushPendingChangesAsync(cancellationToken));
                    Assert.Equal(PersistenceState.Saved, viewModel.SaveState);
                }
                finally
                {
                    window.Close();
                    viewModel.Dispose();
                }

                var list = await draftRepository.ListAsync(cancellationToken);
                Assert.True(list.IsSuccess);
                modelId = Assert.Single(list.Value).Id;
                Assert.True((await contentRepository.GetAsync(modelId, cancellationToken)).IsSuccess);
            }

            using (var reopenedDatabase = new SqliteDatabase(paths))
            {
                var initializer = CreateDataInitializer(reopenedDatabase);
                await initializer.InitializeAsync(cancellationToken);
                var reopenedDrafts = new SqliteModelDraftRepository(reopenedDatabase);
                var reopenedContents = new SqliteModelDraftContentRepository(reopenedDatabase);
                var correlation = new OperationCorrelationContext();
                var reopenedStore = new SqliteAssetStore(
                    new SqliteAssetImportPipeline(paths, reopenedDatabase, initializer,
                        new StructuredFileLogger(paths, correlation), correlation),
                    reopenedDatabase,
                    initializer);
                var draft = await reopenedDrafts.GetAsync(modelId, cancellationToken);
                var content = await reopenedContents.GetAsync(modelId, cancellationToken);
                Assert.True(draft.IsSuccess, draft.Error?.Message);
                Assert.True(content.IsSuccess, content.Error?.Message);
                savedContent = content.Value;
                Assert.Equal(2, savedContent.Parts.Length);
                Assert.Equal(Revision.From(2), savedContent.Revision);
                var savedJoint = Assert.Single(savedContent.RigJoints);
                Assert.Equal(RigJointMode.Fixed, savedJoint.Mode);
                Assert.Equal(new Point2D(31.5, 18), savedJoint.ParentAnchor);
                Assert.Equal(savedJoint.ParentAnchor, savedJoint.ChildAnchor);
                Assert.Single(savedContent.Parts.Where(part => part.SourceTransform.Transform != part.Transform));
                foreach (var assetId in savedContent.Parts.Select(part => part.AssetId).Append(savedContent.SourceAssetId!.Value))
                {
                    var metadata = await reopenedStore.GetMetadataAsync(assetId, cancellationToken);
                    Assert.True(metadata.IsSuccess, metadata.Error?.Message);
                    Assert.Equal(AssetVerificationState.Available, metadata.Value.VerificationState);
                }

                var revisions = new SqliteModelRevisionRepository(reopenedDatabase);
                var published = await new PublishModelRevisionService(reopenedDrafts, reopenedContents, revisions)
                    .PublishAsync(modelId, 1234, cancellationToken);
                Assert.True(published.IsSuccess, published.Error?.Message);
                Assert.Equal(Revision.Initial, published.Value.Revision);
                Assert.Equal(savedContent.Parts.Select(part => part.AssetId), published.Value.Content.Parts.Select(part => part.AssetId));
                var persistedPublication = await revisions.GetAsync(modelId, Revision.Initial, cancellationToken);
                Assert.True(persistedPublication.IsSuccess, persistedPublication.Error?.Message);
                Assert.Equal(savedContent.Parts.Select(part => part.Transform), persistedPublication.Value.Content.Parts.Select(part => part.Transform));
                Assert.Equal(savedContent.RigJoints, persistedPublication.Value.Content.RigJoints);
            }
        }
        finally
        {
            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }

    [AvaloniaFact]
    public async Task PieceEdits_AreDebouncedAndOnlyMarkedSavedAfterContentRepositoryConfirms()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = Path.Combine(Path.GetTempPath(), $"gv5-fabricator-autosave-{Guid.NewGuid():N}");
        var store = new RecordingAssetStore();
        var contentRepository = new RecordingContentRepository();
        var draftRepository = new EmptyDraftRepository();
        using var renderAssetsCache = new AssetBitmapCache(4 * 1024 * 1024);
        var renderAssets = new TestRenderAssetProvider(store, new AssetImageDecoder(), renderAssetsCache);
        var service = CreateService(root);
        var viewModel = new FabricadorViewModel(
            draftRepository,
            new NoopInitializer(),
            filePicker: new RecordingFilePicker(CreateModelSheetPng()),
            modelSourceImportService: service,
            assetStore: store,
            contentRepository: contentRepository,
            sceneRenderer: new SkiaRenderer(renderAssets));
        viewModel.ModelName = "Modelo com autosave";
        var window = new Window { Width = 900, Height = 700, Content = new FabricadorView { DataContext = viewModel } };
        window.Show();

        try
        {
            await viewModel.SelectModelSourceCommand.ExecuteAsync(null);
            await viewModel.PublishModelSourceCommand.ExecuteAsync(null);
            Assert.Equal(1, contentRepository.SaveCount);

            var part = contentRepository.LastSaved!.Parts[0];
            viewModel.TogglePartVisibilityCommand.Execute(part.Id);
            Assert.Equal(PersistenceState.Dirty, viewModel.SaveState);
            Assert.True(viewModel.CanSave);
            Assert.Equal(1, contentRepository.SaveCount);

            await WaitUntilAsync(
                () => viewModel.SaveState == PersistenceState.Saved && contentRepository.SaveCount == 2,
                cancellationToken);

            Assert.Equal(Revision.From(2), contentRepository.LastSaved!.Revision);
            Assert.False(contentRepository.LastSaved.Parts.Single(candidate => candidate.Id == part.Id).IsVisible);
            Assert.False(viewModel.CanSave);
            Assert.Contains(window.GetVisualDescendants().OfType<TextBlock>(), text => text.Name == "SaveStateText" && text.Text == "Salvo");
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

    [AvaloniaFact]
    public async Task FilePickerFlowShowsReviewedBitmapAndPublishesOnlyAfterConfirmation()
    {
        var root = Path.Combine(Path.GetTempPath(), $"gv5-fabricator-preview-{Guid.NewGuid():N}");
        var bytes = CreateModelSheetPng();
        var picker = new RecordingFilePicker(bytes);
        var store = new RecordingAssetStore();
        var contentRepository = new RecordingContentRepository();
        var draftRepository = new EmptyDraftRepository();
        var revisionRepository = new RecordingModelRevisionRepository();
        var publishService = new PublishModelRevisionService(draftRepository, contentRepository, revisionRepository);
        using var renderAssetsCache = new AssetBitmapCache(4 * 1024 * 1024);
        var renderAssets = new TestRenderAssetProvider(store, new AssetImageDecoder(), renderAssetsCache);
        var sceneRenderer = new SkiaRenderer(renderAssets);
        var service = CreateService(root);
        var viewModel = new FabricadorViewModel(
            draftRepository,
            new NoopInitializer(),
            filePicker: picker,
            modelSourceImportService: service,
            assetStore: store,
            contentRepository: contentRepository,
            sceneRenderer: sceneRenderer,
            autosaveDelay: TimeSpan.FromHours(1),
            publishModelRevisionService: publishService);
        viewModel.ModelName = "Modelo de teste";
        var view = new FabricadorView { DataContext = viewModel };
        var window = new Window { Width = 900, Height = 700, Content = view };
        window.Show();

        try
        {
            await viewModel.SelectModelSourceCommand.ExecuteAsync(null);

            var previewImage = Assert.IsType<Image>(window.GetVisualDescendants().Single(control => control.Name == "ModelSourcePreviewImage"));
            var previewBitmap = Assert.IsType<WriteableBitmap>(previewImage.Source);
            Assert.Equal(64, previewBitmap.PixelSize.Width);
            Assert.Equal(48, previewBitmap.PixelSize.Height);
            Assert.Equal("Fonte: 64 × 48 px · prévia 64 × 48 px", viewModel.ImportPreviewDimensions);
            Assert.Contains(window.GetVisualDescendants().OfType<TextBlock>(), text => text.Text == viewModel.ImportPreviewDimensions);
            Assert.Equal(0, store.ImportCount);
            Assert.Single(Directory.GetFiles(root));

            await viewModel.PublishModelSourceCommand.ExecuteAsync(null);

            Assert.Equal(3, store.ImportCount);
            Assert.True(viewModel.ImportPreview!.IsPublished);
            Assert.False(viewModel.CanPublishModelSource);
            Assert.Contains("Modelo carregado", viewModel.ImportStatus);
            Assert.NotNull(viewModel.RenderedModelFrame);
            Assert.Equal(64, viewModel.RenderedModelFrame!.Width);
            Assert.Equal(48, viewModel.RenderedModelFrame.Height);
            Assert.Equal(new SKColor(240, 30, 30, 255), viewModel.RenderedModelFrame.Bitmap.GetPixel(10, 8));
            viewModel.SetToolCommand.Execute(FabricatorTool.Pan);
            Assert.True(viewModel.IsPanTool);
            viewModel.SetToolCommand.Execute(FabricatorTool.Select);
            Assert.True(viewModel.IsSelectTool);
            var canvas = Assert.Single(window.GetVisualDescendants().OfType<FabricatorCanvas>());
            Assert.IsType<WriteableBitmap>(canvas.Frame);
            var persisted = await contentRepository.GetAsync(contentRepository.LastSaved!.ModelId);
            Assert.True(persisted.IsSuccess);
            Assert.True(store.Contains(persisted.Value.SourceAssetId!.Value));
            Assert.Equal(64, persisted.Value.SourceWidth);
            Assert.Equal(48, persisted.Value.SourceHeight);
            Assert.True(viewModel.CanPublishRevision);
            await viewModel.PublishModelRevisionCommand.ExecuteAsync(null);
            Assert.Equal("Versão 01 publicada e preservada.", viewModel.PublishStatus);
            Assert.Single(revisionRepository.Revisions);

            var parts = persisted.Value.Parts;
            Assert.Equal(2, parts.Length);
            Assert.Equal(2, viewModel.PartLayers.Count);
            Assert.Equal(0, viewModel.UndoCount);
            Assert.False(viewModel.UndoCommand.CanExecute(null));
            Assert.Equal(parts.Select(partItem => partItem.Id).Reverse(), viewModel.PartLayers.Select(item => item.Id));
            Assert.False(viewModel.PartLayers.Single(item => item.Id == parts[1].Id).CanMoveForward);
            Assert.False(viewModel.PartLayers.Single(item => item.Id == parts[0].Id).CanMoveBackward);

            var layerList = Assert.Single(window.GetVisualDescendants().OfType<ListBox>(), control => control.Name == "ModelPartLayerList");
            Assert.Equal(2, layerList.Items.Count);
            viewModel.SelectPartLayerCommand.Execute(parts[0].Id);
            Assert.Equal(parts[0].Id, viewModel.SelectedModelPartId);
            Assert.True(viewModel.PartLayers.Single(item => item.Id == parts[0].Id).IsSelected);
            Assert.True(viewModel.PartLayers.Single(item => item.Id == parts[0].Id).CanMoveForward);
            viewModel.BringPartForwardCommand.Execute(parts[0].Id);
            Assert.Equal(1, viewModel.UndoCount);
            Assert.Equal([parts[0].Id, parts[1].Id], viewModel.PartLayers.Select(item => item.Id));
            viewModel.SendPartBackwardCommand.Execute(parts[0].Id);
            Assert.Equal(2, viewModel.UndoCount);
            Assert.Equal(parts.Select(partItem => partItem.Id).Reverse(), viewModel.PartLayers.Select(item => item.Id));

            viewModel.TogglePartVisibilityCommand.Execute(parts[1].Id);
            Assert.Equal(3, viewModel.UndoCount);
            Assert.False(viewModel.PartLayers.Single(item => item.Id == parts[1].Id).IsVisible);
            viewModel.SelectModelPartAt(new Point2D(10, 8));
            Assert.Equal(parts[0].Id, viewModel.SelectedModelPartId);
            viewModel.TogglePartVisibilityCommand.Execute(parts[1].Id);
            Assert.Equal(4, viewModel.UndoCount);
            Assert.True(viewModel.PartLayers.Single(item => item.Id == parts[1].Id).IsVisible);
            viewModel.ClearSelectionCommand.Execute(null);
            Assert.Null(viewModel.SelectedModelPartId);

            var part = parts[^1];
            viewModel.SelectPartLayerCommand.Execute(part.Id);
            var bounds = ModelDraftHitTester.GetPartBounds(persisted.Value, part.Id)!.Value;
            var afterTransform = new Transform2D(new Point2D(8, 9), new Point2D(2, 3), 0.35, new Point2D(1, 1));
            var transformCommand = new ModelPartTransformCommand(part.Id, part.Transform, afterTransform);
            var applied = transformCommand.Apply(persisted.Value);
            Assert.Equal(afterTransform, applied.Parts.Single(candidate => candidate.Id == part.Id).Transform);
            Assert.Equal(persisted.Value.Revision, applied.Revision);
            var reverted = transformCommand.Revert(applied);
            Assert.Equal(part.Transform, reverted.Parts.Single(candidate => candidate.Id == part.Id).Transform);

            var gestureStart = new Point2D(bounds.X + bounds.Width / 2, bounds.Y + bounds.Height / 2);
            viewModel.SelectModelPartAt(gestureStart);
            Assert.Equal(part.Id, viewModel.SelectedModelPartId);
            viewModel.BeginModelPartTransform(new TransformGestureStart(ModelPartTransformKind.Move, gestureStart));
            viewModel.UpdateModelPartTransform(new Point2D(gestureStart.X + 12, gestureStart.Y - 4));
            Assert.Equal(4, viewModel.UndoCount);
            Assert.Equal(1, contentRepository.SaveCount);
            viewModel.UpdateModelPartTransform(new Point2D(gestureStart.X + 20, gestureStart.Y - 6));
            viewModel.CompleteModelPartTransform();
            Assert.Equal(5, viewModel.UndoCount);
            Assert.Equal(1, contentRepository.SaveCount);
            Assert.Equal(1, viewModel.PendingTransformCommandCount);
            var movedBounds = viewModel.SelectedPartBounds!.Value;
            Assert.Equal(bounds.X + 20, movedBounds.X, precision: 6);
            Assert.Equal(bounds.Y - 6, movedBounds.Y, precision: 6);
            Assert.Equal(part.Transform, contentRepository.LastSaved!.Parts.Single(candidate => candidate.Id == part.Id).Transform);

            var beforeScale = viewModel.SelectedPartBounds!.Value;
            var scaleStart = new Point2D(beforeScale.Right, beforeScale.Top);
            viewModel.BeginModelPartTransform(new TransformGestureStart(ModelPartTransformKind.Scale, scaleStart));
            viewModel.UpdateModelPartTransform(new Point2D(scaleStart.X + beforeScale.Width, scaleStart.Y));
            viewModel.CompleteModelPartTransform();
            Assert.Equal(6, viewModel.UndoCount);
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
            Assert.Equal(7, viewModel.UndoCount);
            Assert.Equal(3, viewModel.PendingTransformCommandCount);
            Assert.Equal(1, contentRepository.SaveCount);

            viewModel.UndoCommand.Execute(null);
            Assert.Equal(beforeRotate, viewModel.SelectedPartBounds!.Value);
            Assert.Equal(6, viewModel.UndoCount);
            Assert.Equal(1, viewModel.RedoCount);
            viewModel.RedoCommand.Execute(null);
            Assert.Equal(afterRotate, viewModel.SelectedPartBounds!.Value);
            Assert.Equal(7, viewModel.UndoCount);
            Assert.Equal(0, viewModel.RedoCount);
            Assert.Equal(PersistenceState.Dirty, viewModel.SaveState);
            Assert.True(await viewModel.FlushPendingChangesAsync());
            Assert.Equal(PersistenceState.Saved, viewModel.SaveState);
            Assert.Equal(2, contentRepository.SaveCount);
            Assert.Equal(Revision.From(2), contentRepository.LastSaved!.Revision);
            Assert.Equal(parts.Select(item => item.Id), contentRepository.LastSaved.LayerOrder);
            Assert.Equal(viewModel.SelectedPartBounds, ModelDraftHitTester.GetPartBounds(contentRepository.LastSaved, part.Id));

            await viewModel.PublishModelRevisionCommand.ExecuteAsync(null);
            Assert.Equal("Versão 02 publicada e preservada.", viewModel.PublishStatus);
            Assert.Equal(2, revisionRepository.Revisions.Count);
            Assert.Equal(part.Transform, revisionRepository.Revisions[0].Content.Parts.Single(candidate => candidate.Id == part.Id).Transform);
            Assert.NotEqual(part.Transform, revisionRepository.Revisions[1].Content.Parts.Single(candidate => candidate.Id == part.Id).Transform);

            for (var index = 0; index < 7; index++)
            {
                viewModel.UndoCommand.Execute(null);
            }

            Assert.Equal(0, viewModel.UndoCount);
            Assert.Equal(7, viewModel.RedoCount);
            Assert.Equal(bounds, viewModel.SelectedPartBounds!.Value);
            Assert.Equal(parts.Select(partItem => partItem.Id).Reverse(), viewModel.PartLayers.Select(item => item.Id));
            Assert.All(viewModel.PartLayers, item => Assert.True(item.IsVisible));
            viewModel.TogglePartVisibilityCommand.Execute(parts[0].Id);
            Assert.Equal(0, viewModel.RedoCount);
            viewModel.UndoCommand.Execute(null);
            Assert.Equal(0, viewModel.UndoCount);
            Assert.Equal(1, viewModel.RedoCount);
            contentRepository.AdvanceExternalRevision();
            viewModel.TogglePartVisibilityCommand.Execute(parts[0].Id);
            Assert.False(viewModel.PartLayers.Single(item => item.Id == parts[0].Id).IsVisible);
            Assert.False(await viewModel.FlushPendingChangesAsync());
            Assert.Equal(PersistenceState.Error, viewModel.SaveState);
            Assert.Contains("outra sessão", viewModel.SaveError, StringComparison.OrdinalIgnoreCase);
            Assert.False(viewModel.PartLayers.Single(item => item.Id == parts[0].Id).IsVisible);
            Assert.Equal(Revision.From(3), contentRepository.LastSaved!.Revision);
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

    private static ModelSourceImportService CreateService(string root) => new(
        new AssetImportStager(root, new AssetImportLimits(MaximumBytes: 1024 * 1024, MaximumDimension: 16_384, MaximumPixels: 32_000_000)),
        new AssetImageDecoder(),
        new ModelSheetSegmentationProcessor(new ChromaCropProcessor()));

    private static SqliteMigrationRunner CreateDataInitializer(IGv5Database database) => new(database,
    [
        new InitialAssetSchemaMigration(),
        new ModelDraftSchemaMigration(),
        new ModelDraftCheckpointSchemaMigration(),
        new AssetImportJournalSchemaMigration(),
        new AssetReferenceSchemaMigration(),
        new AssetGarbageCollectionSchemaMigration(),
        new ModelDraftContentSchemaMigration(),
        new ModelRevisionSchemaMigration(),
        new ModelRigJointSchemaMigration()
    ]);

    private static byte[] CreateModelSheetPng()
    {
        using var bitmap = new SKBitmap(new SKImageInfo(64, 48, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        bitmap.Erase(new SKColor(0, 230, 0, 255));
        for (var y = 8; y < 18; y++)
        for (var x = 10; x < 20; x++) bitmap.SetPixel(x, y, new SKColor(240, 30, 30, 255));
        for (var y = 25; y < 35; y++)
        for (var x = 38; x < 48; x++) bitmap.SetPixel(x, y, new SKColor(30, 30, 240, 255));

        using var image = SKImage.FromBitmap(bitmap);
        using var encoded = image.Encode(SKEncodedImageFormat.Png, 100);
        return encoded.ToArray();
    }

    private static async Task WaitUntilAsync(Func<bool> predicate, CancellationToken cancellationToken)
    {
        var timeout = Stopwatch.StartNew();
        while (!predicate())
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (timeout.Elapsed > TimeSpan.FromSeconds(5))
            {
                throw new TimeoutException("The expected autosave state was not reached within five seconds.");
            }

            await Task.Delay(20, cancellationToken);
        }
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
        private readonly Dictionary<AssetId, (AssetMetadata Metadata, byte[] Bytes)> _assets = [];
        public int ImportCount { get; private set; }
        public AssetMetadata? LastImported { get; private set; }
        public bool Contains(AssetId assetId) => _assets.ContainsKey(assetId);

        public async Task<Result<AssetMetadata>> ImportAsync(Stream content, string mediaType, CancellationToken cancellationToken = default)
        {
            ImportCount++;
            using var copy = new MemoryStream();
            await content.CopyToAsync(copy, cancellationToken);
            var data = copy.ToArray();
            LastImported = new AssetMetadata(
                AssetId.New(),
                Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant(),
                mediaType,
                data.LongLength,
                AssetVerificationState.Available,
                123);
            _assets.Add(LastImported.Id, (LastImported, data));
            return Result<AssetMetadata>.Success(LastImported);
        }

        public Task<Result<Stream>> OpenReadAsync(AssetId assetId, CancellationToken cancellationToken = default) =>
            Task.FromResult(_assets.TryGetValue(assetId, out var asset)
                ? Result<Stream>.Success(new MemoryStream(asset.Bytes, writable: false))
                : Result<Stream>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Not found.")));

        public Task<Result<AssetMetadata>> GetMetadataAsync(AssetId assetId, CancellationToken cancellationToken = default) =>
            Task.FromResult(_assets.TryGetValue(assetId, out var asset)
                ? Result<AssetMetadata>.Success(asset.Metadata)
                : Result<AssetMetadata>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Not found.")));

        public Task<Result<Unit>> AddReferenceAsync(AssetId assetId, AssetReferenceKey reference, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<Unit>.Success(Unit.Value));

        public Task<Result<Unit>> ReleaseReferenceAsync(AssetReferenceKey reference, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<Unit>.Success(Unit.Value));
    }

    private sealed class RecordingContentRepository : IModelDraftContentRepository
    {
        public ModelDraftContent? LastSaved { get; private set; }
        public int SaveCount { get; private set; }

        public Task<Result<ModelDraftContent>> GetAsync(ModelId modelId, CancellationToken cancellationToken = default)
        {
            return Task.FromResult(LastSaved?.ModelId == modelId
                ? Result<ModelDraftContent>.Success(LastSaved)
                : Result<ModelDraftContent>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Not found.")));
        }

        public Task<Result<ModelDraftContent>> SaveAsync(ModelDraftContent content, Revision? expectedRevision, CancellationToken cancellationToken = default)
        {
            if (LastSaved is null ? expectedRevision is not null : expectedRevision != LastSaved.Revision)
            {
                return Task.FromResult(Result<ModelDraftContent>.Failure(new ApplicationError(
                    ApplicationErrorCode.Conflict,
                    "The model content changed since it was loaded.")));
            }

            LastSaved = content;
            SaveCount++;
            return Task.FromResult(Result<ModelDraftContent>.Success(content));
        }

        public void AdvanceExternalRevision()
        {
            if (LastSaved is null)
            {
                throw new InvalidOperationException("The model content must be loaded before simulating an external edit.");
            }

            LastSaved = LastSaved.WithParts(LastSaved.Parts, LastSaved.LayerOrder);
        }
    }

    private sealed class TestRenderAssetProvider(
        IAssetStore store,
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
        private readonly Dictionary<ModelId, ModelDraft> _drafts = [];

        public Task<Result<ModelDraft>> CreateAsync(ModelDraft draft, CancellationToken cancellationToken = default)
        {
            _drafts[draft.Id] = draft;
            return Task.FromResult(Result<ModelDraft>.Success(draft));
        }
        public Task<Result<IReadOnlyList<ModelDraft>>> ListAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<IReadOnlyList<ModelDraft>>.Success(_drafts.Values.ToArray()));
        public Task<Result<ModelDraft>> GetAsync(ModelId id, CancellationToken cancellationToken = default) =>
            Task.FromResult(_drafts.TryGetValue(id, out var draft)
                ? Result<ModelDraft>.Success(draft)
                : Result<ModelDraft>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Not found.")));
        public Task<Result<ModelDraft>> DuplicateAsync(ModelId sourceId, string name, long nowUtcMs, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<ModelDraft>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Not found.")));
        public Task<Result<ModelDraft>> UpdateAsync(ModelDraft draft, Revision expectedRevision, CancellationToken cancellationToken = default)
        {
            if (!_drafts.TryGetValue(draft.Id, out var current) || current.Revision != expectedRevision)
            {
                return Task.FromResult(Result<ModelDraft>.Failure(new ApplicationError(ApplicationErrorCode.Conflict, "The model draft changed.")));
            }
            _drafts[draft.Id] = draft;
            return Task.FromResult(Result<ModelDraft>.Success(draft));
        }
    }

    private sealed class RecordingModelRevisionRepository : IModelRevisionRepository
    {
        public List<PublishedModelRevision> Revisions { get; } = [];

        public Task<Result<PublishedModelRevision>> PublishAsync(ModelDraft draft, ModelDraftContent content, long publishedUtcMs, CancellationToken cancellationToken = default)
        {
            var revision = Revisions.Count == 0 ? Revision.Initial : Revisions[^1].Revision.Next();
            var published = PublishedModelRevision.Restore(
                ModelRevisionId.New(), draft.Id, revision, draft.Revision, draft.Name, publishedUtcMs,
                new string('a', 64), content);
            Revisions.Add(published);
            return Task.FromResult(Result<PublishedModelRevision>.Success(published));
        }

        public Task<Result<PublishedModelRevision>> GetAsync(ModelId modelId, Revision revision, CancellationToken cancellationToken = default) =>
            Task.FromResult(Revisions.SingleOrDefault(item => item.ModelId == modelId && item.Revision == revision) is { } published
                ? Result<PublishedModelRevision>.Success(published)
                : Result<PublishedModelRevision>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Not found.")));

        public Task<Result<IReadOnlyList<PublishedModelRevision>>> ListAsync(ModelId modelId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<IReadOnlyList<PublishedModelRevision>>.Success(Revisions.Where(item => item.ModelId == modelId).ToArray()));
    }

    private sealed class NoopInitializer : IDataPlatformInitializer
    {
        public Task InitializeAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
