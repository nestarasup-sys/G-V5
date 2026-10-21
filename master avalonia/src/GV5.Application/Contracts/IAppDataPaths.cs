namespace GV5.Application.Contracts;

/// <summary>Canonical per-user locations used by persistence and asset services.</summary>
public interface IAppDataPaths
{
    string Root { get; }
    string DatabaseDirectory { get; }
    string DatabaseFile { get; }
    string AssetsDirectory { get; }
    string ThumbnailsDirectory { get; }
    string ProjectsDirectory { get; }
    string BackupsDirectory { get; }
    string CacheDirectory { get; }
    string LogsDirectory { get; }
    string TempDirectory { get; }

    /// <summary>Creates the application data directories. Path resolution alone has no filesystem side effects.</summary>
    void EnsureDirectoriesExist();
}
