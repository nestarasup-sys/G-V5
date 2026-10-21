using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Storage;
using GV5.Geometry;
using Microsoft.Data.Sqlite;

namespace GV5.Data.Repositories;

/// <summary>Stores typed model metadata in SQLite and synchronizes its image references transactionally.</summary>
public sealed class SqliteModelDraftContentRepository(IGv5Database database) : IModelDraftContentRepository
{
    private const string AssetOwnerType = "fabricator.model-draft";
    private readonly IGv5Database _database = database ?? throw new ArgumentNullException(nameof(database));

    public async Task<Result<ModelDraftContent>> GetAsync(ModelId modelId, CancellationToken cancellationToken = default)
    {
        if (!modelId.IsValid)
        {
            return Failure(ApplicationErrorCode.Validation, "A valid model ID is required.");
        }

        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            int schemaVersion;
            long contentRevision;
            int? slot;
            string? sourceAssetText;
            int? sourceWidth;
            int? sourceHeight;
            await using (var command = connection.CreateCommand())
            {
                command.CommandText = "SELECT content_revision, schema_version, slot, source_asset_id, source_width, source_height FROM model_draft_contents WHERE model_id = $id;";
                command.Parameters.AddWithValue("$id", modelId.ToString());
                await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
                if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
                {
                    return Result<ModelDraftContent>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "The model draft content does not exist.", modelId.ToString()));
                }

