using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Storage;
using Microsoft.Data.Sqlite;

namespace GV5.Data.Repositories;

/// <summary>Stores checksummed face drafts with optimistic writes and stable asset references.</summary>
public sealed class SqliteFaceCatalogRepository(IGv5Database database) : IFaceCatalogRepository
{
    private const string AssetOwner = "fabricator.face-draft";
    private readonly IGv5Database _database = database ?? throw new ArgumentNullException(nameof(database));

    public async Task<Result<FaceCatalogDraft>> CreateAsync(FaceCatalogDraft draft, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(draft);
        if (draft.Revision != Revision.Initial)
            return Failure<FaceCatalogDraft>(ApplicationErrorCode.Validation, "Um novo catálogo facial deve começar na revisão 1.");
        var encoded = FaceCatalogSnapshotCodec.Encode(draft);
        try
        {
            var created = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                if (!await IsModelAvailableAsync(connection, transaction, draft.Model, token).ConfigureAwait(false)
                    || !await AreAssetsAvailableAsync(connection, transaction, draft.Components.Select(component => component.AssetId), token).ConfigureAwait(false))
                    return false;
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = "INSERT INTO face_catalog_drafts(face_id,model_revision_id,model_revision_sequence,model_snapshot_sha256,model_id,revision,display_name,draft_json,draft_sha256,updated_utc_ms) VALUES($id,$model_revision,$sequence,$model_hash,$model,$revision,$name,$json,$hash,$updated);";
                AddParameters(command, draft, encoded.Json, encoded.Sha256);
                await command.ExecuteNonQueryAsync(token).ConfigureAwait(false);
                await ReplaceAssetReferencesAsync(connection, transaction, draft.Id,
                    draft.Components.Select(component => (component.Id, component.AssetId)), token).ConfigureAwait(false);
                return true;
            }, cancellationToken).ConfigureAwait(false);
            return created ? Result<FaceCatalogDraft>.Success(draft)
                : Failure<FaceCatalogDraft>(ApplicationErrorCode.NotFound, "A revisão exata do modelo ou um asset facial não está disponível.");
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        { return Failure<FaceCatalogDraft>(ApplicationErrorCode.Conflict, "O catálogo facial já existe ou viola uma restrição.", draft.Id.ToString()); }
        catch (SqliteException)
        { return Failure<FaceCatalogDraft>(ApplicationErrorCode.Persistence, "Não foi possível criar o catálogo facial.", draft.Id.ToString()); }
    }

    public async Task<Result<FaceCatalogDraft>> GetAsync(FaceId faceId, CancellationToken cancellationToken = default)
    {
        if (!faceId.IsValid) return Failure<FaceCatalogDraft>(ApplicationErrorCode.Validation, "O ID do catálogo facial é inválido.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = SelectDraft + " WHERE face_id=$id;";
            command.Parameters.AddWithValue("$id", faceId.ToString());
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            return await reader.ReadAsync(cancellationToken).ConfigureAwait(false)
                ? Decode(reader)
                : Failure<FaceCatalogDraft>(ApplicationErrorCode.NotFound, "O catálogo facial não existe.", faceId.ToString());
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or System.Text.Json.JsonException)
        { return Failure<FaceCatalogDraft>(ApplicationErrorCode.Persistence, "O catálogo facial não pôde ser verificado.", faceId.ToString()); }
    }

    public async Task<Result<IReadOnlyList<FaceCatalogDraft>>> ListAsync(ModelRevisionId modelRevisionId,
        CancellationToken cancellationToken = default)
    {
        if (!modelRevisionId.IsValid) return Failure<IReadOnlyList<FaceCatalogDraft>>(ApplicationErrorCode.Validation, "A revisão de modelo é inválida.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = SelectDraft + " WHERE model_revision_id=$model_revision ORDER BY display_name COLLATE NOCASE,face_id;";
            command.Parameters.AddWithValue("$model_revision", modelRevisionId.ToString());
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            var drafts = new List<FaceCatalogDraft>();
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                var decoded = Decode(reader);
                if (decoded.IsFailure) return Result<IReadOnlyList<FaceCatalogDraft>>.Failure(decoded.Error!);
                drafts.Add(decoded.Value);
            }
            return Result<IReadOnlyList<FaceCatalogDraft>>.Success(drafts.AsReadOnly());
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or System.Text.Json.JsonException)
        { return Failure<IReadOnlyList<FaceCatalogDraft>>(ApplicationErrorCode.Persistence, "Os catálogos faciais não puderam ser verificados.", modelRevisionId.ToString()); }
    }

    public async Task<Result<FaceCatalogDraft>> SaveAsync(FaceCatalogDraft draft, Revision expectedRevision,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(draft);
        if (!expectedRevision.IsValid || draft.Revision.Value <= expectedRevision.Value)
            return Failure<FaceCatalogDraft>(ApplicationErrorCode.Validation, "A revisão do catálogo facial precisa avançar.", draft.Id.ToString());
        var encoded = FaceCatalogSnapshotCodec.Encode(draft);
        try
        {
            var saved = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                if (!await IsModelAvailableAsync(connection, transaction, draft.Model, token).ConfigureAwait(false)
                    || !await AreAssetsAvailableAsync(connection, transaction, draft.Components.Select(component => component.AssetId), token).ConfigureAwait(false))
                    return SaveOutcome.MissingDependencies;
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = "UPDATE face_catalog_drafts SET revision=$revision,display_name=$name,draft_json=$json,draft_sha256=$hash,updated_utc_ms=$updated WHERE face_id=$id AND model_revision_id=$model_revision AND model_revision_sequence=$sequence AND model_snapshot_sha256=$model_hash AND model_id=$model AND revision=$expected;";
                AddParameters(command, draft, encoded.Json, encoded.Sha256);
                command.Parameters.AddWithValue("$expected", expectedRevision.Value);
                if (await command.ExecuteNonQueryAsync(token).ConfigureAwait(false) != 1) return SaveOutcome.Conflict;
                await ReplaceAssetReferencesAsync(connection, transaction, draft.Id,
                    draft.Components.Select(component => (component.Id, component.AssetId)), token).ConfigureAwait(false);
                return SaveOutcome.Saved;
            }, cancellationToken).ConfigureAwait(false);
            return saved switch
            {
                SaveOutcome.Saved => Result<FaceCatalogDraft>.Success(draft),
                SaveOutcome.MissingDependencies => Failure<FaceCatalogDraft>(ApplicationErrorCode.NotFound, "A revisão exata do modelo ou um asset facial não está disponível.", draft.Id.ToString()),
                _ => Failure<FaceCatalogDraft>(ApplicationErrorCode.Conflict, "O catálogo foi alterado em outro editor; a revisão salva foi preservada.", draft.Id.ToString())
            };
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or System.Text.Json.JsonException)
        { return Failure<FaceCatalogDraft>(ApplicationErrorCode.Persistence, "Não foi possível salvar o catálogo facial.", draft.Id.ToString()); }
    }

    public async Task<Result<PublishedFaceCatalogRevision>> PublishAsync(FaceId faceId,
        Revision expectedDraftRevision, long publishedUtcMs, CancellationToken cancellationToken = default)
    {
        if (!faceId.IsValid || !expectedDraftRevision.IsValid || publishedUtcMs < 0)
            return Failure<PublishedFaceCatalogRevision>(ApplicationErrorCode.Validation, "Os dados de publicação facial são inválidos.");
        try
        {
            var outcome = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                await using var select = connection.CreateCommand();
                select.Transaction = transaction;
                select.CommandText = SelectDraft + " WHERE face_id=$id;";
                select.Parameters.AddWithValue("$id", faceId.ToString());
                FaceCatalogDraft? draft;
                await using (var reader = await select.ExecuteReaderAsync(token).ConfigureAwait(false))
                {
                    if (!await reader.ReadAsync(token).ConfigureAwait(false)) return PublishOutcome.NotFound;
                    var decoded = Decode(reader);
                    if (decoded.IsFailure) return PublishOutcome.Corrupt;
                    draft = decoded.Value;
                }
                if (draft.Revision != expectedDraftRevision) return PublishOutcome.Conflict;
                if (!await IsModelAvailableAsync(connection, transaction, draft.Model, token).ConfigureAwait(false)
                    || !await AreAssetsAvailableAsync(connection, transaction, draft.Components.Select(component => component.AssetId), token).ConfigureAwait(false))
                    return PublishOutcome.MissingDependencies;

                await using var latest = connection.CreateCommand();
                latest.Transaction = transaction;
                latest.CommandText = PublishedSelect + " WHERE r.face_id=$id ORDER BY r.revision DESC LIMIT 1;";
                latest.Parameters.AddWithValue("$id", faceId.ToString());
                await using (var reader = await latest.ExecuteReaderAsync(token).ConfigureAwait(false))
                {
                    if (await reader.ReadAsync(token).ConfigureAwait(false))
                    {
                        var prior = DecodePublication(reader);
                        if (prior.IsFailure) return PublishOutcome.Corrupt;
                        if (prior.Value.DraftRevision == expectedDraftRevision) return PublishOutcome.Success with { Publication = prior.Value };
                    }
                }

                await using var sequenceCommand = connection.CreateCommand();
                sequenceCommand.Transaction = transaction;
                sequenceCommand.CommandText = "SELECT COALESCE(MAX(revision),0)+1 FROM face_revisions WHERE face_id=$id;";
                sequenceCommand.Parameters.AddWithValue("$id", faceId.ToString());
                var sequence = Revision.From(Convert.ToInt64(await sequenceCommand.ExecuteScalarAsync(token).ConfigureAwait(false)));
                var id = FaceRevisionId.New();
                var encoded = FaceCatalogSnapshotCodec.Encode(draft);
                var publication = PublishedFaceCatalogRevision.Restore(id, faceId, sequence, draft.Revision,
                    publishedUtcMs, encoded.Sha256, draft);
                await using var insert = connection.CreateCommand();
                insert.Transaction = transaction;
                insert.CommandText = "INSERT INTO face_revisions(face_revision_id,face_id,model_revision_id,model_id,revision,draft_revision,display_name,published_utc_ms,snapshot_json,snapshot_sha256) VALUES($id,$face,$model_revision,$model,$revision,$draft_revision,$name,$published,$json,$hash);";
                insert.Parameters.AddWithValue("$id", id.ToString());
                insert.Parameters.AddWithValue("$face", faceId.ToString());
                insert.Parameters.AddWithValue("$model_revision", draft.Model.RevisionId.ToString());
                insert.Parameters.AddWithValue("$model", draft.Model.ModelId.ToString());
                insert.Parameters.AddWithValue("$revision", sequence.Value);
                insert.Parameters.AddWithValue("$draft_revision", draft.Revision.Value);
                insert.Parameters.AddWithValue("$name", draft.Name);
                insert.Parameters.AddWithValue("$published", publishedUtcMs);
                insert.Parameters.AddWithValue("$json", encoded.Json);
                insert.Parameters.AddWithValue("$hash", encoded.Sha256);
                await insert.ExecuteNonQueryAsync(token).ConfigureAwait(false);
                await CopyPublishedAssetReferencesAsync(connection, transaction, faceId, id, token).ConfigureAwait(false);
                return PublishOutcome.Success with { Publication = publication };
            }, cancellationToken).ConfigureAwait(false);
            return outcome.Status switch
            {
                PublishStatus.Success => Result<PublishedFaceCatalogRevision>.Success(outcome.Publication!),
                PublishStatus.NotFound => Failure<PublishedFaceCatalogRevision>(ApplicationErrorCode.NotFound, "O catálogo facial não existe.", faceId.ToString()),
                PublishStatus.Conflict => Failure<PublishedFaceCatalogRevision>(ApplicationErrorCode.Conflict, "O catálogo mudou antes da publicação.", faceId.ToString()),
                PublishStatus.MissingDependencies => Failure<PublishedFaceCatalogRevision>(ApplicationErrorCode.NotFound, "O modelo pinado ou um asset facial não está disponível.", faceId.ToString()),
                _ => Failure<PublishedFaceCatalogRevision>(ApplicationErrorCode.Persistence, "O snapshot facial está corrompido.", faceId.ToString())
            };
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or System.Text.Json.JsonException or OverflowException)
        { return Failure<PublishedFaceCatalogRevision>(ApplicationErrorCode.Persistence, "Não foi possível publicar o catálogo facial.", faceId.ToString()); }
    }

    public async Task<Result<PublishedFaceCatalogRevision>> GetPublishedAsync(FaceId faceId, Revision revision,
        CancellationToken cancellationToken = default)
    {
        if (!faceId.IsValid || !revision.IsValid)
            return Failure<PublishedFaceCatalogRevision>(ApplicationErrorCode.Validation, "O ID e a revisão facial são obrigatórios.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = PublishedSelect + " WHERE r.face_id=$id AND r.revision=$revision;";
            command.Parameters.AddWithValue("$id", faceId.ToString());
            command.Parameters.AddWithValue("$revision", revision.Value);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            return await reader.ReadAsync(cancellationToken).ConfigureAwait(false)
                ? DecodePublication(reader)
                : Failure<PublishedFaceCatalogRevision>(ApplicationErrorCode.NotFound, "A revisão facial publicada não existe.", faceId.ToString());
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or System.Text.Json.JsonException)
        { return Failure<PublishedFaceCatalogRevision>(ApplicationErrorCode.Persistence, "A revisão facial publicada não pôde ser verificada.", faceId.ToString()); }
    }

    public async Task<Result<IReadOnlyList<PublishedFaceCatalogRevision>>> ListPublishedAsync(FaceId faceId,
        CancellationToken cancellationToken = default)
    {
        if (!faceId.IsValid) return Failure<IReadOnlyList<PublishedFaceCatalogRevision>>(ApplicationErrorCode.Validation, "O ID do catálogo facial é inválido.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = PublishedSelect + " WHERE r.face_id=$id ORDER BY r.revision DESC;";
            command.Parameters.AddWithValue("$id", faceId.ToString());
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            var publications = new List<PublishedFaceCatalogRevision>();
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                var decoded = DecodePublication(reader);
                if (decoded.IsFailure) return Result<IReadOnlyList<PublishedFaceCatalogRevision>>.Failure(decoded.Error!);
                publications.Add(decoded.Value);
            }
            return Result<IReadOnlyList<PublishedFaceCatalogRevision>>.Success(publications.AsReadOnly());
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or System.Text.Json.JsonException)
        { return Failure<IReadOnlyList<PublishedFaceCatalogRevision>>(ApplicationErrorCode.Persistence, "As revisões faciais não puderam ser verificadas.", faceId.ToString()); }
    }

    private static Result<PublishedFaceCatalogRevision> DecodePublication(SqliteDataReader reader)
    {
        var id = FaceRevisionId.Parse(reader.GetString(0));
        var faceId = FaceId.Parse(reader.GetString(1));
        var revision = Revision.From(reader.GetInt64(2));
        var draftRevision = Revision.From(reader.GetInt64(3));
        var published = reader.GetInt64(4);
        var hash = reader.GetString(5);
        var snapshot = FaceCatalogSnapshotCodec.Decode(reader.GetString(6), hash);
        var pinnedModel = ModelRevisionReference.Restore(ModelId.Parse(reader.GetString(8)),
            ModelRevisionId.Parse(reader.GetString(7)), Revision.From(reader.GetInt64(9)), reader.GetString(10));
        if (snapshot.Model != pinnedModel)
            throw new InvalidDataException("The published face catalog does not match its pinned model revision.");
        return Result<PublishedFaceCatalogRevision>.Success(PublishedFaceCatalogRevision.Restore(id, faceId,
            revision, draftRevision, published, hash, snapshot));
    }

    private const string PublishedSelect = "SELECT r.face_revision_id,r.face_id,r.revision,r.draft_revision,r.published_utc_ms,r.snapshot_sha256,r.snapshot_json,r.model_revision_id,r.model_id,m.revision,m.snapshot_sha256 FROM face_revisions r JOIN model_revisions m ON m.revision_id=r.model_revision_id";

    private static async Task CopyPublishedAssetReferencesAsync(SqliteConnection connection, SqliteTransaction transaction,
        FaceId faceId, FaceRevisionId revisionId, CancellationToken token)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "INSERT INTO asset_references(owner_type,owner_id,slot,asset_id,created_utc_ms) SELECT 'fabricator.face-revision',$revision,slot,asset_id,$created FROM asset_references WHERE owner_type=$owner AND owner_id=$face;";
        command.Parameters.AddWithValue("$revision", revisionId.Value.ToString("D"));
        command.Parameters.AddWithValue("$created", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        command.Parameters.AddWithValue("$owner", AssetOwner);
        command.Parameters.AddWithValue("$face", faceId.Value.ToString("D"));
        await command.ExecuteNonQueryAsync(token).ConfigureAwait(false);
    }

    private enum PublishStatus { Success, NotFound, Conflict, MissingDependencies, Corrupt }
    private sealed record PublishOutcome(PublishStatus Status, PublishedFaceCatalogRevision? Publication = null)
    {
        public static PublishOutcome NotFound => new(PublishStatus.NotFound);
        public static PublishOutcome Conflict => new(PublishStatus.Conflict);
        public static PublishOutcome MissingDependencies => new(PublishStatus.MissingDependencies);
        public static PublishOutcome Corrupt => new(PublishStatus.Corrupt);
        public static PublishOutcome Success => new(PublishStatus.Success);
    }

    private const string SelectDraft = "SELECT face_id,model_revision_id,model_revision_sequence,model_snapshot_sha256,model_id,revision,display_name,draft_json,draft_sha256 FROM face_catalog_drafts";

    private static void AddParameters(SqliteCommand command, FaceCatalogDraft draft, string json, string hash)
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

    private static Result<FaceCatalogDraft> Decode(SqliteDataReader reader)
    {
        var id = FaceId.Parse(reader.GetString(0));
        var modelRevision = ModelRevisionId.Parse(reader.GetString(1));
        var sequence = reader.GetInt64(2);
        var modelHash = reader.GetString(3);
        var modelId = ModelId.Parse(reader.GetString(4));
        var revision = reader.GetInt64(5);
        var name = reader.GetString(6);
        var draft = FaceCatalogSnapshotCodec.Decode(reader.GetString(7), reader.GetString(8));
        var model = ModelRevisionReference.Restore(modelId, modelRevision, Revision.From(sequence), modelHash);
        if (draft.Id != id || draft.Model != model || draft.Revision.Value != revision || draft.Name != name)
            throw new InvalidDataException("The face catalog row does not match its checksummed snapshot.");
        return Result<FaceCatalogDraft>.Success(draft);
    }

    private static async Task<bool> IsModelAvailableAsync(SqliteConnection connection, SqliteTransaction transaction,
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
        IEnumerable<AssetId> assetIds, CancellationToken token)
    {
        foreach (var assetId in assetIds.Distinct())
        {
            await using var command = connection.CreateCommand();
            command.Transaction = transaction;
            command.CommandText = "SELECT 1 FROM assets WHERE asset_id=$id AND verification_state='available';";
            command.Parameters.AddWithValue("$id", assetId.ToString());
            if (await command.ExecuteScalarAsync(token).ConfigureAwait(false) is null) return false;
        }
        return true;
    }

    private static async Task ReplaceAssetReferencesAsync(SqliteConnection connection, SqliteTransaction transaction,
        FaceId faceId, IEnumerable<(FaceComponentId Id, AssetId Asset)> references, CancellationToken token)
    {
        await using (var delete = connection.CreateCommand())
        {
            delete.Transaction = transaction;
            delete.CommandText = "DELETE FROM asset_references WHERE owner_type=$owner AND owner_id=$id;";
            delete.Parameters.AddWithValue("$owner", AssetOwner);
            delete.Parameters.AddWithValue("$id", faceId.Value.ToString("D"));
            await delete.ExecuteNonQueryAsync(token).ConfigureAwait(false);
        }
        foreach (var (componentId, assetId) in references)
        {
            await using var insert = connection.CreateCommand();
            insert.Transaction = transaction;
            insert.CommandText = "INSERT INTO asset_references(owner_type,owner_id,slot,asset_id,created_utc_ms) VALUES($owner,$id,$slot,$asset,$created);";
            insert.Parameters.AddWithValue("$owner", AssetOwner);
            insert.Parameters.AddWithValue("$id", faceId.Value.ToString("D"));
            insert.Parameters.AddWithValue("$slot", componentId.ToString());
            insert.Parameters.AddWithValue("$asset", assetId.ToString());
            insert.Parameters.AddWithValue("$created", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            await insert.ExecuteNonQueryAsync(token).ConfigureAwait(false);
        }
    }

    private static Result<T> Failure<T>(ApplicationErrorCode code, string message, string? target = null) =>
        Result<T>.Failure(new ApplicationError(code, message, target));

    private enum SaveOutcome { Saved, Conflict, MissingDependencies }
}
