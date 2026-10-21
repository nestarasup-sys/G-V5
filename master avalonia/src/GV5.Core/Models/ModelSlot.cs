namespace GV5.Core.Models;

/// <summary>A one-based legacy-compatible Fabricator model slot (1 through 10).</summary>
public readonly record struct ModelSlot : IComparable<ModelSlot>
{
    public const int Minimum = 1;
    public const int Maximum = 10;

    public int Value { get; }
    public bool IsValid => Value is >= Minimum and <= Maximum;

    private ModelSlot(int value) => Value = value;

    public static ModelSlot From(int value) => value is >= Minimum and <= Maximum
        ? new ModelSlot(value)
        : throw new ArgumentOutOfRangeException(nameof(value), value, $"A model slot must be between {Minimum} and {Maximum}.");

    public static bool TryFrom(int value, out ModelSlot slot)
    {
        if (value is >= Minimum and <= Maximum)
        {
            slot = new ModelSlot(value);
            return true;
        }

        slot = default;
        return false;
    }

    public int CompareTo(ModelSlot other) => Value.CompareTo(other.Value);
    public override string ToString() => Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
}
