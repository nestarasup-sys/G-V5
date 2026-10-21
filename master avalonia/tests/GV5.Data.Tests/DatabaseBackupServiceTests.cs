using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Migrations;
using GV5.Data.Repositories;
using GV5.Data.Storage;
using Xunit;

namespace GV5.Data.Tests;

public sealed class DatabaseBackupServiceTests
{
    [Fact]
    public async Task OnlineBackup_CapturesCommittedWalState_AndRestoresVerifiedDataToIsolatedRoot()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = NewTempRoot("source");
        var restoreRoot = NewTempRoot("restore");
        var paths = new AppDataPaths(root);
        using var database = new SqliteDatabase(paths);
        try
        {
            var initializer = CreateInitializer(database);
            await initializer.InitializeAsync(cancellationToken);
            var repository = new SqliteModelDraftRepository(database);
            var original = ModelDraft.Create("Modelo inicial", 100);
            Assert.True((await repository.CreateAsync(original, cancellationToken)).IsSuccess);
            var latest = original.Rename("Última gravação WAL", 200);

            await using var heldReader = await database.OpenReadConnectionAsync(cancellationToken);
            await using var heldTransaction = heldReader.BeginTransaction(deferred: true);
            await using (var readSnapshot = heldReader.CreateCommand())
            {
                readSnapshot.Transaction = heldTransaction;
                readSnapshot.CommandText = "SELECT COUNT(*) FROM models;";
                Assert.Equal(1L, (long)(await readSnapshot.ExecuteScalarAsync(cancellationToken))!);
            }

            Assert.True((await repository.UpdateAsync(latest, original.Revision, cancellationToken)).IsSuccess);
            var recoveryCheckpoint = ModelDraftCheckpoint.Create(original.Id, latest.Revision, "Checkpoint WAL pendente", 250);
            var checkpointStore = new SqliteModelDraftCheckpointStore(database);
            await checkpointStore.WriteAsync(recoveryCheckpoint, cancellationToken);
            var walPath = paths.DatabaseFile + "-wal";
            Assert.True(File.Exists(walPath));
            Assert.True(new FileInfo(walPath).Length > 0);

            var service = new DatabaseBackupService(paths, database, initializer);
            var backup = await service.CreateAsync(cancellationToken);
            Assert.True(File.Exists(backup.DatabasePath));
            Assert.True(File.Exists(backup.ManifestPath));
            Assert.Equal(new FileInfo(backup.DatabasePath).Length, backup.SizeBytes);
            Assert.Matches("^[0-9a-f]{64}$", backup.Sha256);
            Assert.Equal(3, backup.SchemaVersion);

            var verification = await service.VerifyAsync(backup.DirectoryPath, cancellationToken);
            Assert.True(verification.IsValid, verification.Error);
            Assert.Equal(backup.Sha256, verification.Artifact!.Sha256);

            var restored = await service.RestoreToNewRootAsync(backup.DirectoryPath, restoreRoot, cancellationToken);
            Assert.Equal(Path.Combine(restoreRoot, "database", AppDataPaths.DatabaseFileName), restored.DatabasePath);
            Assert.Equal(3, restored.SchemaVersion);
            using var restoredDatabase = new SqliteDatabase(new AppDataPaths(restoreRoot));
            var restoredInitializer = CreateInitializer(restoredDatabase);
            await restoredInitializer.InitializeAsync(cancellationToken);
            var restoredDraft = await new SqliteModelDraftRepository(restoredDatabase).GetAsync(original.Id, cancellationToken);
            Assert.True(restoredDraft.IsSuccess);
            Assert.Equal("Última gravação WAL", restoredDraft.Value.Name);
            Assert.Equal(Revision.From(2), restoredDraft.Value.Revision);
            var restoredCheckpoints = await new SqliteModelDraftCheckpointStore(restoredDatabase).GetPendingAsync(cancellationToken);
            Assert.Equal(recoveryCheckpoint, Assert.Single(restoredCheckpoints));
        }
        finally
        {
            DeleteTempRoot(root);
            DeleteTempRoot(restoreRoot);
        }
    }

    [Fact]
    public async Task VerificationRejectsTamperedBackup_AndRestoreNeverOverwritesExistingDatabase()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = NewTempRoot("source");
        var restoreRoot = NewTempRoot("restore");
        var paths = new AppDataPaths(root);
        using var database = new SqliteDatabase(paths);
        try
        {
            var initializer = CreateInitializer(database);
            await initializer.InitializeAsync(cancellationToken);
            var service = new DatabaseBackupService(paths, database, initializer);
            var backup = await service.CreateAsync(cancellationToken);

            Directory.CreateDirectory(Path.Combine(restoreRoot, "database"));
            var existingDatabasePath = Path.Combine(restoreRoot, "database", AppDataPaths.DatabaseFileName);
            await File.WriteAllTextAsync(existingDatabasePath, "keep existing file", cancellationToken);
            await Assert.ThrowsAsync<IOException>(() => service.RestoreToNewRootAsync(backup.DirectoryPath, restoreRoot, cancellationToken));
            Assert.Equal("keep existing file", await File.ReadAllTextAsync(existingDatabasePath, cancellationToken));

            await using (var tamper = new FileStream(backup.DatabasePath, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            {
                tamper.Position = Math.Max(0, tamper.Length / 2);
                var byteValue = tamper.ReadByte();
                tamper.Position--;
                tamper.WriteByte((byte)(byteValue ^ 0xFF));
                tamper.Flush(flushToDisk: true);
            }

            var verification = await service.VerifyAsync(backup.DirectoryPath, cancellationToken);
            Assert.False(verification.IsValid);
            Assert.Contains("SHA-256", verification.Error, StringComparison.OrdinalIgnoreCase);
            var rejectedRoot = NewTempRoot("rejected");
            await Assert.ThrowsAsync<InvalidDataException>(() => service.RestoreToNewRootAsync(backup.DirectoryPath, rejectedRoot, cancellationToken));
            Assert.False(File.Exists(Path.Combine(rejectedRoot, "database", AppDataPaths.DatabaseFileName)));
            DeleteTempRoot(rejectedRoot);
        }
        finally
        {
            DeleteTempRoot(root);
            DeleteTempRoot(restoreRoot);
        }
    }

    private static SqliteMigrationRunner CreateInitializer(SqliteDatabase database) => new(
        database,
        [new InitialAssetSchemaMigration(), new ModelDraftSchemaMigration(), new ModelDraftCheckpointSchemaMigration()]);

    private static string NewTempRoot(string suffix) => Path.Combine(Path.GetTempPath(), $"gv5-backup-{suffix}-{Guid.NewGuid():N}");

    private static void DeleteTempRoot(string root)
    {
        if (Directory.Exists(root))
        {
            Directory.Delete(root, recursive: true);
        }
    }
}
