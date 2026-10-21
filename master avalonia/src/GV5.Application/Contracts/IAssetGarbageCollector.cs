namespace GV5.Application.Contracts;

public sealed record AssetGarbageCollectionPolicy
{
    public TimeSpan UnreferencedGracePeriod { get; }
    public TimeSpan TrashRetention { get; }

    private AssetGarbageCollectionPolicy(TimeSpan unreferencedGracePeriod, TimeSpan trashRetention)
    {
        UnreferencedGracePeriod = unreferencedGracePeriod;
        TrashRetention = trashRetention;
    }

    public static AssetGarbageCollectionPolicy Create(TimeSpan unreferencedGracePeriod, TimeSpan trashRetention)
    {
        if (unreferencedGracePeriod < TimeSpan.Zero || trashRetention < TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(unreferencedGracePeriod), "Asset garbage collection durations cannot be negative.");
        }

        return new AssetGarbageCollectionPolicy(unreferencedGracePeriod, trashRetention);
    }
}

public sealed record AssetGarbageCollectionReport(
    int CandidatesTracked,
    int AssetsMovedToTrash,
    int TrashFilesPurged,
    string? VerifiedBackupDirectory);

/// <summary>Moves only unreferenced assets to recoverable trash after a verified full backup.</summary>
public interface IAssetGarbageCollector
{
    Task<Result<AssetGarbageCollectionReport>> CollectAsync(
        AssetGarbageCollectionPolicy policy,
        CancellationToken cancellationToken = default);
}
