using GV5.Core.Identity;

namespace GV5.Core.Models;

/// <summary>A durable, replayable name edit captured before its model draft is committed.</summary>
public sealed record ModelDraftCheckpoint
{
    private ModelDraftCheckpoint(Guid checkpointId, ModelId modelId, Revision? expectedRevision, string name, long createdUtcMs)
    {
        CheckpointId = checkpointId;
        ModelId = modelId;
        ExpectedRevision = expectedRevision;
        Name = name;
        CreatedUtcMs = createdUtcMs;
    }

    public Guid CheckpointId { get; }
    public ModelId ModelId { get; }
    public Revision? ExpectedRevision { get; }
    public string Name { get; }
    public long CreatedUtcMs { get; }

    public static ModelDraftCheckpoint Create(ModelId modelId, Revision? expectedRevision, string name, long createdUtcMs) =>
        Restore(Guid.NewGuid(), modelId, expectedRevision, name, createdUtcMs);

    public static ModelDraftCheckpoint Create(Guid checkpointId, ModelId modelId, Revision? expectedRevision, string name, long createdUtcMs) =>
        Restore(checkpointId, modelId, expectedRevision, name, createdUtcMs);

    public static ModelDraftCheckpoint Restore(Guid checkpointId, ModelId modelId, Revision? expectedRevision, string name, long createdUtcMs)
    {
        if (checkpointId == Guid.Empty)
        {
            throw new ArgumentException("A checkpoint requires a stable ID.", nameof(checkpointId));
        }

        if (!modelId.IsValid)
        {
            throw new ArgumentException("A checkpoint requires a valid model ID.", nameof(modelId));
        }

        if (expectedRevision is { IsValid: false })
        {
            throw new ArgumentException("A checkpoint revision must be positive when present.", nameof(expectedRevision));
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var normalizedName = name.Trim();
        if (normalizedName.Length > 120)
        {
            throw new ArgumentOutOfRangeException(nameof(name), "A model name cannot exceed 120 characters.");
        }

        if (createdUtcMs < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(createdUtcMs), "Timestamps are non-negative Unix milliseconds.");
        }

        return new ModelDraftCheckpoint(checkpointId, modelId, expectedRevision, normalizedName, createdUtcMs);
    }
}
