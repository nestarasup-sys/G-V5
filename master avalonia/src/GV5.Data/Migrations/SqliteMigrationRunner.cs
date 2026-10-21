using System.Security.Cryptography;
using System.Text;
using GV5.Application.Contracts;
using GV5.Data.Storage;
using Microsoft.Data.Sqlite;

namespace GV5.Data.Migrations;

/// <summary>Applies an immutable contiguous migration sequence atomically and verifies stored checksums.</summary>
public sealed class SqliteMigrationRunner : IDataPlatformInitializer
{
    private readonly IGv5Database _database;
    private readonly ISqliteMigration[] _migrations;

    public SqliteMigrationRunner(IGv5Database database, IEnumerable<ISqliteMigration> migrations)
    {
        _database = database ?? throw new ArgumentNullException(nameof(database));
        ArgumentNullException.ThrowIfNull(migrations);
        _migrations = migrations.OrderBy(migration => migration.Version).ToArray();

        for (var index = 0; index < _migrations.Length; index++)
        {
            var expectedVersion = index + 1;
            if (_migrations[index].Version != expectedVersion)
            {
                throw new ArgumentException($"Migration sequence must be unique and contiguous from version 1; expected {expectedVersion}.", nameof(migrations));
            }
        }
    }

    public Task<MigrationRunResult> MigrateAsync(CancellationToken cancellationToken = default) =>
        _database.ExecuteWriteAsync(ApplyMigrationsAsync, cancellationToken);

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        await MigrateAsync(cancellationToken).ConfigureAwait(false);
    }

    private async Task<MigrationRunResult> ApplyMigrationsAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        CancellationToken cancellationToken)
    {
        await ExecuteAsync(connection, transaction, """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY CHECK (version >= 1),
                name TEXT NOT NULL,
                checksum TEXT NOT NULL CHECK (length(checksum) = 64),
                applied_utc_ms INTEGER NOT NULL CHECK (applied_utc_ms >= 0)
            );
            """, cancellationToken).ConfigureAwait(false);

        var applied = await ReadAppliedAsync(connection, transaction, cancellationToken).ConfigureAwait(false);
        var latestKnownVersion = _migrations.LastOrDefault()?.Version ?? 0;
        var latestAppliedVersion = applied.Keys.DefaultIfEmpty(0).Max();
        var appliedNow = new List<int>();
        if (latestAppliedVersion > latestKnownVersion)
        {
            throw new InvalidOperationException($"Database schema version {latestAppliedVersion} is newer than this application supports ({latestKnownVersion}).");
        }

        for (var index = 0; index < _migrations.Length; index++)
        {
            var migration = _migrations[index];
            var checksum = ComputeChecksum(migration);
            if (applied.TryGetValue(migration.Version, out var stored))
            {
                if (!string.Equals(stored.Name, migration.Name, StringComparison.Ordinal) ||
                    !string.Equals(stored.Checksum, checksum, StringComparison.Ordinal))
                {
                    throw new InvalidOperationException($"Applied migration {migration.Version} ({stored.Name}) does not match the registered migration ({migration.Name}).");
                }

                continue;
            }

            var expectedNext = latestAppliedVersion + 1;
            if (migration.Version != expectedNext)
            {
                throw new InvalidOperationException($"Cannot apply migration {migration.Version}; expected the next contiguous version {expectedNext}.");
            }

            await ExecuteAsync(connection, transaction, migration.UpSql, cancellationToken).ConfigureAwait(false);
            await using var insert = connection.CreateCommand();
            insert.Transaction = transaction;
            insert.CommandText = "INSERT INTO schema_migrations(version, name, checksum, applied_utc_ms) VALUES ($version, $name, $checksum, $applied);";
            insert.Parameters.AddWithValue("$version", migration.Version);
            insert.Parameters.AddWithValue("$name", migration.Name);
            insert.Parameters.AddWithValue("$checksum", checksum);
            insert.Parameters.AddWithValue("$applied", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            await insert.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            applied.Add(migration.Version, (migration.Name, checksum));
            latestAppliedVersion = migration.Version;
            appliedNow.Add(migration.Version);
        }

        return new MigrationRunResult(latestAppliedVersion, appliedNow);
    }

    private static async Task<Dictionary<int, (string Name, string Checksum)>> ReadAppliedAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        CancellationToken cancellationToken)
    {
        var applied = new Dictionary<int, (string Name, string Checksum)>();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT version, name, checksum FROM schema_migrations ORDER BY version;";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        var expectedVersion = 1;
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            var version = reader.GetInt32(0);
            if (version != expectedVersion++)
            {
                throw new InvalidOperationException($"Migration history has a gap before version {version}.");
            }

            applied.Add(version, (reader.GetString(1), reader.GetString(2)));
        }

        return applied;
    }

    private static string ComputeChecksum(ISqliteMigration migration)
    {
        var bytes = Encoding.UTF8.GetBytes($"{migration.Version}\n{migration.Name}\n{migration.UpSql}");
        return Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    }

    private static async Task ExecuteAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        string sql,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }
}
