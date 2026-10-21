using GV5.Core.Identity;

namespace GV5.Core.Models;

/// <summary>Editable model metadata. Geometry and parts are persisted as owned child entities separately.</summary>
public sealed record ModelDraft
{
    private ModelDraft(ModelId id, Revision revision, string name, long createdUtcMs, long updatedUtcMs)
    {
        Id = id;
        Revision = revision;
        Name = name;
        CreatedUtcMs = createdUtcMs;
        UpdatedUtcMs = updatedUtcMs;
    }

    public ModelId Id { get; }
    public Revision Revision { get; }
    public string Name { get; }
    public long CreatedUtcMs { get; }
    public long UpdatedUtcMs { get; }

    public static ModelDraft Create(string name, long nowUtcMs) => Create(ModelId.New(), name, nowUtcMs);

    public static ModelDraft Create(ModelId id, string name, long nowUtcMs)
    {
        if (!id.IsValid)
        {
            throw new ArgumentException("A model draft requires a valid stable ID.", nameof(id));
        }

        ValidateTimestamp(nowUtcMs);
        return new ModelDraft(id, Revision.Initial, NormalizeName(name), nowUtcMs, nowUtcMs);
    }

    public static ModelDraft Restore(ModelId id, Revision revision, string name, long createdUtcMs, long updatedUtcMs)
    {
        if (!id.IsValid)
        {
            throw new ArgumentException("A model draft requires a valid stable ID.", nameof(id));
        }
        if (!revision.IsValid)
        {
            throw new ArgumentException("A model draft requires a positive revision.", nameof(revision));
        }

        var normalizedName = NormalizeName(name);
        ValidateTimestamp(createdUtcMs);
        ValidateTimestamp(updatedUtcMs);
        if (updatedUtcMs < createdUtcMs)
        {
            throw new ArgumentOutOfRangeException(nameof(updatedUtcMs), "Updated time cannot precede creation time.");
        }

        return new ModelDraft(id, revision, normalizedName, createdUtcMs, updatedUtcMs);
    }

    public ModelDraft Rename(string name, long updatedUtcMs)
    {
        ValidateTimestamp(updatedUtcMs);
        if (updatedUtcMs < UpdatedUtcMs)
        {
            throw new ArgumentOutOfRangeException(nameof(updatedUtcMs), "An edit cannot move the updated time backwards.");
        }

        var normalizedName = NormalizeName(name);
        return string.Equals(Name, normalizedName, StringComparison.Ordinal)
            ? this
            : new ModelDraft(Id, Revision.Next(), normalizedName, CreatedUtcMs, updatedUtcMs);
    }

    private static string NormalizeName(string name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var normalized = name.Trim();
        if (normalized.Length > 120)
        {
            throw new ArgumentOutOfRangeException(nameof(name), "A model name cannot exceed 120 characters.");
        }

        return normalized;
    }

    private static long ValidateTimestamp(long timestamp) => timestamp >= 0
        ? timestamp
        : throw new ArgumentOutOfRangeException(nameof(timestamp), "Timestamps are non-negative Unix milliseconds.");
}
