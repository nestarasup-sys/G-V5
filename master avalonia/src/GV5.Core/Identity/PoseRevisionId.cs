namespace GV5.Core.Identity;

/// <summary>Stable identity of one immutable published pose revision.</summary>
public readonly record struct PoseRevisionId : IEntityId
{
    public Guid Value { get; }
    public bool IsValid => Value != Guid.Empty;

    private PoseRevisionId(Guid value) => Value = value;

    public static PoseRevisionId New() => new(Guid.NewGuid());
    public static PoseRevisionId From(Guid value) => new(IdValue.RequireValid(value, nameof(value)));
    public static PoseRevisionId Parse(string value) => new(IdValue.Parse(value, nameof(PoseRevisionId)));
    public override string ToString() => Value.ToString("D");
}
