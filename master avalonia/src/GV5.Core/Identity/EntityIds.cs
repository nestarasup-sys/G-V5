namespace GV5.Core.Identity;

/// <summary>Stable, strongly typed identifiers for persisted G-V5 entities.</summary>
public interface IEntityId
{
    Guid Value { get; }

    bool IsValid { get; }
}

public readonly record struct ModelId : IEntityId
{
    public Guid Value { get; }
    public bool IsValid => Value != Guid.Empty;

    private ModelId(Guid value) => Value = value;

    public static ModelId New() => new(Guid.NewGuid());
    public static ModelId From(Guid value) => new(IdValue.RequireValid(value, nameof(value)));
    public static ModelId Parse(string value) => new(IdValue.Parse(value, nameof(ModelId)));
    public static bool TryParse(string? value, out ModelId id) => IdValue.TryParse(value, static parsed => new ModelId(parsed), out id);
    public override string ToString() => Value.ToString("D");
}

public readonly record struct PoseId : IEntityId
{
    public Guid Value { get; }
    public bool IsValid => Value != Guid.Empty;

    private PoseId(Guid value) => Value = value;

    public static PoseId New() => new(Guid.NewGuid());
    public static PoseId From(Guid value) => new(IdValue.RequireValid(value, nameof(value)));
    public static PoseId Parse(string value) => new(IdValue.Parse(value, nameof(PoseId)));
    public static bool TryParse(string? value, out PoseId id) => IdValue.TryParse(value, static parsed => new PoseId(parsed), out id);
    public override string ToString() => Value.ToString("D");
}

public readonly record struct AnimationId : IEntityId
{
    public Guid Value { get; }
    public bool IsValid => Value != Guid.Empty;

    private AnimationId(Guid value) => Value = value;

    public static AnimationId New() => new(Guid.NewGuid());
    public static AnimationId From(Guid value) => new(IdValue.RequireValid(value, nameof(value)));
    public static AnimationId Parse(string value) => new(IdValue.Parse(value, nameof(AnimationId)));
    public static bool TryParse(string? value, out AnimationId id) => IdValue.TryParse(value, static parsed => new AnimationId(parsed), out id);
    public override string ToString() => Value.ToString("D");
}

public readonly record struct AnimationFrameId : IEntityId
{
    public Guid Value { get; }
    public bool IsValid => Value != Guid.Empty;

    private AnimationFrameId(Guid value) => Value = value;

    public static AnimationFrameId New() => new(Guid.NewGuid());
    public static AnimationFrameId From(Guid value) => new(IdValue.RequireValid(value, nameof(value)));
    public static AnimationFrameId Parse(string value) => new(IdValue.Parse(value, nameof(AnimationFrameId)));
    public static bool TryParse(string? value, out AnimationFrameId id) => IdValue.TryParse(value, static parsed => new AnimationFrameId(parsed), out id);
    public override string ToString() => Value.ToString("D");
}

public readonly record struct WardrobeId : IEntityId
{
    public Guid Value { get; }
    public bool IsValid => Value != Guid.Empty;

    private WardrobeId(Guid value) => Value = value;

    public static WardrobeId New() => new(Guid.NewGuid());
    public static WardrobeId From(Guid value) => new(IdValue.RequireValid(value, nameof(value)));
    public static WardrobeId Parse(string value) => new(IdValue.Parse(value, nameof(WardrobeId)));
    public static bool TryParse(string? value, out WardrobeId id) => IdValue.TryParse(value, static parsed => new WardrobeId(parsed), out id);
    public override string ToString() => Value.ToString("D");
}

public readonly record struct WardrobeComponentId : IEntityId
{
    public Guid Value { get; }
    public bool IsValid => Value != Guid.Empty;

    private WardrobeComponentId(Guid value) => Value = value;

    public static WardrobeComponentId New() => new(Guid.NewGuid());
    public static WardrobeComponentId From(Guid value) => new(IdValue.RequireValid(value, nameof(value)));
    public static WardrobeComponentId Parse(string value) => new(IdValue.Parse(value, nameof(WardrobeComponentId)));
    public static bool TryParse(string? value, out WardrobeComponentId id) => IdValue.TryParse(value, static parsed => new WardrobeComponentId(parsed), out id);
    public override string ToString() => Value.ToString("D");
}

public readonly record struct WardrobeRevisionId : IEntityId
{
    public Guid Value { get; }
    public bool IsValid => Value != Guid.Empty;

    private WardrobeRevisionId(Guid value) => Value = value;

    public static WardrobeRevisionId New() => new(Guid.NewGuid());
    public static WardrobeRevisionId From(Guid value) => new(IdValue.RequireValid(value, nameof(value)));
    public static WardrobeRevisionId Parse(string value) => new(IdValue.Parse(value, nameof(WardrobeRevisionId)));
    public static bool TryParse(string? value, out WardrobeRevisionId id) => IdValue.TryParse(value, static parsed => new WardrobeRevisionId(parsed), out id);
    public override string ToString() => Value.ToString("D");
}

public readonly record struct FaceId : IEntityId
{
    public Guid Value { get; }
    public bool IsValid => Value != Guid.Empty;

    private FaceId(Guid value) => Value = value;

    public static FaceId New() => new(Guid.NewGuid());
    public static FaceId From(Guid value) => new(IdValue.RequireValid(value, nameof(value)));
    public static FaceId Parse(string value) => new(IdValue.Parse(value, nameof(FaceId)));
    public static bool TryParse(string? value, out FaceId id) => IdValue.TryParse(value, static parsed => new FaceId(parsed), out id);
    public override string ToString() => Value.ToString("D");
}

