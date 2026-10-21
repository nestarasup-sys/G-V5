namespace GV5.Application.Contracts;

/// <summary>Marker for a request that changes application state.</summary>
public interface ICommand<TResponse>
{
}

/// <summary>Marker for a read-only application request.</summary>
public interface IQuery<TResponse>
{
}

/// <summary>Handles one command type. Cancellation follows the standard Task cancellation contract.</summary>
public interface ICommandHandler<TCommand, TResponse>
    where TCommand : ICommand<TResponse>
{
    Task<TResponse> HandleAsync(TCommand command, CancellationToken cancellationToken);
}

/// <summary>Handles one query type. Cancellation follows the standard Task cancellation contract.</summary>
public interface IQueryHandler<TQuery, TResponse>
    where TQuery : IQuery<TResponse>
{
    Task<TResponse> HandleAsync(TQuery query, CancellationToken cancellationToken);
}
