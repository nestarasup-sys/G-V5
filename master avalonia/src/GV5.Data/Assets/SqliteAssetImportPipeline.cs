using System.Diagnostics;
using System.Security.Cryptography;
using GV5.Application.Contracts;
using GV5.Assets.Import;
using GV5.Core.Identity;
using GV5.Data.Storage;
using Microsoft.Data.Sqlite;

namespace GV5.Data.Assets;

/// <summary>Coordinates staged bytes, hash-addressed files and SQLite metadata through a recoverable journal.</summary>
public sealed class SqliteAssetImportPipeline
{
    private const string AssetRelativeRoot = "sha256";

    private readonly IAppDataPaths _paths;
    private readonly IGv5Database _database;
    private readonly IDataPlatformInitializer _initializer;
    private readonly AssetImportStager _stager;
    private readonly IStructuredDiagnosticLogger _logger;
    private readonly IOperationCorrelationContext _correlationContext;
    private readonly SemaphoreSlim _recoveryGate = new(1, 1);

    public SqliteAssetImportPipeline(
        IAppDataPaths paths,
        IGv5Database database,
        IDataPlatformInitializer initializer,
        IStructuredDiagnosticLogger logger,
        IOperationCorrelationContext correlationContext)
    {
        _paths = paths ?? throw new ArgumentNullException(nameof(paths));
        _database = database ?? throw new ArgumentNullException(nameof(database));
        _initializer = initializer ?? throw new ArgumentNullException(nameof(initializer));
        _stager = new AssetImportStager(Path.Combine(paths.TempDirectory, "asset-imports"));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _correlationContext = correlationContext ?? throw new ArgumentNullException(nameof(correlationContext));
    }

    public async Task<Result<AssetMetadata>> ImportAsync(
        Stream content,
        string mediaType,
        CancellationToken cancellationToken = default)
    {
        using var correlationScope = _correlationContext.BeginScope();
        var stopwatch = Stopwatch.StartNew();
        var operationStagingPath = string.Empty;
        var journalWriteAttempted = false;
        try
        {
            await InitializeAndRecoverAsync(cancellationToken).ConfigureAwait(false);
            await using var staged = await _stager.StageAsync(content, mediaType, cancellationToken).ConfigureAwait(false);
            var operationId = Guid.NewGuid();
            var stagedFileName = $"{operationId:N}.stage";
            var operationDirectory = Path.Combine(_paths.TempDirectory, "asset-operations");
            Directory.CreateDirectory(operationDirectory);
            operationStagingPath = Path.Combine(operationDirectory, stagedFileName);
            await CopyStagedFileAsync(staged, operationStagingPath, cancellationToken).ConfigureAwait(false);

            var pending = new PendingAssetImport(
                operationId,
                staged.Id,
                staged.Sha256,
                BuildRelativeAssetPath(staged.Sha256),
                stagedFileName,
                staged.MediaType,
                staged.ByteLength,
                staged.Width,
                staged.Height,
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());

            journalWriteAttempted = true;
            await WriteJournalAsync(pending, cancellationToken).ConfigureAwait(false);
            await PublishPendingFileAsync(pending, operationStagingPath, cancellationToken).ConfigureAwait(false);
            var metadata = await CommitAssetAndRemoveJournalAsync(pending, cancellationToken).ConfigureAwait(false);
            await WriteDiagnosticAsync(DiagnosticEventCode.AssetImportCompleted, DiagnosticOutcome.Success, durationMilliseconds: stopwatch.ElapsedMilliseconds).ConfigureAwait(false);
            return Result<AssetMetadata>.Success(metadata);
        }
        catch (OperationCanceledException)
        {
            await WriteDiagnosticAsync(DiagnosticEventCode.AssetImportFailed, DiagnosticOutcome.Warning, DiagnosticErrorCode.Cancelled, stopwatch.ElapsedMilliseconds).ConfigureAwait(false);
            throw;
        }
        catch (AssetImportException exception)
        {
            await WriteDiagnosticAsync(DiagnosticEventCode.AssetImportFailed, DiagnosticOutcome.Failure, DiagnosticErrorCode.InvalidAsset, stopwatch.ElapsedMilliseconds).ConfigureAwait(false);
            return Result<AssetMetadata>.Failure(new ApplicationError(ApplicationErrorCode.Validation, exception.Message));
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or SqliteException or InvalidDataException)
        {
            await WriteDiagnosticAsync(DiagnosticEventCode.AssetImportFailed, DiagnosticOutcome.Failure, ClassifyFailure(exception), stopwatch.ElapsedMilliseconds).ConfigureAwait(false);
            return Result<AssetMetadata>.Failure(new ApplicationError(ApplicationErrorCode.Persistence, "The asset could not be stored. The import journal was preserved when recovery may be needed."));
        }
        finally
        {
            if (!journalWriteAttempted && !string.IsNullOrEmpty(operationStagingPath))
            {
                TryDelete(operationStagingPath);
            }
        }
    }

