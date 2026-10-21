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

public sealed class SqliteModelRevisionRepositoryTests
{
    [Fact]
    public async Task PublishRejectsUnavailableReferencedAssetWithoutCreatingRevisionOrReferences()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = Path.Combine(Path.GetTempPath(), $"gv5-model-revision-missing-asset-{Guid.NewGuid():N}");
        var paths = new AppDataPaths(root);
        var modelId = ModelId.New();

        try
        {
            using var database = new SqliteDatabase(paths);
            await CreateInitializer(database).InitializeAsync(cancellationToken);
            var sourceAsset = await InsertAvailableAssetAsync(database, "available-source", cancellationToken);
            var partAsset = await InsertAvailableAssetAsync(database, "part-to-mark-missing", cancellationToken);
            var drafts = new SqliteModelDraftRepository(database);
            var draft = ModelDraft.Create(modelId, "Peça ausente", 10);
            Assert.True((await drafts.CreateAsync(draft, cancellationToken)).IsSuccess);
            var partId = ModelPartId.New();
            var part = new ModelPart(
                partId,
                "Cabeça",
                partAsset,
                new Rect2D(0, 0, 4, 4),
                Transform2D.Identity,
                new ModelPartSourceTransform(new Rect2D(0, 0, 4, 4), Transform2D.Identity));
            var content = ModelDraftContent.Restore(
                ModelDraftContent.CurrentSchemaVersion,
                modelId,
                Revision.Initial,
                null,
                sourceAsset,
                4,
                4,
                [part],
                [partId]);
            var contentRepository = new SqliteModelDraftContentRepository(database);
            Assert.True((await contentRepository.SaveAsync(content, null, cancellationToken)).IsSuccess);

            await database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = "UPDATE assets SET verification_state = 'missing' WHERE asset_id = $asset;";
                command.Parameters.AddWithValue("$asset", partAsset.ToString());
                return await command.ExecuteNonQueryAsync(token) == 1;
            }, cancellationToken);

            var failed = await new SqliteModelRevisionRepository(database).PublishAsync(draft, content, 20, cancellationToken);

            Assert.True(failed.IsFailure);
            Assert.Equal(ApplicationErrorCode.NotFound, failed.Error!.Code);
            Assert.Equal(0L, await ScalarAsync(database,
                "SELECT COUNT(*) FROM model_revisions WHERE model_id = $model;",
                cancellationToken,
                ("$model", modelId.ToString())));
            Assert.Equal(0L, await ScalarAsync(database,
                "SELECT COUNT(*) FROM asset_references WHERE owner_type = 'fabricator.model-revision';",
                cancellationToken));
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
    public async Task Publish_CreatesImmutableSnapshots_PinsAssets_AndIsIdempotent()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = Path.Combine(Path.GetTempPath(), $"gv5-model-revisions-{Guid.NewGuid():N}");
        var paths = new AppDataPaths(root);
        var modelId = ModelId.New();
        var partId = ModelPartId.New();
        var initialTransform = new Transform2D(new Point2D(2, 3), new Point2D(1, 1), 0.1, new Point2D(2, 2));
        AssetId sourceAsset;
        AssetId originalPartAsset;
        AssetId editedPartAsset;
        Revision firstPublishedRevision;
        Revision secondPublishedRevision;

        try
        {
            using (var database = new SqliteDatabase(paths))
            {
                var initializer = CreateInitializer(database);
                await initializer.InitializeAsync(cancellationToken);
                sourceAsset = await InsertAvailableAssetAsync(database, "source", cancellationToken);
                originalPartAsset = await InsertAvailableAssetAsync(database, "part-original", cancellationToken);
                editedPartAsset = await InsertAvailableAssetAsync(database, "part-edited", cancellationToken);

                var drafts = new SqliteModelDraftRepository(database);
                var draft = ModelDraft.Create(modelId, "Modelo versionado", 100);
                Assert.True((await drafts.CreateAsync(draft, cancellationToken)).IsSuccess);
                var part = new ModelPart(
                    partId,
                    "Tronco",
                    originalPartAsset,
                    new Rect2D(0, 0, 8, 8),
                    initialTransform,
                    new ModelPartSourceTransform(new Rect2D(0, 0, 8, 8), Transform2D.Identity));
                var initial = ModelDraftContent.Restore(
                    ModelDraftContent.CurrentSchemaVersion,
                    modelId,
                    Revision.Initial,
                    null,
                    sourceAsset,
                    8,
                    8,
                    [part],
                    [partId]);
                var contentRepository = new SqliteModelDraftContentRepository(database);
                Assert.True((await contentRepository.SaveAsync(initial, null, cancellationToken)).IsSuccess);

                var revisions = new SqliteModelRevisionRepository(database);
                var publishService = new PublishModelRevisionService(drafts, contentRepository, revisions);
                var firstPublish = await publishService.PublishAsync(modelId, 1000, cancellationToken);
                Assert.True(firstPublish.IsSuccess, firstPublish.Error?.Message);
                Assert.Equal(Revision.Initial, firstPublish.Value.Revision);
                firstPublishedRevision = firstPublish.Value.Revision;

                var editedTransform = new Transform2D(new Point2D(-4, 12), new Point2D(1.5, 0.8), -0.5, new Point2D(3, 4), flipX: true);
                var editedPart = new ModelPart(
                    part.Id,
                    part.Name,
                    editedPartAsset,
                    part.SourceCrop,
                    editedTransform,
                    part.SourceTransform,
                    isVisible: false);
                var edited = initial.WithParts([editedPart], [partId]);
                Assert.True((await contentRepository.SaveAsync(edited, initial.Revision, cancellationToken)).IsSuccess);
                Assert.Equal(0L, await ScalarAsync(database,
                    "SELECT COUNT(*) FROM asset_gc_candidates WHERE asset_id = $asset;",
                    cancellationToken,
                    ("$asset", originalPartAsset.ToString())));

                var stalePublish = await revisions.PublishAsync(draft, initial, 1100, cancellationToken);
                Assert.True(stalePublish.IsFailure);
                Assert.Equal(ApplicationErrorCode.Conflict, stalePublish.Error!.Code);

                var secondPublish = await publishService.PublishAsync(modelId, 1200, cancellationToken);
                Assert.True(secondPublish.IsSuccess, secondPublish.Error?.Message);
                Assert.Equal(Revision.From(2), secondPublish.Value.Revision);
                secondPublishedRevision = secondPublish.Value.Revision;
                Assert.Equal(editedTransform, secondPublish.Value.Content.Parts.Single().Transform);

                var duplicatePublish = await revisions.PublishAsync(draft, edited, 1300, cancellationToken);
                Assert.True(duplicatePublish.IsSuccess, duplicatePublish.Error?.Message);
                Assert.Equal(secondPublish.Value.Id, duplicatePublish.Value.Id);
                Assert.Equal(secondPublish.Value.Revision, duplicatePublish.Value.Revision);
                Assert.Equal(2L, await ScalarAsync(database,
                    "SELECT COUNT(*) FROM model_revisions WHERE model_id = $model;",
                    cancellationToken,
                    ("$model", modelId.ToString())));
                Assert.Equal(2L, await ScalarAsync(database,
                    "SELECT COUNT(*) FROM asset_references WHERE owner_type = 'fabricator.model-revision' AND owner_id = $owner;",
                    cancellationToken,
                    ("$owner", firstPublish.Value.Id.ToString())));

                await using var connection = await database.OpenReadConnectionAsync(cancellationToken);
                await using var update = connection.CreateCommand();
                update.CommandText = "UPDATE model_revisions SET display_name = 'Mutada' WHERE model_id = $model AND revision = 1;";
                update.Parameters.AddWithValue("$model", modelId.ToString());
                await Assert.ThrowsAsync<SqliteException>(() => update.ExecuteNonQueryAsync(cancellationToken));
                await using var delete = connection.CreateCommand();
                delete.CommandText = "DELETE FROM model_revisions WHERE model_id = $model AND revision = 1;";
                delete.Parameters.AddWithValue("$model", modelId.ToString());
                await Assert.ThrowsAsync<SqliteException>(() => delete.ExecuteNonQueryAsync(cancellationToken));
            }

            using (var reopenedDatabase = new SqliteDatabase(paths))
            {
                var revisions = new SqliteModelRevisionRepository(reopenedDatabase);
                var first = await revisions.GetAsync(modelId, firstPublishedRevision, cancellationToken);
                var second = await revisions.GetAsync(modelId, secondPublishedRevision, cancellationToken);
                var listed = await revisions.ListAsync(modelId, cancellationToken);

                Assert.True(first.IsSuccess, first.Error?.Message);
                Assert.True(second.IsSuccess, second.Error?.Message);
                Assert.True(listed.IsSuccess, listed.Error?.Message);
                Assert.Equal(2, listed.Value.Count);
                Assert.Equal(originalPartAsset, first.Value.Content.Parts.Single().AssetId);
                Assert.Equal(initialTransform, first.Value.Content.Parts.Single().Transform);
                Assert.True(first.Value.Content.Parts.Single().IsVisible);
                Assert.Equal(editedPartAsset, second.Value.Content.Parts.Single().AssetId);
                Assert.False(second.Value.Content.Parts.Single().IsVisible);
                Assert.Equal(secondPublishedRevision, second.Value.Revision);
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

    private static SqliteMigrationRunner CreateInitializer(SqliteDatabase database) => new(database,
    [
        new InitialAssetSchemaMigration(),
        new ModelDraftSchemaMigration(),
        new ModelDraftCheckpointSchemaMigration(),
        new AssetImportJournalSchemaMigration(),
        new AssetReferenceSchemaMigration(),
        new AssetGarbageCollectionSchemaMigration(),
        new ModelDraftContentSchemaMigration(),
        new ModelRevisionSchemaMigration(),
        new ModelRigJointSchemaMigration()
    ]);

    private static async Task<AssetId> InsertAvailableAssetAsync(SqliteDatabase database, string seed, CancellationToken cancellationToken)
    {
        var bytes = Encoding.UTF8.GetBytes(seed);
        var sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var assetId = AssetId.New();
        await database.ExecuteWriteAsync(async (connection, transaction, token) =>
        {
            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = "INSERT INTO assets(asset_id, sha256, relative_path, mime_type, byte_length, verification_state, created_utc_ms) VALUES ($id, $hash, $path, 'image/png', $length, 'available', 1);";
            command.Parameters.AddWithValue("$id", assetId.ToString());
            command.Parameters.AddWithValue("$hash", sha256);
            command.Parameters.AddWithValue("$path", $"assets/{sha256}.png");
            command.Parameters.AddWithValue("$length", bytes.Length);
            await command.ExecuteNonQueryAsync(token);
            return true;
        }, cancellationToken);
        return assetId;
    }

    private static async Task<long> ScalarAsync(
        SqliteDatabase database,
        string sql,
        CancellationToken cancellationToken,
        params (string Name, object Value)[] parameters)
    {
        await using var connection = await database.OpenReadConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        return Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken));
    }
}
