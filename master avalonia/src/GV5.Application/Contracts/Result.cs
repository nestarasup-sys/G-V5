namespace GV5.Application.Contracts;

/// <summary>A successful non-null value or one expected application error.</summary>
public sealed class Result<T>
{
    private readonly T? _value;

    private Result(T value) => _value = value;

    private Result(ApplicationError error) => Error = error;

    public bool IsSuccess => Error is null;
    public bool IsFailure => !IsSuccess;

    public T Value => IsSuccess
        ? _value!
        : throw new InvalidOperationException("A failed result has no value.");

    public ApplicationError? Error { get; }

    public static Result<T> Success(T value)
    {
        ArgumentNullException.ThrowIfNull(value);
        return new Result<T>(value);
    }

    public static Result<T> Failure(ApplicationError error)
    {
        ArgumentNullException.ThrowIfNull(error);
        return new Result<T>(error);
    }
}

/// <summary>Represents a command result that carries no data.</summary>
public readonly record struct Unit
{
    public static Unit Value => default;

    public override string ToString() => "()";
}