    public async Task<Result<Stream>> OpenReadAsync(AssetId assetId, CancellationToken cancellationToken = default)
    {
        if (!assetId.IsValid)
        {
            return Result<Stream>.Failure(new ApplicationError(ApplicationErrorCode.Validation, "A valid asset ID is required."));
        }

        await InitializeAndRecoverAsync(cancellationToken).ConfigureAwait(false);
        var result = await ReadMetadataAsync(assetId, cancellationToken).ConfigureAwait(false);
        if (result.IsFailure)
        {
            return Result<Stream>.Failure(result.Error!);
        }

        var metadata = result.Value;
        if (metadata.VerificationState != AssetVerificationState.Available)
        {
            return Result<Stream>.Failure(new ApplicationError(ApplicationErrorCode.Unavailable, "The asset file is not available."));
        }

        var relativePath = await ReadRelativePathAsync(assetId, cancellationToken).ConfigureAwait(false);
        var fullPath = ResolveAssetPath(relativePath, metadata.Sha256);
        if (!File.Exists(fullPath))
        {
            await MarkAssetStateAsync(assetId, "missing", cancellationToken).ConfigureAwait(false);
            return Result<Stream>.Failure(new ApplicationError(ApplicationErrorCode.Unavailable, "The asset file is missing."));
        }

        try
        {
            Stream stream = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
            return Result<Stream>.Success(stream);
        }
        catch (FileNotFoundException)
        {
            await MarkAssetStateAsync(assetId, "missing", cancellationToken).ConfigureAwait(false);
            return Result<Stream>.Failure(new ApplicationError(ApplicationErrorCode.Unavailable, "The asset file is missing."));
        }
    }

