using GV5.Core.Models;
using GV5.Data.Migrations;
using GV5.Data.Repositories;
using GV5.Data.Storage;
using Xunit;

namespace GV5.Data.Tests;

public sealed class ModelSlotSchemaMigrationTests
{
    [Fact]
    public async Task MigrationKeepsNewestDuplicateSlotAndEnforcesOneDraftPerSlot()
    {
        var root = Path.Combine(Path.GetTempPath(), $"gv5-model-slots-{Guid.NewGuid():N}");
        var paths = new AppDataPaths(root);
        var cancellationToken = TestContext.Current.CancellationToken;
        var older = ModelDraft.Create("Modelo antigo", 100);
        var metadataOnly = ModelDraft.Create("Modelo sem conteúdo", 150);
        var newer = ModelDraft.Create("Modelo recente", 200);

        try
        {
            using var database = new SqliteDatabase(paths);
            await new SqliteMigrationRunner(database, Migrations(includeSlots: false)).MigrateAsync(cancellationToken);
            var drafts = new SqliteModelDraftRepository(database);
            Assert.True((await drafts.CreateAsync(older, cancellationToken)).IsSuccess);
            Assert.True((await drafts.CreateAsync(metadataOnly, cancellationToken)).IsSuccess);
            Assert.True((await drafts.CreateAsync(newer, cancellationToken)).IsSuccess);
            await database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = """
                    INSERT INTO model_draft_contents(model_id, content_revision, schema_version, slot, updated_utc_ms)
                    VALUES ($older, 1, 1, 3, 100), ($newer, 1, 1, 3, 200);
                    """;
                command.Parameters.AddWithValue("$older", older.Id.ToString());
                command.Parameters.AddWithValue("$newer", newer.Id.ToString());
                await command.ExecuteNonQueryAsync(token);
                return true;
            }, cancellationToken);

            await new SqliteMigrationRunner(database, Migrations(includeSlots: true)).MigrateAsync(cancellationToken);

            var slotRepository = new SqliteModelSlotRepository(database);
            var migrated = await slotRepository.ListAsync(cancellationToken);
            Assert.True(migrated.IsSuccess);
            Assert.Collection(migrated.Value,
                entry =>
                {
                    Assert.Equal(ModelSlot.From(1), entry.Slot);
                    Assert.Equal(metadataOnly.Id, entry.ModelId);
                },
                entry =>
                {
                    Assert.Equal(ModelSlot.From(2), entry.Slot);
                    Assert.Equal(older.Id, entry.ModelId);
                },
                entry =>
                {
                    Assert.Equal(ModelSlot.From(3), entry.Slot);
                    Assert.Equal(newer.Id, entry.ModelId);
                });

            var occupied = await slotRepository.AssignAsync(ModelSlot.From(3), older.Id, 300, cancellationToken);
            Assert.True(occupied.IsFailure);
            Assert.Equal(GV5.Application.Contracts.ApplicationErrorCode.Conflict, occupied.Error!.Code);
            var alreadyAssigned = await slotRepository.AssignAsync(ModelSlot.From(4), older.Id, 300, cancellationToken);
            Assert.True(alreadyAssigned.IsFailure);
            Assert.Equal(GV5.Application.Contracts.ApplicationErrorCode.Conflict, alreadyAssigned.Error!.Code);

            var conflictingDraft = ModelDraft.Create("Conflito atômico", 400);
            var createConflict = await drafts.CreateInSlotAsync(conflictingDraft, ModelSlot.From(3), cancellationToken);
            Assert.True(createConflict.IsFailure);
            Assert.Equal(GV5.Application.Contracts.ApplicationErrorCode.Conflict, createConflict.Error!.Code);
            var absent = await drafts.GetAsync(conflictingDraft.Id, cancellationToken);
            Assert.True(absent.IsFailure);
            Assert.Equal(GV5.Application.Contracts.ApplicationErrorCode.NotFound, absent.Error!.Code);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task SlotAssignmentsSurviveClosingAndReopeningTheDatabase()
    {
        var root = Path.Combine(Path.GetTempPath(), $"gv5-model-slots-reopen-{Guid.NewGuid():N}");
        var paths = new AppDataPaths(root);
        var cancellationToken = TestContext.Current.CancellationToken;
        var draft = ModelDraft.Create("Slot persistente", 100);

        try
        {
            using (var database = new SqliteDatabase(paths))
            {
                await new SqliteMigrationRunner(database, Migrations(includeSlots: true)).MigrateAsync(cancellationToken);
                var repository = new SqliteModelDraftRepository(database);
                var created = await repository.CreateInSlotAsync(draft, ModelSlot.From(7), cancellationToken);
                Assert.True(created.IsSuccess, created.Error?.Message);
            }

            using var reopened = new SqliteDatabase(paths);
            await new SqliteMigrationRunner(reopened, Migrations(includeSlots: true)).MigrateAsync(cancellationToken);
            var entries = await new SqliteModelSlotRepository(reopened).ListAsync(cancellationToken);
            Assert.True(entries.IsSuccess, entries.Error?.Message);
            var slot = Assert.Single(entries.Value);
            Assert.Equal(ModelSlot.From(7), slot.Slot);
            Assert.Equal(draft.Id, slot.ModelId);
            Assert.Equal(draft.Name, slot.Name);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    private static ISqliteMigration[] Migrations(bool includeSlots)
    {
        var migrations = new List<ISqliteMigration>
        {
            new InitialAssetSchemaMigration(),
            new ModelDraftSchemaMigration(),
            new ModelDraftCheckpointSchemaMigration(),
            new AssetImportJournalSchemaMigration(),
            new AssetReferenceSchemaMigration(),
            new AssetGarbageCollectionSchemaMigration(),
            new ModelDraftContentSchemaMigration(),
            new ModelRevisionSchemaMigration(),
            new ModelRigJointSchemaMigration(),
            new PoseRepositorySchemaMigration(),
            new AnimationRepositorySchemaMigration(),
            new WardrobeRepositorySchemaMigration(),
            new HairStyleRepositorySchemaMigration(),
            new FaceCatalogRepositorySchemaMigration(),
            new FaceExpressionRepositorySchemaMigration(),
            new FacePublicationSchemaMigration(),
            new AnimationSlotsSchemaMigration()
        };
        if (includeSlots) migrations.Add(new ModelSlotSchemaMigration());
        return [.. migrations];
    }
}
