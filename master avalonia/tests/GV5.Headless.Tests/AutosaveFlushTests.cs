using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using GV5.App.Navigation;
using GV5.App.ViewModels;
using GV5.App.Views;
using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Migrations;
using GV5.Data.Repositories;
using GV5.Data.Storage;
using GV5.Modules.Customizador;
using GV5.Modules.Customizador.ViewModels;
using GV5.Modules.Fabricador;
using GV5.Modules.Fabricador.ViewModels;
using GV5.Modules.Fabricador.Views;
using Xunit;

namespace GV5.Headless.Tests;

public sealed class AutosaveFlushTests
{
    [AvaloniaFact]
    public async Task Rapid_Edits_Autosave_Once_After_Debounce_And_Confirm_Sqlite_Write()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        using var fixture = new TestDatabaseFixture();
        var repository = new RecordingRepository(fixture.CreateRepository());
        var initializer = new BlockingInitializer(fixture.CreateMigrationRunner());
        var viewModel = new FabricadorViewModel(repository, initializer);
        var window = OpenEditor(viewModel);

        try
        {
            viewModel.ModelName = "Rascunho temporário";
            await Task.Delay(TimeSpan.FromMilliseconds(300), cancellationToken);
            Assert.False(initializer.Started.Task.IsCompleted);

            viewModel.ModelName = "Modelo final";
            await initializer.Started.Task.WaitAsync(TimeSpan.FromSeconds(3), cancellationToken);
            Assert.Equal(PersistenceState.Saving, viewModel.SaveState);
            Assert.Equal(0, repository.CreateCount);

            initializer.Release();
            Assert.True(await viewModel.FlushPendingChangesAsync(cancellationToken));
            Assert.Equal(PersistenceState.Saved, viewModel.SaveState);
            Assert.Equal(1, repository.CreateCount);
            Assert.Equal(0, repository.UpdateCount);
            Assert.NotNull(repository.LastSavedDraft);
            Assert.Equal("Modelo final", repository.LastSavedDraft!.Name);

            var persisted = await fixture.CreateRepository().GetAsync(repository.LastSavedDraft.Id, cancellationToken);
            Assert.True(persisted.IsSuccess);
            Assert.Equal("Modelo final", persisted.Value.Name);
        }
        finally
        {
            initializer.Release();
            window.Close();
        }
    }

    [AvaloniaFact]
    public async Task Navigation_Flushes_Autosave_Before_Replacing_Current_Page()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        using var fixture = new TestDatabaseFixture();
        var repository = new RecordingRepository(fixture.CreateRepository());
        var fabricator = new FabricadorViewModel(repository, fixture.CreateMigrationRunner());
        var viewModel = MakeMainViewModel(fabricator);
        var window = OpenShell(viewModel);

        try
        {
            fabricator.ModelName = "Salvo antes de navegar";
            await viewModel.NavigateCommand.ExecuteAsync("customizador");

            Assert.Equal("customizador", viewModel.ActiveRoute.Id);
            Assert.IsType<CustomizadorViewModel>(viewModel.CurrentPage);
            Assert.Null(viewModel.NavigationError);
            Assert.Equal(1, repository.CreateCount);
            var persisted = await fixture.CreateRepository().GetAsync(repository.LastSavedDraft!.Id, cancellationToken);
            Assert.True(persisted.IsSuccess);
            Assert.Equal("Salvo antes de navegar", persisted.Value.Name);
        }
        finally
        {
            window.Close();
        }
    }

    [AvaloniaFact]
    public async Task Stale_Autosave_Cannot_Replace_A_Newer_Revision_And_Blocks_Navigation_And_Close()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        using var fixture = new TestDatabaseFixture();
        var repository = new RecordingRepository(fixture.CreateRepository());
        var fabricator = new FabricadorViewModel(repository, fixture.CreateMigrationRunner());
        var viewModel = MakeMainViewModel(fabricator);
        var window = OpenShell(viewModel);

        try
        {
            fabricator.ModelName = "Versão carregada";
            Assert.True(await fabricator.FlushPendingChangesAsync(cancellationToken));
            var staleDraft = repository.LastSavedDraft!;

            var externalDraft = staleDraft.Rename(
                "Versão mais recente",
                Math.Max(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), staleDraft.UpdatedUtcMs));
            var externalSave = await fixture.CreateRepository().UpdateAsync(
                externalDraft,
                staleDraft.Revision,
                cancellationToken);
            Assert.True(externalSave.IsSuccess);

            fabricator.ModelName = "Alteração baseada em versão antiga";
            await WaitUntilAsync(() => fabricator.SaveState == PersistenceState.Error, cancellationToken);
            Assert.Contains("changed since it was loaded", fabricator.SaveError, StringComparison.OrdinalIgnoreCase);

            await viewModel.NavigateCommand.ExecuteAsync("customizador");
            Assert.Equal("fabricador", viewModel.ActiveRoute.Id);
            Assert.IsType<FabricadorViewModel>(viewModel.CurrentPage);
            Assert.Contains("área atual foi mantida", viewModel.NavigationError, StringComparison.OrdinalIgnoreCase);

            var persisted = await fixture.CreateRepository().GetAsync(staleDraft.Id, cancellationToken);
            Assert.True(persisted.IsSuccess);
            Assert.Equal("Versão mais recente", persisted.Value.Name);
            Assert.Equal(Revision.From(2), persisted.Value.Revision);

            window.Close();
            await WaitUntilAsync(
                () => viewModel.NavigationError?.Contains("janela permanece aberta", StringComparison.OrdinalIgnoreCase) == true,
                cancellationToken);
            Assert.True(window.IsVisible);

            persisted = await fixture.CreateRepository().GetAsync(staleDraft.Id, cancellationToken);
            Assert.True(persisted.IsSuccess);
            Assert.Equal("Versão mais recente", persisted.Value.Name);
            Assert.Equal(Revision.From(2), persisted.Value.Revision);
        }
        finally
        {
            window.Close();
        }
    }

    [AvaloniaFact]
    public async Task Close_Flushes_Pending_Draft_And_Close_Remains_Cancelled_When_Save_Fails()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = NewTempRoot();
        Directory.CreateDirectory(root);
        var blocker = Path.Combine(root, "not-a-directory");
        await File.WriteAllTextAsync(blocker, "synthetic path blocker", cancellationToken);
        var database = new SqliteDatabase(new AppDataPaths(Path.Combine(blocker, "G-V5")));
        var repository = new RecordingRepository(new SqliteModelDraftRepository(database));
        var failingFabricator = new FabricadorViewModel(repository, new SqliteMigrationRunner(
            database,
            [new InitialAssetSchemaMigration(), new ModelDraftSchemaMigration()]));
        var failingViewModel = MakeMainViewModel(failingFabricator);
        var failingWindow = OpenShell(failingViewModel);

        try
        {
            failingFabricator.ModelName = "Precisa permanecer aberto";
            failingWindow.Close();
            await WaitUntilAsync(() => failingViewModel.HasNavigationError, cancellationToken);
            Assert.True(failingWindow.IsVisible);
            Assert.Equal("fabricador", failingViewModel.ActiveRoute.Id);
            Assert.True(failingViewModel.HasNavigationError);
            Assert.Contains("janela permanece aberta", failingViewModel.NavigationError, StringComparison.OrdinalIgnoreCase);
            Assert.Equal(PersistenceState.Error, failingFabricator.SaveState);
            Assert.True(File.Exists(blocker));
        }
        finally
        {
            failingWindow.Close();
            database.Dispose();
            DeleteTempRoot(root);
        }

        using var closeFixture = new TestDatabaseFixture();
        var closeRepository = new RecordingRepository(closeFixture.CreateRepository());
        var closeFabricator = new FabricadorViewModel(closeRepository, closeFixture.CreateMigrationRunner());
        var closeViewModel = MakeMainViewModel(closeFabricator);
        var closeWindow = OpenShell(closeViewModel);
        try
        {
            closeFabricator.ModelName = "Salvo no fechamento";
            closeWindow.Close();
            await WaitUntilAsync(() => !closeWindow.IsVisible, cancellationToken);
            Assert.False(closeWindow.IsVisible);
            Assert.Equal(PersistenceState.Saved, closeFabricator.SaveState);
            Assert.Equal(1, closeRepository.CreateCount);
        }
        finally
        {
            closeWindow.Close();
        }
    }

    private static MainViewModel MakeMainViewModel(FabricadorViewModel fabricator)
    {
        var catalog = new ModuleRouteCatalog(new[] { FabricadorModule.Route, CustomizadorModule.Route });
        return new MainViewModel(catalog, new FakePageFactory(fabricator));
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

    private static MainWindow OpenShell(MainViewModel viewModel)
    {
        var window = new MainWindow { Width = 1100, Height = 700, DataContext = viewModel };
        window.Show();
        return window;
    }

    private static string NewTempRoot() => Path.Combine(Path.GetTempPath(), $"gv5-autosave-{Guid.NewGuid():N}");

    private static async Task WaitUntilAsync(Func<bool> condition, CancellationToken cancellationToken)
    {
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(5);
        while (!condition())
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (DateTime.UtcNow >= deadline)
            {
                throw new TimeoutException("The expected headless UI state was not reached within five seconds.");
            }

            await Task.Delay(10, cancellationToken);
        }
    }

    private static void DeleteTempRoot(string root)
    {
        if (Directory.Exists(root))
        {
            Directory.Delete(root, recursive: true);
        }
    }

    private sealed class FakePageFactory(FabricadorViewModel fabricator) : IModulePageFactory
    {
        public IModulePageViewModel Create(ModuleRoute route) => route.Id switch
        {
            "fabricador" => fabricator,
            "customizador" => new CustomizadorViewModel(),
            _ => throw new InvalidOperationException($"Unexpected route: {route.Id}")
        };
    }

    private sealed class RecordingRepository(IModelDraftRepository inner) : IModelDraftRepository
    {
        public int CreateCount { get; private set; }
        public int UpdateCount { get; private set; }
        public ModelDraft? LastSavedDraft { get; private set; }

        public async Task<Result<ModelDraft>> CreateAsync(ModelDraft draft, CancellationToken cancellationToken = default)
        {
            CreateCount++;
            var result = await inner.CreateAsync(draft, cancellationToken);
            if (result.IsSuccess)
            {
                LastSavedDraft = result.Value;
            }

            return result;
        }

        public Task<Result<ModelDraft>> GetAsync(ModelId id, CancellationToken cancellationToken = default) =>
            inner.GetAsync(id, cancellationToken);

        public async Task<Result<ModelDraft>> UpdateAsync(ModelDraft draft, Revision expectedRevision, CancellationToken cancellationToken = default)
        {
            UpdateCount++;
            var result = await inner.UpdateAsync(draft, expectedRevision, cancellationToken);
            if (result.IsSuccess)
            {
                LastSavedDraft = result.Value;
            }

            return result;
        }
    }

    private sealed class TestDatabaseFixture : IDisposable
    {
        private readonly string _root = NewTempRoot();
        private readonly SqliteDatabase _database;

        public TestDatabaseFixture() => _database = new SqliteDatabase(new AppDataPaths(_root));

        public SqliteModelDraftRepository CreateRepository() => new(_database);

        public SqliteMigrationRunner CreateMigrationRunner() => new(
            _database,
            [new InitialAssetSchemaMigration(), new ModelDraftSchemaMigration()]);

        public void Dispose()
        {
            _database.Dispose();
            DeleteTempRoot(_root);
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
