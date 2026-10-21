using GV5.Data.Storage;
using Xunit;

namespace GV5.Data.Tests;

public sealed class AppDataPathsTests
{
    [Fact]
    public void Paths_AreSeparatedUnderOneNormalizedRoot_WithoutCreatingFiles()
    {
        var tempBase = Path.Combine(Path.GetTempPath(), $"gv5-paths-{Guid.NewGuid():N}");
        var paths = new AppDataPaths(Path.Combine(tempBase, ".", "data"));

        try
        {
            Assert.Equal(Path.Combine(tempBase, "data"), paths.Root);
            Assert.Equal(Path.Combine(paths.Root, "database"), paths.DatabaseDirectory);
            Assert.Equal(Path.Combine(paths.DatabaseDirectory, AppDataPaths.DatabaseFileName), paths.DatabaseFile);
            Assert.Equal(Path.Combine(paths.Root, "assets"), paths.AssetsDirectory);
            Assert.Equal(Path.Combine(paths.Root, "thumbnails"), paths.ThumbnailsDirectory);
            Assert.Equal(Path.Combine(paths.Root, "projects"), paths.ProjectsDirectory);
            Assert.Equal(Path.Combine(paths.Root, "backups"), paths.BackupsDirectory);
            Assert.Equal(Path.Combine(paths.Root, "cache"), paths.CacheDirectory);
            Assert.Equal(Path.Combine(paths.Root, "logs"), paths.LogsDirectory);
            Assert.Equal(Path.Combine(paths.Root, "temp"), paths.TempDirectory);
            Assert.False(Directory.Exists(tempBase));
        }
        finally
        {
            if (Directory.Exists(tempBase))
            {
                Directory.Delete(tempBase, recursive: true);
            }
        }
    }

    [Fact]
    public void EnsureDirectoriesExist_CreatesAllManagedDirectories()
    {
        var root = Path.Combine(Path.GetTempPath(), $"gv5-paths-{Guid.NewGuid():N}");
        var paths = new AppDataPaths(root);

        try
        {
            paths.EnsureDirectoriesExist();

            Assert.All(
                new[]
                {
                    paths.Root,
                    paths.DatabaseDirectory,
                    paths.AssetsDirectory,
                    paths.ThumbnailsDirectory,
                    paths.ProjectsDirectory,
                    paths.BackupsDirectory,
                    paths.CacheDirectory,
                    paths.LogsDirectory,
                    paths.TempDirectory
                },
                directory => Assert.True(Directory.Exists(directory), $"Expected directory: {directory}"));
        }
        finally
        {
            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }

    [Fact]
    public void ForCurrentUser_UsesDedicatedGv5DirectoryUnderLocalProfile()
    {
        var paths = AppDataPaths.ForCurrentUser();
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var existedBeforeResolution = Directory.Exists(paths.Root);

        Assert.EndsWith(Path.Combine(AppDataPaths.VendorDirectoryName, AppDataPaths.ProductDirectoryName), paths.Root, StringComparison.OrdinalIgnoreCase);
        if (!string.IsNullOrWhiteSpace(localAppData))
        {
            Assert.StartsWith(Path.GetFullPath(localAppData), paths.Root, StringComparison.OrdinalIgnoreCase);
        }
        Assert.Equal(existedBeforeResolution, Directory.Exists(paths.Root));
    }

    [Fact]
    public void Constructor_RejectsBlankRoot()
    {
        Assert.Throws<ArgumentException>(() => new AppDataPaths(" "));
    }
}
