using System.Threading;
using GV5.Application.Contracts;

namespace GV5.Data.Diagnostics;

/// <summary>Propagates one opaque operation ID across awaited calls without storing user data.</summary>
public sealed class OperationCorrelationContext : IOperationCorrelationContext
{
    private readonly AsyncLocal<Guid?> _currentId = new();

    public Guid CurrentId => _currentId.Value ?? Guid.Empty;

    public IDisposable BeginScope(Guid? correlationId = null)
    {
        if (correlationId == Guid.Empty)
        {
            throw new ArgumentException("A supplied correlation ID must be non-empty.", nameof(correlationId));
        }

        var previous = _currentId.Value;
        var active = correlationId ?? previous ?? Guid.NewGuid();
        _currentId.Value = active;
        return new CorrelationScope(this, previous, active);
    }

    private void Restore(Guid? previous, Guid active)
    {
        if (_currentId.Value == active)
        {
            _currentId.Value = previous;
        }
    }

    private sealed class CorrelationScope(OperationCorrelationContext owner, Guid? previous, Guid active) : IDisposable
    {
        private OperationCorrelationContext? _owner = owner;

        public void Dispose() => Interlocked.Exchange(ref _owner, null)?.Restore(previous, active);
    }
}
