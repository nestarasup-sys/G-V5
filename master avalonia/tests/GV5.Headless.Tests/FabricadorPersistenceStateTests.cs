using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.VisualTree;
using Avalonia.Interactivity;
using GV5.Application.Contracts;
using GV5.Assets.Decoding;
using GV5.Data.Assets;
using GV5.Data.Diagnostics;
using GV5.Data.Migrations;
using GV5.Data.Repositories;
using GV5.Data.Storage;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Geometry;
using GV5.Modules.Fabricador.ViewModels;
using GV5.Modules.Fabricador.Views;
using GV5.Modules.Fabricador.Import;
using SkiaSharp;
using Xunit;

namespace GV5.Headless.Tests;

public sealed class FabricadorPersistenceStateTests
{
    [AvaloniaFact]
    public async Task ModelCanvasGridToggleUpdatesTheBoundCanvasAndLabel()
    {
        var root = NewTempRoot();
        using var database = new SqliteDatabase(new AppDataPaths(root));
        var viewModel = new FabricadorViewModel(new SqliteModelDraftRepository(database),
            new BlockingInitializer(CreateMigrationRunner(database)));
        var window = OpenEditor(viewModel);

        try
        {
            var canvas = Assert.Single(window.GetVisualDescendants().OfType<FabricatorCanvas>());
            var toggle = window.GetVisualDescendants().OfType<Button>().Single(button => button.Name == "CanvasGridToggle");
            Assert.False(canvas.ShowGrid);
            Assert.True(toggle.IsVisible);
            Assert.Equal("Mostrar grade", toggle.Content?.ToString());

            viewModel.ToggleCanvasGridCommand.Execute(null);

            Assert.True(viewModel.IsCanvasGridVisible);
            Assert.True(viewModel.CanvasGridEnabled);
            Assert.True(canvas.ShowGrid);
            Assert.Equal("Ocultar grade", toggle.Content?.ToString());
        }
        finally
        {
            window.Close();
            viewModel.Dispose();
            DeleteTempRoot(root);
        }
    }

