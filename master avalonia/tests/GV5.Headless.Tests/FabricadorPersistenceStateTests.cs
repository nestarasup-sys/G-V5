using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.VisualTree;
using Avalonia.Interactivity;
using GV5.Application.Contracts;
using GV5.Data.Migrations;
using GV5.Data.Repositories;
using GV5.Data.Storage;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Modules.Fabricador.ViewModels;
using GV5.Modules.Fabricador.Views;
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
        new FacePublicationSchemaMigration(), new AnimationSlotsSchemaMigration(), new ModelSlotSchemaMigration()
    ]);

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
