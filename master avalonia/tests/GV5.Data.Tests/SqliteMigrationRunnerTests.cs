using GV5.Data.Migrations;
using GV5.Data.Storage;
using Microsoft.Data.Sqlite;
using Xunit;

namespace GV5.Data.Tests;

public sealed class SqliteMigrationRunnerTests
{
    [Fact]
    public async Task MigrateAsync_CreatesSchemaRecordsVersionAndDoesNotRepeatAfterReopen()
    {
        var root = NewTempRoot();
        var paths = new AppDataPaths(root);
        var cancellationToken = TestContext.Current.CancellationToken;

        try
        {
            MigrationRunResult firstRun;
            using (var firstDatabase = new SqliteDatabase(paths))
            {
                var runner = new SqliteMigrationRunner(firstDatabase, [new InitialAssetSchemaMigration()]);
                firstRun = await runner.MigrateAsync(cancellationToken);

                Assert.Equal(1, firstRun.CurrentVersion);
                Assert.Equal(new[] { 1 }, firstRun.AppliedVersions);

                await firstDatabase.ExecuteWriteAsync(async (connection, transaction, operationToken) =>
                {
                    await ExecuteAsync(connection, transaction, "INSERT INTO assets(asset_id, sha256, relative_path, mime_type, byte_length, verification_state, created_utc_ms) VALUES ($id, $hash, 'assets/test.bin', 'application/octet-stream', 4, 'available', 1);", operationToken,
                        ("$id", Guid.NewGuid().ToString("D")), ("$hash", new string('a', 64)));
                    return true;
                }, cancellationToken);
            }

            using var reopenedDatabase = new SqliteDatabase(paths);
            var reopenedRunner = new SqliteMigrationRunner(reopenedDatabase, [new InitialAssetSchemaMigration()]);
            var secondRun = await reopenedRunner.MigrateAsync(cancellationToken);
            await using var read = await reopenedDatabase.OpenReadConnectionAsync(cancellationToken);

            Assert.Equal(1, secondRun.CurrentVersion);
            Assert.Empty(secondRun.AppliedVersions);
            Assert.Equal(1L, await ScalarAsync(read, "SELECT COUNT(*) FROM schema_migrations;", cancellationToken));
            Assert.Equal(1L, await ScalarAsync(read, "SELECT COUNT(*) FROM assets WHERE relative_path = 'assets/test.bin';", cancellationToken));
            Assert.Equal("ok", await ScalarAsync(read, "PRAGMA integrity_check;", cancellationToken) as string);
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task MigrateAsync_RejectsChangedChecksumAndFutureSchema()
    {
        var root = NewTempRoot();
        var paths = new AppDataPaths(root);
        var cancellationToken = TestContext.Current.CancellationToken;

        try
        {
            using (var database = new SqliteDatabase(paths))
            {
                await new SqliteMigrationRunner(database,
                    [new SqliteMigration(1, "create_sample", "CREATE TABLE sample (id INTEGER PRIMARY KEY);")])
                    .MigrateAsync(cancellationToken);

                var changed = new SqliteMigrationRunner(database,
                    [new SqliteMigration(1, "create_sample", "CREATE TABLE sample (id TEXT PRIMARY KEY);")]);
                await Assert.ThrowsAsync<InvalidOperationException>(() => changed.MigrateAsync(cancellationToken));
            }

            using var reopenedDatabase = new SqliteDatabase(paths);
            var future = new SqliteMigrationRunner(reopenedDatabase, []);
            await Assert.ThrowsAsync<InvalidOperationException>(() => future.MigrateAsync(cancellationToken));
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task MigrateAsync_RollsBackSchemaAndHistoryWhenMigrationFails()
    {
        var root = NewTempRoot();
        var paths = new AppDataPaths(root);
        var cancellationToken = TestContext.Current.CancellationToken;
        using var database = new SqliteDatabase(paths);

        try
        {
            var broken = new SqliteMigrationRunner(database,
                [new SqliteMigration(1, "broken", "CREATE TABLE partial (id INTEGER); THIS IS NOT SQL;")]);
            await Assert.ThrowsAsync<SqliteException>(() => broken.MigrateAsync(cancellationToken));

            await using (var read = await database.OpenReadConnectionAsync(cancellationToken))
            {
                Assert.Equal(0L, await ScalarAsync(read,
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('schema_migrations', 'partial');",
                    cancellationToken));
            }

            var repaired = new SqliteMigrationRunner(database,
                [new SqliteMigration(1, "valid", "CREATE TABLE recovered (id INTEGER PRIMARY KEY);")]);
            var result = await repaired.MigrateAsync(cancellationToken);
            Assert.Equal(1, result.CurrentVersion);
            Assert.Equal(new[] { 1 }, result.AppliedVersions);
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public void Constructor_RejectsNonContiguousMigrationSequence()
    {
        using var database = new SqliteDatabase(new AppDataPaths(NewTempRoot()));
        Assert.Throws<ArgumentException>(() => new SqliteMigrationRunner(database,
            [new SqliteMigration(1, "one", "SELECT 1;"), new SqliteMigration(3, "three", "SELECT 3;")]));
    }

    private static string NewTempRoot() => Path.Combine(Path.GetTempPath(), $"gv5-migrations-{Guid.NewGuid():N}");

    private static void DeleteTempRoot(string root)
    {
        if (Directory.Exists(root))
        {
            Directory.Delete(root, recursive: true);
        }
    }

    private static async Task<object?> ScalarAsync(SqliteConnection connection, string sql, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        return await command.ExecuteScalarAsync(cancellationToken);
    }

    private static async Task<bool> ExecuteAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        string sql,
        CancellationToken cancellationToken,
        params (string Name, object Value)[] parameters)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }
        await command.ExecuteNonQueryAsync(cancellationToken);
        return true;
    }
}
