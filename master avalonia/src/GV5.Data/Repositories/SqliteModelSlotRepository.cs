using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Storage;
using Microsoft.Data.Sqlite;

namespace GV5.Data.Repositories;

/// <summary>Persists the ten global Fabricador model-slot assignments in SQLite.</summary>
public sealed class SqliteModelSlotRepository(IGv5Database database) : IModelSlotRepository
{
    private readonly IGv5Database _database = database ?? throw new ArgumentNullException(nameof(database));

    public async Task<Result<IReadOnlyList<ModelSlotEntry>>> ListAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = """
                SELECT slot.slot_number, slot.model_id, model.display_name
                FROM model_slots AS slot
                JOIN models AS model ON model.model_id = slot.model_id
                ORDER BY slot.slot_number;
                """;
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            var slots = new List<ModelSlotEntry>(ModelSlot.Maximum);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
                slots.Add(new ModelSlotEntry(ModelSlot.From(reader.GetInt32(0)), ModelId.Parse(reader.GetString(1)), reader.GetString(2)));
            return Result<IReadOnlyList<ModelSlotEntry>>.Success(slots);
        }
        catch (SqliteException exception)
        {
            return Result<IReadOnlyList<ModelSlotEntry>>.Failure(new ApplicationError(
                ApplicationErrorCode.Persistence,
                "The Fabricador model slots could not be listed.",
                exception.SqliteErrorCode.ToString(System.Globalization.CultureInfo.InvariantCulture)));
        }
    }

    public async Task<Result<bool>> AssignAsync(
        ModelSlot slot,
        ModelId modelId,
        long assignedUtcMs,
        CancellationToken cancellationToken = default)
    {
        if (!slot.IsValid || !modelId.IsValid || assignedUtcMs < 0)
            return Result<bool>.Failure(new ApplicationError(ApplicationErrorCode.Validation, "A valid slot, model ID, and assignment time are required."));

        try
        {
            var assigned = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                await using (var model = connection.CreateCommand())
                {
                    model.Transaction = transaction;
                    model.CommandText = "SELECT 1 FROM models WHERE model_id = $model;";
                    model.Parameters.AddWithValue("$model", modelId.ToString());
                    if (await model.ExecuteScalarAsync(token).ConfigureAwait(false) is null)
                        return AssignmentOutcome.ModelNotFound;
                }

                await using (var slotOwner = connection.CreateCommand())
                {
                    slotOwner.Transaction = transaction;
                    slotOwner.CommandText = "SELECT model_id FROM model_slots WHERE slot_number = $slot;";
                    slotOwner.Parameters.AddWithValue("$slot", slot.Value);
                    if (await slotOwner.ExecuteScalarAsync(token).ConfigureAwait(false) is string owner)
                        return string.Equals(owner, modelId.ToString(), StringComparison.Ordinal)
                            ? AssignmentOutcome.AlreadyAssigned
                            : AssignmentOutcome.SlotOccupied;
                }

                await using (var modelSlot = connection.CreateCommand())
                {
                    modelSlot.Transaction = transaction;
                    modelSlot.CommandText = "SELECT slot_number FROM model_slots WHERE model_id = $model;";
                    modelSlot.Parameters.AddWithValue("$model", modelId.ToString());
                    if (await modelSlot.ExecuteScalarAsync(token).ConfigureAwait(false) is not null)
                        return AssignmentOutcome.ModelAlreadyAssigned;
                }

                await using var insert = connection.CreateCommand();
                insert.Transaction = transaction;
                insert.CommandText = "INSERT INTO model_slots(slot_number, model_id, assigned_utc_ms) VALUES ($slot, $model, $assigned);";
                insert.Parameters.AddWithValue("$slot", slot.Value);
                insert.Parameters.AddWithValue("$model", modelId.ToString());
                insert.Parameters.AddWithValue("$assigned", assignedUtcMs);
                await insert.ExecuteNonQueryAsync(token).ConfigureAwait(false);
                return AssignmentOutcome.Assigned;
            }, cancellationToken).ConfigureAwait(false);

            return assigned switch
            {
                AssignmentOutcome.Assigned or AssignmentOutcome.AlreadyAssigned => Result<bool>.Success(true),
                AssignmentOutcome.ModelNotFound => Result<bool>.Failure(new ApplicationError(ApplicationErrorCode.NotFound, "The model draft does not exist.", modelId.ToString())),
                AssignmentOutcome.SlotOccupied => Result<bool>.Failure(new ApplicationError(ApplicationErrorCode.Conflict, $"Slot {slot.Value:00} already contains another model; its assignment was preserved.", slot.Value.ToString(System.Globalization.CultureInfo.InvariantCulture))),
                _ => Result<bool>.Failure(new ApplicationError(ApplicationErrorCode.Conflict, "This model is already assigned to another slot.", modelId.ToString()))
            };
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        {
            return Result<bool>.Failure(new ApplicationError(ApplicationErrorCode.Conflict, "The model slot assignment conflicts with an existing slot or model assignment."));
        }
        catch (SqliteException exception)
        {
            return Result<bool>.Failure(new ApplicationError(
                ApplicationErrorCode.Persistence,
                "The model slot assignment could not be saved.",
                exception.SqliteErrorCode.ToString(System.Globalization.CultureInfo.InvariantCulture)));
        }
    }

    private enum AssignmentOutcome
    {
        Assigned,
        AlreadyAssigned,
        ModelNotFound,
        SlotOccupied,
        ModelAlreadyAssigned
    }
}
