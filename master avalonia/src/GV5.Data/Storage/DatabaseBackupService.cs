using System.Security.Cryptography;
using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using GV5.Application.Contracts;
using Microsoft.Data.Sqlite;

namespace GV5.Data.Storage;

/// <summary>Versioned complete data-platform backup, integrity verification and non-overwriting restore.</summary>
public sealed class DatabaseBackupService : IDataPlatformBackupService
{
    private const string ManifestFileName = "manifest.json";
    private const string DatabaseRelativePath = "database/gv5.sqlite3";
    private const string BackupFormat = "G-V5-SQLite-Backup";
    private const int CurrentFormatVersion = 2;

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

            var files = new List<BackupFile>();
            await _database.BackupDatabaseAndFilesToAsync(databasePath, async token =>
            {
                var assetEntries = await ReadAssetEntriesAsync(databasePath, token).ConfigureAwait(false);
                foreach (var asset in assetEntries)
                {
                    var sourcePath = ResolveContainedPath(_paths.AssetsDirectory, asset.RelativePath);
                    var relativeBackupPath = $"assets/{asset.RelativePath}";
                    var destinationPath = ResolveContainedPath(backupDirectory, relativeBackupPath);
                    Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
                    if (!File.Exists(sourcePath) || new FileInfo(sourcePath).Length != asset.ByteLength)
                    {
                        throw new InvalidDataException($"Asset {asset.AssetId} is missing or has an unexpected size; a complete backup cannot be created.");
                    }

                    var sourceHash = await ComputeSha256Async(sourcePath, token).ConfigureAwait(false);
                    if (!string.Equals(sourceHash, asset.Sha256, StringComparison.Ordinal))
                    {
                        throw new InvalidDataException($"Asset {asset.AssetId} failed SHA-256 verification; a complete backup cannot be created.");
                    }

                    File.Copy(sourcePath, destinationPath, overwrite: false);
                    var copiedHash = await ComputeSha256Async(destinationPath, token).ConfigureAwait(false);
                    if (!string.Equals(copiedHash, asset.Sha256, StringComparison.Ordinal))
                    {
                        throw new InvalidDataException($"Asset {asset.AssetId} changed while the backup was being created.");
                    }

                    files.Add(new BackupFile(relativeBackupPath, asset.ByteLength, asset.Sha256));
                }
            }, cancellationToken).ConfigureAwait(false);
            var schemaVersion = await ReadSchemaVersionAsync(databasePath, cancellationToken).ConfigureAwait(false);
            await EnsureSqliteIntegrityAsync(databasePath, cancellationToken).ConfigureAwait(false);
            var sizeBytes = new FileInfo(databasePath).Length;
            var sha256 = await ComputeSha256Async(databasePath, cancellationToken).ConfigureAwait(false);
            files.Insert(0, new BackupFile(DatabaseRelativePath, sizeBytes, sha256));
            var manifest = new BackupManifest(
                BackupFormat,
                CurrentFormatVersion,
                createdUtc,
                schemaVersion,
                files.ToArray());

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
            var manifest = await ReadManifestAsync(manifestPath, cancellationToken).ConfigureAwait(false);

            if (!string.Equals(manifest.Format, BackupFormat, StringComparison.Ordinal) || manifest.FormatVersion is < 1 or > CurrentFormatVersion)
            {
                throw new InvalidDataException("The backup format or version is not supported.");
            }

            if (manifest.SchemaVersion < 0 || manifest.Files is not { Length: >= 1 })
            {
                throw new InvalidDataException("The manifest must describe a SQLite database file.");
            }

            var databaseFile = manifest.Files[0];
            if (!string.Equals(databaseFile.Path, DatabaseRelativePath, StringComparison.Ordinal) || databaseFile.SizeBytes < 0 || !IsSha256(databaseFile.Sha256))
            {
                throw new InvalidDataException("The manifest contains an invalid database entry.");
            }

