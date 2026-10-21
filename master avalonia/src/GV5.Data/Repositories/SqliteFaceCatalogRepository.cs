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
