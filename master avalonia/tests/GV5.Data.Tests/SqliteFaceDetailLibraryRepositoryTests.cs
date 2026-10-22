using System.Security.Cryptography;
using System.Text;
using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Migrations;
using GV5.Data.Repositories;
using GV5.Data.Storage;
using GV5.Geometry;
using Xunit;

namespace GV5.Data.Tests;

public sealed class SqliteFaceDetailLibraryRepositoryTests
{
    [Fact]
    public async Task SlotLibraryRoundTripsWithRevisionConflictAndAssetReferenceLifecycle()
    {
        var token = TestContext.Current.CancellationToken;
        var root = Path.Combine(Path.GetTempPath(), $"gv5-face-detail-library-{Guid.NewGuid():N}");
        var paths = new AppDataPaths(root);
        var libraryId = Guid.NewGuid();
        var detailId = FaceComponentId.New();
        var assetId = AssetId.New();
        var secondAssetId = AssetId.New();
        try
        {
            using (var database = new SqliteDatabase(paths))
            {
                await CreateInitializer(database).InitializeAsync(token);
                await InsertAssetAsync(database, assetId, token);
                await InsertAssetAsync(database, secondAssetId, token);
                var repository = new SqliteFaceDetailLibraryRepository(database);
                var draft = FaceDetailLibraryDraft.Restore(libraryId, ModelSlot.From(6), Revision.Initial,
                [FaceDetailAsset.Restore(detailId, FaceDetailKind.EyeHighlightRight, assetId, "Brilho", 20, 12,
                    new Transform2D(new Point2D(14, 8), new Point2D(.2, .2), .1, new Point2D(10, 6)))]);
                var created = await repository.CreateAsync(draft, token);
                Assert.True(created.IsSuccess, created.Error?.Message);
                Assert.Equal(1, await ScalarAsync(database,
                    "SELECT COUNT(*) FROM asset_references WHERE owner_type='fabricator.face-detail-library' AND owner_id=$id;",
                    token, ("$id", libraryId.ToString("D"))));

                var loaded = await repository.GetAsync(ModelSlot.From(6), token);
                Assert.True(loaded.IsSuccess, loaded.Error?.Message);
                Assert.Equal(draft.Assets.Single(), loaded.Value.Assets.Single());
                var renamed = loaded.Value.WithAsset(FaceDetailAsset.Restore(detailId, FaceDetailKind.Blush,
                    secondAssetId, "Blush", 24, 16, Transform2D.Identity));
                var saved = await repository.SaveAsync(renamed, loaded.Value.Revision, token);
                Assert.True(saved.IsSuccess, saved.Error?.Message);
                var staleDraft = loaded.Value.WithAsset(loaded.Value.Assets.Single().WithName("Nome desatualizado"));
                var stale = await repository.SaveAsync(staleDraft, loaded.Value.Revision, token);
                Assert.True(stale.IsFailure);
                Assert.Equal(ApplicationErrorCode.Conflict, stale.Error!.Code);
                Assert.Equal(0, await ScalarAsync(database, "SELECT COUNT(*) FROM asset_references WHERE asset_id=$id;",
                    token, ("$id", assetId.ToString())));
                Assert.Equal(1, await ScalarAsync(database, "SELECT COUNT(*) FROM asset_gc_candidates WHERE asset_id=$id;",
                    token, ("$id", assetId.ToString())));
            }

            using (var reopened = new SqliteDatabase(paths))
            {
                await CreateInitializer(reopened).InitializeAsync(token);
                var repository = new SqliteFaceDetailLibraryRepository(reopened);
                var loaded = await repository.GetAsync(ModelSlot.From(6), token);
                Assert.True(loaded.IsSuccess, loaded.Error?.Message);
                Assert.Equal(FaceDetailKind.Blush, loaded.Value.Assets.Single().Kind);
                Assert.Equal(secondAssetId, loaded.Value.Assets.Single().AssetId);
                await ExecuteAsync(reopened,
                    "UPDATE face_detail_libraries SET draft_sha256=$hash WHERE model_slot=6;", token,
                    ("$hash", new string('0', 64)));
                var corrupted = await repository.GetAsync(ModelSlot.From(6), token);
                Assert.True(corrupted.IsFailure);
                Assert.Equal(ApplicationErrorCode.Persistence, corrupted.Error!.Code);
            }
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task RepositoryRejectsMissingAssetsAndEnforcesOneLibraryPerSlot()
    {
        var token = TestContext.Current.CancellationToken;
        var root = Path.Combine(Path.GetTempPath(), $"gv5-face-detail-library-invalid-{Guid.NewGuid():N}");
        try
        {
            using var database = new SqliteDatabase(new AppDataPaths(root));
            await CreateInitializer(database).InitializeAsync(token);
            var repository = new SqliteFaceDetailLibraryRepository(database);
            var missing = FaceDetailLibraryDraft.Restore(Guid.NewGuid(), ModelSlot.From(2), Revision.Initial,
            [FaceDetailAsset.Create(FaceDetailKind.Blush, AssetId.New(), "Blush", 8, 8, Transform2D.Identity)]);
            var rejected = await repository.CreateAsync(missing, token);
            Assert.True(rejected.IsFailure);
            Assert.Equal(ApplicationErrorCode.NotFound, rejected.Error!.Code);

            var empty = FaceDetailLibraryDraft.Create(ModelSlot.From(2));
            Assert.True((await repository.CreateAsync(empty, token)).IsSuccess);
            var duplicateSlot = FaceDetailLibraryDraft.Create(ModelSlot.From(2));
            var duplicate = await repository.CreateAsync(duplicateSlot, token);
            Assert.True(duplicate.IsFailure);
            Assert.Equal(ApplicationErrorCode.Conflict, duplicate.Error!.Code);
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
        var bytes = Encoding.UTF8.GetBytes($"face-detail-{id}");
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
        params (string Name, object Value)[] parameters)
    {
        await using var connection = await database.OpenReadConnectionAsync(token);
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value);
        return Convert.ToInt64(await command.ExecuteScalarAsync(token));
    }

    private static Task<bool> ExecuteAsync(SqliteDatabase database, string sql, CancellationToken token,
        params (string Name, object Value)[] parameters) => database.ExecuteWriteAsync(async (connection, transaction, cancellationToken) =>
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value);
        await command.ExecuteNonQueryAsync(cancellationToken);
        return true;
    }, token);
}
