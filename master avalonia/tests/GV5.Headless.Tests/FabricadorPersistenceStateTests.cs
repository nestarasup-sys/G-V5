using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.VisualTree;
using GV5.Application.Contracts;
using GV5.Data.Migrations;
using GV5.Data.Repositories;
using GV5.Data.Storage;
using GV5.Modules.Fabricador.ViewModels;
using GV5.Modules.Fabricador.Views;
using Xunit;

namespace GV5.Headless.Tests;

public sealed class FabricadorPersistenceStateTests
{
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
            var nameInput = window.GetVisualDescendants().OfType<TextBox>().Single();
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
