using GV5.Core.Identity;

namespace GV5.Application.Contracts;

public enum FabricatorResourceKind
{
    Model = 1,
    Pose = 2,
    Wardrobe = 3,
    Hair = 4,
    Face = 5,
    FaceExpressionCollection = 6,
    FaceExpressionPreset = 7
}

/// <summary>Typed target for usage and deletion safety queries.</summary>
public sealed record FabricatorResourceReference
{
    private FabricatorResourceReference(FabricatorResourceKind kind, Guid id)
    {
        Kind = kind;
        Id = id;
    }

    public FabricatorResourceKind Kind { get; }
    public Guid Id { get; }

    public static FabricatorResourceReference For(ModelId id) => Create(FabricatorResourceKind.Model, id.Value, id.IsValid);
    public static FabricatorResourceReference For(PoseId id) => Create(FabricatorResourceKind.Pose, id.Value, id.IsValid);
    public static FabricatorResourceReference For(WardrobeId id) => Create(FabricatorResourceKind.Wardrobe, id.Value, id.IsValid);
    public static FabricatorResourceReference For(HairId id) => Create(FabricatorResourceKind.Hair, id.Value, id.IsValid);
    public static FabricatorResourceReference For(FaceId id) => Create(FabricatorResourceKind.Face, id.Value, id.IsValid);
    public static FabricatorResourceReference For(FaceExpressionCollectionId id) => Create(FabricatorResourceKind.FaceExpressionCollection, id.Value, id.IsValid);
    public static FabricatorResourceReference For(FaceExpressionPresetId id) => Create(FabricatorResourceKind.FaceExpressionPreset, id.Value, id.IsValid);

    private static FabricatorResourceReference Create(FabricatorResourceKind kind, Guid id, bool valid)
    {
        if (!valid || id == Guid.Empty) throw new ArgumentException("A deletion-safety query requires a valid resource ID.");
        return new FabricatorResourceReference(kind, id);
    }
}

public sealed record FabricatorResourceUsage(
    string UsageType,
    string OwnerId,
    string OwnerName,
    string? PinnedRevisionId = null);

public sealed record FabricatorDeletionAssessment(
    FabricatorResourceReference Resource,
    IReadOnlyList<FabricatorResourceUsage> Usages)
{
    /// <summary>Published history and explicit references block destructive removal.</summary>
    public bool IsBlocked => Usages.Count > 0;
}

/// <summary>Finds persisted dependents before UI or application services attempt a destructive delete.</summary>
public interface IFabricatorDependencyCatalog
{
    Task<Result<FabricatorDeletionAssessment>> AssessDeletionAsync(
        FabricatorResourceReference resource,
        CancellationToken cancellationToken = default);
}
