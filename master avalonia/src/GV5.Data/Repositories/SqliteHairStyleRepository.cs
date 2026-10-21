using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Storage;
using Microsoft.Data.Sqlite;

namespace GV5.Data.Repositories;

/// <summary>Persists hair drafts with optimistic revisions and immutable published snapshots.</summary>
public sealed class SqliteHairStyleRepository(IGv5Database database) : IHairStyleRepository
{
    private const string DraftOwner = "fabricator.hair-draft";
    private const string RevisionOwner = "fabricator.hair-revision";
    private readonly IGv5Database _database = database ?? throw new ArgumentNullException(nameof(database));

    public async Task<Result<HairStyleDraft>> CreateAsync(HairStyleDraft draft, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(draft);
        if (draft.Revision != Revision.Initial)
            return Failure<HairStyleDraft>(ApplicationErrorCode.Validation, "Um novo penteado deve começar na revisão 1.");
        var encoded = HairStyleSnapshotCodec.Encode(draft);
        try
        {
            var created = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                if (!await IsModelAvailableAsync(connection, transaction, draft.Model, token).ConfigureAwait(false)
                    || !await AreAssetsAvailableAsync(connection, transaction, draft.Layers.Select(layer => layer.AssetId), token).ConfigureAwait(false)) return false;
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = "INSERT INTO hair_drafts(hair_id,model_revision_id,model_revision_sequence,model_snapshot_sha256,model_id,revision,display_name,draft_json,draft_sha256,updated_utc_ms) VALUES($id,$model_revision,$sequence,$model_hash,$model,$revision,$name,$json,$hash,$updated);";
                AddDraftParameters(command, draft, encoded.Json, encoded.Sha256);
                await command.ExecuteNonQueryAsync(token).ConfigureAwait(false);
                await ReplaceAssetReferencesAsync(connection, transaction, DraftOwner, draft.Id.Value,
                    draft.Layers.Select((layer, index) => ($"layer-{index}", layer.AssetId)), token).ConfigureAwait(false);
                return true;
            }, cancellationToken).ConfigureAwait(false);
            return created ? Result<HairStyleDraft>.Success(draft)
                : Failure<HairStyleDraft>(ApplicationErrorCode.NotFound, "A revisão exata do modelo ou um asset do cabelo não está disponível.");
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        { return Failure<HairStyleDraft>(ApplicationErrorCode.Conflict, "O penteado já existe ou viola uma restrição.", draft.Id.ToString()); }
        catch (SqliteException)
        { return Failure<HairStyleDraft>(ApplicationErrorCode.Persistence, "Não foi possível criar o penteado.", draft.Id.ToString()); }
    }

    public async Task<Result<HairStyleDraft>> GetAsync(HairId hairId, CancellationToken cancellationToken = default)
    {
        if (!hairId.IsValid) return Failure<HairStyleDraft>(ApplicationErrorCode.Validation, "O ID do penteado é inválido.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT hair_id,model_revision_id,model_revision_sequence,model_snapshot_sha256,model_id,revision,display_name,draft_json,draft_sha256 FROM hair_drafts WHERE hair_id=$id;";
            command.Parameters.AddWithValue("$id", hairId.ToString());
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            return await reader.ReadAsync(cancellationToken).ConfigureAwait(false)
                ? DecodeDraft(reader) : Failure<HairStyleDraft>(ApplicationErrorCode.NotFound, "O rascunho de cabelo não existe.", hairId.ToString());
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or System.Text.Json.JsonException)
        { return Failure<HairStyleDraft>(ApplicationErrorCode.Persistence, "O rascunho de cabelo não pôde ser verificado.", hairId.ToString()); }
    }

    public async Task<Result<IReadOnlyList<HairStyleDraft>>> ListAsync(ModelRevisionId modelRevisionId,
        CancellationToken cancellationToken = default)
    {
        if (!modelRevisionId.IsValid) return Failure<IReadOnlyList<HairStyleDraft>>(ApplicationErrorCode.Validation, "A revisão de modelo é inválida.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT hair_id,model_revision_id,model_revision_sequence,model_snapshot_sha256,model_id,revision,display_name,draft_json,draft_sha256 FROM hair_drafts WHERE model_revision_id=$model_revision ORDER BY display_name COLLATE NOCASE,hair_id;";
            command.Parameters.AddWithValue("$model_revision", modelRevisionId.ToString());
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            var items = new List<HairStyleDraft>();
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                var decoded = DecodeDraft(reader);
                if (decoded.IsFailure) return Result<IReadOnlyList<HairStyleDraft>>.Failure(decoded.Error!);
                items.Add(decoded.Value);
            }
            return Result<IReadOnlyList<HairStyleDraft>>.Success(items.AsReadOnly());
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or System.Text.Json.JsonException)
        { return Failure<IReadOnlyList<HairStyleDraft>>(ApplicationErrorCode.Persistence, "Os penteados não puderam ser listados.", modelRevisionId.ToString()); }
    }

    public async Task<Result<HairStyleDraft>> SaveAsync(HairStyleDraft draft, Revision expectedRevision,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(draft);
        if (!expectedRevision.IsValid || draft.Revision.Value <= expectedRevision.Value)
            return Failure<HairStyleDraft>(ApplicationErrorCode.Validation, "A revisão do rascunho precisa avançar.", draft.Id.ToString());
        var encoded = HairStyleSnapshotCodec.Encode(draft);
        try
        {
            var updated = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                if (!await IsModelAvailableAsync(connection, transaction, draft.Model, token).ConfigureAwait(false)
                    || !await AreAssetsAvailableAsync(connection, transaction, draft.Layers.Select(layer => layer.AssetId), token).ConfigureAwait(false)) return false;
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = "UPDATE hair_drafts SET revision=$revision,display_name=$name,draft_json=$json,draft_sha256=$hash,updated_utc_ms=$updated WHERE hair_id=$id AND model_revision_id=$model_revision AND model_revision_sequence=$sequence AND model_snapshot_sha256=$model_hash AND model_id=$model AND revision=$expected;";
                AddDraftParameters(command, draft, encoded.Json, encoded.Sha256);
                command.Parameters.AddWithValue("$expected", expectedRevision.Value);
                if (await command.ExecuteNonQueryAsync(token).ConfigureAwait(false) != 1) return false;
                await ReplaceAssetReferencesAsync(connection, transaction, DraftOwner, draft.Id.Value,
                    draft.Layers.Select((layer, index) => ($"layer-{index}", layer.AssetId)), token).ConfigureAwait(false);
                return true;
            }, cancellationToken).ConfigureAwait(false);
            if (updated) return Result<HairStyleDraft>.Success(draft);
            var existing = await GetAsync(draft.Id, cancellationToken).ConfigureAwait(false);
            return existing.IsFailure ? existing : Failure<HairStyleDraft>(ApplicationErrorCode.Conflict,
                "O penteado foi alterado em outro editor; a revisão salva foi preservada.", draft.Id.ToString());
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or System.Text.Json.JsonException)
        { return Failure<HairStyleDraft>(ApplicationErrorCode.Persistence, "Não foi possível salvar o penteado.", draft.Id.ToString()); }
    }

    public async Task<Result<PublishedHairStyleRevision>> PublishAsync(HairId hairId,
        Revision expectedDraftRevision, long publishedUtcMs, CancellationToken cancellationToken = default)
    {
        if (!hairId.IsValid || !expectedDraftRevision.IsValid || publishedUtcMs < 0)
            return Failure<PublishedHairStyleRevision>(ApplicationErrorCode.Validation, "Os dados de publicação do cabelo são inválidos.");
        PublishOutcome outcome;
        try
        {
        outcome = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
        {
            var draft = await ReadDraftAsync(connection, transaction, hairId, token).ConfigureAwait(false);
            if (draft is null) return PublishOutcome.NotFound;
            Result<HairStyleDraft> decoded;
            try { decoded = DecodeDraft(draft); }
            catch (Exception exception) when (exception is InvalidDataException or ArgumentException or System.Text.Json.JsonException)
            { return PublishOutcome.Corrupt; }
            if (decoded.IsFailure) return PublishOutcome.Corrupt;
            if (decoded.Value.Revision != expectedDraftRevision) return PublishOutcome.Conflict;
            if (!await IsModelAvailableAsync(connection, transaction, decoded.Value.Model, token).ConfigureAwait(false)
                || !await AreAssetsAvailableAsync(connection, transaction, decoded.Value.Layers.Select(layer => layer.AssetId), token).ConfigureAwait(false))
                return PublishOutcome.MissingAssets;
            await using (var latestPublished = connection.CreateCommand())
            {
                latestPublished.Transaction = transaction;
                latestPublished.CommandText = "SELECT hair_revision_id,hair_id,revision,draft_revision,published_utc_ms,snapshot_json,snapshot_sha256,model_revision_id,model_id,display_name FROM hair_revisions WHERE hair_id=$id ORDER BY revision DESC LIMIT 1;";
                latestPublished.Parameters.AddWithValue("$id", hairId.ToString());
                await using var reader = await latestPublished.ExecuteReaderAsync(token).ConfigureAwait(false);
                if (await reader.ReadAsync(token).ConfigureAwait(false))
                {
                    var latest = DecodePublication(reader);
                    if (latest.IsFailure) return PublishOutcome.Corrupt;
                    if (latest.Value.DraftRevision == expectedDraftRevision)
                        return PublishOutcome.Success with { Publication = latest.Value };
                }
            }
            long revisionNumber;
            await using (var latest = connection.CreateCommand())
            {
                latest.Transaction = transaction;
                latest.CommandText = "SELECT COALESCE(MAX(revision),0)+1 FROM hair_revisions WHERE hair_id=$id;";
                latest.Parameters.AddWithValue("$id", hairId.ToString());
                revisionNumber = Convert.ToInt64(await latest.ExecuteScalarAsync(token).ConfigureAwait(false));
            }
            var revision = Revision.From(revisionNumber);
            var publicationId = HairRevisionId.New();
            var publicationDocument = PublishedHairStyleRevision.Restore(publicationId, hairId, revision,
                decoded.Value.Revision, publishedUtcMs, new string('0', 64), decoded.Value);
            var encoded = HairStyleSnapshotCodec.Encode(publicationDocument.Snapshot);
            publicationDocument = PublishedHairStyleRevision.Restore(publicationId, hairId, revision,
                decoded.Value.Revision, publishedUtcMs, encoded.Sha256, decoded.Value);
            await using (var insert = connection.CreateCommand())
            {
                insert.Transaction = transaction;
                insert.CommandText = "INSERT INTO hair_revisions(hair_revision_id,hair_id,model_revision_id,model_id,revision,draft_revision,display_name,published_utc_ms,snapshot_json,snapshot_sha256) VALUES($revision_id,$hair_id,$model_revision,$model,$revision,$draft_revision,$name,$published,$json,$hash);";
                insert.Parameters.AddWithValue("$revision_id", publicationId.ToString());
                insert.Parameters.AddWithValue("$hair_id", hairId.ToString());
                insert.Parameters.AddWithValue("$model_revision", decoded.Value.Model.RevisionId.ToString());
                insert.Parameters.AddWithValue("$model", decoded.Value.Model.ModelId.ToString());
                insert.Parameters.AddWithValue("$revision", revision.Value);
                insert.Parameters.AddWithValue("$draft_revision", decoded.Value.Revision.Value);
                insert.Parameters.AddWithValue("$name", decoded.Value.Name);
                insert.Parameters.AddWithValue("$published", publishedUtcMs);
                insert.Parameters.AddWithValue("$json", encoded.Json);
                insert.Parameters.AddWithValue("$hash", encoded.Sha256);
                await insert.ExecuteNonQueryAsync(token).ConfigureAwait(false);
            }
            await ReplaceAssetReferencesAsync(connection, transaction, RevisionOwner, publicationId.Value,
                decoded.Value.Layers.Select((layer, index) => ($"layer-{index}", layer.AssetId)), token).ConfigureAwait(false);
            return PublishOutcome.Success with { Publication = publicationDocument };
        }, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or System.Text.Json.JsonException)
        { return Failure<PublishedHairStyleRevision>(ApplicationErrorCode.Persistence, "Não foi possível publicar o penteado.", hairId.ToString()); }

        return outcome.Status switch
        {
            PublishStatus.Success => Result<PublishedHairStyleRevision>.Success(outcome.Publication!),
            PublishStatus.NotFound => Failure<PublishedHairStyleRevision>(ApplicationErrorCode.NotFound, "O rascunho de cabelo não existe.", hairId.ToString()),
            PublishStatus.Conflict => Failure<PublishedHairStyleRevision>(ApplicationErrorCode.Conflict, "O rascunho foi alterado antes da publicação.", hairId.ToString()),
            PublishStatus.MissingAssets => Failure<PublishedHairStyleRevision>(ApplicationErrorCode.NotFound, "O modelo ou um asset referenciado deixou de estar disponível.", hairId.ToString()),
            _ => Failure<PublishedHairStyleRevision>(ApplicationErrorCode.Persistence, "O penteado salvo está corrompido.", hairId.ToString())
        };
    }

    public async Task<Result<IReadOnlyList<PublishedHairStyleRevision>>> ListPublishedAsync(HairId hairId,
        CancellationToken cancellationToken = default)
    {
        if (!hairId.IsValid) return Failure<IReadOnlyList<PublishedHairStyleRevision>>(ApplicationErrorCode.Validation, "O ID do penteado é inválido.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT hair_revision_id,hair_id,revision,draft_revision,published_utc_ms,snapshot_json,snapshot_sha256,model_revision_id,model_id,display_name FROM hair_revisions WHERE hair_id=$id ORDER BY revision DESC;";
            command.Parameters.AddWithValue("$id", hairId.ToString());
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            var results = new List<PublishedHairStyleRevision>();
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                var decoded = DecodePublication(reader);
                if (decoded.IsFailure) return Result<IReadOnlyList<PublishedHairStyleRevision>>.Failure(decoded.Error!);
                results.Add(decoded.Value);
            }
            return Result<IReadOnlyList<PublishedHairStyleRevision>>.Success(results.AsReadOnly());
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or System.Text.Json.JsonException)
        { return Failure<IReadOnlyList<PublishedHairStyleRevision>>(ApplicationErrorCode.Persistence, "As publicações de cabelo não puderam ser verificadas.", hairId.ToString()); }
    }

    private async Task<bool> IsModelAvailableAsync(SqliteConnection connection, SqliteTransaction transaction,
        ModelRevisionReference model, CancellationToken token)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT 1 FROM model_revisions WHERE revision_id=$revision AND model_id=$model AND revision=$sequence AND snapshot_sha256=$hash;";
        command.Parameters.AddWithValue("$revision", model.RevisionId.ToString());
        command.Parameters.AddWithValue("$model", model.ModelId.ToString());
        command.Parameters.AddWithValue("$sequence", model.Sequence.Value);
        command.Parameters.AddWithValue("$hash", model.SnapshotSha256);
        return await command.ExecuteScalarAsync(token).ConfigureAwait(false) is not null;
    }

    private static async Task<bool> AreAssetsAvailableAsync(SqliteConnection connection, SqliteTransaction transaction,
        IEnumerable<AssetId> assets, CancellationToken token)
    {
        foreach (var asset in assets.Distinct())
        {
            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = "SELECT 1 FROM assets WHERE asset_id=$id AND verification_state='available';";
            command.Parameters.AddWithValue("$id", asset.ToString());
            if (await command.ExecuteScalarAsync(token).ConfigureAwait(false) is null) return false;
        }
        return true;
    }

    private static async Task ReplaceAssetReferencesAsync(SqliteConnection connection, SqliteTransaction transaction,
        string owner, Guid ownerId, IEnumerable<(string Slot, AssetId Asset)> assets, CancellationToken token)
    {
        var current = assets.ToArray();
        var previousAssets = new List<AssetId>();
        await using (var readPrevious = connection.CreateCommand())
        {
            readPrevious.Transaction = transaction;
            readPrevious.CommandText = "SELECT DISTINCT asset_id FROM asset_references WHERE owner_type=$owner AND owner_id=$id;";
            readPrevious.Parameters.AddWithValue("$owner", owner);
            readPrevious.Parameters.AddWithValue("$id", ownerId.ToString("D"));
            await using var reader = await readPrevious.ExecuteReaderAsync(token).ConfigureAwait(false);
            while (await reader.ReadAsync(token).ConfigureAwait(false)) previousAssets.Add(AssetId.Parse(reader.GetString(0)));
        }
        await using (var delete = connection.CreateCommand())
        {
            delete.Transaction = transaction;
            delete.CommandText = "DELETE FROM asset_references WHERE owner_type=$owner AND owner_id=$id;";
            delete.Parameters.AddWithValue("$owner", owner);
            delete.Parameters.AddWithValue("$id", ownerId.ToString("D"));
            await delete.ExecuteNonQueryAsync(token).ConfigureAwait(false);
        }
        foreach (var (slot, asset) in current)
        {
            await using var insert = connection.CreateCommand();
            insert.Transaction = transaction;
            insert.CommandText = "INSERT INTO asset_references(owner_type,owner_id,slot,asset_id,created_utc_ms) VALUES($owner,$id,$slot,$asset,$created);";
            insert.Parameters.AddWithValue("$owner", owner);
            insert.Parameters.AddWithValue("$id", ownerId.ToString("D"));
            insert.Parameters.AddWithValue("$slot", slot);
            insert.Parameters.AddWithValue("$asset", asset.ToString());
            insert.Parameters.AddWithValue("$created", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            await insert.ExecuteNonQueryAsync(token).ConfigureAwait(false);
            await using var gc = connection.CreateCommand();
            gc.Transaction = transaction;
            gc.CommandText = "DELETE FROM asset_gc_candidates WHERE asset_id=$asset;";
            gc.Parameters.AddWithValue("$asset", asset.ToString());
            await gc.ExecuteNonQueryAsync(token).ConfigureAwait(false);
        }
        foreach (var asset in previousAssets.Except(current.Select(item => item.Asset).ToHashSet()))
        {
            await using var referenced = connection.CreateCommand();
            referenced.Transaction = transaction;
            referenced.CommandText = "SELECT 1 FROM asset_references WHERE asset_id=$asset LIMIT 1;";
            referenced.Parameters.AddWithValue("$asset", asset.ToString());
            if (await referenced.ExecuteScalarAsync(token).ConfigureAwait(false) is not null) continue;
            await using var candidate = connection.CreateCommand();
            candidate.Transaction = transaction;
            candidate.CommandText = "INSERT OR IGNORE INTO asset_gc_candidates(asset_id,unreferenced_since_utc_ms) VALUES($asset,$now);";
            candidate.Parameters.AddWithValue("$asset", asset.ToString());
            candidate.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            await candidate.ExecuteNonQueryAsync(token).ConfigureAwait(false);
        }
    }

    private static void AddDraftParameters(SqliteCommand command, HairStyleDraft draft, string json, string hash)
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

    private static async Task<DraftRow?> ReadDraftAsync(SqliteConnection connection, SqliteTransaction transaction,
        HairId hairId, CancellationToken token)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT hair_id,model_revision_id,model_revision_sequence,model_snapshot_sha256,model_id,revision,display_name,draft_json,draft_sha256 FROM hair_drafts WHERE hair_id=$id;";
        command.Parameters.AddWithValue("$id", hairId.ToString());
        await using var reader = await command.ExecuteReaderAsync(token).ConfigureAwait(false);
        return await reader.ReadAsync(token).ConfigureAwait(false)
            ? new DraftRow(HairId.Parse(reader.GetString(0)), ModelRevisionId.Parse(reader.GetString(1)),
                reader.GetInt64(2), reader.GetString(3), ModelId.Parse(reader.GetString(4)),
                reader.GetInt64(5), reader.GetString(6), reader.GetString(7), reader.GetString(8))
            : null;
    }

    private static Result<HairStyleDraft> DecodeDraft(SqliteDataReader reader)
    {
        return DecodeDraft(new DraftRow(HairId.Parse(reader.GetString(0)), ModelRevisionId.Parse(reader.GetString(1)),
            reader.GetInt64(2), reader.GetString(3), ModelId.Parse(reader.GetString(4)), reader.GetInt64(5),
            reader.GetString(6), reader.GetString(7), reader.GetString(8)));
    }

    private static Result<HairStyleDraft> DecodeDraft(DraftRow row)
    {
        var model = ModelRevisionReference.Restore(row.ModelId, row.ModelRevisionId,
            Revision.From(row.ModelRevisionSequence), row.ModelSnapshotSha256);
        var draft = HairStyleSnapshotCodec.Decode(row.Json, row.Sha256);
        if (draft.Id != row.HairId || draft.Model != model || draft.Revision.Value != row.Revision || draft.Name != row.Name)
            throw new InvalidDataException("The hair draft row does not match its checksummed snapshot.");
        return Result<HairStyleDraft>.Success(draft);
    }

    private static Result<PublishedHairStyleRevision> DecodePublication(SqliteDataReader reader)
    {
        var id = HairRevisionId.Parse(reader.GetString(0));
        var hair = HairId.Parse(reader.GetString(1));
        var revision = Revision.From(reader.GetInt64(2));
        var draftRevision = Revision.From(reader.GetInt64(3));
        var timestamp = reader.GetInt64(4);
        var json = reader.GetString(5);
        var hash = reader.GetString(6);
        var snapshot = HairStyleSnapshotCodec.Decode(json, hash);
        if (snapshot.Model.RevisionId != ModelRevisionId.Parse(reader.GetString(7))
            || snapshot.Model.ModelId != ModelId.Parse(reader.GetString(8))
            || snapshot.Name != reader.GetString(9))
            throw new InvalidDataException("The hair publication row does not match its checksummed snapshot.");
        var publication = PublishedHairStyleRevision.Restore(id, hair, revision, draftRevision, timestamp, hash, snapshot);
        return Result<PublishedHairStyleRevision>.Success(publication);
    }

    private static Result<T> Failure<T>(ApplicationErrorCode code, string message, string? target = null) =>
        Result<T>.Failure(new ApplicationError(code, message, target));

    private sealed record DraftRow(HairId HairId, ModelRevisionId ModelRevisionId, long ModelRevisionSequence,
        string ModelSnapshotSha256, ModelId ModelId, long Revision, string Name, string Json, string Sha256);

    private enum PublishStatus { Success, NotFound, Conflict, MissingAssets, Corrupt }
    private sealed record PublishOutcome(PublishStatus Status, PublishedHairStyleRevision? Publication = null)
    {
        public static PublishOutcome NotFound => new(PublishStatus.NotFound);
        public static PublishOutcome Conflict => new(PublishStatus.Conflict);
        public static PublishOutcome MissingAssets => new(PublishStatus.MissingAssets);
        public static PublishOutcome Corrupt => new(PublishStatus.Corrupt);
        public static PublishOutcome Success => new(PublishStatus.Success);
    }
}
