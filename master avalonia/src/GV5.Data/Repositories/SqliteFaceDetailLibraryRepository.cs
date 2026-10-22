using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Storage;
using Microsoft.Data.Sqlite;

namespace GV5.Data.Repositories;

/// <summary>Persists slot-scoped facial-detail libraries with checksums and safe asset references.</summary>
public sealed class SqliteFaceDetailLibraryRepository(IGv5Database database) : IFaceDetailLibraryRepository
{
    private const string AssetOwner = "fabricator.face-detail-library";
    private readonly IGv5Database _database = database ?? throw new ArgumentNullException(nameof(database));

    public async Task<Result<FaceDetailLibraryDraft>> CreateAsync(FaceDetailLibraryDraft draft,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(draft);
        if (draft.Revision != Revision.Initial)
            return Failure<FaceDetailLibraryDraft>(ApplicationErrorCode.Validation, "Uma nova biblioteca facial deve começar na revisão 1.");
        var encoded = FaceDetailLibrarySnapshotCodec.Encode(draft);
        try
        {
            var created = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                if (!await AreAssetsAvailableAsync(connection, transaction, draft.Assets.Select(asset => asset.AssetId), token).ConfigureAwait(false))
                    return false;
                await using var insert = connection.CreateCommand();
                insert.Transaction = transaction;
                insert.CommandText = "INSERT INTO face_detail_libraries(library_id,model_slot,revision,draft_json,draft_sha256,updated_utc_ms) VALUES($id,$slot,$revision,$json,$hash,$updated);";
                AddParameters(insert, draft, encoded.Json, encoded.Sha256);
                await insert.ExecuteNonQueryAsync(token).ConfigureAwait(false);
                await ReplaceAssetReferencesAsync(connection, transaction, draft,
                    draft.Assets.Select(asset => (asset.Id, asset.AssetId)), token).ConfigureAwait(false);
                return true;
            }, cancellationToken).ConfigureAwait(false);
            return created ? Result<FaceDetailLibraryDraft>.Success(draft)
                : Failure<FaceDetailLibraryDraft>(ApplicationErrorCode.NotFound, "Um asset da biblioteca facial não está disponível.");
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        { return Failure<FaceDetailLibraryDraft>(ApplicationErrorCode.Conflict, "Já existe uma biblioteca facial para esse slot ou a entrada viola uma restrição.", draft.ModelSlot.ToString()); }
        catch (SqliteException)
        { return Failure<FaceDetailLibraryDraft>(ApplicationErrorCode.Persistence, "Não foi possível criar a biblioteca facial.", draft.ModelSlot.ToString()); }
    }

    public async Task<Result<FaceDetailLibraryDraft>> GetAsync(ModelSlot modelSlot,
        CancellationToken cancellationToken = default)
    {
        if (!modelSlot.IsValid)
            return Failure<FaceDetailLibraryDraft>(ApplicationErrorCode.Validation, "O slot do modelo é inválido.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT draft_json,draft_sha256 FROM face_detail_libraries WHERE model_slot=$slot;";
            command.Parameters.AddWithValue("$slot", modelSlot.Value);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            return await reader.ReadAsync(cancellationToken).ConfigureAwait(false)
                ? Result<FaceDetailLibraryDraft>.Success(FaceDetailLibrarySnapshotCodec.Decode(reader.GetString(0), reader.GetString(1)))
                : Failure<FaceDetailLibraryDraft>(ApplicationErrorCode.NotFound, "A biblioteca facial desse slot ainda não existe.", modelSlot.ToString());
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or System.Text.Json.JsonException)
        { return Failure<FaceDetailLibraryDraft>(ApplicationErrorCode.Persistence, "A biblioteca facial não pôde ser verificada.", modelSlot.ToString()); }
    }

    public async Task<Result<FaceDetailLibraryDraft>> SaveAsync(FaceDetailLibraryDraft draft, Revision expectedRevision,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(draft);
        if (!expectedRevision.IsValid || draft.Revision.Value <= expectedRevision.Value)
            return Failure<FaceDetailLibraryDraft>(ApplicationErrorCode.Validation, "A revisão da biblioteca facial precisa avançar.", draft.ModelSlot.ToString());
        var encoded = FaceDetailLibrarySnapshotCodec.Encode(draft);
        try
        {
            var saved = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                if (!await AreAssetsAvailableAsync(connection, transaction, draft.Assets.Select(asset => asset.AssetId), token).ConfigureAwait(false))
                    return SaveOutcome.MissingAssets;
                await using var update = connection.CreateCommand();
                update.Transaction = transaction;
                update.CommandText = "UPDATE face_detail_libraries SET revision=$revision,draft_json=$json,draft_sha256=$hash,updated_utc_ms=$updated WHERE library_id=$id AND model_slot=$slot AND revision=$expected;";
                AddParameters(update, draft, encoded.Json, encoded.Sha256);
                update.Parameters.AddWithValue("$expected", expectedRevision.Value);
                if (await update.ExecuteNonQueryAsync(token).ConfigureAwait(false) != 1)
                {
                    await using var exists = connection.CreateCommand();
                    exists.Transaction = transaction;
                    exists.CommandText = "SELECT 1 FROM face_detail_libraries WHERE library_id=$id AND model_slot=$slot;";
                    exists.Parameters.AddWithValue("$id", draft.Id.ToString("D"));
                    exists.Parameters.AddWithValue("$slot", draft.ModelSlot.Value);
                    return await exists.ExecuteScalarAsync(token).ConfigureAwait(false) is null
                        ? SaveOutcome.NotFound : SaveOutcome.Conflict;
                }
                await ReplaceAssetReferencesAsync(connection, transaction, draft,
                    draft.Assets.Select(asset => (asset.Id, asset.AssetId)), token).ConfigureAwait(false);
                return SaveOutcome.Saved;
            }, cancellationToken).ConfigureAwait(false);
            return saved switch
            {
                SaveOutcome.Saved => Result<FaceDetailLibraryDraft>.Success(draft),
                SaveOutcome.MissingAssets => Failure<FaceDetailLibraryDraft>(ApplicationErrorCode.NotFound, "Um asset da biblioteca facial não está disponível.", draft.ModelSlot.ToString()),
                SaveOutcome.NotFound => Failure<FaceDetailLibraryDraft>(ApplicationErrorCode.NotFound, "A biblioteca facial desse slot não existe.", draft.ModelSlot.ToString()),
                _ => Failure<FaceDetailLibraryDraft>(ApplicationErrorCode.Conflict, "A biblioteca facial mudou em outro editor; a revisão salva foi preservada.", draft.ModelSlot.ToString())
            };
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or System.Text.Json.JsonException)
        { return Failure<FaceDetailLibraryDraft>(ApplicationErrorCode.Persistence, "Não foi possível salvar a biblioteca facial.", draft.ModelSlot.ToString()); }
    }

    private static void AddParameters(SqliteCommand command, FaceDetailLibraryDraft draft, string json, string hash)
    {
        command.Parameters.AddWithValue("$id", draft.Id.ToString("D"));
        command.Parameters.AddWithValue("$slot", draft.ModelSlot.Value);
        command.Parameters.AddWithValue("$revision", draft.Revision.Value);
        command.Parameters.AddWithValue("$json", json);
        command.Parameters.AddWithValue("$hash", hash);
        command.Parameters.AddWithValue("$updated", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
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
        FaceDetailLibraryDraft draft, IEnumerable<(FaceComponentId Id, AssetId Asset)> assets, CancellationToken token)
    {
        var current = assets.ToArray();
        var ownerId = draft.Id.ToString("D");
        var previous = new List<AssetId>();
        await using (var read = connection.CreateCommand())
        {
            read.Transaction = transaction;
            read.CommandText = "SELECT DISTINCT asset_id FROM asset_references WHERE owner_type=$owner AND owner_id=$id;";
            read.Parameters.AddWithValue("$owner", AssetOwner);
            read.Parameters.AddWithValue("$id", ownerId);
            await using var reader = await read.ExecuteReaderAsync(token).ConfigureAwait(false);
            while (await reader.ReadAsync(token).ConfigureAwait(false)) previous.Add(AssetId.Parse(reader.GetString(0)));
        }
        await using (var delete = connection.CreateCommand())
        {
            delete.Transaction = transaction;
            delete.CommandText = "DELETE FROM asset_references WHERE owner_type=$owner AND owner_id=$id;";
            delete.Parameters.AddWithValue("$owner", AssetOwner);
            delete.Parameters.AddWithValue("$id", ownerId);
            await delete.ExecuteNonQueryAsync(token).ConfigureAwait(false);
        }
        foreach (var (id, asset) in current)
        {
            await using var insert = connection.CreateCommand();
            insert.Transaction = transaction;
            insert.CommandText = "INSERT INTO asset_references(owner_type,owner_id,slot,asset_id,created_utc_ms) VALUES($owner,$id,$slot,$asset,$created);";
            insert.Parameters.AddWithValue("$owner", AssetOwner);
            insert.Parameters.AddWithValue("$id", ownerId);
            insert.Parameters.AddWithValue("$slot", id.ToString());
            insert.Parameters.AddWithValue("$asset", asset.ToString());
            insert.Parameters.AddWithValue("$created", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            await insert.ExecuteNonQueryAsync(token).ConfigureAwait(false);
            await using var gc = connection.CreateCommand();
            gc.Transaction = transaction;
            gc.CommandText = "DELETE FROM asset_gc_candidates WHERE asset_id=$asset;";
            gc.Parameters.AddWithValue("$asset", asset.ToString());
            await gc.ExecuteNonQueryAsync(token).ConfigureAwait(false);
        }
        foreach (var asset in previous.Except(current.Select(item => item.Asset).ToHashSet()))
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

    private static Result<T> Failure<T>(ApplicationErrorCode code, string message, string? target = null) =>
        Result<T>.Failure(new ApplicationError(code, message, target));

    private enum SaveOutcome { Saved, NotFound, Conflict, MissingAssets }
}
