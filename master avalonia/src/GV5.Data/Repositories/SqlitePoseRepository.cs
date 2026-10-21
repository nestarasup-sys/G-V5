using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Storage;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace GV5.Data.Repositories;

/// <summary>Persists editable poses with optimistic concurrency and immutable, checksum-verified publications.</summary>
public sealed class SqlitePoseRepository(IGv5Database database) : IPoseRepository
{
    private readonly IGv5Database _database = database ?? throw new ArgumentNullException(nameof(database));

    public async Task<Result<PoseDraft>> CreateAsync(PoseDraft pose, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(pose);
        if (pose.Revision != Revision.Initial)
            return Failure<PoseDraft>(ApplicationErrorCode.Validation, "A new pose draft must start at revision 1.", pose.Id.ToString());

        (string Json, string Sha256) encoded;
        try { encoded = PoseSnapshotCodec.Encode(pose); }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException)
        { return Failure<PoseDraft>(ApplicationErrorCode.Validation, "The pose draft could not be validated.", pose.Id.ToString()); }

        var pinnedModel = await ReadPinnedModelRevisionAsync(pose.Model, cancellationToken).ConfigureAwait(false);
        if (pinnedModel.IsFailure) return Result<PoseDraft>.Failure(pinnedModel.Error!);
        try { _ = pose.ApplyToModelRevision(pinnedModel.Value); }
        catch (ArgumentException exception)
        { return Failure<PoseDraft>(ApplicationErrorCode.Validation, exception.Message, pose.Id.ToString()); }

        try
        {
            var created = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                if (!await IsModelRevisionAvailableAsync(connection, transaction, pose.Model, token).ConfigureAwait(false)) return false;
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = "INSERT INTO pose_drafts(pose_id, model_revision_id, model_revision_sequence, model_snapshot_sha256, model_id, revision, display_name, pose_json, pose_sha256, updated_utc_ms) VALUES ($id, $model_revision_id, $model_revision_sequence, $model_snapshot_sha256, $model_id, $revision, $name, $json, $hash, $updated);";
                AddDraftParameters(command, pose, encoded.Json, encoded.Sha256, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                await command.ExecuteNonQueryAsync(token).ConfigureAwait(false);
                return true;
            }, cancellationToken).ConfigureAwait(false);

