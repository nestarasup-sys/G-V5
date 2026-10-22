using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using GV5.Application.Contracts;
using GV5.Application.Services;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Dependencies;
using GV5.Data.Migrations;
using GV5.Data.Repositories;
using GV5.Data.Storage;
using GV5.Geometry;
using Microsoft.Data.Sqlite;
using Xunit;

namespace GV5.Data.Tests;

public sealed class SqliteFaceCatalogRepositoryTests
{
    [Fact]
    public async Task FaceExpressionRepositoryPropagatesCancellationWithoutConvertingItToPersistenceFailure()
    {
        var token = TestContext.Current.CancellationToken;
        var root = Path.Combine(Path.GetTempPath(), $"gv5-face-expression-cancel-{Guid.NewGuid():N}");
        try
        {
            using var database = new SqliteDatabase(new AppDataPaths(root));
            await CreateInitializer(database).InitializeAsync(token);
            var model = await CreatePublishedModelAsync(database, token);
            Assert.True(model.IsSuccess, model.Error?.Message);
            var catalogRepository = new SqliteFaceCatalogRepository(database);
            var catalog = FaceCatalogDraft.Create(ModelRevisionReference.From(model.Value), "Rosto cancelável");
            var createdCatalog = await catalogRepository.CreateAsync(catalog, token);
            Assert.True(createdCatalog.IsSuccess, createdCatalog.Error?.Message);
            var repository = new SqliteFaceExpressionRepository(database);
            var collection = FaceExpressionCollection.Create(ModelRevisionReference.From(model.Value), "Cancelamento", 10);
            var created = await repository.CreateCollectionAsync(collection, token);
            Assert.True(created.IsSuccess, created.Error?.Message);

            using var cancellation = new CancellationTokenSource();
            cancellation.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
                catalogRepository.GetAsync(catalog.Id, cancellation.Token));
            var invalidUncommittedComponent = FaceComponent.Create(FaceComponentKind.Nose, "Cancelado", AssetId.New(), null,
                GV5.Geometry.Transform2D.Identity);
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
                catalogRepository.SaveAsync(catalog.WithComponent(invalidUncommittedComponent), catalog.Revision, cancellation.Token));
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
                repository.GetCollectionAsync(collection.Id, cancellation.Token));
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
                repository.SaveCollectionAsync(collection.WithName("Não deve salvar", 20), collection.Revision, cancellation.Token));

            var unchanged = await repository.GetCollectionAsync(collection.Id, token);
            Assert.True(unchanged.IsSuccess, unchanged.Error?.Message);
            Assert.Equal("Cancelamento", unchanged.Value.Name);
            Assert.Equal(collection.Revision, unchanged.Value.Revision);
            var unchangedCatalog = await catalogRepository.GetAsync(catalog.Id, token);
            Assert.True(unchangedCatalog.IsSuccess, unchangedCatalog.Error?.Message);
            Assert.Equal(catalog.Revision, unchangedCatalog.Value.Revision);
            Assert.Empty(unchangedCatalog.Value.Components);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task FaceDraftsRoundTripWithPinnedModelOptimisticRevisionAndPerComponentAssetReferences()
    {
        var token = TestContext.Current.CancellationToken;
        var root = Path.Combine(Path.GetTempPath(), $"gv5-face-catalog-{Guid.NewGuid():N}");
        var paths = new AppDataPaths(root);
        var faceId = FaceId.New();
        var sparePresetId = FaceExpressionPresetId.New();
        FaceRevisionId publishedFaceId = default;
        FaceExpressionRevisionId publishedExpressionId = default;
        var componentId = FaceComponentId.New();
        var asset = AssetId.New();
        var mouthAsset = AssetId.New();
        var extraAsset = AssetId.New();
        try
        {
            using (var database = new SqliteDatabase(paths))
            {
                await CreateInitializer(database).InitializeAsync(token);
                var model = await CreatePublishedModelAsync(database, token);
                Assert.True(model.IsSuccess, model.Error?.Message);
                await InsertAssetAsync(database, asset, token);
                await InsertAssetAsync(database, mouthAsset, token);
                await InsertAssetAsync(database, extraAsset, token);
                var repository = new SqliteFaceCatalogRepository(database);
                var initial = FaceCatalogDraft.Create(ModelRevisionReference.From(model.Value), "Rosto");
                var component = FaceComponent.Restore(componentId, FaceComponentKind.Eye, "Olho esquerdo", asset,
                    FaceComponentSide.Left, Transform2D.Identity);
                var mouth = FaceComponent.Create(FaceComponentKind.Mouth, "Boca aberta", mouthAsset, null,
                    Transform2D.Identity, mouthVariant: FaceMouthVariant.Open, zOrder: 875);
                var extra = FaceComponent.Create(FaceComponentKind.HeadExtra, "Óculos", extraAsset, null,
                    new Transform2D(new Point2D(22, 37), new Point2D(.6, .35), 0, new Point2D(4, 5)));
                var withComponent = initial.WithComponent(component).WithComponent(mouth).WithComponent(extra);
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
                Assert.Equal(1L, await ScalarAsync(database,
                    "SELECT COUNT(*) FROM asset_references WHERE owner_type='fabricator.face-draft' AND owner_id=$id AND slot=$slot AND asset_id=$asset;",
                    token, ("$id", faceId.Value.ToString("D")), ("$slot", extra.Id.ToString()), ("$asset", extraAsset.ToString())));

                var moved = saved.Value.WithTransform(componentId,
                    new Transform2D(new Point2D(10, -3), new Point2D(1.1, 0.8), 0.2, new Point2D(4, 5)));
                var updated = await repository.SaveAsync(moved, saved.Value.Revision, token);
                Assert.True(updated.IsSuccess, updated.Error?.Message);
                var renamedCatalog = updated.Value.WithComponentName(extra.Id, "Óculos Pro");
                var renamed = await repository.SaveAsync(renamedCatalog, updated.Value.Revision, token);
                Assert.True(renamed.IsSuccess, renamed.Error?.Message);

                var expressionRepository = new SqliteFaceExpressionRepository(database);
                var collection = FaceExpressionCollection.Create(ModelRevisionReference.From(model.Value), "Expressões", 10);
                var createdCollection = await expressionRepository.CreateCollectionAsync(collection, token);
                Assert.True(createdCollection.IsSuccess, createdCollection.Error?.Message);
                var cascadeCollection = FaceExpressionCollection.Create(ModelRevisionReference.From(model.Value), "Descartável", 11);
                var createdCascadeCollection = await expressionRepository.CreateCollectionAsync(cascadeCollection, token);
                Assert.True(createdCascadeCollection.IsSuccess, createdCascadeCollection.Error?.Message);
                var renamedCollection = collection.WithName("Expressões Dev", 20);
                var savedCollection = await expressionRepository.SaveCollectionAsync(renamedCollection, collection.Revision, token);
                Assert.True(savedCollection.IsSuccess, savedCollection.Error?.Message);
                var staleCollection = await expressionRepository.SaveCollectionAsync(renamedCollection, collection.Revision, token);
                Assert.True(staleCollection.IsFailure);
                Assert.Equal(ApplicationErrorCode.Conflict, staleCollection.Error!.Code);
                var assembly = FaceAssembly.Create(renamed.Value).Select(renamed.Value, component.Id)
                    .Select(renamed.Value, mouth.Id);
                var preset = FaceExpressionPresetDraft.Create(collection, renamed.Value, 12, "Irritada", assembly);
                var createdPreset = await expressionRepository.CreatePresetAsync(preset, token);
                Assert.True(createdPreset.IsSuccess, createdPreset.Error?.Message);
                var sparePreset = FaceExpressionPresetDraft.Create(cascadeCollection, renamed.Value, 13, "Triste");
                sparePresetId = sparePreset.Id;
                var createdSparePreset = await expressionRepository.CreatePresetAsync(sparePreset, token);
                Assert.True(createdSparePreset.IsSuccess, createdSparePreset.Error?.Message);
                var effects = FaceExpressionEffects.Create(preset.Effects.Shadow,
                    FaceExpressionEffectParameters.Create(true, "#ef3456", 0.55, 0.6, 0.7, 0.05,
                        style: FaceExpressionEffectStyle.Cheeks), preset.Effects.MouthBlush);
                var presetChanges = preset.WithTransform(FaceAssemblySlot.EyeLeft,
                    new Transform2D(new Point2D(12, -4), new Point2D(1.1, 0.9), 0.1, Point2D.Zero))
                    .WithEffects(effects);
                var savedPreset = await expressionRepository.SavePresetAsync(presetChanges, preset.Revision, token);
                Assert.True(savedPreset.IsSuccess, savedPreset.Error?.Message);
                var stalePreset = await expressionRepository.SavePresetAsync(presetChanges, preset.Revision, token);
                Assert.True(stalePreset.IsFailure);
                Assert.Equal(ApplicationErrorCode.Conflict, stalePreset.Error!.Code);
                var faceRepository = new SqliteFaceCatalogRepository(database);
                var staleFacePublication = await faceRepository.PublishAsync(renamed.Value.Id, Revision.Initial, 25, token);
                Assert.True(staleFacePublication.IsFailure);
                Assert.Equal(ApplicationErrorCode.Conflict, staleFacePublication.Error!.Code);
                var expressionWithoutFacePublication = await expressionRepository.PublishPresetAsync(presetChanges.Id,
                    savedPreset.Value.Revision, 25, token);
                Assert.True(expressionWithoutFacePublication.IsFailure);
                Assert.Equal(ApplicationErrorCode.NotFound, expressionWithoutFacePublication.Error!.Code);
                var facePublication = await faceRepository.PublishAsync(renamed.Value.Id, renamed.Value.Revision, 26, token);
                Assert.True(facePublication.IsSuccess, facePublication.Error?.Message);
                publishedFaceId = facePublication.Value.Id;
                var expressionPublication = await expressionRepository.PublishPresetAsync(presetChanges.Id,
                    savedPreset.Value.Revision, 27, token);
                Assert.True(expressionPublication.IsSuccess, expressionPublication.Error?.Message);
                publishedExpressionId = expressionPublication.Value.Id;
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
                var persistedExtra = Assert.Single(loaded.Value.Components, component => component.Kind == FaceComponentKind.HeadExtra);
                Assert.Equal("Óculos Pro", persistedExtra.Name);
                Assert.Equal(extraAsset, persistedExtra.AssetId);
                Assert.Equal(new Point2D(22, 37), persistedExtra.Transform.Translation);
                var withoutExtra = loaded.Value.WithoutComponent(persistedExtra.Id);
                var removedExtra = await repository.SaveAsync(withoutExtra, loaded.Value.Revision, token);
                Assert.True(removedExtra.IsSuccess, removedExtra.Error?.Message);
                Assert.Empty(removedExtra.Value.Components.Where(component => component.Kind == FaceComponentKind.HeadExtra));
                Assert.Equal(0L, await ScalarAsync(reopened,
                    "SELECT COUNT(*) FROM asset_references WHERE owner_type='fabricator.face-draft' AND owner_id=$id AND slot=$slot;",
                    token, ("$id", faceId.Value.ToString("D")), ("$slot", persistedExtra.Id.ToString())));
                Assert.Equal(1L, await ScalarAsync(reopened,
                    "SELECT COUNT(*) FROM assets WHERE asset_id=$asset;", token, ("$asset", extraAsset.ToString())));
                Assert.Single(listed.Value);
                var expressionRepository = new SqliteFaceExpressionRepository(reopened);
                var collections = await expressionRepository.ListCollectionsAsync(loaded.Value.Model.RevisionId, token);
                Assert.True(collections.IsSuccess, collections.Error?.Message);
                Assert.Equal(2, collections.Value.Count);
                var collection = Assert.Single(collections.Value, item => item.Name == "Expressões Dev");
                Assert.Equal("Expressões Dev", collection.Name);
                var presets = await expressionRepository.ListPresetsAsync(collection.Id, token);
                Assert.True(presets.IsSuccess, presets.Error?.Message);
                Assert.Single(presets.Value);
                var expression = Assert.Single(presets.Value, item => item.ExpressionIndex == 12);
                Assert.Equal("Irritada", expression.Name);
                Assert.Equal(12, expression.ExpressionIndex);
                Assert.Equal(new Point2D(12, -4), expression.Transforms[FaceAssemblySlot.EyeLeft].Translation);
                Assert.Equal("#ef3456", expression.Effects.Blush.Color);
                var facePublications = await new SqliteFaceCatalogRepository(reopened).ListPublishedAsync(loaded.Value.Id, token);
                var publishedFace = Assert.Single(facePublications.Value);
                Assert.Equal(publishedFaceId, publishedFace.Id);
                Assert.Equal(loaded.Value.Revision, publishedFace.DraftRevision);
                var publishedExpressions = await expressionRepository.ListPublishedPresetsAsync(expression.Id, token);
                var publishedExpression = Assert.Single(publishedExpressions.Value);
                var publishedExpressionByRevision = await expressionRepository.GetPublishedPresetAsync(expression.Id,
                    publishedExpression.Revision, token);
                Assert.True(publishedExpressionByRevision.IsSuccess, publishedExpressionByRevision.Error?.Message);
                Assert.Equal(publishedExpression.Id, publishedExpressionByRevision.Value.Id);
                Assert.Equal(publishedExpressionId, publishedExpression.Id);
                Assert.Equal(publishedFaceId, publishedExpression.FaceRevisionId);
                Assert.Equal(expression.Revision, publishedExpression.DraftRevision);
                await Assert.ThrowsAsync<SqliteException>(() => ExecuteAsync(reopened,
                    "UPDATE face_revisions SET display_name='violado' WHERE face_revision_id=$id;", token,
                    ("$id", publishedFaceId.ToString())));
                await Assert.ThrowsAsync<SqliteException>(() => ExecuteAsync(reopened,
                    "UPDATE face_expression_revisions SET published_utc_ms=0 WHERE expression_revision_id=$id;", token,
                    ("$id", publishedExpressionId.ToString())));
                var dependencyCatalog = new SqliteFabricatorDependencyCatalog(reopened);
                var faceDependencies = await dependencyCatalog.AssessDeletionAsync(FabricatorResourceReference.For(loaded.Value.Id), token);
                Assert.True(faceDependencies.IsSuccess, faceDependencies.Error?.Message);
                Assert.Contains(faceDependencies.Value.Usages, usage => usage.UsageType == "expression-preset");
                Assert.Contains(faceDependencies.Value.Usages, usage => usage.UsageType == "immutable-publication");
                var collectionDependencies = await dependencyCatalog.AssessDeletionAsync(FabricatorResourceReference.For(collection.Id), token);
                Assert.True(collectionDependencies.IsSuccess, collectionDependencies.Error?.Message);
                Assert.Contains(collectionDependencies.Value.Usages, usage => usage.UsageType == "expression-preset");
                var presetDependencies = await dependencyCatalog.AssessDeletionAsync(FabricatorResourceReference.For(expression.Id), token);
                Assert.True(presetDependencies.IsSuccess, presetDependencies.Error?.Message);
                Assert.Contains(presetDependencies.Value.Usages, usage => usage.UsageType == "immutable-publication");
                var modelDependencies = await dependencyCatalog.AssessDeletionAsync(FabricatorResourceReference.For(loaded.Value.Model.ModelId), token);
                Assert.True(modelDependencies.IsSuccess, modelDependencies.Error?.Message);
                Assert.Contains(modelDependencies.Value.Usages, usage => usage.UsageType == "face-publication");
                Assert.Equal(FaceMouthVariant.Open, loaded.Value.Components.Single(component => component.Name == "Boca aberta").MouthVariant);
                var deleted = await expressionRepository.DeletePresetAsync(expression.Id, Revision.Initial, token);
                Assert.True(deleted.IsFailure);
                Assert.Equal(ApplicationErrorCode.Conflict, deleted.Error!.Code);
                await ExecuteAsync(reopened, "UPDATE face_expression_presets SET draft_json='{}' WHERE preset_id=$id;", token,
                    ("$id", expression.Id.ToString()));
                var tamperedPreset = await expressionRepository.GetPresetAsync(expression.Id, token);
                Assert.True(tamperedPreset.IsFailure);
                Assert.Equal(ApplicationErrorCode.Persistence, tamperedPreset.Error!.Code);
                var removed = await expressionRepository.DeletePresetAsync(expression.Id, expression.Revision, token);
                Assert.True(removed.IsFailure);
                Assert.Equal(ApplicationErrorCode.Conflict, removed.Error!.Code);
                var staleCollectionDelete = await expressionRepository.DeleteCollectionAsync(collection.Id, Revision.Initial, token);
                Assert.True(staleCollectionDelete.IsFailure);
                Assert.Equal(ApplicationErrorCode.Conflict, staleCollectionDelete.Error!.Code);
                var removedCollection = await expressionRepository.DeleteCollectionAsync(collection.Id, collection.Revision, token);
                Assert.True(removedCollection.IsFailure);
                Assert.Equal(ApplicationErrorCode.Conflict, removedCollection.Error!.Code);
                var disposableCollection = Assert.Single(collections.Value, item => item.Name == "Descartável");
                var deletedDisposableCollection = await expressionRepository.DeleteCollectionAsync(disposableCollection.Id,
                    disposableCollection.Revision, token);
                Assert.True(deletedDisposableCollection.IsSuccess && deletedDisposableCollection.Value);
                var cascadedPreset = await expressionRepository.GetPresetAsync(sparePresetId, token);
                Assert.True(cascadedPreset.IsFailure);
                Assert.Equal(ApplicationErrorCode.NotFound, cascadedPreset.Error!.Code);

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
        new HairStyleRepositorySchemaMigration(), new FaceCatalogRepositorySchemaMigration(), new FaceExpressionRepositorySchemaMigration(),
        new FacePublicationSchemaMigration()
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
