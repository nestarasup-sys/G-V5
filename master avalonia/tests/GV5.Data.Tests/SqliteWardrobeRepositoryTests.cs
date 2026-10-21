using System.Security.Cryptography;
using System.Text;
using GV5.Application.Contracts;
using GV5.Application.Services;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Migrations;
using GV5.Data.Dependencies;
using GV5.Data.Repositories;
using GV5.Data.Storage;
using GV5.Geometry;
using Microsoft.Data.Sqlite;
using Xunit;

namespace GV5.Data.Tests;

public sealed class SqliteWardrobeRepositoryTests
{
    [Fact]
    public async Task DraftAndImmutablePublicationsRoundTripWithAssetAndModelReverseReferences()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = Path.Combine(Path.GetTempPath(), $"gv5-wardrobe-repository-{Guid.NewGuid():N}");
        var paths = new AppDataPaths(root);
        WardrobeId wardrobeId;
        Revision firstRevision;
        Revision secondRevision;
        ModelRevisionId modelRevisionId;
        AssetId garmentAsset;
        try
        {
            using (var database = new SqliteDatabase(paths))
            {
                await CreateInitializer(database).InitializeAsync(cancellationToken);
                var sourceAsset = await InsertAssetAsync(database, "model-source", cancellationToken);
                var partAsset = await InsertAssetAsync(database, "model-part", cancellationToken);
                garmentAsset = await InsertAssetAsync(database, "transparent-garment", cancellationToken);
                var modelId = ModelId.New();
                var modelDrafts = new SqliteModelDraftRepository(database);
                Assert.True((await modelDrafts.CreateAsync(ModelDraft.Create(modelId, "Modelo da roupa", 20), cancellationToken)).IsSuccess);
                var partId = ModelPartId.New();
                var crop = new Rect2D(0, 0, 12, 18);
                var transform = new Transform2D(new Point2D(8, 6), new Point2D(1.2, .9), .1, Point2D.Zero);
                var part = new ModelPart(partId, "Tronco", partAsset, crop, transform,
                    new ModelPartSourceTransform(crop, transform));
                var modelContent = ModelDraftContent.Restore(ModelDraftContent.CurrentSchemaVersion, modelId,
                    Revision.Initial, ModelSlot.From(1), sourceAsset, 32, 32, [part], [partId]);
                var contentRepository = new SqliteModelDraftContentRepository(database);
                Assert.True((await contentRepository.SaveAsync(modelContent, null, cancellationToken)).IsSuccess);
                var model = await new PublishModelRevisionService(modelDrafts, contentRepository,
                    new SqliteModelRevisionRepository(database)).PublishAsync(modelId, 10, cancellationToken);
                Assert.True(model.IsSuccess, model.Error?.Message);
                modelRevisionId = model.Value.Id;

                var poseRepository = new SqlitePoseRepository(database);
                var basePose = await poseRepository.CreateAsync(
                    PoseDraft.CreateFromModelRevision(model.Value, "Pose base"), cancellationToken);
                Assert.True(basePose.IsSuccess, basePose.Error?.Message);
                var animation = AnimationDraft.CreateFromPose(basePose.Value, "Animação vinculada");
                var animationResult = await new SqliteAnimationRepository(database).CreateAsync(animation, cancellationToken);
                Assert.True(animationResult.IsSuccess, animationResult.Error?.Message);

                var repository = new SqliteWardrobeRepository(database);
                var initial = WardrobeSet.Create(model.Value, "Uniforme");
                var created = await repository.CreateAsync(initial, cancellationToken);
                Assert.True(created.IsSuccess, created.Error?.Message);
                wardrobeId = created.Value.Id;
                var frame = WardrobeBoneFrame.FromTransform(part.Id.ToString(), crop, transform);
                var shirt = WardrobeComponent.Create("Blusa", WardrobeCategory.Shirt, part.Id, garmentAsset,
                    new Rect2D(4, 8, 18, 20), 3, frame);
                var firstDraft = created.Value.WithContent("Uniforme", [shirt]);
                var saved = await repository.SaveAsync(firstDraft, created.Value.Revision, cancellationToken);
                Assert.True(saved.IsSuccess, saved.Error?.Message);
                var stale = await repository.SaveAsync(firstDraft, created.Value.Revision, cancellationToken);
                Assert.True(stale.IsFailure);
                Assert.Equal(ApplicationErrorCode.Conflict, stale.Error!.Code);
                Assert.Equal(ApplicationErrorCode.Conflict,
                    (await repository.PublishAsync(wardrobeId, created.Value.Revision, 19, cancellationToken)).Error!.Code);

                var firstPublished = await repository.PublishAsync(wardrobeId, saved.Value.Revision, 20, cancellationToken);
                Assert.True(firstPublished.IsSuccess, firstPublished.Error?.Message);
                Assert.Equal(Revision.Initial, firstPublished.Value.Revision);
                firstRevision = firstPublished.Value.Revision;
                var repeated = await repository.PublishAsync(wardrobeId, saved.Value.Revision, 21, cancellationToken);
                Assert.True(repeated.IsSuccess, repeated.Error?.Message);
                Assert.Equal(firstPublished.Value.Id, repeated.Value.Id);

                var changed = shirt.WithPlacement(new Rect2D(10, 12, 22, 24), 12, frame);
                var secondDraft = saved.Value.WithContent("Uniforme", [changed]);
                var secondSave = await repository.SaveAsync(secondDraft, saved.Value.Revision, cancellationToken);
                Assert.True(secondSave.IsSuccess, secondSave.Error?.Message);
                var secondPublished = await repository.PublishAsync(wardrobeId, secondSave.Value.Revision, 30, cancellationToken);
                Assert.True(secondPublished.IsSuccess, secondPublished.Error?.Message);
                Assert.Equal(Revision.From(2), secondPublished.Value.Revision);
                secondRevision = secondPublished.Value.Revision;
                Assert.Equal(new Rect2D(4, 8, 18, 20), firstPublished.Value.Components.Single().Placement);
                Assert.Equal(new Rect2D(10, 12, 22, 24), secondPublished.Value.Components.Single().Placement);

                var dependencies = new SqliteFabricatorDependencyCatalog(database);
                var wardrobeAssessment = await dependencies.AssessDeletionAsync(
                    FabricatorResourceReference.For(wardrobeId), cancellationToken);
                Assert.True(wardrobeAssessment.IsSuccess, wardrobeAssessment.Error?.Message);
                Assert.True(wardrobeAssessment.Value.IsBlocked);
                Assert.Equal(2, wardrobeAssessment.Value.Usages.Count);
                var poseAssessment = await dependencies.AssessDeletionAsync(
                    FabricatorResourceReference.For(basePose.Value.Id), cancellationToken);
                Assert.True(poseAssessment.IsSuccess, poseAssessment.Error?.Message);
                Assert.True(poseAssessment.Value.IsBlocked);
                Assert.Contains(poseAssessment.Value.Usages, usage => usage.UsageType == "animation-draft");
                var modelAssessment = await dependencies.AssessDeletionAsync(
                    FabricatorResourceReference.For(model.Value.ModelId), cancellationToken);
                Assert.True(modelAssessment.IsSuccess, modelAssessment.Error?.Message);
                Assert.True(modelAssessment.Value.IsBlocked);
                Assert.Equal(5, modelAssessment.Value.Usages.Count);
                var blockedDelete = await repository.DeleteAsync(wardrobeId, secondSave.Value.Revision, cancellationToken);
                Assert.True(blockedDelete.IsFailure);
                Assert.Equal(ApplicationErrorCode.Conflict, blockedDelete.Error!.Code);

                var referenceCount = await ScalarInt64Async(database,
                    "SELECT COUNT(*) FROM asset_references WHERE asset_id = $asset AND owner_type IN ('fabricator.wardrobe-draft','fabricator.wardrobe-revision');",
                    cancellationToken, ("$asset", garmentAsset.ToString()));
                Assert.Equal(3, referenceCount);
                var reverseReferences = await new SqliteWardrobeRepository(database)
                    .ListPublishedForModelAsync(modelRevisionId, cancellationToken);
                Assert.True(reverseReferences.IsSuccess, reverseReferences.Error?.Message);
                Assert.Equal(2, reverseReferences.Value.Count);
                var catalog = new WardrobeCatalog(repository, new NoOpThumbnailService());
                var catalogPage = await catalog.GetPageAsync(WardrobeCatalogRequest.Create(
                    ModelRevisionReference.From(model.Value), pageSize: 10), cancellationToken);
                Assert.True(catalogPage.IsSuccess, catalogPage.Error?.Message);
                Assert.Equal(2, catalogPage.Value.Items.Count);
                Assert.All(catalogPage.Value.Items, item => Assert.Equal(wardrobeId, item.Publication.WardrobeId));
            }

            using (var reopened = new SqliteDatabase(paths))
            {
                await CreateInitializer(reopened).InitializeAsync(cancellationToken);
                var repository = new SqliteWardrobeRepository(reopened);
                var draft = await repository.GetAsync(wardrobeId, cancellationToken);
                var first = await repository.GetPublishedAsync(wardrobeId, firstRevision, cancellationToken);
                var second = await repository.GetPublishedAsync(wardrobeId, secondRevision, cancellationToken);
                var history = await repository.ListPublishedAsync(wardrobeId, cancellationToken);
                Assert.True(draft.IsSuccess, draft.Error?.Message);
                Assert.True(first.IsSuccess, first.Error?.Message);
                Assert.True(second.IsSuccess, second.Error?.Message);
                Assert.True(history.IsSuccess, history.Error?.Message);
                Assert.Equal(Revision.From(3), draft.Value.Revision);
                Assert.Equal(2, history.Value.Count);
                Assert.Equal(new Rect2D(4, 8, 18, 20), first.Value.Components.Single().Placement);
                Assert.Equal(new Rect2D(10, 12, 22, 24), second.Value.Components.Single().Placement);
                var json = await ScalarStringAsync(reopened,
                    "SELECT snapshot_json FROM wardrobe_revisions WHERE wardrobe_id = $id AND revision = 2;",
                    cancellationToken, ("$id", wardrobeId.ToString()));
                var storedHash = await ScalarStringAsync(reopened,
                    "SELECT snapshot_sha256 FROM wardrobe_revisions WHERE wardrobe_id = $id AND revision = 2;",
                    cancellationToken, ("$id", wardrobeId.ToString()));
                Assert.Equal(storedHash, Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json))).ToLowerInvariant());
                await Assert.ThrowsAsync<SqliteException>(() => ExecuteAsync(reopened,
                    "UPDATE wardrobe_revisions SET display_name = 'Mutado' WHERE wardrobe_id = $id AND revision = 1;",
                    cancellationToken, ("$id", wardrobeId.ToString())));
                await Assert.ThrowsAsync<SqliteException>(() => ExecuteAsync(reopened,
                    "DELETE FROM assets WHERE asset_id = $asset;", cancellationToken, ("$asset", garmentAsset.ToString())));
            }
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task PublishRejectsStaleDraftAndMissingAssetsWithoutPartialReferences()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = Path.Combine(Path.GetTempPath(), $"gv5-wardrobe-reject-{Guid.NewGuid():N}");
        try
        {
            using var database = new SqliteDatabase(new AppDataPaths(root));
            await CreateInitializer(database).InitializeAsync(cancellationToken);
            var source = await InsertAssetAsync(database, "source", cancellationToken);
            var partAsset = await InsertAssetAsync(database, "part", cancellationToken);
            var modelId = ModelId.New();
            var modelDrafts = new SqliteModelDraftRepository(database);
            Assert.True((await modelDrafts.CreateAsync(ModelDraft.Create(modelId, "Modelo", 10), cancellationToken)).IsSuccess);
            var partId = ModelPartId.New();
            var crop = new Rect2D(0, 0, 10, 12);
            var part = new ModelPart(partId, "Tronco", partAsset, crop, Transform2D.Identity,
                new ModelPartSourceTransform(crop, Transform2D.Identity));
            var contents = new SqliteModelDraftContentRepository(database);
            Assert.True((await contents.SaveAsync(ModelDraftContent.Restore(ModelDraftContent.CurrentSchemaVersion,
                modelId, Revision.Initial, ModelSlot.From(1), source, 20, 20, [part], [partId]), null, cancellationToken)).IsSuccess);
            var model = await new PublishModelRevisionService(modelDrafts, contents, new SqliteModelRevisionRepository(database))
                .PublishAsync(modelId, 10, cancellationToken);
            Assert.True(model.IsSuccess, model.Error?.Message);
            var repository = new SqliteWardrobeRepository(database);
            var initial = WardrobeSet.Create(model.Value, "Rascunho");
            Assert.True((await repository.CreateAsync(initial, cancellationToken)).IsSuccess);
            var frame = WardrobeBoneFrame.FromTransform(partId.ToString(), crop, Transform2D.Identity);
            var missing = WardrobeComponent.Create("Camisa", WardrobeCategory.Shirt, partId, AssetId.New(),
                new Rect2D(0, 0, 5, 6), 0, frame);
            var invalidDraft = initial.WithContent("Rascunho", [missing]);
            var missingAsset = await repository.SaveAsync(invalidDraft, initial.Revision, cancellationToken);
            Assert.True(missingAsset.IsFailure);
            Assert.Equal(ApplicationErrorCode.NotFound, missingAsset.Error!.Code);
            Assert.True((await repository.GetPublishedAsync(initial.Id, Revision.Initial, cancellationToken)).IsFailure);
            var garmentAsset = await InsertAssetAsync(database, "deletable-garment", cancellationToken);
            var deletionFrame = WardrobeBoneFrame.FromTransform(partId.ToString(), crop, Transform2D.Identity);
            var garment = WardrobeComponent.Create("Camisa temporária", WardrobeCategory.Shirt, partId,
                garmentAsset, new Rect2D(1, 2, 6, 8), 0, deletionFrame);
            var saved = await repository.SaveAsync(initial.WithContent("Rascunho", [garment]), initial.Revision, cancellationToken);
            Assert.True(saved.IsSuccess, saved.Error?.Message);
            var deleted = await repository.DeleteAsync(initial.Id, saved.Value.Revision, cancellationToken);
            Assert.True(deleted.IsSuccess, deleted.Error?.Message);
            Assert.True(deleted.Value);
            Assert.Equal(0, await ScalarInt64Async(database,
                "SELECT COUNT(*) FROM asset_references WHERE asset_id = $asset AND owner_type = 'fabricator.wardrobe-draft';",
                cancellationToken, ("$asset", garmentAsset.ToString())));
            Assert.Equal(1, await ScalarInt64Async(database,
                "SELECT COUNT(*) FROM asset_gc_candidates WHERE asset_id = $asset;",
                cancellationToken, ("$asset", garmentAsset.ToString())));
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
        new PoseRepositorySchemaMigration(), new AnimationRepositorySchemaMigration(), new WardrobeRepositorySchemaMigration()
    ]);

    private static async Task<AssetId> InsertAssetAsync(SqliteDatabase database, string value, CancellationToken token)
    {
        var bytes = Encoding.UTF8.GetBytes(value);
        var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var id = AssetId.New();
        await database.ExecuteWriteAsync(async (connection, transaction, cancellationToken) =>
        {
            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = "INSERT INTO assets(asset_id, sha256, relative_path, mime_type, byte_length, verification_state, created_utc_ms) VALUES ($id, $hash, $path, 'image/png', $length, 'available', 1);";
            command.Parameters.AddWithValue("$id", id.ToString());
            command.Parameters.AddWithValue("$hash", hash);
            command.Parameters.AddWithValue("$path", $"assets/{hash}.png");
            command.Parameters.AddWithValue("$length", bytes.Length);
            await command.ExecuteNonQueryAsync(cancellationToken);
            await using var candidate = connection.CreateCommand();
            candidate.Transaction = transaction;
            candidate.CommandText = "INSERT INTO asset_gc_candidates(asset_id, unreferenced_since_utc_ms) VALUES ($id, 1);";
            candidate.Parameters.AddWithValue("$id", id.ToString());
            await candidate.ExecuteNonQueryAsync(cancellationToken);
            return true;
        }, token);
        return id;
    }

    private static async Task<long> ScalarInt64Async(SqliteDatabase database, string sql, CancellationToken token,
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
        return (string)(await command.ExecuteScalarAsync(token) ?? throw new InvalidOperationException("Expected a scalar string."));
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

    private sealed class NoOpThumbnailService : IThumbnailService
    {
        public Task<Result<Stream>> GetOrCreateAsync(AssetId assetId, ThumbnailRecipe recipe, CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<Stream>.Success(new MemoryStream()));

        public Task<Result<IReadOnlyList<AssetThumbnailStream>>> GetVisibleWindowAsync(IReadOnlyList<AssetId> orderedAssetIds,
            int firstVisibleIndex, int visibleCount, ThumbnailRecipe recipe, int maximumPrefetch = 4,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(Result<IReadOnlyList<AssetThumbnailStream>>.Success(Array.Empty<AssetThumbnailStream>()));
    }
}
