using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Storage;
using Microsoft.Data.Sqlite;

namespace GV5.Data.Repositories;

/// <summary>Stores append-only model snapshots and pins every referenced asset for the lifetime of the publication.</summary>
public sealed class SqliteModelRevisionRepository(IGv5Database database) : IModelRevisionRepository
{
    private const string AssetOwnerType = "fabricator.model-revision";
    private readonly IGv5Database _database = database ?? throw new ArgumentNullException(nameof(database));

    public async Task<Result<PublishedModelRevision>> PublishAsync(
        ModelDraft draft,
        ModelDraftContent content,
        long publishedUtcMs,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(draft);
        ArgumentNullException.ThrowIfNull(content);
        if (draft.Id != content.ModelId)
        {
            return Failure(ApplicationErrorCode.Validation, "The model draft and content must share the same ID.");
        }
        if (publishedUtcMs < 0)
        {
            return Failure(ApplicationErrorCode.Validation, "A publication timestamp must be non-negative.");
        }
        if (content.SourceAssetId is null || content.Parts.IsDefaultOrEmpty)
        {
            return Failure(ApplicationErrorCode.Validation, "A model must have an imported source image and at least one piece before it can be published.", draft.Id.ToString());
        }

        (string Json, string Sha256) encoded;
        try
        {
            encoded = ModelRevisionSnapshotCodec.Encode(draft, content);
        }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException)
        {
            return Failure(ApplicationErrorCode.Validation, "The model snapshot could not be validated.", draft.Id.ToString());
        }

