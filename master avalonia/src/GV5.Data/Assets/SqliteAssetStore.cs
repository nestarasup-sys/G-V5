using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Data.Storage;

namespace GV5.Data.Assets;

/// <summary>Application-facing asset store backed by hash-addressed files and durable SQLite references.</summary>
public sealed class SqliteAssetStore : IAssetStore
{
    private readonly SqliteAssetImportPipeline _pipeline;
    private readonly IGv5Database _database;
    private readonly IDataPlatformInitializer _initializer;

    public SqliteAssetStore(
        SqliteAssetImportPipeline pipeline,
        IGv5Database database,
        IDataPlatformInitializer initializer)
    {
        _pipeline = pipeline ?? throw new ArgumentNullException(nameof(pipeline));
        _database = database ?? throw new ArgumentNullException(nameof(database));
        _initializer = initializer ?? throw new ArgumentNullException(nameof(initializer));
    }

    public Task<Result<AssetMetadata>> ImportAsync(Stream content, string mediaType, CancellationToken cancellationToken = default) =>
        _pipeline.ImportAsync(content, mediaType, cancellationToken);

    public Task<Result<Stream>> OpenReadAsync(AssetId assetId, CancellationToken cancellationToken = default) =>
        _pipeline.OpenReadAsync(assetId, cancellationToken);

    public Task<Result<AssetMetadata>> GetMetadataAsync(AssetId assetId, CancellationToken cancellationToken = default) =>
        _pipeline.GetMetadataAsync(assetId, cancellationToken);

    public async Task<Result<Unit>> AddReferenceAsync(
        AssetId assetId,
        AssetReferenceKey reference,
        CancellationToken cancellationToken = default)
    {
        if (!assetId.IsValid)
        {
            return Failure(ApplicationErrorCode.Validation, "A valid asset ID is required.");
        }

        if (!IsValid(reference))
        {
            return Failure(ApplicationErrorCode.Validation, "A valid owner, owner ID and slot are required.");
        }

        await _initializer.InitializeAsync(cancellationToken).ConfigureAwait(false);
        return await _database.ExecuteWriteAsync(async (connection, transaction, operationToken) =>
        {
            await using (var existing = connection.CreateCommand())
            {
                existing.Transaction = transaction;
                existing.CommandText = "SELECT asset_id FROM asset_references WHERE owner_type = $owner AND owner_id = $ownerId AND slot = $slot;";
                AddReferenceParameters(existing, reference);
                var existingAssetId = await existing.ExecuteScalarAsync(operationToken).ConfigureAwait(false) as string;
                if (existingAssetId is not null)
                {
                    return string.Equals(existingAssetId, assetId.ToString(), StringComparison.Ordinal)
                        ? Result<Unit>.Success(Unit.Value)
                        : Failure(ApplicationErrorCode.Conflict, "The owner slot already references a different asset.");
                }
            }

            await using (var asset = connection.CreateCommand())
            {
                asset.Transaction = transaction;
                asset.CommandText = "SELECT 1 FROM assets WHERE asset_id = $assetId;";
                asset.Parameters.AddWithValue("$assetId", assetId.ToString());
                if (await asset.ExecuteScalarAsync(operationToken).ConfigureAwait(false) is null)
                {
                    return Failure(ApplicationErrorCode.NotFound, "The asset does not exist.");
                }
            }

            await using var insert = connection.CreateCommand();
            insert.Transaction = transaction;
            insert.CommandText = "INSERT INTO asset_references(owner_type, owner_id, slot, asset_id, created_utc_ms) VALUES ($owner, $ownerId, $slot, $assetId, $created);";
            AddReferenceParameters(insert, reference);
            insert.Parameters.AddWithValue("$assetId", assetId.ToString());
            insert.Parameters.AddWithValue("$created", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            await insert.ExecuteNonQueryAsync(operationToken).ConfigureAwait(false);
            return Result<Unit>.Success(Unit.Value);
        }, cancellationToken).ConfigureAwait(false);
    }

    public async Task<Result<Unit>> ReleaseReferenceAsync(
        AssetReferenceKey reference,
        CancellationToken cancellationToken = default)
    {
        if (!IsValid(reference))
        {
            return Failure(ApplicationErrorCode.Validation, "A valid owner, owner ID and slot are required.");
        }

        await _initializer.InitializeAsync(cancellationToken).ConfigureAwait(false);
        return await _database.ExecuteWriteAsync(async (connection, transaction, operationToken) =>
        {
            await using var delete = connection.CreateCommand();
            delete.Transaction = transaction;
            delete.CommandText = "DELETE FROM asset_references WHERE owner_type = $owner AND owner_id = $ownerId AND slot = $slot;";
            AddReferenceParameters(delete, reference);
            await delete.ExecuteNonQueryAsync(operationToken).ConfigureAwait(false);
            return Result<Unit>.Success(Unit.Value);
        }, cancellationToken).ConfigureAwait(false);
    }

    private static bool IsValid(AssetReferenceKey reference) =>
        reference.OwnerId != Guid.Empty &&
        !string.IsNullOrWhiteSpace(reference.OwnerType) &&
        !string.IsNullOrWhiteSpace(reference.Slot);

    private static void AddReferenceParameters(Microsoft.Data.Sqlite.SqliteCommand command, AssetReferenceKey reference)
    {
        command.Parameters.AddWithValue("$owner", reference.OwnerType);
        command.Parameters.AddWithValue("$ownerId", reference.OwnerId.ToString("D"));
        command.Parameters.AddWithValue("$slot", reference.Slot);
    }

    private static Result<Unit> Failure(ApplicationErrorCode code, string message) =>
        Result<Unit>.Failure(new ApplicationError(code, message));
}
