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
