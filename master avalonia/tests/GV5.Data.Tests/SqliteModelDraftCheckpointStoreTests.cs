using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Migrations;
using GV5.Data.Repositories;
using GV5.Data.Storage;
using Xunit;

namespace GV5.Data.Tests;

public sealed class SqliteModelDraftCheckpointStoreTests
{
    [Fact]
    public async Task PendingCheckpoint_SurvivesReopen_AndIsRemovedOnlyWhenCompleted()
    {
        var root = Path.Combine(Path.GetTempPath(), $"gv5-checkpoint-{Guid.NewGuid():N}");
        var paths = new AppDataPaths(root);
        var cancellationToken = TestContext.Current.CancellationToken;
        var modelId = ModelId.New();
        var checkpoint = ModelDraftCheckpoint.Create(modelId, expectedRevision: null, "Modelo antes do primeiro commit", 1234);

        try
        {
            using (var database = new SqliteDatabase(paths))
            {
                await MigrateAsync(database, cancellationToken);
                var store = new SqliteModelDraftCheckpointStore(database);
                await store.WriteAsync(checkpoint, cancellationToken);
                var pending = await store.GetPendingAsync(cancellationToken);
                var loaded = Assert.Single(pending);
                Assert.Equal(checkpoint, loaded);
            }

            using (var reopened = new SqliteDatabase(paths))
            {
                await MigrateAsync(reopened, cancellationToken);
                var store = new SqliteModelDraftCheckpointStore(reopened);
                var pending = await store.GetPendingAsync(cancellationToken);
                Assert.Equal(checkpoint, Assert.Single(pending));

                await store.CompleteAsync(checkpoint.CheckpointId, cancellationToken);
                Assert.Empty(await store.GetPendingAsync(cancellationToken));
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

    [Fact]
    public async Task Journal_AllowsCheckpointBeforeDraftExists_AndKeepsSeparateOperations()
    {
        var root = Path.Combine(Path.GetTempPath(), $"gv5-checkpoint-{Guid.NewGuid():N}");
        using var database = new SqliteDatabase(new AppDataPaths(root));
        var cancellationToken = TestContext.Current.CancellationToken;

        try
        {
            await MigrateAsync(database, cancellationToken);
            var store = new SqliteModelDraftCheckpointStore(database);
            var first = ModelDraftCheckpoint.Create(ModelId.New(), null, "Checkpoint um", 1);
            var second = ModelDraftCheckpoint.Create(first.ModelId, null, "Checkpoint dois", 2);
            await store.WriteAsync(first, cancellationToken);
            var newerFirst = ModelDraftCheckpoint.Create(first.CheckpointId, first.ModelId, null, "Checkpoint um atualizado", 3);
            await store.WriteAsync(newerFirst, cancellationToken);
            await store.WriteAsync(second, cancellationToken);

            var pending = await store.GetPendingAsync(cancellationToken);
            Assert.Equal(new[] { second, newerFirst }, pending);

            await store.CompleteAsync(first.CheckpointId, cancellationToken);
            Assert.Equal(second, Assert.Single(await store.GetPendingAsync(cancellationToken)));
        }
        finally
        {
            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }

    private static Task<MigrationRunResult> MigrateAsync(SqliteDatabase database, CancellationToken cancellationToken) =>
        new SqliteMigrationRunner(database,
            [new InitialAssetSchemaMigration(), new ModelDraftSchemaMigration(), new ModelDraftCheckpointSchemaMigration()])
            .MigrateAsync(cancellationToken);
}
