using System.Buffers.Binary;
using System.Security.Cryptography;
using GV5.Application.Contracts;
using GV5.Assets.Import;
using GV5.Core.Identity;
using GV5.Data.Assets;
using GV5.Data.Diagnostics;
using GV5.Data.Migrations;
using GV5.Data.Storage;
using Microsoft.Data.Sqlite;
using Xunit;

namespace GV5.Data.Tests;

public sealed class SqliteAssetImportPipelineTests
{
    [Fact]
    public async Task ImportAsync_PublishesByHashAndReopensMetadataAndBytes()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = NewTempRoot("publish");
        var paths = new AppDataPaths(root);
        var bytes = CreatePng(32, 24);
        var sha256 = Hash(bytes);

        try
        {
            AssetMetadata imported;
            using (var database = new SqliteDatabase(paths))
            {
                var initializer = CreateInitializer(database);
                var pipeline = CreatePipeline(paths, database, initializer);
                var result = await pipeline.ImportAsync(new MemoryStream(bytes), "image/png", cancellationToken);
                Assert.True(result.IsSuccess, result.Error?.Message);
                imported = result.Value;
                Assert.Equal(sha256, imported.Sha256);
                Assert.Equal(bytes.Length, imported.ByteLength);
                Assert.Equal(AssetVerificationState.Available, imported.VerificationState);

                var relativePath = $"sha256/{sha256[..2]}/{sha256}";
                var publishedPath = Path.Combine(paths.AssetsDirectory, relativePath.Replace('/', Path.DirectorySeparatorChar));
                Assert.Equal(bytes, await File.ReadAllBytesAsync(publishedPath, cancellationToken));
                Assert.Empty(Directory.GetFiles(Path.Combine(paths.TempDirectory, "asset-operations")));
                Assert.Empty(Directory.GetFiles(Path.Combine(paths.TempDirectory, "asset-imports")));
                Assert.Equal(0L, await ScalarAsync(database, "SELECT COUNT(*) FROM asset_import_journal;", cancellationToken));
            }

            using var reopenedDatabase = new SqliteDatabase(paths);
            var reopenedPipeline = CreatePipeline(paths, reopenedDatabase, CreateInitializer(reopenedDatabase));
            var metadata = await reopenedPipeline.GetMetadataAsync(imported.Id, cancellationToken);
            Assert.True(metadata.IsSuccess, metadata.Error?.Message);
            Assert.Equal(imported, metadata.Value);
            var opened = await reopenedPipeline.OpenReadAsync(imported.Id, cancellationToken);
            Assert.True(opened.IsSuccess, opened.Error?.Message);
            await using var assetStream = opened.Value;
            using var copy = new MemoryStream();
            await assetStream.CopyToAsync(copy, cancellationToken);
            Assert.Equal(bytes, copy.ToArray());
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task Recovery_WhenOnlyOperationStageExists_PublishesAndCommitsIt()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = NewTempRoot("recover-stage");
        var paths = new AppDataPaths(root);
        var bytes = CreatePng(40, 20);
        var pending = NewPending(bytes);

        try
        {
            using var database = new SqliteDatabase(paths);
            var initializer = CreateInitializer(database);
            await initializer.InitializeAsync(cancellationToken);
            var stagedPath = WriteOperationStage(paths, pending, bytes);
            await InsertPendingAsync(database, pending, cancellationToken);

            var pipeline = CreatePipeline(paths, database, initializer);
            await pipeline.RecoverPendingImportsAsync(cancellationToken);

            var metadata = await pipeline.GetMetadataAsync(pending.AssetId, cancellationToken);
            Assert.True(metadata.IsSuccess, metadata.Error?.Message);
            Assert.Equal(pending.Sha256, metadata.Value.Sha256);
            Assert.False(File.Exists(stagedPath));
            Assert.True(File.Exists(GetPublishedPath(paths, pending.Sha256)));
            Assert.Equal(0L, await ScalarAsync(database, "SELECT COUNT(*) FROM asset_import_journal;", cancellationToken));
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task Recovery_WhenFileWasPublishedBeforeMetadataCommit_RepairsSqliteRow()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = NewTempRoot("recover-published");
        var paths = new AppDataPaths(root);
        var bytes = CreatePng(48, 36);
        var pending = NewPending(bytes);

        try
        {
            using var database = new SqliteDatabase(paths);
            var initializer = CreateInitializer(database);
            await initializer.InitializeAsync(cancellationToken);
            var publishedPath = GetPublishedPath(paths, pending.Sha256);
            Directory.CreateDirectory(Path.GetDirectoryName(publishedPath)!);
            await File.WriteAllBytesAsync(publishedPath, bytes, cancellationToken);
            await InsertPendingAsync(database, pending, cancellationToken);

            var pipeline = CreatePipeline(paths, database, initializer);
            var metadata = await pipeline.GetMetadataAsync(pending.AssetId, cancellationToken);

            Assert.True(metadata.IsSuccess, metadata.Error?.Message);
            Assert.Equal(pending.AssetId, metadata.Value.Id);
            Assert.Equal(0L, await ScalarAsync(database, "SELECT COUNT(*) FROM asset_import_journal;", cancellationToken));
            Assert.Equal(1L, await ScalarAsync(database, "SELECT COUNT(*) FROM assets WHERE sha256 = $hash;", cancellationToken, ("$hash", pending.Sha256)));
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task Recovery_WhenPublishedFileHashDiffers_PreservesFileAndJournalForRepair()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = NewTempRoot("recover-mismatch");
        var paths = new AppDataPaths(root);
        var bytes = CreatePng(64, 64);
        var pending = NewPending(bytes);
        var wrongBytes = CreatePng(63, 64);

        try
        {
            using var database = new SqliteDatabase(paths);
            var initializer = CreateInitializer(database);
            await initializer.InitializeAsync(cancellationToken);
            var publishedPath = GetPublishedPath(paths, pending.Sha256);
            Directory.CreateDirectory(Path.GetDirectoryName(publishedPath)!);
            await File.WriteAllBytesAsync(publishedPath, wrongBytes, cancellationToken);
            await InsertPendingAsync(database, pending, cancellationToken);
            var pipeline = CreatePipeline(paths, database, initializer);

            await Assert.ThrowsAsync<InvalidDataException>(() => pipeline.RecoverPendingImportsAsync(cancellationToken));

            Assert.Equal(wrongBytes, await File.ReadAllBytesAsync(publishedPath, cancellationToken));
            Assert.Equal(1L, await ScalarAsync(database, "SELECT COUNT(*) FROM asset_import_journal;", cancellationToken));
            Assert.Equal(0L, await ScalarAsync(database, "SELECT COUNT(*) FROM assets WHERE sha256 = $hash;", cancellationToken, ("$hash", pending.Sha256)));
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task GetMetadata_WhenDatabaseRowHasNoFile_MarksAssetMissing()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = NewTempRoot("missing-file");
        var paths = new AppDataPaths(root);
        var bytes = CreatePng(20, 20);
        var pending = NewPending(bytes);

        try
        {
            using var database = new SqliteDatabase(paths);
            var initializer = CreateInitializer(database);
            await initializer.InitializeAsync(cancellationToken);
            await database.ExecuteWriteAsync(async (connection, transaction, operationToken) =>
            {
                await using var insert = connection.CreateCommand();
                insert.Transaction = transaction;
                insert.CommandText = "INSERT INTO assets(asset_id, sha256, relative_path, mime_type, byte_length, verification_state, created_utc_ms) VALUES ($id, $hash, $path, $mime, $length, 'available', $created);";
                insert.Parameters.AddWithValue("$id", pending.AssetId.ToString());
                insert.Parameters.AddWithValue("$hash", pending.Sha256);
                insert.Parameters.AddWithValue("$path", pending.RelativePath);
                insert.Parameters.AddWithValue("$mime", pending.MediaType);
                insert.Parameters.AddWithValue("$length", pending.ByteLength);
                insert.Parameters.AddWithValue("$created", pending.CreatedUtcMs);
                await insert.ExecuteNonQueryAsync(operationToken);
                return true;
            }, cancellationToken);

            var pipeline = CreatePipeline(paths, database, initializer);
            var metadata = await pipeline.GetMetadataAsync(pending.AssetId, cancellationToken);
            Assert.True(metadata.IsSuccess, metadata.Error?.Message);
            Assert.Equal(AssetVerificationState.Missing, metadata.Value.VerificationState);
            Assert.Equal("missing", await ScalarAsync(database, "SELECT verification_state FROM assets WHERE asset_id = $id;", cancellationToken, ("$id", pending.AssetId.ToString())) as string);

            var restoredFile = GetPublishedPath(paths, pending.Sha256);
            Directory.CreateDirectory(Path.GetDirectoryName(restoredFile)!);
            await File.WriteAllBytesAsync(restoredFile, bytes, cancellationToken);
            var recoveredMetadata = await pipeline.GetMetadataAsync(pending.AssetId, cancellationToken);
            Assert.True(recoveredMetadata.IsSuccess, recoveredMetadata.Error?.Message);
            Assert.Equal(AssetVerificationState.Available, recoveredMetadata.Value.VerificationState);
            Assert.Equal("available", await ScalarAsync(database, "SELECT verification_state FROM assets WHERE asset_id = $id;", cancellationToken, ("$id", pending.AssetId.ToString())) as string);
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task AssetStore_DeduplicatesBytesAndPersistsIdempotentReferencesAcrossReopen()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = NewTempRoot("asset-references");
        var paths = new AppDataPaths(root);
        var firstBytes = CreatePng(28, 18);
        var differentBytes = CreatePng(29, 18);
        var ownerId = Guid.NewGuid();
        var background = AssetReferenceKey.Create("studio.scene", ownerId, "background");
        var character = AssetReferenceKey.Create("studio.scene", ownerId, "character");

        try
        {
            AssetId firstId;
            AssetId secondId;
            using (var database = new SqliteDatabase(paths))
            {
                var store = CreateAssetStore(paths, database);
                var first = await store.ImportAsync(new MemoryStream(firstBytes), "image/png", cancellationToken);
                var duplicate = await store.ImportAsync(new MemoryStream(firstBytes), "image/png", cancellationToken);
                var second = await store.ImportAsync(new MemoryStream(differentBytes), "image/png", cancellationToken);

                Assert.True(first.IsSuccess, first.Error?.Message);
                Assert.True(duplicate.IsSuccess, duplicate.Error?.Message);
                Assert.True(second.IsSuccess, second.Error?.Message);
                firstId = first.Value.Id;
                secondId = second.Value.Id;
                Assert.Equal(firstId, duplicate.Value.Id);
                Assert.Equal(2L, await ScalarAsync(database, "SELECT COUNT(*) FROM assets;", cancellationToken));
                Assert.Equal(firstBytes.Length, new FileInfo(GetPublishedPath(paths, first.Value.Sha256)).Length);

                Assert.True((await store.AddReferenceAsync(firstId, background, cancellationToken)).IsSuccess);
                Assert.True((await store.AddReferenceAsync(firstId, background, cancellationToken)).IsSuccess);
                Assert.Equal(1L, await ScalarAsync(database, "SELECT COUNT(*) FROM asset_references WHERE owner_id = $owner;", cancellationToken, ("$owner", ownerId.ToString("D"))));

                var unknownAsset = await store.AddReferenceAsync(AssetId.New(), character, cancellationToken);
                Assert.True(unknownAsset.IsFailure);
                Assert.Equal(ApplicationErrorCode.NotFound, unknownAsset.Error!.Code);
                var invalidReference = await store.ReleaseReferenceAsync(default, cancellationToken);
                Assert.True(invalidReference.IsFailure);
                Assert.Equal(ApplicationErrorCode.Validation, invalidReference.Error!.Code);

                var conflict = await store.AddReferenceAsync(secondId, background, cancellationToken);
                Assert.True(conflict.IsFailure);
                Assert.Equal(ApplicationErrorCode.Conflict, conflict.Error!.Code);
                Assert.True((await store.AddReferenceAsync(firstId, character, cancellationToken)).IsSuccess);
            }

            using var reopenedDatabase = new SqliteDatabase(paths);
            var reopenedStore = CreateAssetStore(paths, reopenedDatabase);
            Assert.True((await reopenedStore.AddReferenceAsync(firstId, background, cancellationToken)).IsSuccess);
            Assert.Equal(2L, await ScalarAsync(reopenedDatabase, "SELECT COUNT(*) FROM asset_references WHERE owner_id = $owner;", cancellationToken, ("$owner", ownerId.ToString("D"))));

            Assert.True((await reopenedStore.ReleaseReferenceAsync(background, cancellationToken)).IsSuccess);
            Assert.True((await reopenedStore.ReleaseReferenceAsync(background, cancellationToken)).IsSuccess);
            Assert.Equal(1L, await ScalarAsync(reopenedDatabase, "SELECT COUNT(*) FROM asset_references WHERE owner_id = $owner;", cancellationToken, ("$owner", ownerId.ToString("D"))));
            Assert.True((await reopenedStore.GetMetadataAsync(firstId, cancellationToken)).IsSuccess);
            Assert.True(File.Exists(GetPublishedPath(paths, Hash(firstBytes))));
            Assert.True((await reopenedStore.GetMetadataAsync(secondId, cancellationToken)).IsSuccess);
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    private static SqliteMigrationRunner CreateInitializer(SqliteDatabase database) => new(
        database,
        [new InitialAssetSchemaMigration(), new ModelDraftSchemaMigration(), new ModelDraftCheckpointSchemaMigration(), new AssetImportJournalSchemaMigration(), new AssetReferenceSchemaMigration()]);

    private static SqliteAssetImportPipeline CreatePipeline(AppDataPaths paths, SqliteDatabase database, SqliteMigrationRunner initializer)
    {
        var correlation = new OperationCorrelationContext();
        return new SqliteAssetImportPipeline(paths, database, initializer, new StructuredFileLogger(paths, correlation), correlation);
    }

    private static SqliteAssetStore CreateAssetStore(AppDataPaths paths, SqliteDatabase database)
    {
        var initializer = CreateInitializer(database);
        return new SqliteAssetStore(CreatePipeline(paths, database, initializer), database, initializer);
    }

    private static PendingImport NewPending(byte[] bytes)
    {
        var operationId = Guid.NewGuid();
        var hash = Hash(bytes);
        return new PendingImport(operationId, AssetId.New(), hash, $"sha256/{hash[..2]}/{hash}", $"{operationId:N}.stage", "image/png", bytes.Length, 64, 64, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }

    private static string WriteOperationStage(AppDataPaths paths, PendingImport pending, byte[] bytes)
    {
        var path = Path.Combine(paths.TempDirectory, "asset-operations", pending.StagedFileName);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, bytes);
        return path;
    }

    private static async Task InsertPendingAsync(SqliteDatabase database, PendingImport pending, CancellationToken cancellationToken)
    {
        await database.ExecuteWriteAsync(async (connection, transaction, operationToken) =>
        {
            await using var insert = connection.CreateCommand();
            insert.Transaction = transaction;
            insert.CommandText = "INSERT INTO asset_import_journal(operation_id, asset_id, sha256, relative_path, staged_file_name, media_type, byte_length, pixel_width, pixel_height, created_utc_ms) VALUES ($operation, $asset, $hash, $path, $stage, $mime, $length, $width, $height, $created);";
            insert.Parameters.AddWithValue("$operation", pending.OperationId.ToString("D"));
            insert.Parameters.AddWithValue("$asset", pending.AssetId.ToString());
            insert.Parameters.AddWithValue("$hash", pending.Sha256);
            insert.Parameters.AddWithValue("$path", pending.RelativePath);
            insert.Parameters.AddWithValue("$stage", pending.StagedFileName);
            insert.Parameters.AddWithValue("$mime", pending.MediaType);
            insert.Parameters.AddWithValue("$length", pending.ByteLength);
            insert.Parameters.AddWithValue("$width", pending.Width);
            insert.Parameters.AddWithValue("$height", pending.Height);
            insert.Parameters.AddWithValue("$created", pending.CreatedUtcMs);
            await insert.ExecuteNonQueryAsync(operationToken);
            return true;
        }, cancellationToken);
    }

    private static string GetPublishedPath(AppDataPaths paths, string hash) =>
        Path.Combine(paths.AssetsDirectory, "sha256", hash[..2], hash);

    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    private static byte[] CreatePng(int width, int height)
    {
        var bytes = new byte[45];
        new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }.CopyTo(bytes, 0);
        BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(8, 4), 13);
        "IHDR"u8.CopyTo(bytes.AsSpan(12, 4));
        BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(16, 4), (uint)width);
        BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(20, 4), (uint)height);
        bytes[24] = 8;
        bytes[25] = 6;
        "IEND"u8.CopyTo(bytes.AsSpan(37, 4));
        return bytes;
    }

    private static string NewTempRoot(string suffix) => Path.Combine(Path.GetTempPath(), $"gv5-asset-{suffix}-{Guid.NewGuid():N}");

    private static void DeleteTempRoot(string root)
    {
        if (Directory.Exists(root))
        {
            Directory.Delete(root, recursive: true);
        }
    }

    private static async Task<object?> ScalarAsync(SqliteDatabase database, string sql, CancellationToken cancellationToken, params (string Name, object Value)[] parameters) =>
        await database.ExecuteWriteAsync(async (connection, transaction, operationToken) =>
        {
            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = sql;
            foreach (var (name, value) in parameters)
            {
                command.Parameters.AddWithValue(name, value);
            }

            return await command.ExecuteScalarAsync(operationToken);
        }, cancellationToken);

    private sealed record PendingImport(
        Guid OperationId,
        AssetId AssetId,
        string Sha256,
        string RelativePath,
        string StagedFileName,
        string MediaType,
        long ByteLength,
        int Width,
        int Height,
        long CreatedUtcMs);
}
