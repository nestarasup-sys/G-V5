using System.Security.Cryptography;
using System.Text;
using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Migrations;
using GV5.Data.Repositories;
using GV5.Data.Storage;
using GV5.Geometry;
using Microsoft.Data.Sqlite;
using Xunit;

namespace GV5.Data.Tests;

public sealed class SqliteHeadExtraLibraryRepositoryTests
{
    [Fact]
    public async Task SlotLibraryRoundTripsWithOptimisticRevisionAndAssetReferenceLifecycle()
    {
        var token = TestContext.Current.CancellationToken;
        var root = Path.Combine(Path.GetTempPath(), $"gv5-head-extra-library-{Guid.NewGuid():N}");
        var paths = new AppDataPaths(root);
        var libraryId = Guid.NewGuid();
        var itemId = FaceComponentId.New();
        var assetId = AssetId.New();
        var secondAssetId = AssetId.New();
        try
        {
            using (var database = new SqliteDatabase(paths))
            {
                await CreateInitializer(database).InitializeAsync(token);
                await InsertAssetAsync(database, assetId, token);
                await InsertAssetAsync(database, secondAssetId, token);
                var repository = new SqliteHeadExtraLibraryRepository(database);
                var draft = HeadExtraLibraryDraft.Restore(libraryId, ModelSlot.From(4), Revision.Initial,
                [HeadExtraAsset.Restore(itemId, assetId, "Óculos", 48, 32,
                    new Transform2D(new Point2D(12, 8), new Point2D(.5, .4), .2, Point2D.Zero))]);
                var created = await repository.CreateAsync(draft, token);
                Assert.True(created.IsSuccess, created.Error?.Message);
                Assert.Equal(1, await ScalarAsync(database,
                    "SELECT COUNT(*) FROM asset_references WHERE owner_type='fabricator.head-extra-library' AND owner_id=$id;", token,
                    ("$id", libraryId.ToString("D"))));
                Assert.Equal(0, await ScalarAsync(database, "SELECT COUNT(*) FROM asset_gc_candidates WHERE asset_id=$id;", token,
                    ("$id", assetId.ToString())));

                var loaded = await repository.GetAsync(ModelSlot.From(4), token);
                Assert.True(loaded.IsSuccess, loaded.Error?.Message);
                Assert.Equal(draft.Id, loaded.Value.Id);
                Assert.Equal(draft.ModelSlot, loaded.Value.ModelSlot);
                Assert.Equal(draft.Revision, loaded.Value.Revision);
                Assert.Equal(draft.Assets.Single(), loaded.Value.Assets.Single());
                var renamed = loaded.Value.WithAssetName(itemId, "Óculos azul").WithAssetTransform(itemId,
                    new Transform2D(new Point2D(20, 10), new Point2D(.7, .6), -.1, Point2D.Zero));
                var saved = await repository.SaveAsync(renamed, loaded.Value.Revision, token);
                Assert.True(saved.IsSuccess, saved.Error?.Message);
                var stale = await repository.SaveAsync(loaded.Value.WithAssetName(itemId, "Antigo"), loaded.Value.Revision, token);
                Assert.True(stale.IsFailure);
                Assert.Equal(ApplicationErrorCode.Conflict, stale.Error!.Code);

                var movedToNewAsset = saved.Value.WithAsset(
                    HeadExtraAsset.Restore(itemId, secondAssetId, "Óculos azul", 48, 32, Transform2D.Identity));
                var replaced = await repository.SaveAsync(movedToNewAsset, saved.Value.Revision, token);
                Assert.True(replaced.IsSuccess, replaced.Error?.Message);
                Assert.Equal(0, await ScalarAsync(database, "SELECT COUNT(*) FROM asset_references WHERE asset_id=$id;", token,
                    ("$id", assetId.ToString())));
                Assert.Equal(1, await ScalarAsync(database, "SELECT COUNT(*) FROM asset_gc_candidates WHERE asset_id=$id;", token,
                    ("$id", assetId.ToString())));
            }

            using (var reopened = new SqliteDatabase(paths))
            {
                await CreateInitializer(reopened).InitializeAsync(token);
                var repository = new SqliteHeadExtraLibraryRepository(reopened);
                var loaded = await repository.GetAsync(ModelSlot.From(4), token);
                Assert.True(loaded.IsSuccess, loaded.Error?.Message);
                Assert.Equal("Óculos azul", loaded.Value.Assets.Single().Name);
                Assert.Equal(secondAssetId, loaded.Value.Assets.Single().AssetId);
                var removed = loaded.Value.WithoutAsset(itemId);
                var saved = await repository.SaveAsync(removed, loaded.Value.Revision, token);
                Assert.True(saved.IsSuccess, saved.Error?.Message);
                Assert.Empty(saved.Value.Assets);
                Assert.Equal(0, await ScalarAsync(reopened,
                    "SELECT COUNT(*) FROM asset_references WHERE owner_type='fabricator.head-extra-library' AND owner_id=$id;", token,
                    ("$id", libraryId.ToString("D"))));

                var independentSlot = HeadExtraLibraryDraft.Create(ModelSlot.From(5));
                var secondLibrary = await repository.CreateAsync(independentSlot, token);
                Assert.True(secondLibrary.IsSuccess, secondLibrary.Error?.Message);
                Assert.Equal(independentSlot.Id,
                    (await repository.GetAsync(ModelSlot.From(5), token)).Value.Id);
            }
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task LibraryRejectsMissingAssetsAndDetectsSnapshotCorruption()
    {
        var token = TestContext.Current.CancellationToken;
        var root = Path.Combine(Path.GetTempPath(), $"gv5-head-extra-library-invalid-{Guid.NewGuid():N}");
        try
        {
            using var database = new SqliteDatabase(new AppDataPaths(root));
            await CreateInitializer(database).InitializeAsync(token);
            var repository = new SqliteHeadExtraLibraryRepository(database);
            var draft = HeadExtraLibraryDraft.Restore(Guid.NewGuid(), ModelSlot.From(2), Revision.Initial,
            [HeadExtraAsset.Create(AssetId.New(), "Asset ausente", 8, 8, Transform2D.Identity)]);
            var missing = await repository.CreateAsync(draft, token);
            Assert.True(missing.IsFailure);
            Assert.Equal(ApplicationErrorCode.NotFound, missing.Error!.Code);

            var empty = HeadExtraLibraryDraft.Create(ModelSlot.From(2));
            var created = await repository.CreateAsync(empty, token);
            Assert.True(created.IsSuccess, created.Error?.Message);
            await ExecuteAsync(database, "UPDATE head_extra_libraries SET draft_sha256=$hash WHERE model_slot=2;", token,
                ("$hash", new string('0', 64)));
            var corrupted = await repository.GetAsync(ModelSlot.From(2), token);
            Assert.True(corrupted.IsFailure);
            Assert.Equal(ApplicationErrorCode.Persistence, corrupted.Error!.Code);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    private static SqliteMigrationRunner CreateInitializer(SqliteDatabase database) => new(database,
    [
        new InitialAssetSchemaMigration(), new ModelDraftSchemaMigration(), new ModelDraftCheckpointSchemaMigration(),
        new AssetImportJournalSchemaMigration(), new AssetReferenceSchemaMigration(), new AssetGarbageCollectionSchemaMigration(),
        new ModelDraftContentSchemaMigration(), new ModelRevisionSchemaMigration(), new ModelRigJointSchemaMigration(),
        new PoseRepositorySchemaMigration(), new AnimationRepositorySchemaMigration(), new WardrobeRepositorySchemaMigration(),
        new HairStyleRepositorySchemaMigration(), new FaceCatalogRepositorySchemaMigration(), new FaceExpressionRepositorySchemaMigration(),
        new FacePublicationSchemaMigration(), new AnimationSlotsSchemaMigration(), new ModelSlotSchemaMigration(),
        new HeadExtraLibrarySchemaMigration(), new FaceDetailLibrarySchemaMigration()
    ]);

    private static async Task InsertAssetAsync(SqliteDatabase database, AssetId id, CancellationToken token)
    {
        var bytes = Encoding.UTF8.GetBytes($"head-extra-{id}");
        var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        await database.ExecuteWriteAsync(async (connection, transaction, cancellationToken) =>
        {
            await using var insert = connection.CreateCommand();
            insert.Transaction = transaction;
            insert.CommandText = "INSERT INTO assets(asset_id,sha256,relative_path,mime_type,byte_length,verification_state,created_utc_ms) VALUES($id,$hash,$path,'image/png',$length,'available',1);";
            insert.Parameters.AddWithValue("$id", id.ToString());
            insert.Parameters.AddWithValue("$hash", hash);
            insert.Parameters.AddWithValue("$path", $"assets/{hash}.png");
            insert.Parameters.AddWithValue("$length", bytes.Length);
            await insert.ExecuteNonQueryAsync(cancellationToken);
            await using var candidate = connection.CreateCommand();
            candidate.Transaction = transaction;
            candidate.CommandText = "INSERT INTO asset_gc_candidates(asset_id,unreferenced_since_utc_ms) VALUES($id,1);";
            candidate.Parameters.AddWithValue("$id", id.ToString());
            await candidate.ExecuteNonQueryAsync(cancellationToken);
            return true;
        }, token);
    }

    private static async Task<long> ScalarAsync(SqliteDatabase database, string sql, CancellationToken token,
        params (string Name, string Value)[] parameters)
    {
        await using var connection = await database.OpenReadConnectionAsync(token);
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value);
        return Convert.ToInt64(await command.ExecuteScalarAsync(token));
    }

    private static async Task ExecuteAsync(SqliteDatabase database, string sql, CancellationToken token,
        params (string Name, string Value)[] parameters)
    {
        await database.ExecuteWriteAsync(async (connection, transaction, cancellationToken) =>
        {
            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = sql;
            foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value);
            await command.ExecuteNonQueryAsync(cancellationToken);
            return true;
        }, token);
    }
}
