using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Data.Storage;
using Microsoft.Data.Sqlite;

namespace GV5.Data.Assets;

/// <summary>Provides keyset-paged metadata ordered newest-first without opening asset files.</summary>
public sealed class SqliteAssetCatalog : IAssetCatalog
{
    private readonly IGv5Database _database;
    private readonly IDataPlatformInitializer _initializer;

    public SqliteAssetCatalog(IGv5Database database, IDataPlatformInitializer initializer)
    {
        _database = database ?? throw new ArgumentNullException(nameof(database));
        _initializer = initializer ?? throw new ArgumentNullException(nameof(initializer));
    }

    public async Task<Result<AssetPage>> GetPageAsync(AssetPageRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        await _initializer.InitializeAsync(cancellationToken).ConfigureAwait(false);

        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            if (request.Cursor is { } cursor)
            {
                command.CommandText = """
                    SELECT asset_id, sha256, mime_type, byte_length, verification_state, created_utc_ms
                    FROM assets
                    WHERE created_utc_ms < $created OR (created_utc_ms = $created AND asset_id < $assetId)
                    ORDER BY created_utc_ms DESC, asset_id DESC
                    LIMIT $limit;
                    """;
                command.Parameters.AddWithValue("$created", cursor.CreatedUtcMs);
                command.Parameters.AddWithValue("$assetId", cursor.AssetId.ToString());
            }
            else
            {
                command.CommandText = """
                    SELECT asset_id, sha256, mime_type, byte_length, verification_state, created_utc_ms
                    FROM assets
                    ORDER BY created_utc_ms DESC, asset_id DESC
                    LIMIT $limit;
                    """;
            }

            command.Parameters.AddWithValue("$limit", request.PageSize + 1);
            var items = new List<AssetMetadata>(request.PageSize + 1);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                items.Add(new AssetMetadata(
                    AssetId.Parse(reader.GetString(0)),
                    reader.GetString(1),
                    reader.GetString(2),
                    reader.GetInt64(3),
                    ParseState(reader.GetString(4)),
                    reader.GetInt64(5)));
            }

            var hasMore = items.Count > request.PageSize;
            if (hasMore)
            {
                items.RemoveAt(items.Count - 1);
            }

            AssetPageCursor? nextCursor = hasMore && items.Count > 0
                ? AssetPageCursor.Create(items[^1].CreatedUtcMs, items[^1].Id)
                : null;
            return Result<AssetPage>.Success(new AssetPage(items.AsReadOnly(), nextCursor, hasMore));
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception) when (exception is SqliteException or IOException or UnauthorizedAccessException or InvalidDataException)
        {
            return Result<AssetPage>.Failure(new ApplicationError(ApplicationErrorCode.Persistence, "The asset page could not be read."));
        }
    }

    private static AssetVerificationState ParseState(string state) => state switch
    {
        "available" => AssetVerificationState.Available,
        "missing" => AssetVerificationState.Missing,
        "corrupt" => AssetVerificationState.Corrupt,
        _ => throw new InvalidDataException("The asset catalog contains an unknown verification state.")
    };
}