    [AvaloniaFact]
    public async Task FabricadorModelSlots_ShowTenSlotsPersistSelectionAndDeleteOnlyTheSelectedUnpublishedDraft()
    {
        var root = NewTempRoot();
        var paths = new AppDataPaths(root);
        using var database = new SqliteDatabase(paths);
        var initializer = CreateFullMigrationRunner(database);
        var repository = new SqliteModelDraftRepository(database);
        var contentRepository = new SqliteModelDraftContentRepository(database);
        var viewModel = new FabricadorViewModel(repository, initializer,
            contentRepository: contentRepository,
            modelSlotRepository: new SqliteModelSlotRepository(database));
        var window = OpenEditor(viewModel);

        try
        {
            await viewModel.ModelSlotsTask;
            var slotButtons = window.GetVisualDescendants().OfType<Button>()
                .Where(button => button.DataContext is ModelSlotListItem)
                .OrderBy(button => ((ModelSlotListItem)button.DataContext!).Number)
                .ToArray();
            Assert.Equal(ModelSlot.Maximum, slotButtons.Length);
            Assert.Equal(Enumerable.Range(1, ModelSlot.Maximum), slotButtons.Select(button => ((ModelSlotListItem)button.DataContext!).Number));

            slotButtons[1].RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
            Assert.Equal(2, viewModel.SelectedModelSlot);
            await viewModel.SelectModelSlotCommand.ExecuteAsync(1);
            viewModel.ModelName = "Modelo no slot 01";
            await viewModel.SaveCommand.ExecuteAsync(null);
            var firstSlot = Assert.Single(viewModel.ModelSlots, slot => slot.Number == 1);
            Assert.True(firstSlot.IsOccupied);
            Assert.Equal("Modelo no slot 01", firstSlot.Name);
            var firstModel = await repository.GetAsync(firstSlot.Id!.Value);
            Assert.True(firstModel.IsSuccess);

            await viewModel.SelectModelSlotCommand.ExecuteAsync(2);
            Assert.Equal(string.Empty, viewModel.ModelName);
            viewModel.ModelName = "Modelo no slot 02";
            await viewModel.SaveCommand.ExecuteAsync(null);
            Assert.True(Assert.Single(viewModel.ModelSlots, slot => slot.Number == 2).IsOccupied);

            await viewModel.SelectModelSlotCommand.ExecuteAsync(1);
            Assert.Equal("Modelo no slot 01", viewModel.ModelName);
            Assert.True(viewModel.CanDeleteSelectedModelSlot);
            await viewModel.DeleteSelectedModelSlotCommand.ExecuteAsync(null);
            Assert.False(Assert.Single(viewModel.ModelSlots, slot => slot.Number == 1).IsOccupied);
            Assert.Equal("Modelo no slot 02", (await repository.ListAsync()).Value.Single().Name);
            Assert.Contains("excluído", viewModel.ModelSlotsStatus, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            window.Close();
            viewModel.Dispose();
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task SplitAndMergeCommandsPersistAssetsAndRigAcrossSqliteReopen()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = NewTempRoot();
        var paths = new AppDataPaths(root);
        var modelId = ModelId.New();
        var originalPartId = ModelPartId.New();
        var followingPartId = ModelPartId.New();
        var sourceAssetId = AssetId.New();
        var joint = new RigJoint(RigJointId.New(), TransformNodeId.From(originalPartId.Value),
            TransformNodeId.From(followingPartId.Value), Point2D.Zero, Point2D.Zero, RigJointMode.Fixed);
        try
        {
            using (var database = new SqliteDatabase(paths))
            {
                var initializer = CreateFullMigrationRunner(database);
                await initializer.InitializeAsync(cancellationToken);
                var assetStore = CreateAssetStore(paths, database, initializer);
                var imported = await assetStore.ImportAsync(new MemoryStream(CreateStripPng(), writable: false),
                    "image/png", cancellationToken);
                Assert.True(imported.IsSuccess, imported.Error?.Message);
                sourceAssetId = imported.Value.Id;
                var drafts = new SqliteModelDraftRepository(database);
                var draft = ModelDraft.Create(modelId, "Split e merge persistente", 100);
                Assert.True((await drafts.CreateInSlotAsync(draft, ModelSlot.From(1), cancellationToken)).IsSuccess);
                var crop = new Rect2D(1, 0, 4, 2);
                var transform = new Transform2D(new Point2D(20, 30), new Point2D(1, 1), 0, Point2D.Zero);
                var original = new ModelPart(originalPartId, "Peça", imported.Value.Id, crop, transform,
                    new ModelPartSourceTransform(crop, transform));
                var followingCrop = new Rect2D(0, 0, 1, 1);
                var following = new ModelPart(followingPartId, "Peça ligada", imported.Value.Id, followingCrop,
                    Transform2D.Identity, new ModelPartSourceTransform(followingCrop, Transform2D.Identity));
                var content = ModelDraftContent.Restore(ModelDraftContent.CurrentSchemaVersion, modelId,
                    Revision.Initial, ModelSlot.From(1), imported.Value.Id, 6, 2,
                    [original, following], [originalPartId, followingPartId], [joint]);
                var contentRepository = new SqliteModelDraftContentRepository(database);
                var initialSave = await contentRepository.SaveAsync(content, expectedRevision: null, cancellationToken);
                Assert.True(initialSave.IsSuccess, initialSave.Error?.Message);

                var viewModel = new FabricadorViewModel(drafts, initializer, assetStore: assetStore,
                    contentRepository: contentRepository,
                    modelPartSplitService: new ModelPartSplitService(assetStore, new AssetImageDecoder()),
                    modelPartMergeService: new ModelPartMergeService(assetStore, new AssetImageDecoder()),
                    modelSlotRepository: new SqliteModelSlotRepository(database),
                    autosaveDelay: TimeSpan.FromHours(1));
                try
                {
                    await viewModel.ModelSlotsTask;
                    await viewModel.SelectModelSlotCommand.ExecuteAsync(1);
                    viewModel.SelectedModelPartId = originalPartId;
                    Assert.True(viewModel.CanSplitSelectedPart);
                    await viewModel.SplitSelectedPartCommand.ExecuteAsync(null);
                    Assert.Equal(3, viewModel.PartLayers.Count);
                    Assert.True(await viewModel.FlushPendingChangesAsync(cancellationToken));
                    var split = await contentRepository.GetAsync(modelId, cancellationToken);
                    Assert.True(split.IsSuccess, split.Error?.Message);
                    Assert.Equal(Revision.From(2), split.Value.Revision);
                    Assert.Equal(new[] { originalPartId, followingPartId },
                        new[] { split.Value.LayerOrder[0], split.Value.LayerOrder[2] });
                    var splitRightId = split.Value.LayerOrder[1];
                    Assert.NotEqual(originalPartId, splitRightId);
                    Assert.NotEqual(followingPartId, splitRightId);
                    Assert.Equal(splitRightId, viewModel.PartLayers.Single(item => item.Id != originalPartId
                        && item.Id != followingPartId).Id);
                    Assert.Equal(joint, Assert.Single(split.Value.RigJoints));
                }
                finally { viewModel.Dispose(); }
            }

            using (var reopenedDatabase = new SqliteDatabase(paths))
            {
                var initializer = CreateFullMigrationRunner(reopenedDatabase);
                await initializer.InitializeAsync(cancellationToken);
                var reopenedRepository = new SqliteModelDraftContentRepository(reopenedDatabase);
                var splitState = await reopenedRepository.GetAsync(modelId, cancellationToken);
                Assert.True(splitState.IsSuccess, splitState.Error?.Message);
                Assert.Equal(Revision.From(2), splitState.Value.Revision);
                Assert.Equal(new[] { originalPartId, followingPartId },
                    new[] { splitState.Value.LayerOrder[0], splitState.Value.LayerOrder[2] });
                Assert.Equal(joint, Assert.Single(splitState.Value.RigJoints));
                var reopenedStore = CreateAssetStore(paths, reopenedDatabase, initializer);
                Assert.Equal(AssetVerificationState.Available,
                    (await reopenedStore.GetMetadataAsync(splitState.Value.Parts.Single(part => part.Id != originalPartId
                        && part.Id != followingPartId).AssetId, cancellationToken)).Value.VerificationState);
                var drafts = new SqliteModelDraftRepository(reopenedDatabase);
                var viewModel = new FabricadorViewModel(drafts, initializer, assetStore: reopenedStore,
                    contentRepository: reopenedRepository,
                    modelPartSplitService: new ModelPartSplitService(reopenedStore, new AssetImageDecoder()),
                    modelPartMergeService: new ModelPartMergeService(reopenedStore, new AssetImageDecoder()),
                    modelSlotRepository: new SqliteModelSlotRepository(reopenedDatabase),
                    autosaveDelay: TimeSpan.FromHours(1));
                try
                {
                    await viewModel.ModelSlotsTask;
                    await viewModel.SelectModelSlotCommand.ExecuteAsync(1);
                    Assert.Equal(3, viewModel.PartLayers.Count);
                    viewModel.SelectedModelPartId = originalPartId;
                    Assert.True(viewModel.CanMergeSelectedPart);
                    await viewModel.MergeSelectedPartCommand.ExecuteAsync(null);
                    Assert.Equal(2, viewModel.PartLayers.Count);
                    Assert.True(await viewModel.FlushPendingChangesAsync(cancellationToken));
                    var merged = await reopenedRepository.GetAsync(modelId, cancellationToken);
                    Assert.True(merged.IsSuccess, merged.Error?.Message);
                    Assert.Equal(Revision.From(3), merged.Value.Revision);
                    Assert.Equal(2, merged.Value.Parts.Length);
                    var mergedPart = merged.Value.Parts.Single(part => part.Id == originalPartId);
                    Assert.Equal(new[] { originalPartId, followingPartId }, merged.Value.LayerOrder);
                    Assert.Equal(joint, Assert.Single(merged.Value.RigJoints));
                    Assert.Equal(sourceAssetId, merged.Value.SourceAssetId);
                    Assert.Equal(AssetVerificationState.Available,
                        (await reopenedStore.GetMetadataAsync(mergedPart.AssetId, cancellationToken)).Value.VerificationState);
                }
                finally { viewModel.Dispose(); }
            }

            using (var finalDatabase = new SqliteDatabase(paths))
            {
                var initializer = CreateFullMigrationRunner(finalDatabase);
                await initializer.InitializeAsync(cancellationToken);
                var finalRepository = new SqliteModelDraftContentRepository(finalDatabase);
                var reopened = await finalRepository.GetAsync(modelId, cancellationToken);
                Assert.True(reopened.IsSuccess, reopened.Error?.Message);
                Assert.Equal(Revision.From(3), reopened.Value.Revision);
                Assert.Equal(new[] { originalPartId, followingPartId }, reopened.Value.LayerOrder);
                Assert.Equal(joint, Assert.Single(reopened.Value.RigJoints));
                var persistedPart = reopened.Value.Parts.Single(part => part.Id == originalPartId);
                Assert.Equal(originalPartId, persistedPart.Id);
                Assert.Equal(new Rect2D(0, 0, 4, 2), persistedPart.SourceCrop);
                var finalStore = CreateAssetStore(paths, finalDatabase, initializer);
                var bytes = await ReadPixelsAsync(finalStore, persistedPart.AssetId, cancellationToken);
                using var bitmap = SKBitmap.Decode(bytes)!;
                Assert.Equal((4, 2), (bitmap.Width, bitmap.Height));
                Assert.Equal(SKColors.Red, bitmap.GetPixel(0, 0));
                Assert.Equal(SKColors.Green, bitmap.GetPixel(1, 0));
                Assert.Equal(SKColors.Blue, bitmap.GetPixel(2, 0));
                Assert.Equal(0, bitmap.GetPixel(3, 0).Alpha);
                Assert.Equal(3L, await ScalarAsync(finalDatabase,
                    "SELECT COUNT(*) FROM asset_references WHERE owner_type='fabricator.model-draft' AND owner_id=$id;",
                    cancellationToken, ("$id", modelId.ToString())));
            }
        }
        finally { DeleteTempRoot(root); }
    }

    [AvaloniaFact]
    public async Task FabricadorCheckpointRecovery_AssignsNewDraftToNextFreeModelSlot()
    {
        var root = NewTempRoot();
        var paths = new AppDataPaths(root);
        using var database = new SqliteDatabase(paths);
        var initializer = CreateFullMigrationRunner(database);
        await initializer.InitializeAsync(TestContext.Current.CancellationToken);
        var repository = new SqliteModelDraftRepository(database);
        var slotRepository = new SqliteModelSlotRepository(database);
        var firstSlotDraft = ModelDraft.Create("Slot ocupado", 100);
        Assert.True((await repository.CreateInSlotAsync(firstSlotDraft, ModelSlot.From(1)).ConfigureAwait(false)).IsSuccess);

        var checkpointStore = new SqliteModelDraftCheckpointStore(database);
        var recoveredId = ModelId.New();
        await checkpointStore.WriteAsync(ModelDraftCheckpoint.Create(recoveredId, null, "Modelo recuperado", 200));
        var viewModel = new FabricadorViewModel(
            repository,
            initializer,
            checkpointStore: checkpointStore,
            contentRepository: new SqliteModelDraftContentRepository(database),
            modelSlotRepository: slotRepository);

        try
        {
            await Task.WhenAll(viewModel.RecoveryTask, viewModel.ModelSlotsTask);
            Assert.True(viewModel.HasPendingRecovery);
            await viewModel.RestoreCheckpointCommand.ExecuteAsync(null);

            var recoveredDraft = await repository.GetAsync(recoveredId);
            Assert.True(recoveredDraft.IsSuccess, recoveredDraft.Error?.Message);
            Assert.Equal("Modelo recuperado", recoveredDraft.Value.Name);
            Assert.Equal(2, viewModel.SelectedModelSlot);
            var slots = await slotRepository.ListAsync();
            Assert.True(slots.IsSuccess);
            Assert.Equal(firstSlotDraft.Id, Assert.Single(slots.Value, slot => slot.Slot == ModelSlot.From(1)).ModelId);
            Assert.Equal(recoveredId, Assert.Single(slots.Value, slot => slot.Slot == ModelSlot.From(2)).ModelId);
            Assert.False(viewModel.HasPendingRecovery);
        }
        finally
        {
            viewModel.Dispose();
            DeleteTempRoot(root);
        }
    }

    [AvaloniaFact]
    public async Task FabricadorView_TogglesHairWorkspacePanelWithoutLosingModelWorkspace()
    {
        var root = NewTempRoot();
        using var database = new SqliteDatabase(new AppDataPaths(root));
        var viewModel = new FabricadorViewModel(new SqliteModelDraftRepository(database),
            new BlockingInitializer(CreateMigrationRunner(database)));
        var window = OpenEditor(viewModel);

        try
        {
            var panel = window.GetVisualDescendants().OfType<HairWorkspacePanel>().Single();
            Assert.False(viewModel.IsHairWorkspace);
            Assert.False(panel.IsVisible);

            await viewModel.ToggleHairWorkspaceCommand.ExecuteAsync(null);
            Assert.True(viewModel.IsHairWorkspace);
            Assert.True(panel.IsVisible);
            Assert.Same(viewModel.HairWorkspace, panel.DataContext);

            await viewModel.ToggleHairWorkspaceCommand.ExecuteAsync(null);
            Assert.False(viewModel.IsHairWorkspace);
            Assert.False(panel.IsVisible);
        }
        finally
        {
            window.Close();
            viewModel.Dispose();
            DeleteTempRoot(root);
        }
    }

    [AvaloniaFact]
    public async Task FaceWorkspacePanel_LoadsTheEyebrowReviewAndConfirmationControls()
    {
        var viewModel = new FaceWorkspaceViewModel(filePicker: null, importService: null);
        var panel = new FaceWorkspacePanel { DataContext = viewModel };
        var window = new Window { Width = 480, Height = 520, Content = panel };
        window.Show();

        try
        {
            var buttons = window.GetVisualDescendants().OfType<Button>().ToArray();
            var select = Assert.Single(buttons, button => button.Content?.ToString() == "Selecionar arquivo da folha");
            var confirm = Assert.Single(buttons, button => button.Content?.ToString() == "Salvar par no catálogo facial");
            var publish = Assert.Single(buttons, button => button.Content?.ToString() == "Publicar catálogo facial");
            Assert.Contains(buttons, button => button.Content?.ToString() == "＋ Importar");
            Assert.Contains(buttons, button => button.Content?.ToString() == "Salvar extra");
            Assert.Contains(buttons, button => button.Content?.ToString() == "Restaurar encaixe inicial");
            Assert.Contains(buttons, button => button.Content?.ToString() == "Adicionar à montagem facial");
            Assert.Contains(buttons, button => button.Content?.ToString() == "Remover da biblioteca");
            Assert.Contains(buttons, button => button.Content?.ToString() == "＋ Importar detalhe");
            Assert.Contains(buttons, button => button.Content?.ToString() == "Salvar detalhe");
            var selectors = window.GetVisualDescendants().OfType<ComboBox>().ToArray();
            Assert.Equal(7, selectors.Length);
            Assert.False(select.IsEnabled);
            Assert.False(confirm.IsVisible);
            Assert.False(publish.IsEnabled);
            Assert.Contains(selectors, selector => ReferenceEquals(selector.ItemsSource, viewModel.SheetKinds));
            Assert.Contains(selectors, selector => ReferenceEquals(selector.ItemsSource, viewModel.NoseSheetModes));
            Assert.Contains(selectors, selector => ReferenceEquals(selector.ItemsSource, viewModel.ComponentChoices));
            Assert.Contains(selectors, selector => ReferenceEquals(selector.ItemsSource, viewModel.HeadExtraChoices));
            Assert.Contains(selectors, selector => ReferenceEquals(selector.ItemsSource, viewModel.FaceDetailKinds));
            Assert.Contains(selectors, selector => ReferenceEquals(selector.ItemsSource, viewModel.FaceDetailChoices));
            Assert.Contains(window.GetVisualDescendants().OfType<TextBlock>(),
                text => text.Text == "Olhos e rosto");
        }
        finally
        {
            window.Close();
            await viewModel.DisposeAsync();
        }
    }

    [AvaloniaFact]
    public async Task FabricadorView_ShowsDirtySavingSavedAndErrorAfterRealFileAccessFailure()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = NewTempRoot();
        using var database = new SqliteDatabase(new AppDataPaths(root));
        var initializer = new BlockingInitializer(CreateMigrationRunner(database));
        var viewModel = new FabricadorViewModel(new SqliteModelDraftRepository(database), initializer);
        var window = OpenEditor(viewModel);

        try
        {
            var nameInput = window.GetVisualDescendants().OfType<TextBox>().Single(text => text.Name == "ModelNameInput");
            var stateLabel = window.GetVisualDescendants().OfType<TextBlock>().Single(text => text.Name == "SaveStateText");
            var errorLabel = window.GetVisualDescendants().OfType<TextBlock>().Single(text => text.Name == "SaveErrorText");

            nameInput.Text = "Modelo headless";
            Assert.Equal(PersistenceState.Dirty, viewModel.SaveState);
            Assert.Equal("Alterações não salvas", stateLabel.Text);

            var saveTask = viewModel.SaveCommand.ExecuteAsync(null);
            await initializer.Started.Task.WaitAsync(cancellationToken);
            Assert.Equal(PersistenceState.Saving, viewModel.SaveState);
            Assert.Equal("Salvando…", stateLabel.Text);

            initializer.Release();
            await saveTask;
            Assert.Equal(PersistenceState.Saved, viewModel.SaveState);
            Assert.Equal("Salvo", stateLabel.Text);
            Assert.False(errorLabel.IsVisible);

            nameInput.Text = "Modelo alterado";
            Assert.Equal(PersistenceState.Dirty, viewModel.SaveState);
            Assert.Equal("Alterações não salvas", stateLabel.Text);
        }
        finally
        {
            window.Close();
            DeleteTempRoot(root);
        }
    }

    [AvaloniaFact]
    public async Task FabricadorView_ShowsErrorAndKeepsFailureVisibleWhenDataRootCannotBeCreated()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var parent = NewTempRoot();
        Directory.CreateDirectory(parent);
        var blocker = Path.Combine(parent, "file-not-directory");
        await File.WriteAllTextAsync(blocker, "synthetic blocker", cancellationToken);
        var dataRoot = Path.Combine(blocker, "G-V5");
        using var database = new SqliteDatabase(new AppDataPaths(dataRoot));
        var viewModel = new FabricadorViewModel(
            new SqliteModelDraftRepository(database),
            CreateMigrationRunner(database));
        var window = OpenEditor(viewModel);

        try
        {
            viewModel.ModelName = "Modelo sem permissão";
            await viewModel.SaveCommand.ExecuteAsync(null);

            var stateLabel = window.GetVisualDescendants().OfType<TextBlock>().Single(text => text.Name == "SaveStateText");
            var errorLabel = window.GetVisualDescendants().OfType<TextBlock>().Single(text => text.Name == "SaveErrorText");
            Assert.Equal(PersistenceState.Error, viewModel.SaveState);
            Assert.Equal("Erro ao salvar", stateLabel.Text);
            Assert.True(errorLabel.IsVisible);
            Assert.Contains("Não foi possível gravar", errorLabel.Text);
            Assert.True(File.Exists(blocker));
        }
        finally
        {
            window.Close();
            DeleteTempRoot(parent);
        }
    }

