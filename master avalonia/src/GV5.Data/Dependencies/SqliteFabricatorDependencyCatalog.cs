using GV5.Application.Contracts;
using GV5.Data.Storage;
using Microsoft.Data.Sqlite;

namespace GV5.Data.Dependencies;

/// <summary>Reports persisted model, pose and wardrobe dependents before destructive operations.</summary>
public sealed class SqliteFabricatorDependencyCatalog(IGv5Database database) : IFabricatorDependencyCatalog
{
    private readonly IGv5Database _database = database ?? throw new ArgumentNullException(nameof(database));

    public async Task<Result<FabricatorDeletionAssessment>> AssessDeletionAsync(
        FabricatorResourceReference resource, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(resource);
        try
        {
            await using var connection = await _database.OpenReadConnectionAsync(cancellationToken).ConfigureAwait(false);
            if (!await ResourceExistsAsync(connection, resource, cancellationToken).ConfigureAwait(false))
                return Result<FabricatorDeletionAssessment>.Failure(new ApplicationError(
                    ApplicationErrorCode.NotFound, "The Fabricator resource does not exist.", resource.Id.ToString("D")));

            await using var command = connection.CreateCommand();
            command.CommandText = resource.Kind switch
            {
                FabricatorResourceKind.Model => ModelUsagesSql,
                FabricatorResourceKind.Pose => PoseUsagesSql,
                FabricatorResourceKind.Wardrobe => WardrobeUsagesSql,
                _ => throw new ArgumentOutOfRangeException(nameof(resource))
            };
            command.Parameters.AddWithValue("$id", resource.Id.ToString("D"));
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            var usages = new List<FabricatorResourceUsage>();
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                usages.Add(new FabricatorResourceUsage(reader.GetString(0), reader.GetString(1), reader.GetString(2),
                    reader.IsDBNull(3) ? null : reader.GetString(3)));
            }
            return Result<FabricatorDeletionAssessment>.Success(new FabricatorDeletionAssessment(resource, usages.AsReadOnly()));
        }
        catch (Exception exception) when (exception is SqliteException or InvalidDataException or ArgumentException)
        {
            return Result<FabricatorDeletionAssessment>.Failure(new ApplicationError(
                ApplicationErrorCode.Persistence, "Fabricator dependents could not be verified.", resource.Id.ToString("D")));
        }
    }

    private static async Task<bool> ResourceExistsAsync(SqliteConnection connection, FabricatorResourceReference resource,
        CancellationToken cancellationToken)
    {
        var (table, idColumn) = resource.Kind switch
        {
            FabricatorResourceKind.Model => ("models", "model_id"),
            FabricatorResourceKind.Pose => ("pose_drafts", "pose_id"),
            FabricatorResourceKind.Wardrobe => ("wardrobe_drafts", "wardrobe_id"),
            _ => throw new ArgumentOutOfRangeException(nameof(resource))
        };
        await using var command = connection.CreateCommand();
        command.CommandText = $"SELECT 1 FROM {table} WHERE {idColumn} = $id;";
        command.Parameters.AddWithValue("$id", resource.Id.ToString("D"));
        return await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) is not null;
    }

    private const string ModelUsagesSql = """
        SELECT 'pose-draft' AS usage_type, pose_id AS owner_id, display_name AS owner_name, model_revision_id AS pinned_revision
        FROM pose_drafts WHERE model_id = $id
        UNION ALL
        SELECT 'pose-publication', pose_revision_id, display_name, model_revision_id
        FROM pose_revisions WHERE model_id = $id
        UNION ALL
        SELECT 'animation-draft', animation_id, display_name, model_revision_id
        FROM animation_drafts WHERE model_id = $id
        UNION ALL
        SELECT 'wardrobe-draft', wardrobe_id, display_name, model_revision_id
        FROM wardrobe_drafts WHERE model_id = $id
        UNION ALL
        SELECT 'wardrobe-publication', wardrobe_revision_id, display_name, model_revision_id
        FROM wardrobe_revisions WHERE model_id = $id
        ORDER BY usage_type, owner_name COLLATE NOCASE, owner_id;
        """;

    private const string PoseUsagesSql = """
        SELECT 'animation-draft' AS usage_type, animation_id AS owner_id, display_name AS owner_name, model_revision_id AS pinned_revision
        FROM animation_drafts
        WHERE CASE WHEN json_valid(animation_json) THEN json_extract(animation_json, '$.basePoseId') ELSE NULL END = $id
        UNION ALL
        SELECT 'animation-unverified', animation_id, display_name, model_revision_id
        FROM animation_drafts WHERE NOT json_valid(animation_json)
        ORDER BY usage_type, owner_name COLLATE NOCASE, owner_id;
        """;

    private const string WardrobeUsagesSql = """
        SELECT 'immutable-publication' AS usage_type, wardrobe_revision_id AS owner_id, display_name AS owner_name, model_revision_id AS pinned_revision
        FROM wardrobe_revisions WHERE wardrobe_id = $id
        ORDER BY revision;
        """;
}
