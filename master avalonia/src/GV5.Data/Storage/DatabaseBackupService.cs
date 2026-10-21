using System.Security.Cryptography;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using GV5.Application.Contracts;
using Microsoft.Data.Sqlite;

namespace GV5.Data.Storage;

/// <summary>Versioned SQLite online backup, integrity verification and non-overwriting restore.</summary>
public sealed class DatabaseBackupService : IDataPlatformBackupService
{
    private const string ManifestFileName = "manifest.json";
    private const string DatabaseRelativePath = "database/gv5.sqlite3";
    private const string BackupFormat = "G-V5-SQLite-Backup";
    private const int CurrentFormatVersion = 1;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };

    private readonly IAppDataPaths _paths;
    private readonly SqliteDatabase _database;
    private readonly IDataPlatformInitializer _initializer;
    private readonly IStructuredDiagnosticLogger _logger;
    private readonly IOperationCorrelationContext _correlationContext;

    public DatabaseBackupService(
        IAppDataPaths paths,
        SqliteDatabase database,
        IDataPlatformInitializer initializer,
        IStructuredDiagnosticLogger logger,
        IOperationCorrelationContext correlationContext)
    {
        _paths = paths ?? throw new ArgumentNullException(nameof(paths));
        _database = database ?? throw new ArgumentNullException(nameof(database));
        _initializer = initializer ?? throw new ArgumentNullException(nameof(initializer));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _correlationContext = correlationContext ?? throw new ArgumentNullException(nameof(correlationContext));
    }

    public async Task<DataBackupArtifact> CreateAsync(CancellationToken cancellationToken = default)
    {
        using var scope = _correlationContext.BeginScope();
        var stopwatch = Stopwatch.StartNew();
        var backupDirectory = string.Empty;
        try
        {
            await _initializer.InitializeAsync(cancellationToken).ConfigureAwait(false);
            Directory.CreateDirectory(_paths.BackupsDirectory);
            var createdUtc = DateTimeOffset.UtcNow;
            var directoryName = $"gv5-backup-{createdUtc:yyyyMMdd'T'HHmmssfff'Z'}-{Guid.NewGuid():N}";
            backupDirectory = Path.Combine(_paths.BackupsDirectory, directoryName);
            Directory.CreateDirectory(backupDirectory);
            var databasePath = ResolveContainedPath(backupDirectory, DatabaseRelativePath);
            Directory.CreateDirectory(Path.GetDirectoryName(databasePath)!);

            await _database.BackupDatabaseToAsync(databasePath, cancellationToken).ConfigureAwait(false);
            var schemaVersion = await ReadSchemaVersionAsync(databasePath, cancellationToken).ConfigureAwait(false);
            await EnsureSqliteIntegrityAsync(databasePath, cancellationToken).ConfigureAwait(false);
            var sizeBytes = new FileInfo(databasePath).Length;
            var sha256 = await ComputeSha256Async(databasePath, cancellationToken).ConfigureAwait(false);
            var manifest = new BackupManifest(
                BackupFormat,
                CurrentFormatVersion,
                createdUtc,
                schemaVersion,
                [new BackupFile(DatabaseRelativePath, sizeBytes, sha256)]);

            var manifestPath = Path.Combine(backupDirectory, ManifestFileName);
            var temporaryManifestPath = manifestPath + ".tmp";
            await using (var stream = new FileStream(temporaryManifestPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await JsonSerializer.SerializeAsync(stream, manifest, JsonOptions, cancellationToken).ConfigureAwait(false);
                await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
                stream.Flush(flushToDisk: true);
            }

            File.Move(temporaryManifestPath, manifestPath);
            await _logger.WriteAsync(
                DiagnosticEventCode.BackupCreated,
                DiagnosticOutcome.Success,
                durationMilliseconds: stopwatch.ElapsedMilliseconds,
                cancellationToken: CancellationToken.None).ConfigureAwait(false);
            return new DataBackupArtifact(backupDirectory, databasePath, manifestPath, sha256, sizeBytes, createdUtc, schemaVersion);
        }
        catch (Exception exception)
        {
            try
            {
                if (!string.IsNullOrEmpty(backupDirectory) && Directory.Exists(backupDirectory))
                {
                    Directory.Delete(backupDirectory, recursive: true);
                }
            }
            catch (Exception cleanupException) when (cleanupException is IOException or UnauthorizedAccessException)
            {
                // Keep the original backup failure; the partial artifact has no manifest and cannot verify.
            }

            await _logger.WriteAsync(
                DiagnosticEventCode.BackupOperationFailed,
                exception is OperationCanceledException ? DiagnosticOutcome.Warning : DiagnosticOutcome.Failure,
                ClassifyFailure(exception),
                stopwatch.ElapsedMilliseconds,
                CancellationToken.None).ConfigureAwait(false);

            throw;
        }
    }

    public async Task<DataBackupVerification> VerifyAsync(string backupDirectory, CancellationToken cancellationToken = default)
    {
        using var scope = _correlationContext.BeginScope();
        var stopwatch = Stopwatch.StartNew();
        try
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(backupDirectory);
            var normalizedDirectory = Path.GetFullPath(backupDirectory);
            var manifestPath = Path.Combine(normalizedDirectory, ManifestFileName);
            await using var stream = new FileStream(manifestPath, FileMode.Open, FileAccess.Read, FileShare.Read, 4096, FileOptions.Asynchronous | FileOptions.SequentialScan);
            var manifest = await JsonSerializer.DeserializeAsync<BackupManifest>(stream, JsonOptions, cancellationToken).ConfigureAwait(false)
                ?? throw new InvalidDataException("The backup manifest is empty.");

            if (!string.Equals(manifest.Format, BackupFormat, StringComparison.Ordinal) || manifest.FormatVersion != CurrentFormatVersion)
            {
                throw new InvalidDataException("The backup format or version is not supported.");
            }

            if (manifest.SchemaVersion < 0 || manifest.Files is not { Length: 1 })
            {
                throw new InvalidDataException("The manifest must describe exactly one SQLite database file.");
            }

            var file = manifest.Files[0];
            if (!string.Equals(file.Path, DatabaseRelativePath, StringComparison.Ordinal) || file.SizeBytes < 0 || !IsSha256(file.Sha256))
            {
                throw new InvalidDataException("The manifest contains an invalid database entry.");
            }

            var databasePath = ResolveContainedPath(normalizedDirectory, file.Path);
            if (!File.Exists(databasePath))
            {
                throw new InvalidDataException("The database file listed in the manifest is missing.");
            }

            var actualSize = new FileInfo(databasePath).Length;
            if (actualSize != file.SizeBytes)
            {
                throw new InvalidDataException("The database size does not match the manifest.");
            }

            var actualHash = await ComputeSha256Async(databasePath, cancellationToken).ConfigureAwait(false);
            if (!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(actualHash), Convert.FromHexString(file.Sha256)))
            {
                throw new InvalidDataException("The database SHA-256 does not match the manifest.");
            }

            await EnsureSqliteIntegrityAsync(databasePath, cancellationToken).ConfigureAwait(false);
            var actualSchemaVersion = await ReadSchemaVersionAsync(databasePath, cancellationToken).ConfigureAwait(false);
            if (actualSchemaVersion != manifest.SchemaVersion)
            {
                throw new InvalidDataException("The SQLite schema version does not match the manifest.");
            }

            var artifact = new DataBackupArtifact(
                normalizedDirectory,
                databasePath,
                manifestPath,
                actualHash,
                actualSize,
                manifest.CreatedUtc,
                manifest.SchemaVersion);
            return new DataBackupVerification(true, null, artifact);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException or InvalidDataException or ArgumentException or SqliteException)
        {
            await _logger.WriteAsync(
                DiagnosticEventCode.BackupVerificationFailed,
                DiagnosticOutcome.Failure,
                ClassifyFailure(exception),
                stopwatch.ElapsedMilliseconds,
                CancellationToken.None).ConfigureAwait(false);
            return new DataBackupVerification(false, exception.Message, null);
        }
    }

    public async Task<DataBackupRestoreResult> RestoreToNewRootAsync(
        string backupDirectory,
        string destinationRoot,
        CancellationToken cancellationToken = default)
    {
        using var scope = _correlationContext.BeginScope();
        var stopwatch = Stopwatch.StartNew();
        var temporaryPath = string.Empty;
        try
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(destinationRoot);
            var verification = await VerifyAsync(backupDirectory, cancellationToken).ConfigureAwait(false);
            if (!verification.IsValid || verification.Artifact is null)
            {
                throw new InvalidDataException($"Backup verification failed: {verification.Error}");
            }

            var destination = new AppDataPaths(destinationRoot);
            if (File.Exists(destination.DatabaseFile))
            {
                throw new IOException("Restore destination already contains a database; existing data was not overwritten.");
            }

            Directory.CreateDirectory(destination.DatabaseDirectory);
            temporaryPath = destination.DatabaseFile + $".{Guid.NewGuid():N}.restore-tmp";
            File.Copy(verification.Artifact.DatabasePath, temporaryPath, overwrite: false);
            var restoredHash = await ComputeSha256Async(temporaryPath, cancellationToken).ConfigureAwait(false);
            if (!CryptographicOperations.FixedTimeEquals(
                    Convert.FromHexString(restoredHash),
                    Convert.FromHexString(verification.Artifact.Sha256)))
            {
                throw new InvalidDataException("The restored database hash differs from the verified backup.");
            }

            await EnsureSqliteIntegrityAsync(temporaryPath, cancellationToken).ConfigureAwait(false);
            File.Move(temporaryPath, destination.DatabaseFile, overwrite: false);
            await _logger.WriteAsync(
                DiagnosticEventCode.BackupRestored,
                DiagnosticOutcome.Success,
                durationMilliseconds: stopwatch.ElapsedMilliseconds,
                cancellationToken: CancellationToken.None).ConfigureAwait(false);
            return new DataBackupRestoreResult(destination.DatabaseFile, destination.Root, verification.Artifact.SchemaVersion);
        }
        catch (Exception exception)
        {
            try
            {
                if (!string.IsNullOrEmpty(temporaryPath) && File.Exists(temporaryPath))
                {
                    File.Delete(temporaryPath);
                }
            }
            catch (Exception cleanupException) when (cleanupException is IOException or UnauthorizedAccessException)
            {
                // Keep the original restore failure; no partial database is installed at the destination.
            }

            await _logger.WriteAsync(
                DiagnosticEventCode.BackupOperationFailed,
                exception is OperationCanceledException ? DiagnosticOutcome.Warning : DiagnosticOutcome.Failure,
                ClassifyFailure(exception),
                stopwatch.ElapsedMilliseconds,
                CancellationToken.None).ConfigureAwait(false);

            throw;
        }
    }

    private static async Task<int> ReadSchemaVersionAsync(string databasePath, CancellationToken cancellationToken)
    {
        var builder = new SqliteConnectionStringBuilder { DataSource = databasePath, Mode = SqliteOpenMode.ReadOnly, Pooling = false };
        await using var connection = new SqliteConnection(builder.ToString());
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COALESCE(MAX(version), 0) FROM schema_migrations;";
        var result = await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
        return Convert.ToInt32(result);
    }

    private static async Task EnsureSqliteIntegrityAsync(string databasePath, CancellationToken cancellationToken)
    {
        var builder = new SqliteConnectionStringBuilder { DataSource = databasePath, Mode = SqliteOpenMode.ReadOnly, Pooling = false };
        await using var connection = new SqliteConnection(builder.ToString());
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await using (var integrity = connection.CreateCommand())
        {
            integrity.CommandText = "PRAGMA integrity_check;";
            var result = Convert.ToString(await integrity.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false));
            if (!string.Equals(result, "ok", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException($"SQLite integrity_check failed: {result ?? "<null>"}.");
            }
        }

        await using var foreignKeys = connection.CreateCommand();
        foreignKeys.CommandText = "PRAGMA foreign_key_check;";
        await using var reader = await foreignKeys.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            throw new InvalidDataException("SQLite foreign_key_check found an invalid reference.");
        }
    }

    private static async Task<string> ComputeSha256Async(string path, CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1024 * 64, FileOptions.Asynchronous | FileOptions.SequentialScan);
        return Convert.ToHexString(await SHA256.HashDataAsync(stream, cancellationToken).ConfigureAwait(false)).ToLowerInvariant();
    }

    private static bool IsSha256(string? value) =>
        value is { Length: 64 } && value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');

    private static DiagnosticErrorCode ClassifyFailure(Exception exception) => exception switch
    {
        OperationCanceledException => DiagnosticErrorCode.Cancelled,
        UnauthorizedAccessException => DiagnosticErrorCode.AccessDenied,
        InvalidDataException => DiagnosticErrorCode.InvalidBackup,
        IOException => DiagnosticErrorCode.StorageFailure,
        SqliteException => DiagnosticErrorCode.StorageFailure,
        _ => DiagnosticErrorCode.Unknown
    };

    private static string ResolveContainedPath(string root, string relativePath)
    {
        if (Path.IsPathRooted(relativePath) || relativePath.Split('/', '\\').Any(segment => segment is ".." or "." or ""))
        {
            throw new InvalidDataException("A manifest path must be a normalized relative path.");
        }

        var normalizedRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var combined = Path.GetFullPath(Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar)));
        if (!combined.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("A manifest path escapes the backup directory.");
        }

        return combined;
    }

    private sealed record BackupManifest(
        string Format,
        int FormatVersion,
        DateTimeOffset CreatedUtc,
        int SchemaVersion,
        BackupFile[] Files);

    private sealed record BackupFile(string Path, long SizeBytes, string Sha256);
}
