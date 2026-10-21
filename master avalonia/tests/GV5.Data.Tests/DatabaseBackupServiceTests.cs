using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Assets;
using GV5.Data.Migrations;
using GV5.Data.Diagnostics;
using GV5.Data.Repositories;
using GV5.Data.Storage;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
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

            var service = CreateService(paths, database, initializer);
            var backup = await service.CreateAsync(cancellationToken);
            Assert.True(File.Exists(backup.DatabasePath));
            Assert.True(File.Exists(backup.ManifestPath));
            Assert.Equal(new FileInfo(backup.DatabasePath).Length, backup.SizeBytes);
            Assert.Matches("^[0-9a-f]{64}$", backup.Sha256);
            Assert.Equal(6, backup.SchemaVersion);

            var verification = await service.VerifyAsync(backup.DirectoryPath, cancellationToken);
            Assert.True(verification.IsValid, verification.Error);
            Assert.Equal(backup.Sha256, verification.Artifact!.Sha256);

            var restored = await service.RestoreToNewRootAsync(backup.DirectoryPath, restoreRoot, cancellationToken);
            Assert.Equal(Path.Combine(restoreRoot, "database", AppDataPaths.DatabaseFileName), restored.DatabasePath);
            Assert.Equal(6, restored.SchemaVersion);
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
            var service = CreateService(paths, database, initializer);
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

    [Fact]
    public async Task VerificationRejectsCorruptSqliteEvenWhenManifestHashMatchesFixture()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = NewTempRoot("corrupt-source");
        var paths = new AppDataPaths(root);
        using var database = new SqliteDatabase(paths);

        try
        {
            var initializer = CreateInitializer(database);
            await initializer.InitializeAsync(cancellationToken);
            var service = CreateService(paths, database, initializer);
            var backup = await service.CreateAsync(cancellationToken);

            // A matching manifest hash ensures verification reaches SQLite's own corruption check.
            var corruptBytes = Enumerable.Repeat((byte)0xCC, 4096).ToArray();
            await File.WriteAllBytesAsync(backup.DatabasePath, corruptBytes, cancellationToken);
            var manifest = JsonNode.Parse(await File.ReadAllTextAsync(backup.ManifestPath, cancellationToken))!.AsObject();
            var databaseEntry = manifest["files"]![0]!.AsObject();
            databaseEntry["sizeBytes"] = corruptBytes.Length;
            databaseEntry["sha256"] = Convert.ToHexString(SHA256.HashData(corruptBytes)).ToLowerInvariant();
            await File.WriteAllTextAsync(backup.ManifestPath, manifest.ToJsonString(), cancellationToken);

            var verification = await service.VerifyAsync(backup.DirectoryPath, cancellationToken);
            Assert.False(verification.IsValid);
            Assert.Null(verification.Artifact);
            Assert.DoesNotContain("SHA-256", verification.Error, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task BackupAndRestore_IncludeAndVerifyReferencedAssetBytes()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = NewTempRoot("asset-source");
        var restoreRoot = NewTempRoot("asset-restore");
        var paths = new AppDataPaths(root);
        using var database = new SqliteDatabase(paths);
        try
        {
            var initializer = CreateInitializer(database);
            await initializer.InitializeAsync(cancellationToken);
            var content = "synthetic asset payload"u8.ToArray();
            var sha256 = Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();
            var relativePath = $"sha256/{sha256[..2]}/{sha256}";
            var sourcePath = Path.Combine(paths.AssetsDirectory, relativePath.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(sourcePath)!);
            await File.WriteAllBytesAsync(sourcePath, content, cancellationToken);
            var assetId = AssetId.New();
            await database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = "INSERT INTO assets(asset_id, sha256, relative_path, mime_type, byte_length, verification_state, created_utc_ms) VALUES ($id, $hash, $path, 'application/octet-stream', $length, 'available', 1);";
                command.Parameters.AddWithValue("$id", assetId.ToString());
                command.Parameters.AddWithValue("$hash", sha256);
                command.Parameters.AddWithValue("$path", relativePath);
                command.Parameters.AddWithValue("$length", content.Length);
                await command.ExecuteNonQueryAsync(token);
                return true;
            }, cancellationToken);

            var service = CreateService(paths, database, initializer);
            var backup = await service.CreateAsync(cancellationToken);
            var backupAssetPath = Path.Combine(backup.DirectoryPath, "assets", relativePath.Replace('/', Path.DirectorySeparatorChar));
            Assert.Equal(content, await File.ReadAllBytesAsync(backupAssetPath, cancellationToken));
            var verification = await service.VerifyAsync(backup.DirectoryPath, cancellationToken);
            Assert.True(verification.IsValid, verification.Error);

            await service.RestoreToNewRootAsync(backup.DirectoryPath, restoreRoot, cancellationToken);
            var restoredAssetPath = Path.Combine(restoreRoot, "assets", relativePath.Replace('/', Path.DirectorySeparatorChar));
            Assert.Equal(content, await File.ReadAllBytesAsync(restoredAssetPath, cancellationToken));

            await File.WriteAllTextAsync(backupAssetPath, "tampered", cancellationToken);
            var rejected = await service.VerifyAsync(backup.DirectoryPath, cancellationToken);
            Assert.False(rejected.IsValid);
            Assert.Contains("size", rejected.Error, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            DeleteTempRoot(root);
            DeleteTempRoot(restoreRoot);
        }
    }

    [Fact]
    public async Task AssetGarbageCollector_RequiresGraceAndVerifiedBackupThenRetainsRecoverableTrash()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = NewTempRoot("gc-source");
        var paths = new AppDataPaths(root);
        using var database = new SqliteDatabase(paths);
        try
        {
            var initializer = CreateInitializer(database);
            await initializer.InitializeAsync(cancellationToken);
            var content = "garbage collection fixture"u8.ToArray();
            var sha256 = Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant();
            var relativePath = $"sha256/{sha256[..2]}/{sha256}";
            var assetPath = Path.Combine(paths.AssetsDirectory, relativePath.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(assetPath)!);
            await File.WriteAllBytesAsync(assetPath, content, cancellationToken);
            var assetId = AssetId.New();
            await database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = "INSERT INTO assets(asset_id, sha256, relative_path, mime_type, byte_length, verification_state, created_utc_ms) VALUES ($id, $hash, $path, 'application/octet-stream', $length, 'available', 1);";
                command.Parameters.AddWithValue("$id", assetId.ToString());
                command.Parameters.AddWithValue("$hash", sha256);
                command.Parameters.AddWithValue("$path", relativePath);
                command.Parameters.AddWithValue("$length", content.Length);
                await command.ExecuteNonQueryAsync(token);
                return true;
            }, cancellationToken);

            var service = CreateService(paths, database, initializer);
            var clock = new AdjustableTimeProvider(DateTimeOffset.Parse("2026-10-21T12:00:00Z"));
            var collector = new SqliteAssetGarbageCollector(paths, database, initializer, service, clock);
            var policy = AssetGarbageCollectionPolicy.Create(TimeSpan.FromHours(1), TimeSpan.FromDays(30));

            var tracked = await collector.CollectAsync(policy, cancellationToken);
            Assert.True(tracked.IsSuccess, tracked.Error?.Message);
            Assert.Equal(1, tracked.Value.CandidatesTracked);
            Assert.Equal(0, tracked.Value.AssetsMovedToTrash);
            Assert.True(File.Exists(assetPath));

            await database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                await using var age = connection.CreateCommand();
                age.Transaction = transaction;
                age.CommandText = "UPDATE asset_gc_candidates SET unreferenced_since_utc_ms = $old WHERE asset_id = $asset;";
                age.Parameters.AddWithValue("$old", clock.GetUtcNow().AddHours(-2).ToUnixTimeMilliseconds());
                age.Parameters.AddWithValue("$asset", assetId.ToString());
                await age.ExecuteNonQueryAsync(token);
                return true;
            }, cancellationToken);

            await File.WriteAllTextAsync(assetPath, "tampered asset", cancellationToken);
            var rejected = await collector.CollectAsync(policy, cancellationToken);
            Assert.True(rejected.IsFailure);
            Assert.Equal(1L, await ScalarAsync(database, "SELECT COUNT(*) FROM assets WHERE asset_id = $asset;", cancellationToken, ("$asset", assetId.ToString())));
            Assert.Equal(0L, await ScalarAsync(database, "SELECT COUNT(*) FROM asset_gc_operations WHERE asset_id = $asset;", cancellationToken, ("$asset", assetId.ToString())));
            Assert.True(File.Exists(assetPath));
            await File.WriteAllBytesAsync(assetPath, content, cancellationToken);

            var trashPath = Path.Combine(paths.AssetsDirectory, "trash", $"{assetId}-{sha256}.bin");
            Directory.CreateDirectory(Path.GetDirectoryName(trashPath)!);
            File.Move(assetPath, trashPath);

            var collected = await collector.CollectAsync(policy, cancellationToken);
            Assert.True(collected.IsSuccess, collected.Error?.Message);
            Assert.Equal(1, collected.Value.AssetsMovedToTrash);
            Assert.NotNull(collected.Value.VerifiedBackupDirectory);
            Assert.False(File.Exists(assetPath));
            Assert.Equal(0L, await ScalarAsync(database, "SELECT COUNT(*) FROM assets WHERE asset_id = $asset;", cancellationToken, ("$asset", assetId.ToString())));
            Assert.Equal(1L, await ScalarAsync(database, "SELECT COUNT(*) FROM asset_gc_operations WHERE asset_id = $asset AND purged_utc_ms IS NULL;", cancellationToken, ("$asset", assetId.ToString())));

            Assert.Equal(content, await File.ReadAllBytesAsync(trashPath, cancellationToken));
            var backupVerification = await service.VerifyAsync(collected.Value.VerifiedBackupDirectory!, cancellationToken);
            Assert.True(backupVerification.IsValid, backupVerification.Error);

            clock.Advance(TimeSpan.FromDays(31));
            var purged = await collector.CollectAsync(policy, cancellationToken);
            Assert.True(purged.IsSuccess, purged.Error?.Message);
            Assert.Equal(1, purged.Value.TrashFilesPurged);
            Assert.False(File.Exists(trashPath));
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    private static SqliteMigrationRunner CreateInitializer(SqliteDatabase database) => new(
        database,
        [new InitialAssetSchemaMigration(), new ModelDraftSchemaMigration(), new ModelDraftCheckpointSchemaMigration(), new AssetImportJournalSchemaMigration(), new AssetReferenceSchemaMigration(), new AssetGarbageCollectionSchemaMigration()]);

    private static DatabaseBackupService CreateService(AppDataPaths paths, SqliteDatabase database, SqliteMigrationRunner initializer)
    {
        var correlation = new OperationCorrelationContext();
        return new DatabaseBackupService(paths, database, initializer, new StructuredFileLogger(paths, correlation), correlation);
    }

    private static string NewTempRoot(string suffix) => Path.Combine(Path.GetTempPath(), $"gv5-backup-{suffix}-{Guid.NewGuid():N}");

    private static async Task<object?> ScalarAsync(
        SqliteDatabase database,
        string sql,
        CancellationToken cancellationToken,
        params (string Name, object Value)[] parameters) =>
        await database.ExecuteWriteAsync(async (connection, transaction, token) =>
        {
            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = sql;
            foreach (var (name, value) in parameters)
            {
                command.Parameters.AddWithValue(name, value);
            }

            return await command.ExecuteScalarAsync(token);
        }, cancellationToken);

    private static void DeleteTempRoot(string root)
    {
        if (Directory.Exists(root))
        {
            Directory.Delete(root, recursive: true);
        }
    }

    private sealed class AdjustableTimeProvider(DateTimeOffset utcNow) : TimeProvider
    {
        private DateTimeOffset _utcNow = utcNow;

        public override DateTimeOffset GetUtcNow() => _utcNow;

        public void Advance(TimeSpan duration) => _utcNow += duration;
    }
}
