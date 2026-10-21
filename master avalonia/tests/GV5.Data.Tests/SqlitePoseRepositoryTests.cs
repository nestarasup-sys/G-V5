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
using Xunit;

namespace GV5.Data.Tests;

public sealed class SqlitePoseRepositoryTests
{
    [Fact]
    public async Task PoseDraftsDuplicateAndImmutablePublicationsSurviveDatabaseReopen()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = Path.Combine(Path.GetTempPath(), $"gv5-pose-repository-{Guid.NewGuid():N}");
        var paths = new AppDataPaths(root);
        var modelId = ModelId.New();
        var partId = ModelPartId.New();
        var initialTransform = new Transform2D(new Point2D(2, 3), new Point2D(1, 1), 0, Point2D.Zero);
        PoseId poseId;
        Revision firstPosePublication;
        Revision secondPosePublication;

        try
        {
            using (var database = new SqliteDatabase(paths))
            {
                var initializer = CreateInitializer(database);
                await initializer.InitializeAsync(cancellationToken);
                var sourceAsset = await InsertAvailableAssetAsync(database, "pose-source", cancellationToken);
                var partAsset = await InsertAvailableAssetAsync(database, "pose-part", cancellationToken);
                var drafts = new SqliteModelDraftRepository(database);
                var modelDraft = ModelDraft.Create(modelId, "Modelo para poses", 100);
                Assert.True((await drafts.CreateAsync(modelDraft, cancellationToken)).IsSuccess);
                var part = new ModelPart(
                    partId,
                    "Braço esquerdo",
                    partAsset,
                    new Rect2D(0, 0, 8, 12),
                    initialTransform,
                    new ModelPartSourceTransform(new Rect2D(10, 10, 8, 12), initialTransform));
                var content = ModelDraftContent.Restore(
                    ModelDraftContent.CurrentSchemaVersion,
                    modelId,
                    Revision.Initial,
                    null,
                    sourceAsset,
                    32,
                    32,
                    [part],
                    [partId]);
                var contentRepository = new SqliteModelDraftContentRepository(database);
                Assert.True((await contentRepository.SaveAsync(content, null, cancellationToken)).IsSuccess);
                var modelRevisions = new SqliteModelRevisionRepository(database);
                var publishedModel = await new PublishModelRevisionService(drafts, contentRepository, modelRevisions)
                    .PublishAsync(modelId, 200, cancellationToken);
                Assert.True(publishedModel.IsSuccess, publishedModel.Error?.Message);

                var repository = new SqlitePoseRepository(database);
                var initialPose = PoseDraft.CreateFromModelRevision(publishedModel.Value, "Braço relaxado");
                var created = await repository.CreateAsync(initialPose, cancellationToken);
                Assert.True(created.IsSuccess, created.Error?.Message);
                poseId = created.Value.Id;
                Assert.Equal(initialPose.Model, created.Value.Model);
                Assert.Equal(initialPose.PartTransforms, created.Value.PartTransforms);
                Assert.Single((await repository.ListAsync(publishedModel.Value.Id, cancellationToken)).Value);

                var editedTransform = new Transform2D(new Point2D(7, -2), new Point2D(1.2, 0.8), 0.35, new Point2D(4, 6), flipX: true);
                var editedPose = created.Value.WithContent(
                    [PosePartTransform.Create(partId, editedTransform, isVisible: false)],
                    [],
                    [partId],
                    "Descanso");
                var saved = await repository.SaveAsync(editedPose, created.Value.Revision, cancellationToken);
                Assert.True(saved.IsSuccess, saved.Error?.Message);
                Assert.Equal(Revision.From(2), saved.Value.Revision);
                var staleSave = await repository.SaveAsync(editedPose, created.Value.Revision, cancellationToken);
                Assert.True(staleSave.IsFailure);
                Assert.Equal(ApplicationErrorCode.Conflict, staleSave.Error!.Code);

                var duplicate = await new DuplicatePoseService(repository)
                    .DuplicateAsync(poseId, "Braço relaxado cópia", cancellationToken);
                Assert.True(duplicate.IsSuccess, duplicate.Error?.Message);
                Assert.NotEqual(poseId, duplicate.Value.Id);
                Assert.Equal(saved.Value.Model, duplicate.Value.Model);
                Assert.Equal(saved.Value.PartTransforms, duplicate.Value.PartTransforms);
                Assert.Equal(Revision.Initial, duplicate.Value.Revision);

                var firstPublished = await repository.PublishAsync(poseId, saved.Value.Revision, 300, cancellationToken);
                Assert.True(firstPublished.IsSuccess, firstPublished.Error?.Message);
                Assert.Equal(Revision.Initial, firstPublished.Value.Revision);
                firstPosePublication = firstPublished.Value.Revision;
                var repeatedPublish = await repository.PublishAsync(poseId, saved.Value.Revision, 301, cancellationToken);
                Assert.True(repeatedPublish.IsSuccess, repeatedPublish.Error?.Message);
                Assert.Equal(firstPublished.Value.Id, repeatedPublish.Value.Id);

                var latestTransform = new Transform2D(new Point2D(-3, 9), new Point2D(0.9, 1.1), -0.2, new Point2D(1, 2));
                var latestDraft = saved.Value.WithContent(
                    [PosePartTransform.Create(partId, latestTransform, isVisible: true)],
                    [],
                    [partId],
                    "Alerta");
                var latestSave = await repository.SaveAsync(latestDraft, saved.Value.Revision, cancellationToken);
                Assert.True(latestSave.IsSuccess, latestSave.Error?.Message);
                var secondPublished = await repository.PublishAsync(poseId, latestSave.Value.Revision, 400, cancellationToken);
                Assert.True(secondPublished.IsSuccess, secondPublished.Error?.Message);
                Assert.Equal(Revision.From(2), secondPublished.Value.Revision);
                secondPosePublication = secondPublished.Value.Revision;
                Assert.NotEqual(firstPublished.Value.SnapshotSha256, secondPublished.Value.SnapshotSha256);
                Assert.Equal(editedTransform, firstPublished.Value.PartTransforms.Single().Transform);
                Assert.Equal(latestTransform, secondPublished.Value.PartTransforms.Single().Transform);

                var invalidModelReference = ModelRevisionReference.Restore(
                    ModelId.New(),
                    ModelRevisionId.New(),
                    Revision.Initial,
                    new string('a', 64));
                var invalidPose = PoseDraft.Create(invalidModelReference, "Referência ausente", [PosePartTransform.Create(ModelPartId.New(), Transform2D.Identity, true)]);
                var rejected = await repository.CreateAsync(invalidPose, cancellationToken);
                Assert.True(rejected.IsFailure);
                Assert.Equal(ApplicationErrorCode.NotFound, rejected.Error!.Code);
            }

            using (var reopened = new SqliteDatabase(paths))
            {
                await CreateInitializer(reopened).InitializeAsync(cancellationToken);
                var repository = new SqlitePoseRepository(reopened);
                var loadedDraft = await repository.GetAsync(poseId, cancellationToken);
                var listedDrafts = await repository.ListAsync((await new SqliteModelRevisionRepository(reopened)
                    .ListAsync(modelId, cancellationToken)).Value.Single().Id, cancellationToken);
                var first = await repository.GetPublishedAsync(poseId, firstPosePublication, cancellationToken);
                var second = await repository.GetPublishedAsync(poseId, secondPosePublication, cancellationToken);
                var publications = await repository.ListPublishedAsync(poseId, cancellationToken);

                Assert.True(loadedDraft.IsSuccess, loadedDraft.Error?.Message);
                Assert.True(listedDrafts.IsSuccess, listedDrafts.Error?.Message);
                Assert.Equal(2, listedDrafts.Value.Count);
                Assert.Equal(Revision.From(3), loadedDraft.Value.Revision);
                Assert.Equal(new Point2D(-3, 9), loadedDraft.Value.PartTransforms.Single().Transform.Translation);
                Assert.True(first.IsSuccess, first.Error?.Message);
                Assert.True(second.IsSuccess, second.Error?.Message);
                Assert.Equal(2, publications.Value.Count);
                Assert.Equal(new Point2D(7, -2), first.Value.PartTransforms.Single().Transform.Translation);
                Assert.Equal(new Point2D(-3, 9), second.Value.PartTransforms.Single().Transform.Translation);
                Assert.Equal(second.Value.SnapshotSha256, Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
                    (await ScalarStringAsync(reopened, "SELECT snapshot_json FROM pose_revisions WHERE pose_id = $pose AND revision = 2;", cancellationToken, ("$pose", poseId.ToString())))))).ToLowerInvariant());
            }
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task PoseDraftChecksumFailureIsReportedWithoutReturningAlteredData()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = Path.Combine(Path.GetTempPath(), $"gv5-pose-corruption-{Guid.NewGuid():N}");
        var paths = new AppDataPaths(root);

        try
        {
            using var database = new SqliteDatabase(paths);
            await CreateInitializer(database).InitializeAsync(cancellationToken);
            var sourceAsset = await InsertAvailableAssetAsync(database, "source-corruption", cancellationToken);
            var partAsset = await InsertAvailableAssetAsync(database, "part-corruption", cancellationToken);
            var modelId = ModelId.New();
            var drafts = new SqliteModelDraftRepository(database);
            var draft = ModelDraft.Create(modelId, "Modelo", 10);
            Assert.True((await drafts.CreateAsync(draft, cancellationToken)).IsSuccess);
            var partId = ModelPartId.New();
            var part = new ModelPart(partId, "Braço", partAsset, new Rect2D(0, 0, 5, 5), Transform2D.Identity,
                new ModelPartSourceTransform(new Rect2D(0, 0, 5, 5), Transform2D.Identity));
            var content = ModelDraftContent.Restore(ModelDraftContent.CurrentSchemaVersion, modelId, Revision.Initial, null, sourceAsset, 8, 8, [part], [partId]);
            var contents = new SqliteModelDraftContentRepository(database);
            Assert.True((await contents.SaveAsync(content, null, cancellationToken)).IsSuccess);
            var published = await new PublishModelRevisionService(drafts, contents, new SqliteModelRevisionRepository(database))
                .PublishAsync(modelId, 20, cancellationToken);
            Assert.True(published.IsSuccess, published.Error?.Message);
            var repository = new SqlitePoseRepository(database);
            var pose = await repository.CreateAsync(PoseDraft.CreateFromModelRevision(published.Value, "Teste"), cancellationToken);
            Assert.True(pose.IsSuccess, pose.Error?.Message);

            await database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                await using var update = connection.CreateCommand();
                update.Transaction = transaction;
                update.CommandText = "UPDATE pose_drafts SET pose_json = replace(pose_json, 'Teste', 'Outro') WHERE pose_id = $id;";
                update.Parameters.AddWithValue("$id", pose.Value.Id.ToString());
                return await update.ExecuteNonQueryAsync(token) == 1;
            }, cancellationToken);

            var loaded = await repository.GetAsync(pose.Value.Id, cancellationToken);
            Assert.True(loaded.IsFailure);
            Assert.Equal(ApplicationErrorCode.Persistence, loaded.Error!.Code);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
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
        new ModelRigJointSchemaMigration(),
        new PoseRepositorySchemaMigration()
    ]);

    private static async Task<AssetId> InsertAvailableAssetAsync(SqliteDatabase database, string value, CancellationToken cancellationToken)
    {
        var bytes = Encoding.UTF8.GetBytes(value);
        var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var id = AssetId.New();
        await database.ExecuteWriteAsync(async (connection, transaction, token) =>
        {
            await using var insert = connection.CreateCommand();
            insert.Transaction = transaction;
            insert.CommandText = "INSERT INTO assets(asset_id, sha256, relative_path, mime_type, byte_length, verification_state, created_utc_ms) VALUES ($id, $hash, $path, 'image/png', $length, 'available', 1);";
            insert.Parameters.AddWithValue("$id", id.ToString());
            insert.Parameters.AddWithValue("$hash", hash);
            insert.Parameters.AddWithValue("$path", $"assets/{hash}.png");
            insert.Parameters.AddWithValue("$length", bytes.Length);
            await insert.ExecuteNonQueryAsync(token);
            return true;
        }, cancellationToken);
        return id;
    }

    private static async Task<string> ScalarStringAsync(SqliteDatabase database, string sql, CancellationToken cancellationToken, params (string Name, object Value)[] parameters)
    {
        await using var connection = await database.OpenReadConnectionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value);
        return (string)(await command.ExecuteScalarAsync(cancellationToken))!;
    }
}