    private static Window OpenEditor(FabricadorViewModel viewModel)
    {
        var window = new Window
        {
            Width = 850,
            Height = 480,
            Content = new FabricadorView { DataContext = viewModel }
        };
        window.Show();
        return window;
    }

    private static SqliteMigrationRunner CreateMigrationRunner(SqliteDatabase database) =>
        new(database, [new InitialAssetSchemaMigration(), new ModelDraftSchemaMigration()]);

    private static SqliteMigrationRunner CreateFullMigrationRunner(SqliteDatabase database) => new(database,
    [
        new InitialAssetSchemaMigration(), new ModelDraftSchemaMigration(), new ModelDraftCheckpointSchemaMigration(),
        new AssetImportJournalSchemaMigration(), new AssetReferenceSchemaMigration(), new AssetGarbageCollectionSchemaMigration(),
        new ModelDraftContentSchemaMigration(), new ModelRevisionSchemaMigration(), new ModelRigJointSchemaMigration(),
        new PoseRepositorySchemaMigration(), new AnimationRepositorySchemaMigration(), new WardrobeRepositorySchemaMigration(),
        new HairStyleRepositorySchemaMigration(), new FaceCatalogRepositorySchemaMigration(), new FaceExpressionRepositorySchemaMigration(),
        new FacePublicationSchemaMigration(), new AnimationSlotsSchemaMigration(), new ModelSlotSchemaMigration(),
        new HeadExtraLibrarySchemaMigration(), new FaceDetailLibrarySchemaMigration()
    ]);

