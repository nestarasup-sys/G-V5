using Avalonia.Controls;
using Avalonia.Headless.XUnit;
using Avalonia.VisualTree;
using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Migrations;
using GV5.Data.Repositories;
using GV5.Data.Storage;
using GV5.Modules.Fabricador.ViewModels;
using GV5.Modules.Fabricador.Views;
using Xunit;

namespace GV5.Headless.Tests;

public sealed class CheckpointRecoveryTests
{
    [AvaloniaFact]
    public async Task Startup_OffersInterruptedNewDraft_AndRestoreReplaysItToSqlite()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = NewTempRoot();
        using var database = new SqliteDatabase(new AppDataPaths(root));
        try
        {
            var initializer = CreateInitializer(database);
            await initializer.InitializeAsync(cancellationToken);
            var store = new SqliteModelDraftCheckpointStore(database);
            var checkpoint = ModelDraftCheckpoint.Create(ModelId.New(), null, "Rascunho recuperado", 1234);
            await store.WriteAsync(checkpoint, cancellationToken);

            var viewModel = new FabricadorViewModel(
                new SqliteModelDraftRepository(database),
                initializer,
                store);
            await viewModel.RecoveryTask.WaitAsync(cancellationToken);
            var window = OpenEditor(viewModel);
            try
            {
                Assert.True(viewModel.HasPendingRecovery);
                Assert.False(viewModel.CanEdit);
                Assert.Equal(checkpoint.Name, viewModel.PendingRecoveryCheckpoint!.Name);
                Assert.Contains(window.GetVisualDescendants().OfType<TextBlock>(), text => text.Text == "Rascunho recuperável encontrado");

                await viewModel.RestoreCheckpointCommand.ExecuteAsync(null);

                Assert.False(viewModel.HasPendingRecovery);
                Assert.Equal("Rascunho recuperado", viewModel.ModelName);
                Assert.Equal(PersistenceState.Saved, viewModel.SaveState);
                Assert.Empty(await store.GetPendingAsync(cancellationToken));
                var persisted = await new SqliteModelDraftRepository(database).GetAsync(checkpoint.ModelId, cancellationToken);
                Assert.True(persisted.IsSuccess);
                Assert.Equal(checkpoint.Name, persisted.Value.Name);
            }
            finally
            {
                window.Close();
            }
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [AvaloniaFact]
    public async Task Interrupted_Save_Leaves_WriteAheadCheckpoint_That_A_New_ViewModel_Can_Recover()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = NewTempRoot();
        using var database = new SqliteDatabase(new AppDataPaths(root));
        try
        {
            var initializer = CreateInitializer(database);
            await initializer.InitializeAsync(cancellationToken);
            var store = new SqliteModelDraftCheckpointStore(database);
            var interruptedEditor = new FabricadorViewModel(new FailingCreateRepository(), initializer, store);
            await interruptedEditor.RecoveryTask.WaitAsync(cancellationToken);
            interruptedEditor.ModelName = "Sobrevive à interrupção";
            await interruptedEditor.SaveCommand.ExecuteAsync(null);

            Assert.Equal(PersistenceState.Error, interruptedEditor.SaveState);
            var interrupted = Assert.Single(await store.GetPendingAsync(cancellationToken));
            Assert.Equal("Sobrevive à interrupção", interrupted.Name);
            Assert.Null(interrupted.ExpectedRevision);

            interruptedEditor.ModelName = "Versão mais recente após retry";
            await interruptedEditor.SaveCommand.ExecuteAsync(null);
            var latestCheckpoint = Assert.Single(await store.GetPendingAsync(cancellationToken));
            Assert.Equal(interrupted.CheckpointId, latestCheckpoint.CheckpointId);
            Assert.Equal("Versão mais recente após retry", latestCheckpoint.Name);

            var reopenedEditor = new FabricadorViewModel(
                new SqliteModelDraftRepository(database),
                initializer,
                store);
            await reopenedEditor.RecoveryTask.WaitAsync(cancellationToken);
            Assert.Equal(latestCheckpoint, reopenedEditor.PendingRecoveryCheckpoint);

            await reopenedEditor.RestoreCheckpointCommand.ExecuteAsync(null);

            Assert.Equal(PersistenceState.Saved, reopenedEditor.SaveState);
            Assert.False(reopenedEditor.HasPendingRecovery);
            var restored = await new SqliteModelDraftRepository(database).GetAsync(interrupted.ModelId, cancellationToken);
            Assert.True(restored.IsSuccess);
            Assert.Equal("Versão mais recente após retry", restored.Value.Name);
            Assert.Empty(await store.GetPendingAsync(cancellationToken));
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [AvaloniaFact]
    public async Task Successful_Save_Commits_Model_And_Cleans_Only_Its_Checkpoint()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = NewTempRoot();
        using var database = new SqliteDatabase(new AppDataPaths(root));
        try
        {
            var initializer = CreateInitializer(database);
            var store = new SqliteModelDraftCheckpointStore(database);
            var drafts = new SqliteModelDraftRepository(database);
            var viewModel = new FabricadorViewModel(drafts, initializer, store);
            await viewModel.RecoveryTask.WaitAsync(cancellationToken);

            viewModel.ModelName = "Commit e journal sincronizados";
            await viewModel.SaveCommand.ExecuteAsync(null);

            Assert.Equal(PersistenceState.Saved, viewModel.SaveState);
            Assert.Empty(await store.GetPendingAsync(cancellationToken));
            var pending = ModelDraftCheckpoint.Create(ModelId.New(), null, "Operação independente", 999);
            await store.WriteAsync(pending, cancellationToken);
            Assert.Equal(pending, Assert.Single(await store.GetPendingAsync(cancellationToken)));
            await using var connection = await database.OpenReadConnectionAsync(cancellationToken);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT display_name FROM models;";
            Assert.Equal("Commit e journal sincronizados", await command.ExecuteScalarAsync(cancellationToken));
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [AvaloniaFact]
    public async Task Recovery_RefusesStaleCheckpointAndAllowsDiscardWithoutDeletingLatestDraft()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = NewTempRoot();
        using var database = new SqliteDatabase(new AppDataPaths(root));
        try
        {
            var initializer = CreateInitializer(database);
            await initializer.InitializeAsync(cancellationToken);
            var drafts = new SqliteModelDraftRepository(database);
            var store = new SqliteModelDraftCheckpointStore(database);
            var saved = ModelDraft.Create("Versão confirmada", 100);
            Assert.True((await drafts.CreateAsync(saved, cancellationToken)).IsSuccess);
            var checkpoint = ModelDraftCheckpoint.Create(saved.Id, saved.Revision, "Checkpoint antigo", 200);
            await store.WriteAsync(checkpoint, cancellationToken);

            var latest = saved.Rename("Versão mais nova", 300);
            Assert.True((await drafts.UpdateAsync(latest, saved.Revision, cancellationToken)).IsSuccess);

            var viewModel = new FabricadorViewModel(drafts, initializer, store);
            await viewModel.RecoveryTask.WaitAsync(cancellationToken);
            var window = OpenEditor(viewModel);
            try
            {
                await viewModel.RestoreCheckpointCommand.ExecuteAsync(null);

                Assert.True(viewModel.HasPendingRecovery);
                Assert.Equal(PersistenceState.Error, viewModel.SaveState);
                Assert.Contains("revisão mais nova", viewModel.RecoveryMessage, StringComparison.OrdinalIgnoreCase);
                var stillLatest = await drafts.GetAsync(saved.Id, cancellationToken);
                Assert.True(stillLatest.IsSuccess);
                Assert.Equal("Versão mais nova", stillLatest.Value.Name);
                Assert.Equal(Revision.From(2), stillLatest.Value.Revision);
                Assert.Equal(checkpoint, Assert.Single(await store.GetPendingAsync(cancellationToken)));

                await viewModel.DiscardCheckpointCommand.ExecuteAsync(null);

                Assert.False(viewModel.HasPendingRecovery);
                Assert.Empty(await store.GetPendingAsync(cancellationToken));
                stillLatest = await drafts.GetAsync(saved.Id, cancellationToken);
                Assert.True(stillLatest.IsSuccess);
                Assert.Equal("Versão mais nova", stillLatest.Value.Name);
                Assert.Equal(Revision.From(2), stillLatest.Value.Revision);
            }
            finally
            {
                window.Close();
            }
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [AvaloniaFact]
    public async Task Recovery_DetectsAlreadyCommittedCheckpoint_WithoutCreatingAnotherRevision()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = NewTempRoot();
        using var database = new SqliteDatabase(new AppDataPaths(root));
        try
        {
            var initializer = CreateInitializer(database);
            await initializer.InitializeAsync(cancellationToken);
            var drafts = new SqliteModelDraftRepository(database);
            var store = new SqliteModelDraftCheckpointStore(database);
            var id = ModelId.New();
            var checkpoint = ModelDraftCheckpoint.Create(id, null, "Commit confirmado antes do crash", 456);
            var alreadyCommitted = ModelDraft.Create(id, checkpoint.Name, checkpoint.CreatedUtcMs);
            Assert.True((await drafts.CreateAsync(alreadyCommitted, cancellationToken)).IsSuccess);
            await store.WriteAsync(checkpoint, cancellationToken);

            var viewModel = new FabricadorViewModel(drafts, initializer, store);
            await viewModel.RecoveryTask.WaitAsync(cancellationToken);
            await viewModel.RestoreCheckpointCommand.ExecuteAsync(null);

            Assert.False(viewModel.HasPendingRecovery);
            Assert.Equal(PersistenceState.Saved, viewModel.SaveState);
            var persisted = await drafts.GetAsync(id, cancellationToken);
            Assert.True(persisted.IsSuccess);
            Assert.Equal(Revision.Initial, persisted.Value.Revision);
            Assert.Empty(await store.GetPendingAsync(cancellationToken));
        }
        finally
        {
            DeleteTempRoot(root);
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

    private static SqliteMigrationRunner CreateInitializer(SqliteDatabase database) => new(
        database,
        [new InitialAssetSchemaMigration(), new ModelDraftSchemaMigration(), new ModelDraftCheckpointSchemaMigration()]);

    private static string NewTempRoot() => Path.Combine(Path.GetTempPath(), $"gv5-recovery-{Guid.NewGuid():N}");

    private static void DeleteTempRoot(string root)
    {
        if (Directory.Exists(root))
        {
            Directory.Delete(root, recursive: true);
        }
    }

    private sealed class FailingCreateRepository : IModelDraftRepository
    {
        public Task<Result<ModelDraft>> CreateAsync(ModelDraft draft, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<ModelDraft>.Failure(new ApplicationError(
                ApplicationErrorCode.Persistence,
                "Synthetic interruption after checkpoint creation.")));

        public Task<Result<ModelDraft>> GetAsync(ModelId id, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<ModelDraft>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Not found.")));

        public Task<Result<IReadOnlyList<ModelDraft>>> ListAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<IReadOnlyList<ModelDraft>>.Success([]));

        public Task<Result<ModelDraft>> DuplicateAsync(ModelId sourceId, string name, long nowUtcMs, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<ModelDraft>.Failure(new ApplicationError(ApplicationErrorCode.Persistence, "Synthetic failure.")));

        public Task<Result<ModelDraft>> UpdateAsync(ModelDraft draft, Revision expectedRevision, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<ModelDraft>.Failure(new ApplicationError(
                ApplicationErrorCode.Persistence,
                "Synthetic interruption during update.")));
    }
}
