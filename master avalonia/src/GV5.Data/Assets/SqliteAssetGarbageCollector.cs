using System.Security.Cryptography;
using GV5.Application.Contracts;
using GV5.Data.Storage;
using Microsoft.Data.Sqlite;

namespace GV5.Data.Assets;

/// <summary>Moves stale, unreferenced assets into recoverable trash only after a complete backup verifies.</summary>
public sealed class SqliteAssetGarbageCollector : IAssetGarbageCollector
{
    private readonly IAppDataPaths _paths;
    private readonly IGv5Database _database;
    private readonly IDataPlatformInitializer _initializer;
    private readonly IDataPlatformBackupService _backupService;
    private readonly TimeProvider _timeProvider;

    public SqliteAssetGarbageCollector(
        IAppDataPaths paths,
        IGv5Database database,
        IDataPlatformInitializer initializer,
        IDataPlatformBackupService backupService,
        TimeProvider? timeProvider = null)
    {
        _paths = paths ?? throw new ArgumentNullException(nameof(paths));
        _database = database ?? throw new ArgumentNullException(nameof(database));
        _initializer = initializer ?? throw new ArgumentNullException(nameof(initializer));
        _backupService = backupService ?? throw new ArgumentNullException(nameof(backupService));
        _timeProvider = timeProvider ?? TimeProvider.System;
    }

