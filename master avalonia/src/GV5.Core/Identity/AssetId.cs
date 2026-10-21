namespace GV5.Core.Identity;

/// <summary>Stable identity for binary content managed by the G-V5 AssetStore.</summary>
public readonly record struct AssetId : IEntityId
{
    public Guid Value { get; }
    public bool IsValid => Value != Guid.Empty;

    private AssetId(Guid value) => Value = value;

    public static AssetId New() => new(Guid.NewGuid());
    public static AssetId From(Guid value) => new(IdValue.RequireValid(value, nameof(value)));
    public static AssetId Parse(string value) => new(IdValue.Parse(value, nameof(AssetId)));
    public static bool TryParse(string? value, out AssetId id) => IdValue.TryParse(value, static parsed => new AssetId(parsed), out id);
    public override string ToString() => Value.ToString("D");
}

/// <summary>Stable slot that owns one asset reference, independent of its physical storage path.</summary>
public readonly record struct AssetReferenceKey
{
    private AssetReferenceKey(string ownerType, Guid ownerId, string slot)
    {
        OwnerType = ownerType;
        OwnerId = ownerId;
        Slot = slot;
    }

    /// <summary>Namespaced, lowercase owner type, for example <c>fabricator.model-part</c>.</summary>
    public string OwnerType { get; }
    public Guid OwnerId { get; }
    /// <summary>Stable lowercase field/slot name, for example <c>sprite</c>.</summary>
    public string Slot { get; }

    public static AssetReferenceKey Create(string ownerType, Guid ownerId, string slot)
    {
        if (ownerId == Guid.Empty)
        {
            throw new ArgumentException("An asset reference requires a non-empty owner ID.", nameof(ownerId));
        }

        return new AssetReferenceKey(
            ValidateToken(ownerType, nameof(ownerType), 80),
            ownerId,
            ValidateToken(slot, nameof(slot), 64));
    }

    private static string ValidateToken(string value, string parameterName, int maximumLength)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(value, parameterName);
        var normalized = value.Trim();
        if (normalized.Length > maximumLength || !IsValidToken(normalized))
        {
            throw new ArgumentException("Reference keys use lowercase ASCII letters, digits, dots and hyphens, with alphanumeric ends.", parameterName);
        }

        return normalized;
    }

    private static bool IsValidToken(string value)
    {
        if (!IsAlphaNumeric(value[0]) || !IsAlphaNumeric(value[^1]))
        {
            return false;
        }

        var previousWasSeparator = false;
        foreach (var character in value)
        {
            if (IsAlphaNumeric(character))
            {
                previousWasSeparator = false;
                continue;
            }

            if (character is not ('.' or '-') || previousWasSeparator)
            {
                return false;
            }

            previousWasSeparator = true;
        }

        return true;
    }

    private static bool IsAlphaNumeric(char character) => character is >= 'a' and <= 'z' or >= '0' and <= '9';
}