            var databasePath = ResolveContainedPath(normalizedDirectory, databaseFile.Path);
            var manifestPaths = new HashSet<string>(StringComparer.Ordinal);
            foreach (var file in manifest.Files)
            {
                if (file.SizeBytes < 0 || !IsSha256(file.Sha256) || !manifestPaths.Add(file.Path))
                {
                    throw new InvalidDataException("The manifest contains a duplicate or invalid file entry.");
                }

                var filePath = ResolveContainedPath(normalizedDirectory, file.Path);
                if (!File.Exists(filePath))
                {
                    throw new InvalidDataException($"The file listed in the manifest is missing: {file.Path}.");
                }

                if (new FileInfo(filePath).Length != file.SizeBytes)
                {
                    throw new InvalidDataException($"The file size does not match the manifest: {file.Path}.");
                }

                var fileHash = await ComputeSha256Async(filePath, cancellationToken).ConfigureAwait(false);
                if (!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(fileHash), Convert.FromHexString(file.Sha256)))
                {
                    throw new InvalidDataException($"The SHA-256 does not match the manifest: {file.Path}.");
                }
            }

            await EnsureSqliteIntegrityAsync(databasePath, cancellationToken).ConfigureAwait(false);
            var actualSchemaVersion = await ReadSchemaVersionAsync(databasePath, cancellationToken).ConfigureAwait(false);
            if (actualSchemaVersion != manifest.SchemaVersion)
            {
                throw new InvalidDataException("The SQLite schema version does not match the manifest.");
            }

            var assets = await ReadAssetEntriesAsync(databasePath, cancellationToken).ConfigureAwait(false);
            if (manifest.FormatVersion == 1)
            {
                if (manifest.Files.Length != 1 || assets.Count != 0)
                {
                    throw new InvalidDataException("This legacy backup omits binary assets referenced by its database.");
                }
            }
            else
            {
                if (manifest.Files.Length != assets.Count + 1)
                {
                    throw new InvalidDataException("The backup manifest does not contain every binary asset recorded by SQLite.");
                }

                var filesByPath = manifest.Files.Skip(1).ToDictionary(file => file.Path, StringComparer.Ordinal);
                foreach (var asset in assets)
                {
                    var expectedPath = $"assets/{asset.RelativePath}";
                    if (!filesByPath.TryGetValue(expectedPath, out var assetFile) || assetFile.SizeBytes != asset.ByteLength || !string.Equals(assetFile.Sha256, asset.Sha256, StringComparison.Ordinal))
                    {
                        throw new InvalidDataException($"The backup is missing or mismatches asset {asset.AssetId}.");
                    }
                }
            }

            var artifact = new DataBackupArtifact(
                normalizedDirectory,
                databasePath,
                manifestPath,
                databaseFile.Sha256,
                databaseFile.SizeBytes,
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
        var stagingRoot = string.Empty;
        try
        {
            ArgumentException.ThrowIfNullOrWhiteSpace(destinationRoot);
            var verification = await VerifyAsync(backupDirectory, cancellationToken).ConfigureAwait(false);
            if (!verification.IsValid || verification.Artifact is null)
            {
                throw new InvalidDataException($"Backup verification failed: {verification.Error}");
            }

            var destination = new AppDataPaths(destinationRoot);
            if (Directory.Exists(destination.Root) || File.Exists(destination.Root))
            {
                throw new IOException("Restore destination must not exist; existing data was not overwritten.");
            }

            stagingRoot = destination.Root + $".{Guid.NewGuid():N}.restore-tmp";
            var staging = new AppDataPaths(stagingRoot);
            Directory.CreateDirectory(staging.DatabaseDirectory);
            var temporaryDatabasePath = staging.DatabaseFile;
            File.Copy(verification.Artifact.DatabasePath, temporaryDatabasePath, overwrite: false);
            var restoredHash = await ComputeSha256Async(temporaryDatabasePath, cancellationToken).ConfigureAwait(false);
            if (!CryptographicOperations.FixedTimeEquals(
                    Convert.FromHexString(restoredHash),
                    Convert.FromHexString(verification.Artifact.Sha256)))
            {
                throw new InvalidDataException("The restored database hash differs from the verified backup.");
            }

            await EnsureSqliteIntegrityAsync(temporaryDatabasePath, cancellationToken).ConfigureAwait(false);
            var manifest = await ReadManifestAsync(verification.Artifact.ManifestPath, cancellationToken).ConfigureAwait(false);
            foreach (var file in manifest.Files.Skip(1))
            {
                var sourcePath = ResolveContainedPath(verification.Artifact.DirectoryPath, file.Path);
                var relativeAssetPath = file.Path["assets/".Length..];
                var outputPath = ResolveContainedPath(staging.AssetsDirectory, relativeAssetPath);
                Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
                File.Copy(sourcePath, outputPath, overwrite: false);
                var copiedHash = await ComputeSha256Async(outputPath, cancellationToken).ConfigureAwait(false);
                if (!string.Equals(copiedHash, file.Sha256, StringComparison.Ordinal) || new FileInfo(outputPath).Length != file.SizeBytes)
                {
                    throw new InvalidDataException($"The restored asset failed verification: {relativeAssetPath}.");
                }
            }

            Directory.Move(staging.Root, destination.Root);
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
                if (!string.IsNullOrEmpty(stagingRoot) && Directory.Exists(stagingRoot))
                {
                    Directory.Delete(stagingRoot, recursive: true);
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

    private static async Task<List<AssetBackupEntry>> ReadAssetEntriesAsync(string databasePath, CancellationToken cancellationToken)
    {
        var builder = new SqliteConnectionStringBuilder { DataSource = databasePath, Mode = SqliteOpenMode.ReadOnly, Pooling = false };
        await using var connection = new SqliteConnection(builder.ToString());
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT asset_id, sha256, relative_path, byte_length, verification_state FROM assets ORDER BY asset_id;";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        var entries = new List<AssetBackupEntry>();
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            var id = reader.GetString(0);
            var sha256 = reader.GetString(1);
            var relativePath = reader.GetString(2);
            var byteLength = reader.GetInt64(3);
            var state = reader.GetString(4);
            var expectedPath = $"sha256/{sha256[..Math.Min(2, sha256.Length)]}/{sha256}";
            if (!IsSha256(sha256) || !string.Equals(relativePath, expectedPath, StringComparison.Ordinal) || byteLength < 0 || !string.Equals(state, "available", StringComparison.Ordinal))
            {
                throw new InvalidDataException($"Asset {id} has invalid metadata or is not available for a complete backup.");
            }

            entries.Add(new AssetBackupEntry(id, sha256, relativePath, byteLength));
        }

        return entries;
    }

    private static async Task<BackupManifest> ReadManifestAsync(string manifestPath, CancellationToken cancellationToken)
    {
        if (new FileInfo(manifestPath).Length > 64 * 1024 * 1024)
        {
            throw new InvalidDataException("The backup manifest is larger than the supported limit.");
        }

        await using var stream = new FileStream(manifestPath, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        return await JsonSerializer.DeserializeAsync<BackupManifest>(stream, JsonOptions, cancellationToken).ConfigureAwait(false)
            ?? throw new InvalidDataException("The backup manifest is empty.");
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
    private sealed record AssetBackupEntry(string AssetId, string Sha256, string RelativePath, long ByteLength);
}
