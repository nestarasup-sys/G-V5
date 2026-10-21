using Microsoft.Data.Sqlite;

namespace GV5.Data.Storage;

/// <summary>Central SQLite access point. Reads are query-only; writes are serialized transactions.</summary>
public interface IGv5Database
{
    Task<SqliteConnection> OpenReadConnectionAsync(CancellationToken cancellationToken = default);

    Task<TResult> ExecuteWriteAsync<TResult>(
        Func<SqliteConnection, SqliteTransaction, CancellationToken, Task<TResult>> operation,
        CancellationToken cancellationToken = default);
}
