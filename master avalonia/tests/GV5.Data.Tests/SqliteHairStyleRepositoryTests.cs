using System.Security.Cryptography;
using System.Text;
using GV5.Application.Contracts;
using GV5.Application.Services;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Migrations;
using GV5.Data.Repositories;
using GV5.Data.Storage;
using GV5.Geometry;
using Microsoft.Data.Sqlite;
using Xunit;

namespace GV5.Data.Tests;

public sealed class SqliteHairStyleRepositoryTests
{
    [Fact]
    public async Task DraftsAndImmutablePublicationsRoundTripWithPinnedModelAndAssetReferences()
    {
        var token = TestContext.Current.CancellationToken;
        var root = Path.Combine(Path.GetTempPath(), $"gv5-hair-repository-{Guid.NewGuid():N}");
        var paths = new AppDataPaths(root);
        var hairId = HairId.New();
        var assetId = AssetId.New();
        try
        {
            using (var database = new SqliteDatabase(paths))
            {
                await CreateInitializer(database).InitializeAsync(token);
                var published = await CreatePublishedModelAsync(database, "Modelo de cabelo", token);
                Assert.True(published.IsSuccess, published.Error?.Message);

                await InsertAssetAsync(database, assetId, token);
                var repository = new SqliteHairStyleRepository(database);
                var created = await repository.CreateAsync(HairStyleDraft.Create(ModelRevisionReference.From(published.Value), "Cabelo") , token);
                Assert.True(created.IsSuccess, created.Error?.Message);
                hairId = created.Value.Id;
                var layer = HairLayer.Create(HairPartId.BackHair, assetId, Transform2D.Identity);
                var changed = created.Value.WithLayer(layer).WithPalette(HairPaletteOverrides.Empty.WithColor(HairColorRole.Base, 0xAA6633));
                var saved = await repository.SaveAsync(changed, created.Value.Revision, token);
                Assert.True(saved.IsSuccess, saved.Error?.Message);
                var stale = await repository.SaveAsync(changed, created.Value.Revision, token);
                Assert.True(stale.IsFailure);
                Assert.Equal(ApplicationErrorCode.Conflict, stale.Error!.Code);

                var publication = await repository.PublishAsync(hairId, saved.Value.Revision, 3, token);
                Assert.True(publication.IsSuccess, publication.Error?.Message);
                var repeated = await repository.PublishAsync(hairId, saved.Value.Revision, 4, token);
                Assert.True(repeated.IsSuccess, repeated.Error?.Message);
                Assert.Equal(publication.Value.Id, repeated.Value.Id);
                Assert.Equal(assetId, publication.Value.Snapshot.Layers.Single().AssetId);
                Assert.Equal(1, await ScalarAsync(database,
                    "SELECT COUNT(*) FROM hair_revisions WHERE hair_id=$id;", token, ("$id", hairId.ToString())));
                Assert.Equal(2, await ScalarAsync(database,
                    "SELECT COUNT(*) FROM asset_references WHERE asset_id=$asset AND owner_type IN ('fabricator.hair-draft','fabricator.hair-revision');",
                    token, ("$asset", assetId.ToString())));

                var json = await ScalarStringAsync(database,
                    "SELECT snapshot_json FROM hair_revisions WHERE hair_id=$id;", token, ("$id", hairId.ToString()));
                var hash = await ScalarStringAsync(database,
                    "SELECT snapshot_sha256 FROM hair_revisions WHERE hair_id=$id;", token, ("$id", hairId.ToString()));
                Assert.Equal(hash, Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json))).ToLowerInvariant());
                await Assert.ThrowsAsync<SqliteException>(() => ExecuteAsync(database,
                    "UPDATE hair_revisions SET display_name='mudado' WHERE hair_id=$id;", token, ("$id", hairId.ToString())));
            }

            using (var reopened = new SqliteDatabase(paths))
            {
                await CreateInitializer(reopened).InitializeAsync(token);
                var repository = new SqliteHairStyleRepository(reopened);
                var draft = await repository.GetAsync(hairId, token);
                var publications = await repository.ListPublishedAsync(hairId, token);
                Assert.True(draft.IsSuccess, draft.Error?.Message);
                Assert.True(publications.IsSuccess, publications.Error?.Message);
                Assert.Equal(assetId, draft.Value.Layers.Single().AssetId);
                Assert.Equal(0xAA6633u, publications.Value.Single().Snapshot.Palette.Colors[HairColorRole.Base]);

                await ExecuteAsync(reopened, "DROP TRIGGER trg_hair_revisions_no_update;", token);
                await ExecuteAsync(reopened, "UPDATE hair_revisions SET display_name='linha adulterada' WHERE hair_id=$id;",
                    token, ("$id", hairId.ToString()));
                var corruptPublication = await repository.ListPublishedAsync(hairId, token);
                Assert.True(corruptPublication.IsFailure);
                Assert.Equal(ApplicationErrorCode.Persistence, corruptPublication.Error!.Code);
            }
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task RepositoryRejectsMissingAssetAndWrongPinnedModelSnapshot()
    {
        var token = TestContext.Current.CancellationToken;
        var root = Path.Combine(Path.GetTempPath(), $"gv5-hair-repository-reject-{Guid.NewGuid():N}");
        try
        {
            using var database = new SqliteDatabase(new AppDataPaths(root));
            await CreateInitializer(database).InitializeAsync(token);
            var model = await CreatePublishedModelAsync(database, "Modelo", token);
            Assert.True(model.IsSuccess, model.Error?.Message);

            var repository = new SqliteHairStyleRepository(database);
            var wrongModel = ModelRevisionReference.Restore(model.Value.ModelId, model.Value.Id,
                model.Value.Revision, new string('f', 64));
            var wrongDraft = HairStyleDraft.Create(wrongModel, "Inválido");
            var wrongCreated = await repository.CreateAsync(wrongDraft, token);
            Assert.True(wrongCreated.IsFailure);

            var initialHairDraft = HairStyleDraft.Create(ModelRevisionReference.From(model.Value), "Cabelo");
            var validDraft = await repository.CreateAsync(initialHairDraft, token);
            Assert.True(validDraft.IsSuccess, validDraft.Error?.Message);
            var missingAssetDraft = validDraft.Value.WithLayer(HairLayer.Create(HairPartId.RearHair, AssetId.New(), Transform2D.Identity));
            var missingAsset = await repository.SaveAsync(missingAssetDraft, validDraft.Value.Revision, token);
            Assert.True(missingAsset.IsFailure);
            Assert.Single((await repository.ListAsync(model.Value.Id, token)).Value);
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
        new HairStyleRepositorySchemaMigration()
    ]);

    private static async Task InsertAssetAsync(SqliteDatabase database, AssetId id, CancellationToken token)
    {
        var bytes = Encoding.UTF8.GetBytes($"hair-asset-{id}");
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

    private static async Task<Result<PublishedModelRevision>> CreatePublishedModelAsync(SqliteDatabase database,
        string name, CancellationToken token)
    {
        var sourceAsset = AssetId.New();
        var partAsset = AssetId.New();
        await InsertAssetAsync(database, sourceAsset, token);
        await InsertAssetAsync(database, partAsset, token);
        var modelId = ModelId.New();
        var models = new SqliteModelDraftRepository(database);
        await models.CreateAsync(ModelDraft.Create(modelId, name, 1), token);
        var partId = ModelPartId.New();
        var crop = new Rect2D(0, 0, 12, 18);
        var transform = Transform2D.Identity;
        var part = new ModelPart(partId, "Corpo", partAsset, crop, transform,
            new ModelPartSourceTransform(crop, transform));
        var content = ModelDraftContent.Restore(ModelDraftContent.CurrentSchemaVersion, modelId, Revision.Initial,
            ModelSlot.From(1), sourceAsset, 32, 32, [part], [partId]);
        var contentRepository = new SqliteModelDraftContentRepository(database);
        var saved = await contentRepository.SaveAsync(content, null, token);
        if (saved.IsFailure) return Result<PublishedModelRevision>.Failure(saved.Error!);
        return await new PublishModelRevisionService(models, contentRepository, new SqliteModelRevisionRepository(database))
            .PublishAsync(modelId, 2, token);
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

    private static async Task<string> ScalarStringAsync(SqliteDatabase database, string sql, CancellationToken token,
        params (string Name, string Value)[] parameters)
    {
        await using var connection = await database.OpenReadConnectionAsync(token);
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value);
        return Convert.ToString(await command.ExecuteScalarAsync(token))!;
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