                contentRevision = reader.GetInt64(0);
                schemaVersion = reader.GetInt32(1);
                slot = reader.IsDBNull(2) ? null : reader.GetInt32(2);
                sourceAssetText = reader.IsDBNull(3) ? null : reader.GetString(3);
                sourceWidth = reader.IsDBNull(4) ? null : reader.GetInt32(4);
                sourceHeight = reader.IsDBNull(5) ? null : reader.GetInt32(5);
            }

            var parts = await ReadPartsAsync(connection, modelId, cancellationToken).ConfigureAwait(false);
            var layerOrder = await ReadLayerOrderAsync(connection, modelId, cancellationToken).ConfigureAwait(false);
            var content = ModelDraftContent.Restore(
                schemaVersion,
                modelId,
                Revision.From(contentRevision),
                slot is { } slotValue ? ModelSlot.From(slotValue) : null,
                sourceAssetText is { } assetText ? AssetId.Parse(assetText) : null,
                sourceWidth,
                sourceHeight,
                parts,
                layerOrder);
            if (content.ModelId != modelId)
            {
                return Failure(ApplicationErrorCode.Persistence, "Stored model content identity is inconsistent.", modelId.ToString());
            }

            return Result<ModelDraftContent>.Success(content);
        }
        catch (Exception exception) when (IsStoredContentError(exception))
        {
            return Failure(ApplicationErrorCode.Persistence, "The model draft content could not be read or validated.", modelId.ToString());
        }
    }

    public async Task<Result<ModelDraftContent>> SaveAsync(
        ModelDraftContent content,
        Revision? expectedRevision,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(content);
        if (!content.ModelId.IsValid || !content.Revision.IsValid)
        {
            return Failure(ApplicationErrorCode.Validation, "A valid model ID and content revision are required.");
        }

        if (expectedRevision is null)
        {
            if (content.Revision != Revision.Initial)
            {
                return Failure(ApplicationErrorCode.Validation, "New model content must start at revision 1.", content.ModelId.ToString());
            }
        }
        else
        {
            if (!expectedRevision.Value.IsValid)
            {
                return Failure(ApplicationErrorCode.Validation, "A valid expected content revision is required.", content.ModelId.ToString());
            }

            try
            {
                if (content.Revision != expectedRevision.Value.Next())
                {
                    return Failure(ApplicationErrorCode.Validation, "Updated model content must advance exactly one revision.", content.ModelId.ToString());
                }
            }
            catch (OverflowException)
            {
                return Failure(ApplicationErrorCode.Validation, "The model content revision cannot be incremented further.", content.ModelId.ToString());
            }
        }

        try
        {
            var outcome = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                if (!await ModelExistsAsync(connection, transaction, content.ModelId, token).ConfigureAwait(false))
                {
                    return SaveOutcome.ModelNotFound;
                }

                var desiredReferences = CreateDesiredReferences(content);
                if (!await AssetsExistAsync(connection, transaction, desiredReferences.Values, token).ConfigureAwait(false))
                {
                    return SaveOutcome.MissingAsset;
                }

                var currentRevision = await ReadStoredRevisionAsync(connection, transaction, content.ModelId, token).ConfigureAwait(false);
                if (currentRevision is null)
                {
                    if (expectedRevision is not null)
                    {
                        return SaveOutcome.Conflict;
                    }

                    await using var insert = connection.CreateCommand();
                    insert.Transaction = transaction;
                    insert.CommandText = "INSERT INTO model_draft_contents(model_id, content_revision, schema_version, slot, source_asset_id, source_width, source_height, updated_utc_ms) VALUES ($id, $revision, $schema, $slot, $source, $width, $height, $updated);";
                    AddContentParameters(insert, content);
                    await insert.ExecuteNonQueryAsync(token).ConfigureAwait(false);
                }
                else
                {
                    if (expectedRevision is null || currentRevision.Value != expectedRevision.Value)
                    {
                        return SaveOutcome.Conflict;
                    }

                    await using var update = connection.CreateCommand();
                    update.Transaction = transaction;
                    update.CommandText = "UPDATE model_draft_contents SET content_revision = $revision, schema_version = $schema, slot = $slot, source_asset_id = $source, source_width = $width, source_height = $height, updated_utc_ms = $updated WHERE model_id = $id AND content_revision = $expected;";
                    AddContentParameters(update, content);
                    update.Parameters.AddWithValue("$expected", expectedRevision.Value.Value);
                    if (await update.ExecuteNonQueryAsync(token).ConfigureAwait(false) != 1)
                    {
                        return SaveOutcome.Conflict;
                    }
                }

                await ReplacePartsAsync(connection, transaction, content, token).ConfigureAwait(false);
                var oldReferences = await ReadReferencesAsync(connection, transaction, content.ModelId, token).ConfigureAwait(false);
                await SynchronizeReferencesAsync(connection, transaction, content.ModelId, oldReferences, desiredReferences, token).ConfigureAwait(false);
                return SaveOutcome.Saved;
            }, cancellationToken).ConfigureAwait(false);

            return outcome switch
            {
                SaveOutcome.Saved => Result<ModelDraftContent>.Success(content),
                SaveOutcome.ModelNotFound => Result<ModelDraftContent>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "The model draft does not exist.", content.ModelId.ToString())),
                SaveOutcome.MissingAsset => Result<ModelDraftContent>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "Every source and piece asset must exist before the model content can be saved.", content.ModelId.ToString())),
                SaveOutcome.Conflict => Result<ModelDraftContent>.Failure(new ApplicationError(ApplicationErrorCode.Conflict, "The model content changed since it was loaded.", content.ModelId.ToString())),
                _ => Failure(ApplicationErrorCode.Persistence, "The model draft content could not be saved.", content.ModelId.ToString())
            };
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        {
            return Failure(ApplicationErrorCode.Validation, "The model content or asset references violate a database constraint.", content.ModelId.ToString());
        }
        catch (SqliteException)
        {
            return Failure(ApplicationErrorCode.Persistence, "The model draft content could not be saved.", content.ModelId.ToString());
        }
    }

    private static async Task<bool> ModelExistsAsync(SqliteConnection connection, SqliteTransaction transaction, ModelId modelId, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT 1 FROM models WHERE model_id = $id;";
        command.Parameters.AddWithValue("$id", modelId.ToString());
        return await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) is not null;
    }

    private static async Task<Revision?> ReadStoredRevisionAsync(SqliteConnection connection, SqliteTransaction transaction, ModelId modelId, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT content_revision FROM model_draft_contents WHERE model_id = $id;";
        command.Parameters.AddWithValue("$id", modelId.ToString());
        var value = await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
        return value is long revision ? Revision.From(revision) : null;
    }

    private static Dictionary<string, AssetId> CreateDesiredReferences(ModelDraftContent content)
    {
        var references = new Dictionary<string, AssetId>(StringComparer.Ordinal);
        if (content.SourceAssetId is { } sourceAssetId)
        {
            references.Add("source", sourceAssetId);
        }

        foreach (var part in content.Parts)
        {
            references.Add($"part-{part.Id}", part.AssetId);
        }

        return references;
    }

    private static async Task<bool> AssetsExistAsync(SqliteConnection connection, SqliteTransaction transaction, IEnumerable<AssetId> assetIds, CancellationToken cancellationToken)
    {
        foreach (var assetId in assetIds.Distinct())
        {
            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = "SELECT 1 FROM assets WHERE asset_id = $id AND verification_state = 'available';";
            command.Parameters.AddWithValue("$id", assetId.ToString());
            if (await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) is null)
            {
                return false;
            }
        }

        return true;
    }

    private static async Task<Dictionary<string, AssetId>> ReadReferencesAsync(SqliteConnection connection, SqliteTransaction transaction, ModelId modelId, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT slot, asset_id FROM asset_references WHERE owner_type = $owner AND owner_id = $id;";
        command.Parameters.AddWithValue("$owner", AssetOwnerType);
        command.Parameters.AddWithValue("$id", modelId.ToString());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        var references = new Dictionary<string, AssetId>(StringComparer.Ordinal);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            references.Add(reader.GetString(0), AssetId.Parse(reader.GetString(1)));
        }

        return references;
    }

    private static async Task SynchronizeReferencesAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        ModelId modelId,
        IReadOnlyDictionary<string, AssetId> existing,
        IReadOnlyDictionary<string, AssetId> desired,
        CancellationToken cancellationToken)
    {
        foreach (var (slot, oldAssetId) in existing)
        {
            if (!desired.TryGetValue(slot, out var newAssetId))
            {
                await using var delete = connection.CreateCommand();
                delete.Transaction = transaction;
                delete.CommandText = "DELETE FROM asset_references WHERE owner_type = $owner AND owner_id = $id AND slot = $slot;";
                AddReferenceParameters(delete, modelId, slot);
                await delete.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
                await MarkGarbageCandidateIfOrphanAsync(connection, transaction, oldAssetId, cancellationToken).ConfigureAwait(false);
                continue;
            }

            if (newAssetId == oldAssetId)
            {
                await RemoveGarbageCandidateAsync(connection, transaction, newAssetId, cancellationToken).ConfigureAwait(false);
                continue;
            }

            await using (var update = connection.CreateCommand())
            {
                update.Transaction = transaction;
                update.CommandText = "UPDATE asset_references SET asset_id = $asset, created_utc_ms = $created WHERE owner_type = $owner AND owner_id = $id AND slot = $slot;";
                update.Parameters.AddWithValue("$asset", newAssetId.ToString());
                update.Parameters.AddWithValue("$created", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                AddReferenceParameters(update, modelId, slot);
                await update.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            }

            await MarkGarbageCandidateIfOrphanAsync(connection, transaction, oldAssetId, cancellationToken).ConfigureAwait(false);
            await RemoveGarbageCandidateAsync(connection, transaction, newAssetId, cancellationToken).ConfigureAwait(false);
        }

        foreach (var (slot, assetId) in desired)
        {
            if (existing.ContainsKey(slot))
            {
                continue;
            }

            await using var insert = connection.CreateCommand();
            insert.Transaction = transaction;
            insert.CommandText = "INSERT INTO asset_references(owner_type, owner_id, slot, asset_id, created_utc_ms) VALUES ($owner, $id, $slot, $asset, $created);";
            AddReferenceParameters(insert, modelId, slot);
            insert.Parameters.AddWithValue("$asset", assetId.ToString());
            insert.Parameters.AddWithValue("$created", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            await insert.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            await RemoveGarbageCandidateAsync(connection, transaction, assetId, cancellationToken).ConfigureAwait(false);
        }
    }

    private static void AddReferenceParameters(SqliteCommand command, ModelId modelId, string slot)
    {
        command.Parameters.AddWithValue("$owner", AssetOwnerType);
        command.Parameters.AddWithValue("$id", modelId.ToString());
        command.Parameters.AddWithValue("$slot", slot);
    }

    private static async Task MarkGarbageCandidateIfOrphanAsync(SqliteConnection connection, SqliteTransaction transaction, AssetId assetId, CancellationToken cancellationToken)
    {
        await using var references = connection.CreateCommand();
        references.Transaction = transaction;
        references.CommandText = "SELECT 1 FROM asset_references WHERE asset_id = $asset LIMIT 1;";
        references.Parameters.AddWithValue("$asset", assetId.ToString());
        if (await references.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) is not null)
        {
            return;
        }

        await using var candidate = connection.CreateCommand();
        candidate.Transaction = transaction;
        candidate.CommandText = "INSERT OR IGNORE INTO asset_gc_candidates(asset_id, unreferenced_since_utc_ms) VALUES ($asset, $created);";
        candidate.Parameters.AddWithValue("$asset", assetId.ToString());
        candidate.Parameters.AddWithValue("$created", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        await candidate.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task RemoveGarbageCandidateAsync(SqliteConnection connection, SqliteTransaction transaction, AssetId assetId, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "DELETE FROM asset_gc_candidates WHERE asset_id = $asset;";
        command.Parameters.AddWithValue("$asset", assetId.ToString());
        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private static void AddContentParameters(SqliteCommand command, ModelDraftContent content)
    {
        command.Parameters.AddWithValue("$id", content.ModelId.ToString());
        command.Parameters.AddWithValue("$revision", content.Revision.Value);
        command.Parameters.AddWithValue("$schema", content.SchemaVersion);
        command.Parameters.AddWithValue("$slot", content.Slot is { } slot ? slot.Value : DBNull.Value);
        command.Parameters.AddWithValue("$source", content.SourceAssetId is { } assetId ? assetId.ToString() : DBNull.Value);
        command.Parameters.AddWithValue("$width", content.SourceWidth is { } width ? width : DBNull.Value);
        command.Parameters.AddWithValue("$height", content.SourceHeight is { } height ? height : DBNull.Value);
        command.Parameters.AddWithValue("$updated", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }

    private static async Task ReplacePartsAsync(SqliteConnection connection, SqliteTransaction transaction, ModelDraftContent content, CancellationToken cancellationToken)
    {
        await using (var delete = connection.CreateCommand())
        {
            delete.Transaction = transaction;
            delete.CommandText = "DELETE FROM model_draft_parts WHERE model_id = $id;";
            delete.Parameters.AddWithValue("$id", content.ModelId.ToString());
            await delete.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        for (var index = 0; index < content.Parts.Length; index++)
        {
            var part = content.Parts[index];
            await using var insert = connection.CreateCommand();
            insert.Transaction = transaction;
            insert.CommandText = """
                INSERT INTO model_draft_parts (
                    model_id, part_id, part_index, display_name, asset_id,
                    crop_x, crop_y, crop_width, crop_height,
                    transform_x, transform_y, scale_x, scale_y, rotation_radians, pivot_x, pivot_y, flip_x, flip_y,
                    source_crop_x, source_crop_y, source_crop_width, source_crop_height,
                    source_transform_x, source_transform_y, source_scale_x, source_scale_y, source_rotation_radians,
                    source_pivot_x, source_pivot_y, source_flip_x, source_flip_y, is_visible)
                VALUES (
                    $model, $part, $index, $name, $asset,
                    $cropX, $cropY, $cropWidth, $cropHeight,
                    $transformX, $transformY, $transformScaleX, $transformScaleY, $transformRotation, $transformPivotX, $transformPivotY, $transformFlipX, $transformFlipY,
                    $sourceCropX, $sourceCropY, $sourceCropWidth, $sourceCropHeight,
                    $sourceX, $sourceY, $sourceScaleX, $sourceScaleY, $sourceRotation,
                    $sourcePivotX, $sourcePivotY, $sourceFlipX, $sourceFlipY, $visible);
                """;
            AddPartParameters(insert, content.ModelId, part, index);
            await insert.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        for (var index = 0; index < content.LayerOrder.Length; index++)
        {
            await using var insertOrder = connection.CreateCommand();
            insertOrder.Transaction = transaction;
            insertOrder.CommandText = "INSERT INTO model_draft_layer_order(model_id, layer_index, part_id) VALUES ($model, $index, $part);";
            insertOrder.Parameters.AddWithValue("$model", content.ModelId.ToString());
            insertOrder.Parameters.AddWithValue("$index", index);
            insertOrder.Parameters.AddWithValue("$part", content.LayerOrder[index].ToString());
            await insertOrder.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    private static void AddPartParameters(SqliteCommand command, ModelId modelId, ModelPart part, int index)
    {
        command.Parameters.AddWithValue("$model", modelId.ToString());
        command.Parameters.AddWithValue("$part", part.Id.ToString());
        command.Parameters.AddWithValue("$index", index);
        command.Parameters.AddWithValue("$name", part.Name);
        command.Parameters.AddWithValue("$asset", part.AssetId.ToString());
        AddRectangleParameters(command, "crop", part.SourceCrop);
        AddTransformParameters(command, "transform", part.Transform);
        AddRectangleParameters(command, "sourceCrop", part.SourceTransform.Crop);
        AddTransformParameters(command, "source", part.SourceTransform.Transform);
        command.Parameters.AddWithValue("$visible", part.IsVisible ? 1 : 0);
    }

    private static void AddRectangleParameters(SqliteCommand command, string prefix, Rect2D rectangle)
    {
        command.Parameters.AddWithValue($"${prefix}X", rectangle.X);
        command.Parameters.AddWithValue($"${prefix}Y", rectangle.Y);
        command.Parameters.AddWithValue($"${prefix}Width", rectangle.Width);
        command.Parameters.AddWithValue($"${prefix}Height", rectangle.Height);
    }

    private static void AddTransformParameters(SqliteCommand command, string prefix, Transform2D transform)
    {
        command.Parameters.AddWithValue($"${prefix}X", transform.Translation.X);
        command.Parameters.AddWithValue($"${prefix}Y", transform.Translation.Y);
        command.Parameters.AddWithValue($"${prefix}ScaleX", transform.Scale.X);
        command.Parameters.AddWithValue($"${prefix}ScaleY", transform.Scale.Y);
        command.Parameters.AddWithValue($"${prefix}Rotation", transform.RotationRadians);
        command.Parameters.AddWithValue($"${prefix}PivotX", transform.Pivot.X);
        command.Parameters.AddWithValue($"${prefix}PivotY", transform.Pivot.Y);
        command.Parameters.AddWithValue($"${prefix}FlipX", transform.FlipX ? 1 : 0);
        command.Parameters.AddWithValue($"${prefix}FlipY", transform.FlipY ? 1 : 0);
    }

    private static async Task<IReadOnlyList<ModelPart>> ReadPartsAsync(SqliteConnection connection, ModelId modelId, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT part_id, display_name, asset_id,
                   crop_x, crop_y, crop_width, crop_height,
                   transform_x, transform_y, scale_x, scale_y, rotation_radians, pivot_x, pivot_y, flip_x, flip_y,
                   source_crop_x, source_crop_y, source_crop_width, source_crop_height,
                   source_transform_x, source_transform_y, source_scale_x, source_scale_y, source_rotation_radians,
                   source_pivot_x, source_pivot_y, source_flip_x, source_flip_y, is_visible
            FROM model_draft_parts WHERE model_id = $model ORDER BY part_index;
            """;
        command.Parameters.AddWithValue("$model", modelId.ToString());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        var parts = new List<ModelPart>();
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            var sourceCrop = new Rect2D(reader.GetDouble(16), reader.GetDouble(17), reader.GetDouble(18), reader.GetDouble(19));
            var sourceTransform = ReadTransform(reader, 20);
            parts.Add(new ModelPart(
                ModelPartId.Parse(reader.GetString(0)),
                reader.GetString(1),
                AssetId.Parse(reader.GetString(2)),
                new Rect2D(reader.GetDouble(3), reader.GetDouble(4), reader.GetDouble(5), reader.GetDouble(6)),
                ReadTransform(reader, 7),
                new ModelPartSourceTransform(sourceCrop, sourceTransform),
                reader.GetInt32(29) != 0));
        }

        return parts;
    }

    private static Transform2D ReadTransform(SqliteDataReader reader, int start) => new(
        new Point2D(reader.GetDouble(start), reader.GetDouble(start + 1)),
        new Point2D(reader.GetDouble(start + 2), reader.GetDouble(start + 3)),
        reader.GetDouble(start + 4),
        new Point2D(reader.GetDouble(start + 5), reader.GetDouble(start + 6)),
        reader.GetInt32(start + 7) != 0,
        reader.GetInt32(start + 8) != 0);

    private static async Task<IReadOnlyList<ModelPartId>> ReadLayerOrderAsync(SqliteConnection connection, ModelId modelId, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT part_id FROM model_draft_layer_order WHERE model_id = $model ORDER BY layer_index;";
        command.Parameters.AddWithValue("$model", modelId.ToString());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        var order = new List<ModelPartId>();
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            order.Add(ModelPartId.Parse(reader.GetString(0)));
        }

        return order;
    }

    private static bool IsStoredContentError(Exception exception) => exception is
        SqliteException or ArgumentException or InvalidOperationException or
        FormatException or OverflowException;

    private static Result<ModelDraftContent> Failure(ApplicationErrorCode code, string message, string? details = null) =>
        Result<ModelDraftContent>.Failure(new ApplicationError(code, message, details));

    private enum SaveOutcome
    {
        Saved,
        ModelNotFound,
        MissingAsset,
        Conflict
    }

}
