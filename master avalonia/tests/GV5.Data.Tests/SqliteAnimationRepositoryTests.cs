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

public sealed class SqliteAnimationRepositoryTests
{
    [Fact]
    public async Task AnimationDraftRoundTripsWithOptimisticRevisionAndChecksummedRigFrames()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var root = Path.Combine(Path.GetTempPath(), $"gv5-animation-repository-{Guid.NewGuid():N}");
        var paths = new AppDataPaths(root);
        var modelId = ModelId.New();
        AnimationId animationId;
        ModelRevisionId modelRevisionId;
        AnimationDraft savedAnimation;
        try
        {
            using (var database = new SqliteDatabase(paths))
            {
                var initializer = CreateInitializer(database);
                await initializer.InitializeAsync(cancellationToken);
                var source = await InsertAvailableAssetAsync(database, "animation-source", cancellationToken);
                var body = await InsertAvailableAssetAsync(database, "animation-body", cancellationToken);
                var arm = await InsertAvailableAssetAsync(database, "animation-arm", cancellationToken);
                var drafts = new SqliteModelDraftRepository(database);
                var draft = ModelDraft.Create(modelId, "Modelo de animação", 100);
                Assert.True((await drafts.CreateAsync(draft, cancellationToken)).IsSuccess);
                var bodyPart = CreatePart("Tronco", body, 0);
                var armPart = CreatePart("Braço", arm, 20);
                var joint = new RigJoint(RigJointId.New(), TransformNodeId.From(bodyPart.Id.Value),
                    TransformNodeId.From(armPart.Id.Value), new Point2D(10, 10), new Point2D(20, 10), RigJointMode.Fixed);
                var content = ModelDraftContent.Restore(ModelDraftContent.CurrentSchemaVersion, modelId, Revision.Initial,
                    null, source, 64, 64, [bodyPart, armPart], [bodyPart.Id, armPart.Id], [joint]);
                var contentRepository = new SqliteModelDraftContentRepository(database);
                Assert.True((await contentRepository.SaveAsync(content, null, cancellationToken)).IsSuccess);
                var modelRevisionRepository = new SqliteModelRevisionRepository(database);
                var published = await new PublishModelRevisionService(drafts, contentRepository, modelRevisionRepository)
                    .PublishAsync(modelId, 1234, cancellationToken);
                Assert.True(published.IsSuccess, published.Error?.Message);
                modelRevisionId = published.Value.Id;

                var repository = new SqliteAnimationRepository(database);
                var basePose = PoseDraft.CreateFromModelRevision(published.Value, "Base");
                var animation = AnimationDraft.CreateFromPose(basePose, "Aceno");
                var created = await repository.CreateAsync(animation, cancellationToken);
                Assert.True(created.IsSuccess, created.Error?.Message);
                animationId = created.Value.Id;
                Assert.Single((await repository.ListAsync(modelRevisionId, cancellationToken)).Value);

                var baseFrame = animation.Frames[0];
                var movedFrame = AnimationFrame.Create(400,
                    baseFrame.Keys.Select(key => key.PartId == armPart.Id
                        ? AnimationPartKey.Create(key.PartId, Transform(29), key.IsVisible)
                        : key),
                    baseFrame.RigJoints.Select(value => value with { ChildAnchor = new Point2D(29, 10) }));
                var edited = animation.WithContent("Aceno longo", basePose.Id, [baseFrame, movedFrame],
                    AnimationEasing.Smooth, AnimationLoopMode.PingPong, 1.25);
                var saved = await repository.SaveAsync(edited, created.Value.Revision, cancellationToken);
                Assert.True(saved.IsSuccess, saved.Error?.Message);
                Assert.Equal(Revision.From(2), saved.Value.Revision);
                var staleSave = await repository.SaveAsync(edited, created.Value.Revision, cancellationToken);
                Assert.True(staleSave.IsFailure);
                Assert.Equal(ApplicationErrorCode.Conflict, staleSave.Error!.Code);
                savedAnimation = saved.Value;
            }

            using (var reopenedDatabase = new SqliteDatabase(paths))
            {
                await CreateInitializer(reopenedDatabase).InitializeAsync(cancellationToken);
                var repository = new SqliteAnimationRepository(reopenedDatabase);
                var loaded = await repository.GetAsync(animationId, cancellationToken);
                Assert.True(loaded.IsSuccess, loaded.Error?.Message);
                Assert.Equal(savedAnimation.Id, loaded.Value.Id);
                Assert.Equal(savedAnimation.Model, loaded.Value.Model);
                Assert.Equal(savedAnimation.Name, loaded.Value.Name);
                Assert.Equal(savedAnimation.Frames.Select(frame => frame.DurationMs), loaded.Value.Frames.Select(frame => frame.DurationMs));
                Assert.Equal(savedAnimation.Frames.SelectMany(frame => frame.Keys).Select(key => key.Transform),
                    loaded.Value.Frames.SelectMany(frame => frame.Keys).Select(key => key.Transform));
                Assert.Equal(Revision.From(2), loaded.Value.Revision);
                var previewModel = await new SqliteModelRevisionRepository(reopenedDatabase)
                    .GetAsync(modelId, Revision.Initial, cancellationToken);
                Assert.True(previewModel.IsSuccess, previewModel.Error?.Message);
                Assert.Equal(Transform(29), loaded.Value.ApplyFrameToModelRevision(previewModel.Value, loaded.Value.Frames[1].Id)
                    .Parts.Single(part => part.Name == "Braço").Transform);

                await reopenedDatabase.ExecuteWriteAsync(async (connection, transaction, token) =>
                {
                    await using var update = connection.CreateCommand();
                    update.Transaction = transaction;
                    update.CommandText = "UPDATE animation_drafts SET animation_json = replace(animation_json, 'Aceno longo', 'Dados alterados') WHERE animation_id = $id;";
                    update.Parameters.AddWithValue("$id", animationId.ToString());
                    return await update.ExecuteNonQueryAsync(token) == 1;
                }, cancellationToken);
                var corrupted = await repository.GetAsync(animationId, cancellationToken);
                Assert.True(corrupted.IsFailure);
                Assert.Equal(ApplicationErrorCode.Persistence, corrupted.Error!.Code);
            }
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
        new PoseRepositorySchemaMigration(), new AnimationRepositorySchemaMigration()
    ]);

    private static async Task<AssetId> InsertAvailableAssetAsync(SqliteDatabase database, string value, CancellationToken cancellationToken)
    {
        var bytes = Encoding.UTF8.GetBytes(value);
        var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var id = AssetId.New();
        await database.ExecuteWriteAsync(async (connection, transaction, token) =>
        {
            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = "INSERT INTO assets(asset_id, sha256, relative_path, mime_type, byte_length, verification_state, created_utc_ms) VALUES ($id, $hash, $path, 'image/png', $length, 'available', 1);";
            command.Parameters.AddWithValue("$id", id.ToString());
            command.Parameters.AddWithValue("$hash", hash);
            command.Parameters.AddWithValue("$path", $"assets/{hash}.png");
            command.Parameters.AddWithValue("$length", bytes.Length);
            await command.ExecuteNonQueryAsync(token);
            return true;
        }, cancellationToken);
        return id;
    }

    private static ModelPart CreatePart(string name, AssetId assetId, double x)
    {
        var crop = new Rect2D(0, 0, 10, 10);
        var transform = Transform(x);
        return new ModelPart(ModelPartId.New(), name, assetId, crop, transform, new ModelPartSourceTransform(crop, transform));
    }

    private static Transform2D Transform(double x) => new(new Point2D(x, 0), new Point2D(1, 1), 0, Point2D.Zero);
}
