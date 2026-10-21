using GV5.Application.Contracts;
using GV5.Core.Identity;
using GV5.Core.Models;
using GV5.Data.Storage;
using Microsoft.Data.Sqlite;

namespace GV5.Data.Repositories;

/// <summary>Persists model-pinned expression collections and checksummed preset snapshots.</summary>
public sealed class SqliteFaceExpressionRepository(IGv5Database database) : IFaceExpressionRepository
{
    private readonly IGv5Database _database = database ?? throw new ArgumentNullException(nameof(database));

    public async Task<Result<FaceExpressionCollection>> CreateCollectionAsync(FaceExpressionCollection collection,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(collection);
        if (collection.Revision != Revision.Initial)
            return Failure<FaceExpressionCollection>(ApplicationErrorCode.Validation, "Uma nova coleção de expressão deve começar na revisão 1.");
        try
        {
            var created = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                if (!await IsModelAvailableAsync(connection, transaction, collection.Model, token).ConfigureAwait(false)) return false;
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = "INSERT INTO face_expression_collections(collection_id,model_revision_id,model_revision_sequence,model_snapshot_sha256,model_id,revision,display_name,created_utc_ms,updated_utc_ms) VALUES($id,$model_revision,$sequence,$hash,$model,$revision,$name,$created,$updated);";
                AddCollectionParameters(command, collection);
                await command.ExecuteNonQueryAsync(token).ConfigureAwait(false);
                return true;
            }, cancellationToken).ConfigureAwait(false);
            return created ? Result<FaceExpressionCollection>.Success(collection)
                : Failure<FaceExpressionCollection>(ApplicationErrorCode.NotFound, "A revisão exata do modelo não está disponível.", collection.Id.ToString());
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        { return Failure<FaceExpressionCollection>(ApplicationErrorCode.Conflict, "A coleção de expressões já existe.", collection.Id.ToString()); }
        catch (Exception exception) when (exception is SqliteException or ArgumentException)
        { return Failure<FaceExpressionCollection>(ApplicationErrorCode.Persistence, "Não foi possível criar a coleção de expressões.", collection.Id.ToString()); }
    }

    public async Task<Result<FaceExpressionCollection>> GetCollectionAsync(FaceExpressionCollectionId id,
        CancellationToken cancellationToken = default)
    {
        if (!id.IsValid) return Failure<FaceExpressionCollection>(ApplicationErrorCode.Validation, "O ID da coleção é inválido.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = CollectionSelect + " WHERE collection_id=$id;";
            command.Parameters.AddWithValue("$id", id.ToString());
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            return await reader.ReadAsync(cancellationToken).ConfigureAwait(false)
                ? Result<FaceExpressionCollection>.Success(DecodeCollection(reader))
                : Failure<FaceExpressionCollection>(ApplicationErrorCode.NotFound, "A coleção de expressões não existe.", id.ToString());
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException)
        { return Failure<FaceExpressionCollection>(ApplicationErrorCode.Persistence, "A coleção de expressões não pôde ser lida.", id.ToString()); }
    }

    public async Task<Result<IReadOnlyList<FaceExpressionCollection>>> ListCollectionsAsync(ModelRevisionId modelRevisionId,
        CancellationToken cancellationToken = default)
    {
        if (!modelRevisionId.IsValid) return Failure<IReadOnlyList<FaceExpressionCollection>>(ApplicationErrorCode.Validation, "A revisão de modelo é inválida.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = CollectionSelect + " WHERE model_revision_id=$model_revision ORDER BY display_name COLLATE NOCASE,collection_id;";
            command.Parameters.AddWithValue("$model_revision", modelRevisionId.ToString());
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            var values = new List<FaceExpressionCollection>();
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false)) values.Add(DecodeCollection(reader));
            return Result<IReadOnlyList<FaceExpressionCollection>>.Success(values.AsReadOnly());
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException)
        { return Failure<IReadOnlyList<FaceExpressionCollection>>(ApplicationErrorCode.Persistence, "As coleções não puderam ser listadas.", modelRevisionId.ToString()); }
    }

    public async Task<Result<FaceExpressionCollection>> SaveCollectionAsync(FaceExpressionCollection collection,
        Revision expectedRevision, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(collection);
        if (!expectedRevision.IsValid || collection.Revision.Value <= expectedRevision.Value)
            return Failure<FaceExpressionCollection>(ApplicationErrorCode.Validation, "A revisão da coleção precisa avançar.", collection.Id.ToString());
        try
        {
            var saved = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                if (!await IsModelAvailableAsync(connection, transaction, collection.Model, token).ConfigureAwait(false)) return false;
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = "UPDATE face_expression_collections SET revision=$revision,display_name=$name,updated_utc_ms=$updated WHERE collection_id=$id AND model_revision_id=$model_revision AND model_revision_sequence=$sequence AND model_snapshot_sha256=$hash AND model_id=$model AND revision=$expected AND created_utc_ms=$created;";
                AddCollectionParameters(command, collection);
                command.Parameters.AddWithValue("$expected", expectedRevision.Value);
                return await command.ExecuteNonQueryAsync(token).ConfigureAwait(false) == 1;
            }, cancellationToken).ConfigureAwait(false);
            if (saved) return Result<FaceExpressionCollection>.Success(collection);
            var current = await GetCollectionAsync(collection.Id, cancellationToken).ConfigureAwait(false);
            return current.IsFailure ? current : Failure<FaceExpressionCollection>(ApplicationErrorCode.Conflict,
                "A coleção foi alterada em outro editor; a revisão salva foi preservada.", collection.Id.ToString());
        }
        catch (Exception exception) when (exception is SqliteException or ArgumentException)
        { return Failure<FaceExpressionCollection>(ApplicationErrorCode.Persistence, "Não foi possível salvar a coleção.", collection.Id.ToString()); }
    }

    public async Task<Result<bool>> DeleteCollectionAsync(FaceExpressionCollectionId id, Revision expectedRevision,
        CancellationToken cancellationToken = default)
    {
        if (!id.IsValid || !expectedRevision.IsValid)
            return Failure<bool>(ApplicationErrorCode.Validation, "O ID e a revisão da coleção são obrigatórios.");
        try
        {
            var deleted = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = "DELETE FROM face_expression_collections WHERE collection_id=$id AND revision=$revision;";
                command.Parameters.AddWithValue("$id", id.ToString());
                command.Parameters.AddWithValue("$revision", expectedRevision.Value);
                return await command.ExecuteNonQueryAsync(token).ConfigureAwait(false) == 1;
            }, cancellationToken).ConfigureAwait(false);
            if (deleted) return Result<bool>.Success(true);
            var current = await GetCollectionAsync(id, cancellationToken).ConfigureAwait(false);
            return current.IsFailure ? Failure<bool>(current.Error!.Code, current.Error.Message, current.Error.Target)
                : Failure<bool>(ApplicationErrorCode.Conflict, "A coleção foi alterada antes da exclusão.", id.ToString());
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        { return Failure<bool>(ApplicationErrorCode.Conflict, "A coleção possui expressões publicadas e não pode ser removida.", id.ToString()); }
        catch (SqliteException)
        { return Failure<bool>(ApplicationErrorCode.Persistence, "Não foi possível excluir a coleção.", id.ToString()); }
    }

    public async Task<Result<FaceExpressionPresetDraft>> CreatePresetAsync(FaceExpressionPresetDraft preset,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(preset);
        if (preset.Revision != Revision.Initial)
            return Failure<FaceExpressionPresetDraft>(ApplicationErrorCode.Validation, "Um novo preset deve começar na revisão 1.");
        var encoded = FaceExpressionSnapshotCodec.Encode(preset);
        try
        {
            var created = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                if (!await DependenciesMatchAsync(connection, transaction, preset, token).ConfigureAwait(false)) return false;
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = "INSERT INTO face_expression_presets(preset_id,collection_id,face_id,face_revision,revision,expression_index,display_name,draft_json,draft_sha256,updated_utc_ms) VALUES($id,$collection,$face,$face_revision,$revision,$index,$name,$json,$hash,$updated);";
                AddPresetParameters(command, preset, encoded.Json, encoded.Sha256);
                await command.ExecuteNonQueryAsync(token).ConfigureAwait(false);
                return true;
            }, cancellationToken).ConfigureAwait(false);
            return created ? Result<FaceExpressionPresetDraft>.Success(preset)
                : Failure<FaceExpressionPresetDraft>(ApplicationErrorCode.NotFound, "A coleção, revisão facial ou componente selecionado não está disponível.", preset.Id.ToString());
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        { return Failure<FaceExpressionPresetDraft>(ApplicationErrorCode.Conflict, "O ID ou índice de expressão já está ocupado nesta coleção.", preset.Id.ToString()); }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or System.Text.Json.JsonException)
        { return Failure<FaceExpressionPresetDraft>(ApplicationErrorCode.Persistence, "Não foi possível criar o preset.", preset.Id.ToString()); }
    }

    public async Task<Result<FaceExpressionPresetDraft>> GetPresetAsync(FaceExpressionPresetId id,
        CancellationToken cancellationToken = default)
    {
        if (!id.IsValid) return Failure<FaceExpressionPresetDraft>(ApplicationErrorCode.Validation, "O ID do preset é inválido.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = PresetSelect + " WHERE preset_id=$id;";
            command.Parameters.AddWithValue("$id", id.ToString());
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            return await reader.ReadAsync(cancellationToken).ConfigureAwait(false)
                ? Result<FaceExpressionPresetDraft>.Success(DecodePreset(reader))
                : Failure<FaceExpressionPresetDraft>(ApplicationErrorCode.NotFound, "O preset não existe.", id.ToString());
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or System.Text.Json.JsonException)
        { return Failure<FaceExpressionPresetDraft>(ApplicationErrorCode.Persistence, "O preset não pôde ser verificado.", id.ToString()); }
    }

    public async Task<Result<IReadOnlyList<FaceExpressionPresetDraft>>> ListPresetsAsync(FaceExpressionCollectionId collectionId,
        CancellationToken cancellationToken = default)
    {
        if (!collectionId.IsValid) return Failure<IReadOnlyList<FaceExpressionPresetDraft>>(ApplicationErrorCode.Validation, "O ID da coleção é inválido.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = PresetSelect + " WHERE collection_id=$collection ORDER BY expression_index,preset_id;";
            command.Parameters.AddWithValue("$collection", collectionId.ToString());
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            var values = new List<FaceExpressionPresetDraft>();
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false)) values.Add(DecodePreset(reader));
            return Result<IReadOnlyList<FaceExpressionPresetDraft>>.Success(values.AsReadOnly());
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or System.Text.Json.JsonException)
        { return Failure<IReadOnlyList<FaceExpressionPresetDraft>>(ApplicationErrorCode.Persistence, "Os presets não puderam ser listados.", collectionId.ToString()); }
    }

    public async Task<Result<FaceExpressionPresetDraft>> SavePresetAsync(FaceExpressionPresetDraft preset,
        Revision expectedRevision, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(preset);
        if (!expectedRevision.IsValid || preset.Revision.Value <= expectedRevision.Value)
            return Failure<FaceExpressionPresetDraft>(ApplicationErrorCode.Validation, "A revisão do preset precisa avançar.", preset.Id.ToString());
        var encoded = FaceExpressionSnapshotCodec.Encode(preset);
        try
        {
            var saved = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                if (!await DependenciesMatchAsync(connection, transaction, preset, token).ConfigureAwait(false)) return false;
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = "UPDATE face_expression_presets SET revision=$revision,expression_index=$index,display_name=$name,draft_json=$json,draft_sha256=$hash,updated_utc_ms=$updated WHERE preset_id=$id AND collection_id=$collection AND face_id=$face AND face_revision=$face_revision AND revision=$expected;";
                AddPresetParameters(command, preset, encoded.Json, encoded.Sha256);
                command.Parameters.AddWithValue("$expected", expectedRevision.Value);
                return await command.ExecuteNonQueryAsync(token).ConfigureAwait(false) == 1;
            }, cancellationToken).ConfigureAwait(false);
            if (saved) return Result<FaceExpressionPresetDraft>.Success(preset);
            var current = await GetPresetAsync(preset.Id, cancellationToken).ConfigureAwait(false);
            return current.IsFailure ? current : Failure<FaceExpressionPresetDraft>(ApplicationErrorCode.Conflict,
                "O preset foi alterado em outro editor; a revisão salva foi preservada.", preset.Id.ToString());
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        { return Failure<FaceExpressionPresetDraft>(ApplicationErrorCode.Conflict, "O índice já está ocupado nesta coleção.", preset.Id.ToString()); }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or System.Text.Json.JsonException)
        { return Failure<FaceExpressionPresetDraft>(ApplicationErrorCode.Persistence, "Não foi possível salvar o preset.", preset.Id.ToString()); }
    }

    public async Task<Result<bool>> DeletePresetAsync(FaceExpressionPresetId id, Revision expectedRevision,
        CancellationToken cancellationToken = default)
    {
        if (!id.IsValid || !expectedRevision.IsValid) return Failure<bool>(ApplicationErrorCode.Validation, "O ID e a revisão do preset são obrigatórios.");
        try
        {
            var deleted = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = "DELETE FROM face_expression_presets WHERE preset_id=$id AND revision=$revision;";
                command.Parameters.AddWithValue("$id", id.ToString());
                command.Parameters.AddWithValue("$revision", expectedRevision.Value);
                return await command.ExecuteNonQueryAsync(token).ConfigureAwait(false) == 1;
            }, cancellationToken).ConfigureAwait(false);
            if (deleted) return Result<bool>.Success(true);
            var current = await GetPresetAsync(id, cancellationToken).ConfigureAwait(false);
            return current.IsFailure ? Failure<bool>(current.Error!.Code, current.Error.Message, current.Error.Target)
                : Failure<bool>(ApplicationErrorCode.Conflict, "O preset foi alterado antes da exclusão.", id.ToString());
        }
        catch (SqliteException exception) when (exception.SqliteErrorCode == 19)
        { return Failure<bool>(ApplicationErrorCode.Conflict, "O preset possui revisões publicadas e não pode ser removido.", id.ToString()); }
        catch (SqliteException)
        { return Failure<bool>(ApplicationErrorCode.Persistence, "Não foi possível excluir o preset.", id.ToString()); }
    }

    public async Task<Result<PublishedFaceExpressionRevision>> PublishPresetAsync(FaceExpressionPresetId id,
        Revision expectedDraftRevision, long publishedUtcMs, CancellationToken cancellationToken = default)
    {
        if (!id.IsValid || !expectedDraftRevision.IsValid || publishedUtcMs < 0)
            return Failure<PublishedFaceExpressionRevision>(ApplicationErrorCode.Validation, "Os dados de publicação da expressão são inválidos.");
        try
        {
            var outcome = await _database.ExecuteWriteAsync(async (connection, transaction, token) =>
            {
                await using var draftCommand = connection.CreateCommand();
                draftCommand.Transaction = transaction;
                draftCommand.CommandText = PresetSelect + " WHERE preset_id=$id;";
                draftCommand.Parameters.AddWithValue("$id", id.ToString());
                FaceExpressionPresetDraft preset;
                await using (var reader = await draftCommand.ExecuteReaderAsync(token).ConfigureAwait(false))
                {
                    if (!await reader.ReadAsync(token).ConfigureAwait(false)) return PublishOutcome.NotFound;
                    preset = DecodePreset(reader);
                }
                if (preset.Revision != expectedDraftRevision) return PublishOutcome.Conflict;
                if (!await DependenciesMatchAsync(connection, transaction, preset, token).ConfigureAwait(false))
                    return PublishOutcome.MissingDependencies;

                await using var faceCommand = connection.CreateCommand();
                faceCommand.Transaction = transaction;
                faceCommand.CommandText = "SELECT face_revision_id,revision,draft_revision FROM face_revisions WHERE face_id=$face ORDER BY revision DESC LIMIT 1;";
                faceCommand.Parameters.AddWithValue("$face", preset.FaceId.ToString());
                FaceRevisionId faceRevisionId;
                Revision faceDraftRevision;
                await using (var reader = await faceCommand.ExecuteReaderAsync(token).ConfigureAwait(false))
                {
                    if (!await reader.ReadAsync(token).ConfigureAwait(false)) return PublishOutcome.FaceNotPublished;
                    faceRevisionId = FaceRevisionId.Parse(reader.GetString(0));
                    faceDraftRevision = Revision.From(reader.GetInt64(2));
                }
                if (preset.FaceRevision != faceDraftRevision) return PublishOutcome.FaceStale;

                await using var latest = connection.CreateCommand();
                latest.Transaction = transaction;
                latest.CommandText = PublishedSelect + " WHERE r.preset_id=$id ORDER BY r.revision DESC LIMIT 1;";
                latest.Parameters.AddWithValue("$id", id.ToString());
                await using (var reader = await latest.ExecuteReaderAsync(token).ConfigureAwait(false))
                {
                    if (await reader.ReadAsync(token).ConfigureAwait(false))
                    {
                        var prior = DecodePublication(reader);
                        if (prior.DraftRevision == expectedDraftRevision && prior.FaceRevisionId == faceRevisionId)
                            return PublishOutcome.Success with { Publication = prior };
                    }
                }
                await using var sequenceCommand = connection.CreateCommand();
                sequenceCommand.Transaction = transaction;
                sequenceCommand.CommandText = "SELECT COALESCE(MAX(revision),0)+1 FROM face_expression_revisions WHERE preset_id=$id;";
                sequenceCommand.Parameters.AddWithValue("$id", id.ToString());
                var sequence = Revision.From(Convert.ToInt64(await sequenceCommand.ExecuteScalarAsync(token).ConfigureAwait(false)));
                var publicationId = FaceExpressionRevisionId.New();
                var encoded = FaceExpressionSnapshotCodec.Encode(preset);
                var publication = PublishedFaceExpressionRevision.Restore(publicationId, preset.Id, faceRevisionId,
                    sequence, preset.Revision, publishedUtcMs, encoded.Sha256, preset);
                await using var insert = connection.CreateCommand();
                insert.Transaction = transaction;
                insert.CommandText = "INSERT INTO face_expression_revisions(expression_revision_id,preset_id,face_revision_id,revision,draft_revision,published_utc_ms,snapshot_json,snapshot_sha256) VALUES($id,$preset,$face_revision,$revision,$draft_revision,$published,$json,$hash);";
                insert.Parameters.AddWithValue("$id", publicationId.ToString());
                insert.Parameters.AddWithValue("$preset", id.ToString());
                insert.Parameters.AddWithValue("$face_revision", faceRevisionId.ToString());
                insert.Parameters.AddWithValue("$revision", sequence.Value);
                insert.Parameters.AddWithValue("$draft_revision", preset.Revision.Value);
                insert.Parameters.AddWithValue("$published", publishedUtcMs);
                insert.Parameters.AddWithValue("$json", encoded.Json);
                insert.Parameters.AddWithValue("$hash", encoded.Sha256);
                await insert.ExecuteNonQueryAsync(token).ConfigureAwait(false);
                return PublishOutcome.Success with { Publication = publication };
            }, cancellationToken).ConfigureAwait(false);
            return outcome.Status switch
            {
                PublishStatus.Success => Result<PublishedFaceExpressionRevision>.Success(outcome.Publication!),
                PublishStatus.NotFound => Failure<PublishedFaceExpressionRevision>(ApplicationErrorCode.NotFound, "O preset de expressão não existe.", id.ToString()),
                PublishStatus.Conflict => Failure<PublishedFaceExpressionRevision>(ApplicationErrorCode.Conflict, "O preset mudou antes da publicação.", id.ToString()),
                PublishStatus.FaceNotPublished => Failure<PublishedFaceExpressionRevision>(ApplicationErrorCode.NotFound, "Publique primeiro o catálogo facial deste preset.", id.ToString()),
                PublishStatus.FaceStale => Failure<PublishedFaceExpressionRevision>(ApplicationErrorCode.Conflict, "Publique a revisão facial atual antes de publicar esta expressão.", id.ToString()),
                _ => Failure<PublishedFaceExpressionRevision>(ApplicationErrorCode.NotFound, "A coleção, catálogo facial ou um componente selecionado não está disponível.", id.ToString())
            };
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or System.Text.Json.JsonException or OverflowException)
        { return Failure<PublishedFaceExpressionRevision>(ApplicationErrorCode.Persistence, "Não foi possível publicar a expressão.", id.ToString()); }
    }

    public async Task<Result<IReadOnlyList<PublishedFaceExpressionRevision>>> ListPublishedPresetsAsync(
        FaceExpressionPresetId id, CancellationToken cancellationToken = default)
    {
        if (!id.IsValid) return Failure<IReadOnlyList<PublishedFaceExpressionRevision>>(ApplicationErrorCode.Validation, "O ID do preset é inválido.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = PublishedSelect + " WHERE r.preset_id=$id ORDER BY r.revision DESC;";
            command.Parameters.AddWithValue("$id", id.ToString());
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            var items = new List<PublishedFaceExpressionRevision>();
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false)) items.Add(DecodePublication(reader));
            return Result<IReadOnlyList<PublishedFaceExpressionRevision>>.Success(items.AsReadOnly());
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or System.Text.Json.JsonException)
        { return Failure<IReadOnlyList<PublishedFaceExpressionRevision>>(ApplicationErrorCode.Persistence, "As revisões de expressão não puderam ser verificadas.", id.ToString()); }
    }

    public async Task<Result<PublishedFaceExpressionRevision>> GetPublishedPresetAsync(FaceExpressionPresetId id,
        Revision revision, CancellationToken cancellationToken = default)
    {
        if (!id.IsValid || !revision.IsValid)
            return Failure<PublishedFaceExpressionRevision>(ApplicationErrorCode.Validation, "O ID e a revisão da expressão são obrigatórios.");
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var command = connection.CreateCommand();
            command.CommandText = PublishedSelect + " WHERE r.preset_id=$id AND r.revision=$revision;";
            command.Parameters.AddWithValue("$id", id.ToString());
            command.Parameters.AddWithValue("$revision", revision.Value);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            return await reader.ReadAsync(cancellationToken).ConfigureAwait(false)
                ? Result<PublishedFaceExpressionRevision>.Success(DecodePublication(reader))
                : Failure<PublishedFaceExpressionRevision>(ApplicationErrorCode.NotFound, "A revisão publicada da expressão não existe.", id.ToString());
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException or System.Text.Json.JsonException)
        { return Failure<PublishedFaceExpressionRevision>(ApplicationErrorCode.Persistence, "A revisão publicada da expressão não pôde ser verificada.", id.ToString()); }
    }

    private static PublishedFaceExpressionRevision DecodePublication(SqliteDataReader reader)
    {
        var id = FaceExpressionRevisionId.Parse(reader.GetString(0));
        var presetId = FaceExpressionPresetId.Parse(reader.GetString(1));
        var faceRevisionId = FaceRevisionId.Parse(reader.GetString(2));
        var pinnedFaceId = FaceId.Parse(reader.GetString(3));
        var pinnedFaceDraftRevision = Revision.From(reader.GetInt64(4));
        var pinnedModel = ModelRevisionReference.Restore(ModelId.Parse(reader.GetString(6)),
            ModelRevisionId.Parse(reader.GetString(5)), Revision.From(reader.GetInt64(7)), reader.GetString(8));
        var revision = Revision.From(reader.GetInt64(9));
        var draftRevision = Revision.From(reader.GetInt64(10));
        var published = reader.GetInt64(11);
        var hash = reader.GetString(12);
        var snapshot = FaceExpressionSnapshotCodec.Decode(reader.GetString(13), hash);
        if (snapshot.FaceId != pinnedFaceId || snapshot.FaceRevision != pinnedFaceDraftRevision)
            throw new InvalidDataException("The published expression does not match its immutable face revision.");
        if (snapshot.Model != pinnedModel)
            throw new InvalidDataException("The published expression does not match its immutable model revision.");
        return PublishedFaceExpressionRevision.Restore(id, presetId, faceRevisionId, revision,
            draftRevision, published, hash, snapshot);
    }

    private const string PublishedSelect = "SELECT r.expression_revision_id,r.preset_id,r.face_revision_id,f.face_id,f.draft_revision,f.model_revision_id,f.model_id,m.revision,m.snapshot_sha256,r.revision,r.draft_revision,r.published_utc_ms,r.snapshot_sha256,r.snapshot_json FROM face_expression_revisions r JOIN face_revisions f ON f.face_revision_id=r.face_revision_id JOIN model_revisions m ON m.revision_id=f.model_revision_id";

    private enum PublishStatus { Success, NotFound, Conflict, MissingDependencies, FaceNotPublished, FaceStale }
    private sealed record PublishOutcome(PublishStatus Status, PublishedFaceExpressionRevision? Publication = null)
    {
        public static PublishOutcome NotFound => new(PublishStatus.NotFound);
        public static PublishOutcome Conflict => new(PublishStatus.Conflict);
        public static PublishOutcome MissingDependencies => new(PublishStatus.MissingDependencies);
        public static PublishOutcome FaceNotPublished => new(PublishStatus.FaceNotPublished);
        public static PublishOutcome FaceStale => new(PublishStatus.FaceStale);
        public static PublishOutcome Success => new(PublishStatus.Success);
    }

    private const string CollectionSelect = "SELECT collection_id,model_revision_id,model_revision_sequence,model_snapshot_sha256,model_id,revision,display_name,created_utc_ms,updated_utc_ms FROM face_expression_collections";
    private const string PresetSelect = "SELECT preset_id,collection_id,face_id,face_revision,revision,expression_index,display_name,draft_json,draft_sha256 FROM face_expression_presets";

    private static void AddCollectionParameters(SqliteCommand command, FaceExpressionCollection collection)
    {
        command.Parameters.AddWithValue("$id", collection.Id.ToString());
        command.Parameters.AddWithValue("$model_revision", collection.Model.RevisionId.ToString());
        command.Parameters.AddWithValue("$sequence", collection.Model.Sequence.Value);
        command.Parameters.AddWithValue("$hash", collection.Model.SnapshotSha256);
        command.Parameters.AddWithValue("$model", collection.Model.ModelId.ToString());
        command.Parameters.AddWithValue("$revision", collection.Revision.Value);
        command.Parameters.AddWithValue("$name", collection.Name);
        command.Parameters.AddWithValue("$created", collection.CreatedUtcMs);
        command.Parameters.AddWithValue("$updated", collection.UpdatedUtcMs);
    }

    private static void AddPresetParameters(SqliteCommand command, FaceExpressionPresetDraft preset, string json, string hash)
    {
        command.Parameters.AddWithValue("$id", preset.Id.ToString());
        command.Parameters.AddWithValue("$collection", preset.CollectionId.ToString());
        command.Parameters.AddWithValue("$face", preset.FaceId.ToString());
        command.Parameters.AddWithValue("$face_revision", preset.FaceRevision.Value);
        command.Parameters.AddWithValue("$revision", preset.Revision.Value);
        command.Parameters.AddWithValue("$index", preset.ExpressionIndex);
        command.Parameters.AddWithValue("$name", preset.Name);
        command.Parameters.AddWithValue("$json", json);
        command.Parameters.AddWithValue("$hash", hash);
        command.Parameters.AddWithValue("$updated", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }

    private static FaceExpressionCollection DecodeCollection(SqliteDataReader reader)
    {
        var model = ModelRevisionReference.Restore(ModelId.Parse(reader.GetString(4)),
            ModelRevisionId.Parse(reader.GetString(1)), Revision.From(reader.GetInt64(2)), reader.GetString(3));
        return FaceExpressionCollection.Restore(FaceExpressionCollectionId.Parse(reader.GetString(0)), model,
            Revision.From(reader.GetInt64(5)), reader.GetString(6), reader.GetInt64(7), reader.GetInt64(8));
    }

    private static FaceExpressionPresetDraft DecodePreset(SqliteDataReader reader)
    {
        var preset = FaceExpressionSnapshotCodec.Decode(reader.GetString(7), reader.GetString(8));
        if (preset.Id != FaceExpressionPresetId.Parse(reader.GetString(0))
            || preset.CollectionId != FaceExpressionCollectionId.Parse(reader.GetString(1))
            || preset.FaceId != FaceId.Parse(reader.GetString(2)) || preset.FaceRevision.Value != reader.GetInt64(3)
            || preset.Revision.Value != reader.GetInt64(4) || preset.ExpressionIndex != reader.GetInt32(5)
            || preset.Name != reader.GetString(6))
            throw new InvalidDataException("The expression preset row does not match its checksummed snapshot.");
        return preset;
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

    private static async Task<bool> DependenciesMatchAsync(SqliteConnection connection, SqliteTransaction transaction,
        FaceExpressionPresetDraft preset, CancellationToken token)
    {
        await using (var collection = connection.CreateCommand())
        {
            collection.Transaction = transaction;
            collection.CommandText = "SELECT 1 FROM face_expression_collections WHERE collection_id=$id AND model_revision_id=$model_revision AND model_revision_sequence=$sequence AND model_snapshot_sha256=$hash AND model_id=$model;";
            collection.Parameters.AddWithValue("$id", preset.CollectionId.ToString());
            collection.Parameters.AddWithValue("$model_revision", preset.Model.RevisionId.ToString());
            collection.Parameters.AddWithValue("$sequence", preset.Model.Sequence.Value);
            collection.Parameters.AddWithValue("$hash", preset.Model.SnapshotSha256);
            collection.Parameters.AddWithValue("$model", preset.Model.ModelId.ToString());
            if (await collection.ExecuteScalarAsync(token).ConfigureAwait(false) is null) return false;
        }
        await using var face = connection.CreateCommand();
        face.Transaction = transaction;
        face.CommandText = "SELECT model_revision_id,model_revision_sequence,model_snapshot_sha256,model_id,revision,draft_json,draft_sha256 FROM face_catalog_drafts WHERE face_id=$face;";
        face.Parameters.AddWithValue("$face", preset.FaceId.ToString());
        await using var reader = await face.ExecuteReaderAsync(token).ConfigureAwait(false);
        if (!await reader.ReadAsync(token).ConfigureAwait(false)) return false;
        var faceModel = ModelRevisionReference.Restore(ModelId.Parse(reader.GetString(3)), ModelRevisionId.Parse(reader.GetString(0)),
            Revision.From(reader.GetInt64(1)), reader.GetString(2));
        var catalog = FaceCatalogSnapshotCodec.Decode(reader.GetString(5), reader.GetString(6));
        if (faceModel != preset.Model || catalog.Model != preset.Model || catalog.Id != preset.FaceId
            || catalog.Revision != preset.FaceRevision) return false;
        _ = FaceAssembly.Restore(catalog, preset.Selections, preset.EyeSidesLinked,
            preset.EyebrowSidesLinked, preset.EyeMode, preset.MouthMode);
        return true;
    }

    private static Result<T> Failure<T>(ApplicationErrorCode code, string message, string? target = null) =>
        Result<T>.Failure(new ApplicationError(code, message, target));
}