            return created
                ? Result<PoseDraft>.Success(pose)
                : Failure<PoseDraft>(ApplicationErrorCode.NotFound, "The pinned model revision does not exist or its hash changed.", pose.Model.RevisionId.ToString());
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        { return Failure<PoseDraft>(ApplicationErrorCode.Conflict, "A pose with this ID already exists or violates a database constraint.", pose.Id.ToString()); }
        catch (SqliteException exception)
        { return Failure<PoseDraft>(ApplicationErrorCode.Persistence, "The pose draft could not be saved.", SqliteCode(exception)); }
    }

    public async Task<Result<PoseDraft>> GetAsync(PoseId poseId, CancellationToken cancellationToken = default)
    {
        if (!poseId.IsValid) return Failure<PoseDraft>(ApplicationErrorCode.Validation, "A valid pose ID is required.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT pose_id, model_revision_id, model_revision_sequence, model_snapshot_sha256, model_id, revision, display_name, pose_json, pose_sha256 FROM pose_drafts WHERE pose_id = $id;";
            command.Parameters.AddWithValue("$id", poseId.ToString());
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
                return Failure<PoseDraft>(ApplicationErrorCode.NotFound, "The pose draft does not exist.", poseId.ToString());
            return DecodeDraftRow(reader);
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or JsonException)
        { return Failure<PoseDraft>(ApplicationErrorCode.Persistence, "The pose draft could not be read or verified.", poseId.ToString()); }
    }

    public async Task<Result<IReadOnlyList<PoseDraft>>> ListAsync(ModelRevisionId modelRevisionId, CancellationToken cancellationToken = default)
    {
        if (!modelRevisionId.IsValid)
            return Failure<IReadOnlyList<PoseDraft>>(ApplicationErrorCode.Validation, "A valid model revision ID is required.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT pose_id, model_revision_id, model_revision_sequence, model_snapshot_sha256, model_id, revision, display_name, pose_json, pose_sha256 FROM pose_drafts WHERE model_revision_id = $revision ORDER BY display_name COLLATE NOCASE, pose_id;";
            command.Parameters.AddWithValue("$revision", modelRevisionId.ToString());
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            var poses = new List<PoseDraft>();
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                var pose = DecodeDraftRow(reader);
                if (pose.IsFailure) return Result<IReadOnlyList<PoseDraft>>.Failure(pose.Error!);
                poses.Add(pose.Value);
            }
            return Result<IReadOnlyList<PoseDraft>>.Success(poses.AsReadOnly());
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or JsonException)
        { return Failure<IReadOnlyList<PoseDraft>>(ApplicationErrorCode.Persistence, "Pose drafts could not be listed.", modelRevisionId.ToString()); }
    }

    public async Task<Result<PoseDraft>> SaveAsync(PoseDraft pose, Revision expectedRevision, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(pose);
        if (!pose.Id.IsValid || !expectedRevision.IsValid || pose.Revision.Value <= expectedRevision.Value)
            return Failure<PoseDraft>(ApplicationErrorCode.Validation, "Saving a pose requires a revision newer than the expected stored revision.", pose.Id.ToString());
        var pinnedModel = await ReadPinnedModelRevisionAsync(pose.Model, cancellationToken).ConfigureAwait(false);
        if (pinnedModel.IsFailure) return Result<PoseDraft>.Failure(pinnedModel.Error!);
        try { _ = pose.ApplyToModelRevision(pinnedModel.Value); }
        catch (ArgumentException exception)
        { return Failure<PoseDraft>(ApplicationErrorCode.Validation, exception.Message, pose.Id.ToString()); }
        (string Json, string Sha256) encoded;
        try { encoded = PoseSnapshotCodec.Encode(pose); }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException)
        { return Failure<PoseDraft>(ApplicationErrorCode.Validation, "The pose draft could not be validated.", pose.Id.ToString()); }

        try
        {
            var updated = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = "UPDATE pose_drafts SET revision = $revision, display_name = $name, pose_json = $json, pose_sha256 = $hash, updated_utc_ms = $updated WHERE pose_id = $id AND model_revision_id = $model_revision_id AND model_revision_sequence = $model_revision_sequence AND model_snapshot_sha256 = $model_snapshot_sha256 AND model_id = $model_id AND revision = $expected;";
                AddDraftParameters(command, pose, encoded.Json, encoded.Sha256, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
                command.Parameters.AddWithValue("$expected", expectedRevision.Value);
                return await command.ExecuteNonQueryAsync(token).ConfigureAwait(false) == 1;
            }, cancellationToken).ConfigureAwait(false);

            if (updated) return Result<PoseDraft>.Success(pose);
            var existing = await GetAsync(pose.Id, cancellationToken).ConfigureAwait(false);
            return existing.IsFailure
                ? Result<PoseDraft>.Failure(existing.Error!)
                : Failure<PoseDraft>(ApplicationErrorCode.Conflict, "The pose changed in another editor; its newer revision was preserved.", pose.Id.ToString());
        }
        catch (SqliteException exception)
        { return Failure<PoseDraft>(ApplicationErrorCode.Persistence, "The pose draft could not be updated.", SqliteCode(exception)); }
    }

    public async Task<Result<PublishedPoseRevision>> PublishAsync(PoseId poseId, Revision expectedDraftRevision, long publishedUtcMs, CancellationToken cancellationToken = default)
    {
        if (!poseId.IsValid || !expectedDraftRevision.IsValid || publishedUtcMs < 0)
            return Failure<PublishedPoseRevision>(ApplicationErrorCode.Validation, "A valid pose, draft revision, and publication time are required.");

        try
        {
            return await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                var stored = await ReadDraftRowAsync(connection, transaction, poseId, token).ConfigureAwait(false);
                if (stored is null) return Failure<PublishedPoseRevision>(ApplicationErrorCode.NotFound, "The pose draft does not exist.", poseId.ToString());
                var decoded = DecodeDraftRow(stored);
                if (decoded.IsFailure) return Result<PublishedPoseRevision>.Failure(decoded.Error!);
                var draft = decoded.Value;
                if (draft.Revision != expectedDraftRevision)
                    return Failure<PublishedPoseRevision>(ApplicationErrorCode.Conflict, "The pose changed after it was loaded; publish the current draft again.", poseId.ToString());
                if (!await IsModelRevisionAvailableAsync(connection, transaction, draft.Model, token).ConfigureAwait(false))
                    return Failure<PublishedPoseRevision>(ApplicationErrorCode.NotFound, "The exact model revision pinned by this pose is unavailable.", draft.Model.RevisionId.ToString());

                var latest = await ReadLatestPoseRevisionAsync(connection, transaction, poseId, token).ConfigureAwait(false);
                if (latest is { } previous && HasSamePublishedContent(draft, previous))
                    return Result<PublishedPoseRevision>.Success(previous);
                Revision sequence;
                try { sequence = latest?.Revision.Next() ?? Revision.Initial; }
                catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or OverflowException)
                { return Failure<PublishedPoseRevision>(ApplicationErrorCode.Validation, "The pose revision could not be prepared for publication.", poseId.ToString()); }

                var poseRevisionId = PoseRevisionId.New();
                var provisional = PublishedPoseRevision.Restore(
                    poseRevisionId, draft.Id, sequence, draft.Revision, draft.Model, draft.Name,
                    publishedUtcMs, new string('0', 64), draft.PartTransforms, draft.RigJoints, draft.LayerOrder, draft.Category);
                var encoded = PoseSnapshotCodec.Encode(provisional);
                var publication = PublishedPoseRevision.Restore(
                    poseRevisionId, draft.Id, sequence, draft.Revision, draft.Model, draft.Name,
                    publishedUtcMs, encoded.Sha256, draft.PartTransforms, draft.RigJoints, draft.LayerOrder, draft.Category);
                var stable = PoseSnapshotCodec.Encode(publication);
                if (!string.Equals(stable.Sha256, encoded.Sha256, StringComparison.Ordinal))
                    return Failure<PublishedPoseRevision>(ApplicationErrorCode.Persistence, "The pose publication checksum is inconsistent.", poseId.ToString());
                await using var insert = connection.CreateCommand();
                insert.Transaction = transaction;
                insert.CommandText = "INSERT INTO pose_revisions(pose_revision_id, pose_id, model_revision_id, model_id, revision, draft_revision, display_name, published_utc_ms, snapshot_json, snapshot_sha256) VALUES ($id, $pose, $model_revision, $model, $revision, $draft_revision, $name, $published, $json, $hash);";
                insert.Parameters.AddWithValue("$id", publication.Id.ToString());
                insert.Parameters.AddWithValue("$pose", publication.PoseId.ToString());
                insert.Parameters.AddWithValue("$model_revision", publication.Model.RevisionId.ToString());
                insert.Parameters.AddWithValue("$model", publication.Model.ModelId.ToString());
                insert.Parameters.AddWithValue("$revision", publication.Revision.Value);
                insert.Parameters.AddWithValue("$draft_revision", publication.DraftRevision.Value);
                insert.Parameters.AddWithValue("$name", publication.Name);
                insert.Parameters.AddWithValue("$published", publication.PublishedUtcMs);
                insert.Parameters.AddWithValue("$json", stable.Json);
                insert.Parameters.AddWithValue("$hash", stable.Sha256);
                await insert.ExecuteNonQueryAsync(token).ConfigureAwait(false);
                return Result<PublishedPoseRevision>.Success(publication);
            }, cancellationToken).ConfigureAwait(false);
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        { return Failure<PublishedPoseRevision>(ApplicationErrorCode.Conflict, "The immutable pose revision conflicts with existing data.", poseId.ToString()); }
        catch (SqliteException exception)
        { return Failure<PublishedPoseRevision>(ApplicationErrorCode.Persistence, "The pose could not be published.", SqliteCode(exception)); }
        catch (Exception exception) when (exception is InvalidDataException or JsonException or ArgumentException)
        { return Failure<PublishedPoseRevision>(ApplicationErrorCode.Persistence, "The pose snapshot could not be verified.", poseId.ToString()); }
    }

    public async Task<Result<PublishedPoseRevision>> GetPublishedAsync(PoseId poseId, Revision revision, CancellationToken cancellationToken = default)
    {
        if (!poseId.IsValid || !revision.IsValid)
            return Failure<PublishedPoseRevision>(ApplicationErrorCode.Validation, "A valid pose ID and publication revision are required.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT snapshot_json, snapshot_sha256 FROM pose_revisions WHERE pose_id = $pose AND revision = $revision;";
            command.Parameters.AddWithValue("$pose", poseId.ToString());
            command.Parameters.AddWithValue("$revision", revision.Value);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
                return Failure<PublishedPoseRevision>(ApplicationErrorCode.NotFound, "The published pose revision does not exist.", poseId.ToString());
            return Result<PublishedPoseRevision>.Success(PoseSnapshotCodec.DecodePublished(reader.GetString(0), reader.GetString(1)));
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or JsonException)
        { return Failure<PublishedPoseRevision>(ApplicationErrorCode.Persistence, "The published pose revision could not be verified.", poseId.ToString()); }
    }

    public async Task<Result<IReadOnlyList<PublishedPoseRevision>>> ListPublishedAsync(PoseId poseId, CancellationToken cancellationToken = default)
    {
        if (!poseId.IsValid) return Failure<IReadOnlyList<PublishedPoseRevision>>(ApplicationErrorCode.Validation, "A valid pose ID is required.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT snapshot_json, snapshot_sha256 FROM pose_revisions WHERE pose_id = $pose ORDER BY revision;";
            command.Parameters.AddWithValue("$pose", poseId.ToString());
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            var revisions = new List<PublishedPoseRevision>();
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
                revisions.Add(PoseSnapshotCodec.DecodePublished(reader.GetString(0), reader.GetString(1)));
            return Result<IReadOnlyList<PublishedPoseRevision>>.Success(revisions.AsReadOnly());
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or JsonException)
        { return Failure<IReadOnlyList<PublishedPoseRevision>>(ApplicationErrorCode.Persistence, "Published pose revisions could not be listed.", poseId.ToString()); }
    }

    private static async Task<bool> IsModelRevisionAvailableAsync(SqliteConnection connection, SqliteTransaction transaction, ModelRevisionReference model, CancellationToken token)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT 1 FROM model_revisions WHERE revision_id = $revision AND model_id = $model AND revision = $sequence AND snapshot_sha256 = $hash;";
        command.Parameters.AddWithValue("$revision", model.RevisionId.ToString());
        command.Parameters.AddWithValue("$model", model.ModelId.ToString());
        command.Parameters.AddWithValue("$sequence", model.Sequence.Value);
        command.Parameters.AddWithValue("$hash", model.SnapshotSha256);
        return await command.ExecuteScalarAsync(token).ConfigureAwait(false) is not null;
    }

    private static async Task<PoseDraftRow?> ReadDraftRowAsync(SqliteConnection connection, SqliteTransaction transaction, PoseId poseId, CancellationToken token)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT pose_id, model_revision_id, model_revision_sequence, model_snapshot_sha256, model_id, revision, display_name, pose_json, pose_sha256 FROM pose_drafts WHERE pose_id = $id;";
        command.Parameters.AddWithValue("$id", poseId.ToString());
        await using var reader = await command.ExecuteReaderAsync(token).ConfigureAwait(false);
        return await reader.ReadAsync(token).ConfigureAwait(false) ? ReadPoseDraftRow(reader) : null;
    }

    private static async Task<PublishedPoseRevision?> ReadLatestPoseRevisionAsync(SqliteConnection connection, SqliteTransaction transaction, PoseId poseId, CancellationToken token)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT snapshot_json, snapshot_sha256 FROM pose_revisions WHERE pose_id = $pose ORDER BY revision DESC LIMIT 1;";
        command.Parameters.AddWithValue("$pose", poseId.ToString());
        await using var reader = await command.ExecuteReaderAsync(token).ConfigureAwait(false);
        return await reader.ReadAsync(token).ConfigureAwait(false)
            ? PoseSnapshotCodec.DecodePublished(reader.GetString(0), reader.GetString(1))
            : null;
    }

    private static Result<PoseDraft> DecodeDraftRow(SqliteDataReader reader) => DecodeDraftRow(ReadPoseDraftRow(reader));

    private static bool HasSamePublishedContent(PoseDraft draft, PublishedPoseRevision revision) =>
        draft.Id == revision.PoseId
        && draft.Model == revision.Model
        && string.Equals(draft.Name, revision.Name, StringComparison.Ordinal)
        && string.Equals(draft.Category, revision.Category, StringComparison.Ordinal)
        && draft.PartTransforms.SequenceEqual(revision.PartTransforms)
        && draft.RigJoints.SequenceEqual(revision.RigJoints)
        && draft.LayerOrder.SequenceEqual(revision.LayerOrder);

    private static Result<PoseDraft> DecodeDraftRow(PoseDraftRow row)
    {
        var pose = PoseSnapshotCodec.DecodeDraft(row.Json, row.Sha256);
        if (pose.Id != row.PoseId || pose.Model.RevisionId != row.ModelRevisionId || pose.Model.ModelId != row.ModelId
            || pose.Model.Sequence.Value != row.ModelRevisionSequence
            || !string.Equals(pose.Model.SnapshotSha256, row.ModelSnapshotSha256, StringComparison.Ordinal)
            || pose.Revision.Value != row.Revision || !string.Equals(pose.Name, row.Name, StringComparison.Ordinal))
            throw new InvalidDataException("The pose draft row does not match its checksummed snapshot.");
        return Result<PoseDraft>.Success(pose);
    }

    private static PoseDraftRow ReadPoseDraftRow(SqliteDataReader reader) => new(
        PoseId.Parse(reader.GetString(0)),
        ModelRevisionId.Parse(reader.GetString(1)),
        reader.GetInt64(2),
        reader.GetString(3),
        ModelId.Parse(reader.GetString(4)),
        reader.GetInt64(5),
        reader.GetString(6),
        reader.GetString(7),
        reader.GetString(8));

    private static void AddDraftParameters(SqliteCommand command, PoseDraft pose, string json, string sha256, long nowUtcMs)
    {
        command.Parameters.AddWithValue("$id", pose.Id.ToString());
        command.Parameters.AddWithValue("$model_revision_id", pose.Model.RevisionId.ToString());
        command.Parameters.AddWithValue("$model_revision_sequence", pose.Model.Sequence.Value);
        command.Parameters.AddWithValue("$model_snapshot_sha256", pose.Model.SnapshotSha256);
        command.Parameters.AddWithValue("$model_id", pose.Model.ModelId.ToString());
        command.Parameters.AddWithValue("$revision", pose.Revision.Value);
        command.Parameters.AddWithValue("$name", pose.Name);
        command.Parameters.AddWithValue("$json", json);
        command.Parameters.AddWithValue("$hash", sha256);
        command.Parameters.AddWithValue("$updated", nowUtcMs);
    }

    private static string SqliteCode(SqliteException exception) => exception.SqliteErrorCode.ToString(System.Globalization.CultureInfo.InvariantCulture);
    private static Result<T> Failure<T>(ApplicationErrorCode code, string message, string? target = null) =>
        Result<T>.Failure(new ApplicationError(code, message, target));

    private async Task<Result<PublishedModelRevision>> ReadPinnedModelRevisionAsync(ModelRevisionReference reference, CancellationToken cancellationToken)
    {
        var model = await new SqliteModelRevisionRepository(_database)
            .GetAsync(reference.ModelId, reference.Sequence, cancellationToken).ConfigureAwait(false);
        if (model.IsFailure) return model;
        if (model.Value.Id != reference.RevisionId
            || !string.Equals(model.Value.SnapshotSha256, reference.SnapshotSha256, StringComparison.Ordinal))
            return Failure<PublishedModelRevision>(ApplicationErrorCode.NotFound, "The exact model revision pinned by this pose is unavailable.", reference.RevisionId.ToString());
        return model;
    }

    private sealed record PoseDraftRow(
        PoseId PoseId,
        ModelRevisionId ModelRevisionId,
        long ModelRevisionSequence,
        string ModelSnapshotSha256,
        ModelId ModelId,
        long Revision,
        string Name,
        string Json,
        string Sha256);
}