    public async Task<Result<AssetMetadata>> GetMetadataAsync(AssetId assetId, CancellationToken cancellationToken = default)
    {
        if (!assetId.IsValid)
        {
            return Result<AssetMetadata>.Failure(new ApplicationError(ApplicationErrorCode.Validation, "A valid asset ID is required."));
        }

        await InitializeAndRecoverAsync(cancellationToken).ConfigureAwait(false);
        return await ReadMetadataAsync(assetId, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Replays journaled imports. Safe to call repeatedly and automatically run before public operations.</summary>
    public async Task RecoverPendingImportsAsync(CancellationToken cancellationToken = default)
    {
        await _initializer.InitializeAsync(cancellationToken).ConfigureAwait(false);
        await RecoverPendingImportsCoreAsync(cancellationToken).ConfigureAwait(false);
    }

    private async Task InitializeAndRecoverAsync(CancellationToken cancellationToken)
    {
        await _initializer.InitializeAsync(cancellationToken).ConfigureAwait(false);
        await RecoverPendingImportsCoreAsync(cancellationToken).ConfigureAwait(false);
    }

    private async Task RecoverPendingImportsCoreAsync(CancellationToken cancellationToken)
    {
        await _recoveryGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var pendingImports = await ReadPendingImportsAsync(cancellationToken).ConfigureAwait(false);
            foreach (var pending in pendingImports)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var stagedPath = ResolveStagingPath(pending);
                var assetPath = ResolveAssetPath(pending.RelativePath, pending.Sha256);
                Directory.CreateDirectory(Path.GetDirectoryName(assetPath)!);

                if (File.Exists(assetPath))
                {
                    await VerifyFileAsync(assetPath, pending, cancellationToken).ConfigureAwait(false);
                    if (File.Exists(stagedPath))
                    {
                        TryDelete(stagedPath);
                    }
                }
                else if (File.Exists(stagedPath))
                {
                    await VerifyFileAsync(stagedPath, pending, cancellationToken).ConfigureAwait(false);
                    File.Move(stagedPath, assetPath, overwrite: false);
                    await VerifyFileAsync(assetPath, pending, cancellationToken).ConfigureAwait(false);
                }
                else
                {
                    throw new FileNotFoundException("A journaled asset has neither a staging file nor a published file.", stagedPath);
                }

                await CommitAssetAndRemoveJournalAsync(pending, cancellationToken).ConfigureAwait(false);
                await WriteDiagnosticAsync(DiagnosticEventCode.AssetRecoveryCompleted, DiagnosticOutcome.Success).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            await WriteDiagnosticAsync(DiagnosticEventCode.AssetRecoveryFailed, DiagnosticOutcome.Warning, DiagnosticErrorCode.Cancelled).ConfigureAwait(false);
            throw;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or SqliteException or InvalidDataException)
        {
            await WriteDiagnosticAsync(DiagnosticEventCode.AssetRecoveryFailed, DiagnosticOutcome.Failure, ClassifyFailure(exception)).ConfigureAwait(false);
            throw;
        }
        finally
        {
            _recoveryGate.Release();
        }
    }

    private async Task<AssetMetadata> CommitAssetAndRemoveJournalAsync(PendingAssetImport pending, CancellationToken cancellationToken) =>
        await _database.ExecuteWriteAsync(async (connection, transaction, operationToken) =>
        {
            AssetMetadata metadata;
            var shouldMarkAvailable = false;
            await using (var existing = connection.CreateCommand())
            {
                existing.Transaction = transaction;
                existing.CommandText = "SELECT asset_id, sha256, mime_type, byte_length, verification_state, created_utc_ms, relative_path FROM assets WHERE sha256 = $sha256;";
                existing.Parameters.AddWithValue("$sha256", pending.Sha256);
                await using var reader = await existing.ExecuteReaderAsync(operationToken).ConfigureAwait(false);
                if (await reader.ReadAsync(operationToken).ConfigureAwait(false))
                {
                    var existingId = AssetId.Parse(reader.GetString(0));
                    var existingPath = reader.GetString(6);
                    var existingState = reader.GetString(4);
                    if (!string.Equals(existingPath, pending.RelativePath, StringComparison.Ordinal))
                    {
                        throw new InvalidDataException("An existing asset hash points to a different storage location.");
                    }

                    metadata = new AssetMetadata(
                        existingId,
                        reader.GetString(1),
                        reader.GetString(2),
                        reader.GetInt64(3),
                        ParseVerificationState(existingState),
                        reader.GetInt64(5));
                    shouldMarkAvailable = !string.Equals(existingState, "available", StringComparison.Ordinal);
                }
                else
                {
                    metadata = new AssetMetadata(pending.AssetId, pending.Sha256, pending.MediaType, pending.ByteLength, AssetVerificationState.Available, pending.CreatedUtcMs);
                }
            }

            if (metadata.Id == pending.AssetId)
            {
                await using var insert = connection.CreateCommand();
                insert.Transaction = transaction;
                insert.CommandText = "INSERT INTO assets(asset_id, sha256, relative_path, mime_type, byte_length, verification_state, created_utc_ms) VALUES ($id, $sha256, $path, $mime, $length, 'available', $created);";
                insert.Parameters.AddWithValue("$id", pending.AssetId.ToString());
                insert.Parameters.AddWithValue("$sha256", pending.Sha256);
                insert.Parameters.AddWithValue("$path", pending.RelativePath);
                insert.Parameters.AddWithValue("$mime", pending.MediaType);
                insert.Parameters.AddWithValue("$length", pending.ByteLength);
                insert.Parameters.AddWithValue("$created", pending.CreatedUtcMs);
                await insert.ExecuteNonQueryAsync(operationToken).ConfigureAwait(false);
            }
            else if (shouldMarkAvailable)
            {
                await using var update = connection.CreateCommand();
                update.Transaction = transaction;
                update.CommandText = "UPDATE assets SET verification_state = 'available' WHERE asset_id = $id;";
                update.Parameters.AddWithValue("$id", metadata.Id.ToString());
                await update.ExecuteNonQueryAsync(operationToken).ConfigureAwait(false);
                metadata = metadata with { VerificationState = AssetVerificationState.Available };
            }

            await DeleteJournalRowAsync(connection, transaction, pending.OperationId, operationToken).ConfigureAwait(false);
            return metadata;
        }, cancellationToken).ConfigureAwait(false);

    private async Task WriteJournalAsync(PendingAssetImport pending, CancellationToken cancellationToken)
    {
        await _database.ExecuteWriteAsync(async (connection, transaction, operationToken) =>
        {
            await using var insert = connection.CreateCommand();
            insert.Transaction = transaction;
            insert.CommandText = """
                INSERT INTO asset_import_journal(
                    operation_id, asset_id, sha256, relative_path, staged_file_name,
                    media_type, byte_length, pixel_width, pixel_height, created_utc_ms)
                VALUES ($operation, $asset, $sha256, $path, $stage, $mime, $length, $width, $height, $created);
                """;
            insert.Parameters.AddWithValue("$operation", pending.OperationId.ToString("D"));
            insert.Parameters.AddWithValue("$asset", pending.AssetId.ToString());
            insert.Parameters.AddWithValue("$sha256", pending.Sha256);
            insert.Parameters.AddWithValue("$path", pending.RelativePath);
            insert.Parameters.AddWithValue("$stage", pending.StagedFileName);
            insert.Parameters.AddWithValue("$mime", pending.MediaType);
            insert.Parameters.AddWithValue("$length", pending.ByteLength);
            insert.Parameters.AddWithValue("$width", pending.Width);
            insert.Parameters.AddWithValue("$height", pending.Height);
            insert.Parameters.AddWithValue("$created", pending.CreatedUtcMs);
            await insert.ExecuteNonQueryAsync(operationToken).ConfigureAwait(false);
            return true;
        }, cancellationToken).ConfigureAwait(false);
    }

    private async Task PublishPendingFileAsync(PendingAssetImport pending, string stagingPath, CancellationToken cancellationToken)
    {
        var assetPath = ResolveAssetPath(pending.RelativePath, pending.Sha256);
        Directory.CreateDirectory(Path.GetDirectoryName(assetPath)!);
        if (File.Exists(assetPath))
        {
            await VerifyFileAsync(assetPath, pending, cancellationToken).ConfigureAwait(false);
            TryDelete(stagingPath);
            return;
        }

        File.Move(stagingPath, assetPath, overwrite: false);
        await VerifyFileAsync(assetPath, pending, cancellationToken).ConfigureAwait(false);
    }

    private async Task CopyStagedFileAsync(StagedAssetImport staged, string destinationPath, CancellationToken cancellationToken)
    {
        await using var input = await staged.OpenReadAsync(cancellationToken).ConfigureAwait(false);
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = new byte[64 * 1024];
        long total = 0;
        try
        {
            await using var output = new FileStream(destinationPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, buffer.Length, FileOptions.Asynchronous | FileOptions.SequentialScan | FileOptions.WriteThrough);
            while (true)
            {
                var read = await input.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
                if (read == 0)
                {
                    break;
                }

                total += read;
                hash.AppendData(buffer, 0, read);
                await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
            }

            await output.FlushAsync(cancellationToken).ConfigureAwait(false);
            output.Flush(flushToDisk: true);
        }
        catch
        {
            TryDelete(destinationPath);
            throw;
        }

        var actualHash = Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
        if (total != staged.ByteLength || !FixedHashEquals(actualHash, staged.Sha256))
        {
            TryDelete(destinationPath);
            throw new InvalidDataException("The staged asset changed before the import journal was written.");
        }
    }

    private async Task VerifyFileAsync(string path, PendingAssetImport pending, CancellationToken cancellationToken)
    {
        await VerifyStoredFileAsync(path, pending.Sha256, pending.ByteLength, cancellationToken).ConfigureAwait(false);
    }

    private static async Task VerifyStoredFileAsync(string path, string expectedSha256, long expectedByteLength, CancellationToken cancellationToken)
    {
        var fileInfo = new FileInfo(path);
        if (!fileInfo.Exists || fileInfo.Length != expectedByteLength)
        {
            throw new InvalidDataException("A journaled asset file has an unexpected size.");
        }

        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        var hash = Convert.ToHexString(await SHA256.HashDataAsync(stream, cancellationToken).ConfigureAwait(false)).ToLowerInvariant();
        if (!FixedHashEquals(hash, expectedSha256))
        {
            throw new InvalidDataException("A journaled asset file does not match its SHA-256.");
        }
    }

    private async Task<List<PendingAssetImport>> ReadPendingImportsAsync(CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT operation_id, asset_id, sha256, relative_path, staged_file_name,
                   media_type, byte_length, pixel_width, pixel_height, created_utc_ms
            FROM asset_import_journal
            ORDER BY created_utc_ms, operation_id;
            """;
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        var operations = new List<PendingAssetImport>();
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            var operation = new PendingAssetImport(
                Guid.Parse(reader.GetString(0)),
                AssetId.Parse(reader.GetString(1)),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.GetString(5),
                reader.GetInt64(6),
                reader.GetInt32(7),
                reader.GetInt32(8),
                reader.GetInt64(9));
            ValidatePendingOperation(operation);
            operations.Add(operation);
        }

        return operations;
    }

    private async Task<Result<AssetMetadata>> ReadMetadataAsync(AssetId assetId, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT asset_id, sha256, mime_type, byte_length, verification_state, created_utc_ms, relative_path FROM assets WHERE asset_id = $id;";
        command.Parameters.AddWithValue("$id", assetId.ToString());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            return Result<AssetMetadata>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "The asset does not exist."));
        }

        var id = AssetId.Parse(reader.GetString(0));
        var sha256 = reader.GetString(1);
        var relativePath = reader.GetString(6);
        var metadata = new AssetMetadata(
            id,
            sha256,
            reader.GetString(2),
            reader.GetInt64(3),
            ParseVerificationState(reader.GetString(4)),
            reader.GetInt64(5));
        await reader.DisposeAsync().ConfigureAwait(false);

        var fullPath = ResolveAssetPath(relativePath, sha256);
        if (!File.Exists(fullPath) && metadata.VerificationState != AssetVerificationState.Missing)
        {
            await MarkAssetStateAsync(assetId, "missing", cancellationToken).ConfigureAwait(false);
            metadata = metadata with { VerificationState = AssetVerificationState.Missing };
        }
        else if (File.Exists(fullPath) && metadata.VerificationState is AssetVerificationState.Missing or AssetVerificationState.Corrupt)
        {
            try
            {
                await VerifyStoredFileAsync(fullPath, metadata.Sha256, metadata.ByteLength, cancellationToken).ConfigureAwait(false);
                await MarkAssetStateAsync(assetId, "available", cancellationToken).ConfigureAwait(false);
                metadata = metadata with { VerificationState = AssetVerificationState.Available };
            }
            catch (InvalidDataException)
            {
                await MarkAssetStateAsync(assetId, "corrupt", cancellationToken).ConfigureAwait(false);
                metadata = metadata with { VerificationState = AssetVerificationState.Corrupt };
            }
        }

        return Result<AssetMetadata>.Success(metadata);
    }

    private async Task<string> ReadRelativePathAsync(AssetId assetId, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT relative_path FROM assets WHERE asset_id = $id;";
        command.Parameters.AddWithValue("$id", assetId.ToString());
        return Convert.ToString(await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false))
            ?? throw new InvalidDataException("The asset metadata has no storage path.");
    }

    private Task MarkAssetStateAsync(AssetId assetId, string state, CancellationToken cancellationToken) =>
        _database.ExecuteWriteAsync(async (connection, transaction, operationToken) =>
        {
            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = "UPDATE assets SET verification_state = $state WHERE asset_id = $id;";
            command.Parameters.AddWithValue("$state", state);
            command.Parameters.AddWithValue("$id", assetId.ToString());
            await command.ExecuteNonQueryAsync(operationToken).ConfigureAwait(false);
            return true;
        }, cancellationToken);

    private static async Task DeleteJournalRowAsync(SqliteConnection connection, SqliteTransaction transaction, Guid operationId, CancellationToken cancellationToken)
    {
        await using var delete = connection.CreateCommand();
        delete.Transaction = transaction;
        delete.CommandText = "DELETE FROM asset_import_journal WHERE operation_id = $operation;";
        delete.Parameters.AddWithValue("$operation", operationId.ToString("D"));
        await delete.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private string ResolveStagingPath(PendingAssetImport pending)
    {
        var expectedName = $"{pending.OperationId:N}.stage";
        if (!string.Equals(pending.StagedFileName, expectedName, StringComparison.Ordinal))
        {
            throw new InvalidDataException("The asset journal contains an invalid staging file name.");
        }

        return Path.Combine(_paths.TempDirectory, "asset-operations", expectedName);
    }

    private string ResolveAssetPath(string relativePath, string sha256)
    {
        if (!IsSha256(sha256) || !string.Equals(relativePath, BuildRelativeAssetPath(sha256), StringComparison.Ordinal))
        {
            throw new InvalidDataException("The asset storage path does not match its content hash.");
        }

        var normalizedRoot = Path.GetFullPath(_paths.AssetsDirectory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var fullPath = Path.GetFullPath(Path.Combine(_paths.AssetsDirectory, relativePath.Replace('/', Path.DirectorySeparatorChar)));
        if (!fullPath.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("The asset path escapes the managed AssetStore directory.");
        }

        return fullPath;
    }

    private static string BuildRelativeAssetPath(string sha256) => $"{AssetRelativeRoot}/{sha256[..2]}/{sha256}";

    private static void ValidatePendingOperation(PendingAssetImport pending)
    {
        if (pending.OperationId == Guid.Empty || !pending.AssetId.IsValid || !IsSha256(pending.Sha256) ||
            !string.Equals(pending.RelativePath, BuildRelativeAssetPath(pending.Sha256), StringComparison.Ordinal) ||
            !string.Equals(pending.StagedFileName, $"{pending.OperationId:N}.stage", StringComparison.Ordinal) ||
            pending.ByteLength < 1 || pending.Width < 1 || pending.Height < 1 || pending.CreatedUtcMs < 0 ||
            pending.MediaType is not ("image/png" or "image/jpeg" or "image/webp"))
        {
            throw new InvalidDataException("The asset import journal contains an invalid record.");
        }
    }

    private static bool IsSha256(string value) =>
        value.Length == 64 && value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');

    private static bool FixedHashEquals(string first, string second)
    {
        if (!IsSha256(first) || !IsSha256(second))
        {
            return false;
        }

        return CryptographicOperations.FixedTimeEquals(Convert.FromHexString(first), Convert.FromHexString(second));
    }

    private static AssetVerificationState ParseVerificationState(string value) => value switch
    {
        "available" => AssetVerificationState.Available,
        "missing" => AssetVerificationState.Missing,
        "corrupt" => AssetVerificationState.Corrupt,
        _ => throw new InvalidDataException("The asset has an unknown verification state.")
    };

    private static DiagnosticErrorCode ClassifyFailure(Exception exception) => exception switch
    {
        UnauthorizedAccessException => DiagnosticErrorCode.AccessDenied,
        AssetImportException => DiagnosticErrorCode.InvalidAsset,
        InvalidDataException => DiagnosticErrorCode.InvalidAsset,
        IOException => DiagnosticErrorCode.StorageFailure,
        SqliteException => DiagnosticErrorCode.StorageFailure,
        _ => DiagnosticErrorCode.Unknown
    };

    private async Task WriteDiagnosticAsync(
        DiagnosticEventCode eventCode,
        DiagnosticOutcome outcome,
        DiagnosticErrorCode? errorCode = null,
        long? durationMilliseconds = null)
    {
        try
        {
            await _logger.WriteAsync(eventCode, outcome, errorCode, durationMilliseconds, CancellationToken.None).ConfigureAwait(false);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // Logging is best effort and must not change an asset persistence result.
        }
    }

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            // Keep a committed journal intact; abandoned staging files can be audited later.
        }
    }

    private sealed record PendingAssetImport(
        Guid OperationId,
        AssetId AssetId,
        string Sha256,
        string RelativePath,
        string StagedFileName,
        string MediaType,
        long ByteLength,
        int Width,
        int Height,
        long CreatedUtcMs);
}
