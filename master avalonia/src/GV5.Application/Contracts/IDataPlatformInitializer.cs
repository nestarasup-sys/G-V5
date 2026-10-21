namespace GV5.Application.Contracts;

/// <summary>Ensures the local data schema is ready before an application feature persists domain records.</summary>
public interface IDataPlatformInitializer
{
    Task InitializeAsync(CancellationToken cancellationToken = default);
}
