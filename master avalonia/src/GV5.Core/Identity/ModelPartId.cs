namespace GV5.Core.Identity;

/// <summary>Stable identity for one editable piece in a Fabricator model.</summary>
public readonly record struct ModelPartId : IEntityId
{
    public Guid Value { get; }
    public bool IsValid => Value != Guid.Empty;

    private ModelPartId(Guid value) => Value = value;

    public static ModelPartId New() => new(Guid.NewGuid());
    public static ModelPartId From(Guid value) => new(IdValue.RequireValid(value, nameof(value)));
    public static ModelPartId Parse(string value) => new(IdValue.Parse(value, nameof(ModelPartId)));
    public static bool TryParse(string? value, out ModelPartId id) =>
        IdValue.TryParse(value, static parsed => new ModelPartId(parsed), out id);

    public override string ToString() => Value.ToString("D");
}
