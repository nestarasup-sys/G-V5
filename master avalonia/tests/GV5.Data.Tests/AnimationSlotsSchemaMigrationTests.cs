using GV5.Data.Migrations;
using Microsoft.Data.Sqlite;
using Xunit;

namespace GV5.Data.Tests;

public sealed class AnimationSlotsSchemaMigrationTests
{
    [Fact]
    public async Task UpgradePreservesExistingDraftsAndBackfillsTwelveStableSlotsPerModel()
    {
        await using var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync(TestContext.Current.CancellationToken);
        await using (var setup = connection.CreateCommand())
        {
            setup.CommandText = """
                PRAGMA foreign_keys = ON;
                CREATE TABLE models(model_id TEXT PRIMARY KEY NOT NULL);
                CREATE TABLE model_revisions(revision_id TEXT PRIMARY KEY NOT NULL);
                CREATE TABLE animation_drafts(
                    animation_id TEXT PRIMARY KEY NOT NULL,
                    model_revision_id TEXT NOT NULL,
                    model_id TEXT NOT NULL,
                    updated_utc_ms INTEGER NOT NULL,
                    display_name TEXT NOT NULL,
                    UNIQUE(animation_id, model_id));
                INSERT INTO models VALUES ('model-a'), ('model-b');
                INSERT INTO model_revisions VALUES ('revision-a1'), ('revision-a2'), ('revision-b1');
                """;
            await setup.ExecuteNonQueryAsync(TestContext.Current.CancellationToken);
        }

        for (var index = 1; index <= 14; index++)
            await InsertDraftAsync(connection, $"animation-a-{index:00}", index <= 7 ? "revision-a1" : "revision-a2", "model-a", $"Anim {index:00}");
        await InsertDraftAsync(connection, "animation-b-01", "revision-b1", "model-b", "Outro modelo 1");
        await InsertDraftAsync(connection, "animation-b-02", "revision-b1", "model-b", "Outro modelo 2");

        await using (var migrate = connection.CreateCommand())
        {
            migrate.CommandText = new AnimationSlotsSchemaMigration().UpSql;
            await migrate.ExecuteNonQueryAsync(TestContext.Current.CancellationToken);
        }

        Assert.Equal(16, await ScalarIntAsync(connection, "SELECT COUNT(*) FROM animation_drafts;"));
        Assert.Equal(14, await ScalarIntAsync(connection, "SELECT COUNT(*) FROM animation_slots;"));
        Assert.Equal(12, await ScalarIntAsync(connection, "SELECT COUNT(*) FROM animation_slots WHERE model_id = 'model-a';"));
        Assert.Equal(2, await ScalarIntAsync(connection, "SELECT COUNT(*) FROM animation_slots WHERE model_id = 'model-b';"));
        Assert.Equal(1, await ScalarIntAsync(connection, "SELECT COUNT(*) FROM animation_slots WHERE model_id = 'model-a' AND slot_number = 1 AND animation_id = 'animation-a-01';"));
        Assert.Equal(1, await ScalarIntAsync(connection, "SELECT COUNT(*) FROM animation_slots WHERE model_id = 'model-a' AND slot_number = 12 AND animation_id = 'animation-a-12';"));
        Assert.Equal(0, await ScalarIntAsync(connection, "SELECT COUNT(*) FROM animation_slots WHERE animation_id = 'animation-a-13' OR animation_id = 'animation-a-14';"));
        Assert.Equal(0, await ScalarIntAsync(connection, "SELECT COUNT(*) FROM pragma_foreign_key_check;"));
    }

    private static async Task InsertDraftAsync(SqliteConnection connection, string id, string revisionId, string modelId, string name)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "INSERT INTO animation_drafts(animation_id, model_revision_id, model_id, updated_utc_ms, display_name) VALUES ($id, $revision, $model, 100, $name);";
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$revision", revisionId);
        command.Parameters.AddWithValue("$model", modelId);
        command.Parameters.AddWithValue("$name", name);
        await command.ExecuteNonQueryAsync(TestContext.Current.CancellationToken);
    }

    private static async Task<int> ScalarIntAsync(SqliteConnection connection, string sql)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        return Convert.ToInt32(await command.ExecuteScalarAsync(TestContext.Current.CancellationToken), System.Globalization.CultureInfo.InvariantCulture);
    }
}
