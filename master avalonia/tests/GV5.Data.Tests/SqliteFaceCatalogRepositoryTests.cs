using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using GV5.Application.Contracts;
using GV5.Application.Services;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Migrations;
using GV5.Data.Repositories;
using GV5.Data.Storage;
using GV5.Geometry;
using Xunit;

namespace GV5.Data.Tests;

public sealed class SqliteFaceCatalogRepositoryTests
{
    [Fact]
    public async Task FaceDraftsRoundTripWithPinnedModelOptimisticRevisionAndPerComponentAssetReferences()
    {
        var token = TestContext.Current.CancellationToken;
        var root = Path.Combine(Path.GetTempPath(), $"gv5-face-catalog-{Guid.NewGuid():N}");
        var paths = new AppDataPaths(root);
        var faceId = FaceId.New();
        var componentId = FaceComponentId.New();
        var asset = AssetId.New();
        var mouthAsset = AssetId.New();
        try
        {
            using (var database = new SqliteDatabase(paths))
            {
                await CreateInitializer(database).InitializeAsync(token);
                var model = await CreatePublishedModelAsync(database, token);
                Assert.True(model.IsSuccess, model.Error?.Message);
                await InsertAssetAsync(database, asset, token);
                await InsertAssetAsync(database, mouthAsset, token);
                var repository = new SqliteFaceCatalogRepository(database);
                var initial = FaceCatalogDraft.Create(ModelRevisionReference.From(model.Value), "Rosto");
                var component = FaceComponent.Restore(componentId, FaceComponentKind.Eye, "Olho esquerdo", asset,
                    FaceComponentSide.Left, Transform2D.Identity);
                var mouth = FaceComponent.Create(FaceComponentKind.Mouth, "Boca aberta", mouthAsset, null,
                    Transform2D.Identity, mouthVariant: FaceMouthVariant.Open, zOrder: 875);
                var withComponent = initial.WithComponent(component).WithComponent(mouth);
                var created = await repository.CreateAsync(initial, token);
                Assert.True(created.IsSuccess, created.Error?.Message);
                faceId = created.Value.Id;
                var saved = await repository.SaveAsync(withComponent, initial.Revision, token);
                Assert.True(saved.IsSuccess, saved.Error?.Message);
                var stale = await repository.SaveAsync(withComponent, initial.Revision, token);
                Assert.True(stale.IsFailure);
                Assert.Equal(ApplicationErrorCode.Conflict, stale.Error!.Code);
                Assert.Equal(1L, await ScalarAsync(database,
                    "SELECT COUNT(*) FROM asset_references WHERE owner_type='fabricator.face-draft' AND owner_id=$id AND slot=$slot AND asset_id=$asset;",
                    token, ("$id", faceId.Value.ToString("D")), ("$slot", componentId.ToString()), ("$asset", asset.ToString())));

                var moved = saved.Value.WithTransform(componentId,
                    new Transform2D(new Point2D(10, -3), new Point2D(1.1, 0.8), 0.2, new Point2D(4, 5)));
                var updated = await repository.SaveAsync(moved, saved.Value.Revision, token);
                Assert.True(updated.IsSuccess, updated.Error?.Message);
            }

            using (var reopened = new SqliteDatabase(paths))
            {
                await CreateInitializer(reopened).InitializeAsync(token);
                var repository = new SqliteFaceCatalogRepository(reopened);
                var loaded = await repository.GetAsync(faceId, token);
                var listed = await repository.ListAsync(loaded.Value.Model.RevisionId, token);
                Assert.True(loaded.IsSuccess, loaded.Error?.Message);
                Assert.True(listed.IsSuccess, listed.Error?.Message);
                var item = loaded.Value.Components.Single(component => component.Id == componentId);
                Assert.Equal(componentId, item.Id);
                Assert.Equal(asset, item.AssetId);
                Assert.Equal(new Point2D(10, -3), item.Transform.Translation);
                Assert.Equal(FaceMouthVariant.Open, loaded.Value.Components.Single(component => component.Name == "Boca aberta").MouthVariant);
                Assert.Equal(875, loaded.Value.Components.Single(component => component.Name == "Boca aberta").ZOrder);
                Assert.Single(listed.Value);

                var json = await ReadStringAsync(reopened, "SELECT draft_json FROM face_catalog_drafts WHERE face_id=$id;",
                    token, ("$id", faceId.ToString()));
                var legacySnapshot = JsonNode.Parse(json)!;
                legacySnapshot["schemaVersion"] = 1;
                foreach (var legacyComponent in legacySnapshot["components"]!.AsArray())
                    legacyComponent!.AsObject().Remove("zOrder");
                var legacyJson = legacySnapshot.ToJsonString(new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
                var legacyHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(legacyJson))).ToLowerInvariant();
                await ExecuteAsync(reopened, "UPDATE face_catalog_drafts SET draft_json=$json,draft_sha256=$hash WHERE face_id=$id;",
                    token, ("$json", legacyJson), ("$hash", legacyHash), ("$id", faceId.ToString()));
                var legacyLoaded = await repository.GetAsync(faceId, token);
                Assert.True(legacyLoaded.IsSuccess, legacyLoaded.Error?.Message);
                Assert.Equal(100, legacyLoaded.Value.Components.Single(component => component.Name == "Olho esquerdo").ZOrder);
                Assert.Equal(500, legacyLoaded.Value.Components.Single(component => component.Name == "Boca aberta").ZOrder);
            }
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task RepositoryRejectsUnavailableModelOrAssetsAndDetectsSnapshotTampering()
    {
        var token = TestContext.Current.CancellationToken;
        var root = Path.Combine(Path.GetTempPath(), $"gv5-face-catalog-reject-{Guid.NewGuid():N}");
        try
        {
            using var database = new SqliteDatabase(new AppDataPaths(root));
            await CreateInitializer(database).InitializeAsync(token);
            var model = await CreatePublishedModelAsync(database, token);
            Assert.True(model.IsSuccess, model.Error?.Message);
            var repository = new SqliteFaceCatalogRepository(database);
            var wrongModel = ModelRevisionReference.Restore(model.Value.ModelId, model.Value.Id,
                model.Value.Revision, new string('f', 64));
            Assert.True((await repository.CreateAsync(FaceCatalogDraft.Create(wrongModel, "Inválido"), token)).IsFailure);

            var valid = await repository.CreateAsync(FaceCatalogDraft.Create(ModelRevisionReference.From(model.Value), "Rosto"), token);
            Assert.True(valid.IsSuccess, valid.Error?.Message);
            var missingAssetComponent = FaceComponent.Create(FaceComponentKind.Nose, "Nariz ausente", AssetId.New(), null, Transform2D.Identity);
            var missingAsset = await repository.SaveAsync(valid.Value.WithComponent(missingAssetComponent), valid.Value.Revision, token);
            Assert.True(missingAsset.IsFailure);
            Assert.Equal(ApplicationErrorCode.NotFound, missingAsset.Error!.Code);
            Assert.Empty((await repository.GetAsync(valid.Value.Id, token)).Value.Components);

            await ExecuteAsync(database, "UPDATE face_catalog_drafts SET draft_json='{}' WHERE face_id=$id;", token,
                ("$id", valid.Value.Id.ToString()));
            var corrupted = await repository.GetAsync(valid.Value.Id, token);
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
        new HairStyleRepositorySchemaMigration(), new FaceCatalogRepositorySchemaMigration()
    ]);

    private static async Task InsertAssetAsync(SqliteDatabase database, AssetId id, CancellationToken token)
    {
        var bytes = Encoding.UTF8.GetBytes($"face-asset-{id}");
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

    private static async Task<Result<PublishedModelRevision>> CreatePublishedModelAsync(SqliteDatabase database, CancellationToken token)
    {
        var sourceAsset = AssetId.New();
        var partAsset = AssetId.New();
        await InsertAssetAsync(database, sourceAsset, token);
        await InsertAssetAsync(database, partAsset, token);
        var modelId = ModelId.New();
        var models = new SqliteModelDraftRepository(database);
        await models.CreateAsync(ModelDraft.Create(modelId, "Modelo facial", 1), token);
        var partId = ModelPartId.New();
        var crop = new Rect2D(0, 0, 12, 18);
        var transform = Transform2D.Identity;
        var part = new ModelPart(partId, "Cabeça", partAsset, crop, transform, new ModelPartSourceTransform(crop, transform));
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

    private static async Task<string> ReadStringAsync(SqliteDatabase database, string sql, CancellationToken token,
        params (string Name, string Value)[] parameters)
    {
        await using var connection = await database.OpenReadConnectionAsync(token);
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value);
        return (string)(await command.ExecuteScalarAsync(token)
            ?? throw new InvalidOperationException("The test query returned no snapshot."));
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
