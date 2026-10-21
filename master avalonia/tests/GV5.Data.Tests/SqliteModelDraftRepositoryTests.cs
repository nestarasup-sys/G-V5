using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Migrations;
using GV5.Data.Repositories;
using GV5.Data.Storage;
using Xunit;

namespace GV5.Data.Tests;

public sealed class SqliteModelDraftRepositoryTests
{
    [Fact]
    public async Task ConcurrentWriters_FromSameExpectedRevision_OnlyOneUpdateWins()
    {
        var root = NewTempRoot();
        var cancellationToken = TestContext.Current.CancellationToken;
        using var database = new SqliteDatabase(new AppDataPaths(root));

        try
        {
            await MigrateAsync(database, cancellationToken);
            var writerA = new SqliteModelDraftRepository(database);
            var writerB = new SqliteModelDraftRepository(database);
            var original = ModelDraft.Create("Versão inicial", 100);
            Assert.True((await writerA.CreateAsync(original, cancellationToken)).IsSuccess);

            var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var updateA = UpdateAfterStartAsync(writerA, original.Rename("Vencedor A", 200), original.Revision, ready.Task, cancellationToken);
            var updateB = UpdateAfterStartAsync(writerB, original.Rename("Vencedor B", 201), original.Revision, ready.Task, cancellationToken);
            ready.SetResult();

            var results = await Task.WhenAll(updateA, updateB);
            Assert.Single(results, result => result.IsSuccess);
            Assert.Single(results, result => result.IsFailure && result.Error?.Code == ApplicationErrorCode.Conflict);

            var latest = await writerA.GetAsync(original.Id, cancellationToken);
            Assert.True(latest.IsSuccess);
            Assert.Equal(Revision.From(2), latest.Value.Revision);
            Assert.Contains(latest.Value.Name, new[] { "Vencedor A", "Vencedor B" });
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task CreateGetUpdate_ReopenPreservesDraftAndDetectsStaleRevision()
    {
        var root = NewTempRoot();
        var paths = new AppDataPaths(root);
        var cancellationToken = TestContext.Current.CancellationToken;
        var draft = ModelDraft.Create("Modelo de teste", 1000);

        try
        {
            using (var database = new SqliteDatabase(paths))
            {
                await MigrateAsync(database, cancellationToken);
                await database.ExecuteWriteAsync(async (connection, transaction, token) =>
                {
                    await using var command = connection.CreateCommand();
                    command.Transaction = transaction;
                    command.CommandText = "CREATE TABLE model_update_audit (model_id TEXT NOT NULL, revision INTEGER NOT NULL); CREATE TRIGGER audit_model_update AFTER UPDATE ON models BEGIN INSERT INTO model_update_audit(model_id, revision) VALUES (NEW.model_id, NEW.revision); END;";
                    await command.ExecuteNonQueryAsync(token);
                    return true;
                }, cancellationToken);

                var repository = new SqliteModelDraftRepository(database);
                var created = await repository.CreateAsync(draft, cancellationToken);
                Assert.True(created.IsSuccess);
                Assert.Equal(draft, created.Value);

                var untouchedDraft = ModelDraft.Create("Outro modelo preservado", 1100);
                Assert.True((await repository.CreateAsync(untouchedDraft, cancellationToken)).IsSuccess);

                var fetched = await repository.GetAsync(draft.Id, cancellationToken);
                Assert.True(fetched.IsSuccess);
                Assert.Equal(draft, fetched.Value);

                var updatedDraft = draft.Rename("Modelo atualizado", 2000);
                var updated = await repository.UpdateAsync(updatedDraft, draft.Revision, cancellationToken);
                Assert.True(updated.IsSuccess);
                Assert.Equal(Revision.From(2), updated.Value.Revision);
                Assert.Equal("Modelo atualizado", updated.Value.Name);

                var noOpSave = await repository.UpdateAsync(updatedDraft, updatedDraft.Revision, cancellationToken);
                Assert.True(noOpSave.IsSuccess);

                var untouched = await repository.GetAsync(untouchedDraft.Id, cancellationToken);
                Assert.True(untouched.IsSuccess);
                Assert.Equal(untouchedDraft, untouched.Value);

                await using (var auditRead = await database.OpenReadConnectionAsync(cancellationToken))
                {
                    await using var audit = auditRead.CreateCommand();
                    audit.CommandText = "SELECT model_id, revision FROM model_update_audit;";
                    await using var auditRows = await audit.ExecuteReaderAsync(cancellationToken);
                    Assert.True(await auditRows.ReadAsync(cancellationToken));
                    Assert.Equal(draft.Id.ToString(), auditRows.GetString(0));
                    Assert.Equal(2, auditRows.GetInt64(1));
                    Assert.False(await auditRows.ReadAsync(cancellationToken));
                }

                var staleDraft = draft.Rename("Edição antiga", 3000);
                var stale = await repository.UpdateAsync(staleDraft, draft.Revision, cancellationToken);
                AssertFailure(stale, ApplicationErrorCode.Conflict);
            }

            using var reopenedDatabase = new SqliteDatabase(paths);
            await MigrateAsync(reopenedDatabase, cancellationToken);
            var reopenedRepository = new SqliteModelDraftRepository(reopenedDatabase);
            var reopened = await reopenedRepository.GetAsync(draft.Id, cancellationToken);

            Assert.True(reopened.IsSuccess);
            Assert.Equal(Revision.From(2), reopened.Value.Revision);
            Assert.Equal("Modelo atualizado", reopened.Value.Name);
            Assert.Equal(1000, reopened.Value.CreatedUtcMs);
            Assert.Equal(2000, reopened.Value.UpdatedUtcMs);
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task Repository_ReturnsTypedFailuresForDuplicateMissingAndInvalidOperations()
    {
        var root = NewTempRoot();
        var cancellationToken = TestContext.Current.CancellationToken;
        using var database = new SqliteDatabase(new AppDataPaths(root));

        try
        {
            await MigrateAsync(database, cancellationToken);
            var repository = new SqliteModelDraftRepository(database);
            var draft = ModelDraft.Create("Único", 100);
            Assert.True((await repository.CreateAsync(draft, cancellationToken)).IsSuccess);

            var duplicate = ModelDraft.Restore(draft.Id, Revision.Initial, draft.Name, draft.CreatedUtcMs, draft.UpdatedUtcMs);
            AssertFailure(await repository.CreateAsync(duplicate, cancellationToken), ApplicationErrorCode.Conflict);

            var current = draft.Rename("Atual", 200);
            Assert.True((await repository.UpdateAsync(current, draft.Revision, cancellationToken)).IsSuccess);

            AssertFailure(await repository.GetAsync(ModelId.New(), cancellationToken), ApplicationErrorCode.NotFound);
            AssertFailure(await repository.GetAsync(default, cancellationToken), ApplicationErrorCode.Validation);

            var missingDraft = ModelDraft.Create("Ausente", 100).Rename("Ausente alterado", 200);
            AssertFailure(await repository.UpdateAsync(missingDraft, Revision.Initial, cancellationToken), ApplicationErrorCode.NotFound);

            var forgedRevision = ModelDraft.Restore(draft.Id, Revision.From(3), draft.Name, 99, 300);
            AssertFailure(await repository.UpdateAsync(forgedRevision, Revision.From(2), cancellationToken), ApplicationErrorCode.Validation);

            var backwardTimestamp = ModelDraft.Restore(draft.Id, Revision.From(3), "Data antiga", 100, 150);
            var timestampFailure = await repository.UpdateAsync(backwardTimestamp, Revision.From(2), cancellationToken);
            AssertFailure(timestampFailure, ApplicationErrorCode.Validation);
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    private static Task<MigrationRunResult> MigrateAsync(SqliteDatabase database, CancellationToken cancellationToken) =>
        new SqliteMigrationRunner(database, [new InitialAssetSchemaMigration(), new ModelDraftSchemaMigration()])
            .MigrateAsync(cancellationToken);

    private static async Task<Result<ModelDraft>> UpdateAfterStartAsync(
        IModelDraftRepository repository,
        ModelDraft draft,
        Revision expectedRevision,
        Task start,
        CancellationToken cancellationToken)
    {
        await start.WaitAsync(cancellationToken);
        return await repository.UpdateAsync(draft, expectedRevision, cancellationToken);
    }

    private static void AssertFailure<T>(Result<T> result, ApplicationErrorCode expectedCode)
    {
        Assert.True(result.IsFailure);
        Assert.Equal(expectedCode, result.Error!.Code);
    }

    private static string NewTempRoot() => Path.Combine(Path.GetTempPath(), $"gv5-model-drafts-{Guid.NewGuid():N}");

    private static void DeleteTempRoot(string root)
    {
        if (Directory.Exists(root))
        {
            Directory.Delete(root, recursive: true);
        }
    }
}