    private static SqliteAssetStore CreateAssetStore(AppDataPaths paths, SqliteDatabase database,
        IDataPlatformInitializer initializer)
    {
        var correlation = new OperationCorrelationContext();
        var pipeline = new SqliteAssetImportPipeline(paths, database, initializer,
            new StructuredFileLogger(paths, correlation), correlation);
        return new SqliteAssetStore(pipeline, database, initializer);
    }

    private static byte[] CreateStripPng()
    {
        using var bitmap = new SKBitmap(new SKImageInfo(6, 2, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        for (var y = 0; y < bitmap.Height; y++)
        {
            bitmap.SetPixel(0, y, SKColors.Yellow);
            bitmap.SetPixel(1, y, SKColors.Red);
            bitmap.SetPixel(2, y, SKColors.Green);
            bitmap.SetPixel(3, y, SKColors.Blue);
            bitmap.SetPixel(4, y, new SKColor(255, 255, 255, 0));
            bitmap.SetPixel(5, y, SKColors.Magenta);
        }
        using var image = SKImage.FromBitmap(bitmap);
        using var encoded = image.Encode(SKEncodedImageFormat.Png, 100);
        return encoded!.ToArray();
    }

    private static async Task<byte[]> ReadPixelsAsync(IAssetStore assetStore, AssetId assetId,
        CancellationToken cancellationToken)
    {
        var opened = await assetStore.OpenReadAsync(assetId, cancellationToken);
        Assert.True(opened.IsSuccess, opened.Error?.Message);
        await using var stream = opened.Value;
        using var buffer = new MemoryStream();
        await stream.CopyToAsync(buffer, cancellationToken);
        return buffer.ToArray();
    }

    private static async Task<long> ScalarAsync(SqliteDatabase database, string sql,
        CancellationToken cancellationToken, params (string Name, object Value)[] parameters)
    {
        await using var connection = await database.OpenReadConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value);
        return Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken));
    }

    private static string NewTempRoot() => Path.Combine(Path.GetTempPath(), $"gv5-fabricador-state-{Guid.NewGuid():N}");

    private static void DeleteTempRoot(string root)
    {
        if (Directory.Exists(root))
        {
            Directory.Delete(root, recursive: true);
        }
    }

    private sealed class BlockingInitializer(IDataPlatformInitializer inner) : IDataPlatformInitializer
    {
        private readonly TaskCompletionSource _release = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Started { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public async Task InitializeAsync(CancellationToken cancellationToken = default)
        {
            Started.TrySetResult();
            await _release.Task.WaitAsync(cancellationToken);
            await inner.InitializeAsync(cancellationToken);
        }

        public void Release() => _release.TrySetResult();
    }
}