        try
        {
            return await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                var current = await ReadCurrentDraftAsync(connection, transaction, draft.Id, token).ConfigureAwait(false);
                if (current is null)
                {
                    return NotFound("The model draft does not exist.", draft.Id.ToString());
                }
                if (current.Value.DraftRevision != draft.Revision
                    || !string.Equals(current.Value.Name, draft.Name, StringComparison.Ordinal)
                    || current.Value.ContentRevision != content.Revision)
                {
                    return Failure(ApplicationErrorCode.Conflict, "The model changed since this publication snapshot was loaded.", draft.Id.ToString());
                }

                var desiredAssets = CreateAssetSlots(content);
                if (!await AssetsAvailableAsync(connection, transaction, desiredAssets.Values, token).ConfigureAwait(false))
                {
                    return NotFound("Every asset referenced by a published model must be available.", draft.Id.ToString());
                }

                var latest = await ReadLatestAsync(connection, transaction, draft.Id, token).ConfigureAwait(false);
                if (latest is { } existing && string.Equals(existing.Sha256, encoded.Sha256, StringComparison.Ordinal))
                {
                    return ReadPublished(existing);
                }

                Revision nextRevision;
                try
                {
                    nextRevision = latest?.Revision.Next() ?? Revision.Initial;
                }
                catch (OverflowException)
                {
                    return Failure(ApplicationErrorCode.Validation, "The model publication revision cannot be incremented further.", draft.Id.ToString());
                }

                var revisionId = ModelRevisionId.New();
                var revision = PublishedModelRevision.Restore(
                    revisionId,
                    draft.Id,
                    nextRevision,
                    draft.Revision,
                    draft.Name,
                    publishedUtcMs,
                    encoded.Sha256,
                    content);
                await using (var insert = connection.CreateCommand())
                {
                    insert.Transaction = transaction;
                    insert.CommandText = "INSERT INTO model_revisions(revision_id, model_id, revision, draft_revision, display_name, published_utc_ms, snapshot_json, snapshot_sha256) VALUES ($revision_id, $model, $revision, $draft_revision, $name, $published, $snapshot, $hash);";
                    insert.Parameters.AddWithValue("$revision_id", revisionId.ToString());
                    insert.Parameters.AddWithValue("$model", draft.Id.ToString());
                    insert.Parameters.AddWithValue("$revision", nextRevision.Value);
                    insert.Parameters.AddWithValue("$draft_revision", draft.Revision.Value);
                    insert.Parameters.AddWithValue("$name", draft.Name);
                    insert.Parameters.AddWithValue("$published", publishedUtcMs);
                    insert.Parameters.AddWithValue("$snapshot", encoded.Json);
                    insert.Parameters.AddWithValue("$hash", encoded.Sha256);
                    await insert.ExecuteNonQueryAsync(token).ConfigureAwait(false);
                }

                foreach (var (slot, assetId) in desiredAssets)
                {
                    await AddAssetReferenceAsync(connection, transaction, revisionId, slot, assetId, publishedUtcMs, token).ConfigureAwait(false);
                }

                return Result<PublishedModelRevision>.Success(revision);
            }, cancellationToken).ConfigureAwait(false);
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        {
            return Failure(ApplicationErrorCode.Conflict, "The immutable model revision could not be committed because a database constraint was violated.", draft.Id.ToString());
        }
        catch (SqliteException)
        {
            return Failure(ApplicationErrorCode.Persistence, "The immutable model revision could not be saved.", draft.Id.ToString());
        }
        catch (InvalidDataException)
        {
            return Failure(ApplicationErrorCode.Persistence, "The immutable model revision could not be encoded.", draft.Id.ToString());
        }
    }

    public async Task<Result<PublishedModelRevision>> GetAsync(ModelId modelId, Revision revision, CancellationToken cancellationToken = default)
    {
        if (!modelId.IsValid || !revision.IsValid)
        {
            return Failure(ApplicationErrorCode.Validation, "A valid model ID and publication revision are required.");
        }

        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT revision_id, model_id, revision, draft_revision, display_name, published_utc_ms, snapshot_json, snapshot_sha256 FROM model_revisions WHERE model_id = $model AND revision = $revision;";
            command.Parameters.AddWithValue("$model", modelId.ToString());
            command.Parameters.AddWithValue("$revision", revision.Value);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                return NotFound("The published model revision does not exist.", modelId.ToString());
            }

            return ReadPublished(ReadRow(reader));
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or JsonException)
        {
            return Failure(ApplicationErrorCode.Persistence, "The published model revision could not be read or validated.", modelId.ToString());
        }
    }

    public async Task<Result<IReadOnlyList<PublishedModelRevision>>> ListAsync(ModelId modelId, CancellationToken cancellationToken = default)
    {
        if (!modelId.IsValid)
        {
            return Result<IReadOnlyList<PublishedModelRevision>>.Failure(new ApplicationError(ApplicationErrorCode.Validation, "A valid model ID is required."));
        }

        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT revision_id, model_id, revision, draft_revision, display_name, published_utc_ms, snapshot_json, snapshot_sha256 FROM model_revisions WHERE model_id = $model ORDER BY revision;";
            command.Parameters.AddWithValue("$model", modelId.ToString());
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            var revisions = new List<PublishedModelRevision>();
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                var revision = ReadPublished(ReadRow(reader));
                if (revision.IsFailure)
                {
                    return Result<IReadOnlyList<PublishedModelRevision>>.Failure(revision.Error!);
                }

                revisions.Add(revision.Value);
            }

            return Result<IReadOnlyList<PublishedModelRevision>>.Success(revisions.AsReadOnly());
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or JsonException)
        {
            return Result<IReadOnlyList<PublishedModelRevision>>.Failure(new ApplicationError(ApplicationErrorCode.Persistence, "Published model revisions could not be listed.", modelId.ToString()));
        }
    }

    private static async Task<(Revision DraftRevision, string Name, Revision ContentRevision)?> ReadCurrentDraftAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        ModelId modelId,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT m.revision, m.display_name, c.content_revision FROM models m LEFT JOIN model_draft_contents c ON c.model_id = m.model_id WHERE m.model_id = $model;";
        command.Parameters.AddWithValue("$model", modelId.ToString());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false) || reader.IsDBNull(2))
        {
            return null;
        }

        return (Revision.From(reader.GetInt64(0)), reader.GetString(1), Revision.From(reader.GetInt64(2)));
    }

    private static async Task<bool> AssetsAvailableAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        IEnumerable<AssetId> assets,
        CancellationToken cancellationToken)
    {
        foreach (var assetId in assets.Distinct())
        {
            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = "SELECT 1 FROM assets WHERE asset_id = $asset AND verification_state = 'available';";
            command.Parameters.AddWithValue("$asset", assetId.ToString());
            if (await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) is null)
            {
                return false;
            }
        }

        return true;
    }

    private static Dictionary<string, AssetId> CreateAssetSlots(ModelDraftContent content)
    {
        var slots = new Dictionary<string, AssetId>(StringComparer.Ordinal);
        if (content.SourceAssetId is { } source)
        {
            slots.Add("source", source);
        }

        foreach (var part in content.Parts)
        {
            slots.Add($"part-{part.Id}", part.AssetId);
        }

        return slots;
    }

    private static async Task AddAssetReferenceAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        ModelRevisionId revisionId,
        string slot,
        AssetId assetId,
        long createdUtcMs,
        CancellationToken cancellationToken)
    {
        await using (var insert = connection.CreateCommand())
        {
            insert.Transaction = transaction;
            insert.CommandText = "INSERT INTO asset_references(owner_type, owner_id, slot, asset_id, created_utc_ms) VALUES ($owner, $id, $slot, $asset, $created);";
            insert.Parameters.AddWithValue("$owner", AssetOwnerType);
            insert.Parameters.AddWithValue("$id", revisionId.ToString());
            insert.Parameters.AddWithValue("$slot", slot);
            insert.Parameters.AddWithValue("$asset", assetId.ToString());
            insert.Parameters.AddWithValue("$created", createdUtcMs);
            await insert.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        await using var cleanup = connection.CreateCommand();
        cleanup.Transaction = transaction;
        cleanup.CommandText = "DELETE FROM asset_gc_candidates WHERE asset_id = $asset;";
        cleanup.Parameters.AddWithValue("$asset", assetId.ToString());
        await cleanup.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task<RevisionRow?> ReadLatestAsync(
        SqliteConnection connection,
        SqliteTransaction transaction,
        ModelId modelId,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT revision_id, model_id, revision, draft_revision, display_name, published_utc_ms, snapshot_json, snapshot_sha256 FROM model_revisions WHERE model_id = $model ORDER BY revision DESC LIMIT 1;";
        command.Parameters.AddWithValue("$model", modelId.ToString());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        return await reader.ReadAsync(cancellationToken).ConfigureAwait(false) ? ReadRow(reader) : null;
    }

    private static RevisionRow ReadRow(SqliteDataReader reader) => new(
        ModelRevisionId.Parse(reader.GetString(0)),
        ModelId.Parse(reader.GetString(1)),
        Revision.From(reader.GetInt64(2)),
        Revision.From(reader.GetInt64(3)),
        reader.GetString(4),
        reader.GetInt64(5),
        reader.GetString(6),
        reader.GetString(7));

    private static Result<PublishedModelRevision> ReadPublished(RevisionRow row)
    {
        var actualHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(row.Json))).ToLowerInvariant();
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(actualHash), Encoding.ASCII.GetBytes(row.Sha256)))
        {
            return Failure(ApplicationErrorCode.Persistence, "The published model snapshot failed its integrity check.", row.ModelId.ToString());
        }

        var decoded = ModelRevisionSnapshotCodec.Decode(row.Json);
        if (decoded.Content.ModelId != row.ModelId
            || decoded.DraftRevision != row.DraftRevision
            || !string.Equals(decoded.Name, row.Name, StringComparison.Ordinal))
        {
            return Failure(ApplicationErrorCode.Persistence, "The published model snapshot metadata is inconsistent.", row.ModelId.ToString());
        }

        return Result<PublishedModelRevision>.Success(PublishedModelRevision.Restore(
            row.Id,
            row.ModelId,
            row.Revision,
            row.DraftRevision,
            row.Name,
            row.PublishedUtcMs,
            row.Sha256,
            decoded.Content));
    }

    private static Result<PublishedModelRevision> Failure(ApplicationErrorCode code, string message, string? context = null) =>
        Result<PublishedModelRevision>.Failure(new ApplicationError(code, message, context));

    private static Result<PublishedModelRevision> NotFound(string message, string? context = null) =>
        Failure(ApplicationErrorCode.NotFound, message, context);

    private sealed record RevisionRow(
        ModelRevisionId Id,
        ModelId ModelId,
        Revision Revision,
        Revision DraftRevision,
        string Name,
        long PublishedUtcMs,
        string Json,
        string Sha256);
}
