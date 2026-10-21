namespace GV5.Core.Identity;

/// <summary>Stable identity of one immutable published model revision.</summary>
public readonly record struct ModelRevisionId : IEntityId
{
    public Guid Value { get; }
    public bool IsValid => Value != Guid.Empty;

    private ModelRevisionId(Guid value) => Value = value;

    public static ModelRevisionId New() => new(Guid.NewGuid());
    public static ModelRevisionId From(Guid value) => new(IdValue.RequireValid(value, nameof(value)));
    public static ModelRevisionId Parse(string value) => new(IdValue.Parse(value, nameof(ModelRevisionId)));
    public override string ToString() => Value.ToString("D");
}
