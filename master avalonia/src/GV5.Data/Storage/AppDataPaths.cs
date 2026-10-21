using GV5.Application.Contracts;

namespace GV5.Data.Storage;

/// <summary>Resolves the isolated G-V5 data layout under the current user's local application data directory.</summary>
public sealed class AppDataPaths : IAppDataPaths
{
    public const string VendorDirectoryName = "Gacha Nymi";
    public const string ProductDirectoryName = "G-V5";
    public const string DatabaseFileName = "gv5.sqlite3";

    public AppDataPaths(string root)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(root);
        Root = Path.GetFullPath(root);
    }

    public string Root { get; }
    public string DatabaseDirectory => Path.Combine(Root, "database");
    public string DatabaseFile => Path.Combine(DatabaseDirectory, DatabaseFileName);
    public string AssetsDirectory => Path.Combine(Root, "assets");
    public string ThumbnailsDirectory => Path.Combine(Root, "thumbnails");
    public string ProjectsDirectory => Path.Combine(Root, "projects");
    public string BackupsDirectory => Path.Combine(Root, "backups");
    public string CacheDirectory => Path.Combine(Root, "cache");
    public string LogsDirectory => Path.Combine(Root, "logs");
    public string TempDirectory => Path.Combine(Root, "temp");

    public static AppDataPaths ForCurrentUser()
    {
        var baseDirectory = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrWhiteSpace(baseDirectory))
        {
            baseDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        }

        if (string.IsNullOrWhiteSpace(baseDirectory))
        {
            throw new InvalidOperationException("Could not resolve a per-user application data directory.");
        }

        return new AppDataPaths(Path.Combine(baseDirectory, VendorDirectoryName, ProductDirectoryName));
    }

    public void EnsureDirectoriesExist()
    {
        foreach (var directory in GetManagedDirectories())
        {
            Directory.CreateDirectory(directory);
        }
    }

    private IEnumerable<string> GetManagedDirectories()
    {
        yield return Root;
        yield return DatabaseDirectory;
        yield return AssetsDirectory;
        yield return ThumbnailsDirectory;
        yield return ProjectsDirectory;
        yield return BackupsDirectory;
        yield return CacheDirectory;
        yield return LogsDirectory;
        yield return TempDirectory;
    }
}
