using GV5.Core.Identity;

namespace GV5.Core.Models;

/// <summary>A named, model-revision-scoped group of expression preset drafts.</summary>
public sealed record FaceExpressionCollection
{
    private FaceExpressionCollection(FaceExpressionCollectionId id, ModelRevisionReference model,
        Revision revision, string name, long createdUtcMs, long updatedUtcMs)
    {
        Id = id;
        Model = model;
        Revision = revision;
        Name = name;
        CreatedUtcMs = createdUtcMs;
        UpdatedUtcMs = updatedUtcMs;
    }

    public FaceExpressionCollectionId Id { get; }
    public ModelRevisionReference Model { get; }
    public Revision Revision { get; }
    public string Name { get; }
    public long CreatedUtcMs { get; }
    public long UpdatedUtcMs { get; }

    public static FaceExpressionCollection Create(ModelRevisionReference model, string name, long createdUtcMs) =>
        Restore(FaceExpressionCollectionId.New(), model, Revision.Initial, name, createdUtcMs, createdUtcMs);

    public static FaceExpressionCollection Restore(FaceExpressionCollectionId id, ModelRevisionReference model,
        Revision revision, string name, long createdUtcMs, long updatedUtcMs)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var normalized = name.Trim();
        if (!id.IsValid || !revision.IsValid) throw new ArgumentException("Expression collection identity and revision must be valid.");
        if (normalized.Length > 80) throw new ArgumentOutOfRangeException(nameof(name));
        if (createdUtcMs < 0 || updatedUtcMs < createdUtcMs) throw new ArgumentOutOfRangeException(nameof(updatedUtcMs));
        return new FaceExpressionCollection(id, model, revision, normalized, createdUtcMs, updatedUtcMs);
    }

    public FaceExpressionCollection WithName(string name, long updatedUtcMs)
    {
        if (updatedUtcMs < UpdatedUtcMs) throw new ArgumentOutOfRangeException(nameof(updatedUtcMs));
        return Restore(Id, Model, Revision.Next(), name, CreatedUtcMs, updatedUtcMs);
    }
}
