using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Storage;
using Microsoft.Data.Sqlite;

namespace GV5.Data.Repositories;

/// <summary>SQLite implementation of the ModelDraft repository contract.</summary>
public sealed class SqliteModelDraftRepository(IGv5Database database) : IModelDraftRepository
{
    private readonly IGv5Database _database = database ?? throw new ArgumentNullException(nameof(database));

    public async Task<Result<ModelDraft>> CreateAsync(ModelDraft draft, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(draft);
        if (draft.Revision != Revision.Initial || draft.CreatedUtcMs != draft.UpdatedUtcMs)
        {
            return Result<ModelDraft>.Failure(new ApplicationError(
                ApplicationErrorCode.Validation,
                "A new model draft must start at revision 1 with matching creation and update times.",
                draft.Id.ToString()));
        }

        try
        {
            await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = "INSERT INTO models(model_id, revision, display_name, created_utc_ms, updated_utc_ms) VALUES ($id, $revision, $name, $created, $updated);";
                AddDraftParameters(command, draft);
                await command.ExecuteNonQueryAsync(token).ConfigureAwait(false);
                return true;
            }, cancellationToken).ConfigureAwait(false);

            return Result<ModelDraft>.Success(draft);
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        {
            return Result<ModelDraft>.Failure(new ApplicationError(
                ApplicationErrorCode.Conflict,
                "A model with this ID already exists or violates a database constraint.",
                draft.Id.ToString()));
        }
    }

    public async Task<Result<ModelDraft>> GetAsync(ModelId id, CancellationToken cancellationToken = default)
    {
        if (!id.IsValid)
        {
            return Result<ModelDraft>.Failure(new ApplicationError(ApplicationErrorCode.Validation, "A valid model ID is required."));
        }

        await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT revision, display_name, created_utc_ms, updated_utc_ms FROM models WHERE model_id = $id;";
        command.Parameters.AddWithValue("$id", id.ToString());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            return Result<ModelDraft>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "The model draft does not exist.", id.ToString()));
        }

        var draft = ModelDraft.Restore(
            id,
            Revision.From(reader.GetInt64(0)),
            reader.GetString(1),
            reader.GetInt64(2),
            reader.GetInt64(3));
        return Result<ModelDraft>.Success(draft);
    }

    public async Task<Result<IReadOnlyList<ModelDraft>>> ListAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT model_id, revision, display_name, created_utc_ms, updated_utc_ms FROM models ORDER BY updated_utc_ms DESC, model_id COLLATE BINARY ASC;";
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);

            var drafts = new List<ModelDraft>();
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                drafts.Add(ModelDraft.Restore(
                    ModelId.Parse(reader.GetString(0)),
                    Revision.From(reader.GetInt64(1)),
                    reader.GetString(2),
                    reader.GetInt64(3),
                    reader.GetInt64(4)));
            }

            return Result<IReadOnlyList<ModelDraft>>.Success(drafts);
        }
        catch (SqliteException exception)
        {
            return Result<IReadOnlyList<ModelDraft>>.Failure(new ApplicationError(
                ApplicationErrorCode.Persistence,
                "Model drafts could not be listed.",
                exception.SqliteErrorCode.ToString(System.Globalization.CultureInfo.InvariantCulture)));
        }
    }

    public async Task<Result<ModelDraft>> DuplicateAsync(
        ModelId sourceId,
        string name,
        long nowUtcMs,
        CancellationToken cancellationToken = default)
    {
        if (!sourceId.IsValid)
        {
            return Result<ModelDraft>.Failure(new ApplicationError(ApplicationErrorCode.Validation, "A valid source model ID is required."));
        }

        ModelDraft duplicate;
        try
        {
            duplicate = ModelDraft.Create(ModelId.New(), name, nowUtcMs);
        }
        catch (ArgumentException exception)
        {
            return Result<ModelDraft>.Failure(new ApplicationError(ApplicationErrorCode.Validation, exception.Message));
        }

        try
        {
            var sourceExists = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                await using var source = connection.CreateCommand();
                source.Transaction = transaction;
                source.CommandText = "SELECT 1 FROM models WHERE model_id = $id;";
                source.Parameters.AddWithValue("$id", sourceId.ToString());
                if (await source.ExecuteScalarAsync(token).ConfigureAwait(false) is null)
                {
                    return false;
                }

                await using var insert = connection.CreateCommand();
                insert.Transaction = transaction;
                insert.CommandText = "INSERT INTO models(model_id, revision, display_name, created_utc_ms, updated_utc_ms) VALUES ($id, $revision, $name, $created, $updated);";
                AddDraftParameters(insert, duplicate);
                await insert.ExecuteNonQueryAsync(token).ConfigureAwait(false);
                await CopyContentSnapshotAsync(connection, transaction, sourceId, duplicate, token).ConfigureAwait(false);
                return true;
            }, cancellationToken).ConfigureAwait(false);

            return sourceExists
                ? Result<ModelDraft>.Success(duplicate)
                : Result<ModelDraft>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "The source model draft does not exist.", sourceId.ToString()));
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        {
            return Result<ModelDraft>.Failure(new ApplicationError(
                ApplicationErrorCode.Conflict,
                "The duplicate model draft could not be created because its identity conflicts with existing data.",
                duplicate.Id.ToString()));
        }
        catch (SqliteException exception)
        {
            return Result<ModelDraft>.Failure(new ApplicationError(
                ApplicationErrorCode.Persistence,
                "The model draft could not be duplicated.",
                exception.SqliteErrorCode.ToString(System.Globalization.CultureInfo.InvariantCulture)));
        }
    }

    public async Task<Result<ModelDraft>> UpdateAsync(
        ModelDraft draft,
        Revision expectedRevision,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(draft);
        if (!expectedRevision.IsValid || !draft.Id.IsValid)
        {
            return Result<ModelDraft>.Failure(new ApplicationError(
                ApplicationErrorCode.Validation,
                "A valid model ID and expected revision are required.",
                draft.Id.ToString()));
        }

        if (draft.Revision == expectedRevision)
        {
            try
            {
                var noOpOutcome = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
                {
                    var current = await ReadDraftAsync(connection, transaction, draft.Id, token).ConfigureAwait(false);
                    if (current is null)
                    {
                        return UpdateOutcome.NotFound;
                    }

                    if (current.Revision != expectedRevision)
                    {
                        return UpdateOutcome.Conflict;
                    }

                    return current == draft ? UpdateOutcome.Unchanged : UpdateOutcome.Validation;
                }, cancellationToken).ConfigureAwait(false);

                return noOpOutcome switch
                {
                    UpdateOutcome.Unchanged => Result<ModelDraft>.Success(draft),
                    UpdateOutcome.NotFound => Result<ModelDraft>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "The model draft does not exist.", draft.Id.ToString())),
                    UpdateOutcome.Conflict => Result<ModelDraft>.Failure(new ApplicationError(ApplicationErrorCode.Conflict, "The model draft changed since it was loaded.", draft.Id.ToString())),
                    _ => Result<ModelDraft>.Failure(new ApplicationError(ApplicationErrorCode.Validation, "Model draft content cannot change without advancing its revision.", draft.Id.ToString()))
                };
            }
            catch (SqliteException exception)
            {
                return Result<ModelDraft>.Failure(new ApplicationError(ApplicationErrorCode.Persistence, exception.Message, draft.Id.ToString()));
            }
        }

        Revision nextRevision;
        try
        {
            nextRevision = expectedRevision.Next();
        }
        catch (InvalidOperationException)
        {
            return Result<ModelDraft>.Failure(new ApplicationError(ApplicationErrorCode.Validation, "A valid expected revision is required.", draft.Id.ToString()));
        }
        catch (OverflowException)
        {
            return Result<ModelDraft>.Failure(new ApplicationError(ApplicationErrorCode.Validation, "The model revision cannot be incremented further.", draft.Id.ToString()));
        }

        if (!draft.Id.IsValid || draft.Revision != nextRevision || draft.CreatedUtcMs > draft.UpdatedUtcMs)
        {
            return Result<ModelDraft>.Failure(new ApplicationError(
                ApplicationErrorCode.Validation,
                "The updated draft must carry the next revision after expectedRevision.",
                draft.Id.ToString()));
        }

        try
        {
            var outcome = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                await using var update = connection.CreateCommand();
                update.Transaction = transaction;
                update.CommandText = "UPDATE models SET revision = $revision, display_name = $name, updated_utc_ms = $updated WHERE model_id = $id AND revision = $expected AND created_utc_ms = $created AND updated_utc_ms <= $updated;";
                AddDraftParameters(update, draft);
                update.Parameters.AddWithValue("$expected", expectedRevision.Value);
                if (await update.ExecuteNonQueryAsync(token).ConfigureAwait(false) == 1)
                {
                    return UpdateOutcome.Updated;
                }

                await using var exists = connection.CreateCommand();
                exists.Transaction = transaction;
                exists.CommandText = "SELECT revision, created_utc_ms, updated_utc_ms FROM models WHERE model_id = $id;";
                exists.Parameters.AddWithValue("$id", draft.Id.ToString());
                await using var reader = await exists.ExecuteReaderAsync(token).ConfigureAwait(false);
                if (!await reader.ReadAsync(token).ConfigureAwait(false))
                {
                    return UpdateOutcome.NotFound;
                }

                if (reader.GetInt64(0) != expectedRevision.Value)
                {
                    return UpdateOutcome.Conflict;
                }

                if (reader.GetInt64(1) != draft.CreatedUtcMs || draft.UpdatedUtcMs < reader.GetInt64(2))
                {
                    return UpdateOutcome.Validation;
                }

                return UpdateOutcome.Persistence;
            }, cancellationToken).ConfigureAwait(false);

            return outcome switch
            {
                UpdateOutcome.Updated => Result<ModelDraft>.Success(draft),
                UpdateOutcome.NotFound => Result<ModelDraft>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "The model draft does not exist.", draft.Id.ToString())),
                UpdateOutcome.Validation => Result<ModelDraft>.Failure(new ApplicationError(ApplicationErrorCode.Validation, "The model draft creation time cannot be changed.", draft.Id.ToString())),
                UpdateOutcome.Persistence => Result<ModelDraft>.Failure(new ApplicationError(ApplicationErrorCode.Persistence, "The model draft could not be updated.", draft.Id.ToString())),
                _ => Result<ModelDraft>.Failure(new ApplicationError(ApplicationErrorCode.Conflict, "The model draft changed since it was loaded.", draft.Id.ToString()))
            };
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        {
            return Result<ModelDraft>.Failure(new ApplicationError(ApplicationErrorCode.Validation, "The model draft violates a database constraint.", draft.Id.ToString()));
        }
    }

    private static void AddDraftParameters(SqliteCommand command, ModelDraft draft)
    {
        command.Parameters.AddWithValue("$id", draft.Id.ToString());
        command.Parameters.AddWithValue("$revision", draft.Revision.Value);
        command.Parameters.AddWithValue("$name", draft.Name);
        command.Parameters.AddWithValue("$created", draft.CreatedUtcMs);
        command.Parameters.AddWithValue("$updated", draft.UpdatedUtcMs);
    }

    private static async Task CopyContentSnapshotAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        ModelId sourceId,
        ModelDraft duplicate,
        CancellationToken cancellationToken)
    {
        await using (var copyContent = connection.CreateCommand())
        {
            copyContent.Transaction = transaction;
            copyContent.CommandText = """
                INSERT INTO model_draft_contents(model_id, content_revision, schema_version, slot, source_asset_id, source_width, source_height, updated_utc_ms)
                SELECT $target, 1, schema_version, slot, source_asset_id, source_width, source_height, $updated
                FROM model_draft_contents WHERE model_id = $source;
                """;
            copyContent.Parameters.AddWithValue("$target", duplicate.Id.ToString());
            copyContent.Parameters.AddWithValue("$source", sourceId.ToString());
            copyContent.Parameters.AddWithValue("$updated", duplicate.UpdatedUtcMs);
            if (await copyContent.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false) == 0)
            {
                return;
            }
        }

        await using (var copyParts = connection.CreateCommand())
        {
            copyParts.Transaction = transaction;
            copyParts.CommandText = """
                INSERT INTO model_draft_parts(
                    model_id, part_id, part_index, display_name, asset_id,
                    crop_x, crop_y, crop_width, crop_height,
                    transform_x, transform_y, scale_x, scale_y, rotation_radians, pivot_x, pivot_y, flip_x, flip_y,
                    source_crop_x, source_crop_y, source_crop_width, source_crop_height,
                    source_transform_x, source_transform_y, source_scale_x, source_scale_y, source_rotation_radians,
                    source_pivot_x, source_pivot_y, source_flip_x, source_flip_y, is_visible)
                SELECT $target, part_id, part_index, display_name, asset_id,
                    crop_x, crop_y, crop_width, crop_height,
                    transform_x, transform_y, scale_x, scale_y, rotation_radians, pivot_x, pivot_y, flip_x, flip_y,
                    source_crop_x, source_crop_y, source_crop_width, source_crop_height,
                    source_transform_x, source_transform_y, source_scale_x, source_scale_y, source_rotation_radians,
                    source_pivot_x, source_pivot_y, source_flip_x, source_flip_y, is_visible
                FROM model_draft_parts WHERE model_id = $source;
                """;
            copyParts.Parameters.AddWithValue("$target", duplicate.Id.ToString());
            copyParts.Parameters.AddWithValue("$source", sourceId.ToString());
            await copyParts.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        await using (var copyLayers = connection.CreateCommand())
        {
            copyLayers.Transaction = transaction;
            copyLayers.CommandText = "INSERT INTO model_draft_layer_order(model_id, layer_index, part_id) SELECT $target, layer_index, part_id FROM model_draft_layer_order WHERE model_id = $source;";
            copyLayers.Parameters.AddWithValue("$target", duplicate.Id.ToString());
            copyLayers.Parameters.AddWithValue("$source", sourceId.ToString());
            await copyLayers.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        await using (var copyJoints = connection.CreateCommand())
        {
            copyJoints.Transaction = transaction;
            copyJoints.CommandText = "INSERT INTO model_draft_rig_joints(model_id, joint_id, joint_index, parent_part_id, child_part_id, parent_anchor_x, parent_anchor_y, child_anchor_x, child_anchor_y, mode, is_suggested) SELECT $target, joint_id, joint_index, parent_part_id, child_part_id, parent_anchor_x, parent_anchor_y, child_anchor_x, child_anchor_y, mode, is_suggested FROM model_draft_rig_joints WHERE model_id = $source;";
            copyJoints.Parameters.AddWithValue("$target", duplicate.Id.ToString());
            copyJoints.Parameters.AddWithValue("$source", sourceId.ToString());
            await copyJoints.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        await using (var copyReferences = connection.CreateCommand())
        {
            copyReferences.Transaction = transaction;
            copyReferences.CommandText = """
                INSERT INTO asset_references(owner_type, owner_id, slot, asset_id, created_utc_ms)
                SELECT owner_type, $target, slot, asset_id, $created
                FROM asset_references WHERE owner_type = 'fabricator.model-draft' AND owner_id = $source;
                """;
            copyReferences.Parameters.AddWithValue("$target", duplicate.Id.ToString());
            copyReferences.Parameters.AddWithValue("$source", sourceId.ToString());
            copyReferences.Parameters.AddWithValue("$created", duplicate.UpdatedUtcMs);
            await copyReferences.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        await using var clearCandidates = connection.CreateCommand();
        clearCandidates.Transaction = transaction;
        clearCandidates.CommandText = "DELETE FROM asset_gc_candidates WHERE asset_id IN (SELECT asset_id FROM asset_references WHERE owner_type = 'fabricator.model-draft' AND owner_id = $target);";
        clearCandidates.Parameters.AddWithValue("$target", duplicate.Id.ToString());
        await clearCandidates.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task<ModelDraft?> ReadDraftAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        ModelId id,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT revision, display_name, created_utc_ms, updated_utc_ms FROM models WHERE model_id = $id;";
        command.Parameters.AddWithValue("$id", id.ToString());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        return await reader.ReadAsync(cancellationToken).ConfigureAwait(false)
            ? ModelDraft.Restore(id, Revision.From(reader.GetInt64(0)), reader.GetString(1), reader.GetInt64(2), reader.GetInt64(3))
            : null;
    }

    private enum UpdateOutcome
    {
        Updated,
        Unchanged,
        NotFound,
        Validation,
        Persistence,
        Conflict
    }
}
