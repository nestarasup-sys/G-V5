using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Storage;

namespace GV5.Data.Repositories;

/// <summary>SQLite-backed write-ahead journal for pending ModelDraft edits.</summary>
public sealed class SqliteModelDraftCheckpointStore(IGv5Database database) : IModelDraftCheckpointStore
{
    private readonly IGv5Database _database = database ?? throw new ArgumentNullException(nameof(database));

    public async Task WriteAsync(ModelDraftCheckpoint checkpoint, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(checkpoint);
        await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
        {
            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = """
                INSERT INTO model_draft_checkpoints(checkpoint_id, model_id, expected_revision, display_name, created_utc_ms)
                VALUES ($checkpoint, $model, $revision, $name, $created)
                ON CONFLICT(checkpoint_id) DO UPDATE SET
                    expected_revision = excluded.expected_revision,
                    display_name = excluded.display_name,
                    created_utc_ms = excluded.created_utc_ms
                WHERE model_draft_checkpoints.model_id = excluded.model_id;
                """;
            command.Parameters.AddWithValue("$checkpoint", checkpoint.CheckpointId.ToString("D"));
            command.Parameters.AddWithValue("$model", checkpoint.ModelId.ToString());
            command.Parameters.AddWithValue("$revision", checkpoint.ExpectedRevision?.Value is { } revision ? revision : DBNull.Value);
            command.Parameters.AddWithValue("$name", checkpoint.Name);
            command.Parameters.AddWithValue("$created", checkpoint.CreatedUtcMs);
            if (await command.ExecuteNonQueryAsync(token).ConfigureAwait(false) != 1)
            {
                throw new InvalidOperationException("A checkpoint ID cannot be reused for a different model.");
            }

            return true;
        }, cancellationToken).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<ModelDraftCheckpoint>> GetPendingAsync(CancellationToken cancellationToken = default)
    {
        await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT checkpoint_id, model_id, expected_revision, display_name, created_utc_ms FROM model_draft_checkpoints ORDER BY created_utc_ms, checkpoint_id;";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        var checkpoints = new List<ModelDraftCheckpoint>();
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            Revision? expectedRevision = reader.IsDBNull(2) ? null : Revision.From(reader.GetInt64(2));
            checkpoints.Add(ModelDraftCheckpoint.Restore(
                Guid.Parse(reader.GetString(0)),
                ModelId.Parse(reader.GetString(1)),
                expectedRevision,
                reader.GetString(3),
                reader.GetInt64(4)));
        }

        return checkpoints.AsReadOnly();
    }

    public Task CompleteAsync(Guid checkpointId, CancellationToken cancellationToken = default)
    {
        if (checkpointId == Guid.Empty)
        {
            throw new ArgumentException("A valid checkpoint ID is required.", nameof(checkpointId));
        }

        return _database.ExecuteWriteAsync(async (connection, transaction, token) =>
        {
            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = "DELETE FROM model_draft_checkpoints WHERE checkpoint_id = $checkpoint;";
            command.Parameters.AddWithValue("$checkpoint", checkpointId.ToString("D"));
            await command.ExecuteNonQueryAsync(token).ConfigureAwait(false);
            return true;
        }, cancellationToken);
    }
}
