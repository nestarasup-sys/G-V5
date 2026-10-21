using System.Text.Json;
using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Storage;
using GV5.Geometry;
using Microsoft.Data.Sqlite;

namespace GV5.Data.Repositories;

/// <summary>Stores wardrobe drafts optimistically and publishes checksummed immutable snapshots.</summary>
public sealed class SqliteWardrobeRepository(IGv5Database database) : IWardrobeRepository
{
    private const string DraftAssetOwner = "fabricator.wardrobe-draft";
    private const string RevisionAssetOwner = "fabricator.wardrobe-revision";
    private readonly IGv5Database _database = database ?? throw new ArgumentNullException(nameof(database));

    public async Task<Result<WardrobeSet>> CreateAsync(WardrobeSet draft, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(draft);
        if (draft.Revision != Revision.Initial)
            return Failure<WardrobeSet>(ApplicationErrorCode.Validation, "A new wardrobe draft must start at revision 1.", draft.Id.ToString());
        var model = await ReadPinnedModelAsync(draft.Model, cancellationToken).ConfigureAwait(false);
        if (model.IsFailure) return Result<WardrobeSet>.Failure(model.Error!);
        if (!AreComponentsValidForModel(draft, model.Value))
            return Failure<WardrobeSet>(ApplicationErrorCode.Validation, "A wardrobe component does not match the pinned model geometry.", draft.Id.ToString());
        if (!await AreAssetsAvailableAsync(draft.Components, cancellationToken).ConfigureAwait(false))
            return Failure<WardrobeSet>(ApplicationErrorCode.NotFound, "A wardrobe asset is unavailable.", draft.Id.ToString());
        (string Json, string Sha256) encoded;
        try { encoded = WardrobeSnapshotCodec.Encode(draft); }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException)
        { return Failure<WardrobeSet>(ApplicationErrorCode.Validation, "The wardrobe draft could not be encoded.", draft.Id.ToString()); }

