using GV5.Data.Storage;
using Microsoft.Data.Sqlite;
using Xunit;

namespace GV5.Data.Tests;

public sealed class SqliteDatabaseTests
{
    [Fact]
    public async Task OpenReadConnection_UsesIsolatedFileAndDurableSqlitePolicy()
    {
        var root = NewTempRoot();
        var paths = new AppDataPaths(root);
        using var database = new SqliteDatabase(paths);
        var cancellationToken = TestContext.Current.CancellationToken;

        try
        {
            Assert.False(Directory.Exists(root));
            await using var connection = await database.OpenReadConnectionAsync(cancellationToken);

            Assert.True(File.Exists(paths.DatabaseFile));
            Assert.Equal(1L, await ScalarAsync(connection, "PRAGMA foreign_keys;", cancellationToken));
            Assert.Equal("wal", await ScalarAsync(connection, "PRAGMA journal_mode;", cancellationToken) as string);
            Assert.Equal(5000L, await ScalarAsync(connection, "PRAGMA busy_timeout;", cancellationToken));
            Assert.Equal(2L, await ScalarAsync(connection, "PRAGMA synchronous;", cancellationToken));
            Assert.Equal(1L, await ScalarAsync(connection, "PRAGMA query_only;", cancellationToken));

            await Assert.ThrowsAsync<SqliteException>(async () =>
            {
                await using var command = connection.CreateCommand();
                command.CommandText = "CREATE TABLE forbidden_write (id INTEGER);";
                await command.ExecuteNonQueryAsync(cancellationToken);
            });
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task ExecuteWriteAsync_CommitsAndForeignKeysRejectDanglingReferences()
    {
        var root = NewTempRoot();
        using var database = new SqliteDatabase(new AppDataPaths(root));
        var cancellationToken = TestContext.Current.CancellationToken;

        try
        {
            await database.ExecuteWriteAsync(async (connection, transaction, operationToken) =>
            {
                await ExecuteAsync(connection, transaction, "CREATE TABLE parent (id TEXT PRIMARY KEY);", operationToken);
                await ExecuteAsync(connection, transaction, "CREATE TABLE child (parent_id TEXT NOT NULL REFERENCES parent(id));", operationToken);
                return true;
            }, cancellationToken);

            await Assert.ThrowsAsync<SqliteException>(() => database.ExecuteWriteAsync(
                (connection, transaction, operationToken) => ExecuteAsync(connection, transaction,
                    "INSERT INTO child(parent_id) VALUES ('missing');", operationToken), cancellationToken));

            await database.ExecuteWriteAsync(async (connection, transaction, operationToken) =>
            {
                await ExecuteAsync(connection, transaction, "INSERT INTO parent(id) VALUES ('p1');", operationToken);
                await ExecuteAsync(connection, transaction, "INSERT INTO child(parent_id) VALUES ('p1');", operationToken);
                return true;
            }, cancellationToken);

            await using var read = await database.OpenReadConnectionAsync(cancellationToken);
            Assert.Equal(1L, await ScalarAsync(read, "SELECT COUNT(*) FROM child;", cancellationToken));
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task ExecuteWriteAsync_RollsBackWhenOperationFails()
    {
        var root = NewTempRoot();
        using var database = new SqliteDatabase(new AppDataPaths(root));
        var cancellationToken = TestContext.Current.CancellationToken;

        try
        {
            await database.ExecuteWriteAsync(async (connection, transaction, operationToken) =>
            {
                await ExecuteAsync(connection, transaction, "CREATE TABLE values_table (value TEXT NOT NULL);", operationToken);
                return true;
            }, cancellationToken);

            await Assert.ThrowsAsync<InvalidOperationException>(() => database.ExecuteWriteAsync<bool>(async (connection, transaction, operationToken) =>
            {
                await ExecuteAsync(connection, transaction, "INSERT INTO values_table(value) VALUES ('uncommitted');", operationToken);
                throw new InvalidOperationException("synthetic failure");
            }, cancellationToken));

            await using var read = await database.OpenReadConnectionAsync(cancellationToken);
            Assert.Equal(0L, await ScalarAsync(read, "SELECT COUNT(*) FROM values_table;", cancellationToken));
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task ExecuteWriteAsync_SerializesConcurrentWriters()
    {
        var root = NewTempRoot();
        using var database = new SqliteDatabase(new AppDataPaths(root));
        var cancellationToken = TestContext.Current.CancellationToken;
        var active = 0;
        var maximumActive = 0;

        try
        {
            var writes = Enumerable.Range(0, 5).Select(_ => database.ExecuteWriteAsync(async (connection, transaction, operationToken) =>
            {
                var current = Interlocked.Increment(ref active);
                UpdateMaximum(ref maximumActive, current);
                await Task.Delay(20, operationToken);
                Interlocked.Decrement(ref active);
                return true;
            }, cancellationToken));

            await Task.WhenAll(writes);
            Assert.Equal(1, maximumActive);
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    private static string NewTempRoot() => Path.Combine(Path.GetTempPath(), $"gv5-sqlite-{Guid.NewGuid():N}");

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

    private static async Task<bool> ExecuteAsync(SqliteConnection connection, SqliteTransaction transaction, string sql, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync(cancellationToken);
        return true;
    }

    private static void UpdateMaximum(ref int maximum, int value)
    {
        int current;
        do
        {
            current = Volatile.Read(ref maximum);
            if (current >= value)
            {
                return;
            }
        }
        while (Interlocked.CompareExchange(ref maximum, value, current) != current);
    }
}
