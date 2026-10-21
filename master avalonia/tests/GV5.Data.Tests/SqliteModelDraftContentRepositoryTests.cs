using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Assets;
using GV5.Data.Diagnostics;
using GV5.Data.Migrations;
using GV5.Data.Repositories;
using GV5.Data.Storage;
using GV5.Geometry;
using Microsoft.Data.Sqlite;
using SkiaSharp;
using Xunit;

namespace GV5.Data.Tests;

public sealed class SqliteModelDraftContentRepositoryTests
{
    [Fact]
    public async Task SaveAndReopen_RoundTripsTypedPieceMetadataAndSeparateAssetBytes()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = NewTempRoot();
        var paths = new AppDataPaths(root);
        var sourceBytes = CreatePng(48, 32, SKColors.LimeGreen);
        var firstPieceBytes = CreatePng(12, 10, SKColors.CornflowerBlue);
        var secondPieceBytes = CreatePng(8, 14, SKColors.OrangeRed);
        var modelId = ModelId.New();
        AssetMetadata sourceAsset;
        AssetMetadata firstPieceAsset;
        AssetMetadata secondPieceAsset;
        ModelDraftContent content;

        try
        {
            using (var database = new SqliteDatabase(paths))
            {
                var initializer = CreateInitializer(database);
                await initializer.InitializeAsync(cancellationToken);
                var assetStore = CreateAssetStore(paths, database, initializer);
                sourceAsset = await ImportAsync(assetStore, sourceBytes, cancellationToken);
                firstPieceAsset = await ImportAsync(assetStore, firstPieceBytes, cancellationToken);
                secondPieceAsset = await ImportAsync(assetStore, secondPieceBytes, cancellationToken);

                var drafts = new SqliteModelDraftRepository(database);
                var draft = ModelDraft.Create(modelId, "Modelo com peças", 1000);
                Assert.True((await drafts.CreateAsync(draft, cancellationToken)).IsSuccess);

                var firstPartId = ModelPartId.New();
                var secondPartId = ModelPartId.New();
                var firstTransform = new Transform2D(new Point2D(12.25, -4.5), new Point2D(1.2, 0.8), 0.35, new Point2D(5, 7), flipX: true);
                var secondTransform = new Transform2D(new Point2D(-9, 13), new Point2D(0.9, 1.1), -0.2, new Point2D(4, 6), flipY: true);
                var parts = new[]
                {
                    new ModelPart(
                        firstPartId,
                        "Tronco",
                        firstPieceAsset.Id,
                        new Rect2D(2, 3, 12, 10),
                        firstTransform,
                        new ModelPartSourceTransform(new Rect2D(4, 6, 12, 10), Transform2D.Identity),
                        isVisible: false),
                    new ModelPart(
                        secondPartId,
                        "Cabeça",
                        secondPieceAsset.Id,
                        new Rect2D(30, 2, 8, 14),
                        secondTransform,
                        new ModelPartSourceTransform(new Rect2D(30, 2, 8, 14), secondTransform))
                };
                content = ModelDraftContent.Restore(
                    ModelDraftContent.CurrentSchemaVersion,
                    modelId,
                    Revision.Initial,
                    ModelSlot.From(4),
                    sourceAsset.Id,
                    48,
                    32,
                    parts,
                    [secondPartId, firstPartId],
                    [new RigJoint(RigJointId.New(), TransformNodeId.From(firstPartId.Value), TransformNodeId.From(secondPartId.Value), new Point2D(21, 8), new Point2D(4, 7), RigJointMode.Fixed, true)]);

                var repository = new SqliteModelDraftContentRepository(database);
                var saved = await repository.SaveAsync(content, expectedRevision: null, cancellationToken);
                Assert.True(saved.IsSuccess, saved.Error?.Message);
                Assert.Equal(content, saved.Value);
                Assert.Equal(1L, await ScalarAsync(database, "SELECT COUNT(*) FROM model_draft_rig_joints WHERE model_id = $id;", cancellationToken, ("$id", modelId.ToString())));
                Assert.Equal(3L, await ScalarAsync(database, "SELECT COUNT(*) FROM asset_references WHERE owner_type = 'fabricator.model-draft' AND owner_id = $id;", cancellationToken, ("$id", modelId.ToString())));

                Assert.Equal(2L, await ScalarAsync(database, "SELECT COUNT(*) FROM model_draft_parts WHERE model_id = $id;", cancellationToken, ("$id", modelId.ToString())));
                Assert.Equal(2L, await ScalarAsync(database, "SELECT COUNT(DISTINCT asset_id) FROM model_draft_parts WHERE model_id = $id;", cancellationToken, ("$id", modelId.ToString())));

                using (var cancellation = new CancellationTokenSource())
                {
                    cancellation.Cancel();
                    var cancelledUpdate = content.WithParts([content.Parts[0]], [content.Parts[0].Id]);
                    await Assert.ThrowsAnyAsync<OperationCanceledException>(() => repository.GetAsync(modelId, cancellation.Token));
                    await Assert.ThrowsAnyAsync<OperationCanceledException>(() => repository.SaveAsync(cancelledUpdate, Revision.Initial, cancellation.Token));
                }
                var unchangedAfterCancellation = await repository.GetAsync(modelId, cancellationToken);
                Assert.True(unchangedAfterCancellation.IsSuccess, unchangedAfterCancellation.Error?.Message);
                AssertContentEqual(content, unchangedAfterCancellation.Value);
            }

            using (var reopenedDatabase = new SqliteDatabase(paths))
            {
                var initializer = CreateInitializer(reopenedDatabase);
                var repository = new SqliteModelDraftContentRepository(reopenedDatabase);
                var reopened = await repository.GetAsync(modelId, cancellationToken);

                Assert.True(reopened.IsSuccess, reopened.Error?.Message);
                AssertContentEqual(content, reopened.Value);
                Assert.Equal(content.RigJoints, reopened.Value.RigJoints);

                var sourceDuplicate = await new SqliteModelDraftRepository(reopenedDatabase).DuplicateAsync(modelId, "Cópia com rig", 1500, cancellationToken);
                Assert.True(sourceDuplicate.IsSuccess, sourceDuplicate.Error?.Message);
                var copiedRig = await repository.GetAsync(sourceDuplicate.Value.Id, cancellationToken);
                Assert.True(copiedRig.IsSuccess, copiedRig.Error?.Message);
                Assert.Equal(content.RigJoints, copiedRig.Value.RigJoints);

                var reopenedAssets = CreateAssetStore(paths, reopenedDatabase, initializer);
                await AssertAssetBytesAsync(reopenedAssets, sourceAsset.Id, sourceBytes, cancellationToken);
                await AssertAssetBytesAsync(reopenedAssets, firstPieceAsset.Id, firstPieceBytes, cancellationToken);
                await AssertAssetBytesAsync(reopenedAssets, secondPieceAsset.Id, secondPieceBytes, cancellationToken);

                var updated = content.WithParts([content.Parts[0]], [content.Parts[0].Id]);
                var savedUpdate = await repository.SaveAsync(updated, Revision.Initial, cancellationToken);
                Assert.True(savedUpdate.IsSuccess, savedUpdate.Error?.Message);
                Assert.Equal(Revision.From(2), savedUpdate.Value.Revision);
                Assert.Empty(savedUpdate.Value.RigJoints);
                Assert.Equal(2L, await ScalarAsync(reopenedDatabase, "SELECT COUNT(*) FROM asset_references WHERE owner_type = 'fabricator.model-draft' AND owner_id = $id;", cancellationToken, ("$id", modelId.ToString())));
                Assert.Equal(0L, await ScalarAsync(reopenedDatabase, "SELECT COUNT(*) FROM asset_gc_candidates WHERE asset_id = $id;", cancellationToken, ("$id", secondPieceAsset.Id.ToString())));

                var stale = await repository.SaveAsync(updated, Revision.Initial, cancellationToken);
                Assert.True(stale.IsFailure);
                Assert.Equal(ApplicationErrorCode.Conflict, stale.Error!.Code);
                Assert.Equal(Revision.From(2), (await repository.GetAsync(modelId, cancellationToken)).Value.Revision);

                var duplicateResult = await new SqliteModelDraftRepository(reopenedDatabase).DuplicateAsync(modelId, "Cópia completa", 2000, cancellationToken);
                Assert.True(duplicateResult.IsSuccess, duplicateResult.Error?.Message);
                var duplicateContent = await repository.GetAsync(duplicateResult.Value.Id, cancellationToken);
                Assert.True(duplicateContent.IsSuccess, duplicateContent.Error?.Message);
                Assert.Equal(Revision.Initial, duplicateContent.Value.Revision);
                Assert.Equal(duplicateResult.Value.Id, duplicateContent.Value.ModelId);
                Assert.Equal(updated.Parts.ToArray(), duplicateContent.Value.Parts.ToArray());
                Assert.Equal(updated.LayerOrder.ToArray(), duplicateContent.Value.LayerOrder.ToArray());
                Assert.Equal(updated.SourceAssetId, duplicateContent.Value.SourceAssetId);
                Assert.Equal(2L, await ScalarAsync(reopenedDatabase, "SELECT COUNT(*) FROM asset_references WHERE owner_type = 'fabricator.model-draft' AND owner_id = $id;", cancellationToken, ("$id", duplicateResult.Value.Id.ToString())));
                Assert.Equal(0L, await ScalarAsync(reopenedDatabase, "SELECT COUNT(*) FROM asset_gc_candidates WHERE asset_id = $id;", cancellationToken, ("$id", sourceAsset.Id.ToString())));
                Assert.Equal(0L, await ScalarAsync(reopenedDatabase, "SELECT COUNT(*) FROM asset_gc_candidates WHERE asset_id = $id;", cancellationToken, ("$id", firstPieceAsset.Id.ToString())));
                Assert.Equal(0L, await ScalarAsync(reopenedDatabase, "SELECT COUNT(*) FROM asset_gc_candidates WHERE asset_id = $id;", cancellationToken, ("$id", secondPieceAsset.Id.ToString())));
            }
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task SaveAsync_MissingAssetDoesNotPersistContentOrPartialReferences()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = NewTempRoot();
        var paths = new AppDataPaths(root);
        var modelId = ModelId.New();

        try
        {
            using var database = new SqliteDatabase(paths);
            var initializer = CreateInitializer(database);
            await initializer.InitializeAsync(cancellationToken);
            var drafts = new SqliteModelDraftRepository(database);
            Assert.True((await drafts.CreateAsync(ModelDraft.Create(modelId, "Sem asset", 10), cancellationToken)).IsSuccess);
            var sourceId = AssetId.New();
            var missing = ModelDraftContent.Restore(
                ModelDraftContent.CurrentSchemaVersion,
                modelId,
                Revision.Initial,
                ModelSlot.From(1),
                sourceId,
                20,
                20,
                [],
                []);

            var saved = await new SqliteModelDraftContentRepository(database).SaveAsync(missing, expectedRevision: null, cancellationToken);

            Assert.True(saved.IsFailure);
            Assert.Equal(ApplicationErrorCode.NotFound, saved.Error!.Code);
            Assert.Equal(0L, await ScalarAsync(database, "SELECT COUNT(*) FROM model_draft_contents WHERE model_id = $id;", cancellationToken, ("$id", modelId.ToString())));
            Assert.Equal(0L, await ScalarAsync(database, "SELECT COUNT(*) FROM asset_references WHERE owner_type = 'fabricator.model-draft' AND owner_id = $id;", cancellationToken, ("$id", modelId.ToString())));
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    private static async Task<AssetMetadata> ImportAsync(IAssetStore assetStore, byte[] bytes, CancellationToken cancellationToken)
    {
        var result = await assetStore.ImportAsync(new MemoryStream(bytes, writable: false), "image/png", cancellationToken);
        Assert.True(result.IsSuccess, result.Error?.Message);
        return result.Value;
    }

    private static async Task AssertAssetBytesAsync(IAssetStore assetStore, AssetId assetId, byte[] expected, CancellationToken cancellationToken)
    {
        var opened = await assetStore.OpenReadAsync(assetId, cancellationToken);
        Assert.True(opened.IsSuccess, opened.Error?.Message);
        await using var content = opened.Value;
        using var copy = new MemoryStream();
        await content.CopyToAsync(copy, cancellationToken);
        Assert.Equal(expected, copy.ToArray());
    }

    private static void AssertContentEqual(ModelDraftContent expected, ModelDraftContent actual)
    {
        Assert.Equal(expected.SchemaVersion, actual.SchemaVersion);
        Assert.Equal(expected.ModelId, actual.ModelId);
        Assert.Equal(expected.Revision, actual.Revision);
        Assert.Equal(expected.Slot, actual.Slot);
        Assert.Equal(expected.SourceAssetId, actual.SourceAssetId);
        Assert.Equal(expected.SourceWidth, actual.SourceWidth);
        Assert.Equal(expected.SourceHeight, actual.SourceHeight);
        Assert.Equal(expected.LayerOrder.ToArray(), actual.LayerOrder.ToArray());
        Assert.Equal(expected.RigJoints.ToArray(), actual.RigJoints.ToArray());
        Assert.Equal(expected.Parts.ToArray(), actual.Parts.ToArray());
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

    private static SqliteAssetStore CreateAssetStore(AppDataPaths paths, SqliteDatabase database, SqliteMigrationRunner initializer)
    {
        var correlation = new OperationCorrelationContext();
        var pipeline = new SqliteAssetImportPipeline(paths, database, initializer, new StructuredFileLogger(paths, correlation), correlation);
        return new SqliteAssetStore(pipeline, database, initializer);
    }

    private static async Task<long> ScalarAsync(SqliteDatabase database, string sql, CancellationToken cancellationToken, params (string Name, object Value)[] parameters)
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

    private static byte[] CreatePng(int width, int height, SKColor color)
    {
        using var bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Unpremul));
        bitmap.Erase(color);
        using var image = SKImage.FromBitmap(bitmap);
        using var encoded = image.Encode(SKEncodedImageFormat.Png, 100);
        return encoded.ToArray();
    }

    private static string NewTempRoot() => Path.Combine(Path.GetTempPath(), $"gv5-model-content-{Guid.NewGuid():N}");

    private static void DeleteTempRoot(string root)
    {
        if (Directory.Exists(root))
        {
            Directory.Delete(root, recursive: true);
        }
    }
}
