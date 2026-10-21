using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Storage;
using Microsoft.Data.Sqlite;
using System.Text.Json;

namespace GV5.Data.Repositories;

/// <summary>Persists animation drafts with checksums, immutable model references and optimistic concurrency.</summary>
public sealed class SqliteAnimationRepository(IGv5Database database) : IAnimationRepository
{
    private readonly IGv5Database _database = database ?? throw new ArgumentNullException(nameof(database));

    public async Task<Result<AnimationDraft>> CreateAsync(AnimationDraft animation, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(animation);
        if (animation.Revision != Revision.Initial)
            return Failure<AnimationDraft>(ApplicationErrorCode.Validation, "A new animation must start at revision 1.", animation.Id.ToString());
        var pinnedModel = await ReadPinnedModelAsync(animation.Model, cancellationToken).ConfigureAwait(false);
        if (pinnedModel.IsFailure) return Result<AnimationDraft>.Failure(pinnedModel.Error!);
        var validation = ValidateFrames(animation, pinnedModel.Value);
        if (validation is not null) return Result<AnimationDraft>.Failure(validation);

        (string Json, string Sha256) encoded;
        try { encoded = AnimationSnapshotCodec.Encode(animation); }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException)
        { return Failure<AnimationDraft>(ApplicationErrorCode.Validation, "The animation draft could not be validated.", animation.Id.ToString()); }
        try
        {
            await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = "INSERT INTO animation_drafts(animation_id, model_revision_id, model_revision_sequence, model_snapshot_sha256, model_id, revision, display_name, animation_json, animation_sha256, updated_utc_ms) VALUES ($id, $model_revision_id, $model_revision_sequence, $model_snapshot_sha256, $model_id, $revision, $name, $json, $hash, $updated);";
                AddParameters(command, animation, encoded.Json, encoded.Sha256);
                await command.ExecuteNonQueryAsync(token).ConfigureAwait(false);
                return true;
            }, cancellationToken).ConfigureAwait(false);
            return Result<AnimationDraft>.Success(animation);
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        { return Failure<AnimationDraft>(ApplicationErrorCode.Conflict, "An animation with this ID already exists or violates a database constraint.", animation.Id.ToString()); }
        catch (SqliteException exception)
        { return Failure<AnimationDraft>(ApplicationErrorCode.Persistence, "The animation draft could not be saved.", SqliteCode(exception)); }
    }

    public async Task<Result<AnimationDraft>> GetAsync(AnimationId animationId, CancellationToken cancellationToken = default)
    {
        if (!animationId.IsValid) return Failure<AnimationDraft>(ApplicationErrorCode.Validation, "A valid animation ID is required.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT animation_id, model_revision_id, model_revision_sequence, model_snapshot_sha256, model_id, revision, display_name, animation_json, animation_sha256 FROM animation_drafts WHERE animation_id = $id;";
            command.Parameters.AddWithValue("$id", animationId.ToString());
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
                return Failure<AnimationDraft>(ApplicationErrorCode.NotFound, "The animation draft does not exist.", animationId.ToString());
            var decoded = DecodeRow(reader);
            if (decoded.IsFailure) return decoded;
            var pinned = await ReadPinnedModelAsync(decoded.Value.Model, cancellationToken).ConfigureAwait(false);
            if (pinned.IsFailure) return Result<AnimationDraft>.Failure(pinned.Error!);
            var validation = ValidateFrames(decoded.Value, pinned.Value);
            return validation is null ? decoded : Result<AnimationDraft>.Failure(validation);
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or JsonException or KeyNotFoundException)
        { return Failure<AnimationDraft>(ApplicationErrorCode.Persistence, "The animation draft could not be read or verified.", animationId.ToString()); }
    }

    public async Task<Result<IReadOnlyList<AnimationDraft>>> ListAsync(ModelRevisionId modelRevisionId, CancellationToken cancellationToken = default)
    {
        if (!modelRevisionId.IsValid)
            return Failure<IReadOnlyList<AnimationDraft>>(ApplicationErrorCode.Validation, "A valid model revision ID is required.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT animation_id, model_revision_id, model_revision_sequence, model_snapshot_sha256, model_id, revision, display_name, animation_json, animation_sha256 FROM animation_drafts WHERE model_revision_id = $revision ORDER BY display_name COLLATE NOCASE, animation_id;";
            command.Parameters.AddWithValue("$revision", modelRevisionId.ToString());
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            var animations = new List<AnimationDraft>();
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                var decoded = DecodeRow(reader);
                if (decoded.IsFailure) return Result<IReadOnlyList<AnimationDraft>>.Failure(decoded.Error!);
                animations.Add(decoded.Value);
            }
            await reader.DisposeAsync().ConfigureAwait(false);
            foreach (var animation in animations)
            {
                var pinned = await ReadPinnedModelAsync(animation.Model, cancellationToken).ConfigureAwait(false);
                if (pinned.IsFailure) return Result<IReadOnlyList<AnimationDraft>>.Failure(pinned.Error!);
                var validation = ValidateFrames(animation, pinned.Value);
                if (validation is not null) return Result<IReadOnlyList<AnimationDraft>>.Failure(validation);
            }
            return Result<IReadOnlyList<AnimationDraft>>.Success(animations.AsReadOnly());
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or JsonException or KeyNotFoundException)
        { return Failure<IReadOnlyList<AnimationDraft>>(ApplicationErrorCode.Persistence, "Animation drafts could not be listed.", modelRevisionId.ToString()); }
    }

    public async Task<Result<IReadOnlyList<AnimationDraft>>> ListByModelAsync(ModelId modelId, CancellationToken cancellationToken = default)
    {
        if (!modelId.IsValid)
            return Failure<IReadOnlyList<AnimationDraft>>(ApplicationErrorCode.Validation, "A valid model ID is required.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT animation_id, model_revision_id, model_revision_sequence, model_snapshot_sha256, model_id, revision, display_name, animation_json, animation_sha256 FROM animation_drafts WHERE model_id = $model ORDER BY model_revision_sequence DESC, display_name COLLATE NOCASE, animation_id;";
            command.Parameters.AddWithValue("$model", modelId.ToString());
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            var animations = new List<AnimationDraft>();
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                var decoded = DecodeRow(reader);
                if (decoded.IsFailure) return Result<IReadOnlyList<AnimationDraft>>.Failure(decoded.Error!);
                animations.Add(decoded.Value);
            }
            await reader.DisposeAsync().ConfigureAwait(false);
            foreach (var animation in animations)
            {
                var pinned = await ReadPinnedModelAsync(animation.Model, cancellationToken).ConfigureAwait(false);
                if (pinned.IsFailure) return Result<IReadOnlyList<AnimationDraft>>.Failure(pinned.Error!);
                var validation = ValidateFrames(animation, pinned.Value);
                if (validation is not null) return Result<IReadOnlyList<AnimationDraft>>.Failure(validation);
            }
            return Result<IReadOnlyList<AnimationDraft>>.Success(animations.AsReadOnly());
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or JsonException or KeyNotFoundException)
        { return Failure<IReadOnlyList<AnimationDraft>>(ApplicationErrorCode.Persistence, "Animations for this model could not be listed.", modelId.ToString()); }
    }

    public async Task<Result<IReadOnlyList<AnimationSlotAssignment>>> ListSlotsAsync(
        ModelId modelId, CancellationToken cancellationToken = default)
    {
        if (!modelId.IsValid)
            return Failure<IReadOnlyList<AnimationSlotAssignment>>(ApplicationErrorCode.Validation, "A valid model ID is required.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT slot_number, animation_id FROM animation_slots WHERE model_id = $model ORDER BY slot_number;";
            command.Parameters.AddWithValue("$model", modelId.ToString());
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            var assignments = new List<AnimationSlotAssignment>();
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
                assignments.Add(new AnimationSlotAssignment(reader.GetInt32(0), AnimationId.Parse(reader.GetString(1))));
            return Result<IReadOnlyList<AnimationSlotAssignment>>.Success(assignments.AsReadOnly());
        }
        catch (Exception exception) when (exception is SqliteException or ArgumentException or FormatException)
        { return Failure<IReadOnlyList<AnimationSlotAssignment>>(ApplicationErrorCode.Persistence, "Animation slots could not be listed.", modelId.ToString()); }
    }

    public async Task<Result<AnimationSlotAssignment>> AssignToSlotAsync(
        ModelId modelId, AnimationId animationId, int slotNumber, CancellationToken cancellationToken = default)
    {
        if (!modelId.IsValid || !animationId.IsValid || slotNumber is < 1 or > 12)
            return Failure<AnimationSlotAssignment>(ApplicationErrorCode.Validation, "A valid model, animation and slot from 1 to 12 are required.");
        try
        {
            var assigned = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                await using var exists = connection.CreateCommand();
                exists.Transaction = transaction;
                exists.CommandText = "SELECT 1 FROM animation_drafts WHERE animation_id = $animation AND model_id = $model;";
                exists.Parameters.AddWithValue("$animation", animationId.ToString());
                exists.Parameters.AddWithValue("$model", modelId.ToString());
                if (await exists.ExecuteScalarAsync(token).ConfigureAwait(false) is null) return false;

                await using var remove = connection.CreateCommand();
                remove.Transaction = transaction;
                remove.CommandText = "DELETE FROM animation_slots WHERE animation_id = $animation OR (model_id = $model AND slot_number = $slot);";
                remove.Parameters.AddWithValue("$animation", animationId.ToString());
                remove.Parameters.AddWithValue("$model", modelId.ToString());
                remove.Parameters.AddWithValue("$slot", slotNumber);
                await remove.ExecuteNonQueryAsync(token).ConfigureAwait(false);

                await using var insert = connection.CreateCommand();
                insert.Transaction = transaction;
                insert.CommandText = "INSERT INTO animation_slots(model_id, slot_number, animation_id, assigned_utc_ms) VALUES ($model, $slot, $animation, $assigned);";
                insert.Parameters.AddWithValue("$model", modelId.ToString());
                insert.Parameters.AddWithValue("$slot", slotNumber);
                insert.Parameters.AddWithValue("$animation", animationId.ToString());
                insert.Parameters.AddWithValue("$assigned", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                await insert.ExecuteNonQueryAsync(token).ConfigureAwait(false);
                return true;
            }, cancellationToken).ConfigureAwait(false);
            return assigned
                ? Result<AnimationSlotAssignment>.Success(new AnimationSlotAssignment(slotNumber, animationId))
                : Failure<AnimationSlotAssignment>(ApplicationErrorCode.NotFound, "The animation does not belong to this model.", animationId.ToString());
        }
        catch (SqliteException exception)
        { return Failure<AnimationSlotAssignment>(ApplicationErrorCode.Persistence, "The animation could not be assigned to its slot.", SqliteCode(exception)); }
    }

    public async Task<Result<bool>> ClearSlotAsync(
        ModelId modelId, int slotNumber, CancellationToken cancellationToken = default)
    {
        if (!modelId.IsValid || slotNumber is < 1 or > 12)
            return Failure<bool>(ApplicationErrorCode.Validation, "A valid model and slot from 1 to 12 are required.");
        try
        {
            var cleared = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = "DELETE FROM animation_slots WHERE model_id = $model AND slot_number = $slot;";
                command.Parameters.AddWithValue("$model", modelId.ToString());
                command.Parameters.AddWithValue("$slot", slotNumber);
                return await command.ExecuteNonQueryAsync(token).ConfigureAwait(false) == 1;
            }, cancellationToken).ConfigureAwait(false);
            return Result<bool>.Success(cleared);
        }
        catch (SqliteException exception)
        { return Failure<bool>(ApplicationErrorCode.Persistence, "The animation slot could not be cleared.", SqliteCode(exception)); }
    }

    public async Task<Result<AnimationDraft>> SaveAsync(AnimationDraft animation, Revision expectedRevision, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(animation);
        if (!expectedRevision.IsValid || animation.Revision.Value <= expectedRevision.Value)
            return Failure<AnimationDraft>(ApplicationErrorCode.Validation, "Saving an animation requires a revision newer than the stored revision.", animation.Id.ToString());
        var pinnedModel = await ReadPinnedModelAsync(animation.Model, cancellationToken).ConfigureAwait(false);
        if (pinnedModel.IsFailure) return Result<AnimationDraft>.Failure(pinnedModel.Error!);
        var validation = ValidateFrames(animation, pinnedModel.Value);
        if (validation is not null) return Result<AnimationDraft>.Failure(validation);
        (string Json, string Sha256) encoded;
        try { encoded = AnimationSnapshotCodec.Encode(animation); }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException)
        { return Failure<AnimationDraft>(ApplicationErrorCode.Validation, "The animation draft could not be validated.", animation.Id.ToString()); }
        try
        {
            var updated = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = "UPDATE animation_drafts SET revision = $revision, display_name = $name, animation_json = $json, animation_sha256 = $hash, updated_utc_ms = $updated WHERE animation_id = $id AND model_revision_id = $model_revision_id AND model_revision_sequence = $model_revision_sequence AND model_snapshot_sha256 = $model_snapshot_sha256 AND model_id = $model_id AND revision = $expected;";
                AddParameters(command, animation, encoded.Json, encoded.Sha256);
                command.Parameters.AddWithValue("$expected", expectedRevision.Value);
                return await command.ExecuteNonQueryAsync(token).ConfigureAwait(false) == 1;
            }, cancellationToken).ConfigureAwait(false);
            if (updated) return Result<AnimationDraft>.Success(animation);
            var current = await GetAsync(animation.Id, cancellationToken).ConfigureAwait(false);
            return current.IsFailure ? Result<AnimationDraft>.Failure(current.Error!)
                : Failure<AnimationDraft>(ApplicationErrorCode.Conflict, "The animation changed in another editor; its newer revision was preserved.", animation.Id.ToString());
        }
        catch (SqliteException exception)
        { return Failure<AnimationDraft>(ApplicationErrorCode.Persistence, "The animation draft could not be saved.", SqliteCode(exception)); }
    }

    public async Task<Result<bool>> DeleteAsync(AnimationId animationId, Revision expectedRevision, CancellationToken cancellationToken = default)
    {
        if (!animationId.IsValid || !expectedRevision.IsValid)
            return Failure<bool>(ApplicationErrorCode.Validation, "A valid animation ID and revision are required.");
        try
        {
            var deleted = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = "DELETE FROM animation_drafts WHERE animation_id = $id AND revision = $revision;";
                command.Parameters.AddWithValue("$id", animationId.ToString());
                command.Parameters.AddWithValue("$revision", expectedRevision.Value);
                return await command.ExecuteNonQueryAsync(token).ConfigureAwait(false) == 1;
            }, cancellationToken).ConfigureAwait(false);
            if (deleted) return Result<bool>.Success(true);
            var current = await GetAsync(animationId, cancellationToken).ConfigureAwait(false);
            return current.IsFailure ? Result<bool>.Failure(current.Error!)
                : Failure<bool>(ApplicationErrorCode.Conflict, "The animation revision changed before it could be deleted.", animationId.ToString());
        }
        catch (SqliteException exception)
        { return Failure<bool>(ApplicationErrorCode.Persistence, "The animation draft could not be deleted.", SqliteCode(exception)); }
    }

    private async Task<Result<PublishedModelRevision>> ReadPinnedModelAsync(ModelRevisionReference reference, CancellationToken cancellationToken)
    {
        var model = await new SqliteModelRevisionRepository(_database)
            .GetAsync(reference.ModelId, reference.Sequence, cancellationToken).ConfigureAwait(false);
        if (model.IsFailure) return model;
        if (model.Value.Id != reference.RevisionId || model.Value.SnapshotSha256 != reference.SnapshotSha256)
            return Failure<PublishedModelRevision>(ApplicationErrorCode.NotFound, "The exact model revision pinned by this animation is unavailable.", reference.RevisionId.ToString());
        return model;
    }

    private static ApplicationError? ValidateFrames(AnimationDraft animation, PublishedModelRevision model)
    {
        try
        {
            foreach (var frame in animation.Frames) _ = animation.ApplyFrameToModelRevision(model, frame.Id);
            return null;
        }
        catch (Exception exception) when (exception is ArgumentException or KeyNotFoundException)
        { return new ApplicationError(ApplicationErrorCode.Validation, exception.Message, animation.Id.ToString()); }
    }

    private static Result<AnimationDraft> DecodeRow(SqliteDataReader reader)
    {
        try
        {
            var animation = AnimationSnapshotCodec.Decode(reader.GetString(7), reader.GetString(8));
            if (animation.Id != AnimationId.Parse(reader.GetString(0))
                || animation.Model.RevisionId != ModelRevisionId.Parse(reader.GetString(1))
                || animation.Model.Sequence.Value != reader.GetInt64(2)
                || animation.Model.SnapshotSha256 != reader.GetString(3)
                || animation.Model.ModelId != ModelId.Parse(reader.GetString(4))
                || animation.Revision.Value != reader.GetInt64(5)
                || animation.Name != reader.GetString(6))
                return Failure<AnimationDraft>(ApplicationErrorCode.Persistence, "The animation snapshot does not match its indexed database columns.", reader.GetString(0));
            return Result<AnimationDraft>.Success(animation);
        }
        catch (Exception exception) when (exception is InvalidDataException or ArgumentException or JsonException or KeyNotFoundException or FormatException)
        { return Failure<AnimationDraft>(ApplicationErrorCode.Persistence, "The animation snapshot could not be decoded or verified.", reader.GetString(0)); }
    }

    private static void AddParameters(SqliteCommand command, AnimationDraft animation, string json, string sha256)
    {
        command.Parameters.AddWithValue("$id", animation.Id.ToString());
        command.Parameters.AddWithValue("$model_revision_id", animation.Model.RevisionId.ToString());
        command.Parameters.AddWithValue("$model_revision_sequence", animation.Model.Sequence.Value);
        command.Parameters.AddWithValue("$model_snapshot_sha256", animation.Model.SnapshotSha256);
        command.Parameters.AddWithValue("$model_id", animation.Model.ModelId.ToString());
        command.Parameters.AddWithValue("$revision", animation.Revision.Value);
        command.Parameters.AddWithValue("$name", animation.Name);
        command.Parameters.AddWithValue("$json", json);
        command.Parameters.AddWithValue("$hash", sha256);
        command.Parameters.AddWithValue("$updated", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }

    private static string SqliteCode(SqliteException exception) => exception.SqliteErrorCode.ToString(System.Globalization.CultureInfo.InvariantCulture);
    private static Result<T> Failure<T>(ApplicationErrorCode code, string message, string? target = null) =>
        Result<T>.Failure(new ApplicationError(code, message, target));
}
