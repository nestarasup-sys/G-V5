using GV5.Application.Contracts;
using Microsoft.Data.Sqlite;

namespace GV5.Data.Storage;

/// <summary>Owns per-user database initialization and the process-wide SQLite write policy.</summary>
public sealed class SqliteDatabase : IGv5Database, IDisposable
{
    public const int BusyTimeoutMilliseconds = 5000;

    private readonly IAppDataPaths _paths;
    private readonly string _connectionString;
    private readonly SemaphoreSlim _writer = new(1, 1);
    private readonly SemaphoreSlim _initialization = new(1, 1);
    private bool _journalModeInitialized;
    private bool _disposed;

    public SqliteDatabase(IAppDataPaths paths)
    {
        _paths = paths ?? throw new ArgumentNullException(nameof(paths));
        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = _paths.DatabaseFile,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Pooling = false,
            DefaultTimeout = BusyTimeoutMilliseconds / 1000
        }.ToString();
    }

    /// <summary>Opens a connection that SQLite itself prevents from changing database contents.</summary>
    public async Task<SqliteConnection> OpenReadConnectionAsync(CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        var connection = await OpenConfiguredConnectionAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await ExecutePragmaAsync(connection, "PRAGMA query_only = ON;", cancellationToken).ConfigureAwait(false);
            return connection;
        }
        catch
        {
            await connection.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }

    /// <summary>Runs one immediate transaction under the singleton writer gate.</summary>
    public async Task<TResult> ExecuteWriteAsync<TResult>(
        Func<SqliteConnection, SqliteTransaction, CancellationToken, Task<TResult>> operation,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(operation);
        ThrowIfDisposed();
        await _writer.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await using var connection = await OpenConfiguredConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var transaction = connection.BeginTransaction(deferred: false);
            var result = await operation(connection, transaction, cancellationToken).ConfigureAwait(false);
            await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
            return result;
        }
        finally
        {
            _writer.Release();
        }
    }

    /// <summary>Uses SQLite's online backup API so committed WAL pages are copied as one consistent snapshot.</summary>
    public async Task BackupDatabaseToAsync(string destinationFile, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(destinationFile);
        ThrowIfDisposed();
        var fullDestination = Path.GetFullPath(destinationFile);
        if (string.Equals(fullDestination, Path.GetFullPath(_paths.DatabaseFile), StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException("A backup destination must differ from the source database.", nameof(destinationFile));
        }

        if (File.Exists(fullDestination))
        {
            throw new IOException("The backup destination already exists; it will not be overwritten.");
        }

        Directory.CreateDirectory(Path.GetDirectoryName(fullDestination)!);
        await _writer.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await using var source = await OpenConfiguredConnectionAsync(cancellationToken).ConfigureAwait(false);
            var builder = new SqliteConnectionStringBuilder
            {
                DataSource = fullDestination,
                Mode = SqliteOpenMode.ReadWriteCreate,
                Pooling = false,
                DefaultTimeout = BusyTimeoutMilliseconds / 1000
            };
            await using var destination = new SqliteConnection(builder.ToString());
            await destination.OpenAsync(cancellationToken).ConfigureAwait(false);
            await Task.Run(() => source.BackupDatabase(destination), cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _writer.Release();
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _writer.Dispose();
        _initialization.Dispose();
    }

    private async Task<SqliteConnection> OpenConfiguredConnectionAsync(CancellationToken cancellationToken)
    {
        _paths.EnsureDirectoriesExist();
        var connection = new SqliteConnection(_connectionString);
        try
        {
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
            await ExecutePragmaAsync(connection, "PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;", cancellationToken).ConfigureAwait(false);
            await EnsureWalModeAsync(connection, cancellationToken).ConfigureAwait(false);
            return connection;
        }
        catch
        {
            await connection.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }

    private async Task EnsureWalModeAsync(SqliteConnection connection, CancellationToken cancellationToken)
    {
        if (_journalModeInitialized)
        {
            return;
        }

        await _initialization.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_journalModeInitialized)
            {
                return;
            }

            await using var command = connection.CreateCommand();
            command.CommandText = "PRAGMA journal_mode = WAL;";
            var mode = Convert.ToString(await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false));
            if (!string.Equals(mode, "wal", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException($"SQLite did not enable WAL mode (reported '{mode ?? "<null>"}').");
            }

            _journalModeInitialized = true;
        }
        finally
        {
            _initialization.Release();
        }
    }

    private static async Task ExecutePragmaAsync(SqliteConnection connection, string sql, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
    }
}
