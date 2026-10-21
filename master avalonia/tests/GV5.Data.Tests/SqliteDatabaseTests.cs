using GV5.Data.Storage;
using GV5.Application.Contracts;
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

    [Fact]
    public async Task ExecuteWriteAsync_DiskFullRollsBackAndLeavesDatabaseIntegrityIntact()
    {
        var root = NewTempRoot();
        using var database = new SqliteDatabase(new AppDataPaths(root));
        var cancellationToken = TestContext.Current.CancellationToken;

        try
        {
            await database.ExecuteWriteAsync(async (connection, transaction, operationToken) =>
            {
                await ExecuteAsync(connection, transaction, "CREATE TABLE payloads (content BLOB NOT NULL);", operationToken);
                return true;
            }, cancellationToken);

            var fullError = await Assert.ThrowsAsync<SqliteException>(() => database.ExecuteWriteAsync(async (connection, transaction, operationToken) =>
            {
                var currentPageCount = Convert.ToInt32(await ScalarAsync(connection, "PRAGMA page_count;", operationToken));
                await ExecuteAsync(connection, transaction, $"PRAGMA max_page_count = {currentPageCount};", operationToken);
                await using var insert = connection.CreateCommand();
                insert.Transaction = transaction;
                insert.CommandText = "INSERT INTO payloads(content) VALUES ($content);";
                insert.Parameters.Add("$content", SqliteType.Blob).Value = new byte[1024 * 1024];
                await insert.ExecuteNonQueryAsync(operationToken);
                return true;
            }, cancellationToken));

            Assert.Equal(13, fullError.SqliteErrorCode);
            await using var read = await database.OpenReadConnectionAsync(cancellationToken);
            Assert.Equal(0L, await ScalarAsync(read, "SELECT COUNT(*) FROM payloads;", cancellationToken));
            Assert.Equal("ok", await ScalarAsync(read, "PRAGMA integrity_check;", cancellationToken) as string);
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task OpenReadConnection_WhenDataDirectoryAccessIsDenied_PropagatesFailureWithoutCreatingDatabase()
    {
        var root = NewTempRoot();
        var paths = new AccessDeniedAppDataPaths(root);
        using var database = new SqliteDatabase(paths);

        try
        {
            await Assert.ThrowsAsync<UnauthorizedAccessException>(() => database.OpenReadConnectionAsync(TestContext.Current.CancellationToken));
            Assert.Equal(1, paths.EnsureCallCount);
            Assert.False(File.Exists(paths.DatabaseFile));
        }
        finally
        {
            DeleteTempRoot(root);
        }
    }

    [Fact]
    public async Task ExecuteWriteAsync_CancellationAfterMutationRollsBackAndAllowsReopen()
    {
        var root = NewTempRoot();
        var paths = new AppDataPaths(root);
        var cancellationToken = TestContext.Current.CancellationToken;

        try
        {
            using (var database = new SqliteDatabase(paths))
            {
                await database.ExecuteWriteAsync(async (connection, transaction, operationToken) =>
                {
                    await ExecuteAsync(connection, transaction, "CREATE TABLE operations (id INTEGER PRIMARY KEY, value TEXT NOT NULL);", operationToken);
                    return true;
                }, cancellationToken);

                using var interrupted = new CancellationTokenSource();
                await Assert.ThrowsAnyAsync<OperationCanceledException>(() => database.ExecuteWriteAsync(async (connection, transaction, operationToken) =>
                {
                    await ExecuteAsync(connection, transaction, "INSERT INTO operations(value) VALUES ('must roll back');", operationToken);
                    interrupted.Cancel();
                    operationToken.ThrowIfCancellationRequested();
                    return true;
                }, interrupted.Token));
            }

            using var reopened = new SqliteDatabase(paths);
            await using var read = await reopened.OpenReadConnectionAsync(cancellationToken);
            Assert.Equal(0L, await ScalarAsync(read, "SELECT COUNT(*) FROM operations;", cancellationToken));
            Assert.Equal("ok", await ScalarAsync(read, "PRAGMA integrity_check;", cancellationToken) as string);
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

    private sealed class AccessDeniedAppDataPaths(string root) : IAppDataPaths
    {
        public int EnsureCallCount { get; private set; }
        public string Root { get; } = root;
        public string DatabaseDirectory => Path.Combine(Root, "database");
        public string DatabaseFile => Path.Combine(DatabaseDirectory, AppDataPaths.DatabaseFileName);
        public string AssetsDirectory => Path.Combine(Root, "assets");
        public string ThumbnailsDirectory => Path.Combine(Root, "thumbnails");
        public string ProjectsDirectory => Path.Combine(Root, "projects");
        public string BackupsDirectory => Path.Combine(Root, "backups");
        public string CacheDirectory => Path.Combine(Root, "cache");
        public string LogsDirectory => Path.Combine(Root, "logs");
        public string TempDirectory => Path.Combine(Root, "temp");

        public void EnsureDirectoriesExist()
        {
            EnsureCallCount++;
            throw new UnauthorizedAccessException("Synthetic access-denied fixture.");
        }
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