public readonly record struct HairId : IEntityId
{
    public Guid Value { get; }
    public bool IsValid => Value != Guid.Empty;

    private HairId(Guid value) => Value = value;

    public static HairId New() => new(Guid.NewGuid());
    public static HairId From(Guid value) => new(IdValue.RequireValid(value, nameof(value)));
    public static HairId Parse(string value) => new(IdValue.Parse(value, nameof(HairId)));
    public static bool TryParse(string? value, out HairId id) => IdValue.TryParse(value, static parsed => new HairId(parsed), out id);
    public override string ToString() => Value.ToString("D");
}

public readonly record struct CharacterId : IEntityId
{
    public Guid Value { get; }
    public bool IsValid => Value != Guid.Empty;

    private CharacterId(Guid value) => Value = value;

    public static CharacterId New() => new(Guid.NewGuid());
    public static CharacterId From(Guid value) => new(IdValue.RequireValid(value, nameof(value)));
    public static CharacterId Parse(string value) => new(IdValue.Parse(value, nameof(CharacterId)));
    public static bool TryParse(string? value, out CharacterId id) => IdValue.TryParse(value, static parsed => new CharacterId(parsed), out id);
    public override string ToString() => Value.ToString("D");
}

public readonly record struct SceneId : IEntityId
{
    public Guid Value { get; }
    public bool IsValid => Value != Guid.Empty;

    private SceneId(Guid value) => Value = value;

    public static SceneId New() => new(Guid.NewGuid());
    public static SceneId From(Guid value) => new(IdValue.RequireValid(value, nameof(value)));
    public static SceneId Parse(string value) => new(IdValue.Parse(value, nameof(SceneId)));
    public static bool TryParse(string? value, out SceneId id) => IdValue.TryParse(value, static parsed => new SceneId(parsed), out id);
    public override string ToString() => Value.ToString("D");
}

public readonly record struct VideoId : IEntityId
{
    public Guid Value { get; }
    public bool IsValid => Value != Guid.Empty;

    private VideoId(Guid value) => Value = value;

    public static VideoId New() => new(Guid.NewGuid());
    public static VideoId From(Guid value) => new(IdValue.RequireValid(value, nameof(value)));
    public static VideoId Parse(string value) => new(IdValue.Parse(value, nameof(VideoId)));
    public static bool TryParse(string? value, out VideoId id) => IdValue.TryParse(value, static parsed => new VideoId(parsed), out id);
    public override string ToString() => Value.ToString("D");
}

public readonly record struct RoteiroId : IEntityId
{
    public Guid Value { get; }
    public bool IsValid => Value != Guid.Empty;

    private RoteiroId(Guid value) => Value = value;

    public static RoteiroId New() => new(Guid.NewGuid());
    public static RoteiroId From(Guid value) => new(IdValue.RequireValid(value, nameof(value)));
    public static RoteiroId Parse(string value) => new(IdValue.Parse(value, nameof(RoteiroId)));
    public static bool TryParse(string? value, out RoteiroId id) => IdValue.TryParse(value, static parsed => new RoteiroId(parsed), out id);
    public override string ToString() => Value.ToString("D");
}

/// <summary>A positive, monotonically increasing optimistic-concurrency revision.</summary>
public readonly record struct Revision : IComparable<Revision>
{
    public long Value { get; }
    public bool IsValid => Value > 0;

    private Revision(long value) => Value = value;

    public static Revision Initial { get; } = new(1);

    public static Revision From(long value) => value > 0
        ? new Revision(value)
        : throw new ArgumentOutOfRangeException(nameof(value), value, "A revision must be greater than zero.");

    public static bool TryFrom(long value, out Revision revision)
    {
        if (value > 0)
        {
            revision = new Revision(value);
            return true;
        }

        revision = default;
        return false;
    }

    public Revision Next()
    {
        if (!IsValid)
        {
            throw new InvalidOperationException("An uninitialized revision cannot be incremented.");
        }

        return From(checked(Value + 1));
    }

    public int CompareTo(Revision other) => Value.CompareTo(other.Value);

    public override string ToString() => Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
}

internal static class IdValue
{
    public static Guid RequireValid(Guid value, string parameterName) => value != Guid.Empty
        ? value
        : throw new ArgumentException("An entity ID cannot be empty.", parameterName);

    public static Guid Parse(string value, string idTypeName)
    {
        ArgumentNullException.ThrowIfNull(value);

        if (!Guid.TryParse(value, out var id) || id == Guid.Empty)
        {
            throw new FormatException($"'{value}' is not a valid non-empty {idTypeName}.");
        }

        return id;
    }

    public static bool TryParse<TId>(string? value, Func<Guid, TId> create, out TId id)
        where TId : struct, IEntityId
    {
        if (TryParse(value, out var parsed))
        {
            id = create(parsed);
            return true;
        }

        id = default;
        return false;
    }

    private static bool TryParse(string? value, out Guid id)
    {
        if (Guid.TryParse(value, out id) && id != Guid.Empty)
        {
            return true;
        }

        id = Guid.Empty;
        return false;
    }
}
