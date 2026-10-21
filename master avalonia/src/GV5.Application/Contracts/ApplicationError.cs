namespace GV5.Application.Contracts;

/// <summary>Expected, user-actionable failures returned by application use cases.</summary>
public sealed record ApplicationError
{
    public ApplicationErrorCode Code { get; }
    public string Message { get; }
    public string? Target { get; }

    public ApplicationError(ApplicationErrorCode code, string message, string? target = null)
    {
        if (!Enum.IsDefined(code))
        {
            throw new ArgumentOutOfRangeException(nameof(code), code, "The error code is not supported.");
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(message);

        Code = code;
        Message = message;
        Target = target;
    }
}

/// <summary>Stable categories for expected application failures.</summary>
public enum ApplicationErrorCode
{
    Validation = 1,
    NotFound = 2,
    Conflict = 3,
    Persistence = 4,
    Unavailable = 5
}