    public async Task<Result<AssetGarbageCollectionReport>> CollectAsync(
        AssetGarbageCollectionPolicy policy,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(policy);
        try
        {
            return await CollectCoreAsync(policy, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException or SqliteException or InvalidOperationException)
        {
            return Failure($"Asset cleanup stopped safely: {exception.Message}");
        }
    }

    private async Task<Result<AssetGarbageCollectionReport>> CollectCoreAsync(
        AssetGarbageCollectionPolicy policy,
        CancellationToken cancellationToken)
    {
        await _initializer.InitializeAsync(cancellationToken).ConfigureAwait(false);
        var now = _timeProvider.GetUtcNow();
        var nowUtcMs = now.ToUnixTimeMilliseconds();
        var tracked = await TrackUnreferencedAssetsAsync(nowUtcMs, cancellationToken).ConfigureAwait(false);
        var eligible = await ReadEligibleAssetsAsync(ToCutoff(nowUtcMs, policy.UnreferencedGracePeriod), cancellationToken).ConfigureAwait(false);

        foreach (var asset in eligible)
        {
            await RecoverInterruptedMoveAsync(asset, cancellationToken).ConfigureAwait(false);
        }

        DataBackupArtifact? verifiedBackup = null;
        if (eligible.Count > 0)
        {
            var backup = await _backupService.CreateAsync(cancellationToken).ConfigureAwait(false);
            var verification = await _backupService.VerifyAsync(backup.DirectoryPath, cancellationToken).ConfigureAwait(false);
            if (!verification.IsValid || verification.Artifact is null)
            {
                return Failure("Asset cleanup was stopped because the complete data backup could not be verified.");
            }

            verifiedBackup = verification.Artifact;
        }

        var trashed = 0;
        foreach (var asset in eligible)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                if (verifiedBackup is null || !await BackupContainsAssetAsync(verifiedBackup, asset, cancellationToken).ConfigureAwait(false))
                {
                    return Failure($"Asset {asset.AssetId} was preserved because its verified backup entry could not be confirmed.");
                }

                var sourcePath = ResolveAssetPath(asset.RelativePath);
                var trashRelativePath = GetTrashRelativePath(asset);
                var trashPath = ResolveAssetPath(trashRelativePath);
                var movedToTrash = false;
                try
                {
                    var deleted = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
                    {
                        var current = await ReadEligibleAssetInsideTransactionAsync(connection, transaction, asset.AssetId, ToCutoff(nowUtcMs, policy.UnreferencedGracePeriod), token).ConfigureAwait(false);
                        if (current is null || current != asset)
                        {
                            return false;
                        }

                        if (!File.Exists(sourcePath) || new FileInfo(sourcePath).Length != asset.ByteLength ||
                            !string.Equals(await ComputeSha256Async(sourcePath, token).ConfigureAwait(false), asset.Sha256, StringComparison.Ordinal))
                        {
                            throw new InvalidDataException($"Asset {asset.AssetId} is missing or changed; it was preserved.");
                        }

                        Directory.CreateDirectory(Path.GetDirectoryName(trashPath)!);
                        if (File.Exists(trashPath))
                        {
                            throw new IOException($"The asset trash destination already exists: {trashRelativePath}.");
                        }

                        await using (var journal = connection.CreateCommand())
                        {
                            journal.Transaction = transaction;
                            journal.CommandText = "INSERT INTO asset_gc_operations(operation_id, asset_id, sha256, relative_path, trash_relative_path, backup_directory_name, trashed_utc_ms, purged_utc_ms) VALUES ($operation, $asset, $hash, $relative, $trash, $backup, $trashed, NULL);";
                            journal.Parameters.AddWithValue("$operation", Guid.NewGuid().ToString("D"));
                            journal.Parameters.AddWithValue("$asset", asset.AssetId);
                            journal.Parameters.AddWithValue("$hash", asset.Sha256);
                            journal.Parameters.AddWithValue("$relative", asset.RelativePath);
                            journal.Parameters.AddWithValue("$trash", trashRelativePath);
                            journal.Parameters.AddWithValue("$backup", Path.GetFileName(verifiedBackup.DirectoryPath));
                            journal.Parameters.AddWithValue("$trashed", nowUtcMs);
                            await journal.ExecuteNonQueryAsync(token).ConfigureAwait(false);
                        }

                        File.Move(sourcePath, trashPath, overwrite: false);
                        movedToTrash = true;
                        if (new FileInfo(trashPath).Length != asset.ByteLength ||
                            !string.Equals(await ComputeSha256Async(trashPath, token).ConfigureAwait(false), asset.Sha256, StringComparison.Ordinal))
                        {
                            throw new InvalidDataException($"Asset {asset.AssetId} changed during quarantine and was restored.");
                        }

                        await using var delete = connection.CreateCommand();
                        delete.Transaction = transaction;
                        delete.CommandText = "DELETE FROM assets WHERE asset_id = $asset AND NOT EXISTS (SELECT 1 FROM asset_references WHERE asset_id = $asset);";
                        delete.Parameters.AddWithValue("$asset", asset.AssetId);
                        if (await delete.ExecuteNonQueryAsync(token).ConfigureAwait(false) != 1)
                        {
                            throw new InvalidOperationException("The asset gained a reference while garbage collection was running.");
                        }

                        return true;
                    }, cancellationToken).ConfigureAwait(false);

                    if (deleted)
                    {
                        trashed++;
                    }
                    else if (movedToTrash)
                    {
                        RestoreFile(sourcePath, trashPath);
                        movedToTrash = false;
                    }
                }
                catch
                {
                    if (movedToTrash)
                    {
                        RestoreFile(sourcePath, trashPath);
                    }

                    throw;
                }
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or InvalidDataException or SqliteException or InvalidOperationException)
            {
                return Failure($"Asset cleanup stopped safely: {exception.Message}");
            }
        }

        var purged = await PurgeExpiredTrashAsync(ToCutoff(nowUtcMs, policy.TrashRetention), cancellationToken).ConfigureAwait(false);
        return Result<AssetGarbageCollectionReport>.Success(new AssetGarbageCollectionReport(
            tracked,
            trashed,
            purged,
            verifiedBackup?.DirectoryPath));
    }

    private async Task<int> TrackUnreferencedAssetsAsync(long nowUtcMs, CancellationToken cancellationToken) =>
        await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
        {
            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = """
                INSERT OR IGNORE INTO asset_gc_candidates(asset_id, unreferenced_since_utc_ms)
                SELECT a.asset_id, $now
                FROM assets a
                WHERE NOT EXISTS (SELECT 1 FROM asset_references r WHERE r.asset_id = a.asset_id);
                """;
            command.Parameters.AddWithValue("$now", nowUtcMs);
            return await command.ExecuteNonQueryAsync(token).ConfigureAwait(false);
        }, cancellationToken).ConfigureAwait(false);

    private async Task<List<GarbageAsset>> ReadEligibleAssetsAsync(long cutoffUtcMs, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT a.asset_id, a.sha256, a.relative_path, a.byte_length, c.unreferenced_since_utc_ms
            FROM assets a
            JOIN asset_gc_candidates c ON c.asset_id = a.asset_id
            WHERE c.unreferenced_since_utc_ms <= $cutoff
              AND a.verification_state = 'available'
              AND NOT EXISTS (SELECT 1 FROM asset_references r WHERE r.asset_id = a.asset_id)
            ORDER BY c.unreferenced_since_utc_ms, a.asset_id;
            """;
        command.Parameters.AddWithValue("$cutoff", cutoffUtcMs);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        var assets = new List<GarbageAsset>();
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            assets.Add(new GarbageAsset(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetInt64(3), reader.GetInt64(4)));
        }

        return assets;
    }

    private static async Task<GarbageAsset?> ReadEligibleAssetInsideTransactionAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        string assetId,
        long cutoffUtcMs,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            SELECT a.asset_id, a.sha256, a.relative_path, a.byte_length, c.unreferenced_since_utc_ms
            FROM assets a
            JOIN asset_gc_candidates c ON c.asset_id = a.asset_id
            WHERE a.asset_id = $asset
              AND c.unreferenced_since_utc_ms <= $cutoff
              AND a.verification_state = 'available'
              AND NOT EXISTS (SELECT 1 FROM asset_references r WHERE r.asset_id = a.asset_id);
            """;
        command.Parameters.AddWithValue("$asset", assetId);
        command.Parameters.AddWithValue("$cutoff", cutoffUtcMs);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        return await reader.ReadAsync(cancellationToken).ConfigureAwait(false)
            ? new GarbageAsset(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetInt64(3), reader.GetInt64(4))
            : null;
    }

    private async Task RecoverInterruptedMoveAsync(GarbageAsset asset, CancellationToken cancellationToken)
    {
        var sourcePath = ResolveAssetPath(asset.RelativePath);
        var trashPath = ResolveAssetPath(GetTrashRelativePath(asset));
        if (File.Exists(sourcePath) && File.Exists(trashPath))
        {
            throw new IOException($"Both active and trash copies exist for asset {asset.AssetId}; neither was changed.");
        }

        if (File.Exists(sourcePath))
        {
            return;
        }

        if (!File.Exists(trashPath))
        {
            throw new FileNotFoundException($"Neither active nor recoverable trash bytes exist for asset {asset.AssetId}.");
        }

        if (new FileInfo(trashPath).Length != asset.ByteLength || !string.Equals(await ComputeSha256Async(trashPath, cancellationToken).ConfigureAwait(false), asset.Sha256, StringComparison.Ordinal))
        {
            throw new InvalidDataException($"Interrupted trash bytes for asset {asset.AssetId} failed verification; they were preserved.");
        }

        Directory.CreateDirectory(Path.GetDirectoryName(sourcePath)!);
        File.Move(trashPath, sourcePath, overwrite: false);
    }

    private async Task<int> PurgeExpiredTrashAsync(long cutoffUtcMs, CancellationToken cancellationToken)
    {
        var operations = new List<TrashOperation>();
        await using (var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false))
        await using (var command = connection.CreateCommand())
        {
            command.CommandText = "SELECT operation_id, sha256, relative_path, trash_relative_path, backup_directory_name FROM asset_gc_operations WHERE purged_utc_ms IS NULL AND trashed_utc_ms <= $cutoff ORDER BY trashed_utc_ms, operation_id;";
            command.Parameters.AddWithValue("$cutoff", cutoffUtcMs);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                operations.Add(new TrashOperation(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4)));
            }
        }

        var purged = 0;
        foreach (var operation in operations)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!IsSafeBackupDirectoryName(operation.BackupDirectoryName))
            {
                continue;
            }

            var backupDirectory = Path.Combine(_paths.BackupsDirectory, operation.BackupDirectoryName);
            var backupVerification = await _backupService.VerifyAsync(backupDirectory, cancellationToken).ConfigureAwait(false);
            if (!backupVerification.IsValid || backupVerification.Artifact is null)
            {
                continue;
            }

            var expectedBackupAsset = ResolveContainedPath(backupDirectory, $"assets/{operation.RelativePath}");
            var trashPath = ResolveAssetPath(operation.TrashRelativePath);
            if (!File.Exists(expectedBackupAsset) || !string.Equals(await ComputeSha256Async(expectedBackupAsset, cancellationToken).ConfigureAwait(false), operation.Sha256, StringComparison.Ordinal))
            {
                continue;
            }

            if (File.Exists(trashPath))
            {
                if (!string.Equals(await ComputeSha256Async(trashPath, cancellationToken).ConfigureAwait(false), operation.Sha256, StringComparison.Ordinal))
                {
                    continue;
                }

                File.Delete(trashPath);
            }

            await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                await using var update = connection.CreateCommand();
                update.Transaction = transaction;
                update.CommandText = "UPDATE asset_gc_operations SET purged_utc_ms = $purged WHERE operation_id = $operation AND purged_utc_ms IS NULL;";
                update.Parameters.AddWithValue("$purged", _timeProvider.GetUtcNow().ToUnixTimeMilliseconds());
                update.Parameters.AddWithValue("$operation", operation.OperationId);
                return await update.ExecuteNonQueryAsync(token).ConfigureAwait(false);
            }, cancellationToken).ConfigureAwait(false);
            purged++;
        }

        return purged;
    }

    private async Task<bool> BackupContainsAssetAsync(DataBackupArtifact backup, GarbageAsset asset, CancellationToken cancellationToken)
    {
        var path = ResolveContainedPath(backup.DirectoryPath, $"assets/{asset.RelativePath}");
        return File.Exists(path) && new FileInfo(path).Length == asset.ByteLength &&
               string.Equals(await ComputeSha256Async(path, cancellationToken).ConfigureAwait(false), asset.Sha256, StringComparison.Ordinal);
    }

    private string ResolveAssetPath(string relativePath) => ResolveContainedPath(_paths.AssetsDirectory, relativePath);

    private static string ResolveContainedPath(string root, string relativePath)
    {
        if (Path.IsPathRooted(relativePath) || relativePath.Split('/', '\\').Any(segment => segment is ".." or "." or ""))
        {
            throw new InvalidDataException("An asset path must be a normalized relative path.");
        }

        var normalizedRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var combined = Path.GetFullPath(Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar)));
        if (!combined.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("An asset path escaped its managed directory.");
        }

        return combined;
    }

    private static string GetTrashRelativePath(GarbageAsset asset) => $"trash/{asset.AssetId}-{asset.Sha256}.bin";

    private static bool IsSafeBackupDirectoryName(string value) =>
        value.StartsWith("gv5-backup-", StringComparison.Ordinal) &&
        string.Equals(Path.GetFileName(value), value, StringComparison.Ordinal) &&
        !value.Contains('/') && !value.Contains('\\');

    private static long ToCutoff(long nowUtcMs, TimeSpan duration)
    {
        var milliseconds = (long)duration.TotalMilliseconds;
        return Math.Max(0, nowUtcMs - milliseconds);
    }

    private static async Task<string> ComputeSha256Async(string path, CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        return Convert.ToHexStringLower(await SHA256.HashDataAsync(stream, cancellationToken).ConfigureAwait(false));
    }

    private static void RestoreFile(string sourcePath, string trashPath)
    {
        if (!File.Exists(trashPath))
        {
            return;
        }

        Directory.CreateDirectory(Path.GetDirectoryName(sourcePath)!);
        File.Move(trashPath, sourcePath, overwrite: false);
    }

    private static Result<AssetGarbageCollectionReport> Failure(string message) =>
        Result<AssetGarbageCollectionReport>.Failure(new ApplicationError(ApplicationErrorCode.Persistence, message));

    private sealed record GarbageAsset(string AssetId, string Sha256, string RelativePath, long ByteLength, long UnreferencedSinceUtcMs);
    private sealed record TrashOperation(string OperationId, string Sha256, string RelativePath, string TrashRelativePath, string BackupDirectoryName);
}