        try
        {
            var created = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                if (!await IsModelAvailableAsync(connection, transaction, draft.Model, token).ConfigureAwait(false)
                    || !await AreAssetsAvailableAsync(connection, transaction, draft.Components, token).ConfigureAwait(false)) return false;
                await using var insert = connection.CreateCommand();
                insert.Transaction = transaction;
                insert.CommandText = "INSERT INTO wardrobe_drafts(wardrobe_id, model_revision_id, model_revision_sequence, model_snapshot_sha256, model_id, revision, display_name, wardrobe_json, wardrobe_sha256, updated_utc_ms) VALUES ($id, $model_revision, $sequence, $model_hash, $model, $revision, $name, $json, $hash, $updated);";
                AddDraftParameters(insert, draft, encoded.Json, encoded.Sha256);
                await insert.ExecuteNonQueryAsync(token).ConfigureAwait(false);
                await ReplaceAssetReferencesAsync(connection, transaction, DraftAssetOwner, draft.Id.Value, [], draft.Components, token).ConfigureAwait(false);
                return true;
            }, cancellationToken).ConfigureAwait(false);
            return created ? Result<WardrobeSet>.Success(draft)
                : Failure<WardrobeSet>(ApplicationErrorCode.NotFound, "The exact model revision or one of the referenced assets is unavailable.", draft.Id.ToString());
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        { return Failure<WardrobeSet>(ApplicationErrorCode.Conflict, "A wardrobe draft with this ID already exists or violates a constraint.", draft.Id.ToString()); }
        catch (SqliteException)
        { return Failure<WardrobeSet>(ApplicationErrorCode.Persistence, "The wardrobe draft could not be created.", draft.Id.ToString()); }
    }

    public async Task<Result<WardrobeSet>> GetAsync(WardrobeId wardrobeId, CancellationToken cancellationToken = default)
    {
        if (!wardrobeId.IsValid) return Failure<WardrobeSet>(ApplicationErrorCode.Validation, "A valid wardrobe ID is required.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT wardrobe_id, model_revision_id, model_revision_sequence, model_snapshot_sha256, model_id, revision, display_name, wardrobe_json, wardrobe_sha256 FROM wardrobe_drafts WHERE wardrobe_id = $id;";
            command.Parameters.AddWithValue("$id", wardrobeId.ToString());
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
                return Failure<WardrobeSet>(ApplicationErrorCode.NotFound, "The wardrobe draft does not exist.", wardrobeId.ToString());
            return DecodeDraft(ReadDraftRow(reader));
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or JsonException)
        { return Failure<WardrobeSet>(ApplicationErrorCode.Persistence, "The wardrobe draft could not be read or verified.", wardrobeId.ToString()); }
    }

    public async Task<Result<IReadOnlyList<WardrobeSet>>> ListAsync(ModelRevisionId modelRevisionId, CancellationToken cancellationToken = default)
    {
        if (!modelRevisionId.IsValid) return Failure<IReadOnlyList<WardrobeSet>>(ApplicationErrorCode.Validation, "A valid model revision ID is required.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT wardrobe_id, model_revision_id, model_revision_sequence, model_snapshot_sha256, model_id, revision, display_name, wardrobe_json, wardrobe_sha256 FROM wardrobe_drafts WHERE model_revision_id = $model_revision ORDER BY display_name COLLATE NOCASE, wardrobe_id;";
            command.Parameters.AddWithValue("$model_revision", modelRevisionId.ToString());
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            var drafts = new List<WardrobeSet>();
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                var draft = DecodeDraft(ReadDraftRow(reader));
                if (draft.IsFailure) return Result<IReadOnlyList<WardrobeSet>>.Failure(draft.Error!);
                drafts.Add(draft.Value);
            }
            return Result<IReadOnlyList<WardrobeSet>>.Success(drafts.AsReadOnly());
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or JsonException)
        { return Failure<IReadOnlyList<WardrobeSet>>(ApplicationErrorCode.Persistence, "Wardrobe drafts could not be listed.", modelRevisionId.ToString()); }
    }

    public async Task<Result<WardrobeSet>> SaveAsync(WardrobeSet draft, Revision expectedRevision, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(draft);
        if (!draft.Id.IsValid || !expectedRevision.IsValid || draft.Revision.Value <= expectedRevision.Value)
            return Failure<WardrobeSet>(ApplicationErrorCode.Validation, "Saving a wardrobe requires a revision newer than the expected stored revision.", draft.Id.ToString());
        var existing = await GetAsync(draft.Id, cancellationToken).ConfigureAwait(false);
        if (existing.IsFailure) return existing;
        if (existing.Value.Model != draft.Model)
            return Failure<WardrobeSet>(ApplicationErrorCode.Validation, "A wardrobe draft cannot change its pinned model revision.", draft.Id.ToString());
        var model = await ReadPinnedModelAsync(draft.Model, cancellationToken).ConfigureAwait(false);
        if (model.IsFailure) return Result<WardrobeSet>.Failure(model.Error!);
        if (!AreComponentsValidForModel(draft, model.Value))
            return Failure<WardrobeSet>(ApplicationErrorCode.Validation, "A wardrobe component does not match the pinned model geometry.", draft.Id.ToString());
        if (!await AreAssetsAvailableAsync(draft.Components, cancellationToken).ConfigureAwait(false))
            return Failure<WardrobeSet>(ApplicationErrorCode.NotFound, "A wardrobe asset is unavailable.", draft.Id.ToString());
        (string Json, string Sha256) encoded;
        try { encoded = WardrobeSnapshotCodec.Encode(draft); }
        catch (Exception exception) when (exception is ArgumentException or InvalidOperationException)
        { return Failure<WardrobeSet>(ApplicationErrorCode.Validation, "The wardrobe draft could not be encoded.", draft.Id.ToString()); }

        try
        {
            var updated = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                if (!await IsModelAvailableAsync(connection, transaction, draft.Model, token).ConfigureAwait(false)
                    || !await AreAssetsAvailableAsync(connection, transaction, draft.Components, token).ConfigureAwait(false)) return false;
                await using var update = connection.CreateCommand();
                update.Transaction = transaction;
                update.CommandText = "UPDATE wardrobe_drafts SET revision = $revision, display_name = $name, wardrobe_json = $json, wardrobe_sha256 = $hash, updated_utc_ms = $updated WHERE wardrobe_id = $id AND model_revision_id = $model_revision AND model_revision_sequence = $sequence AND model_snapshot_sha256 = $model_hash AND model_id = $model AND revision = $expected;";
                AddDraftParameters(update, draft, encoded.Json, encoded.Sha256);
                update.Parameters.AddWithValue("$expected", expectedRevision.Value);
                if (await update.ExecuteNonQueryAsync(token).ConfigureAwait(false) != 1) return false;
                await ReplaceAssetReferencesAsync(connection, transaction, DraftAssetOwner, draft.Id.Value, existing.Value.Components, draft.Components, token).ConfigureAwait(false);
                return true;
            }, cancellationToken).ConfigureAwait(false);
            if (updated) return Result<WardrobeSet>.Success(draft);
            var current = await GetAsync(draft.Id, cancellationToken).ConfigureAwait(false);
            return current.IsFailure ? Result<WardrobeSet>.Failure(current.Error!)
                : Failure<WardrobeSet>(ApplicationErrorCode.Conflict, "The wardrobe changed in another editor; its newer revision was preserved.", draft.Id.ToString());
        }
        catch (SqliteException)
        { return Failure<WardrobeSet>(ApplicationErrorCode.Persistence, "The wardrobe draft could not be saved.", draft.Id.ToString()); }
    }

    public async Task<Result<PublishedWardrobeRevision>> PublishAsync(WardrobeId wardrobeId, Revision expectedDraftRevision,
        long publishedUtcMs, CancellationToken cancellationToken = default)
    {
        if (!wardrobeId.IsValid || !expectedDraftRevision.IsValid || publishedUtcMs < 0)
            return Failure<PublishedWardrobeRevision>(ApplicationErrorCode.Validation, "A valid wardrobe, draft revision and publication time are required.");
        var loaded = await GetAsync(wardrobeId, cancellationToken).ConfigureAwait(false);
        if (loaded.IsFailure) return Result<PublishedWardrobeRevision>.Failure(loaded.Error!);
        var draft = loaded.Value;
        if (draft.Revision != expectedDraftRevision)
            return Failure<PublishedWardrobeRevision>(ApplicationErrorCode.Conflict, "The wardrobe changed after it was loaded; publish the current draft again.", wardrobeId.ToString());
        if (draft.Components.IsDefaultOrEmpty)
            return Failure<PublishedWardrobeRevision>(ApplicationErrorCode.Validation, "An empty wardrobe cannot be published.", wardrobeId.ToString());
        var model = await ReadPinnedModelAsync(draft.Model, cancellationToken).ConfigureAwait(false);
        if (model.IsFailure) return Result<PublishedWardrobeRevision>.Failure(model.Error!);
        if (!AreComponentsValidForModel(draft, model.Value))
            return Failure<PublishedWardrobeRevision>(ApplicationErrorCode.Validation, "A wardrobe component does not match the pinned model geometry.", wardrobeId.ToString());

        try
        {
            return await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                var storedRow = await ReadDraftRowAsync(connection, transaction, wardrobeId, token).ConfigureAwait(false);
                if (storedRow is null) return Failure<PublishedWardrobeRevision>(ApplicationErrorCode.NotFound, "The wardrobe draft does not exist.", wardrobeId.ToString());
                var stored = DecodeDraft(storedRow);
                if (stored.IsFailure) return Result<PublishedWardrobeRevision>.Failure(stored.Error!);
                if (stored.Value.Revision != expectedDraftRevision)
                    return Failure<PublishedWardrobeRevision>(ApplicationErrorCode.Conflict, "The wardrobe changed before publication.", wardrobeId.ToString());
                if (!await IsModelAvailableAsync(connection, transaction, draft.Model, token).ConfigureAwait(false)
                    || !await AreAssetsAvailableAsync(connection, transaction, draft.Components, token).ConfigureAwait(false))
                    return Failure<PublishedWardrobeRevision>(ApplicationErrorCode.NotFound, "The pinned model or a wardrobe asset is unavailable.", wardrobeId.ToString());
                var latest = await ReadLatestPublishedAsync(connection, transaction, wardrobeId, token).ConfigureAwait(false);
                if (latest is not null && HasSameContent(draft, latest))
                    return Result<PublishedWardrobeRevision>.Success(latest);
                Revision sequence;
                try { sequence = latest?.Revision.Next() ?? Revision.Initial; }
                catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or OverflowException)
                { return Failure<PublishedWardrobeRevision>(ApplicationErrorCode.Validation, "The wardrobe publication revision could not be prepared.", wardrobeId.ToString()); }

                var provisional = PublishedWardrobeRevision.Snapshot(draft, sequence, publishedUtcMs, new string('0', 64));
                var encoded = WardrobeSnapshotCodec.Encode(provisional);
                var publication = PublishedWardrobeRevision.Restore(provisional.Id, provisional.WardrobeId,
                    provisional.Revision, provisional.DraftRevision, provisional.Model, provisional.Name,
                    provisional.PublishedUtcMs, encoded.Sha256, provisional.Components);
                var stable = WardrobeSnapshotCodec.Encode(publication);
                if (!string.Equals(stable.Sha256, encoded.Sha256, StringComparison.Ordinal))
                    return Failure<PublishedWardrobeRevision>(ApplicationErrorCode.Persistence, "The wardrobe publication checksum is inconsistent.", wardrobeId.ToString());
                await using var insert = connection.CreateCommand();
                insert.Transaction = transaction;
                insert.CommandText = "INSERT INTO wardrobe_revisions(wardrobe_revision_id, wardrobe_id, model_revision_id, model_id, revision, draft_revision, display_name, published_utc_ms, snapshot_json, snapshot_sha256) VALUES ($id, $wardrobe, $model_revision, $model, $revision, $draft_revision, $name, $published, $json, $hash);";
                AddPublicationParameters(insert, publication, stable.Json, stable.Sha256);
                await insert.ExecuteNonQueryAsync(token).ConfigureAwait(false);
                await ReplaceAssetReferencesAsync(connection, transaction, RevisionAssetOwner, publication.Id.Value, [], publication.Components, token).ConfigureAwait(false);
                return Result<PublishedWardrobeRevision>.Success(publication);
            }, cancellationToken).ConfigureAwait(false);
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        { return Failure<PublishedWardrobeRevision>(ApplicationErrorCode.Conflict, "The immutable wardrobe revision conflicts with existing data.", wardrobeId.ToString()); }
        catch (SqliteException)
        { return Failure<PublishedWardrobeRevision>(ApplicationErrorCode.Persistence, "The wardrobe could not be published.", wardrobeId.ToString()); }
        catch (Exception exception) when (exception is InvalidDataException or JsonException or ArgumentException)
        { return Failure<PublishedWardrobeRevision>(ApplicationErrorCode.Persistence, "The wardrobe snapshot could not be verified.", wardrobeId.ToString()); }
    }

    public async Task<Result<PublishedWardrobeRevision>> GetPublishedAsync(WardrobeId wardrobeId, Revision revision, CancellationToken cancellationToken = default)
    {
        if (!wardrobeId.IsValid || !revision.IsValid)
            return Failure<PublishedWardrobeRevision>(ApplicationErrorCode.Validation, "A valid wardrobe ID and publication revision are required.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT wardrobe_revision_id, wardrobe_id, model_revision_id, model_id, revision, draft_revision, display_name, published_utc_ms, snapshot_json, snapshot_sha256 FROM wardrobe_revisions WHERE wardrobe_id = $wardrobe AND revision = $revision;";
            command.Parameters.AddWithValue("$wardrobe", wardrobeId.ToString());
            command.Parameters.AddWithValue("$revision", revision.Value);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
                return Failure<PublishedWardrobeRevision>(ApplicationErrorCode.NotFound, "The published wardrobe revision does not exist.", wardrobeId.ToString());
            return DecodePublished(ReadPublishedRow(reader));
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or JsonException)
        { return Failure<PublishedWardrobeRevision>(ApplicationErrorCode.Persistence, "The published wardrobe snapshot could not be verified.", wardrobeId.ToString()); }
    }

    public Task<Result<IReadOnlyList<PublishedWardrobeRevision>>> ListPublishedAsync(WardrobeId wardrobeId, CancellationToken cancellationToken = default) =>
        ListPublishedWhereAsync("wardrobe_id", wardrobeId.ToString(), wardrobeId.IsValid, "A valid wardrobe ID is required.", cancellationToken);

    public Task<Result<IReadOnlyList<PublishedWardrobeRevision>>> ListPublishedForModelAsync(ModelRevisionId modelRevisionId, CancellationToken cancellationToken = default) =>
        ListPublishedWhereAsync("model_revision_id", modelRevisionId.ToString(), modelRevisionId.IsValid, "A valid model revision ID is required.", cancellationToken);

    private async Task<Result<IReadOnlyList<PublishedWardrobeRevision>>> ListPublishedWhereAsync(string column, string value,
        bool valid, string invalidMessage, CancellationToken cancellationToken)
    {
        if (!valid) return Failure<IReadOnlyList<PublishedWardrobeRevision>>(ApplicationErrorCode.Validation, invalidMessage);
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = $"SELECT wardrobe_revision_id, wardrobe_id, model_revision_id, model_id, revision, draft_revision, display_name, published_utc_ms, snapshot_json, snapshot_sha256 FROM wardrobe_revisions WHERE {column} = $value ORDER BY revision;";
            command.Parameters.AddWithValue("$value", value);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            var revisions = new List<PublishedWardrobeRevision>();
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                var decoded = DecodePublished(ReadPublishedRow(reader));
                if (decoded.IsFailure) return Result<IReadOnlyList<PublishedWardrobeRevision>>.Failure(decoded.Error!);
                revisions.Add(decoded.Value);
            }
            return Result<IReadOnlyList<PublishedWardrobeRevision>>.Success(revisions.AsReadOnly());
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or JsonException)
        { return Failure<IReadOnlyList<PublishedWardrobeRevision>>(ApplicationErrorCode.Persistence, "Published wardrobe revisions could not be listed.", value); }
    }

    private async Task<Result<PublishedModelRevision>> ReadPinnedModelAsync(ModelRevisionReference reference, CancellationToken cancellationToken)
    {
        var model = await new SqliteModelRevisionRepository(_database).GetAsync(reference.ModelId, reference.Sequence, cancellationToken).ConfigureAwait(false);
        if (model.IsFailure) return model;
        if (model.Value.Id != reference.RevisionId || model.Value.SnapshotSha256 != reference.SnapshotSha256)
            return Failure<PublishedModelRevision>(ApplicationErrorCode.NotFound, "The exact model revision pinned by this wardrobe is unavailable.", reference.RevisionId.ToString());
        return model;
    }

    private static bool AreComponentsValidForModel(WardrobeSet wardrobe, PublishedModelRevision model)
    {
        if (wardrobe.Model != ModelRevisionReference.From(model)) return false;
        var parts = model.Content.Parts.ToDictionary(part => part.Id);
        foreach (var component in wardrobe.Components)
        {
            if (!parts.TryGetValue(component.BoneId, out var part)) return false;
            var frame = WardrobeBoneFrame.FromTransform(part.Id.ToString(), part.SourceTransform.Crop, part.SourceTransform.Transform);
            var binding = component.Binding;
            if (binding.BoneId != part.Id.ToString()
                || !NearlyEqual(binding.BoneWidth, frame.Bounds.Width)
                || !NearlyEqual(binding.BoneHeight, frame.Bounds.Height)
                || !NearlyEqual(binding.BoneRotationDegrees, frame.RotationDegrees)) return false;
        }
        return true;
    }

    private static bool NearlyEqual(double left, double right) => Math.Abs(left - right) <= 1e-8 * Math.Max(1, Math.Abs(right));

    private static async Task<bool> IsModelAvailableAsync(SqliteConnection connection, SqliteTransaction transaction,
        ModelRevisionReference model, CancellationToken token)
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

    private static async Task<bool> AreAssetsAvailableAsync(SqliteConnection connection, SqliteTransaction transaction,
        IEnumerable<WardrobeComponent> components, CancellationToken token)
    {
        foreach (var assetId in components.Select(component => component.AssetId).Distinct())
        {
            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = "SELECT 1 FROM assets WHERE asset_id = $asset AND verification_state = 'available';";
            command.Parameters.AddWithValue("$asset", assetId.ToString());
            if (await command.ExecuteScalarAsync(token).ConfigureAwait(false) is null) return false;
        }
        return true;
    }

    private async Task<bool> AreAssetsAvailableAsync(IEnumerable<WardrobeComponent> components, CancellationToken token)
    {
        await using var connection = await _database.OpenReadConnectionAsync(token).ConfigureAwait(false);
        foreach (var assetId in components.Select(component => component.AssetId).Distinct())
        {
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT 1 FROM assets WHERE asset_id = $asset AND verification_state = 'available';";
            command.Parameters.AddWithValue("$asset", assetId.ToString());
            if (await command.ExecuteScalarAsync(token).ConfigureAwait(false) is null) return false;
        }
        return true;
    }

    private static async Task ReplaceAssetReferencesAsync(SqliteConnection connection, SqliteTransaction transaction,
        string ownerType, Guid ownerId, IEnumerable<WardrobeComponent> previous, IEnumerable<WardrobeComponent> current, CancellationToken token)
    {
        var previousAssets = previous.Select(component => component.AssetId).Distinct().ToArray();
        await using (var delete = connection.CreateCommand())
        {
            delete.Transaction = transaction;
            delete.CommandText = "DELETE FROM asset_references WHERE owner_type = $owner AND owner_id = $id;";
            delete.Parameters.AddWithValue("$owner", ownerType);
            delete.Parameters.AddWithValue("$id", ownerId.ToString("D"));
            await delete.ExecuteNonQueryAsync(token).ConfigureAwait(false);
        }
        foreach (var component in current)
        {
            await using var insert = connection.CreateCommand();
            insert.Transaction = transaction;
            insert.CommandText = "INSERT INTO asset_references(owner_type, owner_id, slot, asset_id, created_utc_ms) VALUES ($owner, $id, $slot, $asset, $created);";
            insert.Parameters.AddWithValue("$owner", ownerType);
            insert.Parameters.AddWithValue("$id", ownerId.ToString("D"));
            insert.Parameters.AddWithValue("$slot", $"component-{component.Id}");
            insert.Parameters.AddWithValue("$asset", component.AssetId.ToString());
            insert.Parameters.AddWithValue("$created", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            await insert.ExecuteNonQueryAsync(token).ConfigureAwait(false);
            await using var removeCandidate = connection.CreateCommand();
            removeCandidate.Transaction = transaction;
            removeCandidate.CommandText = "DELETE FROM asset_gc_candidates WHERE asset_id = $asset;";
            removeCandidate.Parameters.AddWithValue("$asset", component.AssetId.ToString());
            await removeCandidate.ExecuteNonQueryAsync(token).ConfigureAwait(false);
        }
        foreach (var assetId in previousAssets)
        {
            await using var hasReference = connection.CreateCommand();
            hasReference.Transaction = transaction;
            hasReference.CommandText = "SELECT 1 FROM asset_references WHERE asset_id = $asset LIMIT 1;";
            hasReference.Parameters.AddWithValue("$asset", assetId.ToString());
            if (await hasReference.ExecuteScalarAsync(token).ConfigureAwait(false) is not null) continue;
            await using var candidate = connection.CreateCommand();
            candidate.Transaction = transaction;
            candidate.CommandText = "INSERT OR IGNORE INTO asset_gc_candidates(asset_id, unreferenced_since_utc_ms) VALUES ($asset, $now);";
            candidate.Parameters.AddWithValue("$asset", assetId.ToString());
            candidate.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            await candidate.ExecuteNonQueryAsync(token).ConfigureAwait(false);
        }
    }

    private static async Task<DraftRow?> ReadDraftRowAsync(SqliteConnection connection, SqliteTransaction transaction,
        WardrobeId id, CancellationToken token)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT wardrobe_id, model_revision_id, model_revision_sequence, model_snapshot_sha256, model_id, revision, display_name, wardrobe_json, wardrobe_sha256 FROM wardrobe_drafts WHERE wardrobe_id = $id;";
        command.Parameters.AddWithValue("$id", id.ToString());
        await using var reader = await command.ExecuteReaderAsync(token).ConfigureAwait(false);
        return await reader.ReadAsync(token).ConfigureAwait(false) ? ReadDraftRow(reader) : null;
    }

    private static async Task<PublishedWardrobeRevision?> ReadLatestPublishedAsync(SqliteConnection connection,
        SqliteTransaction transaction, WardrobeId id, CancellationToken token)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT wardrobe_revision_id, wardrobe_id, model_revision_id, model_id, revision, draft_revision, display_name, published_utc_ms, snapshot_json, snapshot_sha256 FROM wardrobe_revisions WHERE wardrobe_id = $id ORDER BY revision DESC LIMIT 1;";
        command.Parameters.AddWithValue("$id", id.ToString());
        await using var reader = await command.ExecuteReaderAsync(token).ConfigureAwait(false);
        return await reader.ReadAsync(token).ConfigureAwait(false)
            ? DecodePublished(ReadPublishedRow(reader)).Value : null;
    }

    private static DraftRow ReadDraftRow(SqliteDataReader reader) => new(WardrobeId.Parse(reader.GetString(0)),
        ModelRevisionId.Parse(reader.GetString(1)), reader.GetInt64(2), reader.GetString(3), ModelId.Parse(reader.GetString(4)),
        reader.GetInt64(5), reader.GetString(6), reader.GetString(7), reader.GetString(8));

    private static PublishedRow ReadPublishedRow(SqliteDataReader reader) => new(
        WardrobeRevisionId.Parse(reader.GetString(0)), WardrobeId.Parse(reader.GetString(1)),
        ModelRevisionId.Parse(reader.GetString(2)), ModelId.Parse(reader.GetString(3)),
        Revision.From(reader.GetInt64(4)), Revision.From(reader.GetInt64(5)), reader.GetString(6),
        reader.GetInt64(7), reader.GetString(8), reader.GetString(9));

    private static Result<WardrobeSet> DecodeDraft(DraftRow row)
    {
        var draft = WardrobeSnapshotCodec.DecodeDraft(row.Json, row.Sha256);
        if (draft.Id != row.WardrobeId || draft.Model.RevisionId != row.ModelRevisionId
            || draft.Model.Sequence.Value != row.ModelRevisionSequence || draft.Model.ModelId != row.ModelId
            || draft.Model.SnapshotSha256 != row.ModelSnapshotSha256 || draft.Revision.Value != row.Revision
            || draft.Name != row.Name) throw new InvalidDataException("The wardrobe draft row does not match its checksummed snapshot.");
        return Result<WardrobeSet>.Success(draft);
    }

    private static Result<PublishedWardrobeRevision> DecodePublished(PublishedRow row)
    {
        var publication = WardrobeSnapshotCodec.DecodePublished(row.Json, row.Sha256);
        if (publication.Id != row.RevisionId || publication.WardrobeId != row.WardrobeId
            || publication.Model.RevisionId != row.ModelRevisionId || publication.Model.ModelId != row.ModelId
            || publication.Revision != row.Revision || publication.DraftRevision != row.DraftRevision
            || publication.Name != row.Name || publication.PublishedUtcMs != row.PublishedUtcMs)
            throw new InvalidDataException("The published wardrobe row does not match its checksummed snapshot.");
        return Result<PublishedWardrobeRevision>.Success(publication);
    }

    private static bool HasSameContent(WardrobeSet draft, PublishedWardrobeRevision revision) =>
        draft.Id == revision.WardrobeId && draft.Model == revision.Model && draft.Name == revision.Name
        && draft.Components.SequenceEqual(revision.Components);

    private static void AddDraftParameters(SqliteCommand command, WardrobeSet draft, string json, string hash)
    {
        command.Parameters.AddWithValue("$id", draft.Id.ToString());
        command.Parameters.AddWithValue("$model_revision", draft.Model.RevisionId.ToString());
        command.Parameters.AddWithValue("$sequence", draft.Model.Sequence.Value);
        command.Parameters.AddWithValue("$model_hash", draft.Model.SnapshotSha256);
        command.Parameters.AddWithValue("$model", draft.Model.ModelId.ToString());
        command.Parameters.AddWithValue("$revision", draft.Revision.Value);
        command.Parameters.AddWithValue("$name", draft.Name);
        command.Parameters.AddWithValue("$json", json);
        command.Parameters.AddWithValue("$hash", hash);
        command.Parameters.AddWithValue("$updated", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }

    private static void AddPublicationParameters(SqliteCommand command, PublishedWardrobeRevision revision, string json, string hash)
    {
        command.Parameters.AddWithValue("$id", revision.Id.ToString());
        command.Parameters.AddWithValue("$wardrobe", revision.WardrobeId.ToString());
        command.Parameters.AddWithValue("$model_revision", revision.Model.RevisionId.ToString());
        command.Parameters.AddWithValue("$model", revision.Model.ModelId.ToString());
        command.Parameters.AddWithValue("$revision", revision.Revision.Value);
        command.Parameters.AddWithValue("$draft_revision", revision.DraftRevision.Value);
        command.Parameters.AddWithValue("$name", revision.Name);
        command.Parameters.AddWithValue("$published", revision.PublishedUtcMs);
        command.Parameters.AddWithValue("$json", json);
        command.Parameters.AddWithValue("$hash", hash);
    }

    private sealed record DraftRow(WardrobeId WardrobeId, ModelRevisionId ModelRevisionId,
        long ModelRevisionSequence, string ModelSnapshotSha256, ModelId ModelId, long Revision,
        string Name, string Json, string Sha256);

    private sealed record PublishedRow(WardrobeRevisionId RevisionId, WardrobeId WardrobeId,
        ModelRevisionId ModelRevisionId, ModelId ModelId, Revision Revision, Revision DraftRevision,
        string Name, long PublishedUtcMs, string Json, string Sha256);

    private static Result<T> Failure<T>(ApplicationErrorCode code, string message, string? target = null) =>
        Result<T>.Failure(new ApplicationError(code, message, target));
}
